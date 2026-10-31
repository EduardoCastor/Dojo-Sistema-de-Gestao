-- ============================================================================
-- MIGRATION 39: FIX HAS_TENANT_ROLE TEXT OVERLOAD & MANAGE_PORTAL_ACCOUNT_ACCESS ROBUSTNESS
-- ============================================================================
-- Product: Tatame Club (https://tatameclub.com.br)
-- Company: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
-- Target Supabase Project: knmzzndugadmklzzgtaa
--
-- Objectives:
-- 1. Create overloaded has_tenant_role(uuid, VARIADIC text[]) to ensure text literals
--    passed from functions or policies match without SQLSTATE 42883 type mismatch.
-- 2. Harden manage_portal_account_access with:
--      - Explicit type cast to app_role[] in has_tenant_role call.
--      - search_path = public, auth, extensions.
--      - Resilient invite code generator with fallback (never fails on gen_random_bytes).
--      - Grants to authenticated and service_role.
--      - Notification to reload PostgREST schema cache immediately.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. OVERLOAD: HAS_TENANT_ROLE COM VARIADIC TEXT[]
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_tenant_role(t_id uuid, VARIADIC target_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.tenant_memberships 
    WHERE tenant_id = t_id 
      AND user_id = auth.uid() 
      AND status = 'active'
      AND role::text = ANY(target_roles)
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_tenant_role(uuid, VARIADIC text[]) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. HARDENED MANAGE_PORTAL_ACCOUNT_ACCESS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manage_portal_account_access(
  p_tenant_id uuid,
  p_target_type text, -- 'student' ou 'guardian'
  p_target_id uuid,   -- student.id ou person.id (do responsável)
  p_action text,      -- 'invite', 'resend_invite', 'resend_email', 'revoke_invite', 'block', 'revoke_access', 'reactivate', 'toggle_anthropometry'
  p_email text DEFAULT NULL,
  p_allow_anthropometry boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_name text;
  v_student record;
  v_person record;
  v_existing_inv record;
  v_invite_code text;
  v_invitation_id uuid;
  v_target_user_id uuid;
  v_normalized_email text := lower(trim(COALESCE(p_email, '')));
  v_elapsed_sec int;
  v_has_permission boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.' USING ERRCODE = '42501';
  END IF;

  -- Validação de permissão tolerante a text[] e app_role[]
  SELECT (
    public.is_platform_admin()
    OR public.has_tenant_role(p_tenant_id, VARIADIC ARRAY['owner', 'branch_manager', 'secretary']::app_role[])
    OR public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary')
  ) INTO v_has_permission;

  IF NOT v_has_permission THEN
    RAISE EXCEPTION 'Permissão insuficiente: apenas administradores ou secretaria da academia podem gerenciar contas de alunos e responsáveis.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p.full_name, u.email, 'Gestor')
  INTO v_actor_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

  -- --------------------------------------------------------------------------
  -- 1. FLUXO ALUNO (target_type = 'student')
  -- --------------------------------------------------------------------------
  IF p_target_type = 'student' THEN
    SELECT s.*, p.full_name, p.email AS person_email, p.cpf
    INTO v_student
    FROM public.students s
    JOIN public.persons p ON p.id = s.person_id AND p.tenant_id = s.tenant_id
    WHERE s.id = p_target_id AND s.tenant_id = p_tenant_id;

    IF v_student.id IS NULL THEN
      RAISE EXCEPTION 'Aluno não encontrado nesta academia.' USING ERRCODE = 'P0002';
    END IF;

    IF p_action = 'toggle_anthropometry' THEN
      UPDATE public.students
      SET allow_anthropometry_view = COALESCE(p_allow_anthropometry, NOT allow_anthropometry_view),
          updated_at = now()
      WHERE id = v_student.id AND tenant_id = p_tenant_id;

      RETURN jsonb_build_object(
        'success', true,
        'allow_anthropometry_view', COALESCE(p_allow_anthropometry, NOT v_student.allow_anthropometry_view)
      );
    END IF;

    IF v_normalized_email = '' THEN
      v_normalized_email := lower(trim(COALESCE(v_student.person_email, '')));
    END IF;

    -- REENVIAR APENAS E-MAIL (MANTENDO CÓDIGO ATIVO EXISTENTE)
    IF p_action = 'resend_email' THEN
      SELECT * INTO v_existing_inv
      FROM public.tenant_user_invitations
      WHERE tenant_id = p_tenant_id
        AND target_student_id = v_student.id
        AND status = 'invited'
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_existing_inv.id IS NULL THEN
        RAISE EXCEPTION 'Nenhum convite pendente ativo encontrado para o aluno. Gere um novo convite.'
          USING ERRCODE = 'P0002';
      END IF;

      -- Proteção contra spam / rate-limiting (cooldown de 60 segundos após envio com sucesso)
      IF v_existing_inv.last_email_sent_at IS NOT NULL AND v_existing_inv.last_email_status = 'sent' THEN
        v_elapsed_sec := EXTRACT(EPOCH FROM (now() - v_existing_inv.last_email_sent_at))::int;
        IF v_elapsed_sec < 60 THEN
          RAISE EXCEPTION 'Um e-mail de ativação já foi enviado recentemente (%s segundos atrás). Aguarde 1 minuto.', v_elapsed_sec
            USING ERRCODE = '22023';
        END IF;
      END IF;

      -- Atualiza e-mail se foi informado um novo
      IF v_normalized_email <> '' AND v_normalized_email <> v_existing_inv.email THEN
        UPDATE public.tenant_user_invitations
        SET email = v_normalized_email, updated_at = now()
        WHERE id = v_existing_inv.id;

        UPDATE public.persons
        SET email = v_normalized_email, updated_at = now()
        WHERE id = v_student.person_id AND tenant_id = p_tenant_id;

        v_existing_inv.email := v_normalized_email;
      END IF;

      INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, entity, entity_id, details)
      VALUES (
        p_tenant_id, v_uid, v_actor_name, 'Reenvio de E-mail Convite Aluno', 'Student', v_student.id::text,
        format('Reenvio de e-mail de convite (%s) para o aluno %s (%s).', v_existing_inv.invite_code, v_student.full_name, v_existing_inv.email)
      );

      RETURN jsonb_build_object(
        'success', true,
        'status', 'invited',
        'invite_code', v_existing_inv.invite_code,
        'invitation_id', v_existing_inv.id,
        'email', v_existing_inv.email,
        'full_name', v_student.full_name
      );

    -- GERAR NOVO CONVITE OU REINICIAR CÓDIGO
    ELSIF p_action IN ('invite', 'resend_invite') THEN
      IF v_normalized_email = '' THEN
        RAISE EXCEPTION 'Informe um e-mail válido para o aluno antes de gerar o convite de acesso.';
      END IF;

      UPDATE public.persons
      SET email = v_normalized_email, updated_at = now()
      WHERE id = v_student.person_id AND tenant_id = p_tenant_id;

      -- Expirar convites anteriores pendentes
      UPDATE public.tenant_user_invitations
      SET status = 'expired', updated_at = now()
      WHERE tenant_id = p_tenant_id
        AND target_student_id = v_student.id
        AND status = 'invited';

      -- Geração de código com fallback resiliente
      BEGIN
        v_invite_code := 'AL-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 8));
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          v_invite_code := 'AL-' || upper(substr(encode(public.gen_random_bytes(4), 'hex'), 1, 8));
        EXCEPTION WHEN OTHERS THEN
          v_invite_code := 'AL-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
        END;
      END;

      INSERT INTO public.tenant_user_invitations (
        tenant_id, branch_id, email, full_name, role, status,
        invited_by_user_id, invited_by_name, invite_code, target_student_id,
        expires_at
      ) VALUES (
        p_tenant_id, v_student.branch_id, v_normalized_email, v_student.full_name, 'student', 'invited',
        v_uid, v_actor_name, v_invite_code, v_student.id,
        now() + interval '14 days'
      )
      RETURNING id INTO v_invitation_id;

      UPDATE public.students
      SET portal_access_status = 'invited', updated_at = now()
      WHERE id = v_student.id AND tenant_id = p_tenant_id;

      INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, entity, entity_id, details)
      VALUES (
        p_tenant_id, v_uid, v_actor_name, 'Convite Portal do Aluno', 'Student', v_student.id::text,
        format('Convite de acesso (%s) gerado para o aluno %s (%s).', v_invite_code, v_student.full_name, v_normalized_email)
      );

      RETURN jsonb_build_object(
        'success', true,
        'status', 'invited',
        'invite_code', v_invite_code,
        'invitation_id', v_invitation_id,
        'email', v_normalized_email,
        'full_name', v_student.full_name
      );

    ELSIF p_action = 'revoke_invite' THEN
      UPDATE public.tenant_user_invitations
      SET status = 'revoked', updated_at = now()
      WHERE tenant_id = p_tenant_id AND target_student_id = v_student.id AND status = 'invited';

      UPDATE public.students
      SET portal_access_status = 'none', updated_at = now()
      WHERE id = v_student.id AND tenant_id = p_tenant_id;

      RETURN jsonb_build_object('success', true, 'status', 'none');

    ELSIF p_action IN ('block', 'revoke_access') THEN
      UPDATE public.students
      SET portal_access_status = CASE WHEN p_action = 'block' THEN 'blocked' ELSE 'revoked' END,
          user_id = CASE WHEN p_action = 'revoke_access' THEN NULL ELSE user_id END,
          updated_at = now()
      WHERE id = v_student.id AND tenant_id = p_tenant_id;

      IF v_student.user_id IS NOT NULL THEN
        UPDATE public.tenant_memberships
        SET status = 'suspended', updated_at = now()
        WHERE tenant_id = p_tenant_id AND user_id = v_student.user_id AND role = 'student';
      END IF;

      INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, entity, entity_id, details)
      VALUES (
        p_tenant_id, v_uid, v_actor_name,
        CASE WHEN p_action = 'block' THEN 'Bloqueio de Acesso Aluno' ELSE 'Revogação de Acesso Aluno' END,
        'Student', v_student.id::text,
        format('Acesso do aluno %s alterado para %s.', v_student.full_name, p_action)
      );

      RETURN jsonb_build_object(
        'success', true,
        'status', CASE WHEN p_action = 'block' THEN 'blocked' ELSE 'revoked' END
      );

    ELSIF p_action = 'reactivate' THEN
      UPDATE public.students
      SET portal_access_status = 'active', updated_at = now()
      WHERE id = v_student.id AND tenant_id = p_tenant_id;

      IF v_student.user_id IS NOT NULL THEN
        UPDATE public.tenant_memberships
        SET status = 'active', updated_at = now()
        WHERE tenant_id = p_tenant_id AND user_id = v_student.user_id AND role = 'student';
      END IF;

      RETURN jsonb_build_object('success', true, 'status', 'active');
    END IF;

  -- --------------------------------------------------------------------------
  -- 2. FLUXO RESPONSÁVEL (target_type = 'guardian')
  -- --------------------------------------------------------------------------
  ELSIF p_target_type = 'guardian' THEN
    SELECT * INTO v_person
    FROM public.persons
    WHERE id = p_target_id AND tenant_id = p_tenant_id;

    IF v_person.id IS NULL THEN
      RAISE EXCEPTION 'Responsável não encontrado nesta academia.' USING ERRCODE = 'P0002';
    END IF;

    IF v_normalized_email = '' THEN
      v_normalized_email := lower(trim(COALESCE(v_person.email, '')));
    END IF;

    -- REENVIAR APENAS E-MAIL (MANTENDO CÓDIGO ATIVO EXISTENTE)
    IF p_action = 'resend_email' THEN
      SELECT * INTO v_existing_inv
      FROM public.tenant_user_invitations
      WHERE tenant_id = p_tenant_id
        AND target_guardian_person_id = v_person.id
        AND status = 'invited'
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_existing_inv.id IS NULL THEN
        RAISE EXCEPTION 'Nenhum convite pendente ativo encontrado para o responsável. Gere um novo convite.'
          USING ERRCODE = 'P0002';
      END IF;

      IF v_existing_inv.last_email_sent_at IS NOT NULL AND v_existing_inv.last_email_status = 'sent' THEN
        v_elapsed_sec := EXTRACT(EPOCH FROM (now() - v_existing_inv.last_email_sent_at))::int;
        IF v_elapsed_sec < 60 THEN
          RAISE EXCEPTION 'Um e-mail de ativação já foi enviado recentemente (%s segundos atrás). Aguarde 1 minuto.', v_elapsed_sec
            USING ERRCODE = '22023';
        END IF;
      END IF;

      IF v_normalized_email <> '' AND v_normalized_email <> v_existing_inv.email THEN
        UPDATE public.tenant_user_invitations
        SET email = v_normalized_email, updated_at = now()
        WHERE id = v_existing_inv.id;

        UPDATE public.persons
        SET email = v_normalized_email, updated_at = now()
        WHERE id = v_person.id AND tenant_id = p_tenant_id;

        v_existing_inv.email := v_normalized_email;
      END IF;

      INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, entity, entity_id, details)
      VALUES (
        p_tenant_id, v_uid, v_actor_name, 'Reenvio de E-mail Convite Responsável', 'Person', v_person.id::text,
        format('Reenvio de e-mail de convite (%s) para o responsável %s (%s).', v_existing_inv.invite_code, v_person.full_name, v_existing_inv.email)
      );

      RETURN jsonb_build_object(
        'success', true,
        'status', 'invited',
        'invite_code', v_existing_inv.invite_code,
        'invitation_id', v_existing_inv.id,
        'email', v_existing_inv.email,
        'full_name', v_person.full_name
      );

    ELSIF p_action IN ('invite', 'resend_invite') THEN
      IF v_normalized_email = '' THEN
        RAISE EXCEPTION 'Informe um e-mail válido para o responsável antes de gerar o convite de acesso.';
      END IF;

      UPDATE public.persons
      SET email = v_normalized_email,
          portal_access_status = 'invited',
          updated_at = now()
      WHERE id = v_person.id AND tenant_id = p_tenant_id;

      UPDATE public.tenant_user_invitations
      SET status = 'expired', updated_at = now()
      WHERE tenant_id = p_tenant_id
        AND target_guardian_person_id = v_person.id
        AND status = 'invited';

      -- Geração com fallback resiliente
      BEGIN
        v_invite_code := 'RP-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 8));
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          v_invite_code := 'RP-' || upper(substr(encode(public.gen_random_bytes(4), 'hex'), 1, 8));
        EXCEPTION WHEN OTHERS THEN
          v_invite_code := 'RP-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
        END;
      END;

      INSERT INTO public.tenant_user_invitations (
        tenant_id, email, full_name, role, status,
        invited_by_user_id, invited_by_name, invite_code, target_guardian_person_id,
        expires_at
      ) VALUES (
        p_tenant_id, v_normalized_email, v_person.full_name, 'guardian', 'invited',
        v_uid, v_actor_name, v_invite_code, v_person.id,
        now() + interval '14 days'
      )
      RETURNING id INTO v_invitation_id;

      INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, entity, entity_id, details)
      VALUES (
        p_tenant_id, v_uid, v_actor_name, 'Convite Portal do Responsável', 'Person', v_person.id::text,
        format('Convite de acesso (%s) gerado para o responsável %s (%s).', v_invite_code, v_person.full_name, v_normalized_email)
      );

      RETURN jsonb_build_object(
        'success', true,
        'status', 'invited',
        'invite_code', v_invite_code,
        'invitation_id', v_invitation_id,
        'email', v_normalized_email,
        'full_name', v_person.full_name
      );

    ELSIF p_action = 'revoke_invite' THEN
      UPDATE public.tenant_user_invitations
      SET status = 'revoked', updated_at = now()
      WHERE tenant_id = p_tenant_id AND target_guardian_person_id = v_person.id AND status = 'invited';

      UPDATE public.persons
      SET portal_access_status = 'none', updated_at = now()
      WHERE id = v_person.id AND tenant_id = p_tenant_id;

      RETURN jsonb_build_object('success', true, 'status', 'none');

    ELSIF p_action IN ('block', 'revoke_access') THEN
      UPDATE public.persons
      SET portal_access_status = CASE WHEN p_action = 'block' THEN 'blocked' ELSE 'revoked' END,
          user_id = CASE WHEN p_action = 'revoke_access' THEN NULL ELSE user_id END,
          updated_at = now()
      WHERE id = v_person.id AND tenant_id = p_tenant_id;

      IF v_person.user_id IS NOT NULL THEN
        UPDATE public.tenant_memberships
        SET status = 'suspended', updated_at = now()
        WHERE tenant_id = p_tenant_id AND user_id = v_person.user_id AND role = 'guardian';
      END IF;

      INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, entity, entity_id, details)
      VALUES (
        p_tenant_id, v_uid, v_actor_name,
        CASE WHEN p_action = 'block' THEN 'Bloqueio de Acesso Responsável' ELSE 'Revogação de Acesso Responsável' END,
        'Person', v_person.id::text,
        format('Acesso do responsável %s alterado para %s.', v_person.full_name, p_action)
      );

      RETURN jsonb_build_object(
        'success', true,
        'status', CASE WHEN p_action = 'block' THEN 'blocked' ELSE 'revoked' END
      );

    ELSIF p_action = 'reactivate' THEN
      UPDATE public.persons
      SET portal_access_status = 'active', updated_at = now()
      WHERE id = v_person.id AND tenant_id = p_tenant_id;

      IF v_person.user_id IS NOT NULL THEN
        UPDATE public.tenant_memberships
        SET status = 'active', updated_at = now()
        WHERE tenant_id = p_tenant_id AND user_id = v_person.user_id AND role = 'guardian';
      END IF;

      RETURN jsonb_build_object('success', true, 'status', 'active');
    END IF;
  END IF;

  RAISE EXCEPTION 'Ação de gestão de acesso desconhecida: %', p_action USING ERRCODE = '22023';
END;
$$;

GRANT EXECUTE ON FUNCTION public.manage_portal_account_access(uuid, text, uuid, text, text, boolean) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. RECARREGAMENTO DO CACHE DO POSTGREST
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
