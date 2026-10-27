-- ============================================================================
-- MIGRATION 30: FIX SAAS PIX SUBSCRIPTION, PAYMENTS SCHEMA AND RPCS
-- ============================================================================
-- Produto: Tatame Club (https://tatameclub.com.br)
-- Empresa: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
--
-- Objetivos:
-- 1. Compatibilizar o esquema das tabelas saas_subscriptions e saas_payments com
--    os tipos reais criados na Migration 24 (UUID para saas_subscriptions.id,
--    TEXT para saas_payments.id, trade_name para tenants).
-- 2. Adicionar as colunas necessárias para o fluxo Pix:
--    - saas_commercial_plans: monthly_price, annual_price
--    - saas_subscriptions: requested_plan_id, requested_billing_cycle, requested_amount, tenant_name, etc.
--    - saas_payments: tenant_name, plan_id, plan_name, billing_cycle, payer_email, pix_key, reference_id, etc.
-- 3. Atualizar as constraints de status para permitir 'pending_payment' e 'under_review'.
-- 4. Criar a tabela saas_subscription_email_logs para auditoria de envios.
-- 5. Criar a RPC SECURITY DEFINER public.request_saas_plan_subscription(...)
--    com validação rigorosa de permissões (is_platform_admin ou membro autorizado do tenant),
--    cálculo exato de valores com desconto por ciclo, e idempotência estrita.
-- 6. Criar a RPC SECURITY DEFINER public.get_tenant_subscription_overview(uuid)
-- 7. Criar a RPC SECURITY DEFINER public.log_saas_subscription_email_result(...)
-- 8. Conceder permissão de execução a authenticated e notificar reload do schema PostgREST.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXPANDIR SAAS_COMMERCIAL_PLANS
-- ----------------------------------------------------------------------------
ALTER TABLE public.saas_commercial_plans
  ADD COLUMN IF NOT EXISTS monthly_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS annual_price numeric(10,2);

UPDATE public.saas_commercial_plans
SET monthly_price = price
WHERE monthly_price IS NULL;

UPDATE public.saas_commercial_plans
SET annual_price = CASE
  WHEN id = 'basic' THEN 1490.00
  WHEN id = 'advanced' THEN 2990.00
  WHEN id = 'enterprise' THEN 5990.00
  ELSE 0.00
END
WHERE annual_price IS NULL;

-- ----------------------------------------------------------------------------
-- 2. EXPANDIR SAAS_SUBSCRIPTIONS
-- ----------------------------------------------------------------------------
ALTER TABLE public.saas_subscriptions
  ADD COLUMN IF NOT EXISTS tenant_name text,
  ADD COLUMN IF NOT EXISTS requested_plan_id text REFERENCES public.saas_commercial_plans(id),
  ADD COLUMN IF NOT EXISTS requested_billing_cycle text,
  ADD COLUMN IF NOT EXISTS requested_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'pix',
  ADD COLUMN IF NOT EXISTS payment_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_renew boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS last_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_email_status text,
  ADD COLUMN IF NOT EXISTS last_email_error text,
  ADD COLUMN IF NOT EXISTS last_payment_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_payment_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Atualizar constraint de status em saas_subscriptions
DO $$
DECLARE
  v_con text;
BEGIN
  FOR v_con IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'saas_subscriptions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.saas_subscriptions DROP CONSTRAINT IF EXISTS %I', v_con);
  END LOOP;
END $$;

ALTER TABLE public.saas_subscriptions
  ADD CONSTRAINT saas_subscriptions_status_check
  CHECK (status IN (
    'trial',
    'pending_payment',
    'waiting_payment',
    'payment_under_review',
    'under_review',
    'active',
    'past_due',
    'suspended',
    'canceled',
    'expired',
    'rejected'
  ));

-- Atualizar constraint de billing_cycle em saas_subscriptions
DO $$
DECLARE
  v_con text;
