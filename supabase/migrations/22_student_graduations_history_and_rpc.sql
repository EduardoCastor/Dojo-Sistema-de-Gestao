-- ============================================================================
-- Migration 22: Módulo de Histórico de Graduações por Arte Marcial
-- TatameHub: Gestão de Academias de Artes Marciais
-- ============================================================================
-- OBJETIVO:
--  1. Assegurar colunas e índices de alta performance na tabela student_graduations
--  2. Reforçar políticas de Row Level Security (RLS) multi-tenant com privilégios adequados
--  3. Fornecer funções RPC atômicas para registro, correção (edição) e exclusão
--     de graduações históricas e retroativas com validação estrita no banco e auditoria
-- ============================================================================

-- 1. ESTRUTURA DA TABELA STUDENT_GRADUATIONS
ALTER TABLE public.student_graduations 
  ADD COLUMN IF NOT EXISTS certificate_code text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2. ÍNDICES DE PERFORMANCE E CONSULTA CRONOLÓGICA
CREATE INDEX IF NOT EXISTS idx_student_graduations_history
  ON public.student_graduations (tenant_id, student_id, martial_art_id, graduated_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_graduations_tenant_date
  ON public.student_graduations (tenant_id, graduated_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_graduations_belt
  ON public.student_graduations (tenant_id, belt_rank_id);

-- 3. GARANTIR HABILITAÇÃO DE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.student_graduations ENABLE ROW LEVEL SECURITY;

-- 3.1 POLÍTICA DE LEITURA (SELECT)
-- Membros ativos da academia, o próprio aluno ou seu responsável legal podem ler o histórico
DROP POLICY IF EXISTS "graduations_select" ON public.student_graduations;
DROP POLICY IF EXISTS "graduations_select_tenant" ON public.student_graduations;
CREATE POLICY "graduations_select_tenant" ON public.student_graduations
FOR SELECT TO authenticated
USING (
  public.is_tenant_member(tenant_id)
  OR public.is_own_student(student_id)
  OR public.is_guardian_of_student(student_id)
);

-- 3.2 POLÍTICA DE INSERÇÃO (INSERT)
-- Usuários staff autenticados (owner, branch_manager, secretary, instructor)
-- pertencentes à mesma academia (tenant_id) podem registrar graduações
DROP POLICY IF EXISTS "graduations_insert_staff" ON public.student_graduations;
CREATE POLICY "graduations_insert_staff" ON public.student_graduations
FOR INSERT TO authenticated
WITH CHECK (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor')
);

-- 3.3 POLÍTICA DE ATUALIZAÇÃO (UPDATE)
-- Atualizações de histórico por membros staff autorizados (correções com auditoria)
DROP POLICY IF EXISTS "graduations_update_staff" ON public.student_graduations;
CREATE POLICY "graduations_update_staff" ON public.student_graduations
FOR UPDATE TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'))
WITH CHECK (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'));

-- 3.4 POLÍTICA DE EXCLUSÃO (DELETE)
-- Apenas proprietários e gestores de filial podem remover registros de graduação
DROP POLICY IF EXISTS "graduations_delete_owner" ON public.student_graduations;
CREATE POLICY "graduations_delete_owner" ON public.student_graduations
FOR DELETE TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager'));

-- ============================================================================
-- 4. FUNÇÃO RPC ATÔMICA: RECORD_STUDENT_GRADUATION
-- ============================================================================
-- Suporta data retroativa, validação estrita da modalidade e faixa na academia,
-- nome do avaliador/examinador, código comprobatório e observações.
CREATE OR REPLACE FUNCTION public.record_student_graduation(
  p_tenant_id uuid,
  p_student_id uuid,
  p_martial_art_id uuid,
  p_belt_rank_id uuid,
  p_graduated_at date DEFAULT CURRENT_DATE,
  p_examiner_name text DEFAULT 'Sensei Responsável',
  p_notes text DEFAULT NULL,
  p_certificate_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_graduation_id uuid;
  v_user_name text;
  v_martial_art_name text;
  v_belt_name text;
BEGIN
  -- 1. Validar autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: o usuário precisa estar autenticado.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validar permissão na academia
  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor') THEN
    RAISE EXCEPTION 'Permissão insuficiente para registrar graduações nesta academia.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Validar que o aluno pertence à academia ativa
  IF NOT EXISTS (
    SELECT 1 FROM public.students 
    WHERE id = p_student_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Aluno não encontrado nesta academia.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Validar que a modalidade pertence à mesma academia
  SELECT name INTO v_martial_art_name
  FROM public.martial_arts 
  WHERE id = p_martial_art_id AND tenant_id = p_tenant_id;

  IF v_martial_art_name IS NULL THEN
    RAISE EXCEPTION 'Modalidade não pertence a esta academia ou não foi encontrada.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 5. Validar que a faixa pertence à modalidade informada e à mesma academia
  SELECT name INTO v_belt_name
  FROM public.belt_ranks 
  WHERE id = p_belt_rank_id AND tenant_id = p_tenant_id AND martial_art_id = p_martial_art_id;

  IF v_belt_name IS NULL THEN
    RAISE EXCEPTION 'A graduação selecionada não pertence à modalidade informada nesta academia.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 6. Validar data da graduação
  IF p_graduated_at IS NULL THEN
    p_graduated_at := CURRENT_DATE;
  END IF;

  -- 7. Obter nome do usuário operador para auditoria
  SELECT COALESCE(full_name, 'Instrutor') INTO v_user_name
  FROM public.profiles WHERE id = v_user_id;

  -- 8. Inserir graduação no histórico
  INSERT INTO public.student_graduations (
    tenant_id,
    student_id,
    martial_art_id,
    belt_rank_id,
    graduated_at,
    examiner_name,
    certificate_code,
    notes,
    created_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    p_tenant_id,
    p_student_id,
    p_martial_art_id,
    p_belt_rank_id,
    p_graduated_at,
    COALESCE(NULLIF(TRIM(p_examiner_name), ''), v_user_name, 'Sensei Responsável'),
    NULLIF(TRIM(p_certificate_code), ''),
    NULLIF(TRIM(p_notes), ''),
    v_user_id,
    now(),
    now()
  )
  RETURNING id INTO v_graduation_id;

  -- 9. Registrar log de auditoria
  BEGIN
    INSERT INTO public.audit_logs (
      tenant_id,
      user_id,
      user_name,
      action,
      entity,
      entity_id,
      details
    ) VALUES (
      p_tenant_id,
      v_user_id,
      COALESCE(v_user_name, 'Instrutor'),
      'Registro de Graduação',
      'student_graduations',
      v_graduation_id,
      'Graduação ' || v_belt_name || ' (' || v_martial_art_name || ') em ' || p_graduated_at::text || ' para o aluno ID ' || p_student_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'id', v_graduation_id,
    'student_id', p_student_id,
    'martial_art_id', p_martial_art_id,
    'martial_art_name', v_martial_art_name,
    'belt_rank_id', p_belt_rank_id,
    'belt_rank_name', v_belt_name,
    'graduated_at', p_graduated_at,
    'examiner_name', COALESCE(NULLIF(TRIM(p_examiner_name), ''), v_user_name, 'Sensei Responsável'),
    'certificate_code', NULLIF(TRIM(p_certificate_code), ''),
    'notes', NULLIF(TRIM(p_notes), ''),
    'success', true
  );
END;
$$;

-- Sobrecarga de compatibilidade para chamadas legadas com 6 parâmetros
CREATE OR REPLACE FUNCTION public.record_student_graduation(
  p_tenant_id uuid,
  p_student_id uuid,
  p_martial_art_id uuid,
  p_belt_rank_id uuid,
  p_examiner_name text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN public.record_student_graduation(
    p_tenant_id := p_tenant_id,
    p_student_id := p_student_id,
    p_martial_art_id := p_martial_art_id,
    p_belt_rank_id := p_belt_rank_id,
    p_graduated_at := CURRENT_DATE,
    p_examiner_name := p_examiner_name,
    p_notes := p_notes,
    p_certificate_code := NULL
  );
END;
$$;

-- ============================================================================
-- 5. FUNÇÃO RPC ATÔMICA: UPDATE_STUDENT_GRADUATION (CORREÇÃO DE REGISTRO)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_student_graduation(
  p_tenant_id uuid,
  p_graduation_id uuid,
  p_martial_art_id uuid,
  p_belt_rank_id uuid,
  p_graduated_at date,
  p_examiner_name text,
  p_notes text DEFAULT NULL,
  p_certificate_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_student_id uuid;
  v_user_name text;
  v_martial_art_name text;
  v_belt_name text;
BEGIN
  -- 1. Validar autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: o usuário precisa estar autenticado.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validar permissão na academia
  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor') THEN
    RAISE EXCEPTION 'Permissão insuficiente para alterar graduações nesta academia.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Obter registro existente
  SELECT student_id INTO v_student_id
  FROM public.student_graduations
  WHERE id = p_graduation_id AND tenant_id = p_tenant_id;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Registro de graduação não encontrado nesta academia.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Validar modalidade
  SELECT name INTO v_martial_art_name
  FROM public.martial_arts 
  WHERE id = p_martial_art_id AND tenant_id = p_tenant_id;

  IF v_martial_art_name IS NULL THEN
    RAISE EXCEPTION 'Modalidade não encontrada nesta academia.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 5. Validar faixa
  SELECT name INTO v_belt_name
  FROM public.belt_ranks 
  WHERE id = p_belt_rank_id AND tenant_id = p_tenant_id AND martial_art_id = p_martial_art_id;

  IF v_belt_name IS NULL THEN
    RAISE EXCEPTION 'A graduação informada não pertence à modalidade nesta academia.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 6. Obter nome do usuário operador
  SELECT COALESCE(full_name, 'Instrutor') INTO v_user_name
  FROM public.profiles WHERE id = v_user_id;

  -- 7. Executar atualização
  UPDATE public.student_graduations
  SET
    martial_art_id = p_martial_art_id,
    belt_rank_id = p_belt_rank_id,
    graduated_at = COALESCE(p_graduated_at, CURRENT_DATE),
    examiner_name = COALESCE(NULLIF(TRIM(p_examiner_name), ''), 'Sensei Responsável'),
    notes = NULLIF(TRIM(p_notes), ''),
    certificate_code = NULLIF(TRIM(p_certificate_code), ''),
    updated_at = now()
  WHERE id = p_graduation_id AND tenant_id = p_tenant_id;

  -- 8. Auditoria
  BEGIN
    INSERT INTO public.audit_logs (
      tenant_id,
      user_id,
      user_name,
      action,
      entity,
      entity_id,
      details
    ) VALUES (
      p_tenant_id,
      v_user_id,
      COALESCE(v_user_name, 'Instrutor'),
      'Correção de Graduação',
      'student_graduations',
      p_graduation_id,
      'Graduação atualizada para ' || v_belt_name || ' (' || v_martial_art_name || ') em ' || p_graduated_at::text
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'id', p_graduation_id,
    'student_id', v_student_id,
    'martial_art_id', p_martial_art_id,
    'martial_art_name', v_martial_art_name,
    'belt_rank_id', p_belt_rank_id,
    'belt_rank_name', v_belt_name,
    'graduated_at', p_graduated_at,
    'examiner_name', p_examiner_name,
    'certificate_code', p_certificate_code,
    'notes', p_notes,
    'success', true
  );
END;
$$;

-- ============================================================================
-- 6. FUNÇÃO RPC ATÔMICA: DELETE_STUDENT_GRADUATION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_student_graduation(
  p_tenant_id uuid,
  p_graduation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_student_id uuid;
  v_user_name text;
  v_old_belt text;
BEGIN
  -- 1. Validar autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: o usuário precisa estar autenticado.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validar permissão (proprietários e gestores de filial)
  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager') THEN
    RAISE EXCEPTION 'Apenas proprietários e gestores de filial podem excluir registros do histórico de graduação.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Obter dados para auditoria
  SELECT sg.student_id, br.name INTO v_student_id, v_old_belt
  FROM public.student_graduations sg
  LEFT JOIN public.belt_ranks br ON br.id = sg.belt_rank_id
  WHERE sg.id = p_graduation_id AND sg.tenant_id = p_tenant_id;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Registro de graduação não encontrado nesta academia.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(full_name, 'Gestor') INTO v_user_name
  FROM public.profiles WHERE id = v_user_id;

  -- 4. Excluir o registro
  DELETE FROM public.student_graduations
  WHERE id = p_graduation_id AND tenant_id = p_tenant_id;

  -- 5. Registrar log de auditoria
  BEGIN
    INSERT INTO public.audit_logs (
      tenant_id,
      user_id,
      user_name,
      action,
      entity,
      entity_id,
      details
    ) VALUES (
      p_tenant_id,
      v_user_id,
      COALESCE(v_user_name, 'Gestor'),
      'Exclusão de Graduação',
      'student_graduations',
      p_graduation_id,
      'Excluído registro de graduação ' || COALESCE(v_old_belt, '') || ' do aluno ID ' || v_student_id::text
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'id', p_graduation_id,
    'student_id', v_student_id,
    'success', true
  );
END;
$$;

-- 7. CONCEDER PERMISSÕES DE EXECUÇÃO
GRANT EXECUTE ON FUNCTION public.record_student_graduation(uuid, uuid, uuid, uuid, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_student_graduation(uuid, uuid, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_student_graduation(uuid, uuid, uuid, uuid, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_student_graduation(uuid, uuid) TO authenticated;
