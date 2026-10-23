-- ============================================================================
-- Migration 19: Vinculação de Planos Financeiros aos Alunos e Atualização
--              Atômica de Mensalidades Futuras
-- TatameHub: Módulo Alunos & Módulo Mensalidades e Finanças
-- ============================================================================

-- 1. ADICIONAR COLUNA PLAN_ID NA TABELA PUBLIC.STUDENTS
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.membership_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_tenant_plan 
  ON public.students (tenant_id, plan_id);

-- 2. FUNÇÃO AUXILIAR PARA COMPARAÇÃO CRONOLÓGICA DE COMPETÊNCIAS ('MM/YYYY')
CREATE OR REPLACE FUNCTION public.competence_to_int(p_comp text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 
    CASE 
      WHEN p_comp ~ '^[0-1]?[0-9]/[0-9]{4}$' THEN
        (split_part(p_comp, '/', 2)::integer * 12) + split_part(p_comp, '/', 1)::integer
      ELSE 0
    END;
$$;

-- 3. FUNÇÃO RPC ATÔMICA: VINCULAÇÃO/ALTERAÇÃO DE PLANO DO ALUNO E AJUSTE DE MENSALIDADES FUTURAS
-- Garante atomicidade: se o ajuste das faturas falhar, o vínculo do aluno não permanece inconsistente.
-- Regras de Negócio Estritas:
--  - Mensalidades pagas ('paid' ou paid_amount > 0): NUNCA são alteradas.
--  - Mensalidades parcialmente pagas ('partially_paid'): NUNCA são alteradas.
--  - Mensalidades vencidas ('overdue' ou due_date < CURRENT_DATE): NUNCA são alteradas.
--  - Cobranças extras (taxas, exames, materiais esportivos): NUNCA são alteradas.
--  - Somente faturas futuras estritamente em aberto (status = 'pending' E balance = final_amount
--    E paid_amount = 0 E due_date >= CURRENT_DATE E competence >= p_effective_competence) são atualizadas.
CREATE OR REPLACE FUNCTION public.update_student_plan_and_invoices(
  p_tenant_id uuid,
  p_student_id uuid,
  p_new_plan_id uuid,
  p_new_monthly_fee numeric,
  p_effective_competence text,
  p_user_name text DEFAULT 'Administrador'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_student_exists boolean;
  v_old_plan_id uuid;
  v_old_fee numeric;
  v_plan_name text := NULL;
  v_plan_amount numeric := NULL;
  v_plan_due_day integer := NULL;
  v_plan_discount_pct numeric := 0;
  v_plan_discount_desc text := NULL;
  v_final_amount numeric := 0;
  v_discount_val numeric := 0;
  v_effective_comp_int integer;
  v_updated_invoices_count integer := 0;
  v_audit_action text;
BEGIN
  -- 1. Validar autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: o usuário precisa estar autenticado.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validar permissões de staff
  IF NOT public.has_tenant_role(p_tenant_id, 'owner', 'branch_manager', 'secretary', 'financial') THEN
    RAISE EXCEPTION 'Permissão insuficiente para alterar planos e mensalidades de alunos nesta academia.'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Verificar existência do aluno na academia ativa
  SELECT plan_id, monthly_fee
  INTO v_old_plan_id, v_old_fee
  FROM public.students
  WHERE id = p_student_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aluno não localizado nesta academia.'
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Carregar detalhes do novo plano (se informado)
  IF p_new_plan_id IS NOT NULL THEN
    SELECT name, amount, due_day, COALESCE(discount_percentage, 0), discount_description
    INTO v_plan_name, v_plan_amount, v_plan_due_day, v_plan_discount_pct, v_plan_discount_desc
    FROM public.membership_plans
    WHERE id = p_new_plan_id AND tenant_id = p_tenant_id AND active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'O plano de mensalidade selecionado não existe ou não está ativo nesta academia.'
        USING ERRCODE = '22023';
    END IF;

    -- Calcular desconto se previsto no plano
    IF v_plan_discount_pct > 0 THEN
      v_discount_val := round((v_plan_amount * (v_plan_discount_pct / 100.0)), 2);
    ELSE
      v_discount_val := 0;
    END IF;

    v_final_amount := round(v_plan_amount - v_discount_val, 2);
  ELSE
    -- Aluno sem plano vinculado (valor personalizado)
    v_final_amount := COALESCE(p_new_monthly_fee, v_old_fee, 0.00);
    v_plan_amount := v_final_amount;
    v_discount_val := 0;
    v_plan_discount_desc := NULL;
    v_plan_name := 'Personalizado / Sem plano';
  END IF;

  -- 5. Atualizar cadastro do aluno
  UPDATE public.students
  SET
    plan_id = p_new_plan_id,
    monthly_fee = v_final_amount,
    updated_at = now()
  WHERE id = p_student_id AND tenant_id = p_tenant_id;

  -- 6. Atualizar faturas futuras que estejam integralmente em aberto
  v_effective_comp_int := public.competence_to_int(p_effective_competence);

  WITH updated_rows AS (
    UPDATE public.invoices
    SET
      plan_id = p_new_plan_id,
      original_amount = v_plan_amount,
      discount_amount = v_discount_val,
      discount_description = v_plan_discount_desc,
      final_amount = v_final_amount,
      balance = v_final_amount,
      due_date = CASE 
        WHEN v_plan_due_day IS NOT NULL 
             AND competence ~ '^[0-1]?[0-9]/[0-9]{4}$' 
             AND make_date(
                   split_part(competence, '/', 2)::integer, 
                   split_part(competence, '/', 1)::integer, 
                   LEAST(28, GREATEST(1, v_plan_due_day))
                 ) >= CURRENT_DATE THEN
          make_date(
            split_part(competence, '/', 2)::integer, 
            split_part(competence, '/', 1)::integer, 
            LEAST(28, GREATEST(1, v_plan_due_day))
          )
        ELSE due_date
      END,
      updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND student_id = p_student_id
      AND status = 'pending'
      AND paid_amount = 0
      AND balance = final_amount
      AND due_date >= CURRENT_DATE
      AND (v_effective_comp_int = 0 OR public.competence_to_int(competence) >= v_effective_comp_int)
    RETURNING id
  )
  SELECT count(*) INTO v_updated_invoices_count FROM updated_rows;

  -- 7. Registrar log de auditoria
  v_audit_action := format(
    'Plano do aluno alterado para "%s". Valor mensal: R$ %s. Mensalidades futuras atualizadas: %s (a partir de %s).',
    v_plan_name,
    trim(to_char(v_final_amount, '999990.00')),
    v_updated_invoices_count,
    COALESCE(p_effective_competence, 'próximas')
  );

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
    p_user_name,
    'Troca de Plano de Aluno',
    'Student',
    p_student_id,
    v_audit_action
  );

  RETURN jsonb_build_object(
    'success', true,
    'student_id', p_student_id,
    'new_plan_id', p_new_plan_id,
    'new_plan_name', v_plan_name,
    'monthly_fee', v_final_amount,
    'effective_competence', p_effective_competence,
    'updated_invoices_count', v_updated_invoices_count,
    'message', v_audit_action
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.competence_to_int(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_student_plan_and_invoices(uuid, uuid, uuid, numeric, text, text) TO authenticated;
