-- ============================================================================
-- MIGRATION 29: SAAS PIX PAYMENT, AUTOMATIC EMAIL AUDIT, AND LICENSE PERSISTENCE
-- ============================================================================
-- Product: Tatame Club (https://tatameclub.com.br)
-- Company: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
--
-- Objectives:
-- 1. Support post-trial commercial plan selection with explicit 'pending_payment'
--    state and Pix payment request tracking without unlocking paid access prematurely.
-- 2. Audit every automatic payment instruction email attempt in
--    public.saas_subscription_email_logs and on public.saas_subscriptions.
-- 3. Fix get_tenant_effective_limits() so active subscriptions with historical
--    past trial_expires_at are properly recognized as active, while pending_payment
--    after trial expiration blocks access until valid payment confirmation.
-- 4. Provide transactional SECURITY DEFINER RPCs for:
--    - Academy admins: request_saas_plan_subscription, log_saas_subscription_email_result,
--      get_tenant_subscription_overview
--    - Global Admins (admin@tatameclub.com.br, beaverstraining@gmail.com):
--      admin_change_tenant_plan, admin_confirm_saas_payment, admin_reject_saas_payment,
--      admin_manual_activate_subscription, admin_suspend_tenant, admin_reactivate_tenant,
--      admin_save_commercial_plan, admin_fetch_platform_overview
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXPAND SAAS_SUBSCRIPTIONS COLUMNS & STATUS CONSTRAINT
-- ----------------------------------------------------------------------------
ALTER TABLE public.saas_subscriptions
  ADD COLUMN IF NOT EXISTS requested_plan_id text REFERENCES public.saas_commercial_plans(id),
  ADD COLUMN IF NOT EXISTS requested_billing_cycle text CHECK (requested_billing_cycle IS NULL OR requested_billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  ADD COLUMN IF NOT EXISTS requested_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS payment_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_email_status text CHECK (last_email_status IS NULL OR last_email_status IN ('sent', 'failed', 'missing_config', 'pending')),
  ADD COLUMN IF NOT EXISTS last_email_error text,
  ADD COLUMN IF NOT EXISTS last_payment_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_payment_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  FOR v_constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'saas_subscriptions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.saas_subscriptions DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.saas_subscriptions
  ADD CONSTRAINT saas_subscriptions_status_check
  CHECK (status IN (
    'trial',
    'pending_payment',
    'waiting_payment',
    'payment_under_review',
    'active',
    'past_due',
    'suspended',
    'canceled',
    'expired',
    'rejected'
  ));

-- Ensure billing_cycle supports semiannual as well
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  FOR v_constraint_name IN
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
    EXECUTE format('ALTER TABLE public.saas_subscriptions DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.saas_subscriptions
  ADD CONSTRAINT saas_subscriptions_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual'));

-- Ensure UNIQUE (tenant_id) on saas_subscriptions so a tenant never gets duplicate subscriptions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'saas_subscriptions'
      AND con.contype = 'u'
  ) THEN
    ALTER TABLE public.saas_subscriptions ADD CONSTRAINT saas_subscriptions_tenant_id_key UNIQUE (tenant_id);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. EXPAND SAAS_PAYMENTS COLUMNS & STATUS CONSTRAINT
-- ----------------------------------------------------------------------------
ALTER TABLE public.saas_payments
  ADD COLUMN IF NOT EXISTS plan_id text REFERENCES public.saas_commercial_plans(id),
  ADD COLUMN IF NOT EXISTS plan_name text,
  ADD COLUMN IF NOT EXISTS billing_cycle text DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  ADD COLUMN IF NOT EXISTS payer_email text,
  ADD COLUMN IF NOT EXISTS pix_key text,
  ADD COLUMN IF NOT EXISTS pix_key_provisional boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS confirmed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_by_user_name text,
  ADD COLUMN IF NOT EXISTS confirmation_notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  FOR v_constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'saas_payments'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.saas_payments DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.saas_payments
  ADD CONSTRAINT saas_payments_status_check
  CHECK (status IN ('pending', 'under_review', 'paid', 'failed', 'rejected', 'canceled', 'refunded'));

-- ----------------------------------------------------------------------------
-- 3. CREATE SAAS_SUBSCRIPTION_EMAIL_LOGS TABLE FOR EMAIL AUDIT & DIAGNOSTICS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saas_subscription_email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscription_id text REFERENCES public.saas_subscriptions(id) ON DELETE SET NULL,
  payment_id text REFERENCES public.saas_payments(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  plan_id text NOT NULL,
  plan_name text NOT NULL,
  billing_cycle text NOT NULL,
  amount numeric(10,2) NOT NULL,
  pix_key_used text NOT NULL,
  is_provisional_pix_key boolean NOT NULL DEFAULT true,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'missing_config')),
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
    OR public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'financial')
  );

