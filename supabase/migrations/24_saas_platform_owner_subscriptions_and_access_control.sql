-- ============================================================================
-- Migration 24: Painel do Proprietário do SaaS, Planos Comerciais, Assinaturas
--              Recorrentes, Pagamentos e Controle Centralizado de Acesso
-- TatameHub: Gestão de Academias de Artes Marciais (SaaS Multi-Tenant)
-- ============================================================================
-- OBJETIVO:
--  1. Separar o Administrador da Plataforma (SuperAdmin) dos Administradores de Academia (Owner).
--  2. Criar tabelas dedicadas para os Planos Comerciais do SaaS (não confundir com planos de alunos).
--  3. Gestão de Assinaturas das academias clientes (vigências, períodos, carência de 5 dias).
--  4. Registro seguro de Pagamentos da plataforma com conciliação de métodos (PIX, Boleto, Cartão).
--  5. Idempotência estrita para webhooks de provedores de pagamento (Asaas, Mercado Pago, Stripe).
--  6. Histórico auditado de alterações administrativas e suspensões preventivas com justificativa.
--  7. Políticas de Row Level Security (RLS) que blindam os dados entre diferentes academias.
-- ============================================================================

-- 1. FUNÇÃO DE IDENTIFICAÇÃO SEGURA DO ADMINISTRADOR DA PLATAFORMA (SUPERADMIN)
-- Verifica explicitamente no banco se o usuário autenticado possui a flag is_platform_admin no seu perfil.
-- Não confia em cabeçalhos, parâmetros enviados pelo cliente ou no papel 'owner' de um tenant.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.profiles 
    WHERE id = auth.uid() 
      AND is_platform_admin = true
  );
$$;

-- 2. TABELA DOS PLANOS COMERCIAIS DO SAAS (TATAMEHUB PLANS)
-- Planos que a plataforma oferece para as academias contratarem.
CREATE TABLE IF NOT EXISTS public.saas_commercial_plans (
  id text PRIMARY KEY, -- 'trial', 'basic', 'advanced', 'enterprise'
  name text NOT NULL,
  description text NOT NULL,
  tagline text,
  price numeric(10,2) NOT NULL DEFAULT 0.00,
  currency text NOT NULL DEFAULT 'BRL',
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  cycle_multiplier integer NOT NULL DEFAULT 1,
  trial_days integer NOT NULL DEFAULT 0,
  max_students integer NOT NULL DEFAULT 100,
  max_branches integer NOT NULL DEFAULT 1,
  max_storage_gb integer NOT NULL DEFAULT 10,
  features jsonb NOT NULL DEFAULT '{
    "digitalLibrary": false,
    "beltExams": false,
    "competitions": false,
    "advancedReports": false,
    "multiBranch": false,
    "customBranding": false,
    "automatedNotifications": false
  }'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Inserção idempotente dos planos comerciais padrão do SaaS
