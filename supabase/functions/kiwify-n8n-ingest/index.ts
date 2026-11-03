// ============================================================================
// SUPABASE EDGE FUNCTION: kiwify-n8n-ingest
// ============================================================================
// Produto: Tatame Club (https://tatameclub.com.br)
// Empresa: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
//
// Arquitetura:
//   Kiwify -> n8n -> Supabase Edge Function (kiwify-n8n-ingest) -> Supabase PostgreSQL -> Tatame Club
//
// Endpoint Oficial:
//   POST https://knmzzndugadmklzzgtaa.supabase.co/functions/v1/kiwify-n8n-ingest
//
// Autenticação de Comunicação (n8n -> Edge Function):
//   Header obrigatório: 'x-tatame-integration-secret'
//   Comparado contra o Supabase Secret: 'TATAME_INTEGRATION_SECRET'
//
// Validação de Autenticidade da Origem (Kiwify -> n8n -> Edge Function):
//   Validado contra o Supabase Secret: 'KIWIFY_WEBHOOK_TOKEN'
//   Verifica se query_signature coincide com o token oficial da Kiwify ou hash HMAC-SHA1
//
// Required Supabase Secrets:
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - TATAME_INTEGRATION_SECRET (segredo compartilhado exclusivamente entre n8n e Tatame Club)
//   - KIWIFY_WEBHOOK_TOKEN (token de autenticação fornecido na configuração de webhooks da Kiwify)
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tatame-integration-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Algoritmo de validação de HMAC-SHA1 para assinaturas de webhook quando aplicável
async function verifyHmacSha1(secret: string, bodyText: string, expectedHexSignature: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(bodyText));
    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const calculatedHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase();
    return calculatedHex === expectedHexSignature.toLowerCase();
  } catch (_e) {
    return false;
  }
}

// Algoritmo de comparação segura em tempo constante
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

