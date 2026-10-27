import { createClient, SupabaseClient, User as SupabaseUser, Session } from '@supabase/supabase-js';
import { Tenant, LegalAcceptanceRecord } from '../types';
import { DataStore } from '../data/storage';
import { getAuthRedirectUrl } from '../utils/domainConfig';

export const LEGAL_DOCUMENT_VERSIONS = {
  termsVersion: '1.0.0-2026',
  privacyVersion: '1.0.0-2026',
  terms_of_use: '1.0.0-2026',
  privacy_policy: '1.0.0-2026',
  effectiveDate: '27/10/2026',
  developerCompany: 'Beaver Soluções em Tecnologia',
  developerCnpj: '28.410.730/0001-80',
};

// Variáveis de ambiente públicas do cliente (Vite / Node)
const getEnvVar = (key: string): string | undefined => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    return (import.meta as any).env[key];
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return undefined;
};

/**
 * Normaliza a URL base do projeto Supabase removendo sufixos acidentais como
 * `/rest/v1/`, `/auth/v1/` ou barras finais que causariam erro HTTP 404 (PGRST125)
 * ao concatenar os endpoints internos do SDK `@supabase/supabase-js`.
 */
export const normalizeSupabaseUrl = (rawUrl?: string): string | undefined => {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  return trimmed
    .replace(/\/(rest|auth|storage|functions)\/v1\/?$/i, '')
    .replace(/\/+$/, '');
};

const rawSupabaseUrl = getEnvVar('VITE_SUPABASE_URL');
export const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl);
const supabaseKey = getEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY') || getEnvVar('VITE_SUPABASE_ANON_KEY');

// Validação de configuração
export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
    supabaseKey &&
    supabaseUrl !== 'https://your-project.supabase.co' &&
    supabaseKey !== 'your-anon-or-publishable-key' &&
    supabaseUrl.startsWith('https://')
  );
};

export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(supabaseUrl!, supabaseKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'tatamehub_supabase_auth_token',
      },
    })
  : null;

function isValidUUID(id?: string | null): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Interface dos vínculos multi-tenant carregados do Supabase
 */
export interface UserMembership {
  id: string;
  tenant_id: string;
  branch_id?: string | null;
  role: 'owner' | 'branch_manager' | 'secretary' | 'financial' | 'instructor' | 'student' | 'guardian';
  status: 'active' | 'suspended' | 'invited';
  student_id?: string | null;
  guardian_person_id?: string | null;
  tenant?: {
    id: string;
    trade_name: string;
    legal_name?: string;
    cnpj_or_cpf: string;
    admin_name?: string;
    email?: string;
    phone?: string;
    whatsapp?: string;
    website?: string;
    logo_url?: string;
    address?: any;
    plan_id: string;
    status: string;
    trial_started_at?: string;
    trial_expires_at?: string;
    retention_days?: number;
    settings?: any;
    updated_at?: string;
  } | null;
  branch?: {
    id: string;
    name: string;
    is_headquarter: boolean;
  } | null;
}

/**
 * Mapeia uma linha da tabela `tenants` do Supabase para o objeto `Tenant` do frontend
 * preservando todos os campos configurados sem sobrescrever com valores vazios.
 */
