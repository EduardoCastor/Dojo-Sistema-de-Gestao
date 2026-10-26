-- ============================================================================
-- Migration 23: Módulo de Biblioteca Digital de Vídeos do YouTube
-- TatameHub: Gestão de Academias de Artes Marciais
-- ============================================================================
-- OBJETIVO:
--  1. Criar tabelas public.digital_library_videos e public.digital_library_video_belts
--  2. Normalização e integridade de vídeos do YouTube vinculados a artes marciais e faixas
--  3. Políticas estritas de Row Level Security (RLS) multi-tenant e por papel de acesso
--  4. RPCs atômicas com validação no banco de dados para consulta e gestão pedagógica
-- ============================================================================

-- 1. TABELA PRINCIPAL DE VÍDEOS DA BIBLIOTECA DIGITAL
CREATE TABLE IF NOT EXISTS public.digital_library_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  martial_art_id uuid NOT NULL REFERENCES public.martial_arts(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  youtube_url text NOT NULL,
  youtube_video_id text NOT NULL,
  thumbnail_url text NOT NULL,
  category text NOT NULL DEFAULT 'waza_techniques' CHECK (
    category IN ('kata', 'waza_techniques', 'physical_prep', 'rules_referee', 'philosophy_history', 'general')
  ),
  author_instructor text,
  display_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published' CHECK (
    status IN ('published', 'draft', 'archived')
  ),
  all_belts boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. TABELA DE ASSOCIAÇÃO ENTRE VÍDEOS E GRADUAÇÕES/FAIXAS ALVO (M:N)
CREATE TABLE IF NOT EXISTS public.digital_library_video_belts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES public.digital_library_videos(id) ON DELETE CASCADE,
  belt_rank_id uuid NOT NULL REFERENCES public.belt_ranks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_video_belt_association UNIQUE (tenant_id, video_id, belt_rank_id)
);

-- 3. ÍNDICES DE PERFORMANCE E PESQUISA MULTI-TENANT
CREATE INDEX IF NOT EXISTS idx_digital_library_videos_tenant_status 
  ON public.digital_library_videos (tenant_id, status, martial_art_id, display_order ASC);

CREATE INDEX IF NOT EXISTS idx_digital_library_videos_martial_art 
  ON public.digital_library_videos (tenant_id, martial_art_id);

CREATE INDEX IF NOT EXISTS idx_digital_library_video_belts_video 
  ON public.digital_library_video_belts (tenant_id, video_id);

CREATE INDEX IF NOT EXISTS idx_digital_library_video_belts_rank 
  ON public.digital_library_video_belts (tenant_id, belt_rank_id);

-- 4. HABILITAÇÃO DE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.digital_library_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_library_video_belts ENABLE ROW LEVEL SECURITY;

-- 4.1 POLÍTICAS PARA public.digital_library_videos
DROP POLICY IF EXISTS "digital_library_videos_select" ON public.digital_library_videos;
CREATE POLICY "digital_library_videos_select" ON public.digital_library_videos
FOR SELECT TO authenticated
USING (
  -- Membros da equipe administrativa/instrutores podem ver tudo (inclusive rascunhos e arquivados)
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor')
  OR (
    -- Alunos podem visualizar apenas vídeos publicados
    status = 'published'
    AND public.is_tenant_member(tenant_id)
    AND (
      -- Se for liberado para todas as faixas e o aluno treina a modalidade
      (
        all_belts = true
        AND EXISTS (
          SELECT 1 
          FROM public.students st
          WHERE st.tenant_id = public.digital_library_videos.tenant_id
            AND (public.is_own_student(st.id) OR public.is_guardian_of_student(st.id))
            AND (
              EXISTS (
                SELECT 1 FROM public.enrollments en
                WHERE en.student_id = st.id
                  AND en.martial_art_id = public.digital_library_videos.martial_art_id
                  AND en.status = 'active'
              )
              OR EXISTS (
                SELECT 1 FROM public.student_graduations sg
                WHERE sg.student_id = st.id
                  AND sg.martial_art_id = public.digital_library_videos.martial_art_id
              )
            )
        )
      )
      OR EXISTS (
        SELECT 1 
        FROM public.digital_library_video_belts vb
        JOIN public.student_graduations sg ON sg.belt_rank_id = vb.belt_rank_id
        JOIN public.students st ON st.id = sg.student_id
        WHERE vb.video_id = public.digital_library_videos.id
          AND vb.tenant_id = public.digital_library_videos.tenant_id
          AND st.tenant_id = public.digital_library_videos.tenant_id
          AND (public.is_own_student(st.id) OR public.is_guardian_of_student(st.id))
      )
    )
  )
);

DROP POLICY IF EXISTS "digital_library_videos_insert" ON public.digital_library_videos;
CREATE POLICY "digital_library_videos_insert" ON public.digital_library_videos
FOR INSERT TO authenticated
WITH CHECK (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor')
);

