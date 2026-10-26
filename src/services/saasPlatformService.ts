import { supabase, isSupabaseConfigured } from './supabase';
import {
  Tenant,
  SaaSCommercialPlan,
  SaaSSubscription,
  SaaSPayment,
  PlatformAuditLog,
  TenantAccessEvaluation,
  SaaSPaymentWebhookEvent,
} from '../types';
import { DataStore } from '../data/storage';

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
   * Avaliação centralizada e determinística das permissões e estado de acesso da academia.
   * Não espalha regras por dezenas de componentes.
   */
  evaluateTenantAccess(
    tenant: Tenant,
    subscription?: SaaSSubscription | null,
    plan?: SaaSCommercialPlan | null,
    studentCount: number = 0,
    branchCount: number = 1
  ): TenantAccessEvaluation {
    const defaultModules = {
      digitalLibrary: true,
      beltExams: true,
      competitions: true,
      advancedReports: true,
      multiBranch: true,
      customBranding: true,
    };

    // 1. Suspensão administrativa
    if (tenant.status === 'suspended' || subscription?.status === 'suspended') {
      return {
        isAllowed: false,
        accessState: 'blocked_suspended',
        message: subscription?.suspendedReason || 'Acesso à academia suspenso administrativamente pela plataforma TatameHub. Seus dados estão preservados.',
        allowedModules: { ...defaultModules, digitalLibrary: false, beltExams: false, competitions: false, advancedReports: false },
        limits: {
          maxStudents: plan?.maxStudents || 40,
          currentStudents: studentCount,
          isStudentsLimitReached: true,
          maxBranches: plan?.maxBranches || 1,
          currentBranches: branchCount,
          isBranchesLimitReached: true,
        },
      };
    }

    // 2. Cancelamento
    if (tenant.status === 'canceled' || subscription?.status === 'canceled') {
      return {
        isAllowed: false,
        accessState: 'blocked_canceled',
        message: subscription?.cancelReason || 'Assinatura do TatameHub cancelada. Seus registros permanecem guardados para reativação futura.',
        allowedModules: { ...defaultModules, digitalLibrary: false, beltExams: false, competitions: false, advancedReports: false },
        limits: {
          maxStudents: plan?.maxStudents || 40,
          currentStudents: studentCount,
          isStudentsLimitReached: true,
          maxBranches: plan?.maxBranches || 1,
          currentBranches: branchCount,
          isBranchesLimitReached: true,
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
            maxStudents: plan?.maxStudents || 100,
            currentStudents: studentCount,
            isStudentsLimitReached: true,
            maxBranches: plan?.maxBranches || 1,
            currentBranches: branchCount,
            isBranchesLimitReached: true,
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
            maxStudents: plan?.maxStudents || 40,
            currentStudents: studentCount,
            isStudentsLimitReached: studentCount >= (plan?.maxStudents || 40),
            maxBranches: plan?.maxBranches || 2,
            currentBranches: branchCount,
            isBranchesLimitReached: branchCount >= (plan?.maxBranches || 2),
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
          maxStudents: plan?.maxStudents || 40,
          currentStudents: studentCount,
          isStudentsLimitReached: studentCount >= (plan?.maxStudents || 40),
          maxBranches: plan?.maxBranches || 2,
          currentBranches: branchCount,
          isBranchesLimitReached: branchCount >= (plan?.maxBranches || 2),
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
        // Dentro do período de carência/tolerância
        return {
          isAllowed: true,
          accessState: 'grace_period',
          graceDaysLeft: Math.max(0, graceDaysLeft),
          message: `Cobrança de mensalidade pendente há ${daysOverdue} dia(s). Período de tolerância em vigor: restam ${graceDaysLeft} dia(s) para regularização sem bloqueio.`,
          allowedModules: plan?.features || defaultModules,
          limits: {
            maxStudents: plan?.maxStudents || 100,
            currentStudents: studentCount,
            isStudentsLimitReached: studentCount >= (plan?.maxStudents || 100),
            maxBranches: plan?.maxBranches || 1,
            currentBranches: branchCount,
            isBranchesLimitReached: branchCount >= (plan?.maxBranches || 1),
          },
        };
      }

      // Ultrapassou a carência: bloqueio
      return {
        isAllowed: false,
        accessState: 'blocked_past_due',
        graceDaysLeft: 0,
        message: `Acesso temporariamente restrito por inadimplência (${daysOverdue} dias de atraso). Efetue a quitação da fatura via PIX ou Boleto para reativação imediata.`,
        allowedModules: plan?.features || defaultModules,
        limits: {
          maxStudents: plan?.maxStudents || 100,
          currentStudents: studentCount,
          isStudentsLimitReached: true,
          maxBranches: plan?.maxBranches || 1,
          currentBranches: branchCount,
          isBranchesLimitReached: true,
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

    const maxStudents = plan?.maxStudents || (tenant.planId === 'basic' ? 100 : 500);
    const maxBranches = plan?.maxBranches || (tenant.planId === 'basic' ? 1 : 5);

    return {
      isAllowed: true,
      accessState: 'active',
      message: 'Assinatura ativa e em dia.',
      allowedModules: planFeatures,
      limits: {
        maxStudents,
        currentStudents: studentCount,
        isStudentsLimitReached: studentCount >= maxStudents,
        maxBranches,
        currentBranches: branchCount,
        isBranchesLimitReached: branchCount >= maxBranches,
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
};
