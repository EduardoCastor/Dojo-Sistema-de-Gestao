import React from 'react';
import { Shield, Lock } from 'lucide-react';

interface PublicFooterProps {
  onOpenSaaSPanel?: () => void;
  onOpenTerms?: () => void;
  onOpenPrivacy?: () => void;
}

export const PublicFooter: React.FC<PublicFooterProps> = ({
  onOpenSaaSPanel,
  onOpenTerms,
  onOpenPrivacy,
}) => {
  return (
    <footer className="border-t border-slate-800 bg-slate-950 text-slate-400 py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          <div className="space-y-4 md:col-span-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/10 border border-red-500/20 text-red-500">
                <Shield className="h-4 w-4" />
              </div>
              <span className="text-lg font-bold text-white tracking-tight">Tatame <span className="text-red-500">Club</span></span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Plataforma SaaS para gestão integral de dojos e academias de artes marciais no Brasil. Especializada em Judô, Jiu-Jitsu, Karatê e modalidades de combate.
            </p>
            <div className="text-xs text-slate-500">
              Isolamento multi-tenant · LGPD compliant · Fuso America/Sao_Paulo
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-4">Módulos</h4>
            <ul className="space-y-2 text-xs">
              <li><a href="#funcionalidades" className="hover:text-white transition-colors">Gestão de Graduações & Faixas</a></li>
              <li><a href="#funcionalidades" className="hover:text-white transition-colors">Controle de Frequência & Turmas</a></li>
              <li><a href="#funcionalidades" className="hover:text-white transition-colors">Mensalidades & Desconto Familiar</a></li>
              <li><a href="#funcionalidades" className="hover:text-white transition-colors">Biblioteca de Técnicas & Vídeos</a></li>
              <li><a href="#funcionalidades" className="hover:text-white transition-colors">Exames de Faixa & Competições</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-4">Ambientes da Academia</h4>
            <ul className="space-y-2 text-xs">
              <li><a href="#login" className="hover:text-white transition-colors">Painel da Academia (Owner / Gestor)</a></li>
              <li><a href="#login" className="hover:text-white transition-colors">Portal do Professor / Sensei</a></li>
              <li><a href="#login" className="hover:text-white transition-colors">Portal do Aluno</a></li>
              <li><a href="#login" className="hover:text-white transition-colors">Portal dos Responsáveis</a></li>
              <li><span className="text-slate-500">tatameclub.com.br</span></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-4">Conformidade & Privacidade</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <button
                  type="button"
                  onClick={onOpenPrivacy}
                  className="hover:text-white transition-colors text-left cursor-pointer"
                >
                  Política de Privacidade (LGPD)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={onOpenTerms}
                  className="hover:text-white transition-colors text-left cursor-pointer"
                >
                  Termos e Condições de Uso
                </button>
              </li>
              <li><span className="text-slate-400">Privacidade de Dados de Menores (Art. 14 LGPD)</span></li>
              <li><span className="text-slate-400">Armazenamento Restrito de Dados de Saúde</span></li>
              <li><span className="text-slate-400">Retenção e Controle de Acesso Multi-Tenant</span></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-900 pt-8 flex flex-col lg:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p className="text-center lg:text-left">
            © {new Date().getFullYear()} Tatame Club. Sistema desenvolvido e mantido por Beaver Soluções em Tecnologia — CNPJ 28.410.730/0001-80. Todos os direitos reservados.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
            <button
              type="button"
              onClick={onOpenTerms}
              className="hover:text-white transition-colors cursor-pointer underline-offset-4 hover:underline"
            >
              Termos de Uso
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={onOpenPrivacy}
              className="hover:text-white transition-colors cursor-pointer underline-offset-4 hover:underline"
            >
              Política de Privacidade
            </button>
            {onOpenSaaSPanel && (
              <>
                <span>·</span>
                <button
                  type="button"
                  onClick={onOpenSaaSPanel}
                  className="inline-flex items-center gap-1.5 text-amber-400/80 hover:text-amber-300 transition-colors cursor-pointer"
                  title="Acesso restrito ao Proprietário do SaaS (painel.tatameclub.com.br)"
                >
                  <Lock className="h-3 w-3" />
                  <span>Painel SaaS (painel.tatameclub.com.br)</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
};
