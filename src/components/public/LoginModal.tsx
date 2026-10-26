import React, { useState } from 'react';
import {
  X,
  User,
  Lock,
  Mail,
  CheckCircle2,
  AlertCircle,
  Cloud,
  ArrowRight,
  Building2,
} from 'lucide-react';
import { User as UserType } from '../../types';
import { authService, isSupabaseConfigured, UserMembership } from '../../services/supabase';
import { DataStore } from '../../data/storage';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: UserType[];
  onSelectUser: (user: UserType) => void;
  onAuthSuccess?: (user: any, memberships: UserMembership[]) => void;
  onOpenRegister?: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  onSelectUser,
  onAuthSuccess,
  onOpenRegister,
}) => {
  const [authMode, setAuthMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const supabaseActive = isSupabaseConfigured();

  if (!isOpen) return null;

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
        // Autenticação em conta vinculada a um tenant real cadastrado na plataforma (sem seletor público de demonstração)
        const allUsers = DataStore.getUsers();
        const matchedUser = allUsers.find(
          (u) => u.email.trim().toLowerCase() === normalizedEmail && u.role !== 'superadmin'
        );

        if (!matchedUser) {
          setError(
            'Nenhuma conta de academia encontrada para este e-mail. Verifique o e-mail informado ou cadastre sua academia no teste grátis de 10 dias.'
          );
          setLoading(false);
          return;
        }

        if (matchedUser.active === false) {
          setError(
            'Seu acesso à academia encontra-se desativado pelo proprietário ou gestor. Entre em contato com a administração do seu dojo.'
          );
          setLoading(false);
          return;
        }

        onSelectUser(matchedUser);
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
      <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-5">
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
            Entre com seu e-mail e senha para acessar exclusivamente o ambiente da sua academia.
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

          <div className="flex gap-2 text-xs font-medium border-b border-slate-800 pb-3">
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
              Entrar na Academia
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
              Recuperar Senha
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
            <div>
              <label className="block text-slate-300 font-medium mb-1">E-mail de Acesso *</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu.email@academia.com.br"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2.5 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
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
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2.5 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
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
                <span>Autenticando...</span>
              ) : authMode === 'login' ? (
                <>
                  <span>Entrar no Ambiente da Academia</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              ) : (
                <span>Enviar Link de Recuperação</span>
              )}
            </button>
          </form>

          {onOpenRegister && (
            <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">Ainda não cadastrou seu dojo?</span>
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
