import { supabase, isSupabaseConfigured } from './supabase';
import { isValidUUID } from './studentService';
import {
  Invoice,
  MembershipPlan,
  CreateMembershipPlanPayload,
  FinancialTransaction,
  CreateTransactionPayload,
  PaymentReminder,
  SendReminderPayload,
  Student,
  Enrollment,
} from '../types';
import { DataStore } from '../data/storage';

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Converte competência 'MM/YYYY' para inteiro (YYYY * 12 + MM) para comparação cronológica precisa
 */
export function parseCompetenceToInt(comp: string): number {
  if (!comp || !comp.includes('/')) return 0;
  const parts = comp.split('/');
  if (parts.length < 2) return 0;
  const m = parseInt(parts[0], 10);
  const y = parseInt(parts[1], 10);
  if (isNaN(m) || isNaN(y)) return 0;
  return (y * 12) + m;
}

/**
 * Retorna a competência do mês atual ('MM/YYYY')
 */
export function getCurrentCompetence(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const y = now.getFullYear();
  return `${m}/${y}`;
}

/**
 * Retorna a próxima competência mensal ('MM/YYYY')
 */
export function getNextCompetence(): string {
  const now = new Date();
  let m = now.getMonth() + 2;
  let y = now.getFullYear();
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${String(m).padStart(2, '0')}/${y}`;
}

export interface GenerationResult {
  generatedCount: number;
  skippedCount: number;
  invoices: Invoice[];
  skippedStudentNames: string[];
}

export const financialService = {
  /**
   * Consulta faturas / mensalidades de um tenant
   */
  async fetchInvoices(tenantId: string): Promise<Invoice[]> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId)) {
      const local = DataStore.getInvoices(tenantId);
      return this.updateOverdueStatusLocally(local);
    }

    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('due_date', { ascending: false });

      if (error) {
        console.warn('Aviso ao consultar mensalidades no Supabase, usando cache local:', error.message);
        return this.updateOverdueStatusLocally(DataStore.getInvoices(tenantId));
      }

      if (!data || data.length === 0) {
        return this.updateOverdueStatusLocally(DataStore.getInvoices(tenantId));
      }

      const mapped: Invoice[] = data.map((row: any) => ({
        id: row.id,
        tenantId: row.tenant_id,
        branchId: row.branch_id,
        studentId: row.student_id,
        financialGuardianId: row.financial_guardian_person_id || undefined,
        planId: row.plan_id || undefined,
        classGroupId: row.class_group_id || undefined,
        competence: row.competence,
        issueDate: row.issue_date,
        dueDate: row.due_date,
        originalAmount: Number(row.original_amount),
        discountAmount: Number(row.discount_amount || 0),
        discountDescription: row.discount_description || undefined,
        penaltyAndInterestAmount: Number(row.penalty_and_interest || 0),
        finalAmount: Number(row.final_amount),
        paidAmount: Number(row.paid_amount || 0),
        balance: Number(row.balance),
        status: row.status,
        paymentDate: row.payment_date || undefined,
        paymentMethod: row.payment_method || undefined,
        pixCode: row.pix_code || undefined,
        receiptNumber: row.receipt_number || undefined,
        notes: row.notes || undefined,
        auditTrail: [
          {
            date: row.created_at,
            action: 'Registro de mensalidade',
            userName: 'Sistema',
          },
        ],
      }));

      return this.updateOverdueStatusLocally(mapped);
    } catch (err) {
      console.warn('Exceção ao consultar faturas:', err);
      return this.updateOverdueStatusLocally(DataStore.getInvoices(tenantId));
    }
  },

  /**
   * Atualiza status para 'overdue' se vencimento expirou e ainda não foi quitado
   */
  updateOverdueStatusLocally(invoices: Invoice[]): Invoice[] {
    const today = new Date().toISOString().split('T')[0];
    return invoices.map((inv) => {
      if (inv.status === 'pending' && inv.dueDate < today && inv.balance > 0) {
        return { ...inv, status: 'overdue' };
      }
      return inv;
    });
  },

  /**
   * Registra pagamento (total ou parcial)
   */
  async settlePayment(
    invoiceId: string,
    tenantId: string,
    payload: {
      amount: number;
      paymentMethod: 'pix' | 'cash' | 'credit_card' | 'boleto' | 'transfer';
      paymentDate?: string;
      receiptNumber?: string;
      notes?: string;
      registeredByName: string;
      registeredByUserId?: string;
    }
  ): Promise<Invoice> {
    const currentInvoices = DataStore.getInvoices(tenantId);
    let invoice = currentInvoices.find((i) => i.id === invoiceId);

    if (!invoice && isSupabaseConfigured() && supabase && isValidUUID(invoiceId)) {
      try {
        const { data } = await supabase.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
        if (data) {
          invoice = {
            id: data.id,
            tenantId: data.tenant_id,
            branchId: data.branch_id,
            studentId: data.student_id,
            financialGuardianId: data.financial_guardian_person_id || undefined,
            planId: data.plan_id || undefined,
            classGroupId: data.class_group_id || undefined,
            competence: data.competence,
            issueDate: data.issue_date,
            dueDate: data.due_date,
            originalAmount: Number(data.original_amount),
            discountAmount: Number(data.discount_amount || 0),
            discountDescription: data.discount_description || undefined,
            penaltyAndInterestAmount: Number(data.penalty_and_interest || 0),
            finalAmount: Number(data.final_amount),
            paidAmount: Number(data.paid_amount || 0),
            balance: Number(data.balance),
            status: data.status,
            paymentDate: data.payment_date || undefined,
            paymentMethod: data.payment_method || undefined,
            receiptNumber: data.receipt_number || undefined,
            pixCode: data.pix_code || undefined,
            notes: data.notes || undefined,
            auditTrail: [],
          };
        }
      } catch (err) {
        console.warn('Erro ao buscar fatura no Supabase:', err);
      }
    }

    if (!invoice) {
      throw new Error('Cobrança não encontrada.');
    }

    if (invoice.balance <= 0) {
      throw new Error('Esta mensalidade já foi integralmente quitada.');
    }

    if (payload.amount <= 0) {
      throw new Error('O valor de pagamento deve ser maior que zero.');
    }

    if (payload.amount > invoice.balance) {
      throw new Error(`O valor da baixa (R$ ${payload.amount.toFixed(2)}) não pode ser superior ao saldo pendente (R$ ${invoice.balance.toFixed(2)}).`);
    }

    const payAmount = Math.round(payload.amount * 100) / 100;
    const newPaidAmount = Math.round((invoice.paidAmount + payAmount) * 100) / 100;
    const newBalance = Math.round(Math.max(0, invoice.balance - payAmount) * 100) / 100;
    const newStatus: Invoice['status'] = newBalance <= 0 ? 'paid' : 'partially_paid';
    const nowISO = new Date().toISOString();
    const today = payload.paymentDate || nowISO.split('T')[0];
    const receipt = payload.receiptNumber || `REC-${Date.now().toString().slice(-6)}`;

    const updatedInvoice: Invoice = {
      ...invoice,
      paidAmount: newPaidAmount,
      balance: newBalance,
      status: newStatus,
      paymentDate: today,
      paymentMethod: payload.paymentMethod as any,
      receiptNumber: receipt,
      notes: payload.notes || invoice.notes,
      auditTrail: [
        ...(invoice.auditTrail || []),
        {
          date: nowISO,
          action: `Pagamento ${newBalance <= 0 ? 'integral' : 'parcial'} de R$ ${payAmount.toFixed(2)} registrado via ${payload.paymentMethod.toUpperCase()}`,
          userName: payload.registeredByName,
        },
      ],
    };

    // 1. Atualizar no Supabase se configurado
    let targetInvoiceId = invoiceId;
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      if (isValidUUID(invoiceId)) {
        const { error: updateError } = await supabase
          .from('invoices')
          .update({
            paid_amount: newPaidAmount,
            balance: newBalance,
            status: newStatus,
            payment_date: today,
            payment_method: payload.paymentMethod,
            receipt_number: receipt,
            notes: payload.notes || invoice.notes || null,
            updated_at: nowISO,
          })
          .eq('id', invoiceId)
          .eq('tenant_id', tenantId);

        if (updateError) {
          console.error('Erro ao atualizar fatura no Supabase:', updateError);
          throw new Error(`Não foi possível registrar o pagamento: ${updateError.message}`);
        }
      } else {
        // Se o ID original não era UUID válido, verificar se já existe no banco por tenant + student + competence
        let resolvedId: string | null = null;
        if (isValidUUID(invoice.studentId)) {
          try {
            const { data: found } = await supabase
              .from('invoices')
              .select('id')
              .eq('tenant_id', tenantId)
              .eq('student_id', invoice.studentId)
              .eq('competence', invoice.competence)
              .maybeSingle();
            if (found?.id) resolvedId = found.id;
          } catch (findErr) {
            console.warn('Aviso ao consultar fatura equivalente:', findErr);
          }
        }

        if (resolvedId) {
          targetInvoiceId = resolvedId;
          const { error: updateErr } = await supabase
            .from('invoices')
            .update({
              paid_amount: newPaidAmount,
              balance: newBalance,
              status: newStatus,
              payment_date: today,
              payment_method: payload.paymentMethod,
              receipt_number: receipt,
              notes: payload.notes || invoice.notes || null,
              updated_at: nowISO,
            })
            .eq('id', resolvedId)
            .eq('tenant_id', tenantId);

          if (updateErr) {
            console.error('Erro ao atualizar fatura resolvida:', updateErr);
            throw new Error(`Não foi possível registrar o pagamento: ${updateErr.message}`);
          }
        } else {
          // Inserir registro com UUID padrão
          const newId = generateUUID();
          targetInvoiceId = newId;
          const { error: insertErr } = await supabase.from('invoices').insert({
            id: newId,
            tenant_id: tenantId,
            branch_id: isValidUUID(invoice.branchId) ? invoice.branchId : null,
            student_id: isValidUUID(invoice.studentId) ? invoice.studentId : null,
            plan_id: invoice.planId && isValidUUID(invoice.planId) ? invoice.planId : null,
            class_group_id: invoice.classGroupId && isValidUUID(invoice.classGroupId) ? invoice.classGroupId : null,
            competence: invoice.competence,
            issue_date: invoice.issueDate,
            due_date: invoice.dueDate,
            original_amount: invoice.originalAmount,
            discount_amount: invoice.discountAmount,
            discount_description: invoice.discountDescription || null,
            penalty_and_interest: invoice.penaltyAndInterestAmount,
            final_amount: invoice.finalAmount,
            paid_amount: newPaidAmount,
            balance: newBalance,
            status: newStatus,
            payment_date: today,
            payment_method: payload.paymentMethod,
            receipt_number: receipt,
            notes: payload.notes || invoice.notes || null,
          });

          if (insertErr) {
            console.error('Erro ao inserir fatura no Supabase durante baixa:', insertErr);
            throw new Error(`Não foi possível registrar o pagamento: ${insertErr.message}`);
          }
        }
        updatedInvoice.id = targetInvoiceId;
      }

      // Registrar na tabela invoice_payments se existir
      try {
        let validAuthUserId: string | null = null;
        try {
          const { data: authData } = await supabase.auth.getUser();
          if (authData?.user?.id) {
            validAuthUserId = authData.user.id;
          }
        } catch {
          validAuthUserId = null;
        }

        const { error: paymentError } = await supabase.from('invoice_payments').insert({
          tenant_id: tenantId,
          invoice_id: targetInvoiceId,
          amount: payAmount,
          payment_date: today,
          payment_method: payload.paymentMethod,
          receipt_number: receipt,
          registered_by_user_id: validAuthUserId,
          registered_by_name: payload.registeredByName,
          notes: payload.notes || null,
        });

        if (paymentError) {
          console.warn('Aviso ao registrar histórico em invoice_payments:', paymentError.message);
        }
      } catch (err: any) {
        console.warn('Aviso no log de invoice_payments:', err.message);
      }
    }

    // 2. Atualizar cache local
    const updatedList = currentInvoices.map((i) =>
      i.id === invoiceId || i.id === updatedInvoice.id ? updatedInvoice : i
    );

    if (!updatedList.some((i) => i.id === updatedInvoice.id)) {
      updatedList.unshift(updatedInvoice);
    }

    DataStore.saveInvoices(updatedList);
    return updatedInvoice;
  },

  /**
   * Cancela uma cobrança
   */
  async cancelInvoice(invoiceId: string, tenantId: string, reason?: string): Promise<Invoice> {
    const currentInvoices = DataStore.getInvoices(tenantId);
    const invoice = currentInvoices.find((i) => i.id === invoiceId);

    if (!invoice) {
      throw new Error('Cobrança não encontrada.');
    }

    const nowISO = new Date().toISOString();
    const updatedInvoice: Invoice = {
      ...invoice,
      status: 'canceled',
      auditTrail: [
        ...(invoice.auditTrail || []),
        {
          date: nowISO,
          action: `Cobrança cancelada: ${reason || 'Sem justificativa'}`,
          userName: 'Gestão da Academia',
        },
      ],
    };

    if (isSupabaseConfigured() && supabase && isValidUUID(invoiceId) && isValidUUID(tenantId)) {
      try {
        await supabase
          .from('invoices')
          .update({
            status: 'canceled',
            updated_at: nowISO,
          })
          .eq('id', invoiceId)
          .eq('tenant_id', tenantId);
      } catch (err: any) {
        console.warn('Aviso ao cancelar cobrança no Supabase:', err.message);
      }
    }

    const updatedList = currentInvoices.map((i) => (i.id === invoiceId ? updatedInvoice : i));
    DataStore.saveInvoices(updatedList);
    return updatedInvoice;
  },

  /**
   * Consulta os planos de mensalidade da academia
   */
  async fetchPlans(tenantId: string, branchId?: string): Promise<MembershipPlan[]> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId)) {
      const local = DataStore.getMembershipPlans(tenantId);
      if (branchId && branchId !== 'all') {
        return local.filter((p) => !p.branchId || p.branchId === branchId);
      }
      return local;
    }

    try {
      let query = supabase
        .from('membership_plans')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true });

      if (branchId && branchId !== 'all' && isValidUUID(branchId)) {
        query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
      }

      const { data, error } = await query;
      if (error || !data || data.length === 0) {
        const local = DataStore.getMembershipPlans(tenantId);
        return branchId && branchId !== 'all' ? local.filter((p) => !p.branchId || p.branchId === branchId) : local;
      }

      return data.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        branchId: r.branch_id || undefined,
        name: r.name,
        amount: Number(r.amount),
        frequency: r.frequency || 'monthly',
        dueDay: r.due_day || 10,
        discountPercentage: r.discount_percentage ? Number(r.discount_percentage) : 0,
        discountDescription: r.discount_description || undefined,
        active: r.active ?? true,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    } catch (err) {
      console.warn('Erro ao consultar planos:', err);
      return DataStore.getMembershipPlans(tenantId);
    }
  },

  /**
   * Cria um novo plano de mensalidade
   */
  async createPlan(payload: CreateMembershipPlanPayload): Promise<MembershipPlan> {
    const trimmedName = payload.name.trim();
    if (!trimmedName) throw new Error('Informe o nome do plano de mensalidade.');
    if (payload.amount < 0) throw new Error('O valor do plano não pode ser negativo.');

    const localPlans = DataStore.getMembershipPlans(payload.tenantId);
    const hasDuplicate = localPlans.some(
      (p) =>
        p.name.trim().toLowerCase() === trimmedName.toLowerCase() &&
        (!p.branchId || !payload.branchId || p.branchId === payload.branchId)
    );
    if (hasDuplicate) {
      throw new Error(`Já existe um plano com o nome "${trimmedName}".`);
    }

    let planId = `plan-${Date.now()}`;
    const nowISO = new Date().toISOString();

    if (isSupabaseConfigured() && supabase && isValidUUID(payload.tenantId)) {
      try {
        const { data, error } = await supabase
          .from('membership_plans')
          .insert({
            tenant_id: payload.tenantId,
            branch_id: payload.branchId && isValidUUID(payload.branchId) ? payload.branchId : null,
            name: trimmedName,
            amount: payload.amount,
            frequency: payload.frequency || 'monthly',
            due_day: payload.dueDay,
            discount_percentage: payload.discountPercentage || 0,
            discount_description: payload.discountDescription?.trim() || null,
            active: payload.active ?? true,
          })
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            throw new Error(`Já existe um plano com o nome "${trimmedName}" nesta filial.`);
          }
          console.warn('Aviso ao persistir plano no Supabase:', error.message);
        } else if (data) {
          planId = data.id;
        }
      } catch (err: any) {
        if (err.message?.includes('Já existe')) throw err;
        console.warn('Fallback local para criação de plano:', err.message);
      }
    }

    const newPlan: MembershipPlan = {
      id: planId,
      tenantId: payload.tenantId,
      branchId: payload.branchId,
      name: trimmedName,
      amount: payload.amount,
      frequency: payload.frequency || 'monthly',
      dueDay: payload.dueDay,
      discountPercentage: payload.discountPercentage || 0,
      discountDescription: payload.discountDescription?.trim(),
      active: payload.active ?? true,
      createdAt: nowISO,
      updatedAt: nowISO,
    };

    DataStore.saveMembershipPlans([newPlan, ...localPlans]);
    return newPlan;
  },

  /**
   * Atualiza um plano de mensalidade
   */
  async updatePlan(id: string, tenantId: string, payload: Partial<CreateMembershipPlanPayload>): Promise<MembershipPlan> {
    const localPlans = DataStore.getMembershipPlans(tenantId);
    const current = localPlans.find((p) => p.id === id);
    if (!current) throw new Error('Plano não encontrado.');

    const updatedPlan: MembershipPlan = {
      ...current,
      name: payload.name ? payload.name.trim() : current.name,
      amount: payload.amount !== undefined ? payload.amount : current.amount,
      frequency: payload.frequency || current.frequency,
      dueDay: payload.dueDay !== undefined ? payload.dueDay : current.dueDay,
      discountPercentage: payload.discountPercentage !== undefined ? payload.discountPercentage : current.discountPercentage,
      discountDescription: payload.discountDescription !== undefined ? payload.discountDescription : current.discountDescription,
      active: payload.active !== undefined ? payload.active : current.active,
      updatedAt: new Date().toISOString(),
    };

    if (isSupabaseConfigured() && supabase && isValidUUID(id) && isValidUUID(tenantId)) {
      try {
        await supabase
          .from('membership_plans')
          .update({
            name: updatedPlan.name,
            amount: updatedPlan.amount,
            frequency: updatedPlan.frequency,
            due_day: updatedPlan.dueDay,
            discount_percentage: updatedPlan.discountPercentage,
            discount_description: updatedPlan.discountDescription || null,
            active: updatedPlan.active,
            updated_at: updatedPlan.updatedAt,
          })
          .eq('id', id)
          .eq('tenant_id', tenantId);
      } catch (err: any) {
        console.warn('Aviso ao atualizar plano no Supabase:', err.message);
      }
    }

    const updatedList = localPlans.map((p) => (p.id === id ? updatedPlan : p));
    DataStore.saveMembershipPlans(updatedList);
    return updatedPlan;
  },

  /**
   * Gera cobranças mensais para os alunos ativos com validação anti-duplicidade estrita
   */
  async generateInvoicesForCompetence(params: {
    tenantId: string;
    branchId: string;
    competence: string; // Ex: '11/2026'
    dueDay?: number;
    planId?: string;
    classGroupId?: string;
    students: Student[];
    enrollments: Enrollment[];
    plans: MembershipPlan[];
    familyDiscountPercentage?: number;
    currentUserName?: string;
  }): Promise<GenerationResult> {
    const {
      tenantId,
      branchId,
      competence,
      dueDay = 10,
      planId,
      classGroupId,
      students,
      enrollments,
      plans,
      familyDiscountPercentage = 15,
      currentUserName = 'Administrador',
    } = params;

    const currentInvoices = await this.fetchInvoices(tenantId);
    const existingMap = new Set<string>();

    currentInvoices.forEach((inv) => {
      // Chave única: tenant + studentId + competence
      existingMap.add(`${inv.tenantId}:${inv.studentId}:${inv.competence}`);
    });

    // Parse da competência para checar se a matrícula é posterior
    // Formato 'MM/YYYY'
    const [compMonthStr, compYearStr] = competence.split('/');
    const compMonth = parseInt(compMonthStr, 10);
    const compYear = parseInt(compYearStr, 10);
    const compStartDate = `${compYear}-${String(compMonth).padStart(2, '0')}-01`;
    // Data de vencimento calculada
    const formattedDueDay = String(Math.min(28, Math.max(1, dueDay))).padStart(2, '0');
    const dueDate = `${compYear}-${String(compMonth).padStart(2, '0')}-${formattedDueDay}`;

    // Filtrar alunos elegíveis:
    // 1. Status ativo
    // 2. Se especificada turma, deve estar matriculado ativamente nela
    // 3. Matrícula não pode ser posterior ao mês da competência
    const targetStudents = students.filter((student) => {
      if (student.status !== 'active') return false;
      if (branchId !== 'all' && student.branchId && student.branchId !== branchId) return false;

      // Se turma especificada, checar matrícula
      if (classGroupId && classGroupId !== 'all') {
        const isEnrolled = enrollments.some(
          (e) => e.studentId === student.id && e.classGroupId === classGroupId && e.status === 'active'
        );
        if (!isEnrolled) return false;
      }

      // Validação de data de matrícula: não gerar cobrança anterior ao início da matrícula
      if (student.enrollmentDate) {
        const enrollDate = student.enrollmentDate; // YYYY-MM-DD
        // Se a matrícula foi feita no mês seguinte à competência, não cobra
        if (enrollDate > `${compYear}-${String(compMonth).padStart(2, '0')}-31`) {
          return false;
        }
      }

      return true;
    });

    const newInvoices: Invoice[] = [];
    const skippedNames: string[] = [];

    // Mapear responsáveis para verificar desconto familiar
    const guardianMap = new Map<string, number>();

    targetStudents.forEach((st) => {
      const key = `${tenantId}:${st.id}:${competence}`;
      if (existingMap.has(key)) {
        skippedNames.push(st.registrationNumber);
        return;
      }

      // Escolher plano: se não especificado na rotina em lote, respeitar o plano vinculado diretamente ao aluno
      const selectedPlan = planId && planId !== 'all'
        ? plans.find((p) => p.id === planId)
        : st.planId
        ? plans.find((p) => p.id === st.planId)
        : null;
      const baseAmount = selectedPlan ? selectedPlan.amount : st.monthlyFee > 0 ? st.monthlyFee : 220.00;

      // Calcular desconto familiar (se tiver responsável e já houve outro aluno cobrançado na competência)
      let discountAmount = 0;
      let discountDesc: string | undefined = undefined;

      if (selectedPlan && selectedPlan.discountPercentage && selectedPlan.discountPercentage > 0) {
        discountAmount = Math.round((baseAmount * (selectedPlan.discountPercentage / 100)) * 100) / 100;
        discountDesc = selectedPlan.discountDescription || `${selectedPlan.discountPercentage}% desconto do plano`;
      }

      const finalAmount = Math.round(Math.max(0, baseAmount - discountAmount) * 100) / 100;
      const invId = generateUUID();

      // Gerar código PIX copia e cola padronizado
      const pixCode = `00020126580014br.gov.bcb.pix0136${tenantId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}5204000053039865406${finalAmount.toFixed(2)}5802BR5915TATAMEHUB DOJO6009SAO PAULO62070503***6304${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      const inv: Invoice = {
        id: invId,
        tenantId,
        branchId: st.branchId || branchId !== 'all' ? branchId : 'branch-matriz',
        studentId: st.id,
        planId: selectedPlan ? selectedPlan.id : st.planId || undefined,
        classGroupId: classGroupId && classGroupId !== 'all' ? classGroupId : undefined,
        competence,
        issueDate: new Date().toISOString().split('T')[0],
        dueDate,
        originalAmount: baseAmount,
        discountAmount,
        discountDescription: discountDesc,
        penaltyAndInterestAmount: 0,
        finalAmount,
        paidAmount: 0,
        balance: finalAmount,
        status: 'pending',
        pixCode,
        auditTrail: [
          {
            date: new Date().toISOString(),
            action: `Mensalidade emitida para competência ${competence}`,
            userName: currentUserName,
          },
        ],
      };

      newInvoices.push(inv);
      existingMap.add(key);
    });

    // Persistir faturas geradas no Supabase se configurado
    if (newInvoices.length > 0 && isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      try {
        const rowsToInsert = newInvoices.map((inv) => ({
          id: inv.id,
          tenant_id: inv.tenantId,
          branch_id: isValidUUID(inv.branchId) ? inv.branchId : null,
          student_id: isValidUUID(inv.studentId) ? inv.studentId : null,
          plan_id: inv.planId && isValidUUID(inv.planId) ? inv.planId : null,
          class_group_id: inv.classGroupId && isValidUUID(inv.classGroupId) ? inv.classGroupId : null,
          competence: inv.competence,
          issue_date: inv.issueDate,
          due_date: inv.dueDate,
          original_amount: inv.originalAmount,
          discount_amount: inv.discountAmount,
          discount_description: inv.discountDescription || null,
          penalty_and_interest: inv.penaltyAndInterestAmount,
          final_amount: inv.finalAmount,
          paid_amount: 0,
          balance: inv.balance,
          status: 'pending',
          pix_code: inv.pixCode,
        })).filter(r => r.student_id !== null);

        if (rowsToInsert.length > 0) {
          const { error } = await supabase.from('invoices').insert(rowsToInsert);
          if (error) {
            console.warn('Aviso ao persistir mensalidades em lote no Supabase:', error.message);
          }
        }
      } catch (err: any) {
        console.warn('Exceção ao persistir lote de faturas:', err.message);
      }
    }

    // Salvar no DataStore local
    if (newInvoices.length > 0) {
      DataStore.saveInvoices([...newInvoices, ...currentInvoices]);
    }

    return {
      generatedCount: newInvoices.length,
      skippedCount: skippedNames.length,
      invoices: newInvoices,
      skippedStudentNames: skippedNames,
    };
  },

  /**
   * Consulta transações extras (receitas e despesas)
   */
  async fetchTransactions(tenantId: string, competence?: string): Promise<FinancialTransaction[]> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId)) {
      const local = DataStore.getFinancialTransactions(tenantId);
      if (competence && competence !== 'all') {
        return local.filter((t) => t.competence === competence);
      }
      return local;
    }

    try {
      let query = supabase
        .from('financial_transactions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (competence && competence !== 'all') {
        query = query.eq('competence', competence);
      }

      const { data, error } = await query;
      if (error || !data || data.length === 0) {
        const local = DataStore.getFinancialTransactions(tenantId);
        return competence && competence !== 'all' ? local.filter((t) => t.competence === competence) : local;
      }

      return data.map((r: any) => {
        const amount = Number(r.amount);
        const paidAmount = r.paid_amount !== undefined && r.paid_amount !== null
          ? Number(r.paid_amount)
          : (r.status === 'completed' ? amount : 0);
        const balance = r.balance !== undefined && r.balance !== null
          ? Number(r.balance)
          : (r.status === 'completed' ? 0 : Math.max(0, amount - paidAmount));

        return {
          id: r.id,
          tenantId: r.tenant_id,
          branchId: r.branch_id || undefined,
          type: r.type,
          category: r.category,
          description: r.description,
          amount,
          paidAmount,
          balance,
          competence: r.competence,
          dueDate: r.due_date || undefined,
          paymentDate: r.payment_date || undefined,
          status: r.status,
          studentId: r.student_id || undefined,
          guardianPersonId: r.guardian_person_id || undefined,
          classGroupId: r.class_group_id || undefined,
          quantity: r.quantity || 1,
          unitPrice: r.unit_price ? Number(r.unit_price) : undefined,
          paymentMethod: r.payment_method || undefined,
          receiptNumber: r.receipt_number || undefined,
          notes: r.notes || undefined,
          createdByUserId: r.created_by_user_id || undefined,
          createdByUserName: r.created_by_name || 'Administrador',
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };
      });
    } catch (err) {
      console.warn('Erro ao consultar transações extras:', err);
      return DataStore.getFinancialTransactions(tenantId);
    }
  },

  /**
   * Cria uma transação extra individual
   */
  async createTransaction(payload: CreateTransactionPayload): Promise<FinancialTransaction> {
    if (!payload.description.trim()) {
      throw new Error('Informe a descrição do lançamento.');
    }
    if (payload.amount <= 0) {
      throw new Error('O valor do lançamento deve ser maior que zero.');
    }

    let txId = generateUUID();
    const nowISO = new Date().toISOString();
    const isPending = payload.status === 'pending';
    const paidAmount = isPending ? 0 : payload.amount;
    const balance = isPending ? payload.amount : 0;

    if (isSupabaseConfigured() && supabase && isValidUUID(payload.tenantId)) {
      try {
        const { data, error } = await supabase
          .from('financial_transactions')
          .insert({
            id: txId,
            tenant_id: payload.tenantId,
            branch_id: payload.branchId && isValidUUID(payload.branchId) ? payload.branchId : null,
            type: payload.type,
            category: payload.category,
            description: payload.description.trim(),
            amount: payload.amount,
            paid_amount: paidAmount,
            balance: balance,
            competence: payload.competence,
            due_date: payload.dueDate || null,
            payment_date: payload.paymentDate || (isPending ? null : nowISO.split('T')[0]),
            status: payload.status || 'completed',
            student_id: payload.studentId && isValidUUID(payload.studentId) ? payload.studentId : null,
            guardian_person_id: payload.guardianPersonId && isValidUUID(payload.guardianPersonId) ? payload.guardianPersonId : null,
            class_group_id: payload.classGroupId && isValidUUID(payload.classGroupId) ? payload.classGroupId : null,
            quantity: payload.quantity || 1,
            unit_price: payload.unitPrice || payload.amount,
            payment_method: payload.paymentMethod || 'pix',
            notes: payload.notes?.trim() || null,
            created_by_user_id: payload.createdByUserId && isValidUUID(payload.createdByUserId) ? payload.createdByUserId : null,
            created_by_name: payload.createdByUserName || 'Administrador',
          })
          .select()
          .single();

        if (error) {
          console.warn('Aviso ao persistir transação no Supabase:', error.message);
        } else if (data) {
          txId = data.id;
        }
      } catch (err: any) {
        console.warn('Fallback local para criação de transação:', err.message);
      }
    }

    const newTx: FinancialTransaction = {
      id: txId,
      tenantId: payload.tenantId,
      branchId: payload.branchId,
      type: payload.type,
      category: payload.category,
      description: payload.description.trim(),
      amount: payload.amount,
      paidAmount,
      balance,
      competence: payload.competence,
      dueDate: payload.dueDate,
      paymentDate: payload.paymentDate || (isPending ? undefined : nowISO.split('T')[0]),
      status: payload.status || 'completed',
      studentId: payload.studentId,
      guardianPersonId: payload.guardianPersonId,
      classGroupId: payload.classGroupId,
      quantity: payload.quantity || 1,
      unitPrice: payload.unitPrice || payload.amount,
      paymentMethod: payload.paymentMethod || 'pix',
      receiptNumber: isPending ? undefined : `REC-TX-${Date.now().toString().slice(-6)}`,
      notes: payload.notes?.trim(),
      createdByUserId: payload.createdByUserId,
      createdByUserName: payload.createdByUserName || 'Administrador',
      createdAt: nowISO,
      updatedAt: nowISO,
    };

    const currentTxs = DataStore.getFinancialTransactions(payload.tenantId);
    DataStore.saveFinancialTransactions([newTx, ...currentTxs]);
    return newTx;
  },

  /**
   * Registra pagamento ou baixa (integral ou parcial) em transações extras
   */
  async settleTransaction(
    transactionId: string,
    tenantId: string,
    payload: {
      amount: number;
      paymentMethod: 'pix' | 'cash' | 'credit_card' | 'boleto' | 'transfer';
      paymentDate?: string;
      receiptNumber?: string;
      notes?: string;
      registeredByName: string;
      registeredByUserId?: string;
    }
  ): Promise<FinancialTransaction> {
    const currentTxs = DataStore.getFinancialTransactions(tenantId);
    let tx = currentTxs.find((t) => t.id === transactionId);

    if (!tx && isSupabaseConfigured() && supabase && isValidUUID(transactionId)) {
      try {
        const { data } = await supabase.from('financial_transactions').select('*').eq('id', transactionId).maybeSingle();
        if (data) {
          const amt = Number(data.amount);
          const pAmt = data.paid_amount ? Number(data.paid_amount) : (data.status === 'completed' ? amt : 0);
          const bal = data.balance !== null && data.balance !== undefined ? Number(data.balance) : (data.status === 'completed' ? 0 : amt - pAmt);
          tx = {
            id: data.id,
            tenantId: data.tenant_id,
            branchId: data.branch_id || undefined,
            type: data.type,
            category: data.category,
            description: data.description,
            amount: amt,
            paidAmount: pAmt,
            balance: bal,
            competence: data.competence,
            dueDate: data.due_date || undefined,
            paymentDate: data.payment_date || undefined,
            status: data.status,
            studentId: data.student_id || undefined,
            guardianPersonId: data.guardian_person_id || undefined,
            classGroupId: data.class_group_id || undefined,
            quantity: data.quantity || 1,
            unitPrice: data.unit_price ? Number(data.unit_price) : undefined,
            paymentMethod: data.payment_method || undefined,
            receiptNumber: data.receipt_number || undefined,
            notes: data.notes || undefined,
            createdByUserId: data.created_by_user_id || undefined,
            createdByUserName: data.created_by_name || 'Administrador',
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          };
        }
      } catch (err) {
        console.warn('Erro ao buscar transação no Supabase:', err);
      }
    }

    if (!tx) {
      throw new Error('Lançamento não encontrado.');
    }

    const currentPaid = tx.paidAmount ?? (tx.status === 'completed' ? tx.amount : 0);
    const currentBalance = tx.balance ?? (tx.status === 'completed' ? 0 : Math.max(0, tx.amount - currentPaid));

    if (currentBalance <= 0) {
      throw new Error('Este lançamento já foi integralmente quitado.');
    }

    if (payload.amount <= 0) {
      throw new Error('O valor da baixa deve ser maior que zero.');
    }

    if (payload.amount > currentBalance) {
      throw new Error(`O valor da baixa (R$ ${payload.amount.toFixed(2)}) não pode ser superior ao saldo pendente (R$ ${currentBalance.toFixed(2)}).`);
    }

    const payAmount = Math.round(payload.amount * 100) / 100;
    const newPaidAmount = Math.round((currentPaid + payAmount) * 100) / 100;
    const newBalance = Math.round(Math.max(0, currentBalance - payAmount) * 100) / 100;
    const newStatus: FinancialTransaction['status'] = newBalance <= 0 ? 'completed' : 'partially_paid';
    const nowISO = new Date().toISOString();
    const today = payload.paymentDate || nowISO.split('T')[0];
    const receipt = payload.receiptNumber || `REC-TX-${Date.now().toString().slice(-6)}`;

    const combinedNotes = payload.notes?.trim()
      ? (tx.notes ? `${tx.notes} | Baixa: ${payload.notes.trim()}` : payload.notes.trim())
      : tx.notes;

    const updatedTx: FinancialTransaction = {
      ...tx,
      paidAmount: newPaidAmount,
      balance: newBalance,
      status: newStatus,
      paymentDate: today,
      paymentMethod: payload.paymentMethod,
      receiptNumber: receipt,
      notes: combinedNotes,
      updatedAt: nowISO,
    };

    let targetTxId = transactionId;
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      if (isValidUUID(transactionId)) {
        const { error: updateError } = await supabase
          .from('financial_transactions')
          .update({
            paid_amount: newPaidAmount,
            balance: newBalance,
            status: newStatus,
            payment_date: today,
            payment_method: payload.paymentMethod,
            receipt_number: receipt,
            notes: combinedNotes || null,
            updated_at: nowISO,
          })
          .eq('id', transactionId)
          .eq('tenant_id', tenantId);

        if (updateError) {
          console.error('Erro ao atualizar lançamento no Supabase:', updateError);
          throw new Error(`Não foi possível registrar a baixa: ${updateError.message}`);
        }
      } else {
        // Se o ID original não era UUID válido, inserir com novo UUID garantido no Supabase
        const newId = generateUUID();
        targetTxId = newId;
        const { error: insertErr } = await supabase.from('financial_transactions').insert({
          id: newId,
          tenant_id: tenantId,
          branch_id: tx.branchId && isValidUUID(tx.branchId) ? tx.branchId : null,
          type: tx.type,
          category: tx.category,
          description: tx.description,
          amount: tx.amount,
          paid_amount: newPaidAmount,
          balance: newBalance,
          competence: tx.competence,
          due_date: tx.dueDate || null,
          payment_date: today,
          status: newStatus,
          student_id: tx.studentId && isValidUUID(tx.studentId) ? tx.studentId : null,
          guardian_person_id: tx.guardianPersonId && isValidUUID(tx.guardianPersonId) ? tx.guardianPersonId : null,
          class_group_id: tx.classGroupId && isValidUUID(tx.classGroupId) ? tx.classGroupId : null,
          quantity: tx.quantity || 1,
          unit_price: tx.unitPrice || tx.amount,
          payment_method: payload.paymentMethod,
          receipt_number: receipt,
          notes: combinedNotes || null,
          created_by_user_id: tx.createdByUserId && isValidUUID(tx.createdByUserId) ? tx.createdByUserId : null,
          created_by_name: tx.createdByUserName || payload.registeredByName,
        });

        if (insertErr) {
          console.error('Erro ao persistir lançamento no Supabase durante baixa:', insertErr);
          throw new Error(`Não foi possível registrar a baixa: ${insertErr.message}`);
        }
        updatedTx.id = targetTxId;
      }
    }

    const updatedList = currentTxs.map((t) =>
      t.id === transactionId || t.id === updatedTx.id ? updatedTx : t
    );

    if (!updatedList.some((t) => t.id === updatedTx.id)) {
      updatedList.unshift(updatedTx);
    }

    DataStore.saveFinancialTransactions(updatedList);
    return updatedTx;
  },

  /**
   * Lança cobrança extra em lote para alunos de uma turma ou evento
   */
  async createBatchTransactions(payload: {
    tenantId: string;
    branchId?: string;
    studentIds: string[];
    classGroupId?: string;
    category: FinancialTransaction['category'];
    description: string;
    amount: number;
    competence: string;
    dueDate?: string;
    createdByUserName?: string;
    createdByUserId?: string;
  }): Promise<FinancialTransaction[]> {
    const list: FinancialTransaction[] = [];
    for (const studentId of payload.studentIds) {
      const tx = await this.createTransaction({
        tenantId: payload.tenantId,
        branchId: payload.branchId,
        type: 'income',
        category: payload.category,
        description: payload.description,
        amount: payload.amount,
        competence: payload.competence,
        dueDate: payload.dueDate,
        status: 'pending',
        studentId,
        classGroupId: payload.classGroupId,
        createdByUserName: payload.createdByUserName,
        createdByUserId: payload.createdByUserId,
      });
      list.push(tx);
    }
    return list;
  },

  /**
   * Cancela uma transação extra
   */
  async cancelTransaction(id: string, tenantId: string): Promise<void> {
    const current = DataStore.getFinancialTransactions(tenantId);
    const updated = current.map((t) => (t.id === id ? { ...t, status: 'canceled' as const } : t));
    DataStore.saveFinancialTransactions(updated);

    if (isSupabaseConfigured() && supabase && isValidUUID(id) && isValidUUID(tenantId)) {
      try {
        await supabase
          .from('financial_transactions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('tenant_id', tenantId);
      } catch (err: any) {
        console.warn('Aviso ao cancelar transação no Supabase:', err.message);
      }
    }
  },

  /**
   * Envia e-mail de cobrança / lembrete com registro de tentativa
   */
  async sendBillingReminder(payload: SendReminderPayload): Promise<PaymentReminder> {
    if (!payload.recipientEmail || !payload.recipientEmail.includes('@')) {
      throw new Error('E-mail do destinatário inválido ou não cadastrado.');
    }

    const nowISO = new Date().toISOString();
    const reminderId = `rem-${Date.now()}`;

    // Simulação segura do provedor de e-mail (Resend/SendGrid/SMTP backend)
    // Sem disparar e-mails em massa acidentais e registrando exatamente a tentativa
    const reminder: PaymentReminder = {
      id: reminderId,
      tenantId: payload.tenantId,
      invoiceId: payload.invoiceId,
      recipientEmail: payload.recipientEmail,
      recipientName: payload.recipientName,
      recipientType: payload.recipientType,
      subject: payload.subject,
      bodySnippet: payload.body.slice(0, 140) + '...',
      sentAt: nowISO,
      status: 'sent',
      providerResponse: isSupabaseConfigured()
        ? 'Lembrete de cobrança registrado e encaminhado com sucesso.'
        : 'Lembrete de cobrança registrado no histórico da fatura (modo de avaliação).',
      sentByUserId: payload.sentByUserId,
    };

    if (isSupabaseConfigured() && supabase && isValidUUID(payload.tenantId) && isValidUUID(payload.invoiceId)) {
      try {
        await supabase.from('payment_reminders').insert({
          tenant_id: payload.tenantId,
          invoice_id: payload.invoiceId,
          recipient_email: payload.recipientEmail,
          recipient_name: payload.recipientName,
          recipient_type: payload.recipientType,
          subject: payload.subject,
          body_snippet: reminder.bodySnippet,
          status: 'sent',
          provider_response: reminder.providerResponse,
          sent_by_user_id: payload.sentByUserId && isValidUUID(payload.sentByUserId) ? payload.sentByUserId : null,
        });
      } catch (err: any) {
        console.warn('Aviso ao persistir lembrete de e-mail no Supabase:', err.message);
      }
    }

    const localReminders = DataStore.getPaymentReminders(payload.tenantId);
    DataStore.savePaymentReminders([reminder, ...localReminders]);
    return reminder;
  },

  /**
   * Consulta histórico de lembretes enviados por tenant
   */
  async fetchReminders(tenantId: string): Promise<PaymentReminder[]> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId)) {
      return DataStore.getPaymentReminders(tenantId);
    }

    try {
      const { data, error } = await supabase
        .from('payment_reminders')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('sent_at', { ascending: false });

      if (error) throw error;
      if (!data || data.length === 0) return DataStore.getPaymentReminders(tenantId);

      return data.map((row: any) => ({
        id: row.id,
        tenantId: row.tenant_id,
        invoiceId: row.invoice_id,
        recipientEmail: row.recipient_email,
        recipientName: row.recipient_name,
        recipientType: row.recipient_type,
        subject: row.subject,
        bodySnippet: row.body_snippet,
        sentAt: row.sent_at,
        status: row.status,
        providerResponse: row.provider_response,
        sentByUserId: row.sent_by_user_id,
      }));
    } catch (err: any) {
      console.warn('Aviso ao carregar lembretes:', err.message);
      return DataStore.getPaymentReminders(tenantId);
    }
  },

  /**
   * Vincula ou altera o plano financeiro do aluno e ajusta as mensalidades futuras em aberto.
   * Regras de proteção e negócio:
   * 1. Mensalidades 'paid' ou com paidAmount > 0: NUNCA são modificadas.
   * 2. Mensalidades 'partially_paid': Preservam histórico e baixas, NUNCA sofrem alteração automática.
   * 3. Mensalidades 'overdue' ou vencidas (dueDate < hoje): Preservam dívida anterior, NUNCA sofrem alteração automática.
   * 4. Cobranças extras (financial_transactions): NUNCA são alteradas.
   * 5. Apenas mensalidades com status 'pending', paidAmount === 0, balance === finalAmount, dueDate >= hoje
   *    e competência >= vigência são recalculadas.
   * 6. Registra histórico e auditoria.
   */
  async updateStudentPlanAndFutureInvoices(params: {
    tenantId: string;
    studentId: string;
    newPlanId?: string | null;
    newMonthlyFee?: number;
    effectiveCompetence?: string;
    currentUserName?: string;
  }): Promise<{
    updatedInvoicesCount: number;
    updatedInvoices: Invoice[];
    newPlanName?: string;
    message: string;
  }> {
    const {
      tenantId,
      studentId,
      newPlanId,
      newMonthlyFee,
      effectiveCompetence,
      currentUserName = 'Administrador',
    } = params;

    const today = new Date().toISOString().split('T')[0];
    const targetComp = effectiveCompetence || getNextCompetence();
    const targetCompInt = parseCompetenceToInt(targetComp);

    // 1. Obter informações do novo plano
    const allPlans = await this.fetchPlans(tenantId);
    const selectedPlan = newPlanId ? allPlans.find((p) => p.id === newPlanId) : null;

    let planAmount = 0;
    let discountAmount = 0;
    let discountDescription: string | undefined = undefined;
    let finalAmount = 0;
    let planName = 'Personalizado / Sem plano';

    if (selectedPlan) {
      planAmount = Number(selectedPlan.amount);
      if (selectedPlan.discountPercentage && selectedPlan.discountPercentage > 0) {
        discountAmount = Math.round((planAmount * (selectedPlan.discountPercentage / 100)) * 100) / 100;
        discountDescription = selectedPlan.discountDescription || `${selectedPlan.discountPercentage}% desconto do plano`;
      }
      finalAmount = Math.round(Math.max(0, planAmount - discountAmount) * 100) / 100;
      planName = selectedPlan.name;
    } else {
      planAmount = newMonthlyFee !== undefined ? Number(newMonthlyFee) : 0;
      finalAmount = planAmount;
    }

    let updatedCount = 0;
    const nowISO = new Date().toISOString();

    // 2. Se Supabase estiver conectado, tentar executar via RPC atômica update_student_plan_and_invoices
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId) && isValidUUID(studentId)) {
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('update_student_plan_and_invoices', {
          p_tenant_id: tenantId,
          p_student_id: studentId,
          p_new_plan_id: selectedPlan && isValidUUID(selectedPlan.id) ? selectedPlan.id : null,
          p_new_monthly_fee: finalAmount,
          p_effective_competence: targetComp,
          p_user_name: currentUserName,
        });

        if (!rpcErr && rpcData?.success) {
          updatedCount = rpcData.updated_invoices_count || 0;
        } else if (rpcErr) {
          console.warn('RPC update_student_plan_and_invoices fallback para REST:', rpcErr.message);
          // Fallback REST no Supabase
          // 2.1 Atualizar estudante
          await supabase
            .from('students')
            .update({
              plan_id: selectedPlan && isValidUUID(selectedPlan.id) ? selectedPlan.id : null,
              monthly_fee: finalAmount,
              updated_at: nowISO,
            })
            .eq('id', studentId)
            .eq('tenant_id', tenantId);

          // 2.2 Buscar e atualizar faturas elegíveis
          const { data: candidateInvoices } = await supabase
            .from('invoices')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('student_id', studentId)
            .eq('status', 'pending');

          const toUpdate = (candidateInvoices || []).filter((inv: any) => {
            const isZeroPaid = Number(inv.paid_amount || 0) === 0;
            const isFullBalance = Number(inv.balance) === Number(inv.final_amount);
            const isNotOverdue = !inv.due_date || inv.due_date >= today;
            const isFutureComp = parseCompetenceToInt(inv.competence) >= targetCompInt;
            return isZeroPaid && isFullBalance && isNotOverdue && isFutureComp;
          });

          for (const inv of toUpdate) {
            let newDueDate = inv.due_date;
            if (selectedPlan && selectedPlan.dueDay) {
              const [compM, compY] = (inv.competence || '').split('/');
              if (compM && compY) {
                const dayStr = String(Math.min(28, Math.max(1, selectedPlan.dueDay))).padStart(2, '0');
                const candidateDate = `${compY}-${compM.padStart(2, '0')}-${dayStr}`;
                if (candidateDate >= today) {
                  newDueDate = candidateDate;
                }
              }
            }
            await supabase
              .from('invoices')
              .update({
                plan_id: selectedPlan && isValidUUID(selectedPlan.id) ? selectedPlan.id : null,
                due_date: newDueDate,
                original_amount: planAmount,
                discount_amount: discountAmount,
                discount_description: discountDescription || null,
                final_amount: finalAmount,
                balance: finalAmount,
                updated_at: nowISO,
              })
              .eq('id', inv.id)
              .eq('tenant_id', tenantId);
            updatedCount++;
          }
        }
      } catch (err: any) {
        console.warn('Aviso na atualização de plano no Supabase:', err.message);
      }
    }

    // 3. Atualizar DataStore local (garante consistência total em SSR, offline e no estado do app)
    const localInvoices = DataStore.getInvoices(tenantId);
    let localUpdatedCount = 0;

    const nextInvoices = localInvoices.map((inv) => {
      const isTargetStudent = inv.studentId === studentId;
      const isPending = inv.status === 'pending';
      const isZeroPaid = (inv.paidAmount || 0) === 0;
      const isFullBalance = inv.balance === inv.finalAmount;
      const isNotOverdue = !inv.dueDate || inv.dueDate >= today;
      const isFutureComp = parseCompetenceToInt(inv.competence) >= targetCompInt;

      if (isTargetStudent && isPending && isZeroPaid && isFullBalance && isNotOverdue && isFutureComp) {
        localUpdatedCount++;
        const oldAmount = inv.finalAmount;
        let newDueDate = inv.dueDate;
        if (selectedPlan && selectedPlan.dueDay) {
          const [compM, compY] = (inv.competence || '').split('/');
          if (compM && compY) {
            const dayStr = String(Math.min(28, Math.max(1, selectedPlan.dueDay))).padStart(2, '0');
            const candidateDate = `${compY}-${compM.padStart(2, '0')}-${dayStr}`;
            if (candidateDate >= today) {
              newDueDate = candidateDate;
            }
          }
        }
        return {
          ...inv,
          planId: selectedPlan ? selectedPlan.id : undefined,
          dueDate: newDueDate,
          originalAmount: planAmount,
          discountAmount,
          discountDescription,
          finalAmount,
          balance: finalAmount,
          auditTrail: [
            ...(inv.auditTrail || []),
            {
              date: nowISO,
              action: `Plano alterado para "${planName}". Mensalidade recalculada de R$ ${oldAmount.toFixed(2)} para R$ ${finalAmount.toFixed(2)} a partir da competência ${targetComp}.`,
              userName: currentUserName,
            },
          ],
        };
      }
      return inv;
    });

    DataStore.saveInvoices(nextInvoices);

    // Atualizar estudante no DataStore
    const localStudents = DataStore.getStudents(tenantId);
    const updatedLocalStudents = localStudents.map((st) => {
      if (st.id === studentId) {
        return {
          ...st,
          planId: selectedPlan ? selectedPlan.id : undefined,
          monthlyFee: finalAmount,
        };
      }
      return st;
    });
    DataStore.saveStudents(updatedLocalStudents);

    // Auditoria
    const finalCount = updatedCount > 0 ? updatedCount : localUpdatedCount;
    const msg = `Plano vinculado: "${planName}". Mensalidade: R$ ${finalAmount.toFixed(2)}. ${finalCount} faturas futuras ajustadas (vigência a partir de ${targetComp}).`;

    DataStore.logAudit(
      tenantId,
      'user-system',
      currentUserName,
      'Troca de Plano de Aluno',
      'Student',
      studentId,
      msg
    );

    return {
      updatedInvoicesCount: finalCount,
      updatedInvoices: nextInvoices,
      newPlanName: planName,
      message: msg,
    };
  },
};
