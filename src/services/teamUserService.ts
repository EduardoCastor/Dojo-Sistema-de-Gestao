import { supabase, isSupabaseConfigured } from './supabase';
import {
  User,
  UserRole,
  TenantUserInvitation,
} from '../types';
import { DataStore } from '../data/storage';
import { saasPlatformService, isValidUUID } from './saasPlatformService';

/**
 * Papéis permitidos dentro do escopo de uma academia (Tenant).
 * O papel 'superadmin' NUNCA pode ser atribuído por uma academia.
 */
export const ALLOWED_TENANT_ROLES: Exclude<UserRole, 'superadmin'>[] = [
  'owner',
  'branch_manager',
  'secretary',
  'financial',
  'instructor',
  'student',
  'guardian',
];

export const ALLOWED_ACADEMY_ROLES = ALLOWED_TENANT_ROLES;

export const ROLE_LABELS: Record<Exclude<UserRole, 'superadmin'>, string> = {
  owner: 'Proprietário / Sensei Titular',
  branch_manager: 'Gestor de Filial',
  secretary: 'Secretaria / Recepção',
  financial: 'Financeiro',
  instructor: 'Professor / Instrutor',
  student: 'Aluno (Portal)',
  guardian: 'Responsável (Portal)',
};

// Semáforo/Mutex em memória por tenantId para evitar condição de corrida em chamadas concorrentes
const tenantLocks = new Map<string, Promise<any>>();

async function withTenantLock<T>(tenantId: string, task: () => Promise<T>): Promise<T> {
  const previous = tenantLocks.get(tenantId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  tenantLocks.set(tenantId, previous.then(() => current));

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (tenantLocks.get(tenantId) === current) {
      tenantLocks.delete(tenantId);
    }
  }
}

export interface CreateTenantUserPayload {
  tenantId: string;
  branchId?: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  mode?: 'direct_active' | 'invite';
}

export interface UpdateTenantUserPayload {
  tenantId: string;
  targetUserId: string;
  name?: string;
  email?: string;
  phone?: string;
  branchId?: string;
  role?: UserRole;
  active?: boolean;
}

