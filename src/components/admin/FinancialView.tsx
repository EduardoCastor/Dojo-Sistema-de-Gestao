import React, { useState, useMemo, useEffect } from 'react';
import {
  DollarSign,
  CheckCircle,
  Clock,
  AlertTriangle,
  QrCode,
  FileText,
  Search,
  Filter,
  ArrowUpRight,
  Printer,
  X,
  CreditCard,
  Copy,
  Check,
  Plus,
  Mail,
  Send,
  Calendar,
  Layers,
  ShoppingBag,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Eye,
  Trash2,
  Edit2,
  Users,
  ShieldCheck,
  Building2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import {
  Invoice,
  Student,
  Person,
  Tenant,
  Branch,
  ClassGroup,
  User,
  MembershipPlan,
  FinancialTransaction,
  PaymentReminder,
  CreateMembershipPlanPayload,
  CreateTransactionPayload,
} from '../../types';
import { formatCurrencyBRL, formatDateBR } from '../../utils/formatters';
import { financialService } from '../../services/financialService';
import { EmailReminderModal } from './EmailReminderModal';
import { PlanFormModal } from './PlanFormModal';
import { TransactionFormModal } from './TransactionFormModal';
import { GenerateInvoicesModal } from './GenerateInvoicesModal';

export type SettleTarget =
  | { type: 'invoice'; data: Invoice }
  | { type: 'transaction'; data: FinancialTransaction };

interface FinancialViewProps {
  tenant: Tenant;
  invoices?: Invoice[];
  students: Student[];
  persons: Person[];
  classes?: ClassGroup[];
  branches?: Branch[];
  currentBranchId?: string;
  currentUser: User;
  onRefreshData?: () => Promise<void>;
  onSettleInvoice?: (updatedInvoice: Invoice) => void;
}

export const FinancialView: React.FC<FinancialViewProps> = ({
  tenant,
  invoices: propInvoices,
  students,
  persons,
  classes = [],
  branches = [],
  currentBranchId = 'all',
  currentUser,
  onRefreshData,
  onSettleInvoice,
}) => {
  // Abas do Módulo
  const [activeTab, setActiveTab] = useState<'overview' | 'invoices' | 'transactions' | 'plans'>('overview');

  // Estados dos Dados Financeiros
  const [invoices, setInvoices] = useState<Invoice[]>(propInvoices || []);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [reminders, setReminders] = useState<PaymentReminder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Sincronizar propInvoices caso venha atualizado do App.tsx
  useEffect(() => {
    if (propInvoices && propInvoices.length > 0) {
      setInvoices(propInvoices);
    }
  }, [propInvoices]);

  // Filtros Globais do Painel
  const [selectedCompetence, setSelectedCompetence] = useState<string>('10/2026');
  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranchId || 'all');
  const [selectedClassId, setSelectedClassId] = useState<string>('all');

  // Filtros da Aba de Cobranças
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>('all');
  const [invoiceSearchTerm, setInvoiceSearchTerm] = useState('');

  // Filtros da Aba de Transações Extras
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [transactionCategoryFilter, setTransactionCategoryFilter] = useState<string>('all');

  // Modais
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null);
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [reminderModalInvoice, setReminderModalInvoice] = useState<Invoice | null>(null);
  const [selectedInvoiceForPix, setSelectedInvoiceForPix] = useState<Invoice | null>(null);
  const [selectedInvoiceForReceipt, setSelectedInvoiceForReceipt] = useState<Invoice | null>(null);
  const [copiedPix, setCopiedPix] = useState(false);

  // Modal de Baixa / Registro de Pagamento (Mensalidades e Transações Extras)
  const [settlingTarget, setSettlingTarget] = useState<SettleTarget | null>(null);
  const [settleAmount, setSettleAmount] = useState<number>(0);
  const [settleMethod, setSettleMethod] = useState<'pix' | 'cash' | 'credit_card' | 'boleto' | 'transfer'>('pix');
  const [settleDate, setSettleDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [settleNotes, setSettleNotes] = useState('');
  const [settleError, setSettleError] = useState<string | null>(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Carregar dados completos
  const loadFinancialData = async () => {
    setIsLoading(true);
    try {
      const [fetchedInvoices, fetchedPlans, fetchedTxs, fetchedReminders] = await Promise.all([
        financialService.fetchInvoices(tenant.id),
        financialService.fetchPlans(tenant.id, selectedBranchId),
        financialService.fetchTransactions(tenant.id),
        financialService.fetchReminders(tenant.id),
      ]);
      setInvoices(fetchedInvoices);
      setPlans(fetchedPlans);
      setTransactions(fetchedTxs);
      setReminders(fetchedReminders);
    } catch (err: any) {
      console.warn('Aviso ao carregar dados financeiros:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFinancialData();
  }, [tenant.id, selectedBranchId]);

  // Lista de competências disponíveis para filtro
  const availableCompetences = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach((i) => set.add(i.competence));
    transactions.forEach((t) => set.add(t.competence));
    set.add('10/2026');
    set.add('11/2026');
    return Array.from(set).sort().reverse();
  }, [invoices, transactions]);

  // Helpers de Aluno e Pessoa
  const getStudentAndPerson = (studentId?: string) => {
    if (!studentId) return { student: null, person: null };
    const student = students.find((s) => s.id === studentId) || null;
    const person = student ? persons.find((p) => p.id === student.personId) || null : null;
    return { student, person };
  };

  const getGuardianPerson = (guardianId?: string) => {
    if (!guardianId) return null;
    return persons.find((p) => p.id === guardianId) || null;
  };

  const getClassObj = (classId?: string) => {
    if (!classId) return null;
    return classes.find((c) => c.id === classId) || null;
  };

  // ==============================================================
  // 1. CÁLCULO DOS INDICADORES FINANCEIROS DO PERÍODO
  // ==============================================================
  const periodInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (selectedCompetence !== 'all' && inv.competence !== selectedCompetence) return false;
      if (selectedBranchId !== 'all' && inv.branchId && inv.branchId !== selectedBranchId) return false;
      if (selectedClassId !== 'all' && inv.classGroupId && inv.classGroupId !== selectedClassId) return false;
      return true;
    });
  }, [invoices, selectedCompetence, selectedBranchId, selectedClassId]);

  const periodTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (selectedCompetence !== 'all' && t.competence !== selectedCompetence) return false;
      if (selectedBranchId !== 'all' && t.branchId && t.branchId !== selectedBranchId) return false;
      if (selectedClassId !== 'all' && t.classGroupId && t.classGroupId !== selectedClassId) return false;
      return t.status !== 'canceled';
    });
  }, [transactions, selectedCompetence, selectedBranchId, selectedClassId]);

  const financialIndicators = useMemo(() => {
    // Mensalidades
    const totalInvoiced = periodInvoices.reduce((acc, i) => acc + (i.status !== 'canceled' ? i.finalAmount : 0), 0);
    const totalPaid = periodInvoices.reduce((acc, i) => acc + (i.status !== 'canceled' ? i.paidAmount : 0), 0);
    const totalOverdue = periodInvoices
      .filter((i) => i.status === 'overdue')
      .reduce((acc, i) => acc + i.balance, 0);
    const totalPending = periodInvoices
      .filter((i) => i.status === 'pending' || i.status === 'partially_paid')
      .reduce((acc, i) => acc + i.balance, 0);

    // Alunos inadimplentes
    const overdueStudentIds = new Set(
      periodInvoices.filter((i) => i.status === 'overdue' && i.balance > 0).map((i) => i.studentId)
    );
    const overdueStudentsCount = overdueStudentIds.size;

    // Receitas Extras (considerando valores pagos e saldos pendentes)
    const extraIncomes = periodTransactions.filter((t) => t.type === 'income');
    const extraIncomeRealized = extraIncomes.reduce((acc, t) => {
      const paid = t.paidAmount !== undefined ? t.paidAmount : (t.status === 'completed' ? t.amount : 0);
      return acc + paid;
    }, 0);
    const extraIncomePending = extraIncomes.reduce((acc, t) => {
      const bal = t.balance !== undefined ? t.balance : (t.status === 'completed' ? 0 : t.amount);
      return acc + bal;
    }, 0);

    // Despesas Registradas (considerando valores pagos e saldos pendentes)
    const expenses = periodTransactions.filter((t) => t.type === 'expense');
    const expensesRealized = expenses.reduce((acc, t) => {
      const paid = t.paidAmount !== undefined ? t.paidAmount : (t.status === 'completed' ? t.amount : 0);
      return acc + paid;
    }, 0);
    const expensesPending = expenses.reduce((acc, t) => {
      const bal = t.balance !== undefined ? t.balance : (t.status === 'completed' ? 0 : t.amount);
      return acc + bal;
    }, 0);

    // Saldo do Período: Receitas Efetivamente Realizadas - Despesas Efetivamente Pagas
    const totalRealizedRevenue = totalPaid + extraIncomeRealized;
    const netPeriodBalance = totalRealizedRevenue - expensesRealized;

    // Valores Previstos
    const totalProjectedRevenue = totalInvoiced + extraIncomeRealized + extraIncomePending;
    const totalProjectedExpenses = expensesRealized + expensesPending;
    const projectedNetBalance = totalProjectedRevenue - totalProjectedExpenses;

    const defaultRate =
      totalInvoiced > 0 ? Math.min(100, Math.round((totalOverdue / totalInvoiced) * 100)) : 0;

    return {
      totalInvoiced,
      totalPaid,
      totalPending,
      totalOverdue,
      overdueStudentsCount,
      defaultRate,
      extraIncomeRealized,
      extraIncomePending,
      expensesRealized,
      expensesPending,
      totalRealizedRevenue,
      netPeriodBalance,
      totalProjectedRevenue,
      totalProjectedExpenses,
      projectedNetBalance,
    };
  }, [periodInvoices, periodTransactions]);

  // Inadimplência detalhada por Turma
  const classDefaultBreakdown = useMemo(() => {
    const map = new Map<string, { className: string; studentIds: Set<string>; overdueAmount: number }>();

    classes.forEach((c) => {
      map.set(c.id, { className: c.name, studentIds: new Set(), overdueAmount: 0 });
    });
    map.set('no_class', { className: 'Sem Turma Específica', studentIds: new Set(), overdueAmount: 0 });

    periodInvoices.forEach((inv) => {
      if (inv.status === 'overdue' && inv.balance > 0) {
        const key = inv.classGroupId && map.has(inv.classGroupId) ? inv.classGroupId : 'no_class';
        const entry = map.get(key)!;
        entry.studentIds.add(inv.studentId);
        entry.overdueAmount += inv.balance;
      }
    });

    return Array.from(map.entries())
      .map(([id, data]) => ({
        id,
        className: data.className,
        studentCount: data.studentIds.size,
        overdueAmount: data.overdueAmount,
      }))
      .filter((item) => item.studentCount > 0 || item.overdueAmount > 0)
      .sort((a, b) => b.overdueAmount - a.overdueAmount);
  }, [classes, periodInvoices]);

  // Faturas filtradas para a tabela da aba 'invoices'
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (invoiceStatusFilter !== 'all' && inv.status !== invoiceStatusFilter) return false;
      if (selectedCompetence !== 'all' && inv.competence !== selectedCompetence) return false;
      if (selectedBranchId !== 'all' && inv.branchId && inv.branchId !== selectedBranchId) return false;
      if (selectedClassId !== 'all' && inv.classGroupId && inv.classGroupId !== selectedClassId) return false;

      if (invoiceSearchTerm.trim()) {
        const term = invoiceSearchTerm.toLowerCase();
        const { student, person } = getStudentAndPerson(inv.studentId);
        const guardian = getGuardianPerson(inv.financialGuardianId);

        const nameMatch = person ? person.fullName.toLowerCase().includes(term) : false;
        const regMatch = student ? student.registrationNumber.toLowerCase().includes(term) : false;
        const guardianMatch = guardian ? guardian.fullName.toLowerCase().includes(term) : false;
        const compMatch = inv.competence.toLowerCase().includes(term);

        if (!nameMatch && !regMatch && !guardianMatch && !compMatch) return false;
      }

      return true;
    });
  }, [invoices, invoiceStatusFilter, selectedCompetence, selectedBranchId, selectedClassId, invoiceSearchTerm, students, persons]);

  // Transações filtradas para a aba 'transactions'
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (transactionTypeFilter !== 'all' && t.type !== transactionTypeFilter) return false;
      if (transactionCategoryFilter !== 'all' && t.category !== transactionCategoryFilter) return false;
      if (selectedCompetence !== 'all' && t.competence !== selectedCompetence) return false;
      return true;
    });
  }, [transactions, transactionTypeFilter, transactionCategoryFilter, selectedCompetence]);

  // ==============================================================
  // AÇÕES FINANCEIRAS
  // ==============================================================
  const handleOpenSettleModal = (inv: Invoice) => {
    setSettlingInvoice(inv);
    setSettleAmount(inv.balance);
    setSettleMethod(inv.paymentMethod || 'pix');
    setSettleNotes('');
  };

  const handleConfirmSettle = async () => {
    if (!settlingInvoice) return;
    setIsSubmittingPayment(true);
    try {
      const updated = await financialService.settlePayment(settlingInvoice.id, tenant.id, {
        amount: settleAmount,
        paymentMethod: settleMethod,
        notes: settleNotes.trim() || undefined,
        registeredByName: currentUser.name,
        registeredByUserId: currentUser.id,
      });

      setInvoices((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setFeedbackBanner({
        type: 'success',
        message: `Pagamento de ${formatCurrencyBRL(settleAmount)} registrado com sucesso.`,
      });
      setSettlingInvoice(null);
      if (onSettleInvoice) {
        onSettleInvoice(updated.id, updated.paymentMethod, settleAmount);
      }
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err?.message || 'Não foi possível registrar o pagamento.',
      });
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const handleCancelInvoice = async (inv: Invoice) => {
    if (!window.confirm(`Deseja realmente cancelar a cobrança de ${inv.competence} do aluno?`)) return;
    try {
      const updated = await financialService.cancelInvoice(inv.id, tenant.id, 'Cancelamento manual pelo administrador');
      setInvoices((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setFeedbackBanner({
        type: 'success',
        message: 'Cobrança cancelada com sucesso.',
      });
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err?.message || 'Falha ao cancelar cobrança.',
      });
    }
  };

  const handleSavePlan = async (payload: CreateMembershipPlanPayload, planId?: string) => {
    if (planId) {
      const updated = await financialService.updatePlan(planId, tenant.id, payload);
      setPlans((prev) => prev.map((p) => (p.id === planId ? updated : p)));
      setFeedbackBanner({ type: 'success', message: 'Plano de mensalidade atualizado com sucesso.' });
    } else {
      const created = await financialService.createPlan(payload);
      setPlans((prev) => [created, ...prev]);
      setFeedbackBanner({ type: 'success', message: 'Plano de mensalidade cadastrado com sucesso.' });
    }
  };

  const handleTogglePlan = async (plan: MembershipPlan) => {
    try {
      const updated = await financialService.updatePlan(plan.id, tenant.id, { active: !plan.active });
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? updated : p)));
      setFeedbackBanner({
        type: 'success',
        message: `Plano "${plan.name}" ${updated.active ? 'ativado' : 'desativado'} com sucesso.`,
      });
    } catch (err: any) {
      setFeedbackBanner({ type: 'error', message: err?.message || 'Falha ao alterar situação do plano.' });
    }
  };

  const handleSaveTransaction = async (payload: CreateTransactionPayload) => {
    const created = await financialService.createTransaction(payload);
    setTransactions((prev) => [created, ...prev]);
    setFeedbackBanner({
      type: 'success',
      message: `Lançamento de ${created.type === 'income' ? 'receita' : 'despesa'} registrado com sucesso.`,
    });
  };

  const handleSaveBatchTransactions = async (payload: {
    tenantId: string;
    branchId?: string;
    studentIds: string[];
    classGroupId?: string;
    category: FinancialTransaction['category'];
    description: string;
    amount: number;
    competence: string;
    dueDate?: string;
  }) => {
    const createdList = await financialService.createBatchTransactions({
      ...payload,
      createdByUserName: currentUser.name,
      createdByUserId: currentUser.id,
    });
    setTransactions((prev) => [...createdList, ...prev]);
    setFeedbackBanner({
      type: 'success',
      message: `${createdList.length} cobranças em lote geradas com sucesso para a turma.`,
    });
  };

  const handleCancelTransaction = async (t: FinancialTransaction) => {
    if (!window.confirm(`Deseja realmente cancelar o lançamento "${t.description}"?`)) return;
    try {
      await financialService.cancelTransaction(t.id, tenant.id);
      setTransactions((prev) => prev.map((item) => (item.id === t.id ? { ...item, status: 'canceled' } : item)));
      setFeedbackBanner({ type: 'success', message: 'Lançamento cancelado com sucesso.' });
    } catch (err: any) {
      setFeedbackBanner({ type: 'error', message: err?.message || 'Falha ao cancelar lançamento.' });
    }
  };

  const handleSendReminder = async (data: {
    invoiceId: string;
    recipientEmail: string;
    recipientName: string;
    recipientType: 'student' | 'financial_guardian';
    subject: string;
    body: string;
  }) => {
    const reminder = await financialService.sendBillingReminder({
      tenantId: tenant.id,
      invoiceId: data.invoiceId,
      recipientEmail: data.recipientEmail,
      recipientName: data.recipientName,
      recipientType: data.recipientType,
      subject: data.subject,
      body: data.body,
      sentByUserId: currentUser.id,
    });

    setReminders((prev) => [reminder, ...prev]);
    setFeedbackBanner({
      type: 'success',
      message: `Notificação enviada com sucesso para ${data.recipientEmail}.`,
    });
  };

  const handleCopyPix = (code?: string) => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopiedPix(true);
    setTimeout(() => setCopiedPix(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* CABEÇALHO */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-red-500" />
              Mensalidades e Finanças
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-950/60 border border-red-500/30 text-red-400">
              Gestão Financeira do Dojo
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Controle de mensalidades, cobrança por e-mail, prevenção de inadimplência, receitas extras e despesas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsGenerateModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow transition-colors cursor-pointer"
          >
            <Calendar className="h-4 w-4" />
            <span>Gerar Mensalidades</span>
          </button>

          <button
            onClick={() => setIsTransactionModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4 text-emerald-400" />
            <span>Lançamento Extra</span>
          </button>
        </div>
      </div>

      {/* BANNER DE FEEDBACK */}
      {feedbackBanner && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs animate-fadeIn ${
            feedbackBanner.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-300'
              : 'bg-red-950/60 border-red-500/30 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackBanner.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            )}
            <span>{feedbackBanner.message}</span>
          </div>
          <button onClick={() => setFeedbackBanner(null)} className="text-slate-400 hover:text-white cursor-pointer ml-3">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* BARRA DE FILTROS GLOBAIS DE PERÍODO E UNIDADE */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl border border-slate-800 bg-slate-900/60 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Competência */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-semibold">Competência:</span>
            <select
              value={selectedCompetence}
              onChange={(e) => setSelectedCompetence(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white font-mono focus:border-red-500 focus:outline-none"
            >
              <option value="all">Todas as Competências</option>
              {availableCompetences.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Filial */}
          {branches.length > 1 && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-semibold">Unidade:</span>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white focus:border-red-500 focus:outline-none"
              >
                <option value="all">Todas as Unidades</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Turma */}
          {classes.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-semibold">Turma:</span>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white focus:border-red-500 focus:outline-none"
              >
                <option value="all">Todas as Turmas</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
            Regra Familiar: <strong>{tenant.settings.familyDiscount2ndMember}% Desconto 2º Membro</strong>
          </span>
        </div>
      </div>

      {/* NAVEGAÇÃO ENTRE ABAS */}
      <div className="flex border-b border-slate-800 gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'overview'
              ? 'border-red-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <TrendingUp className="h-4 w-4 text-red-500" />
          <span>Painel Financeiro & Indicadores</span>
        </button>

        <button
          onClick={() => setActiveTab('invoices')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'invoices'
              ? 'border-red-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <CreditCard className="h-4 w-4 text-amber-400" />
          <span>Mensalidades & Inadimplência</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
            {periodInvoices.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('transactions')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'transactions'
              ? 'border-red-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShoppingBag className="h-4 w-4 text-emerald-400" />
          <span>Receitas & Despesas Extras</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
            {periodTransactions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('plans')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'plans'
              ? 'border-red-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="h-4 w-4 text-blue-400" />
          <span>Configuração de Planos</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
            {plans.length}
          </span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* ABA 1: PAINEL FINANCEIRO & INDICADORES                         */}
      {/* ============================================================== */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* CARDS DE INDICADORES REALIZADOS */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Total Recebido */}
            <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Total Recebido (Efetivo)</span>
                <CheckCircle className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="text-xl font-bold text-emerald-400">
                {formatCurrencyBRL(financialIndicators.totalRealizedRevenue)}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                Mensalidades ({formatCurrencyBRL(financialIndicators.totalPaid)}) + Extras ({formatCurrencyBRL(financialIndicators.extraIncomeRealized)})
              </div>
            </div>

            {/* Total Pendente */}
            <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Mensalidades a Vencer</span>
                <Clock className="h-4 w-4 text-blue-400" />
              </div>
              <div className="text-xl font-bold text-white">
                {formatCurrencyBRL(financialIndicators.totalPending)}
              </div>
              <div className="text-[10px] text-slate-500">Cobranças em aberto dentro do prazo</div>
            </div>

            {/* Inadimplência / Vencidos */}
            <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Total em Inadimplência</span>
                <AlertTriangle className="h-4 w-4 text-red-400" />
              </div>
              <div className="text-xl font-bold text-red-400">
                {formatCurrencyBRL(financialIndicators.totalOverdue)}
              </div>
              <div className="text-[10px] text-red-400/80">
                {financialIndicators.overdueStudentsCount} aluno(s) com mensalidade vencida ({financialIndicators.defaultRate}%)
              </div>
            </div>

            {/* Saldo Efetivo do Período */}
            <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Saldo Realizado do Período</span>
                <DollarSign className="h-4 w-4 text-emerald-400" />
              </div>
              <div
                className={`text-xl font-bold ${
                  financialIndicators.netPeriodBalance >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {formatCurrencyBRL(financialIndicators.netPeriodBalance)}
              </div>
              <div className="text-[10px] text-slate-500">
                Receitas ({formatCurrencyBRL(financialIndicators.totalRealizedRevenue)}) - Despesas Pagas ({formatCurrencyBRL(financialIndicators.expensesRealized)})
              </div>
            </div>
          </div>

          {/* COMPARATIVO DE PREVISTO VS REALIZADO */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/50 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  Demonstrativo Efetivo Realizado
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                  Valores Confirmados
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">(+) Mensalidades Recebidas:</span>
                  <span className="font-semibold text-white font-mono">{formatCurrencyBRL(financialIndicators.totalPaid)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">(+) Receitas Extras Recebidas:</span>
                  <span className="font-semibold text-white font-mono">{formatCurrencyBRL(financialIndicators.extraIncomeRealized)}</span>
                </div>
                <div className="flex items-center justify-between text-red-400">
                  <span>(-) Despesas Efetivamente Pagas:</span>
                  <span className="font-semibold font-mono">-{formatCurrencyBRL(financialIndicators.expensesRealized)}</span>
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between font-bold text-sm">
                  <span className="text-white">Resultado Líquido em Caixa:</span>
                  <span className={financialIndicators.netPeriodBalance >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {formatCurrencyBRL(financialIndicators.netPeriodBalance)}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/50 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-blue-400" />
                  Projeção Orçamentária Prevista
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-blue-950/60 text-blue-400 border border-blue-500/30">
                  Previsão Completa
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Faturamento Total Previsto:</span>
                  <span className="font-semibold text-white font-mono">{formatCurrencyBRL(financialIndicators.totalProjectedRevenue)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Total de Despesas Estimadas:</span>
                  <span className="font-semibold text-slate-300 font-mono">{formatCurrencyBRL(financialIndicators.totalProjectedExpenses)}</span>
                </div>
                <div className="flex items-center justify-between text-amber-400">
                  <span>Saldo a Receber (Pendente + Vencido):</span>
                  <span className="font-semibold font-mono">
                    {formatCurrencyBRL(financialIndicators.totalPending + financialIndicators.totalOverdue)}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between font-bold text-sm">
                  <span className="text-white">Saldo Projetado Final:</span>
                  <span className={financialIndicators.projectedNetBalance >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {formatCurrencyBRL(financialIndicators.projectedNetBalance)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* INADIMPLÊNCIA POR TURMA */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/50 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Mapa de Inadimplência por Turma · {selectedCompetence === 'all' ? 'Geral' : selectedCompetence}
              </h3>
              <span className="text-xs text-slate-400">
                Total em Atraso: <strong className="text-red-400">{formatCurrencyBRL(financialIndicators.totalOverdue)}</strong>
              </span>
            </div>

            {classDefaultBreakdown.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
                Nenhuma inadimplência registrada para o período selecionado. Parabéns pela pontualidade!
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Turma</th>
                      <th className="py-2.5 px-3 text-center">Alunos com Pendência</th>
                      <th className="py-2.5 px-3 text-right">Valor em Atraso</th>
                      <th className="py-2.5 px-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {classDefaultBreakdown.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-3 font-semibold text-white">{item.className}</td>
                        <td className="py-3 px-3 text-center">
                          <span className="px-2 py-0.5 rounded-full bg-red-950/60 text-red-300 font-bold border border-red-500/30">
                            {item.studentCount} aluno(s)
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-red-400">
                          {formatCurrencyBRL(item.overdueAmount)}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => {
                              setSelectedClassId(item.id);
                              setInvoiceStatusFilter('overdue');
                              setActiveTab('invoices');
                            }}
                            className="text-xs text-red-400 hover:text-red-300 underline cursor-pointer"
                          >
                            Ver Cobranças
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 2: MENSALIDADES & COBRANÇAS                                */}
      {/* ============================================================== */}
      {activeTab === 'invoices' && (
        <div className="space-y-4">
          {/* Barra de Busca e Filtro de Situação */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between text-xs">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar por nome do aluno, responsável ou matrícula..."
                value={invoiceSearchTerm}
                onChange={(e) => setInvoiceSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-400 font-semibold">Situação:</span>
              <select
                value={invoiceStatusFilter}
                onChange={(e) => setInvoiceStatusFilter(e.target.value)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:outline-none focus:border-red-500"
              >
                <option value="all">Todas as Situações</option>
                <option value="pending">A Vencer (Pendentes)</option>
                <option value="overdue">Vencidas (Inadimplentes)</option>
                <option value="partially_paid">Parcialmente Pagas</option>
                <option value="paid">Quitadas (Pagas)</option>
                <option value="canceled">Canceladas</option>
              </select>
            </div>
          </div>

          {/* Tabela de Cobranças */}
          {filteredInvoices.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-950/40 space-y-2">
              <CreditCard className="h-8 w-8 text-slate-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-300">Nenhuma fatura encontrada</div>
              <p className="text-xs text-slate-500">
                Ajuste os filtros de competência, turma e situação ou clique em "Gerar Mensalidades" para emitir as cobranças do mês.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Aluno / Matrícula</th>
                      <th className="py-3 px-3">Turma</th>
                      <th className="py-3 px-3">Competência</th>
                      <th className="py-3 px-3">Vencimento</th>
                      <th className="py-3 px-3 text-right">Valor Final</th>
                      <th className="py-3 px-3 text-right">Saldo Pendente</th>
                      <th className="py-3 px-3 text-center">Situação</th>
                      <th className="py-3 px-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredInvoices.map((inv) => {
                      const { student, person } = getStudentAndPerson(inv.studentId);
                      const guardian = getGuardianPerson(inv.financialGuardianId);
                      const classObj = getClassObj(inv.classGroupId);

                      return (
                        <tr key={inv.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-bold text-white">{person?.fullName || 'Aluno Desconhecido'}</div>
                            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono">Mat: {student?.registrationNumber || 'N/A'}</span>
                              {guardian && (
                                <span className="text-blue-400 font-normal">
                                  · Resp: {guardian.fullName}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-3 text-slate-300">
                            {classObj ? classObj.name : 'Matrícula Geral'}
                          </td>

                          <td className="py-3 px-3 font-mono font-semibold text-slate-200">
                            {inv.competence}
                          </td>

                          <td className="py-3 px-3">
                            <span className="font-mono text-slate-300">{formatDateBR(inv.dueDate)}</span>
                            {inv.status === 'overdue' && (
                              <span className="block text-[10px] text-red-400 font-semibold">Vencida</span>
                            )}
                          </td>

                          <td className="py-3 px-3 text-right font-mono text-slate-300">
                            {formatCurrencyBRL(inv.finalAmount)}
                            {inv.discountAmount > 0 && (
                              <span className="block text-[10px] text-emerald-400">
                                -{formatCurrencyBRL(inv.discountAmount)}
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-3 text-right font-mono font-bold">
                            <span className={inv.balance > 0 ? (inv.status === 'overdue' ? 'text-red-400' : 'text-white') : 'text-emerald-400'}>
                              {formatCurrencyBRL(inv.balance)}
                            </span>
                            {inv.paidAmount > 0 && inv.balance > 0 && (
                              <span className="block text-[10px] text-slate-400 font-normal">
                                Pago: {formatCurrencyBRL(inv.paidAmount)}
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-3 text-center">
                            {inv.status === 'paid' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                                Quitado
                              </span>
                            )}
                            {inv.status === 'partially_paid' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950/60 text-amber-400 border border-amber-500/30">
                                Parcial
                              </span>
                            )}
                            {inv.status === 'pending' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-950/60 text-blue-400 border border-blue-500/30">
                                A Vencer
                              </span>
                            )}
                            {inv.status === 'overdue' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-950/60 text-red-400 border border-red-500/30">
                                Vencido
                              </span>
                            )}
                            {inv.status === 'canceled' && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                                Cancelado
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {inv.balance > 0 && inv.status !== 'canceled' && (
                                <button
                                  onClick={() => handleOpenSettleModal(inv)}
                                  title="Registrar pagamento ou baixa parcial"
                                  className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                                >
                                  Dar Baixa
                                </button>
                              )}

                              {inv.pixCode && (
                                <button
                                  onClick={() => setSelectedInvoiceForPix(inv)}
                                  title="Ver PIX Copia e Cola / QR Code"
                                  className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                                >
                                  <QrCode className="h-3.5 w-3.5" />
                                </button>
                              )}

                              {inv.status !== 'canceled' && inv.balance > 0 && (
                                <button
                                  onClick={() => setReminderModalInvoice(inv)}
                                  title="Enviar lembrete de cobrança por e-mail"
                                  className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                                >
                                  <Mail className="h-3.5 w-3.5 text-blue-400" />
                                </button>
                              )}

                              {inv.paidAmount > 0 && (
                                <button
                                  onClick={() => setSelectedInvoiceForReceipt(inv)}
                                  title="Visualizar Recibo"
                                  className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                                >
                                  <Printer className="h-3.5 w-3.5 text-purple-400" />
                                </button>
                              )}

                              {inv.status !== 'canceled' && inv.paidAmount === 0 && (
                                <button
                                  onClick={() => handleCancelInvoice(inv)}
                                  title="Cancelar cobrança"
                                  className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-red-400 cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 3: RECEITAS & DESPESAS EXTRAS                              */}
      {/* ============================================================== */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-semibold">Tipo:</span>
                <select
                  value={transactionTypeFilter}
                  onChange={(e) => setTransactionTypeFilter(e.target.value as any)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white focus:outline-none focus:border-red-500"
                >
                  <option value="all">Todas as Movimentações</option>
                  <option value="income">Somente Receitas Extras</option>
                  <option value="expense">Somente Despesas</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-semibold">Categoria:</span>
                <select
                  value={transactionCategoryFilter}
                  onChange={(e) => setTransactionCategoryFilter(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white focus:outline-none focus:border-red-500"
                >
                  <option value="all">Todas as Categorias</option>
                  <option value="competition">Competição</option>
                  <option value="merchandise">Material / Quimono</option>
                  <option value="exam">Exame de Graduação</option>
                  <option value="event">Seminário / Evento</option>
                  <option value="administrative">Taxa Administrativa</option>
                  <option value="facilities">Manutenção / Espaço</option>
                  <option value="payroll">Honorários</option>
                </select>
              </div>
            </div>

            <button
              onClick={() => setIsTransactionModalOpen(true)}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Novo Lançamento</span>
            </button>
          </div>

          {filteredTransactions.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-950/40 space-y-2">
              <ShoppingBag className="h-8 w-8 text-slate-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-300">Nenhuma movimentação extra encontrada</div>
              <p className="text-xs text-slate-500">
                Cadastre taxas de inscrição em campeonatos, vendas de quimonos ou despesas operacionais da academia.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Tipo</th>
                      <th className="py-3 px-3">Categoria</th>
                      <th className="py-3 px-4">Descrição</th>
                      <th className="py-3 px-3">Aluno / Turma Vinculada</th>
                      <th className="py-3 px-3">Competência</th>
                      <th className="py-3 px-3 text-right">Valor</th>
                      <th className="py-3 px-3 text-center">Situação</th>
                      <th className="py-3 px-4 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredTransactions.map((t) => {
                      const { person } = getStudentAndPerson(t.studentId);
                      const classObj = getClassObj(t.classGroupId);

                      return (
                        <tr key={t.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                t.type === 'income'
                                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-red-950/60 text-red-400 border border-red-500/30'
                              }`}
                            >
                              {t.type === 'income' ? 'Receita Extra' : 'Despesa'}
                            </span>
                          </td>

                          <td className="py-3 px-3 text-slate-300 capitalize">
                            {t.category === 'competition' && 'Competição'}
                            {t.category === 'merchandise' && 'Material / Quimono'}
                            {t.category === 'exam' && 'Exame de Faixa'}
                            {t.category === 'event' && 'Evento / Seminário'}
                            {t.category === 'administrative' && 'Administrativo'}
                            {t.category === 'facilities' && 'Manutenção'}
                            {t.category === 'payroll' && 'Honorários'}
                            {t.category === 'other' && 'Outro'}
                          </td>

                          <td className="py-3 px-4">
                            <div className="font-semibold text-white">{t.description}</div>
                            {t.notes && <div className="text-[11px] text-slate-400 italic mt-0.5">{t.notes}</div>}
                          </td>

                          <td className="py-3 px-3 text-slate-300">
                            {person ? (
                              <span className="font-semibold text-white">{person.fullName}</span>
                            ) : classObj ? (
                              <span>Turma {classObj.name}</span>
                            ) : (
                              <span className="text-slate-500">Geral da Academia</span>
                            )}
                          </td>

                          <td className="py-3 px-3 font-mono text-slate-300">{t.competence}</td>

                          <td className="py-3 px-3 text-right font-mono font-bold">
                            <span className={t.type === 'income' ? 'text-emerald-400' : 'text-red-400'}>
                              {t.type === 'income' ? '+' : '-'}{formatCurrencyBRL(t.amount)}
                            </span>
                          </td>

                          <td className="py-3 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                t.status === 'completed'
                                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                                  : t.status === 'pending'
                                  ? 'bg-amber-950/60 text-amber-400 border border-amber-500/30'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {t.status === 'completed' ? 'Concluído' : t.status === 'pending' ? 'Pendente' : 'Cancelado'}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-right">
                            {t.status !== 'canceled' && (
                              <button
                                onClick={() => handleCancelTransaction(t)}
                                title="Cancelar lançamento"
                                className="text-slate-400 hover:text-red-400 transition-colors p-1 cursor-pointer"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 4: CONFIGURAÇÃO DE PLANOS DE MENSALIDADE                   */}
      {/* ============================================================== */}
      {activeTab === 'plans' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-red-500" />
              <div>
                <h3 className="text-sm font-bold text-white">Planos e Políticas de Cobrança do Dojo</h3>
                <p className="text-xs text-slate-400">
                  Configure os valores de referência para matrícula de novos alunos e geração em lote de mensalidades.
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                setEditingPlan(null);
                setIsPlanModalOpen(true);
              }}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Cadastrar Novo Plano</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map((plan) => {
              const enrolledWithPlan = students.filter((s) => s.monthlyFee === plan.amount).length;

              return (
                <div
                  key={plan.id}
                  className={`p-5 rounded-2xl border transition-all ${
                    plan.active
                      ? 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                      : 'border-slate-800/60 bg-slate-950/40 opacity-75'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <h4 className="text-sm font-bold text-white">{plan.name}</h4>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        Periodicidade: {plan.frequency === 'monthly' ? 'Mensal' : plan.frequency}
                      </span>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        plan.active
                          ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {plan.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>

                  <div className="my-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Valor Base:</span>
                      <span className="text-base font-bold text-white font-mono">{formatCurrencyBRL(plan.amount)}</span>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Vencimento Padrão:</span>
                      <span className="font-semibold text-white">Dia {plan.dueDay} de cada mês</span>
                    </div>
                    {plan.discountPercentage ? (
                      <div className="flex items-center justify-between py-1 border-b border-slate-800/60 text-emerald-400">
                        <span>Desconto Pontualidade:</span>
                        <span className="font-semibold">{plan.discountPercentage}% off</span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Alunos com esta mensalidade:</span>
                      <span className="font-semibold text-slate-200">{enrolledWithPlan} aluno(s)</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-end gap-2 text-xs">
                    <button
                      onClick={() => handleTogglePlan(plan)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                      {plan.active ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingPlan(plan);
                        setIsPlanModalOpen(true);
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                      <Edit2 className="h-3.5 w-3.5 text-blue-400" />
                      <span>Editar</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL DE BAIXA / REGISTRO DE PAGAMENTO                         */}
      {/* ============================================================== */}
      {settlingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200 text-xs">
            <button
              onClick={() => setSettlingInvoice(null)}
              disabled={isSubmittingPayment}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2 mb-3 text-emerald-400">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <h3 className="text-base font-bold text-white">Registrar Pagamento de Cobrança</h3>
            </div>

            <p className="text-slate-400 mb-3">
              Informe o valor recebido e a forma de pagamento para atualizar o saldo do aluno.
            </p>

            <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/60 mb-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Aluno:</span>
                <span className="font-bold text-white">
                  {getStudentAndPerson(settlingInvoice.studentId).person?.fullName || 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Competência:</span>
                <span className="font-mono text-slate-300">{settlingInvoice.competence}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Saldo Atual Devedor:</span>
                <span className="font-mono font-bold text-red-400">{formatCurrencyBRL(settlingInvoice.balance)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Valor do Pagamento (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={settlingInvoice.balance}
                  value={settleAmount}
                  onChange={(e) => setSettleAmount(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white font-mono font-bold text-sm focus:outline-none focus:border-red-500"
                />
                {settleAmount < settlingInvoice.balance && (
                  <span className="text-[11px] text-amber-400 mt-1 block">
                    Pagamento parcial: o saldo remanescente será de {formatCurrencyBRL(settlingInvoice.balance - settleAmount)}.
                  </span>
                )}
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Forma de Pagamento</label>
                <select
                  value={settleMethod}
                  onChange={(e) => setSettleMethod(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500"
                >
                  <option value="pix">PIX Instantâneo</option>
                  <option value="cash">Dinheiro em Espécie</option>
                  <option value="credit_card">Cartão de Crédito / Débito</option>
                  <option value="boleto">Boleto Bancário</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Observações do Recibo (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ex: Pago na recepção em dinheiro..."
                  value={settleNotes}
                  onChange={(e) => setSettleNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSettlingInvoice(null)}
                disabled={isSubmittingPayment}
                className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmSettle}
                disabled={isSubmittingPayment || settleAmount <= 0}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow cursor-pointer disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                <span>{isSubmittingPayment ? 'Registrando...' : 'Confirmar Baixa'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL DE PIX / QR CODE                                         */}
      {/* ============================================================== */}
      {selectedInvoiceForPix && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200 text-xs">
            <button
              onClick={() => setSelectedInvoiceForPix(null)}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2 mb-3 text-emerald-400">
              <QrCode className="h-5 w-5" />
              <h3 className="text-base font-bold text-white">Chave PIX Copia e Cola</h3>
            </div>

            <p className="text-slate-400 mb-3">
              Utilize o código abaixo no aplicativo do seu banco para pagamento instantâneo da mensalidade.
            </p>

            <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/70 mb-3 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-400">Aluno:</span>
                <span className="font-bold text-white">
                  {getStudentAndPerson(selectedInvoiceForPix.studentId).person?.fullName || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Competência:</span>
                <span className="font-mono text-slate-300">{selectedInvoiceForPix.competence}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Valor a Pagar:</span>
                <span className="font-mono font-bold text-emerald-400">{formatCurrencyBRL(selectedInvoiceForPix.balance)}</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 break-all font-mono text-[11px] text-slate-300 max-h-32 overflow-y-auto">
              {selectedInvoiceForPix.pixCode || 'Código PIX não disponível.'}
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 mt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => handleCopyPix(selectedInvoiceForPix.pixCode)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold shadow cursor-pointer"
              >
                {copiedPix ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                <span>{copiedPix ? 'Chave Copiada!' : 'Copiar Código PIX'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL DE RECIBO DE PAGAMENTO                                   */}
      {/* ============================================================== */}
      {selectedInvoiceForReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200 text-xs">
            <button
              onClick={() => setSelectedInvoiceForReceipt(null)}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Comprovante de Quitação</h3>
                <span className="text-[11px] text-slate-400">{tenant.tradeName}</span>
              </div>
              <span className="px-2.5 py-1 rounded-lg font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-500/30">
                {selectedInvoiceForReceipt.receiptNumber || 'REC-QUITADO'}
              </span>
            </div>

            <div className="space-y-3 p-4 rounded-xl border border-slate-800 bg-slate-950/50 mb-4">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Aluno:</span>
                <span className="font-bold text-white">
                  {getStudentAndPerson(selectedInvoiceForReceipt.studentId).person?.fullName || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Competência:</span>
                <span className="font-mono text-slate-200">{selectedInvoiceForReceipt.competence}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Valor Pago:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {formatCurrencyBRL(selectedInvoiceForReceipt.paidAmount)}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Data de Liquidação:</span>
                <span className="font-mono text-slate-200">
                  {selectedInvoiceForReceipt.paymentDate ? formatDateBR(selectedInvoiceForReceipt.paymentDate) : 'Confirmado'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Meio de Pagamento:</span>
                <span className="font-semibold text-white uppercase">
                  {selectedInvoiceForReceipt.paymentMethod || 'PIX'}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-200 hover:text-white cursor-pointer"
              >
                <Printer className="h-4 w-4" />
                <span>Imprimir Recibo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE ENVIO DE COBRANÇA POR E-MAIL */}
      <EmailReminderModal
        isOpen={Boolean(reminderModalInvoice)}
        onClose={() => setReminderModalInvoice(null)}
        invoice={reminderModalInvoice}
        student={reminderModalInvoice ? getStudentAndPerson(reminderModalInvoice.studentId).student : null}
        studentPerson={reminderModalInvoice ? getStudentAndPerson(reminderModalInvoice.studentId).person : null}
        guardianPerson={reminderModalInvoice ? getGuardianPerson(reminderModalInvoice.financialGuardianId) : null}
        tenantName={tenant.tradeName}
        onSend={handleSendReminder}
      />

      {/* MODAL DE GERAÇÃO EM LOTE */}
      <GenerateInvoicesModal
        isOpen={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
        onGenerate={async (params) => {
          const res = await financialService.generateInvoicesForCompetence({
            tenantId: tenant.id,
            branchId: selectedBranchId,
            competence: params.competence,
            dueDay: params.dueDay,
            planId: params.planId,
            classGroupId: params.classGroupId,
            students,
            enrollments: [],
            plans,
            familyDiscountPercentage: tenant.settings.familyDiscount2ndMember || 15,
            currentUserName: currentUser.name,
          });
          await loadFinancialData();
          return res;
        }}
        students={students}
        classes={classes}
        plans={plans}
        existingInvoices={invoices}
        currentCompetence={selectedCompetence !== 'all' ? selectedCompetence : '11/2026'}
      />

      {/* MODAL DE FORMULÁRIO DE PLANO */}
      <PlanFormModal
        isOpen={isPlanModalOpen}
        onClose={() => {
          setIsPlanModalOpen(false);
          setEditingPlan(null);
        }}
        onSave={handleSavePlan}
        planToEdit={editingPlan}
        branches={branches}
        currentBranchId={selectedBranchId !== 'all' ? selectedBranchId : undefined}
        tenantId={tenant.id}
      />

      {/* MODAL DE FORMULÁRIO DE TRANSAÇÃO EXTRA */}
      <TransactionFormModal
        isOpen={isTransactionModalOpen}
        onClose={() => setIsTransactionModalOpen(false)}
        onSaveIndividual={handleSaveTransaction}
        onSaveBatch={handleSaveBatchTransactions}
        students={students}
        persons={persons}
        classes={classes}
        tenantId={tenant.id}
        currentCompetence={selectedCompetence !== 'all' ? selectedCompetence : '10/2026'}
        currentUserName={currentUser.name}
      />
    </div>
  );
};
