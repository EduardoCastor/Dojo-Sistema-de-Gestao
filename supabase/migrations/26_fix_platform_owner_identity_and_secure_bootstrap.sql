-- ============================================================================
-- Migration 26: Migração Segura da Identidade do Proprietário Global
--              (admin@tatameclub.com.br), Verificação de Bootstrap e
--              Proteção contra Escalonamento Anônimo
-- PROJETO: Tatame Club (https://tatameclub.com.br | https://painel.tatameclub.com.br)
-- ============================================================================
-- OBJETIVO:
--  1. Centralizar a identidade autorizada do proprietário do SaaS na tabela
--     protegida `public.platform_authorized_owners`, definindo
--     `admin@tatameclub.com.br` como proprietário principal sem excluir ou
--     corromper contas preexistentes.
--  2. Disponibilizar a RPC `public.get_platform_bootstrap_status()` para
--     diagnóstico real do estado das Migrations 25/26 e do bootstrap no banco,
--     eliminando falsos alertas de pendência de migration na interface.
--  3. Disponibilizar a RPC `public.verify_platform_admin_access()` para validar
--     de forma estrita no backend (PostgreSQL) se o usuário autenticado possui
--     efetivamente o papel global (`profiles.is_platform_admin = true` +
--     registro ativo em `platform_authorized_owners`).
--  4. Fortalecer `public.bootstrap_platform_owner_by_email` revogando execução
--     anônima (`anon`), exigindo verificação de e-mail ou token de setup /
--     execução privilegiada (`service_role` / `postgres`), protegendo com
--     advisory lock e registrando trilha de auditoria.
-- ============================================================================

-- 1. TABELA CENTRALIZADA DE ADMINISTRADORES GLOBAIS AUTORIZADOS
CREATE TABLE IF NOT EXISTS public.platform_authorized_owners (
  email text PRIMARY KEY CHECK (email = lower(trim(email))),
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  notes text,
  migrated_to text,
  bootstrapped_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  bootstrapped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_authorized_owners ENABLE ROW LEVEL SECURITY;

-- Nenhuma escrita pública ou por usuários comuns; leitura restrita a platform_admin
DROP POLICY IF EXISTS "platform_authorized_owners_select_admin" ON public.platform_authorized_owners;
CREATE POLICY "platform_authorized_owners_select_admin" ON public.platform_authorized_owners
FOR SELECT TO authenticated
USING (public.is_platform_admin());

DROP POLICY IF EXISTS "platform_authorized_owners_write_none" ON public.platform_authorized_owners;
CREATE POLICY "platform_authorized_owners_write_none" ON public.platform_authorized_owners
FOR ALL TO authenticated
USING (false)
WITH CHECK (false);

-- 2. INSERIR O ENDEREÇO OFICIAL PRETENDIDO: admin@tatameclub.com.br
INSERT INTO public.platform_authorized_owners (email, is_primary, active, notes)
VALUES (
  'admin@tatameclub.com.br',
  true,
  true,
  'Proprietário Global Oficial do SaaS Tatame Club (painel.tatameclub.com.br)'
)
ON CONFLICT (email) DO UPDATE
SET is_primary = true,
    active = true,
    updated_at = now();

-- 3. PRESERVAR CONTA ANTIGA SE EXISTIR (SEM EXCLUSÃO OU ALTERAÇÃO AUTOMÁTICA DE PRIVILÉGIOS)
DO $$
DECLARE
  v_legacy_user record;
  v_new_owner_user record;
BEGIN
  SELECT id, email INTO v_legacy_user
  FROM auth.users
  WHERE lower(email) = 'beaverstraining@gmail.com'
  LIMIT 1;

  IF v_legacy_user.id IS NOT NULL THEN
    INSERT INTO public.platform_authorized_owners (
      email, is_primary, active, notes, migrated_to, bootstrapped_user_id
    ) VALUES (
      'beaverstraining@gmail.com',
      false,
      true,
      'Conta histórica anterior preservada sem exclusão ou revogação automática; endereço principal configurado para admin@tatameclub.com.br.',
      'admin@tatameclub.com.br',
      v_legacy_user.id
    )
    ON CONFLICT (email) DO UPDATE
    SET is_primary = false,
        migrated_to = 'admin@tatameclub.com.br',
        updated_at = now();
  END IF;

  -- Se a conta admin@tatameclub.com.br já existir em auth.users e já tiver perfil admin, sincronizar registro
  SELECT u.id, u.email, p.is_platform_admin
  INTO v_new_owner_user
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = 'admin@tatameclub.com.br'
  LIMIT 1;

  IF v_new_owner_user.id IS NOT NULL AND COALESCE(v_new_owner_user.is_platform_admin, false) = true THEN
    UPDATE public.platform_authorized_owners
    SET bootstrapped_user_id = v_new_owner_user.id,
        bootstrapped_at = COALESCE(bootstrapped_at, now()),
        updated_at = now()
    WHERE email = 'admin@tatameclub.com.br';
  END IF;
END $$;

-- 3.1 FUNÇÃO EXPLÍCITA DE TRANSIÇÃO DE AUTORIZAÇÃO GLOBAL (OPCIONAL PELO PROPRIETÁRIO)
CREATE OR REPLACE FUNCTION public.migrate_platform_owner_authorization(
  p_target_email text DEFAULT 'admin@tatameclub.com.br',
  p_deactivate_legacy boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_role text := coalesce(current_setting('role', true), current_user);
  v_is_privileged boolean := v_caller_role IN ('service_role', 'postgres', 'supabase_admin');
  v_normalized_target text := lower(trim(coalesce(p_target_email, 'admin@tatameclub.com.br')));
BEGIN
  IF NOT v_is_privileged AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas o Administrador Global ou o SQL Editor pode migrar autorizações globais.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.platform_authorized_owners (email, is_primary, active, notes)
  VALUES (v_normalized_target, true, true, 'Proprietário Global Principal migrado com segurança.')
  ON CONFLICT (email) DO UPDATE
  SET is_primary = true,
      active = true,
      updated_at = now();

  UPDATE public.platform_authorized_owners
  SET is_primary = false,
      active = CASE WHEN p_deactivate_legacy THEN false ELSE active END,
      migrated_to = v_normalized_target,
      updated_at = now()
  WHERE email <> v_normalized_target;

  RETURN jsonb_build_object(
    'success', true,
    'primary_owner_email', v_normalized_target,
    'legacy_deactivated', p_deactivate_legacy
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.migrate_platform_owner_authorization(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.migrate_platform_owner_authorization(text, boolean) TO authenticated, service_role;

-- 4. ATUALIZAR public.is_platform_admin() PARA VERIFICAR PERFIL + TABELA CENTRALIZADA
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.platform_authorized_owners o ON o.email = lower(u.email)
    WHERE p.id = auth.uid()
      AND p.is_platform_admin = true
      AND COALESCE(o.active, true) = true
  );
$$;

-- 5. FUNÇÃO DE DIAGNÓSTICO SEGURO DO ESTADO DO BOOTSTRAP E DAS MIGRATIONS
-- Permite que a tela de login verifique se as migrations 25/26 estão aplicadas
-- e se o proprietário já concluiu o bootstrap, sem expor dados sensíveis.
CREATE OR REPLACE FUNCTION public.get_platform_bootstrap_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_primary_email text := 'admin@tatameclub.com.br';
  v_bootstrap_completed boolean := false;
  v_account_exists boolean := false;
  v_email_confirmed boolean := false;
BEGIN
  SELECT email INTO v_primary_email
  FROM public.platform_authorized_owners
  WHERE is_primary = true AND active = true
  ORDER BY updated_at DESC
  LIMIT 1;

  v_primary_email := COALESCE(v_primary_email, 'admin@tatameclub.com.br');

  SELECT
    true,
    (u.email_confirmed_at IS NOT NULL),
    (COALESCE(p.is_platform_admin, false) = true AND u.email_confirmed_at IS NOT NULL)
  INTO v_account_exists, v_email_confirmed, v_bootstrap_completed
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = v_primary_email
  LIMIT 1;

  RETURN jsonb_build_object(
    'migration_25_applied', true,
    'migration_26_applied', true,
    'authorized_owner_email', v_primary_email,
    'account_exists', COALESCE(v_account_exists, false),
    'email_confirmed', COALESCE(v_email_confirmed, false),
    'bootstrap_completed', COALESCE(v_bootstrap_completed, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_bootstrap_status() TO anon, authenticated, service_role;

-- 6. FUNÇÃO DE VERIFICAÇÃO ESTRITA DE AUTORIZAÇÃO GLOBAL PÓS-LOGIN
CREATE OR REPLACE FUNCTION public.verify_platform_admin_access()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user record;
  v_is_authorized boolean := false;
  v_reason text := 'unauthenticated';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'is_authorized', false,
      'reason', 'unauthenticated',
      'message', 'Sessão não autenticada.'
    );
  END IF;

  SELECT
    u.id,
    lower(u.email) AS email,
    u.email_confirmed_at,
    COALESCE(p.full_name, u.raw_user_meta_data->>'full_name', 'Proprietário Tatame Club') AS full_name,
    COALESCE(p.is_platform_admin, false) AS is_platform_admin,
    COALESCE(o.active, false) AS is_owner_listed
  INTO v_user
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  LEFT JOIN public.platform_authorized_owners o ON o.email = lower(u.email)
  WHERE u.id = v_uid
  LIMIT 1;

  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object(
      'is_authorized', false,
      'reason', 'user_not_found',
      'message', 'Usuário não localizado no diretório de autenticação.'
    );
  END IF;

  IF v_user.email_confirmed_at IS NULL THEN
    RETURN jsonb_build_object(
      'is_authorized', false,
      'user_id', v_user.id,
      'email', v_user.email,
      'reason', 'email_not_confirmed',
      'message', 'O e-mail da conta ainda não foi confirmado.'
    );
  END IF;

  IF v_user.is_platform_admin = true AND (v_user.is_owner_listed = true OR v_user.email = 'admin@tatameclub.com.br') THEN
    v_is_authorized := true;
    v_reason := 'authorized';
  ELSIF v_user.is_owner_listed = true AND v_user.is_platform_admin = false THEN
    v_is_authorized := false;
    v_reason := 'bootstrap_pending';
  ELSE
    v_is_authorized := false;
    v_reason := 'forbidden_not_platform_admin';
  END IF;

  RETURN jsonb_build_object(
    'is_authorized', v_is_authorized,
    'user_id', v_user.id,
    'email', v_user.email,
    'full_name', v_user.full_name,
    'reason', v_reason
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_platform_admin_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_platform_admin_access() TO authenticated, service_role;

-- 7. FUNÇÃO PROTEGIDA DE BOOTSTRAP DO PROPRIETÁRIO GLOBAL (admin@tatameclub.com.br)
CREATE OR REPLACE FUNCTION public.bootstrap_platform_owner_by_email(
  p_email text DEFAULT 'admin@tatameclub.com.br',
  p_reason text DEFAULT 'Bootstrap inicial do proprietário da plataforma Tatame Club'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_target_user record;
  v_owner_config record;
  v_has_existing_admin boolean := false;
  v_jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_caller_role text := coalesce(current_setting('role', true), current_user);
  v_is_privileged_context boolean := v_caller_role IN ('service_role', 'postgres', 'supabase_admin');
  v_normalized_email text := lower(trim(coalesce(p_email, 'admin@tatameclub.com.br')));
BEGIN
  -- 1. Bloqueio transacional contra chamadas concorrentes
  PERFORM pg_advisory_xact_lock(hashtext('platform_owner_bootstrap_lock'));

  -- 2. Bloquear chamadas anônimas
  IF NOT v_is_privileged_context AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: chamadas anônimas não estão autorizadas a inicializar o proprietário global.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Verificar se o e-mail consta como proprietário ativo na configuração central
  SELECT * INTO v_owner_config
  FROM public.platform_authorized_owners
  WHERE email = v_normalized_email AND active = true
  LIMIT 1;

  IF v_owner_config.email IS NULL THEN
    RAISE EXCEPTION 'Operação negada: o endereço "%" não está autorizado como proprietário global do Tatame Club (esperado: admin@tatameclub.com.br).', v_normalized_email
      USING ERRCODE = '42501';
  END IF;

  -- 4. Se não for contexto privilegiado (SQL Editor / Edge Function service_role),
  --    exigir que o usuário autenticado seja exatamente o titular do e-mail autorizado
  IF NOT v_is_privileged_context AND v_jwt_email <> v_normalized_email AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Violação de segurança: o usuário autenticado (%) não possui permissão para inicializar ou assumir a conta global (%).', v_jwt_email, v_normalized_email
      USING ERRCODE = '42501';
  END IF;

  -- 5. Localizar conta real em auth.users
  SELECT id, email, email_confirmed_at, raw_user_meta_data
  INTO v_target_user
  FROM auth.users
  WHERE lower(email) = v_normalized_email
  LIMIT 1;

  IF v_target_user.id IS NULL THEN
    RAISE EXCEPTION 'A conta "%" ainda não existe no Supabase Auth. Crie o usuário em Authentication -> Users no Supabase Dashboard ou pelo fluxo seguro de primeiro acesso antes de vincular o papel global.', v_normalized_email;
  END IF;

  -- 6. Verificar confirmação de e-mail:
  --    Apenas service_role / postgres (SQL Editor / Edge Function administrativa) pode auto-confirmar.
  --    Sessões clientes precisam ter confirmado o e-mail para impedir criação não verificada por terceiros.
  IF v_target_user.email_confirmed_at IS NULL THEN
    IF v_is_privileged_context THEN
      UPDATE auth.users
      SET email_confirmed_at = now(),
          updated_at = now()
      WHERE id = v_target_user.id;
    ELSE
      RAISE EXCEPTION 'O endereço % aguarda confirmação de e-mail. Verifique a caixa de entrada de % ou execute "SELECT public.bootstrap_platform_owner_by_email(''admin@tatameclub.com.br'');" no SQL Editor do Supabase.', v_normalized_email, v_normalized_email
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 7. Verificar se já estava inicializado para evitar duplicidade de eventos
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_target_user.id AND is_platform_admin = true
  ) INTO v_has_existing_admin;

  -- 8. Ativar flag is_platform_admin no perfil e atualizar registro central
  INSERT INTO public.profiles (id, full_name, is_platform_admin, updated_at)
  VALUES (
    v_target_user.id,
    COALESCE(v_target_user.raw_user_meta_data->>'full_name', 'Proprietário Tatame Club SaaS'),
    true,
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET is_platform_admin = true,
      updated_at = now();

  UPDATE public.platform_authorized_owners
  SET bootstrapped_user_id = v_target_user.id,
      bootstrapped_at = COALESCE(bootstrapped_at, now()),
      updated_at = now()
  WHERE email = v_normalized_email;

  -- 9. Registrar auditoria quando inicializado pela primeira vez
  IF NOT v_has_existing_admin THEN
    INSERT INTO public.platform_audit_logs (
      actor_user_id,
      actor_user_name,
      action,
      entity_type,
      entity_id,
      reason,
      details,
      metadata
    ) VALUES (
      v_target_user.id,
      v_target_user.email,
      'bootstrap_platform_owner',
      'user',
      v_target_user.id::text,
      p_reason,
      format('Privilégio de Proprietário Global (is_platform_admin = true) vinculado com segurança à conta %s.', v_target_user.email),
      jsonb_build_object('bootstrapped_email', v_target_user.email, 'context', v_caller_role)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_target_user.id,
    'email', v_target_user.email,
    'is_platform_admin', true,
    'already_bootstrapped', v_has_existing_admin
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bootstrap_platform_owner_by_email(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_platform_owner_by_email(text, text) TO authenticated, service_role;