Deno.serve(async (req: Request) => {
  // Tratar requisições CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Método HTTP não permitido. Utilize POST.',
      }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const integrationSecret = Deno.env.get('TATAME_INTEGRATION_SECRET') ?? '';
  const kiwifyWebhookToken = Deno.env.get('KIWIFY_WEBHOOK_TOKEN') ?? '';

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Configuração interna do Supabase ausente (SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY).',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 1. AUTENTICAÇÃO DO CANAL N8N -> SUPABASE EDGE FUNCTION
  // Verifica o header x-tatame-integration-secret
  const incomingIntegrationSecret = req.headers.get('x-tatame-integration-secret') || '';

  if (!integrationSecret) {
    console.error('[kiwify-n8n-ingest] ERRO CRÍTICO: Segredo TATAME_INTEGRATION_SECRET não configurado nos secrets do Supabase.');
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'MISSING_SERVER_SECRET',
        error: 'Segredo de integração TATAME_INTEGRATION_SECRET não configurado na Edge Function.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!incomingIntegrationSecret || !timingSafeEqual(incomingIntegrationSecret, integrationSecret)) {
    console.warn('[kiwify-n8n-ingest] Tentativa de chamada não autorizada: x-tatame-integration-secret inválido ou ausente.');
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'UNAUTHORIZED_INTEGRATION',
        error: 'Acesso negado: header x-tatame-integration-secret inválido ou ausente.',
      }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // 2. PARSE E VALIDAÇÃO DO CORPO DA REQUISIÇÃO (CONTRATO JSON N8N)
  let body: any;
  let rawBodyText = '';
  try {
    rawBodyText = await req.text();
    body = JSON.parse(rawBodyText);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'INVALID_JSON',
        error: 'Corpo da requisição não é um JSON válido: ' + (err?.message || ''),
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!body || typeof body !== 'object') {
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'EMPTY_PAYLOAD',
        error: 'Payload vazio ou em formato inválido.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const querySignature = (body.query_signature || '').trim();
  const rawBodyFromN8n = body.raw_body || '';
  let signatureVerified = false;

  // 3. VALIDAÇÃO EFETIVA DA ORIGEM KIWIFY
  // A Kiwify envia na query string ?signature=<token_ou_hmac>
  if (kiwifyWebhookToken) {
    // 3.1 Verificação padrão Kiwify: query_signature coincide diretamente com o Webhook Token
    if (querySignature && timingSafeEqual(querySignature, kiwifyWebhookToken)) {
      signatureVerified = true;
    }
    // 3.2 Verificação HMAC-SHA1 alternativa se o n8n tiver fornecido os bytes/texto bruto
    else if (querySignature && rawBodyFromN8n && (await verifyHmacSha1(kiwifyWebhookToken, rawBodyFromN8n, querySignature))) {
      signatureVerified = true;
    } else {
      console.warn(`[kiwify-n8n-ingest] Assinatura Kiwify divergente do segredo KIWIFY_WEBHOOK_TOKEN configurado.`);
      return new Response(
        JSON.stringify({
          ok: false,
          code: 'INVALID_KIWIFY_SIGNATURE',
          error: 'Falha na validação de autenticidade da Kiwify: query_signature não coincide com o token configurado.',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } else {
    // Aviso de auditoria caso o token da Kiwify ainda não tenha sido cadastrado nos secrets do Supabase
    console.warn('[kiwify-n8n-ingest] AVISO: KIWIFY_WEBHOOK_TOKEN não definido nos secrets do Supabase. A autenticação baseou-se exclusivamente no x-tatame-integration-secret.');
    signatureVerified = false;
  }

  // 4. PREPARAR OBJETO NORMALIZADO PARA INGESTÃO ATÔMICA NO BANCO
  const eventPayload = {
    source: body.source || 'kiwify-n8n',
    received_at: body.received_at || new Date().toISOString(),
    event_type: body.event_type || '',
    order_id: body.order_id || '',
    order_ref: body.order_ref || '',
    order_status: body.order_status || '',
    product_type: body.product_type || '',
    product_id: body.product_id || '',
    product_name: body.product_name || '',
    subscription_id: body.subscription_id || '',
    subscription_status: body.subscription_status || '',
    subscription_start_date: body.subscription_start_date || '',
    subscription_next_payment: body.subscription_next_payment || '',
    plan_id: body.plan_id || '',
    plan_name: body.plan_name || '',
    plan_frequency: body.plan_frequency || '',
    plan_qty_charges: body.plan_qty_charges !== undefined ? body.plan_qty_charges : null,
    customer_email: body.customer_email || '',
    payment_method: body.payment_method || '',
    approved_date: body.approved_date || '',
    refunded_at: body.refunded_at || '',
    charge_amount_minor: body.charge_amount_minor !== undefined ? body.charge_amount_minor : null,
    product_base_price_minor: body.product_base_price_minor !== undefined ? body.product_base_price_minor : null,
    settlement_amount_minor: body.settlement_amount_minor !== undefined ? body.settlement_amount_minor : null,
    query_signature: querySignature,
    signature_verified: signatureVerified,
    raw_payload: body.raw_payload || body,
    raw_headers: body.raw_headers || null,
  };

  // 5. EXECUTAR RPC ATÔMICA TRANSACTIONAL NO SUPABASE POSTGRESQL
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  try {
    const { data, error } = await supabase.rpc('process_kiwify_n8n_event', {
      p_event: eventPayload,
    });

    if (error) {
      console.error('[kiwify-n8n-ingest] Erro na execução da RPC process_kiwify_n8n_event:', error);
      return new Response(
        JSON.stringify({
          ok: false,
          code: 'DB_PROCESSING_ERROR',
          error: 'Falha interna ao persistir o evento no banco de dados: ' + error.message,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Se o banco retornou sucesso (processado, duplicado ou pendente de associação)
    if (data?.ok) {
      return new Response(
        JSON.stringify({
          ok: true,
          processed: Boolean(data.processed),
          duplicate: Boolean(data.duplicate),
          status: data.status,
          event_type: data.event_type || body.event_type,
          order_id: data.order_id || body.order_id,
          tenant_id: data.tenant_id,
          message: data.message || 'Evento Kiwify processado com sucesso.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Se o banco retornou erro estruturado (ex: campos obrigatórios ausentes)
    return new Response(
      JSON.stringify({
        ok: false,
        code: data?.code || 'VALIDATION_FAILED',
        error: data?.error || 'Não foi possível validar o evento recebido.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[kiwify-n8n-ingest] Exceção não tratada:', err);
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'INTERNAL_EXCEPTION',
        error: 'Erro inesperado no processamento do evento: ' + (err?.message || ''),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