DROP POLICY IF EXISTS "digital_library_videos_update" ON public.digital_library_videos;
CREATE POLICY "digital_library_videos_update" ON public.digital_library_videos
FOR UPDATE TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'))
WITH CHECK (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'));

DROP POLICY IF EXISTS "digital_library_videos_delete" ON public.digital_library_videos;
CREATE POLICY "digital_library_videos_delete" ON public.digital_library_videos
FOR DELETE TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'));

-- 4.2 POLÍTICAS PARA public.digital_library_video_belts
DROP POLICY IF EXISTS "digital_library_video_belts_select" ON public.digital_library_video_belts;
CREATE POLICY "digital_library_video_belts_select" ON public.digital_library_video_belts
FOR SELECT TO authenticated
USING (
  public.is_tenant_member(tenant_id)
);

DROP POLICY IF EXISTS "digital_library_video_belts_manage" ON public.digital_library_video_belts;
CREATE POLICY "digital_library_video_belts_manage" ON public.digital_library_video_belts
FOR ALL TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'))
WITH CHECK (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'));

-- 5. RPC FUNCTIONS PARA GESTÃO SEGURA E AUDITADA

-- 5.1 Salvar ou atualizar vídeo com vínculos de faixas
DROP FUNCTION IF EXISTS public.save_digital_library_video(uuid, uuid, uuid, text, text, text, text, text, text, text, integer, text, boolean, uuid[]);

CREATE OR REPLACE FUNCTION public.save_digital_library_video(
  p_tenant_id uuid,
  p_video_id uuid,
  p_martial_art_id uuid,
  p_title text,
  p_description text,
  p_youtube_url text,
  p_youtube_video_id text,
  p_thumbnail_url text,
  p_category text,
  p_author_instructor text,
  p_display_order integer,
  p_status text,
  p_all_belts boolean,
  p_belt_rank_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_res_video_id uuid;
  v_belt_id uuid;
BEGIN
  -- Validação de privilégios de staff no tenant
  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor') THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores e instrutores autorizados podem gerenciar a Biblioteca Digital.';
  END IF;

  -- Validação de campos obrigatórios
  IF trim(p_title) = '' THEN
    RAISE EXCEPTION 'O título do vídeo não pode estar em branco.';
  END IF;

  IF trim(p_youtube_video_id) = '' OR length(trim(p_youtube_video_id)) < 8 THEN
    RAISE EXCEPTION 'Identificador de vídeo do YouTube inválido.';
  END IF;

  IF p_status NOT IN ('published', 'draft', 'archived') THEN
    RAISE EXCEPTION 'Situação do vídeo inválida: %', p_status;
  END IF;

  -- Inserir ou atualizar registro de vídeo
  IF p_video_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.digital_library_videos WHERE id = p_video_id AND tenant_id = p_tenant_id) THEN
    UPDATE public.digital_library_videos
    SET
      martial_art_id = p_martial_art_id,
      title = trim(p_title),
      description = trim(COALESCE(p_description, '')),
      youtube_url = trim(p_youtube_url),
      youtube_video_id = trim(p_youtube_video_id),
      thumbnail_url = trim(p_thumbnail_url),
      category = p_category,
      author_instructor = trim(COALESCE(p_author_instructor, '')),
      display_order = COALESCE(p_display_order, 0),
      status = p_status,
      all_belts = COALESCE(p_all_belts, false),
      updated_at = now()
    WHERE id = p_video_id AND tenant_id = p_tenant_id
    RETURNING id INTO v_res_video_id;
  ELSE
    INSERT INTO public.digital_library_videos (
      id,
      tenant_id,
      martial_art_id,
      title,
      description,
      youtube_url,
      youtube_video_id,
      thumbnail_url,
      category,
      author_instructor,
      display_order,
      status,
      all_belts,
      created_by_user_id,
      created_at,
      updated_at
    ) VALUES (
      COALESCE(p_video_id, gen_random_uuid()),
      p_tenant_id,
      p_martial_art_id,
      trim(p_title),
      trim(COALESCE(p_description, '')),
      trim(p_youtube_url),
      trim(p_youtube_video_id),
      trim(p_thumbnail_url),
      p_category,
      trim(COALESCE(p_author_instructor, '')),
      COALESCE(p_display_order, 0),
      p_status,
      COALESCE(p_all_belts, false),
      auth.uid(),
      now(),
      now()
    )
    RETURNING id INTO v_res_video_id;
  END IF;

  -- Atualizar associações de faixas (remover existentes e reinserir se não for all_belts)
  DELETE FROM public.digital_library_video_belts
  WHERE tenant_id = p_tenant_id AND video_id = v_res_video_id;

  IF NOT p_all_belts AND p_belt_rank_ids IS NOT NULL AND array_length(p_belt_rank_ids, 1) > 0 THEN
    FOREACH v_belt_id IN ARRAY p_belt_rank_ids LOOP
      -- Validar se a faixa pertence ao mesmo tenant e arte marcial
      IF EXISTS (
        SELECT 1 FROM public.belt_ranks 
        WHERE id = v_belt_id AND tenant_id = p_tenant_id AND martial_art_id = p_martial_art_id
      ) THEN
        INSERT INTO public.digital_library_video_belts (tenant_id, video_id, belt_rank_id)
        VALUES (p_tenant_id, v_res_video_id, v_belt_id)
        ON CONFLICT (tenant_id, video_id, belt_rank_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_res_video_id;
END;
$$;

-- 5.2 Excluir vídeo da biblioteca
DROP FUNCTION IF EXISTS public.delete_digital_library_video(uuid, uuid);

CREATE OR REPLACE FUNCTION public.delete_digital_library_video(
  p_tenant_id uuid,
  p_video_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor') THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores e instrutores podem excluir conteúdos da Biblioteca Digital.';
  END IF;

  DELETE FROM public.digital_library_video_belts
  WHERE tenant_id = p_tenant_id AND video_id = p_video_id;

  DELETE FROM public.digital_library_videos
  WHERE tenant_id = p_tenant_id AND id = p_video_id;

  RETURN true;
END;
$$;

-- 5.3 Consultar vídeos pedagógicos acessíveis ao aluno autenticado
DROP FUNCTION IF EXISTS public.get_student_accessible_videos(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_student_accessible_videos(
  p_tenant_id uuid,
  p_student_id uuid
)
RETURNS TABLE (
  video_id uuid,
  tenant_id uuid,
  martial_art_id uuid,
  martial_art_name text,
  title text,
  description text,
  youtube_url text,
  youtube_video_id text,
  thumbnail_url text,
  category text,
  author_instructor text,
  display_order integer,
  all_belts boolean,
  target_belt_names text[],
  target_belt_ids uuid[],
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Validar se o usuário é o próprio aluno, seu responsável ou staff
  IF NOT (
    public.is_tenant_member(p_tenant_id)
    AND (
      public.is_own_student(p_student_id)
      OR public.is_guardian_of_student(p_student_id)
      OR public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor')
    )
  ) THEN
    RAISE EXCEPTION 'Acesso negado ao acervo do aluno informado.';
  END IF;

  RETURN QUERY
  WITH student_active_arts AS (
    -- Modalidades em que o aluno possui matrícula ativa ou graduação registrada
    SELECT DISTINCT en.martial_art_id
    FROM public.enrollments en
    WHERE en.student_id = p_student_id
      AND en.tenant_id = p_tenant_id
      AND en.status = 'active'
    UNION
    SELECT DISTINCT sg.martial_art_id
    FROM public.student_graduations sg
    WHERE sg.student_id = p_student_id
      AND sg.tenant_id = p_tenant_id
  ),
  student_belts AS (
    -- Faixa atual do aluno por modalidade
    SELECT DISTINCT sg.martial_art_id, sg.belt_rank_id
    FROM public.student_graduations sg
    WHERE sg.student_id = p_student_id
      AND sg.tenant_id = p_tenant_id
  ),
  video_belts_agg AS (
    SELECT 
      vb.video_id,
      array_agg(br.name ORDER BY br.sort_order ASC) AS belt_names,
      array_agg(br.id) AS belt_ids
    FROM public.digital_library_video_belts vb
    JOIN public.belt_ranks br ON br.id = vb.belt_rank_id
    WHERE vb.tenant_id = p_tenant_id
    GROUP BY vb.video_id
  )
  SELECT 
    v.id AS video_id,
    v.tenant_id,
    v.martial_art_id,
    ma.name AS martial_art_name,
    v.title,
    v.description,
    v.youtube_url,
    v.youtube_video_id,
    v.thumbnail_url,
    v.category,
    v.author_instructor,
    v.display_order,
    v.all_belts,
    COALESCE(vba.belt_names, ARRAY[]::text[]) AS target_belt_names,
    COALESCE(vba.belt_ids, ARRAY[]::uuid[]) AS target_belt_ids,
    v.created_at
  FROM public.digital_library_videos v
  JOIN public.martial_arts ma ON ma.id = v.martial_art_id
  LEFT JOIN video_belts_agg vba ON vba.video_id = v.id
  WHERE v.tenant_id = p_tenant_id
    AND v.status = 'published'
    AND v.martial_art_id IN (SELECT martial_art_id FROM student_active_arts)
    AND (
      v.all_belts = true
      OR EXISTS (
        SELECT 1 
        FROM public.digital_library_video_belts dvb
        WHERE dvb.video_id = v.id
          AND dvb.belt_rank_id IN (
            SELECT sb.belt_rank_id 
            FROM student_belts sb 
            WHERE sb.martial_art_id = v.martial_art_id
          )
      )
    )
  ORDER BY v.display_order ASC, v.created_at DESC;
END;
$$;
