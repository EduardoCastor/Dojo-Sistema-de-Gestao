-- ============================================================================
-- Migration 25: Reestruturação Tatame Club — Limites por Licença (Usuários e
--              Filiais), Gestão de Equipe da Academia, Isolamento Estrito e
--              Bootstrap Seguro do Administrador Global (admin@tatameclub.com.br)
-- PROJETO: Tatame Club (anteriormente TatameHub)
-- ============================================================================
-- OBJETIVO:
--  1. Adicionar limite configurável de usuários (max_users) aos planos comerciais
--     e limites customizados por assinatura/licença individual.
--  2. Implementar validação transacional no PostgreSQL (com advisory locks)
--     para impedir criação/ativação de usuários e criação de filiais acima do
--     limite contratado, inclusive sob requisições simultâneas.
--  3. Criar estrutura de convites e gestão de usuários por academia (tenant),
--     protegendo o último proprietário (owner) e impedindo escalonamento para
--     superadmin.
--  4. Atualizar register_academy_atomic() para criar assinatura de trial (10 dias)
--     e modalidades iniciais de forma transacional e isolada.
--  5. Impedir que administradores de academia alterem sua própria licença/status
--     na tabela tenants ou promovam a si mesmos a is_platform_admin.
--  6. Disponibilizar procedimento seguro de bootstrap para admin@tatameclub.com.br
--     sem qualquer senha fixa em código ou banco.
-- ============================================================================

-- 1. EVOLUÇÃO DE SCHEMA: LIMITES DE USUÁRIOS NOS PLANOS E POR ASSINATURA
ALTER TABLE public.saas_commercial_plans
  ADD COLUMN IF NOT EXISTS max_users integer NOT NULL DEFAULT 5;

UPDATE public.saas_commercial_plans SET max_users = 5 WHERE id = 'trial';
UPDATE public.saas_commercial_plans SET max_users = 5 WHERE id = 'basic';
UPDATE public.saas_commercial_plans SET max_users = 20 WHERE id = 'advanced';
UPDATE public.saas_commercial_plans SET max_users = 100 WHERE id = 'enterprise';

-- Atualizar textos comerciais nos planos para a nova identidade Tatame Club
UPDATE public.saas_commercial_plans
SET tagline = replace(tagline, 'TatameHub', 'Tatame Club'),
    updated_at = now()
WHERE tagline LIKE '%TatameHub%';

-- Permitir limites customizados por licença individual (quando autorizado pelo SuperAdmin)
ALTER TABLE public.saas_subscriptions
  ADD COLUMN IF NOT EXISTS custom_max_users integer,
  ADD COLUMN IF NOT EXISTS custom_max_branches integer,
  ADD COLUMN IF NOT EXISTS custom_max_students integer;

-- 2. TABELA DE CONVITES E MEMBROS DA EQUIPE DA ACADEMIA
CREATE TABLE IF NOT EXISTS public.tenant_user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid,
  email text NOT NULL,
  full_name text NOT NULL,
  role app_role NOT NULL DEFAULT 'instructor',
  phone text,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'revoked', 'expired')),
  invited_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_by_name text NOT NULL,
  accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_invitation_branch FOREIGN KEY (tenant_id, branch_id)
    REFERENCES public.branches(tenant_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant_status
  ON public.tenant_user_invitations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email
  ON public.tenant_user_invitations(lower(email));

ALTER TABLE public.tenant_user_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_invitations_select" ON public.tenant_user_invitations;
CREATE POLICY "tenant_invitations_select" ON public.tenant_user_invitations
FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary')
  OR lower(email) = lower((SELECT u.email FROM auth.users u WHERE u.id = auth.uid()))
);

DROP POLICY IF EXISTS "tenant_invitations_write_owner" ON public.tenant_user_invitations;
CREATE POLICY "tenant_invitations_write_owner" ON public.tenant_user_invitations
FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  OR public.has_tenant_role(tenant_id, 'owner', 'branch_manager')
)
WITH CHECK (
  public.is_platform_admin()
  OR public.has_tenant_role(tenant_id, 'owner', 'branch_manager')
);

