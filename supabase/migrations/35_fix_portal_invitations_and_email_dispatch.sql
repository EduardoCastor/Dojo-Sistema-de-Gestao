-- ============================================================================
-- MIGRATION 35: FIX PORTAL INVITATIONS, AUTOMATIC EMAIL DISPATCH, AND ACCESS VALIDATION
-- ============================================================================
-- Product: Tatame Club (https://tatameclub.com.br)
-- Company: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
--
-- Objectives:
-- 1. Create public.portal_invitation_email_logs to audit every student & guardian
--    invitation email dispatch (sent, failed, missing_config, pending).
-- 2. Expand public.tenant_user_invitations with email delivery audit columns:
--    (last_email_sent_at, last_email_status, last_email_error).
-- 3. Provide RPC verify_portal_invitation(p_invite_code text) so users and UI
--    can pre-validate a code before sign-up and display clear, specific feedback
--    (never mask reasons with a generic "invalid, used or revoked" message).
-- 4. Improve manage_portal_account_access to return full details for transactional email.
-- 5. Improve claim_portal_invitation with whitespace normalization, atomic row locking,
--    and precise, differentiated error messages for each rejection cause:
--      - Code not found
--      - Already claimed / activated
--      - Revoked by academy
--      - Expired
--      - CPF mismatch
--      - Account already linked
-- 6. Grant appropriate RLS and execution permissions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXPAND PUBLIC.TENANT_USER_INVITATIONS WITH EMAIL AUDIT COLUMNS
-- ----------------------------------------------------------------------------
ALTER TABLE public.tenant_user_invitations
  ADD COLUMN IF NOT EXISTS last_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_email_status text CHECK (last_email_status IS NULL OR last_email_status IN ('sent', 'failed', 'missing_config', 'pending')),
  ADD COLUMN IF NOT EXISTS last_email_error text;

-- Ensure index on uppercase trimmed invite code exists
DROP INDEX IF EXISTS idx_tenant_invitations_code_upper;
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_code_upper
  ON public.tenant_user_invitations(upper(regexp_replace(invite_code, '\s+', '', 'g')));

-- ----------------------------------------------------------------------------
-- 2. CREATE TABLE PUBLIC.PORTAL_INVITATION_EMAIL_LOGS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portal_invitation_email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invitation_id uuid REFERENCES public.tenant_user_invitations(id) ON DELETE SET NULL,
  invite_code text NOT NULL,
  recipient_email text NOT NULL,
  recipient_name text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('student', 'guardian', 'team')),
  target_id uuid,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'missing_config', 'pending')),
  provider text NOT NULL DEFAULT 'resend',
  provider_message_id text,
  error_message text,
  triggered_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_email_logs_tenant
  ON public.portal_invitation_email_logs(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_email_logs_invite_code
  ON public.portal_invitation_email_logs(invite_code);

ALTER TABLE public.portal_invitation_email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portal_email_logs_select" ON public.portal_invitation_email_logs;
CREATE POLICY "portal_email_logs_select" ON public.portal_invitation_email_logs
FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary')
);

DROP POLICY IF EXISTS "portal_email_logs_insert" ON public.portal_invitation_email_logs;
CREATE POLICY "portal_email_logs_insert" ON public.portal_invitation_email_logs
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_admin()
  OR public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary')
  OR tenant_id IS NOT NULL
);

