import { supabase, isSupabaseConfigured } from './supabase';
import {
  Tenant,
  SaaSCommercialPlan,
  SaaSSubscription,
  SaaSPayment,
  PlatformAuditLog,
  TenantAccessEvaluation,
  SaaSPaymentWebhookEvent,
  Branch,
  User,
} from '../types';
import { DataStore } from '../data/storage';
import { OFFICIAL_DOMAINS, isAuthorizedPlatformOwnerEmail } from '../utils/domainConfig';

const branchLocks = new Map<string, Promise<any>>();
async function withBranchLock<T>(tenantId: string, task: () => Promise<T>): Promise<T> {
  const prev = branchLocks.get(tenantId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => {
    release = r;
  });
  branchLocks.set(tenantId, prev.then(() => current));
  await prev;
  try {
    return await task();
  } finally {
    release();
    if (branchLocks.get(tenantId) === current) {
      branchLocks.delete(tenantId);
    }
  }
}

export function isValidUUID(id: string): boolean {
  if (!id) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

export interface PlatformMetrics {
  totalTenants: number;
  activeSubscriptions: number;
  trialSubscriptions: number;
  pastDueSubscriptions: number;
  suspendedTenants: number;
  canceledSubscriptions: number;
  estimatedMRR: number; // Receita recorrente mensal calculada apenas com planos ativos pagos
  confirmedRevenueMonth: number; // Receita efetivamente recebida no mês corrente (não prevista)
  confirmedRevenueTotal: number; // Receita histórica total confirmada
}

export const saasPlatformService = {
  /**
   * Retorna os limites comerciais efetivos de uma academia (priorizando limites customizados da licença individual sobre o plano padrão).
   */
  getEffectiveLimits(tenantId: string): {
    maxUsers: number;
    maxBranches: number;
    maxStudents: number;
    planId: string;
    currentActiveUsers: number;
    pendingUserInvitations: number;
    totalReservedUsers: number;
    currentBranches: number;
    currentStudents: number;
    usersLimitReached: boolean;
    branchesLimitReached: boolean;
    studentsLimitReached: boolean;
    hasCustomLimits: boolean;
  } {
    const tenants = DataStore.getTenants();
    const tenant = tenants.find((t) => t.id === tenantId);
    const subs = DataStore.getSaaSSubscriptions();
    const sub = subs.find((s) => s.tenantId === tenantId);
    const plans = DataStore.getCommercialPlans();
    const planId = sub?.planId || tenant?.planId || 'trial';
    const plan = plans.find((p) => p.id === planId);

    const defaultMaxUsers = plan?.maxUsers ?? (planId === 'advanced' ? 10 : planId === 'enterprise' ? 30 : 3);
    const defaultMaxBranches = plan?.maxBranches ?? (planId === 'basic' || planId === 'trial' ? 1 : planId === 'advanced' ? 3 : 10);
    const defaultMaxStudents = plan?.maxStudents ?? (planId === 'basic' ? 100 : planId === 'trial' ? 50 : 500);

    const maxUsers = sub?.customMaxUsers ?? defaultMaxUsers;
    const maxBranches = sub?.customMaxBranches ?? defaultMaxBranches;
    const maxStudents = sub?.customMaxStudents ?? defaultMaxStudents;

    const currentActiveUsers = DataStore.getAllUsers().filter(
      (u) =>
        u.tenantId === tenantId &&
        u.role !== 'superadmin' &&
        u.role !== 'student' &&
        u.role !== 'guardian' &&
        u.active !== false &&
        (u as any).isActive !== false
    ).length;

    const pendingUserInvitations = DataStore.getTenantInvitations(tenantId).filter(
      (inv) => inv.status === 'invited' || (inv.status as string) === 'pending'
    ).length;

    const totalReservedUsers = currentActiveUsers + pendingUserInvitations;
    const currentBranches = DataStore.getBranches().filter((b) => b.tenantId === tenantId).length;
    const currentStudents = DataStore.getStudents(tenantId).length;

    return {
      maxUsers,
      maxBranches,
      maxStudents,
      planId,
      currentActiveUsers,
      pendingUserInvitations,
      totalReservedUsers,
      currentBranches,
      currentStudents,
      usersLimitReached: totalReservedUsers >= maxUsers,
      branchesLimitReached: currentBranches >= maxBranches,
      studentsLimitReached: currentStudents >= maxStudents,
      hasCustomLimits: Boolean(
        sub?.customMaxUsers !== undefined ||
          sub?.customMaxBranches !== undefined ||
          sub?.customMaxStudents !== undefined
      ),
    };
  },

  /**
   * Avaliação centralizada e determinística das permissões e estado de acesso da academia.
   * Não espalha regras por dezenas de componentes.
   */
  evaluateTenantAccess(
    tenant: Tenant,
    subscription?: SaaSSubscription | null,
    plan?: SaaSCommercialPlan | null,
    studentCount: number = 0,
    branchCount: number = 1,
    activeUserCount?: number
  ): TenantAccessEvaluation {
    const defaultModules = {
      digitalLibrary: true,
      beltExams: true,
      competitions: true,
      advancedReports: true,
      multiBranch: true,
      customBranding: true,
    };

    const resolvedActiveUsers =
      activeUserCount !== undefined
        ? activeUserCount
        : DataStore.getUsers(tenant.id).filter((u) => u.active && u.role !== 'superadmin').length;

    const effectiveMaxStudents =
      subscription?.customMaxStudents ?? plan?.maxStudents ?? (tenant.planId === 'basic' ? 100 : tenant.planId === 'trial' ? 40 : 500);
    const effectiveMaxBranches =
      subscription?.customMaxBranches ?? plan?.maxBranches ?? (tenant.planId === 'basic' ? 1 : tenant.planId === 'trial' ? 2 : 5);
    const effectiveMaxUsers =
      subscription?.customMaxUsers ?? plan?.maxUsers ?? (tenant.planId === 'advanced' ? 20 : 5);

    // 1. Suspensão administrativa
    if (tenant.status === 'suspended' || subscription?.status === 'suspended') {
      return {
        isAllowed: false,
        accessState: 'blocked_suspended',
        message: subscription?.suspendedReason || 'Acesso à academia suspenso administrativamente pela plataforma Tatame Club. Seus dados estão preservados.',
        allowedModules: { ...defaultModules, digitalLibrary: false, beltExams: false, competitions: false, advancedReports: false },
        limits: {
          maxStudents: effectiveMaxStudents,
          currentStudents: studentCount,
          isStudentsLimitReached: true,
          maxBranches: effectiveMaxBranches,
          currentBranches: branchCount,
          isBranchesLimitReached: true,
          maxUsers: effectiveMaxUsers,
          currentUsers: resolvedActiveUsers,
          isUsersLimitReached: true,
        },
      };
    }

    // 2. Cancelamento
    if (tenant.status === 'canceled' || subscription?.status === 'canceled') {
      return {
        isAllowed: false,
        accessState: 'blocked_canceled',
        message: subscription?.cancelReason || 'Assinatura do Tatame Club cancelada. Seus registros permanecem guardados para reativação futura.',
        allowedModules: { ...defaultModules, digitalLibrary: false, beltExams: false, competitions: false, advancedReports: false },
        limits: {
          maxStudents: effectiveMaxStudents,
          currentStudents: studentCount,
          isStudentsLimitReached: true,
          maxBranches: effectiveMaxBranches,
          currentBranches: branchCount,
          isBranchesLimitReached: true,
          maxUsers: effectiveMaxUsers,
          currentUsers: resolvedActiveUsers,
          isUsersLimitReached: true,
        },
      };
    }

    // 3. Aguardando Pagamento (waiting_payment)
    if (subscription?.status === 'waiting_payment') {
      const isTrialAuthorized = tenant.status === 'trial' && new Date(tenant.trialExpiresAt).getTime() > Date.now();
      if (!isTrialAuthorized) {
        return {
          isAllowed: false,
          accessState: 'waiting_payment',
          message: 'Aguardando confirmação do pagamento de assinatura pela instituição financeira.',
          allowedModules: defaultModules,
          limits: {
            maxStudents: effectiveMaxStudents,
            currentStudents: studentCount,
            isStudentsLimitReached: true,
            maxBranches: effectiveMaxBranches,
            currentBranches: branchCount,
            isBranchesLimitReached: true,
            maxUsers: effectiveMaxUsers,
            currentUsers: resolvedActiveUsers,
            isUsersLimitReached: true,
          },
        };
      }
    }

    // 4. Status de Teste (Trial de 10 dias)
    if (tenant.status === 'trial' || subscription?.status === 'trial') {
      const trialExpiry = new Date(subscription?.trialExpiresAt || tenant.trialExpiresAt).getTime();
      const now = Date.now();
      const diffMs = trialExpiry - now;
      const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (daysLeft < 0) {
        return {
          isAllowed: false,
          accessState: 'trial_expired',
          daysRemaining: 0,
          message: 'Seu período de teste gratuito de 10 dias terminou. Contrate um plano comercial para continuar gerenciando sua academia sem perder seus dados.',
          allowedModules: defaultModules,
          limits: {
            maxStudents: effectiveMaxStudents,
            currentStudents: studentCount,
            isStudentsLimitReached: studentCount >= effectiveMaxStudents,
            maxBranches: effectiveMaxBranches,
            currentBranches: branchCount,
            isBranchesLimitReached: branchCount >= effectiveMaxBranches,
            maxUsers: effectiveMaxUsers,
            currentUsers: resolvedActiveUsers,
            isUsersLimitReached: resolvedActiveUsers >= effectiveMaxUsers,
          },
        };
      }

      return {
        isAllowed: true,
        accessState: 'trial',
        daysRemaining: Math.max(0, daysLeft),
        message: `Período de avaliação ativo: restam ${daysLeft} dia(s) de teste gratuito.`,
        allowedModules: defaultModules,
        limits: {
          maxStudents: effectiveMaxStudents,
          currentStudents: studentCount,
          isStudentsLimitReached: studentCount >= effectiveMaxStudents,
          maxBranches: effectiveMaxBranches,
          currentBranches: branchCount,
          isBranchesLimitReached: branchCount >= effectiveMaxBranches,
          maxUsers: effectiveMaxUsers,
          currentUsers: resolvedActiveUsers,
          isUsersLimitReached: resolvedActiveUsers >= effectiveMaxUsers,
        },
      };
    }

    // 5. Inadimplência / Pagamento Atrasado (past_due)
    if (subscription?.status === 'past_due') {
      const dueDate = new Date(subscription.nextDueDate).getTime();
      const now = Date.now();
      const graceDays = subscription.gracePeriodDays || 5;
      const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
      const graceDaysLeft = graceDays - daysOverdue;

      if (graceDaysLeft >= 0) {
        return {
          isAllowed: true,
          accessState: 'grace_period',
          graceDaysLeft: Math.max(0, graceDaysLeft),
          message: `Cobrança de mensalidade pendente há ${daysOverdue} dia(s). Período de tolerância em vigor: restam ${graceDaysLeft} dia(s) para regularização sem bloqueio.`,
          allowedModules: plan?.features || defaultModules,
          limits: {
            maxStudents: effectiveMaxStudents,
            currentStudents: studentCount,
            isStudentsLimitReached: studentCount >= effectiveMaxStudents,
            maxBranches: effectiveMaxBranches,
            currentBranches: branchCount,
            isBranchesLimitReached: branchCount >= effectiveMaxBranches,
            maxUsers: effectiveMaxUsers,
            currentUsers: resolvedActiveUsers,
            isUsersLimitReached: resolvedActiveUsers >= effectiveMaxUsers,
          },
        };
      }

      return {
        isAllowed: false,
        accessState: 'blocked_past_due',
        graceDaysLeft: 0,
        message: `Acesso temporariamente restrito por inadimplência (${daysOverdue} dias de atraso). Efetue a quitação da fatura via PIX ou Boleto para reativação imediata.`,
        allowedModules: plan?.features || defaultModules,
        limits: {
          maxStudents: effectiveMaxStudents,
          currentStudents: studentCount,
          isStudentsLimitReached: true,
          maxBranches: effectiveMaxBranches,
          currentBranches: branchCount,
          isBranchesLimitReached: true,
          maxUsers: effectiveMaxUsers,
          currentUsers: resolvedActiveUsers,
          isUsersLimitReached: true,
        },
      };
    }

    // 6. Assinatura Regular e Ativa (active)
    const planFeatures = plan?.features || {
      digitalLibrary: true,
      beltExams: true,
      competitions: true,
      advancedReports: true,
      multiBranch: true,
      customBranding: true,
      automatedNotifications: true,
    };

    return {
      isAllowed: true,
      accessState: 'active',
      message: 'Assinatura ativa e em dia.',
      allowedModules: planFeatures,
      limits: {
        maxStudents: effectiveMaxStudents,
        currentStudents: studentCount,
        isStudentsLimitReached: studentCount >= effectiveMaxStudents,
        maxBranches: effectiveMaxBranches,
        currentBranches: branchCount,
        isBranchesLimitReached: branchCount >= effectiveMaxBranches,
        maxUsers: effectiveMaxUsers,
        currentUsers: resolvedActiveUsers,
        isUsersLimitReached: resolvedActiveUsers >= effectiveMaxUsers,
      },
    };
  },

  /**
   * Calcula as métricas reais consolidadas da plataforma SaaS.
   * Não inventa valores: calcula estritamente a partir das assinaturas e pagamentos confirmados.
   */
  async getMetrics(): Promise<PlatformMetrics> {
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase.rpc('get_platform_metrics');
        if (!error && data) {
          return {
            totalTenants: Number(data.total_tenants) || 0,
            activeSubscriptions: Number(data.active_subscriptions) || 0,
            trialSubscriptions: Number(data.trial_subscriptions) || 0,
            pastDueSubscriptions: Number(data.past_due_subscriptions) || 0,
            suspendedTenants: Number(data.suspended_tenants) || 0,
            canceledSubscriptions: Number(data.canceled_subscriptions) || 0,
            estimatedMRR: Number(data.estimated_mrr) || 0,
            confirmedRevenueMonth: Number(data.confirmed_revenue_month) || 0,
            confirmedRevenueTotal: Number(data.confirmed_revenue_total) || 0,
          };
        }
      } catch (err) {
        console.warn('Fallback para cálculo de métricas local:', err);
      }
    }

    // Fallback DataStore
    const tenants = DataStore.getTenants();
    const subs = DataStore.getSaaSSubscriptions();
    const payments = DataStore.getSaaSPayments();
    const plans = DataStore.getCommercialPlans();

    const totalTenants = tenants.length;
    const activeSubscriptions = subs.filter(s => s.status === 'active').length;
    const trialSubscriptions = subs.filter(s => s.status === 'trial').length;
    const pastDueSubscriptions = subs.filter(s => s.status === 'past_due').length;
    const suspendedTenants = tenants.filter(t => t.status === 'suspended').length;
    const canceledSubscriptions = subs.filter(s => s.status === 'canceled').length;

    // MRR: soma dos valores de planos de assinaturas estritamente ativas
    const estimatedMRR = subs
      .filter(s => s.status === 'active')
      .reduce((acc, sub) => acc + (sub.amount || 0), 0);

    // Receita recebida no mês corrente (status === 'paid' com paidAt dentro do mês)
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
  },

  /**
   * Buscar todos os planos comerciais do SaaS
   */
  async fetchPlans(): Promise<SaaSCommercialPlan[]> {
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('saas_commercial_plans')
          .select('*')
          .order('price', { ascending: true });
        if (!error && data && data.length > 0) {
          const mapped: SaaSCommercialPlan[] = data.map((r: any) => ({
            id: r.id,
            name: r.name,
            description: r.description || '',
            tagline: r.tagline || '',
            price: Number(r.price) || 0,
            currency: 'BRL',
            billingCycle: r.billing_cycle || 'monthly',
            cycleMultiplier: r.cycle_multiplier || 1,
            trialDays: r.trial_days || 0,
            maxStudents: r.max_students || 100,
            maxBranches: r.max_branches || 1,
            maxUsers: r.max_users || 5,
            maxStorageGb: r.max_storage_gb || 10,
            features: r.features || {
              digitalLibrary: false,
              beltExams: false,
              competitions: false,
              advancedReports: false,
              multiBranch: false,
              customBranding: false,
              automatedNotifications: false,
            },
            active: Boolean(r.active),
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }));
          DataStore.saveCommercialPlans(mapped);
          return mapped;
        }
      } catch (err) {
        console.warn('Erro ao consultar planos comerciais no Supabase:', err);
      }
    }
    return DataStore.getCommercialPlans();
  },

  /**
   * Salvar ou atualizar plano comercial
   */
  async savePlan(plan: SaaSCommercialPlan, actorUserId: string, actorUserName: string): Promise<SaaSCommercialPlan> {
    const plans = DataStore.getCommercialPlans();
    const existingIndex = plans.findIndex(p => p.id === plan.id);
    const isNew = existingIndex === -1;

    const updatedPlan: SaaSCommercialPlan = {
      ...plan,
      updatedAt: new Date().toISOString(),
      createdAt: isNew ? new Date().toISOString() : plan.createdAt,
    };

    if (isNew) {
      plans.push(updatedPlan);
    } else {
      plans[existingIndex] = updatedPlan;
    }

    DataStore.saveCommercialPlans(plans);

    // Auditoria
    DataStore.logPlatformAudit(
      actorUserId,
      actorUserName,
      isNew ? 'create_plan' : 'update_plan',
      'plan',
      plan.id,
      `${isNew ? 'Criado novo' : 'Atualizado'} plano comercial "${plan.name}" com valor R$ ${plan.price.toFixed(2)}.`
    );

    return updatedPlan;
  },

  /**
   * Buscar todas as assinaturas registradas
   */
  async fetchSubscriptions(): Promise<SaaSSubscription[]> {
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('saas_subscriptions')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && data && data.length > 0) {
          const mapped: SaaSSubscription[] = data.map((r: any) => ({
            id: r.id,
            tenantId: r.tenant_id,
            planId: r.plan_id,
            planName: r.plan_name,
            status: r.status,
            billingCycle: r.billing_cycle,
            amount: Number(r.amount),
            startedAt: r.started_at,
            currentPeriodStart: r.current_period_start,
            currentPeriodEnd: r.current_period_end,
            nextDueDate: r.next_due_date,
            trialExpiresAt: r.trial_expires_at,
            gracePeriodDays: r.grace_period_days || 5,
            customMaxUsers: r.custom_max_users ?? undefined,
            customMaxBranches: r.custom_max_branches ?? undefined,
            customMaxStudents: r.custom_max_students ?? undefined,
            gatewayCustomerId: r.gateway_customer_id,
            gatewaySubscriptionId: r.gateway_subscription_id,
            cancelReason: r.cancel_reason,
            canceledAt: r.canceled_at,
            suspendedReason: r.suspended_reason,
            suspendedAt: r.suspended_at,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }));
          DataStore.saveSaaSSubscriptions(mapped);
          return mapped;
        }
      } catch (err) {
        console.warn('Erro ao consultar assinaturas no Supabase:', err);
      }
    }
    return DataStore.getSaaSSubscriptions();
  },

  /**
   * Buscar todos os pagamentos da plataforma
   */
  async fetchPayments(): Promise<SaaSPayment[]> {
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('saas_payments')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && data && data.length > 0) {
          const mapped: SaaSPayment[] = data.map((r: any) => ({
            id: r.id,
            subscriptionId: r.subscription_id,
            tenantId: r.tenant_id,
            amount: Number(r.amount),
            currency: r.currency || 'BRL',
            dueDate: r.due_date,
            paidAt: r.paid_at,
            status: r.status,
            paymentMethod: r.payment_method,
            gatewayChargeId: r.gateway_charge_id,
            gatewayPaymentId: r.gateway_payment_id,
            billingPeriodStart: r.billing_period_start,
            billingPeriodEnd: r.billing_period_end,
            invoiceUrl: r.invoice_url,
            pixQrCode: r.pix_qr_code,
            pixCopyPaste: r.pix_copy_paste,
            barcode: r.barcode,
            notes: r.notes,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }));
          DataStore.saveSaaSPayments(mapped);
          return mapped;
        }
      } catch (err) {
        console.warn('Erro ao consultar pagamentos no Supabase:', err);
      }
    }
    return DataStore.getSaaSPayments();
  },

  /**
   * Suspender uma academia com motivo obrigatório e auditoria
   */
  async suspendTenant(
    tenantId: string,
    reason: string,
    actorUserId: string,
    actorUserName: string
  ): Promise<boolean> {
    if (!reason || reason.trim().length < 5) {
      throw new Error('É obrigatório informar uma justificativa clara para suspender uma academia.');
    }

    const tenants = DataStore.getTenants();
    const tenant = tenants.find(t => t.id === tenantId);
    if (!tenant) throw new Error('Academia não encontrada.');

    tenant.status = 'suspended';
    DataStore.saveTenants(tenants);

    const subs = DataStore.getSaaSSubscriptions();
    const sub = subs.find(s => s.tenantId === tenantId);
    if (sub) {
      sub.status = 'suspended';
      sub.suspendedReason = reason.trim();
      sub.suspendedAt = new Date().toISOString();
      sub.updatedAt = new Date().toISOString();
      DataStore.saveSaaSSubscriptions(subs);
    }

    DataStore.logPlatformAudit(
      actorUserId,
      actorUserName,
      'suspend_tenant',
      'tenant',
      tenantId,
      `Academia "${tenant.tradeName}" foi suspensa administrativamente. Motivo: ${reason}`,
      { tenantId, tenantName: tenant.tradeName, reason }
    );

    return true;
  },

  /**
   * Reativar uma academia com justificativa e auditoria
   */
  async reactivateTenant(
    tenantId: string,
    reason: string,
    actorUserId: string,
    actorUserName: string
  ): Promise<boolean> {
    const tenants = DataStore.getTenants();
    const tenant = tenants.find(t => t.id === tenantId);
    if (!tenant) throw new Error('Academia não encontrada.');

    tenant.status = 'active';
    DataStore.saveTenants(tenants);

    const subs = DataStore.getSaaSSubscriptions();
    const sub = subs.find(s => s.tenantId === tenantId);
    if (sub) {
      sub.status = 'active';
      sub.suspendedReason = undefined;
      sub.suspendedAt = undefined;
      sub.updatedAt = new Date().toISOString();
      DataStore.saveSaaSSubscriptions(subs);
    }

    DataStore.logPlatformAudit(
      actorUserId,
      actorUserName,
      'reactivate_tenant',
      'tenant',
      tenantId,
      `Acesso da academia "${tenant.tradeName}" foi reativado. Justificativa: ${reason || 'Regularização de pendências.'}`,
      { tenantId, tenantName: tenant.tradeName, reason }
    );

    return true;
  },

  /**
   * Alterar plano comercial contratado de uma academia
   */
  async changeTenantPlan(
    tenantId: string,
    newPlanId: string,
    reason: string,
    actorUserId: string,
    actorUserName: string
  ): Promise<boolean> {
    const tenants = DataStore.getTenants();
    const tenant = tenants.find(t => t.id === tenantId);
    if (!tenant) throw new Error('Academia não encontrada.');

    const plans = DataStore.getCommercialPlans();
    const targetPlan = plans.find(p => p.id === newPlanId);
    if (!targetPlan) throw new Error('Plano comercial selecionado não existe.');

    const oldPlanId = tenant.planId;
    tenant.planId = targetPlan.id as any;
    DataStore.saveTenants(tenants);

    const subs = DataStore.getSaaSSubscriptions();
    let sub = subs.find(s => s.tenantId === tenantId);
    if (sub) {
      sub.planId = targetPlan.id;
      sub.planName = targetPlan.name;
      sub.amount = targetPlan.price;
      sub.updatedAt = new Date().toISOString();
      DataStore.saveSaaSSubscriptions(subs);
    }

    DataStore.logPlatformAudit(
      actorUserId,
      actorUserName,
      'change_subscription_plan',
      'subscription',
      sub?.id || tenantId,
      `Plano da academia "${tenant.tradeName}" alterado de [${oldPlanId}] para [${targetPlan.name} - R$ ${targetPlan.price}]. Justificativa: ${reason || 'Upgrade/Downgrade solicitado'}`,
      { tenantId, tenantName: tenant.tradeName, reason, metadata: { oldPlanId, newPlanId } }
    );

    return true;
  },

  /**
   * Ativação manual da assinatura pelo proprietário do SaaS.
   * Exige justificativa formal, registra operador, não inventa falso pagamento mas concede dias de extensão.
   */
  async manualActivateSubscription(
    subscriptionId: string,
    reason: string,
    extendDays: number,
    actorUserId: string,
    actorUserName: string
  ): Promise<boolean> {
    if (!reason || reason.trim().length < 5) {
      throw new Error('A ativação manual exige uma justificativa formal com no mínimo 5 caracteres.');
    }

    const subs = DataStore.getSaaSSubscriptions();
    const sub = subs.find(s => s.id === subscriptionId);
    if (!sub) throw new Error('Assinatura não encontrada.');

    const days = Math.max(1, extendDays || 30);
    const newPeriodEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const newDueDate = newPeriodEnd.split('T')[0];

    sub.status = 'active';
    sub.currentPeriodEnd = newPeriodEnd;
    sub.nextDueDate = newDueDate;
    sub.manualActivation = {
      activatedByUserId: actorUserId,
      activatedByUserName: actorUserName,
      reason: reason.trim(),
      activatedAt: new Date().toISOString(),
      extendedDays: days,
    };
    sub.updatedAt = new Date().toISOString();
    DataStore.saveSaaSSubscriptions(subs);

    // Também atualizar status do tenant
    const tenants = DataStore.getTenants();
    const tenant = tenants.find(t => t.id === sub.tenantId);
    if (tenant) {
      tenant.status = 'active';
      DataStore.saveTenants(tenants);
    }

    DataStore.logPlatformAudit(
      actorUserId,
      actorUserName,
      'manual_activate_subscription',
      'subscription',
      subscriptionId,
      `Ativação manual de cortesia/concessão para a academia "${tenant?.tradeName || sub.tenantId}". Vigência estendida em ${days} dias (até ${newDueDate}). Motivo: ${reason}`,
      { tenantId: sub.tenantId, tenantName: tenant?.tradeName, reason }
    );

    return true;
  },

  /**
   * Processador de Webhook de Pagamento Seguro & Idempotente.
   * Não confia em chamadas livres de frontend nem em redirecionamentos.
   * Valida ID do evento, atualiza cobrança, estende vigência da assinatura e ativa tenant.
   */
  async processPaymentWebhookEvent(event: {
    eventId: string; // Ex: 'evt_asaas_100234'
    gatewayName: 'asaas' | 'mercadopago' | 'stripe';
    eventType: 'PAYMENT_RECEIVED' | 'PAYMENT_OVERDUE' | 'PAYMENT_REFUNDED' | 'PAYMENT_DELETED';
    chargeId: string;
    amount: number;
    tenantId: string;
    subscriptionId: string;
    paidAt?: string;
    paymentMethod?: 'pix' | 'credit_card' | 'boleto';
  }): Promise<{ success: boolean; duplicate: boolean; message: string }> {
    // 1. Verificação de idempotência no banco de eventos
    const processedEvents = DataStore.getPlatformAuditLogs().filter(
      l => l.action === 'process_payment_webhook' && l.metadata?.eventId === event.eventId
    );

    if (processedEvents.length > 0) {
      return {
        success: true,
        duplicate: true,
        message: `Evento de pagamento [${event.eventId}] já havia sido processado anteriormente (Idempotência garantida).`,
      };
    }

    // 2. Encontrar ou registrar cobrança correspondente
    const payments = DataStore.getSaaSPayments();
    let payment = payments.find(p => p.gatewayChargeId === event.chargeId || p.id === event.chargeId);

    const nowIso = new Date().toISOString();
    const paidDate = event.paidAt || nowIso;

    if (!payment) {
      payment = {
        id: `pay-${Date.now()}`,
        subscriptionId: event.subscriptionId,
        tenantId: event.tenantId,
        amount: event.amount,
        currency: 'BRL',
        dueDate: nowIso.split('T')[0],
        paidAt: paidDate,
        status: event.eventType === 'PAYMENT_RECEIVED' ? 'paid' : 'pending',
        paymentMethod: event.paymentMethod || 'pix',
        gatewayChargeId: event.chargeId,
        billingPeriodStart: nowIso.split('T')[0],
        billingPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        notes: `Cobrança gerada automaticamente pelo webhook do gateway [${event.gatewayName}].`,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      payments.unshift(payment);
    } else {
      if (event.eventType === 'PAYMENT_RECEIVED') {
        payment.status = 'paid';
        payment.paidAt = paidDate;
        payment.updatedAt = nowIso;
      } else if (event.eventType === 'PAYMENT_REFUNDED') {
        payment.status = 'refunded';
        payment.updatedAt = nowIso;
      } else if (event.eventType === 'PAYMENT_OVERDUE') {
        payment.status = 'failed';
        payment.updatedAt = nowIso;
      }
    }

    DataStore.saveSaaSPayments(payments);

    // 3. Atualizar assinatura e vigência
    const subs = DataStore.getSaaSSubscriptions();
    const sub = subs.find(s => s.id === event.subscriptionId || s.tenantId === event.tenantId);

    if (sub && event.eventType === 'PAYMENT_RECEIVED') {
      sub.status = 'active';
      sub.lastPaymentId = payment.id;
      // Estender vigência por 30 dias a partir da data atual ou do término atual
      const baseDate = Math.max(Date.now(), new Date(sub.currentPeriodEnd || nowIso).getTime());
      const extendedEnd = new Date(baseDate + 30 * 24 * 60 * 60 * 1000).toISOString();
      sub.currentPeriodStart = nowIso;
      sub.currentPeriodEnd = extendedEnd;
      sub.nextDueDate = extendedEnd.split('T')[0];
      sub.updatedAt = nowIso;
      DataStore.saveSaaSSubscriptions(subs);

      // 4. Liberar acesso à academia
      const tenants = DataStore.getTenants();
      const tenant = tenants.find(t => t.id === event.tenantId);
      if (tenant) {
        tenant.status = 'active';
        DataStore.saveTenants(tenants);
      }
    } else if (sub && event.eventType === 'PAYMENT_OVERDUE') {
      sub.status = 'past_due';
      sub.updatedAt = nowIso;
      DataStore.saveSaaSSubscriptions(subs);
    }

    // 5. Registrar log de auditoria do webhook
    DataStore.logPlatformAudit(
      'system-webhook',
      `Gateway ${event.gatewayName.toUpperCase()}`,
      'process_payment_webhook',
      'payment',
      payment.id,
      `Webhook processado: Pagamento de R$ ${event.amount.toFixed(2)} confirmado via ${event.paymentMethod?.toUpperCase() || 'PIX'}. Vigência da academia regularizada.`,
      {
        tenantId: event.tenantId,
        metadata: {
          eventId: event.eventId,
          gateway: event.gatewayName,
          chargeId: event.chargeId,
          amount: event.amount,
        },
      }
    );

    return {
      success: true,
      duplicate: false,
      message: `Pagamento de R$ ${event.amount.toFixed(2)} recebido com sucesso e acesso da academia liberado.`,
    };
  },

  /**
   * Atualiza limites comerciais customizados de uma licença específica (maxUsers, maxBranches, maxStudents).
   * Exclusivo para o proprietário global do SaaS (superadmin).
   */
  async updateLicenseLimits(
    tenantId: string,
    limits: {
      customMaxUsers?: number | null;
      customMaxBranches?: number | null;
      customMaxStudents?: number | null;
    },
    reason: string,
    actor: User
  ): Promise<SaaSSubscription> {
    if (actor.role !== 'superadmin') {
      throw new Error('Acesso negado (403): apenas o proprietário global do SaaS pode alterar os limites de licença.');
    }

    const tenants = DataStore.getTenants();
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) {
      throw new Error('Academia não encontrada.');
    }

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      await supabase.rpc('admin_update_license_limits', {
        p_tenant_id: tenantId,
        p_custom_max_users: limits.customMaxUsers ?? null,
        p_custom_max_branches: limits.customMaxBranches ?? null,
        p_custom_max_students: limits.customMaxStudents ?? null,
        p_reason: reason || 'Ajuste de limites pelo proprietário do SaaS',
      });
    }

    const subs = DataStore.getSaaSSubscriptions();
    let sub = subs.find((s) => s.tenantId === tenantId);
    const plans = DataStore.getCommercialPlans();
    const plan = plans.find((p) => p.id === tenant.planId) || plans[0];

    if (!sub) {
      const now = new Date().toISOString();
      sub = {
        id: `sub-${tenantId}`,
        tenantId,
        planId: tenant.planId,
        planName: plan.name,
        status: tenant.status === 'trial' ? 'trial' : 'active',
        billingCycle: 'monthly',
        amount: plan.price,
        startedAt: tenant.createdAt || now,
        currentPeriodStart: now,
        currentPeriodEnd: tenant.trialExpiresAt || now,
        nextDueDate: (tenant.trialExpiresAt || now).split('T')[0],
        trialExpiresAt: tenant.trialExpiresAt,
        gracePeriodDays: 5,
        createdAt: now,
        updatedAt: now,
      };
      subs.push(sub);
    }

    sub.customMaxUsers = limits.customMaxUsers && limits.customMaxUsers > 0 ? Number(limits.customMaxUsers) : undefined;
    sub.customMaxBranches =
      limits.customMaxBranches && limits.customMaxBranches > 0 ? Number(limits.customMaxBranches) : undefined;
    sub.customMaxStudents =
      limits.customMaxStudents && limits.customMaxStudents > 0 ? Number(limits.customMaxStudents) : undefined;
    sub.updatedAt = new Date().toISOString();

    DataStore.saveSaaSSubscriptions(subs);

    DataStore.logPlatformAudit(
      actor.id,
      actor.name,
      'update_license_limits',
      'subscription',
      sub.id,
      `Limites da licença da academia "${tenant.tradeName}" atualizados (Usuários: ${
        sub.customMaxUsers ?? plan.maxUsers
      }, Unidades: ${sub.customMaxBranches ?? plan.maxBranches}, Alunos: ${
        sub.customMaxStudents ?? plan.maxStudents
      }). Motivo: ${reason || 'Parametrização comercial'}`,
      {
        tenantId,
        tenantName: tenant.tradeName,
        reason,
        metadata: limits,
      }
    );

    return sub;
  },

  /**
   * Cria uma nova filial/unidade validando estritamente o limite de unidades contratadas (maxBranches)
   * no backend/serviço com proteção contra concorrência.
   * Regra: A Unidade Matriz conta como a 1ª unidade da licença.
   */
  async createBranchWithLimitCheck(
    payload: {
      tenantId: string;
      name: string;
      address?: string;
      phone?: string;
      email?: string;
      managerName?: string;
    },
    actor: User
  ): Promise<Branch> {
    return withBranchLock(payload.tenantId, async () => {
      if (!actor || !actor.active) {
        throw new Error('Sessão inválida ou usuário inativo.');
      }
      if (actor.role !== 'superadmin') {
        if (actor.tenantId !== payload.tenantId) {
          throw new Error('Violação de isolamento multi-tenant (403): você não pertence a esta academia.');
        }
        if (actor.role !== 'owner') {
          throw new Error('Permissão negada: apenas o Proprietário (owner) da academia pode cadastrar novas filiais.');
        }
      }

      if (!payload.name || !payload.name.trim()) {
        throw new Error('O nome da filial/unidade é obrigatório.');
      }

      const limits = this.getEffectiveLimits(payload.tenantId);
      const allBranches = DataStore.getBranches();
      const tenantBranches = allBranches.filter((b) => b.tenantId === payload.tenantId);

      if (tenantBranches.length >= limits.maxBranches) {
        throw new Error(
          `Limite de filiais/unidades atingido para a licença atual (${tenantBranches.length}/${limits.maxBranches} unidades cadastradas, incluindo a Unidade Matriz). Faça upgrade do seu plano para expandir novas filiais.`
        );
      }

      const newBranch: Branch = {
        id: `branch-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId: payload.tenantId,
        name: payload.name.trim(),
        isHeadquarter: tenantBranches.length === 0,
        phone: payload.phone?.trim() || '(11) 3456-0000',
        email: payload.email?.trim() || 'filial@tatameclub.com.br',
        address: payload.address?.trim() || 'Endereço da Unidade',
        managerName: payload.managerName?.trim() || actor.name,
        active: true,
      };

      DataStore.saveBranches([...allBranches, newBranch]);
      DataStore.logAudit(
        payload.tenantId,
        actor.id,
        actor.name,
        'Criação de Filial',
        'Branch',
        newBranch.id,
        `Nova unidade "${newBranch.name}" cadastrada (${tenantBranches.length + 1}/${limits.maxBranches} unidades utilizadas).`
      );

      return newBranch;
    });
  },

  /**
   * Registra uma nova academia de forma totalmente isolada (sem compartilhamento com dados de demonstração),
   * criando:
   * 1. Tenant com 10 dias de trial (trialStartedAt + trialExpiresAt)
   * 2. SaaSSubscription vinculada (status: 'trial', 10 dias)
   * 3. Unidade Matriz (1ª unidade de maxBranches)
   * 4. Usuário Proprietário (role: 'owner', 1º usuário ativo de maxUsers)
   * 5. Modalidades e faixas iniciais exclusivas do novo tenantId
   */
  registerAcademyIsolated(params: {
    tradeName: string;
    legalName?: string;
    cnpjOrCpf: string;
    adminName: string;
    email: string;
    phone?: string;
    whatsapp?: string;
    logoUrl?: string;
    address?: {
      street?: string;
      number?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      zipCode?: string;
    };
  }): {
    tenant: Tenant;
    branch: Branch;
    ownerUser: User;
    subscription: SaaSSubscription;
  } {
    const suffix = `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const tenantId = `tenant-${suffix}`;
    const branchId = `branch-matriz-${suffix}`;
    const userId = `user-owner-${suffix}`;

    const now = new Date();
    const trialExpiry = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const normalizedEmail = params.email.trim().toLowerCase();

    const newTenant: Tenant = {
      id: tenantId,
      tradeName: params.tradeName.trim(),
      legalName: (params.legalName || params.tradeName).trim(),
      cnpjOrCpf: params.cnpjOrCpf.trim(),
      adminName: params.adminName.trim(),
      email: normalizedEmail,
      phone: params.phone?.trim() || '(11) 98888-0000',
      whatsapp: (params.whatsapp || params.phone)?.trim() || '(11) 98888-0000',
      logoUrl: params.logoUrl || undefined,
      address: {
        street: params.address?.street?.trim() || 'Rua Principal',
        number: params.address?.number?.trim() || '100',
        neighborhood: params.address?.neighborhood?.trim() || 'Centro',
        city: params.address?.city?.trim() || 'São Paulo',
        state: params.address?.state?.trim() || 'SP',
        zipCode: params.address?.zipCode?.trim() || '01000-000',
      },
      planId: 'trial',
      status: 'trial',
      trialStartedAt: now.toISOString(),
      trialExpiresAt: trialExpiry.toISOString(),
      createdAt: now.toISOString(),
      retentionDays: 60,
      settings: {
        defaultDueDay: 10,
        penaltyRate: 2.0,
        dailyInterestRate: 0.033,
        familyDiscount2ndMember: 15,
        multiArtDiscount: 20,
        customBrandColor: '#dc2626',
      },
    };

    const newBranch: Branch = {
      id: branchId,
      tenantId,
      name: 'Unidade Matriz',
      isHeadquarter: true,
      phone: newTenant.phone,
      email: normalizedEmail,
      address: `${newTenant.address.street}, ${newTenant.address.number} - ${newTenant.address.city}/${newTenant.address.state}`,
      managerName: newTenant.adminName,
      active: true,
    };

    const newOwner: User = {
      id: userId,
      tenantId,
      branchId,
      name: newTenant.adminName,
      email: normalizedEmail,
      role: 'owner',
      phone: newTenant.phone,
      active: true,
      createdAt: now.toISOString(),
    };

    const newSubscription: SaaSSubscription = {
      id: `sub-${suffix}`,
      tenantId,
      planId: 'trial',
      planName: 'Degustação Gratuita (10 Dias)',
      status: 'trial',
      billingCycle: 'monthly',
      amount: 0,
      startedAt: now.toISOString(),
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: trialExpiry.toISOString(),
      nextDueDate: trialExpiry.toISOString().split('T')[0],
      trialExpiresAt: trialExpiry.toISOString(),
      gracePeriodDays: 5,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    // Persistir todas as entidades isoladas
    DataStore.saveTenants([...DataStore.getTenants(), newTenant]);
    DataStore.saveBranches([...DataStore.getBranches(), newBranch]);
    DataStore.saveUsers([...DataStore.getAllUsers(), newOwner]);
    DataStore.saveSaaSSubscription(newSubscription);
    DataStore.seedDefaultModalitiesForTenant(tenantId, branchId);

    DataStore.logAudit(
      tenantId,
      userId,
      newOwner.name,
      'Criação de Academia',
      'Tenant',
      tenantId,
      `Nova academia "${newTenant.tradeName}" cadastrada com 10 dias de teste gratuito isolado.`
    );

    DataStore.logPlatformAudit(
      userId,
      newOwner.name,
      'register_tenant',
      'tenant',
      tenantId,
      `Nova academia "${newTenant.tradeName}" registrada com período de teste de 10 dias (expira em ${trialExpiry.toISOString().split('T')[0]}).`,
      { tenantId, tenantName: newTenant.tradeName }
    );

    return {
      tenant: newTenant,
      branch: newBranch,
      ownerUser: newOwner,
      subscription: newSubscription,
    };
  },

  /**
   * Bootstrap seguro do proprietário global do SaaS (beaverstraining@gmail.com).
   * NUNCA utiliza senha fixa no código-fonte. Valida estritamente a identidade do e-mail autorizado.
   */
  async bootstrapPlatformOwner(params: {
    email: string;
    fullName?: string;
    userId?: string;
  }): Promise<User> {
    const normalizedEmail = params.email.trim().toLowerCase();
    if (!isAuthorizedPlatformOwnerEmail(normalizedEmail)) {
      throw new Error(
        `Acesso negado (403): o endereço "${normalizedEmail}" não corresponde à conta oficial do proprietário da plataforma (${OFFICIAL_DOMAINS.PLATFORM_OWNER_EMAIL}).`
      );
    }

    const allUsers = DataStore.getAllUsers();
    let ownerUser = allUsers.find(
      (u) => u.email.toLowerCase() === OFFICIAL_DOMAINS.PLATFORM_OWNER_EMAIL || u.role === 'superadmin'
    );

    if (!ownerUser) {
      ownerUser = {
        id: params.userId || 'user-superadmin',
        tenantId: 'platform',
        name: params.fullName?.trim() || 'Proprietário Tatame Club',
        email: OFFICIAL_DOMAINS.PLATFORM_OWNER_EMAIL,
        role: 'superadmin',
        phone: '(11) 99999-0000',
        active: true,
      };
      DataStore.saveUsers([ownerUser, ...allUsers]);
    } else {
      ownerUser.email = OFFICIAL_DOMAINS.PLATFORM_OWNER_EMAIL;
      ownerUser.role = 'superadmin';
      ownerUser.tenantId = 'platform';
      ownerUser.active = true;
      if (params.fullName?.trim()) {
        ownerUser.name = params.fullName.trim();
      }
      DataStore.saveUsers(allUsers);
    }

    DataStore.logPlatformAudit(
      ownerUser.id,
      ownerUser.name,
      'bootstrap_platform_owner',
      'user',
      ownerUser.id,
      `Proprietário global da plataforma Tatame Club (${OFFICIAL_DOMAINS.PLATFORM_OWNER_EMAIL}) verificado e habilitado com sucesso.`
    );

    return ownerUser;
  },
};