-- 3. FUNÇÃO CENTRAL DE AVALIAÇÃO DE LICENÇA E LIMITES EFETIVOS NO BANCO
-- Regra de contagem:
--   - Usuários: registros com status = 'active' em public.tenant_memberships
--     (convites pendentes em tenant_user_invitations ou memberships 'invited'/'suspended' NÃO consomem vaga ativa).
--   - Filiais: total de unidades em public.branches vinculadas ao tenant (a Unidade Matriz conta como a 1ª unidade).
CREATE OR REPLACE FUNCTION public.get_tenant_effective_limits(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tenant record;
  v_sub record;
  v_plan record;
  v_max_users integer := 5;
  v_max_branches integer := 1;
  v_max_students integer := 40;
  v_active_users integer := 0;
  v_total_branches integer := 0;
  v_total_students integer := 0;
  v_is_license_valid boolean := false;
  v_access_state text := 'active';
BEGIN
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'Academia não encontrada para avaliação de limites.';
  END IF;

  SELECT * INTO v_sub FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id;
  SELECT * INTO v_plan FROM public.saas_commercial_plans WHERE id = COALESCE(v_sub.plan_id, v_tenant.plan_id, 'trial');

  v_max_users := COALESCE(v_sub.custom_max_users, v_plan.max_users, 5);
  v_max_branches := COALESCE(v_sub.custom_max_branches, v_plan.max_branches, 1);
  v_max_students := COALESCE(v_sub.custom_max_students, v_plan.max_students, 40);

  SELECT count(DISTINCT user_id) INTO v_active_users
  FROM public.tenant_memberships
  WHERE tenant_id = p_tenant_id AND status = 'active';

  SELECT count(*) INTO v_total_branches
  FROM public.branches
  WHERE tenant_id = p_tenant_id;

  SELECT count(*) INTO v_total_students
  FROM public.students
  WHERE tenant_id = p_tenant_id;

  -- Avaliar validade da licença
  IF v_tenant.status = 'suspended' OR v_sub.status = 'suspended' THEN
    v_is_license_valid := false;
    v_access_state := 'blocked_suspended';
  ELSIF v_tenant.status = 'canceled' OR v_sub.status = 'canceled' THEN
    v_is_license_valid := false;
    v_access_state := 'blocked_canceled';
  ELSIF v_tenant.status = 'trial' OR v_sub.status = 'trial' THEN
    IF COALESCE(v_sub.trial_expires_at, v_tenant.trial_expires_at) < now() THEN
      v_is_license_valid := false;
      v_access_state := 'trial_expired';
    ELSE
      v_is_license_valid := true;
      v_access_state := 'trial';
    END IF;
  ELSIF v_sub.status = 'past_due' THEN
    IF (CURRENT_DATE - v_sub.next_due_date) > COALESCE(v_sub.grace_period_days, 5) THEN
      v_is_license_valid := false;
      v_access_state := 'blocked_past_due';
    ELSE
      v_is_license_valid := true;
      v_access_state := 'grace_period';
    END IF;
  ELSE
    v_is_license_valid := true;
    v_access_state := 'active';
  END IF;

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'is_license_valid', v_is_license_valid,
    'access_state', v_access_state,
    'max_users', v_max_users,
    'current_active_users', v_active_users,
    'is_users_limit_reached', (v_active_users >= v_max_users),
    'max_branches', v_max_branches,
    'current_branches', v_total_branches,
    'is_branches_limit_reached', (v_total_branches >= v_max_branches),
    'max_students', v_max_students,
    'current_students', v_total_students,
    'is_students_limit_reached', (v_total_students >= v_max_students)
  );
END;
$$;

-- 4. GATILHO TRANSACIONAL: IMPEDIR ESCALONAMENTO INDEVIDO DE IS_PLATFORM_ADMIN
CREATE OR REPLACE FUNCTION public.enforce_profile_admin_security()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.is_platform_admin IS DISTINCT FROM COALESCE(OLD.is_platform_admin, false) THEN
    -- Permitir apenas se for executado via service_role / postgres ou por um platform_admin já validado
    IF current_setting('role', true) NOT IN ('service_role', 'postgres', 'supabase_admin')
       AND NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'Violação de segurança: você não possui autorização para conceder ou alterar o papel de Administrador Global do SaaS.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_platform_admin_flag ON public.profiles;
CREATE TRIGGER trg_protect_platform_admin_flag
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_admin_security();

