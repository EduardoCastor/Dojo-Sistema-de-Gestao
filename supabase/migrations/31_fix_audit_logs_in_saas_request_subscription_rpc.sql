-- ============================================================================
-- MIGRATION 31: CORREÇÃO DEFINITIVA DE AUDIT_LOGS NA RPC DE SOLICITAÇÃO DE PLANO SAAS
-- ============================================================================
-- Diagnóstico da causa raiz:
-- A função RPC public.request_saas_plan_subscription continha uma instrução de inserção
-- que referenciava as colunas actor_user_id, module, entity_type, description e metadata,
-- incompatíveis com a estrutura real e imutável da tabela public.audit_logs criada
-- na fundação do sistema (migration 01_schema_foundation.sql).
--
-- Estrutura real de public.audit_logs:
--   - id (uuid PRIMARY KEY DEFAULT gen_random_uuid())
--   - tenant_id (uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE)
--   - user_id (uuid REFERENCES auth.users(id) ON DELETE SET NULL)
--   - user_name (text NOT NULL)
--   - action (text NOT NULL)
--   - entity (text NOT NULL)
--   - entity_id (text NOT NULL)
--   - timestamp (timestamptz NOT NULL DEFAULT now())
--   - details (text NOT NULL)
--
-- Esta migration substitui a função public.request_saas_plan_subscription alinhando
-- rigorosamente as colunas de auditoria com a tabela public.audit_logs e recarrega
-- o cache de schema do PostgREST.
-- ============================================================================

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

  -- 5. Calcular valor pelo ciclo de faturamento
  CASE lower(btrim(COALESCE(p_billing_cycle, 'monthly')))
    WHEN 'monthly' THEN
      v_cycle_months := 1;
      v_base_price := v_plan.price;
      v_total_amount := round(v_base_price, 2);
    WHEN 'quarterly' THEN
      v_cycle_months := 3;
      v_base_price := COALESCE(v_plan.price_quarterly, round(v_plan.price * 3 * 0.95, 2));
      v_total_amount := round(v_base_price, 2);
    WHEN 'semiannual' THEN
      v_cycle_months := 6;
      v_base_price := COALESCE(v_plan.price_semiannual, round(v_plan.price * 6 * 0.90, 2));
      v_total_amount := round(v_base_price, 2);
    WHEN 'annual' THEN
      v_cycle_months := 12;
      v_base_price := COALESCE(v_plan.price_annual, round(v_plan.price * 12 * 0.85, 2));
      v_total_amount := round(v_base_price, 2);
    ELSE
      RAISE EXCEPTION 'Ciclo de faturamento inválido: %. Permitidos: monthly, quarterly, semiannual, annual.', p_billing_cycle;
  END CASE;

  v_recipient_email := lower(btrim(COALESCE(p_payer_email, v_tenant.email, '')));
  IF v_recipient_email = '' OR position('@' in v_recipient_email) = 0 THEN
    v_recipient_email := COALESCE(auth.jwt() ->> 'email', 'financeiro@' || lower(replace(v_tenant_display_name, ' ', '')) || '.com.br');
  END IF;

  -- 6. Upsert na tabela saas_subscriptions para a academia
  SELECT * INTO v_sub FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF FOUND THEN
    v_sub_id := v_sub.id;
    UPDATE public.saas_subscriptions
    SET
      tenant_name = v_tenant_display_name,
      requested_plan_id = v_plan.id,
      requested_plan_name = v_plan.name,
      requested_billing_cycle = p_billing_cycle,
      requested_amount = v_total_amount,
      plan_name = COALESCE(v_sub.plan_name, v_plan.name),
      billing_cycle = p_billing_cycle,
      amount = v_total_amount,
      payment_method = 'pix',
      payment_requested_at = now(),
      status = CASE
        WHEN v_sub.status = 'active' THEN 'active'
        ELSE 'pending_payment'
      END,
      notes = COALESCE(p_notes, v_sub.notes, 'Solicitação de contratação via Pix registrada.'),
      updated_at = now()
    WHERE id = v_sub.id
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
      requested_plan_name,
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
      v_plan.name,
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

  -- 7. Idempotência estrita: verificar se já existe cobrança pendente idêntica
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
      pix_key = COALESCE(p_pix_key, pix_key, '28410730000180'),
      is_provisional_pix_key = true,
      due_date = GREATEST(due_date, (CURRENT_DATE + interval '3 days')),
      updated_at = now()
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;
  ELSE
    v_pay_id := 'spay-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    INSERT INTO public.saas_payments (
      id,
      subscription_id,
      tenant_id,
      plan_id,
      plan_name,
      billing_cycle,
      amount,
      due_date,
      status,
      payment_method,
      payer_email,
      pix_key,
      is_provisional_pix_key,
      reference_id,
      notes,
      created_at,
      updated_at
    ) VALUES (
      v_pay_id,
      v_sub.id,
      p_tenant_id,
      v_plan.id,
      v_plan.name,
      p_billing_cycle,
      v_total_amount,
      (CURRENT_DATE + interval '3 days'),
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

  -- 8. Registrar auditoria no histórico do tenant com as colunas reais de public.audit_logs
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

-- Permissão de execução para usuários autenticados
GRANT EXECUTE ON FUNCTION public.request_saas_plan_subscription(uuid, text, text, text, text, text) TO authenticated;

-- Notificar o PostgREST para recarregar o cache de schemas imediatamente
NOTIFY pgrst, 'reload schema';
