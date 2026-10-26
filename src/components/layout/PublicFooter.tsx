import React from 'react';
import { Shield } from 'lucide-react';

export const PublicFooter: React.FC = () => {
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
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-4">Conformidade</h4>
            <ul className="space-y-2 text-xs">
              <li><span className="text-slate-400">Privacidade de Dados de Menores (LGPD)</span></li>
              <li><span className="text-slate-400">Armazenamento Restrito de Dados de Saúde</span></li>
              <li><span className="text-slate-400">Regras de Graduação Configuráveis</span></li>
              <li><span className="text-slate-400">Retenção e Exportação de Cadastros</span></li>
              <li><span className="text-slate-400">Auditoria Completa de Operações</span></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-900 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} Tatame Club. Todos os direitos reservados. Feito para o ecossistema de artes marciais brasileiro.</p>
          <div className="flex gap-6">
            <span>Termos de Uso</span>
            <span>·</span>
            <span>Política de Privacidade</span>
            <span>·</span>
            <span>Suporte Técnico</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