export function mapSupabaseRowToTenant(row: any, existingFallback?: Partial<Tenant>): Tenant {
  const defaultSettings = {
    defaultDueDay: 10,
    penaltyRate: 2,
    dailyInterestRate: 0.033,
    familyDiscount2ndMember: 15,
    multiArtDiscount: 20,
    customBrandColor: '#dc2626',
  };

  const rawSettings = row?.settings && typeof row.settings === 'object' ? row.settings : {};
  const rawAddress = row?.address && typeof row.address === 'object' ? row.address : {};

  return {
    id: row.id,
    tradeName: row.trade_name ?? existingFallback?.tradeName ?? 'Tatame Club Dojo',
    legalName: row.legal_name ?? row.trade_name ?? existingFallback?.legalName ?? '',
    cnpjOrCpf: row.cnpj_or_cpf ?? existingFallback?.cnpjOrCpf ?? '',
    adminName: row.admin_name ?? existingFallback?.adminName ?? 'Administrador',
    email: row.email ?? existingFallback?.email ?? '',
    phone: row.phone ?? existingFallback?.phone ?? '',
    whatsapp: row.whatsapp ?? row.phone ?? existingFallback?.whatsapp ?? '',
    website: row.website ?? existingFallback?.website ?? undefined,
    logoUrl: row.logo_url ?? existingFallback?.logoUrl ?? undefined,
    address: {
      street: rawAddress.street ?? existingFallback?.address?.street ?? '',
      number: rawAddress.number ?? existingFallback?.address?.number ?? '',
      complement: rawAddress.complement ?? existingFallback?.address?.complement ?? undefined,
      neighborhood: rawAddress.neighborhood ?? existingFallback?.address?.neighborhood ?? '',
      city: rawAddress.city ?? existingFallback?.address?.city ?? 'São Paulo',
      state: rawAddress.state ?? existingFallback?.address?.state ?? 'SP',
      zipCode: rawAddress.zipCode ?? existingFallback?.address?.zipCode ?? '',
    },
    planId: (row.plan_id as any) || existingFallback?.planId || 'trial',
    status: (row.status as any) || existingFallback?.status || 'trial',
    trialStartedAt: row.trial_started_at || existingFallback?.trialStartedAt || new Date().toISOString(),
    trialExpiresAt: row.trial_expires_at || existingFallback?.trialExpiresAt || new Date().toISOString(),
    createdAt: row.created_at || existingFallback?.createdAt || new Date().toISOString(),
    retentionDays: Number(row.retention_days ?? existingFallback?.retentionDays ?? 60),
    settings: {
      defaultDueDay: Number(
        rawSettings.defaultDueDay ?? existingFallback?.settings?.defaultDueDay ?? defaultSettings.defaultDueDay
      ),
      penaltyRate: Number(
        rawSettings.penaltyRate ?? existingFallback?.settings?.penaltyRate ?? defaultSettings.penaltyRate
      ),
      dailyInterestRate: Number(
        rawSettings.dailyInterestRate ??
          existingFallback?.settings?.dailyInterestRate ??
          defaultSettings.dailyInterestRate
      ),
      familyDiscount2ndMember: Number(
        rawSettings.familyDiscount2ndMember ??
          existingFallback?.settings?.familyDiscount2ndMember ??
          defaultSettings.familyDiscount2ndMember
      ),
      multiArtDiscount: Number(
        rawSettings.multiArtDiscount ??
          existingFallback?.settings?.multiArtDiscount ??
          defaultSettings.multiArtDiscount
      ),
      customBrandColor:
        rawSettings.customBrandColor ??
        existingFallback?.settings?.customBrandColor ??
        defaultSettings.customBrandColor,
    },
  };
}

/**
 * Serviços de Autenticação, Configurações do Dojo e Aceite Legal com Supabase Auth
 */
