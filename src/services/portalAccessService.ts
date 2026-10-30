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
  lastEmailSentAt?: string;
  lastEmailStatus?: 'sent' | 'failed' | 'missing_config' | 'pending';
  lastEmailError?: string;
}

export interface PortalInvitationVerification {
  valid: boolean;
  reason?: 'ready_to_claim' | 'not_found' | 'already_used' | 'revoked' | 'expired' | 'empty_code' | 'service_unavailable';
  message: string;
  invitationId?: string;
  inviteCode?: string;
  tenantId?: string;
  academyName?: string;
  role?: string;
  fullName?: string;
  email?: string;
  maskedEmail?: string;
  maskedCpf?: string;
  requiresCpf?: boolean;
  expiresAt?: string;
  acceptedAt?: string;
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
        lastEmailSentAt: pendingInvite?.lastEmailSentAt,
        lastEmailStatus: pendingInvite?.lastEmailStatus,
        lastEmailError: pendingInvite?.lastEmailError,
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
        lastEmailSentAt: pendingInvite?.lastEmailSentAt,
        lastEmailStatus: pendingInvite?.lastEmailStatus,
        lastEmailError: pendingInvite?.lastEmailError,
      };
    }
  },

  /**
   * Envia o e-mail de ativação com o código de convite e link direto via Supabase Edge Function / Resend.
   */
  async sendPortalInvitationEmail(params: {
    tenantId: string;
    invitationId?: string;
    inviteCode: string;
    recipientEmail: string;
    recipientName: string;
    targetType: 'student' | 'guardian';
    targetId: string;
    academyName?: string;
  }): Promise<{
    success: boolean;
    emailSent: boolean;
    status: 'sent' | 'failed' | 'missing_config' | 'pending';
    error?: string;
    messageId?: string;
  }> {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://tatameclub.com.br';

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase.functions.invoke('send-portal-invitation-email', {
          body: {
            tenantId: params.tenantId,
            invitationId: params.invitationId,
            inviteCode: params.inviteCode,
            recipientEmail: params.recipientEmail,
            recipientName: params.recipientName,
            targetType: params.targetType,
            targetId: params.targetId,
            academyName: params.academyName || 'Tatame Club',
            appUrl: origin,
          },
        });

        if (error) {
          let errText = error.message || 'Falha ao acionar a Edge Function de e-mail.';
          if (errText.includes('Failed to send a request to the Edge Function')) {
            errText = 'Falha de conexão com a Edge Function de e-mail (send-portal-invitation-email). O código de convite continua ativo.';
          }
          return {
            success: false,
            emailSent: false,
            status: 'failed',
            error: errText,
          };
        }

        if (data?.code === 'MISSING_EMAIL_PROVIDER_SECRET') {
          return {
            success: false,
            emailSent: false,
            status: 'missing_config',
            error: data.error,
          };
        }

        if (data?.emailSent) {
          return {
            success: true,
            emailSent: true,
            status: 'sent',
            messageId: data.messageId,
          };
        }

        return {
          success: false,
          emailSent: false,
          status: data?.code === 'MISSING_EMAIL_PROVIDER_SECRET' ? 'missing_config' : 'failed',
          error: data?.error || 'Não foi possível entregar o e-mail de convite.',
        };
      } catch (err: any) {
        let errText = err?.message || 'Falha na conexão com a Edge Function de e-mail.';
        if (errText.includes('Failed to send a request to the Edge Function')) {
          errText = 'Falha de conexão com a Edge Function de e-mail (send-portal-invitation-email). O código de convite continua ativo.';
        }
        return {
          success: false,
          emailSent: false,
          status: 'failed',
          error: errText,
        };
      }
    }

    // Modo local / simulação para testes e ambientes locais
    DataStore.logAudit(
      params.tenantId,
      'system',
      'Serviço Transacional de E-mail',
      'Envio de E-mail de Convite (Local/Simulado)',
      params.targetType === 'student' ? 'Student' : 'Person',
      params.targetId,
      `E-mail de ativação com código ${params.inviteCode} despachado para ${params.recipientEmail}.`
    );

    return {
      success: true,
      emailSent: true,
      status: 'sent',
      messageId: `local-${Date.now()}`,
    };
  },

  /**
   * Pré-valida o código de convite antes do cadastro, retornando dados da academia e do aluno/responsável.
   */
  async verifyPortalInvitation(inviteCode: string): Promise<PortalInvitationVerification> {
    const rawClean = (inviteCode || '').trim().toUpperCase();
    const cleanWithoutHyphen = rawClean.replace(/[\s\-]/g, '');
    if (!cleanWithoutHyphen) {
      return {
        valid: false,
        reason: 'empty_code',
        message: 'Informe o código de convite fornecido pela academia.',
      };
    }

    if (isSupabaseConfigured()) {
      if (!supabase) return { valid: false, reason: 'service_unavailable', message: 'O serviço de validação de convites não está disponível. Tente novamente mais tarde.' };
      try {
        let rpcRes = await supabase.rpc('verify_portal_invitation', { p_invite_code: rawClean });
        if ((rpcRes.error || !rpcRes.data) && rawClean !== cleanWithoutHyphen) {
          const retryRes = await supabase.rpc('verify_portal_invitation', { p_invite_code: cleanWithoutHyphen });
          if (!retryRes.error && retryRes.data) rpcRes = retryRes;
        }
        if (rpcRes.error) {
          console.warn('Erro ao verificar convite no Supabase:', rpcRes.error);
          const rpcMissing = rpcRes.error.code === '42883' || rpcRes.error.code === 'PGRST202';
          return {
            valid: false,
            reason: 'service_unavailable',
            message: rpcMissing
              ? 'A validação de convites não está configurada no banco da academia. A equipe responsável precisa aplicar as migrations 35 a 38 do projeto.'
              : 'Não foi possível consultar o convite no banco da academia. Tente novamente mais tarde.',
          };
        }
        if (!rpcRes.data) return { valid: false, reason: 'service_unavailable', message: 'O banco da academia não retornou uma resposta de validação. Tente novamente mais tarde.' };
        const d = rpcRes.data as any;
        return {
          valid: Boolean(d.valid),
          reason: d.reason,
          message: d.message || 'Código verificado com sucesso.',
          invitationId: d.invitation_id || d.invitationId,
          inviteCode: d.invite_code || d.inviteCode || rawClean,
          tenantId: d.tenant_id || d.tenantId,
          academyName: d.academy_name || d.academyName || 'Tatame Club',
          role: d.role,
          fullName: d.full_name || d.fullName,
          email: d.email,
          maskedEmail: d.masked_email || d.maskedEmail,
          maskedCpf: d.masked_cpf || d.maskedCpf,
          requiresCpf: d.requires_cpf !== undefined ? Boolean(d.requires_cpf) : Boolean(d.requiresCpf),
          expiresAt: d.expires_at || d.expiresAt,
          acceptedAt: d.accepted_at || d.acceptedAt,
        };
      } catch (err) {
        console.warn('Falha na chamada de verificação de convite:', err);
        return { valid: false, reason: 'service_unavailable', message: 'Não foi possível consultar o convite no banco da academia. Tente novamente mais tarde.' };
      }
    }

    // Validação no DataStore local somente quando o Supabase não está configurado


    const allInvites = DataStore.getTenantInvitations();
    const inv = allInvites.find(
      (i) => (i.inviteCode || '').replace(/[\s\-]/g, '').toUpperCase() === cleanWithoutHyphen
    );

    if (!inv) {
      return {
        valid: false,
        reason: 'not_found',
        message: 'Código de convite não encontrado no sistema. Verifique a digitação ou solicite um novo envio à academia.',
      };
    }

    const tenant = DataStore.getTenants().find((t) => t.id === inv.tenantId);
    const academyName = tenant?.tradeName || tenant?.legalName || 'Tatame Club';

    if (inv.status === 'accepted') {
      return {
        valid: false,
        reason: 'already_used',
        message: 'Este código de convite já foi utilizado e ativado anteriormente.',
        academyName,
        inviteCode: inv.inviteCode,
      };
    }

    if (inv.status === 'revoked') {
      return {
        valid: false,
        reason: 'revoked',
        message: 'Este convite foi revogado pela administração da academia. Solicite um novo código à secretaria.',
        academyName,
        inviteCode: inv.inviteCode,
      };
    }

    const isExpired = inv.status === 'expired' || new Date(inv.expiresAt).getTime() < Date.now();
    if (isExpired) {
      return {
        valid: false,
        reason: 'expired',
        message: 'Este código de convite expirou. Solicite um novo código de ativação à secretaria da academia.',
        academyName,
        expiresAt: inv.expiresAt,
        inviteCode: inv.inviteCode,
      };
    }

    let personCpf = '';
    if (inv.role === 'student' && inv.targetStudentId) {
      const student = DataStore.getStudents(inv.tenantId).find((s) => s.id === inv.targetStudentId);
      const person = student ? DataStore.getPersons(inv.tenantId).find((p) => p.id === student.personId) : undefined;
      personCpf = cleanCPF(person?.cpf || '');
    } else if (inv.role === 'guardian' && inv.targetGuardianPersonId) {
      const person = DataStore.getPersons(inv.tenantId).find((p) => p.id === inv.targetGuardianPersonId);
      personCpf = cleanCPF(person?.cpf || '');
    }

    let maskedCpf = '';
    if (personCpf.length === 11) {
      maskedCpf = `${personCpf.slice(0, 3)}.***.***-${personCpf.slice(9)}`;
    }

    let maskedEmail = inv.email;
    if (inv.email.includes('@')) {
      const [user, domain] = inv.email.split('@');
      maskedEmail = `${user.slice(0, 2)}***@${domain}`;
    }

    return {
      valid: true,
      reason: 'ready_to_claim',
      message: 'Convite válido e pronto para ativação.',
      invitationId: inv.id,
      inviteCode: inv.inviteCode,
      tenantId: inv.tenantId,
      academyName,
      role: inv.role,
      fullName: inv.fullName,
      email: inv.email,
      maskedEmail,
      maskedCpf,
      requiresCpf: Boolean(personCpf),
      expiresAt: inv.expiresAt,
    };
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
      | 'resend_email'
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
    emailSent?: boolean;
    emailStatus?: 'sent' | 'failed' | 'missing_config' | 'pending';
    emailError?: string;
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

    if (isSupabaseConfigured()) {
      if (!supabase) throw new Error('O Supabase está configurado, mas o cliente de banco não está disponível.');
      if (!isValidUUID(params.tenantId) || !isValidUUID(params.targetId)) {
        throw new Error('Não foi possível localizar os identificadores reais da academia e do cadastro para gravar o convite.');
      }
      const { data, error } = await supabase.rpc('manage_portal_account_access', {
        p_tenant_id: params.tenantId,
        p_target_type: params.targetType,
        p_target_id: params.targetId,
        p_action: normalizedAction,
        p_email: params.email?.trim().toLowerCase() || null,
        p_allow_anthropometry: params.allowAnthropometry !== undefined ? params.allowAnthropometry : null,
      });
      if (error) {
        const rpcMissing = error.code === '42883' || error.code === 'PGRST202';
        throw new Error(
          rpcMissing
            ? 'O serviço de convites do portal não está instalado no banco da academia. Aplique a migration 36 antes de gerar ou reenviar convites.'
            : error.message || 'Falha ao gerenciar conta de acesso no Supabase.'
        );
      }
      if (data?.success === false) throw new Error(data.message || 'O banco não confirmou a operação de acesso ao portal.');
      if (['invite', 'resend_invite'].includes(normalizedAction) && !data?.invite_code) {
        throw new Error('O banco não confirmou a gravação do convite. Nenhum e-mail foi enviado.');
      }
      if (data?.invite_code) remoteInviteCode = data.invite_code;
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

        const tenant = DataStore.getTenants().find((t) => t.id === params.tenantId);
        const academyName = tenant?.tradeName || tenant?.legalName || 'Tatame Club';

        const emailResult = await this.sendPortalInvitationEmail({
          tenantId: params.tenantId,
          invitationId: newInvite.id,
          inviteCode,
          recipientEmail: normalizedEmail,
          recipientName: newInvite.fullName,
          targetType: 'student',
          targetId: student.id,
          academyName,
        });

        newInvite.lastEmailSentAt = emailResult.emailSent ? new Date().toISOString() : undefined;
        newInvite.lastEmailStatus = emailResult.status;
        newInvite.lastEmailError = emailResult.error;

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
          `Convite (${inviteCode}) gerado para ${newInvite.fullName} (${normalizedEmail}). Status e-mail: ${emailResult.status}.`
        );

        let userFeedbackMessage = `Convite gerado com sucesso! Código de ativação: ${inviteCode}`;
        if (emailResult.emailSent) {
          userFeedbackMessage = `Convite gerado e e-mail de ativação enviado com sucesso para ${normalizedEmail}! Código: ${inviteCode}`;
        } else if (emailResult.status === 'missing_config') {
          userFeedbackMessage = `Convite gerado! Código: ${inviteCode}. Aviso: O envio por e-mail está desativado (segredo RESEND_API_KEY não configurado no Supabase). Copie o código acima para fornecer ao aluno.`;
        } else if (emailResult.error) {
          userFeedbackMessage = `Convite gerado (Código: ${inviteCode}), mas o envio do e-mail falhou (${emailResult.error}). Copie o código para fornecer ao aluno.`;
        }

        return {
          success: true,
          message: userFeedbackMessage,
          status: 'invited',
          portalAccessStatus: 'invited',
          inviteCode,
          email: normalizedEmail,
          emailSent: emailResult.emailSent,
          emailStatus: emailResult.status,
          emailError: emailResult.error,
        };
      }

      if (normalizedAction === 'resend_email') {
        const activeInvite = allInvites.find(
          (inv) =>
            inv.tenantId === params.tenantId &&
            inv.targetStudentId === student.id &&
            inv.status === 'invited'
        );

        if (!activeInvite) {
          throw new Error('Nenhum convite pendente ativo encontrado para reenviar o e-mail do aluno.');
        }

        const targetEmail = (params.email || activeInvite.email || person?.email || '').trim().toLowerCase();
        if (!targetEmail || !targetEmail.includes('@')) {
          throw new Error('Endereço de e-mail inválido para reenvio.');
        }

        // Anti-spam / rate limit: impede reenvio se enviado com sucesso há menos de 60 segundos
        if (activeInvite.lastEmailSentAt && activeInvite.lastEmailStatus === 'sent') {
          const elapsedMs = Date.now() - new Date(activeInvite.lastEmailSentAt).getTime();
          if (elapsedMs < 60_000) {
            const waitSec = Math.ceil((60_000 - elapsedMs) / 1000);
            return {
              success: false,
              message: `Um e-mail de ativação já foi enviado recentemente para ${activeInvite.email}. Aguarde ${waitSec} segundos para tentar novamente.`,
              status: 'invited',
              portalAccessStatus: 'invited',
              inviteCode: activeInvite.inviteCode,
              email: activeInvite.email,
              emailSent: false,
              emailStatus: activeInvite.lastEmailStatus,
              emailError: activeInvite.lastEmailError,
            };
          }
        }

        const tenant = DataStore.getTenants().find((t) => t.id === params.tenantId);
        const academyName = tenant?.tradeName || tenant?.legalName || 'Tatame Club';

        const emailResult = await this.sendPortalInvitationEmail({
          tenantId: params.tenantId,
          invitationId: activeInvite.id,
          inviteCode: activeInvite.inviteCode || '',
          recipientEmail: targetEmail,
          recipientName: activeInvite.fullName || person?.fullName || `Aluno ${student.registrationNumber}`,
          targetType: 'student',
          targetId: student.id,
          academyName,
        });

        // Atualiza convite existente SEM alterar código de convite e SEM expirar
        activeInvite.email = targetEmail;
        if (emailResult.emailSent) {
          activeInvite.lastEmailSentAt = new Date().toISOString();
        }
        activeInvite.lastEmailStatus = emailResult.status;
        activeInvite.lastEmailError = emailResult.error;

        DataStore.saveTenantInvitations(allInvites);

        DataStore.logAudit(
          params.tenantId,
          resolvedActor.id,
          resolvedActor.name,
          'Reenvio de E-mail de Convite Aluno',
          'Student',
          student.id,
          `Reenvio de e-mail de convite para ${targetEmail} com código ${activeInvite.inviteCode}. Status: ${emailResult.status}.`
        );

        let userFeedbackMessage = `Tentativa de envio de e-mail concluída. Código mantido: ${activeInvite.inviteCode}`;
        if (emailResult.emailSent) {
          userFeedbackMessage = `E-mail de ativação reenviado com sucesso para ${targetEmail}! Código mantido: ${activeInvite.inviteCode}`;
        } else if (emailResult.status === 'missing_config') {
          userFeedbackMessage = `O envio por e-mail está desativado (segredo RESEND_API_KEY não configurado no Supabase). O código ${activeInvite.inviteCode} continua ativo para fornecer ao aluno.`;
        } else if (emailResult.error) {
          userFeedbackMessage = `Falha ao reenviar o e-mail (${emailResult.error}). O código ativo permanece válido: ${activeInvite.inviteCode}. Copie-o abaixo para fornecer ao aluno.`;
        }

        return {
          success: emailResult.emailSent,
          message: userFeedbackMessage,
          status: 'invited',
          portalAccessStatus: 'invited',
          inviteCode: activeInvite.inviteCode,
          email: targetEmail,
          emailSent: emailResult.emailSent,
          emailStatus: emailResult.status,
          emailError: emailResult.error,
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

        const tenant = DataStore.getTenants().find((t) => t.id === params.tenantId);
        const academyName = tenant?.tradeName || tenant?.legalName || 'Tatame Club';

        const emailResult = await this.sendPortalInvitationEmail({
          tenantId: params.tenantId,
          invitationId: newInvite.id,
          inviteCode,
          recipientEmail: normalizedEmail,
          recipientName: person.fullName,
          targetType: 'guardian',
          targetId: person.id,
          academyName,
        });

        newInvite.lastEmailSentAt = emailResult.emailSent ? new Date().toISOString() : undefined;
        newInvite.lastEmailStatus = emailResult.status;
        newInvite.lastEmailError = emailResult.error;

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
          `Convite (${inviteCode}) gerado para o responsável ${person.fullName} (${normalizedEmail}). Status e-mail: ${emailResult.status}.`
        );

        let userFeedbackMessage = `Convite gerado para o responsável! Código de ativação: ${inviteCode}`;
        if (emailResult.emailSent) {
          userFeedbackMessage = `Convite gerado e e-mail de ativação enviado com sucesso para ${normalizedEmail}! Código: ${inviteCode}`;
        } else if (emailResult.status === 'missing_config') {
          userFeedbackMessage = `Convite gerado! Código: ${inviteCode}. Aviso: O envio por e-mail está desativado (segredo RESEND_API_KEY não configurado no Supabase). Copie o código acima para fornecer ao responsável.`;
        } else if (emailResult.error) {
          userFeedbackMessage = `Convite gerado (Código: ${inviteCode}), mas o envio do e-mail falhou (${emailResult.error}). Copie o código para fornecer ao responsável.`;
        }

        return {
          success: true,
          message: userFeedbackMessage,
          status: 'invited',
          portalAccessStatus: 'invited',
          inviteCode,
          email: normalizedEmail,
          emailSent: emailResult.emailSent,
          emailStatus: emailResult.status,
          emailError: emailResult.error,
        };
      }

      if (normalizedAction === 'resend_email') {
        const activeInvite = allInvites.find(
          (inv) =>
            inv.tenantId === params.tenantId &&
            inv.targetGuardianPersonId === person.id &&
            inv.status === 'invited'
        );

        if (!activeInvite) {
          throw new Error('Nenhum convite pendente ativo encontrado para reenviar o e-mail do responsável.');
        }

        const targetEmail = (params.email || activeInvite.email || person.email || '').trim().toLowerCase();
        if (!targetEmail || !targetEmail.includes('@')) {
          throw new Error('Endereço de e-mail inválido para reenvio.');
        }

        if (activeInvite.lastEmailSentAt && activeInvite.lastEmailStatus === 'sent') {
          const elapsedMs = Date.now() - new Date(activeInvite.lastEmailSentAt).getTime();
          if (elapsedMs < 60_000) {
            const waitSec = Math.ceil((60_000 - elapsedMs) / 1000);
            return {
              success: false,
              message: `Um e-mail de ativação já foi enviado recentemente para ${activeInvite.email}. Aguarde ${waitSec} segundos para tentar novamente.`,
              status: 'invited',
              portalAccessStatus: 'invited',
              inviteCode: activeInvite.inviteCode,
              email: activeInvite.email,
              emailSent: false,
              emailStatus: activeInvite.lastEmailStatus,
              emailError: activeInvite.lastEmailError,
            };
          }
        }

        const tenant = DataStore.getTenants().find((t) => t.id === params.tenantId);
        const academyName = tenant?.tradeName || tenant?.legalName || 'Tatame Club';

        const emailResult = await this.sendPortalInvitationEmail({
          tenantId: params.tenantId,
          invitationId: activeInvite.id,
          inviteCode: activeInvite.inviteCode || '',
          recipientEmail: targetEmail,
          recipientName: activeInvite.fullName || person.fullName,
          targetType: 'guardian',
          targetId: person.id,
          academyName,
        });

        activeInvite.email = targetEmail;
        if (emailResult.emailSent) {
          activeInvite.lastEmailSentAt = new Date().toISOString();
        }
        activeInvite.lastEmailStatus = emailResult.status;
        activeInvite.lastEmailError = emailResult.error;

        DataStore.saveTenantInvitations(allInvites);

        DataStore.logAudit(
          params.tenantId,
          resolvedActor.id,
          resolvedActor.name,
          'Reenvio de E-mail de Convite Responsável',
          'Person',
          person.id,
          `Reenvio de e-mail de convite para ${targetEmail} com código ${activeInvite.inviteCode}. Status: ${emailResult.status}.`
        );

        let userFeedbackMessage = `Tentativa de envio de e-mail concluída. Código mantido: ${activeInvite.inviteCode}`;
        if (emailResult.emailSent) {
          userFeedbackMessage = `E-mail de ativação reenviado com sucesso para ${targetEmail}! Código mantido: ${activeInvite.inviteCode}`;
        } else if (emailResult.status === 'missing_config') {
          userFeedbackMessage = `O envio por e-mail está desativado (segredo RESEND_API_KEY não configurado no Supabase). O código ${activeInvite.inviteCode} continua ativo para fornecer ao responsável.`;
        } else if (emailResult.error) {
          userFeedbackMessage = `Falha ao reenviar o e-mail (${emailResult.error}). O código ativo permanece válido: ${activeInvite.inviteCode}. Copie-o abaixo para fornecer ao responsável.`;
        }

        return {
          success: emailResult.emailSent,
          message: userFeedbackMessage,
          status: 'invited',
          portalAccessStatus: 'invited',
          inviteCode: activeInvite.inviteCode,
          email: targetEmail,
          emailSent: emailResult.emailSent,
          emailStatus: emailResult.status,
          emailError: emailResult.error,
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

    const rawCode = (params.inviteCode || '').trim().toUpperCase();
    const cleanCode = rawCode.replace(/[\s\-]/g, '');
    const cleanedInputCpf = cleanCPF(params.cpf || '');
    const normalizedAuthEmail = authUser.email.trim().toLowerCase();

    if (!cleanCode) {
      throw new Error('Informe o código de convite fornecido pela sua academia.');
    }

    // 1. Se o Supabase estiver configurado, validar no servidor via RPC
    if (isSupabaseConfigured()) {
      if (!supabase) {
        throw new Error('O serviço de ativação do portal não está disponível no momento.');
      }
      const targetUserId = isValidUUID(authUser.id) ? authUser.id : null;

      // Tenta chamar com 3 parâmetros (incluindo p_user_id para casos de signUp recente)
      let rpcRes = await supabase.rpc('claim_portal_invitation', {
        p_invite_code: rawCode,
        p_cpf: cleanedInputCpf || null,
        p_user_id: targetUserId,
      });

      // Se der erro 42883 (função com 3 parâmetros não encontrada), tenta a assinatura legada de 2 parâmetros
      if (rpcRes.error && rpcRes.error.code === '42883') {
        rpcRes = await supabase.rpc('claim_portal_invitation', {
          p_invite_code: rawCode,
          p_cpf: cleanedInputCpf || null,
        });
      }

      // Se falhou por código não encontrado e o código original tinha hífens, tenta a versão sem hífens
      if (
        (rpcRes.error || !rpcRes.data?.success) &&
        rawCode !== cleanCode &&
        rpcRes.error?.code !== '42501'
      ) {
        const retryRes = await supabase.rpc('claim_portal_invitation', {
          p_invite_code: cleanCode,
          p_cpf: cleanedInputCpf || null,
          p_user_id: targetUserId,
        });
        if (!retryRes.error || (retryRes.data as any)?.success) {
          rpcRes = retryRes;
        }
      }

      const { data, error } = rpcRes;

      if (error) {
        const rpcMissing = error.code === '42883' || error.code === 'PGRST202';
        throw new Error(
          rpcMissing
            ? 'O serviço de ativação do portal não está instalado no banco da academia. Aplique as migrations 37 e 38 antes de vincular a conta.'
            : error.message || 'Não foi possível validar o convite de acesso.'
        );
      } else if (data?.success) {
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

        // Sincronizar cache local com o resultado confirmado do servidor
        const allUsers = DataStore.getAllUsers();
        const updatedUsers = [linkedUser, ...allUsers.filter((u) => u.id !== linkedUser.id)];
        DataStore.saveUsers(updatedUsers);

        if (data.role === 'student' && data.student_id) {
          const allStudents = DataStore.getStudents();
          const sIdx = allStudents.findIndex((s) => s.id === data.student_id);
          if (sIdx >= 0) {
            allStudents[sIdx] = {
              ...allStudents[sIdx],
              userId: linkedUser.id,
              portalAccessStatus: 'active',
            };
            DataStore.saveStudents(allStudents);

            const allPersons = DataStore.getPersons();
            const pIdx = allPersons.findIndex((p) => p.id === allStudents[sIdx].personId);
            if (pIdx >= 0) {
              allPersons[pIdx] = {
                ...allPersons[pIdx],
                userId: linkedUser.id,
                portalAccessStatus: 'active',
              };
              DataStore.savePersons(allPersons);
            }
          }
        }

        const allInvites = DataStore.getTenantInvitations();
        const invIdx = allInvites.findIndex(
          (i) => (i.inviteCode || '').replace(/[\s\-]/g, '').toUpperCase() === cleanCode
        );
        if (invIdx >= 0) {
          allInvites[invIdx] = {
            ...allInvites[invIdx],
            status: 'accepted',
            acceptedAt: new Date().toISOString(),
          };
          DataStore.saveTenantInvitations(allInvites);
        }

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
      throw new Error('O banco não confirmou a ativação do convite. Nenhum vínculo local foi criado.');
    }

    // 2. Validação transacional local (DataStore) somente quando o Supabase não está configurado
    const allInvites = DataStore.getTenantInvitations();
    const inviteIdx = allInvites.findIndex(
      (inv) =>
        (inv.inviteCode || '').replace(/[\s\-]/g, '').toUpperCase() === cleanCode
    );

    if (inviteIdx === -1) {
      throw new Error(
        'Código de convite não encontrado no sistema. Verifique a digitação ou solicite um novo envio à academia.'
      );
    }

    const invite = allInvites[inviteIdx];

    if (invite.status === 'accepted') {
      throw new Error('Este código de convite já foi utilizado e ativado anteriormente.');
    }

    if (invite.status === 'revoked') {
      throw new Error('Este convite foi revogado pela administração da academia. Solicite um novo código à secretaria.');
    }

    if (invite.status === 'expired' || new Date(invite.expiresAt).getTime() < Date.now()) {
      allInvites[inviteIdx] = { ...invite, status: 'expired' };
      DataStore.saveTenantInvitations(allInvites);
      throw new Error('Este convite expirou. Solicite um novo código à secretaria da sua academia.');
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

    const studentIdFromSecondary = user.secondaryRoles
      ?.map((r) => (typeof r === 'object' && r.role === 'student' ? r.studentId : undefined))
      .find(Boolean);
    const effectiveStudentId = user.studentId || studentIdFromSecondary;

    const guardianPersonIdFromSecondary = user.secondaryRoles
      ?.map((r) => (typeof r === 'object' && r.role === 'guardian' ? r.guardianPersonId : undefined))
      .find(Boolean);
    const effectiveGuardianPersonId = user.guardianPersonId || guardianPersonIdFromSecondary;

    // 1. Verificar vínculo de Aluno (priorizando studentId explícito, ou userId no mesmo tenant)
    const candidateStudent =
      (effectiveStudentId
        ? students.find((s) => s.tenantId === tenantId && s.id === effectiveStudentId)
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
          persons.find((p) => p.userId === user.id && p.tenantId === tenantId) ||
          null;
      }
    }

    // 2. Verificar vínculo de Responsável (priorizando guardianPersonId explícito, ou pessoa com userId que possua vínculo em guardians)
    let candidateGuardianPerson =
      (effectiveGuardianPersonId
        ? persons.find((p) => p.tenantId === tenantId && p.id === effectiveGuardianPersonId)
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
      if (
        item.accessScope === 'restricted_belt' ||
        (!item.allBelts && item.targetBeltIds && item.targetBeltIds.length > 0)
      ) {
        if (item.martialArtId) {
          const stuBeltId = studentGradMap.get(item.martialArtId);
          if (!stuBeltId) return false;
          if (!item.targetBeltIds || item.targetBeltIds.length === 0) return true;
          return item.targetBeltIds.includes(stuBeltId);
        }
        if (item.targetBeltIds && item.targetBeltIds.length > 0) {
          return Array.from(studentGradMap.values()).some((bId) => item.targetBeltIds!.includes(bId));
        }
        return false;
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
