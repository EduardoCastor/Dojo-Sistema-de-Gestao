import React, { useState, useMemo } from 'react';
import {
  ShieldAlert,
  Building2,
  DollarSign,
  Users,
  Clock,
  Sparkles,
  CheckCircle2,
  XCircle,
  Edit2,
  Save,
  Check,
  Search,
  AlertTriangle,
  FileText,
  CreditCard,
  Plus,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  X,
  Sliders,
  Calendar,
  Lock,
  ArrowRight,
  TrendingUp,
  Receipt,
  History,
  QrCode,
  Copy,
  Info,
} from 'lucide-react';
import {
  Tenant,
  SaaSPlan,
  User,
  SaaSCommercialPlan,
  SaaSSubscription,
  SaaSPayment,
  PlatformAuditLog,
} from '../../types';
import { formatCurrencyBRL, formatDateBR } from '../../utils/formatters';
import { saasPlatformService, PlatformMetrics } from '../../services/saasPlatformService';
import { DataStore } from '../../data/storage';

interface PlatformAdminViewProps {
  tenants: Tenant[];
  plans: SaaSPlan[];
  currentUser: User;
  onUpdatePlans: (updatedPlans: SaaSPlan[]) => void;
  onUpdateTenantStatus: (tenantId: string, status: Tenant['status']) => void;
  onSwitchTenant: (tenantId: string) => void;
  onBackToApp?: () => void;
}

export type PlatformTab =
  | 'overview'
  | 'tenants'
  | 'plans'
  | 'subscriptions'
  | 'payments'
  | 'overdue'
  | 'audit'
  | 'gateway';

