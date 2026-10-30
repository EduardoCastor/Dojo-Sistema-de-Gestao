import React, { useState, useEffect } from 'react';
import {
  X,
  Lock,
  Mail,
  CheckCircle2,
  AlertCircle,
  Cloud,
  ArrowRight,
  Building2,
  KeyRound,
  UserCheck,
  UserPlus,
  FileText,
  Loader2,
} from 'lucide-react';
import { User as UserType } from '../../types';
import { authService, isSupabaseConfigured, UserMembership } from '../../services/supabase';
import { portalAccessService, PortalInvitationVerification } from '../../services/portalAccessService';
import { DataStore } from '../../data/storage';
import { formatCPF } from '../../utils/cpfValidator';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: UserType[];
  onSelectUser: (user: UserType) => void;
  onAuthSuccess?: (user: any, memberships: UserMembership[]) => void;
  onOpenRegister?: () => void;
  onOpenTerms?: () => void;
  onOpenPrivacy?: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  onSelectUser,
  onAuthSuccess,
  onOpenRegister,
  onOpenTerms,
  onOpenPrivacy,
}) => {
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'claim_invite' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [cpf, setCpf] = useState('');
  const [acceptedLegal, setAcceptedLegal] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [inviteVerification, setInviteVerification] = useState<PortalInvitationVerification | null>(null);
  const [isVerifyingInvite, setIsVerifyingInvite] = useState(false);

  const supabaseActive = isSupabaseConfigured();

  const handleVerifyInviteCode = async (code: string) => {
    const clean = (code || '').replace(/\s+/g, '').toUpperCase();
    if (!clean || clean.length < 3) {
      setInviteVerification(null);
      return;
    }
    setIsVerifyingInvite(true);
    try {
      const res = await portalAccessService.verifyPortalInvitation(clean);
      setInviteVerification(res);
      if (res.valid) {
        if (res.email && !email) setEmail(res.email);
        if (res.fullName && !fullName) setFullName(res.fullName);
      }
    } catch (err: any) {
      setInviteVerification({
        valid: false,
        reason: 'not_found',
        message: err?.message || 'Código de convite não encontrado.',
      });
    } finally {
      setIsVerifyingInvite(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const inviteFromUrl = urlParams.get('invite');
      if (inviteFromUrl) {
        const clean = inviteFromUrl.trim().toUpperCase();
        setInviteCode(clean);
        setAuthMode('claim_invite');
        handleVerifyInviteCode(clean);
      }
    } catch (e) {
      // ignore
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setError(null);
    setSuccessMessage(null);
    setLoading(true);
    try {
      const { error: oauthErr } = await authService.signInWithGoogle();
      if (oauthErr) {
        throw oauthErr;
      }
    } catch (err: any) {
      setError(
        err?.message ||
          'Não foi possível iniciar o login com o Google. Verifique a configuração do provedor Google no Supabase Auth.'
      );
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();

      if (authMode === 'forgot') {
        if (supabaseActive) {
          const { error: err } = await authService.resetPasswordForEmail(normalizedEmail);
          if (err) throw err;
        }
        setSuccessMessage('Instruções de redefinição de senha foram enviadas para o seu e-mail cadastrado.');
        setLoading(false);
        return;
      }

      if (authMode === 'signup') {
        if (!fullName.trim()) {
          setError('Informe seu nome completo para criar a conta.');
          setLoading(false);
          return;
        }
        if (!acceptedLegal) {
          setError('Você deve ler e concordar com os Termos de Uso e a Política de Privacidade (LGPD).');
          setLoading(false);
          return;
        }

        if (supabaseActive) {
          const { data, error: signUpErr } = await authService.signUp(
            normalizedEmail,
            password,
            fullName.trim(),
            'student'
          );
          if (signUpErr) throw signUpErr;

          if (data.user) {
            await authService.recordLegalAcceptance({
              userId: data.user.id,
              context: 'account_signup',
            });
            setSuccessMessage(
              'Conta criada com sucesso! Caso você seja Aluno ou Responsável, utilize a aba "Ativar Convite" com o código fornecido pela sua academia.'
            );
            setAuthMode('claim_invite');
          }
          setLoading(false);
          return;
        } else {
          setSuccessMessage(
            'Para vincular uma conta de Aluno ou Responsável, utilize a aba "Ativar Convite" com o código gerado pela sua academia.'
          );
          setAuthMode('claim_invite');
          setLoading(false);
          return;
        }
      }

      if (authMode === 'claim_invite') {
        if (!acceptedLegal) {
          setError(
            'Para ativar seu acesso de Aluno ou Responsável, é necessário aceitar os Termos de Uso e a Política de Privacidade (LGPD).'
          );
          setLoading(false);
          return;
        }
        if (!inviteCode.trim() || !cpf.trim()) {
          setError('Informe o Código de Convite da academia e o CPF do titular cadastrado.');
          setLoading(false);
          return;
        }

        let authenticatedUserId = '';
        let authenticatedUserEmail = normalizedEmail;
        let authenticatedUserName = fullName.trim();

        if (supabaseActive) {
          // Autentica ou cria a conta no Supabase antes de vincular o convite
          const { data: signInData, error: signInErr } = await authService.signInWithEmail(
            normalizedEmail,
            password
          );
          if (signInErr) {
            // Tenta criar a conta caso ainda não exista
            const { data: signUpData, error: signUpErr } = await authService.signUp(
              normalizedEmail,
              password,
              fullName.trim() || normalizedEmail.split('@')[0],
              'student'
            );
            if (signUpErr || !signUpData.user) {
              const errDetail =
                signUpErr?.message ||
                signInErr?.message ||
                'Não foi possível criar as credenciais de acesso. Verifique os dados digitados.';
              throw new Error(errDetail);
            }
            authenticatedUserId = signUpData.user.id;
            authenticatedUserEmail = signUpData.user.email || normalizedEmail;
            authenticatedUserName =
              signUpData.user.user_metadata?.full_name || fullName.trim() || normalizedEmail;
          } else if (signInData.user) {
            authenticatedUserId = signInData.user.id;
            authenticatedUserEmail = signInData.user.email || normalizedEmail;
            authenticatedUserName =
              signInData.user.user_metadata?.full_name || fullName.trim() || normalizedEmail;
          }
        } else {
          const existing = DataStore.getUsers().find(
            (u) => u.email.trim().toLowerCase() === normalizedEmail
          );
          authenticatedUserId = existing?.id || `u-portal-${Date.now()}`;
          authenticatedUserName = existing?.name || fullName.trim() || normalizedEmail.split('@')[0];
        }

        const claimRes = await portalAccessService.claimPortalInvitation({
          inviteCode: inviteCode.trim(),
          cpf: cpf.trim(),
          userId: authenticatedUserId,
          userEmail: authenticatedUserEmail,
          userName: authenticatedUserName,
          acceptedTerms: true,
        });

        if (!claimRes.success) {
          setError(claimRes.message);
          setLoading(false);
          return;
        }

        if (supabaseActive) {
          let memberships = await authService.loadUserMemberships(authenticatedUserId);
          if (memberships.length === 0 && claimRes.tenantId) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            memberships = await authService.loadUserMemberships(authenticatedUserId);
          }
          if (memberships.length === 0 && claimRes.tenantId) {
            const tenantSettings = await authService.fetchTenantSettings(claimRes.tenantId);
            const fallbackMembership: UserMembership = {
              id: `mem-${Date.now()}`,
              tenant_id: claimRes.tenantId,
              role: claimRes.role,
              status: 'active',
              student_id: claimRes.studentId || null,
              guardian_person_id: claimRes.guardianPersonId || null,
              tenant: tenantSettings
                ? {
                    id: tenantSettings.id,
                    trade_name: tenantSettings.tradeName,
                    legal_name: tenantSettings.legalName,
                    cnpj_or_cpf: tenantSettings.cnpjOrCpf,
                    plan_id: tenantSettings.planId,
                    status: tenantSettings.status,
                    settings: tenantSettings.settings,
                  }
                : null,
            };
            memberships = [fallbackMembership];
          }

          if (onAuthSuccess) {
            onAuthSuccess(
              {
                id: authenticatedUserId,
                email: authenticatedUserEmail,
                user_metadata: { full_name: authenticatedUserName },
              },
              memberships
            );
          }
          onClose();
        } else if (claimRes.user) {
          onSelectUser(claimRes.user);
          onClose();
        }
        return;
      }

      // Modo Login padrão
      if (supabaseActive) {
        const { data, error: err } = await authService.signInWithEmail(normalizedEmail, password);
        if (err) throw err;

        if (data.user) {
          const memberships = await authService.loadUserMemberships(data.user.id);
          if (onAuthSuccess) {
            onAuthSuccess(data.user, memberships);
          }
          onClose();
        }
      } else {
        const allUsers = DataStore.getUsers();
        const matchedUsers = allUsers.filter(
          (u) => u.email.trim().toLowerCase() === normalizedEmail && u.role !== 'superadmin'
        );

        if (matchedUsers.length === 0) {
          setError(
            'Nenhuma conta vinculada encontrada para este e-mail. Se você recebeu um convite da sua academia (Aluno ou Responsável), acesse a aba "Ativar Convite".'
          );
          setLoading(false);
          return;
        }

        const activeMatched = matchedUsers.filter((u) => u.active !== false);
        if (activeMatched.length === 0) {
          setError(
            'Seu acesso à academia encontra-se bloqueado ou revogado pela administração do seu dojo.'
          );
          setLoading(false);
          return;
        }

        const primaryUser = activeMatched[0];
        // Se o mesmo usuário possuir múltiplos papéis (ex: Responsável e Aluno na mesma academia), preserva secondaryRoles
        const extraRoles = activeMatched
          .slice(1)
          .map((u) => ({
            role: u.role,
            studentId: u.studentId,
            guardianPersonId: u.guardianPersonId,
          }));

        onSelectUser({
          ...primaryUser,
          secondaryRoles: extraRoles.length > 0 ? extraRoles : primaryUser.secondaryRoles,
        });
        onClose();
      }
    } catch (err: any) {
      let msg = err.message || 'Falha na autenticação.';
      if (msg.includes('Invalid login credentials')) {
        msg = 'E-mail ou senha incorretos.';
      } else if (msg.includes('Email not confirmed')) {
        msg = 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200 my-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-white">Acessar Conta · Tatame Club</h3>
            {supabaseActive && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded">
                <Cloud className="h-3 w-3" />
                <span>Auth Seguro</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Acesso para Gestores, Professores, Alunos e Responsáveis vinculados a uma academia.
          </p>
        </div>

        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-950/50 border border-red-500/50 text-xs text-red-200 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-500/50 text-xs text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Abas de Autenticação */}
          <div className="grid grid-cols-3 gap-1.5 text-[11px] font-medium bg-slate-950/70 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setError(null);
                setSuccessMessage(null);
              }}
              className={`py-1.5 px-2 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1 ${
                authMode === 'login' ? 'bg-slate-800 text-white font-semibold shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              <UserCheck className="h-3.5 w-3.5" />
              <span>Entrar</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('claim_invite');
                setError(null);
                setSuccessMessage(null);
              }}
              className={`py-1.5 px-2 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1 ${
                authMode === 'claim_invite'
                  ? 'bg-red-600/20 text-red-300 border border-red-500/30 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Ativar Convite</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('signup');
                setError(null);
                setSuccessMessage(null);
              }}
              className={`py-1.5 px-2 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1 ${
                authMode === 'signup' ? 'bg-slate-800 text-white font-semibold shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Criar Conta</span>
            </button>
          </div>

          {/* Botão Google OAuth */}
          {authMode !== 'forgot' && (
            <div>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2.5 rounded-lg border border-slate-700 bg-slate-800/90 hover:bg-slate-800 py-2.5 px-4 text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path
                    fill="#EA4335"
                    d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.8C6.2 7.2 8.9 5 12 5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6l3.7 2.9c2.2-2 3.7-5 3.7-8.7z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.3 14.8c-.2-.8-.4-1.6-.4-2.5s.2-1.7.4-2.5L1.6 7C.6 9 0 11.2 0 13.5s.6 4.5 1.6 6.5l3.7-2.9z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.1-6.7-5L1.6 17c1.9 3.9 5.8 7 10.4 7z"
                  />
                </svg>
                <span>Continuar com Google</span>
              </button>
              <div className="relative my-3 flex items-center justify-center">
                <div className="border-t border-slate-800 w-full" />
                <span className="bg-slate-900 px-2 text-[10px] text-slate-500 uppercase tracking-wider">
                  ou via e-mail
                </span>
                <div className="border-t border-slate-800 w-full" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3 text-xs">
            {(authMode === 'signup' || authMode === 'claim_invite') && (
              <div>
                <label className="block text-slate-300 font-medium mb-1">Nome Completo</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Seu nome completo"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            )}

            {authMode === 'claim_invite' && (
              <div className="p-3 rounded-xl border border-red-500/30 bg-red-950/20 space-y-2.5">
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  <strong>Vínculo Seguro (Aluno ou Responsável):</strong> Informe o código de convite emitido pela secretaria do seu dojo e o CPF cadastrado na matrícula.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Código do Convite *</label>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        value={inviteCode}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          setInviteCode(val);
                          handleVerifyInviteCode(val);
                        }}
                        onBlur={() => handleVerifyInviteCode(inviteCode)}
                        placeholder="Ex: AL-12AB34CD ou RP-12AB34CD"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-amber-300 font-mono uppercase tracking-wider placeholder-slate-600 focus:border-red-500 focus:outline-none pr-8"
                      />
                      {isVerifyingInvite && (
                        <div className="absolute right-2.5 top-2.5">
                          <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">CPF do Titular *</label>
                    <input
                      type="text"
                      required
                      value={cpf}
                      onChange={(e) => setCpf(formatCPF(e.target.value))}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white font-mono placeholder-slate-600 focus:border-red-500 focus:outline-none"
                    />
                  </div>
                </div>

                {inviteVerification && (
                  <div
                    className={`mt-2 p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                      inviteVerification.valid
                        ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                        : 'bg-red-950/60 border-red-500/40 text-red-200'
                    }`}
                  >
                    {inviteVerification.valid ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      {inviteVerification.valid ? (
                        <>
                          <div className="font-semibold text-white">
                            Convite Localizado — {inviteVerification.academyName}
                          </div>
                          <div className="text-[11px] text-emerald-300/90 mt-0.5">
                            Titular: <strong className="text-white">{inviteVerification.fullName}</strong> ({inviteVerification.role === 'student' ? 'Aluno' : 'Responsável'})
                            {inviteVerification.maskedCpf && (
                              <span className="block text-[10px] text-slate-300 mt-0.5">
                                CPF cadastrado na secretaria: {inviteVerification.maskedCpf}
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="font-medium">{inviteVerification.message}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-slate-300 font-medium mb-1">E-mail de Acesso *</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu.email@exemplo.com.br"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            {authMode !== 'forgot' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-medium">Senha *</label>
                  {authMode === 'login' && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('forgot');
                        setError(null);
                        setSuccessMessage(null);
                      }}
                      className="text-[11px] text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                    >
                      Esqueceu a senha?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo de 6 caracteres"
                    minLength={6}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {(authMode === 'signup' || authMode === 'claim_invite') && (
              <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/60">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedLegal}
                    onChange={(e) => setAcceptedLegal(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 text-red-600 focus:ring-red-500"
                  />
                  <span className="text-[11px] text-slate-300 leading-relaxed">
                    Concordo com os{' '}
                    <button
                      type="button"
                      onClick={onOpenTerms}
                      className="text-red-400 hover:text-red-300 underline"
                    >
                      Termos de Uso
                    </button>{' '}
                    e a{' '}
                    <button
                      type="button"
                      onClick={onOpenPrivacy}
                      className="text-red-400 hover:text-red-300 underline"
                    >
                      Política de Privacidade (LGPD)
                    </button>
                    .
                  </span>
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-xs font-semibold text-white hover:bg-red-500 active:bg-red-700 transition-colors shadow cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <span>Processando...</span>
              ) : authMode === 'login' ? (
                <>
                  <span>Entrar no Ambiente da Academia</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              ) : authMode === 'claim_invite' ? (
                <>
                  <KeyRound className="h-4 w-4" />
                  <span>Validar Convite e Vincular Acesso</span>
                </>
              ) : authMode === 'signup' ? (
                <>
                  <UserPlus className="h-4 w-4" />
                  <span>Criar Minha Conta</span>
                </>
              ) : (
                <span>Enviar Link de Recuperação</span>
              )}
            </button>
          </form>

          {/* Links permanentes para Termos de Uso e Política de Privacidade */}
          <div className="pt-2 flex items-center justify-center gap-3 text-[11px] text-slate-400">
            <button
              type="button"
              onClick={onOpenTerms}
              className="inline-flex items-center gap-1 hover:text-white transition-colors cursor-pointer"
            >
              <FileText className="h-3 w-3 text-red-400" />
              <span>Termos de Uso</span>
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={onOpenPrivacy}
              className="inline-flex items-center gap-1 hover:text-white transition-colors cursor-pointer"
            >
              <Lock className="h-3 w-3 text-red-400" />
              <span>Política de Privacidade (LGPD)</span>
            </button>
          </div>

          {onOpenRegister && (
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">É gestor e quer cadastrar seu dojo?</span>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenRegister();
                }}
                className="inline-flex items-center gap-1.5 text-red-400 hover:text-red-300 font-semibold cursor-pointer"
              >
                <Building2 className="h-3.5 w-3.5" />
                <span>Criar Academia (10 Dias Grátis)</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
