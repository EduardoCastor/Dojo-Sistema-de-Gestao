/**
 * Configuração Oficial de Domínios e Separação de Ambientes — Tatame Club
 *
 * Domínios oficiais desejados:
 * - Site comercial e ambiente das academias: https://tatameclub.com.br
 * - Painel administrativo exclusivo do proprietário do SaaS: https://painel.tatameclub.com.br
 */

export const OFFICIAL_DOMAINS = {
  MAIN_SITE: 'tatameclub.com.br',
  MAIN_SITE_URL: 'https://tatameclub.com.br',
  SAAS_ADMIN_PANEL: 'painel.tatameclub.com.br',
  SAAS_ADMIN_PANEL_URL: 'https://painel.tatameclub.com.br',
  PLATFORM_OWNER_EMAIL: 'admin@tatameclub.com.br',
  // CamelCase aliases for UI convenience
  mainSiteHost: 'tatameclub.com.br',
  mainSiteUrl: 'https://tatameclub.com.br',
  saasAdminHost: 'painel.tatameclub.com.br',
  saasAdminUrl: 'https://painel.tatameclub.com.br',
  platformOwnerEmail: 'admin@tatameclub.com.br',
} as const;

export type AppEnvironmentMode = 'main_site' | 'saas_admin_panel';

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
  search?: string
): AppEnvironmentMode {
  const host = (
    hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '')
  ).toLowerCase();
  const path = (
    pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '')
  ).toLowerCase();
  const query =
    search ?? (typeof window !== 'undefined' ? window.location.search : '');

  if (
    host === OFFICIAL_DOMAINS.SAAS_ADMIN_PANEL ||
    host.startsWith('painel.')
  ) {
    return 'saas_admin_panel';
  }

  if (path === '/painel' || path.startsWith('/painel/')) {
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
 * Verifica se o e-mail informado pertence ao proprietário global autorizado do SaaS.
 */
export function isAuthorizedPlatformOwnerEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === OFFICIAL_DOMAINS.PLATFORM_OWNER_EMAIL;
}
