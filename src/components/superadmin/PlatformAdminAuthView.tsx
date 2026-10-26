import React, { useState } from 'react';
import { ShieldAlert, Lock, Mail, KeyRound, ArrowLeft, CheckCircle2, Globe } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../../services/supabase';
import { saasPlatformService } from '../../services/saasPlatformService';
import { OFFICIAL_DOMAINS, isAuthorizedPlatformOwnerEmail } from '../../utils/domainConfig';
import { User } from '../../types';
import brandEmblem from '../../assets/images/tatame_brand_emblem_1792068009123.jpg';

interface PlatformAdminAuthViewProps {
  currentUser: User | null;
  onAuthenticatedSuperAdmin: (user: User) => void;
  onReturnToMainSite: () => void;
}

export const PlatformAdminAuthView: React.FC<PlatformAdminAuthViewProps> = ({
  currentUser,
  onAuthenticatedSuperAdmin,
  onReturnToMainSite,
}) => {
  const [email, setEmail] = useState(OFFICIAL_DOMAINS.platformOwnerEmail);
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'bootstrap'>('login');
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If user is logged in as a regular academy user, block access explicitly
  const isUnauthorizedLoggedUser =
    currentUser && (currentUser.role !== 'superadmin' || !isAuthorizedPlatformOwnerEmail(currentUser.email));

  const handleLocalSandboxAccess = async () => {
    setError(null);
    setInfoMessage(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!isAuthorizedPlatformOwnerEmail(normalizedEmail)) {
      setError(
        `Acesso negado: o Painel Global do SaaS (${OFFICIAL_DOMAINS.saasAdminHost}) é restrito exclusivamente à conta proprietária ${OFFICIAL_DOMAINS.platformOwnerEmail}.`
      );
      return;
    }
    if (password.length < 6) {
      setError('Digite uma senha de pelo menos 6 caracteres no campo de senha acima para iniciar a sessão de teste.');
      return;
    }
    setLoading(true);
    try {
      const ownerUser = await saasPlatformService.bootstrapPlatformOwner({ email: normalizedEmail });
      onAuthenticatedSuperAdmin(ownerUser);
    } catch (err: any) {
      setError(err?.message || 'Erro ao iniciar modo de teste local.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!isAuthorizedPlatformOwnerEmail(normalizedEmail)) {
      setError(
        `Acesso negado: o Painel Global do SaaS (${OFFICIAL_DOMAINS.saasAdminHost}) é restrito exclusivamente à conta proprietária ${OFFICIAL_DOMAINS.platformOwnerEmail}.`
      );
      return;
    }

    if (password.length < 6) {
      setError('Informe uma senha válida (mínimo de 6 caracteres).');
      return;
    }

    setLoading(true);
    try {
      if (isSupabaseConfigured()) {
        if (mode === 'bootstrap') {
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: normalizedEmail,
            password,
            options: {
              data: { full_name: 'Proprietário Tatame Club SaaS' },
            },
          });

          if (signUpError && !signUpError.message.toLowerCase().includes('already registered')) {
            setError(`Erro no Supabase Auth: ${signUpError.message}`);
            return;
          }

          // Tenta promover e confirmar automaticamente a conta via RPC da Migration 25
          await supabase.rpc('bootstrap_platform_owner_by_email');

          // Tenta autenticar imediatamente após inicializar
          const { data: signInAfterBootstrap, error: signInAfterError } =
            await supabase.auth.signInWithPassword({
              email: normalizedEmail,
              password,
            });

          if (!signInAfterError && signInAfterBootstrap?.user) {
            const ownerUser = await saasPlatformService.bootstrapPlatformOwner({
              email: normalizedEmail,
              userId: signInAfterBootstrap.user.id,
            });
            onAuthenticatedSuperAdmin(ownerUser);
            return;
          }

          if (signUpData?.user && !signUpData.session) {
            setInfoMessage(
              'Conta criada no Supabase Auth! Confirme o e-mail enviado para beaverstraining@gmail.com (ou rode a Migration 25 no SQL Editor do Supabase) — ou clique no botão "Entrar em Modo de Teste Local" abaixo.'
            );
            setMode('login');
            return;
          }

          setInfoMessage('Conta inicial configurada! Faça login abaixo.');
          setMode('login');
          return;
        }

        // Modo Login: tenta promover antes caso a conta já exista mas ainda não esteja confirmada
        await supabase.rpc('bootstrap_platform_owner_by_email');

        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (signInError) {
          const rawMsg = signInError.message || '';
          if (rawMsg.toLowerCase().includes('email not confirmed')) {
            setError(
              'A conta beaverstraining@gmail.com foi criada, mas aguarda confirmação de e-mail. Verifique sua caixa de entrada do Gmail (ou rode "SELECT public.bootstrap_platform_owner_by_email();" no SQL Editor do Supabase) ou use o botão de Teste Local abaixo.'
            );
          } else {
            setError(
              'Conta beaverstraining@gmail.com ainda não foi criada no Supabase Auth (ou a senha está incorreta). Clique na aba "1º Acesso (Criar Senha)" acima para cadastrar sua senha pela primeira vez.'
            );
          }
          return;
        }

        if (data.user) {
          await supabase.rpc('bootstrap_platform_owner_by_email');
          const ownerUser = await saasPlatformService.bootstrapPlatformOwner({
            email: normalizedEmail,
            userId: data.user.id,
          });
          onAuthenticatedSuperAdmin(ownerUser);
        }
      } else {
        const ownerUser = await saasPlatformService.bootstrapPlatformOwner({ email: normalizedEmail });
        onAuthenticatedSuperAdmin(ownerUser);
      }
    } catch (err: any) {
      setError(err?.message || 'Erro inesperado ao autenticar no painel global.');
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

          {isUnauthorizedLoggedUser && (
            <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 space-y-2">
              <div className="flex items-center gap-2 text-red-400 font-bold text-xs">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Acesso Bloqueado para Conta de Academia</span>
              </div>
              <p className="text-xs text-red-200/90 leading-relaxed">
                Você está autenticado como <strong>{currentUser.email}</strong> ({currentUser.role}). Administradores de
                academias não possuem permissão para visualizar ou gerenciar tenants de terceiros.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-950 rounded-xl border border-zinc-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`py-2 rounded-lg transition-colors cursor-pointer ${
                mode === 'login' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Já tenho Senha (Login)
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('bootstrap');
                setError(null);
              }}
              className={`py-2 rounded-lg transition-colors cursor-pointer ${
                mode === 'bootstrap' ? 'bg-amber-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-white'
              }`}
            >
              1º Acesso (Criar Senha)
            </button>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 leading-relaxed space-y-2">
              <p>{error}</p>
              {mode === 'login' && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('bootstrap');
                    setError(null);
                  }}
                  className="w-full py-2 px-3 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs transition-colors cursor-pointer"
                >
                  Ir para "1º Acesso (Criar Senha)" →
                </button>
              )}
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
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                E-mail Administrativo Autorizado
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="beaverstraining@gmail.com"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">
                Somente <code className="text-amber-400">{OFFICIAL_DOMAINS.platformOwnerEmail}</code> possui autorização
                de superadministrador.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                {mode === 'bootstrap' ? 'Escolha sua Senha Forte (mín. 6 caracteres)' : 'Senha do Proprietário'}
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs tracking-wide uppercase transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading
                ? 'Processando...'
                : mode === 'bootstrap'
                ? 'Criar Senha e Inicializar Proprietário'
                : 'Acessar Painel Global do SaaS'}
            </button>
          </form>

          <div className="pt-4 border-t border-zinc-800/80 space-y-2">
            <p className="text-[11px] text-zinc-400 text-center">
              Ainda não publicou o domínio <code className="text-zinc-300">@tatameclub.com.br</code> ou ainda não rodou a Migration 25 no Supabase?
            </p>
            <button
              type="button"
              disabled={loading}
              onClick={handleLocalSandboxAccess}
              className="w-full py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-semibold text-xs transition-colors cursor-pointer"
            >
              Entrar em Modo de Teste Local (Pré-Domínio)
            </button>
          </div>
        </div>
      </main>

      <footer className="text-center text-[11px] text-zinc-500">
        Tatame Club • Governança Multi-Tenant Isolada • {OFFICIAL_DOMAINS.saasAdminUrl}
      </footer>
    </div>
  );
};