export const teamUserService = {
  /**
   * Valida se o ator possui permissão administrativa sobre a equipe da academia.
   */
  assertActorCanManageTenantUsers(actor: User, targetTenantId: string): void {
    if (!actor || !actor.active) {
      throw new Error('Acesso negado: usuário autenticado inativo ou inválido.');
    }
    if (actor.role === 'superadmin') {
      return;
    }
    if (actor.tenantId !== targetTenantId) {
      throw new Error(
        'Violação de isolamento multi-tenant (403): você não possui permissão para gerenciar usuários de outra academia.'
      );
    }
    if (actor.role !== 'owner' && actor.role !== 'branch_manager') {
      throw new Error(
        `Permissão insuficiente: o papel "${actor.role}" não está autorizado a criar, convidar ou gerenciar membros da equipe.`
      );
    }
  },

  /**
   * Valida se o papel solicitado é permitido dentro de uma academia (bloqueia 'superadmin').
   */
  assertValidTenantRole(role: UserRole): asserts role is Exclude<UserRole, 'superadmin'> {
    if (role === 'superadmin' || !ALLOWED_TENANT_ROLES.includes(role as any)) {
      throw new Error(
        `Papel inválido ou proibido ("${role}"): administradores de academias não podem conceder privilégios globais de SuperAdmin.`
      );
    }
  },

  /**
   * Retorna os usuários vinculados estritamente à academia informada.
   * Regra de contagem:
   * - Usuários ativos (active === true) contam no limite contratado (maxUsers).
   * - Usuários desativados (active === false) não consomem vaga ativa.
   */
  getTenantUsers(tenantId: string): User[] {
    if (!tenantId || tenantId === 'platform') return [];
    const all = DataStore.getAllUsers();
    return all.filter((u) => u.tenantId === tenantId && u.role !== 'superadmin');
  },

  getActiveUsersCount(tenantId: string): number {
    return this.getTenantUsers(tenantId).filter((u) => u.active).length;
  },

  getTenantInvitations(tenantId: string): TenantUserInvitation[] {
    return DataStore.getTenantInvitations(tenantId);
  },

  /**
   * Cria um usuário ativo ou envia convite na equipe da academia, respeitando o limite
   * de usuários ativos da licença (maxUsers) com proteção contra concorrência.
   */
  async createOrInviteUser(
    payload: CreateTenantUserPayload,
    actor: User
  ): Promise<{ user?: User; invitation?: TenantUserInvitation }> {
    return withTenantLock(payload.tenantId, async () => {
      this.assertActorCanManageTenantUsers(actor, payload.tenantId);
      this.assertValidTenantRole(payload.role);

      // branch_manager não pode criar outro owner
      if (actor.role === 'branch_manager' && payload.role === 'owner') {
        throw new Error('Apenas o Proprietário (owner) pode cadastrar ou promover outro Proprietário.');
      }

      const normalizedEmail = payload.email.trim().toLowerCase();
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        throw new Error('Informe um endereço de e-mail válido.');
      }
      if (!payload.name || payload.name.trim().length < 2) {
        throw new Error('Informe o nome completo do usuário.');
      }

      const limits = saasPlatformService.getEffectiveLimits(payload.tenantId);
      const tenantUsers = this.getTenantUsers(payload.tenantId);
      const activeUsersCount = tenantUsers.filter((u) => u.active).length;

      // Verificar duplicidade de e-mail na mesma academia
      const duplicateUser = tenantUsers.find(
        (u) => u.email.trim().toLowerCase() === normalizedEmail
      );
      if (duplicateUser) {
        throw new Error(
          `Já existe um usuário cadastrado nesta academia com o e-mail "${normalizedEmail}".`
        );
      }

      // Verificar limite contratado da licença (maxUsers considerando ativos + convites pendentes)
      if (limits.totalReservedUsers >= limits.maxUsers) {
        throw new Error(
          `Limite de usuários da licença atingido (${limits.totalReservedUsers}/${limits.maxUsers} vagas ocupadas entre usuários ativos e convites pendentes). Desative um usuário, revogue convites pendentes ou faça upgrade do plano.`
        );
      }

      if (payload.mode === 'invite') {
        const allInvites = DataStore.getTenantInvitations();
        const existingPending = allInvites.find(
          (inv) =>
            inv.tenantId === payload.tenantId &&
            inv.email.toLowerCase() === normalizedEmail &&
            inv.status === 'invited'
        );
        if (existingPending) {
          throw new Error(`Já existe um convite pendente para "${normalizedEmail}" nesta academia.`);
        }

        const now = new Date();
        const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const invitation: TenantUserInvitation = {
          id: `inv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          tenantId: payload.tenantId,
          branchId: payload.branchId,
          email: normalizedEmail,
          fullName: payload.name.trim(),
          role: payload.role,
          phone: payload.phone?.trim(),
          status: 'invited',
          invitedByUserId: actor.id,
          invitedByName: actor.name,
          createdAt: now.toISOString(),
          expiresAt: expires.toISOString(),
        };

        if (isSupabaseConfigured() && supabase && isValidUUID(payload.tenantId)) {
          const { error } = await supabase.from('tenant_user_invitations').insert({
            tenant_id: payload.tenantId,
            branch_id: payload.branchId && isValidUUID(payload.branchId) ? payload.branchId : null,
            email: normalizedEmail,
            full_name: payload.name.trim(),
            role: payload.role,
            phone: payload.phone?.trim() || null,
            status: 'invited',
          });
          if (error) {
            throw new Error(error.message);
          }
        }

        DataStore.saveTenantInvitations([invitation, ...allInvites]);
        DataStore.logAudit(
          payload.tenantId,
          actor.id,
          actor.name,
          'Convite de Usuário',
          'TenantUserInvitation',
          invitation.id,
          `Convite enviado para ${invitation.fullName} (${invitation.email}) com papel ${invitation.role}.`
        );

        return { invitation };
      }

      // Criação direta de usuário ativo na academia
      const newUser: User = {
        id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId: payload.tenantId,
        branchId: payload.branchId,
        name: payload.name.trim(),
        email: normalizedEmail,
        role: payload.role,
        phone: payload.phone?.trim() || '',
        active: true,
        invitedByUserId: actor.id,
        createdAt: new Date().toISOString(),
      };

      const allUsers = DataStore.getAllUsers();
      DataStore.saveUsers([...allUsers, newUser]);

      DataStore.logAudit(
        payload.tenantId,
        actor.id,
        actor.name,
        'Cadastro de Usuário da Equipe',
        'User',
        newUser.id,
        `Usuário "${newUser.name}" (${newUser.email}) adicionado com papel "${newUser.role}". Ocupação: ${activeUsersCount + 1}/${limits.maxUsers}.`
      );

      return { user: newUser };
    });
  },

  /**
   * Aceita um convite pendente e ativa o vínculo do usuário, validando novamente o limite de usuários ativos.
   */
  async acceptInvitation(invitationId: string, actor: User): Promise<User> {
    const allInvites = DataStore.getTenantInvitations();
    const invite = allInvites.find((i) => i.id === invitationId);
    if (!invite) {
      throw new Error('Convite não encontrado.');
    }
    if (invite.status !== 'invited') {
      throw new Error(`Este convite não está mais pendente (status atual: ${invite.status}).`);
    }

    return withTenantLock(invite.tenantId, async () => {
      this.assertActorCanManageTenantUsers(actor, invite.tenantId);

      const limits = saasPlatformService.getEffectiveLimits(invite.tenantId);
      const activeUsersCount = this.getActiveUsersCount(invite.tenantId);

      if (activeUsersCount >= limits.maxUsers) {
        throw new Error(
          `Não é possível ativar o convite: o limite de usuários ativos da licença (${limits.maxUsers}) já foi atingido.`
        );
      }

      invite.status = 'accepted';
      DataStore.saveTenantInvitations([...allInvites]);

      const newUser: User = {
        id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId: invite.tenantId,
        branchId: invite.branchId,
        name: invite.fullName,
        email: invite.email,
        role: invite.role,
        phone: invite.phone || '',
        active: true,
        invitedByUserId: invite.invitedByUserId,
        createdAt: new Date().toISOString(),
      };

      const allUsers = DataStore.getAllUsers();
      DataStore.saveUsers([...allUsers, newUser]);

      DataStore.logAudit(
        invite.tenantId,
        actor.id,
        actor.name,
        'Ativação de Convite',
        'User',
        newUser.id,
        `Convite de ${newUser.name} (${newUser.email}) confirmado como usuário ativo (${newUser.role}).`
      );

      return newUser;
    });
  },

  /**
   * Revoga um convite pendente.
   */
  async revokeInvitation(invitationId: string, actor: User): Promise<void> {
    const allInvites = DataStore.getTenantInvitations();
    const invite = allInvites.find((i) => i.id === invitationId);
    if (!invite) {
      throw new Error('Convite não encontrado.');
    }
    this.assertActorCanManageTenantUsers(actor, invite.tenantId);

    invite.status = 'revoked';
    DataStore.saveTenantInvitations([...allInvites]);

    DataStore.logAudit(
      invite.tenantId,
      actor.id,
      actor.name,
      'Revogação de Convite',
      'TenantUserInvitation',
      invite.id,
      `Convite para ${invite.email} foi revogado.`
    );
  },

  /**
   * Atualiza papel, filial, dados ou status ativo/inativo de um usuário da academia.
   * Protege o último 'owner' ativo contra desativação ou rebaixamento de papel.
   * Valida o limite maxUsers ao reativar um usuário inativo.
   */
  async updateTenantUser(payload: UpdateTenantUserPayload, actor: User): Promise<User> {
    return withTenantLock(payload.tenantId, async () => {
      this.assertActorCanManageTenantUsers(actor, payload.tenantId);

      const allUsers = DataStore.getAllUsers();
      const targetIndex = allUsers.findIndex(
        (u) => u.id === payload.targetUserId && u.tenantId === payload.tenantId
      );
      if (targetIndex === -1) {
        throw new Error('Usuário não encontrado nesta academia.');
      }

      const target = allUsers[targetIndex];

      if (payload.role !== undefined) {
        this.assertValidTenantRole(payload.role);
        if (actor.role === 'branch_manager' && (target.role === 'owner' || payload.role === 'owner')) {
          throw new Error('Apenas o Proprietário (owner) pode alterar permissões de Proprietário.');
        }
      }

      const tenantUsers = allUsers.filter((u) => u.tenantId === payload.tenantId);
      const activeOwners = tenantUsers.filter((u) => u.role === 'owner' && u.active);

      const isDemotingOwner =
        target.role === 'owner' && payload.role !== undefined && payload.role !== 'owner';
      const isDeactivatingOwner =
        target.role === 'owner' && target.active && payload.active === false;

      if ((isDemotingOwner || isDeactivatingOwner) && activeOwners.length <= 1) {
        throw new Error(
          'Operação bloqueada: a academia não pode ficar sem ao menos um Proprietário (owner) ativo. Transfira a titularidade para outro membro ativo antes de desativar ou alterar este perfil.'
        );
      }

      // Se estiver reativando um usuário que estava inativo, validar o limite de usuários ativos
      if (!target.active && payload.active === true) {
        const limits = saasPlatformService.getEffectiveLimits(payload.tenantId);
        const currentActiveCount = tenantUsers.filter((u) => u.active).length;
        if (currentActiveCount >= limits.maxUsers) {
          throw new Error(
            `Não é possível reativar este usuário: o limite de usuários ativos da licença (${currentActiveCount}/${limits.maxUsers}) já foi atingido.`
          );
        }
      }

      const updatedUser: User = {
        ...target,
        name: payload.name !== undefined ? payload.name.trim() : target.name,
        email: payload.email !== undefined ? payload.email.trim().toLowerCase() : target.email,
        phone: payload.phone !== undefined ? payload.phone.trim() : target.phone,
        branchId: payload.branchId !== undefined ? payload.branchId : target.branchId,
        role: payload.role !== undefined ? payload.role : target.role,
        active: payload.active !== undefined ? payload.active : target.active,
      };

      allUsers[targetIndex] = updatedUser;
      DataStore.saveUsers(allUsers);

      DataStore.logAudit(
        payload.tenantId,
        actor.id,
        actor.name,
        payload.active === false
          ? 'Desativação de Usuário'
          : payload.active === true && !target.active
          ? 'Reativação de Usuário'
          : 'Atualização de Usuário',
        'User',
        updatedUser.id,
        `Usuário "${updatedUser.name}" atualizado (Papel: ${updatedUser.role}, Status: ${
          updatedUser.active ? 'Ativo' : 'Inativo'
        }).`
      );

      return updatedUser;
    });
  },

  /**
   * Transfere a titularidade (owner) de forma segura para outro usuário ativo da mesma academia.
   */
  async transferOwnership(
    tenantId: string,
    currentOwnerId: string,
    newOwnerId: string,
    actor: User
  ): Promise<{ previousOwner: User; newOwner: User }> {
    return withTenantLock(tenantId, async () => {
      if (actor.role !== 'owner' && actor.role !== 'superadmin') {
        throw new Error('Apenas o Proprietário atual pode transferir a titularidade da academia.');
      }
      if (actor.role === 'owner' && actor.tenantId !== tenantId) {
        throw new Error('Violação de isolamento: você não pertence a esta academia.');
      }

      const allUsers = DataStore.getAllUsers();
      const prevIdx = allUsers.findIndex((u) => u.id === currentOwnerId && u.tenantId === tenantId);
      const nextIdx = allUsers.findIndex((u) => u.id === newOwnerId && u.tenantId === tenantId);

      if (prevIdx === -1 || nextIdx === -1) {
        throw new Error('Ambos os usuários devem pertencer à mesma academia.');
      }
      if (!allUsers[nextIdx].active) {
        throw new Error('O novo Proprietário deve estar com status Ativo na academia.');
      }

      allUsers[nextIdx] = { ...allUsers[nextIdx], role: 'owner' };
      allUsers[prevIdx] = { ...allUsers[prevIdx], role: 'branch_manager' };

      DataStore.saveUsers(allUsers);

      DataStore.logAudit(
        tenantId,
        actor.id,
        actor.name,
        'Transferência de Titularidade',
        'User',
        allUsers[nextIdx].id,
        `Titularidade (owner) transferida de "${allUsers[prevIdx].name}" para "${allUsers[nextIdx].name}".`
      );

      return {
        previousOwner: allUsers[prevIdx],
        newOwner: allUsers[nextIdx],
      };
    });
  },
};