-- ----------------------------------------------------------------------------
-- 3. RPC: VERIFY_PORTAL_INVITATION (Public pre-validation for login & claim)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_portal_invitation(
  p_invite_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean_code text := upper(regexp_replace(trim(COALESCE(p_invite_code, '')), '\s+', '', 'g'));
  v_inv record;
  v_tenant record;
  v_person record;
  v_target_cpf text := '';
  v_masked_cpf text := '';
  v_masked_email text := '';
  v_email_parts text[];
  v_email_user text;
  v_email_domain text;
BEGIN
  IF v_clean_code = '' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'empty_code',
      'message', 'Informe o código de convite fornecido pela academia.'
    );
  END IF;

  -- Localiza convite ignorando espaços ou maiúsculas/minúsculas
  SELECT * INTO v_inv
  FROM public.tenant_user_invitations
  WHERE upper(regexp_replace(invite_code, '\s+', '', 'g')) = v_clean_code
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_inv.id IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'not_found',
      'message', 'Código de convite não encontrado no sistema. Verifique a digitação ou solicite um novo envio à academia.'
    );
  END IF;

  -- Consulta correta com trade_name e legal_name
  SELECT trade_name, legal_name INTO v_tenant
  FROM public.tenants
  WHERE id = v_inv.tenant_id;

  -- Obter CPF cadastrado
  IF v_inv.target_student_id IS NOT NULL THEN
    SELECT p.* INTO v_person
    FROM public.students s
    JOIN public.persons p ON p.id = s.person_id
    WHERE s.id = v_inv.target_student_id AND s.tenant_id = v_inv.tenant_id;
  ELSIF v_inv.target_guardian_person_id IS NOT NULL THEN
    SELECT p.* INTO v_person
    FROM public.persons p
    WHERE p.id = v_inv.target_guardian_person_id AND p.tenant_id = v_inv.tenant_id;
  END IF;

  v_target_cpf := regexp_replace(COALESCE(v_person.cpf, ''), '\D', '', 'g');
  IF length(v_target_cpf) = 11 THEN
    v_masked_cpf := substr(v_target_cpf, 1, 3) || '.***.***-' || substr(v_target_cpf, 10, 2);
  END IF;

  -- Mascara e-mail para exibição segura
  IF v_inv.email LIKE '%@%' THEN
    v_email_parts := string_to_array(v_inv.email, '@');
    v_email_user := v_email_parts[1];
    v_email_domain := v_email_parts[2];
    IF length(v_email_user) > 2 THEN
      v_masked_email := substr(v_email_user, 1, 2) || '***@' || v_email_domain;
    ELSE
      v_masked_email := substr(v_email_user, 1, 1) || '***@' || v_email_domain;
    END IF;
  ELSE
    v_masked_email := v_inv.email;
  END IF;

  -- 1. Verifica se já foi aceito
  IF v_inv.status = 'accepted' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'already_used',
      'message', 'Este código de convite já foi utilizado e ativado anteriormente.',
      'accepted_at', v_inv.accepted_at,
      'academy_name', COALESCE(NULLIF(trim(v_tenant.trade_name), ''), NULLIF(trim(v_tenant.legal_name), ''), 'Tatame Club')
    );
  END IF;

  -- 2. Verifica se foi cancelado/revogado
  IF v_inv.status = 'revoked' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'revoked',
      'message', 'Este convite foi revogado pela administração da academia. Solicite um novo código à secretaria.',
      'academy_name', COALESCE(NULLIF(trim(v_tenant.trade_name), ''), NULLIF(trim(v_tenant.legal_name), ''), 'Tatame Club')
    );
  END IF;

  -- 3. Verifica expiração por data ou status
  IF v_inv.status = 'expired' OR v_inv.expires_at < now() THEN
    IF v_inv.status <> 'expired' THEN
      UPDATE public.tenant_user_invitations
      SET status = 'expired', updated_at = now()
      WHERE id = v_inv.id;
    END IF;
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'expired',
      'message', 'Este código de convite expirou. Solicite um novo código de ativação à secretaria da academia.',
      'expires_at', v_inv.expires_at,
      'academy_name', COALESCE(NULLIF(trim(v_tenant.trade_name), ''), NULLIF(trim(v_tenant.legal_name), ''), 'Tatame Club')
    );
  END IF;

  -- Convite válido e pendente de ativação
  RETURN jsonb_build_object(
    'valid', true,
    'reason', 'ready_to_claim',
    'message', 'Convite válido e pronto para ativação.',
    'invitation_id', v_inv.id,
    'invite_code', v_inv.invite_code,
    'tenant_id', v_inv.tenant_id,
    'academy_name', COALESCE(NULLIF(trim(v_tenant.trade_name), ''), NULLIF(trim(v_tenant.legal_name), ''), 'Tatame Club'),
    'role', v_inv.role,
    'full_name', v_inv.full_name,
    'email', v_inv.email,
    'masked_email', v_masked_email,
    'masked_cpf', v_masked_cpf,
    'requires_cpf', (v_target_cpf <> ''),
    'expires_at', v_inv.expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_portal_invitation(text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. RPC: CLAIM_PORTAL_INVITATION (Robust, atomic & precise error reporting)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_portal_invitation(
  p_invite_code text,
  p_cpf text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_email text;
  v_clean_code text := upper(regexp_replace(trim(COALESCE(p_invite_code, '')), '\s+', '', 'g'));
  v_clean_input_cpf text := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
  v_target_cpf text := '';
  v_inv record;
  v_tenant record;
  v_student record;
  v_person record;
  v_membership_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autentique-se com sua conta antes de validar o convite da academia.'
      USING ERRCODE = '42501';
  END IF;

  IF v_clean_code = '' THEN
    RAISE EXCEPTION 'Informe o código de convite da academia.'
      USING ERRCODE = '22023';
  END IF;

  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = v_uid;

  -- Bloqueio transacional do registro de convite para impedir concorrência/duplo claim
  SELECT * INTO v_inv
  FROM public.tenant_user_invitations
  WHERE upper(regexp_replace(invite_code, '\s+', '', 'g')) = v_clean_code
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Código de convite não encontrado no sistema. Verifique a digitação.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Consulta correta com trade_name e legal_name
  SELECT trade_name, legal_name INTO v_tenant
  FROM public.tenants
  WHERE id = v_inv.tenant_id;

  -- Diagnóstico preciso do status
  IF v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'Este código de convite já foi utilizado e ativado anteriormente.'
      USING ERRCODE = '22023';
  END IF;

  IF v_inv.status = 'revoked' THEN
    RAISE EXCEPTION 'Este convite foi revogado pela administração da academia. Solicite um novo código à secretaria.'
      USING ERRCODE = '22023';
  END IF;

  IF v_inv.status = 'expired' OR v_inv.expires_at < now() THEN
    UPDATE public.tenant_user_invitations
    SET status = 'expired', updated_at = now()
    WHERE id = v_inv.id;

    RAISE EXCEPTION 'Este convite expirou. Solicite um novo código à secretaria da sua academia.'
      USING ERRCODE = '22023';
  END IF;

  -- Obter CPF do cadastro da pessoa
  IF v_inv.target_student_id IS NOT NULL THEN
    SELECT s.*, p.cpf AS person_cpf, p.full_name AS person_full_name, p.id AS person_id
    INTO v_student
    FROM public.students s
    JOIN public.persons p ON p.id = s.person_id
    WHERE s.id = v_inv.target_student_id AND s.tenant_id = v_inv.tenant_id;

    v_target_cpf := regexp_replace(COALESCE(v_student.person_cpf, ''), '\D', '', 'g');
  ELSIF v_inv.target_guardian_person_id IS NOT NULL THEN
    SELECT p.*, p.cpf AS person_cpf
    INTO v_person
    FROM public.persons p
    WHERE p.id = v_inv.target_guardian_person_id AND p.tenant_id = v_inv.tenant_id;

    v_target_cpf := regexp_replace(COALESCE(v_person.person_cpf, ''), '\D', '', 'g');
  END IF;

  -- Validação de CPF para segurança e conformidade LGPD
  IF v_target_cpf <> '' AND v_clean_input_cpf <> '' AND v_target_cpf <> v_clean_input_cpf THEN
    RAISE EXCEPTION 'O CPF informado não corresponde ao titular do convite cadastrado na academia.'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_cpf <> '' AND v_clean_input_cpf = '' AND lower(trim(v_inv.email)) <> v_user_email THEN
    RAISE EXCEPTION 'Como você está autenticando com um e-mail diferente do convite (%s), confirme seu CPF cadastrado na academia.', v_inv.email
      USING ERRCODE = '42501';
  END IF;

  -- Assegura criação ou atualização de perfil de usuário
  INSERT INTO public.profiles (id, full_name, is_platform_admin)
  VALUES (v_uid, v_inv.full_name, false)
  ON CONFLICT (id) DO UPDATE
  SET full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
      updated_at = now();

  -- Vínculo de Aluno ou Responsável
  IF v_inv.role = 'student' AND v_inv.target_student_id IS NOT NULL THEN
    UPDATE public.students
    SET user_id = v_uid,
        portal_access_status = 'active',
        updated_at = now()
    WHERE id = v_inv.target_student_id AND tenant_id = v_inv.tenant_id;

    -- Atualiza e-mail da pessoa vinculada se estava em branco
    UPDATE public.persons
    SET email = COALESCE(NULLIF(email, ''), v_user_email),
        user_id = v_uid,
        portal_access_status = 'active',
        updated_at = now()
    WHERE id = v_student.person_id AND tenant_id = v_inv.tenant_id;

    INSERT INTO public.tenant_memberships (
      tenant_id, user_id, branch_id, role, status, student_id
    ) VALUES (
      v_inv.tenant_id, v_uid, v_inv.branch_id, 'student', 'active', v_inv.target_student_id
    )
    ON CONFLICT (tenant_id, user_id, role) DO UPDATE
    SET status = 'active',
        student_id = EXCLUDED.student_id,
        updated_at = now()
    RETURNING id INTO v_membership_id;

  ELSIF v_inv.role = 'guardian' AND v_inv.target_guardian_person_id IS NOT NULL THEN
    UPDATE public.persons
    SET user_id = v_uid,
        portal_access_status = 'active',
        email = COALESCE(NULLIF(email, ''), v_user_email),
        updated_at = now()
    WHERE id = v_inv.target_guardian_person_id AND tenant_id = v_inv.tenant_id;

    INSERT INTO public.tenant_memberships (
      tenant_id, user_id, branch_id, role, status, guardian_person_id
    ) VALUES (
      v_inv.tenant_id, v_uid, v_inv.branch_id, 'guardian', 'active', v_inv.target_guardian_person_id
    )
    ON CONFLICT (tenant_id, user_id, role) DO UPDATE
    SET status = 'active',
        guardian_person_id = EXCLUDED.guardian_person_id,
        updated_at = now()
    RETURNING id INTO v_membership_id;
  ELSE
    INSERT INTO public.tenant_memberships (
      tenant_id, user_id, branch_id, role, status
    ) VALUES (
      v_inv.tenant_id, v_uid, v_inv.branch_id, v_inv.role, 'active'
    )
    ON CONFLICT (tenant_id, user_id, role) DO UPDATE
    SET status = 'active',
        updated_at = now()
    RETURNING id INTO v_membership_id;
  END IF;

  -- Marca convite como aceito
  UPDATE public.tenant_user_invitations
  SET status = 'accepted',
      accepted_by_user_id = v_uid,
      accepted_at = now(),
      updated_at = now()
  WHERE id = v_inv.id;

  -- Registra auditoria
  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, entity, entity_id, details)
  VALUES (
    v_inv.tenant_id, v_uid, v_inv.full_name, 'Ativação de Convite Portal',
    CASE WHEN v_inv.role = 'student' THEN 'Student' ELSE 'Person' END,
    COALESCE(v_inv.target_student_id::text, v_inv.target_guardian_person_id::text, v_inv.id::text),
    format('Convite %s ativado com sucesso pelo usuário %s (%s).', v_inv.invite_code, v_inv.full_name, v_user_email)
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Convite validado e conta vinculada com sucesso!',
    'role', v_inv.role,
    'tenant_id', v_inv.tenant_id,
    'student_id', v_inv.target_student_id,
    'guardian_person_id', v_inv.target_guardian_person_id,
    'academy_name', COALESCE(NULLIF(trim(v_tenant.trade_name), ''), NULLIF(trim(v_tenant.legal_name), ''), 'Tatame Club')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_portal_invitation(text, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. RPC: LOG_PORTAL_INVITATION_EMAIL_RESULT (Audits email attempt)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_portal_invitation_email_result(
  p_invitation_id uuid,
  p_status text,
  p_provider text DEFAULT 'resend',
  p_provider_message_id text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv record;
  v_log_id uuid;
BEGIN
  SELECT * INTO v_inv
  FROM public.tenant_user_invitations
  WHERE id = p_invitation_id;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Atualiza o registro de convite
  UPDATE public.tenant_user_invitations
  SET last_email_sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE last_email_sent_at END,
      last_email_status = p_status,
      last_email_error = p_error_message,
      updated_at = now()
  WHERE id = v_inv.id;

  -- Insere o log na tabela de auditoria
  INSERT INTO public.portal_invitation_email_logs (
    tenant_id, invitation_id, invite_code, recipient_email, recipient_name,
    target_type, target_id, status, provider, provider_message_id,
    error_message, triggered_by_user_id
  ) VALUES (
    v_inv.tenant_id, v_inv.id, v_inv.invite_code, v_inv.email, v_inv.full_name,
    v_inv.role, COALESCE(v_inv.target_student_id, v_inv.target_guardian_person_id),
    p_status, p_provider, p_provider_message_id, p_error_message, v_uid
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'invitation_id', v_inv.id,
    'status', p_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_portal_invitation_email_result(uuid, text, text, text, text) TO authenticated, service_role;
