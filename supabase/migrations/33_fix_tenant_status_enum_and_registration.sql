-- ============================================================================
-- MIGRATION 33: Correção do Erro tenant_status 'expired' e Fluxo de Cadastro de Academias
-- 
-- Causa Raiz:
-- 1. O enum PostgreSQL `public.tenant_status` contém exclusivamente:
--    'trial', 'active', 'suspended', 'canceled'.
-- 2. O valor 'expired' pertence ao status da assinatura (public.saas_subscriptions.status)
--    ou ao estado computado da licença (quando trial_expires_at < now()), NUNCA ao enum
--    do tenant.
-- 3. A função `public.get_tenant_effective_limits(uuid)` continha a cláusula:
--    `ELSIF v_tenant.status = 'expired' OR ...`
--    Como v_tenant.status é do tipo enum `tenant_status`, o PostgreSQL tenta converter
--    a string literal 'expired' para o tipo enum `tenant_status`, disparando:
--    `invalid input value for enum tenant_status: "expired" (SQLSTATE: 22P02)`.
-- 4. Durante o cadastro de uma nova academia na função `public.register_academy_atomic()`,
--    a inserção da filial matriz e do membro owner dispara os gatilhos:
--    - `trg_enforce_tenant_branch_limit` (em public.branches)
--    - `trg_enforce_tenant_user_limit` (em public.tenant_memberships)
--    Ambos chamam `public.get_tenant_effective_limits()`. Ao avaliar o novo tenant
--    com status 'trial', a função percorria as condições até encontrar a comparação
--    com 'expired' e abortava a transação de cadastro inteira.
--
-- Solução Aplicada:
-- 1. Atualizar `get_tenant_effective_limits` para NUNCA comparar `v_tenant.status` com 'expired'.
-- 2. Garantir que `get_tenant_effective_limits` forneça todas as chaves de limites
--    utilizadas pelos gatilhos (`max_branches`, `current_branches`, `max_users`, `current_active_users`).
-- 3. Blindar `register_academy_atomic` para criar o tenant com `status = 'trial'::public.tenant_status`
--    e a assinatura com 10 dias corridos de degustação gratuita, preservando atomicidade.
-- 4. Blindar `admin_reactivate_tenant` para jamais tentar fazer cast de status não-enum para `tenant_status`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ATUALIZAÇÃO SEGURA DE public.get_tenant_effective_limits(uuid)
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
  v_plan public.saas_commercial_plans%ROWTYPE;
  v_effective_status text;
  v_is_allowed boolean := true;
  v_reason text := 'Assinatura regular e ativa.';
  v_active_users integer := 0;
  v_total_branches integer := 0;
  v_total_students integer := 0;
  v_max_users integer := 5;
  v_max_branches integer := 2;
  v_max_students integer := 40;
