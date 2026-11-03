-- ============================================================================
-- MIGRATION 41: INTEGRAÇÃO KIWIFY VIA WORKFLOW N8N — PAGAMENTOS E ASSINATURAS SAAS
-- ============================================================================
-- Produto: Tatame Club (https://tatameclub.com.br)
-- Empresa: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
--
-- OBJETIVO:
-- 1. Criar estrutura de mapeamento comercial Kiwify -> Planos Internos Tatame Club
--    (Básico Mensal/Trimestral/Anual, Avançado Mensal/Trimestral/Anual).
-- 2. Criar tabela de referências seguras de checkout (Tracking sck) associadas
--    aos tenants para impedir atribuição arbitrária ou errônea de pagamentos.
-- 3. Criar tabelas de auditoria e persistência de pedidos e cobranças Kiwify:
--    - public.kiwify_webhook_events (idempotência e histórico bruto do n8n)
--    - public.kiwify_orders (pedidos normalizados com status, produto, comprador)
--    - public.kiwify_charges (cobranças individuais com idempotência por cobrança)
-- 4. Função RPC transacional public.process_kiwify_n8n_event() para execução atômica
--    com advisory locks, atualização de saas_subscriptions, saas_payments e tenants.
-- 5. Função RPC public.create_saas_checkout_reference() para gerar URLs de checkout
--    oficiais com sck rastreável.
-- 6. Políticas de RLS estritas com proteção multi-tenant e isolamento da plataforma.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABELA DE MAPEAMENTO COMERCIAL (KIWIFY -> TATAME CLUB)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kiwify_plan_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kiwify_product_id text NOT NULL,
  kiwify_plan_id text,
  kiwify_offer_id text,
  plan_frequency text CHECK (plan_frequency IS NULL OR plan_frequency IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  tatame_plan_id text NOT NULL REFERENCES public.saas_commercial_plans(id) ON DELETE RESTRICT,
  tatame_billing_cycle text NOT NULL CHECK (tatame_billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_kiwify_mapping UNIQUE (kiwify_product_id, kiwify_plan_id, kiwify_offer_id, plan_frequency)
);

CREATE INDEX IF NOT EXISTS idx_kiwify_mappings_lookup 
  ON public.kiwify_plan_mappings (kiwify_product_id, kiwify_plan_id, plan_frequency, active);

-- Inserção de mapeamentos iniciais configuráveis
-- Os IDs de produto/plano/oferta da Kiwify podem ser atualizados pelo painel ou SQL
INSERT INTO public.kiwify_plan_mappings (
  kiwify_product_id, kiwify_plan_id, kiwify_offer_id, plan_frequency, tatame_plan_id, tatame_billing_cycle, description
) VALUES
  ('kiwify_basic_prod', 'plan_basic_monthly', NULL, 'monthly', 'basic', 'monthly', 'Plano Básico Tatame Club — Mensal'),
  ('kiwify_basic_prod', 'plan_basic_quarterly', NULL, 'quarterly', 'basic', 'quarterly', 'Plano Básico Tatame Club — Trimestral'),
  ('kiwify_basic_prod', 'plan_basic_annual', NULL, 'annual', 'basic', 'annual', 'Plano Básico Tatame Club — Anual'),
  ('kiwify_advanced_prod', 'plan_adv_monthly', NULL, 'monthly', 'advanced', 'monthly', 'Plano Avançado Tatame Club — Mensal'),
  ('kiwify_advanced_prod', 'plan_adv_quarterly', NULL, 'quarterly', 'advanced', 'quarterly', 'Plano Avançado Tatame Club — Trimestral'),
  ('kiwify_advanced_prod', 'plan_adv_annual', NULL, 'annual', 'advanced', 'annual', 'Plano Avançado Tatame Club — Anual')
ON CONFLICT (kiwify_product_id, kiwify_plan_id, kiwify_offer_id, plan_frequency) DO UPDATE SET
  tatame_plan_id = EXCLUDED.tatame_plan_id,
  tatame_billing_cycle = EXCLUDED.tatame_billing_cycle,
  description = EXCLUDED.description,
  updated_at = now();

-- ----------------------------------------------------------------------------
-- 2. TABELA DE REFERÊNCIAS SEGURAS DE CHECKOUT (SCK / TRACKING)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saas_checkout_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code text NOT NULL UNIQUE, -- e.g. TC-REF-XXXXXXXX
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.saas_commercial_plans(id),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used boolean NOT NULL DEFAULT false,
  used_at timestamptz,
  used_order_id text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_checkout_ref_lookup 
  ON public.saas_checkout_references (reference_code, tenant_id);

-- ----------------------------------------------------------------------------
-- 3. TABELA DE INGESTÃO BRUTA DE EVENTOS (N8N AUDIT E IDEMPOTÊNCIA)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kiwify_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'kiwify-n8n',
  event_type text NOT NULL,
  order_id text,
  order_ref text,
  order_status text,
  subscription_id text,
  product_id text,
  plan_id text,
  customer_email text,
  charge_amount_minor bigint,
  query_signature text,
  signature_verified boolean NOT NULL DEFAULT false,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'received' CHECK (
    status IN ('received', 'processed', 'ignored', 'failed', 'pending_association')
  ),
  message text,
  raw_payload jsonb NOT NULL,
  raw_headers jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_kiwify_events_order_type 
  ON public.kiwify_webhook_events (order_id, event_type);
CREATE INDEX IF NOT EXISTS idx_kiwify_events_status 
  ON public.kiwify_webhook_events (status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_kiwify_events_tenant 
  ON public.kiwify_webhook_events (tenant_id);

-- ----------------------------------------------------------------------------
-- 4. TABELA DE PEDIDOS NORMALIZADOS DA KIWIFY
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kiwify_orders (
  order_id text PRIMARY KEY,
  order_ref text,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  order_status text NOT NULL, -- 'waiting_payment', 'paid', 'approved', 'refunded', 'chargedback', 'canceled', 'refused'
  product_id text,
  product_name text,
  product_type text,
  subscription_id text,
  plan_id text,
  plan_name text,
  plan_frequency text,
  plan_qty_charges integer,
  customer_email text,
  payment_method text,
  charge_amount_minor bigint,
  product_base_price_minor bigint,
  settlement_amount_minor bigint,
  approved_date timestamptz,
  refunded_at timestamptz,
  pix_expiration_date timestamptz,
  pix_code text,
  pix_qrcode_url text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kiwify_orders_tenant 
  ON public.kiwify_orders (tenant_id, order_status);
CREATE INDEX IF NOT EXISTS idx_kiwify_orders_subscription 
  ON public.kiwify_orders (subscription_id);

-- ----------------------------------------------------------------------------
-- 5. TABELA DE COBRANÇAS INDIVIDUAIS (CHARGES) KIWIFY
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kiwify_charges (
  id text PRIMARY KEY, -- e.g. order_id ou id específico da cobrança na Kiwify
  order_id text NOT NULL REFERENCES public.kiwify_orders(order_id) ON DELETE CASCADE,
  subscription_id text,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  amount_minor bigint NOT NULL,
  status text NOT NULL DEFAULT 'paid' CHECK (
    status IN ('pending', 'paid', 'failed', 'refunded', 'chargedback')
  ),
  payment_method text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kiwify_charges_tenant 
  ON public.kiwify_charges (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_kiwify_charges_subscription 
  ON public.kiwify_charges (subscription_id);

-- ----------------------------------------------------------------------------
-- 6. RPC DE GERAÇÃO SEGURA DE REFERÊNCIA DE CHECKOUT (TRACKING SCK)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_saas_checkout_reference(
  p_tenant_id uuid,
  p_plan_id text,
  p_billing_cycle text DEFAULT 'monthly'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ref_code text;
  v_tenant record;
  v_plan record;
  v_user_id uuid := auth.uid();
BEGIN
  -- Validar permissão de owner ou superadmin
  IF NOT (
    public.is_platform_admin() 
    OR (public.has_tenant_role(p_tenant_id, 'owner') AND public.is_tenant_member(p_tenant_id))
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas o proprietário da academia ou administrador global pode gerar links de checkout.';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'Academia não encontrada.';
  END IF;

  SELECT * INTO v_plan FROM public.saas_commercial_plans WHERE id = p_plan_id;
  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'Plano comercial informado não existe.';
  END IF;

  -- Gerar código alfanumérico seguro com prefixo TC-
  v_ref_code := 'TC-' || upper(substr(md5(gen_random_uuid()::text), 1, 10));

  INSERT INTO public.saas_checkout_references (
    reference_code, tenant_id, plan_id, billing_cycle, created_by_user_id
  ) VALUES (
    v_ref_code, p_tenant_id, p_plan_id, p_billing_cycle, v_user_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'reference_code', v_ref_code,
    'tenant_id', p_tenant_id,
    'tenant_name', v_tenant.trade_name,
    'plan_id', p_plan_id,
    'billing_cycle', p_billing_cycle,
    'tracking_sck', v_ref_code
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. RPC ATÔMICA CENTRAL: PROCESS_KIWIFY_N8N_EVENT
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_kiwify_n8n_event(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
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

  -- Identificação e mapeamento
  v_tenant_id uuid := NULL;
  v_resolved_plan_id text := NULL;
  v_resolved_billing_cycle text := NULL;
  v_mapping public.kiwify_plan_mappings%ROWTYPE;
  v_checkout_ref public.saas_checkout_references%ROWTYPE;
  v_existing_event public.kiwify_webhook_events%ROWTYPE;
  v_event_log_id uuid;
  v_amount_reais numeric(10,2);
  v_period_interval interval;
  v_next_period_end timestamptz;
  v_subscription public.saas_subscriptions%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
  v_lock_obtained boolean;
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

  -- Valores monetários em centavos
  v_charge_amount_minor      := NULLIF(p_event->>'charge_amount_minor', '')::bigint;
  v_product_base_price_minor := NULLIF(p_event->>'product_base_price_minor', '')::bigint;
  v_settlement_amount_minor  := NULLIF(p_event->>'settlement_amount_minor', '')::bigint;
  v_plan_qty_charges         := NULLIF(p_event->>'plan_qty_charges', '')::integer;

  -- Datas
  IF p_event->>'approved_date' IS NOT NULL AND p_event->>'approved_date' <> '' THEN
    BEGIN
      v_approved_date := (p_event->>'approved_date')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_approved_date := now();
    END;
  END IF;

  IF p_event->>'refunded_at' IS NOT NULL AND p_event->>'refunded_at' <> '' THEN
    BEGIN
      v_refunded_at := (p_event->>'refunded_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      v_refunded_at := now();
    END;
  END IF;

  -- Se order_id ou event_type estiverem ausentes, rejeitar
  IF v_order_id = '' OR v_event_type = '' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'MISSING_REQUIRED_FIELDS',
      'error', 'Parâmetros order_id e event_type são obrigatórios no payload encaminhado pelo n8n.'
    );
  END IF;

  -- 1. VERIFICAÇÃO DE IDEMPOTÊNCIA: Verificar se este evento exato já foi processado
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
      'event_type', v_event_type,
      'order_id', v_order_id,
      'message', 'Evento Kiwify já processado anteriormente com sucesso (Idempotência confirmada).'
    );
  END IF;

  -- 2. IDENTIFICAÇÃO SEGURA DA ACADEMIA (TENANT_ID)
  -- Prioridade 1: Buscar por Tracking sck no payload bruto ou order_ref
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

  -- Se v_order_ref tiver formato de UUID direto, verificar se existe na tabela tenants
  IF v_order_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_tenant_id FROM public.tenants WHERE id = v_order_ref::uuid;
  END IF;

  -- Se não localizou por UUID direto, buscar na tabela de saas_checkout_references
  IF v_tenant_id IS NULL AND v_order_ref <> '' THEN
    SELECT * INTO v_checkout_ref
    FROM public.saas_checkout_references
    WHERE reference_code = v_order_ref
    LIMIT 1;

    IF v_checkout_ref.id IS NOT NULL THEN
      v_tenant_id := v_checkout_ref.tenant_id;
      v_resolved_plan_id := v_checkout_ref.plan_id;
      v_resolved_billing_cycle := v_checkout_ref.billing_cycle;

      -- Marcar referência como utilizada
      UPDATE public.saas_checkout_references
      SET used = true,
          used_at = now(),
          used_order_id = v_order_id
      WHERE id = v_checkout_ref.id;
    END IF;
  END IF;

  -- Se ainda não localizou e existe assinatura existente com mesmo gateway_subscription_id
  IF v_tenant_id IS NULL AND v_subscription_id <> '' THEN
    SELECT tenant_id INTO v_tenant_id
    FROM public.saas_subscriptions
    WHERE gateway_subscription_id = v_subscription_id
    LIMIT 1;
  END IF;

  -- 3. SE NÃO FOI POSSÍVEL ASSOCIAR A NENHUMA ACADEMIA:
  -- Registrar o evento como pendente de associação, SEM liberar funcionalidades nem ativar plano
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
    ) RETURNING id INTO v_event_log_id;

    -- Também registrar na tabela de pedidos para conferência do administrador global
    INSERT INTO public.kiwify_orders (
      order_id, order_ref, tenant_id, event_type, order_status, product_id,
      product_name, product_type, subscription_id, plan_id, plan_name,
      plan_frequency, plan_qty_charges, customer_email, payment_method,
      charge_amount_minor, product_base_price_minor, settlement_amount_minor,
      approved_date, raw_payload
    ) VALUES (
      v_order_id, v_order_ref, NULL, v_event_type, v_order_status, v_product_id,
      v_product_name, v_product_type, v_subscription_id, v_plan_id, v_plan_name,
      v_plan_frequency, v_plan_qty_charges, v_customer_email, v_payment_method,
      v_charge_amount_minor, v_product_base_price_minor, v_settlement_amount_minor,
      v_approved_date, v_raw_payload
    ) ON CONFLICT (order_id) DO UPDATE SET
      order_status = EXCLUDED.order_status,
      event_type = EXCLUDED.event_type,
      updated_at = now();

    RETURN jsonb_build_object(
      'ok', true,
      'processed', true,
      'status', 'pending_association',
      'event_type', v_event_type,
      'order_id', v_order_id,
      'message', 'Evento registrado com sucesso como pendente de associação (referência da academia ausente no checkout).'
    );
  END IF;

  -- 4. MAPEAMENTO COMERCIAL (PRODUTO/PLANO KIWIFY -> PLANO TATAME CLUB)
  IF v_resolved_plan_id IS NULL THEN
    -- Buscar correspondência em kiwify_plan_mappings
    SELECT * INTO v_mapping
    FROM public.kiwify_plan_mappings
    WHERE active = true
      AND kiwify_product_id = v_product_id
      AND (kiwify_plan_id IS NULL OR kiwify_plan_id = '' OR kiwify_plan_id = v_plan_id)
      AND (plan_frequency IS NULL OR plan_frequency = '' OR plan_frequency = v_plan_frequency)
    ORDER BY (CASE WHEN kiwify_plan_id = v_plan_id THEN 1 ELSE 2 END) ASC
    LIMIT 1;

    IF v_mapping.id IS NOT NULL THEN
      v_resolved_plan_id := v_mapping.tatame_plan_id;
      v_resolved_billing_cycle := v_mapping.tatame_billing_cycle;
    ELSE
      -- Inferência pedagógica estrita se não houver mapeamento cadastrado
      IF v_product_name ILIKE '%avançado%' OR v_product_name ILIKE '%completo%' OR v_plan_name ILIKE '%avançado%' THEN
        v_resolved_plan_id := 'advanced';
      ELSE
        v_resolved_plan_id := 'basic';
      END IF;

      IF v_plan_frequency = 'annual' THEN
        v_resolved_billing_cycle := 'annual';
      ELSIF v_plan_frequency = 'quarterly' THEN
        v_resolved_billing_cycle := 'quarterly';
      ELSIF v_plan_frequency = 'semiannual' THEN
        v_resolved_billing_cycle := 'semiannual';
      ELSE
        v_resolved_billing_cycle := 'monthly';
      END IF;
    END IF;
  END IF;

  -- Converter centavos em Reais
  v_amount_reais := COALESCE(v_charge_amount_minor, 0) / 100.0;

  -- 5. PROCESSAMENTO DE ACORDO COM O TIPO DE EVENTO
  -- Advisory lock no tenant para evitar concorrência entre webhooks rápidos
  PERFORM pg_advisory_xact_lock(hashtext(v_tenant_id::text));

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_tenant_id;
  SELECT * INTO v_subscription FROM public.saas_subscriptions WHERE tenant_id = v_tenant_id;

  -- Definir intervalo de renovação conforme ciclo de faturamento
  IF v_resolved_billing_cycle = 'annual' THEN
    v_period_interval := interval '365 days';
  ELSIF v_resolved_billing_cycle = 'quarterly' THEN
    v_period_interval := interval '90 days';
  ELSIF v_resolved_billing_cycle = 'semiannual' THEN
    v_period_interval := interval '180 days';
  ELSE
    v_period_interval := interval '30 days';
  END IF;

  -- Inserir ou atualizar na tabela kiwify_orders
  INSERT INTO public.kiwify_orders (
    order_id, order_ref, tenant_id, event_type, order_status, product_id,
    product_name, product_type, subscription_id, plan_id, plan_name,
    plan_frequency, plan_qty_charges, customer_email, payment_method,
    charge_amount_minor, product_base_price_minor, settlement_amount_minor,
    approved_date, refunded_at, raw_payload
  ) VALUES (
    v_order_id, v_order_ref, v_tenant_id, v_event_type, v_order_status, v_product_id,
    v_product_name, v_product_type, v_subscription_id, v_plan_id, v_plan_name,
    v_plan_frequency, v_plan_qty_charges, v_customer_email, v_payment_method,
    v_charge_amount_minor, v_product_base_price_minor, v_settlement_amount_minor,
    v_approved_date, v_refunded_at, v_raw_payload
  ) ON CONFLICT (order_id) DO UPDATE SET
    tenant_id = COALESCE(EXCLUDED.tenant_id, public.kiwify_orders.tenant_id),
    order_status = EXCLUDED.order_status,
    event_type = EXCLUDED.event_type,
    approved_date = COALESCE(EXCLUDED.approved_date, public.kiwify_orders.approved_date),
    refunded_at = COALESCE(EXCLUDED.refunded_at, public.kiwify_orders.refunded_at),
    raw_payload = EXCLUDED.raw_payload,
    updated_at = now();

  -- ==========================================================================
  -- CASO A: PIX CRIADO (pix_created / waiting_payment)
  -- ==========================================================================
  IF v_event_type = 'pix_created' OR v_order_status = 'waiting_payment' THEN
    -- Se o tenant estiver em trial ativo, manter o acesso em trial com aviso
    -- NÃO aprovar pagamento, NÃO alterar tenant para active
    IF v_subscription.id IS NOT NULL THEN
      UPDATE public.saas_subscriptions
      SET requested_plan_id = v_resolved_plan_id,
          requested_billing_cycle = v_resolved_billing_cycle,
          requested_amount = v_amount_reais,
          payment_requested_at = now(),
          gateway_subscription_id = COALESCE(NULLIF(v_subscription_id, ''), gateway_subscription_id),
          updated_at = now()
      WHERE id = v_subscription.id;
    END IF;

    -- Registrar evento
    INSERT INTO public.kiwify_webhook_events (
      source, event_type, order_id, order_ref, order_status, subscription_id,
      product_id, plan_id, customer_email, charge_amount_minor, query_signature,
      signature_verified, tenant_id, status, message, raw_payload, raw_headers, processed_at
    ) VALUES (
      'kiwify-n8n', v_event_type, v_order_id, v_order_ref, v_order_status, v_subscription_id,
      v_product_id, v_plan_id, v_customer_email, v_charge_amount_minor, v_query_signature,
      v_signature_verified, v_tenant_id, 'processed',
      'Pix gerado com sucesso. Pedido registrado como aguardando pagamento.',
      v_raw_payload, v_raw_headers, now()
    );

    RETURN jsonb_build_object(
      'ok', true,
      'processed', true,
      'event_type', v_event_type,
      'order_id', v_order_id,
      'tenant_id', v_tenant_id,
      'status', 'waiting_payment',
      'message', 'Pedido Pix registrado como pendente de pagamento. Funcionalidades pagas permanecem bloqueadas até a compensação.'
    );

  -- ==========================================================================
  -- CASO B: PEDIDO APROVADO / PAGO (order_approved / paid)
  -- ==========================================================================
  ELSIF v_event_type = 'order_approved' OR v_order_status IN ('paid', 'approved') THEN
    v_next_period_end := now() + v_period_interval;

    -- 1. Registrar a cobrança individual com unicidade
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
      format('Pagamento aprovado via Kiwify (Pedido: %s, Produto: %s)', v_order_id, v_product_name)
    ) ON CONFLICT (id) DO UPDATE SET
      status = 'paid',
      paid_at = EXCLUDED.paid_at,
      updated_at = now();

    -- 3. Atualizar assinatura do SaaS (saas_subscriptions)
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
          suspended_reason = NULL,
          suspended_at = NULL,
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

    -- 4. Atualizar o tenant para ATIVO e com os limites do plano
    UPDATE public.tenants
    SET status = 'active',
        plan_id = v_resolved_plan_id,
        trial_expires_at = NULL, -- Trial superado com sucesso por plano comercial
        updated_at = now()
    WHERE id = v_tenant_id;

    -- Registrar auditoria de plataforma
    INSERT INTO public.platform_audit_logs (
      actor_user_name, action, entity_type, entity_id, tenant_id, tenant_name,
      details, metadata
    ) VALUES (
      'Kiwify n8n Webhook',
      'Ativação de Assinatura Kiwify',
      'Tenant',
      v_tenant_id::text,
      v_tenant_id,
      v_tenant.trade_name,
      format('Plano %s (%s) ativado com sucesso via Kiwify. Pedido: %s, Valor: R$ %s',
        v_resolved_plan_id, v_resolved_billing_cycle, v_order_id, v_amount_reais),
      jsonb_build_object('order_id', v_order_id, 'subscription_id', v_subscription_id, 'email', v_customer_email)
    );

    -- Marcar evento de webhook como processado
    INSERT INTO public.kiwify_webhook_events (
      source, event_type, order_id, order_ref, order_status, subscription_id,
      product_id, plan_id, customer_email, charge_amount_minor, query_signature,
      signature_verified, tenant_id, status, message, raw_payload, raw_headers, processed_at
    ) VALUES (
      'kiwify-n8n', v_event_type, v_order_id, v_order_ref, v_order_status, v_subscription_id,
      v_product_id, v_plan_id, v_customer_email, v_charge_amount_minor, v_query_signature,
      v_signature_verified, v_tenant_id, 'processed',
      format('Assinatura ativada com sucesso para o plano %s.', v_resolved_plan_id),
      v_raw_payload, v_raw_headers, now()
    );

    RETURN jsonb_build_object(
      'ok', true,
      'processed', true,
      'event_type', v_event_type,
      'order_id', v_order_id,
      'tenant_id', v_tenant_id,
      'plan_id', v_resolved_plan_id,
      'billing_cycle', v_resolved_billing_cycle,
      'status', 'active',
      'message', 'Pagamento confirmado e assinatura da academia ativada com sucesso no Tatame Club.'
    );

  -- ==========================================================================
  -- CASO C: REEMBOLSO (order_refunded / refunded)
  -- ==========================================================================
  ELSIF v_event_type = 'order_refunded' OR v_order_status = 'refunded' THEN
    UPDATE public.kiwify_charges
    SET status = 'refunded', refunded_at = COALESCE(v_refunded_at, now())
    WHERE order_id = v_order_id;

    UPDATE public.saas_payments
    SET status = 'refunded'
    WHERE id = 'KW-' || v_order_id;

    UPDATE public.saas_subscriptions
    SET status = 'canceled',
        cancel_reason = 'Reembolso processado pela Kiwify',
        canceled_at = now(),
        updated_at = now()
    WHERE tenant_id = v_tenant_id;

    UPDATE public.tenants
    SET status = 'expired',
        updated_at = now()
    WHERE id = v_tenant_id;

    INSERT INTO public.platform_audit_logs (
      actor_user_name, action, entity_type, entity_id, tenant_id, tenant_name, details
    ) VALUES (
      'Kiwify n8n Webhook',
      'Reembolso de Assinatura',
      'Tenant',
      v_tenant_id::text,
      v_tenant_id,
      v_tenant.trade_name,
      format('Pedido %s reembolsado via Kiwify. Acesso da academia suspenso/expirado.', v_order_id)
    );

    INSERT INTO public.kiwify_webhook_events (
      source, event_type, order_id, order_ref, order_status, subscription_id,
      product_id, plan_id, customer_email, charge_amount_minor, query_signature,
      signature_verified, tenant_id, status, message, raw_payload, raw_headers, processed_at
    ) VALUES (
      'kiwify-n8n', v_event_type, v_order_id, v_order_ref, v_order_status, v_subscription_id,
      v_product_id, v_plan_id, v_customer_email, v_charge_amount_minor, v_query_signature,
      v_signature_verified, v_tenant_id, 'processed',
      'Reembolso registrado e plano suspenso.',
      v_raw_payload, v_raw_headers, now()
    );

    RETURN jsonb_build_object(
      'ok', true,
      'processed', true,
      'event_type', v_event_type,
      'order_id', v_order_id,
      'tenant_id', v_tenant_id,
      'status', 'refunded',
      'message', 'Reembolso registrado com sucesso no Tatame Club.'
    );

  -- ==========================================================================
  -- CASO D: CHARGEBACK (CONTESTAÇÃO DE PAGAMENTO)
  -- ==========================================================================
  ELSIF v_event_type = 'chargeback' OR v_order_status = 'chargedback' THEN
    UPDATE public.kiwify_charges
    SET status = 'chargedback'
    WHERE order_id = v_order_id;

    UPDATE public.saas_payments
    SET status = 'failed'
    WHERE id = 'KW-' || v_order_id;

    UPDATE public.saas_subscriptions
    SET status = 'suspended',
        suspended_reason = format('Chargeback/Disputa registrada no pedido Kiwify %s', v_order_id),
        suspended_at = now(),
        updated_at = now()
    WHERE tenant_id = v_tenant_id;

    UPDATE public.tenants
    SET status = 'suspended',
        updated_at = now()
    WHERE id = v_tenant_id;

    INSERT INTO public.platform_audit_logs (
      actor_user_name, action, entity_type, entity_id, tenant_id, tenant_name, details
    ) VALUES (
      'Kiwify n8n Webhook',
      'Chargeback de Pagamento',
      'Tenant',
      v_tenant_id::text,
      v_tenant_id,
      v_tenant.trade_name,
      format('Chargeback recebido para o pedido Kiwify %s. Academia suspensa para averiguação financeira.', v_order_id)
    );

    INSERT INTO public.kiwify_webhook_events (
      source, event_type, order_id, order_ref, order_status, subscription_id,
      product_id, plan_id, customer_email, charge_amount_minor, query_signature,
      signature_verified, tenant_id, status, message, raw_payload, raw_headers, processed_at
    ) VALUES (
      'kiwify-n8n', v_event_type, v_order_id, v_order_ref, v_order_status, v_subscription_id,
      v_product_id, v_plan_id, v_customer_email, v_charge_amount_minor, v_query_signature,
      v_signature_verified, v_tenant_id, 'processed',
      'Chargeback registrado e academia suspensa preventivamente.',
      v_raw_payload, v_raw_headers, now()
    );

    RETURN jsonb_build_object(
      'ok', true,
      'processed', true,
      'event_type', v_event_type,
      'order_id', v_order_id,
      'tenant_id', v_tenant_id,
      'status', 'chargedback',
      'message', 'Chargeback registrado e assinatura suspensa preventivamente.'
    );

  -- ==========================================================================
  -- CASO E: CANCELAMENTO DE ASSINATURA (subscription_canceled)
  -- ==========================================================================
  ELSIF v_event_type = 'subscription_canceled' OR v_subscription_status = 'canceled' THEN
    UPDATE public.saas_subscriptions
    SET cancel_reason = 'Cancelado pelo cliente/administrador via Kiwify',
        canceled_at = now(),
        updated_at = now()
    WHERE tenant_id = v_tenant_id;

    INSERT INTO public.platform_audit_logs (
      actor_user_name, action, entity_type, entity_id, tenant_id, tenant_name, details
    ) VALUES (
      'Kiwify n8n Webhook',
      'Cancelamento de Recorrência',
      'Tenant',
      v_tenant_id::text,
      v_tenant_id,
      v_tenant.trade_name,
      format('Assinatura recorrente Kiwify %s cancelada. Acesso preservado até o fim do período vigente.', v_subscription_id)
    );

    INSERT INTO public.kiwify_webhook_events (
      source, event_type, order_id, order_ref, order_status, subscription_id,
      product_id, plan_id, customer_email, charge_amount_minor, query_signature,
      signature_verified, tenant_id, status, message, raw_payload, raw_headers, processed_at
    ) VALUES (
      'kiwify-n8n', v_event_type, v_order_id, v_order_ref, v_order_status, v_subscription_id,
      v_product_id, v_plan_id, v_customer_email, v_charge_amount_minor, v_query_signature,
      v_signature_verified, v_tenant_id, 'processed',
      'Cancelamento de recorrência registrado.',
      v_raw_payload, v_raw_headers, now()
    );

    RETURN jsonb_build_object(
      'ok', true,
      'processed', true,
      'event_type', v_event_type,
      'order_id', v_order_id,
      'tenant_id', v_tenant_id,
      'status', 'subscription_canceled',
      'message', 'Cancelamento de recorrência registrado com sucesso.'
    );

  -- ==========================================================================
  -- CASO F: DEMAIS EVENTOS INFORMATIVOS
  -- ==========================================================================
  ELSE
    INSERT INTO public.kiwify_webhook_events (
      source, event_type, order_id, order_ref, order_status, subscription_id,
      product_id, plan_id, customer_email, charge_amount_minor, query_signature,
      signature_verified, tenant_id, status, message, raw_payload, raw_headers, processed_at
    ) VALUES (
      'kiwify-n8n', v_event_type, v_order_id, v_order_ref, v_order_status, v_subscription_id,
      v_product_id, v_plan_id, v_customer_email, v_charge_amount_minor, v_query_signature,
      v_signature_verified, v_tenant_id, 'ignored',
      'Evento informativo recebido e registrado sem alteração de estado da assinatura.',
      v_raw_payload, v_raw_headers, now()
    );

    RETURN jsonb_build_object(
      'ok', true,
      'processed', true,
      'event_type', v_event_type,
      'order_id', v_order_id,
      'tenant_id', v_tenant_id,
      'status', 'ignored',
      'message', 'Evento recebido e registrado para auditoria.'
    );
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. RLS E PERMISSÕES DE SEGURANÇA
-- ----------------------------------------------------------------------------
ALTER TABLE public.kiwify_plan_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_checkout_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiwify_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiwify_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiwify_charges ENABLE ROW LEVEL SECURITY;

-- 8.1 kiwify_plan_mappings: Leitura para autenticados; Escrita restrita ao SuperAdmin
DROP POLICY IF EXISTS "kiwify_mappings_select" ON public.kiwify_plan_mappings;
CREATE POLICY "kiwify_mappings_select" ON public.kiwify_plan_mappings
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "kiwify_mappings_admin" ON public.kiwify_plan_mappings;
CREATE POLICY "kiwify_mappings_admin" ON public.kiwify_plan_mappings
FOR ALL TO authenticated
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

-- 8.2 saas_checkout_references: Tenant lê as suas referências; SuperAdmin lê tudo
DROP POLICY IF EXISTS "checkout_references_select" ON public.saas_checkout_references;
CREATE POLICY "checkout_references_select" ON public.saas_checkout_references
FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR (public.has_tenant_role(tenant_id, 'owner') AND public.is_tenant_member(tenant_id))
);

-- 8.3 kiwify_orders: Proprietário lê os pedidos do seu tenant; SuperAdmin lê tudo
DROP POLICY IF EXISTS "kiwify_orders_select" ON public.kiwify_orders;
CREATE POLICY "kiwify_orders_select" ON public.kiwify_orders
FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR (tenant_id IS NOT NULL AND public.has_tenant_role(tenant_id, 'owner') AND public.is_tenant_member(tenant_id))
);

-- 8.4 kiwify_charges: Proprietário lê cobranças do seu tenant; SuperAdmin lê tudo
DROP POLICY IF EXISTS "kiwify_charges_select" ON public.kiwify_charges;
CREATE POLICY "kiwify_charges_select" ON public.kiwify_charges
FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR (public.has_tenant_role(tenant_id, 'owner') AND public.is_tenant_member(tenant_id))
);

-- 8.5 kiwify_webhook_events: Restrito ao SuperAdmin da plataforma
DROP POLICY IF EXISTS "kiwify_events_select_admin" ON public.kiwify_webhook_events;
CREATE POLICY "kiwify_events_select_admin" ON public.kiwify_webhook_events
FOR SELECT TO authenticated
USING (public.is_platform_admin());

-- Grants de execução
GRANT EXECUTE ON FUNCTION public.process_kiwify_n8n_event(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_saas_checkout_reference(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