export const PlatformAdminView: React.FC<PlatformAdminViewProps> = ({
  tenants,
  plans,
  currentUser,
  onUpdatePlans,
  onUpdateTenantStatus,
  onSwitchTenant,
  onBackToApp,
}) => {
  const [activeTab, setActiveTab] = useState<PlatformTab>('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [tenantFilterStatus, setTenantFilterStatus] = useState<string>('all');
  const [tenantFilterPlan, setTenantFilterPlan] = useState<string>('all');

  // Subscriptions & Commercial Plans state
  const [commercialPlans, setCommercialPlans] = useState<SaaSCommercialPlan[]>(() =>
    DataStore.getCommercialPlans()
  );
  const [subscriptions, setSubscriptions] = useState<SaaSSubscription[]>(() =>
    DataStore.getSaaSSubscriptions()
  );
  const [payments, setPayments] = useState<SaaSPayment[]>(() => DataStore.getSaaSPayments());
  const [auditLogs, setAuditLogs] = useState<PlatformAuditLog[]>(() =>
    DataStore.getPlatformAuditLogs()
  );

  // Modals state
  const [selectedTenantForDetails, setSelectedTenantForDetails] = useState<Tenant | null>(null);
  const [tenantModalTab, setTenantModalTab] = useState<'info' | 'subscription' | 'payments' | 'audit'>('info');

  const [tenantToSuspend, setTenantToSuspend] = useState<Tenant | null>(null);
  const [suspensionReason, setSuspensionReason] = useState('');
  const [isSubmittingSuspension, setIsSubmittingSuspension] = useState(false);

  const [tenantToReactivate, setTenantToReactivate] = useState<Tenant | null>(null);
  const [reactivationReason, setReactivationReason] = useState('');

  const [tenantToChangePlan, setTenantToChangePlan] = useState<Tenant | null>(null);
  const [targetNewPlanId, setTargetNewPlanId] = useState<string>('advanced');
  const [changePlanReason, setChangePlanReason] = useState('');

  const [subToManualActivate, setSubToManualActivate] = useState<SaaSSubscription | null>(null);
  const [manualActivateDays, setManualActivateDays] = useState<number>(30);
  const [manualActivateReason, setManualActivateReason] = useState('');

  const [isNewPlanModalOpen, setIsNewPlanModalOpen] = useState(false);
  const [newPlanForm, setNewPlanForm] = useState<Partial<SaaSCommercialPlan>>({
    id: '',
    name: '',
    description: '',
    tagline: '',
    price: 199,
    currency: 'BRL',
    billingCycle: 'monthly',
    trialDays: 0,
    maxStudents: 150,
    maxBranches: 2,
    maxStorageGb: 15,
    features: {
      digitalLibrary: true,
      beltExams: true,
      competitions: false,
      advancedReports: true,
      multiBranch: true,
      customBranding: false,
      automatedNotifications: true,
    },
    active: true,
  });

  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const showFeedback = (msg: string) => {
    setActionSuccessMsg(msg);
    setTimeout(() => setActionSuccessMsg(null), 3500);
  };

  // Metrics calculations
  const metrics: PlatformMetrics = useMemo(() => {
    const totalTenants = tenants.length;
    const activeSubscriptions = subscriptions.filter(s => s.status === 'active').length;
    const trialSubscriptions = subscriptions.filter(s => s.status === 'trial').length;
    const pastDueSubscriptions = subscriptions.filter(s => s.status === 'past_due').length;
    const suspendedTenants = tenants.filter(t => t.status === 'suspended').length;
    const canceledSubscriptions = subscriptions.filter(s => s.status === 'canceled').length;

    const estimatedMRR = subscriptions
      .filter(s => s.status === 'active')
      .reduce((acc, sub) => acc + (sub.amount || 0), 0);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const confirmedRevenueMonth = payments
      .filter(p => {
        if (p.status !== 'paid' || !p.paidAt) return false;
        const d = new Date(p.paidAt);
        return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
      })
      .reduce((acc, p) => acc + (p.amount || 0), 0);

    const confirmedRevenueTotal = payments
      .filter(p => p.status === 'paid')
      .reduce((acc, p) => acc + (p.amount || 0), 0);

    return {
      totalTenants,
      activeSubscriptions,
      trialSubscriptions,
      pastDueSubscriptions,
      suspendedTenants,
      canceledSubscriptions,
      estimatedMRR,
      confirmedRevenueMonth,
      confirmedRevenueTotal,
    };
  }, [tenants, subscriptions, payments]);

  // Filtered tenants
  const filteredTenants = useMemo(() => {
    return tenants.filter(t => {
      const matchSearch =
        t.tradeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.adminName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.cnpjOrCpf.includes(searchTerm) ||
        t.email.toLowerCase().includes(searchTerm.toLowerCase());

      const matchStatus =
        tenantFilterStatus === 'all' ? true : t.status === tenantFilterStatus;

      const matchPlan =
        tenantFilterPlan === 'all' ? true : t.planId === tenantFilterPlan;

      return matchSearch && matchStatus && matchPlan;
    });
  }, [tenants, searchTerm, tenantFilterStatus, tenantFilterPlan]);

  // Actions
  const handleConfirmSuspension = async () => {
    if (!tenantToSuspend) return;
    if (!suspensionReason.trim() || suspensionReason.trim().length < 5) {
      alert('Por favor informe uma justificativa com no mínimo 5 caracteres.');
      return;
    }
    setIsSubmittingSuspension(true);
    try {
      await saasPlatformService.suspendTenant(
        tenantToSuspend.id,
        suspensionReason,
        currentUser.id,
        currentUser.name
      );
      onUpdateTenantStatus(tenantToSuspend.id, 'suspended');
      setSubscriptions(DataStore.getSaaSSubscriptions());
      setAuditLogs(DataStore.getPlatformAuditLogs());
      setTenantToSuspend(null);
      setSuspensionReason('');
      showFeedback(`Academia "${tenantToSuspend.tradeName}" suspensa com sucesso.`);
    } catch (err: any) {
      alert(err.message || 'Erro ao suspender academia.');
    } finally {
      setIsSubmittingSuspension(false);
    }
  };

  const handleConfirmReactivation = async () => {
    if (!tenantToReactivate) return;
    try {
      await saasPlatformService.reactivateTenant(
        tenantToReactivate.id,
        reactivationReason || 'Reativação solicitada pelo administrador',
        currentUser.id,
        currentUser.name
      );
      onUpdateTenantStatus(tenantToReactivate.id, 'active');
      setSubscriptions(DataStore.getSaaSSubscriptions());
      setAuditLogs(DataStore.getPlatformAuditLogs());
      setTenantToReactivate(null);
      setReactivationReason('');
      showFeedback(`Academia "${tenantToReactivate.tradeName}" reativada com sucesso.`);
    } catch (err: any) {
      alert(err.message || 'Erro ao reativar academia.');
    }
  };

  const handleConfirmChangePlan = async () => {
    if (!tenantToChangePlan) return;
    try {
      await saasPlatformService.changeTenantPlan(
        tenantToChangePlan.id,
        targetNewPlanId,
        changePlanReason || 'Upgrade administrativo',
        currentUser.id,
        currentUser.name
      );
      tenantToChangePlan.planId = targetNewPlanId as any;
      setSubscriptions(DataStore.getSaaSSubscriptions());
      setAuditLogs(DataStore.getPlatformAuditLogs());
      setTenantToChangePlan(null);
      setChangePlanReason('');
      showFeedback(`Plano da academia "${tenantToChangePlan.tradeName}" atualizado para [${targetNewPlanId}].`);
    } catch (err: any) {
      alert(err.message || 'Erro ao alterar plano.');
    }
  };

  const handleConfirmManualActivation = async () => {
    if (!subToManualActivate) return;
    if (!manualActivateReason.trim() || manualActivateReason.trim().length < 5) {
      alert('Informe uma justificativa formal com no mínimo 5 caracteres para a ativação manual.');
      return;
    }
    try {
      await saasPlatformService.manualActivateSubscription(
        subToManualActivate.id,
        manualActivateReason,
        manualActivateDays,
        currentUser.id,
        currentUser.name
      );
      onUpdateTenantStatus(subToManualActivate.tenantId, 'active');
      setSubscriptions(DataStore.getSaaSSubscriptions());
      setAuditLogs(DataStore.getPlatformAuditLogs());
      setSubToManualActivate(null);
      setManualActivateReason('');
      showFeedback(`Assinatura ativada manualmente por ${manualActivateDays} dias.`);
    } catch (err: any) {
      alert(err.message || 'Erro ao ativar manualmente.');
    }
  };

  const handleCreateCommercialPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlanForm.name || !newPlanForm.price) {
      alert('Nome e preço são obrigatórios.');
      return;
    }
    const slug =
      newPlanForm.id ||
      'plan-' + newPlanForm.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

    const created: SaaSCommercialPlan = {
      id: slug,
      name: newPlanForm.name,
      description: newPlanForm.description || '',
      tagline: newPlanForm.tagline || '',
      price: Number(newPlanForm.price),
      currency: 'BRL',
      billingCycle: newPlanForm.billingCycle || 'monthly',
      cycleMultiplier: 1,
      trialDays: Number(newPlanForm.trialDays || 0),
      maxStudents: Number(newPlanForm.maxStudents || 100),
      maxBranches: Number(newPlanForm.maxBranches || 1),
      maxStorageGb: Number(newPlanForm.maxStorageGb || 10),
      features: newPlanForm.features || {
        digitalLibrary: false,
        beltExams: false,
        competitions: false,
        advancedReports: false,
        multiBranch: false,
        customBranding: false,
        automatedNotifications: false,
      },
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saasPlatformService.savePlan(created, currentUser.id, currentUser.name);
    setCommercialPlans(DataStore.getCommercialPlans());
    setAuditLogs(DataStore.getPlatformAuditLogs());
    setIsNewPlanModalOpen(false);
    showFeedback(`Plano comercial "${created.name}" criado com sucesso.`);
  };

  const handleTogglePlanActive = async (plan: SaaSCommercialPlan) => {
    const updated = { ...plan, active: !plan.active };
    await saasPlatformService.savePlan(updated, currentUser.id, currentUser.name);
    setCommercialPlans(DataStore.getCommercialPlans());
    setAuditLogs(DataStore.getPlatformAuditLogs());
    showFeedback(`Plano "${plan.name}" agora está ${updated.active ? 'Ativo' : 'Inativo'}.`);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Platform Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider bg-amber-950/70 px-2 py-0.5 rounded border border-amber-500/30">
              Console Central da Plataforma
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-400">Administrador Global SaaS</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            TatameHub Platform Owner
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Gestão multi-tenant das academias clientes, planos comerciais, assinaturas recorrentes e controle de acesso.
          </p>
        </div>

        {actionSuccessMsg && (
          <div className="bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 animate-fadeIn">
            <Check className="h-4 w-4 text-emerald-400" />
            <span>{actionSuccessMsg}</span>
          </div>
        )}
      </div>

      {/* Primary KPI Strip - Real calculated values */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400 font-medium">Academias Clientes</div>
          <div className="text-2xl font-bold text-white font-mono tabular-nums mt-1">
            {metrics.totalTenants}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            {metrics.activeSubscriptions} ativas · {metrics.trialSubscriptions} em teste
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400 font-medium">Em Degustação (10d)</div>
          <div className="text-2xl font-bold text-amber-400 font-mono tabular-nums mt-1">
            {metrics.trialSubscriptions}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">Período de avaliação</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400 font-medium">Inadimplentes / Atraso</div>
          <div className="text-2xl font-bold text-rose-400 font-mono tabular-nums mt-1">
            {metrics.pastDueSubscriptions}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">Carência de 5 dias</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400 font-medium">Academias Suspensas</div>
          <div className="text-2xl font-bold text-slate-300 font-mono tabular-nums mt-1">
            {metrics.suspendedTenants}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">Dados preservados</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400 font-medium">MRR Recorrente Ativo</div>
          <div className="text-xl font-bold text-emerald-400 font-mono tabular-nums mt-1">
            {formatCurrencyBRL(metrics.estimatedMRR)}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">Apenas planos pagos ativos</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400 font-medium">Recebido no Mês</div>
          <div className="text-xl font-bold text-blue-400 font-mono tabular-nums mt-1">
            {formatCurrencyBRL(metrics.confirmedRevenueMonth)}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">Receita real confirmada</div>
        </div>
      </div>

      {/* Navigation Tabs (8 Dedicated Sections) */}
      <div className="flex border-b border-slate-800 text-xs font-semibold overflow-x-auto gap-1">
        {[
          { id: 'overview', label: 'Visão Geral', icon: TrendingUp },
          { id: 'tenants', label: `Academias Clientes (${tenants.length})`, icon: Building2 },
          { id: 'plans', label: `Planos Comerciais (${commercialPlans.length})`, icon: Sparkles },
          { id: 'subscriptions', label: `Assinaturas (${subscriptions.length})`, icon: Receipt },
          { id: 'payments', label: `Pagamentos (${payments.length})`, icon: DollarSign },
          { id: 'overdue', label: `Inadimplência (${metrics.pastDueSubscriptions})`, icon: AlertTriangle },
          { id: 'audit', label: 'Auditoria da Plataforma', icon: History },
          { id: 'gateway', label: 'Gateway & Webhooks', icon: CreditCard },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as PlatformTab)}
              className={`flex items-center gap-2 py-3 px-3.5 border-b-2 cursor-pointer transition-colors whitespace-nowrap ${
                isActive
                  ? 'border-red-500 text-white font-bold bg-slate-900/30'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: VISÃO GERAL (OVERVIEW) */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Status breakdown */}
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-red-500" />
                  <span>Distribuição das Academias</span>
                </h3>
                <span className="text-xs text-slate-500">{tenants.length} dojos totais</span>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    <span className="text-slate-300">Assinaturas Ativas e Regulares</span>
                  </div>
                  <span className="font-mono font-bold text-white">{metrics.activeSubscriptions}</span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                    <span className="text-slate-300">Degustação Gratuita (10 dias)</span>
                  </div>
                  <span className="font-mono font-bold text-white">{metrics.trialSubscriptions}</span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                    <span className="text-slate-300">Atraso na Mensalidade (Carência)</span>
                  </div>
                  <span className="font-mono font-bold text-white">{metrics.pastDueSubscriptions}</span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
                    <span className="text-slate-300">Suspensas Administrativamente</span>
                  </div>
                  <span className="font-mono font-bold text-white">{metrics.suspendedTenants}</span>
                </div>
              </div>
            </div>

            {/* Financial summary */}
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                  <span>Saúde Financeira do SaaS</span>
                </h3>
                <span className="text-xs text-slate-500">Conciliação real</span>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-slate-400 text-[11px]">Receita Recorrente Mensal (MRR)</div>
                    <div className="text-xl font-bold text-emerald-400 font-mono mt-0.5">
                      {formatCurrencyBRL(metrics.estimatedMRR)}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-slate-500">
                    <div>Base ativa: {metrics.activeSubscriptions} contratos</div>
                    <div>Ticket médio: {metrics.activeSubscriptions > 0 ? formatCurrencyBRL(metrics.estimatedMRR / metrics.activeSubscriptions) : 'R$ 0,00'}</div>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-slate-400 text-[11px]">Receita Confirmada no Mês Atual</div>
                    <div className="text-xl font-bold text-blue-400 font-mono mt-0.5">
                      {formatCurrencyBRL(metrics.confirmedRevenueMonth)}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-slate-500">
                    <div>Total histórico: {formatCurrencyBRL(metrics.confirmedRevenueTotal)}</div>
                    <div>Status: Conciliado via Gateway</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick action shortcuts */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/40">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
              Ações Rápidas de Administração
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <button
                onClick={() => setActiveTab('tenants')}
                className="p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-left transition-colors flex items-center justify-between cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-white">Consultar Dojos</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Ver academias, alterar planos e acessos</div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </button>

              <button
                onClick={() => {
                  setActiveTab('plans');
                  setIsNewPlanModalOpen(true);
                }}
                className="p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-left transition-colors flex items-center justify-between cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-white">Criar Novo Plano</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Definir limites e precificação comercial</div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </button>

              <button
                onClick={() => setActiveTab('overdue')}
                className="p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-left transition-colors flex items-center justify-between cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-white">Gerenciar Inadimplência</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{metrics.pastDueSubscriptions} academias em atraso</div>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-500" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ACADEMIAS CLIENTES (TENANTS) */}
      {activeTab === 'tenants' && (
        <div className="space-y-4">
          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome, responsável, CNPJ ou e-mail..."
                className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={tenantFilterStatus}
                onChange={e => setTenantFilterStatus(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300 focus:outline-none"
              >
                <option value="all">Todos os Status</option>
                <option value="active">Ativa</option>
                <option value="trial">Em Teste</option>
                <option value="suspended">Suspensa</option>
                <option value="canceled">Cancelada</option>
              </select>

              <select
                value={tenantFilterPlan}
                onChange={e => setTenantFilterPlan(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300 focus:outline-none"
              >
                <option value="all">Todos os Planos</option>
                <option value="trial">Trial</option>
                <option value="basic">Básico</option>
                <option value="advanced">Avançado</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
          </div>

          {/* Tenants Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Academia / Dojô</th>
                    <th className="py-3 px-4">Responsável</th>
                    <th className="py-3 px-4">Plano Contratado</th>
                    <th className="py-3 px-4">Status & Acesso</th>
                    <th className="py-3 px-4">Cidade / UF</th>
                    <th className="py-3 px-4 text-right">Ações Administrativas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredTenants.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        Nenhuma academia encontrada com os filtros informados.
                      </td>
                    </tr>
                  ) : (
                    filteredTenants.map(t => {
                      const commPlan = commercialPlans.find(p => p.id === t.planId);
                      const sub = subscriptions.find(s => s.tenantId === t.id);
                      const isSuspended = t.status === 'suspended' || sub?.status === 'suspended';
                      const isTrial = t.status === 'trial' || sub?.status === 'trial';

                      return (
                        <tr key={t.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-bold text-white flex items-center gap-2">
                              <span>{t.tradeName}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              CNPJ: {t.cnpjOrCpf} · ID: {t.id}
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="text-slate-200">{t.adminName}</div>
                            <div className="text-[10px] text-slate-500">{t.email}</div>
                          </td>

                          <td className="py-3 px-4">
                            <span className="font-semibold text-slate-300">
                              {commPlan?.name || t.planId.toUpperCase()}
                            </span>
                            <span className="block text-[10px] text-slate-500">
                              {commPlan?.price === 0
                                ? 'Degustação (R$ 0)'
                                : formatCurrencyBRL(commPlan?.price || sub?.amount || 0) + '/mês'}
                            </span>
                          </td>

                          <td className="py-3 px-4">
                            {isSuspended ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-950/60 text-rose-400 border border-rose-500/30">
                                <XCircle className="h-3 w-3" />
                                <span>Acesso Suspenso</span>
                              </span>
                            ) : isTrial ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950/60 text-amber-400 border border-amber-500/30">
                                <Clock className="h-3 w-3" />
                                <span>Teste 10 Dias</span>
                              </span>
                            ) : sub?.status === 'past_due' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-orange-950/60 text-orange-400 border border-orange-500/30">
                                <AlertTriangle className="h-3 w-3" />
                                <span>Atrasado (Carência)</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Assinatura Ativa</span>
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-slate-400">
                            {t.address.city}/{t.address.state}
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => {
                                  setSelectedTenantForDetails(t);
                                  setTenantModalTab('info');
                                }}
                                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition-colors cursor-pointer"
                                title="Ver ficha cadastral e histórico"
                              >
                                Detalhes
                              </button>

                              <button
                                onClick={() => {
                                  setTenantToChangePlan(t);
                                  setTargetNewPlanId(t.planId);
                                }}
                                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition-colors cursor-pointer"
                                title="Alterar plano comercial"
                              >
                                Mudar Plano
                              </button>

                              {isSuspended ? (
                                <button
                                  onClick={() => setTenantToReactivate(t)}
                                  className="px-2.5 py-1 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30 text-[11px] font-semibold transition-colors cursor-pointer"
                                >
                                  Reativar
                                </button>
                              ) : (
                                <button
                                  onClick={() => setTenantToSuspend(t)}
                                  className="px-2.5 py-1 rounded bg-rose-950/60 text-rose-400 hover:bg-rose-900/60 border border-rose-500/30 text-[11px] font-semibold transition-colors cursor-pointer"
                                >
                                  Suspender
                                </button>
                              )}

                              <button
                                onClick={() => onSwitchTenant(t.id)}
                                className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1"
                                title="Acessar Dojo no papel de Administrador"
                              >
                                <span>Acessar</span>
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PLANOS COMERCIAIS DO SAAS (PLANS) */}
      {activeTab === 'plans' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Catálogo de Planos Comerciais do TatameHub</h3>
              <p className="text-xs text-slate-400">
                Planos oferecidos para contratação por academias e centros de treinamento de artes marciais.
              </p>
            </div>
            <button
              onClick={() => setIsNewPlanModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-xs transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Novo Plano Comercial</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {commercialPlans.map(plan => (
              <div
                key={plan.id}
                className={`p-5 rounded-2xl border transition-all flex flex-col justify-between ${
                  plan.active
                    ? 'border-slate-800 bg-slate-900/60'
                    : 'border-slate-800/40 bg-slate-900/20 opacity-75'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-white text-base">{plan.name}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        plan.active
                          ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {plan.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mb-3">{plan.tagline}</div>

                  <div className="my-3 pb-3 border-b border-slate-800">
                    <div className="text-2xl font-bold font-mono text-white">
                      {plan.price === 0 ? 'Gratuito' : formatCurrencyBRL(plan.price)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {plan.price === 0 ? `${plan.trialDays} dias de degustação` : 'Por mês recorrente'}
                    </div>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-300">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Limite de Alunos:</span>
                      <strong className="text-white font-mono">{plan.maxStudents}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Limite de Filiais:</span>
                      <strong className="text-white font-mono">{plan.maxBranches}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Armazenamento:</span>
                      <strong className="text-white font-mono">{plan.maxStorageGb} GB</strong>
                    </div>
                  </div>

                  <div className="pt-3 mt-3 border-t border-slate-800 space-y-1 text-[11px] text-slate-400">
                    <div className="font-semibold text-slate-300 mb-1">Módulos Inclusos:</div>
                    <div>Biblioteca Digital: {plan.features.digitalLibrary ? '✅ Sim' : '❌ Não'}</div>
                    <div>Exames de Faixa: {plan.features.beltExams ? '✅ Sim' : '❌ Não'}</div>
                    <div>Competições: {plan.features.competitions ? '✅ Sim' : '❌ Não'}</div>
                    <div>Multi-Filiais: {plan.features.multiBranch ? '✅ Sim' : '❌ Não'}</div>
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-slate-800 flex items-center justify-end gap-2">
                  <button
                    onClick={() => handleTogglePlanActive(plan)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      plan.active
                        ? 'bg-slate-800 text-slate-300 hover:text-white'
                        : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                    }`}
                  >
                    {plan.active ? 'Desativar' : 'Ativar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: ASSINATURAS (SUBSCRIPTIONS) */}
      {activeTab === 'subscriptions' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Academia Assinante</th>
                    <th className="py-3 px-4">Plano</th>
                    <th className="py-3 px-4">Valor Mensal</th>
                    <th className="py-3 px-4">Vigência Atual</th>
                    <th className="py-3 px-4">Próximo Vencimento</th>
                    <th className="py-3 px-4">Status da Assinatura</th>
                    <th className="py-3 px-4 text-right">Ação SuperAdmin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {subscriptions.map(sub => {
                    const tenant = tenants.find(t => t.id === sub.tenantId);
                    return (
                      <tr key={sub.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-bold text-white">{tenant?.tradeName || sub.tenantId}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            Sub ID: {sub.id}
                          </div>
                        </td>

                        <td className="py-3 px-4 font-semibold text-slate-300">
                          {sub.planName}
                        </td>

                        <td className="py-3 px-4 font-mono font-bold text-white">
                          {sub.amount === 0 ? 'Gratuito' : formatCurrencyBRL(sub.amount)}
                        </td>

                        <td className="py-3 px-4 text-slate-400">
                          {formatDateBR(sub.currentPeriodStart)} até {formatDateBR(sub.currentPeriodEnd)}
                        </td>

                        <td className="py-3 px-4 text-slate-300 font-mono">
                          {formatDateBR(sub.nextDueDate)}
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                              sub.status === 'active'
                                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                                : sub.status === 'trial'
                                ? 'bg-amber-950/60 text-amber-400 border border-amber-500/30'
                                : sub.status === 'past_due'
                                ? 'bg-orange-950/60 text-orange-400 border border-orange-500/30'
                                : sub.status === 'suspended'
                                ? 'bg-rose-950/60 text-rose-400 border border-rose-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {sub.status.toUpperCase()}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => {
                              setSubToManualActivate(sub);
                              setManualActivateDays(30);
                            }}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors cursor-pointer"
                          >
                            Ativar Manualmente
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: PAGAMENTOS (PAYMENTS) */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Identificador da Fatura</th>
                    <th className="py-3 px-4">Academia</th>
                    <th className="py-3 px-4">Valor</th>
                    <th className="py-3 px-4">Vencimento</th>
                    <th className="py-3 px-4">Data Pagamento</th>
                    <th className="py-3 px-4">Método</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {payments.map(p => {
                    const tenant = tenants.find(t => t.id === p.tenantId);
                    return (
                      <tr key={p.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-mono text-slate-300">
                          {p.id}
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-bold text-white">{tenant?.tradeName || p.tenantId}</div>
                        </td>

                        <td className="py-3 px-4 font-mono font-bold text-white">
                          {formatCurrencyBRL(p.amount)}
                        </td>

                        <td className="py-3 px-4 text-slate-400">
                          {formatDateBR(p.dueDate)}
                        </td>

                        <td className="py-3 px-4 text-slate-300">
                          {p.paidAt ? formatDateBR(p.paidAt) : '—'}
                        </td>

                        <td className="py-3 px-4 uppercase text-[10px] text-slate-400 font-mono">
                          {p.paymentMethod}
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                              p.status === 'paid'
                                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                                : p.status === 'pending'
                                ? 'bg-amber-950/60 text-amber-400 border border-amber-500/30'
                                : 'bg-rose-950/60 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {p.status === 'paid' ? 'CONFIRMADO' : p.status.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: INADIMPLÊNCIA & COBRANÇA */}
      {activeTab === 'overdue' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-amber-600/30 bg-amber-950/20 text-xs text-amber-200 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block font-semibold mb-1">
                Política de Tolerância e Atraso (5 Dias de Carência)
              </strong>
              <p className="text-amber-200/80 leading-relaxed text-[11px]">
                Quando a fatura do SaaS vence, a academia entra em estado de <em>past_due</em> (carência de 5 dias).
                O acesso normal permanece liberado com aviso discreto para regularização.
                Após os 5 dias, o acesso aos módulos é pausado até a quitação, sem perda de dados.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Academia</th>
                    <th className="py-3 px-4">Responsável</th>
                    <th className="py-3 px-4">Vencimento Original</th>
                    <th className="py-3 px-4">Dias de Atraso</th>
                    <th className="py-3 px-4">Situação da Carência</th>
                    <th className="py-3 px-4 text-right">Ações de Cobrança</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {subscriptions
                    .filter(s => s.status === 'past_due')
                    .map(sub => {
                      const tenant = tenants.find(t => t.id === sub.tenantId);
                      const now = Date.now();
                      const dueDate = new Date(sub.nextDueDate).getTime();
                      const daysOverdue = Math.max(0, Math.floor((now - dueDate) / (1000 * 60 * 60 * 24)));
                      const graceDaysLeft = (sub.gracePeriodDays || 5) - daysOverdue;

                      return (
                        <tr key={sub.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 font-bold text-white">
                            {tenant?.tradeName || sub.tenantId}
                          </td>

                          <td className="py-3 px-4 text-slate-300">
                            {tenant?.adminName} ({tenant?.phone})
                          </td>

                          <td className="py-3 px-4 font-mono text-slate-400">
                            {formatDateBR(sub.nextDueDate)}
                          </td>

                          <td className="py-3 px-4 font-mono font-bold text-rose-400">
                            {daysOverdue} dia(s)
                          </td>

                          <td className="py-3 px-4">
                            {graceDaysLeft >= 0 ? (
                              <span className="text-amber-400 font-semibold text-[11px]">
                                Carência ativa: restam {graceDaysLeft} dia(s)
                              </span>
                            ) : (
                              <span className="text-rose-400 font-semibold text-[11px]">
                                Carência expirada: acesso restrito
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => {
                                if (tenant) setTenantToSuspend(tenant);
                              }}
                              className="px-2.5 py-1 rounded bg-rose-950/60 text-rose-400 hover:bg-rose-900/60 border border-rose-500/30 text-[11px] font-semibold cursor-pointer"
                            >
                              Suspender Acesso
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: HISTÓRICO DE AUDITORIA DA PLATAFORMA */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 text-xs text-slate-300">
            <span className="font-bold text-white">Trilha de Auditoria Imutável do SaaS:</span>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Registra quem alterou planos, preços, suspendeu dojos, confirmou pagamentos de webhooks ou concedeu acessos manuais.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Data e Hora</th>
                    <th className="py-3 px-4">Operador / Agente</th>
                    <th className="py-3 px-4">Ação</th>
                    <th className="py-3 px-4">Entidade / Academia</th>
                    <th className="py-3 px-4">Detalhes e Justificativa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {auditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                        {formatDateBR(log.timestamp)} {new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </td>

                      <td className="py-3 px-4 font-semibold text-slate-200">
                        {log.actorUserName}
                      </td>

                      <td className="py-3 px-4 font-mono text-[11px] text-amber-400 uppercase">
                        {log.action.replace(/_/g, ' ')}
                      </td>

                      <td className="py-3 px-4 text-slate-300">
                        {log.tenantName || log.entityId}
                      </td>

                      <td className="py-3 px-4 text-slate-400 text-[11px]">
                        {log.details}
                        {log.reason && (
                          <span className="block text-slate-300 font-medium mt-0.5">
                            Motivo: {log.reason}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 8: GATEWAY & WEBHOOKS */}
      {activeTab === 'gateway' && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-red-500" />
                  <span>Provedores de Pagamento Recorrente Homologados</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Arquitetura desacoplada compatível com Asaas, Mercado Pago e Stripe.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 text-[11px] font-semibold">
                Webhook Idempotente Ativo
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
                <div className="font-bold text-white flex items-center justify-between">
                  <span>Asaas Pagamentos</span>
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded">Recomendado BR</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  PIX instantâneo com conciliação automática, boletos bancários com baixa em D+1 e assinaturas em cartão.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
                <div className="font-bold text-white flex items-center justify-between">
                  <span>Mercado Pago</span>
                  <span className="text-[10px] text-blue-400 bg-blue-950/60 px-2 py-0.5 rounded">Suportado</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Checkout transparente, PIX e parcelamento no cartão de crédito para clientes finais.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
                <div className="font-bold text-white flex items-center justify-between">
                  <span>Stripe Billing</span>
                  <span className="text-[10px] text-purple-400 bg-purple-950/60 px-2 py-0.5 rounded">Internacional</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Recorrência global com suporte a múltiplas moedas e cartões internacionais.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/80 space-y-3 text-xs">
              <div className="font-bold text-white">Endpoint do Webhook Seguro:</div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300 flex items-center justify-between">
                <span>https://api.tatamehub.com.br/api/webhooks/saas-payments</span>
                <span className="text-[10px] text-emerald-400 font-sans">Validação de Assinatura HMAC-SHA256</span>
              </div>
              <p className="text-[11px] text-slate-500">
                O processador de webhooks é estritamente idempotente: rejeita duplicatas por <code>event_id</code>, estende o período de serviço e ativa o tenant no banco sem depender do navegador.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: DETALHES DA ACADEMIA CLIENTE */}
      {selectedTenantForDetails && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 text-xs text-slate-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">{selectedTenantForDetails.tradeName}</h3>
                <span className="text-[11px] text-slate-400">Ficha Completa do Cliente SaaS</span>
              </div>
              <button
                onClick={() => setSelectedTenantForDetails(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-slate-800 text-xs font-semibold gap-2">
              <button
                onClick={() => setTenantModalTab('info')}
                className={`py-2 px-3 border-b-2 cursor-pointer ${
                  tenantModalTab === 'info' ? 'border-red-500 text-white font-bold' : 'border-transparent text-slate-400'
                }`}
              >
                Dados Cadastrais
              </button>
              <button
                onClick={() => setTenantModalTab('subscription')}
                className={`py-2 px-3 border-b-2 cursor-pointer ${
                  tenantModalTab === 'subscription' ? 'border-red-500 text-white font-bold' : 'border-transparent text-slate-400'
                }`}
              >
                Assinatura & Plano
              </button>
              <button
                onClick={() => setTenantModalTab('payments')}
                className={`py-2 px-3 border-b-2 cursor-pointer ${
                  tenantModalTab === 'payments' ? 'border-red-500 text-white font-bold' : 'border-transparent text-slate-400'
                }`}
              >
                Faturas
              </button>
            </div>

            {tenantModalTab === 'info' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-slate-400 block text-[11px]">Razão Social</span>
                  <span className="font-semibold text-white">{selectedTenantForDetails.legalName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">CNPJ / CPF</span>
                  <span className="font-mono text-white">{selectedTenantForDetails.cnpjOrCpf}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Responsável</span>
                  <span className="text-white">{selectedTenantForDetails.adminName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">E-mail de Contato</span>
                  <span className="text-white">{selectedTenantForDetails.email}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Telefone / WhatsApp</span>
                  <span className="text-white">{selectedTenantForDetails.phone}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Endereço</span>
                  <span className="text-white">
                    {selectedTenantForDetails.address.street}, {selectedTenantForDetails.address.number} - {selectedTenantForDetails.address.city}/{selectedTenantForDetails.address.state}
                  </span>
                </div>
              </div>
            )}

            {tenantModalTab === 'subscription' && (
              <div className="space-y-3">
                {(() => {
                  const sub = subscriptions.find(s => s.tenantId === selectedTenantForDetails.id);
                  const plan = commercialPlans.find(p => p.id === selectedTenantForDetails.planId);
                  return (
                    <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Plano Contratado:</span>
                        <strong className="text-white">{plan?.name || selectedTenantForDetails.planId}</strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Status da Assinatura:</span>
                        <span className="font-semibold text-emerald-400">{sub?.status.toUpperCase() || selectedTenantForDetails.status.toUpperCase()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Valor Mensal:</span>
                        <span className="font-mono font-bold text-white">{formatCurrencyBRL(sub?.amount || plan?.price || 0)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Próximo Vencimento:</span>
                        <span className="font-mono text-slate-300">{sub?.nextDueDate ? formatDateBR(sub.nextDueDate) : '—'}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {tenantModalTab === 'payments' && (
              <div className="space-y-2">
                {payments.filter(p => p.tenantId === selectedTenantForDetails.id).length === 0 ? (
                  <p className="text-slate-500 py-4 text-center">Nenhum pagamento registrado ainda para este dojo.</p>
                ) : (
                  payments
                    .filter(p => p.tenantId === selectedTenantForDetails.id)
                    .map(p => (
                      <div key={p.id} className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                        <div>
                          <div className="font-bold text-white">{formatCurrencyBRL(p.amount)}</div>
                          <div className="text-[10px] text-slate-500">Venc: {formatDateBR(p.dueDate)} · Método: {p.paymentMethod.toUpperCase()}</div>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                          {p.status.toUpperCase()}
                        </span>
                      </div>
                    ))
                )}
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setSelectedTenantForDetails(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: SUSPENDER ACADEMIA COM JUSTIFICATIVA OBRIGATÓRIA */}
      {tenantToSuspend && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/30 rounded-2xl max-w-md w-full p-6 space-y-4 text-xs text-slate-200">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
              <AlertTriangle className="h-5 w-5" />
              <span>Confirmar Suspensão Administrativa</span>
            </div>

            <p className="text-slate-300">
              Você está prestes a suspender o acesso da academia{' '}
              <strong className="text-white">{tenantToSuspend.tradeName}</strong>.
            </p>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-400">
              Os dados e cadastros dos alunos permanecem preservados no banco de dados. Os gestores verão uma tela de orientação sobre a suspensão com orientações de contato.
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Motivo / Justificativa da Suspensão (Obrigatório):
              </label>
              <textarea
                value={suspensionReason}
                onChange={e => setSuspensionReason(e.target.value)}
                placeholder="Ex: Inadimplência reincidente superior a 30 dias após notificações prévias."
                rows={3}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setTenantToSuspend(null);
                  setSuspensionReason('');
                }}
                disabled={isSubmittingSuspension}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmSuspension}
                disabled={isSubmittingSuspension}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold cursor-pointer"
              >
                {isSubmittingSuspension ? 'Suspendendo...' : 'Confirmar Suspensão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: REATIVAR ACADEMIA */}
      {tenantToReactivate && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl max-w-md w-full p-6 space-y-4 text-xs text-slate-200">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
              <CheckCircle2 className="h-5 w-5" />
              <span>Reativar Acesso da Academia</span>
            </div>

            <p className="text-slate-300">
              Deseja reativar o acesso total da academia{' '}
              <strong className="text-white">{tenantToReactivate.tradeName}</strong>?
            </p>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Justificativa da Reativação (Opcional):
              </label>
              <input
                type="text"
                value={reactivationReason}
                onChange={e => setReactivationReason(e.target.value)}
                placeholder="Ex: Regularização dos pagamentos pendentes."
                className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setTenantToReactivate(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmReactivation}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
              >
                Confirmar Reativação
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: MUDAR PLANO COMERCIAL */}
      {tenantToChangePlan && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 text-xs text-slate-200">
            <h3 className="text-sm font-bold text-white">
              Alterar Plano Comercial — {tenantToChangePlan.tradeName}
            </h3>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Selecione o Novo Plano:</label>
              <select
                value={targetNewPlanId}
                onChange={e => setTargetNewPlanId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white focus:outline-none"
              >
                {commercialPlans.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.price === 0 ? 'Gratuito' : formatCurrencyBRL(p.price)}/mês
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Motivo da Alteração:</label>
              <input
                type="text"
                value={changePlanReason}
                onChange={e => setChangePlanReason(e.target.value)}
                placeholder="Ex: Upgrade solicitado pelo Sensei responsável para abertura de filial."
                className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setTenantToChangePlan(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmChangePlan}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold cursor-pointer"
              >
                Salvar Novo Plano
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: ATIVAÇÃO MANUAL DE ASSINATURA */}
      {subToManualActivate && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 text-xs text-slate-200">
            <h3 className="text-sm font-bold text-white">
              Ativação Manual de Assinatura (Concessão SuperAdmin)
            </h3>

            <p className="text-slate-400 text-[11px]">
              Esta ação ativa a assinatura e libera o acesso da academia sem criar registros fictícios de pagamento. O evento é registrado com seu nome na trilha de auditoria.
            </p>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Dias de Extensão do Acesso:</label>
              <input
                type="number"
                min={1}
                max={365}
                value={manualActivateDays}
                onChange={e => setManualActivateDays(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white font-mono focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Justificativa Formal da Concessão (Obrigatório):
              </label>
              <textarea
                value={manualActivateReason}
                onChange={e => setManualActivateReason(e.target.value)}
                placeholder="Ex: Parceria institucional firmada ou prorrogação de teste para homologação."
                rows={3}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white placeholder-slate-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setSubToManualActivate(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmManualActivation}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
              >
                Ativar Manualmente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: CRIAR NOVO PLANO COMERCIAL */}
      {isNewPlanModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCommercialPlan}
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 text-xs text-slate-200"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">Criar Novo Plano Comercial</h3>
              <button
                type="button"
                onClick={() => setIsNewPlanModalOpen(false)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-slate-300 font-semibold mb-1">Nome Comercial do Plano *</label>
                <input
                  type="text"
                  required
                  value={newPlanForm.name}
                  onChange={e => setNewPlanForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex: Plano Intermediário (Dojo Pró)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Preço Mensal (R$) *</label>
                <input
                  type="number"
                  required
                  min={0}
                  step="0.01"
                  value={newPlanForm.price}
                  onChange={e => setNewPlanForm(prev => ({ ...prev, price: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white font-mono focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Máx. de Alunos *</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={newPlanForm.maxStudents}
                  onChange={e => setNewPlanForm(prev => ({ ...prev, maxStudents: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white font-mono focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Máx. de Filiais *</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={newPlanForm.maxBranches}
                  onChange={e => setNewPlanForm(prev => ({ ...prev, maxBranches: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white font-mono focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Armazenamento (GB)</label>
                <input
                  type="number"
                  min={1}
                  value={newPlanForm.maxStorageGb}
                  onChange={e => setNewPlanForm(prev => ({ ...prev, maxStorageGb: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white font-mono focus:outline-none"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-slate-300 font-semibold mb-1">Descrição Comercial</label>
                <textarea
                  value={newPlanForm.description}
                  onChange={e => setNewPlanForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Descreva para qual porte de academia este plano é indicado..."
                  rows={2}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white focus:outline-none"
                />
              </div>

              <div className="col-span-2 space-y-1.5 pt-2 border-t border-slate-800">
                <span className="font-semibold text-slate-300 block mb-1">Módulos Liberados:</span>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newPlanForm.features?.digitalLibrary}
                    onChange={e =>
                      setNewPlanForm(prev => ({
                        ...prev,
                        features: { ...prev.features!, digitalLibrary: e.target.checked },
                      }))
                    }
                    className="rounded text-red-600 focus:ring-0"
                  />
                  <span>Biblioteca Digital de Vídeos do YouTube</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newPlanForm.features?.beltExams}
                    onChange={e =>
                      setNewPlanForm(prev => ({
                        ...prev,
                        features: { ...prev.features!, beltExams: e.target.checked },
                      }))
                    }
                    className="rounded text-red-600 focus:ring-0"
                  />
                  <span>Exames de Graduação & Faixas</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newPlanForm.features?.competitions}
                    onChange={e =>
                      setNewPlanForm(prev => ({
                        ...prev,
                        features: { ...prev.features!, competitions: e.target.checked },
                      }))
                    }
                    className="rounded text-red-600 focus:ring-0"
                  />
                  <span>Competições & Medalhas</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsNewPlanModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold cursor-pointer"
              >
                Salvar Plano
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
