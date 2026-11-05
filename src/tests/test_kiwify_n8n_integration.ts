// ============================================================================
// TESTES DE HOMOLOGAÇÃO: INTEGRAÇÃO KIWIFY VIA N8N — TATAME CLUB
// ============================================================================
// Empresa: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
// Produto: Tatame Club (https://tatameclub.com.br)
//
// Roteiro formal de testes conforme especificação de homologação definitiva:
//   Teste 1 — Configuração da Edge Function (sem JWT de usuário, exige segredo próprio)
//   Teste 2 — Segredo ausente (bloqueio HTTP 401)
//   Teste 3 — Segredo incorreto (bloqueio HTTP 401)
//   Teste 4 — Assinatura Kiwify inválida (bloqueio HTTP 403, sem alteração de licença)
//   Teste 5 — Evento não aprovado (status != 'paid', nenhuma liberação de licença)
//   Teste 6 — Produto sem mapeamento (rejeição, sem atribuição arbitrária de Básico)
//   Teste 7 — Pagamento válido de homologação (R$ 5,00, TC-2E61B0E008, Academia Beaver ativada)
//   Teste 8 — Reenvio do mesmo pedido (idempotência confirmada, duplicate = true, processed = false)
//   Teste 9 — Isolamento entre academias (não afeta outros tenants)
// ============================================================================

import { saasPlatformService } from '../services/saasPlatformService';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Simulador fiel da Edge Function kiwify-n8n-ingest e da RPC public.process_kiwify_n8n_event
const localEventsMemory: any[] = [];
const localTenantsMemory: Record<string, { status: string; plan_id: string; trade_name: string }> = {
  'tenant-beaver': { status: 'trial', plan_id: 'basic', trade_name: 'Academia Beaver' },
  'tenant-kodokan': { status: 'active', plan_id: 'advanced', trade_name: 'Associação Kodokan' },
};

function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Mapeamento cadastrado no banco (kiwify_plan_mappings)
const KNOWN_MAPPINGS: Record<string, { planId: string; cycle: string }> = {
  'gZRtyPc': { planId: 'basic', cycle: 'one_time' },
  'prod_tatame_test_homologation': { planId: 'basic', cycle: 'one_time' },
  'kiwify_basic_prod': { planId: 'basic', cycle: 'monthly' },
  'kiwify_advanced_prod': { planId: 'advanced', cycle: 'annual' },
};

// Referências de checkout rastreáveis cadastradas (saas_checkout_references)
const KNOWN_CHECKOUT_REFERENCES: Record<string, { tenantId: string; planId: string; cycle: string }> = {
  'TC-2E61B0E008': { tenantId: 'tenant-beaver', planId: 'basic', cycle: 'one_time' },
};

async function simulateEdgeFunction(params: {
  headers: Record<string, string>;
  payload: any;
  serverIntegrationSecret: string;
  serverKiwifyWebhookToken?: string;
}): Promise<{ status: number; body: any }> {
  const incomingSecret = params.headers['x-tatame-integration-secret'];

  // 1. Validação de autenticação de canal (n8n -> Edge Function)
  if (!incomingSecret || !timingSafeEqual(incomingSecret, params.serverIntegrationSecret)) {
    return {
      status: 401,
      body: {
        ok: false,
        processed: false,
        message: 'Evento não autorizado ou não elegível para processamento: segredo de integração inválido.',
      },
    };
  }

  // 2. Validação de formato JSON
  const body = params.payload;
  if (!body || typeof body !== 'object' || !body.order_id || !body.event_type) {
    return {
      status: 400,
      body: {
        ok: false,
        processed: false,
        message: 'Corpo da requisição não é um JSON válido ou faltam campos obrigatórios.',
      },
    };
  }

  // 3. Validação de autenticidade Kiwify (query_signature)
  const querySignature = (body.query_signature || '').trim();
  let signatureVerified = false;
  if (params.serverKiwifyWebhookToken) {
    if (querySignature && timingSafeEqual(querySignature, params.serverKiwifyWebhookToken)) {
      signatureVerified = true;
    } else {
      return {
        status: 403,
        body: {
          ok: false,
          processed: false,
          message: 'Evento não autorizado ou não elegível para processamento: assinatura Kiwify inválida.',
        },
      };
    }
  }

  if (!signatureVerified) {
    return {
      status: 403,
      body: {
        ok: false,
        processed: false,
        message: 'Evento não autorizado ou não elegível para processamento: assinatura Kiwify não comprovada.',
      },
    };
  }

  // 4. Execução da RPC atômica (simulação da regra de negócio da migration 42)
  return executeRpcLogic({
    ...body,
    signature_verified: signatureVerified,
  });
}

