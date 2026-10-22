-- ============================================================================
-- ARQUIVO: 16_tatamis_table_and_crud.sql
-- OBJETIVO: Tabela dedicada para gestão de Tatamis e Espaços (CRUD completo),
--           vínculo com tenant_id e branch_id, controle de capacidade,
--           desativação lógica para preservação de histórico e políticas RLS.
-- PROJETO: TatameHub (Gestão de Academias de Artes Marciais)
-- ============================================================================

-- 1. TABELA DE TATAMIS E ESPAÇOS: public.tatamis
CREATE TABLE IF NOT EXISTS public.tatamis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  dimensions text, -- ex: "12x12m (144m²)"
  max_capacity int NOT NULL DEFAULT 20 CHECK (max_capacity > 0),
  color_hex text DEFAULT '#dc2626',
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tatamis_tenant_branch_name UNIQUE (tenant_id, branch_id, name)
);

-- 2. HABILITAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.tatamis ENABLE ROW LEVEL SECURITY;

-- 3. ÍNDICES DE PERFORMANCE E ISOLAMENTO
CREATE INDEX IF NOT EXISTS idx_tatamis_tenant ON public.tatamis(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tatamis_branch ON public.tatamis(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_tatamis_active ON public.tatamis(tenant_id, active);

-- 4. POLÍTICAS RLS PARA public.tatamis
-- 4.1 Leitura: qualquer membro ativo autenticado da academia
DROP POLICY IF EXISTS "tatamis_select" ON public.tatamis;
CREATE POLICY "tatamis_select" ON public.tatamis
FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id));

-- 4.2 Escrita (INSERT, UPDATE, DELETE): equipe autorizada (proprietário, gestor, secretário, instrutor)
DROP POLICY IF EXISTS "tatamis_write_staff" ON public.tatamis;
CREATE POLICY "tatamis_write_staff" ON public.tatamis
FOR ALL TO authenticated
USING (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'))
WITH CHECK (public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'secretary', 'instructor'));

-- 5. SEED INICIAL CONDICIONAL: SE NÃO HOUVER TATAMIS, POPULAR A PARTIR DAS TURMAS EXISTENTES
INSERT INTO public.tatamis (tenant_id, branch_id, name, max_capacity, color_hex, active)
SELECT DISTINCT 
  c.tenant_id, 
  c.branch_id, 
  c.tatami_room, 
  COALESCE(c.max_capacity, 20),
  '#dc2626',
  true
FROM public.class_groups c
WHERE c.tatami_room IS NOT NULL AND c.tatami_room <> ''
ON CONFLICT (tenant_id, branch_id, name) DO NOTHING;

-- 6. COMENTÁRIOS EXPLICATIVOS
COMMENT ON TABLE public.tatamis IS 'Espaços físicos e tatamis disponíveis para treinamentos e eventos.';
COMMENT ON COLUMN public.tatamis.active IS 'Indica se o tatami está ativo. Se falso, o histórico de turmas e ocupações permanece preservado.';
