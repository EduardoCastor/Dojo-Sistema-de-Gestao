-- ============================================================================
-- Migration 28: Persistência de Configurações do Dojo, Registro de Aceite Legal
--              (Termos de Uso / LGPD) e Controle de Acesso de Alunos e Responsáveis
-- PROJETO: Tatame Club — Beaver Soluções em Tecnologia (CNPJ 28.410.730/0001-80)
-- ============================================================================

-- ============================================================================
-- 1. EVOLUÇÃO DE SCHEMA: VÍNCULO EXPLÍCITO E SEGURO DE CONTAS DE ALUNOS E RESPONSÁVEIS
-- ============================================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_access_status text NOT NULL DEFAULT 'none'
    CHECK (portal_access_status IN ('none', 'invited', 'active', 'blocked', 'revoked')),
  ADD COLUMN IF NOT EXISTS allow_anthropometry_view boolean NOT NULL DEFAULT false;

ALTER TABLE public.persons
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_access_status text NOT NULL DEFAULT 'none'
    CHECK (portal_access_status IN ('none', 'invited', 'active', 'blocked', 'revoked'));

ALTER TABLE public.tenant_memberships
  ADD COLUMN IF NOT EXISTS student_id uuid,
  ADD COLUMN IF NOT EXISTS guardian_person_id uuid;

ALTER TABLE public.tenant_user_invitations
  ADD COLUMN IF NOT EXISTS invite_code text,
  ADD COLUMN IF NOT EXISTS target_student_id uuid,
  ADD COLUMN IF NOT EXISTS target_guardian_person_id uuid;

