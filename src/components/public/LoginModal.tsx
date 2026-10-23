import React, { useState } from 'react';
import {
  X,
  ShieldAlert,
  Award,
  User,
  Users,
  Wallet,
  Building2,
  Lock,
  Mail,
  CheckCircle2,
  AlertCircle,
  Cloud,
  ArrowRight,
} from 'lucide-react';
import { User as UserType } from '../../types';
import { authService, isSupabaseConfigured, UserMembership } from '../../services/supabase';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: UserType[];
  onSelectUser: (user: UserType) => void;
  onAuthSuccess?: (user: any, memberships: UserMembership[]) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  users,
  onSelectUser,
  onAuthSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'supabase' | 'personas'>('supabase');
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot'>('login');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const supabaseActive = isSupabaseConfigured();

  if (!isOpen) return null;

  const handleSupabaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      if (authMode === 'login') {
        const { data, error: err } = await authService.signInWithEmail(email, password);
        if (err) throw err;

        if (data.user) {
          // Carregar vínculos multi-tenant do usuário autenticado diretamente do banco
          const memberships = await authService.loadUserMemberships(data.user.id);
          if (onAuthSuccess) {
            onAuthSuccess(data.user, memberships);
          }
          onClose();
        }
      } else if (authMode === 'register') {
        const { data, error: err } = await authService.signUpWithEmail(email, password, fullName);
        if (err) throw err;

        if (data.session) {
          // Sessão direta sem confirmação obrigatória
          const memberships = await authService.loadUserMemberships(data.user!.id);
          if (onAuthSuccess) {
            onAuthSuccess(data.user, memberships);
          }
          onClose();
        } else {
          // Confirmação de e-mail ativada no projeto Supabase
          setSuccessMessage(
            'Cadastro realizado com sucesso! Enviamos um link de confirmação para o seu e-mail.'
          );
        }
      } else if (authMode === 'forgot') {
        const { error: err } = await authService.resetPasswordForEmail(email);
        if (err) throw err;
        setSuccessMessage('Instruções de redefinição de senha foram enviadas para o seu e-mail.');
      }
    } catch (err: any) {
      console.error('Erro de autenticação:', err);
      let msg = err.message || 'Falha na autenticação.';
      if (msg.includes('Invalid login credentials')) {
        msg = 'E-mail ou senha incorretos.';
      } else if (msg.includes('Email not confirmed')) {
        msg = 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada.';
      } else if (msg.includes('User already registered')) {
        msg = 'Este e-mail já está cadastrado. Faça login ou recupere sua senha.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const getRoleBadge = (role: UserType['role']) => {
    const map: Record<string, { label: string; color: string; icon: React.ElementType }> = {
      superadmin: { label: 'Admin SaaS', color: 'text-amber-400 bg-amber-950/60 border-amber-500/30', icon: ShieldAlert },
      owner: { label: 'Proprietário Sensei', color: 'text-red-400 bg-red-950/60 border-red-500/30', icon: Award },
      branch_manager: { label: 'Gestor de Filial', color: 'text-blue-400 bg-blue-950/60 border-blue-500/30', icon: Building2 },
      secretary: { label: 'Secretaria', color: 'text-emerald-400 bg-emerald-950/60 border-emerald-500/30', icon: User },
      financial: { label: 'Financeiro', color: 'text-cyan-400 bg-cyan-950/60 border-cyan-500/30', icon: Wallet },
      instructor: { label: 'Professor / Sensei', color: 'text-purple-400 bg-purple-950/60 border-purple-500/30', icon: Award },
      student: { label: 'Aluno (Portal)', color: 'text-orange-400 bg-orange-950/60 border-orange-500/30', icon: User },
      guardian: { label: 'Responsável (Portal)', color: 'text-pink-400 bg-pink-950/60 border-pink-500/30', icon: Users },
    };
    return map[role] || { label: role, color: 'text-slate-400 bg-slate-800', icon: User };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-white">Acessar a Plataforma TatameHub</h3>
            {supabaseActive && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded">
                <Cloud className="h-3 w-3" />
                <span>Dados Conectados</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Entre com sua conta real ou explore as personas de demonstração local.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-slate-800 mb-4 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('supabase')}
            className={`py-2 px-4 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'supabase'
                ? 'border-red-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Entrar com E-mail e Senha
          </button>
          <button
            onClick={() => setActiveTab('personas')}
            className={`py-2 px-4 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'personas'
                ? 'border-red-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Perfis de Demonstração
          </button>
        </div>

        {activeTab === 'supabase' ? (
          <div>
            {!supabaseActive ? (
              <div className="p-4 rounded-xl border border-amber-600/40 bg-amber-950/30 text-xs text-amber-200 space-y-2 mb-4">
                <div className="font-bold flex items-center gap-1.5 text-amber-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>Modo de Demonstração Ativo</span>
                </div>
                <p className="leading-relaxed">
                  A autenticação na nuvem ainda não está configurada neste ambiente. Para explorar e testar todas as funcionalidades do sistema, utilize a aba <strong>Perfis de Demonstração</strong>.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {error && (
                  <div className="p-3 rounded-lg bg-red-950/50 border border-red-500/50 text-xs text-red-200 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                    <span>{error}</span>
                  </div>
                )}

                {successMessage && (
                  <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-500/50 text-xs text-emerald-200 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    <span>{successMessage}</span>
                  </div>
                )}

                {/* Sub-tabs: Login / Register / Forgot */}
                <div className="flex gap-2 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('login');
                      setError(null);
                      setSuccessMessage(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                      authMode === 'login' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Entrar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('register');
                      setError(null);
                      setSuccessMessage(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                      authMode === 'register' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Criar Conta
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('forgot');
                      setError(null);
                      setSuccessMessage(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                      authMode === 'forgot' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Esqueci a Senha
                  </button>
                </div>

                <form onSubmit={handleSupabaseSubmit} className="space-y-3 text-xs">
                  {authMode === 'register' && (
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">Nome Completo *</label>
                      <div className="relative">
                        <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                        <input
                          type="text"
                          required
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Sensei ou Aluno"
                          className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">E-mail *</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="seu.email@dominio.com"
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  {authMode !== 'forgot' && (
                    <div>
                      <label className="block text-slate-300 font-medium mb-1">Senha *</label>
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

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-xs font-semibold text-white hover:bg-red-500 active:bg-red-700 transition-colors shadow cursor-pointer disabled:opacity-50"
                  >
                    {loading ? (
                      <span>Processando dados...</span>
                    ) : authMode === 'login' ? (
                      <>
                        <span>Acessar Conta</span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    ) : authMode === 'register' ? (
                      <>
                        <span>Cadastrar Usuário</span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    ) : (
                      <span>Enviar Link de Recuperação</span>
                    )}
                  </button>
                </form>
              </div>
            )}
          </div>
        ) : (
          /* Personas de Demonstração (Permite navegação offline/mock para inspeção de UI) */
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1 text-xs">
            <div className="text-[11px] text-slate-400 mb-2">
              Selecione um perfil para inspecionar telas e fluxos com dados locais simulados:
            </div>
            {users.map((u) => {
              const badge = getRoleBadge(u.role);
              const Icon = badge.icon;
              return (
                <button
                  key={u.id}
                  onClick={() => onSelectUser(u)}
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/60 hover:bg-slate-800 hover:border-slate-700 transition-all text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 border border-slate-700 text-white font-bold group-hover:bg-red-600/20 group-hover:text-red-400 transition-colors">
                      {u.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white group-hover:text-red-400 transition-colors">
                        {u.name}
                      </div>
                      <div className="text-[11px] text-slate-400">{u.email}</div>
                    </div>
                  </div>

                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] font-medium ${badge.color}`}>
                    <Icon className="h-3 w-3" />
                    <span>{badge.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
