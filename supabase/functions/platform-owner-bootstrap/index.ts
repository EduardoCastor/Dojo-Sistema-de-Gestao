/**
 * Supabase Edge Function: platform-owner-bootstrap
 *
 * Responsável por inicializar de forma administrativa e segura a conta do
 * Proprietário Global do SaaS (`admin@tatameclub.com.br`) sem jamais expor
 * a `SUPABASE_SERVICE_ROLE_KEY` no frontend.
 *
 * Regras de segurança:
 * 1. Exige cabeçalho `x-bootstrap-token` correspondente ao segredo de servidor
 *    `PLATFORM_BOOTSTRAP_SECRET` configurado nos Secrets do Supabase Edge Functions.
 * 2. Aceita exclusivamente o endereço autorizado (`PLATFORM_OWNER_EMAIL`, padrão
 *    `admin@tatameclub.com.br`).
 * 3. Se o bootstrap já tiver sido concluído, recusa repetição e orienta o uso
 *    do fluxo normal de login ou recuperação de senha.
 * 4. Se a conta já existir em `auth.users`, não cria duplicidade; apenas vincula
 *    o papel global e opcionalmente envia link de recuperação de senha.
 * 5. Nunca define senha padrão nem retorna segredos em mensagens de erro.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bootstrap-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const expectedBootstrapSecret = Deno.env.get('PLATFORM_BOOTSTRAP_SECRET') ?? '';
    const authorizedOwnerEmail = (
      Deno.env.get('PLATFORM_OWNER_EMAIL') ?? 'admin@tatameclub.com.br'
    )
      .trim()
      .toLowerCase();

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Ambiente administrativo não configurado no servidor.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const providedToken = String(
      req.headers.get('x-bootstrap-token') ?? body.setupToken ?? ''
    ).trim();

    // 1. Validar e-mail autorizado
    if (!email || email !== authorizedOwnerEmail) {
      return new Response(
        JSON.stringify({
          error: `Acesso negado (403): o bootstrap global é exclusivo para ${authorizedOwnerEmail}.`,
          code: 'UNAUTHORIZED_EMAIL',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Validar token administrativo de bootstrap
    if (!expectedBootstrapSecret || !providedToken || providedToken !== expectedBootstrapSecret) {
      return new Response(
        JSON.stringify({
          error:
            'Token administrativo de inicialização inválido ou ausente. Não é permitido inicializar a conta global sem verificação do segredo de bootstrap.',
          code: 'INVALID_BOOTSTRAP_TOKEN',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!password || password.length < 8) {
      return new Response(
        JSON.stringify({
          error: 'Informe uma senha forte com pelo menos 8 caracteres.',
          code: 'WEAK_PASSWORD',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 3. Verificar estado atual do bootstrap no banco
    const { data: statusData } = await supabaseAdmin.rpc('get_platform_bootstrap_status');
    if (statusData?.bootstrap_completed === true) {
      return new Response(
        JSON.stringify({
          error:
            'O bootstrap do proprietário global já foi concluído anteriormente. Utilize a aba de Login ou Recuperação de Senha.',
          code: 'BOOTSTRAP_ALREADY_COMPLETED',
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Verificar se o usuário já existe em auth.users para evitar duplicidade
    const { data: usersList, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) {
      throw listErr;
    }

    const existingUser = usersList?.users?.find(
      (u) => (u.email ?? '').toLowerCase() === authorizedOwnerEmail
    );

    let targetUserId: string;

    if (existingUser) {
      targetUserId = existingUser.id;
      const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
        password,
        email_confirm: true,
        user_metadata: {
          ...(existingUser.user_metadata || {}),
          full_name: 'Proprietário Tatame Club SaaS',
        },
      });
      if (updateErr) throw updateErr;
    } else {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: authorizedOwnerEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: 'Proprietário Tatame Club SaaS',
        },
      });
      if (createErr || !created.user) {
        throw createErr ?? new Error('Falha ao criar conta administrativa.');
      }
      targetUserId = created.user.id;
    }

    // 5. Vincular papel global via RPC transacional e auditada
    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc(
      'bootstrap_platform_owner_by_email',
      {
        p_email: authorizedOwnerEmail,
        p_reason: 'Inicialização via Edge Function protegida platform-owner-bootstrap',
      }
    );

    if (rpcErr) {
      throw rpcErr;
    }

    return new Response(
      JSON.stringify({
        success: true,
        userId: targetUserId,
        email: authorizedOwnerEmail,
        existingAccountUpdated: Boolean(existingUser),
        bootstrap: rpcResult,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'Não foi possível concluir a inicialização administrativa. Verifique os logs do servidor.',
        code: 'INTERNAL_BOOTSTRAP_ERROR',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
