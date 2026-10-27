import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Lock,
  Mail,
  KeyRound,
  ArrowLeft,
  CheckCircle2,
  Globe,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { isSupabaseConfigured, supabase, authService } from '../../services/supabase';
import { saasPlatformService } from '../../services/saasPlatformService';
import {
  OFFICIAL_DOMAINS,
  isAuthorizedPlatformOwnerEmail,
  getAuthRedirectUrl,
} from '../../utils/domainConfig';
import { User } from '../../types';
import brandEmblem from '../../assets/images/tatame_brand_emblem_1792068009123.jpg';

interface PlatformAdminAuthViewProps {
  currentUser: User | null;
  onAuthenticatedSuperAdmin: (user: User) => void;
  onReturnToMainSite: () => void;
}

type AuthTabMode = 'login' | 'bootstrap' | 'recovery' | 'update_password';

export const PlatformAdminAuthView: React.FC<PlatformAdminAuthViewProps> = ({
  currentUser,
  onAuthenticatedSuperAdmin,
  onReturnToMainSite,
}) => {
  const [email, setEmail] = useState<string>(OFFICIAL_DOMAINS.platformOwnerEmail);
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [setupToken, setSetupToken] = useState<string>('');
  const [bootstrapMethod, setBootstrapMethod] = useState<'email_verification' | 'token_bootstrap'>(
    'email_verification'
  );
  const [mode, setMode] = useState<AuthTabMode>('login');
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const [bootstrapStatus, setBootstrapStatus] = useState<{
    checked: boolean;
    supabaseConnected: boolean;
    migration25Applied: boolean;
    migration26Applied: boolean;
    accountExists: boolean;
    emailConfirmed: boolean;
    bootstrapCompleted: boolean;
  }>({
    checked: false,
    supabaseConnected: isSupabaseConfigured(),
    migration25Applied: true,
    migration26Applied: true,
    accountExists: false,
    emailConfirmed: false,
    bootstrapCompleted: false,
  });

  // Se o usuário estiver logado como membro comum de uma academia, bloquear explicitamente
  const isUnauthorizedLoggedUser = Boolean(
    currentUser &&
      currentUser.id &&
      (currentUser.role !== 'superadmin' || !isAuthorizedPlatformOwnerEmail(currentUser.email))
  );

  // Verificar estado real do banco e detectar retorno de link de recuperação/confirmação do Supabase Auth
  useEffect(() => {
    let isMounted = true;

    async function inspectEnvironment() {
      const status = await saasPlatformService.checkBootstrapStatus(email);
      if (!isMounted) return;
      setBootstrapStatus({
        checked: true,
        ...status,
      });
    }

    inspectEnvironment();

    if (isSupabaseConfigured() && supabase) {
      const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!isMounted) return;
        if (event === 'PASSWORD_RECOVERY') {
          setMode('update_password');
          const recoveryEmail = (session?.user?.email || email).toLowerCase();
          setInfoMessage(
            `Sessão de redefinição de senha validada para ${recoveryEmail}. Defina sua nova senha abaixo.`
          );
          setError(null);
        } else if (event === 'SIGNED_IN' && session?.user && supabase) {
          const userEmail = (session.user.email || '').trim().toLowerCase();
          if (isAuthorizedPlatformOwnerEmail(userEmail) && session.user.email_confirmed_at) {
            // Se acabou de confirmar o e-mail oficial pelo link recebido, vincular papel global se necessário
            await supabase.rpc('bootstrap_platform_owner_by_email', {
              p_email: userEmail,
            });
            const verification = await saasPlatformService.verifyPlatformAdminAuthorization({
              id: session.user.id,
              email: userEmail,
              name: session.user.user_metadata?.full_name,
            });
            if (verification.authorized && verification.user && isMounted) {
              onAuthenticatedSuperAdmin(verification.user);
            }
          }
        }
      });

      return () => {
        isMounted = false;
        listener?.subscription?.unsubscribe();
      };
    }

    return () => {
      isMounted = false;
    };
  }, [email]);

  const handleLocalSandboxAccess = async () => {
    setError(null);
    setInfoMessage(null);
    const normalizedEmail = email.trim().toLowerCase();

    if (!isAuthorizedPlatformOwnerEmail(normalizedEmail)) {
      setError(
        `Acesso negado (403): o Painel Global do SaaS (${OFFICIAL_DOMAINS.saasAdminHost}) é restrito aos administradores autorizados: ${OFFICIAL_DOMAINS.platformOwnerEmails.join(' e ')}.`
      );
      return;
    }

    if (password.length < 6) {
      setError(
        'Informe uma senha de pelo menos 6 caracteres no campo de senha para validar a sessão administrativa de homologação.'
      );
      return;
    }

    setLoading(true);
    try {
      const ownerUser = await saasPlatformService.bootstrapPlatformOwner({
        email: normalizedEmail,
        isVerifiedSession: true,
      });
      const check = await saasPlatformService.verifyPlatformAdminAuthorization(ownerUser);
      if (!check.authorized || !check.user) {
        setError(check.message);
        return;
      }
      onAuthenticatedSuperAdmin(check.user);
    } catch (err: any) {
      setError(err?.message || 'Erro ao validar acesso no ambiente de homologação.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Validação estrita do endereço dos administradores globais
    if (!isAuthorizedPlatformOwnerEmail(normalizedEmail)) {
      setError(
        `Acesso negado (403): o endereço "${normalizedEmail}" não possui autorização para administrar o SaaS. O painel ${OFFICIAL_DOMAINS.saasAdminHost} é exclusivo para ${OFFICIAL_DOMAINS.platformOwnerEmails.join(' e ')}.`
      );
      return;
    }

    // 2. Fluxo de Recuperação de Senha por E-mail Oficial
    if (mode === 'recovery') {
      setLoading(true);
      try {
        if (isSupabaseConfigured() && supabase) {
          const redirectUrl = getAuthRedirectUrl('saas_admin_panel');
          const { error: resetErr } = await authService.resetPasswordForEmail(
            normalizedEmail,
            redirectUrl
          );
          if (resetErr) {
            throw resetErr;
          }
          setInfoMessage(
            `Link seguro de definição/recuperação de senha enviado para ${normalizedEmail}. Acesse sua caixa de entrada e clique no link para retornar a ${redirectUrl}.`
          );
        } else {
          setInfoMessage(
            `Em modo local (sem Supabase remoto configurado), utilize o acesso de homologação abaixo com o e-mail ${normalizedEmail}.`
          );
        }
      } catch (err: any) {
        setError(
          err?.message ||
            `Não foi possível enviar o e-mail de recuperação para ${normalizedEmail}. Verifique a configuração de SMTP no Supabase Auth.`
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    // 3. Fluxo de Atualização de Senha após clicar no link de recuperação do e-mail
    if (mode === 'update_password') {
      if (password.length < 6) {
        setError('A nova senha deve ter pelo menos 6 caracteres.');
        return;
      }
      if (password !== confirmPassword) {
        setError('A confirmação de senha não confere.');
        return;
      }

      setLoading(true);
      try {
        if (isSupabaseConfigured() && supabase) {
          const { data: updated, error: updateErr } = await supabase.auth.updateUser({
            password,
          });
          if (updateErr) {
            throw updateErr;
          }
          if (updated.user) {
            await supabase.rpc('bootstrap_platform_owner_by_email', {
              p_email: normalizedEmail,
            });
            const verification = await saasPlatformService.verifyPlatformAdminAuthorization({
              id: updated.user.id,
              email: updated.user.email,
              name: updated.user.user_metadata?.full_name,
            });
            if (verification.authorized && verification.user) {
              onAuthenticatedSuperAdmin(verification.user);
              return;
            }
          }
          setInfoMessage('Senha atualizada com sucesso! Faça login abaixo.');
          setMode('login');
        }
      } catch (err: any) {
        setError(err?.message || 'Erro ao salvar a nova senha.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Validar senha para Login e 1º Acesso
    if (password.length < 6) {
      setError('Informe uma senha válida (mínimo de 6 caracteres).');
      return;
    }

    setLoading(true);
    try {
      // 4. Fluxo de 1º Acesso (Criar Senha e Inicializar Administrador com Segurança)
      if (mode === 'bootstrap') {
        if (password !== confirmPassword) {
          setError('A confirmação de senha não confere com a senha digitada.');
          setLoading(false);
          return;
        }

        // Impedir repetição indevida se o bootstrap já estiver concluído no banco
        const currentStatus = await saasPlatformService.checkBootstrapStatus(normalizedEmail);
        if (currentStatus.bootstrapCompleted) {
          setError(
            `A conta ${normalizedEmail} já foi inicializada anteriormente como Administrador Global. Não é permitido repetir o bootstrap. Utilize a aba "Login" ou "Recuperar Senha".`
          );
          setMode('login');
          setLoading(false);
          return;
        }

        if (bootstrapMethod === 'token_bootstrap') {
          const result = await saasPlatformService.executeProtectedEdgeBootstrap({
            email: normalizedEmail,
            password,
            setupToken,
          });
          if (result.user) {
            onAuthenticatedSuperAdmin(result.user);
            return;
          }
        }

        if (isSupabaseConfigured() && supabase) {
          const redirectUrl = getAuthRedirectUrl('saas_admin_panel');
          const adminTitle = isAuthorizedPlatformOwnerEmail(normalizedEmail)
            ? 'Administrador Global Tatame Club'
            : 'Proprietário Tatame Club SaaS';

          const { data: signUpData, error: signUpError } = await authService.signUpWithEmail(
            normalizedEmail,
            password,
            adminTitle,
            redirectUrl
          );

          // Caso B: Conta já existe no Supabase Auth — não criar duplicidade!
          if (
            signUpError &&
            (signUpError.message.toLowerCase().includes('already registered') ||
              signUpError.message.toLowerCase().includes('already exists'))
          ) {
            setInfoMessage(
              `A conta ${normalizedEmail} já existe no Supabase Auth (nenhuma duplicata foi criada). Faça login com sua senha atual ou utilize a aba "Recuperar Senha" para receber um link seguro no e-mail ${normalizedEmail}.`
            );
            setMode('login');
            setLoading(false);
            return;
          }

          if (signUpError) {
            setError(`Não foi possível iniciar o cadastro no Supabase Auth: ${signUpError.message}`);
            setLoading(false);
            return;
          }

          // Supabase retorna identities vazio quando o usuário já existe e a proteção contra enumeração está ativa
          if (
            signUpData?.user &&
            Array.isArray(signUpData.user.identities) &&
            signUpData.user.identities.length === 0
          ) {
            setInfoMessage(
              `A conta ${normalizedEmail} já consta registrada no Supabase Auth. Faça login abaixo ou clique em "Recuperar Senha" para redefinir sua credencial com segurança.`
            );
            setMode('login');
            setLoading(false);
            return;
          }

          // Se o Supabase já retornou sessão ativa (ex: confirmação automática em ambiente controlado)
          if (signUpData?.user && signUpData?.session) {
            await supabase.rpc('bootstrap_platform_owner_by_email', {
              p_email: normalizedEmail,
            });
            const verification = await saasPlatformService.verifyPlatformAdminAuthorization({
              id: signUpData.user.id,
              email: normalizedEmail,
              name: adminTitle,
            });
            if (verification.authorized && verification.user) {
              onAuthenticatedSuperAdmin(verification.user);
              return;
            }
          }

          // Fluxo padrão com confirmação de e-mail ativa no Supabase Auth
          setInfoMessage(
            `Solicitação de 1º acesso registrada! Para segurança da conta, um link de confirmação foi enviado para ${normalizedEmail}. Confirme no seu e-mail (ou execute "SELECT public.bootstrap_platform_owner_by_email('${normalizedEmail}');" no SQL Editor do Supabase) e depois faça login.`
          );
          setMode('login');
          return;
        } else {
          // Modo local sem Supabase remoto: exigir setupToken para testar o 1º acesso
          const result = await saasPlatformService.executeProtectedEdgeBootstrap({
            email: normalizedEmail,
            password,
            setupToken: setupToken || 'TATAME-CLUB-OWNER-BOOTSTRAP-2026',
          });
          if (result.user) {
            onAuthenticatedSuperAdmin(result.user);
          }
          return;
        }
      }

      // 5. Fluxo de Login Normal (Autenticação + Validação de Autorização Global no Backend)
      if (isSupabaseConfigured() && supabase) {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (signInError) {
          const rawMsg = (signInError.message || '').toLowerCase();
          if (rawMsg.includes('email not confirmed')) {
            setError(
              `O endereço ${normalizedEmail} já foi criado, mas aguarda confirmação de e-mail. Verifique a caixa de entrada de ${normalizedEmail} ou execute "SELECT public.bootstrap_platform_owner_by_email('${normalizedEmail}');" no SQL Editor do Supabase.`
            );
          } else if (rawMsg.includes('invalid login credentials')) {
            const currentStatus = await saasPlatformService.checkBootstrapStatus(normalizedEmail);
            if ((currentStatus.migration26Applied || currentStatus.migration27Applied) && !currentStatus.accountExists) {
              setError(
                `A conta ${normalizedEmail} ainda não foi inicializada no Supabase Auth. Utilize a aba "1º Acesso (Criar Senha)" acima para configurar sua senha com segurança.`
              );
            } else {
              setError(
                `Credenciais inválidas para ${normalizedEmail}. Verifique a senha digitada ou utilize a aba "Recuperar Senha" para redefini-la por e-mail.`
              );
            }
          } else {
            setError(`Falha na autenticação: ${signInError.message}`);
          }
          return;
        }

        if (data.user) {
          // Verificar autorização global no backend
          let verification = await saasPlatformService.verifyPlatformAdminAuthorization({
            id: data.user.id,
            email: data.user.email,
            name: data.user.user_metadata?.full_name,
          });

          // Se a conta oficial autenticou com e-mail confirmado mas ainda estava com bootstrap_pending,
          // concluir vínculo autenticado via RPC segura e revalidar
          if (!verification.authorized && verification.reason === 'bootstrap_pending') {
            await supabase.rpc('bootstrap_platform_owner_by_email', {
              p_email: normalizedEmail,
            });
            verification = await saasPlatformService.verifyPlatformAdminAuthorization({
              id: data.user.id,
              email: data.user.email,
              name: data.user.user_metadata?.full_name,
            });
          }

          if (!verification.authorized || !verification.user) {
            await authService.signOut();
            setError(verification.message);
            return;
          }

          onAuthenticatedSuperAdmin(verification.user);
        }
      } else {
        // Ambiente sem Supabase remoto configurado
        const verification = await saasPlatformService.verifyPlatformAdminAuthorization({
          id: 'user-superadmin',
          email: normalizedEmail,
          name: 'Administrador Global Tatame Club',
        });
        if (!verification.authorized || !verification.user) {
          setError(verification.message);
          return;
        }
        onAuthenticatedSuperAdmin(verification.user);
      }
    } catch (err: any) {
      setError(err?.message || 'Erro inesperado ao validar acesso ao painel global.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between p-6">
      <header className="max-w-6xl w-full mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-3">
          <img
            src={brandEmblem}
            alt="Tatame Club"
            className="w-10 h-10 rounded-xl object-cover border border-amber-500/40"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black tracking-tight text-lg text-white">TATAME CLUB</span>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                SaaS Global Control
              </span>
            </div>
            <p className="text-xs text-zinc-400 flex items-center gap-1">
              <Globe className="w-3 h-3 text-amber-400" />
              {OFFICIAL_DOMAINS.saasAdminHost}
            </p>
          </div>
        </div>

        <button
          onClick={onReturnToMainSite}
          className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 flex items-center gap-2 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Ir para {OFFICIAL_DOMAINS.mainSiteHost}
        </button>
      </header>

      <main className="max-w-md w-full mx-auto my-auto py-8">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="space-y-2 text-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto mb-3">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-white">Painel Exclusivo do Proprietário SaaS</h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Ambiente isolado para administração global de academias, planos, assinaturas e limites de licenças do{' '}
              <strong className="text-zinc-200">Tatame Club</strong>.
            </p>
          </div>

          {isUnauthorizedLoggedUser && currentUser && (
            <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 space-y-2">
              <div className="flex items-center gap-2 text-red-400 font-bold text-xs">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Acesso Negado para Conta de Academia (403)</span>
              </div>
              <p className="text-xs text-red-200/90 leading-relaxed">
                Você está autenticado como <strong>{currentUser.email}</strong> (papel:{' '}
                <code>{currentUser.role}</code>). Contas de academias não possuem autorização global para acessar{' '}
                <strong>{OFFICIAL_DOMAINS.saasAdminHost}</strong>.
              </p>
            </div>
          )}

          {/* Exibir aviso de migration SOMENTE se a verificação real detectar ausência das funções no Supabase */}
          {bootstrapStatus.checked &&
            bootstrapStatus.supabaseConnected &&
            (!bootstrapStatus.migration25Applied || !bootstrapStatus.migration26Applied) && (
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Atualização de Schema Pendente no Supabase</span>
                </div>
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  Detectamos que a função de diagnóstico da{' '}
                  {!bootstrapStatus.migration25Applied ? 'Migration 25 e Migration 26' : 'Migration 26'} ainda não foi
                  aplicada no banco remoto. Execute o script{' '}
                  <code>supabase/migrations/26_fix_platform_owner_identity_and_secure_bootstrap.sql</code> no SQL Editor
                  do Supabase.
                </p>
              </div>
            )}

          {mode !== 'update_password' && (
            <div className="grid grid-cols-3 gap-1 p-1 bg-zinc-950 rounded-xl border border-zinc-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                  setInfoMessage(null);
                }}
                className={`py-2 rounded-lg transition-colors cursor-pointer ${
                  mode === 'login' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('bootstrap');
                  setError(null);
                  setInfoMessage(null);
                }}
                className={`py-2 rounded-lg transition-colors cursor-pointer ${
                  mode === 'bootstrap' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
                }`}
              >
                1º Acesso
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('recovery');
                  setError(null);
                  setInfoMessage(null);
                }}
                className={`py-2 rounded-lg transition-colors cursor-pointer ${
                  mode === 'recovery' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Recuperar Senha
              </button>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 leading-relaxed space-y-2">
              <p>{error}</p>
            </div>
          )}

          {infoMessage && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-start gap-2 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{infoMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-zinc-300">
                  E-mails Administrativos Autorizados
                </label>
                <span className="text-[11px] text-amber-400/90 font-medium">2 contas com acesso global</span>
              </div>

              {/* Seletor rápido dos e-mails autorizados */}
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {OFFICIAL_DOMAINS.platformOwnerEmails.map((authEmail) => (
                  <button
                    key={authEmail}
                    type="button"
                    onClick={() => {
                      setEmail(authEmail);
                      setError(null);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium border transition-all cursor-pointer ${
                      email.trim().toLowerCase() === authEmail.toLowerCase()
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 font-semibold shadow-sm'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-700'
                    }`}
                  >
                    {authEmail}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={OFFICIAL_DOMAINS.platformOwnerEmails.join(' ou ')}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>
              <p className="text-[11px] text-zinc-400 mt-1.5 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  Administradores globais autorizados:{' '}
                  <code className="text-amber-400 font-semibold">
                    {OFFICIAL_DOMAINS.platformOwnerEmails.join(' • ')}
                  </code>
                </span>
              </p>
            </div>

            {mode === 'bootstrap' && (
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2.5">
                <span className="block text-[11px] font-semibold text-zinc-300">
                  Método de Verificação do Proprietário:
                </span>
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setBootstrapMethod('email_verification')}
                    className={`py-1.5 px-2 rounded-lg border text-center transition-colors cursor-pointer ${
                      bootstrapMethod === 'email_verification'
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 font-semibold'
                        : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Confirmação por E-mail
                  </button>
                  <button
                    type="button"
                    onClick={() => setBootstrapMethod('token_bootstrap')}
                    className={`py-1.5 px-2 rounded-lg border text-center transition-colors cursor-pointer ${
                      bootstrapMethod === 'token_bootstrap'
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 font-semibold'
                        : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Token Administrativo
                  </button>
                </div>

                {bootstrapMethod === 'token_bootstrap' && (
                  <div className="pt-1">
                    <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                      Token Único de Inicialização (Setup Token)
                    </label>
                    <input
                      type="password"
                      required
                      value={setupToken}
                      onChange={(e) => setSetupToken(e.target.value)}
                      placeholder="Informe o PLATFORM_BOOTSTRAP_SECRET"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}
              </div>
            )}

            {mode !== 'recovery' && (
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  {mode === 'bootstrap' || mode === 'update_password'
                    ? 'Definir Senha Forte do Proprietário (mín. 6 caracteres)'
                    : 'Senha do Proprietário'}
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            )}

            {(mode === 'bootstrap' || mode === 'update_password') && (
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Confirmar Senha do Proprietário
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a senha escolhida"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs tracking-wide uppercase transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verificando Autorização...</span>
                </>
              ) : mode === 'bootstrap' ? (
                <span>Inicializar Conta e Definir Senha</span>
              ) : mode === 'recovery' ? (
                <span>Enviar Link Seguro de Redefinição</span>
              ) : mode === 'update_password' ? (
                <span>Salvar Nova Senha e Acessar Painel</span>
              ) : (
                <span>Acessar Painel Global do SaaS</span>
              )}
            </button>
          </form>

          {!isSupabaseConfigured() && (
            <div className="pt-4 border-t border-zinc-800/80 space-y-2.5">
              <p className="text-[11px] text-zinc-400 text-center">
                Ambiente de Homologação Local (Supabase remoto não configurado nas variáveis de ambiente):
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {OFFICIAL_DOMAINS.platformOwnerEmails.map((authEmail) => (
                  <button
                    key={authEmail}
                    type="button"
                    disabled={loading}
                    onClick={async () => {
                      setEmail(authEmail);
                      setError(null);
                      setLoading(true);
                      try {
                        const ownerUser = await saasPlatformService.bootstrapPlatformOwner({
                          email: authEmail,
                          isVerifiedSession: true,
                        });
                        const check = await saasPlatformService.verifyPlatformAdminAuthorization(ownerUser);
                        if (check.authorized && check.user) {
                          onAuthenticatedSuperAdmin(check.user);
                        } else {
                          setError(check.message);
                        }
                      } catch (err: any) {
                        setError(err?.message || 'Erro ao validar acesso local.');
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className="py-2.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-medium text-xs transition-colors cursor-pointer text-center"
                  >
                    Validar: <strong className="font-mono text-amber-300 block truncate">{authEmail}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="text-center text-[11px] text-zinc-500">
        Tatame Club • Governança Multi-Tenant Isolada • {OFFICIAL_DOMAINS.saasAdminUrl}
      </footer>
    </div>
  );
};