export const authService = {
  async getSession(): Promise<Session | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('Erro ao obter sessão Supabase:', error.message);
      return null;
    }
    return data.session;
  },

  async getUser(): Promise<SupabaseUser | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user;
  },

  async signInWithEmail(email: string, password: string) {
    if (!supabase) {
      throw new Error('Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.');
    }
    return await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
  },

  async signUpWithEmail(email: string, password: string, fullName: string, emailRedirectTo?: string) {
    if (!supabase) {
      throw new Error('Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.');
    }
    return await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: emailRedirectTo || getAuthRedirectUrl('main_site'),
        data: {
          full_name: fullName,
        },
      },
    });
  },

  async signUp(email: string, password: string, fullName: string, emailRedirectTo?: string) {
    return await this.signUpWithEmail(email, password, fullName, emailRedirectTo);
  },

  /**
   * Inicia o fluxo de login OAuth com Google via Supabase Auth.
   * Nunca expõe segredos OAuth no frontend e redireciona para a URL permitida do ambiente.
   */
  async signInWithGoogle(redirectTarget: 'main_site' | 'saas_admin_panel' = 'main_site') {
    if (!supabase) {
      throw new Error(
        'O provedor Google OAuth requer o Supabase configurado (VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY).'
      );
    }
    const redirectTo = getAuthRedirectUrl(redirectTarget);
    return await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account',
        },
      },
    });
  },

  async signOut() {
    if (!supabase) return;
    return await supabase.auth.signOut();
  },

  async resetPasswordForEmail(email: string, redirectTo?: string) {
    if (!supabase) {
      throw new Error('Supabase não configurado.');
    }
    const targetRedirect = redirectTo || getAuthRedirectUrl('reset_password');
    return await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: targetRedirect,
    });
  },

  /**
   * Carrega os vínculos da tabela tenant_memberships para o usuário autenticado.
   * Busca todos os campos de configuração da academia para evitar perda de estado.
   */
  async loadUserMemberships(userId: string): Promise<UserMembership[]> {
    if (!supabase) return [];

    // Tentativa 1: Consulta completa incluindo student_id, guardian_person_id e todas as colunas de tenants
    const { data, error } = await supabase
      .from('tenant_memberships')
      .select(`
        id,
        tenant_id,
        branch_id,
        role,
        status,
        student_id,
        guardian_person_id,
        tenant:tenants (
          id,
          trade_name,
          legal_name,
          cnpj_or_cpf,
          admin_name,
          email,
          phone,
          whatsapp,
          website,
          logo_url,
          address,
          plan_id,
          status,
          trial_started_at,
          trial_expires_at,
          retention_days,
          settings,
          updated_at
        ),
        branch:branches (
          id,
          name,
          is_headquarter
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'active');

    if (!error && data) {
      return (data as unknown as UserMembership[]) || [];
    }

    // Fallback compatível caso a Migration 28 ainda não tenha adicionado student_id/guardian_person_id no banco remoto
    const fallbackRes = await supabase
      .from('tenant_memberships')
      .select(`
        id,
        tenant_id,
        branch_id,
        role,
        status,
        tenant:tenants (
          id,
          trade_name,
          legal_name,
          cnpj_or_cpf,
          admin_name,
          email,
          phone,
          whatsapp,
          website,
          logo_url,
          address,
          plan_id,
          status,
          trial_started_at,
          trial_expires_at,
          retention_days,
          settings,
          updated_at
        ),
        branch:branches (
          id,
          name,
          is_headquarter
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'active');

    if (fallbackRes.error) {
      console.error('Erro ao carregar tenant_memberships:', fallbackRes.error);
      return [];
    }

    return (fallbackRes.data as unknown as UserMembership[]) || [];
  },

  /**
   * Busca as configurações atualizadas do Dojo diretamente no Supabase para a academia ativa.
   */
  async fetchTenantSettings(tenantId: string): Promise<Tenant | null> {
    if (!tenantId) return null;

    const localTenants = DataStore.getTenants();
    const localMatch = localTenants.find((t) => t.id === tenantId);

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      // 1. Tentar via RPC get_tenant_dojo_settings
      const rpcRes = await supabase.rpc('get_tenant_dojo_settings', {
        p_tenant_id: tenantId,
      });

      if (!rpcRes.error && rpcRes.data) {
        const mapped = mapSupabaseRowToTenant(rpcRes.data, localMatch);
        const updatedList = localTenants.some((t) => t.id === tenantId)
          ? localTenants.map((t) => (t.id === tenantId ? mapped : t))
          : [mapped, ...localTenants];
        DataStore.saveTenants(updatedList);
        return mapped;
      }

      // 2. Fallback para SELECT direto na tabela public.tenants (respeitando RLS)
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .maybeSingle();

      if (error) {
        console.warn('Erro ao buscar configurações do Dojo no Supabase:', error.message);
        return localMatch || null;
      }

      if (data) {
        const mapped = mapSupabaseRowToTenant(data, localMatch);
        const updatedList = localTenants.some((t) => t.id === tenantId)
          ? localTenants.map((t) => (t.id === tenantId ? mapped : t))
          : [mapped, ...localTenants];
        DataStore.saveTenants(updatedList);
        return mapped;
      }
    }

    return localMatch || null;
  },

  /**
   * Grava as configurações do Dojo no Supabase e aguarda a confirmação efetiva do banco.
   * Nunca retorna falso sucesso se houver erro de banco/RLS.
   */
  async saveTenantSettings(updatedTenant: Tenant, actorUser?: { id?: string; name?: string }): Promise<Tenant> {
    if (!updatedTenant || !updatedTenant.id) {
      throw new Error('Identificador da academia (tenant_id) inválido.');
    }

    if (!updatedTenant.tradeName || !updatedTenant.tradeName.trim()) {
      throw new Error('O Nome Fantasia do Dojo é obrigatório.');
    }

    if (!updatedTenant.cnpjOrCpf || !updatedTenant.cnpjOrCpf.trim()) {
      throw new Error('O CNPJ ou CPF da academia é obrigatório.');
    }

    const sanitizedTenant: Tenant = {
      ...updatedTenant,
      tradeName: updatedTenant.tradeName.trim(),
      legalName: (updatedTenant.legalName || updatedTenant.tradeName).trim(),
      cnpjOrCpf: updatedTenant.cnpjOrCpf.trim(),
      adminName: (updatedTenant.adminName || 'Administrador').trim(),
      email: (updatedTenant.email || '').trim().toLowerCase(),
      phone: (updatedTenant.phone || '').trim(),
      whatsapp: (updatedTenant.whatsapp || updatedTenant.phone || '').trim(),
      website: updatedTenant.website?.trim() || undefined,
      logoUrl: updatedTenant.logoUrl?.trim() || undefined,
      retentionDays: Math.max(30, Number(updatedTenant.retentionDays || 60)),
      address: {
        street: updatedTenant.address?.street?.trim() || '',
        number: updatedTenant.address?.number?.trim() || '',
        complement: updatedTenant.address?.complement?.trim() || undefined,
        neighborhood: updatedTenant.address?.neighborhood?.trim() || '',
        city: updatedTenant.address?.city?.trim() || 'São Paulo',
        state: updatedTenant.address?.state?.trim() || 'SP',
        zipCode: updatedTenant.address?.zipCode?.trim() || '',
      },
      settings: {
        ...updatedTenant.settings,
        defaultDueDay: Math.min(28, Math.max(1, Number(updatedTenant.settings?.defaultDueDay ?? 10))),
        penaltyRate: Math.max(0, Number(updatedTenant.settings?.penaltyRate ?? 2)),
        dailyInterestRate: Math.max(0, Number(updatedTenant.settings?.dailyInterestRate ?? 0.033)),
        familyDiscount2ndMember: Math.min(100, Math.max(0, Number(updatedTenant.settings?.familyDiscount2ndMember ?? 15))),
        multiArtDiscount: Math.min(100, Math.max(0, Number(updatedTenant.settings?.multiArtDiscount ?? 20))),
        customBrandColor: updatedTenant.settings?.customBrandColor || '#dc2626',
      },
    };

    // Persistência real no Supabase quando configurado e com UUID válido
    if (isSupabaseConfigured() && supabase && isValidUUID(sanitizedTenant.id)) {
      // 1. Tentar via RPC transacional update_tenant_dojo_settings
      const rpcRes = await supabase.rpc('update_tenant_dojo_settings', {
        p_tenant_id: sanitizedTenant.id,
        p_trade_name: sanitizedTenant.tradeName,
        p_legal_name: sanitizedTenant.legalName,
        p_cnpj_or_cpf: sanitizedTenant.cnpjOrCpf,
        p_admin_name: sanitizedTenant.adminName,
        p_email: sanitizedTenant.email,
        p_phone: sanitizedTenant.phone,
        p_whatsapp: sanitizedTenant.whatsapp,
        p_website: sanitizedTenant.website || null,
        p_logo_url: sanitizedTenant.logoUrl || null,
        p_address: sanitizedTenant.address,
        p_retention_days: sanitizedTenant.retentionDays,
        p_settings: sanitizedTenant.settings,
      });

      if (!rpcRes.error && rpcRes.data?.success && rpcRes.data?.tenant) {
        const confirmedTenant = mapSupabaseRowToTenant(rpcRes.data.tenant, sanitizedTenant);
        const allTenants = DataStore.getTenants();
        const nextTenants = allTenants.some((t) => t.id === confirmedTenant.id)
          ? allTenants.map((t) => (t.id === confirmedTenant.id ? confirmedTenant : t))
          : [confirmedTenant, ...allTenants];
        DataStore.saveTenants(nextTenants);
        return confirmedTenant;
      }

      // Se o erro da RPC não for "função inexistente" (42883 / PGRST202), mas sim erro de permissão/validação, lançar!
      if (
        rpcRes.error &&
        rpcRes.error.code !== '42883' &&
        rpcRes.error.code !== 'PGRST202' &&
        !rpcRes.error.message?.includes('Could not find the function')
      ) {
        throw new Error(rpcRes.error.message || 'Falha ao gravar as configurações no Supabase.');
      }

      // 2. Fallback para UPDATE direto na tabela public.tenants (caso a Migration 28 ainda não tenha sido aplicada)
      // Importante: atualiza apenas colunas de configuração, sem tocar em plan_id/status/trial_expires_at
      const { data: updatedRow, error: updateError } = await supabase
        .from('tenants')
        .update({
          trade_name: sanitizedTenant.tradeName,
          legal_name: sanitizedTenant.legalName,
          cnpj_or_cpf: sanitizedTenant.cnpjOrCpf,
          admin_name: sanitizedTenant.adminName,
          email: sanitizedTenant.email,
          phone: sanitizedTenant.phone,
          whatsapp: sanitizedTenant.whatsapp,
          website: sanitizedTenant.website || null,
          logo_url: sanitizedTenant.logoUrl || null,
          address: sanitizedTenant.address,
          retention_days: sanitizedTenant.retentionDays,
          settings: sanitizedTenant.settings,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sanitizedTenant.id)
        .select('*')
        .maybeSingle();

      if (updateError) {
        throw new Error(updateError.message || 'Não foi possível salvar as configurações do Dojo no Supabase.');
      }

      if (!updatedRow) {
        throw new Error(
          'Nenhuma alteração foi confirmada pelo banco de dados. Verifique se sua conta possui permissão de Proprietário (Owner) ou Gestor nesta academia.'
        );
      }

      const confirmedTenant = mapSupabaseRowToTenant(updatedRow, sanitizedTenant);
      const allTenants = DataStore.getTenants();
      const nextTenants = allTenants.some((t) => t.id === confirmedTenant.id)
        ? allTenants.map((t) => (t.id === confirmedTenant.id ? confirmedTenant : t))
        : [confirmedTenant, ...allTenants];
      DataStore.saveTenants(nextTenants);
      return confirmedTenant;
    }

    // Modo local / ambiente de homologação sem Supabase configurado
    const allTenants = DataStore.getTenants();
    const exists = allTenants.some((t) => t.id === sanitizedTenant.id);
    const nextTenants = exists
      ? allTenants.map((t) => (t.id === sanitizedTenant.id ? sanitizedTenant : t))
      : [sanitizedTenant, ...allTenants];
    DataStore.saveTenants(nextTenants);

    DataStore.logAudit(
      sanitizedTenant.id,
      actorUser?.id || 'owner',
      actorUser?.name || sanitizedTenant.adminName || 'Administrador',
      'Atualização de Configurações do Dojo',
      'Tenant',
      sanitizedTenant.id,
      `Configurações do Dojo "${sanitizedTenant.tradeName}" atualizadas.`
    );

    return sanitizedTenant;
  },

  /**
   * Registra o aceite contratual dos Termos de Uso e a ciência da Política de Privacidade.
   */
  async recordLegalAcceptance(params: {
    userId: string;
    tenantId?: string;
    termsVersion?: string;
    privacyVersion?: string;
    context: LegalAcceptanceRecord['acceptanceContext'];
    specificConsents?: Record<string, boolean>;
  }): Promise<LegalAcceptanceRecord> {
    const termsVer = params.termsVersion || '1.0.0-2026';
    const privacyVer = params.privacyVersion || '1.0.0-2026';
    const nowIso = new Date().toISOString();

    if (isSupabaseConfigured() && supabase && isValidUUID(params.userId)) {
      try {
        await supabase.rpc('record_legal_acceptance', {
          p_tenant_id: params.tenantId && isValidUUID(params.tenantId) ? params.tenantId : null,
          p_terms_version: termsVer,
          p_privacy_version: privacyVer,
          p_context: params.context,
          p_specific_consents: params.specificConsents || {},
          p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        });
      } catch (err) {
        console.warn('Aviso ao registrar aceite legal no Supabase:', err);
      }
    }

    const record: LegalAcceptanceRecord = {
      id: `legal-${Date.now()}`,
      userId: params.userId,
      tenantId: params.tenantId,
      termsVersion: termsVer,
      privacyVersion: privacyVer,
      acceptanceContext: params.context,
      acceptedTerms: true,
      acknowledgedPrivacy: true,
      specificConsents: params.specificConsents || {},
      acceptedAt: nowIso,
    };

    try {
      if (typeof localStorage !== 'undefined') {
        const key = 'tatamehub_legal_acceptances';
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        localStorage.setItem(key, JSON.stringify([record, ...existing]));
      }
    } catch {
      // ignore
    }

    return record;
  },

  /**
   * Chamada segura da função RPC atômica register_academy_atomic() criada no banco.
   * O proprietário é associado pelo auth.uid() no servidor do Supabase.
   */
  async registerAcademyAtomic(params: {
    tradeName: string;
    legalName?: string;
    cnpjOrCpf: string;
    adminName: string;
    phone: string;
    whatsapp?: string;
    address?: any;
  }) {
    if (!supabase) {
      throw new Error('Supabase não configurado.');
    }

    const { data, error } = await supabase.rpc('register_academy_atomic', {
      p_trade_name: params.tradeName,
      p_legal_name: params.legalName || params.tradeName,
      p_cnpj_or_cpf: params.cnpjOrCpf,
      p_admin_name: params.adminName,
      p_phone: params.phone,
      p_whatsapp: params.whatsapp || params.phone,
      p_address: params.address || {},
    });

    if (error) {
      throw error;
    }

    return data;
  },
};
