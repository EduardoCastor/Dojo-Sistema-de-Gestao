-- ============================================================================
-- ARQUIVO: 11_guardian_management_and_independent_links.sql
-- OBJETIVO: Aperfeiçoamento do módulo independente de responsáveis,
--           suporte a múltiplos vínculos por aluno, e correção definitiva
--           do reuso de responsáveis por UUID em register_student_atomic.
-- ============================================================================

-- 1. CORREÇÃO DE register_student_atomic PARA PRIORIZAR UUID DO RESPONSÁVEL REUTILIZADO
CREATE OR REPLACE FUNCTION public.register_student_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_person jsonb,
  p_student jsonb,
  p_guardian_person jsonb DEFAULT NULL,
  p_guardian_rel jsonb DEFAULT NULL,
  p_graduation jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_person_id uuid;
  v_student_id uuid;
  v_guardian_person_id uuid;
  v_guardian_rel_id uuid;
  v_clean_cpf text;
  v_clean_student_cpf text;
  v_birth_date date;
  v_age integer;
  v_monthly_fee numeric;
  v_registration_number text;
  v_guardian_name text;
  v_guardian_cpf text;
BEGIN
  -- 1. Validar autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: o usuário precisa estar autenticado.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validar se o usuário possui papel de staff nesta academia
  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor') THEN
    RAISE EXCEPTION 'Permissão insuficiente para cadastrar alunos nesta academia.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Validação e normalização de dados do Aluno
  v_clean_student_cpf := public.clean_cpf(p_person->>'cpf');
  IF v_clean_student_cpf = '' THEN
    v_clean_student_cpf := NULL;
  END IF;

  v_birth_date := (p_person->>'birth_date')::date;
  IF v_birth_date IS NULL THEN
    RAISE EXCEPTION 'A data de nascimento do aluno é obrigatória.'
      USING ERRCODE = '23502';
  END IF;

  v_age := date_part('year', age(v_birth_date))::integer;

  -- Se for maior de 18 anos, CPF é obrigatório e deve ser matematicamente válido
  IF v_age >= 18 THEN
    IF v_clean_student_cpf IS NULL THEN
      RAISE EXCEPTION 'O CPF é obrigatório para alunos maiores de 18 anos.'
        USING ERRCODE = '23502';
    END IF;
  END IF;

  IF v_clean_student_cpf IS NOT NULL THEN
    IF NOT public.is_valid_cpf(v_clean_student_cpf) THEN
      RAISE EXCEPTION 'O CPF do aluno (%) é matematicamente inválido.', p_person->>'cpf'
        USING ERRCODE = '22023';
    END IF;

    -- Verificar unicidade na mesma academia
    IF EXISTS (
      SELECT 1 FROM public.persons
      WHERE tenant_id = p_tenant_id AND public.clean_cpf(cpf) = v_clean_student_cpf
    ) THEN
      -- Se a pessoa já existe, reaproveitar seu person_id para não duplicar dados
      SELECT id INTO v_person_id
      FROM public.persons
      WHERE tenant_id = p_tenant_id AND public.clean_cpf(cpf) = v_clean_student_cpf
      LIMIT 1;

      -- Verificar se já tem matrícula de aluno ativa
      IF EXISTS (
        SELECT 1 FROM public.students
        WHERE tenant_id = p_tenant_id AND person_id = v_person_id AND status = 'active'
      ) THEN
        RAISE EXCEPTION 'Já existe uma matrícula ativa de aluno para este CPF nesta academia.'
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  -- 4. Inserir pessoa do aluno se não encontrada
  IF v_person_id IS NULL THEN
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
      trim(p_person->>'full_name'),
      p_person->>'social_name',
      v_clean_student_cpf,
      v_birth_date,
      COALESCE(p_person->>'gender', 'other'),
      p_person->>'phone',
      p_person->>'email',
      COALESCE(p_person->'address', '{}'::jsonb)
    )
    RETURNING id INTO v_person_id;
  ELSE
    -- Atualiza os contatos da pessoa já existente
    UPDATE public.persons
    SET
      full_name = trim(p_person->>'full_name'),
      phone = COALESCE(p_person->>'phone', phone),
      email = COALESCE(p_person->>'email', email),
      updated_at = now()
    WHERE id = v_person_id;
  END IF;

  -- 5. Inserir registro em students
  v_registration_number := COALESCE(
    p_student->>'registration_number',
    'MAT-' || to_char(now(), 'YYYY') || '-' || lpad((floor(random() * 9000 + 1000)::text), 4, '0')
  );
  v_monthly_fee := COALESCE((p_student->>'monthly_fee')::numeric, 0);

  INSERT INTO public.students (
    tenant_id,
    branch_id,
    person_id,
    registration_number,
    enrollment_date,
    status,
    monthly_fee,
    notes
  )
  VALUES (
    p_tenant_id,
    p_branch_id,
    v_person_id,
    v_registration_number,
    COALESCE((p_student->>'enrollment_date')::date, current_date),
    COALESCE(p_student->>'status', 'active'),
    v_monthly_fee,
    p_student->>'notes'
  )
  RETURNING id INTO v_student_id;

  -- 6. Se houver dados de Responsável (Guardian)
  IF p_guardian_person IS NOT NULL AND trim(COALESCE(p_guardian_person->>'full_name', '')) <> '' THEN
    v_guardian_name := trim(p_guardian_person->>'full_name');
    v_guardian_cpf := public.clean_cpf(p_guardian_person->>'cpf');
    IF v_guardian_cpf = '' THEN
      v_guardian_cpf := NULL;
    END IF;

    -- Validar CPF do responsável se informado
    IF v_guardian_cpf IS NOT NULL AND NOT public.is_valid_cpf(v_guardian_cpf) THEN
      RAISE EXCEPTION 'O CPF do responsável (%) é matematicamente inválido.', p_guardian_person->>'cpf'
        USING ERRCODE = '22023';
    END IF;

    -- Prioridade 1: Localizar pelo UUID explícito da pessoa informada no payload (Reuso direto)
    IF p_guardian_person->>'id' IS NOT NULL AND length(trim(p_guardian_person->>'id')) = 36 THEN
      SELECT id INTO v_guardian_person_id
      FROM public.persons
      WHERE id = (p_guardian_person->>'id')::uuid AND tenant_id = p_tenant_id
      LIMIT 1;
    END IF;

    -- Prioridade 2: Localizar se o responsável já existe na academia por CPF limpo
    IF v_guardian_person_id IS NULL AND v_guardian_cpf IS NOT NULL THEN
      SELECT id INTO v_guardian_person_id
      FROM public.persons
      WHERE tenant_id = p_tenant_id AND public.clean_cpf(cpf) = v_guardian_cpf
      LIMIT 1;
    END IF;

    -- Se não encontrou nem por UUID nem por CPF, criar nova pessoa do responsável
    IF v_guardian_person_id IS NULL THEN
      INSERT INTO public.persons (
        tenant_id,
        full_name,
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
        v_guardian_cpf,
        COALESCE((p_guardian_person->>'birth_date')::date, '1985-01-01'::date),
        COALESCE(p_guardian_person->>'gender', 'other'),
        p_guardian_person->>'phone',
        p_guardian_person->>'email',
        COALESCE(p_guardian_person->'address', '{}'::jsonb)
      )
      RETURNING id INTO v_guardian_person_id;
    ELSE
      -- Atualiza contatos se fornecidos
      UPDATE public.persons
      SET
        full_name = v_guardian_name,
        phone = COALESCE(p_guardian_person->>'phone', phone),
        email = COALESCE(p_guardian_person->>'email', email),
        cpf = COALESCE(v_guardian_cpf, cpf),
        updated_at = now()
      WHERE id = v_guardian_person_id;
    END IF;

    -- Criar ou atualizar o vínculo familiar
    INSERT INTO public.guardian_relationships (
      tenant_id,
      student_id,
      guardian_person_id,
      relationship_label,
      is_legal_guardian,
      is_financial_guardian,
      is_emergency_contact,
      is_pickup_authorized,
      notes
    )
    VALUES (
      p_tenant_id,
      v_student_id,
      v_guardian_person_id,
      COALESCE(p_guardian_rel->>'relationship_label', 'Responsável'),
      COALESCE((p_guardian_rel->>'is_legal_guardian')::boolean, true),
      COALESCE((p_guardian_rel->>'is_financial_guardian')::boolean, true),
      COALESCE((p_guardian_rel->>'is_emergency_contact')::boolean, true),
      COALESCE((p_guardian_rel->>'is_pickup_authorized')::boolean, true),
      p_guardian_rel->>'notes'
    )
    ON CONFLICT (tenant_id, student_id, guardian_person_id)
    DO UPDATE SET
      relationship_label = EXCLUDED.relationship_label,
      is_legal_guardian = EXCLUDED.is_legal_guardian,
      is_financial_guardian = EXCLUDED.is_financial_guardian,
      is_emergency_contact = EXCLUDED.is_emergency_contact,
      is_pickup_authorized = EXCLUDED.is_pickup_authorized
    RETURNING id INTO v_guardian_rel_id;
  END IF;

  -- 7. Se houver graduação inicial
  IF p_graduation IS NOT NULL AND p_graduation->>'martial_art_id' IS NOT NULL AND p_graduation->>'belt_rank_id' IS NOT NULL THEN
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
      v_student_id,
      (p_graduation->>'martial_art_id')::uuid,
      (p_graduation->>'belt_rank_id')::uuid,
      COALESCE((p_graduation->>'graduated_at')::date, current_date),
      p_graduation->>'examiner_name',
      p_graduation->>'notes'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', v_student_id,
    'person_id', v_person_id,
    'guardian_person_id', v_guardian_person_id,
    'guardian_relationship_id', v_guardian_rel_id,
    'registration_number', v_registration_number
  );
