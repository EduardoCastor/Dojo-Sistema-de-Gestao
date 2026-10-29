// ============================================================================
// SUPABASE EDGE FUNCTION: send-portal-invitation-email
// ============================================================================
// Product: Tatame Club (https://tatameclub.com.br)
// Company: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
//
// Purpose:
// Dispatches official activation email with secure invitation code and direct link
// when an academy invites a student or legal guardian to access the Portal.
// Audits real email delivery into public.portal_invitation_email_logs.
//
// Required Supabase Secrets for production email delivery:
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY
//   - SUPABASE_SERVICE_ROLE_KEY
//   - RESEND_API_KEY
//   - PORTAL_EMAIL_FROM (optional, defaults to "Tatame Club <acesso@tatameclub.com.br>")
//   - APP_URL (optional, defaults to "https://tatameclub.com.br")
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
const DEFAULT_APP_URL = 'https://tatameclub.com.br';

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
  const emailFrom = Deno.env.get('PORTAL_EMAIL_FROM') ?? Deno.env.get('SAAS_EMAIL_FROM') ?? 'Tatame Club <acesso@tatameclub.com.br>';
  const appBaseUrl = Deno.env.get('APP_URL') ?? DEFAULT_APP_URL;

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
      invitationId,
      inviteCode,
      recipientEmail,
      recipientName,
      targetType = 'student',
      academyName = 'Sua Academia',
      targetId,
    } = body;

    if (!tenantId || !recipientEmail || !inviteCode) {
      return new Response(
        JSON.stringify({
          success: false,
          emailSent: false,
          code: 'INVALID_PAYLOAD',
          error: 'Parâmetros obrigatórios ausentes: tenantId, recipientEmail ou inviteCode.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const roleLabel = targetType === 'guardian' ? 'Portal do Responsável' : 'Portal do Aluno';
    const emailSubject = `${academyName} no Tatame Club — Seu convite de acesso ao ${roleLabel}`;
    const cleanCode = String(inviteCode).trim().toUpperCase();
    const activationUrl = `${appBaseUrl.replace(/\/$/, '')}/?invite=${encodeURIComponent(cleanCode)}`;

    // Verify if RESEND_API_KEY is configured
    if (!resendApiKey) {
      const missingError =
        'Serviço de envio de e-mail não configurado: o segredo RESEND_API_KEY não foi definido no Supabase Edge Functions.';

      // Grava auditoria de tentativa
      try {
        await adminClient.from('portal_invitation_email_logs').insert({
          tenant_id: tenantId,
          invitation_id: invitationId || null,
          invite_code: cleanCode,
          recipient_email: recipientEmail,
          recipient_name: recipientName || recipientEmail,
          target_type: targetType,
          target_id: targetId || null,
          status: 'missing_config',
          provider: 'resend',
          error_message: missingError,
          triggered_by_user_id: userData.user.id,
        });

        if (invitationId) {
          await adminClient
            .from('tenant_user_invitations')
            .update({
              last_email_status: 'missing_config',
              last_email_error: missingError,
              updated_at: new Date().toISOString(),
            })
            .eq('id', invitationId);
        }
      } catch (logErr) {
        console.error('Falha ao gravar log de email ausente:', logErr);
      }

      return new Response(
        JSON.stringify({
          success: false,
          emailSent: false,
          code: 'MISSING_EMAIL_PROVIDER_SECRET',
          missingSecrets: ['RESEND_API_KEY'],
          subject: emailSubject,
          inviteCode: cleanCode,
          activationUrl,
          error: missingError,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Template HTML profissional e responsivo
    const htmlBody = `
      <div style="font-family:'Inter',Arial,-apple-system,sans-serif;max-width:620px;margin:0 auto;background:#09090b;color:#f4f4f5;border-radius:16px;overflow:hidden;border:1px solid #27272a;">
        <div style="background:linear-gradient(135deg, #b91c1c 0%, #dc2626 100%);padding:28px 32px;">
          <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#fecaca;font-weight:700;">
            ${PRODUCT_NAME} • ${COMPANY_NAME}
          </p>
          <h1 style="margin:10px 0 0;font-size:22px;line-height:1.3;color:#ffffff;font-weight:800;">
            Seu convite de acesso ao ${roleLabel}
          </h1>
          <p style="margin:6px 0 0;font-size:13px;color:#fecaca;">
            Academia: <strong>${academyName}</strong>
          </p>
        </div>

        <div style="padding:32px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#d4d4d8;">
            Olá, <strong style="color:#ffffff;">${recipientName || 'Praticante'}</strong>!
          </p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#a1a1aa;">
            A academia <strong style="color:#ffffff;">${academyName}</strong> gerou um convite seguro para que você ative sua conta no <strong>${PRODUCT_NAME}</strong> e tenha acesso total ao ${roleLabel}.
          </p>

          <div style="background:#18181b;border:1px solid #dc2626;border-radius:12px;padding:24px;margin-bottom:28px;text-align:center;">
            <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#fca5a5;font-weight:700;">
              Seu Código de Ativação Seguro
            </p>
            <div style="background:#09090b;border:2px solid #dc2626;border-radius:10px;padding:14px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:3px;display:inline-block;min-width:240px;margin-bottom:14px;">
              ${cleanCode}
            </div>
            <p style="margin:0 0 18px;font-size:12px;color:#a1a1aa;">
              Este código é intransferível, válido por 14 dias e requer a confirmação do seu CPF cadastrado.
            </p>
            <div>
              <a href="${activationUrl}" style="background:#dc2626;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;display:inline-block;box-shadow:0 4px 12px rgba(220,38,38,0.4);">
                Ativar Minha Conta no Portal &rarr;
              </a>
            </div>
          </div>

          <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:20px;margin-bottom:24px;">
            <h3 style="margin:0 0 12px;font-size:14px;color:#ffffff;font-weight:700;">
              Como ativar sua conta em 3 passos rápidos:
            </h3>
            <ol style="margin:0;padding-left:20px;font-size:13px;line-height:1.8;color:#d4d4d8;">
              <li>Clique no botão acima ou acesse <strong><a href="${appBaseUrl}" style="color:#ef4444;text-decoration:none;">${appBaseUrl}</a></strong> e selecione <em>"Entrar &rarr; Ativar Convite"</em>.</li>
              <li>Informe o código <strong>${cleanCode}</strong> e o seu <strong>CPF</strong> registrado na secretaria.</li>
              <li>Defina sua senha de acesso ou vincule com sua conta Google com segurança.</li>
            </ol>
          </div>

          <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#a1a1aa;">
              🥋 <strong>O que você pode fazer no portal:</strong> consultar histórico de presenças em treinos, evolução de faixas e graus, biblioteca técnica oficial em vídeo, exames de graduação e comunicados da equipe técnica.
            </p>
          </div>

          <p style="margin:24px 0 0;font-size:12px;color:#71717a;text-align:center;line-height:1.5;">
            ${PRODUCT_NAME} (${appBaseUrl}) — Desenvolvido por ${COMPANY_NAME} • CNPJ ${COMPANY_CNPJ}<br/>
            Este é um e-mail transacional automático. Se você não solicitou este acesso, desconsidere esta mensagem.
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
        subject: emailSubject,
        html: htmlBody,
      }),
    });

    const resendResult = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      const providerErr =
        resendResult?.message ||
        `Erro do provedor Resend HTTP ${resendResponse.status}: ${JSON.stringify(resendResult)}`;

      try {
        await adminClient.from('portal_invitation_email_logs').insert({
          tenant_id: tenantId,
          invitation_id: invitationId || null,
          invite_code: cleanCode,
          recipient_email: recipientEmail,
          recipient_name: recipientName || recipientEmail,
          target_type: targetType,
          target_id: targetId || null,
          status: 'failed',
          provider: 'resend',
          error_message: providerErr,
          triggered_by_user_id: userData.user.id,
        });

        if (invitationId) {
          await adminClient
            .from('tenant_user_invitations')
            .update({
              last_email_status: 'failed',
              last_email_error: providerErr,
              updated_at: new Date().toISOString(),
            })
            .eq('id', invitationId);
        }
      } catch (logErr) {
        console.error('Falha ao logar erro Resend:', logErr);
      }

      return new Response(
        JSON.stringify({
          success: false,
          emailSent: false,
          code: 'RESEND_PROVIDER_ERROR',
          error: providerErr,
          details: resendResult,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sucesso no envio
    const messageId = resendResult?.id || `msg-${Date.now()}`;
    const sentAt = new Date().toISOString();

    try {
      await adminClient.from('portal_invitation_email_logs').insert({
        tenant_id: tenantId,
        invitation_id: invitationId || null,
        invite_code: cleanCode,
        recipient_email: recipientEmail,
        recipient_name: recipientName || recipientEmail,
        target_type: targetType,
        target_id: targetId || null,
        status: 'sent',
        provider: 'resend',
        provider_message_id: messageId,
        triggered_by_user_id: userData.user.id,
      });

      if (invitationId) {
        await adminClient
          .from('tenant_user_invitations')
          .update({
            last_email_sent_at: sentAt,
            last_email_status: 'sent',
            last_email_error: null,
            updated_at: sentAt,
          })
          .eq('id', invitationId);
      }
    } catch (logErr) {
      console.error('Falha ao logar sucesso Resend:', logErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        emailSent: true,
        messageId,
        sentAt,
        recipientEmail,
        inviteCode: cleanCode,
        subject: emailSubject,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        emailSent: false,
        code: 'INTERNAL_ERROR',
        error: err?.message || 'Falha inesperada ao processar envio de convite por e-mail.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
