// ============================================================================
// SUPABASE EDGE FUNCTION: send-saas-payment-email
// ============================================================================
// Product: Tatame Club (https://tatameclub.com.br)
// Company: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
//
// Purpose:
// Sends the official Pix payment instruction email when an academy selects a
// commercial plan after or during the trial period, and logs the real email
// dispatch result in public.saas_subscription_email_logs.
//
// Required Supabase Secrets for production email delivery:
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY
//   - SUPABASE_SERVICE_ROLE_KEY
//   - RESEND_API_KEY
//   - SAAS_EMAIL_FROM (e.g. "Tatame Club <financeiro@tatameclub.com.br>")
//   - SAAS_RECEIPT_REPLY_TO (optional, defaults to "financeiro@tatameclub.com.br")
//   - PIX_KEY (optional, defaults to provisional CNPJ key "28410730000180")
//   - PIX_KEY_VALIDATED (optional, "true" only after validated with bank)
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const COMPANY_NAME = 'Beaver Soluções em Tecnologia';
const COMPANY_CNPJ = '28.410.730/0001-80';
const PRODUCT_NAME = 'Tatame Club';
const PRODUCT_URL = 'https://tatameclub.com.br';
const EMAIL_SUBJECT = 'Tatame Club — Instruções de pagamento da sua assinatura';

const CYCLE_LABELS: Record<string, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
};