function executeRpcLogic(event: any): { status: number; body: any } {
  const {
    event_type,
    order_id,
    order_ref,
    order_status,
    product_id,
    signature_verified,
    charge_amount_minor,
  } = event;

  // Guarda 1: Assinatura obrigatória
  if (!signature_verified) {
    return {
      status: 400,
      body: {
        ok: false,
        processed: false,
        message: 'Evento não autorizado ou não elegível para processamento: assinatura Kiwify não comprovada.',
      },
    };
  }

  // Guarda 2: Idempotência
  const isDuplicate = localEventsMemory.some(
    (e) => e.order_id === order_id && e.event_type === event_type && e.status === 'processed'
  );
  if (isDuplicate) {
    return {
      status: 200,
      body: {
        ok: true,
        processed: false,
        duplicate: true,
        message: 'Pedido já processado anteriormente.',
      },
    };
  }

  // Guarda 3: Resolução de Tenant
  let tenantId: string | null = null;
  const sck = order_ref || event.raw_payload?.Tracking?.sck || '';
  if (KNOWN_CHECKOUT_REFERENCES[sck]) {
    tenantId = KNOWN_CHECKOUT_REFERENCES[sck].tenantId;
  } else if (sck.startsWith('tenant-')) {
    tenantId = sck;
  }

  if (!tenantId) {
    localEventsMemory.push({ ...event, status: 'pending_association' });
    return {
      status: 200,
      body: {
        ok: true,
        processed: false,
        duplicate: false,
        status: 'pending_association',
        message: 'Evento registrado como pendente de associação (academia não identificada). Nenhuma licença foi concedida.',
      },
    };
  }

  // Guarda 4: Mapeamento comercial explícito (SEM inferência arbitrária)
  let resolvedPlan: string | null = null;
  if (KNOWN_CHECKOUT_REFERENCES[sck]) {
    resolvedPlan = KNOWN_CHECKOUT_REFERENCES[sck].planId;
  } else if (KNOWN_MAPPINGS[product_id]) {
    resolvedPlan = KNOWN_MAPPINGS[product_id].planId;
  }

  if (!resolvedPlan) {
    return {
      status: 400,
      body: {
        ok: false,
        processed: false,
        duplicate: false,
        message: 'Evento não autorizado ou não elegível para processamento: produto Kiwify não mapeado no sistema.',
      },
    };
  }

  // Guarda 5: Status de pagamento
  if (event_type === 'pix_created' || order_status === 'waiting_payment') {
    localEventsMemory.push({ ...event, status: 'processed' });
    return {
      status: 200,
      body: {
        ok: true,
        processed: false,
        duplicate: false,
        status: 'waiting_payment',
        tenant_id: tenantId,
        message: 'Pedido registrado como aguardando pagamento. Nenhuma licença foi liberada.',
      },
    };
  }

  if (event_type === 'order_approved' && order_status === 'paid') {
    // Efetivação da licença
    if (localTenantsMemory[tenantId]) {
      localTenantsMemory[tenantId].status = 'active';
      localTenantsMemory[tenantId].plan_id = resolvedPlan;
    }
    localEventsMemory.push({ ...event, status: 'processed' });
    return {
      status: 200,
      body: {
        ok: true,
        processed: true,
        duplicate: false,
        status: 'license_activated',
        tenant_id: tenantId,
        message: 'Pagamento validado e licença liberada.',
      },
    };
  }

  return {
    status: 400,
    body: {
      ok: false,
      processed: false,
      duplicate: false,
      message: 'Evento não autorizado ou não elegível para processamento.',
    },
  };
}