INSERT INTO public.saas_commercial_plans (
  id, name, description, tagline, price, billing_cycle, cycle_multiplier, trial_days, max_students, max_branches, max_storage_gb, features, active
) VALUES
(
  'trial',
  'Degustação Gratuita (10 Dias)',
  'Acesso completo a todas as funcionalidades do sistema para testar com turmas reais sem necessidade de cartão de crédito.',
  'Experimente sem compromisso com suporte do time TatameHub.',
  0.00, 'monthly', 1, 10, 40, 2, 5,
  '{"digitalLibrary": true, "beltExams": true, "competitions": true, "advancedReports": true, "multiBranch": true, "customBranding": true, "automatedNotifications": true}'::jsonb,
  true
),
(
  'basic',
  'Plano Básico (Dojo Essencial)',
  'Indicado para academias e centros de treinamento individuais com até 100 alunos ativos.',
  'Gestão completa de alunos, financeiro, chamadas e turmas.',
  149.00, 'monthly', 1, 0, 100, 1, 10,
  '{"digitalLibrary": false, "beltExams": false, "competitions": false, "advancedReports": false, "multiBranch": false, "customBranding": false, "automatedNotifications": false}'::jsonb,
  true
),
(
  'advanced',
  'Plano Avançado (Academia Completa)',
  'A solução ideal para academias consolidadas, com múltiplas unidades, exames de faixa e biblioteca de técnicas em vídeo.',
  'Todos os módulos operacionais, pedagógicos e multi-filiais liberados.',
  299.00, 'monthly', 1, 0, 500, 5, 50,
  '{"digitalLibrary": true, "beltExams": true, "competitions": true, "advancedReports": true, "multiBranch": true, "customBranding": true, "automatedNotifications": true}'::jsonb,
  true
),
(
  'enterprise',
  'Plano Franquias & Federações',
  'Para redes com mais de 5 filiais, gestão centralizada com relatórios consolidados e limites ampliados.',
  'Capacidade ilimitada e consultoria de implantação dedicada.',
  599.00, 'monthly', 1, 0, 2000, 20, 200,
  '{"digitalLibrary": true, "beltExams": true, "competitions": true, "advancedReports": true, "multiBranch": true, "customBranding": true, "automatedNotifications": true}'::jsonb,
  true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  tagline = EXCLUDED.tagline,
  price = EXCLUDED.price,
  max_students = EXCLUDED.max_students,
  max_branches = EXCLUDED.max_branches,
  features = EXCLUDED.features;

-- 3. TABELA DE ASSINATURAS DO SAAS (SAAS_SUBSCRIPTIONS)
-- Cada tenant possui uma assinatura identificável vinculada a um plano comercial.
CREATE TABLE IF NOT EXISTS public.saas_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.saas_commercial_plans(id) ON DELETE RESTRICT,
  plan_name text NOT NULL,
  status text NOT NULL DEFAULT 'trial' CHECK (
    status IN ('trial', 'waiting_payment', 'active', 'past_due', 'suspended', 'canceled', 'expired')
  ),
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  amount numeric(10,2) NOT NULL DEFAULT 0.00,
  started_at timestamptz NOT NULL DEFAULT now(),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  next_due_date date NOT NULL DEFAULT (CURRENT_DATE + interval '30 days'),
  trial_expires_at timestamptz,
  grace_period_days integer NOT NULL DEFAULT 5, -- 5 dias de carência antes do bloqueio
  gateway_customer_id text,
  gateway_subscription_id text,
  cancel_reason text,
  canceled_at timestamptz,
  suspended_reason text,
  suspended_at timestamptz,
  last_payment_id text,
  manual_activation jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_saas_subscriptions_tenant UNIQUE (tenant_id)
);

-- 4. TABELA DE PAGAMENTOS DA PLATAFORMA (SAAS_PAYMENTS)
-- Registra os pagamentos recebidos dos clientes do SaaS (não confundir com mensalidades de alunos!).
CREATE TABLE IF NOT EXISTS public.saas_payments (
  id text PRIMARY KEY,
  subscription_id uuid REFERENCES public.saas_subscriptions(id) ON DELETE SET NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  due_date date NOT NULL,
  paid_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'paid', 'failed', 'canceled', 'refunded')
  ),
  payment_method text NOT NULL DEFAULT 'pix' CHECK (
    payment_method IN ('pix', 'credit_card', 'boleto')
  ),
  gateway_charge_id text,
  gateway_payment_id text,
  billing_period_start date NOT NULL,
  billing_period_end date NOT NULL,
  invoice_url text,
  pix_qr_code text,
  pix_copy_paste text,
  barcode text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. TABELA DE AUDITORIA DE EVENTOS DE WEBHOOK (IDEMPOTÊNCIA ESTREITA)
CREATE TABLE IF NOT EXISTS public.saas_payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE, -- Identificador único do evento no gateway
  gateway_name text NOT NULL, -- 'asaas', 'mercadopago', 'stripe'
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'processed' CHECK (status IN ('processed', 'ignored', 'failed')),
  error_details text,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- 6. TABELA DE AUDITORIA ADMINISTRATIVA DA PLATAFORMA (PLATFORM_AUDIT_LOGS)
