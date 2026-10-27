import { supabase, isSupabaseConfigured } from './supabase';
import {
  Student,
  Person,
  User,
  TenantUserInvitation,
  PortalAccessStatus,
  GuardianRelationship,
  AttendanceRecord,
  Invoice,
  DigitalLibraryItem,
  PhysicalAssessment,
} from '../types';
import { DataStore } from '../data/storage';
import { cleanCPF } from '../utils/cpfValidator';
import { digitalLibraryService } from './digitalLibraryService';

function isValidUUID(id?: string | null): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function generateInviteCode(prefix: 'AL' | 'RP'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token = '';
  for (let i = 0; i < 8; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${token}`;
}

export interface PortalAccountInfo {
  targetType: 'student' | 'guardian';
  targetId: string;
  tenantId: string;
  status: PortalAccessStatus;
  email: string;
  linkedUserId?: string;
  linkedUserEmail?: string;
  inviteCode?: string;
  pendingInviteCode?: string;
  inviteExpiresAt?: string;
  allowAnthropometryView?: boolean;
}

export type PortalAccountSummary = PortalAccountInfo;

export const portalAccessService = {
  /**
   * Verifica se o ator possui permissão administrativa para gerenciar contas de alunos e responsáveis.
   */
  assertCanManagePortalAccounts(actor: User, tenantId: string): void {
    if (!actor || !actor.active) {
      throw new Error('Acesso negado: sessão inativa ou inválida.');
    }
    if (actor.role === 'superadmin') return;
    if (actor.tenantId !== tenantId) {
      throw new Error('Violação de isolamento multi-tenant: você não pertence a esta academia.');
    }
    if (!['owner', 'branch_manager', 'secretary'].includes(actor.role)) {
      throw new Error(
        `Permissão insuficiente: o perfil "${actor.role}" não está autorizado a criar, bloquear ou revogar contas de alunos e responsáveis.`
      );
    }
  },

  /**
   * Consulta o estado detalhado do acesso de um aluno ou responsável na academia.
   */
  getPortalAccountStatus(
    tenantId: string,
    targetType: 'student' | 'guardian',
    targetId: string
  ): PortalAccountInfo {
    const invitations = DataStore.getTenantInvitations(tenantId);
    const users = DataStore.getUsers(tenantId);

    if (targetType === 'student') {
      const students = DataStore.getStudents(tenantId);
      const persons = DataStore.getPersons(tenantId);
      const student = students.find((s) => s.id === targetId);
      const person = student ? persons.find((p) => p.id === student.personId) : undefined;

      const pendingInvite = invitations.find(
        (inv) =>
          inv.status === 'invited' &&
          (inv.targetStudentId === targetId ||
            (inv.role === 'student' &&
              person?.email &&
              inv.email.toLowerCase() === person.email.toLowerCase()))
      );

      const linkedUser = users.find(
        (u) =>
          u.tenantId === tenantId &&
          (u.studentId === targetId || (student?.userId && u.id === student.userId))
      );

      let status: PortalAccessStatus = student?.portalAccessStatus || 'none';
      if (status === 'none') {
        if (linkedUser) {
          status = linkedUser.active ? 'active' : 'blocked';
        } else if (pendingInvite) {
          status = 'invited';
        }
      }

      return {
        targetType: 'student',
        targetId,
        tenantId,
        status,
        email: person?.email || linkedUser?.email || pendingInvite?.email || '',
        linkedUserId: student?.userId || linkedUser?.id,
        linkedUserEmail: linkedUser?.email || person?.email,
        inviteCode: pendingInvite?.inviteCode,
        pendingInviteCode: pendingInvite?.inviteCode,
        inviteExpiresAt: pendingInvite?.expiresAt,
        allowAnthropometryView: Boolean(student?.allowAnthropometryView),
      };
    } else {
      const persons = DataStore.getPersons(tenantId);
      const person = persons.find((p) => p.id === targetId);

      const pendingInvite = invitations.find(
        (inv) =>
          inv.status === 'invited' &&
          (inv.targetGuardianPersonId === targetId ||
            (inv.role === 'guardian' &&
              person?.email &&
              inv.email.toLowerCase() === person.email.toLowerCase()))
      );

      const linkedUser = users.find(
        (u) =>
          u.tenantId === tenantId &&
          (u.guardianPersonId === targetId || (person?.userId && u.id === person.userId))
      );

      let status: PortalAccessStatus = person?.portalAccessStatus || 'none';
      if (status === 'none') {
        if (linkedUser) {
          status = linkedUser.active ? 'active' : 'blocked';
        } else if (pendingInvite) {
          status = 'invited';
        }
      }

      return {
        targetType: 'guardian',
        targetId,
        tenantId,
        status,
        email: person?.email || linkedUser?.email || pendingInvite?.email || '',
        linkedUserId: person?.userId || linkedUser?.id,
        linkedUserEmail: linkedUser?.email || person?.email,
        inviteCode: pendingInvite?.inviteCode,
        pendingInviteCode: pendingInvite?.inviteCode,
        inviteExpiresAt: pendingInvite?.expiresAt,
      };
    }
  },

  /**
   * Executa ações administrativas sobre a conta de acesso de um Aluno ou Responsável.
   */
  async manageAccountAccess(params: {
    tenantId: string;
    targetType: 'student' | 'guardian';
    targetId: string;
    action:
      | 'invite'
      | 'create_invite'
      | 'resend_invite'
      | 'revoke_invite'
      | 'block'
      | 'revoke_access'
      | 'reactivate'
      | 'toggle_anthropometry';
    email?: string;
    allowAnthropometry?: boolean;
    actor?: User;
  }): Promise<{
    success: boolean;
    message: string;
    status: PortalAccessStatus;
    portalAccessStatus: PortalAccessStatus;
    inviteCode?: string;
    email?: string;
    allowAnthropometryView?: boolean;
  }> {
    const resolvedActor: User =
      params.actor ||
      DataStore.getUsers(params.tenantId).find((u) =>
        ['owner', 'branch_manager', 'secretary'].includes(u.role)
      ) || {
        id: 'owner',
        tenantId: params.tenantId,
        name: 'Administrador da Academia',
        email: 'admin@tatameclub.com.br',
        role: 'owner',
        active: true,
      };

    this.assertCanManagePortalAccounts(resolvedActor, params.tenantId);

    const normalizedAction =
      params.action === 'create_invite' ? 'invite' : params.action;

    let remoteInviteCode: string | undefined;

    if (
      isSupabaseConfigured() &&
      supabase &&
      isValidUUID(params.tenantId) &&
      isValidUUID(params.targetId)
    ) {
      const { data, error } = await supabase.rpc('manage_portal_account_access', {
        p_tenant_id: params.tenantId,
        p_target_type: params.targetType,
        p_target_id: params.targetId,
        p_action: normalizedAction,
        p_email: params.email?.trim().toLowerCase() || null,
        p_allow_anthropometry:
          params.allowAnthropometry !== undefined ? params.allowAnthropometry : null,
      });

      if (error && error.code !== '42883' && error.code !== 'PGRST202') {
        throw new Error(error.message || 'Falha ao gerenciar conta de acesso no Supabase.');
      }
      if (data?.invite_code) {
        remoteInviteCode = data.invite_code;
      }
    }

    const allStudents = DataStore.getStudents();
    const allPersons = DataStore.getPersons();
    const allUsers = DataStore.getAllUsers();
    const allInvites = DataStore.getTenantInvitations();

    if (params.targetType === 'student') {
      const studentIdx = allStudents.findIndex(
        (s) => s.id === params.targetId && s.tenantId === params.tenantId
      );
      if (studentIdx === -1) {
        throw new Error('Aluno não encontrado nesta academia.');
      }
      const student = allStudents[studentIdx];
      const personIdx = allPersons.findIndex(
        (p) => p.id === student.personId && p.tenantId === params.tenantId
      );
      const person = personIdx >= 0 ? allPersons[personIdx] : undefined;

      if (normalizedAction === 'toggle_anthropometry') {
        const nextVal =
          params.allowAnthropometry !== undefined
            ? params.allowAnthropometry
            : !student.allowAnthropometryView;
        allStudents[studentIdx] = {
          ...student,
          allowAnthropometryView: nextVal,
        };
        DataStore.saveStudents(allStudents);
        const curStatus = student.portalAccessStatus || 'none';
        return {
          success: true,
          message: nextVal
            ? 'Visualização de evolução física (antropometria e IMC) liberada para o aluno.'
            : 'Visualização de evolução física ocultada no Portal do Aluno.',
          status: curStatus,
          portalAccessStatus: curStatus,
          allowAnthropometryView: nextVal,
        };
      }

      const normalizedEmail = (params.email || person?.email || '').trim().toLowerCase();

      if (normalizedAction === 'invite' || normalizedAction === 'resend_invite') {
        if (!normalizedEmail || !normalizedEmail.includes('@')) {
          throw new Error('Informe um endereço de e-mail válido para enviar o convite ao aluno.');
        }

        if (personIdx >= 0) {
          allPersons[personIdx] = { ...allPersons[personIdx], email: normalizedEmail };
          DataStore.savePersons(allPersons);
        }

        const updatedInvites = allInvites.map((inv) =>
          inv.tenantId === params.tenantId &&
          inv.targetStudentId === student.id &&
          inv.status === 'invited'
            ? { ...inv, status: 'expired' as const }
            : inv
        );

        const inviteCode = remoteInviteCode || generateInviteCode('AL');
        const now = new Date();
        const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

        const newInvite: TenantUserInvitation = {
          id: `inv-stu-${Date.now()}`,
          tenantId: params.tenantId,
          branchId: student.branchId,
          email: normalizedEmail,
          fullName: person?.fullName || `Aluno ${student.registrationNumber}`,
          role: 'student',
          phone: person?.phone,
          status: 'invited',
          inviteCode,
          targetStudentId: student.id,
          invitedByUserId: resolvedActor.id,
          invitedByName: resolvedActor.name,
          createdAt: now.toISOString(),
          expiresAt: expires.toISOString(),
        };

        DataStore.saveTenantInvitations([newInvite, ...updatedInvites]);

        allStudents[studentIdx] = {
          ...student,
          portalAccessStatus: 'invited',
        };
        DataStore.saveStudents(allStudents);

        DataStore.logAudit(
          params.tenantId,
          resolvedActor.id,
          resolvedActor.name,
          normalizedAction === 'resend_invite' ? 'Reenvio de Convite Aluno' : 'Convite Portal do Aluno',
          'Student',
          student.id,
          `Convite (${inviteCode}) gerado para ${newInvite.fullName} (${normalizedEmail}).`
        );

        return {
          success: true,
          message: `Convite gerado com sucesso! Código de ativação: ${inviteCode}`,
          status: 'invited',
          portalAccessStatus: 'invited',
          inviteCode,
          email: normalizedEmail,
        };
      }

      if (normalizedAction === 'revoke_invite') {
        const updatedInvites = allInvites.map((inv) =>
          inv.tenantId === params.tenantId &&
          inv.targetStudentId === student.id &&
          inv.status === 'invited'
            ? { ...inv, status: 'revoked' as const }
            : inv
        );
        DataStore.saveTenantInvitations(updatedInvites);

        allStudents[studentIdx] = {
          ...student,
          portalAccessStatus: 'none',
        };
        DataStore.saveStudents(allStudents);

        return {
          success: true,
          message: 'Convite pendente revogado com sucesso.',
          status: 'none',
          portalAccessStatus: 'none',
        };
      }

      if (normalizedAction === 'block' || normalizedAction === 'revoke_access') {
        const nextStatus: PortalAccessStatus =
          normalizedAction === 'block' ? 'blocked' : 'revoked';

        allStudents[studentIdx] = {
          ...student,
          portalAccessStatus: nextStatus,
          userId: normalizedAction === 'revoke_access' ? undefined : student.userId,
        };
        DataStore.saveStudents(allStudents);

        const nextUsers = allUsers.map((u) => {
          if (
            u.tenantId === params.tenantId &&
            (u.studentId === student.id || (student.userId && u.id === student.userId))
          ) {
            if (
              u.guardianPersonId &&
              (u.role === 'guardian' ||
                (u.secondaryRoles || []).some((r) =>
                  typeof r === 'string' ? r === 'guardian' : r.role === 'guardian'
                ))
            ) {
              return {
                ...u,
                role: 'guardian' as const,
                active: true,
                studentId: normalizedAction === 'revoke_access' ? undefined : u.studentId,
                secondaryRoles: (u.secondaryRoles || []).filter((r) =>
                  typeof r === 'string' ? r !== 'student' : r.role !== 'student'
                ),
              };
            }
            return {
              ...u,
              active: false,
              studentId: normalizedAction === 'revoke_access' ? undefined : u.studentId,
            };
          }
          return u;
        });
        DataStore.saveUsers(nextUsers);

        DataStore.logAudit(
          params.tenantId,
          resolvedActor.id,
          resolvedActor.name,
          normalizedAction === 'block' ? 'Bloqueio de Conta de Aluno' : 'Revogação de Conta de Aluno',
          'Student',
          student.id,
          `Acesso ao Portal do Aluno alterado para "${nextStatus}".`
        );

        return {
          success: true,
          message:
            normalizedAction === 'block'
              ? 'Conta do aluno bloqueada temporariamente.'
              : 'Acesso do aluno revogado com sucesso.',
          status: nextStatus,
          portalAccessStatus: nextStatus,
        };
      }

      if (normalizedAction === 'reactivate') {
        allStudents[studentIdx] = {
          ...student,
          portalAccessStatus: 'active',
        };
        DataStore.saveStudents(allStudents);

        const nextUsers = allUsers.map((u) => {
          if (
            u.tenantId === params.tenantId &&
            (u.studentId === student.id || (student.userId && u.id === student.userId))
          ) {
            return { ...u, active: true };
          }
          return u;
        });
        DataStore.saveUsers(nextUsers);

        return {
          success: true,
          message: 'Acesso do aluno reativado com sucesso.',
          status: 'active',
          portalAccessStatus: 'active',
        };
      }
    } else {
      // targetType === 'guardian'
      const personIdx = allPersons.findIndex(
        (p) => p.id === params.targetId && p.tenantId === params.tenantId
      );
      if (personIdx === -1) {
        throw new Error('Responsável não encontrado nesta academia.');
      }
      const person = allPersons[personIdx];
      const normalizedEmail = (params.email || person.email || '').trim().toLowerCase();

      if (normalizedAction === 'invite' || normalizedAction === 'resend_invite') {
        if (!normalizedEmail || !normalizedEmail.includes('@')) {
          throw new Error('Informe um endereço de e-mail válido para enviar o convite ao responsável.');
        }

        const updatedInvites = allInvites.map((inv) =>
          inv.tenantId === params.tenantId &&
          inv.targetGuardianPersonId === person.id &&
          inv.status === 'invited'
            ? { ...inv, status: 'expired' as const }
            : inv
        );

        const inviteCode = remoteInviteCode || generateInviteCode('RP');
        const now = new Date();
        const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

        const newInvite: TenantUserInvitation = {
          id: `inv-grd-${Date.now()}`,
          tenantId: params.tenantId,
          email: normalizedEmail,
          fullName: person.fullName,
          role: 'guardian',
          phone: person.phone,
          status: 'invited',
          inviteCode,
          targetGuardianPersonId: person.id,
          invitedByUserId: resolvedActor.id,
          invitedByName: resolvedActor.name,
          createdAt: now.toISOString(),
          expiresAt: expires.toISOString(),
        };

        DataStore.saveTenantInvitations([newInvite, ...updatedInvites]);

        allPersons[personIdx] = {
          ...person,
          email: normalizedEmail,
          portalAccessStatus: 'invited',
        };
        DataStore.savePersons(allPersons);

        DataStore.logAudit(
          params.tenantId,
          resolvedActor.id,
          resolvedActor.name,
          normalizedAction === 'resend_invite'
            ? 'Reenvio de Convite Responsável'
            : 'Convite Portal do Responsável',
          'Person',
          person.id,
          `Convite (${inviteCode}) gerado para o responsável ${person.fullName} (${normalizedEmail}).`
        );

        return {
          success: true,
          message: `Convite gerado para o responsável! Código de ativação: ${inviteCode}`,
          status: 'invited',
          portalAccessStatus: 'invited',
          inviteCode,
          email: normalizedEmail,
        };
      }

      if (normalizedAction === 'revoke_invite') {
        const updatedInvites = allInvites.map((inv) =>
          inv.tenantId === params.tenantId &&
          inv.targetGuardianPersonId === person.id &&
          inv.status === 'invited'
            ? { ...inv, status: 'revoked' as const }
            : inv
        );
        DataStore.saveTenantInvitations(updatedInvites);

        allPersons[personIdx] = {
          ...person,
          portalAccessStatus: 'none',
        };
        DataStore.savePersons(allPersons);

        return {
          success: true,
          message: 'Convite pendente do responsável revogado.',
          status: 'none',
          portalAccessStatus: 'none',
        };
      }

      if (normalizedAction === 'block' || normalizedAction === 'revoke_access') {
        const nextStatus: PortalAccessStatus =
          normalizedAction === 'block' ? 'blocked' : 'revoked';

        allPersons[personIdx] = {
          ...person,
          portalAccessStatus: nextStatus,
          userId: normalizedAction === 'revoke_access' ? undefined : person.userId,
        };
        DataStore.savePersons(allPersons);

        const nextUsers = allUsers.map((u) => {
          if (
            u.tenantId === params.tenantId &&
            (u.guardianPersonId === person.id || (person.userId && u.id === person.userId))
          ) {
            if (
              u.studentId &&
              (u.role === 'student' ||
                (u.secondaryRoles || []).some((r) =>
                  typeof r === 'string' ? r === 'student' : r.role === 'student'
                ))
            ) {
              return {
                ...u,
                role: 'student' as const,
                active: true,
                guardianPersonId: normalizedAction === 'revoke_access' ? undefined : u.guardianPersonId,
                secondaryRoles: (u.secondaryRoles || []).filter((r) =>
                  typeof r === 'string' ? r !== 'guardian' : r.role !== 'guardian'
                ),
              };
            }
            return {
              ...u,
              active: false,
              guardianPersonId: normalizedAction === 'revoke_access' ? undefined : u.guardianPersonId,
            };
          }
          return u;
        });
        DataStore.saveUsers(nextUsers);

        DataStore.logAudit(
          params.tenantId,
          resolvedActor.id,
          resolvedActor.name,
          normalizedAction === 'block'
            ? 'Bloqueio de Conta de Responsável'
            : 'Revogação de Conta de Responsável',
          'Person',
          person.id,
          `Acesso ao Portal do Responsável alterado para "${nextStatus}".`
        );

        return {
          success: true,
          message:
            normalizedAction === 'block'
              ? 'Conta do responsável bloqueada temporariamente.'
              : 'Acesso do responsável revogado com sucesso.',
          status: nextStatus,
          portalAccessStatus: nextStatus,
        };
      }

      if (normalizedAction === 'reactivate') {
        allPersons[personIdx] = {
          ...person,
          portalAccessStatus: 'active',
        };
        DataStore.savePersons(allPersons);

        const nextUsers = allUsers.map((u) => {
          if (
            u.tenantId === params.tenantId &&
            (u.guardianPersonId === person.id || (person.userId && u.id === person.userId))
          ) {
            return { ...u, active: true };
          }
          return u;
        });
        DataStore.saveUsers(nextUsers);

        return {
          success: true,
          message: 'Acesso do responsável reativado com sucesso.',
          status: 'active',
          portalAccessStatus: 'active',
        };
      }
    }

    throw new Error('Operação de gestão de conta inválida.');
  },

  /**
   * Vincula uma conta autenticada (por E-mail/Senha ou Google OAuth) a um convite de Aluno ou Responsável,
   * validando o Código de Convite e o CPF (sem jamais associar automaticamente apenas por nome/e-mail).
   */
  async claimPortalInvitation(params: {
    inviteCode: string;
    cpf?: string;
    authenticatedUser?: { id: string; email: string; name?: string };
    userId?: string;
    userEmail?: string;
    userName?: string;
    acceptedTerms?: boolean;
  }): Promise<{
    success: boolean;
    message: string;
    user: User;
    tenantId: string;
    role: 'student' | 'guardian';
    studentId?: string;
    guardianPersonId?: string;
  }> {
    const authUser = params.authenticatedUser || {
      id: params.userId || `user-${Date.now()}`,
      email: params.userEmail || '',
      name: params.userName,
    };

    const normalizedCode = params.inviteCode.trim().toUpperCase();
    const cleanedInputCpf = cleanCPF(params.cpf || '');
    const normalizedAuthEmail = authUser.email.trim().toLowerCase();

    if (!normalizedCode) {
      throw new Error('Informe o código de convite fornecido pela sua academia.');
    }

    // 1. Se o Supabase estiver configurado, validar no servidor via RPC
    if (isSupabaseConfigured() && supabase && isValidUUID(authUser.id)) {
      const { data, error } = await supabase.rpc('claim_portal_invitation', {
        p_invite_code: normalizedCode,
        p_cpf: cleanedInputCpf || null,
      });

      if (error && error.code !== '42883' && error.code !== 'PGRST202') {
        throw new Error(error.message || 'Não foi possível validar o convite de acesso.');
      }

      if (data?.success) {
        const linkedUser: User = {
          id: authUser.id,
          tenantId: data.tenant_id,
          name: authUser.name || normalizedAuthEmail.split('@')[0],
          email: normalizedAuthEmail,
          role: data.role,
          active: true,
          studentId: data.student_id || undefined,
          guardianPersonId: data.guardian_person_id || undefined,
        };
        return {
          success: true,
          message: 'Convite validado e conta vinculada com sucesso!',
          user: linkedUser,
          tenantId: data.tenant_id,
          role: data.role,
          studentId: data.student_id,
          guardianPersonId: data.guardian_person_id,
        };
      }
    }

    // 2. Validação transacional local
    const allInvites = DataStore.getTenantInvitations();
    const inviteIdx = allInvites.findIndex(
      (inv) =>
        inv.inviteCode?.toUpperCase() === normalizedCode &&
        inv.status === 'invited'
    );

    if (inviteIdx === -1) {
      throw new Error(
        'Código de convite inválido, expirado ou revogado pela academia.'
      );
    }

    const invite = allInvites[inviteIdx];
    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      allInvites[inviteIdx] = { ...invite, status: 'expired' };
      DataStore.saveTenantInvitations(allInvites);
      throw new Error('Este convite expirou. Solicite um novo convite à secretaria da academia.');
    }

    const allStudents = DataStore.getStudents();
    const allPersons = DataStore.getPersons();
    const allUsers = DataStore.getAllUsers();

    let targetStudent: Student | undefined;
    let targetPerson: Person | undefined;

    if (invite.role === 'student' && invite.targetStudentId) {
      targetStudent = allStudents.find(
        (s) => s.id === invite.targetStudentId && s.tenantId === invite.tenantId
      );
      targetPerson = targetStudent
        ? allPersons.find((p) => p.id === targetStudent!.personId && p.tenantId === invite.tenantId)
        : undefined;
    } else if (invite.role === 'guardian' && invite.targetGuardianPersonId) {
      targetPerson = allPersons.find(
        (p) => p.id === invite.targetGuardianPersonId && p.tenantId === invite.tenantId
      );
    }

    const targetCpf = cleanCPF(targetPerson?.cpf || '');
    if (targetCpf && cleanedInputCpf && targetCpf !== cleanedInputCpf) {
      throw new Error('O CPF informado não corresponde ao titular do convite cadastrado na academia.');
    }
    if (
      targetCpf &&
      !cleanedInputCpf &&
      invite.email.toLowerCase() !== normalizedAuthEmail
    ) {
      throw new Error(
        'Como você está autenticando com um e-mail diferente do convite, confirme seu CPF cadastrado na academia.'
      );
    }

    const existingUserIdx = allUsers.findIndex(
      (u) =>
        u.tenantId === invite.tenantId &&
        (u.id === authUser.id ||
          u.email.toLowerCase() === normalizedAuthEmail)
    );

    let finalUser: User;

    if (existingUserIdx >= 0) {
      const existing = allUsers[existingUserIdx];
      const rolesSet = new Set(existing.secondaryRoles || [existing.role]);
      rolesSet.add(invite.role);

      const matchingStudentForSamePerson = targetPerson
        ? allStudents.find(
            (s) => s.tenantId === invite.tenantId && s.personId === targetPerson!.id
          )
        : undefined;

      finalUser = {
        ...existing,
        id: authUser.id || existing.id,
        email: normalizedAuthEmail,
        active: true,
        studentId:
          invite.role === 'student'
            ? invite.targetStudentId
            : existing.studentId || matchingStudentForSamePerson?.id,
        guardianPersonId:
          invite.role === 'guardian'
            ? invite.targetGuardianPersonId
            : existing.guardianPersonId,
        secondaryRoles: Array.from(rolesSet),
      };
      allUsers[existingUserIdx] = finalUser;
    } else {
      const matchingStudentForSamePerson = targetPerson
        ? allStudents.find(
            (s) => s.tenantId === invite.tenantId && s.personId === targetPerson!.id
          )
        : undefined;
      const isAlsoGuardian = targetPerson
        ? DataStore.getGuardianRelationships(invite.tenantId).some(
            (g) => g.guardianPersonId === targetPerson!.id
          )
        : false;

      const secondaryRoles: ('student' | 'guardian')[] = [invite.role as 'student' | 'guardian'];
      if (invite.role === 'guardian' && matchingStudentForSamePerson) {
        secondaryRoles.push('student');
      } else if (invite.role === 'student' && isAlsoGuardian) {
        secondaryRoles.push('guardian');
      }

      finalUser = {
        id: authUser.id || `user-${Date.now()}`,
        tenantId: invite.tenantId,
        branchId: invite.branchId,
        name: targetPerson?.fullName || invite.fullName,
        email: normalizedAuthEmail,
        role: invite.role as 'student' | 'guardian',
        secondaryRoles,
        phone: targetPerson?.phone || invite.phone,
        active: true,
        studentId:
          invite.role === 'student'
            ? invite.targetStudentId
            : matchingStudentForSamePerson?.id,
        guardianPersonId:
          invite.role === 'guardian'
            ? invite.targetGuardianPersonId
            : isAlsoGuardian && targetPerson
            ? targetPerson.id
            : undefined,
        createdAt: new Date().toISOString(),
      };
      allUsers.push(finalUser);
    }

    DataStore.saveUsers(allUsers);

    if (invite.role === 'student' && invite.targetStudentId) {
      const sIdx = allStudents.findIndex((s) => s.id === invite.targetStudentId);
      if (sIdx >= 0) {
        allStudents[sIdx] = {
          ...allStudents[sIdx],
          userId: finalUser.id,
          portalAccessStatus: 'active',
        };
        DataStore.saveStudents(allStudents);
      }
    }

    if (targetPerson) {
      const pIdx = allPersons.findIndex((p) => p.id === targetPerson!.id);
      if (pIdx >= 0) {
        allPersons[pIdx] = {
          ...allPersons[pIdx],
          userId: finalUser.id,
          portalAccessStatus: 'active',
        };
        DataStore.savePersons(allPersons);
      }
    }

    allInvites[inviteIdx] = { ...invite, status: 'accepted' };
    DataStore.saveTenantInvitations(allInvites);

    return {
      success: true,
      message: 'Convite validado e conta vinculada com sucesso!',
      user: finalUser,
      tenantId: invite.tenantId,
      role: invite.role as 'student' | 'guardian',
      studentId: finalUser.studentId,
      guardianPersonId: finalUser.guardianPersonId,
    };
  },

  /**
   * Resolve os vínculos autorizados de Aluno e/ou Responsável para um usuário autenticado.
   * Nunca retorna registros de terceiros caso o vínculo seja revogado, bloqueado ou inexistente.
   */
  resolveAuthorizedPortalContext(
    userOrParams:
      | User
      | {
          user: User;
          tenantId: string;
          students?: Student[];
          persons?: Person[];
          guardians?: GuardianRelationship[];
        },
    maybeTenantId?: string
  ): {
    canAccessStudentPortal: boolean;
    canAccessGuardianPortal: boolean;
    hasDualPortalRole: boolean;
    ownStudent: Student | null;
    ownStudentPerson: Person | null;
    studentRecord: Student | null;
    studentPerson: Person | null;
    guardianPerson: Person | null;
    linkedDependents: {
      student: Student;
      person: Person;
      relationship: GuardianRelationship;
    }[];
    accessBlockedReason?: string;
  } {
    const isParamsObj =
      userOrParams &&
      typeof userOrParams === 'object' &&
      'user' in userOrParams &&
      'tenantId' in userOrParams;

    const user = isParamsObj ? userOrParams.user : (userOrParams as User);
    const tenantId = isParamsObj ? userOrParams.tenantId : (maybeTenantId || user?.tenantId || '');
    const students =
      (isParamsObj && userOrParams.students) || DataStore.getStudents(tenantId);
    const persons =
      (isParamsObj && userOrParams.persons) || DataStore.getPersons(tenantId);
    const guardians =
      (isParamsObj && userOrParams.guardians) || DataStore.getGuardianRelationships(tenantId);

    if (!user || !user.id || !user.active || user.tenantId !== tenantId) {
      return {
        canAccessStudentPortal: false,
        canAccessGuardianPortal: false,
        hasDualPortalRole: false,
        ownStudent: null,
        ownStudentPerson: null,
        studentRecord: null,
        studentPerson: null,
        guardianPerson: null,
        linkedDependents: [],
        accessBlockedReason: 'Sessão inativa ou pertencente a outra academia.',
      };
    }

    // 1. Verificar vínculo de Aluno (priorizando studentId explícito, ou userId no mesmo tenant)
    const candidateStudent =
      (user.studentId
        ? students.find((s) => s.tenantId === tenantId && s.id === user.studentId)
        : undefined) ||
      students.find((s) => s.tenantId === tenantId && s.userId && s.userId === user.id);

    let ownStudent: Student | null = null;
    let ownStudentPerson: Person | null = null;
    let blockedReason: string | undefined;

    if (candidateStudent) {
      if (
        candidateStudent.portalAccessStatus === 'blocked' ||
        candidateStudent.portalAccessStatus === 'revoked'
      ) {
        blockedReason =
          candidateStudent.portalAccessStatus === 'blocked'
            ? 'Seu acesso ao Portal do Aluno foi temporariamente bloqueado pela secretaria da academia.'
            : 'Seu vínculo de acesso ao Portal do Aluno foi revogado pela academia.';
      } else {
        ownStudent = candidateStudent;
        ownStudentPerson =
          persons.find((p) => p.id === candidateStudent.personId && p.tenantId === tenantId) ||
          null;
      }
    }

    // 2. Verificar vínculo de Responsável (priorizando guardianPersonId explícito, ou pessoa com userId que possua vínculo em guardians)
    let candidateGuardianPerson =
      (user.guardianPersonId
        ? persons.find((p) => p.tenantId === tenantId && p.id === user.guardianPersonId)
        : undefined) ||
      persons.find(
        (p) =>
          p.tenantId === tenantId &&
          p.userId &&
          p.userId === user.id &&
          guardians.some((g) => g.tenantId === tenantId && g.guardianPersonId === p.id)
      );

    // Se o usuário já foi identificado como aluno, verificar se a mesma pessoa física (ownStudentPerson) também possui dependentes
    if (!candidateGuardianPerson && ownStudentPerson) {
      const hasDeps = guardians.some(
        (g) => g.tenantId === tenantId && g.guardianPersonId === ownStudentPerson!.id
      );
      if (hasDeps) {
        candidateGuardianPerson = ownStudentPerson;
      }
    }

    // Inversamente, se foi identificado como responsável e a mesma pessoa física também é aluno ativo
    if (!ownStudent && candidateGuardianPerson) {
      const matchingStu = students.find(
        (s) =>
          s.tenantId === tenantId &&
          s.personId === candidateGuardianPerson!.id &&
          s.portalAccessStatus !== 'blocked' &&
          s.portalAccessStatus !== 'revoked'
      );
      if (matchingStu) {
        ownStudent = matchingStu;
        ownStudentPerson = candidateGuardianPerson;
      }
    }

    let guardianPerson: Person | null = null;
    const linkedDependents: {
      student: Student;
      person: Person;
      relationship: GuardianRelationship;
    }[] = [];

    if (candidateGuardianPerson) {
      if (
        candidateGuardianPerson.portalAccessStatus === 'blocked' ||
        candidateGuardianPerson.portalAccessStatus === 'revoked'
      ) {
        blockedReason =
          candidateGuardianPerson.portalAccessStatus === 'blocked'
            ? 'Seu acesso ao Portal do Responsável foi temporariamente bloqueado pela academia.'
            : 'Seu vínculo de acesso ao Portal do Responsável foi revogado pela academia.';
      } else {
        guardianPerson = candidateGuardianPerson;
        const rels = guardians.filter(
          (r) =>
            r.tenantId === tenantId && r.guardianPersonId === candidateGuardianPerson!.id
        );
        for (const rel of rels) {
          const depStudent = students.find(
            (s) => s.id === rel.studentId && s.tenantId === tenantId
          );
          if (depStudent) {
            const depPerson = persons.find(
              (p) => p.id === depStudent.personId && p.tenantId === tenantId
            );
            if (depPerson) {
              linkedDependents.push({
                student: depStudent,
                person: depPerson,
                relationship: rel,
              });
            }
          }
        }
      }
    }

    const canAccessStudentPortal = Boolean(ownStudent && ownStudentPerson);
    const canAccessGuardianPortal = Boolean(guardianPerson && linkedDependents.length > 0);

    return {
      canAccessStudentPortal,
      canAccessGuardianPortal,
      hasDualPortalRole: canAccessStudentPortal && canAccessGuardianPortal,
      ownStudent,
      ownStudentPerson,
      studentRecord: ownStudent,
      studentPerson: ownStudentPerson,
      guardianPerson,
      linkedDependents,
      accessBlockedReason: blockedReason,
    };
  },

  /**
   * Valida e retorna APENAS os registros de frequência autorizados para o solicitante.
   * Protege contra manipulação de IDs (Seção 7, 8 e 9).
   */
  getAuthorizedStudentAttendance(params: {
    actor: User;
    tenantId: string;
    targetStudentId: string;
    allAttendances: AttendanceRecord[];
    students: Student[];
    persons: Person[];
    guardians: GuardianRelationship[];
  }): AttendanceRecord[] {
    const { actor, tenantId, targetStudentId, allAttendances, students, persons, guardians } =
      params;

    if (!actor || !actor.active || actor.tenantId !== tenantId) {
      throw new Error('Acesso negado (403): usuário não autenticado nesta academia.');
    }

    if (['owner', 'branch_manager', 'secretary', 'instructor'].includes(actor.role)) {
      return allAttendances.filter(
        (a) => a.tenantId === tenantId && a.studentId === targetStudentId
      );
    }

    const ctx = this.resolveAuthorizedPortalContext({
      user: actor,
      tenantId,
      students,
      persons,
      guardians,
    });

    const isOwn = ctx.canAccessStudentPortal && ctx.ownStudent?.id === targetStudentId;
    const isLinkedDependent =
      ctx.canAccessGuardianPortal &&
      ctx.linkedDependents.some((d) => d.student.id === targetStudentId);

    if (!isOwn && !isLinkedDependent) {
      throw new Error(
        'Violação de permissão (403): você não possui autorização para consultar a frequência deste aluno.'
      );
    }

    return allAttendances.filter(
      (a) => a.tenantId === tenantId && a.studentId === targetStudentId
    );
  },

  /**
   * Valida e retorna APENAS as mensalidades/faturas autorizadas para o Responsável vinculado.
   * Bloqueia consulta de faturas de outras famílias ou acesso por alunos a faturas de terceiros.
   */
  getAuthorizedGuardianInvoices(params: {
    actor: User;
    tenantId: string;
    targetStudentId?: string;
    allInvoices: Invoice[];
    students: Student[];
    persons: Person[];
    guardians: GuardianRelationship[];
  }): Invoice[] {
    const { actor, tenantId, targetStudentId, allInvoices, students, persons, guardians } =
      params;

    if (!actor || !actor.active || actor.tenantId !== tenantId) {
      throw new Error('Acesso negado (403): usuário não autenticado nesta academia.');
    }

    if (['owner', 'branch_manager', 'secretary', 'financial'].includes(actor.role)) {
      return allInvoices.filter(
        (i) =>
          i.tenantId === tenantId && (!targetStudentId || i.studentId === targetStudentId)
      );
    }

    const ctx = this.resolveAuthorizedPortalContext({
      user: actor,
      tenantId,
      students,
      persons,
      guardians,
    });

    if (!ctx.canAccessGuardianPortal || !ctx.guardianPerson) {
      throw new Error(
        'Violação de permissão (403): apenas responsáveis vinculados ou a administração financeira podem consultar mensalidades.'
      );
    }

    const allowedStudentIds = new Set(ctx.linkedDependents.map((d) => d.student.id));
    if (targetStudentId && !allowedStudentIds.has(targetStudentId)) {
      throw new Error(
        'Violação de permissão (403): você não possui vínculo de responsabilidade com o aluno solicitado.'
      );
    }

    return allInvoices.filter(
      (i) =>
        i.tenantId === tenantId &&
        allowedStudentIds.has(i.studentId) &&
        (!targetStudentId || i.studentId === targetStudentId)
    );
  },

  /**
   * Valida e retorna os vídeos da Biblioteca Digital autorizados para o Aluno.
   * Bloqueia acesso por Responsável que não possua vínculo próprio de Aluno.
   */
  getAuthorizedDigitalLibraryForActor(
    actorOrParams:
      | {
          actor: User;
          tenantId: string;
          students?: Student[];
          persons?: Person[];
          guardians?: GuardianRelationship[];
          libraryItems?: DigitalLibraryItem[];
        }
      | {
          id?: string;
          userId?: string;
          tenantId: string;
          role: string;
          studentId?: string;
          guardianPersonId?: string;
          active?: boolean;
        },
    maybeLibraryItems?: DigitalLibraryItem[]
  ): DigitalLibraryItem[] {
    const isParamsWithActor =
      actorOrParams && typeof actorOrParams === 'object' && 'actor' in actorOrParams;

    const rawActor = isParamsWithActor ? actorOrParams.actor : actorOrParams;
    const tenantId = isParamsWithActor ? actorOrParams.tenantId : rawActor.tenantId;
    const actor: User = {
      id: (rawActor as any).id || (rawActor as any).userId || 'student-actor',
      tenantId,
      name: (rawActor as any).name || 'Aluno',
      email: (rawActor as any).email || '',
      role: (rawActor.role as any) || 'student',
      active: (rawActor as any).active !== false,
      studentId: (rawActor as any).studentId,
      guardianPersonId: (rawActor as any).guardianPersonId,
    };

    if (!actor || !actor.active || actor.tenantId !== tenantId) {
      throw new Error('Acesso negado (403): sessão inválida.');
    }

    const students =
      (isParamsWithActor && actorOrParams.students) || DataStore.getStudents(tenantId);
    const persons =
      (isParamsWithActor && actorOrParams.persons) || DataStore.getPersons(tenantId);
    const guardians =
      (isParamsWithActor && actorOrParams.guardians) || DataStore.getGuardianRelationships(tenantId);

    const ctx = this.resolveAuthorizedPortalContext({
      user: actor,
      tenantId,
      students,
      persons,
      guardians,
    });

    if (!ctx.canAccessStudentPortal || !ctx.ownStudent) {
      throw new Error(
        'Violação de permissão (403): a Biblioteca Digital é exclusiva para alunos matriculados.'
      );
    }

    const items =
      maybeLibraryItems ||
      (isParamsWithActor && actorOrParams.libraryItems) ||
      DataStore.getLibraryItems(tenantId);

    const studentGradMap = new Map<string, string>();
    for (const g of ctx.ownStudent.currentGraduations || []) {
      studentGradMap.set(g.martialArtId, g.beltId);
    }

    return items.filter((item) => {
      if (item.tenantId !== tenantId) return false;
      if (item.status && item.status !== 'published') return false;
      if (item.accessScope === 'public' || item.accessScope === 'tenant_all' || item.allBelts) {
        return true;
      }
      if (item.accessScope === 'restricted_belt') {
        if (item.martialArtId) {
          const stuBeltId = studentGradMap.get(item.martialArtId);
          if (!stuBeltId) return false;
          if (!item.targetBeltIds || item.targetBeltIds.length === 0) return true;
          return item.targetBeltIds.includes(stuBeltId);
        }
        return true;
      }
      return true;
    });
  },

  /**
   * Valida e retorna avaliações físicas do aluno somente quando autorizado pela academia.
   */
  getAuthorizedStudentAssessments(params: {
    actor: User;
    tenantId: string;
    targetStudentId: string;
    allAssessments: PhysicalAssessment[];
    students: Student[];
    persons: Person[];
    guardians: GuardianRelationship[];
  }): PhysicalAssessment[] {
    const { actor, tenantId, targetStudentId, allAssessments, students, persons, guardians } =
      params;

    const ctx = this.resolveAuthorizedPortalContext({
      user: actor,
      tenantId,
      students,
      persons,
      guardians,
    });

    if (ctx.canAccessStudentPortal && ctx.ownStudent?.id === targetStudentId) {
      if (!ctx.ownStudent.allowAnthropometryView) {
        return [];
      }
      return allAssessments.filter(
        (a) => a.tenantId === tenantId && a.studentId === targetStudentId
      );
    }

    if (
      ctx.canAccessGuardianPortal &&
      ctx.linkedDependents.some((d) => d.student.id === targetStudentId)
    ) {
      return allAssessments.filter(
        (a) => a.tenantId === tenantId && a.studentId === targetStudentId
      );
    }

    throw new Error(
      'Violação de permissão (403): acesso não autorizado aos dados físicos deste aluno.'
    );
  },

  /**
   * Permite ao próprio aluno atualizar exclusivamente seus dados pessoais permitidos
   * (nome social, telefone, e-mail de contato e endereço), bloqueando alteração de matrícula,
   * mensalidade, plano ou graduação.
   */
  async updateOwnStudentPersonalInfo(params: {
    actor?: User;
    tenantId: string;
    studentId: string;
    personId?: string;
    socialName?: string;
    phone?: string;
    email?: string;
    address?: Person['address'];
  }): Promise<Person & { success: boolean; message: string; updatedPerson: Person }> {
    const allStudents = DataStore.getStudents();
    const allPersons = DataStore.getPersons();
    const allGuardians = DataStore.getGuardianRelationships();

    const resolvedActor: User =
      params.actor ||
      DataStore.getUsers(params.tenantId).find((u) => u.studentId === params.studentId) || {
        id: `student-${params.studentId}`,
        tenantId: params.tenantId,
        name: 'Aluno',
        email: params.email || '',
        role: 'student',
        active: true,
        studentId: params.studentId,
      };

    const ctx = this.resolveAuthorizedPortalContext({
      user: resolvedActor,
      tenantId: params.tenantId,
      students: allStudents,
      persons: allPersons,
      guardians: allGuardians,
    });

    if (!ctx.canAccessStudentPortal || !ctx.ownStudent || ctx.ownStudent.id !== params.studentId) {
      throw new Error(
        'Violação de permissão (403): você só pode atualizar os dados cadastrais do seu próprio perfil de aluno.'
      );
    }

    if (
      isSupabaseConfigured() &&
      supabase &&
      isValidUUID(params.tenantId) &&
      isValidUUID(params.studentId)
    ) {
      const { error } = await supabase.rpc('student_update_own_personal_info', {
        p_tenant_id: params.tenantId,
        p_student_id: params.studentId,
        p_social_name: params.socialName?.trim() || null,
        p_phone: params.phone?.trim() || null,
        p_email: params.email?.trim().toLowerCase() || null,
        p_address: params.address || null,
      });

      if (error && error.code !== '42883' && error.code !== 'PGRST202') {
        throw new Error(error.message || 'Falha ao atualizar seus dados cadastrais.');
      }
    }

    const personIdx = allPersons.findIndex(
      (p) => p.id === ctx.ownStudent!.personId && p.tenantId === params.tenantId
    );
    if (personIdx === -1) {
      throw new Error('Cadastro pessoal não localizado.');
    }

    const currentPerson = allPersons[personIdx];
    const updatedPerson: Person = {
      ...currentPerson,
      socialName:
        params.socialName !== undefined
          ? params.socialName.trim() || undefined
          : currentPerson.socialName,
      phone: params.phone !== undefined ? params.phone.trim() : currentPerson.phone,
      email:
        params.email !== undefined
          ? params.email.trim().toLowerCase()
          : currentPerson.email,
      address: params.address ? { ...currentPerson.address, ...params.address } : currentPerson.address,
    };

    allPersons[personIdx] = updatedPerson;
    DataStore.savePersons(allPersons);

    DataStore.logAudit(
      params.tenantId,
      resolvedActor.id,
      resolvedActor.name,
      'Autoatendimento: Atualização de Dados Pessoais',
      'Person',
      updatedPerson.id,
      `O aluno ${updatedPerson.fullName} atualizou seus dados de contato/endereço no Portal do Aluno.`
    );

    return {
      ...updatedPerson,
      success: true,
      message: 'Seus dados de contato e endereço foram atualizados com sucesso!',
      updatedPerson,
    };
  },
};
