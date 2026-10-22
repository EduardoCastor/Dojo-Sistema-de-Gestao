-- ============================================================================
-- Migration 17: Financial Management - Plans, Invoices, Transactions & Reminders
-- TatameHub: Módulo Mensalidades e Finanças
-- ============================================================================

-- 1. TABELA DE PLANOS DE MENSALIDADE (MEMBERSHIP PLANS)
CREATE TABLE IF NOT EXISTS public.membership_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  due_day INTEGER NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 31),
  discount_percentage NUMERIC(5,2) DEFAULT 0.00,
  discount_description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_plans_tenant_branch 
  ON public.membership_plans (tenant_id, branch_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_tenant_branch_name 
  ON public.membership_plans (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(trim(name)));

-- 2. AJUSTES NA TABELA PUBLIC.INVOICES
ALTER TABLE public.invoices 
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES public.membership_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS class_group_id UUID REFERENCES public.class_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status 
  ON public.invoices (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_invoices_student_comp 
  ON public.invoices (tenant_id, student_id, competence);

CREATE INDEX IF NOT EXISTS idx_invoices_class 
  ON public.invoices (tenant_id, class_group_id);

-- 3. TABELA DE TRANSAÇÕES FINANCEIRAS EXTRAS (RECEITAS E DESPESAS)
CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category TEXT NOT NULL CHECK (category IN (
    'competition', 'merchandise', 'exam', 'event', 'administrative', 'facilities', 'payroll', 'other'
  )),
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  competence TEXT NOT NULL, -- Ex: '10/2026'
  due_date DATE,
  payment_date DATE,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'canceled')),
  student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  guardian_person_id UUID REFERENCES public.persons(id) ON DELETE SET NULL,
  class_group_id UUID REFERENCES public.class_groups(id) ON DELETE SET NULL,
  quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(10,2),
  payment_method payment_method DEFAULT 'pix',
  notes TEXT,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL DEFAULT 'Administrador',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_comp 
  ON public.financial_transactions (tenant_id, competence);

CREATE INDEX IF NOT EXISTS idx_transactions_type_cat 
  ON public.financial_transactions (tenant_id, type, category);

-- 4. TABELA DE HISTÓRICO DE LEMBRETES E COBRANÇAS POR E-MAIL
CREATE TABLE IF NOT EXISTS public.payment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('student', 'financial_guardian')),
  subject TEXT NOT NULL,
  body_snippet TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'preview')),
  provider_response TEXT,
  sent_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_reminders_tenant_invoice 
  ON public.payment_reminders (tenant_id, invoice_id);

-- 5. HABILITAÇÃO DO ROW LEVEL SECURITY (RLS)
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reminders ENABLE ROW LEVEL SECURITY;

-- Planos: Leitura por qualquer membro autenticado do tenant
DROP POLICY IF EXISTS plans_select ON public.membership_plans;
CREATE POLICY plans_select ON public.membership_plans
  FOR SELECT TO authenticated
  USING (
    has_tenant_role(
      tenant_id,
      VARIADIC ARRAY['owner', 'branch_manager', 'secretary', 'financial', 'instructor', 'student', 'guardian']::app_role[]
    )
  );

-- Planos: Escrita por Gestores e Financeiro
DROP POLICY IF EXISTS plans_write_financial ON public.membership_plans;
CREATE POLICY plans_write_financial ON public.membership_plans
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

-- Transações Extras: Leitura por equipe e pelo próprio aluno/responsável vinculado
DROP POLICY IF EXISTS transactions_select ON public.financial_transactions;
CREATE POLICY transactions_select ON public.financial_transactions
  FOR SELECT TO authenticated
  USING (
    has_tenant_role(
      tenant_id,
      VARIADIC ARRAY['owner', 'branch_manager', 'secretary', 'financial']::app_role[]
    )
    OR (student_id IS NOT NULL AND (is_own_student(student_id) OR is_guardian_of_student(student_id)))
  );

-- Transações Extras: Escrita por Gestores e Financeiro
DROP POLICY IF EXISTS transactions_write_financial ON public.financial_transactions;
CREATE POLICY transactions_write_financial ON public.financial_transactions
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

-- Lembretes de cobrança: Leitura e envio restrito à equipe financeira e gestores
DROP POLICY IF EXISTS reminders_select ON public.payment_reminders;
CREATE POLICY reminders_select ON public.payment_reminders
  FOR SELECT TO authenticated
  USING (
    has_tenant_role(
      tenant_id,
      VARIADIC ARRAY['owner', 'branch_manager', 'secretary', 'financial']::app_role[]
    )
  );

DROP POLICY IF EXISTS reminders_write_financial ON public.payment_reminders;
CREATE POLICY reminders_write_financial ON public.payment_reminders
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

-- 6. TRIGGERS DE MODTIME
DROP TRIGGER IF EXISTS update_membership_plans_modtime ON public.membership_plans;
CREATE TRIGGER update_membership_plans_modtime
  BEFORE UPDATE ON public.membership_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_financial_transactions_modtime ON public.financial_transactions;
CREATE TRIGGER update_financial_transactions_modtime
  BEFORE UPDATE ON public.financial_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
