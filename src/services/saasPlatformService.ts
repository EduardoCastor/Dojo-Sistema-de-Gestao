import { supabase, isSupabaseConfigured } from './supabase';
import {
  Tenant,
  SaaSCommercialPlan,
  SaaSSubscription,
  SaaSPayment,
  SaaSSubscriptionEmailLog,
  PlatformAuditLog,
  TenantAccessEvaluation,
  BillingCycle,
  Branch,
  User,
} from '../types';
import { DataStore } from '../data/storage';
import { OFFICIAL_DOMAINS, isAuthorizedPlatformOwnerEmail } from '../utils/domainConfig';

export const TATAME_CLUB_COMPANY_INFO = {
  companyName: 'Beaver Soluções em Tecnologia',
  cnpj: '28.410.730/0001-80',
  productName: 'Tatame Club',
  siteUrl: 'https://tatameclub.com.br',
  globalAdminUrl: 'https://painel.tatameclub.com.br',
  financialEmail: 'financeiro@tatameclub.com.br',
  emailSubject: 'Tatame Club — Instruções de pagamento da sua assinatura',
  provisionalPixKey: '28410730000180',
  isProvisionalPixKey: true,
  provisionalPixNotice:
    'Chave Pix provisória (CNPJ da Beaver Soluções em Tecnologia sem pontuação: 28410730000180). A chave definitiva deverá ser validada junto à instituição bancária antes do uso em produção real.',
} as const;

export const BILLING_CYCLE_OPTIONS: Array<{
  id: BillingCycle;
  label: string;
  months: number;
  discountPercent: number;
  badge?: string;
}> = [
  { id: 'monthly', label: 'Mensal', months: 1, discountPercent: 0 },
  { id: 'quarterly', label: 'Trimestral', months: 3, discountPercent: 5, badge: '5% OFF' },
  { id: 'semiannual', label: 'Semestral', months: 6, discountPercent: 10, badge: '10% OFF' },
  { id: 'annual', label: 'Anual', months: 12, discountPercent: 15, badge: '15% OFF' },
];

export interface PlanCyclePricing {
  planId: string;
  planName: string;
  billingCycle: BillingCycle;
  billingCycleLabel: string;
  months: number;
  baseMonthlyPrice: number;
  effectiveMonthlyPrice: number;
  totalAmount: number;
  discountPercent: number;
}

export interface EmailDispatchDiagnostic {
  emailSent: boolean;
  status: 'sent' | 'failed' | 'missing_config';
  recipientEmail: string;
  subject: string;
  provider: string;
  messageId?: string;
  errorMessage?: string;
  missingSecrets?: string[];
  pixKey: string;
  isProvisionalPixKey: boolean;
  logId?: string;
}

export interface PlanSubscriptionRequestResult {
  success: boolean;
  reusedExistingPayment: boolean;
  tenant: Tenant;
  subscription: SaaSSubscription;
  payment: SaaSPayment;
  pricing: PlanCyclePricing;
  emailDispatch: EmailDispatchDiagnostic;
  pixConfig: {
    pixKey: string;
    isProvisional: boolean;
    beneficiaryName: string;
    beneficiaryCnpj: string;
    receiptEmail: string;
    provisionalNotice: string;
  };
}

export type TestEmailTransportFn = (payload: {
  tenantId: string;
  tenantName: string;
  recipientEmail: string;
  subject: string;
  planId: string;
  planName: string;
  billingCycle: BillingCycle;
  amount: number;
  subscriptionId: string;
  paymentId: string;
  paymentReference: string;
  pixKey: string;
  isProvisionalPixKey: boolean;
}) => Promise<{
  sent: boolean;
  status: 'sent' | 'failed' | 'missing_config';
  messageId?: string;
  error?: string;
  missingSecrets?: string[];
}>;

let customTestEmailTransport: TestEmailTransportFn | null = null;

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

function assertGlobalAdminActor(actorUserId: string, actorUserName?: string, actorEmail?: string): void {
  const allUsers = DataStore.getAllUsers();
  const matchedById = allUsers.find((u) => u.id === actorUserId);

  if (actorEmail) {
    if (!isAuthorizedPlatformOwnerEmail(actorEmail.trim().toLowerCase())) {
      throw new Error(
        `Acesso negado (403): o e-mail "${actorEmail}" não pertence a um Administrador Global autorizado (${OFFICIAL_DOMAINS.platformOwnerEmails.join(' e ')}).`
      );
    }
  }

  if (matchedById) {
    if (matchedById.role !== 'superadmin' || !isAuthorizedPlatformOwnerEmail(matchedById.email)) {
      throw new Error(
        'Acesso negado (403): apenas Administradores Globais do Tatame Club podem alterar planos ou licenças de academias.'
      );
    }
    return;
  }

  if (!actorUserId || actorUserId.trim() === '') {
    throw new Error('Identificação do Administrador Global obrigatória para realizar esta operação.');
  }
}

function mapSupabaseTenantRow(r: any, existing?: Tenant): Tenant {
  const settingsObj = typeof r.settings === 'object' && r.settings !== null ? r.settings : {};
  return {
    id: r.id,
    tradeName: r.name || r.tradeName || existing?.tradeName || 'Academia',
    legalName: r.legal_name || r.legalName || r.name || existing?.legalName || 'Academia',
    cnpjOrCpf: r.cnpj || r.cnpjOrCpf || existing?.cnpjOrCpf || '',
    cnpj: r.cnpj || existing?.cnpj,
    adminName: settingsObj.adminName || existing?.adminName || 'Administrador',
    email: r.email || existing?.email || '',
    phone: r.phone || existing?.phone || '',
    whatsapp: r.whatsapp || r.phone || existing?.whatsapp || '',
    website: r.website || existing?.website,
    logoUrl: r.logo_url || r.logoUrl || existing?.logoUrl,
    address: {
      street: r.address_street ?? existing?.address?.street ?? '',
      number: r.address_number ?? existing?.address?.number ?? '',
      complement: r.address_complement ?? existing?.address?.complement,
      neighborhood: r.address_neighborhood ?? existing?.address?.neighborhood ?? '',
      city: r.address_city ?? existing?.address?.city ?? '',
      state: r.address_state ?? existing?.address?.state ?? '',
      zipCode: r.address_zip ?? existing?.address?.zipCode ?? '',
      zip: r.address_zip ?? existing?.address?.zip,
    },
    planId: (r.plan_id || r.planId || existing?.planId || 'trial') as Tenant['planId'],
    status: (r.status || existing?.status || 'trial') as Tenant['status'],
    suspendedAt: r.suspended_at ?? existing?.suspendedAt,
    suspendedReason: r.suspended_reason ?? existing?.suspendedReason,
    trialStartedAt: r.trial_started_at || r.trialStartedAt || existing?.trialStartedAt || r.created_at || new Date().toISOString(),
    trialExpiresAt: r.trial_expires_at || r.trialExpiresAt || existing?.trialExpiresAt || new Date().toISOString(),
    createdAt: r.created_at || r.createdAt || existing?.createdAt || new Date().toISOString(),
    updatedAt: r.updated_at || r.updatedAt || existing?.updatedAt || new Date().toISOString(),
    retentionDays: existing?.retentionDays ?? 60,
    settings: {
      defaultDueDay: Number(settingsObj.defaultDueDay ?? existing?.settings?.defaultDueDay ?? 10),
      penaltyRate: Number(settingsObj.penaltyRate ?? existing?.settings?.penaltyRate ?? 2.0),
      dailyInterestRate: Number(settingsObj.dailyInterestRate ?? existing?.settings?.dailyInterestRate ?? 0.033),
      familyDiscount2ndMember: Number(settingsObj.familyDiscount2ndMember ?? existing?.settings?.familyDiscount2ndMember ?? 15),
      multiArtDiscount: Number(settingsObj.multiArtDiscount ?? existing?.settings?.multiArtDiscount ?? 20),
      customBrandColor: settingsObj.customBrandColor ?? existing?.settings?.customBrandColor ?? '#dc2626',
      allowMultipleCheckinsPerDay: settingsObj.allowMultipleCheckinsPerDay ?? existing?.settings?.allowMultipleCheckinsPerDay,
      requireMedicalClearance: settingsObj.requireMedicalClearance ?? existing?.settings?.requireMedicalClearance,
      autoBlockDelinquentAfterDays: settingsObj.autoBlockDelinquentAfterDays ?? existing?.settings?.autoBlockDelinquentAfterDays,
      pixKey: settingsObj.pixKey ?? existing?.settings?.pixKey,
      pixBeneficiaryName: settingsObj.pixBeneficiaryName ?? existing?.settings?.pixBeneficiaryName,
      defaultLateFeePercent: settingsObj.defaultLateFeePercent ?? existing?.settings?.defaultLateFeePercent,
    },
  };
}

function mapSupabasePlanRow(r: any): SaaSCommercialPlan {
  const monthlyPrice = Number(r.monthly_price ?? r.price ?? 0);
  const annualPrice = r.annual_price !== undefined && r.annual_price !== null ? Number(r.annual_price) : undefined;
  const maxBranches = Number(r.max_branches ?? r.maxBranches ?? 1);
  return {
    id: r.id,
    name: r.name,
    description: r.description || '',
    tagline: r.tagline || r.description || '',
    price: monthlyPrice,
    annualPrice,
    currency: 'BRL',
    billingCycle: r.billing_cycle || r.billingCycle || 'monthly',
    cycleMultiplier: r.cycle_multiplier || 1,
    trialDays: Number(r.trial_days ?? (r.id === 'trial' ? 14 : 0)),
    maxStudents: Number(r.max_students ?? r.maxStudents ?? 100),
    maxBranches,
    maxUsers: Number(r.max_team_users ?? r.max_users ?? r.maxUsers ?? 5),
    maxClasses: Number(r.max_classes ?? 20),
    maxStorageGb: Number(r.max_storage_gb ?? (r.id === 'enterprise' ? 200 : r.id === 'advanced' ? 50 : 10)),
    features: r.features || {
      digitalLibrary: Boolean(r.allow_digital_library ?? (r.id !== 'basic')),
      beltExams: true,
      competitions: Boolean(r.allow_competitions ?? (r.id !== 'basic')),
      advancedReports: Boolean(r.id !== 'basic'),
      multiBranch: maxBranches > 1,
      customBranding: Boolean(r.id !== 'basic'),
      automatedNotifications: Boolean(r.id !== 'basic'),
    },
    active: r.active !== false,
    createdAt: r.created_at || new Date().toISOString(),
    updatedAt: r.updated_at || r.created_at || new Date().toISOString(),
  };
}

function mapSupabaseSubscriptionRow(r: any): SaaSSubscription {
  const periodEnd = r.current_period_end || r.currentPeriodEnd || r.trial_expires_at || new Date().toISOString();
  const nextDue = r.next_due_date || r.nextDueDate || String(periodEnd).split('T')[0];
  return {
    id: r.id,
    tenantId: r.tenant_id || r.tenantId,
    tenantName: r.tenant_name || r.tenantName,
    planId: r.plan_id || r.planId,
    planName: r.plan_name || r.planName,
    requestedPlanId: r.requested_plan_id ?? r.requestedPlanId ?? undefined,
    requestedBillingCycle: r.requested_billing_cycle ?? r.requestedBillingCycle ?? undefined,
    requestedAmount:
      r.requested_amount !== undefined && r.requested_amount !== null ? Number(r.requested_amount) : undefined,
    paymentRequestedAt: r.payment_requested_at ?? r.paymentRequestedAt ?? undefined,
    lastEmailSentAt: r.last_email_sent_at ?? r.lastEmailSentAt ?? undefined,
    lastEmailStatus: r.last_email_status ?? r.lastEmailStatus ?? undefined,
    lastEmailError: r.last_email_error ?? r.lastEmailError ?? undefined,
    lastPaymentConfirmedAt: r.last_payment_confirmed_at ?? r.lastPaymentConfirmedAt ?? undefined,
    lastPaymentConfirmedBy: r.last_payment_confirmed_by ?? r.lastPaymentConfirmedBy ?? undefined,
    status: r.status,
    billingCycle: (r.billing_cycle || r.billingCycle || 'monthly') as BillingCycle,
    amount: Number(r.amount ?? 0),
    startedAt: r.started_at || r.trial_started_at || r.created_at || new Date().toISOString(),
    currentPeriodStart: r.current_period_start || r.created_at || new Date().toISOString(),
    currentPeriodEnd: periodEnd,
    nextDueDate: nextDue,
    trialExpiresAt: r.trial_expires_at ?? r.trialExpiresAt ?? undefined,
    gracePeriodDays: Number(r.grace_period_days ?? 5),
    customMaxUsers: r.custom_max_users ?? r.customMaxUsers ?? undefined,
    customMaxBranches: r.custom_max_branches ?? r.customMaxBranches ?? undefined,
    customMaxStudents: r.custom_max_students ?? r.customMaxStudents ?? undefined,
    gatewayCustomerId: r.gateway_customer_id ?? undefined,
    gatewaySubscriptionId: r.gateway_subscription_id ?? undefined,
    cancelReason: r.cancel_reason ?? undefined,
    canceledAt: r.canceled_at ?? undefined,
    suspendedReason: r.suspended_reason ?? undefined,
    suspendedAt: r.suspended_at ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at || new Date().toISOString(),
    updatedAt: r.updated_at || r.created_at || new Date().toISOString(),
  };
}

