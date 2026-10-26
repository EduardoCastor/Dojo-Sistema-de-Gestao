/**
 * Configuração Oficial de Domínios, Redirecionamentos e Identidade do Administrador Global — Tatame Club
 *
 * Domínios oficiais:
 * - Site comercial e ambiente das academias: https://tatameclub.com.br
 * - Painel administrativo exclusivo do proprietário do SaaS: https://painel.tatameclub.com.br
 * - E-mail oficial do proprietário global: admin@tatameclub.com.br
 */

export const DEFAULT_PLATFORM_OWNER_EMAIL = 'admin@tatameclub.com.br';
export const LEGACY_PLATFORM_OWNER_EMAIL = 'beaverstraining@gmail.com';

function resolveEnvPlatformOwnerEmail(): string {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_PLATFORM_OWNER_EMAIL) {
      const envVal = String((import.meta as any).env.VITE_PLATFORM_OWNER_EMAIL).trim().toLowerCase();
      if (envVal && envVal.includes('@')) {
        return envVal;
      }
    }
    if (typeof process !== 'undefined' && process.env?.VITE_PLATFORM_OWNER_EMAIL) {
      const envVal = String(process.env.VITE_PLATFORM_OWNER_EMAIL).trim().toLowerCase();
      if (envVal && envVal.includes('@')) {
        return envVal;
      }
    }
  } catch {
    // ignore environment access errors
  }
  return DEFAULT_PLATFORM_OWNER_EMAIL;
}

const resolvedOwnerEmail = resolveEnvPlatformOwnerEmail();

export const OFFICIAL_DOMAINS = {
  MAIN_SITE: 'tatameclub.com.br',
  MAIN_SITE_URL: 'https://tatameclub.com.br',
  SAAS_ADMIN_PANEL: 'painel.tatameclub.com.br',
  SAAS_ADMIN_PANEL_URL: 'https://painel.tatameclub.com.br',
  PLATFORM_OWNER_EMAIL: resolvedOwnerEmail,
  // CamelCase aliases for UI convenience
  mainSiteHost: 'tatameclub.com.br',
  mainSiteUrl: 'https://tatameclub.com.br',
  saasAdminHost: 'painel.tatameclub.com.br',
  saasAdminUrl: 'https://painel.tatameclub.com.br',
  platformOwnerEmail: resolvedOwnerEmail,
} as const;

export type AppEnvironmentMode = 'main_site' | 'saas_admin_panel';

/**
 * Retorna o e-mail oficial configurado para o proprietário global do SaaS.
 */
export function getAuthorizedPlatformOwnerEmail(): string {
  return resolveEnvPlatformOwnerEmail();
}

/**
 * Detecta se a execução atual corresponde ao hostname ou rota dedicada do
 * Painel Administrativo Global do SaaS (painel.tatameclub.com.br).
 *
 * Suporta:
 * 1. Hostname de produção: `painel.tatameclub.com.br` (ou subdomínios iniciados por `painel.`)
 * 2. Rota dedicada compatível com SPA/Preview: `/painel` ou `?env=painel`
 */
export function detectEnvironmentMode(
  hostname?: string,
  pathname?: string,
  search?: string,
  hash?: string
): AppEnvironmentMode {
  const host = (
    hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  ).toLowerCase();
  const path = (
    pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '')
  ).toLowerCase();
  const query =
    search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const urlHash = (
    hash ?? (typeof window !== 'undefined' ? window.location.hash : '')
  ).toLowerCase();

  if (
    host === OFFICIAL_DOMAINS.SAAS_ADMIN_PANEL ||
    host.startsWith('painel.')
  ) {
    return 'saas_admin_panel';
  }

  if (
    path === '/painel' ||
    path.startsWith('/painel/') ||
    path.endsWith('/painel') ||
    path.includes('/painel/')
  ) {
    return 'saas_admin_panel';
  }

  if (urlHash === '#painel' || urlHash === '#/painel' || urlHash.includes('env=painel')) {
    return 'saas_admin_panel';
  }

  if (query) {
    try {
      const params = new URLSearchParams(query);
      if (params.get('env') === 'painel') {
        return 'saas_admin_panel';
      }
    } catch {
      // ignore malformed query
    }
  }

  return 'main_site';
}

/**
 * Verifica se o e-mail informado corresponde ao endereço oficial do proprietário global do SaaS.
 * Nota: Esta validação identifica o endereço pretendido, mas a autorização efetiva exige
 * também validação do papel/flag `is_platform_admin` no backend/Supabase.
 */
export function isAuthorizedPlatformOwnerEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === getAuthorizedPlatformOwnerEmail();
}

/**
 * Constrói a URL segura de redirecionamento de autenticação (confirmação de e-mail / redefinição de senha),
 * preservando o domínio oficial `https://painel.tatameclub.com.br` em produção sem depender de URLs de desenvolvimento.
 */
export function getAuthRedirectUrl(target: 'main_site' | 'saas_admin_panel' | 'reset_password'): string {
  if (typeof window === 'undefined') {
    return target === 'saas_admin_panel'
      ? OFFICIAL_DOMAINS.SAAS_ADMIN_PANEL_URL
      : OFFICIAL_DOMAINS.MAIN_SITE_URL;
  }

  const host = window.location.hostname.toLowerCase();
  const origin = window.location.origin;

  // Em produção nos domínios oficiais
  if (host === OFFICIAL_DOMAINS.SAAS_ADMIN_PANEL || host.startsWith('painel.')) {
    return OFFICIAL_DOMAINS.SAAS_ADMIN_PANEL_URL;
  }
  if (host === OFFICIAL_DOMAINS.MAIN_SITE || host === `www.${OFFICIAL_DOMAINS.MAIN_SITE}`) {
    if (target === 'saas_admin_panel') {
      return OFFICIAL_DOMAINS.SAAS_ADMIN_PANEL_URL;
    }
    return target === 'reset_password'
      ? `${OFFICIAL_DOMAINS.MAIN_SITE_URL}/reset-password`
      : OFFICIAL_DOMAINS.MAIN_SITE_URL;
  }

  // Em ambiente de homologação / preview / local
  if (target === 'saas_admin_panel') {
    return `${origin}/?env=painel`;
  }
  return target === 'reset_password' ? `${origin}/reset-password` : origin;
}
