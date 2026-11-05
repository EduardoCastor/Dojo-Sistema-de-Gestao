// ============================================================================
// SUPABASE EDGE FUNCTION: kiwify-n8n-ingest
// ============================================================================
// Produto: Tatame Club (https://tatameclub.com.br)
// Empresa: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
//
// Arquitetura:
//   Kiwify -> n8n -> Supabase Edge Function (kiwify-n8n-ingest) -> PostgreSQL RPC -> Tatame Club
//
// Endpoint Oficial:
//   POST https://knmzzndugadmklzzgtaa.supabase.co/functions/v1/kiwify-n8n-ingest
//
// Configuração JWT (supabase/config.toml):
//   [functions.kiwify-n8n-ingest]
//   verify_jwt = false
//
// Autenticação de Comunicação (n8n -> Edge Function):
//   Header obrigatório: 'x-tatame-integration-secret'
//   Comparado contra o Supabase Secret: 'TATAME_INTEGRATION_SECRET'
//
// Validação de Autenticidade da Origem (Kiwify -> n8n -> Edge Function):
//   Validado contra o Supabase Secret: 'KIWIFY_WEBHOOK_TOKEN'
//   Compara query_signature (recebido via ?signature=...) usando timingSafeEqual ou HMAC-SHA1
//
// Required Supabase Secrets:
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - TATAME_INTEGRATION_SECRET (segredo de canal n8n -> Supabase)
//   - KIWIFY_WEBHOOK_TOKEN (token de autenticação de webhooks da Kiwify)
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tatame-integration-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Algoritmo de validação de HMAC-SHA1 para assinaturas de webhook Kiwify
async function verifyHmacSha1(secret: string, bodyText: string, expectedHexSignature: string): Promise<boolean> {
  try {
    if (!secret || !bodyText || !expectedHexSignature) return false;
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
    return timingSafeEqual(calculatedHex, expectedHexSignature.toLowerCase());
  } catch (_e) {
    return false;
  }
}

