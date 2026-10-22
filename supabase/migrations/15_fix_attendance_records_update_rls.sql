-- ============================================================================
-- ARQUIVO: 15_fix_attendance_records_update_rls.sql
-- OBJETIVO: Correção mínima e reversível de RLS na tabela public.attendance_records.
--           Cria a política FOR UPDATE para permitir upsert e edição de chamadas
--           pela equipe autorizada, mantendo isolamento estrito por tenant_id.
-- PROJETO: TatameHub (Gestão de Academias de Artes Marciais)
-- ============================================================================

-- 1. POLÍTICA CONTROLADA: PERMITIR ATUALIZAÇÃO DE FREQUÊNCIA PELA EQUIPE DA ACADEMIA
--    - USING: garante que o usuário só pode atualizar registros do seu tenant ativo.
--    - WITH CHECK: garante que o registro atualizado não seja movido para outro tenant
--      e que o usuário permaneça com papel autorizado no tenant resultante.

DROP POLICY IF EXISTS "attendance_update_staff" ON public.attendance_records;

CREATE POLICY "attendance_update_staff" ON public.attendance_records
FOR UPDATE TO authenticated
USING (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'instructor', 'secretary')
)
WITH CHECK (
  public.has_tenant_role(tenant_id, 'owner', 'branch_manager', 'instructor', 'secretary')
);

-- 2. COMENTÁRIO DESCRITIVO NO BANCO DE DADOS
COMMENT ON POLICY "attendance_update_staff" ON public.attendance_records IS 
'Permite que proprietários, gestores, instrutores e secretários atualizem presenças apenas na sua academia.';

-- ============================================================================
-- SCRIPT DE REVERSÃO (ROLLBACK) SE NECESSÁRIO:
-- DROP POLICY IF EXISTS "attendance_update_staff" ON public.attendance_records;
-- ============================================================================
