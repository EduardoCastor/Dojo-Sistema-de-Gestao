-- ============================================================================
-- MIGRATION 40: CORREÇÃO DEFINITIVA DO ACESSO À BIBLIOTECA DIGITAL NO PORTAL DO ALUNO
-- ============================================================================
-- Produto: Tatame Club (https://tatameclub.com.br)
-- Empresa: Beaver Soluções em Tecnologia (CNPJ: 28.410.730/0001-80)
--
-- OBJETIVO:
-- 1. Conceder permissão de execução (GRANT EXECUTE) na RPC get_student_accessible_videos
--    para authenticated e service_role (evitando erro 42501 / PGRST202 no PostgREST).
-- 2. Corrigir get_student_accessible_videos para:
--    - Usar LEFT JOIN com martial_arts (evitando exclusão de vídeos gerais sem arte vinculada);
--    - Permitir que vídeos marcados com all_belts = true sejam retornados para qualquer
--      aluno ativo do tenant, mesmo que recém-matriculado sem turmas/graduações lançadas;
--    - Validar permissão de acesso via is_own_student, is_guardian_of_student,
--      tenant_memberships (student/guardian) e staff administrativo.
-- 3. Atualizar política RLS "digital_library_videos_select" para garantir que alunos e
--    responsáveis autenticados na academia consigam ler vídeos publicados.
-- 4. Conceder permissões e recarregar schema no PostgREST (NOTIFY pgrst).
-- ============================================================================

-- 1. CORREÇÃO DA RPC get_student_accessible_videos
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
DECLARE
  v_uid uuid := auth.uid();
  v_is_authorized boolean := false;
BEGIN
  -- 1. Validação de autorização robusta multi-tenant
  IF public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor') THEN
    v_is_authorized := true;
  ELSIF public.is_own_student(p_student_id) OR public.is_guardian_of_student(p_student_id) THEN
    v_is_authorized := true;
  ELSIF EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = v_uid
      AND tm.status = 'active'
      AND (tm.student_id = p_student_id OR tm.role = 'student')
  ) THEN
    v_is_authorized := true;
  ELSIF EXISTS (
    SELECT 1 FROM public.students st
    LEFT JOIN public.persons p ON p.id = st.person_id
    WHERE st.id = p_student_id
      AND st.tenant_id = p_tenant_id
      AND (st.user_id = v_uid OR p.user_id = v_uid)
  ) THEN
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Acesso negado: o usuário não possui permissão para consultar o acervo deste aluno.';
  END IF;

  RETURN QUERY
  WITH student_active_arts AS (
    -- Modalidades em que o aluno possui matrícula ativa ou graduação registrada
    SELECT DISTINCT cg.martial_art_id
    FROM public.enrollments en
    JOIN public.class_groups cg ON cg.id = en.class_group_id
    WHERE en.student_id = p_student_id
      AND en.tenant_id = p_tenant_id
      AND en.status = 'active'
      AND cg.martial_art_id IS NOT NULL
    UNION
    SELECT DISTINCT sg.martial_art_id
    FROM public.student_graduations sg
    WHERE sg.student_id = p_student_id
      AND sg.tenant_id = p_tenant_id
      AND sg.martial_art_id IS NOT NULL
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
    COALESCE(ma.name, 'Geral') AS martial_art_name,
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
  LEFT JOIN public.martial_arts ma ON ma.id = v.martial_art_id
  LEFT JOIN video_belts_agg vba ON vba.video_id = v.id
  WHERE v.tenant_id = p_tenant_id
    AND v.status = 'published'
    AND (
      -- Vídeos liberados para todas as faixas
      v.all_belts = true
      -- Vídeos gerais sem modalidade restrita
      OR v.martial_art_id IS NULL
      -- Vídeos da modalidade em que o aluno atua
      OR (
        v.martial_art_id IN (SELECT martial_art_id FROM student_active_arts)
        AND (
          -- Compatível com a graduação do aluno
          EXISTS (
            SELECT 1 
            FROM public.digital_library_video_belts dvb
            WHERE dvb.video_id = v.id
              AND dvb.belt_rank_id IN (
                SELECT sb.belt_rank_id 
                FROM student_belts sb 
                WHERE sb.martial_art_id = v.martial_art_id
              )
          )
          -- Ou vídeo da modalidade sem restrição relacional de faixas
          OR NOT EXISTS (
            SELECT 1 
            FROM public.digital_library_video_belts dvb2
            WHERE dvb2.video_id = v.id
          )
        )
      )
      -- Aluno do tenant sem turmas específicas lançadas ainda: libera conteúdos gerais da academia
      OR NOT EXISTS (SELECT 1 FROM student_active_arts)
    )
  ORDER BY v.display_order ASC, v.created_at DESC;
END;
$$;

-- Permissões na RPC para usuários autenticados e service_role
GRANT EXECUTE ON FUNCTION public.get_student_accessible_videos(uuid, uuid) TO authenticated, service_role;

-- 2. ATUALIZAÇÃO DA POLÍTICA RLS PARA public.digital_library_videos
DROP POLICY IF EXISTS "digital_library_videos_select" ON public.digital_library_videos;

CREATE POLICY "digital_library_videos_select" ON public.digital_library_videos
FOR SELECT TO authenticated
USING (
  -- Membros da equipe administrativa / instrutores podem ler tudo
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor')
  OR (
    -- Alunos e responsáveis matriculados no tenant podem consultar vídeos publicados
    status = 'published'
    AND (
      public.is_tenant_member(tenant_id)
      OR EXISTS (
        SELECT 1 FROM public.tenant_memberships tm
        WHERE tm.tenant_id = public.digital_library_videos.tenant_id
          AND tm.user_id = auth.uid()
          AND tm.status = 'active'
      )
    )
  )
);

-- 3. ATUALIZAÇÃO DA POLÍTICA RLS PARA public.digital_library_video_belts
DROP POLICY IF EXISTS "digital_library_video_belts_select" ON public.digital_library_video_belts;

CREATE POLICY "digital_library_video_belts_select" ON public.digital_library_video_belts
FOR SELECT TO authenticated
USING (
  public.is_tenant_member(tenant_id)
  OR public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor')
  OR EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.tenant_id = public.digital_library_video_belts.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.status = 'active'
  )
);

-- 4. GARANTIR GRANTS NAS DEMAIS RPCS DO MÓDULO DE BIBLIOTECA
GRANT EXECUTE ON FUNCTION public.save_digital_library_video(uuid, uuid, uuid, text, text, text, text, text, text, text, integer, text, boolean, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_digital_library_video(uuid, uuid) TO authenticated, service_role;

-- 5. NOTIFICAR O POSTGREST PARA RECARREGAR O SCHEMA IMEDIATAMENTE
NOTIFY pgrst, 'reload schema';
