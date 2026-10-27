import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Users,
  Award,
  Calendar,
  CheckSquare,
  DollarSign,
  BookOpen,
  FileCheck2,
  Trophy,
  Building2,
  FileSpreadsheet,
  Settings,
  LogOut,
  ChevronDown,
  Clock,
  Sparkles,
  ArrowRightLeft,
  LayoutGrid,
  Shield,
  AlertCircle,
  Menu,
  X,
  UserCheck,
} from 'lucide-react';
import { User, Tenant, Branch } from '../../types';
import { saasPlatformService } from '../../services/saasPlatformService';
import { DataStore } from '../../data/storage';
import { TenantAccessRestrictedView } from '../common/TenantAccessRestrictedView';

export type AdminViewTab =
  | 'overview'
  | 'students'
  | 'guardians'
  | 'modalities'
  | 'classes'
  | 'attendance'
  | 'tatami_occupancy'
  | 'financial'
  | 'library'
  | 'exams'
  | 'competitions'
  | 'branches'
  | 'team_users'
  | 'reports'
  | 'settings';

interface DashboardLayoutProps {
  currentUser: User;
  tenant: Tenant;
  branches: Branch[];
  currentBranchId: string;
  onSelectBranch: (branchId: string) => void;
  activeTab: AdminViewTab;
  onSelectTab: (tab: AdminViewTab) => void;
  onSwitchPersona?: () => void;
  onLogout: () => void;
  onUpgradePlan: () => void;
  onNavigateToSuperAdmin?: () => void;
  onTenantSynchronized?: (tenant: Tenant) => void;
  children: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  currentUser,
  tenant,
  branches,
  currentBranchId,
  onSelectBranch,
  activeTab,
  onSelectTab,
  onLogout,
  onUpgradePlan,
  onNavigateToSuperAdmin,
  onTenantSynchronized,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [, setSyncTick] = useState(0);

  const handleRefreshLicenseStatus = useCallback(async () => {
    const synced = await saasPlatformService.syncTenantSubscriptionState(tenant.id);
    if (synced.tenant && onTenantSynchronized) {
      onTenantSynchronized(synced.tenant);
    }
    setSyncTick((prev) => prev + 1);
  }, [tenant.id, onTenantSynchronized]);

  useEffect(() => {
    let mounted = true;
    saasPlatformService
      .syncTenantSubscriptionState(tenant.id)
      .then((synced) => {
        if (!mounted) return;
        if (
          synced.tenant &&
          onTenantSynchronized &&
          (synced.tenant.status !== tenant.status || synced.tenant.planId !== tenant.planId)
        ) {
          onTenantSynchronized(synced.tenant);
        }
        setSyncTick((prev) => prev + 1);
      })
      .catch(() => {
        // fallback local preservado
      });
    return () => {
      mounted = false;
    };
  }, [tenant.id]);

  // SaaS Subscription & Access Evaluation
  const subscriptions = DataStore.getSaaSSubscriptions();
  const subscription = subscriptions.find((s) => s.tenantId === tenant.id) || null;
  const commercialPlans = DataStore.getCommercialPlans();
  const currentCommercialPlan =
    commercialPlans.find((p) => p.id === (subscription?.planId || tenant.planId)) || null;
  const currentStudents = DataStore.getStudents(tenant.id);

  const accessEvaluation = saasPlatformService.evaluateTenantAccess(
    tenant,
    subscription,
    currentCommercialPlan,
    currentStudents.length,
    branches.length
  );