END;
$$;

-- 2. FUNÇÃO RPC PARA VINCULAR ALUNO A UM RESPONSÁVEL DIRETAMENTE
CREATE OR REPLACE FUNCTION public.link_student_to_guardian(
  p_tenant_id uuid,
  p_student_id uuid,
  p_guardian_person_id uuid,
  p_relationship_label text DEFAULT 'Responsável',
  p_is_financial boolean DEFAULT true,
  p_is_legal boolean DEFAULT true,
  p_is_emergency boolean DEFAULT true,
  p_is_pickup boolean DEFAULT true,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_rel_id uuid;
BEGIN
  -- Validar autenticação e tenant
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor') THEN
    RAISE EXCEPTION 'Permissão insuficiente nesta academia.' USING ERRCODE = '42501';
  END IF;

  -- Validar que aluno e responsável pertencem ao mesmo tenant
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Aluno não encontrado nesta academia.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.persons WHERE id = p_guardian_person_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Responsável não encontrado nesta academia.' USING ERRCODE = 'P0002';
  END IF;

  -- Inserir ou atualizar o relacionamento
  INSERT INTO public.guardian_relationships (
    tenant_id,
    student_id,
    guardian_person_id,
    relationship_label,
    is_legal_guardian,
    is_financial_guardian,
    is_emergency_contact,
    is_pickup_authorized,
    notes
  )
  VALUES (
    p_tenant_id,
    p_student_id,
    p_guardian_person_id,
    COALESCE(p_relationship_label, 'Responsável'),
    COALESCE(p_is_legal, true),
    COALESCE(p_is_financial, true),
    COALESCE(p_is_emergency, true),
    COALESCE(p_is_pickup, true),
    p_notes
  )
  ON CONFLICT (tenant_id, student_id, guardian_person_id)
  DO UPDATE SET
    relationship_label = EXCLUDED.relationship_label,
    is_legal_guardian = EXCLUDED.is_legal_guardian,
    is_financial_guardian = EXCLUDED.is_financial_guardian,
    is_emergency_contact = EXCLUDED.is_emergency_contact,
    is_pickup_authorized = EXCLUDED.is_pickup_authorized,
    notes = EXCLUDED.notes
  RETURNING id INTO v_rel_id;

  RETURN jsonb_build_object(
    'success', true,
    'relationship_id', v_rel_id,
    'action', 'linked'
  );
END;
$$;

-- 3. FUNÇÃO RPC PARA DESVINCULAR ALUNO DE UM RESPONSÁVEL ESPECÍFICO
CREATE OR REPLACE FUNCTION public.unlink_student_from_guardian(
  p_tenant_id uuid,
  p_student_id uuid,
  p_guardian_person_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Validar autenticação e tenant
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor') THEN
    RAISE EXCEPTION 'Permissão insuficiente nesta academia.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.guardian_relationships
  WHERE tenant_id = p_tenant_id
    AND student_id = p_student_id
    AND guardian_person_id = p_guardian_person_id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'unlinked'
  );
END;
$$;

-- Permissões de execução para authenticated
GRANT EXECUTE ON FUNCTION public.register_student_atomic(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_student_to_guardian(uuid, uuid, uuid, text, boolean, boolean, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_student_from_guardian(uuid, uuid, uuid) TO authenticated;