-- ----------------------------------------------------------------------------
-- 4. FIX GET_TENANT_EFFECTIVE_LIMITS TO EVALUATE ACTIVE BEFORE HISTORICAL TRIAL
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tenant_effective_limits(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
  v_plan public.saas_commercial_plans%ROWTYPE;
  v_effective_status text;
  v_is_allowed boolean := true;
  v_reason text := 'Assinatura regular e ativa.';
BEGIN
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'is_allowed', false,
      'status', 'not_found',
      'reason', 'Academia não localizada.'
    );
  END IF;

  SELECT * INTO v_sub FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id;

  -- Priority 1: Suspended or Canceled
  IF v_tenant.status = 'suspended' OR v_sub.status = 'suspended' THEN
    v_effective_status := 'suspended';
    v_is_allowed := false;
    v_reason := COALESCE(v_tenant.suspended_reason, 'Licença suspensa administrativamente.');
  ELSIF v_tenant.status = 'canceled' OR v_sub.status = 'canceled' THEN
    v_effective_status := 'canceled';
    v_is_allowed := false;
    v_reason := 'Assinatura cancelada.';
  -- Priority 2: Explicitly Active commercial subscription
  ELSIF v_tenant.status = 'active' AND v_sub.status = 'active' AND v_tenant.plan_id <> 'trial' THEN
    IF v_sub.current_period_end IS NOT NULL
       AND v_sub.current_period_end < (now() - interval '5 days')
       AND COALESCE(v_sub.auto_renew, false) = false THEN
      v_effective_status := 'expired';
      v_is_allowed := false;
      v_reason := 'O ciclo da assinatura expirou sem renovação confirmada.';
    ELSE
      v_effective_status := 'active';
      v_is_allowed := true;
      v_reason := 'Assinatura comercial ativa e regular.';
    END IF;
  -- Priority 3: Pending payment / waiting payment / under review
  ELSIF v_sub.status IN ('pending_payment', 'waiting_payment', 'payment_under_review') THEN
    IF v_tenant.trial_expires_at IS NOT NULL AND v_tenant.trial_expires_at >= now() THEN
      v_effective_status := 'trial_active';
      v_is_allowed := true;
      v_reason := 'Solicitação de plano registrada (aguardando pagamento Pix). Acesso liberado durante a degustação vigente.';
    ELSE
      v_effective_status := 'pending_payment';
      v_is_allowed := false;
      v_reason := 'Contratação registrada e aguardando confirmação válida do pagamento Pix para liberação do acesso.';
    END IF;
  -- Priority 4: Rejected payment
  ELSIF v_sub.status = 'rejected' THEN
    v_effective_status := 'rejected';
    v_is_allowed := false;
    v_reason := 'O pagamento informado não pôde ser validado. Envie um comprovante válido ou selecione um plano.';
  -- Priority 5: Past due
  ELSIF v_sub.status = 'past_due' THEN
    v_effective_status := 'past_due';
    v_is_allowed := false;
    v_reason := 'Mensalidade em atraso. Regularize sua assinatura.';
  -- Priority 6: Expired
  ELSIF v_tenant.status = 'expired' OR v_sub.status = 'expired' THEN
    v_effective_status := 'expired';
    v_is_allowed := false;
    v_reason := 'Licença expirada. Renove seu plano.';
  -- Priority 7: Trial evaluation
  ELSIF v_tenant.status = 'trial' OR v_sub.status = 'trial' OR v_tenant.plan_id = 'trial' THEN
    IF v_tenant.trial_expires_at IS NOT NULL AND v_tenant.trial_expires_at < now() THEN
      v_effective_status := 'trial_expired';
      v_is_allowed := false;
      v_reason := 'Período de degustação gratuita de 14 dias encerrado. Selecione um plano comercial para continuar.';
    ELSE
      v_effective_status := 'trial_active';
      v_is_allowed := true;
      v_reason := 'Período de degustação gratuita ativo.';
    END IF;
  -- Fallback: Active tenant without subscription row yet
  ELSIF v_tenant.status = 'active' THEN
    v_effective_status := 'active';
    v_is_allowed := true;
    v_reason := 'Licença ativa.';
  ELSE
    v_effective_status := 'expired';
    v_is_allowed := false;
    v_reason := 'Status de licença inválido ou expirado.';
  END IF;

  SELECT * INTO v_plan
  FROM public.saas_commercial_plans
  WHERE id = COALESCE(v_sub.plan_id, v_tenant.plan_id, 'trial');

  RETURN jsonb_build_object(
    'is_allowed', v_is_allowed,
    'status', v_effective_status,
    'reason', v_reason,
    'plan_id', COALESCE(v_plan.id, v_tenant.plan_id),
    'plan_name', COALESCE(v_plan.name, 'Trial 14 Dias'),
    'subscription_status', COALESCE(v_sub.status, v_tenant.status),
    'trial_expires_at', v_tenant.trial_expires_at,
    'current_period_end', v_sub.current_period_end,
    'max_students', COALESCE(v_plan.max_students, 50),
    'max_branches', COALESCE(v_plan.max_branches, 1),
    'max_classes', COALESCE(v_plan.max_classes, 10),
    'max_team_users', COALESCE(v_plan.max_team_users, 3),
    'allow_financial_module', COALESCE(v_plan.allow_financial_module, true),
    'allow_digital_library', COALESCE(v_plan.allow_digital_library, true),
    'allow_anthropometry', COALESCE(v_plan.allow_anthropometry, true),
    'allow_competitions', COALESCE(v_plan.allow_competitions, true)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. RPC: REQUEST SAAS PLAN SUBSCRIPTION (ACADEMY ADMIN / OWNER)
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
  v_unit_price numeric(10,2);
  v_total_amount numeric(10,2);
  v_recipient_email text;
  v_sub_id text;
  v_pay_id text;
  v_reused_existing boolean := false;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória para solicitar contratação de plano.';
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'financial')
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas o administrador ou responsável financeiro da academia pode contratar planos.';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia não encontrada.';
  END IF;

  IF p_plan_id IS NULL OR btrim(p_plan_id) = '' OR p_plan_id = 'trial' THEN
    RAISE EXCEPTION 'Selecione um plano comercial válido (Básico, Avançado ou Enterprise).';
  END IF;

  SELECT * INTO v_plan
  FROM public.saas_commercial_plans
  WHERE id = p_plan_id AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano comercial (%) inválido ou indisponível para contratação.', p_plan_id;
  END IF;

  IF p_billing_cycle NOT IN ('monthly', 'quarterly', 'semiannual', 'annual') THEN
    RAISE EXCEPTION 'Ciclo de cobrança inválido (%). Utilize monthly, quarterly, semiannual ou annual.', p_billing_cycle;
  END IF;

  CASE p_billing_cycle
    WHEN 'monthly' THEN
      v_cycle_months := 1;
      v_unit_price := v_plan.monthly_price;
      v_total_amount := round(v_plan.monthly_price, 2);
    WHEN 'quarterly' THEN
      v_cycle_months := 3;
      v_unit_price := round(v_plan.monthly_price * 0.95, 2);
      v_total_amount := round(v_plan.monthly_price * 3 * 0.95, 2);
    WHEN 'semiannual' THEN
      v_cycle_months := 6;
      v_unit_price := round(v_plan.monthly_price * 0.90, 2);
      v_total_amount := round(v_plan.monthly_price * 6 * 0.90, 2);
    WHEN 'annual' THEN
      v_cycle_months := 12;
      IF COALESCE(v_plan.annual_price, 0) > 0 THEN
        v_unit_price := round(v_plan.annual_price / 12.0, 2);
        v_total_amount := round(v_plan.annual_price, 2);
      ELSE
        v_unit_price := round(v_plan.monthly_price * 0.85, 2);
        v_total_amount := round(v_plan.monthly_price * 12 * 0.85, 2);
      END IF;
  END CASE;

  v_recipient_email := lower(btrim(COALESCE(NULLIF(btrim(p_payer_email), ''), v_tenant.email)));
  IF v_recipient_email IS NULL OR v_recipient_email = '' THEN
    RAISE EXCEPTION 'A academia não possui e-mail administrativo cadastrado para receber as instruções de pagamento.';
  END IF;

  -- Check if there is an existing subscription row for this tenant
  SELECT * INTO v_sub FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF FOUND THEN
    v_sub_id := v_sub.id;
    UPDATE public.saas_subscriptions
    SET
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
    v_sub_id := 'sub-' || substr(replace(p_tenant_id::text, '-', ''), 1, 12);
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
      auto_renew,
      payment_method,
      payment_requested_at,
      notes,
      updated_at
    ) VALUES (
      v_sub_id,
      p_tenant_id,
      v_tenant.name,
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
      true,
      'pix',
      now(),
      COALESCE(p_notes, 'Solicitação de contratação via Pix registrada pelo administrador da academia.'),
      now()
    )
    RETURNING * INTO v_sub;
  END IF;

  -- Check if there is already a pending payment for the exact same plan + cycle + amount
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
    -- Cancel older pending payment requests for other plans/cycles so there is no ambiguity
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
      status,
      payment_method,
      due_date,
      payer_email,
      pix_key,
      pix_key_provisional,
      reference_Id,
      notes,
      created_at,
      updated_at
    ) VALUES (
      v_pay_id,
      v_sub.id,
      p_tenant_id,
      v_tenant.name,
      v_plan.id,
      v_plan.name,
      p_billing_cycle,
      v_total_amount,
      'pending',
      'pix',
      (now() + interval '3 days')::date,
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
    COALESCE(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() ->> 'email', 'Administrador'),
    'Solicitação de Plano Comercial (Pix)',
    'SaaSSubscription',
    v_sub.id::text,
    format('Solicitação de contratação do plano %s (%s) no valor de R$ %s via Pix. Status: pending_payment. Referência: %s.', v_plan.name, p_billing_cycle, v_total_amount, v_payment.reference_id),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'reused_existing_payment', v_reused_existing,
    'tenant_id', v_tenant.id,
    'tenant_name', v_tenant.name,
    'recipient_email', v_recipient_email,
    'subscription_id', v_sub.id,
    'subscription_status', v_sub.status,
    'payment_id', v_payment.id,
    'payment_reference', v_payment.reference_id,
    'payment_status', v_payment.status,
    'due_date', v_payment.due_date,
    'plan_id', v_plan.id,
    'plan_name', v_plan.name,
    'billing_cycle', p_billing_cycle,
    'cycle_months', v_cycle_months,
    'unit_monthly_price', v_unit_price,
    'total_amount', v_total_amount,
    'requested_at', v_sub.payment_requested_at
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. RPC: LOG SAAS SUBSCRIPTION EMAIL RESULT
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
BEGIN
  IF v_caller_id IS NOT NULL AND NOT (
    public.is_platform_admin()
    OR public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'financial')
  ) THEN
    RAISE EXCEPTION 'Acesso negado para registrar auditoria de e-mail.';
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
    p_subscription_id,
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