  // Calculate trial days left
  const calculateDaysLeft = () => {
    if (accessEvaluation.accessState !== 'trial') return null;
    if (accessEvaluation.daysRemaining !== undefined) return accessEvaluation.daysRemaining;
    if (!tenant.trialExpiresAt) return null;
    const expiry = new Date(tenant.trialExpiresAt).getTime();
    const now = new Date().getTime();
    const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  const trialDaysLeft = calculateDaysLeft();

  const navItems: { id: AdminViewTab; label: string; icon: React.ElementType; allowedRoles?: User['role'][] }[] = [
    { id: 'overview', label: 'Visão Geral', icon: LayoutDashboard },
    { id: 'students', label: 'Alunos', icon: Users },
    { id: 'guardians', label: 'Responsáveis', icon: UserCheck },
    { id: 'modalities', label: 'Modalidades & Faixas', icon: Award },
    { id: 'classes', label: 'Turmas & Horários', icon: Calendar },
    { id: 'attendance', label: 'Controle de Frequência', icon: CheckSquare },
    { id: 'tatami_occupancy', label: 'Gerenciador de Tatamis', icon: LayoutGrid },
    { id: 'financial', label: 'Mensalidades e Finanças', icon: DollarSign },
    { id: 'library', label: 'Biblioteca Digital', icon: BookOpen },
    { id: 'exams', label: 'Exames de Graduação', icon: FileCheck2 },
    { id: 'competitions', label: 'Competições & Medalhas', icon: Trophy },
    { id: 'branches', label: 'Filiais & Unidades', icon: Building2 },
    { id: 'team_users', label: 'Equipe & Acessos', icon: Shield },
    { id: 'reports', label: 'Relatórios & Exportação', icon: FileSpreadsheet },
    { id: 'settings', label: 'Configurações do Dojo', icon: Settings },
  ];

  const currentBranch = branches.find(b => b.id === currentBranchId) || branches[0];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* Mobile Menu Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/80 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col justify-between border-r border-slate-800 bg-slate-900 transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          {/* Brand header */}
          <div className="flex h-16 items-center justify-between px-6 border-b border-slate-800">
            <div className="flex items-center gap-2.5 overflow-hidden">
              {tenant?.logoUrl ? (
                <img
                  src={tenant.logoUrl}
                  alt={tenant.tradeName}
                  className="h-8 w-8 rounded-lg object-contain bg-slate-800 border border-slate-700 p-0.5 shadow shrink-0"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-white font-bold text-sm shadow shrink-0">
                  TC
                </div>
              )}
              <div className="overflow-hidden">
                <div className="text-sm font-bold text-white tracking-tight">Tatame <span className="text-red-500">Club</span></div>
                <div className="text-[10px] text-slate-400 truncate max-w-[130px]">{tenant?.tradeName || 'Academia'}</div>
              </div>
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-16rem)]">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Card & Actions */}
        <div className="p-4 border-t border-slate-800 space-y-3 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 border border-slate-700 text-red-400 font-bold text-xs">
              {currentUser.name.substring(0, 2).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <div className="text-xs font-bold text-white truncate">{currentUser.name}</div>
              <div className="text-[11px] text-slate-400 capitalize">{currentUser.role.replace('_', ' ')}</div>
            </div>
          </div>

          <div className="pt-1 text-[11px]">
            <button
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-1.5 p-2 rounded-md border border-slate-700 bg-slate-800 text-slate-300 hover:text-red-400 hover:bg-slate-700 transition-colors cursor-pointer"
              title="Encerrar sessão na academia"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Encerrar Sessão</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-slate-800 bg-slate-900/60 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Branch Switcher */}
            {branches.length > 1 && (
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                <div className="relative">
                  <select
                    value={currentBranchId}
                    onChange={(e) => onSelectBranch(e.target.value)}
                    className="appearance-none rounded-lg border border-slate-700 bg-slate-800 py-1.5 pl-3 pr-8 text-xs font-semibold text-white focus:border-red-500 focus:outline-none cursor-pointer"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} {b.isHeadquarter ? '(Matriz)' : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                </div>
              </div>
            )}
            {branches.length === 1 && (
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <Building2 className="h-4 w-4 text-red-500" />
                <span>{currentBranch?.name || 'Unidade Principal'}</span>
              </div>
            )}
          </div>

          {/* Right Header Badges & SuperAdmin Inspection Banner */}
          <div className="flex items-center gap-3">
            {currentUser.role === 'superadmin' && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-950/80 border border-amber-500/40 text-amber-300 text-xs">
                <Shield className="h-3.5 w-3.5 text-amber-400" />
                <span className="font-semibold">Modo Inspeção SuperAdmin</span>
                {onNavigateToSuperAdmin && (
                  <button
                    onClick={onNavigateToSuperAdmin}
                    className="ml-2 px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-[10px] uppercase transition-colors cursor-pointer"
                  >
                    Voltar ao Console
                  </button>
                )}
              </div>
            )}

            {trialDaysLeft !== null && currentUser.role !== 'superadmin' && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-950/60 border border-amber-600/40 text-amber-300 text-xs">
                <Clock className="h-3.5 w-3.5 text-amber-400" />
                <span>
                  Teste Grátis: <strong className="text-white font-bold">{trialDaysLeft} dias</strong> restantes
                </span>
                <button
                  onClick={onUpgradePlan}
                  className="ml-1.5 px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-[10px] uppercase transition-colors cursor-pointer"
                >
                  Contratar
                </button>
              </div>
            )}

            {tenant.status === 'active' && currentUser.role !== 'superadmin' && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Plano {currentCommercialPlan?.name || tenant.planId.toUpperCase()}</span>
              </div>
            )}
          </div>
        </header>

        {/* Viewport content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-slate-950">
          {/* 1. Bloqueio de Acesso se Não Autorizado (Suspensa, Expirada, Pagamento Pendente após Trial ou Inadimplente fora da carência) */}
          {!accessEvaluation.isAllowed && currentUser.role !== 'superadmin' ? (
            <TenantAccessRestrictedView
              tenant={tenant}
              evaluation={accessEvaluation}
              subscription={subscription}
              plan={currentCommercialPlan}
              onLogout={onLogout}
              onRefreshStatus={handleRefreshLicenseStatus}
              onOpenUpgradeModal={onUpgradePlan}
            />
          ) : (
            <>
              {/* 2. Banner de Carência (Past Due mas ainda dentro da tolerância de 5 dias) */}
              {accessEvaluation.accessState === 'grace_period' && (
                <div className="mb-6 p-4 rounded-xl border border-amber-500/40 bg-amber-950/40 text-xs text-amber-200 flex items-center justify-between gap-3 shadow-lg">
                  <div className="flex items-center gap-2.5">
                    <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
                    <div>
                      <strong className="text-white block font-semibold">Aviso de Mensalidade do SaaS Pendente</strong>
                      <span className="text-[11px] text-amber-200/90">{accessEvaluation.message}</span>
                    </div>
                  </div>
                  <button
                    onClick={onUpgradePlan}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs transition-colors cursor-pointer"
                  >
                    Regularizar Fatura
                  </button>
                </div>
              )}

              {children}
            </>
          )}
        </main>
      </div>
    </div>
  );
};