-- Registra alterações críticas de superadmin (preços, suspensões, reativações, ativações manuais).
CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_user_name text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  tenant_name text,
  reason text,
  details text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  timestamp timestamptz NOT NULL DEFAULT now()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_saas_subs_tenant ON public.saas_subscriptions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_saas_payments_tenant ON public.saas_payments(tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_saas_payments_paid_at ON public.saas_payments(status, paid_at);
CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_timestamp ON public.platform_audit_logs(timestamp DESC);

-- ============================================================================
-- 7. POLÍTICAS DE ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE public.saas_commercial_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

-- 7.1 POLÍTICAS: saas_commercial_plans
-- Qualquer usuário autenticado pode visualizar planos ativos
DROP POLICY IF EXISTS "saas_plans_select" ON public.saas_commercial_plans;
CREATE POLICY "saas_plans_select" ON public.saas_commercial_plans
FOR SELECT TO authenticated
USING (active = true OR public.is_platform_admin());

-- Somente SuperAdmin da plataforma pode criar/editar planos
DROP POLICY IF EXISTS "saas_plans_write_admin" ON public.saas_commercial_plans;
CREATE POLICY "saas_plans_write_admin" ON public.saas_commercial_plans
FOR ALL TO authenticated
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

-- 7.2 POLÍTICAS: saas_subscriptions
-- SuperAdmin lê tudo. O proprietário da academia lê APENAS a sua própria assinatura!
-- Jamais pode consultar assinaturas de outras academias.
DROP POLICY IF EXISTS "saas_subscriptions_select" ON public.saas_subscriptions;
CREATE POLICY "saas_subscriptions_select" ON public.saas_subscriptions
FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR (public.has_tenant_role(tenant_id, 'owner') AND public.is_tenant_member(tenant_id))
);

-- Nenhum cliente pode alterar o próprio status de assinatura via UPDATE/INSERT livre
DROP POLICY IF EXISTS "saas_subscriptions_write_admin" ON public.saas_subscriptions;
CREATE POLICY "saas_subscriptions_write_admin" ON public.saas_subscriptions
FOR ALL TO authenticated
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

-- 7.3 POLÍTICAS: saas_payments
-- SuperAdmin lê todos os pagamentos. A academia lê APENAS suas próprias faturas.
DROP POLICY IF EXISTS "saas_payments_select" ON public.saas_payments;
CREATE POLICY "saas_payments_select" ON public.saas_payments
FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR (public.has_tenant_role(tenant_id, 'owner') AND public.is_tenant_member(tenant_id))
);

-- Nenhum cliente pode inserir ou forjar pagamentos
DROP POLICY IF EXISTS "saas_payments_write_admin" ON public.saas_payments;
CREATE POLICY "saas_payments_write_admin" ON public.saas_payments
FOR ALL TO authenticated
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

-- 7.4 POLÍTICAS: saas_payment_webhook_events & platform_audit_logs
-- Acesso restrito 100% ao SuperAdmin da plataforma
DROP POLICY IF EXISTS "saas_webhook_events_admin_only" ON public.saas_payment_webhook_events;
CREATE POLICY "saas_webhook_events_admin_only" ON public.saas_payment_webhook_events
FOR ALL TO authenticated
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "platform_audit_logs_admin_only" ON public.platform_audit_logs;
CREATE POLICY "platform_audit_logs_admin_only" ON public.platform_audit_logs
FOR SELECT TO authenticated
USING (public.is_platform_admin());

-- Permitir que SuperAdmin também consulte todas as academias na tabela public.tenants
DROP POLICY IF EXISTS "tenants_select_members_or_platform_admin" ON public.tenants;
CREATE POLICY "tenants_select_members_or_platform_admin" ON public.tenants
FOR SELECT TO authenticated
USING (
  public.is_tenant_member(id)
  OR public.is_platform_admin()
);

-- ============================================================================
-- 8. FUNÇÕES RPC DO PAINEL DO PROPRIETÁRIO (AUDITADAS E ATÔMICAS)
-- ============================================================================

-- 8.1 MÉTRICAS CONSOLIDADAS REAIS DA PLATAFORMA
CREATE OR REPLACE FUNCTION public.get_platform_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_total_tenants integer := 0;
  v_active_subscriptions integer := 0;
  v_trial_subscriptions integer := 0;
  v_past_due_subscriptions integer := 0;
  v_suspended_tenants integer := 0;
  v_canceled_subscriptions integer := 0;
  v_estimated_mrr numeric(10,2) := 0.00;
  v_confirmed_revenue_month numeric(10,2) := 0.00;
  v_confirmed_revenue_total numeric(10,2) := 0.00;