// Algoritmo de comparação segura em tempo constante (evita timing attacks)
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
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
        processed: false,
        message: 'Método HTTP não permitido. Utilize POST.',
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
        processed: false,
        message: 'Configuração interna do Supabase ausente.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // --------------------------------------------------------------------------
  // 1. AUTENTICAÇÃO DO CANAL N8N -> SUPABASE EDGE FUNCTION
  // --------------------------------------------------------------------------
  if (!integrationSecret) {
    console.error('[kiwify-n8n-ingest] ERRO: TATAME_INTEGRATION_SECRET não configurado nos secrets.');
    return new Response(
      JSON.stringify({
        ok: false,
        processed: false,
        message: 'Configuração de segredo de integração ausente no servidor.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const incomingIntegrationSecret = req.headers.get('x-tatame-integration-secret') || '';

  if (!incomingIntegrationSecret || !timingSafeEqual(incomingIntegrationSecret, integrationSecret)) {
    // Nunca registrar o segredo recebido nos logs por segurança
    console.warn('[kiwify-n8n-ingest] Requisição bloqueada: cabeçalho x-tatame-integration-secret inválido ou ausente.');
    return new Response(
      JSON.stringify({
        ok: false,
        processed: false,
        message: 'Evento não autorizado ou não elegível para processamento: segredo de integração inválido.',
      }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // --------------------------------------------------------------------------
  // 2. PARSE E EXTRAÇÃO DO CORPO DA REQUISIÇÃO
  // --------------------------------------------------------------------------
  let rawBodyText = '';
  let body: any;
  try {
    rawBodyText = await req.text();
    body = JSON.parse(rawBodyText);
  } catch (_err) {
    return new Response(
      JSON.stringify({
        ok: false,
        processed: false,
        message: 'Corpo da requisição não é um JSON válido.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!body || typeof body !== 'object') {
    return new Response(
      JSON.stringify({
        ok: false,
        processed: false,
        message: 'Payload vazio ou em formato inválido.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // --------------------------------------------------------------------------
  // 3. VALIDAÇÃO EFETIVA DA ORIGEM KIWIFY (AUTENTICIDADE DO WEBHOOK)
  // --------------------------------------------------------------------------
  // A Kiwify envia na query string ?signature=<token_ou_hmac_hex>
  const querySignature = (body.query_signature || '').trim();
  const rawBodyFromN8n = body.raw_body || '';

  if (!kiwifyWebhookToken) {
    console.error('[kiwify-n8n-ingest] ERRO: KIWIFY_WEBHOOK_TOKEN não configurado nos secrets.');
    return new Response(
      JSON.stringify({
        ok: false,
        processed: false,
        message: 'Configuração de validação Kiwify ausente no servidor.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let signatureVerified = false;

  // Verificação 1: Comparação direta em tempo constante (quando repassado o token de assinatura)
  if (querySignature && timingSafeEqual(querySignature, kiwifyWebhookToken)) {
    signatureVerified = true;
  }
  // Verificação 2: Validação criptográfica HMAC-SHA1 oficial da Kiwify sobre o corpo cru
  else if (querySignature && (rawBodyFromN8n || rawBodyText)) {
    const textToVerify = rawBodyFromN8n || rawBodyText;
    if (await verifyHmacSha1(kiwifyWebhookToken, textToVerify, querySignature)) {
      signatureVerified = true;
    }
  }

  // REJEIÇÃO OBRIGATÓRIA: Nunca prosseguir se a assinatura não for comprovada
  if (!signatureVerified) {
    console.warn('[kiwify-n8n-ingest] Assinatura Kiwify inválida ou divergente do token configurado.');
    return new Response(
      JSON.stringify({
        ok: false,
        processed: false,
        message: 'Evento não autorizado ou não elegível para processamento: assinatura Kiwify inválida.',
      }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // --------------------------------------------------------------------------
  // 4. PREPARAR OBJETO NORMALIZADO PARA INGESTÃO ATÔMICA NA RPC
  // --------------------------------------------------------------------------
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
    signature_verified: true, // Garantidamente true após a validação acima
    raw_payload: body.raw_payload || body,
    raw_headers: body.raw_headers || null,
  };

  // --------------------------------------------------------------------------
  // 5. EXECUTAR RPC ATÔMICA TRANSACTIONAL NO POSTGRESQL
  // --------------------------------------------------------------------------
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  try {
    const { data, error } = await supabase.rpc('process_kiwify_n8n_event', {
      p_event: eventPayload,
    });

    if (error) {
      console.error('[kiwify-n8n-ingest] Erro na execução da RPC:', error.message);
      return new Response(
        JSON.stringify({
          ok: false,
          processed: false,
          message: 'Falha interna ao persistir o evento no banco de dados.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Se o pedido já tiver sido processado (idempotência)
    if (data?.duplicate) {
      return new Response(
        JSON.stringify({
          ok: true,
          processed: false,
          duplicate: true,
          message: data.message || 'Pedido já processado anteriormente.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Se o processamento concluiu e a licença foi liberada com sucesso
    if (data?.ok && data?.processed) {
      return new Response(
        JSON.stringify({
          ok: true,
          processed: true,
          duplicate: false,
          status: data.status || 'license_activated',
          tenant_id: data.tenant_id,
          message: data.message || 'Pagamento validado e licença liberada.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Se o evento não for elegível ou falhar em validações de negócio
    return new Response(
      JSON.stringify({
        ok: false,
        processed: false,
        message: data?.message || 'Evento não autorizado ou não elegível para processamento.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[kiwify-n8n-ingest] Exceção não tratada:', err?.message || err);
    return new Response(
      JSON.stringify({
        ok: false,
        processed: false,
        message: 'Erro inesperado no processamento do evento.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
