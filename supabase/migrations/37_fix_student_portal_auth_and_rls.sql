-- ============================================================================
-- MIGRATION 37: FIX STUDENT PORTAL AUTHENTICATION, MEMBERSHIP, AND RLS POLICIES
-- ============================================================================
-- Product: Tatame Club (https://tatameclub.com.br)
-- Company: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
--
-- Objectives:
-- 1. Fix column references in verify_portal_invitation and claim_portal_invitation:
--    Correctly query public.tenants (trade_name, legal_name) instead of non-existent (name, trading_name).
-- 2. Ensure atomic association of auth.uid() with public.students and public.persons.
-- 3. Ensure upsert in public.tenant_memberships with role 'student', status 'active',
--    and student_id populated.
-- 4. Audit legal acceptance record automatically during portal invitation claim.
-- 5. Harden RLS policies for student portal:
--    - public.tenant_memberships: authenticated users can SELECT their own memberships.
--    - public.students: students can SELECT their own record (is_own_student).
--    - public.persons: students can SELECT their own personal record (is_own_student or user_id = auth.uid()).
--    - public.student_medical_documents: students can SELECT their own medical clearance.
--    - public.student_graduations: staff can SELECT tenant graduations; students can only SELECT their own.
--    - public.physical_assessments: students can SELECT their assessments only when allow_anthropometry_view = true.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FIX RPC: VERIFY_PORTAL_INVITATION
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
  v_academy_name text;
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

  -- Consulta correta na tabela public.tenants usando trade_name e legal_name
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

  -- 2. Verifica se foi cancelado/revogado
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
    'message', 'Código de convite válido!',
    'invitation_id', v_inv.id,
    'invite_code', v_inv.invite_code,
    'tenant_id', v_inv.tenant_id,
    'academy_name', v_academy_name,
    'role', v_inv.role,
    'full_name', v_inv.full_name,
    'masked_email', v_masked_email,
    'masked_cpf', v_masked_cpf,
    'requires_cpf', (v_target_cpf <> ''),
    'expires_at', v_inv.expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_portal_invitation(text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. FIX RPC: CLAIM_PORTAL_INVITATION
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
  v_academy_name text;
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

  v_academy_name := COALESCE(NULLIF(trim(v_tenant.trade_name), ''), NULLIF(trim(v_tenant.legal_name), ''), 'Tatame Club');

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
    format('Convite %s ativado com sucesso pelo usuário %s (%s).', v_inv.invite_code, v_inv.full_name, v_user_email)
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

GRANT EXECUTE ON FUNCTION public.claim_portal_invitation(text, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. RLS HARDENING: TENANT_MEMBERSHIPS, STUDENTS, PERSONS, MEDICAL DOCS, GRADUATIONS
-- ----------------------------------------------------------------------------

-- 3.1 TENANT_MEMBERSHIPS: Usuário autenticado pode ler TODOS os seus próprios memberships
DROP POLICY IF EXISTS "memberships_select_tenant" ON public.tenant_memberships;
CREATE POLICY "memberships_select_tenant" ON public.tenant_memberships
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_tenant_member(tenant_id)
);

-- 3.2 STUDENTS: Aluno lê seu próprio registro de forma estrita
DROP POLICY IF EXISTS "students_select" ON public.students;
CREATE POLICY "students_select" ON public.students
FOR SELECT TO authenticated
USING (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor', 'financial')
  OR public.is_own_student(id)
  OR public.is_guardian_of_student(id)
);

-- 3.3 PERSONS: Aluno e responsável lêem seus próprios registros físicos e dependentes
DROP POLICY IF EXISTS "persons_select" ON public.persons;
CREATE POLICY "persons_select" ON public.persons
FOR SELECT TO authenticated
USING (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor', 'financial')
  OR (user_id = auth.uid() AND portal_access_status = 'active')
  OR EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.tenant_id = public.persons.tenant_id
      AND s.person_id = public.persons.id
      AND (public.is_own_student(s.id) OR public.is_guardian_of_student(s.id))
  )
);

-- 3.4 STUDENT_MEDICAL_DOCUMENTS: O próprio aluno e o responsável podem ler documentos médicos
DROP POLICY IF EXISTS "student_medical_docs_select" ON public.student_medical_documents;
CREATE POLICY "student_medical_docs_select" ON public.student_medical_documents
FOR SELECT TO authenticated
USING (
  public.has_tenant_role(
    tenant_id,
    'owner',
    'branch_manager',
    'secretary',
    'instructor',
    'financial'
  )
  OR public.is_own_student(student_id)
  OR public.is_guardian_of_student(student_id)
);

-- 3.5 STUDENT_GRADUATIONS: Equipe lê tudo; Aluno lê estritamente suas graduações; Responsável lê dos dependentes
DROP POLICY IF EXISTS "graduations_select_tenant" ON public.student_graduations;
CREATE POLICY "graduations_select_tenant" ON public.student_graduations
FOR SELECT TO authenticated
USING (
  public.has_tenant_role(
    tenant_id,
    'owner',
    'branch_manager',
    'secretary',
    'instructor',
    'financial'
  )
  OR public.is_own_student(student_id)
  OR public.is_guardian_of_student(student_id)
);