function mapSupabasePaymentRow(r: any): SaaSPayment {
  const dueDate = r.due_date || r.dueDate || new Date().toISOString().split('T')[0];
  return {
    id: r.id,
    subscriptionId: r.subscription_id || r.subscriptionId || '',
    tenantId: r.tenant_id || r.tenantId,
    tenantName: r.tenant_name || r.tenantName,
    planId: r.plan_id || r.planId,
    planName: r.plan_name || r.planName,
    billingCycle: (r.billing_cycle || r.billingCycle || 'monthly') as BillingCycle,
    amount: Number(r.amount ?? 0),
    currency: 'BRL',
    dueDate: String(dueDate).split('T')[0],
    paidAt: r.paid_at || r.paidAt || undefined,
    status: r.status,
    paymentMethod: (r.payment_method || r.paymentMethod || 'pix') as SaaSPayment['paymentMethod'],
    payerEmail: r.payer_email || r.payerEmail || undefined,
    pixKey: r.pix_key || r.pixKey || TATAME_CLUB_COMPANY_INFO.provisionalPixKey,
    pixKeyProvisional: r.pix_key_provisional ?? r.pixKeyProvisional ?? true,
    referenceId: r.reference_id || r.referenceId || undefined,
    confirmedByUserId: r.confirmed_by_user_id || undefined,
    confirmedByUserName: r.confirmed_by_user_name || undefined,
    confirmationNotes: r.confirmation_notes || undefined,
    gatewayChargeId: r.gateway_charge_id || undefined,
    gatewayPaymentId: r.gateway_payment_id || undefined,
    billingPeriodStart: r.billing_period_start || String(dueDate).split('T')[0],
    billingPeriodEnd: r.billing_period_end || String(dueDate).split('T')[0],
    invoiceUrl: r.invoice_url || undefined,
    pixQrCode: r.pix_qr_code || undefined,
    pixCopyPaste: r.pix_copy_paste || undefined,
    barcode: r.barcode || undefined,
    notes: r.notes || undefined,
    createdAt: r.created_at || new Date().toISOString(),
    updatedAt: r.updated_at || r.created_at || new Date().toISOString(),
  };
}

function mapSupabaseAuditLogRow(r: any): PlatformAuditLog {
  return {
    id: r.id,
    actorUserId: r.actor_user_id || r.actorUserId || 'system',
    actorUserName: r.actor_user_name || r.actorUserName || 'Administrador Global',
    action: (r.action || 'change_tenant_plan') as PlatformAuditLog['action'],
    entityType: (r.entity_type || (r.tenant_id ? 'tenant' : 'subscription')) as PlatformAuditLog['entityType'],
    entityId: r.entity_id || r.tenant_id || r.id,
    tenantId: r.tenant_id || r.tenantId || undefined,
    tenantName: r.tenant_name || r.tenantName || undefined,
    reason: r.metadata?.reason || r.reason || undefined,
    details: r.description || r.details || '',
    metadata: r.metadata || undefined,
    timestamp: r.created_at || r.timestamp || new Date().toISOString(),
  };
}

function mapSupabaseEmailLogRow(r: any): SaaSSubscriptionEmailLog {
  return {
    id: r.id,
    tenantId: r.tenant_id || r.tenantId,
    subscriptionId: r.subscription_id || r.subscriptionId || undefined,
    paymentId: r.payment_id || r.paymentId || undefined,
    recipientEmail: r.recipient_email || r.recipientEmail,
    subject: r.subject || TATAME_CLUB_COMPANY_INFO.emailSubject,
    planId: r.plan_id || r.planId,
    planName: r.plan_name || r.planName,
    billingCycle: (r.billing_cycle || r.billingCycle || 'monthly') as BillingCycle,
    amount: Number(r.amount ?? 0),
    pixKeyUsed: r.pix_key_used || r.pixKeyUsed || TATAME_CLUB_COMPANY_INFO.provisionalPixKey,
    isProvisionalPixKey: Boolean(r.is_provisional_pix_key ?? r.isProvisionalPixKey ?? true),
    status: r.status,
    provider: r.provider || 'resend',
    providerMessageId: r.provider_message_id || undefined,
    errorMessage: r.error_message || undefined,
    triggeredByUserId: r.triggered_by_user_id || undefined,
    createdAt: r.created_at || new Date().toISOString(),
  };
}

export interface PlatformMetrics {
  totalTenants: number;
  activeSubscriptions: number;
  trialSubscriptions: number;
  pendingPaymentSubscriptions?: number;
  pastDueSubscriptions: number;
  suspendedTenants: number;
  canceledSubscriptions: number;
  estimatedMRR: number;
  confirmedRevenueMonth: number;
  confirmedRevenueTotal: number;
}

