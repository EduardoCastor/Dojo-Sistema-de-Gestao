-- ============================================================================
-- Migration 27: Autorização Equidistante dos Dois Administradores Globais
--              (admin@tatameclub.com.br e beaverstraining@gmail.com)
-- PROJETO: Tatame Club (https://tatameclub.com.br | https://painel.tatameclub.com.br)
-- ============================================================================
-- OBJETIVO:
--  1. Habilitar de forma definitiva os dois e-mails administrativos globais:
--     - admin@tatameclub.com.br
--     - beaverstraining@gmail.com
--     ambos com privilégio global equivalente, ativos e sem sobreposição ou migração.
--  2. Atualizar public.platform_authorized_owners garantindo que ambos constem
--     com active = true e migrated_to = NULL.
--  3. Sincronizar contas existentes em auth.users para garantir que tenham
--     profiles.is_platform_admin = true.
--  4. Atualizar public.is_platform_admin(), public.verify_platform_admin_access(),
--     public.get_platform_bootstrap_status() e public.bootstrap_platform_owner_by_email().
-- ============================================================================

-- 1. ASSEGURAR TABELA CENTRALIZADA
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

DROP POLICY IF EXISTS "platform_authorized_owners_select_admin" ON public.platform_authorized_owners;
CREATE POLICY "platform_authorized_owners_select_admin" ON public.platform_authorized_owners
FOR SELECT TO authenticated
USING (public.is_platform_admin());

DROP POLICY IF EXISTS "platform_authorized_owners_write_none" ON public.platform_authorized_owners;
CREATE POLICY "platform_authorized_owners_write_none" ON public.platform_authorized_owners
FOR ALL TO authenticated
USING (false)
WITH CHECK (false);

-- 2. CADASTRAR OU ATUALIZAR OS DOIS ADMINISTRADORES GLOBAIS AUTORIZADOS
INSERT INTO public.platform_authorized_owners (email, is_primary, active, notes, migrated_to)
VALUES (
  'admin@tatameclub.com.br',
  true,
  true,
  'Administrador Global Oficial do SaaS Tatame Club (painel.tatameclub.com.br)',
  NULL
)
ON CONFLICT (email) DO UPDATE
SET active = true,
    migrated_to = NULL,
    updated_at = now();

INSERT INTO public.platform_authorized_owners (email, is_primary, active, notes, migrated_to)
VALUES (
  'beaverstraining@gmail.com',
  false,
  true,
  'Administrador Global Autorizado do SaaS Tatame Club (painel.tatameclub.com.br)',
  NULL
)
ON CONFLICT (email) DO UPDATE
SET active = true,
    migrated_to = NULL,
    updated_at = now();

-- 2.1 ATUALIZAR FUNÇÃO DE SEGURANÇA CONTRA ESCALONAMENTO INDEVIDO (COMPATÍVEL COM SQL EDITOR E BOOTSTRAP)
-- Permite operações vindas do SQL Editor/Postgres/service_role E reconhece os proprietários legítimos ativos.
CREATE OR REPLACE FUNCTION public.enforce_profile_admin_security()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_role text := lower(coalesce(nullif(current_setting('role', true), ''), current_user, session_user, ''));
  v_is_privileged boolean := false;
  v_is_authorized_owner boolean := false;
BEGIN
  IF NEW.is_platform_admin IS DISTINCT FROM COALESCE(OLD.is_platform_admin, false) THEN
    -- 1. Contexto privilegiado (SQL Editor, Migrations, Postgres superuser, service_role)
    IF v_caller_role IN ('service_role', 'postgres', 'supabase_admin', 'dashboard_user', 'authenticator')
       OR current_user IN ('postgres', 'supabase_admin', 'service_role', 'dashboard_user')
       OR session_user IN ('postgres', 'supabase_admin', 'service_role', 'dashboard_user')
       OR coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
      v_is_privileged := true;
    END IF;

    -- 2. Verificar se o usuário que está recebendo a flag é um dos e-mails autorizados em platform_authorized_owners
    IF NOT v_is_privileged THEN
      SELECT EXISTS (
        SELECT 1
        FROM auth.users u
        JOIN public.platform_authorized_owners o ON lower(trim(o.email)) = lower(trim(u.email))
        WHERE u.id = NEW.id
          AND o.active = true
      ) INTO v_is_authorized_owner;

      -- Fallback canônico
      IF NOT v_is_authorized_owner THEN
        SELECT EXISTS (
          SELECT 1
          FROM auth.users u
          WHERE u.id = NEW.id
            AND lower(trim(u.email)) IN ('admin@tatameclub.com.br', 'beaverstraining@gmail.com')
        ) INTO v_is_authorized_owner;
      END IF;
    END IF;

    -- 3. Se não for contexto privilegiado, nem proprietário autorizado ativo, nem platform_admin já validado:
    IF NOT v_is_privileged AND NOT v_is_authorized_owner AND NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'Violação de segurança: você não possui autorização para conceder ou alterar o papel de Administrador Global do SaaS.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_platform_admin_flag ON public.profiles;
CREATE TRIGGER trg_protect_platform_admin_flag
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_admin_security();

-- 2.2 ATUALIZAR FUNÇÃO DE SEGURANÇA DE IMUTABILIDADE DE LICENÇAS
CREATE OR REPLACE FUNCTION public.enforce_tenant_license_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_role text := lower(coalesce(nullif(current_setting('role', true), ''), current_user, session_user, ''));
  v_is_privileged boolean := false;
BEGIN
  IF (
    NEW.plan_id IS DISTINCT FROM OLD.plan_id OR
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.trial_started_at IS DISTINCT FROM OLD.trial_started_at OR
    NEW.trial_expires_at IS DISTINCT FROM OLD.trial_expires_at
  ) THEN
    IF v_caller_role IN ('service_role', 'postgres', 'supabase_admin', 'dashboard_user', 'authenticator')
       OR current_user IN ('postgres', 'supabase_admin', 'service_role', 'dashboard_user')
       OR session_user IN ('postgres', 'supabase_admin', 'service_role', 'dashboard_user')
       OR coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
      v_is_privileged := true;
    END IF;

    IF NOT v_is_privileged AND NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'Acesso negado: uma academia não pode alterar diretamente seu próprio plano, status de licença ou validade do período de teste.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. VINCULAR CONTAS DE AUTH.USERS QUE JÁ EXISTIREM NO BANCO DE DADOS
-- Temporariamente desativa o trigger durante a sincronização em lote da migration
ALTER TABLE public.profiles DISABLE TRIGGER trg_protect_platform_admin_flag;

DO $$
DECLARE
  v_admin_user record;
  v_beavers_user record;
BEGIN
  -- Verificar admin@tatameclub.com.br
  SELECT u.id, u.email, u.email_confirmed_at, p.is_platform_admin
  INTO v_admin_user
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = 'admin@tatameclub.com.br'
  LIMIT 1;

  IF v_admin_user.id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, is_platform_admin, updated_at)
    VALUES (v_admin_user.id, 'Administrador Global Tatame Club', true, now())
    ON CONFLICT (id) DO UPDATE
    SET is_platform_admin = true,
        updated_at = now();

    UPDATE public.platform_authorized_owners
    SET bootstrapped_user_id = v_admin_user.id,
        bootstrapped_at = COALESCE(bootstrapped_at, now()),
        updated_at = now()
    WHERE email = 'admin@tatameclub.com.br';
  END IF;

  -- Verificar beaverstraining@gmail.com
  SELECT u.id, u.email, u.email_confirmed_at, p.is_platform_admin
  INTO v_beavers_user
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = 'beaverstraining@gmail.com'
  LIMIT 1;

  IF v_beavers_user.id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, is_platform_admin, updated_at)
    VALUES (v_beavers_user.id, 'Administrador Global Tatame Club', true, now())
    ON CONFLICT (id) DO UPDATE
    SET is_platform_admin = true,
        updated_at = now();

    UPDATE public.platform_authorized_owners
    SET bootstrapped_user_id = v_beavers_user.id,
        bootstrapped_at = COALESCE(bootstrapped_at, now()),
        updated_at = now()
    WHERE email = 'beaverstraining@gmail.com';
  END IF;
