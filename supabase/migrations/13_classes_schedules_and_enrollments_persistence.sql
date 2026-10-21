-- ============================================================================
-- ARQUIVO: 13_classes_schedules_and_enrollments_persistence.sql
-- OBJETIVO: Persistência completa do módulo Turmas & Horários no TatameHub,
--           criação de horários estruturados semanais (class_schedules),
--           políticas RLS para matrículas (enrollments) e RPCs atômicas de gestão.
-- ============================================================================

-- 1. EXTENSÃO DA TABELA public.class_groups
ALTER TABLE public.class_groups ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.class_groups ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Garantir índices para buscas e isolamento
CREATE INDEX IF NOT EXISTS idx_classes_martial_art ON public.class_groups(tenant_id, martial_art_id);
CREATE INDEX IF NOT EXISTS idx_classes_active ON public.class_groups(tenant_id, active);

-- Políticas RLS para public.class_groups (incluindo instrutores)
DROP POLICY IF EXISTS "classes_select" ON public.class_groups;
CREATE POLICY "classes_select" ON public.class_groups
FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "classes_write_staff" ON public.class_groups;
CREATE POLICY "classes_write_staff" ON public.class_groups
FOR ALL TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'))
WITH CHECK (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'));

-- ============================================================================
-- 2. TABELA DE HORÁRIOS ESTRUTURADOS SEMANAIS: public.class_schedules
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.class_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  class_group_id uuid NOT NULL REFERENCES public.class_groups(id) ON DELETE CASCADE,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0: Dom, 1: Seg, 2: Ter, 3: Qua, 4: Qui, 5: Sex, 6: Sáb
  start_time time NOT NULL,
  end_time time NOT NULL,
  tatami_room text NOT NULL DEFAULT 'Tatami Principal',
  instructor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  instructor_name text,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_schedule_interval CHECK (start_time < end_time)
);