-- 5. GATILHO TRANSACIONAL: IMPEDIR QUE OWNER ALTERE PRÓPRIA LICENÇA/STATUS
CREATE OR REPLACE FUNCTION public.enforce_tenant_license_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF (
    NEW.plan_id IS DISTINCT FROM OLD.plan_id OR
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.trial_started_at IS DISTINCT FROM OLD.trial_started_at OR
    NEW.trial_expires_at IS DISTINCT FROM OLD.trial_expires_at
  ) THEN
    IF current_setting('role', true) NOT IN ('service_role', 'postgres', 'supabase_admin')
       AND NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'Acesso negado: uma academia não pode alterar diretamente seu próprio plano, status de licença ou validade do período de teste.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_tenant_license_fields ON public.tenants;
CREATE TRIGGER trg_protect_tenant_license_fields
BEFORE UPDATE ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.enforce_tenant_license_immutability();

-- 6. GATILHO TRANSACIONAL: LIMITE DE USUÁRIOS E PROTEÇÃO DO ÚLTIMO OWNER
CREATE OR REPLACE FUNCTION public.enforce_tenant_membership_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_limits jsonb;
  v_max_users integer;
  v_active_users integer;
  v_remaining_owners integer;
  v_is_already_active boolean := false;
BEGIN
  -- Serializar alterações de usuários por tenant para evitar ultrapassar limite em requisições concorrentes
  PERFORM pg_advisory_xact_lock(hashtext('user_limit_' || COALESCE(NEW.tenant_id, OLD.tenant_id)::text));

  -- Caso 1: Remoção ou desativação/alteração de papel de um owner
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' AND OLD.status = 'active' THEN
      SELECT count(*) INTO v_remaining_owners
      FROM public.tenant_memberships
      WHERE tenant_id = OLD.tenant_id
        AND role = 'owner'
        AND status = 'active'
        AND id <> OLD.id;

      IF v_remaining_owners = 0 THEN
        RAISE EXCEPTION 'Operação bloqueada: não é permitido remover o único administrador principal (owner) ativo da academia.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'owner' AND OLD.status = 'active' AND (NEW.role <> 'owner' OR NEW.status <> 'active') THEN
      SELECT count(*) INTO v_remaining_owners
      FROM public.tenant_memberships
      WHERE tenant_id = OLD.tenant_id
        AND role = 'owner'
        AND status = 'active'
        AND id <> OLD.id;

      IF v_remaining_owners = 0 THEN
        RAISE EXCEPTION 'Operação bloqueada: a academia deve possuir pelo menos um administrador principal (owner) ativo. Transfira a titularidade antes de desativar este acesso.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- Caso 2: Criação ou ativação de usuário -> Verificar limite da licença
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    -- Verificar se o mesmo user_id já possui outro vínculo ativo no mesmo tenant
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = NEW.tenant_id
        AND user_id = NEW.user_id
        AND status = 'active'
        AND (TG_OP = 'INSERT' OR id <> NEW.id)
    ) INTO v_is_already_active;

    IF NOT v_is_already_active THEN
      v_limits := public.get_tenant_effective_limits(NEW.tenant_id);
      v_max_users := (v_limits->>'max_users')::integer;
      v_active_users := (v_limits->>'current_active_users')::integer;

      -- Permitir o 1º usuário (owner inicial) durante o bootstrap da academia
      IF v_active_users > 0 AND v_active_users >= v_max_users THEN
        RAISE EXCEPTION 'Limite de usuários ativos atingido para a licença atual (% de % usuários ativos). Desative um acesso existente ou solicite ampliação do plano.',
          v_active_users, v_max_users
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_tenant_user_limit ON public.tenant_memberships;
CREATE TRIGGER trg_enforce_tenant_user_limit
BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_memberships
FOR EACH ROW
EXECUTE FUNCTION public.enforce_tenant_membership_rules();

-- 7. GATILHO TRANSACIONAL: LIMITE DE FILIAIS POR ACADEMIA (CONCURRENCY-SAFE)
CREATE OR REPLACE FUNCTION public.enforce_tenant_branch_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_limits jsonb;
  v_max_branches integer;
  v_current_branches integer;