BEGIN
  -- Apenas administrador global pode calcular métricas da plataforma
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas o administrador global da plataforma pode consultar métricas financeiras consolidadas.';
  END IF;

  SELECT count(*) INTO v_total_tenants FROM public.tenants;
  SELECT count(*) INTO v_active_subscriptions FROM public.saas_subscriptions WHERE status = 'active';
  SELECT count(*) INTO v_trial_subscriptions FROM public.saas_subscriptions WHERE status = 'trial';
  SELECT count(*) INTO v_past_due_subscriptions FROM public.saas_subscriptions WHERE status = 'past_due';
  SELECT count(*) INTO v_suspended_tenants FROM public.tenants WHERE status = 'suspended';
  SELECT count(*) INTO v_canceled_subscriptions FROM public.saas_subscriptions WHERE status = 'canceled';

  -- MRR: exclusivamente a soma dos valores de assinaturas ativas
  SELECT COALESCE(sum(amount), 0.00) INTO v_estimated_mrr
  FROM public.saas_subscriptions
  WHERE status = 'active';

  -- Receita confirmada no mês corrente
  SELECT COALESCE(sum(amount), 0.00) INTO v_confirmed_revenue_month
  FROM public.saas_payments
  WHERE status = 'paid'
    AND paid_at >= date_trunc('month', now());

  -- Receita confirmada histórica total
  SELECT COALESCE(sum(amount), 0.00) INTO v_confirmed_revenue_total
  FROM public.saas_payments
  WHERE status = 'paid';

  RETURN jsonb_build_object(
    'total_tenants', v_total_tenants,
    'active_subscriptions', v_active_subscriptions,
    'trial_subscriptions', v_trial_subscriptions,
    'past_due_subscriptions', v_past_due_subscriptions,
    'suspended_tenants', v_suspended_tenants,
    'canceled_subscriptions', v_canceled_subscriptions,
    'estimated_mrr', v_estimated_mrr,
    'confirmed_revenue_month', v_confirmed_revenue_month,
    'confirmed_revenue_total', v_confirmed_revenue_total
  );
END;
$$;

