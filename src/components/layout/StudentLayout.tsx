import React from 'react';
import { Shield, ArrowRightLeft, LogOut, User } from 'lucide-react';
import { User as UserType, Tenant } from '../../types';

interface StudentLayoutProps {
  currentUser: UserType;
  tenant: Tenant;
  onSwitchPersona: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export const StudentLayout: React.FC<StudentLayoutProps> = ({
  currentUser,
  tenant,
  onSwitchPersona,
  onLogout,
  children,
}) => {
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
              <div className="text-sm font-bold text-white tracking-tight">Tatame <span className="text-red-500">Club</span></div>
              <div className="text-[10px] text-slate-400">{tenant.tradeName}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs">
              <User className="h-3.5 w-3.5 text-red-400" />
              <span className="font-semibold text-white">{currentUser.name}</span>
              <span className="text-slate-400 text-[10px] capitalize">({currentUser.role === 'student' ? 'Aluno' : 'Responsável'})</span>
            </div>

            <button
              onClick={onLogout}
              className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-red-400 transition-colors cursor-pointer"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        {children}
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-500">
        Tatame Club · {tenant.tradeName} · Conectado com segurança
      </footer>
    </div>
  );
};