function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, emailSent: false, error: 'Método HTTP não permitido.' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const emailFrom = Deno.env.get('SAAS_EMAIL_FROM') ?? 'Tatame Club <financeiro@tatameclub.com.br>';
  const replyTo = Deno.env.get('SAAS_RECEIPT_REPLY_TO') ?? 'financeiro@tatameclub.com.br';

  // Centralized Pix Key Configuration (Provisional until bank validation)
  const pixKey = Deno.env.get('PIX_KEY') ?? '28410730000180';
  const isProvisionalPixKey = (Deno.env.get('PIX_KEY_VALIDATED') ?? 'false').toLowerCase() !== 'true';

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({
        success: false,
        emailSent: false,
        code: 'MISSING_SUPABASE_SECRETS',
        error: 'Segredos básicos do Supabase (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) ausentes na Edge Function.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({
        success: false,
        emailSent: false,
        code: 'UNAUTHORIZED',
        error: 'Cabeçalho de autorização ausente.',
      }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({
          success: false,
          emailSent: false,
          code: 'INVALID_SESSION',
          error: 'Sessão de usuário inválida ou expirada.',
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const {
      tenantId,
      tenantName,
      recipientEmail,
      planId,
      planName,
      billingCycle = 'monthly',
      amount,
      subscriptionId,
      paymentId,
      paymentReference,
    } = body;

    if (!tenantId || !recipientEmail || !planId || !planName || typeof amount !== 'number') {
      return new Response(
        JSON.stringify({
          success: false,
          emailSent: false,
          code: 'INVALID_PAYLOAD',
          error: 'Dados obrigatórios da assinatura ou destinatário ausentes para envio do e-mail.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cycleLabel = CYCLE_LABELS[billingCycle] || billingCycle;
    const formattedAmount = formatCurrencyBRL(amount);
    const requestIdentifier = paymentReference || paymentId || subscriptionId || tenantId;

    // Verify if RESEND_API_KEY is configured
    if (!resendApiKey) {
      const missingError =
        'Serviço de envio de e-mail não configurado: o segredo RESEND_API_KEY não foi definido no Supabase Edge Functions.';

      await adminClient.from('saas_subscription_email_logs').insert({
        tenant_id: tenantId,
        subscription_id: subscriptionId || null,
        payment_id: paymentId || null,
        recipient_email: recipientEmail,
        subject: EMAIL_SUBJECT,
        plan_id: planId,
        plan_name: planName,
        billing_cycle: billingCycle,
        amount,
        pix_key_used: pixKey,
        is_provisional_pix_key: isProvisionalPixKey,
        status: 'missing_config',
        provider: 'resend',
        error_message: missingError,
        triggered_by_user_id: userData.user.id,
      });

      await adminClient
        .from('saas_subscriptions')
        .update({
          last_email_status: 'missing_config',
          last_email_error: missingError,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId);

      return new Response(
        JSON.stringify({
          success: false,
          emailSent: false,
          code: 'MISSING_EMAIL_PROVIDER_SECRET',
          missingSecrets: ['RESEND_API_KEY', 'SAAS_EMAIL_FROM'],
          pixKey,
          isProvisionalPixKey,
          subject: EMAIL_SUBJECT,
          error: missingError,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const provisionalWarningHtml = isProvisionalPixKey
      ? `<div style="margin-top:12px;padding:10px 14px;background-color:#fffbeb;border:1px solid #f59e0b;border-radius:8px;color:#92400e;font-size:12px;">
           <strong>Aviso de Ambiente:</strong> Chave Pix configurada (CNPJ ${pixKey}) marcada como provisória para homologação até validação bancária definitiva.
         </div>`
      : '';

    const htmlBody = `
      <div style="font-family:'Inter',Arial,sans-serif;max-width:620px;margin:0 auto;background:#09090b;color:#f4f4f5;border-radius:16px;overflow:hidden;border:1px solid #27272a;">
        <div style="background:#dc2626;padding:24px 32px;">
          <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#fecaca;font-weight:700;">
            ${PRODUCT_NAME} • ${COMPANY_NAME}
          </p>
          <h1 style="margin:8px 0 0;font-size:22px;color:#ffffff;font-weight:800;">
            Instruções de pagamento da sua assinatura
          </h1>
        </div>

        <div style="padding:32px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#d4d4d8;">
            Olá, responsável pela academia <strong style="color:#ffffff;">${tenantName}</strong>.
          </p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#a1a1aa;">
            Recebemos sua solicitação de contratação no <strong>${PRODUCT_NAME}</strong>. Sua assinatura encontra-se com status
            <strong style="color:#fbbf24;">Pagamento Pendente (pending_payment)</strong> e será liberada assim que o pagamento via Pix for confirmado.
          </p>

          <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:20px;margin-bottom:24px;">
            <h2 style="margin:0 0 14px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#a1a1aa;">
              Resumo da Solicitação
            </h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr>
                <td style="padding:6px 0;color:#a1a1aa;">Academia:</td>
                <td style="padding:6px 0;color:#ffffff;font-weight:700;text-align:right;">${tenantName}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#a1a1aa;">Plano Selecionado:</td>
                <td style="padding:6px 0;color:#ffffff;font-weight:700;text-align:right;">${planName}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#a1a1aa;">Ciclo de Cobrança:</td>
                <td style="padding:6px 0;color:#ffffff;font-weight:700;text-align:right;">${cycleLabel}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#a1a1aa;">Identificador da Solicitação:</td>
                <td style="padding:6px 0;color:#e4e4e7;font-family:monospace;text-align:right;">${requestIdentifier}</td>
              </tr>
              <tr style="border-top:1px solid #27272a;">
                <td style="padding:12px 0 4px;color:#ffffff;font-weight:700;">Valor Total a Pagar:</td>
                <td style="padding:12px 0 4px;color:#22c55e;font-size:18px;font-weight:800;text-align:right;">${formattedAmount}</td>
              </tr>
            </table>
          </div>

          <div style="background:#18181b;border:1px solid #dc2626;border-radius:12px;padding:20px;margin-bottom:24px;">
            <h2 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#fca5a5;">
              Dados para Pagamento via Pix
            </h2>
            <p style="margin:0 0 8px;font-size:13px;color:#d4d4d8;">
              <strong>Favorecido:</strong> ${COMPANY_NAME} (CNPJ: ${COMPANY_CNPJ})
            </p>
            <p style="margin:0 0 6px;font-size:12px;color:#a1a1aa;">Chave Pix (CNPJ somente números):</p>
            <div style="background:#09090b;border:1px solid #3f3f46;border-radius:8px;padding:12px;font-family:monospace;font-size:16px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:1px;">
              ${pixKey}
            </div>
            ${provisionalWarningHtml}
          </div>

          <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:20px;margin-bottom:24px;">
            <h3 style="margin:0 0 10px;font-size:14px;color:#ffffff;">Como concluir a ativação:</h3>
            <ol style="margin:0;padding-left:20px;font-size:13px;line-height:1.7;color:#d4d4d8;">
              <li>Abra o aplicativo do seu banco e escolha a opção <strong>Pix &rarr; Pagar com Chave Pix (CNPJ)</strong>.</li>
              <li>Informe a chave Pix <strong>${pixKey}</strong> e confira o favorecido (<strong>${COMPANY_NAME}</strong>).</li>
              <li>Realize a transferência no valor exato de <strong>${formattedAmount}</strong>.</li>
              <li>Envie o comprovante respondendo a este e-mail (<strong>${replyTo}</strong>) informando o código <strong>${requestIdentifier}</strong> e o nome da academia.</li>
              <li>O acesso comercial será liberado imediatamente após a confirmação válida do pagamento pela equipe financeira do ${PRODUCT_NAME}.</li>
            </ol>
          </div>

          <p style="margin:0;font-size:12px;color:#71717a;text-align:center;">
            ${PRODUCT_NAME} (${PRODUCT_URL}) — um produto ${COMPANY_NAME} • CNPJ ${COMPANY_CNPJ}
          </p>
        </div>
      </div>
    `;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [recipientEmail],
        reply_to: replyTo,
        subject: EMAIL_SUBJECT,
        html: htmlBody,
      }),
    });

    const resendResult = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      const providerErr =
        resendResult?.message ||
        resendResult?.error ||
        `Falha retornada pelo provedor de e-mail (HTTP ${resendResponse.status}).`;

      await adminClient.from('saas_subscription_email_logs').insert({
        tenant_id: tenantId,
        subscription_id: subscriptionId || null,
        payment_id: paymentId || null,
        recipient_email: recipientEmail,
        subject: EMAIL_SUBJECT,
        plan_id: planId,
        plan_name: planName,
        billing_cycle: billingCycle,
        amount,
        pix_key_used: pixKey,
        is_provisional_pix_key: isProvisionalPixKey,
        status: 'failed',
        provider: 'resend',
        error_message: providerErr,
        triggered_by_user_id: userData.user.id,
      });

      await adminClient
        .from('saas_subscriptions')
        .update({
          last_email_status: 'failed',
          last_email_error: providerErr,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId);

      return new Response(
        JSON.stringify({
          success: false,
          emailSent: false,
          code: 'EMAIL_PROVIDER_ERROR',
          pixKey,
          isProvisionalPixKey,
          subject: EMAIL_SUBJECT,
          error: providerErr,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const messageId = resendResult?.id || null;

    await adminClient.from('saas_subscription_email_logs').insert({
      tenant_id: tenantId,
      subscription_id: subscriptionId || null,
      payment_id: paymentId || null,
      recipient_email: recipientEmail,
      subject: EMAIL_SUBJECT,
      plan_id: planId,
      plan_name: planName,
      billing_cycle: billingCycle,
      amount,
      pix_key_used: pixKey,
      is_provisional_pix_key: isProvisionalPixKey,
      status: 'sent',
      provider: 'resend',
      provider_message_id: messageId,
      triggered_by_user_id: userData.user.id,
    });

    await adminClient
      .from('saas_subscriptions')
      .update({
        last_email_sent_at: new Date().toISOString(),
        last_email_status: 'sent',
        last_email_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId);

    return new Response(
      JSON.stringify({
        success: true,
        emailSent: true,
        code: 'EMAIL_SENT',
        messageId,
        recipientEmail,
        subject: EMAIL_SUBJECT,
        pixKey,
        isProvisionalPixKey,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        emailSent: false,
        code: 'INTERNAL_EDGE_ERROR',
        pixKey,
        isProvisionalPixKey,
        error: err?.message || 'Erro interno ao processar envio de e-mail.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
