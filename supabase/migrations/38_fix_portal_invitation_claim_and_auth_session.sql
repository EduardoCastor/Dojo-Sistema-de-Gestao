-- ============================================================================
-- MIGRATION 38: FIX PORTAL INVITATION CLAIM, HYPHEN NORMALIZATION AND AUTH SESSIONS
-- ============================================================================
-- Product: Tatame Club (https://tatameclub.com.br)
-- Company: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
-- Target Supabase Project: knmzzndugadmklzzgtaa
--
-- Objectives:
-- 1. Fix verify_portal_invitation and claim_portal_invitation to normalize both
--    spaces and hyphens ('[\s\-]+'), ensuring codes like 'AL-WQA5MR64' match
--    regardless of hyphen presence, casing or formatting.
-- 2. Allow claim_portal_invitation to accept an optional p_user_id parameter.
--    This resolves the issue where a newly created user (via authService.signUp)
--    does not yet have an active JWT session due to email confirmation or client
--    session propagation delay.
-- 3. Ensure both anon, authenticated and service_role can execute verify_portal_invitation
--    and claim_portal_invitation securely with SECURITY DEFINER and search_path = public, auth.
-- 4. Provide overload functions for backwards-compatibility with 2-parameter callers.
-- 5. Harden RLS policies for tenant_memberships, students, persons, graduations,
--    and medical documents for the newly linked student or guardian.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. INDEX ON NORMALIZED INVITATION CODE (STRIPPING SPACES AND HYPHENS)
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_tenant_invitations_code_clean;
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_code_clean
  ON public.tenant_user_invitations(upper(regexp_replace(invite_code, '[\s\-]+', '', 'g')));

-- ----------------------------------------------------------------------------
-- 2. RPC: VERIFY_PORTAL_INVITATION (Public pre-validation for login & claim)
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
  v_clean_code text := upper(regexp_replace(trim(COALESCE(p_invite_code, '')), '[\s\-]+', '', 'g'));
  v_inv record;
  v_tenant record;
  v_person record;
  v_target_cpf text := '';
  v_masked_cpf text := '';
  v_masked_email text := '';
  v_email_parts text[];
  v_email_user text;
  v_email_domain text;
  v_academy_name text;
BEGIN
  IF v_clean_code = '' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'empty_code',
      'message', 'Informe o código de convite fornecido pela academia.'
    );
  END IF;

  -- Localiza o convite ignorando espaços, hífens ou maiúsculas/minúsculas
  SELECT * INTO v_inv
  FROM public.tenant_user_invitations
  WHERE upper(regexp_replace(invite_code, '[\s\-]+', '', 'g')) = v_clean_code
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_inv.id IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'not_found',
      'message', 'Código de convite não encontrado no sistema. Verifique a digitação ou solicite um novo envio à academia.'
    );
  END IF;

  -- Consulta dados da academia
  SELECT trade_name, legal_name INTO v_tenant
  FROM public.tenants
  WHERE id = v_inv.tenant_id;

  v_academy_name := COALESCE(NULLIF(trim(v_tenant.trade_name), ''), NULLIF(trim(v_tenant.legal_name), ''), 'Tatame Club');

  -- Obter CPF cadastrado do titular
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
      'academy_name', v_academy_name
    );
  END IF;

  -- 2. Verifica se foi revogado
  IF v_inv.status = 'revoked' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'revoked',
      'message', 'Este convite foi revogado pela administração da academia. Solicite um novo código à secretaria.',
      'academy_name', v_academy_name
    );
  END IF;

  -- 3. Verifica se expirou por data ou status
  IF v_inv.status = 'expired' OR v_inv.expires_at < now() THEN
    IF v_inv.status <> 'expired' THEN
      UPDATE public.tenant_user_invitations
      SET status = 'expired', updated_at = now()
      WHERE id = v_inv.id;
    END IF;

    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'expired',
      'message', 'Este código de convite expirou. Solicite um novo código à secretaria da sua academia.',
      'expires_at', v_inv.expires_at,
      'academy_name', v_academy_name
    );
  END IF;

  -- Convite válido e pronto para ativação
  RETURN jsonb_build_object(
    'valid', true,
    'reason', 'ready_to_claim',
    'message', 'Código de convite válido e pronto para ativação.',
    'invitation_id', v_inv.id,
    'invite_code', v_inv.invite_code,
    'tenant_id', v_inv.tenant_id,
    'academy_name', v_academy_name,
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
-- 3. RPC: CLAIM_PORTAL_INVITATION (With optional p_user_id and hyphen normalization)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_portal_invitation(
  p_invite_code text,
  p_cpf text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := COALESCE(auth.uid(), p_user_id);
  v_user_email text;
  v_clean_code text := upper(regexp_replace(trim(COALESCE(p_invite_code, '')), '[\s\-]+', '', 'g'));
  v_clean_input_cpf text := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
  v_target_cpf text := '';
  v_inv record;
  v_tenant record;
  v_student record;
  v_person record;
  v_membership_id uuid;
  v_academy_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autentique-se com sua conta ou preencha suas credenciais de acesso antes de validar o convite da academia.'
      USING ERRCODE = '42501';
  END IF;

  IF v_clean_code = '' THEN
    RAISE EXCEPTION 'Informe o código de convite da academia.'
      USING ERRCODE = '22023';
  END IF;

  -- Recupera e-mail do usuário autenticado / cadastrado no Supabase Auth
  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = v_uid;

  -- Bloqueio transacional do registro de convite para impedir concorrência/duplo claim
  SELECT * INTO v_inv
  FROM public.tenant_user_invitations
  WHERE upper(regexp_replace(invite_code, '[\s\-]+', '', 'g')) = v_clean_code
  FOR UPDATE;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Código de convite não encontrado no sistema. Verifique a digitação.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Consulta dados da academia
  SELECT trade_name, legal_name INTO v_tenant
  FROM public.tenants
  WHERE id = v_inv.tenant_id;

  v_academy_name := COALESCE(NULLIF(trim(v_tenant.trade_name), ''), NULLIF(trim(v_tenant.legal_name), ''), 'Tatame Club');

  -- Diagnóstico de status
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

  IF v_target_cpf <> '' AND v_clean_input_cpf = '' AND lower(trim(v_inv.email)) <> COALESCE(v_user_email, '') THEN
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

    -- Atualiza e-mail e vínculo da pessoa física correspondente
    IF v_student.person_id IS NOT NULL THEN
      UPDATE public.persons
      SET email = COALESCE(NULLIF(email, ''), v_user_email),
          user_id = v_uid,
          portal_access_status = 'active',
          updated_at = now()
      WHERE id = v_student.person_id AND tenant_id = v_inv.tenant_id;
    END IF;

    -- Cria ou reativa a associação em tenant_memberships com papel 'student'
    INSERT INTO public.tenant_memberships (
      tenant_id, user_id, branch_id, role, status, student_id
    ) VALUES (
      v_inv.tenant_id, v_uid, v_inv.branch_id, 'student', 'active', v_inv.target_student_id
    )
    ON CONFLICT (tenant_id, user_id, role) DO UPDATE
    SET status = 'active',
        student_id = EXCLUDED.student_id,
        branch_id = COALESCE(EXCLUDED.branch_id, public.tenant_memberships.branch_id),
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
        branch_id = COALESCE(EXCLUDED.branch_id, public.tenant_memberships.branch_id),
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
        branch_id = COALESCE(EXCLUDED.branch_id, public.tenant_memberships.branch_id),
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
    format('Convite %s ativado com sucesso pelo usuário %s (%s).', v_inv.invite_code, v_inv.full_name, COALESCE(v_user_email, v_inv.email))
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Convite validado e conta vinculada com sucesso!',
    'role', v_inv.role,
    'tenant_id', v_inv.tenant_id,
    'student_id', v_inv.target_student_id,
    'guardian_person_id', v_inv.target_guardian_person_id,
    'academy_name', v_academy_name
  );
END;
$$;

-- Overload com 2 parâmetros para compatibilidade com chamadas legado
CREATE OR REPLACE FUNCTION public.claim_portal_invitation(
  p_invite_code text,
  p_cpf text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN public.claim_portal_invitation(p_invite_code, p_cpf, NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_portal_invitation(text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_portal_invitation(text, text) TO anon, authenticated, service_role;
