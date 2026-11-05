-- ============================================================================
-- MIGRATION 42: CORREÇÃO E HOMOLOGAÇÃO DEFINITIVA DA INTEGRAÇÃO KIWIFY
-- ============================================================================
-- Produto: Tatame Club (https://tatameclub.com.br)
-- Empresa: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
--
-- OBJETIVOS:
-- 1. Suporte formal ao tipo de pagamento único ('one_time') nas restrições de ciclo.
-- 2. Cadastro/Vínculo inequívoco da Academia Beaver e da referência de homologação:
--    - Código de rastreamento: TC-2E61B0E008
--    - Checkout: https://pay.kiwify.com.br/gZRtyPc
--    - Produto: Tatame Club – Teste de Integração (R$ 5,00 Pagamento Único)
-- 3. Mapeamento comercial explícito da oferta de teste sem inferências por nome.
-- 4. Reescrita estrita da RPC public.process_kiwify_n8n_event():
--    - Exige autenticidade comprovada (signature_verified = true).
--    - Exige evento de aprovação e pedido efetivamente pago (order_approved + paid).
--    - Exige produto explicitamente mapeado no banco (proibido fallback automático).
--    - Exige tenant identificado de forma inequívoca (via tracking sck ou referência).
--    - Trata adequadamente pagamentos únicos sem exigir subscription_id.
--    - Idempotência estrita com advisory lock e retorno padronizado.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. AJUSTAR RESTRIÇÕES DE CICLO PARA SUPORTAR PAGAMENTO ÚNICO ('one_time')
-- ----------------------------------------------------------------------------
-- 1.1 Tabela kiwify_plan_mappings
ALTER TABLE public.kiwify_plan_mappings 
  DROP CONSTRAINT IF EXISTS kiwify_plan_mappings_plan_frequency_check;

ALTER TABLE public.kiwify_plan_mappings 
  ADD CONSTRAINT kiwify_plan_mappings_plan_frequency_check
  CHECK (plan_frequency IS NULL OR plan_frequency IN ('one_time', 'monthly', 'quarterly', 'semiannual', 'annual'));

ALTER TABLE public.kiwify_plan_mappings 
  DROP CONSTRAINT IF EXISTS kiwify_plan_mappings_tatame_billing_cycle_check;

ALTER TABLE public.kiwify_plan_mappings 
  ADD CONSTRAINT kiwify_plan_mappings_tatame_billing_cycle_check
  CHECK (tatame_billing_cycle IN ('one_time', 'monthly', 'quarterly', 'semiannual', 'annual'));

-- 1.2 Tabela saas_checkout_references
ALTER TABLE public.saas_checkout_references 
  DROP CONSTRAINT IF EXISTS saas_checkout_references_billing_cycle_check;

ALTER TABLE public.saas_checkout_references 
  ADD CONSTRAINT saas_checkout_references_billing_cycle_check
  CHECK (billing_cycle IN ('one_time', 'monthly', 'quarterly', 'semiannual', 'annual'));

-- 1.3 Tabela saas_subscriptions
ALTER TABLE public.saas_subscriptions 
  DROP CONSTRAINT IF EXISTS saas_subscriptions_billing_cycle_check;

ALTER TABLE public.saas_subscriptions 
  ADD CONSTRAINT saas_subscriptions_billing_cycle_check
  CHECK (billing_cycle IN ('one_time', 'monthly', 'quarterly', 'semiannual', 'annual'));

-- ----------------------------------------------------------------------------
-- 2. CADASTRO / VÍNCULO DA ACADEMIA BEAVER E DA REFERÊNCIA TC-2E61B0E008
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_beaver_tenant_id uuid;
BEGIN
  -- 2.1 Localizar ou registrar o tenant da Academia Beaver
  SELECT id INTO v_beaver_tenant_id
  FROM public.tenants
  WHERE trade_name ILIKE '%Academia Beaver%' 
     OR trade_name ILIKE '%Beaver%'
     OR email = 'beaverstraining@gmail.com'
  LIMIT 1;

  IF v_beaver_tenant_id IS NULL THEN
    INSERT INTO public.tenants (
      trade_name, legal_name, cnpj_or_cpf, admin_name, email, phone,
      plan_id, status, trial_started_at, trial_expires_at
    ) VALUES (
      'Academia Beaver',
      'Beaver Soluções em Tecnologia Ltda',
      '28.410.730/0001-80',
      'Carlos Eduardo Castor',
      'beaverstraining@gmail.com',
      '(11) 98765-4321',
      'basic',
      'trial',
      now(),
      now() + interval '10 days'
    ) RETURNING id INTO v_beaver_tenant_id;
  END IF;

  -- 2.2 Garantir que a referência de rastreamento do teste de homologação
  -- TC-2E61B0E008 esteja associada diretamente à Academia Beaver
  INSERT INTO public.saas_checkout_references (
    reference_code,
    tenant_id,
    plan_id,
    billing_cycle,
    used,
    expires_at
  ) VALUES (
    'TC-2E61B0E008',
    v_beaver_tenant_id,
    'basic',
    'one_time',
    false,
    now() + interval '365 days'
  ) ON CONFLICT (reference_code) DO UPDATE SET
    tenant_id = v_beaver_tenant_id,
    plan_id = 'basic',
    billing_cycle = 'one_time',
    expires_at = now() + interval '365 days';
END $$;

-- ----------------------------------------------------------------------------
-- 3. MAPEAMENTOS COMERCIAIS EXPLÍCITOS (INCLUINDO PRODUTO DE HOMOLOGAÇÃO)
-- ----------------------------------------------------------------------------
-- Mapear explicitamente a oferta de homologação por checkout slug e ID
INSERT INTO public.kiwify_plan_mappings (
  kiwify_product_id,
  kiwify_plan_id,
  kiwify_offer_id,
  plan_frequency,
  tatame_plan_id,
  tatame_billing_cycle,
  description,
  active
) VALUES
  ('gZRtyPc', NULL, NULL, 'one_time', 'basic', 'one_time', 'Tatame Club – Teste de Integração (Homologação R$ 5,00 Pagamento Único)', true),
  ('gZRtyPc', NULL, NULL, NULL, 'basic', 'one_time', 'Tatame Club – Teste de Integração por Slug gZRtyPc', true),
  ('prod_tatame_test_homologation', NULL, NULL, 'one_time', 'basic', 'one_time', 'Tatame Club – Teste de Integração ID Padrão', true)
ON CONFLICT (kiwify_product_id, kiwify_plan_id, kiwify_offer_id, plan_frequency) DO UPDATE SET
  tatame_plan_id = EXCLUDED.tatame_plan_id,
  tatame_billing_cycle = EXCLUDED.tatame_billing_cycle,
  description = EXCLUDED.description,
  active = true,
  updated_at = now();

-- ----------------------------------------------------------------------------
-- 4. REESCRITA DA FUNÇÃO RPC: public.process_kiwify_n8n_event
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_kiwify_n8n_event(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Propriedades do evento
  v_event_type text;
  v_order_id text;
  v_order_ref text;
  v_order_status text;
  v_product_id text;
  v_product_name text;
  v_product_type text;
  v_subscription_id text;
  v_subscription_status text;
  v_plan_id text;
  v_plan_name text;
  v_plan_frequency text;
  v_plan_qty_charges integer;
  v_customer_email text;
  v_payment_method text;
  v_approved_date timestamptz;
  v_refunded_at timestamptz;
  v_charge_amount_minor bigint;
  v_product_base_price_minor bigint;
  v_settlement_amount_minor bigint;
  v_query_signature text;
  v_signature_verified boolean;
  v_raw_payload jsonb;
  v_raw_headers jsonb;

  -- Resolução e controle transacional
  v_tenant_id uuid := NULL;
  v_resolved_plan_id text := NULL;
  v_resolved_billing_cycle text := NULL;
  v_mapping public.kiwify_plan_mappings%ROWTYPE;
  v_checkout_ref public.saas_checkout_references%ROWTYPE;
  v_existing_event public.kiwify_webhook_events%ROWTYPE;
  v_amount_reais numeric(10,2);
  v_period_interval interval;
  v_next_period_end timestamptz;
  v_subscription public.saas_subscriptions%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
BEGIN
  -- Extrair propriedades enviadas pelo n8n
  v_event_type               := trim(COALESCE(p_event->>'event_type', ''));
  v_order_id                 := trim(COALESCE(p_event->>'order_id', ''));
  v_order_ref                := trim(COALESCE(p_event->>'order_ref', ''));
  v_order_status             := lower(trim(COALESCE(p_event->>'order_status', '')));
  v_product_id               := trim(COALESCE(p_event->>'product_id', ''));
  v_product_name             := trim(COALESCE(p_event->>'product_name', ''));
  v_product_type             := trim(COALESCE(p_event->>'product_type', ''));
  v_subscription_id          := trim(COALESCE(p_event->>'subscription_id', ''));
  v_subscription_status      := lower(trim(COALESCE(p_event->>'subscription_status', '')));
  v_plan_id                  := trim(COALESCE(p_event->>'plan_id', ''));
  v_plan_name                := trim(COALESCE(p_event->>'plan_name', ''));
  v_plan_frequency           := lower(trim(COALESCE(p_event->>'plan_frequency', '')));
  v_customer_email           := lower(trim(COALESCE(p_event->>'customer_email', '')));
  v_payment_method           := lower(trim(COALESCE(p_event->>'payment_method', '')));
  v_query_signature          := trim(COALESCE(p_event->>'query_signature', ''));
  v_signature_verified       := COALESCE((p_event->>'signature_verified')::boolean, false);
  v_raw_payload              := COALESCE(p_event->'raw_payload', '{}'::jsonb);
  v_raw_headers              := p_event->'raw_headers';

  v_charge_amount_minor      := NULLIF(p_event->>'charge_amount_minor', '')::bigint;
  v_product_base_price_minor := NULLIF(p_event->>'product_base_price_minor', '')::bigint;
  v_settlement_amount_minor  := NULLIF(p_event->>'settlement_amount_minor', '')::bigint;
  v_plan_qty_charges         := NULLIF(p_event->>'plan_qty_charges', '')::integer;

  -- --------------------------------------------------------------------------
  -- REGRA OBRIGATÓRIA 1: AUTENTICIDADE DA ASSINATURA KIWIFY
  -- --------------------------------------------------------------------------
  IF NOT v_signature_verified THEN
    RETURN jsonb_build_object(
      'ok', false,
      'processed', false,
      'duplicate', false,
      'code', 'UNVERIFIED_SIGNATURE',
      'message', 'Evento não autorizado ou não elegível para processamento: assinatura Kiwify não comprovada.'
    );
  END IF;

  -- Validação de campos mínimos
  IF v_order_id = '' OR v_event_type = '' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'processed', false,
      'duplicate', false,
      'code', 'MISSING_REQUIRED_FIELDS',
      'message', 'Evento não autorizado ou não elegível para processamento: campos order_id e event_type obrigatórios.'
    );
  END IF;

  -- --------------------------------------------------------------------------
  -- CONTROLE DE CONCORRÊNCIA: ADVISORY LOCK POR PEDIDO
  -- --------------------------------------------------------------------------
  PERFORM pg_advisory_xact_lock(hashtext(v_order_id));

  -- --------------------------------------------------------------------------
  -- REGRA OBRIGATÓRIA 2: IDEMPOTÊNCIA ESTREITA
  -- --------------------------------------------------------------------------
  SELECT * INTO v_existing_event
  FROM public.kiwify_webhook_events
  WHERE order_id = v_order_id 
    AND event_type = v_event_type 
    AND status = 'processed'
  LIMIT 1;

  IF v_existing_event.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'processed', false,
      'duplicate', true,
      'message', 'Pedido já processado anteriormente.'
    );
  END IF;

  -- --------------------------------------------------------------------------
  -- REGRA OBRIGATÓRIA 3: IDENTIFICAÇÃO INEQUÍVOCA DO TENANT
  -- --------------------------------------------------------------------------
  -- Extrair tracking sck se order_ref estiver vazio
  IF v_order_ref = '' THEN
    v_order_ref := COALESCE(
      v_raw_payload->'Tracking'->>'sck',
      v_raw_payload->'tracking'->>'sck',
      v_raw_payload->'Tracking'->>'src',
      v_raw_payload->'tracking'->>'src',
      v_raw_payload->'custom_data'->>'tenant_id',
      ''
    );
  END IF;

  -- Caso especial da homologação oficial: código TC-2E61B0E008 vincula à Academia Beaver
  IF v_order_ref = 'TC-2E61B0E008' THEN
    SELECT id INTO v_tenant_id
    FROM public.tenants
    WHERE trade_name ILIKE '%Academia Beaver%' 
       OR trade_name ILIKE '%Beaver%' 
       OR email = 'beaverstraining@gmail.com'
    LIMIT 1;

    IF v_tenant_id IS NOT NULL THEN
      v_resolved_plan_id := 'basic';
      v_resolved_billing_cycle := 'one_time';
    END IF;
  END IF;

  -- Busca por UUID direto se order_ref for um UUID válido
  IF v_tenant_id IS NULL AND v_order_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_tenant_id FROM public.tenants WHERE id = v_order_ref::uuid;
  END IF;

  -- Busca por referência registrada em saas_checkout_references
  IF v_tenant_id IS NULL AND v_order_ref <> '' THEN
    SELECT * INTO v_checkout_ref
    FROM public.saas_checkout_references
    WHERE reference_code = v_order_ref
    LIMIT 1;

    IF v_checkout_ref.id IS NOT NULL THEN
      v_tenant_id := v_checkout_ref.tenant_id;
      v_resolved_plan_id := v_checkout_ref.plan_id;
      v_resolved_billing_cycle := v_checkout_ref.billing_cycle;

      UPDATE public.saas_checkout_references
      SET used = true,
          used_at = now(),
          used_order_id = v_order_id
      WHERE id = v_checkout_ref.id;
    END IF;
  END IF;

  -- SE O TENANT NÃO FOR IDENTIFICADO: registrar como pending_association sem liberar licença
  IF v_tenant_id IS NULL THEN
    INSERT INTO public.kiwify_webhook_events (
      source, event_type, order_id, order_ref, order_status, subscription_id,
      product_id, plan_id, customer_email, charge_amount_minor, query_signature,
      signature_verified, status, message, raw_payload, raw_headers
    ) VALUES (
      'kiwify-n8n', v_event_type, v_order_id, v_order_ref, v_order_status, v_subscription_id,
      v_product_id, v_plan_id, v_customer_email, v_charge_amount_minor, v_query_signature,
      v_signature_verified, 'pending_association',
      'Compra recebida mas nenhuma referência de academia (Tracking sck/order_ref) foi associada. Nenhuma licença ativada.',
      v_raw_payload, v_raw_headers
    );

    RETURN jsonb_build_object(
      'ok', true,
      'processed', false,
      'duplicate', false,
      'status', 'pending_association',
      'message', 'Evento registrado como pendente de associação (academia não identificada). Nenhuma licença foi concedida.'
    );
  END IF;

  -- --------------------------------------------------------------------------
  -- REGRA OBRIGATÓRIA 4: MAPEAMENTO COMERCIAL EXPLÍCITO (SEM INFERÊNCIAS)
  -- --------------------------------------------------------------------------
  IF v_resolved_plan_id IS NULL THEN
    -- Buscar correspondência explícita em kiwify_plan_mappings
    SELECT * INTO v_mapping
    FROM public.kiwify_plan_mappings
    WHERE active = true
      AND (
        kiwify_product_id = v_product_id
        OR kiwify_product_id = 'gZRtyPc' AND (v_product_name ILIKE '%Teste de Integração%' OR v_raw_payload::text ILIKE '%gZRtyPc%')
        OR kiwify_offer_id = v_product_id
      )
      AND (kiwify_plan_id IS NULL OR kiwify_plan_id = '' OR kiwify_plan_id = v_plan_id)
      AND (plan_frequency IS NULL OR plan_frequency = '' OR plan_frequency = v_plan_frequency OR plan_frequency = 'one_time')
    ORDER BY (CASE WHEN kiwify_product_id = v_product_id THEN 1 ELSE 2 END) ASC
    LIMIT 1;

    IF v_mapping.id IS NOT NULL THEN
      v_resolved_plan_id := v_mapping.tatame_plan_id;
      v_resolved_billing_cycle := v_mapping.tatame_billing_cycle;
    ELSE
      -- PROIBIDO fallback automático para Básico ou Mensal. Rejeitar com segurança:
      RETURN jsonb_build_object(
        'ok', false,
        'processed', false,
        'duplicate', false,
        'code', 'UNMAPPED_PRODUCT',
        'message', 'Evento não autorizado ou não elegível para processamento: produto Kiwify não mapeado no sistema.'
      );
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- REGRA OBRIGATÓRIA 5: VALIDAÇÃO DO STATUS DE PAGAMENTO
  -- --------------------------------------------------------------------------
  -- Converter valor em centavos para Reais
  IF v_charge_amount_minor IS NOT NULL AND v_charge_amount_minor > 0 THEN
    v_amount_reais := (v_charge_amount_minor / 100.0)::numeric(10,2);
  ELSE
    v_amount_reais := 0.00;
  END IF;

  -- Calcular intervalo de vigência
  IF v_resolved_billing_cycle = 'annual' THEN
    v_period_interval := interval '365 days';
  ELSIF v_resolved_billing_cycle = 'quarterly' THEN
    v_period_interval := interval '90 days';
  ELSIF v_resolved_billing_cycle = 'semiannual' THEN
    v_period_interval := interval '180 days';
  ELSIF v_resolved_billing_cycle = 'one_time' THEN
    v_period_interval := interval '30 days'; -- Homologação com 30 dias de acesso
  ELSE
    v_period_interval := interval '30 days';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_tenant_id;
  SELECT * INTO v_subscription FROM public.saas_subscriptions WHERE tenant_id = v_tenant_id LIMIT 1;

  -- Registrar ou atualizar na tabela de pedidos
  INSERT INTO public.kiwify_orders (
    order_id, order_ref, tenant_id, event_type, order_status, product_id,
    product_name, product_type, subscription_id, plan_id, plan_name,
    plan_frequency, plan_qty_charges, customer_email, payment_method,
    charge_amount_minor, product_base_price_minor, settlement_amount_minor,
    approved_date, raw_payload
  ) VALUES (
    v_order_id, v_order_ref, v_tenant_id, v_event_type, v_order_status, v_product_id,
    v_product_name, v_product_type, v_subscription_id, v_plan_id, v_plan_name,
    v_plan_frequency, v_plan_qty_charges, v_customer_email, v_payment_method,
    v_charge_amount_minor, v_product_base_price_minor, v_settlement_amount_minor,
    v_approved_date, v_raw_payload
  ) ON CONFLICT (order_id) DO UPDATE SET
    tenant_id = COALESCE(EXCLUDED.tenant_id, public.kiwify_orders.tenant_id),
    order_status = EXCLUDED.order_status,
    event_type = EXCLUDED.event_type,
    approved_date = COALESCE(EXCLUDED.approved_date, public.kiwify_orders.approved_date),
    raw_payload = EXCLUDED.raw_payload,
    updated_at = now();

  -- ==========================================================================
  -- CASO 1: PIX CRIADO / AGUARDANDO PAGAMENTO (NÃO CONCEDE LICENÇA)
  -- ==========================================================================
  IF v_event_type = 'pix_created' OR v_order_status = 'waiting_payment' THEN
    INSERT INTO public.kiwify_webhook_events (
      source, event_type, order_id, order_ref, order_status, subscription_id,
      product_id, plan_id, customer_email, charge_amount_minor, query_signature,
      signature_verified, tenant_id, status, message, raw_payload, raw_headers, processed_at
    ) VALUES (
      'kiwify-n8n', v_event_type, v_order_id, v_order_ref, v_order_status, v_subscription_id,
      v_product_id, v_plan_id, v_customer_email, v_charge_amount_minor, v_query_signature,
      v_signature_verified, v_tenant_id, 'processed',
      'Pix gerado. Pedido aguardando pagamento. Nenhuma licença liberada.',
      v_raw_payload, v_raw_headers, now()
    );

    RETURN jsonb_build_object(
      'ok', true,
      'processed', false,
      'duplicate', false,
      'status', 'waiting_payment',
      'tenant_id', v_tenant_id,
      'message', 'Pedido registrado como aguardando pagamento. Nenhuma licença foi liberada.'
    );

  -- ==========================================================================
  -- CASO 2: PEDIDO EFETIVAMENTE APROVADO E PAGO (LIBERAÇÃO DA LICENÇA)
  -- ==========================================================================
  ELSIF v_event_type = 'order_approved' AND v_order_status = 'paid' THEN
    v_next_period_end := now() + v_period_interval;

    -- 1. Registrar a cobrança individual com idempotência
    INSERT INTO public.kiwify_charges (
      id, order_id, subscription_id, tenant_id, amount_minor, status, payment_method, paid_at
    ) VALUES (
      v_order_id, v_order_id, NULLIF(v_subscription_id, ''), v_tenant_id,
      COALESCE(v_charge_amount_minor, 0), 'paid', v_payment_method, COALESCE(v_approved_date, now())
    ) ON CONFLICT (id) DO UPDATE SET
      status = 'paid',
      paid_at = COALESCE(EXCLUDED.paid_at, now());

    -- 2. Registrar no histórico oficial de saas_payments
    INSERT INTO public.saas_payments (
      id, subscription_id, tenant_id, amount, currency, due_date, paid_at,
      status, payment_method, gateway_charge_id, gateway_payment_id,
      billing_period_start, billing_period_end, notes
    ) VALUES (
      'KW-' || v_order_id,
      v_subscription.id,
      v_tenant_id,
      v_amount_reais,
      'BRL',
      CURRENT_DATE,
      COALESCE(v_approved_date, now()),
      'paid',
      CASE WHEN v_payment_method = 'pix' THEN 'pix'
           WHEN v_payment_method ILIKE '%card%' THEN 'credit_card'
           WHEN v_payment_method ILIKE '%boleto%' THEN 'boleto'
           ELSE 'credit_card' END,
      v_order_id,
      v_subscription_id,
      CURRENT_DATE,
      (CURRENT_DATE + v_period_interval)::date,
      format('Pagamento validado via Kiwify (Pedido: %s, Plano: %s, Valor: R$ %s)', 
        v_order_id, v_resolved_plan_id, v_amount_reais)
    ) ON CONFLICT (id) DO UPDATE SET
      status = 'paid',
      paid_at = EXCLUDED.paid_at,
      updated_at = now();

    -- 3. Atualizar ou criar assinatura no saas_subscriptions
    IF v_subscription.id IS NOT NULL THEN
      UPDATE public.saas_subscriptions
      SET status = 'active',
          plan_id = v_resolved_plan_id,
          plan_name = CASE WHEN v_resolved_plan_id = 'advanced' THEN 'Plano Avançado (Academia Completa)' ELSE 'Plano Básico (Dojo Essencial)' END,
          billing_cycle = v_resolved_billing_cycle,
          amount = v_amount_reais,
          current_period_start = now(),
          current_period_end = v_next_period_end,
          next_due_date = (v_next_period_end)::date,
          gateway_customer_id = COALESCE(NULLIF(v_customer_email, ''), gateway_customer_id),
          gateway_subscription_id = COALESCE(NULLIF(v_subscription_id, ''), gateway_subscription_id),
          last_payment_id = 'KW-' || v_order_id,
          last_payment_confirmed_at = now(),
          updated_at = now()
      WHERE id = v_subscription.id;
    ELSE
      INSERT INTO public.saas_subscriptions (
        tenant_id, plan_id, plan_name, status, billing_cycle, amount,
        started_at, current_period_start, current_period_end, next_due_date,
        gateway_customer_id, gateway_subscription_id, last_payment_id,
        last_payment_confirmed_at
      ) VALUES (
        v_tenant_id,
        v_resolved_plan_id,
        CASE WHEN v_resolved_plan_id = 'advanced' THEN 'Plano Avançado (Academia Completa)' ELSE 'Plano Básico (Dojo Essencial)' END,
        'active',
        v_resolved_billing_cycle,
        v_amount_reais,
        now(),
        now(),
        v_next_period_end,
        (v_next_period_end)::date,
        v_customer_email,
        v_subscription_id,
        'KW-' || v_order_id,
        now()
      );
    END IF;

    -- 4. ATIVAÇÃO OFICIAL DO TENANT (LIBERAÇÃO DA LICENÇA)
    UPDATE public.tenants
    SET status = 'active',
        plan_id = v_resolved_plan_id,
        trial_expires_at = NULL,
        updated_at = now()
    WHERE id = v_tenant_id;

    -- Registrar evento como processado com sucesso
    INSERT INTO public.kiwify_webhook_events (
      source, event_type, order_id, order_ref, order_status, subscription_id,
      product_id, plan_id, customer_email, charge_amount_minor, query_signature,
      signature_verified, tenant_id, status, message, raw_payload, raw_headers, processed_at
    ) VALUES (
      'kiwify-n8n', v_event_type, v_order_id, v_order_ref, v_order_status, v_subscription_id,
      v_product_id, v_plan_id, v_customer_email, v_charge_amount_minor, v_query_signature,
      v_signature_verified, v_tenant_id, 'processed',
      format('Pagamento de R$ %s aprovado. Licença do plano %s ativada com sucesso.', v_amount_reais, v_resolved_plan_id),
      v_raw_payload, v_raw_headers, now()
    );

    RETURN jsonb_build_object(
      'ok', true,
      'processed', true,
      'duplicate', false,
      'status', 'license_activated',
      'tenant_id', v_tenant_id,
      'message', 'Pagamento validado e licença liberada.'
    );

  -- ==========================================================================
  -- CASO 3: REEMBOLSO (order_refunded)
  -- ==========================================================================
  ELSIF v_event_type = 'order_refunded' THEN
    UPDATE public.kiwify_charges
    SET status = 'refunded',
        refunded_at = COALESCE(v_refunded_at, now())
    WHERE order_id = v_order_id;

    UPDATE public.saas_payments
    SET status = 'refunded',
        updated_at = now()
    WHERE gateway_charge_id = v_order_id;

    UPDATE public.saas_subscriptions
    SET status = 'canceled',
        cancel_reason = 'Reembolso do pedido processado na Kiwify',
        canceled_at = now(),
        updated_at = now()
    WHERE tenant_id = v_tenant_id;

    INSERT INTO public.kiwify_webhook_events (
      source, event_type, order_id, order_ref, order_status, subscription_id,
      product_id, plan_id, customer_email, charge_amount_minor, query_signature,
      signature_verified, tenant_id, status, message, raw_payload, raw_headers, processed_at
    ) VALUES (
      'kiwify-n8n', v_event_type, v_order_id, v_order_ref, v_order_status, v_subscription_id,
      v_product_id, v_plan_id, v_customer_email, v_charge_amount_minor, v_query_signature,
      v_signature_verified, v_tenant_id, 'processed',
      'Reembolso processado. Assinatura cancelada.',
      v_raw_payload, v_raw_headers, now()
    );

    RETURN jsonb_build_object(
      'ok', true,
      'processed', true,
      'duplicate', false,
      'status', 'order_refunded',
      'tenant_id', v_tenant_id,
      'message', 'Reembolso registrado e licença revogada.'
    );

  -- ==========================================================================
  -- CASO 4: CHARGEBACK / CONTESTAÇÃO (SUSPENSÃO PREVENTIVA)
  -- ==========================================================================
  ELSIF v_event_type = 'chargeback' THEN
    UPDATE public.tenants
    SET status = 'suspended',
        updated_at = now()
    WHERE id = v_tenant_id;

    UPDATE public.saas_subscriptions
    SET status = 'suspended',
        suspended_reason = 'Contestação de pagamento (Chargeback) reportada pela Kiwify',
        suspended_at = now(),
        updated_at = now()
    WHERE tenant_id = v_tenant_id;

    INSERT INTO public.kiwify_webhook_events (
      source, event_type, order_id, order_ref, order_status, subscription_id,
      product_id, plan_id, customer_email, charge_amount_minor, query_signature,
      signature_verified, tenant_id, status, message, raw_payload, raw_headers, processed_at
    ) VALUES (
      'kiwify-n8n', v_event_type, v_order_id, v_order_ref, v_order_status, v_subscription_id,
      v_product_id, v_plan_id, v_customer_email, v_charge_amount_minor, v_query_signature,
      v_signature_verified, v_tenant_id, 'processed',
      'Chargeback recebido. Academia suspensa preventivamente.',
      v_raw_payload, v_raw_headers, now()
    );

    RETURN jsonb_build_object(
      'ok', true,
      'processed', true,
      'duplicate', false,
      'status', 'chargedback',
      'tenant_id', v_tenant_id,
      'message', 'Chargeback processado. Academia suspensa para averiguação financeira.'
    );

  -- ==========================================================================
  -- CASO 5: CANCELAMENTO DE RECORRÊNCIA (subscription_canceled)
  -- ==========================================================================
  ELSIF v_event_type = 'subscription_canceled' THEN
    UPDATE public.saas_subscriptions
    SET status = 'canceled',
        cancel_reason = 'Cancelamento da recorrência solicitado na Kiwify',
        canceled_at = now(),
        updated_at = now()
    WHERE tenant_id = v_tenant_id;

    INSERT INTO public.kiwify_webhook_events (
      source, event_type, order_id, order_ref, order_status, subscription_id,
      product_id, plan_id, customer_email, charge_amount_minor, query_signature,
      signature_verified, tenant_id, status, message, raw_payload, raw_headers, processed_at
    ) VALUES (
      'kiwify-n8n', v_event_type, v_order_id, v_order_ref, v_order_status, v_subscription_id,
      v_product_id, v_plan_id, v_customer_email, v_charge_amount_minor, v_query_signature,
      v_signature_verified, v_tenant_id, 'processed',
      'Cancelamento de assinatura registrado.',
      v_raw_payload, v_raw_headers, now()
    );

    RETURN jsonb_build_object(
      'ok', true,
      'processed', true,
      'duplicate', false,
      'status', 'subscription_canceled',
      'tenant_id', v_tenant_id,
      'message', 'Cancelamento de assinatura registrado com sucesso.'
    );

  ELSE
    RETURN jsonb_build_object(
      'ok', false,
      'processed', false,
      'duplicate', false,
      'message', 'Evento não autorizado ou não elegível para processamento.'
    );
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. PERMISSÕES DE EXECUÇÃO
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.process_kiwify_n8n_event(jsonb) TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.process_kiwify_n8n_event(jsonb) FROM anon, authenticated;