BEGIN
  FOR v_con IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'saas_subscriptions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%billing_cycle%'
      AND con.conname <> 'saas_subscriptions_requested_billing_cycle_check'
  LOOP
    EXECUTE format('ALTER TABLE public.saas_subscriptions DROP CONSTRAINT IF EXISTS %I', v_con);
  END LOOP;
END $$;

ALTER TABLE public.saas_subscriptions
  ADD CONSTRAINT saas_subscriptions_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual'));

-- ----------------------------------------------------------------------------
-- 3. EXPANDIR SAAS_PAYMENTS
-- ----------------------------------------------------------------------------
ALTER TABLE public.saas_payments
  ADD COLUMN IF NOT EXISTS tenant_name text,
  ADD COLUMN IF NOT EXISTS plan_id text REFERENCES public.saas_commercial_plans(id),
  ADD COLUMN IF NOT EXISTS plan_name text,
  ADD COLUMN IF NOT EXISTS billing_cycle text DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS payer_email text,
  ADD COLUMN IF NOT EXISTS pix_key text,
  ADD COLUMN IF NOT EXISTS pix_key_provisional boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS confirmed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_by_user_name text,
  ADD COLUMN IF NOT EXISTS confirmation_notes text;

-- Atualizar constraint de status em saas_payments
DO $$
DECLARE
  v_con text;
BEGIN
  FOR v_con IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'saas_payments'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.saas_payments DROP CONSTRAINT IF EXISTS %I', v_con);
  END LOOP;
END $$;

ALTER TABLE public.saas_payments
  ADD CONSTRAINT saas_payments_status_check
  CHECK (status IN ('pending', 'under_review', 'paid', 'failed', 'rejected', 'canceled', 'refunded'));

-- ----------------------------------------------------------------------------
-- 4. TABELA DE AUDITORIA DE E-MAILS DE COBRANÇA
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saas_subscription_email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.saas_subscriptions(id) ON DELETE SET NULL,
  payment_id text REFERENCES public.saas_payments(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  plan_id text NOT NULL,
  plan_name text NOT NULL,
  billing_cycle text NOT NULL,
  amount numeric(10,2) NOT NULL,
  pix_key_used text NOT NULL,
  is_provisional_pix_key boolean NOT NULL DEFAULT true,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'missing_config', 'pending')),
  provider text NOT NULL DEFAULT 'resend',
  provider_message_id text,
  error_message text,
  triggered_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_sub_email_logs_tenant_created
  ON public.saas_subscription_email_logs(tenant_id, created_at DESC);

ALTER TABLE public.saas_subscription_email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_logs_select" ON public.saas_subscription_email_logs;
CREATE POLICY "email_logs_select" ON public.saas_subscription_email_logs
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = saas_subscription_email_logs.tenant_id
        AND user_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner', 'branch_manager', 'financial')
    )
  );

