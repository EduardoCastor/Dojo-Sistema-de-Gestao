-- ============================================================================
-- MIGRATION 32: CORREÇÃO DEFINITIVA DA ATIVAÇÃO MANUAL DE LICENÇAS E CONTROLE DE ACESSO
-- ============================================================================
-- Diagnóstico da Causa Raiz:
-- 1. Erro: "column suspended_at of relation tenants does not exist".
--    Na tabela public.tenants (criada na Migration 01), o estado de suspensão de uma academia
--    é representado pelo campo enum `status tenant_status` ('trial', 'active', 'suspended', 'canceled').
--    As colunas `suspended_at` (timestamptz) e `suspended_reason` (text) pertencem exclusivamente
--    à tabela public.saas_subscriptions (criada na Migration 24).
--    Portanto, instruções UPDATE na tabela public.tenants não devem referenciar suspended_at
--    ou suspended_reason, mas sim atualizar `status = 'active'::public.tenant_status`.
-- 2. Limpeza e reativação da assinatura (public.saas_subscriptions):
--    A tabela saas_subscriptions é a entidade correta que armazena `suspended_at = NULL`
--    e `suspended_reason = NULL`, além de registrar `manual_activation` (jsonb) e `notes`.
-- 3. Função get_tenant_effective_limits(uuid):
--    Compatibilizada para consultar a razão da suspensão a partir de v_sub.suspended_reason,
--    evitando acesso a campos inexistentes no registro v_tenant.
-- 4. Segurança e Auditoria:
--    Apenas administradores globais autorizados (public.is_platform_admin() = true) podem invocar a função.
--    Toda ativação manual é auditada em public.platform_audit_logs com colunas válidas.
--    Não altera saas_payments nem cria confirmações fictícias de pagamento.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DROP DEFENSIVO DE VERSÕES ANTERIORES PARA LIMPAR ASSINATURAS DO POSTGREST
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_manual_activate_subscription(uuid, text, integer);