CREATE INDEX IF NOT EXISTS idx_students_user_id ON public.students(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_persons_user_id ON public.persons(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_invite_code ON public.tenant_user_invitations(upper(invite_code));

-- ============================================================================
-- 2. TABELA DE REGISTRO DE ACEITE CONTRATUAL E CIÊNCIA DE PRIVACIDADE (LGPD)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  terms_version text NOT NULL DEFAULT '1.0.0-2026',
  privacy_version text NOT NULL DEFAULT '1.0.0-2026',
  acceptance_context text NOT NULL CHECK (
    acceptance_context IN ('academy_registration', 'user_signup', 'portal_activation', 'terms_update')
  ),
  accepted_terms boolean NOT NULL DEFAULT true,
  acknowledged_privacy boolean NOT NULL DEFAULT true,
  specific_consents jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent text,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user ON public.legal_acceptances(user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_tenant ON public.legal_acceptances(tenant_id);

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "legal_acceptances_select_own_or_admin" ON public.legal_acceptances;
CREATE POLICY "legal_acceptances_select_own_or_admin" ON public.legal_acceptances
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (tenant_id IS NOT NULL AND public.has_tenant_role(tenant_id, 'owner'))
  OR public.is_platform_admin()
);

DROP POLICY IF EXISTS "legal_acceptances_insert_own" ON public.legal_acceptances;
CREATE POLICY "legal_acceptances_insert_own" ON public.legal_acceptances
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.record_legal_acceptance(
  p_tenant_id uuid DEFAULT NULL,
  p_terms_version text DEFAULT '1.0.0-2026',
  p_privacy_version text DEFAULT '1.0.0-2026',
  p_context text DEFAULT 'user_signup',
  p_specific_consents jsonb DEFAULT '{}'::jsonb,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_acceptance_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória para registrar aceite contratual.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.legal_acceptances (
    user_id,
    tenant_id,
    terms_version,
    privacy_version,
    acceptance_context,
    accepted_terms,
    acknowledged_privacy,
    specific_consents,
    user_agent
  ) VALUES (
    v_uid,
    p_tenant_id,
    COALESCE(NULLIF(trim(p_terms_version), ''), '1.0.0-2026'),
    COALESCE(NULLIF(trim(p_privacy_version), ''), '1.0.0-2026'),
    COALESCE(NULLIF(trim(p_context), ''), 'user_signup'),
    true,
    true,
    COALESCE(p_specific_consents, '{}'::jsonb),
    p_user_agent
  )
  RETURNING id INTO v_acceptance_id;

  RETURN jsonb_build_object(
    'success', true,
    'acceptance_id', v_acceptance_id,
    'terms_version', COALESCE(NULLIF(trim(p_terms_version), ''), '1.0.0-2026'),
    'privacy_version', COALESCE(NULLIF(trim(p_privacy_version), ''), '1.0.0-2026'),
    'accepted_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_legal_acceptance(uuid, text, text, text, jsonb, text) TO authenticated;

-- ============================================================================
-- 3. CORREÇÃO BUG 2: PERSISTÊNCIA E RECUPERAÇÃO DAS CONFIGURAÇÕES DO DOJO
-- ============================================================================

-- Permitir atualização de configurações pelo owner e branch_manager autorizado da academia
DROP POLICY IF EXISTS "tenants_update_owner_only" ON public.tenants;
CREATE POLICY "tenants_update_owner_only" ON public.tenants
FOR UPDATE TO authenticated
USING (public.has_tenant_role(id, 'owner', 'branch_manager'))
WITH CHECK (public.has_tenant_role(id, 'owner', 'branch_manager'));

CREATE OR REPLACE FUNCTION public.get_tenant_dojo_settings(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão não autenticada.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_tenant_member(p_tenant_id) AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: você não pertence a esta academia.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_tenant
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'Academia não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'id', v_tenant.id,
    'trade_name', v_tenant.trade_name,
    'legal_name', v_tenant.legal_name,
    'cnpj_or_cpf', v_tenant.cnpj_or_cpf,
    'admin_name', v_tenant.admin_name,
    'email', v_tenant.email,
    'phone', v_tenant.phone,
    'whatsapp', v_tenant.whatsapp,
    'website', v_tenant.website,
    'logo_url', v_tenant.logo_url,
    'address', COALESCE(v_tenant.address, '{}'::jsonb),
    'plan_id', v_tenant.plan_id,
    'status', v_tenant.status,
    'trial_started_at', v_tenant.trial_started_at,
    'trial_expires_at', v_tenant.trial_expires_at,
    'retention_days', v_tenant.retention_days,
    'settings', COALESCE(v_tenant.settings, '{}'::jsonb),
    'updated_at', v_tenant.updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_dojo_settings(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_dojo_settings(
  p_tenant_id uuid,
  p_trade_name text,
  p_legal_name text,
  p_cnpj_or_cpf text,
  p_admin_name text,
  p_email text,
  p_phone text,
  p_whatsapp text,
  p_website text,
  p_logo_url text,
  p_address jsonb,
  p_retention_days integer,
  p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_name text;
  v_updated public.tenants%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: sessão expirada ou não autenticada.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager') AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Permissão insuficiente: apenas o Proprietário ou Gestor autorizado desta academia pode alterar as configurações do Dojo.'
      USING ERRCODE = '42501';
  END IF;

  IF trim(COALESCE(p_trade_name, '')) = '' THEN
    RAISE EXCEPTION 'O Nome Fantasia da academia é obrigatório.' USING ERRCODE = '22023';
  END IF;

  IF trim(COALESCE(p_cnpj_or_cpf, '')) = '' THEN
    RAISE EXCEPTION 'O CNPJ ou CPF da academia é obrigatório.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(p.full_name, u.email, 'Administrador')
  INTO v_actor_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

  UPDATE public.tenants
  SET trade_name = trim(p_trade_name),
      legal_name = COALESCE(NULLIF(trim(p_legal_name), ''), trim(p_trade_name)),
      cnpj_or_cpf = trim(p_cnpj_or_cpf),
      admin_name = COALESCE(NULLIF(trim(p_admin_name), ''), admin_name),
      email = COALESCE(NULLIF(trim(p_email), ''), email),
      phone = COALESCE(trim(p_phone), phone),
      whatsapp = COALESCE(NULLIF(trim(p_whatsapp), ''), trim(p_phone), whatsapp),
      website = NULLIF(trim(COALESCE(p_website, '')), ''),
      logo_url = NULLIF(trim(COALESCE(p_logo_url, '')), ''),
      address = COALESCE(p_address, address, '{}'::jsonb),
      retention_days = GREATEST(30, COALESCE(p_retention_days, retention_days, 60)),
      settings = COALESCE(tenants.settings, '{}'::jsonb) || COALESCE(p_settings, '{}'::jsonb),
      updated_at = now()
  WHERE id = p_tenant_id
  RETURNING * INTO v_updated;

  IF v_updated.id IS NULL THEN
    RAISE EXCEPTION 'Academia não encontrada para atualização.' USING ERRCODE = 'P0002';
  END IF;

  -- Atualizar também dados básicos na Unidade Matriz correspondente
  UPDATE public.branches
  SET phone = v_updated.phone,
      email = v_updated.email,
      manager_name = v_updated.admin_name,
      updated_at = now()
  WHERE tenant_id = p_tenant_id AND is_headquarter = true;

  INSERT INTO public.audit_logs (
    tenant_id, user_id, user_name, action, entity, entity_id, details
  ) VALUES (
    p_tenant_id,
    v_uid,
    COALESCE(v_actor_name, 'Administrador'),
    'Atualização de Configurações do Dojo',
    'Tenant',
    p_tenant_id::text,
    format('Configurações institucionais e parâmetros financeiros do Dojo "%s" salvos com sucesso.', v_updated.trade_name)
  );

  RETURN jsonb_build_object(
    'success', true,
    'tenant', jsonb_build_object(
      'id', v_updated.id,
      'trade_name', v_updated.trade_name,
      'legal_name', v_updated.legal_name,
      'cnpj_or_cpf', v_updated.cnpj_or_cpf,
      'admin_name', v_updated.admin_name,
      'email', v_updated.email,
      'phone', v_updated.phone,
      'whatsapp', v_updated.whatsapp,
      'website', v_updated.website,
      'logo_url', v_updated.logo_url,
      'address', v_updated.address,
      'plan_id', v_updated.plan_id,
      'status', v_updated.status,
      'trial_started_at', v_updated.trial_started_at,
      'trial_expires_at', v_updated.trial_expires_at,
      'retention_days', v_updated.retention_days,
      'settings', v_updated.settings,
      'updated_at', v_updated.updated_at
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_tenant_dojo_settings(uuid, text, text, text, text, text, text, text, text, text, jsonb, integer, jsonb) TO authenticated;

-- ============================================================================
-- 4. FUNÇÕES DE SEGURANÇA RLS PARA ALUNOS E RESPONSÁVEIS (BASEADAS EM VÍNCULO VALIDADO)
-- ============================================================================

-- 4.1 Verifica se o usuário autenticado é o próprio aluno com acesso ativo e não revogado/bloqueado
CREATE OR REPLACE FUNCTION public.is_own_student(s_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    JOIN public.tenant_memberships tm
      ON tm.tenant_id = s.tenant_id
     AND tm.user_id = auth.uid()
     AND tm.role = 'student'
     AND tm.status = 'active'
    WHERE s.id = s_id
      AND s.portal_access_status = 'active'
      AND (
        s.user_id = auth.uid()
        OR tm.student_id = s.id
      )
  );
$$;

-- 4.2 Verifica se o usuário autenticado é responsável legitimamente vinculado ao aluno com acesso ativo
CREATE OR REPLACE FUNCTION public.is_guardian_of_student(s_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.guardian_relationships gr
    JOIN public.persons gp
      ON gp.id = gr.guardian_person_id
     AND gp.tenant_id = gr.tenant_id
    JOIN public.tenant_memberships tm
      ON tm.tenant_id = gr.tenant_id
     AND tm.user_id = auth.uid()
     AND tm.role = 'guardian'
     AND tm.status = 'active'
    WHERE gr.student_id = s_id
      AND gp.portal_access_status = 'active'
      AND (
        gp.user_id = auth.uid()
        OR tm.guardian_person_id = gp.id
      )
  );
$$;

-- ============================================================================
-- 5. ATUALIZAÇÃO DE POLÍTICAS RLS PARA ISOLAMENTO ESTRITO DE ALUNO E RESPONSÁVEL
-- ============================================================================

-- 5.1 Persons: Aluno vê apenas sua própria pessoa; Responsável vê sua pessoa e as pessoas dos alunos sob sua responsabilidade
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

-- 5.2 Guardian Relationships: Responsável vê apenas seus próprios vínculos; Aluno vê apenas seus responsáveis
DROP POLICY IF EXISTS "guardian_relationships_select" ON public.guardian_relationships;
CREATE POLICY "guardian_relationships_select" ON public.guardian_relationships
FOR SELECT TO authenticated
USING (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor', 'financial')
  OR public.is_own_student(student_id)
  OR public.is_guardian_of_student(student_id)
);

-- 5.3 Invoices: APENAS equipe financeira/administrativa e o RESPONSÁVEL vinculado (Aluno NÃO consulta financeiro de terceiros)
DROP POLICY IF EXISTS "invoices_select" ON public.invoices;
CREATE POLICY "invoices_select" ON public.invoices
FOR SELECT TO authenticated
USING (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'financial')
  OR public.is_guardian_of_student(student_id)
);

-- 5.4 Physical Assessments (Evolução Física / IMC): Aluno só visualiza se expressamente autorizado (allow_anthropometry_view = true)
DROP POLICY IF EXISTS "assessments_select" ON public.physical_assessments;
CREATE POLICY "assessments_select" ON public.physical_assessments
FOR SELECT TO authenticated
USING (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor')
  OR public.is_guardian_of_student(student_id)
  OR (
    public.is_own_student(student_id)
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = public.physical_assessments.student_id
        AND s.allow_anthropometry_view = true
    )
  )
);

-- ============================================================================
-- 6. RPCs DE GESTÃO DE ACESSO DE ALUNOS E RESPONSÁVEIS PELA ACADEMIA
-- ============================================================================

CREATE OR REPLACE FUNCTION public.manage_portal_account_access(
  p_tenant_id uuid,
  p_target_type text, -- 'student' ou 'guardian'
  p_target_id uuid,   -- student.id ou person.id (do responsável)
  p_action text,      -- 'invite', 'resend_invite', 'revoke_invite', 'block', 'revoke_access', 'reactivate', 'toggle_anthropometry'
  p_email text DEFAULT NULL,
  p_allow_anthropometry boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_name text;
  v_student record;
  v_person record;
  v_invite_code text;
  v_invitation_id uuid;
  v_target_user_id uuid;
  v_normalized_email text := lower(trim(COALESCE(p_email, '')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary') AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Permissão insuficiente: apenas administradores ou secretaria da academia podem gerenciar contas de alunos e responsáveis.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p.full_name, u.email, 'Gestor')
  INTO v_actor_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

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

    IF p_action IN ('invite', 'resend_invite') THEN
      IF v_normalized_email = '' THEN
        RAISE EXCEPTION 'Informe um e-mail válido para o aluno antes de gerar o convite de acesso.';
      END IF;

      -- Atualizar e-mail na ficha da pessoa se informado
      UPDATE public.persons
      SET email = v_normalized_email, updated_at = now()
      WHERE id = v_student.person_id AND tenant_id = p_tenant_id;

      -- Expirar convites anteriores pendentes para o mesmo aluno
      UPDATE public.tenant_user_invitations
      SET status = 'expired', updated_at = now()
      WHERE tenant_id = p_tenant_id
        AND target_student_id = v_student.id
        AND status = 'invited';

      v_invite_code := 'AL-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 8));

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
        'email', v_normalized_email
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

    IF p_action IN ('invite', 'resend_invite') THEN
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

      v_invite_code := 'RP-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 8));

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
        'email', v_normalized_email
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

  RAISE EXCEPTION 'Parâmetros de ação ou tipo inválidos.';
END;
$$;

GRANT EXECUTE ON FUNCTION public.manage_portal_account_access(uuid, text, uuid, text, text, boolean) TO authenticated;

-- ============================================================================
-- 7. RPC DE ASSOCIAÇÃO SEGURA DE CONTA (CLAIM INVITATION POR CÓDIGO + CPF)
-- ============================================================================
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
  v_inv record;
  v_clean_input_cpf text := regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g');
  v_target_cpf text := '';
  v_membership_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autentique-se com sua conta antes de validar o convite da academia.'
      USING ERRCODE = '42501';
  END IF;

  SELECT lower(email) INTO v_user_email FROM auth.users WHERE id = v_uid;

  SELECT * INTO v_inv
  FROM public.tenant_user_invitations
  WHERE upper(trim(invite_code)) = upper(trim(COALESCE(p_invite_code, '')))
    AND status = 'invited'
  LIMIT 1;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Código de convite inválido, já utilizado ou revogado pela academia.'
      USING ERRCODE = '22023';
  END IF;

  IF v_inv.expires_at < now() THEN
    UPDATE public.tenant_user_invitations SET status = 'expired', updated_at = now() WHERE id = v_inv.id;
    RAISE EXCEPTION 'Este convite expirou. Solicite um novo convite à secretaria da sua academia.'
      USING ERRCODE = '22023';
  END IF;

  -- Validar CPF ou e-mail exato do convite para impedir associação indevida
  IF v_inv.target_student_id IS NOT NULL THEN
    SELECT regexp_replace(COALESCE(p.cpf, ''), '\D', '', 'g')
    INTO v_target_cpf
    FROM public.students s
    JOIN public.persons p ON p.id = s.person_id
    WHERE s.id = v_inv.target_student_id AND s.tenant_id = v_inv.tenant_id;
  ELSIF v_inv.target_guardian_person_id IS NOT NULL THEN
    SELECT regexp_replace(COALESCE(p.cpf, ''), '\D', '', 'g')
    INTO v_target_cpf
    FROM public.persons p
    WHERE p.id = v_inv.target_guardian_person_id AND p.tenant_id = v_inv.tenant_id;
  END IF;

  IF v_target_cpf <> '' AND v_clean_input_cpf <> '' AND v_target_cpf <> v_clean_input_cpf THEN
    RAISE EXCEPTION 'O CPF informado não corresponde ao titular do convite registrado na academia.'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_cpf <> '' AND v_clean_input_cpf = '' AND lower(trim(v_inv.email)) <> v_user_email THEN
    RAISE EXCEPTION 'Para vincular uma conta com e-mail diferente do convite, informe o CPF cadastrado na academia.'
      USING ERRCODE = '42501';
  END IF;

  -- Garantir profile do usuário
  INSERT INTO public.profiles (id, full_name, is_platform_admin)
  VALUES (v_uid, v_inv.full_name, false)
  ON CONFLICT (id) DO NOTHING;

  -- Vincular student ou guardian_person
  IF v_inv.role = 'student' AND v_inv.target_student_id IS NOT NULL THEN
    UPDATE public.students
    SET user_id = v_uid,
        portal_access_status = 'active',
        updated_at = now()
    WHERE id = v_inv.target_student_id AND tenant_id = v_inv.tenant_id;

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

  UPDATE public.tenant_user_invitations
  SET status = 'accepted',
      accepted_by_user_id = v_uid,
      accepted_at = now(),
      updated_at = now()
  WHERE id = v_inv.id;

  INSERT INTO public.audit_logs (tenant_id, user_id, user_name, action, entity, entity_id, details)
  VALUES (
    v_inv.tenant_id, v_uid, v_inv.full_name, 'Ativação de Conta no Portal',
    'TenantMembership', COALESCE(v_membership_id::text, v_inv.id::text),
    format('Conta autenticada (%s) vinculada com sucesso ao perfil %s.', v_user_email, v_inv.role)
  );

  RETURN jsonb_build_object(
    'success', true,
    'tenant_id', v_inv.tenant_id,
    'role', v_inv.role,
    'student_id', v_inv.target_student_id,
    'guardian_person_id', v_inv.target_guardian_person_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_portal_invitation(text, text) TO authenticated;

-- ============================================================================
-- 8. RPC PARA ATUALIZAÇÃO DE DADOS CADASTRAIS PERMITIDOS PELO PRÓPRIO ALUNO
-- ============================================================================
CREATE OR REPLACE FUNCTION public.student_update_own_personal_info(
  p_tenant_id uuid,
  p_student_id uuid,
  p_social_name text,
  p_phone text,
  p_email text,
  p_address jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_student record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_own_student(p_student_id) THEN
    RAISE EXCEPTION 'Acesso negado: você só pode atualizar seus próprios dados cadastrais permitidos.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_student
  FROM public.students
  WHERE id = p_student_id AND tenant_id = p_tenant_id;

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION 'Registro de aluno não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.persons
  SET social_name = NULLIF(trim(COALESCE(p_social_name, '')), ''),
      phone = COALESCE(NULLIF(trim(COALESCE(p_phone, '')), ''), phone),
      email = COALESCE(NULLIF(lower(trim(COALESCE(p_email, ''))), ''), email),
      address = COALESCE(p_address, address),
      updated_at = now()
  WHERE id = v_student.person_id AND tenant_id = p_tenant_id;

  INSERT INTO public.audit_logs (
    tenant_id, user_id, user_name, action, entity, entity_id, details
  ) VALUES (
    p_tenant_id, auth.uid(), 'Aluno (Autoatendimento)',
    'Atualização de Contato pelo Aluno', 'Person', v_student.person_id::text,
    'Dados de contato/endereço atualizados pelo próprio aluno no Portal do Aluno.'
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.student_update_own_personal_info(uuid, uuid, text, text, text, jsonb) TO authenticated;