-- ----------------------------------------------------------------------------
-- 7. RPC: GET TENANT SUBSCRIPTION OVERVIEW (FOR ACADEMY ADMIN)
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
  v_limits jsonb;
  v_payments jsonb;
  v_email_logs jsonb;
  v_plans jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR public.is_tenant_member(p_tenant_id)
  ) THEN
    RAISE EXCEPTION 'Acesso negado aos dados de assinatura desta academia.';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia não encontrada.';
  END IF;

  SELECT * INTO v_sub FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id;
  v_limits := public.get_tenant_effective_limits(p_tenant_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC), '[]'::jsonb)
  INTO v_payments
  FROM public.saas_payments p
  WHERE p.tenant_id = p_tenant_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC), '[]'::jsonb)
  INTO v_email_logs
  FROM (
    SELECT *
    FROM public.saas_subscription_email_logs
    WHERE tenant_id = p_tenant_id
    ORDER BY created_at DESC
    LIMIT 10
  ) l;

  SELECT COALESCE(jsonb_agg(to_jsonb(cp) ORDER BY cp.monthly_price ASC), '[]'::jsonb)
  INTO v_plans
  FROM public.saas_commercial_plans cp
  WHERE cp.active = true;

  RETURN jsonb_build_object(
    'tenant', to_jsonb(v_tenant),
    'subscription', CASE WHEN v_sub.id IS NOT NULL THEN to_jsonb(v_sub) ELSE NULL END,
    'effective_access', v_limits,
    'payments', v_payments,
    'email_logs', v_email_logs,
    'commercial_plans', v_plans
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. GLOBAL ADMIN RPCs: CHANGE PLAN, CONFIRM/REJECT PAYMENT, MANUAL ACTIVATE,
--    SUSPEND, REACTIVATE, SAVE COMMERCIAL PLAN, FETCH PLATFORM OVERVIEW
-- ----------------------------------------------------------------------------

-- 8.1 admin_change_tenant_plan
CREATE OR REPLACE FUNCTION public.admin_change_tenant_plan(
  p_tenant_id uuid,
  p_new_plan_id text,
  p_reason text,
  p_billing_cycle text DEFAULT 'monthly',
  p_activate_immediately boolean DEFAULT false,
  p_extend_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_email text := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  v_tenant public.tenants%ROWTYPE;
  v_plan public.saas_commercial_plans%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
  v_previous_plan_id text;
  v_previous_status text;
  v_new_tenant_status text;
  v_new_sub_status text;
  v_period_end timestamptz;
  v_amount numeric(10,2);
  v_sub_id text;
  v_audit_id text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores Globais do Tatame Club podem alterar planos de academias.';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Informe uma justificativa administrativa válida (mínimo de 5 caracteres).';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia não encontrada no banco de dados.';
  END IF;

  SELECT * INTO v_plan FROM public.saas_commercial_plans WHERE id = p_new_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano comercial (%) não encontrado.', p_new_plan_id;
  END IF;

  v_previous_plan_id := v_tenant.plan_id;
  v_previous_status := v_tenant.status;

  SELECT * INTO v_sub FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF p_billing_cycle = 'annual' AND COALESCE(v_plan.annual_price, 0) > 0 THEN
    v_amount := v_plan.annual_price;
  ELSIF p_billing_cycle = 'semiannual' THEN
    v_amount := round(v_plan.monthly_price * 6 * 0.90, 2);
  ELSIF p_billing_cycle = 'quarterly' THEN
    v_amount := round(v_plan.monthly_price * 3 * 0.95, 2);
  ELSE
    v_amount := v_plan.monthly_price;
  END IF;

  IF p_new_plan_id = 'trial' THEN
    v_new_tenant_status := 'trial';
    v_new_sub_status := 'trial';
    v_period_end := now() + (GREATEST(COALESCE(p_extend_days, 14), 1) || ' days')::interval;
  ELSIF p_activate_immediately THEN
    v_new_tenant_status := 'active';
    v_new_sub_status := 'active';
    v_period_end := now() + (GREATEST(COALESCE(p_extend_days, 30), 1) || ' days')::interval;
  ELSE
    -- Keep active if already active; if trial is still valid keep trial; otherwise set pending_payment
    IF v_tenant.status = 'active' AND v_sub.status = 'active' THEN
      v_new_tenant_status := 'active';
      v_new_sub_status := 'active';
      v_period_end := COALESCE(v_sub.current_period_end, now() + interval '30 days');
    ELSIF v_tenant.status = 'suspended' THEN
      v_new_tenant_status := 'suspended';
      v_new_sub_status := 'suspended';
      v_period_end := COALESCE(v_sub.current_period_end, now() + interval '30 days');
    ELSE
      v_new_tenant_status := v_tenant.status;
      v_new_sub_status := 'pending_payment';
      v_period_end := COALESCE(v_sub.current_period_end, now() + interval '30 days');
    END IF;
  END IF;

  UPDATE public.tenants
  SET
    plan_id = v_plan.id,
    status = v_new_tenant_status,
    trial_expires_at = CASE WHEN p_new_plan_id = 'trial' THEN v_period_end ELSE trial_expires_at END,
    suspended_at = CASE WHEN v_new_tenant_status = 'active' THEN NULL ELSE suspended_at END,
    suspended_reason = CASE WHEN v_new_tenant_status = 'active' THEN NULL ELSE suspended_reason END,
    updated_at = now()
  WHERE id = p_tenant_id
  RETURNING * INTO v_tenant;

  IF v_sub.id IS NOT NULL THEN
    UPDATE public.saas_subscriptions
    SET
      tenant_name = v_tenant.name,
      plan_id = v_plan.id,
      plan_name = v_plan.name,
      requested_plan_id = v_plan.id,
      requested_billing_cycle = COALESCE(p_billing_cycle, billing_cycle, 'monthly'),
      requested_amount = v_amount,
      billing_cycle = COALESCE(p_billing_cycle, billing_cycle, 'monthly'),
      amount = v_amount,
      status = v_new_sub_status,
      current_period_start = CASE WHEN p_activate_immediately THEN now() ELSE current_period_start END,
      current_period_end = v_period_end,
      trial_expires_at = CASE WHEN p_new_plan_id = 'trial' THEN v_period_end ELSE trial_expires_at END,
      last_payment_confirmed_at = CASE WHEN p_activate_immediately THEN now() ELSE last_payment_confirmed_at END,
      last_payment_confirmed_by = CASE WHEN p_activate_immediately THEN v_caller_id ELSE last_payment_confirmed_by END,
      notes = btrim(p_reason),
      updated_at = now()
    WHERE id = v_sub.id
    RETURNING * INTO v_sub;
  ELSE
    v_sub_id := 'sub-' || substr(replace(p_tenant_id::text, '-', ''), 1, 12);
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
      auto_renew,
      payment_method,
      last_payment_confirmed_at,
      last_payment_confirmed_by,
      notes,
      updated_at
    ) VALUES (
      v_sub_id,
      p_tenant_id,
      v_tenant.name,
      v_plan.id,
      v_plan.name,
      v_plan.id,
      COALESCE(p_billing_cycle, 'monthly'),
      v_amount,
      COALESCE(p_billing_cycle, 'monthly'),
      v_amount,
      v_new_sub_status,
      v_tenant.trial_started_at,
      v_tenant.trial_expires_at,
      now(),
      v_period_end,
      true,
      'pix',
      CASE WHEN p_activate_immediately THEN now() ELSE NULL END,
      CASE WHEN p_activate_immediately THEN v_caller_id ELSE NULL END,
      btrim(p_reason),
      now()
    )
    RETURNING * INTO v_sub;
  END IF;

  v_audit_id := 'paudit-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  INSERT INTO public.platform_audit_logs (
    id,
    actor_user_id,
    actor_user_name,
    tenant_id,
    tenant_name,
    action,
    description,
    metadata,
    created_at
  ) VALUES (
    v_audit_id,
    v_caller_id,
    COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
    v_tenant.id,
    v_tenant.name,
    'change_tenant_plan',
    format(
      'Plano comercial alterado de %s para %s (%s). Ativação imediata: %s. Motivo: %s',
      v_previous_plan_id,
      v_plan.name,
      v_new_sub_status,
      CASE WHEN p_activate_immediately THEN 'Sim' ELSE 'Não' END,
      btrim(p_reason)
    ),
    jsonb_build_object(
      'previous_plan_id', v_previous_plan_id,
      'new_plan_id', v_plan.id,
      'previous_tenant_status', v_previous_status,
      'new_tenant_status', v_new_tenant_status,
      'new_subscription_status', v_new_sub_status,
      'billing_cycle', COALESCE(p_billing_cycle, 'monthly'),
      'activate_immediately', p_activate_immediately,
      'extend_days', p_extend_days,
      'reason', btrim(p_reason)
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'tenant', to_jsonb(v_tenant),
    'subscription', to_jsonb(v_sub),
    'effective_access', public.get_tenant_effective_limits(p_tenant_id)
  );
END;
$$;

-- 8.2 admin_confirm_saas_payment
CREATE OR REPLACE FUNCTION public.admin_confirm_saas_payment(
  p_tenant_id uuid,
  p_payment_id text DEFAULT NULL,
  p_reason text DEFAULT 'Confirmação administrativa de pagamento Pix',
  p_extend_days integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_email text := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  v_tenant public.tenants%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
  v_payment public.saas_payments%ROWTYPE;
  v_plan public.saas_commercial_plans%ROWTYPE;
  v_target_plan_id text;
  v_billing_cycle text;
  v_days integer;
  v_period_end timestamptz;
  v_pay_id text;
  v_audit_id text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores Globais podem confirmar pagamentos de assinaturas.';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Informe uma justificativa ou referência do comprovante (mínimo de 5 caracteres).';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia não encontrada.';
  END IF;

  SELECT * INTO v_sub FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF p_payment_id IS NOT NULL AND btrim(p_payment_id) <> '' THEN
    SELECT * INTO v_payment
    FROM public.saas_payments
    WHERE id = p_payment_id AND tenant_id = p_tenant_id
    FOR UPDATE;
  ELSE
    SELECT * INTO v_payment
    FROM public.saas_payments
    WHERE tenant_id = p_tenant_id AND status IN ('pending', 'under_review')
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  v_target_plan_id := COALESCE(
    v_payment.plan_id,
    v_sub.requested_plan_id,
    NULLIF(v_sub.plan_id, 'trial'),
    NULLIF(v_tenant.plan_id, 'trial'),
    'basic'
  );

  SELECT * INTO v_plan FROM public.saas_commercial_plans WHERE id = v_target_plan_id;
  IF NOT FOUND THEN
    SELECT * INTO v_plan FROM public.saas_commercial_plans WHERE id = 'basic';
  END IF;

  v_billing_cycle := COALESCE(v_payment.billing_cycle, v_sub.requested_billing_cycle, v_sub.billing_cycle, 'monthly');

  IF p_extend_days IS NOT NULL AND p_extend_days > 0 THEN
    v_days := p_extend_days;
  ELSE
    CASE v_billing_cycle
      WHEN 'annual' THEN v_days := 365;
      WHEN 'semiannual' THEN v_days := 180;
      WHEN 'quarterly' THEN v_days := 90;
      ELSE v_days := 30;
    END CASE;
  END IF;

  v_period_end := now() + (v_days || ' days')::interval;

  -- Mark payment as paid (or create a paid record if none was pending)
  IF v_payment.id IS NOT NULL THEN
    UPDATE public.saas_payments
    SET
      status = 'paid',
      paid_at = now(),
      plan_id = v_plan.id,
      plan_name = v_plan.name,
      billing_cycle = v_billing_cycle,
      confirmed_by_user_id = v_caller_id,
      confirmed_by_user_name = COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
      confirmation_notes = btrim(p_reason),
      notes = COALESCE(notes, '') || ' | Confirmado: ' || btrim(p_reason),
      updated_at = now()
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;
  ELSE
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
      status,
      payment_method,
      due_date,
      paid_at,
      confirmed_by_user_id,
      confirmed_by_user_name,
      confirmation_notes,
      reference_id,
      notes,
      created_at,
      updated_at
    ) VALUES (
      v_pay_id,
      COALESCE(v_sub.id, 'sub-' || substr(replace(p_tenant_id::text, '-', ''), 1, 12)),
      p_tenant_id,
      v_tenant.name,
      v_plan.id,
      v_plan.name,
      v_billing_cycle,
      COALESCE(v_sub.requested_amount, v_sub.amount, v_plan.monthly_price),
      'paid',
      'pix',
      now()::date,
      now(),
      v_caller_id,
      COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
      btrim(p_reason),
      upper('TC-CONF-' || to_char(now(), 'YYMMDDHH24MI')),
      btrim(p_reason),
      now(),
      now()
    )
    RETURNING * INTO v_payment;
  END IF;

  -- Update tenant to active and link to confirmed plan
  UPDATE public.tenants
  SET
    plan_id = v_plan.id,
    status = 'active',
    suspended_at = NULL,
    suspended_reason = NULL,
    updated_at = now()
  WHERE id = p_tenant_id
  RETURNING * INTO v_tenant;

  -- Upsert subscription as active
  IF v_sub.id IS NOT NULL THEN
    UPDATE public.saas_subscriptions
    SET
      tenant_name = v_tenant.name,
      plan_id = v_plan.id,
      plan_name = v_plan.name,
      requested_plan_id = v_plan.id,
      requested_billing_cycle = v_billing_cycle,
      billing_cycle = v_billing_cycle,
      amount = v_payment.amount,
      status = 'active',
      current_period_start = now(),
      current_period_end = v_period_end,
      last_payment_confirmed_at = now(),
      last_payment_confirmed_by = v_caller_id,
      notes = btrim(p_reason),
      updated_at = now()
    WHERE id = v_sub.id
    RETURNING * INTO v_sub;
  ELSE
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
      auto_renew,
      payment_method,
      last_payment_confirmed_at,
      last_payment_confirmed_by,
      notes,
      updated_at
    ) VALUES (
      'sub-' || substr(replace(p_tenant_id::text, '-', ''), 1, 12),
      p_tenant_id,
      v_tenant.name,
      v_plan.id,
      v_plan.name,
      v_plan.id,
      v_billing_cycle,
      v_payment.amount,
      v_billing_cycle,
      v_payment.amount,
      'active',
      v_tenant.trial_started_at,
      v_tenant.trial_expires_at,
      now(),
      v_period_end,
      true,
      'pix',
      now(),
      v_caller_id,
      btrim(p_reason),
      now()
    )
    RETURNING * INTO v_sub;
  END IF;

  v_audit_id := 'paudit-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  INSERT INTO public.platform_audit_logs (
    id,
    actor_user_id,
    actor_user_name,
    tenant_id,
    tenant_name,
    action,
    description,
    metadata,
    created_at
  ) VALUES (
    v_audit_id,
    v_caller_id,
    COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
    v_tenant.id,
    v_tenant.name,
    'manual_activate_subscription',
    format('Pagamento Pix confirmado (%s - R$ %s). Assinatura ativada por %s dias no plano %s. Justificativa: %s',
      v_payment.id, v_payment.amount, v_days, v_plan.name, btrim(p_reason)),
    jsonb_build_object(
      'operation', 'confirm_saas_payment',
      'payment_id', v_payment.id,
      'plan_id', v_plan.id,
      'billing_cycle', v_billing_cycle,
      'amount', v_payment.amount,
      'extend_days', v_days,
      'reason', btrim(p_reason)
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'tenant', to_jsonb(v_tenant),
    'subscription', to_jsonb(v_sub),
    'payment', to_jsonb(v_payment),
    'effective_access', public.get_tenant_effective_limits(p_tenant_id)
  );
END;
$$;

-- 8.3 admin_reject_saas_payment
CREATE OR REPLACE FUNCTION public.admin_reject_saas_payment(
  p_tenant_id uuid,
  p_payment_id text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_email text := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  v_tenant public.tenants%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
  v_payment public.saas_payments%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores Globais podem rejeitar pagamentos.';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo da rejeição do pagamento (mínimo de 5 caracteres).';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia não encontrada.';
  END IF;

  UPDATE public.saas_payments
  SET
    status = 'rejected',
    confirmation_notes = btrim(p_reason),
    notes = COALESCE(notes, '') || ' | Rejeitado: ' || btrim(p_reason),
    updated_at = now()
  WHERE id = p_payment_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_payment;

  UPDATE public.saas_subscriptions
  SET
    status = CASE WHEN status = 'active' THEN 'active' ELSE 'rejected' END,
    notes = 'Pagamento rejeitado: ' || btrim(p_reason),
    updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO v_sub;

  INSERT INTO public.platform_audit_logs (
    id,
    actor_user_id,
    actor_user_name,
    tenant_id,
    tenant_name,
    action,
    description,
    metadata,
    created_at
  ) VALUES (
    'paudit-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    v_caller_id,
    COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
    v_tenant.id,
    v_tenant.name,
    'suspend_tenant',
    format('Pagamento %s rejeitado. Motivo: %s', COALESCE(p_payment_id, 'N/A'), btrim(p_reason)),
    jsonb_build_object('operation', 'reject_saas_payment', 'payment_id', p_payment_id, 'reason', btrim(p_reason)),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'tenant', to_jsonb(v_tenant),
    'subscription', to_jsonb(v_sub),
    'payment', to_jsonb(v_payment),
    'effective_access', public.get_tenant_effective_limits(p_tenant_id)
  );
END;
$$;

-- 8.4 admin_manual_activate_subscription
CREATE OR REPLACE FUNCTION public.admin_manual_activate_subscription(
  p_tenant_id uuid,
  p_reason text,
  p_extend_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_email text := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  v_tenant public.tenants%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
  v_plan public.saas_commercial_plans%ROWTYPE;
  v_target_plan_id text;
  v_period_end timestamptz;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores Globais podem ativar licenças manualmente.';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Informe uma justificativa administrativa válida (mínimo de 5 caracteres).';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia não encontrada.';
  END IF;

  SELECT * INTO v_sub FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id FOR UPDATE;

  v_target_plan_id := COALESCE(
    v_sub.requested_plan_id,
    NULLIF(v_sub.plan_id, 'trial'),
    NULLIF(v_tenant.plan_id, 'trial'),
    'basic'
  );

  SELECT * INTO v_plan FROM public.saas_commercial_plans WHERE id = v_target_plan_id;
  IF NOT FOUND THEN
    SELECT * INTO v_plan FROM public.saas_commercial_plans WHERE id = 'basic';
  END IF;

  v_period_end := now() + (GREATEST(COALESCE(p_extend_days, 30), 1) || ' days')::interval;

  UPDATE public.tenants
  SET
    plan_id = v_plan.id,
    status = 'active',
    suspended_at = NULL,
    suspended_reason = NULL,
    updated_at = now()
  WHERE id = p_tenant_id
  RETURNING * INTO v_tenant;

  IF v_sub.id IS NOT NULL THEN
    UPDATE public.saas_subscriptions
    SET
      tenant_name = v_tenant.name,
      plan_id = v_plan.id,
      plan_name = v_plan.name,
      amount = CASE WHEN amount > 0 THEN amount ELSE v_plan.monthly_price END,
      status = 'active',
      current_period_start = now(),
      current_period_end = v_period_end,
      last_payment_confirmed_at = now(),
      last_payment_confirmed_by = v_caller_id,
      notes = btrim(p_reason),
      updated_at = now()
    WHERE id = v_sub.id
    RETURNING * INTO v_sub;
  ELSE
    INSERT INTO public.saas_subscriptions (
      id,
      tenant_id,
      tenant_name,
      plan_id,
      plan_name,
      billing_cycle,
      amount,
      status,
      trial_started_at,
      trial_expires_at,
      current_period_start,
      current_period_end,
      auto_renew,
      payment_method,
      last_payment_confirmed_at,
      last_payment_confirmed_by,
      notes,
      updated_at
    ) VALUES (
      'sub-' || substr(replace(p_tenant_id::text, '-', ''), 1, 12),
      p_tenant_id,
      v_tenant.name,
      v_plan.id,
      v_plan.name,
      'monthly',
      v_plan.monthly_price,
      'active',
      v_tenant.trial_started_at,
      v_tenant.trial_expires_at,
      now(),
      v_period_end,
      true,
      'pix',
      now(),
      v_caller_id,
      btrim(p_reason),
      now()
    )
    RETURNING * INTO v_sub;
  END IF;

  INSERT INTO public.platform_audit_logs (
    id,
    actor_user_id,
    actor_user_name,
    tenant_id,
    tenant_name,
    action,
    description,
    metadata,
    created_at
  ) VALUES (
    'paudit-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    v_caller_id,
    COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
    v_tenant.id,
    v_tenant.name,
    'manual_activate_subscription',
    format('Assinatura ativada/estendida manualmente por %s dias no plano %s. Motivo: %s',
      GREATEST(COALESCE(p_extend_days, 30), 1), v_plan.name, btrim(p_reason)),
    jsonb_build_object(
      'plan_id', v_plan.id,
      'extend_days', GREATEST(COALESCE(p_extend_days, 30), 1),
      'new_period_end', v_period_end,
      'reason', btrim(p_reason)
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'tenant', to_jsonb(v_tenant),
    'subscription', to_jsonb(v_sub),
    'effective_access', public.get_tenant_effective_limits(p_tenant_id)
  );
END;
$$;

-- 8.5 admin_suspend_tenant & admin_reactivate_tenant
CREATE OR REPLACE FUNCTION public.admin_suspend_tenant(
  p_tenant_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_email text := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  v_tenant public.tenants%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores Globais podem suspender academias.';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo da suspensão (mínimo de 5 caracteres).';
  END IF;

  UPDATE public.tenants
  SET
    status = 'suspended',
    suspended_at = now(),
    suspended_reason = btrim(p_reason),
    updated_at = now()
  WHERE id = p_tenant_id
  RETURNING * INTO v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia não encontrada.';
  END IF;

  UPDATE public.saas_subscriptions
  SET
    status = 'suspended',
    notes = 'Suspensa administrativamente: ' || btrim(p_reason),
    updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO v_sub;

  INSERT INTO public.platform_audit_logs (
    id,
    actor_user_id,
    actor_user_name,
    tenant_id,
    tenant_name,
    action,
    description,
    metadata,
    created_at
  ) VALUES (
    'paudit-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    v_caller_id,
    COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
    v_tenant.id,
    v_tenant.name,
    'suspend_tenant',
    format('Academia suspensa administrativamente. Motivo: %s', btrim(p_reason)),
    jsonb_build_object('reason', btrim(p_reason)),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'tenant', to_jsonb(v_tenant),
    'subscription', CASE WHEN v_sub.id IS NOT NULL THEN to_jsonb(v_sub) ELSE NULL END,
    'effective_access', public.get_tenant_effective_limits(p_tenant_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reactivate_tenant(
  p_tenant_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_email text := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  v_tenant public.tenants%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
  v_next_status text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores Globais podem reativar academias.';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Informe a justificativa de reativação (mínimo de 5 caracteres).';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia não encontrada.';
  END IF;

  v_next_status := CASE
    WHEN v_tenant.plan_id = 'trial' AND (v_tenant.trial_expires_at IS NULL OR v_tenant.trial_expires_at >= now()) THEN 'trial'
    ELSE 'active'
  END;

  UPDATE public.tenants
  SET
    status = v_next_status,
    plan_id = CASE WHEN v_next_status = 'active' AND plan_id = 'trial' THEN 'basic' ELSE plan_id END,
    suspended_at = NULL,
    suspended_reason = NULL,
    updated_at = now()
  WHERE id = p_tenant_id
  RETURNING * INTO v_tenant;

  UPDATE public.saas_subscriptions
  SET
    status = v_next_status,
    plan_id = v_tenant.plan_id,
    current_period_end = CASE
      WHEN current_period_end IS NULL OR current_period_end < now() THEN now() + interval '30 days'
      ELSE current_period_end
    END,
    notes = 'Reativada administrativamente: ' || btrim(p_reason),
    updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO v_sub;

  INSERT INTO public.platform_audit_logs (
    id,
    actor_user_id,
    actor_user_name,
    tenant_id,
    tenant_name,
    action,
    description,
    metadata,
    created_at
  ) VALUES (
    'paudit-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    v_caller_id,
    COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
    v_tenant.id,
    v_tenant.name,
    'reactivate_tenant',
    format('Academia reativada administrativamente (%s). Motivo: %s', v_next_status, btrim(p_reason)),
    jsonb_build_object('reason', btrim(p_reason), 'new_status', v_next_status),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'tenant', to_jsonb(v_tenant),
    'subscription', CASE WHEN v_sub.id IS NOT NULL THEN to_jsonb(v_sub) ELSE NULL END,
    'effective_access', public.get_tenant_effective_limits(p_tenant_id)
  );
END;
$$;

-- 8.6 admin_fetch_platform_overview
CREATE OR REPLACE FUNCTION public.admin_fetch_platform_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenants jsonb;
  v_subscriptions jsonb;
  v_plans jsonb;
  v_payments jsonb;
  v_audit_logs jsonb;
  v_email_logs jsonb;
  v_student_counts jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores Globais podem consultar a visão global da plataforma.';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb)
  INTO v_tenants
  FROM public.tenants t;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.updated_at DESC), '[]'::jsonb)
  INTO v_subscriptions
  FROM public.saas_subscriptions s;

  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.monthly_price ASC), '[]'::jsonb)
  INTO v_plans
  FROM public.saas_commercial_plans p;

  SELECT COALESCE(jsonb_agg(to_jsonb(pay) ORDER BY pay.created_at DESC), '[]'::jsonb)
  INTO v_payments
  FROM public.saas_payments pay;

  SELECT COALESCE(jsonb_agg(to_jsonb(al) ORDER BY al.created_at DESC), '[]'::jsonb)
  INTO v_audit_logs
  FROM (
    SELECT *
    FROM public.platform_audit_logs
    ORDER BY created_at DESC
    LIMIT 200
  ) al;

  SELECT COALESCE(jsonb_agg(to_jsonb(el) ORDER BY el.created_at DESC), '[]'::jsonb)
  INTO v_email_logs
  FROM (
    SELECT *
    FROM public.saas_subscription_email_logs
    ORDER BY created_at DESC
    LIMIT 100
  ) el;

  SELECT COALESCE(
    jsonb_object_agg(tenant_id::text, cnt),
    '{}'::jsonb
  )
  INTO v_student_counts
  FROM (
    SELECT tenant_id, count(*)::integer AS cnt
    FROM public.students
    GROUP BY tenant_id
  ) sc;

  RETURN jsonb_build_object(
    'tenants', v_tenants,
    'subscriptions', v_subscriptions,
    'commercial_plans', v_plans,
    'payments', v_payments,
    'audit_logs', v_audit_logs,
    'email_logs', v_email_logs,
    'student_counts', v_student_counts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_saas_plan_subscription(uuid, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_saas_subscription_email_result(uuid, text, text, text, text, text, text, text, numeric, text, boolean, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_subscription_overview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_change_tenant_plan(uuid, text, text, text, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirm_saas_payment(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_saas_payment(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manual_activate_subscription(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_suspend_tenant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_tenant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_fetch_platform_overview() TO authenticated;
