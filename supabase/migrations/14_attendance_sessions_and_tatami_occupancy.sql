-- ============================================================================
-- ARQUIVO: 14_attendance_sessions_and_tatami_occupancy.sql
-- OBJETIVO: Persistência completa do Controle de Frequência no TatameHub,
--           criação da tabela de sessões/aulas (class_sessions), extensão de
--           attendance_records com status 'late', políticas RLS e RPC atômica.
-- ============================================================================

-- 1. EXTENSÃO DO ENUM attendance_status
DO $$ BEGIN
  ALTER TYPE attendance_status ADD VALUE IF NOT EXISTS 'late';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. TABELA DE SESSÕES / AULAS: public.class_sessions
CREATE TABLE IF NOT EXISTS public.class_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  class_group_id uuid NOT NULL REFERENCES public.class_groups(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  scheduled_start_time time,
  scheduled_end_time time,
  instructor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  instructor_name text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('open', 'completed', 'canceled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_class_session_date UNIQUE (tenant_id, class_group_id, session_date)
);

ALTER TABLE public.class_sessions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_sessions_tenant_class ON public.class_sessions(tenant_id, class_group_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_date ON public.class_sessions(tenant_id, session_date);

-- Políticas RLS para public.class_sessions
DROP POLICY IF EXISTS "sessions_select" ON public.class_sessions;
CREATE POLICY "sessions_select" ON public.class_sessions
FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "sessions_write_staff" ON public.class_sessions;
CREATE POLICY "sessions_write_staff" ON public.class_sessions
FOR ALL TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'))
WITH CHECK (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'));

-- 3. EXTENSÃO E POLÍTICAS PARA public.attendance_records
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.class_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_attendance_tenant_date ON public.attendance_records(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON public.attendance_records(tenant_id, student_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON public.attendance_records(tenant_id, session_id);

-- Atualização das Políticas RLS de attendance_records para permitir UPDATE e DELETE além de INSERT
DROP POLICY IF EXISTS "attendance_select" ON public.attendance_records;
CREATE POLICY "attendance_select" ON public.attendance_records
FOR SELECT TO authenticated
USING (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor')
  OR public.is_own_student(student_id)
  OR public.is_guardian_of_student(student_id)
);

DROP POLICY IF EXISTS "attendance_insert_sensei" ON public.attendance_records;
DROP POLICY IF EXISTS "attendance_write_staff" ON public.attendance_records;
CREATE POLICY "attendance_write_staff" ON public.attendance_records
FOR ALL TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'instructor', 'secretary'))
WITH CHECK (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'instructor', 'secretary'));

-- 4. FUNÇÃO RPC ATÔMICA: SALVAR CHAMADA COMPLETA NO SUPABASE
CREATE OR REPLACE FUNCTION public.save_attendance_atomic(
  p_tenant_id uuid,
  p_class_group_id uuid,
  p_session_date date,
  p_start_time time DEFAULT NULL,
  p_end_time time DEFAULT NULL,
  p_instructor_name text DEFAULT NULL,
  p_session_status text DEFAULT 'completed',
  p_session_notes text DEFAULT NULL,
  p_records jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_user_name text;
  v_session_id uuid;
  v_rec_elem jsonb;
  v_student_id uuid;
  v_status attendance_status;
  v_status_text text;
  v_notes text;
  v_saved_records_count int := 0;
  v_saved_session jsonb;
  v_saved_records jsonb;
BEGIN
  -- 1. Validar autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: o usuário precisa estar autenticado.' USING ERRCODE = '42501';
  END IF;

  -- 2. Validar permissões de equipe no tenant
  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor') THEN
    RAISE EXCEPTION 'Permissão insuficiente para registrar chamada nesta academia.' USING ERRCODE = '42501';
  END IF;

  -- Obter nome do usuário gravador
  SELECT COALESCE(raw_user_meta_data->>'name', email, 'Sensei')
  INTO v_user_name
  FROM auth.users
  WHERE id = v_user_id;

  -- 3. Inserir ou atualizar a sessão da aula (class_sessions)
  INSERT INTO public.class_sessions (
    tenant_id,
    class_group_id,
    session_date,
    scheduled_start_time,
    scheduled_end_time,
    instructor_user_id,
    instructor_name,
    status,
    notes,
    updated_at
  )
  VALUES (
    p_tenant_id,
    p_class_group_id,
    p_session_date,
    p_start_time,
    p_end_time,
    v_user_id,
    COALESCE(p_instructor_name, v_user_name),
    COALESCE(p_session_status, 'completed'),
    p_session_notes,
    now()
  )
  ON CONFLICT (tenant_id, class_group_id, session_date)
  DO UPDATE SET
    scheduled_start_time = COALESCE(EXCLUDED.scheduled_start_time, class_sessions.scheduled_start_time),
    scheduled_end_time = COALESCE(EXCLUDED.scheduled_end_time, class_sessions.scheduled_end_time),
    instructor_name = COALESCE(EXCLUDED.instructor_name, class_sessions.instructor_name),
    status = EXCLUDED.status,
    notes = EXCLUDED.notes,
    updated_at = now()
  RETURNING id INTO v_session_id;

  -- 4. Processar cada registro individual de frequência dos alunos
  IF jsonb_array_length(p_records) > 0 THEN
    FOR v_rec_elem IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
      v_student_id := (v_rec_elem->>'student_id')::uuid;
      v_status_text := COALESCE(v_rec_elem->>'status', 'present');
      v_notes := v_rec_elem->>'notes';

      -- Tratar conversão segura para o enum
      BEGIN
        v_status := v_status_text::attendance_status;
      EXCEPTION
        WHEN OTHERS THEN
          v_status := 'present'::attendance_status;
      END;

      -- Upsert no attendance_records baseado na restrição única (tenant_id, class_group_id, student_id, date)
      INSERT INTO public.attendance_records (
        tenant_id,
        class_group_id,
        session_id,
        student_id,
        date,
        status,
        notes,
        recorded_by_user_id,
        recorded_by_name,
        created_at,
        updated_at
      )
      VALUES (
        p_tenant_id,
        p_class_group_id,
        v_session_id,
        v_student_id,
        p_session_date,
        v_status,
        v_notes,
        v_user_id,
        COALESCE(v_rec_elem->>'recorded_by_name', v_user_name),
        now(),
        now()
      )
      ON CONFLICT (tenant_id, class_group_id, student_id, date)
      DO UPDATE SET
        session_id = v_session_id,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        recorded_by_user_id = v_user_id,
        recorded_by_name = COALESCE(EXCLUDED.recorded_by_name, attendance_records.recorded_by_name),
        updated_at = now();

      v_saved_records_count := v_saved_records_count + 1;
    END LOOP;
  END IF;

  -- 5. Retornar sessão consolidada e registros gravados
  SELECT row_to_json(s)::jsonb INTO v_saved_session
  FROM public.class_sessions s WHERE s.id = v_session_id;

  SELECT jsonb_agg(row_to_json(r)::jsonb) INTO v_saved_records
  FROM public.attendance_records r
  WHERE r.tenant_id = p_tenant_id AND r.class_group_id = p_class_group_id AND r.date = p_session_date;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'saved_records_count', v_saved_records_count,
    'session', v_saved_session,
    'records', COALESCE(v_saved_records, '[]'::jsonb)
  );
END;
$$;
