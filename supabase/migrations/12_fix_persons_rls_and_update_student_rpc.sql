-- ============================================================================
-- ARQUIVO: 12_fix_persons_rls_and_update_student_rpc.sql
-- OBJETIVO: Correção definitiva do erro "permission denied for table users"
--           ao editar alunos e responsáveis no TatameHub, ajustando a política
--           persons_select para não consultar auth.users diretamente e fornecendo
--           a RPC atômica update_student_atomic.
-- ============================================================================

-- 1. FUNÇÃO SECURITY DEFINER PARA OBTER EMAIL DO USUÁRIO DA SESSÃO
-- Acesso direto a auth.users pela role 'authenticated' gera erro de permissão.
-- Usando SECURITY DEFINER ou auth.jwt()->>'email', a leitura é 100% segura.
CREATE OR REPLACE FUNCTION public.get_auth_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    auth.jwt() ->> 'email',
    (SELECT email FROM auth.users WHERE id = auth.uid())
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_auth_user_email() TO authenticated;

-- 2. CORREÇÃO DA POLÍTICA RLS persons_select NA TABELA public.persons
-- A versão anterior em 03_row_level_security.sql continha:
--   OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
-- que gerava 'permission denied for table users' quando a cláusula RETURNING
-- do UPDATE executava como role 'authenticated'.
DROP POLICY IF EXISTS "persons_select" ON public.persons;
CREATE POLICY "persons_select" ON public.persons
FOR SELECT TO authenticated
USING (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor', 'financial')
  OR email = COALESCE(auth.jwt() ->> 'email', public.get_auth_user_email())
);

