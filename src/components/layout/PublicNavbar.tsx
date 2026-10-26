import React from 'react';
import { Shield, ArrowRight, UserCheck } from 'lucide-react';

interface PublicNavbarProps {
  onOpenRegister: () => void;
  onOpenLogin: () => void;
}

export const PublicNavbar: React.FC<PublicNavbarProps> = ({ onOpenRegister, onOpenLogin }) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Brand wordmark */}
        <a href="#" className="flex items-center gap-2.5 whitespace-nowrap shrink-0 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600/10 border border-red-500/20 text-red-500 group-hover:bg-red-600 group-hover:text-white transition-colors">
            <Shield className="h-5 w-5" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold tracking-tight text-white">Tatame <span className="text-red-500">Club</span></span>
            <span className="text-[10px] font-semibold text-slate-400 tracking-wider">SaaS</span>
          </div>
        </a>

        {/* Zone 2: 4-5 concise single-line links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
          <a href="#beneficios" className="hover:text-white transition-colors whitespace-nowrap shrink-0">Benefícios</a>
          <a href="#funcionalidades" className="hover:text-white transition-colors whitespace-nowrap shrink-0">Funcionalidades</a>
          <a href="#planos" className="hover:text-white transition-colors whitespace-nowrap shrink-0">Planos</a>
          <a href="#faq" className="hover:text-white transition-colors whitespace-nowrap shrink-0">Dúvidas Frequentes</a>
          <a href="#seguranca" className="hover:text-white transition-colors whitespace-nowrap shrink-0">LGPD & Segurança</a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onOpenLogin}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UserCheck className="h-4 w-4 text-slate-400" />
            <span>Acessar Portal</span>
          </button>
          
          <button
            onClick={onOpenRegister}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 active:bg-red-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Teste Grátis 10 Dias</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