export const saasPlatformService = {
  /**
   * Retorna a configuração centralizada de Pix (provisória até validação bancária) e dados institucionais.
   */
  getCentralizedPixConfig() {
    return {
      pixKey: TATAME_CLUB_COMPANY_INFO.provisionalPixKey,
      isProvisional: TATAME_CLUB_COMPANY_INFO.isProvisionalPixKey,
      beneficiaryName: TATAME_CLUB_COMPANY_INFO.companyName,
      beneficiaryCnpj: TATAME_CLUB_COMPANY_INFO.cnpj,
      productName: TATAME_CLUB_COMPANY_INFO.productName,
      receiptEmail: TATAME_CLUB_COMPANY_INFO.financialEmail,
      emailSubject: TATAME_CLUB_COMPANY_INFO.emailSubject,
      provisionalNotice: TATAME_CLUB_COMPANY_INFO.provisionalPixNotice,
    };
  },

  /**
   * Permite injetar transporte de e-mail determinístico apenas para suítes de testes automatizados.
   */
  setTestEmailTransport(transport: TestEmailTransportFn | null) {
    customTestEmailTransport = transport;
  },

  /**
   * Calcula de forma determinística o valor mensal equivalente e o valor total do ciclo escolhido.
   */
  calculatePlanCyclePricing(plan: SaaSCommercialPlan, billingCycle: BillingCycle = 'monthly'): PlanCyclePricing {
    const cycleMeta = BILLING_CYCLE_OPTIONS.find((c) => c.id === billingCycle) || BILLING_CYCLE_OPTIONS[0];
    const baseMonthlyPrice = Number(plan.price || 0);
    let effectiveMonthlyPrice = baseMonthlyPrice;
    let totalAmount = baseMonthlyPrice;

    if (billingCycle === 'monthly') {
      effectiveMonthlyPrice = Number(baseMonthlyPrice.toFixed(2));
      totalAmount = Number(baseMonthlyPrice.toFixed(2));
    } else if (billingCycle === 'quarterly') {
      effectiveMonthlyPrice = Number((baseMonthlyPrice * 0.95).toFixed(2));
      totalAmount = Number((baseMonthlyPrice * 3 * 0.95).toFixed(2));
    } else if (billingCycle === 'semiannual') {
      effectiveMonthlyPrice = Number((baseMonthlyPrice * 0.9).toFixed(2));
      totalAmount = Number((baseMonthlyPrice * 6 * 0.9).toFixed(2));
    } else if (billingCycle === 'annual') {
      if (plan.annualPrice && plan.annualPrice > 0) {
        totalAmount = Number(plan.annualPrice.toFixed(2));
        effectiveMonthlyPrice = Number((plan.annualPrice / 12).toFixed(2));
      } else {
        effectiveMonthlyPrice = Number((baseMonthlyPrice * 0.85).toFixed(2));
        totalAmount = Number((baseMonthlyPrice * 12 * 0.85).toFixed(2));
      }
    }

    return {
      planId: plan.id,
      planName: plan.name,
      billingCycle: cycleMeta.id,
      billingCycleLabel: cycleMeta.label,
      months: cycleMeta.months,
      baseMonthlyPrice,
      effectiveMonthlyPrice,
      totalAmount,
      discountPercent: cycleMeta.discountPercent,
    };
  },

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
    const planId =
      sub?.status === 'active'
        ? sub.planId
        : tenant?.status === 'active'
        ? tenant.planId
        : sub?.planId || tenant?.planId || 'trial';
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
   * Regras críticas:
   * - Seleção de plano comercial sem pagamento confirmado (pending_payment / waiting_payment) NÃO libera acesso se a degustação expirou.
   * - Licença comercial confirmada (tenant.status === 'active' && subscription.status === 'active') tem prioridade sobre datas históricas de trial expiradas.
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
        : DataStore.getUsers(tenant.id).filter(
            (u) => u.active && u.role !== 'superadmin' && u.role !== 'student' && u.role !== 'guardian'
          ).length;

    const effectivePlanId = subscription?.planId || tenant.planId || 'trial';
    const effectiveMaxStudents =
      subscription?.customMaxStudents ??
      plan?.maxStudents ??
      (effectivePlanId === 'basic' ? 100 : effectivePlanId === 'trial' ? 40 : effectivePlanId === 'enterprise' ? 2000 : 500);
    const effectiveMaxBranches =
      subscription?.customMaxBranches ??
      plan?.maxBranches ??
      (effectivePlanId === 'basic' ? 1 : effectivePlanId === 'trial' ? 2 : effectivePlanId === 'enterprise' ? 20 : 5);
    const effectiveMaxUsers =
      subscription?.customMaxUsers ??
      plan?.maxUsers ??
      (effectivePlanId === 'advanced' ? 20 : effectivePlanId === 'enterprise' ? 100 : 5);

    const planFeatures = plan?.features || {
      digitalLibrary: effectivePlanId !== 'basic',
      beltExams: true,
      competitions: effectivePlanId !== 'basic',
      advancedReports: effectivePlanId !== 'basic',
      multiBranch: effectiveMaxBranches > 1,
      customBranding: effectivePlanId !== 'basic',
      automatedNotifications: effectivePlanId !== 'basic',
    };

    // 1. Suspensão administrativa
    if (tenant.status === 'suspended' || subscription?.status === 'suspended') {
      return {
        isAllowed: false,
        accessState: 'blocked_suspended',
        message:
          subscription?.suspendedReason ||
          tenant.suspendedReason ||
          'Acesso à academia suspenso administrativamente pela plataforma Tatame Club. Seus dados estão preservados.',
        allowedModules: {
          ...defaultModules,
          digitalLibrary: false,
          beltExams: false,
          competitions: false,
          advancedReports: false,
        },
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
        message:
          subscription?.cancelReason ||
          'Assinatura do Tatame Club cancelada. Seus registros permanecem guardados para reativação futura.',
        allowedModules: {
          ...defaultModules,
          digitalLibrary: false,
          beltExams: false,
          competitions: false,
          advancedReports: false,
        },
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

    // 3. Assinatura comercial explicitamente ATIVA (prioridade sobre data histórica de trial expirada!)
    const isCommercialPlan = tenant.planId !== 'trial' || (subscription?.planId && subscription.planId !== 'trial');
    if (tenant.status === 'active' && (!subscription || subscription.status === 'active') && isCommercialPlan) {
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
    }

    // 4. Pagamento Pendente / Aguardando Pagamento / Em Análise (pending_payment, waiting_payment, payment_under_review)
    if (
      subscription?.status === 'pending_payment' ||
      subscription?.status === 'waiting_payment' ||
      subscription?.status === 'payment_under_review'
    ) {
      const trialExpiryMs = new Date(subscription?.trialExpiresAt || tenant.trialExpiresAt).getTime();
      const nowMs = Date.now();
      const diffMs = trialExpiryMs - nowMs;
      const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const isTrialStillValid = !Number.isNaN(trialExpiryMs) && daysLeft >= 0;

      if (isTrialStillValid) {
        return {
          isAllowed: true,
          accessState: 'trial',
          daysRemaining: Math.max(0, daysLeft),
          message: `Solicitação do ${subscription.planName} registrada (aguardando confirmação do Pix). Degustação ativa por mais ${Math.max(0, daysLeft)} dia(s).`,
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

      const mappedState =
        subscription.status === 'payment_under_review'
          ? 'payment_under_review'
          : subscription.status === 'pending_payment'
          ? 'pending_payment'
          : 'waiting_payment';

      return {
        isAllowed: false,
        accessState: mappedState,
        daysRemaining: 0,
        message:
          subscription.status === 'payment_under_review'
            ? `Comprovante do ${subscription.planName} em análise financeira. O acesso será liberado assim que o pagamento for validado.`
            : `Solicitação de contratação do ${subscription.planName} registrada (Status: Pagamento Pendente). Efetue o pagamento via Pix e envie o comprovante para liberação do acesso.`,
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

    // 5. Pagamento Rejeitado
    if (subscription?.status === 'rejected') {
      return {
        isAllowed: false,
        accessState: 'rejected',
        daysRemaining: 0,
        message:
          subscription.notes ||
          'O pagamento informado não pôde ser confirmado. Verifique as instruções de Pix ou envie um comprovante válido.',
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

    // 6. Inadimplência / Pagamento Atrasado (past_due)
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
      }

      return {
        isAllowed: false,
        accessState: 'blocked_past_due',
        graceDaysLeft: 0,
        message: `Acesso temporariamente restrito por inadimplência (${daysOverdue} dias de atraso). Efetue a quitação da fatura via PIX para reativação imediata.`,
        allowedModules: planFeatures,
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

    // 7. Status de Degustação (Trial) ou Expirado
    if (
      tenant.status === 'trial' ||
      tenant.status === 'expired' ||
      subscription?.status === 'trial' ||
      subscription?.status === 'expired' ||
      tenant.planId === 'trial'
    ) {
      const trialExpiry = new Date(subscription?.trialExpiresAt || tenant.trialExpiresAt).getTime();
      const now = Date.now();
      const diffMs = trialExpiry - now;
      const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (daysLeft < 0 || tenant.status === 'expired' || subscription?.status === 'expired') {
        return {
          isAllowed: false,
          accessState: 'trial_expired',
          daysRemaining: 0,
          message:
            'Seu período de degustação gratuita terminou. Selecione um plano comercial e conclua o pagamento via Pix para continuar gerenciando sua academia sem perder seus dados.',
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
        message: `Período de degustação ativo: restam ${daysLeft} dia(s) de avaliação gratuita.`,
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

    // 8. Fallback Assinatura Ativa
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
   * Sincroniza o estado completo da assinatura e licença de uma academia diretamente do Supabase.
   */
  async syncTenantSubscriptionState(tenantId: string): Promise<{
    tenant: Tenant | null;
    subscription: SaaSSubscription | null;
    payments: SaaSPayment[];
    emailLogs: SaaSSubscriptionEmailLog[];
    commercialPlans: SaaSCommercialPlan[];
    evaluation: TenantAccessEvaluation | null;
  }> {
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      try {
        const { data, error } = await supabase.rpc('get_tenant_subscription_overview', {
          p_tenant_id: tenantId,
        });

        if (!error && data && data.tenant) {
          const allTenants = DataStore.getTenants();
          const existingTenant = allTenants.find((t) => t.id === tenantId);
          const mappedTenant = mapSupabaseTenantRow(data.tenant, existingTenant);

          const tenantIdx = allTenants.findIndex((t) => t.id === tenantId);
          if (tenantIdx >= 0) {
            allTenants[tenantIdx] = mappedTenant;
          } else {
            allTenants.unshift(mappedTenant);
          }
          DataStore.saveTenants(allTenants);

          let mappedSub: SaaSSubscription | null = null;
          if (data.subscription) {
            mappedSub = mapSupabaseSubscriptionRow(data.subscription);
            DataStore.saveSaaSSubscription(mappedSub);
          }

          const mappedPlans: SaaSCommercialPlan[] = Array.isArray(data.commercial_plans)
            ? data.commercial_plans.map(mapSupabasePlanRow)
            : DataStore.getCommercialPlans();
          if (mappedPlans.length > 0) {
            DataStore.saveCommercialPlans(mappedPlans);
          }

          const mappedPayments: SaaSPayment[] = Array.isArray(data.payments)
            ? data.payments.map(mapSupabasePaymentRow)
            : [];
          for (const p of mappedPayments) {
            DataStore.saveSaaSPayment(p);
          }

          const mappedEmailLogs: SaaSSubscriptionEmailLog[] = Array.isArray(data.email_logs)
            ? data.email_logs.map(mapSupabaseEmailLogRow)
            : [];
          for (const l of mappedEmailLogs) {
            DataStore.saveSaaSEmailLog(l);
          }

          const matchedPlan = mappedPlans.find(
            (p) => p.id === (mappedSub?.planId || mappedTenant.planId)
          );
          const evaluation = this.evaluateTenantAccess(
            mappedTenant,
            mappedSub,
            matchedPlan,
            DataStore.getStudents(tenantId).length,
            DataStore.getBranches(tenantId).length
          );

          return {
            tenant: mappedTenant,
            subscription: mappedSub,
            payments: mappedPayments,
            emailLogs: mappedEmailLogs,
            commercialPlans: mappedPlans,
            evaluation,
          };
        }
      } catch (err) {
        console.warn('Falha ao consultar get_tenant_subscription_overview no Supabase:', err);
      }
    }

    const tenant = DataStore.getTenants().find((t) => t.id === tenantId) || null;
    const subscription = DataStore.getSaaSSubscriptions(tenantId)[0] || null;
    const payments = DataStore.getSaaSPayments(tenantId);
    const emailLogs = DataStore.getSaaSEmailLogs(tenantId);
    const commercialPlans = DataStore.getCommercialPlans();
    const matchedPlan = tenant
      ? commercialPlans.find((p) => p.id === (subscription?.planId || tenant.planId))
      : null;

    const evaluation = tenant
      ? this.evaluateTenantAccess(
          tenant,
          subscription,
          matchedPlan,
          DataStore.getStudents(tenantId).length,
          DataStore.getBranches(tenantId).length
        )
      : null;

    return {
      tenant,
      subscription,
      payments,
      emailLogs,
      commercialPlans,
      evaluation,
    };
  },

  /**
   * CORREÇÃO 1: Registra a solicitação de contratação de um plano comercial após/durante a degustação,
   * define o status explícito 'pending_payment' (sem liberar acesso pago antes da confirmação) e
   * aciona o envio automático do e-mail com as instruções de pagamento Pix.
   */
  async requestPlanSubscriptionAndSendEmail(params: {
    tenantId: string;
    planId: string;
    billingCycle?: BillingCycle;
    recipientEmail?: string;
    actorUserId?: string;
    actorUserName?: string;
    notes?: string;
  }): Promise<PlanSubscriptionRequestResult> {
    const billingCycle: BillingCycle = params.billingCycle || 'monthly';
    if (!['monthly', 'quarterly', 'semiannual', 'annual'].includes(billingCycle)) {
      throw new Error(`Ciclo de cobrança inválido (${billingCycle}).`);
    }

    if (!params.planId || params.planId === 'trial') {
      throw new Error('Selecione um plano comercial válido (Básico, Avançado ou Enterprise) para contratar.');
    }

    const plans = await this.fetchPlans();
    const selectedPlan = plans.find((p) => p.id === params.planId && p.active !== false);
    if (!selectedPlan) {
      throw new Error(`O plano selecionado (${params.planId}) não está disponível para contratação.`);
    }

    const tenants = DataStore.getTenants();
    let tenant = tenants.find((t) => t.id === params.tenantId);
    if (!tenant) {
      throw new Error('Academia não encontrada para registrar a solicitação de assinatura.');
    }

    const recipientEmail = (params.recipientEmail || tenant.email || '').trim().toLowerCase();
    if (!recipientEmail || !recipientEmail.includes('@')) {
      throw new Error('A academia não possui um e-mail administrativo válido para receber as instruções de pagamento.');
    }

    const pricing = this.calculatePlanCyclePricing(selectedPlan, billingCycle);
    const pixConfig = this.getCentralizedPixConfig();
    let subscription: SaaSSubscription | undefined;
    let payment: SaaSPayment | undefined;
    let reusedExistingPayment = false;

    // 1. Persistir no Supabase via RPC transacional quando disponível
    if (isSupabaseConfigured() && supabase && isValidUUID(params.tenantId)) {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('request_saas_plan_subscription', {
        p_tenant_id: params.tenantId,
        p_plan_id: selectedPlan.id,
        p_billing_cycle: billingCycle,
        p_payer_email: recipientEmail,
        p_pix_key: pixConfig.pixKey,
        p_notes: params.notes || null,
      });

      if (rpcErr) {
        throw new Error(`Falha ao registrar solicitação de plano no banco de dados: ${rpcErr.message}`);
      }

      if (rpcData) {
        reusedExistingPayment = Boolean(rpcData.reused_existing_payment);
        const synced = await this.syncTenantSubscriptionState(params.tenantId);
        if (synced.tenant) tenant = synced.tenant;
        if (synced.subscription) subscription = synced.subscription;
        payment = synced.payments.find((p) => p.id === rpcData.payment_id) || synced.payments[0];
      }
    }

    // 2. Fallback / Sincronização no DataStore local (sem liberar tenant.status = 'active'!)
    if (!subscription || !payment) {
      const nowIso = new Date().toISOString();
      const dueIso = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const periodEndIso = new Date(Date.now() + pricing.months * 30 * 24 * 60 * 60 * 1000).toISOString();

      const existingSubs = DataStore.getSaaSSubscriptions();
      const existingSub = existingSubs.find((s) => s.tenantId === params.tenantId);

      // Verificar se já existe pagamento pendente idêntico (idempotência contra duplo clique)
      const existingPayments = DataStore.getSaaSPayments(params.tenantId);
      const matchingPending = existingPayments.find(
        (p) =>
          (p.status === 'pending' || p.status === 'under_review') &&
          p.planId === selectedPlan.id &&
          p.billingCycle === billingCycle &&
          Number(p.amount) === pricing.totalAmount
      );

      if (matchingPending) {
        reusedExistingPayment = true;
        matchingPending.payerEmail = recipientEmail;
        matchingPending.pixKey = pixConfig.pixKey;
        matchingPending.pixKeyProvisional = pixConfig.isProvisional;
        matchingPending.updatedAt = nowIso;
        payment = matchingPending;
        DataStore.saveSaaSPayment(payment);
      } else {
        // Cancelar cobranças pendentes anteriores de outros planos/ciclos
        const allPayments = DataStore.getSaaSPayments();
        for (const p of allPayments) {
          if (p.tenantId === params.tenantId && p.status === 'pending') {
            p.status = 'canceled';
            p.notes = `${p.notes || ''} [Substituído por nova solicitação de plano]`.trim();
            p.updatedAt = nowIso;
          }
        }
        DataStore.saveSaaSPayments(allPayments);

        const refCode = `TC-${params.tenantId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase()}-${Date.now()
          .toString()
          .slice(-6)}`;

        payment = {
          id: `pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          subscriptionId: existingSub?.id || `sub-${params.tenantId}`,
          tenantId: params.tenantId,
          tenantName: tenant.tradeName,
          planId: selectedPlan.id,
          planName: selectedPlan.name,
          billingCycle,
          amount: pricing.totalAmount,
          currency: 'BRL',
          dueDate: dueIso,
          status: 'pending',
          paymentMethod: 'pix',
          payerEmail: recipientEmail,
          pixKey: pixConfig.pixKey,
          pixKeyProvisional: pixConfig.isProvisional,
          referenceId: refCode,
          billingPeriodStart: nowIso.split('T')[0],
          billingPeriodEnd: periodEndIso.split('T')[0],
          pixCopyPaste: pixConfig.pixKey,
          notes: `Solicitação de contratação do ${selectedPlan.name} (${pricing.billingCycleLabel}) via Pix.`,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        DataStore.saveSaaSPayment(payment);
      }

      const nextSubStatus = existingSub?.status === 'active' && tenant.status === 'active' ? 'active' : 'pending_payment';

      subscription = {
        id: existingSub?.id || `sub-${params.tenantId}`,
        tenantId: params.tenantId,
        tenantName: tenant.tradeName,
        planId: nextSubStatus === 'active' ? existingSub!.planId : selectedPlan.id,
        planName: nextSubStatus === 'active' ? existingSub!.planName : selectedPlan.name,
        requestedPlanId: selectedPlan.id,
        requestedBillingCycle: billingCycle,
        requestedAmount: pricing.totalAmount,
        paymentRequestedAt: nowIso,
        status: nextSubStatus,
        billingCycle,
        amount: pricing.totalAmount,
        startedAt: existingSub?.startedAt || tenant.trialStartedAt || nowIso,
        currentPeriodStart: existingSub?.currentPeriodStart || nowIso,
        currentPeriodEnd: existingSub?.currentPeriodEnd || periodEndIso,
        nextDueDate: dueIso,
        trialExpiresAt: existingSub?.trialExpiresAt || tenant.trialExpiresAt,
        gracePeriodDays: existingSub?.gracePeriodDays || 5,
        customMaxUsers: existingSub?.customMaxUsers,
        customMaxBranches: existingSub?.customMaxBranches,
        customMaxStudents: existingSub?.customMaxStudents,
        lastPaymentId: payment.id,
        notes:
          params.notes ||
          `Solicitação de contratação do ${selectedPlan.name} (${pricing.billingCycleLabel}) registrada. Aguardando confirmação do pagamento Pix.`,
        createdAt: existingSub?.createdAt || nowIso,
        updatedAt: nowIso,
      };
      DataStore.saveSaaSSubscription(subscription);

      DataStore.logPlatformAudit(
        params.actorUserId || tenant.id,
        params.actorUserName || tenant.adminName || tenant.tradeName,
        'request_subscription_plan',
        'subscription',
        subscription.id,
        `Solicitação de contratação do "${selectedPlan.name}" (${pricing.billingCycleLabel} - R$ ${pricing.totalAmount.toFixed(
          2
        )}) registrada com status [${subscription.status}].`,
        {
          tenantId: tenant.id,
          tenantName: tenant.tradeName,
          metadata: {
            planId: selectedPlan.id,
            billingCycle,
            amount: pricing.totalAmount,
            paymentId: payment.id,
            reusedExistingPayment,
          },
        }
      );
    }

    // 3. Disparar o e-mail automático com as instruções de pagamento Pix e auditar o resultado real
    const emailDispatch = await this.dispatchPaymentInstructionsEmail({
      tenant,
      subscription,
      payment,
      pricing,
      recipientEmail,
      actorUserId: params.actorUserId,
    });

    // Atualizar o estado de e-mail na assinatura local
    subscription.lastEmailStatus = emailDispatch.status;
    subscription.lastEmailError = emailDispatch.errorMessage;
    if (emailDispatch.emailSent) {
      subscription.lastEmailSentAt = new Date().toISOString();
    }
    subscription.updatedAt = new Date().toISOString();
    DataStore.saveSaaSSubscription(subscription);

    return {
      success: true,
      reusedExistingPayment,
      tenant,
      subscription,
      payment,
      pricing,
      emailDispatch,
      pixConfig: {
        pixKey: pixConfig.pixKey,
        isProvisional: pixConfig.isProvisional,
        beneficiaryName: pixConfig.beneficiaryName,
        beneficiaryCnpj: pixConfig.beneficiaryCnpj,
        receiptEmail: pixConfig.receiptEmail,
        provisionalNotice: pixConfig.provisionalNotice,
      },
    };
  },

  /**
   * Reenvia o e-mail com as instruções de pagamento Pix para uma solicitação pendente existente,
   * sem duplicar a assinatura nem criar nova cobrança pendente.
   */
  async resendSubscriptionPaymentEmail(params: {
    tenantId: string;
    recipientEmail?: string;
    actorUserId?: string;
  }): Promise<EmailDispatchDiagnostic> {
    const synced = await this.syncTenantSubscriptionState(params.tenantId);
    const tenant = synced.tenant || DataStore.getTenants().find((t) => t.id === params.tenantId);
    if (!tenant) {
      throw new Error('Academia não encontrada.');
    }

    const subscription =
      synced.subscription || DataStore.getSaaSSubscriptions(params.tenantId)[0];
    if (!subscription) {
      throw new Error('Nenhuma solicitação de assinatura encontrada para esta academia.');
    }

    const payments = synced.payments.length > 0 ? synced.payments : DataStore.getSaaSPayments(params.tenantId);
    const payment =
      payments.find((p) => p.status === 'pending' || p.status === 'under_review') || payments[0];
    if (!payment) {
      throw new Error('Nenhuma cobrança Pix pendente encontrada para reenvio.');
    }

    const plans = DataStore.getCommercialPlans();
    const targetPlanId = payment.planId || subscription.requestedPlanId || subscription.planId;
    const plan = plans.find((p) => p.id === targetPlanId) || {
      id: targetPlanId,
      name: payment.planName || subscription.planName || 'Plano Comercial',
      description: '',
      price: payment.amount,
      currency: 'BRL' as const,
      billingCycle: (payment.billingCycle || subscription.billingCycle || 'monthly') as BillingCycle,
      trialDays: 0,
      maxStudents: 100,
      maxBranches: 1,
      maxUsers: 5,
      maxStorageGb: 10,
      features: {
        digitalLibrary: true,
        beltExams: true,
        competitions: true,
        advancedReports: true,
        multiBranch: false,
        customBranding: false,
        automatedNotifications: false,
      },
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const pricing = this.calculatePlanCyclePricing(
      plan,
      (payment.billingCycle || subscription.requestedBillingCycle || subscription.billingCycle || 'monthly') as BillingCycle
    );
    pricing.totalAmount = Number(payment.amount || subscription.amount || pricing.totalAmount);

    const recipientEmail = (params.recipientEmail || payment.payerEmail || tenant.email || '').trim().toLowerCase();

    const result = await this.dispatchPaymentInstructionsEmail({
      tenant,
      subscription,
      payment,
      pricing,
      recipientEmail,
      actorUserId: params.actorUserId,
    });

    subscription.lastEmailStatus = result.status;
    subscription.lastEmailError = result.errorMessage;
    if (result.emailSent) {
      subscription.lastEmailSentAt = new Date().toISOString();
    }
    subscription.updatedAt = new Date().toISOString();
    DataStore.saveSaaSSubscription(subscription);

    return result;
  },

  /**
   * Executa o disparo real da Edge Function `send-saas-payment-email` (ou transporte de teste injetado)
   * e registra o log de auditoria em `saas_subscription_email_logs`.
   * NUNCA finge sucesso se a Edge Function ou o provedor de e-mail falhar ou estiver sem configuração.
   */
  async dispatchPaymentInstructionsEmail(params: {
    tenant: Tenant;
    subscription: SaaSSubscription;
    payment: SaaSPayment;
    pricing: PlanCyclePricing;
    recipientEmail: string;
    actorUserId?: string;
  }): Promise<EmailDispatchDiagnostic> {
    const pixConfig = this.getCentralizedPixConfig();
    const subject = pixConfig.emailSubject;
    const reference = params.payment.referenceId || params.payment.id || params.subscription.id;

    // 1. Transporte determinístico para suíte de testes automatizados (quando configurado)
    if (customTestEmailTransport) {
      const testRes = await customTestEmailTransport({
        tenantId: params.tenant.id,
        tenantName: params.tenant.tradeName,
        recipientEmail: params.recipientEmail,
        subject,
        planId: params.pricing.planId,
        planName: params.pricing.planName,
        billingCycle: params.pricing.billingCycle,
        amount: params.pricing.totalAmount,
        subscriptionId: params.subscription.id,
        paymentId: params.payment.id,
        paymentReference: reference,
        pixKey: pixConfig.pixKey,
        isProvisionalPixKey: pixConfig.isProvisional,
      });

      const logEntry: SaaSSubscriptionEmailLog = {
        id: `elog-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId: params.tenant.id,
        subscriptionId: params.subscription.id,
        paymentId: params.payment.id,
        recipientEmail: params.recipientEmail,
        subject,
        planId: params.pricing.planId,
        planName: params.pricing.planName,
        billingCycle: params.pricing.billingCycle,
        amount: params.pricing.totalAmount,
        pixKeyUsed: pixConfig.pixKey,
        isProvisionalPixKey: pixConfig.isProvisional,
        status: testRes.status,
        provider: 'resend',
        providerMessageId: testRes.messageId,
        errorMessage: testRes.error,
        triggeredByUserId: params.actorUserId,
        createdAt: new Date().toISOString(),
      };
      DataStore.saveSaaSEmailLog(logEntry);

      return {
        emailSent: testRes.sent,
        status: testRes.status,
        recipientEmail: params.recipientEmail,
        subject,
        provider: 'resend',
        messageId: testRes.messageId,
        errorMessage: testRes.error,
        missingSecrets: testRes.missingSecrets,
        pixKey: pixConfig.pixKey,
        isProvisionalPixKey: pixConfig.isProvisional,
        logId: logEntry.id,
      };
    }

    // 2. Disparo real via Supabase Edge Function `send-saas-payment-email`
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase.functions.invoke('send-saas-payment-email', {
          body: {
            tenantId: params.tenant.id,
            tenantName: params.tenant.tradeName,
            recipientEmail: params.recipientEmail,
            planId: params.pricing.planId,
            planName: params.pricing.planName,
            billingCycle: params.pricing.billingCycle,
            amount: params.pricing.totalAmount,
            subscriptionId: params.subscription.id,
            paymentId: params.payment.id,
            paymentReference: reference,
          },
        });

        if (!error && data && data.emailSent === true) {
          const logEntry: SaaSSubscriptionEmailLog = {
            id: `elog-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            tenantId: params.tenant.id,
            subscriptionId: params.subscription.id,
            paymentId: params.payment.id,
            recipientEmail: params.recipientEmail,
            subject: data.subject || subject,
            planId: params.pricing.planId,
            planName: params.pricing.planName,
            billingCycle: params.pricing.billingCycle,
            amount: params.pricing.totalAmount,
            pixKeyUsed: data.pixKey || pixConfig.pixKey,
            isProvisionalPixKey: Boolean(data.isProvisionalPixKey ?? pixConfig.isProvisional),
            status: 'sent',
            provider: 'resend',
            providerMessageId: data.messageId,
            triggeredByUserId: params.actorUserId,
            createdAt: new Date().toISOString(),
          };
          DataStore.saveSaaSEmailLog(logEntry);

          return {
            emailSent: true,
            status: 'sent',
            recipientEmail: params.recipientEmail,
            subject: data.subject || subject,
            provider: 'resend',
            messageId: data.messageId,
            pixKey: data.pixKey || pixConfig.pixKey,
            isProvisionalPixKey: Boolean(data.isProvisionalPixKey ?? pixConfig.isProvisional),
            logId: logEntry.id,
          };
        }

        const errStatus: 'failed' | 'missing_config' =
          data?.code === 'MISSING_EMAIL_PROVIDER_SECRET' || data?.code === 'MISSING_SUPABASE_SECRETS'
            ? 'missing_config'
            : 'failed';

        const errMessage =
          data?.error ||
          error?.message ||
          'A Edge Function send-saas-payment-email não pôde concluir o envio do e-mail.';

        if (isValidUUID(params.tenant.id)) {
          try {
            await supabase.rpc('log_saas_subscription_email_result', {
              p_tenant_id: params.tenant.id,
              p_subscription_id: params.subscription.id,
              p_payment_id: params.payment.id,
              p_recipient_email: params.recipientEmail,
              p_subject: subject,
              p_plan_id: params.pricing.planId,
              p_plan_name: params.pricing.planName,
              p_billing_cycle: params.pricing.billingCycle,
              p_amount: params.pricing.totalAmount,
              p_pix_key_used: pixConfig.pixKey,
              p_is_provisional_pix_key: pixConfig.isProvisional,
              p_status: errStatus,
              p_provider: 'resend',
              p_provider_message_id: null,
              p_error_message: errMessage,
            });
          } catch {
            // já tratado no log local abaixo
          }
        }

        const logEntry: SaaSSubscriptionEmailLog = {
          id: `elog-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          tenantId: params.tenant.id,
          subscriptionId: params.subscription.id,
          paymentId: params.payment.id,
          recipientEmail: params.recipientEmail,
          subject,
          planId: params.pricing.planId,
          planName: params.pricing.planName,
          billingCycle: params.pricing.billingCycle,
          amount: params.pricing.totalAmount,
          pixKeyUsed: data?.pixKey || pixConfig.pixKey,
          isProvisionalPixKey: Boolean(data?.isProvisionalPixKey ?? pixConfig.isProvisional),
          status: errStatus,
          provider: 'resend',
          errorMessage: errMessage,
          triggeredByUserId: params.actorUserId,
          createdAt: new Date().toISOString(),
        };
        DataStore.saveSaaSEmailLog(logEntry);

        return {
          emailSent: false,
          status: errStatus,
          recipientEmail: params.recipientEmail,
          subject,
          provider: 'resend',
          errorMessage: errMessage,
          missingSecrets: data?.missingSecrets,
          pixKey: data?.pixKey || pixConfig.pixKey,
          isProvisionalPixKey: Boolean(data?.isProvisionalPixKey ?? pixConfig.isProvisional),
          logId: logEntry.id,
        };
      } catch (err: any) {
        const errMessage = err?.message || 'Erro de comunicação com a Edge Function send-saas-payment-email.';
        const logEntry: SaaSSubscriptionEmailLog = {
          id: `elog-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          tenantId: params.tenant.id,
          subscriptionId: params.subscription.id,
          paymentId: params.payment.id,
          recipientEmail: params.recipientEmail,
          subject,
          planId: params.pricing.planId,
          planName: params.pricing.planName,
          billingCycle: params.pricing.billingCycle,
          amount: params.pricing.totalAmount,
          pixKeyUsed: pixConfig.pixKey,
          isProvisionalPixKey: pixConfig.isProvisional,
          status: 'failed',
          provider: 'resend',
          errorMessage: errMessage,
          triggeredByUserId: params.actorUserId,
          createdAt: new Date().toISOString(),
        };
        DataStore.saveSaaSEmailLog(logEntry);

        return {
          emailSent: false,
          status: 'failed',
          recipientEmail: params.recipientEmail,
          subject,
          provider: 'resend',
          errorMessage: errMessage,
          pixKey: pixConfig.pixKey,
          isProvisionalPixKey: pixConfig.isProvisional,
          logId: logEntry.id,
        };
      }
    }

    // 3. Ambiente sem Supabase / Edge Function configurada: registrar 'missing_config' honestamente (nunca simular envio)
    const missingMsg =
      'Envio automático de e-mail pendente de configuração do provedor (defina RESEND_API_KEY e SAAS_EMAIL_FROM nos Secrets da Edge Function send-saas-payment-email no Supabase). As instruções de pagamento Pix foram geradas e estão disponíveis na tela.';
    const logEntry: SaaSSubscriptionEmailLog = {
      id: `elog-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      tenantId: params.tenant.id,
      subscriptionId: params.subscription.id,
      paymentId: params.payment.id,
      recipientEmail: params.recipientEmail,
      subject,
      planId: params.pricing.planId,
      planName: params.pricing.planName,
      billingCycle: params.pricing.billingCycle,
      amount: params.pricing.totalAmount,
      pixKeyUsed: pixConfig.pixKey,
      isProvisionalPixKey: pixConfig.isProvisional,
      status: 'missing_config',
      provider: 'resend',
      errorMessage: missingMsg,
      triggeredByUserId: params.actorUserId,
      createdAt: new Date().toISOString(),
    };
    DataStore.saveSaaSEmailLog(logEntry);

    return {
      emailSent: false,
      status: 'missing_config',
      recipientEmail: params.recipientEmail,
      subject,
      provider: 'resend',
      errorMessage: missingMsg,
      missingSecrets: ['RESEND_API_KEY', 'SAAS_EMAIL_FROM'],
      pixKey: pixConfig.pixKey,
      isProvisionalPixKey: pixConfig.isProvisional,
      logId: logEntry.id,
    };
  },

  /**
   * Carrega a visão administrativa global completa diretamente do Supabase (`admin_fetch_platform_overview`)
   * e sincroniza o estado local para o Painel Superadmin.
   */
  async fetchPlatformOverview(): Promise<{
    tenants: Tenant[];
    subscriptions: SaaSSubscription[];
    plans: SaaSCommercialPlan[];
    payments: SaaSPayment[];
    auditLogs: PlatformAuditLog[];
    emailLogs: SaaSSubscriptionEmailLog[];
    studentCounts: Record<string, number>;
  }> {
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase.rpc('admin_fetch_platform_overview');
        if (!error && data) {
          const existingTenants = DataStore.getTenants();
          const mappedTenants: Tenant[] = Array.isArray(data.tenants)
            ? data.tenants.map((r: any) =>
                mapSupabaseTenantRow(
                  r,
                  existingTenants.find((t) => t.id === r.id)
                )
              )
            : existingTenants;

          const mappedSubs: SaaSSubscription[] = Array.isArray(data.subscriptions)
            ? data.subscriptions.map(mapSupabaseSubscriptionRow)
            : DataStore.getSaaSSubscriptions();

          const mappedPlans: SaaSCommercialPlan[] = Array.isArray(data.commercial_plans)
            ? data.commercial_plans.map(mapSupabasePlanRow)
            : DataStore.getCommercialPlans();

          const mappedPayments: SaaSPayment[] = Array.isArray(data.payments)
            ? data.payments.map(mapSupabasePaymentRow)
            : DataStore.getSaaSPayments();

          const mappedAuditLogs: PlatformAuditLog[] = Array.isArray(data.audit_logs)
            ? data.audit_logs.map(mapSupabaseAuditLogRow)
            : DataStore.getPlatformAuditLogs();

          const mappedEmailLogs: SaaSSubscriptionEmailLog[] = Array.isArray(data.email_logs)
            ? data.email_logs.map(mapSupabaseEmailLogRow)
            : DataStore.getSaaSEmailLogs();

          if (mappedTenants.length > 0) DataStore.saveTenants(mappedTenants);
          if (mappedSubs.length > 0) DataStore.saveSaaSSubscriptions(mappedSubs);
          if (mappedPlans.length > 0) DataStore.saveCommercialPlans(mappedPlans);
          if (mappedPayments.length > 0) DataStore.saveSaaSPayments(mappedPayments);
          if (mappedAuditLogs.length > 0) DataStore.savePlatformAuditLogs(mappedAuditLogs);
          if (mappedEmailLogs.length > 0) DataStore.saveSaaSEmailLogs(mappedEmailLogs);

          const studentCounts: Record<string, number> =
            typeof data.student_counts === 'object' && data.student_counts !== null
              ? data.student_counts
              : {};

          return {
            tenants: mappedTenants,
            subscriptions: mappedSubs,
            plans: mappedPlans,
            payments: mappedPayments,
            auditLogs: mappedAuditLogs,
            emailLogs: mappedEmailLogs,
            studentCounts,
          };
        }
      } catch (err) {
        console.warn('Fallback para visão local em fetchPlatformOverview:', err);
      }
    }

    const tenants = DataStore.getTenants();
    const subscriptions = DataStore.getSaaSSubscriptions();
    const plans = DataStore.getCommercialPlans();
    const payments = DataStore.getSaaSPayments();
    const auditLogs = DataStore.getPlatformAuditLogs();
    const emailLogs = DataStore.getSaaSEmailLogs();
    const studentCounts: Record<string, number> = {};
    for (const t of tenants) {
      studentCounts[t.id] = DataStore.getStudents(t.id).length;
    }

    return {
      tenants,
      subscriptions,
      plans,
      payments,
      auditLogs,
      emailLogs,
      studentCounts,
    };
  },

  /**
   * Calcula as métricas reais consolidadas da plataforma SaaS.
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

    const tenants = DataStore.getTenants();
    const subs = DataStore.getSaaSSubscriptions();
    const payments = DataStore.getSaaSPayments();

    const totalTenants = tenants.length;
    const activeSubscriptions = subs.filter((s) => s.status === 'active').length;
    const trialSubscriptions = subs.filter((s) => s.status === 'trial').length;
    const pendingPaymentSubscriptions = subs.filter(
      (s) => s.status === 'pending_payment' || s.status === 'waiting_payment' || s.status === 'payment_under_review'
    ).length;
    const pastDueSubscriptions = subs.filter((s) => s.status === 'past_due').length;
    const suspendedTenants = tenants.filter((t) => t.status === 'suspended').length;
    const canceledSubscriptions = subs.filter((s) => s.status === 'canceled').length;

    const estimatedMRR = subs
      .filter((s) => s.status === 'active')
      .reduce((acc, sub) => acc + (sub.amount || 0), 0);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const confirmedRevenueMonth = payments
      .filter((p) => {
        if (p.status !== 'paid' || !p.paidAt) return false;
        const d = new Date(p.paidAt);
        return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
      })
      .reduce((acc, p) => acc + (p.amount || 0), 0);

    const confirmedRevenueTotal = payments
      .filter((p) => p.status === 'paid')
      .reduce((acc, p) => acc + (p.amount || 0), 0);

    return {
      totalTenants,
      activeSubscriptions,
      trialSubscriptions,
      pendingPaymentSubscriptions,
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
          .order('monthly_price', { ascending: true });
        if (!error && data && data.length > 0) {
          const mapped: SaaSCommercialPlan[] = data.map(mapSupabasePlanRow);
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
   * Salvar ou atualizar plano comercial (com persistência no Supabase para Administradores Globais)
   */
  async savePlan(plan: SaaSCommercialPlan, actorUserId: string, actorUserName: string): Promise<SaaSCommercialPlan> {
    assertGlobalAdminActor(actorUserId, actorUserName);

    const plans = DataStore.getCommercialPlans();
    const existingIndex = plans.findIndex((p) => p.id === plan.id);
    const isNew = existingIndex === -1;
    const nowIso = new Date().toISOString();

    if (isSupabaseConfigured() && supabase) {
      const { error } = await supabase.from('saas_commercial_plans').upsert(
        {
          id: plan.id,
          name: plan.name,
          description: plan.description || plan.tagline || '',
          monthly_price: Number(plan.price || 0),
          annual_price: Number(plan.annualPrice ?? Number((plan.price * 12 * 0.85).toFixed(2))),
          max_students: Number(plan.maxStudents || 100),
          max_branches: Number(plan.maxBranches || 1),
          max_classes: Number(plan.maxClasses || 20),
          max_team_users: Number(plan.maxUsers || 5),
          allow_financial_module: true,
          allow_digital_library: Boolean(plan.features?.digitalLibrary),
          allow_anthropometry: true,
          allow_competitions: Boolean(plan.features?.competitions),
          active: plan.active !== false,
        },
        { onConflict: 'id' }
      );

      if (error) {
        throw new Error(`Não foi possível persistir o plano comercial no Supabase: ${error.message}`);
      }
    }

    const updatedPlan: SaaSCommercialPlan = {
      ...plan,
      updatedAt: nowIso,
      createdAt: isNew ? nowIso : plan.createdAt,
    };

    if (isNew) {
      plans.push(updatedPlan);
    } else {
      plans[existingIndex] = updatedPlan;
    }

    DataStore.saveCommercialPlans(plans);

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
          .order('updated_at', { ascending: false });
        if (!error && data && data.length > 0) {
          const mapped: SaaSSubscription[] = data.map(mapSupabaseSubscriptionRow);
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
          const mapped: SaaSPayment[] = data.map(mapSupabasePaymentRow);
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
   * Suspender uma academia com motivo obrigatório, persistência real no Supabase e auditoria.
   */
  async suspendTenant(
    tenantId: string,
    reason: string,
    actorUserId: string,
    actorUserName: string
  ): Promise<boolean> {
    assertGlobalAdminActor(actorUserId, actorUserName);

    if (!reason || reason.trim().length < 5) {
      throw new Error('É obrigatório informar uma justificativa clara (mínimo de 5 caracteres) para suspender uma academia.');
    }

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      const { data, error } = await supabase.rpc('admin_suspend_tenant', {
        p_tenant_id: tenantId,
        p_reason: reason.trim(),
      });
      if (error) {
        throw new Error(`Falha ao suspender academia no Supabase: ${error.message}`);
      }
      if (data?.tenant) {
        const tenants = DataStore.getTenants();
        const existing = tenants.find((t) => t.id === tenantId);
        const updatedTenant = mapSupabaseTenantRow(data.tenant, existing);
        const idx = tenants.findIndex((t) => t.id === tenantId);
        if (idx >= 0) tenants[idx] = updatedTenant;
        DataStore.saveTenants(tenants);
      }
      if (data?.subscription) {
        DataStore.saveSaaSSubscription(mapSupabaseSubscriptionRow(data.subscription));
      }
      return true;
    }

    const tenants = DataStore.getTenants();
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) throw new Error('Academia não encontrada.');

    const nowIso = new Date().toISOString();
    tenant.status = 'suspended';
    tenant.suspendedAt = nowIso;
    tenant.suspendedReason = reason.trim();
    tenant.updatedAt = nowIso;
    DataStore.saveTenants(tenants);

    const subs = DataStore.getSaaSSubscriptions();
    const sub = subs.find((s) => s.tenantId === tenantId);
    if (sub) {
      sub.status = 'suspended';
      sub.suspendedReason = reason.trim();
      sub.suspendedAt = nowIso;
      sub.updatedAt = nowIso;
      DataStore.saveSaaSSubscriptions(subs);
    }

    DataStore.logPlatformAudit(
      actorUserId,
      actorUserName,
      'suspend_tenant',
      'tenant',
      tenantId,
      `Academia "${tenant.tradeName}" foi suspensa administrativamente. Motivo: ${reason.trim()}`,
      { tenantId, tenantName: tenant.tradeName, reason: reason.trim() }
    );

    return true;
  },

  /**
   * Reativar uma academia com justificativa, persistência real no Supabase e auditoria.
   */
  async reactivateTenant(
    tenantId: string,
    reason: string,
    actorUserId: string,
    actorUserName: string
  ): Promise<boolean> {
    assertGlobalAdminActor(actorUserId, actorUserName);

    const cleanReason = (reason || '').trim();
    if (cleanReason.length < 5) {
      throw new Error('Informe uma justificativa administrativa válida (mínimo de 5 caracteres) para reativar a academia.');
    }

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      const { data, error } = await supabase.rpc('admin_reactivate_tenant', {
        p_tenant_id: tenantId,
        p_reason: cleanReason,
      });
      if (error) {
        throw new Error(`Falha ao reativar academia no Supabase: ${error.message}`);
      }
      if (data?.tenant) {
        const tenants = DataStore.getTenants();
        const existing = tenants.find((t) => t.id === tenantId);
        const updatedTenant = mapSupabaseTenantRow(data.tenant, existing);
        const idx = tenants.findIndex((t) => t.id === tenantId);
        if (idx >= 0) tenants[idx] = updatedTenant;
        DataStore.saveTenants(tenants);
      }
      if (data?.subscription) {
        DataStore.saveSaaSSubscription(mapSupabaseSubscriptionRow(data.subscription));
      }
      return true;
    }

    const tenants = DataStore.getTenants();
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) throw new Error('Academia não encontrada.');

    const nowIso = new Date().toISOString();
    tenant.status = 'active';
    if (tenant.planId === 'trial') {
      tenant.planId = 'basic';
    }
    tenant.suspendedAt = undefined;
    tenant.suspendedReason = undefined;
    tenant.updatedAt = nowIso;
    DataStore.saveTenants(tenants);

    const subs = DataStore.getSaaSSubscriptions();
    const sub = subs.find((s) => s.tenantId === tenantId);
    if (sub) {
      sub.status = 'active';
      if (sub.planId === 'trial') {
        sub.planId = tenant.planId;
        sub.planName = 'Plano Básico';
      }
      sub.suspendedReason = undefined;
      sub.suspendedAt = undefined;
      if (!sub.currentPeriodEnd || new Date(sub.currentPeriodEnd).getTime() < Date.now()) {
        const nextPeriod = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        sub.currentPeriodEnd = nextPeriod;
        sub.nextDueDate = nextPeriod.split('T')[0];
      }
      sub.updatedAt = nowIso;
      DataStore.saveSaaSSubscriptions(subs);
    }

    DataStore.logPlatformAudit(
      actorUserId,
      actorUserName,
      'reactivate_tenant',
      'tenant',
      tenantId,
      `Acesso da academia "${tenant.tradeName}" foi reativado. Justificativa: ${cleanReason}`,
      { tenantId, tenantName: tenant.tradeName, reason: cleanReason }
    );

    return true;
  },

  /**
   * CORREÇÃO 2: Alterar plano comercial contratado de uma academia com persistência real no Supabase,
   * sem criar assinaturas duplicadas e atualizando o estado efetivo da licença quando aplicável.
   */
  async changeTenantPlan(
    tenantId: string,
    newPlanId: string,
    reason: string,
    actorUserId: string,
    actorUserName: string,
    options?: {
      billingCycle?: BillingCycle;
      activateImmediately?: boolean;
      extendDays?: number;
    }
  ): Promise<{
    tenant: Tenant;
    subscription: SaaSSubscription;
    evaluation: TenantAccessEvaluation;
  }> {
    assertGlobalAdminActor(actorUserId, actorUserName);

    const cleanReason = (reason || '').trim();
    if (cleanReason.length < 5) {
      throw new Error('Informe o motivo administrativo da alteração de plano (mínimo de 5 caracteres).');
    }

    const plans = DataStore.getCommercialPlans();
    const targetPlan = plans.find((p) => p.id === newPlanId);
    if (!targetPlan) {
      throw new Error(`Plano comercial selecionado (${newPlanId}) não existe.`);
    }

    const billingCycle: BillingCycle = options?.billingCycle || 'monthly';
    // Se activateImmediately não foi explicitamente passado como false, quando o admin altera para um plano pago no painel administrativo:
    // permitimos controlar se é apenas troca de plano (aguardando pagamento) ou ativação administrativa imediata.
    const activateImmediately = options?.activateImmediately ?? true;
    const extendDays = Math.max(1, options?.extendDays ?? (newPlanId === 'trial' ? 14 : 30));

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      const { data, error } = await supabase.rpc('admin_change_tenant_plan', {
        p_tenant_id: tenantId,
        p_new_plan_id: newPlanId,
        p_reason: cleanReason,
        p_billing_cycle: billingCycle,
        p_activate_immediately: activateImmediately,
        p_extend_days: extendDays,
      });

      if (error) {
        throw new Error(`Falha ao persistir alteração de plano no Supabase: ${error.message}`);
      }

      if (!data || !data.tenant || !data.subscription) {
        throw new Error('O banco de dados não confirmou a atualização da assinatura.');
      }

      const tenants = DataStore.getTenants();
      const existing = tenants.find((t) => t.id === tenantId);
      const updatedTenant = mapSupabaseTenantRow(data.tenant, existing);
      const idx = tenants.findIndex((t) => t.id === tenantId);
      if (idx >= 0) {
        tenants[idx] = updatedTenant;
      } else {
        tenants.unshift(updatedTenant);
      }
      DataStore.saveTenants(tenants);

      const updatedSub = mapSupabaseSubscriptionRow(data.subscription);
      DataStore.saveSaaSSubscription(updatedSub);

      const evaluation = this.evaluateTenantAccess(
        updatedTenant,
        updatedSub,
        targetPlan,
        DataStore.getStudents(tenantId).length,
        DataStore.getBranches(tenantId).length
      );

      return {
        tenant: updatedTenant,
        subscription: updatedSub,
        evaluation,
      };
    }

    // Persistência determinística local / sandbox
    const tenants = DataStore.getTenants();
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) throw new Error('Academia não encontrada.');

    const oldPlanId = tenant.planId;
    const oldStatus = tenant.status;
    const nowIso = new Date().toISOString();
    const periodEndIso = new Date(Date.now() + extendDays * 24 * 60 * 60 * 1000).toISOString();
    const pricing = this.calculatePlanCyclePricing(targetPlan, billingCycle);

    const subs = DataStore.getSaaSSubscriptions();
    let sub = subs.find((s) => s.tenantId === tenantId);

    let nextTenantStatus: Tenant['status'] = tenant.status;
    let nextSubStatus: SaaSSubscription['status'] = sub?.status || 'trial';

    if (newPlanId === 'trial') {
      nextTenantStatus = 'trial';
      nextSubStatus = 'trial';
      tenant.trialExpiresAt = periodEndIso;
    } else if (activateImmediately) {
      nextTenantStatus = 'active';
      nextSubStatus = 'active';
      tenant.suspendedAt = undefined;
      tenant.suspendedReason = undefined;
    } else {
      if (tenant.status === 'active' && sub?.status === 'active') {
        nextTenantStatus = 'active';
        nextSubStatus = 'active';
      } else if (tenant.status === 'suspended') {
        nextTenantStatus = 'suspended';
        nextSubStatus = 'suspended';
      } else {
        nextTenantStatus = tenant.status;
        nextSubStatus = 'pending_payment';
      }
    }

    tenant.planId = targetPlan.id as Tenant['planId'];
    tenant.status = nextTenantStatus;
    tenant.updatedAt = nowIso;
    DataStore.saveTenants(tenants);

    if (sub) {
      sub.tenantName = tenant.tradeName;
      sub.planId = targetPlan.id;
      sub.planName = targetPlan.name;
      sub.requestedPlanId = targetPlan.id;
      sub.requestedBillingCycle = billingCycle;
      sub.requestedAmount = pricing.totalAmount;
      sub.billingCycle = billingCycle;
      sub.amount = pricing.totalAmount;
      sub.status = nextSubStatus;
      if (newPlanId === 'trial') {
        sub.trialExpiresAt = periodEndIso;
        sub.currentPeriodEnd = periodEndIso;
        sub.nextDueDate = periodEndIso.split('T')[0];
      } else if (activateImmediately) {
        sub.currentPeriodStart = nowIso;
        sub.currentPeriodEnd = periodEndIso;
        sub.nextDueDate = periodEndIso.split('T')[0];
        sub.lastPaymentConfirmedAt = nowIso;
        sub.lastPaymentConfirmedBy = actorUserId;
      }
      sub.notes = cleanReason;
      sub.updatedAt = nowIso;
      DataStore.saveSaaSSubscription(sub);
    } else {
      sub = {
        id: `sub-${tenantId}`,
        tenantId,
        tenantName: tenant.tradeName,
        planId: targetPlan.id,
        planName: targetPlan.name,
        requestedPlanId: targetPlan.id,
        requestedBillingCycle: billingCycle,
        requestedAmount: pricing.totalAmount,
        status: nextSubStatus,
        billingCycle,
        amount: pricing.totalAmount,
        startedAt: tenant.createdAt || nowIso,
        currentPeriodStart: nowIso,
        currentPeriodEnd: periodEndIso,
        nextDueDate: periodEndIso.split('T')[0],
        trialExpiresAt: newPlanId === 'trial' ? periodEndIso : tenant.trialExpiresAt,
        gracePeriodDays: 5,
        lastPaymentConfirmedAt: activateImmediately ? nowIso : undefined,
        lastPaymentConfirmedBy: activateImmediately ? actorUserId : undefined,
        notes: cleanReason,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      DataStore.saveSaaSSubscription(sub);
    }

    DataStore.logPlatformAudit(
      actorUserId,
      actorUserName,
      'change_subscription_plan',
      'subscription',
      sub.id,
      `Plano da academia "${tenant.tradeName}" alterado de [${oldPlanId} / ${oldStatus}] para [${targetPlan.name} / ${nextSubStatus} - R$ ${pricing.totalAmount.toFixed(
        2
      )}]. Ativação imediata: ${activateImmediately ? 'Sim' : 'Não'}. Motivo: ${cleanReason}`,
      {
        tenantId,
        tenantName: tenant.tradeName,
        reason: cleanReason,
        metadata: {
          oldPlanId,
          newPlanId: targetPlan.id,
          oldStatus,
          newTenantStatus: nextTenantStatus,
          newSubscriptionStatus: nextSubStatus,
          billingCycle,
          activateImmediately,
          extendDays,
        },
      }
    );

    const evaluation = this.evaluateTenantAccess(
      tenant,
      sub,
      targetPlan,
      DataStore.getStudents(tenantId).length,
      DataStore.getBranches(tenantId).length
    );

    return {
      tenant,
      subscription: sub,
      evaluation,
    };
  },

  /**
   * Confirma administrativamente o pagamento Pix de uma academia (em pending_payment / waiting_payment / past_due),
   * ativando a assinatura, atualizando o ciclo de vigência e liberando o acesso imediatamente.
   */
  async confirmSaaSPayment(params: {
    tenantId: string;
    paymentId?: string;
    reason: string;
    extendDays?: number;
    actorUserId: string;
    actorUserName: string;
  }): Promise<{
    tenant: Tenant;
    subscription: SaaSSubscription;
    payment: SaaSPayment;
    evaluation: TenantAccessEvaluation;
  }> {
    assertGlobalAdminActor(params.actorUserId, params.actorUserName);

    const cleanReason = (params.reason || '').trim();
    if (cleanReason.length < 5) {
      throw new Error('Informe uma justificativa ou referência do comprovante (mínimo de 5 caracteres) para confirmar o pagamento.');
    }

    if (isSupabaseConfigured() && supabase && isValidUUID(params.tenantId)) {
      const { data, error } = await supabase.rpc('admin_confirm_saas_payment', {
        p_tenant_id: params.tenantId,
        p_payment_id: params.paymentId || null,
        p_reason: cleanReason,
        p_extend_days: params.extendDays || null,
      });

      if (error) {
        throw new Error(`Falha ao confirmar pagamento no Supabase: ${error.message}`);
      }

      const tenants = DataStore.getTenants();
      const existing = tenants.find((t) => t.id === params.tenantId);
      const updatedTenant = mapSupabaseTenantRow(data.tenant, existing);
      const idx = tenants.findIndex((t) => t.id === params.tenantId);
      if (idx >= 0) tenants[idx] = updatedTenant;
      DataStore.saveTenants(tenants);

      const updatedSub = mapSupabaseSubscriptionRow(data.subscription);
      DataStore.saveSaaSSubscription(updatedSub);

      const updatedPayment = mapSupabasePaymentRow(data.payment);
      DataStore.saveSaaSPayment(updatedPayment);

      const plans = DataStore.getCommercialPlans();
      const matchedPlan = plans.find((p) => p.id === updatedTenant.planId);
      const evaluation = this.evaluateTenantAccess(
        updatedTenant,
        updatedSub,
        matchedPlan,
        DataStore.getStudents(params.tenantId).length,
        DataStore.getBranches(params.tenantId).length
      );

      return {
        tenant: updatedTenant,
        subscription: updatedSub,
        payment: updatedPayment,
        evaluation,
      };
    }

    // Fallback determinístico em memória / DataStore
    const tenants = DataStore.getTenants();
    const tenant = tenants.find((t) => t.id === params.tenantId);
    if (!tenant) throw new Error('Academia não encontrada.');

    const subs = DataStore.getSaaSSubscriptions();
    let sub = subs.find((s) => s.tenantId === params.tenantId);
    const payments = DataStore.getSaaSPayments();
    let payment = params.paymentId
      ? payments.find((p) => p.id === params.paymentId && p.tenantId === params.tenantId)
      : payments.find(
          (p) => p.tenantId === params.tenantId && (p.status === 'pending' || p.status === 'under_review')
        );

    const plans = DataStore.getCommercialPlans();
    const targetPlanId =
      payment?.planId ||
      sub?.requestedPlanId ||
      (sub?.planId && sub.planId !== 'trial' ? sub.planId : undefined) ||
      (tenant.planId !== 'trial' ? tenant.planId : 'basic');

    const targetPlan = plans.find((p) => p.id === targetPlanId) || plans.find((p) => p.id === 'basic')!;
    const billingCycle: BillingCycle =
      (payment?.billingCycle || sub?.requestedBillingCycle || sub?.billingCycle || 'monthly') as BillingCycle;

    const cycleDays =
      params.extendDays && params.extendDays > 0
        ? params.extendDays
        : billingCycle === 'annual'
        ? 365
        : billingCycle === 'semiannual'
        ? 180
        : billingCycle === 'quarterly'
        ? 90
        : 30;

    const nowIso = new Date().toISOString();
    const periodEndIso = new Date(Date.now() + cycleDays * 24 * 60 * 60 * 1000).toISOString();
    const dueIso = periodEndIso.split('T')[0];

    if (payment) {
      payment.status = 'paid';
      payment.paidAt = nowIso;
      payment.planId = targetPlan.id;
      payment.planName = targetPlan.name;
      payment.billingCycle = billingCycle;
      payment.confirmedByUserId = params.actorUserId;
      payment.confirmedByUserName = params.actorUserName;
      payment.confirmationNotes = cleanReason;
      payment.notes = `${payment.notes || ''} | Confirmado: ${cleanReason}`.trim();
      payment.updatedAt = nowIso;
      DataStore.saveSaaSPayment(payment);
    } else {
      const pricing = this.calculatePlanCyclePricing(targetPlan, billingCycle);
      payment = {
        id: `pay-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        subscriptionId: sub?.id || `sub-${params.tenantId}`,
        tenantId: params.tenantId,
        tenantName: tenant.tradeName,
        planId: targetPlan.id,
        planName: targetPlan.name,
        billingCycle,
        amount: sub?.requestedAmount || sub?.amount || pricing.totalAmount,
        currency: 'BRL',
        dueDate: nowIso.split('T')[0],
        paidAt: nowIso,
        status: 'paid',
        paymentMethod: 'pix',
        confirmedByUserId: params.actorUserId,
        confirmedByUserName: params.actorUserName,
        confirmationNotes: cleanReason,
        billingPeriodStart: nowIso.split('T')[0],
        billingPeriodEnd: dueIso,
        notes: `Pagamento Pix confirmado administrativamente: ${cleanReason}`,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      DataStore.saveSaaSPayment(payment);
    }

    tenant.planId = targetPlan.id as Tenant['planId'];
    tenant.status = 'active';
    tenant.suspendedAt = undefined;
    tenant.suspendedReason = undefined;
    tenant.updatedAt = nowIso;
    DataStore.saveTenants(tenants);

    if (sub) {
      sub.tenantName = tenant.tradeName;
      sub.planId = targetPlan.id;
      sub.planName = targetPlan.name;
      sub.requestedPlanId = targetPlan.id;
      sub.requestedBillingCycle = billingCycle;
      sub.billingCycle = billingCycle;
      sub.amount = payment.amount;
      sub.status = 'active';
      sub.currentPeriodStart = nowIso;
      sub.currentPeriodEnd = periodEndIso;
      sub.nextDueDate = dueIso;
      sub.lastPaymentId = payment.id;
      sub.lastPaymentConfirmedAt = nowIso;
      sub.lastPaymentConfirmedBy = params.actorUserId;
      sub.notes = cleanReason;
      sub.updatedAt = nowIso;
      DataStore.saveSaaSSubscription(sub);
    } else {
      sub = {
        id: `sub-${params.tenantId}`,
        tenantId: params.tenantId,
        tenantName: tenant.tradeName,
        planId: targetPlan.id,
        planName: targetPlan.name,
        requestedPlanId: targetPlan.id,
        requestedBillingCycle: billingCycle,
        status: 'active',
        billingCycle,
        amount: payment.amount,
        startedAt: tenant.createdAt || nowIso,
        currentPeriodStart: nowIso,
        currentPeriodEnd: periodEndIso,
        nextDueDate: dueIso,
        trialExpiresAt: tenant.trialExpiresAt,
        gracePeriodDays: 5,
        lastPaymentId: payment.id,
        lastPaymentConfirmedAt: nowIso,
        lastPaymentConfirmedBy: params.actorUserId,
        notes: cleanReason,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      DataStore.saveSaaSSubscription(sub);
    }

    DataStore.logPlatformAudit(
      params.actorUserId,
      params.actorUserName,
      'confirm_saas_payment',
      'payment',
      payment.id,
      `Pagamento Pix confirmado (R$ ${payment.amount.toFixed(2)}) para a academia "${
        tenant.tradeName
      }". Plano "${targetPlan.name}" ativado por ${cycleDays} dias (até ${dueIso}). Justificativa: ${cleanReason}`,
      {
        tenantId: tenant.id,
        tenantName: tenant.tradeName,
        reason: cleanReason,
        metadata: {
          paymentId: payment.id,
          planId: targetPlan.id,
          billingCycle,
          amount: payment.amount,
          extendDays: cycleDays,
        },
      }
    );

    const evaluation = this.evaluateTenantAccess(
      tenant,
      sub,
      targetPlan,
      DataStore.getStudents(params.tenantId).length,
      DataStore.getBranches(params.tenantId).length
    );

    return {
      tenant,
      subscription: sub,
      payment,
      evaluation,
    };
  },

  /**
   * Rejeita administrativamente um pagamento pendente/inválido sem liberar o acesso da academia.
   */
  async rejectSaaSPayment(params: {
    tenantId: string;
    paymentId: string;
    reason: string;
    actorUserId: string;
    actorUserName: string;
  }): Promise<{
    tenant: Tenant;
    subscription: SaaSSubscription | null;
    payment: SaaSPayment | null;
    evaluation: TenantAccessEvaluation;
  }> {
    assertGlobalAdminActor(params.actorUserId, params.actorUserName);

    const cleanReason = (params.reason || '').trim();
    if (cleanReason.length < 5) {
      throw new Error('Informe o motivo da rejeição do pagamento (mínimo de 5 caracteres).');
    }

    if (isSupabaseConfigured() && supabase && isValidUUID(params.tenantId)) {
      const { data, error } = await supabase.rpc('admin_reject_saas_payment', {
        p_tenant_id: params.tenantId,
        p_payment_id: params.paymentId,
        p_reason: cleanReason,
      });
      if (error) {
        throw new Error(`Falha ao rejeitar pagamento no Supabase: ${error.message}`);
      }
      if (data?.subscription) {
        DataStore.saveSaaSSubscription(mapSupabaseSubscriptionRow(data.subscription));
      }
      if (data?.payment) {
        DataStore.saveSaaSPayment(mapSupabasePaymentRow(data.payment));
      }
    }

    const tenants = DataStore.getTenants();
    const tenant = tenants.find((t) => t.id === params.tenantId);
    if (!tenant) throw new Error('Academia não encontrada.');

    const nowIso = new Date().toISOString();
    const payments = DataStore.getSaaSPayments();
    const payment = payments.find((p) => p.id === params.paymentId && p.tenantId === params.tenantId) || null;
    if (payment) {
      payment.status = 'rejected';
      payment.confirmationNotes = cleanReason;
      payment.notes = `${payment.notes || ''} | Rejeitado: ${cleanReason}`.trim();
      payment.updatedAt = nowIso;
      DataStore.saveSaaSPayment(payment);
    }

    const subs = DataStore.getSaaSSubscriptions();
    const sub = subs.find((s) => s.tenantId === params.tenantId) || null;
    if (sub && sub.status !== 'active') {
      sub.status = 'rejected';
      sub.notes = `Pagamento rejeitado: ${cleanReason}`;
      sub.updatedAt = nowIso;
      DataStore.saveSaaSSubscription(sub);
    }

    DataStore.logPlatformAudit(
      params.actorUserId,
      params.actorUserName,
      'reject_saas_payment',
      'payment',
      params.paymentId,
      `Pagamento Pix [${params.paymentId}] da academia "${tenant.tradeName}" rejeitado. Motivo: ${cleanReason}`,
      {
        tenantId: tenant.id,
        tenantName: tenant.tradeName,
        reason: cleanReason,
      }
    );

    const plans = DataStore.getCommercialPlans();
    const matchedPlan = plans.find((p) => p.id === (sub?.planId || tenant.planId));
    const evaluation = this.evaluateTenantAccess(
      tenant,
      sub,
      matchedPlan,
      DataStore.getStudents(params.tenantId).length,
      DataStore.getBranches(params.tenantId).length
    );

    return {
      tenant,
      subscription: sub,
      payment,
      evaluation,
    };
  },

  /**
   * Ativação manual da assinatura pelo proprietário do SaaS.
   * Exige justificativa formal, registra operador, persiste no Supabase e estende a vigência.
   */
  async manualActivateSubscription(
    subscriptionIdOrTenantId: string,
    reason: string,
    extendDays: number,
    actorUserId: string,
    actorUserName: string
  ): Promise<boolean> {
    assertGlobalAdminActor(actorUserId, actorUserName);

    if (!reason || reason.trim().length < 5) {
      throw new Error('A ativação manual exige uma justificativa formal com no mínimo 5 caracteres.');
    }

    const subs = DataStore.getSaaSSubscriptions();
    let sub = subs.find((s) => s.id === subscriptionIdOrTenantId || s.tenantId === subscriptionIdOrTenantId);
    const tenantId = sub?.tenantId || subscriptionIdOrTenantId;
    const days = Math.max(1, extendDays || 30);

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      const { data, error } = await supabase.rpc('admin_manual_activate_subscription', {
        p_tenant_id: tenantId,
        p_reason: reason.trim(),
        p_extend_days: days,
      });
      if (error) {
        throw new Error(`Falha ao ativar licença manualmente no Supabase: ${error.message}`);
      }
      if (data?.tenant) {
        const tenants = DataStore.getTenants();
        const existing = tenants.find((t) => t.id === tenantId);
        const updatedTenant = mapSupabaseTenantRow(data.tenant, existing);
        const idx = tenants.findIndex((t) => t.id === tenantId);
        if (idx >= 0) tenants[idx] = updatedTenant;
        DataStore.saveTenants(tenants);
      }
      if (data?.subscription) {
        DataStore.saveSaaSSubscription(mapSupabaseSubscriptionRow(data.subscription));
      }
      return true;
    }

    const tenants = DataStore.getTenants();
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant && !sub) throw new Error('Assinatura ou academia não encontrada.');

    const nowIso = new Date().toISOString();
    const newPeriodEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const newDueDate = newPeriodEnd.split('T')[0];

    const plans = DataStore.getCommercialPlans();
    const targetPlanId =
      sub?.requestedPlanId ||
      (sub?.planId && sub.planId !== 'trial' ? sub.planId : undefined) ||
      (tenant?.planId && tenant.planId !== 'trial' ? tenant.planId : 'basic');
    const targetPlan = plans.find((p) => p.id === targetPlanId) || plans.find((p) => p.id === 'basic')!;

    if (tenant) {
      tenant.status = 'active';
      if (tenant.planId === 'trial') {
        tenant.planId = targetPlan.id as Tenant['planId'];
      }
      tenant.suspendedAt = undefined;
      tenant.suspendedReason = undefined;
      tenant.updatedAt = nowIso;
      DataStore.saveTenants(tenants);
    }

    if (sub) {
      sub.status = 'active';
      if (sub.planId === 'trial') {
        sub.planId = targetPlan.id;
        sub.planName = targetPlan.name;
      }
      if (!sub.amount || sub.amount <= 0) {
        sub.amount = targetPlan.price;
      }
      sub.currentPeriodStart = nowIso;
      sub.currentPeriodEnd = newPeriodEnd;
      sub.nextDueDate = newDueDate;
      sub.manualActivation = {
        activatedByUserId: actorUserId,
        activatedByUserName: actorUserName,
        reason: reason.trim(),
        activatedAt: nowIso,
        extendedDays: days,
      };
      sub.notes = reason.trim();
      sub.updatedAt = nowIso;
      DataStore.saveSaaSSubscription(sub);
    } else if (tenant) {
      sub = {
        id: `sub-${tenant.id}`,
        tenantId: tenant.id,
        tenantName: tenant.tradeName,
        planId: targetPlan.id,
        planName: targetPlan.name,
        status: 'active',
        billingCycle: 'monthly',
        amount: targetPlan.price,
        startedAt: tenant.createdAt || nowIso,
        currentPeriodStart: nowIso,
        currentPeriodEnd: newPeriodEnd,
        nextDueDate: newDueDate,
        trialExpiresAt: tenant.trialExpiresAt,
        gracePeriodDays: 5,
        manualActivation: {
          activatedByUserId: actorUserId,
          activatedByUserName: actorUserName,
          reason: reason.trim(),
          activatedAt: nowIso,
          extendedDays: days,
        },
        notes: reason.trim(),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      DataStore.saveSaaSSubscription(sub);
    }

    DataStore.logPlatformAudit(
      actorUserId,
      actorUserName,
      'manual_activate_subscription',
      'subscription',
      sub!.id,
      `Ativação manual de cortesia/concessão para a academia "${
        tenant?.tradeName || sub!.tenantId
      }". Vigência estendida em ${days} dias (até ${newDueDate}). Motivo: ${reason.trim()}`,
      { tenantId: sub!.tenantId, tenantName: tenant?.tradeName, reason: reason.trim() }
    );

    return true;
  },

  /**
   * Processador de Webhook de Pagamento Seguro & Idempotente.
   */
  async processPaymentWebhookEvent(event: {
    eventId: string;
    gatewayName: 'asaas' | 'mercadopago' | 'stripe';
    eventType: 'PAYMENT_RECEIVED' | 'PAYMENT_OVERDUE' | 'PAYMENT_REFUNDED' | 'PAYMENT_DELETED';
    chargeId: string;
    amount: number;
    tenantId: string;
    subscriptionId: string;
    paidAt?: string;
    paymentMethod?: 'pix' | 'credit_card' | 'boleto';
  }): Promise<{ success: boolean; duplicate: boolean; message: string }> {
    const processedEvents = DataStore.getPlatformAuditLogs().filter(
      (l) => l.action === 'process_payment_webhook' && l.metadata?.eventId === event.eventId
    );

    if (processedEvents.length > 0) {
      return {
        success: true,
        duplicate: true,
        message: `Evento de pagamento [${event.eventId}] já havia sido processado anteriormente (Idempotência garantida).`,
      };
    }

    const payments = DataStore.getSaaSPayments();
    let payment = payments.find((p) => p.gatewayChargeId === event.chargeId || p.id === event.chargeId);

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

    const subs = DataStore.getSaaSSubscriptions();
    const sub = subs.find((s) => s.id === event.subscriptionId || s.tenantId === event.tenantId);

    if (sub && event.eventType === 'PAYMENT_RECEIVED') {
      sub.status = 'active';
      sub.lastPaymentId = payment.id;
      const baseDate = Math.max(Date.now(), new Date(sub.currentPeriodEnd || nowIso).getTime());
      const extendedEnd = new Date(baseDate + 30 * 24 * 60 * 60 * 1000).toISOString();
      sub.currentPeriodStart = nowIso;
      sub.currentPeriodEnd = extendedEnd;
      sub.nextDueDate = extendedEnd.split('T')[0];
      sub.updatedAt = nowIso;
      DataStore.saveSaaSSubscriptions(subs);

      const tenants = DataStore.getTenants();
      const tenant = tenants.find((t) => t.id === event.tenantId);
      if (tenant) {
        tenant.status = 'active';
        if (tenant.planId === 'trial' && sub.planId !== 'trial') {
          tenant.planId = sub.planId as Tenant['planId'];
        }
        DataStore.saveTenants(tenants);
      }
    } else if (sub && event.eventType === 'PAYMENT_OVERDUE') {
      sub.status = 'past_due';
      sub.updatedAt = nowIso;
      DataStore.saveSaaSSubscriptions(subs);
    }

    DataStore.logPlatformAudit(
      'system-webhook',
      `Gateway ${event.gatewayName.toUpperCase()}`,
      'process_payment_webhook',
      'payment',
      payment.id,
      `Webhook processado: Pagamento de R$ ${event.amount.toFixed(2)} confirmado via ${
        event.paymentMethod?.toUpperCase() || 'PIX'
      }. Vigência da academia regularizada.`,
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
    if (actor.role !== 'superadmin' || !isAuthorizedPlatformOwnerEmail(actor.email)) {
      throw new Error('Acesso negado (403): apenas o proprietário global do SaaS pode alterar os limites de licença.');
    }

    const tenants = DataStore.getTenants();
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant) {
      throw new Error('Academia não encontrada.');
    }

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      const { error } = await supabase.rpc('admin_update_license_limits', {
        p_tenant_id: tenantId,
        p_custom_max_users: limits.customMaxUsers ?? null,
        p_custom_max_branches: limits.customMaxBranches ?? null,
        p_custom_max_students: limits.customMaxStudents ?? null,
        p_reason: reason || 'Ajuste de limites pelo proprietário do SaaS',
      });
      if (error) {
        throw new Error(`Falha ao atualizar limites de licença no Supabase: ${error.message}`);
      }
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
   * Cria uma nova filial/unidade validando estritamente o limite de unidades contratadas (maxBranches).
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
   * Registra uma nova academia de forma totalmente isolada.
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
    const trialExpiry = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
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
      updatedAt: now.toISOString(),
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
      tenantName: newTenant.tradeName,
      planId: 'trial',
      planName: 'Degustação Gratuita (14 Dias)',
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
      `Nova academia "${newTenant.tradeName}" cadastrada com período de degustação gratuita isolado.`
    );

    DataStore.logPlatformAudit(
      userId,
      newOwner.name,
      'register_tenant',
      'tenant',
      tenantId,
      `Nova academia "${newTenant.tradeName}" registrada com período de degustação gratuita (expira em ${
        trialExpiry.toISOString().split('T')[0]
      }).`,
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
   * Consulta o estado real do bootstrap e das migrations no banco de dados.
   */
  async checkBootstrapStatus(candidateEmail?: string): Promise<{
    supabaseConnected: boolean;
    migration25Applied: boolean;
    migration26Applied: boolean;
    migration27Applied: boolean;
    authorizedOwnerEmail: string;
    authorizedOwnerEmails: string[];
    accountExists: boolean;
    emailConfirmed: boolean;
    bootstrapCompleted: boolean;
  }> {
    const localState = DataStore.getPlatformBootstrapState();
    const fallbackEmails = [...OFFICIAL_DOMAINS.platformOwnerEmails];
    const targetEmail = (candidateEmail || OFFICIAL_DOMAINS.platformOwnerEmail).trim().toLowerCase();

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase.rpc('get_platform_bootstrap_status', {
          p_email: targetEmail,
        });
        if (!error && data) {
          const authEmails =
            Array.isArray(data.authorized_emails) && data.authorized_emails.length > 0
              ? data.authorized_emails
              : fallbackEmails;
          return {
            supabaseConnected: true,
            migration25Applied: Boolean(data.migration_25_applied ?? true),
            migration26Applied: Boolean(data.migration_26_applied ?? true),
            migration27Applied: Boolean(data.migration_27_applied ?? true),
            authorizedOwnerEmail: String(data.authorized_owner_email || targetEmail),
            authorizedOwnerEmails: authEmails,
            accountExists: Boolean(data.account_exists || localState.bootstrapped),
            emailConfirmed: Boolean(data.email_confirmed || localState.bootstrapped),
            bootstrapCompleted: Boolean(
              data.bootstrap_completed ||
                (localState.bootstrapped &&
                  (localState.bootstrappedEmails?.includes(targetEmail) ||
                    localState.ownerEmail.toLowerCase() === targetEmail))
            ),
          };
        }

        const { data: dataNoParam, error: errNoParam } = await supabase.rpc('get_platform_bootstrap_status');
        if (!errNoParam && dataNoParam) {
          return {
            supabaseConnected: true,
            migration25Applied: Boolean(dataNoParam.migration_25_applied ?? true),
            migration26Applied: Boolean(dataNoParam.migration_26_applied ?? true),
            migration27Applied: Boolean(dataNoParam.migration_27_applied ?? false),
            authorizedOwnerEmail: String(dataNoParam.authorized_owner_email || targetEmail),
            authorizedOwnerEmails: fallbackEmails,
            accountExists: Boolean(dataNoParam.account_exists || localState.bootstrapped),
            emailConfirmed: Boolean(dataNoParam.email_confirmed || localState.bootstrapped),
            bootstrapCompleted: Boolean(
              dataNoParam.bootstrap_completed ||
                (localState.bootstrapped &&
                  (localState.bootstrappedEmails?.includes(targetEmail) ||
                    localState.ownerEmail.toLowerCase() === targetEmail))
            ),
          };
        }

        if (error && (error.code === 'PGRST202' || error.message?.includes('get_platform_bootstrap_status'))) {
          const { error: planErr } = await supabase
            .from('saas_commercial_plans')
            .select('id, max_team_users')
            .limit(1);
          const mig25Present = !planErr;
          return {
            supabaseConnected: true,
            migration25Applied: mig25Present,
            migration26Applied: false,
            migration27Applied: false,
            authorizedOwnerEmail: targetEmail,
            authorizedOwnerEmails: fallbackEmails,
            accountExists: localState.bootstrapped,
            emailConfirmed: localState.bootstrapped,
            bootstrapCompleted: localState.bootstrapped,
          };
        }
      } catch {
        // fallback silencioso
      }
    }

    const isBootstrappedForEmail = Boolean(
      localState.bootstrappedEmails?.includes(targetEmail) ||
        (localState.bootstrapped && localState.ownerEmail.toLowerCase() === targetEmail)
    );

    return {
      supabaseConnected: false,
      migration25Applied: true,
      migration26Applied: true,
      migration27Applied: true,
      authorizedOwnerEmail: targetEmail,
      authorizedOwnerEmails: fallbackEmails,
      accountExists: isBootstrappedForEmail,
      emailConfirmed: isBootstrappedForEmail,
      bootstrapCompleted: isBootstrappedForEmail,
    };
  },

  /**
   * Valida estritamente se um usuário autenticado possui autorização global para administrar o SaaS.
   */
  async verifyPlatformAdminAuthorization(candidate: {
    id: string;
    email?: string | null;
    role?: string;
    name?: string;
  }): Promise<{
    authorized: boolean;
    reason:
      | 'authorized'
      | 'unauthorized_email'
      | 'forbidden_not_platform_admin'
      | 'email_not_confirmed'
      | 'bootstrap_pending';
    message: string;
    user?: User;
  }> {
    const normalizedEmail = (candidate.email || '').trim().toLowerCase();

    if (!isAuthorizedPlatformOwnerEmail(normalizedEmail)) {
      return {
        authorized: false,
        reason: 'unauthorized_email',
        message: `Acesso negado (403): o endereço "${
          normalizedEmail || 'desconhecido'
        }" não possui privilégios de Administrador Global do SaaS. O painel ${
          OFFICIAL_DOMAINS.SAAS_ADMIN_PANEL
        } é restrito aos administradores autorizados: ${OFFICIAL_DOMAINS.platformOwnerEmails.join(' e ')}.`,
      };
    }

    if (isSupabaseConfigured() && supabase) {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        const { data: verifyData, error: verifyErr } = await supabase.rpc('verify_platform_admin_access');
        if (!verifyErr && verifyData) {
          if (verifyData.is_authorized === true) {
            const syncedUser = await this.bootstrapPlatformOwner({
              email: normalizedEmail,
              userId: candidate.id,
              fullName: verifyData.full_name || candidate.name,
              isVerifiedSession: true,
            });
            return {
              authorized: true,
              reason: 'authorized',
              message: 'Autorização global verificada com sucesso no Supabase.',
              user: syncedUser,
            };
          }

          const reasonCode = verifyData.reason || 'forbidden_not_platform_admin';
          if (reasonCode === 'email_not_confirmed') {
            return {
              authorized: false,
              reason: 'email_not_confirmed',
              message: `O e-mail ${normalizedEmail} ainda aguarda confirmação no Supabase Auth.`,
            };
          }
          if (reasonCode === 'bootstrap_pending') {
            return {
              authorized: false,
              reason: 'bootstrap_pending',
              message: `A conta ${normalizedEmail} foi autenticada, mas o vínculo global (is_platform_admin) ainda não foi inicializado.`,
            };
          }

          return {
            authorized: false,
            reason: 'forbidden_not_platform_admin',
            message: 'Acesso negado (403): esta conta não possui a flag is_platform_admin ativa no banco de dados.',
          };
        }

        const { data: profileRow, error: profileErr } = await supabase
          .from('profiles')
          .select('id, full_name, is_platform_admin')
          .eq('id', candidate.id)
          .maybeSingle();

        if (profileErr || !profileRow || profileRow.is_platform_admin !== true) {
          return {
            authorized: false,
            reason: profileRow ? 'bootstrap_pending' : 'forbidden_not_platform_admin',
            message:
              'Conta autenticada, porém o perfil ainda não possui privilégio de Administrador Global (is_platform_admin = true) confirmado no banco.',
          };
        }

        const syncedUser = await this.bootstrapPlatformOwner({
          email: normalizedEmail,
          userId: candidate.id,
          fullName: profileRow.full_name || candidate.name,
          isVerifiedSession: true,
        });

        return {
          authorized: true,
          reason: 'authorized',
          message: 'Autorização global validada via perfil seguro.',
          user: syncedUser,
        };
      }
    }

    const allUsers = DataStore.getAllUsers();
    const matched = allUsers.find((u) => u.email.trim().toLowerCase() === normalizedEmail);

    if (!matched || matched.role !== 'superadmin' || matched.active === false) {
      return {
        authorized: false,
        reason: 'forbidden_not_platform_admin',
        message: 'Acesso negado (403): o usuário não possui o papel global superadmin ativo.',
      };
    }

    return {
      authorized: true,
      reason: 'authorized',
      message: 'Autorização global verificada.',
      user: matched,
    };
  },

  /**
   * Invoca a Edge Function administrativa protegida `platform-owner-bootstrap`.
   */
  async executeProtectedEdgeBootstrap(params: {
    email: string;
    password: string;
    setupToken: string;
  }): Promise<{ success: boolean; message: string; user?: User }> {
    const normalizedEmail = params.email.trim().toLowerCase();
    if (!isAuthorizedPlatformOwnerEmail(normalizedEmail)) {
      throw new Error(
        `Acesso negado (403): o endereço "${normalizedEmail}" não possui autorização. O bootstrap global é exclusivo para os administradores autorizados: ${OFFICIAL_DOMAINS.platformOwnerEmails.join(
          ' e '
        )}.`
      );
    }
    if (!params.setupToken || params.setupToken.trim().length < 6) {
      throw new Error(
        'É obrigatório informar o Token Administrativo de Inicialização (Setup Token) para autorizar o primeiro acesso.'
      );
    }
    if (!params.password || params.password.length < 6) {
      throw new Error('Defina uma senha forte com no mínimo 6 caracteres.');
    }

    const currentStatus = await this.checkBootstrapStatus(normalizedEmail);
    if (currentStatus.bootstrapCompleted) {
      throw new Error(
        `O bootstrap do administrador (${normalizedEmail}) já foi concluído anteriormente. Utilize o fluxo de Login ou Recuperação de Senha.`
      );
    }

    if (isSupabaseConfigured() && supabase) {
      const { data, error } = await supabase.functions.invoke('platform-owner-bootstrap', {
        body: {
          email: normalizedEmail,
          password: params.password,
          setupToken: params.setupToken.trim(),
        },
        headers: {
          'x-bootstrap-token': params.setupToken.trim(),
        },
      });

      if (!error && data && !data.error) {
        const ownerUser = await this.bootstrapPlatformOwner({
          email: normalizedEmail,
          userId: data?.userId,
          setupToken: params.setupToken.trim(),
          isVerifiedSession: true,
        });

        return {
          success: true,
          message: 'Administrador global inicializado e verificado com sucesso via Edge Function.',
          user: ownerUser,
        };
      }

      if (data?.error) {
        throw new Error(data.error);
      }
    }

    const ownerUser = await this.bootstrapPlatformOwner({
      email: normalizedEmail,
      setupToken: params.setupToken.trim(),
      enforceOneTimeBootstrap: true,
    });

    return {
      success: true,
      message: 'Administrador global inicializado com sucesso.',
      user: ownerUser,
    };
  },

  /**
   * Bootstrap seguro dos administradores globais do SaaS (admin@tatameclub.com.br e beaverstraining@gmail.com).
   */
  async bootstrapPlatformOwner(params: {
    email: string;
    fullName?: string;
    userId?: string;
    setupToken?: string;
    enforceOneTimeBootstrap?: boolean;
    isVerifiedSession?: boolean;
  }): Promise<User> {
    const normalizedEmail = params.email.trim().toLowerCase();
    if (!isAuthorizedPlatformOwnerEmail(normalizedEmail)) {
      throw new Error(
        `Acesso negado (403): o endereço "${normalizedEmail}" não corresponde a um administrador global autorizado (${OFFICIAL_DOMAINS.platformOwnerEmails.join(
          ' e '
        )}).`
      );
    }

    const bootstrapState = DataStore.getPlatformBootstrapState();
    const allUsers = DataStore.getAllUsers();

    const bootstrappedList = bootstrapState.bootstrappedEmails || [];
    const alreadyBootstrapped = bootstrappedList.includes(normalizedEmail);
    if (params.enforceOneTimeBootstrap && alreadyBootstrapped) {
      throw new Error(
        `O bootstrap do administrador (${normalizedEmail}) já foi concluído anteriormente. Utilize o fluxo de Login ou Recuperação de Senha.`
      );
    }

    if (params.enforceOneTimeBootstrap && params.setupToken !== undefined) {
      const expectedToken = bootstrapState.setupTokenHash || 'TATAME-CLUB-OWNER-BOOTSTRAP-2026';
      if (!params.setupToken.trim() || params.setupToken.trim() !== expectedToken) {
        throw new Error(
          'Token administrativo de inicialização inválido. O primeiro acesso exige verificação de segurança.'
        );
      }
    }

    const conflictingAcademyUser = allUsers.find(
      (u) => u.email.toLowerCase() === normalizedEmail && u.role !== 'superadmin'
    );
    if (conflictingAcademyUser) {
      throw new Error(
        'Conflito de segurança: este endereço pertence a um perfil de academia comum e não pode ser promovido a Administrador Global.'
      );
    }

    let ownerUser = allUsers.find(
      (u) =>
        (u.email.toLowerCase() === normalizedEmail && u.role === 'superadmin') ||
        (normalizedEmail === 'admin@tatameclub.com.br' && u.id === 'user-superadmin' && u.role === 'superadmin') ||
        (normalizedEmail === 'beaverstraining@gmail.com' && u.id === 'user-superadmin-beavers' && u.role === 'superadmin')
    );

    const defaultAdminName =
      normalizedEmail === 'beaverstraining@gmail.com'
        ? 'Administrador Global Tatame Club'
        : 'Proprietário Tatame Club';

    const defaultAdminId =
      normalizedEmail === 'beaverstraining@gmail.com'
        ? 'user-superadmin-beavers'
        : 'user-superadmin';

    if (!ownerUser) {
      ownerUser = {
        id: params.userId || defaultAdminId,
        tenantId: 'platform',
        name: params.fullName?.trim() || defaultAdminName,
        email: normalizedEmail,
        role: 'superadmin',
        phone: '(11) 99999-0000',
        active: true,
      };
      DataStore.saveUsers([ownerUser, ...allUsers]);
    } else {
      if (params.userId) {
        ownerUser.id = params.userId;
      }
      ownerUser.email = normalizedEmail;
      ownerUser.role = 'superadmin';
      ownerUser.tenantId = 'platform';
      ownerUser.active = true;
      if (params.fullName?.trim()) {
        ownerUser.name = params.fullName.trim();
      }
      DataStore.saveUsers(allUsers);
    }

    const updatedBootstrappedEmails = Array.from(
      new Set([...(bootstrapState.bootstrappedEmails || []), normalizedEmail])
    );
    DataStore.savePlatformBootstrapState({
      ...bootstrapState,
      bootstrapped: true,
      bootstrappedEmails: updatedBootstrappedEmails,
      ownerEmail: normalizedEmail,
      bootstrappedAt: bootstrapState.bootstrappedAt || new Date().toISOString(),
    });

    DataStore.logPlatformAudit(
      ownerUser.id,
      ownerUser.name,
      'bootstrap_platform_owner',
      'user',
      ownerUser.id,
      `Administrador global da plataforma Tatame Club (${normalizedEmail}) verificado e habilitado com segurança.`
    );

    return ownerUser;
  },
};
