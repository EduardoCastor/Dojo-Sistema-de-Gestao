-- ============================================================================
-- Migration 20: Antropometria e IMC — Gestão de Medições e Histórico Biométrico
-- TatameHub: Módulo Alunos & Antropometria
-- ============================================================================

-- 1. ADICIONAR COLUNAS COMPLEMENTARES NA TABELA PUBLIC.PHYSICAL_ASSESSMENTS
ALTER TABLE public.physical_assessments
  ADD COLUMN IF NOT EXISTS age_years integer,
  ADD COLUMN IF NOT EXISTS age_months integer,
  ADD COLUMN IF NOT EXISTS classification text,
  ADD COLUMN IF NOT EXISTS reference_standard text,
  ADD COLUMN IF NOT EXISTS recorded_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2. ÍNDICES DE PERFORMANCE E ISOLAMENTO MULTI-TENANT
CREATE INDEX IF NOT EXISTS idx_physical_assessments_tenant_student_date 
  ON public.physical_assessments (tenant_id, student_id, date DESC);

-- 3. HABILITAR E CONFIGURAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.physical_assessments ENABLE ROW LEVEL SECURITY;

-- 3.1 POLÍTICA DE LEITURA (SELECT)
-- Usuários autorizados da academia (owners, gerentes, secretários, instrutores, financeiro)
-- ou o próprio aluno autenticado.
DROP POLICY IF EXISTS "physical_assessments_select" ON public.physical_assessments;
CREATE POLICY "physical_assessments_select" ON public.physical_assessments
FOR SELECT TO authenticated
USING (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor', 'financial')
  OR (
    -- Aluno visualizando seu próprio histórico biométrico
    EXISTS (
      SELECT 1 FROM public.students s
      JOIN public.profiles pr ON pr.id = auth.uid()
      WHERE s.id = physical_assessments.student_id
        AND s.tenant_id = physical_assessments.tenant_id
        AND pr.email = (
          SELECT email FROM public.persons p WHERE p.id = s.person_id
        )
    )
  )
);

-- 3.2 POLÍTICA DE INSERÇÃO (INSERT)
-- Apenas staff autorizado (owner, branch_manager, secretary, instructor)
DROP POLICY IF EXISTS "physical_assessments_insert" ON public.physical_assessments;
CREATE POLICY "physical_assessments_insert" ON public.physical_assessments
FOR INSERT TO authenticated
WITH CHECK (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor')
);

-- 3.3 POLÍTICA DE ATUALIZAÇÃO (UPDATE)
-- Apenas staff autorizado
DROP POLICY IF EXISTS "physical_assessments_update" ON public.physical_assessments;
CREATE POLICY "physical_assessments_update" ON public.physical_assessments
FOR UPDATE TO authenticated
USING (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor')
)
WITH CHECK (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor')
);

-- 3.4 POLÍTICA DE EXCLUSÃO (DELETE)
-- Apenas proprietários e gerentes de filial
DROP POLICY IF EXISTS "physical_assessments_delete" ON public.physical_assessments;
CREATE POLICY "physical_assessments_delete" ON public.physical_assessments
FOR DELETE TO authenticated
USING (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager')
);