END $$;

-- Reativa o trigger de proteção para garantir a blindagem contínua
ALTER TABLE public.profiles ENABLE TRIGGER trg_protect_platform_admin_flag;

-- 4. ATUALIZAR public.is_platform_admin() PARA RECONHECER AMBOS OS E-MAILS
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
      AND (
        COALESCE(o.active, false) = true OR
        lower(u.email) IN ('admin@tatameclub.com.br', 'beaverstraining@gmail.com')
      )
  );
$$;

-- 5. ATUALIZAR public.get_platform_bootstrap_status()
CREATE OR REPLACE FUNCTION public.get_platform_bootstrap_status(p_email text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_normalized_email text := lower(trim(coalesce(p_email, '')));
  v_account_exists boolean := false;
  v_email_confirmed boolean := false;
  v_bootstrap_completed boolean := false;
  v_authorized_emails text[];
  v_target_email text;
BEGIN
  -- Coletar e-mails autorizados ativos
  SELECT array_agg(email ORDER BY (CASE WHEN email = 'admin@tatameclub.com.br' THEN 0 WHEN email = 'beaverstraining@gmail.com' THEN 1 ELSE 2 END), email)
  INTO v_authorized_emails
  FROM public.platform_authorized_owners
  WHERE active = true;

  IF v_authorized_emails IS NULL OR array_length(v_authorized_emails, 1) = 0 THEN
    v_authorized_emails := ARRAY['admin@tatameclub.com.br', 'beaverstraining@gmail.com'];
  END IF;

  IF v_normalized_email <> '' AND v_normalized_email = ANY(v_authorized_emails) THEN
    v_target_email := v_normalized_email;
  ELSE
    v_target_email := v_authorized_emails[1];
  END IF;

  SELECT
    true,
    (u.email_confirmed_at IS NOT NULL),
    (COALESCE(p.is_platform_admin, false) = true AND u.email_confirmed_at IS NOT NULL)
  INTO v_account_exists, v_email_confirmed, v_bootstrap_completed
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = v_target_email
  LIMIT 1;

  RETURN jsonb_build_object(
    'migration_25_applied', true,
    'migration_26_applied', true,
    'migration_27_applied', true,
    'authorized_owner_email', v_target_email,
    'authorized_emails', v_authorized_emails,
    'account_exists', COALESCE(v_account_exists, false),
    'email_confirmed', COALESCE(v_email_confirmed, false),
    'bootstrap_completed', COALESCE(v_bootstrap_completed, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_bootstrap_status(text) TO anon, authenticated, service_role;

-- 6. ATUALIZAR public.verify_platform_admin_access()
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
  v_is_authorized_email boolean := false;
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
    COALESCE(p.full_name, u.raw_user_meta_data->>'full_name', 'Administrador Global Tatame Club') AS full_name,
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

  v_is_authorized_email := (
    v_user.is_owner_listed = true OR
    v_user.email IN ('admin@tatameclub.com.br', 'beaverstraining@gmail.com')
  );

  IF v_user.is_platform_admin = true AND v_is_authorized_email THEN
    v_is_authorized := true;
    v_reason := 'authorized';
  ELSIF v_is_authorized_email AND v_user.is_platform_admin = false THEN
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

-- 7. ATUALIZAR public.bootstrap_platform_owner_by_email() PARA AMBOS OS E-MAILS
CREATE OR REPLACE FUNCTION public.bootstrap_platform_owner_by_email(
  p_email text,
  p_reason text DEFAULT 'Bootstrap do administrador da plataforma Tatame Club'
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
  v_is_known_owner boolean := false;
BEGIN
  -- 1. Bloqueio transacional contra chamadas concorrentes
  PERFORM pg_advisory_xact_lock(hashtext('platform_owner_bootstrap_lock'));

  -- 2. Bloquear chamadas anônimas
  IF NOT v_is_privileged_context AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: chamadas anônimas não estão autorizadas a inicializar o administrador global.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Verificar se o e-mail consta como proprietário ativo na configuração central
  SELECT * INTO v_owner_config
  FROM public.platform_authorized_owners
  WHERE email = v_normalized_email AND active = true
  LIMIT 1;

  v_is_known_owner := (v_owner_config.email IS NOT NULL) OR (v_normalized_email IN ('admin@tatameclub.com.br', 'beaverstraining@gmail.com'));

  IF NOT v_is_known_owner THEN
    RAISE EXCEPTION 'Operação negada: o endereço "%" não está autorizado como administrador global do Tatame Club (endereços autorizados: admin@tatameclub.com.br e beaverstraining@gmail.com).', v_normalized_email
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

  -- 6. Verificar confirmação de e-mail
  IF v_target_user.email_confirmed_at IS NULL THEN
    IF v_is_privileged_context THEN
      UPDATE auth.users
      SET email_confirmed_at = now(),
          updated_at = now()
      WHERE id = v_target_user.id;
    ELSE
      RAISE EXCEPTION 'O endereço % aguarda confirmação de e-mail. Verifique a caixa de entrada de % ou confirme a conta no Supabase Dashboard.', v_normalized_email, v_normalized_email
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 7. Verificar se já estava inicializado
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_target_user.id AND is_platform_admin = true
  ) INTO v_has_existing_admin;

  -- 8. Ativar flag is_platform_admin no perfil e atualizar registro central
  INSERT INTO public.profiles (id, full_name, is_platform_admin, updated_at)
  VALUES (
    v_target_user.id,
    COALESCE(v_target_user.raw_user_meta_data->>'full_name', 'Administrador Global Tatame Club'),
    true,
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET is_platform_admin = true,
      updated_at = now();

  INSERT INTO public.platform_authorized_owners (
    email, is_primary, active, notes, bootstrapped_user_id, bootstrapped_at, updated_at
  ) VALUES (
    v_normalized_email,
    (v_normalized_email = 'admin@tatameclub.com.br'),
    true,
    'Administrador Global Autorizado Tatame Club',
    v_target_user.id,
    now(),
    now()
  )
  ON CONFLICT (email) DO UPDATE
  SET bootstrapped_user_id = v_target_user.id,
      bootstrapped_at = COALESCE(platform_authorized_owners.bootstrapped_at, now()),
      active = true,
      migrated_to = NULL,
      updated_at = now();

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
      format('Privilégio de Administrador Global (is_platform_admin = true) vinculado com segurança à conta %s.', v_target_user.email),
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