ALTER TABLE public.class_schedules ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_schedules_tenant_class ON public.class_schedules(tenant_id, class_group_id);
CREATE INDEX IF NOT EXISTS idx_schedules_time_slot ON public.class_schedules(tenant_id, day_of_week, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_schedules_room ON public.class_schedules(tenant_id, tatami_room);

-- Políticas RLS para public.class_schedules
DROP POLICY IF EXISTS "schedules_select" ON public.class_schedules;
CREATE POLICY "schedules_select" ON public.class_schedules
FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "schedules_write_staff" ON public.class_schedules;
CREATE POLICY "schedules_write_staff" ON public.class_schedules
FOR ALL TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'))
WITH CHECK (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'));

-- ============================================================================
-- 3. POLÍTICAS RLS PARA public.enrollments (MATRÍCULAS EM TURMAS)
-- ============================================================================
-- A tabela public.enrollments já existe na migração 01, mas carecia de políticas RLS.
DROP POLICY IF EXISTS "enrollments_select" ON public.enrollments;
CREATE POLICY "enrollments_select" ON public.enrollments
FOR SELECT TO authenticated
USING (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor', 'financial')
  OR public.is_own_student(student_id)
  OR public.is_guardian_of_student(student_id)
);

DROP POLICY IF EXISTS "enrollments_write_staff" ON public.enrollments;
CREATE POLICY "enrollments_write_staff" ON public.enrollments
FOR ALL TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'))
WITH CHECK (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'));

CREATE INDEX IF NOT EXISTS idx_enrollments_tenant_class ON public.enrollments(tenant_id, class_group_id, status);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON public.enrollments(tenant_id, student_id, status);

-- ============================================================================
-- 4. FUNÇÃO RPC ATÔMICA: SALVAR TURMA COM HORÁRIOS ESTRUTURADOS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.save_class_with_schedules_atomic(
  p_tenant_id uuid,
  p_class_data jsonb,
  p_schedules jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_class_id uuid;
  v_branch_id uuid;
  v_martial_art_id uuid;
  v_name text;
  v_instructor_id uuid;
  v_instructor_name text;
  v_days_of_week int[];
  v_start_time time;
  v_end_time time;
  v_max_capacity int;
  v_min_age int;
  v_max_age int;
  v_tatami_room text;
  v_active boolean;
  v_notes text;
  v_schedule_elem jsonb;
  v_sched_id uuid;
  v_sched_day int;
  v_sched_start time;
  v_sched_end time;
  v_sched_room text;
  v_sched_inst_name text;
  v_sched_inst_id uuid;
  v_saved_class jsonb;
  v_saved_schedules jsonb;
BEGIN
  -- 1. Validar autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: o usuário precisa estar autenticado.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validar permissões de staff no tenant
  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor') THEN
    RAISE EXCEPTION 'Permissão insuficiente para gerenciar turmas nesta academia.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Extrair dados da turma
  v_name := trim(p_class_data->>'name');
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'O nome da turma é obrigatório.' USING ERRCODE = '23502';
  END IF;

  v_branch_id := (p_class_data->>'branch_id')::uuid;
  v_martial_art_id := (p_class_data->>'martial_art_id')::uuid;
  v_instructor_name := COALESCE(p_class_data->>'head_instructor_name', 'Sensei Responsável');
  v_start_time := COALESCE((p_class_data->>'start_time')::time, '18:00'::time);
  v_end_time := COALESCE((p_class_data->>'end_time')::time, '19:00'::time);
  v_max_capacity := COALESCE((p_class_data->>'max_capacity')::int, 20);
  v_min_age := COALESCE((p_class_data->>'min_age')::int, 5);
  v_max_age := (p_class_data->>'max_age')::int;
  v_tatami_room := COALESCE(p_class_data->>'tatami_room', 'Tatami Principal');
  v_active := COALESCE((p_class_data->>'active')::boolean, true);
  v_notes := p_class_data->>'notes';

  IF p_class_data->>'head_instructor_user_id' IS NOT NULL AND length(trim(p_class_data->>'head_instructor_user_id')) = 36 THEN
    v_instructor_id := (p_class_data->>'head_instructor_user_id')::uuid;
  END IF;

  -- Dias da semana (array de inteiros)
  IF p_class_data->'days_of_week' IS NOT NULL THEN
    SELECT array_agg(elem::int)
    INTO v_days_of_week
    FROM jsonb_array_elements_text(p_class_data->'days_of_week') elem;
  ELSE
    v_days_of_week := ARRAY[1, 3, 5];
  END IF;

  IF v_start_time >= v_end_time THEN
    RAISE EXCEPTION 'O horário de início (%) deve ser anterior ao de término (%).', v_start_time, v_end_time
      USING ERRCODE = '22023';
  END IF;

  -- 4. Inserir ou atualizar na tabela public.class_groups
  IF p_class_data->>'id' IS NOT NULL AND length(trim(p_class_data->>'id')) = 36 THEN
    v_class_id := (p_class_data->>'id')::uuid;

    UPDATE public.class_groups
    SET
      branch_id = v_branch_id,
      martial_art_id = v_martial_art_id,
      name = v_name,
      head_instructor_user_id = v_instructor_id,
      head_instructor_name = v_instructor_name,
      days_of_week = v_days_of_week,
      start_time = v_start_time,
      end_time = v_end_time,
      max_capacity = v_max_capacity,
      min_age = v_min_age,
      max_age = v_max_age,
      tatami_room = v_tatami_room,
      active = v_active,
      notes = v_notes,
      updated_at = now()
    WHERE id = v_class_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Turma não localizada para atualização nesta academia.'
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    INSERT INTO public.class_groups (
      tenant_id,
      branch_id,
      martial_art_id,
      name,
      head_instructor_user_id,
      head_instructor_name,
      days_of_week,
      start_time,
      end_time,
      max_capacity,
      min_age,
      max_age,
      tatami_room,
      active,
      notes
    )
    VALUES (
      p_tenant_id,
      v_branch_id,
      v_martial_art_id,
      v_name,
      v_instructor_id,
      v_instructor_name,
      v_days_of_week,
      v_start_time,
      v_end_time,
      v_max_capacity,
      v_min_age,
      v_max_age,
      v_tatami_room,
      v_active,
      v_notes
    )
    RETURNING id INTO v_class_id;
  END IF;

  -- 5. Sincronizar horários estruturados em public.class_schedules
  -- Removemos os horários antigos desta turma e reinserimos a grade atualizada
  DELETE FROM public.class_schedules
  WHERE class_group_id = v_class_id AND tenant_id = p_tenant_id;

  IF jsonb_array_length(p_schedules) > 0 THEN
    FOR v_schedule_elem IN SELECT * FROM jsonb_array_elements(p_schedules)
    LOOP
      v_sched_day := (v_schedule_elem->>'day_of_week')::int;
      v_sched_start := (v_schedule_elem->>'start_time')::time;
      v_sched_end := (v_schedule_elem->>'end_time')::time;
      v_sched_room := COALESCE(v_schedule_elem->>'tatami_room', v_tatami_room);
      v_sched_inst_name := COALESCE(v_schedule_elem->>'instructor_name', v_instructor_name);

      IF v_schedule_elem->>'instructor_user_id' IS NOT NULL AND length(trim(v_schedule_elem->>'instructor_user_id')) = 36 THEN
        v_sched_inst_id := (v_schedule_elem->>'instructor_user_id')::uuid;
      ELSE
        v_sched_inst_id := v_instructor_id;
      END IF;

      IF v_sched_start >= v_sched_end THEN
        RAISE EXCEPTION 'Horário de início (%) deve ser menor que o término (%) no dia %.', v_sched_start, v_sched_end, v_sched_day
          USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.class_schedules (
        tenant_id,
        class_group_id,
        day_of_week,
        start_time,
        end_time,
        tatami_room,
        instructor_user_id,
        instructor_name,
        active,
        notes
      )
      VALUES (
        p_tenant_id,
        v_class_id,
        v_sched_day,
        v_sched_start,
        v_sched_end,
        v_sched_room,
        v_sched_inst_id,
        v_sched_inst_name,
        COALESCE((v_schedule_elem->>'active')::boolean, true),
        v_schedule_elem->>'notes'
      );
    END LOOP;
  ELSE
    -- Caso nenhum schedule detalhado tenha sido informado, gerar a partir de days_of_week
    FOREACH v_sched_day IN ARRAY v_days_of_week
    LOOP
      INSERT INTO public.class_schedules (
        tenant_id,
        class_group_id,
        day_of_week,
        start_time,
        end_time,
        tatami_room,
        instructor_user_id,
        instructor_name,
        active
      )
      VALUES (
        p_tenant_id,
        v_class_id,
        v_sched_day,
        v_start_time,
        v_end_time,
        v_tatami_room,
        v_instructor_id,
        v_instructor_name,
        v_active
      );
    END LOOP;
  END IF;

  -- 6. Auditoria
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
    'Gravação de Turma',
    'ClassGroup',
    v_class_id,
    'Turma ' || v_name || ' salva com sucesso no ' || v_tatami_room
  );

  -- 7. Retorno estruturado
  SELECT to_jsonb(cg) INTO v_saved_class FROM public.class_groups cg WHERE id = v_class_id;
  SELECT jsonb_agg(to_jsonb(cs)) INTO v_saved_schedules FROM public.class_schedules cs WHERE class_group_id = v_class_id;

  RETURN jsonb_build_object(
    'success', true,
    'class_id', v_class_id,
    'class', v_saved_class,
    'schedules', COALESCE(v_saved_schedules, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_class_with_schedules_atomic(uuid, jsonb, jsonb) TO authenticated;

-- ============================================================================
-- 5. FUNÇÃO RPC: MATRICULAR ALUNO EM TURMA COM VERIFICAÇÃO DE VAGAS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enroll_student_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_student_id uuid,
  p_class_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_enrollment_id uuid;
  v_class_capacity int;
  v_current_enrolled int;
  v_student_name text;
  v_class_name text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: o usuário precisa estar autenticado.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor') THEN
    RAISE EXCEPTION 'Permissão insuficiente para matricular alunos nesta academia.' USING ERRCODE = '42501';
  END IF;

  -- Validar que o aluno pertence ao tenant
  SELECT p.full_name INTO v_student_name
  FROM public.students s
  JOIN public.persons p ON p.id = s.person_id
  WHERE s.id = p_student_id AND s.tenant_id = p_tenant_id;

  IF v_student_name IS NULL THEN
    RAISE EXCEPTION 'Aluno não localizado nesta academia.' USING ERRCODE = 'P0002';
  END IF;

  -- Validar turma e capacidade
  SELECT name, max_capacity INTO v_class_name, v_class_capacity
  FROM public.class_groups
  WHERE id = p_class_group_id AND tenant_id = p_tenant_id;

  IF v_class_name IS NULL THEN
    RAISE EXCEPTION 'Turma não localizada nesta academia.' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_current_enrolled
  FROM public.enrollments
  WHERE class_group_id = p_class_group_id AND tenant_id = p_tenant_id AND status = 'active';

  -- Inserir ou reativar matrícula
  INSERT INTO public.enrollments (
    tenant_id,
    branch_id,
    student_id,
    class_group_id,
    enrolled_at,
    status
  )
  VALUES (
    p_tenant_id,
    p_branch_id,
    p_student_id,
    p_class_group_id,
    CURRENT_DATE,
    'active'
  )
  ON CONFLICT (tenant_id, student_id, class_group_id)
  DO UPDATE SET
    status = 'active',
    enrolled_at = CURRENT_DATE
  RETURNING id INTO v_enrollment_id;

  RETURN jsonb_build_object(
    'success', true,
    'enrollment_id', v_enrollment_id,
    'student_name', v_student_name,
    'class_name', v_class_name,
    'is_over_capacity', (v_current_enrolled + 1 > v_class_capacity),
    'current_enrolled', v_current_enrolled + 1,
    'max_capacity', v_class_capacity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enroll_student_atomic(uuid, uuid, uuid, uuid) TO authenticated;
