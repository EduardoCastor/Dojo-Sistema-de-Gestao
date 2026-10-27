/**
 * Gerenciador Seguro de Rascunhos Temporários de Formulários e Estado de Navegação (BUG 1)
 *
 * Regras de segurança e privacidade (LGPD):
 * 1. Armazena apenas rascunhos temporários de formulários em andamento para evitar perda de dados
 *    ao alternar entre abas do navegador ou recarregar acidentalmente a página.
 * 2. Isola cada rascunho por (tenantId + userId + formKey), garantindo que um usuário ou academia
 *    JAMAIS visualize ou restaure rascunhos de outro usuário.
 * 3. Filtra e remove automaticamente campos sensíveis (senhas, tokens, chaves, segredos).
 * 4. Aplica política de retenção curta (TTL padrão de 12 horas) e limpeza automática ao concluir,
 *    cancelar ou expirar.
 */

const DRAFT_PREFIX = 'tatameclub_draft_v1_';
const NAV_SESSION_PREFIX = 'tatameclub_nav_v1_';
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

const FORBIDDEN_SENSITIVE_KEYS = new Set([
  'password',
  'confirmpassword',
  'newpassword',
  'currentpassword',
  'senha',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'apikey',
  'service_role',
]);

export interface StoredFormDraft<T = Record<string, any>> {
  status?: 'found';
  tenantId: string;
  userId: string;
  formKey: string;
  step?: number | string;
  data: T;
  savedAt: number;
  expiresAt: number;
}

const memoryDrafts = new Map<string, string>();

function isSensitiveFieldName(key: string): boolean {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (FORBIDDEN_SENSITIVE_KEYS.has(normalizedKey)) return true;
  return (
    normalizedKey.includes('password') ||
    normalizedKey.includes('senha') ||
    normalizedKey.includes('token') ||
    normalizedKey.includes('secret') ||
    normalizedKey.includes('apikey') ||
    normalizedKey.includes('service_role')
  );
}