-- 8.2 SUSPENDER OU REATIVAR ACADEMIA COM AUDITORIA
CREATE OR REPLACE FUNCTION public.admin_update_tenant_status(
  p_tenant_id uuid,
  p_new_status text,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tenant_name text;
  v_actor_name text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas o administrador da plataforma pode alterar status de academias.';
  END IF;

  IF p_new_status NOT IN ('active', 'suspended', 'canceled') THEN
    RAISE EXCEPTION 'Status inválido: %', p_new_status;
  END IF;

  IF trim(p_reason) = '' THEN
    RAISE EXCEPTION 'É obrigatório informar uma justificativa clara.';
  END IF;

  SELECT trade_name INTO v_tenant_name FROM public.tenants WHERE id = p_tenant_id;
  IF v_tenant_name IS NULL THEN
    RAISE EXCEPTION 'Academia não encontrada.';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = auth.uid();

  -- Atualizar tenant
  UPDATE public.tenants
  SET status = p_new_status::tenant_status, updated_at = now()
  WHERE id = p_tenant_id;

  -- Atualizar assinatura correspondente
  UPDATE public.saas_subscriptions
  SET
    status = CASE 
      WHEN p_new_status = 'suspended' THEN 'suspended'
      WHEN p_new_status = 'canceled' THEN 'canceled'
      ELSE 'active'
    END,
    suspended_reason = CASE WHEN p_new_status = 'suspended' THEN p_reason ELSE NULL END,
    suspended_at = CASE WHEN p_new_status = 'suspended' THEN now() ELSE NULL END,
    cancel_reason = CASE WHEN p_new_status = 'canceled' THEN p_reason ELSE NULL END,
    canceled_at = CASE WHEN p_new_status = 'canceled' THEN now() ELSE NULL END,
    updated_at = now()
  WHERE tenant_id = p_tenant_id;

  -- Gravar log de auditoria da plataforma
  INSERT INTO public.platform_audit_logs (
    actor_user_id,
    actor_user_name,
    action,
    entity_type,
    entity_id,
    tenant_id,
    tenant_name,
    reason,
    details
  ) VALUES (
    auth.uid(),
    COALESCE(v_actor_name, 'SuperAdmin'),
    CASE WHEN p_new_status = 'suspended' THEN 'suspend_tenant' ELSE 'reactivate_tenant' END,
    'tenant',
    p_tenant_id::text,
    p_tenant_id,
    v_tenant_name,
    p_reason,
    'Status da academia alterado para [' || p_new_status || ']. Justificativa: ' || p_reason
  );

  RETURN true;
END;
$$;

-- 8.3 PROCESSADOR DE WEBHOOK DE PAGAMENTO SEGURO E IDEMPOTENTE
CREATE OR REPLACE FUNCTION public.process_saas_payment_webhook(
  p_event_id text,
  p_gateway text,
  p_event_type text,
  p_charge_id text,
  p_tenant_id uuid,
  p_subscription_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'pix'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_already_processed boolean;
  v_tenant_name text;
BEGIN
  -- 1. Verificar idempotência pelo identificador do evento
  SELECT EXISTS (
    SELECT 1 FROM public.saas_payment_webhook_events WHERE event_id = p_event_id
  ) INTO v_already_processed;

  IF v_already_processed THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'message', 'Evento já processado anteriormente.');
  END IF;

  SELECT trade_name INTO v_tenant_name FROM public.tenants WHERE id = p_tenant_id;

  -- 2. Registrar evento de webhook
  INSERT INTO public.saas_payment_webhook_events (
    event_id, gateway_name, event_type, payload, status
  ) VALUES (
    p_event_id, p_gateway, p_event_type,
    jsonb_build_object('charge_id', p_charge_id, 'amount', p_amount, 'tenant_id', p_tenant_id),
    'processed'
  );

  -- 3. Se for confirmação de pagamento recebido
  IF p_event_type = 'PAYMENT_RECEIVED' THEN
    -- Registrar ou atualizar fatura paga
    INSERT INTO public.saas_payments (
      id, subscription_id, tenant_id, amount, currency, due_date, paid_at, status, payment_method, gateway_charge_id,
      billing_period_start, billing_period_end, notes
    ) VALUES (
      COALESCE(p_charge_id, 'pay-' || gen_random_uuid()),
      p_subscription_id,
      p_tenant_id,
      p_amount,
      'BRL',
      CURRENT_DATE,
      now(),
      'paid',
      p_payment_method,
      p_charge_id,
      CURRENT_DATE,
      (CURRENT_DATE + interval '30 days')::date,
      'Pagamento confirmado via webhook do gateway ' || p_gateway
    )
    ON CONFLICT (id) DO UPDATE SET
      status = 'paid',
      paid_at = now(),
      updated_at = now();

    -- Atualizar assinatura: marcar ativa e estender vigência por 30 dias
    UPDATE public.saas_subscriptions
    SET
      status = 'active',
      current_period_start = now(),
      current_period_end = now() + interval '30 days',
      next_due_date = (CURRENT_DATE + interval '30 days')::date,
      last_payment_id = p_charge_id,
      suspended_reason = NULL,
      suspended_at = NULL,
      updated_at = now()
    WHERE tenant_id = p_tenant_id;

    -- Liberar acesso do tenant
    UPDATE public.tenants
    SET status = 'active', updated_at = now()
    WHERE id = p_tenant_id;

    -- Registrar auditoria
    INSERT INTO public.platform_audit_logs (
      actor_user_id, actor_user_name, action, entity_type, entity_id, tenant_id, tenant_name, details
    ) VALUES (
      NULL,
      'Webhook ' || upper(p_gateway),
      'process_payment_webhook',
      'payment',
      p_charge_id,
      p_tenant_id,
      v_tenant_name,
      'Pagamento de R$ ' || p_amount || ' confirmado. Acesso da academia regularizado até ' || (CURRENT_DATE + interval '30 days')::text
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'duplicate', false, 'message', 'Webhook processado com sucesso.');
END;
$$;