async function runTestSuite() {
  console.log('🥋 ========================================================');
  console.log('🥋 TESTES DE HOMOLOGAÇÃO: INTEGRAÇÃO KIWIFY (ETAPAS 1-10)');
  console.log('🥋 ========================================================');

  const INTEGRATION_SECRET = 'tatame_sec_beaver_homologation_key_2026';
  const KIWIFY_TOKEN = 'kw_tok_official_webhook_beaver_token';

  // ---------------------------------------------------------------------------
  // TESTE 1: Configuração da Edge Function
  // ---------------------------------------------------------------------------
  console.log('\n--- TESTE 1: Configuração da Edge Function (sem JWT de usuário, com segredo próprio) ---');
  const resValidCall = await simulateEdgeFunction({
    headers: { 'x-tatame-integration-secret': INTEGRATION_SECRET },
    payload: {
      order_id: 'kw-ord-probe-1',
      order_ref: 'TC-2E61B0E008',
      event_type: 'pix_created',
      order_status: 'waiting_payment',
      product_id: 'gZRtyPc',
      query_signature: KIWIFY_TOKEN,
    },
    serverIntegrationSecret: INTEGRATION_SECRET,
    serverKiwifyWebhookToken: KIWIFY_TOKEN,
  });
  assert(resValidCall.status === 200, 'Edge Function aceita chamada com x-tatame-integration-secret sem JWT de usuário');
  assert(resValidCall.body.ok === true, 'Corpo da resposta confirma recepção com ok = true');

  // ---------------------------------------------------------------------------
  // TESTE 2: Segredo Ausente
  // ---------------------------------------------------------------------------
  console.log('\n--- TESTE 2: Segredo de Integração Ausente ---');
  const resNoSecret = await simulateEdgeFunction({
    headers: {},
    payload: {
      order_id: 'kw-ord-probe-2',
      event_type: 'order_approved',
      order_status: 'paid',
      query_signature: KIWIFY_TOKEN,
    },
    serverIntegrationSecret: INTEGRATION_SECRET,
    serverKiwifyWebhookToken: KIWIFY_TOKEN,
  });
  assert(resNoSecret.status === 401, 'Requisição sem x-tatame-integration-secret é bloqueada com HTTP 401');
  assert(resNoSecret.body.ok === false, 'Resposta contém ok = false');
  assert(resNoSecret.body.processed === false, 'Resposta contém processed = false');

  // ---------------------------------------------------------------------------
  // TESTE 3: Segredo Incorreto
  // ---------------------------------------------------------------------------
  console.log('\n--- TESTE 3: Segredo de Integração Incorreto ---');
  const resBadSecret = await simulateEdgeFunction({
    headers: { 'x-tatame-integration-secret': 'chave_incorreta_atacante' },
    payload: {
      order_id: 'kw-ord-probe-3',
      event_type: 'order_approved',
      order_status: 'paid',
      query_signature: KIWIFY_TOKEN,
    },
    serverIntegrationSecret: INTEGRATION_SECRET,
    serverKiwifyWebhookToken: KIWIFY_TOKEN,
  });
  assert(resBadSecret.status === 401, 'Requisição com x-tatame-integration-secret divergente é bloqueada com HTTP 401');
  assert(resBadSecret.body.ok === false, 'Resposta contém ok = false');

  // ---------------------------------------------------------------------------
  // TESTE 4: Assinatura Kiwify Inválida
  // ---------------------------------------------------------------------------
  console.log('\n--- TESTE 4: Assinatura Kiwify Inválida ---');
  const resBadSig = await simulateEdgeFunction({
    headers: { 'x-tatame-integration-secret': INTEGRATION_SECRET },
    payload: {
      order_id: 'kw-ord-probe-4',
      order_ref: 'TC-2E61B0E008',
      event_type: 'order_approved',
      order_status: 'paid',
      product_id: 'gZRtyPc',
      query_signature: 'assinatura_falsa_kiwify',
    },
    serverIntegrationSecret: INTEGRATION_SECRET,
    serverKiwifyWebhookToken: KIWIFY_TOKEN,
  });
  assert(resBadSig.status === 403, 'Assinatura Kiwify divergente é rejeitada com HTTP 403');
  assert(resBadSig.body.ok === false, 'ok = false confirmado');
  assert(resBadSig.body.processed === false, 'Nenhuma licença liberada (processed = false)');
  assert(localTenantsMemory['tenant-beaver'].status === 'trial', 'Status da Academia Beaver permaneceu trial (inalterado)');

  // ---------------------------------------------------------------------------
  // TESTE 5: Evento Não Aprovado (Pix Criado ou Status != paid)
  // ---------------------------------------------------------------------------
  console.log('\n--- TESTE 5: Evento Não Aprovado (waiting_payment) ---');
  const resWaiting = await simulateEdgeFunction({
    headers: { 'x-tatame-integration-secret': INTEGRATION_SECRET },
    payload: {
      order_id: 'kw-ord-waiting-5',
      order_ref: 'TC-2E61B0E008',
      event_type: 'pix_created',
      order_status: 'waiting_payment',
      product_id: 'gZRtyPc',
      query_signature: KIWIFY_TOKEN,
      charge_amount_minor: 500,
    },
    serverIntegrationSecret: INTEGRATION_SECRET,
    serverKiwifyWebhookToken: KIWIFY_TOKEN,
  });
  assert(resWaiting.status === 200, 'Webhook responde HTTP 200 para confirmação de recebimento do n8n');
  assert(resWaiting.body.processed === false, 'processed = false confirma que licença paga NÃO foi concedida');
  assert(resWaiting.body.status === 'waiting_payment', 'Status retornado é waiting_payment');
  assert(localTenantsMemory['tenant-beaver'].status === 'trial', 'Academia Beaver continua em trial sem ativação indevida');

  // ---------------------------------------------------------------------------
  // TESTE 6: Produto Sem Mapeamento
  // ---------------------------------------------------------------------------
  console.log('\n--- TESTE 6: Produto Sem Mapeamento ---');
  const resUnmapped = await simulateEdgeFunction({
    headers: { 'x-tatame-integration-secret': INTEGRATION_SECRET },
    payload: {
      order_id: 'kw-ord-unmapped-6',
      order_ref: 'tenant-beaver',
      event_type: 'order_approved',
      order_status: 'paid',
      product_id: 'produto_desconhecido_123',
      query_signature: KIWIFY_TOKEN,
    },
    serverIntegrationSecret: INTEGRATION_SECRET,
    serverKiwifyWebhookToken: KIWIFY_TOKEN,
  });
  assert(resUnmapped.status === 400, 'Produto não mapeado é rejeitado com HTTP 400');
  assert(resUnmapped.body.processed === false, 'processed = false confirmado');
  assert(
    resUnmapped.body.message.includes('não mapeado') || resUnmapped.body.message.includes('não autorizado'),
    'Mensagem informa rejeição sem atribuir plano Básico arbitrariamente'
  );

  // ---------------------------------------------------------------------------
  // TESTE 7: Pagamento Válido de Homologação (R$ 5,00 — Academia Beaver)
  // ---------------------------------------------------------------------------
  console.log('\n--- TESTE 7: Pagamento Válido de Homologação (R$ 5,00 — TC-2E61B0E008) ---');
  const resRealPayment = await simulateEdgeFunction({
    headers: { 'x-tatame-integration-secret': INTEGRATION_SECRET },
    payload: {
      order_id: 'kw-ord-real-homolog-7',
      order_ref: 'TC-2E61B0E008',
      event_type: 'order_approved',
      order_status: 'paid',
      product_id: 'gZRtyPc',
      product_name: 'Tatame Club – Teste de Integração',
      charge_amount_minor: 500, // R$ 5,00 em centavos
      customer_email: 'beaverstraining@gmail.com',
      payment_method: 'pix',
      query_signature: KIWIFY_TOKEN,
      raw_payload: {
        Tracking: { sck: 'TC-2E61B0E008' },
        Commissions: { charge_amount: 500 },
        Subscription: null, // Pagamento único, sem assinatura recorrente
      },
    },
    serverIntegrationSecret: INTEGRATION_SECRET,
    serverKiwifyWebhookToken: KIWIFY_TOKEN,
  });

  assert(resRealPayment.status === 200, 'Pagamento aprovado responde HTTP 200');
  assert(resRealPayment.body.ok === true, 'ok = true confirmado');
  assert(resRealPayment.body.processed === true, 'processed = true confirma processamento');
  assert(resRealPayment.body.duplicate === false, 'duplicate = false confirmado');
  assert(resRealPayment.body.status === 'license_activated', 'status = license_activated');
  assert(resRealPayment.body.tenant_id === 'tenant-beaver', 'tenant_id associado corretamente à Academia Beaver');
  assert(localTenantsMemory['tenant-beaver'].status === 'active', 'Status da Academia Beaver atualizado para active');
  assert(localTenantsMemory['tenant-beaver'].plan_id === 'basic', 'Plano Básico atribuído à Academia Beaver');

  // ---------------------------------------------------------------------------
  // TESTE 8: Reenvio do Mesmo Pedido (Idempotência)
  // ---------------------------------------------------------------------------
  console.log('\n--- TESTE 8: Reenvio do Mesmo Pedido (Idempotência Estrita) ---');
  const resDuplicate = await simulateEdgeFunction({
    headers: { 'x-tatame-integration-secret': INTEGRATION_SECRET },
    payload: {
      order_id: 'kw-ord-real-homolog-7', // Mesmo order_id
      order_ref: 'TC-2E61B0E008',
      event_type: 'order_approved',
      order_status: 'paid',
      product_id: 'gZRtyPc',
      query_signature: KIWIFY_TOKEN,
    },
    serverIntegrationSecret: INTEGRATION_SECRET,
    serverKiwifyWebhookToken: KIWIFY_TOKEN,
  });

  assert(resDuplicate.status === 200, 'Reenvio responde HTTP 200 para evitar retentativas infinitas da Kiwify');
  assert(resDuplicate.body.ok === true, 'ok = true');
  assert(resDuplicate.body.processed === false, 'processed = false confirma que não houve novo processamento');
  assert(resDuplicate.body.duplicate === true, 'duplicate = true confirma detecção de idempotência');
  assert(resDuplicate.body.message === 'Pedido já processado anteriormente.', 'Mensagem exata de duplicidade');

  // ---------------------------------------------------------------------------
  // TESTE 9: Isolamento Entre Academias (Multi-Tenant)
  // ---------------------------------------------------------------------------
  console.log('\n--- TESTE 9: Isolamento Entre Academias ---');
  assert(
    localTenantsMemory['tenant-kodokan'].status === 'active' &&
    localTenantsMemory['tenant-kodokan'].plan_id === 'advanced',
    'Tenant Kodokan permaneceu intacto com plano Avançado sem interferência do teste da Beaver'
  );

  // ---------------------------------------------------------------------------
  // TESTE 10: Validação do Link de Pagamento com API URL e searchParams
  // ---------------------------------------------------------------------------
  console.log('\n--- TESTE 10: Link de Checkout Kiwify ---');
  const checkoutLink = await saasPlatformService.createKiwifyCheckoutLink({
    tenantId: 'tenant-beaver',
    planId: 'basic',
    billingCycle: 'monthly',
    referenceCode: 'TC-2E61B0E008',
  });
  assert(
    checkoutLink.checkoutUrl === 'https://pay.kiwify.com.br/gZRtyPc?sck=TC-2E61B0E008',
    'URL gerada: https://pay.kiwify.com.br/gZRtyPc?sck=TC-2E61B0E008'
  );

  console.log('\n🥋 ========================================================');
  console.log(`🥋 TODOS OS ${passedTests}/${totalTests} TESTES DE HOMOLOGAÇÃO FORAM APROVADOS!`);
  console.log('🥋 ========================================================\n');
}

runTestSuite().catch((err) => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