BEGIN
  -- Bloqueio transacional por tenant para impedir criações simultâneas acima do limite
  PERFORM pg_advisory_xact_lock(hashtext('branch_limit_' || NEW.tenant_id::text));

  v_limits := public.get_tenant_effective_limits(NEW.tenant_id);
  v_max_branches := (v_limits->>'max_branches')::integer;
  v_current_branches := (v_limits->>'current_branches')::integer;

  -- A 1ª filial (Unidade Matriz na criação do tenant) é sempre permitida se current_branches = 0
  IF v_current_branches > 0 AND v_current_branches >= v_max_branches THEN
    RAISE EXCEPTION 'Limite de filiais atingido para a licença atual (% de % unidades cadastradas, incluindo a Matriz). Faça upgrade do plano ou solicite ampliação ao administrador do Tatame Club.',
      v_current_branches, v_max_branches
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_tenant_branch_limit ON public.branches;
CREATE TRIGGER trg_enforce_tenant_branch_limit
BEFORE INSERT ON public.branches
FOR EACH ROW
EXECUTE FUNCTION public.enforce_tenant_branch_limit();

-- 8. ATUALIZAÇÃO DA FUNÇÃO RPC ATÔMICA DE CADASTRO DE ACADEMIA
-- Cria tenant exclusivo, filial matriz, vínculo owner, assinatura de teste (10 dias)
-- e modalidades básicas isoladas para a nova academia.
CREATE OR REPLACE FUNCTION public.register_academy_atomic(
  p_trade_name text,
  p_legal_name text,
  p_cnpj_or_cpf text,
  p_admin_name text,
  p_phone text,
  p_whatsapp text,
  p_address jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_membership_id uuid;
  v_subscription_id uuid;
  v_judo_art_id uuid;
  v_bjj_art_id uuid;
  v_trial_start timestamptz := now();
  v_trial_end timestamptz := now() + interval '10 days';
BEGIN
  -- 1. Validar sessão autenticada no Supabase Auth
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: o usuário precisa estar autenticado para criar uma academia.'
      USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- 2. Validar campos obrigatórios
  IF trim(p_trade_name) = '' OR trim(p_cnpj_or_cpf) = '' OR trim(p_admin_name) = '' THEN
    RAISE EXCEPTION 'Parâmetros inválidos: Nome da academia, CNPJ/CPF e nome do responsável são obrigatórios.'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Garantir perfil público (sem jamais conceder is_platform_admin aqui)
  INSERT INTO public.profiles (id, full_name, phone, is_platform_admin)
  VALUES (v_user_id, trim(p_admin_name), p_phone, false)
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      phone = COALESCE(EXCLUDED.phone, public.profiles.phone);

  -- 4. Criar novo tenant exclusivo (nunca reutiliza tenant de demonstração)
  INSERT INTO public.tenants (
    trade_name,
    legal_name,
    cnpj_or_cpf,
    admin_name,
    email,
    phone,
    whatsapp,
    address,
    plan_id,
    status,
    trial_started_at,
    trial_expires_at
  )
  VALUES (
    trim(p_trade_name),
    COALESCE(NULLIF(trim(p_legal_name), ''), trim(p_trade_name)),
    trim(p_cnpj_or_cpf),
    trim(p_admin_name),
    COALESCE(v_user_email, ''),
    p_phone,
    COALESCE(NULLIF(trim(p_whatsapp), ''), p_phone),
    COALESCE(p_address, '{}'::jsonb),
    'trial',
    'trial',
    v_trial_start,
    v_trial_end
  )
  RETURNING id INTO v_tenant_id;

  -- 5. Criar assinatura de teste (10 dias) vinculada à nova academia
  INSERT INTO public.saas_subscriptions (
    tenant_id,
    plan_id,
    plan_name,
    status,
    billing_cycle,
    amount,
    started_at,
    current_period_start,
    current_period_end,
    next_due_date,
    trial_expires_at,
    grace_period_days
  )
  VALUES (
    v_tenant_id,
    'trial',
    'Degustação Gratuita (10 Dias)',
    'trial',
    'monthly',
    0.00,
    v_trial_start,
    v_trial_start,
    v_trial_end,
    v_trial_end::date,
    v_trial_end,
    5
  )
  RETURNING id INTO v_subscription_id;

  -- 6. Criar a filial Matriz padrão vinculada à academia
  INSERT INTO public.branches (
    tenant_id,
    name,
    is_headquarter,
    phone,
    email,
    address,
    manager_name,
    active
  )
  VALUES (
    v_tenant_id,
    'Unidade Matriz',
    true,
    p_phone,
    v_user_email,
    COALESCE(p_address->>'street', '') || ', ' || COALESCE(p_address->>'number', ''),
    trim(p_admin_name),
    true
  )
  RETURNING id INTO v_branch_id;

  -- 7. Vincular o usuário como administrador principal (owner) da academia
  INSERT INTO public.tenant_memberships (
    tenant_id,
    user_id,
    branch_id,
    role,
    status
  )
  VALUES (
    v_tenant_id,
    v_user_id,
    v_branch_id,
    'owner',
    'active'
  )
  RETURNING id INTO v_membership_id;

  -- 8. Criar modalidades iniciais padrão exclusivas do novo tenant (sem compartilhar IDs com demo)
  INSERT INTO public.martial_arts (tenant_id, name, origin, description, governing_federation, status)
  VALUES (v_tenant_id, 'Judô', 'Japão', 'Caminho suave — arte marcial olímpica fundada por Jigoro Kano.', 'CBJ / IJF', 'active')
  RETURNING id INTO v_judo_art_id;

  INSERT INTO public.belt_ranks (tenant_id, martial_art_id, name, rank_type, order_index, color_hex, min_age_years, min_practice_months, technical_requirements, requires_exam)
  VALUES
    (v_tenant_id, v_judo_art_id, 'Faixa Branca (Mukyu)', 'faixa', 1, '#FFFFFF', 4, 0, 'Matrícula inicial e etiqueta de tatami (Reiho).', false),
    (v_tenant_id, v_judo_art_id, 'Faixa Cinza (7º Kyu)', 'faixa', 2, '#94A3B8', 5, 6, 'Ukemi (amortecimento de quedas) e técnicas básicas de projeção.', true),
    (v_tenant_id, v_judo_art_id, 'Faixa Azul (6º Kyu)', 'faixa', 3, '#2563EB', 7, 6, 'Go-Kyo inicial e imobilizações (Osaekomi-waza).', true),
    (v_tenant_id, v_judo_art_id, 'Faixa Amarela (5º Kyu)', 'faixa', 4, '#EAB308', 9, 6, 'Combinações (Renraku-henka-waza) e contragolpes.', true),
    (v_tenant_id, v_judo_art_id, 'Faixa Laranja (4º Kyu)', 'faixa', 5, '#F97316', 11, 8, 'Domínio intermediário de Nage-waza e Katame-waza.', true),
    (v_tenant_id, v_judo_art_id, 'Faixa Verde (3º Kyu)', 'faixa', 6, '#16A34A', 13, 12, 'Técnicas de sacrifício (Sutemi-waza) e chaves/estrangulamentos conforme idade.', true),
    (v_tenant_id, v_judo_art_id, 'Faixa Roxa (2º Kyu)', 'faixa', 7, '#9333EA', 14, 12, 'Aperfeiçoamento técnico e Nage-no-Kata parcial.', true),
    (v_tenant_id, v_judo_art_id, 'Faixa Marrom (1º Kyu)', 'faixa', 8, '#78350F', 15, 12, 'Nage-no-Kata completo e preparação para Shodan.', true),
    (v_tenant_id, v_judo_art_id, 'Faixa Preta (1º Dan - Shodan)', 'dan', 9, '#0F172A', 16, 12, 'Exame oficial de graduação superior.', true);

  INSERT INTO public.martial_arts (tenant_id, name, origin, description, governing_federation, status)
  VALUES (v_tenant_id, 'Jiu-Jitsu Brasileiro (BJJ)', 'Brasil', 'Arte suave focada em luta de solo, alavancas e finalizações.', 'CBJJ / IBJJF', 'active')
  RETURNING id INTO v_bjj_art_id;

  INSERT INTO public.belt_ranks (tenant_id, martial_art_id, name, rank_type, order_index, color_hex, min_age_years, min_practice_months, technical_requirements, requires_exam)
  VALUES
    (v_tenant_id, v_bjj_art_id, 'Faixa Branca', 'faixa', 1, '#FFFFFF', 4, 0, 'Fundamentos de defesa pessoal, posturas e fugas de quadril.', false),
    (v_tenant_id, v_bjj_art_id, 'Faixa Azul', 'faixa', 2, '#2563EB', 16, 18, 'Domínio de guardas, passagens, raspagens e finalizações básicas.', true),
    (v_tenant_id, v_bjj_art_id, 'Faixa Roxa', 'faixa', 3, '#9333EA', 16, 24, 'Combinações avançadas de guarda e transições dinâmicas.', true),
    (v_tenant_id, v_bjj_art_id, 'Faixa Marrom', 'faixa', 4, '#78350F', 18, 18, 'Refinamento técnico de pressão e precisão.', true),
    (v_tenant_id, v_bjj_art_id, 'Faixa Preta', 'dan', 5, '#0F172A', 19, 12, 'Grau de excelência técnica e pedagógica.', true);

  -- 9. Registrar auditoria da academia e da plataforma
  INSERT INTO public.audit_logs (
    tenant_id, user_id, user_name, action, entity, entity_id, details
  ) VALUES (
    v_tenant_id, v_user_id, trim(p_admin_name), 'Criação de Academia', 'Tenant', v_tenant_id::text,
    'Academia criada no Tatame Club com filial matriz e 10 dias de avaliação gratuita ativados.'
  );

  INSERT INTO public.platform_audit_logs (
    actor_user_id, actor_user_name, action, entity_type, entity_id, tenant_id, tenant_name, details
  ) VALUES (
    v_user_id, trim(p_admin_name), 'register_tenant', 'tenant', v_tenant_id::text, v_tenant_id, trim(p_trade_name),
    'Nova academia cadastrada com licença de teste de 10 dias (início: ' || to_char(v_trial_start, 'DD/MM/YYYY') || ', término: ' || to_char(v_trial_end, 'DD/MM/YYYY') || ').'
  );

  RETURN jsonb_build_object(
    'success', true,
    'tenant_id', v_tenant_id,
    'branch_id', v_branch_id,
    'membership_id', v_membership_id,
    'subscription_id', v_subscription_id,
    'role', 'owner',
    'plan_id', 'trial',
    'trial_started_at', v_trial_start,
    'trial_expires_at', v_trial_end
  );
END;
$$;

-- 9. RPC DO PAINEL GLOBAL: ATUALIZAR LIMITES COMERCIAIS DE PLANO OU LICENÇA INDIVIDUAL
CREATE OR REPLACE FUNCTION public.admin_update_license_limits(
  p_target_type text, -- 'plan' ou 'subscription'
  p_target_id text,   -- id do plano (ex: 'basic') ou tenant_id (uuid em texto)
  p_max_users integer,
  p_max_branches integer,
  p_max_students integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_name text;
  v_tenant_uuid uuid;
  v_tenant_name text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas o Administrador Global do Tatame Club pode configurar limites de licenças.'
      USING ERRCODE = '42501';
  END IF;

  IF p_max_users < 1 OR p_max_branches < 1 OR p_max_students < 1 THEN
    RAISE EXCEPTION 'Os limites de usuários, filiais e alunos devem ser maiores ou iguais a 1.';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();

  IF p_target_type = 'plan' THEN
    UPDATE public.saas_commercial_plans
    SET max_users = p_max_users,
        max_branches = p_max_branches,
        max_students = p_max_students,
        updated_at = now()
    WHERE id = p_target_id;

    INSERT INTO public.platform_audit_logs (
      actor_user_id, actor_user_name, action, entity_type, entity_id, reason, details
    ) VALUES (
      auth.uid(), COALESCE(v_actor_name, 'SuperAdmin'), 'update_plan', 'plan', p_target_id, p_reason,
      format('Limites do plano [%s] atualizados: máx. %s usuários, %s filiais, %s alunos.', p_target_id, p_max_users, p_max_branches, p_max_students)
    );
  ELSIF p_target_type = 'subscription' THEN
    v_tenant_uuid := p_target_id::uuid;
    SELECT trade_name INTO v_tenant_name FROM public.tenants WHERE id = v_tenant_uuid;

    UPDATE public.saas_subscriptions
    SET custom_max_users = p_max_users,
        custom_max_branches = p_max_branches,
        custom_max_students = p_max_students,
        updated_at = now()
    WHERE tenant_id = v_tenant_uuid;

    INSERT INTO public.platform_audit_logs (
      actor_user_id, actor_user_name, action, entity_type, entity_id, tenant_id, tenant_name, reason, details
    ) VALUES (
      auth.uid(), COALESCE(v_actor_name, 'SuperAdmin'), 'change_subscription_plan', 'subscription', p_target_id, v_tenant_uuid, v_tenant_name, p_reason,
      format('Limites individuais da licença da academia "%s" ajustados: máx. %s usuários, %s filiais, %s alunos.', COALESCE(v_tenant_name, p_target_id), p_max_users, p_max_branches, p_max_students)
    );
  ELSE
    RAISE EXCEPTION 'Tipo de alvo inválido: use "plan" ou "subscription".';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 10. PROCEDIMENTO SEGURO DE BOOTSTRAP DO ADMINISTRADOR GLOBAL (admin@tatameclub.com.br)
-- IMPORTANTE:
--  - Não contém senha fixa nem cria credenciais padrão.
--  - Permite o bootstrap inicial apenas para o e-mail oficial admin@tatameclub.com.br
--    quando ainda não existe nenhum is_platform_admin = true no banco, ou quando executado
--    pelo próprio admin@tatameclub.com.br / SQL Editor (postgres / service_role).
--  - Confirma automaticamente email_confirmed_at para admin@tatameclub.com.br caso o
--    domínio de e-mail ainda não esteja publicado em produção.
CREATE OR REPLACE FUNCTION public.bootstrap_platform_owner_by_email(
  p_email text DEFAULT 'admin@tatameclub.com.br',
  p_reason text DEFAULT 'Bootstrap inicial do proprietário da plataforma Tatame Club'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_target_user record;
  v_has_existing_admin boolean := false;
  v_jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
BEGIN
  -- Apenas o e-mail oficial do proprietário pode receber bootstrap
  IF lower(trim(p_email)) <> 'admin@tatameclub.com.br' THEN
    RAISE EXCEPTION 'Operação negada: o bootstrap global é exclusivo para admin@tatameclub.com.br.'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE is_platform_admin = true
  ) INTO v_has_existing_admin;

  -- Se já existir um admin global configurado, exigir contexto privilegiado ou o próprio admin@tatameclub.com.br autenticado
  IF v_has_existing_admin
     AND current_setting('role', true) NOT IN ('service_role', 'postgres', 'supabase_admin')
     AND NOT public.is_platform_admin()
     AND v_jwt_email <> 'admin@tatameclub.com.br' THEN
    RAISE EXCEPTION 'Operação restrita: o Administrador Global já foi inicializado. Execute alterações pelo SQL Editor ou autenticado como admin@tatameclub.com.br.'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, email, email_confirmed_at, raw_user_meta_data
  INTO v_target_user
  FROM auth.users
  WHERE lower(email) = 'admin@tatameclub.com.br'
  LIMIT 1;

  IF v_target_user.id IS NULL THEN
    RAISE EXCEPTION 'A conta "admin@tatameclub.com.br" ainda não existe em auth.users. Utilize a aba "Primeiro Acesso" na tela do painel para definir sua senha antes de vincular o papel global.';
  END IF;

  -- Auto-confirmar o e-mail de admin@tatameclub.com.br caso o domínio ainda não tenha servidor de e-mail ativo
  IF v_target_user.email_confirmed_at IS NULL THEN
    UPDATE auth.users
    SET email_confirmed_at = now(),
        updated_at = now()
    WHERE id = v_target_user.id;
  END IF;

  -- Garantir perfil e ativar a flag is_platform_admin
  INSERT INTO public.profiles (id, full_name, is_platform_admin, updated_at)
  VALUES (
    v_target_user.id,
    COALESCE(v_target_user.raw_user_meta_data->>'full_name', 'Proprietário Tatame Club SaaS'),
    true,
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET is_platform_admin = true,
      updated_at = now();

  -- Registrar evento crítico na trilha de auditoria da plataforma
  INSERT INTO public.platform_audit_logs (
    actor_user_id,
    actor_user_name,
    action,
    entity_type,
    entity_id,
    reason,
    details,
    metadata
  ) VALUES (
    v_target_user.id,
    COALESCE(v_target_user.email, 'admin@tatameclub.com.br'),
    'change_plan_status',
    'gateway',
    v_target_user.id::text,
    p_reason,
    format('Privilégio de Proprietário Global (is_platform_admin = true) vinculado com segurança à conta %s.', v_target_user.email),
    jsonb_build_object('bootstrapped_email', v_target_user.email, 'email_confirmed', true)
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_target_user.id,
    'email', v_target_user.email,
    'is_platform_admin', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bootstrap_platform_owner_by_email(text, text) TO anon, authenticated, service_role;