function sanitizeDraftPayload<T>(payload: T): T {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeDraftPayload(item)) as unknown as T;
  }

  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload as Record<string, any>)) {
    if (isSensitiveFieldName(key)) {
      continue;
    }
    if (value && typeof value === 'object') {
      cleaned[key] = sanitizeDraftPayload(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned as T;
}

function buildStorageKey(tenantId: string, userId: string, formKey: string): string {
  const safeTenant = (tenantId || 'public').trim().toLowerCase();
  const safeUser = (userId || 'anonymous').trim().toLowerCase();
  const safeForm = formKey.trim().toLowerCase();
  return `${DRAFT_PREFIX}${safeTenant}__${safeUser}__${safeForm}`;
}

export const formDraftStore = {
  /**
   * Remove rascunhos expirados do armazenamento local.
   */
  purgeExpiredDrafts(nowMs: number = Date.now()): number {
    let purgedCount = 0;
    try {
      if (typeof localStorage !== 'undefined') {
        const keysToDelete: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(DRAFT_PREFIX)) {
            const raw = localStorage.getItem(k);
            if (raw) {
              try {
                const parsed = JSON.parse(raw) as StoredFormDraft;
                if (!parsed.expiresAt || parsed.expiresAt <= nowMs) {
                  keysToDelete.push(k);
                }
              } catch {
                keysToDelete.push(k);
              }
            }
          }
        }
        for (const k of keysToDelete) {
          localStorage.removeItem(k);
          purgedCount++;
        }
      }
    } catch {
      // ignore storage errors
    }

    for (const [k, raw] of memoryDrafts.entries()) {
      if (k.startsWith(DRAFT_PREFIX)) {
        try {
          const parsed = JSON.parse(raw) as StoredFormDraft;
          if (!parsed.expiresAt || parsed.expiresAt <= nowMs) {
            memoryDrafts.delete(k);
            purgedCount++;
          }
        } catch {
          memoryDrafts.delete(k);
          purgedCount++;
        }
      }
    }
    return purgedCount;
  },

  /**
   * Salva um rascunho de formulário vinculado estritamente ao tenantId, userId e formKey.
   */
  saveDraft<T = Record<string, any>>(
    params: {
      tenantId: string;
      userId: string;
      formKey: string;
      data?: T;
      step?: number | string;
      ttlMs?: number;
    },
    maybeData?: T,
    maybeStep?: number | string
  ): { saved: boolean; savedAt: number; error?: string } {
    this.purgeExpiredDrafts();

    const payloadData = (maybeData !== undefined ? maybeData : params.data) as T;
    const payloadStep = maybeStep !== undefined ? maybeStep : params.step;

    const key = buildStorageKey(params.tenantId, params.userId, params.formKey);
    const nowMs = Date.now();
    const record: StoredFormDraft<T> = {
      status: 'found',
      tenantId: (params.tenantId || 'public').trim(),
      userId: (params.userId || 'anonymous').trim(),
      formKey: params.formKey.trim(),
      step: payloadStep,
      data: sanitizeDraftPayload(payloadData),
      savedAt: nowMs,
      expiresAt: nowMs + (params.ttlMs ?? DEFAULT_TTL_MS),
    };

    const serialized = JSON.stringify(record);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, serialized);
      } else {
        memoryDrafts.set(key, serialized);
      }
      return { saved: true, savedAt: nowMs };
    } catch (err: any) {
      try {
        memoryDrafts.set(key, serialized);
        return { saved: true, savedAt: nowMs };
      } catch {
        return {
          saved: false,
          savedAt: nowMs,
          error: err?.message || 'Não foi possível salvar o rascunho temporário.',
        };
      }
    }
  },

  /**
   * Carrega o rascunho somente se pertencer exatamente ao mesmo tenantId, userId e formKey
   * e se não estiver expirado.
   */
  loadDraft<T = Record<string, any>>(params: {
    tenantId: string;
    userId: string;
    formKey: string;
    nowMs?: number;
  }): StoredFormDraft<T> | null {
    const now = params.nowMs ?? Date.now();
    this.purgeExpiredDrafts(now);

    const key = buildStorageKey(params.tenantId, params.userId, params.formKey);
    try {
      const raw =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(key) ?? memoryDrafts.get(key)
          : memoryDrafts.get(key);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as StoredFormDraft<T>;
      if (
        parsed.tenantId !== (params.tenantId || 'public').trim() ||
        parsed.userId !== (params.userId || 'anonymous').trim() ||
        parsed.formKey !== params.formKey.trim()
      ) {
        return null;
      }

      if (parsed.expiresAt <= now) {
        this.clearDraft(params);
        return null;
      }

      return {
        ...parsed,
        status: 'found',
      };
    } catch {
      return null;
    }
  },

  /**
   * Descarta o rascunho após conclusão ou cancelamento do cadastro.
   */
  clearDraft(params: { tenantId: string; userId: string; formKey: string }): void {
    const key = buildStorageKey(params.tenantId, params.userId, params.formKey);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
    memoryDrafts.delete(key);
  },

  /**
   * Remove todos os rascunhos de um usuário específico (ex.: no logout).
   */
  clearAllUserDrafts(userId: string): void {
    const safeUser = `__${(userId || 'anonymous').trim().toLowerCase()}__`;
    try {
      if (typeof localStorage !== 'undefined') {
        const toDelete: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(DRAFT_PREFIX) && k.includes(safeUser)) {
            toDelete.push(k);
          }
        }
        toDelete.forEach((k) => localStorage.removeItem(k));
      }
    } catch {
      // ignore
    }
    for (const k of Array.from(memoryDrafts.keys())) {
      if (k.startsWith(DRAFT_PREFIX) && k.includes(safeUser)) {
        memoryDrafts.delete(k);
      }
    }
  },

  /**
   * Preserva o estado de navegação (aba ativa e modal aberto) durante alternância de foco da aba.
   */
  saveNavigationState(state: {
    userId: string;
    tenantId: string;
    currentView: string;
    adminTab: string;
    activeModal?: string | null;
    editingStudentId?: string | null;
  }): void {
    if (!state.userId) return;
    const key = `${NAV_SESSION_PREFIX}${state.userId.toLowerCase()}`;
    const payload = JSON.stringify({
      ...state,
      updatedAt: Date.now(),
    });
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(key, payload);
      } else {
        memoryDrafts.set(key, payload);
      }
    } catch {
      memoryDrafts.set(key, payload);
    }
  },

  loadNavigationState(userId: string): {
    userId: string;
    tenantId: string;
    currentView: string;
    adminTab: string;
    activeModal?: string | null;
    editingStudentId?: string | null;
    updatedAt: number;
  } | null {
    if (!userId) return null;
    const key = `${NAV_SESSION_PREFIX}${userId.toLowerCase()}`;
    try {
      const raw =
        typeof sessionStorage !== 'undefined'
          ? sessionStorage.getItem(key) ?? memoryDrafts.get(key)
          : memoryDrafts.get(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  clearNavigationState(userId?: string): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        if (userId) {
          sessionStorage.removeItem(`${NAV_SESSION_PREFIX}${userId.toLowerCase()}`);
        } else {
          const toDelete: string[] = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith(NAV_SESSION_PREFIX)) toDelete.push(k);
          }
          toDelete.forEach((k) => sessionStorage.removeItem(k));
        }
      }
    } catch {
      // ignore
    }
    if (userId) {
      memoryDrafts.delete(`${NAV_SESSION_PREFIX}${userId.toLowerCase()}`);
    }
  },
};
