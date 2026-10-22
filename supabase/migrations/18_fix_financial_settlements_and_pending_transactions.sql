-- ============================================================================
-- Migration 18: Correção de Baixas Financeiras e Quitação de Lançamentos Pendentes
-- TatameHub: Módulo Mensalidades e Finanças
-- ============================================================================

-- 1. ADICIONAR COLUNAS DE CONTROLE DE SALDO E RECIBO EM FINANCIAL_TRANSACTIONS
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS paid_amount numeric(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS balance numeric(10,2),
  ADD COLUMN IF NOT EXISTS receipt_number text;

-- 2. ATUALIZAR RESTRIÇÃO DE STATUS PARA ACEITAR BAIXA PARCIAL ('partially_paid')
DO $$
BEGIN
  -- Remover constraint antiga se existir
  ALTER TABLE public.financial_transactions
    DROP CONSTRAINT IF EXISTS financial_transactions_status_check;

  -- Aplicar nova constraint com suporte a partially_paid
  ALTER TABLE public.financial_transactions
    ADD CONSTRAINT financial_transactions_status_check
    CHECK (status IN ('pending', 'partially_paid', 'completed', 'canceled'));
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- 3. AJUSTE DE VALORES PRÉ-EXISTENTES
UPDATE public.financial_transactions
SET
  paid_amount = CASE WHEN status = 'completed' THEN amount ELSE COALESCE(paid_amount, 0.00) END,
  balance = CASE WHEN status = 'completed' THEN 0.00 ELSE (amount - COALESCE(paid_amount, 0.00)) END
WHERE balance IS NULL;

-- 4. ATUALIZAR E EXPANDIR POLÍTICAS RLS PARA BAIXAS EM INVOICES E INVOICE_PAYMENTS
-- Garantir que proprietários, gestores de filial, secretários e financeiro possam registrar baixas
DROP POLICY IF EXISTS "invoices_write_financial" ON public.invoices;
CREATE POLICY "invoices_write_financial" ON public.invoices
  FOR ALL TO authenticated
  USING (
    has_tenant_role(
      tenant_id,
      VARIADIC ARRAY['owner', 'branch_manager', 'secretary', 'financial']::app_role[]
    )
  )
  WITH CHECK (
    has_tenant_role(
      tenant_id,
      VARIADIC ARRAY['owner', 'branch_manager', 'secretary', 'financial']::app_role[]
    )
  );

DROP POLICY IF EXISTS "payments_write_financial" ON public.invoice_payments;
CREATE POLICY "payments_write_financial" ON public.invoice_payments
  FOR ALL TO authenticated
  USING (
    has_tenant_role(
      tenant_id,
      VARIADIC ARRAY['owner', 'branch_manager', 'secretary', 'financial']::app_role[]
    )
  )
  WITH CHECK (
    has_tenant_role(
      tenant_id,
      VARIADIC ARRAY['owner', 'branch_manager', 'secretary', 'financial']::app_role[]
    )
  );