-- Garantir que instrutores e secretários também possam consultar e alterar
DROP POLICY IF EXISTS "persons_update_staff" ON public.persons;
CREATE POLICY "persons_update_staff" ON public.persons
FOR UPDATE TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'))
WITH CHECK (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'));

DROP POLICY IF EXISTS "students_update_staff" ON public.students;
CREATE POLICY "students_update_staff" ON public.students
FOR UPDATE TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'))
WITH CHECK (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'));

-- ============================================================================
-- 3. FUNÇÃO RPC ATÔMICA: ATUALIZAÇÃO COMPLETA DE ALUNO
-- ============================================================================
-- Atualiza simultaneamente em uma única transação ACID:
--  - public.persons (dados civis, contatos, CPF)
--  - public.students (filial, mensalidade, status, observações)
--  - public.guardian_relationships (vínculo ou desvinculação de responsáveis)
--  - public.student_graduations (se informada nova graduação)
--  - public.audit_logs (registro seguro de auditoria)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_student_atomic(
  p_tenant_id uuid,
  p_student_id uuid,
  p_person_id uuid,
  p_branch_id uuid,
  p_person jsonb,
  p_student jsonb,
  p_guardian_person jsonb DEFAULT NULL,
  p_guardian_rel jsonb DEFAULT NULL,
  p_remove_guardian boolean DEFAULT false,
  p_graduation jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_clean_student_cpf text;
  v_birth_date date;
  v_guardian_person_id uuid;
  v_guardian_rel_id uuid;
  v_guardian_cpf text;
  v_guardian_name text;
  v_current_rel_id uuid;
  v_ret_person jsonb;
  v_ret_student jsonb;
  v_ret_guardian_person jsonb := NULL;
  v_ret_guardian_rel jsonb := NULL;
BEGIN
  -- 1. Validar autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: o usuário precisa estar autenticado.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validar se o usuário possui papel de staff nesta academia
  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor') THEN
    RAISE EXCEPTION 'Permissão insuficiente para alterar alunos nesta academia.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Validar e normalizar CPF do aluno
  v_clean_student_cpf := public.clean_cpf(p_person->>'cpf');
  IF v_clean_student_cpf = '' THEN
    v_clean_student_cpf := NULL;
  END IF;

  IF v_clean_student_cpf IS NOT NULL THEN
    IF NOT public.is_valid_cpf(v_clean_student_cpf) THEN
      RAISE EXCEPTION 'O CPF do aluno informado (%) é inválido.', p_person->>'cpf'
        USING ERRCODE = '22023';
    END IF;

    -- Verificar duplicidade de CPF na mesma academia ignorando a própria pessoa sendo editada
    IF EXISTS (
      SELECT 1 FROM public.persons
      WHERE tenant_id = p_tenant_id 
        AND id <> p_person_id 
        AND public.clean_cpf(cpf) = v_clean_student_cpf
    ) THEN
      RAISE EXCEPTION 'Já existe outra pessoa cadastrada com este CPF nesta academia.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF p_person->>'birth_date' IS NOT NULL AND trim(p_person->>'birth_date') <> '' THEN
    v_birth_date := (p_person->>'birth_date')::date;
  END IF;

  -- 4. Atualizar registro em public.persons do aluno
  UPDATE public.persons
  SET
    full_name = trim(COALESCE(p_person->>'full_name', full_name)),
    social_name = p_person->>'social_name',
    cpf = v_clean_student_cpf,
    birth_date = COALESCE(v_birth_date, birth_date),
    gender = COALESCE(p_person->>'gender', gender),
    phone = p_person->>'phone',
    email = p_person->>'email',
    address = COALESCE(p_person->'address', address),
    updated_at = now()
  WHERE id = p_person_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de pessoa não localizado para atualização.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 5. Atualizar registro em public.students
  UPDATE public.students
  SET
    branch_id = COALESCE(p_branch_id, branch_id),
    monthly_fee = COALESCE((p_student->>'monthly_fee')::numeric, monthly_fee),
    status = COALESCE(p_student->>'status', status),
    notes = COALESCE(p_student->>'notes', notes),
    updated_at = now()
  WHERE id = p_student_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de matrícula do aluno não localizado para atualização.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 6. Gestão de Responsáveis (Desvincular, Atualizar ou Vincular)
  IF p_remove_guardian THEN
    -- Desvincular responsáveis deste aluno sem apagar a pessoa do responsável
    DELETE FROM public.guardian_relationships
    WHERE student_id = p_student_id AND tenant_id = p_tenant_id;
  ELSIF p_guardian_person IS NOT NULL AND trim(COALESCE(p_guardian_person->>'full_name', '')) <> '' THEN
    v_guardian_name := trim(p_guardian_person->>'full_name');
    v_guardian_cpf := public.clean_cpf(p_guardian_person->>'cpf');
    IF v_guardian_cpf = '' THEN
      v_guardian_cpf := NULL;
    END IF;

    -- Validar CPF do responsável se informado
    IF v_guardian_cpf IS NOT NULL AND NOT public.is_valid_cpf(v_guardian_cpf) THEN
      RAISE EXCEPTION 'O CPF do responsável informado (%) é inválido.', p_guardian_person->>'cpf'
        USING ERRCODE = '22023';
    END IF;

    -- 6.1. Prioridade para UUID explícito da pessoa informada
    IF p_guardian_person->>'id' IS NOT NULL AND length(trim(p_guardian_person->>'id')) = 36 THEN
      SELECT id INTO v_guardian_person_id
      FROM public.persons
      WHERE id = (p_guardian_person->>'id')::uuid AND tenant_id = p_tenant_id
      LIMIT 1;
    END IF;

    -- 6.2. Se não localizou por ID, buscar por CPF na academia
    IF v_guardian_person_id IS NULL AND v_guardian_cpf IS NOT NULL THEN
      SELECT id INTO v_guardian_person_id
      FROM public.persons
      WHERE tenant_id = p_tenant_id AND public.clean_cpf(cpf) = v_guardian_cpf
      LIMIT 1;
    END IF;

    -- 6.3. Se não existe, criar a pessoa física do responsável
    IF v_guardian_person_id IS NULL THEN
      INSERT INTO public.persons (
        tenant_id,
        full_name,
        social_name,
        cpf,
        birth_date,
        gender,
        phone,
        email,
        address
      )
      VALUES (
        p_tenant_id,
        v_guardian_name,
        p_guardian_person->>'social_name',
        v_guardian_cpf,
        COALESCE((p_guardian_person->>'birth_date')::date, '1985-01-01'::date),
        COALESCE(p_guardian_person->>'gender', 'other'),
        p_guardian_person->>'phone',
        p_guardian_person->>'email',
        COALESCE(p_guardian_person->'address', '{}'::jsonb)
      )
      RETURNING id INTO v_guardian_person_id;
    ELSE
      -- Atualiza contatos do responsável existente
      UPDATE public.persons
      SET
        full_name = v_guardian_name,
        phone = COALESCE(p_guardian_person->>'phone', phone),
        email = COALESCE(p_guardian_person->>'email', email),
        cpf = COALESCE(v_guardian_cpf, cpf),
        updated_at = now()
      WHERE id = v_guardian_person_id;
    END IF;

    -- 6.4. Criar ou atualizar o relacionamento em guardian_relationships
    SELECT id INTO v_current_rel_id
    FROM public.guardian_relationships
    WHERE student_id = p_student_id AND tenant_id = p_tenant_id
    LIMIT 1;

    IF v_current_rel_id IS NOT NULL THEN
      UPDATE public.guardian_relationships
      SET
        guardian_person_id = v_guardian_person_id,
        relationship_label = COALESCE(p_guardian_rel->>'relationship_label', 'Responsável'),
        is_legal_guardian = COALESCE((p_guardian_rel->>'is_legal_guardian')::boolean, true),
        is_financial_guardian = COALESCE((p_guardian_rel->>'is_financial_guardian')::boolean, true),
        is_emergency_contact = COALESCE((p_guardian_rel->>'is_emergency_contact')::boolean, true),
        is_pickup_authorized = COALESCE((p_guardian_rel->>'is_pickup_authorized')::boolean, true)
      WHERE id = v_current_rel_id
      RETURNING id INTO v_guardian_rel_id;
    ELSE
      INSERT INTO public.guardian_relationships (
        tenant_id,
        student_id,
        guardian_person_id,
        relationship_label,
        is_legal_guardian,
        is_financial_guardian,
        is_emergency_contact,
        is_pickup_authorized
      )
      VALUES (
        p_tenant_id,
        p_student_id,
        v_guardian_person_id,
        COALESCE(p_guardian_rel->>'relationship_label', 'Responsável'),
        COALESCE((p_guardian_rel->>'is_legal_guardian')::boolean, true),
        COALESCE((p_guardian_rel->>'is_financial_guardian')::boolean, true),
        COALESCE((p_guardian_rel->>'is_emergency_contact')::boolean, true),
        COALESCE((p_guardian_rel->>'is_pickup_authorized')::boolean, true)
      )
      RETURNING id INTO v_guardian_rel_id;
    END IF;

    -- Carregar dados do responsável para retorno
    SELECT to_jsonb(p) INTO v_ret_guardian_person FROM public.persons p WHERE id = v_guardian_person_id;
    SELECT to_jsonb(gr) INTO v_ret_guardian_rel FROM public.guardian_relationships gr WHERE id = v_guardian_rel_id;
  END IF;

  -- 7. Graduação (se informada)
  IF p_graduation IS NOT NULL AND p_graduation->>'martial_art_id' IS NOT NULL AND p_graduation->>'belt_rank_id' IS NOT NULL THEN
    -- Inserir nova graduação se for diferente da mais recente
    IF NOT EXISTS (
      SELECT 1 FROM public.student_graduations
      WHERE student_id = p_student_id 
        AND tenant_id = p_tenant_id
        AND martial_art_id = (p_graduation->>'martial_art_id')::uuid
        AND belt_rank_id = (p_graduation->>'belt_rank_id')::uuid
    ) THEN
      INSERT INTO public.student_graduations (
        tenant_id,
        student_id,
        martial_art_id,
        belt_rank_id,
        graduated_at,
        examiner_name,
        notes
      )
      VALUES (
        p_tenant_id,
        p_student_id,
        (p_graduation->>'martial_art_id')::uuid,
        (p_graduation->>'belt_rank_id')::uuid,
        COALESCE((p_graduation->>'graduated_at')::date, current_date),
        COALESCE(p_graduation->>'examiner_name', 'Atualização administrativa'),
        COALESCE(p_graduation->>'notes', 'Graduação atualizada no cadastro do aluno')
      );
    END IF;
  END IF;

  -- 8. Auditoria
  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    user_name,
    action,
    entity,
    entity_id,
    details
  )
  VALUES (
    p_tenant_id,
    v_user_id,
    'Staff TatameHub',
    'Edição de Aluno',
    'Student',
    p_student_id,
    'Atualizado cadastro do aluno ' || trim(COALESCE(p_person->>'full_name', ''))
  );

  -- 9. Retornar dados completos atualizados
  SELECT to_jsonb(p) INTO v_ret_person FROM public.persons p WHERE id = p_person_id;
  SELECT to_jsonb(s) INTO v_ret_student FROM public.students s WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'person_id', p_person_id,
    'guardian_person_id', v_guardian_person_id,
    'guardian_relationship_id', v_guardian_rel_id,
    'person', v_ret_person,
    'student', v_ret_student,
    'guardian_person', v_ret_guardian_person,
    'guardian_relationship', v_ret_guardian_rel
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_student_atomic(
  uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, boolean, jsonb
) TO authenticated;
