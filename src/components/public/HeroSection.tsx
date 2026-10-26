import React from 'react';
import { ArrowRight, CheckCircle2, Award, Calendar, Users, Wallet } from 'lucide-react';
import dojoImage from '../../assets/images/hero_martial_arts_dojo_1792068007714.jpg';

interface HeroSectionProps {
  onOpenRegister: () => void;
  onOpenLogin: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onOpenRegister, onOpenLogin }) => {
  return (
    <section className="relative overflow-hidden pt-8 pb-16 lg:pt-14 lg:pb-24 border-b border-slate-800">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Value Proposition */}
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-red-500/30 bg-red-950/40 text-red-400 text-xs font-semibold">
              <span className="flex h-2 w-2 rounded-full bg-red-500"></span>
              SaaS Especializado em Judô, Jiu-Jitsu e Artes Marciais
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-[1.15]" style={{ textWrap: 'balance' }}>
              Gestão de ponta a ponta para seu <span className="text-red-500">dojo</span> e <span className="text-slate-100">filiais</span>
            </h1>

            <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-2xl">
              Chega de planilhas desorganizadas. O Tatame Club centraliza controle de faixas e graduações, chamadas de frequência, validação anti-conflito de horários, mensalidades com desconto familiar e portais exclusivos para alunos e responsáveis.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-2">
              <button
                onClick={onOpenRegister}
                className="flex items-center justify-center gap-2 rounded-lg bg-red-600 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-red-900/30 hover:bg-red-500 active:bg-red-700 transition-colors cursor-pointer"
              >
                <span>Criar Conta & Testar 10 Dias Grátis</span>
                <ArrowRight className="h-5 w-5" />
              </button>

              <button
                onClick={onOpenLogin}
                className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-6 py-3.5 text-base font-medium text-slate-200 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
              >
                <span>Acessar Minha Academia</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-6 pt-4 text-xs text-slate-400 border-t border-slate-800/80">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>10 dias de teste sem cartão</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Isolamento total multi-tenant</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Adequado à LGPD (Dados de menores)</span>
              </div>
            </div>
          </div>

          {/* Right Column: High-fidelity Dojo Photography */}
          <div className="lg:col-span-5 relative">
            <div className="relative rounded-2xl overflow-hidden border border-slate-700/80 shadow-2xl bg-slate-900">
              <img
                src={dojoImage}
                alt="Dojo de Judô e Tatami Profissional"
                className="w-full h-[360px] sm:h-[420px] object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-transparent"></div>
              
              <div className="absolute bottom-4 left-4 right-4 p-4 rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-700/60 text-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-white">Associação Kodokan Brasil (Matriz Pinheiros)</span>
                  <span className="text-[11px] font-medium text-emerald-400">Ativo · Trial</span>
                </div>
                <div className="flex items-center gap-4 text-slate-400 text-[11px]">
                  <span>4 Turmas ativas</span>
                  <span>·</span>
                  <span>92% Frequência média</span>
                  <span>·</span>
                  <span>Exame 28/11</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 4-column KPI strip below the hero split */}
        <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Award className="h-4 w-4 text-red-500" />
              <span>Graduações & Faixas</span>
            </div>
            <div className="text-xl font-bold text-white tracking-tight">Regulamentos Oficiais</div>
            <p className="text-xs text-slate-400 mt-1">Critérios de idade, carência e frequência CBJ, CBJJ e CBK.</p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Calendar className="h-4 w-4 text-blue-500" />
              <span>Turmas & Matrículas</span>
            </div>
            <div className="text-xl font-bold text-white tracking-tight">Anti-Conflito Ativo</div>
            <p className="text-xs text-slate-400 mt-1">Bloqueio automático de choque de horários e limites de tatami.</p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Wallet className="h-4 w-4 text-emerald-500" />
              <span>Gestão Financeira</span>
            </div>
            <div className="text-xl font-bold text-white tracking-tight">Desconto Familiar & PIX</div>
            <p className="text-xs text-slate-400 mt-1">Cobrança única de irmãos com desconto sem duplicidades.</p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Users className="h-4 w-4 text-purple-500" />
              <span>Portal da Família</span>
            </div>
            <div className="text-xl font-bold text-white tracking-tight">Acesso Pais & Alunos</div>
            <p className="text-xs text-slate-400 mt-1">Acompanhamento de faltas, notas de exame e mensalidades.</p>
          </div>
        </div>

      </div>
    </section>
  );
};
