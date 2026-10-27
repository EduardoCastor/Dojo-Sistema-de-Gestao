import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  UserPlus,
  ShieldCheck,
  Mail,
  Building2,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRightLeft,
  AlertTriangle,
  Sparkles,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { User, Branch, Tenant, UserRole, TenantUserInvitation } from '../../types';
import { teamUserService, ALLOWED_TENANT_ROLES, ROLE_LABELS } from '../../services/teamUserService';
import { saasPlatformService } from '../../services/saasPlatformService';

interface TeamUsersViewProps {
  tenant: Tenant;
  currentUser: User;
  branches: Branch[];
  selectedBranchId: string | 'all';
  onOpenPlanUpgrade?: () => void;
  onUserUpdated?: () => void;
}

const STAFF_ROLES: Exclude<UserRole, 'superadmin' | 'student' | 'guardian'>[] = [
  'owner',
  'branch_manager',
  'instructor',
  'secretary',
  'financial',
];

export const TeamUsersView: React.FC<TeamUsersViewProps> = ({
  tenant,
  currentUser,
  branches,
  selectedBranchId,
  onOpenPlanUpgrade,
  onUserUpdated,
}) => {
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<TenantUserInvitation[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('staff');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);

  // Invite form state
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<UserRole, 'superadmin'>>('instructor');
  const [inviteBranchId, setInviteBranchId] = useState<string>(
    currentUser.role === 'branch_manager' && currentUser.branchId
      ? currentUser.branchId
      : branches[0]?.id || ''
  );
  const [createDirectActive, setCreateDirectActive] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Ownership transfer state
  const [newOwnerUserId, setNewOwnerUserId] = useState<string>('');

  const loadData = () => {
    setUsers(teamUserService.getTenantUsers(tenant.id));
    setInvitations(teamUserService.getTenantInvitations(tenant.id));
  };

  useEffect(() => {
    loadData();
  }, [tenant.id]);

  const limits = useMemo(() => saasPlatformService.getEffectiveLimits(tenant.id), [tenant.id, users, invitations]);

  const canManageTeam =
    currentUser.role === 'owner' ||
    currentUser.role === 'branch_manager' ||
    currentUser.role === 'superadmin';
  const isOwner = currentUser.role === 'owner' || currentUser.role === 'superadmin';

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (selectedBranchId !== 'all' && u.branchId && u.branchId !== selectedBranchId && u.role !== 'owner') {
        return false;
      }
      if (roleFilter === 'staff') {
        if (u.role === 'student' || u.role === 'guardian') return false;
      } else if (roleFilter !== 'all' && u.role !== roleFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      }
      return true;
    });
  }, [users, selectedBranchId, roleFilter, searchTerm]);

  const pendingInvitations = useMemo(
    () => invitations.filter((inv) => inv.status === 'invited'),
    [invitations]
  );

  const handleCreateOrInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);
    try {
      await teamUserService.createOrInviteUser(
        {
          tenantId: tenant.id,
          name: inviteName,
          email: inviteEmail,
          role: inviteRole,
          branchId: inviteRole === 'owner' ? undefined : inviteBranchId || undefined,
          mode: createDirectActive ? 'direct_active' : 'invite',
        },
        currentUser
      );

      setFeedback({
        type: 'success',
        message: createDirectActive
          ? `Usuário ${inviteName} cadastrado e ativado com sucesso na academia!`
          : `Convite enviado para ${inviteEmail}. A vaga já foi reservada no limite da licença.`,
      });
      setInviteName('');
      setInviteEmail('');
      setShowInviteModal(false);
      loadData();
      onUserUpdated?.();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Não foi possível adicionar o usuário.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleUserActive = async (targetUser: User) => {
    setFeedback(null);
    const nextState = !(targetUser.active !== false);
    try {
      await teamUserService.updateTenantUser(
        {
          tenantId: tenant.id,
          targetUserId: targetUser.id,
          active: nextState,
        },
        currentUser
      );
      setFeedback({
        type: 'success',
        message: `Usuário ${targetUser.name} ${nextState ? 'reativado' : 'desativado'} com sucesso.`,
      });
      loadData();
      onUserUpdated?.();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Erro ao alterar status do usuário.' });
    }
  };

  const handleChangeRole = async (targetUser: User, newRole: Exclude<UserRole, 'superadmin'>) => {
    setFeedback(null);
    try {
      await teamUserService.updateTenantUser(
        {
          tenantId: tenant.id,
          targetUserId: targetUser.id,
          role: newRole,
        },
        currentUser
      );
      setFeedback({
        type: 'success',
        message: `Papel de ${targetUser.name} atualizado para ${ROLE_LABELS[newRole]}.`,
      });
      loadData();
      onUserUpdated?.();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Erro ao alterar papel do usuário.' });
    }
  };

  const handleChangeBranch = async (targetUser: User, branchId: string) => {
    setFeedback(null);
    try {
      await teamUserService.updateTenantUser(
        {
          tenantId: tenant.id,
          targetUserId: targetUser.id,
          branchId: branchId || undefined,
        },
        currentUser
      );
      setFeedback({
        type: 'success',
        message: `Unidade de ${targetUser.name} atualizada com sucesso.`,
      });
      loadData();
      onUserUpdated?.();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Erro ao alterar unidade do usuário.' });
    }
  };

  const handleAcceptInvitation = async (invitationId: string) => {
    setFeedback(null);
    try {
      await teamUserService.acceptInvitation(invitationId, currentUser);
      setFeedback({ type: 'success', message: 'Convite aceito e usuário ativado na academia.' });
      loadData();
      onUserUpdated?.();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Erro ao ativar convite.' });
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    setFeedback(null);
    try {
      await teamUserService.revokeInvitation(invitationId, currentUser);
      setFeedback({ type: 'success', message: 'Convite revogado e vaga liberada na licença.' });
      loadData();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Erro ao revogar convite.' });
    }
  };

  const handleTransferOwnership = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!newOwnerUserId) return;

    try {
      await teamUserService.transferOwnership(tenant.id, currentUser.id, newOwnerUserId, currentUser);
      setFeedback({
        type: 'success',
        message: 'Titularidade (Owner) transferida com sucesso!',
      });
      setShowTransferModal(false);
      loadData();
      onUserUpdated?.();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Falha ao transferir titularidade.' });
    }
  };

  const usagePercentage = Math.min(100, Math.round((limits.totalReservedUsers / Math.max(1, limits.maxUsers)) * 100));

  return (
    <div className="space-y-6">
      {/* Header & License Capacity Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-500/20 flex items-center justify-center text-red-500">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Equipe, Papéis e Acessos da Academia</h2>
              <p className="text-xs text-zinc-400">
                Gerencie proprietários, gestores de unidade, instrutores, secretaria e financeiro vinculados a {tenant.tradeName}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isOwner && (
            <button
              onClick={() => setShowTransferModal(true)}
              className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-2 border border-zinc-700 transition-colors cursor-pointer"
            >
              <ArrowRightLeft className="w-4 h-4 text-amber-400" />
              Transferir Titularidade
            </button>
          )}

          {canManageTeam && (
            <button
              onClick={() => {
                setFeedback(null);
                setShowInviteModal(true);
              }}
              disabled={limits.usersLimitReached}
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                limits.usersLimitReached
                  ? 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed'
                  : 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/20'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              Adicionar Membro / Convite
            </button>
          )}
        </div>
      </div>

      {/* License Quota Card */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Limite de Usuários da Licença ({(tenant?.planId || 'PLANO').toUpperCase()})
              </span>
              {limits.hasCustomLimits && (
                <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-semibold">
                  Limite Personalizado pelo SaaS
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-300">
              <strong className="text-white">{limits.currentActiveUsers}</strong> usuários ativos
              {limits.pendingUserInvitations > 0 && (
                <>
                  {' '}
                  + <strong className="text-amber-400">{limits.pendingUserInvitations}</strong> convite(s) pendente(s)
                </>
              )}{' '}
              de <strong className="text-white">{limits.maxUsers}</strong> permitidos na sua licença.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-48">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-400">Ocupação de licenças</span>
                <span className="font-bold text-white">
                  {limits.totalReservedUsers} / {limits.maxUsers}
                </span>
              </div>
              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    limits.usersLimitReached
                      ? 'bg-red-500'
                      : usagePercentage >= 80
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{ width: `${usagePercentage}%` }}
                />
              </div>
            </div>

            {limits.usersLimitReached && onOpenPlanUpgrade && (
              <button
                onClick={onOpenPlanUpgrade}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Ampliar Limite / Upgrade
              </button>
            )}
          </div>
        </div>

        {limits.usersLimitReached && (
          <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs text-red-300">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>
                Sua academia atingiu o limite de <strong>{limits.maxUsers} usuários</strong> contratados. Para adicionar
                novos professores, secretários ou gestores, desative um membro inativo, revogue convites pendentes ou
                faça upgrade de plano.
              </span>
            </div>
          </div>
        )}
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-xl border text-xs font-medium flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          <span>{feedback.message}</span>
          <button onClick={() => setFeedback(null)} className="text-zinc-400 hover:text-white ml-4">
            ✕
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between items-center bg-zinc-900 border border-zinc-800 p-4 rounded-2xl">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Buscar por nome ou e-mail..."
          className="w-full sm:w-80 bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-red-500"
        />

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-zinc-400">Exibir:</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
          >
            <option value="staff">Equipe da Academia (Staff)</option>
            <option value="all">Todos os vínculos</option>
            <option value="owner">Proprietários (Owner)</option>
            <option value="branch_manager">Gestores de Unidade</option>
            <option value="instructor">Instrutores / Professores</option>
            <option value="secretary">Secretaria / Recepção</option>
            <option value="financial">Financeiro</option>
          </select>
        </div>
      </div>

      {/* Active / Inactive Users Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Membros Vinculados à Academia ({filteredUsers.length})</h3>
          <span className="text-[11px] text-zinc-400">
            Isolamento Multi-Tenant Ativo • Tenant ID: <code className="text-zinc-300">{tenant.id}</code>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-400 bg-zinc-950/60">
                <th className="py-3.5 px-6">Usuário</th>
                <th className="py-3.5 px-4">Papel na Academia</th>
                <th className="py-3.5 px-4">Unidade Vinculada</th>
                <th className="py-3.5 px-4">Status da Licença</th>
                <th className="py-3.5 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70 text-xs">
              {filteredUsers.map((member) => {
                const isActive = member.active !== false;
                const isSelf = member.id === currentUser.id;
                const memberRole = member.role === 'superadmin' ? 'owner' : member.role;
                const canEditMember =
                  canManageTeam &&
                  (isOwner ||
                    (currentUser.role === 'branch_manager' &&
                      member.role !== 'owner' &&
                      member.role !== 'branch_manager' &&
                      member.branchId === currentUser.branchId));

                return (
                  <tr key={member.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-white">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-white flex items-center gap-2">
                            {member.name}
                            {isSelf && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-red-500/10 text-red-400 border border-red-500/20">
                                Você
                              </span>
                            )}
                          </div>
                          <div className="text-zinc-400 text-[11px] flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {member.email}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      {canEditMember && !isSelf ? (
                        <select
                          value={memberRole}
                          onChange={(e) =>
                            handleChangeRole(member, e.target.value as Exclude<UserRole, 'superadmin'>)
                          }
                          className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                        >
                          {STAFF_ROLES.filter((r) => isOwner || (r !== 'owner' && r !== 'branch_manager')).map(
                            (roleKey) => (
                              <option key={roleKey} value={roleKey}>
                                {ROLE_LABELS[roleKey]}
                              </option>
                            )
                          )}
                        </select>
                      ) : (
                        <span className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-200 font-medium">
                          {ROLE_LABELS[memberRole]}
                        </span>
                      )}
                    </td>

                    <td className="py-4 px-4">
                      {member.role === 'owner' ? (
                        <span className="text-zinc-300 flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-amber-400" />
                          Acesso Global (Todas as Unidades)
                        </span>
                      ) : canEditMember && isOwner ? (
                        <select
                          value={member.branchId || ''}
                          onChange={(e) => handleChangeBranch(member, e.target.value)}
                          className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                        >
                          <option value="">Todas as unidades</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} {b.isHeadquarter ? '(Matriz)' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-zinc-300">
                          {branches.find((b) => b.id === member.branchId)?.name || 'Unidade Matriz'}
                        </span>
                      )}
                    </td>

                    <td className="py-4 px-4">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Ativo (Conta no limite)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                          <XCircle className="w-3.5 h-3.5" />
                          Inativo (Vaga liberada)
                        </span>
                      )}
                    </td>

                    <td className="py-4 px-6 text-right">
                      {canEditMember && !isSelf ? (
                        <button
                          onClick={() => handleToggleUserActive(member)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20'
                              : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                          }`}
                        >
                          {isActive ? 'Desativar Acesso' : 'Reativar Acesso'}
                        </button>
                      ) : (
                        <span className="text-zinc-500 text-[11px] inline-flex items-center gap-1">
                          <Lock className="w-3 h-3" /> Protegido
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Invitations Section */}
      {pendingInvitations.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white">
                Convites Pendentes ({pendingInvitations.length}) — Reservas Ativas na Licença
              </h3>
            </div>
          </div>

          <div className="divide-y divide-zinc-800">
            {pendingInvitations.map((inv) => (
              <div key={inv.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-white">
                    {inv.fullName} <span className="text-zinc-400 font-normal">({inv.email})</span>
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Papel: <strong className="text-zinc-200">{ROLE_LABELS[inv.role]}</strong> • Unidade:{' '}
                    {branches.find((b) => b.id === inv.branchId)?.name || 'Todas as unidades'}
                  </p>
                </div>

                {canManageTeam && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAcceptInvitation(inv.id)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Efetivar / Ativar Agora
                    </button>
                    <button
                      onClick={() => handleRevokeInvitation(inv.id)}
                      className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold cursor-pointer"
                    >
                      Revogar Convite
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite / Create User Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Adicionar Membro à Equipe</h3>
              <button onClick={() => setShowInviteModal(false)} className="text-zinc-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOrInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Ex: Sensei Marcos Silva"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">E-mail de Acesso</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="marcos@academia.com.br"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Papel / Nível de Permissão</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Exclude<UserRole, 'superadmin'>)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-red-500"
                >
                  {ALLOWED_TENANT_ROLES.filter(
                    (r) =>
                      r !== 'student' &&
                      r !== 'guardian' &&
                      (isOwner || (r !== 'owner' && r !== 'branch_manager'))
                  ).map((roleKey) => (
                    <option key={roleKey} value={roleKey}>
                      {ROLE_LABELS[roleKey]}
                    </option>
                  ))}
                </select>
              </div>

              {inviteRole !== 'owner' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">Unidade de Atuação</label>
                  <select
                    value={inviteBranchId}
                    onChange={(e) => setInviteBranchId(e.target.value)}
                    disabled={currentUser.role === 'branch_manager'}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-red-500 disabled:opacity-60"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} {b.isHeadquarter ? '(Unidade Matriz)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pt-1">
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createDirectActive}
                    onChange={(e) => setCreateDirectActive(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-950 text-red-600 focus:ring-red-500"
                  />
                  Ativar conta imediatamente (sem aguardar aceite de convite)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || limits.usersLimitReached}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Salvando...' : createDirectActive ? 'Cadastrar Usuário' : 'Enviar Convite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ownership Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Transferir Titularidade da Academia</h3>
              <button onClick={() => setShowTransferModal(false)} className="text-zinc-400 hover:text-white">
                ✕
              </button>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Selecione um membro ativo da equipe para assumir o papel de <strong>Proprietário (Owner)</strong> da
              academia. Seu usuário passará para o papel de Gestor de Filial.
            </p>

            <form onSubmit={handleTransferOwnership} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Novo Proprietário</label>
                <select
                  required
                  value={newOwnerUserId}
                  onChange={(e) => setNewOwnerUserId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-red-500"
                >
                  <option value="">Selecione um membro ativo...</option>
                  {users
                    .filter(
                      (u) =>
                        u.id !== currentUser.id &&
                        u.active !== false &&
                        u.role !== 'student' &&
                        u.role !== 'guardian'
                    )
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-300 text-xs font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newOwnerUserId}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold disabled:opacity-50 cursor-pointer"
                >
                  Confirmar Transferência
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