-- ----------------------------------------------------------------------------
-- 5. RPC: REQUEST SAAS PLAN SUBSCRIPTION (PRINCIPAL)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_saas_plan_subscription(
  p_tenant_id uuid,
  p_plan_id text,
  p_billing_cycle text DEFAULT 'monthly',
  p_payer_email text DEFAULT NULL,
  p_pix_key text DEFAULT '28410730000180',
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_name text;
  v_tenant public.tenants%ROWTYPE;
  v_plan public.saas_commercial_plans%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
  v_payment public.saas_payments%ROWTYPE;
  v_cycle_months integer := 1;
  v_base_price numeric(10,2);
  v_total_amount numeric(10,2);
  v_recipient_email text;
  v_sub_id uuid;
  v_pay_id text;
  v_reused_existing boolean := false;
  v_tenant_display_name text;
BEGIN
  -- 1. Autenticação obrigatória
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória para solicitar contratação de plano.';
  END IF;

  -- 2. Validação estrita de autorização (SuperAdmin ou gestor autorizado do tenant)
  IF NOT (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 
      FROM public.tenant_memberships 
      WHERE tenant_id = p_tenant_id 
        AND user_id = v_caller_id 
        AND status = 'active'
        AND role IN ('owner', 'branch_manager', 'financial', 'secretary')
    )
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas o administrador ou responsável financeiro da academia pode contratar planos.';
  END IF;

  -- 3. Obter dados da academia
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia não encontrada (ID: %).', p_tenant_id;
  END IF;

  v_tenant_display_name := COALESCE(NULLIF(btrim(v_tenant.trade_name), ''), NULLIF(btrim(v_tenant.legal_name), ''), 'Academia');

  -- Obter nome do usuário solicitante para registro na trilha de auditoria
  SELECT COALESCE(p.full_name, u.raw_user_meta_data->>'full_name', u.email, 'Administrador')
  INTO v_caller_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_caller_id;

  IF v_caller_name IS NULL OR btrim(v_caller_name) = '' THEN
    v_caller_name := COALESCE(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() ->> 'email', v_tenant.admin_name, 'Administrador');
  END IF;

  -- 4. Validar plano
  IF p_plan_id IS NULL OR btrim(p_plan_id) = '' OR p_plan_id = 'trial' THEN
    RAISE EXCEPTION 'Selecione um plano comercial válido (Básico, Avançado ou Enterprise).';
  END IF;

  SELECT * INTO v_plan
  FROM public.saas_commercial_plans
  WHERE id = p_plan_id AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano comercial (%) inválido ou indisponível para contratação.', p_plan_id;
  END IF;

  -- 5. Validar ciclo de cobrança
  IF p_billing_cycle NOT IN ('monthly', 'quarterly', 'semiannual', 'annual') THEN
    RAISE EXCEPTION 'Ciclo de cobrança inválido (%). Utilize monthly, quarterly, semiannual ou annual.', p_billing_cycle;
  END IF;

  v_base_price := COALESCE(v_plan.monthly_price, v_plan.price, 0);

  CASE p_billing_cycle
    WHEN 'monthly' THEN
      v_cycle_months := 1;
      v_total_amount := round(v_base_price, 2);
    WHEN 'quarterly' THEN
      v_cycle_months := 3;
      v_total_amount := round(v_base_price * 3 * 0.95, 2);
    WHEN 'semiannual' THEN
      v_cycle_months := 6;
      v_total_amount := round(v_base_price * 6 * 0.90, 2);
    WHEN 'annual' THEN
      v_cycle_months := 12;
      IF COALESCE(v_plan.annual_price, 0) > 0 THEN
        v_total_amount := round(v_plan.annual_price, 2);
      ELSE
        v_total_amount := round(v_base_price * 12 * 0.85, 2);
      END IF;
  END CASE;

  -- 6. E-mail do pagador
  v_recipient_email := lower(btrim(COALESCE(NULLIF(btrim(p_payer_email), ''), v_tenant.email)));
  IF v_recipient_email IS NULL OR v_recipient_email = '' OR v_recipient_email NOT LIKE '%@%' THEN
    RAISE EXCEPTION 'A academia não possui e-mail administrativo válido cadastrado para receber as instruções de pagamento.';
  END IF;

  -- 7. Gravação em saas_subscriptions (status = pending_payment)
  SELECT * INTO v_sub FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF FOUND THEN
    v_sub_id := v_sub.id;
    UPDATE public.saas_subscriptions
    SET
      tenant_name = v_tenant_display_name,
      requested_plan_id = v_plan.id,
      requested_billing_cycle = p_billing_cycle,
      requested_amount = v_total_amount,
      plan_id = CASE WHEN status = 'active' THEN plan_id ELSE v_plan.id END,
      plan_name = CASE WHEN status = 'active' THEN plan_name ELSE v_plan.name END,
      billing_cycle = p_billing_cycle,
      amount = v_total_amount,
      status = CASE WHEN status = 'active' THEN 'active' ELSE 'pending_payment' END,
      payment_method = 'pix',
      payment_requested_at = now(),
      notes = COALESCE(p_notes, notes),
      updated_at = now()
    WHERE id = v_sub_id
    RETURNING * INTO v_sub;
  ELSE
    v_sub_id := gen_random_uuid();
    INSERT INTO public.saas_subscriptions (
      id,
      tenant_id,
      tenant_name,
      plan_id,
      plan_name,
      requested_plan_id,
      requested_billing_cycle,
      requested_amount,
      billing_cycle,
      amount,
      status,
      trial_started_at,
      trial_expires_at,
      current_period_start,
      current_period_end,
      next_due_date,
      auto_renew,
      payment_method,
      payment_requested_at,
      notes,
      created_at,
      updated_at
    ) VALUES (
      v_sub_id,
      p_tenant_id,
      v_tenant_display_name,
      v_plan.id,
      v_plan.name,
      v_plan.id,
      p_billing_cycle,
      v_total_amount,
      p_billing_cycle,
      v_total_amount,
      'pending_payment',
      v_tenant.trial_started_at,
      v_tenant.trial_expires_at,
      now(),
      now() + (v_cycle_months || ' months')::interval,
      (CURRENT_DATE + interval '3 days'),
      true,
      'pix',
      now(),
      COALESCE(p_notes, 'Solicitação de contratação via Pix registrada pelo administrador da academia.'),
      now(),
      now()
    )
    RETURNING * INTO v_sub;
  END IF;

  -- 8. Idempotência estrita: verificar se já existe cobrança pendente idêntica
  SELECT * INTO v_payment
  FROM public.saas_payments
  WHERE tenant_id = p_tenant_id
    AND status IN ('pending', 'under_review')
    AND plan_id = v_plan.id
    AND billing_cycle = p_billing_cycle
    AND amount = v_total_amount
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_reused_existing := true;
    UPDATE public.saas_payments
    SET
      payer_email = v_recipient_email,
      pix_key = COALESCE(p_pix_key, '28410730000180'),
      updated_at = now()
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;
  ELSE
    -- Cancelar cobranças pendentes anteriores de outros planos/ciclos para evitar duplicidade
    UPDATE public.saas_payments
    SET
      status = 'canceled',
      notes = COALESCE(notes, '') || ' [Substituído por nova seleção de plano]',
      updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND status = 'pending';

    v_pay_id := 'pay-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    INSERT INTO public.saas_payments (
      id,
      subscription_id,
      tenant_id,
      tenant_name,
      plan_id,
      plan_name,
      billing_cycle,
      amount,
      currency,
      due_date,
      billing_period_start,
      billing_period_end,
      status,
      payment_method,
      payer_email,
      pix_key,
      pix_key_provisional,
      reference_id,
      notes,
      created_at,
      updated_at
    ) VALUES (
      v_pay_id,
      v_sub.id,
      p_tenant_id,
      v_tenant_display_name,
      v_plan.id,
      v_plan.name,
      p_billing_cycle,
      v_total_amount,
      'BRL',
      (CURRENT_DATE + interval '3 days'),
      CURRENT_DATE,
      (CURRENT_DATE + (v_cycle_months || ' months')::interval)::date,
      'pending',
      'pix',
      v_recipient_email,
      COALESCE(p_pix_key, '28410730000180'),
      true,
      upper('TC-' || substr(replace(p_tenant_id::text, '-', ''), 1, 6) || '-' || to_char(now(), 'YYMMDDHH24MI')),
      format('Solicitação de contratação do %s (%s) via Pix.', v_plan.name, p_billing_cycle),
      now(),
      now()
    )
    RETURNING * INTO v_payment;
  END IF;

  -- 9. Registrar auditoria no histórico do tenant
  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    user_name,
    action,
    entity,
    entity_id,
    details,
    timestamp
  ) VALUES (
    p_tenant_id,
    v_caller_id,
    COALESCE(v_caller_name, 'Administrador'),
    'Solicitação de Plano Comercial (Pix)',
    'SaaSSubscription',
    v_sub.id::text,
    format('Solicitação de contratação do plano %s (%s) no valor de R$ %s via Pix. Status: pending_payment. Referência: %s.', v_plan.name, p_billing_cycle, v_total_amount, v_payment.reference_id),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'reused_existing_payment', v_reused_existing,
    'subscription_id', v_sub.id::text,
    'payment_id', v_payment.id,
    'reference_id', v_payment.reference_id,
    'plan_id', v_plan.id,
    'plan_name', v_plan.name,
    'billing_cycle', p_billing_cycle,
    'amount', v_total_amount,
    'due_date', v_payment.due_date,
    'payer_email', v_recipient_email,
    'pix_key', v_payment.pix_key,
    'subscription_status', v_sub.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_saas_plan_subscription(uuid, text, text, text, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. RPC: GET_TENANT_SUBSCRIPTION_OVERVIEW
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tenant_subscription_overview(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
  v_payments jsonb;
  v_email_logs jsonb;
  v_plans jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = p_tenant_id
        AND user_id = auth.uid()
        AND status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'Acesso negado aos dados de assinatura desta academia.';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  SELECT * INTO v_sub FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC), '[]'::jsonb)
  INTO v_payments
  FROM public.saas_payments p
  WHERE p.tenant_id = p_tenant_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_email_logs
  FROM public.saas_subscription_email_logs l
  WHERE l.tenant_id = p_tenant_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(pl) ORDER BY pl.price ASC), '[]'::jsonb)
  INTO v_plans
  FROM public.saas_commercial_plans pl
  WHERE pl.active = true;

  RETURN jsonb_build_object(
    'tenant', to_jsonb(v_tenant),
    'subscription', to_jsonb(v_sub),
    'payments', v_payments,
    'email_logs', v_email_logs,
    'commercial_plans', v_plans,
    'plans', v_plans
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_subscription_overview(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. RPC: LOG_SAAS_SUBSCRIPTION_EMAIL_RESULT
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_saas_subscription_email_result(
  p_tenant_id uuid,
  p_subscription_id text,
  p_payment_id text,
  p_recipient_email text,
  p_subject text,
  p_plan_id text,
  p_plan_name text,
  p_billing_cycle text,
  p_amount numeric,
  p_pix_key_used text,
  p_is_provisional_pix_key boolean,
  p_status text,
  p_provider text DEFAULT 'resend',
  p_provider_message_id text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_log_id uuid;
  v_sub_uuid uuid;
BEGIN
  IF v_caller_id IS NOT NULL AND NOT (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = p_tenant_id
        AND user_id = v_caller_id
        AND status = 'active'
        AND role IN ('owner', 'branch_manager', 'financial')
    )
  ) THEN
    RAISE EXCEPTION 'Acesso negado para registrar auditoria de e-mail.';
  END IF;

  IF p_subscription_id IS NOT NULL AND p_subscription_id ~ '^[0-9a-fA-F-]{36}$' THEN
    v_sub_uuid := p_subscription_id::uuid;
  ELSE
    SELECT id INTO v_sub_uuid FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id LIMIT 1;
  END IF;

  INSERT INTO public.saas_subscription_email_logs (
    tenant_id,
    subscription_id,
    payment_id,
    recipient_email,
    subject,
    plan_id,
    plan_name,
    billing_cycle,
    amount,
    pix_key_used,
    is_provisional_pix_key,
    status,
    provider,
    provider_message_id,
    error_message,
    triggered_by_user_id
  ) VALUES (
    p_tenant_id,
    v_sub_uuid,
    p_payment_id,
    p_recipient_email,
    p_subject,
    p_plan_id,
    p_plan_name,
    p_billing_cycle,
    p_amount,
    p_pix_key_used,
    COALESCE(p_is_provisional_pix_key, true),
    p_status,
    COALESCE(p_provider, 'resend'),
    p_provider_message_id,
    p_error_message,
    v_caller_id
  )
  RETURNING id INTO v_log_id;

  UPDATE public.saas_subscriptions
  SET
    last_email_sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE last_email_sent_at END,
    last_email_status = p_status,
    last_email_error = p_error_message,
    updated_at = now()
  WHERE tenant_id = p_tenant_id;

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_saas_subscription_email_result(uuid, text, text, text, text, text, text, text, numeric, text, boolean, text, text, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. RECARREGAR O SCHEMA CACHE DO POSTGREST
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