-- ----------------------------------------------------------------------------
-- 2. ATUALIZAR get_tenant_effective_limits PARA CONSULTAR A TABELA CORRETA
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tenant_effective_limits(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
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

  -- Prioridade 1: Suspensão ou Cancelamento
  IF v_tenant.status = 'suspended' OR (v_sub.id IS NOT NULL AND v_sub.status = 'suspended') THEN
    v_effective_status := 'suspended';
    v_is_allowed := false;
    v_reason := COALESCE(v_sub.suspended_reason, 'Licença suspensa administrativamente.');
  ELSIF v_tenant.status = 'canceled' OR (v_sub.id IS NOT NULL AND v_sub.status = 'canceled') THEN
    v_effective_status := 'canceled';
    v_is_allowed := false;
    v_reason := 'Assinatura cancelada.';
  -- Prioridade 2: Assinatura Comercial Ativa
  ELSIF v_tenant.status = 'active' AND (v_sub.id IS NULL OR v_sub.status = 'active') AND v_tenant.plan_id <> 'trial' THEN
    IF v_sub.id IS NOT NULL AND v_sub.current_period_end IS NOT NULL
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
  -- Prioridade 3: Solicitação aguardando pagamento Pix
  ELSIF v_sub.id IS NOT NULL AND v_sub.status IN ('pending_payment', 'waiting_payment', 'payment_under_review') THEN
    IF v_tenant.trial_expires_at IS NOT NULL AND v_tenant.trial_expires_at >= now() THEN
      v_effective_status := 'trial_active';
      v_is_allowed := true;
      v_reason := 'Solicitação de plano registrada (aguardando pagamento Pix). Acesso liberado durante a degustação vigente.';
    ELSE
      v_effective_status := 'pending_payment';
      v_is_allowed := false;
      v_reason := 'Contratação registrada e aguardando confirmação válida do pagamento Pix para liberação do acesso.';
    END IF;
  -- Prioridade 4: Pagamento rejeitado
  ELSIF v_sub.id IS NOT NULL AND v_sub.status = 'rejected' THEN
    v_effective_status := 'rejected';
    v_is_allowed := false;
    v_reason := 'O pagamento informado não pôde ser validado. Envie um comprovante válido ou selecione um plano.';
  -- Prioridade 5: Em atraso
  ELSIF v_sub.id IS NOT NULL AND v_sub.status = 'past_due' THEN
    v_effective_status := 'past_due';
    v_is_allowed := false;
    v_reason := 'Mensalidade em atraso. Regularize sua assinatura.';
  -- Prioridade 6: Expirada
  ELSIF v_tenant.status = 'expired' OR (v_sub.id IS NOT NULL AND v_sub.status = 'expired') THEN
    v_effective_status := 'expired';
    v_is_allowed := false;
    v_reason := 'Licença expirada.';
  -- Prioridade 7: Degustação Gratuita (Trial)
  ELSIF v_tenant.status = 'trial' OR (v_sub.id IS NOT NULL AND v_sub.status = 'trial') THEN
    IF v_tenant.trial_expires_at IS NOT NULL AND v_tenant.trial_expires_at >= now() THEN
      v_effective_status := 'trial_active';
      v_is_allowed := true;
      v_reason := 'Período de degustação vigente.';
    ELSE
      v_effective_status := 'trial_expired';
      v_is_allowed := false;
      v_reason := 'O período de degustação gratuita de 10 dias expirou.';
    END IF;
  ELSE
    v_effective_status := 'active';
    v_is_allowed := true;
    v_reason := 'Acesso liberado.';
  END IF;

  RETURN jsonb_build_object(
    'is_allowed', v_is_allowed,
    'status', v_effective_status,
    'reason', v_reason,
    'plan_id', v_tenant.plan_id,
    'tenant_status', v_tenant.status,
    'subscription_status', v_sub.status
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. IMPLEMENTAÇÃO SEGURA DE public.admin_manual_activate_subscription
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_manual_activate_subscription(
  p_tenant_id uuid,
  p_reason text,
  p_extend_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_email text := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  v_tenant public.tenants%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
  v_plan public.saas_commercial_plans%ROWTYPE;
  v_target_plan_id text;
  v_days integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_manual_activation_json jsonb;
  v_tenant_display_name text;
BEGIN
  -- 1. Validação de segurança no servidor: apenas administradores globais autorizados
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores Globais podem ativar licenças manualmente.';
  END IF;

  -- 2. Validação dos parâmetros
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'O identificador da academia (tenant_id) é obrigatório.';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Informe uma justificativa administrativa válida (mínimo de 5 caracteres).';
  END IF;

  v_days := GREATEST(COALESCE(p_extend_days, 30), 1);

  -- 3. Localizar academia (tenant)
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia não encontrada.';
  END IF;

  v_tenant_display_name := COALESCE(NULLIF(btrim(v_tenant.trade_name), ''), NULLIF(btrim(v_tenant.legal_name), ''), 'Academia');

  -- 4. Localizar assinatura existente
  SELECT * INTO v_sub FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id FOR UPDATE;

  -- 5. Determinar plano comercial de destino (respeita plano solicitado ou contratado)
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

  -- 6. Calcular início e término da vigência respeitando saldo existente
  IF v_sub.id IS NOT NULL AND v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end > now() THEN
    -- Licença ainda vigente: preserva dias restantes somando ao final do período
    v_period_start := v_sub.current_period_start;
    v_period_end := v_sub.current_period_end + (v_days || ' days')::interval;
  ELSE
    -- Licença vencida ou trial: nova vigência a partir de agora
    v_period_start := now();
    v_period_end := now() + (v_days || ' days')::interval;
  END IF;

  -- 7. Montar metadados de concessão manual (auditáveis e compatíveis com camelCase e snake_case)
  v_manual_activation_json := jsonb_build_object(
    'activated_by_user_id', v_caller_id,
    'activated_by_user_name', COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
    'activatedByUserId', v_caller_id,
    'activatedByUserName', COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
    'reason', btrim(p_reason),
    'activated_at', now(),
    'activatedAt', now(),
    'extended_days', v_days,
    'extendedDays', v_days
  );

  -- 8. Atualizar status e plano do tenant no esquema real (apenas colunas existentes)
  UPDATE public.tenants
  SET
    plan_id = v_plan.id,
    status = 'active'::public.tenant_status,
    updated_at = now()
  WHERE id = p_tenant_id
  RETURNING * INTO v_tenant;

  -- 9. Atualizar ou Criar assinatura correspondente (limpando flags de suspensão em saas_subscriptions)
  IF v_sub.id IS NOT NULL THEN
    UPDATE public.saas_subscriptions
    SET
      tenant_name = v_tenant_display_name,
      plan_id = v_plan.id,
      plan_name = v_plan.name,
      amount = CASE WHEN amount > 0 THEN amount ELSE COALESCE(v_plan.monthly_price, v_plan.price, 0.00) END,
      status = 'active',
      current_period_start = v_period_start,
      current_period_end = v_period_end,
      next_due_date = v_period_end::date,
      suspended_at = NULL,
      suspended_reason = NULL,
      canceled_at = NULL,
      cancel_reason = NULL,
      manual_activation = v_manual_activation_json,
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
      started_at,
      current_period_start,
      current_period_end,
      next_due_date,
      trial_expires_at,
      grace_period_days,
      payment_method,
      manual_activation,
      notes,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      p_tenant_id,
      v_tenant_display_name,
      v_plan.id,
      v_plan.name,
      'monthly',
      COALESCE(v_plan.monthly_price, v_plan.price, 0.00),
      'active',
      COALESCE(v_tenant.trial_started_at, now()),
      v_period_start,
      v_period_end,
      v_period_end::date,
      v_tenant.trial_expires_at,
      5,
      'pix',
      v_manual_activation_json,
      btrim(p_reason),
      now(),
      now()
    )
    RETURNING * INTO v_sub;
  END IF;

  -- 10. Registrar auditoria em public.platform_audit_logs com colunas reais e IDs válidos
  INSERT INTO public.platform_audit_logs (
    actor_user_id,
    actor_user_name,
    tenant_id,
    tenant_name,
    action,
    entity_type,
    entity_id,
    reason,
    details,
    metadata
  ) VALUES (
    v_caller_id,
    COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
    v_tenant.id,
    v_tenant_display_name,
    'manual_activate_subscription',
    'subscription',
    v_sub.id::text,
    btrim(p_reason),
    format('Assinatura ativada/estendida manualmente por %s dias no plano %s (vigência até %s). Motivo: %s',
      v_days, v_plan.name, to_char(v_period_end, 'YYYY-MM-DD'), btrim(p_reason)),
    jsonb_build_object(
      'plan_id', v_plan.id,
      'extend_days', v_days,
      'new_period_end', v_period_end,
      'reason', btrim(p_reason)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'tenant', to_jsonb(v_tenant),
    'subscription', to_jsonb(v_sub),
    'effective_access', public.get_tenant_effective_limits(p_tenant_id)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. ATUALIZAR public.admin_suspend_tenant E public.admin_reactivate_tenant
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_suspend_tenant(
  p_tenant_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_email text := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  v_tenant public.tenants%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
  v_tenant_display_name text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores Globais podem suspender academias.';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'O identificador da academia (tenant_id) é obrigatório.';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo da suspensão (mínimo de 5 caracteres).';
  END IF;

  -- 1. Atualizar status na tabela tenants (apenas colunas existentes)
  UPDATE public.tenants
  SET
    status = 'suspended'::public.tenant_status,
    updated_at = now()
  WHERE id = p_tenant_id
  RETURNING * INTO v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia não encontrada.';
  END IF;

  v_tenant_display_name := COALESCE(NULLIF(btrim(v_tenant.trade_name), ''), NULLIF(btrim(v_tenant.legal_name), ''), 'Academia');

  -- 2. Gravar data e motivo da suspensão na tabela saas_subscriptions (entidade oficial)
  UPDATE public.saas_subscriptions
  SET
    status = 'suspended',
    suspended_at = now(),
    suspended_reason = btrim(p_reason),
    notes = 'Suspensa administrativamente: ' || btrim(p_reason),
    updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO v_sub;

  -- 3. Registrar na trilha de auditoria global
  INSERT INTO public.platform_audit_logs (
    actor_user_id,
    actor_user_name,
    tenant_id,
    tenant_name,
    action,
    entity_type,
    entity_id,
    reason,
    details,
    metadata
  ) VALUES (
    v_caller_id,
    COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
    v_tenant.id,
    v_tenant_display_name,
    'suspend_tenant',
    'tenant',
    v_tenant.id::text,
    btrim(p_reason),
    format('Academia suspensa administrativamente. Motivo: %s', btrim(p_reason)),
    jsonb_build_object('reason', btrim(p_reason))
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
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_email text := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  v_tenant public.tenants%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
  v_next_status text;
  v_tenant_display_name text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores Globais podem reativar academias.';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'O identificador da academia (tenant_id) é obrigatório.';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo da reativação (mínimo de 5 caracteres).';
  END IF;

  SELECT * INTO v_sub FROM public.saas_subscriptions WHERE tenant_id = p_tenant_id;

  IF v_sub.id IS NOT NULL AND v_sub.status <> 'suspended' THEN
    v_next_status := v_sub.status;
  ELSIF v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end > now() THEN
    v_next_status := 'active';
  ELSE
    v_next_status := 'active';
  END IF;

  -- 1. Atualizar status na tabela tenants (apenas colunas existentes)
  UPDATE public.tenants
  SET
    status = v_next_status::public.tenant_status,
    updated_at = now()
  WHERE id = p_tenant_id
  RETURNING * INTO v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia não encontrada.';
  END IF;

  v_tenant_display_name := COALESCE(NULLIF(btrim(v_tenant.trade_name), ''), NULLIF(btrim(v_tenant.legal_name), ''), 'Academia');

  -- 2. Limpar suspensão na tabela saas_subscriptions
  IF v_sub.id IS NOT NULL THEN
    UPDATE public.saas_subscriptions
    SET
      status = v_next_status,
      suspended_at = NULL,
      suspended_reason = NULL,
      notes = 'Reativada administrativamente: ' || btrim(p_reason),
      updated_at = now()
    WHERE id = v_sub.id
    RETURNING * INTO v_sub;
  END IF;

  -- 3. Registrar na trilha de auditoria global
  INSERT INTO public.platform_audit_logs (
    actor_user_id,
    actor_user_name,
    tenant_id,
    tenant_name,
    action,
    entity_type,
    entity_id,
    reason,
    details,
    metadata
  ) VALUES (
    v_caller_id,
    COALESCE(NULLIF(v_caller_email, ''), 'Administrador Global'),
    v_tenant.id,
    v_tenant_display_name,
    'reactivate_tenant',
    'tenant',
    v_tenant.id::text,
    btrim(p_reason),
    format('Academia reativada com sucesso. Motivo: %s', btrim(p_reason)),
    jsonb_build_object('reason', btrim(p_reason), 'restored_status', v_next_status)
  );

  RETURN jsonb_build_object(
    'success', true,
    'tenant', to_jsonb(v_tenant),
    'subscription', CASE WHEN v_sub.id IS NOT NULL THEN to_jsonb(v_sub) ELSE NULL END,
    'effective_access', public.get_tenant_effective_limits(p_tenant_id)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. CONCEDER PERMISSÕES E RECARREGAR O CACHE DO SCHEMA POSTGREST
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_tenant_effective_limits(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manual_activate_subscription(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_suspend_tenant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_tenant(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