BEGIN
  -- 1. Buscar dados do tenant
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'is_allowed', false,
      'is_license_valid', false,
      'status', 'not_found',
      'access_state', 'not_found',
      'reason', 'Academia não localizada.',
      'max_branches', 1,
      'current_branches', 0,
      'max_users', 1,
      'current_active_users', 0,
      'max_students', 0,
      'current_students', 0
    );
  END IF;

  -- 2. Buscar dados da assinatura (se existir)
  SELECT * INTO v_sub
  FROM public.saas_subscriptions
  WHERE tenant_id = p_tenant_id
  ORDER BY created_at DESC
  LIMIT 1;

  -- 3. Avaliação de Status Efetivo (Respeitando estritamente o enum tenant_status)
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
  ELSIF v_tenant.status = 'active' AND (v_sub.id IS NULL OR v_sub.status = 'active') AND COALESCE(v_tenant.plan_id, 'trial') <> 'trial' THEN
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
      v_reason := 'Solicitação de plano registrada (aguardando confirmação do Pix). Acesso liberado durante a degustação vigente.';
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

  -- Prioridade 5: Em atraso (past_due)
  ELSIF v_sub.id IS NOT NULL AND v_sub.status = 'past_due' THEN
    v_effective_status := 'past_due';
    v_is_allowed := false;
    v_reason := 'Mensalidade em atraso. Regularize sua assinatura.';

  -- Prioridade 6: Assinatura Expirada (verifica APENAS saas_subscriptions.status, JAMAIS o enum tenant_status)
  ELSIF v_sub.id IS NOT NULL AND v_sub.status = 'expired' THEN
    v_effective_status := 'expired';
    v_is_allowed := false;
    v_reason := 'Licença expirada. Renove seu plano para continuar.';

  -- Prioridade 7: Período de Degustação Gratuita (10 dias)
  ELSIF v_tenant.status = 'trial' OR (v_sub.id IS NOT NULL AND v_sub.status = 'trial') OR COALESCE(v_tenant.plan_id, 'trial') = 'trial' THEN
    IF v_tenant.trial_expires_at IS NOT NULL AND v_tenant.trial_expires_at < now() THEN
      v_effective_status := 'trial_expired';
      v_is_allowed := false;
      v_reason := 'O período de degustação gratuita de 10 dias expirou. Selecione um plano comercial para continuar gerenciando sua academia.';
    ELSE
      v_effective_status := 'trial_active';
      v_is_allowed := true;
      v_reason := 'Período de degustação gratuita de 10 dias ativo.';
    END IF;

  -- Prioridade 8: Fallback Ativo
  ELSIF v_tenant.status = 'active' THEN
    v_effective_status := 'active';
    v_is_allowed := true;
    v_reason := 'Licença ativa.';

  ELSE
    v_effective_status := 'trial_expired';
    v_is_allowed := false;
    v_reason := 'Status da academia não permite novas operações.';
  END IF;

  -- 4. Resolver limites do plano comercial ou de teste
  SELECT * INTO v_plan
  FROM public.saas_commercial_plans
  WHERE id = COALESCE(v_sub.plan_id, v_tenant.plan_id, 'trial');

  -- Valores padrão por tipo de plano
  IF COALESCE(v_sub.plan_id, v_tenant.plan_id, 'trial') = 'trial' THEN
    v_max_users := COALESCE(v_sub.custom_max_users, v_plan.max_users, 5);
    v_max_branches := COALESCE(v_sub.custom_max_branches, v_plan.max_branches, 2);
    v_max_students := COALESCE(v_sub.custom_max_students, v_plan.max_students, 40);
  ELSE
    v_max_users := COALESCE(v_sub.custom_max_users, v_plan.max_users, 10);
    v_max_branches := COALESCE(v_sub.custom_max_branches, v_plan.max_branches, 5);
    v_max_students := COALESCE(v_sub.custom_max_students, v_plan.max_students, 500);
  END IF;

  -- 5. Contadores atuais do tenant
  SELECT count(DISTINCT user_id) INTO v_active_users
  FROM public.tenant_memberships
  WHERE tenant_id = p_tenant_id AND status = 'active';

  SELECT count(*) INTO v_total_branches
  FROM public.branches
  WHERE tenant_id = p_tenant_id;

  SELECT count(*) INTO v_total_students
  FROM public.students
  WHERE tenant_id = p_tenant_id;

  -- 6. Retornar payload unificado compatível com gatilhos e frontend
  RETURN jsonb_build_object(
    'is_allowed', v_is_allowed,
    'is_license_valid', v_is_allowed,
    'status', v_effective_status,
    'access_state', v_effective_status,
    'reason', v_reason,
    'plan_id', COALESCE(v_plan.id, v_tenant.plan_id, 'trial'),
    'plan_name', COALESCE(v_plan.name, 'Degustação Gratuita (10 Dias)'),
    'tenant_status', v_tenant.status,
    'subscription_status', v_sub.status,
    'trial_expires_at', v_tenant.trial_expires_at,
    'current_period_end', v_sub.current_period_end,
    'max_users', v_max_users,
    'current_active_users', v_active_users,
    'is_users_limit_reached', (v_active_users >= v_max_users),
    'max_branches', v_max_branches,
    'current_branches', v_total_branches,
    'is_branches_limit_reached', (v_total_branches >= v_max_branches),
    'max_students', v_max_students,
    'current_students', v_total_students,
    'is_students_limit_reached', (v_total_students >= v_max_students),
    'max_team_users', v_max_users
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. ATUALIZAÇÃO SEGURA DA FUNÇÃO ATÔMICA DE CADASTRO DE ACADEMIA
--    register_academy_atomic(...)
-- ----------------------------------------------------------------------------
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

  -- 3. Garantir perfil público do usuário (sem conceder is_platform_admin aqui)
  INSERT INTO public.profiles (id, full_name, phone, is_platform_admin)
  VALUES (v_user_id, trim(p_admin_name), p_phone, false)
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      phone = COALESCE(EXCLUDED.phone, public.profiles.phone);

  -- 4. Criar novo tenant exclusivo com status 'trial'::public.tenant_status
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
    'trial'::public.tenant_status,
    v_trial_start,
    v_trial_end
  )
  RETURNING id INTO v_tenant_id;

  -- 5. Criar assinatura de teste vinculada à nova academia (10 dias de degustação gratuita)
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
    grace_period_days,
    created_at,
    updated_at
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
    5,
    now(),
    now()
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

  -- 8. Criar modalidades iniciais padrão exclusivas do novo tenant
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
  BEGIN
    INSERT INTO public.audit_logs (
      tenant_id, user_id, user_name, action, entity, entity_id, details
    ) VALUES (
      v_tenant_id, v_user_id, trim(p_admin_name), 'Criação de Academia', 'Tenant', v_tenant_id::text,
      'Academia criada no Tatame Club com filial matriz e 10 dias de avaliação gratuita ativados.'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Falha ao registrar audit_logs: %', SQLERRM;
  END;

  BEGIN
    INSERT INTO public.platform_audit_logs (
      id, actor_user_id, actor_user_name, action, entity_type, entity_id, tenant_id, tenant_name, details, timestamp
    ) VALUES (
      gen_random_uuid(), v_user_id, trim(p_admin_name), 'register_tenant', 'tenant', v_tenant_id::text, v_tenant_id, trim(p_trade_name),
      'Nova academia cadastrada com licença de teste de 10 dias (início: ' || to_char(v_trial_start, 'DD/MM/YYYY') || ', término: ' || to_char(v_trial_end, 'DD/MM/YYYY') || ').',
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Falha ao registrar platform_audit_logs: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'tenant_id', v_tenant_id,
    'branch_id', v_branch_id,
    'membership_id', v_membership_id,
    'subscription_id', v_subscription_id,
    'role', 'owner',
    'plan_id', 'trial',
    'status', 'trial',
    'trial_started_at', v_trial_start,
    'trial_expires_at', v_trial_end,
    'message', 'Academia cadastrada com sucesso e licença de teste de 10 dias ativada.'
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. REATIVAÇÃO SEGURA DE ACADEMIA (NUNCA ATRIBUI STATUS INVÁLIDO AO ENUM)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reactivate_tenant(
  p_tenant_id uuid,
  p_reason text DEFAULT 'Reativação administrativa pelo painel'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_email text;
  v_tenant public.tenants%ROWTYPE;
  v_sub public.saas_subscriptions%ROWTYPE;
  v_next_tenant_status public.tenant_status;
  v_tenant_display_name text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NOT NULL THEN
    SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;
  END IF;

  IF NOT (
    (v_caller_id IS NOT NULL AND public.is_platform_admin()) OR
    (v_caller_email = 'beaverstraining@gmail.com') OR
    (COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role')
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas Administradores Globais podem reativar academias.'
      USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'O identificador da academia (p_tenant_id) é obrigatório.';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo da reativação (mínimo de 5 caracteres).';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Academia com ID % não encontrada.', p_tenant_id USING ERRCODE = 'P0002';
  END IF;

  -- Determinar o status do tenant estritamente como valor válido do enum tenant_status
  IF v_tenant.trial_expires_at IS NOT NULL AND v_tenant.trial_expires_at > now() THEN
    v_next_tenant_status := 'trial'::public.tenant_status;
  ELSE
    v_next_tenant_status := 'active'::public.tenant_status;
  END IF;

  -- 1. Atualizar status na tabela tenants
  UPDATE public.tenants
  SET
    status = v_next_tenant_status,
    updated_at = now()
  WHERE id = p_tenant_id
  RETURNING * INTO v_tenant;

  v_tenant_display_name := COALESCE(NULLIF(btrim(v_tenant.trade_name), ''), NULLIF(btrim(v_tenant.legal_name), ''), 'Academia');

  -- 2. Limpar suspensão na tabela saas_subscriptions
  UPDATE public.saas_subscriptions
  SET
    status = CASE WHEN v_next_tenant_status = 'trial' THEN 'trial' ELSE 'active' END,
    suspended_at = NULL,
    suspended_reason = NULL,
    updated_at = now()
  WHERE tenant_id = p_tenant_id;

  -- 3. Registrar auditoria em platform_audit_logs
  BEGIN
    INSERT INTO public.platform_audit_logs (
      id,
      actor_user_id,
      actor_user_name,
      tenant_id,
      tenant_name,
      action,
      entity_type,
      entity_id,
      reason,
      details,
      metadata,
      timestamp
    ) VALUES (
      gen_random_uuid(),
      v_caller_id,
      COALESCE(v_caller_email, 'Administrador Global'),
      p_tenant_id,
      v_tenant_display_name,
      'TENANT_REACTIVATE',
      'tenant',
      p_tenant_id::text,
      btrim(p_reason),
      'Academia reativada com status ' || v_next_tenant_status::text || '. Suspensão revogada.',
      jsonb_build_object(
        'reactivated_at', now(),
        'reason', btrim(p_reason),
        'tenant_status', v_next_tenant_status::text
      ),
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Falha ao registrar auditoria em platform_audit_logs: %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'tenant_id', p_tenant_id,
    'trade_name', v_tenant.trade_name,
    'status', v_next_tenant_status::text,
    'reason', btrim(p_reason),
    'effective_access', public.get_tenant_effective_limits(p_tenant_id)
  );
END;
$$;

-- Permissões de execução
GRANT EXECUTE ON FUNCTION public.get_tenant_effective_limits(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_effective_limits(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.register_academy_atomic(text, text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_tenant(uuid, text) TO authenticated;

-- Recarregar cache de esquema do PostgREST
NOTIFY pgrst, 'reload schema';
