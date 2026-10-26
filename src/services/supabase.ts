import { createClient, SupabaseClient, User as SupabaseUser, Session } from '@supabase/supabase-js';

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

/**
 * Interface dos vínculos multi-tenant carregados do Supabase
 */
export interface UserMembership {
  id: string;
  tenant_id: string;
  branch_id?: string | null;
  role: 'owner' | 'branch_manager' | 'secretary' | 'financial' | 'instructor' | 'student' | 'guardian';
  status: 'active' | 'suspended' | 'invited';
  tenant?: {
    id: string;
    trade_name: string;
    legal_name?: string;
    cnpj_or_cpf: string;
    plan_id: string;
    status: string;
    trial_expires_at?: string;
    settings?: any;
    logo_url?: string;
  } | null;
  branch?: {
    id: string;
    name: string;
    is_headquarter: boolean;
  } | null;
}

/**
 * Serviços de Autenticação com Supabase Auth
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
        emailRedirectTo,
        data: {
          full_name: fullName,
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
    const targetRedirect =
      redirectTo || (typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : 'https://tatameclub.com.br/reset-password');
    return await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: targetRedirect,
    });
  },

  /**
   * Carrega os vínculos da tabela tenant_memberships para o usuário autenticado.
   * Não confia em papéis do frontend: busca exclusivamente registros autorizados via RLS.
   */
  async loadUserMemberships(userId: string): Promise<UserMembership[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
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
          plan_id,
          status,
          trial_expires_at,
          settings,
          logo_url
        ),
        branch:branches (
          id,
          name,
          is_headquarter
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      console.error('Erro ao carregar tenant_memberships:', error);
      return [];
    }

    return (data as unknown as UserMembership[]) || [];
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
