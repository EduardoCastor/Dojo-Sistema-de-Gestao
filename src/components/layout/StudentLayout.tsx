import React from 'react';
import { Shield, ArrowRightLeft, LogOut, User, FileText, Lock } from 'lucide-react';
import { User as UserType, Tenant } from '../../types';

interface StudentLayoutProps {
  currentUser: UserType;
  tenant: Tenant;
  activePortalRole?: 'student' | 'guardian';
  canSwitchPortalRole?: boolean;
  onSwitchPersona: () => void;
  onLogout: () => void;
  onOpenTerms?: () => void;
  onOpenPrivacy?: () => void;
  children: React.ReactNode;
}

export const StudentLayout: React.FC<StudentLayoutProps> = ({
  currentUser,
  tenant,
  activePortalRole,
  canSwitchPortalRole = false,
  onSwitchPersona,
  onLogout,
  onOpenTerms,
  onOpenPrivacy,
  children,
}) => {
  const effectiveRole = activePortalRole || (currentUser.role === 'guardian' ? 'guardian' : 'student');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-900/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600/10 border border-red-500/20 text-red-500">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white tracking-tight">
                Tatame <span className="text-red-500">Club</span>
              </div>
              <div className="text-[10px] text-slate-400">{tenant.tradeName}</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {canSwitchPortalRole && (
              <button
                type="button"
                onClick={onSwitchPersona}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/15 hover:bg-red-600/25 border border-red-500/30 text-red-300 text-xs font-semibold transition-colors cursor-pointer"
                title="Você possui vínculo duplo nesta academia (Aluno e Responsável). Clique para alternar o ambiente."
              >
                <ArrowRightLeft className="h-3.5 w-3.5 text-red-400" />
                <span>
                  {effectiveRole === 'student'
                    ? 'Alternar para Portal do Responsável'
                    : 'Alternar para Portal do Aluno'}
                </span>
              </button>
            )}

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs">
              <User className="h-3.5 w-3.5 text-red-400" />
              <span className="font-semibold text-white">{currentUser.name}</span>
              <span className="text-slate-400 text-[10px]">
                ({effectiveRole === 'student' ? 'Portal do Aluno' : 'Portal do Responsável'})
              </span>
            </div>

            <button
              onClick={onLogout}
              className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-red-400 transition-colors cursor-pointer"
              title="Sair da conta"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>

      {/* Footer with Beaver Copyright & Legal Links */}
      <footer className="border-t border-slate-900 py-6 px-4 text-xs text-slate-500">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-center sm:text-left">
            © {new Date().getFullYear()} Tatame Club. Sistema desenvolvido e mantido por Beaver Soluções em Tecnologia — CNPJ 28.410.730/0001-80. Todos os direitos reservados.
          </p>
          <div className="flex items-center gap-4">
            {onOpenTerms && (
              <button
                type="button"
                onClick={onOpenTerms}
                className="inline-flex items-center gap-1 hover:text-slate-300 transition-colors cursor-pointer"
              >
                <FileText className="h-3 w-3" />
                <span>Termos de Uso</span>
              </button>
            )}
            {onOpenPrivacy && (
              <button
                type="button"
                onClick={onOpenPrivacy}
                className="inline-flex items-center gap-1 hover:text-slate-300 transition-colors cursor-pointer"
              >
                <Lock className="h-3 w-3" />
                <span>Política de Privacidade (LGPD)</span>
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};
