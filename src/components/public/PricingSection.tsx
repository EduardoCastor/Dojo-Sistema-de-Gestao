import React from 'react';
import { Check, Zap, Sparkles } from 'lucide-react';
import { SaaSPlan } from '../../types';

interface PricingSectionProps {
  plans: SaaSPlan[];
  onSelectPlan: (planId: string) => void;
}

export const PricingSection: React.FC<PricingSectionProps> = ({ plans, onSelectPlan }) => {
  return (
    <section id="planos" className="py-20 border-b border-slate-800 bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2">Transparência Comercial</div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Planos sob medida para o tamanho do seu dojo
          </h2>
          <p className="mt-3 text-sm text-slate-400">
            Comece pelo teste gratuito de 10 dias com acesso completo e evolua conforme sua academia cresce.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {plans.map((plan) => {
            const isTrial = plan.id === 'trial';
            const isAdvanced = plan.id === 'advanced';

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col justify-between rounded-2xl p-6 transition-all duration-200 ${
                  isAdvanced
                    ? 'border-2 border-red-500 bg-slate-900/90 shadow-xl shadow-red-950/20'
                    : isTrial
                    ? 'border border-amber-500/40 bg-slate-900/60'
                    : 'border border-slate-800 bg-slate-900/50'
                }`}
              >
                {isAdvanced && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-[11px] font-bold text-white shadow">
                    <Sparkles className="h-3 w-3" />
                    <span>MAIS RECOMENDADO</span>
                  </div>
                )}

                {isTrial && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-amber-600 px-3 py-1 text-[11px] font-bold text-white shadow">
                    <Zap className="h-3 w-3" />
                    <span>10 DIAS SEM COMPROMISSO</span>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                  </div>

                  <p className="text-xs text-slate-400 mb-6 min-h-[32px]">{plan.tagline}</p>

                  <div className="mb-6 pb-6 border-b border-slate-800">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold text-white">
                        {plan.pricePerMonth === 0 ? 'R$ 0' : `R$ ${plan.pricePerMonth}`}
                      </span>
                      {plan.pricePerMonth > 0 && <span className="text-xs text-slate-400">/mês</span>}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {isTrial
                        ? 'Duração de 10 dias corridos · Sem cobrança'
                        : 'Faturamento mensal · Cancele quando quiser'}
                    </div>
                  </div>

                  <div className="space-y-3 mb-8 text-xs">
                    <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Limites & Recursos</div>
                    
                    <div className="flex items-center gap-2 text-slate-300">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>Até {plan.maxStudents} alunos cadastrados</span>
                    </div>

                    <div className="flex items-center gap-2 text-slate-300">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>Até {plan.maxUsers || 3} usuários ativos na equipe</span>
                    </div>

                    <div className="flex items-center gap-2 text-slate-300">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>{plan.maxBranches === 1 ? '1 Unidade (Matriz inclusa)' : `Até ${plan.maxBranches} Unidades (Matriz + ${plan.maxBranches - 1} filiais)`}</span>
                    </div>

                    <div className="flex items-center gap-2 text-slate-300">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>{plan.maxStorageGb} GB de armazenamento seguro</span>
                    </div>

                    <div className="flex items-center gap-2 text-slate-300">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>Controle de graduações e frequências</span>
                    </div>

                    <div className="flex items-center gap-2 text-slate-300">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>Gestão financeira e baixa de mensalidades</span>
                    </div>

                    <div className={`flex items-center gap-2 ${plan.features.digitalLibrary ? 'text-slate-300' : 'text-slate-600 line-through'}`}>
                      <Check className={`h-4 w-4 ${plan.features.digitalLibrary ? 'text-emerald-400' : 'text-slate-700'} shrink-0`} />
                      <span>Biblioteca digital de técnicas & vídeos</span>
                    </div>

                    <div className={`flex items-center gap-2 ${plan.features.beltExams ? 'text-slate-300' : 'text-slate-600 line-through'}`}>
                      <Check className={`h-4 w-4 ${plan.features.beltExams ? 'text-emerald-400' : 'text-slate-700'} shrink-0`} />
                      <span>Módulo de exames de graduação & certificados</span>
                    </div>

                    <div className={`flex items-center gap-2 ${plan.features.competitions ? 'text-slate-300' : 'text-slate-600 line-through'}`}>
                      <Check className={`h-4 w-4 ${plan.features.competitions ? 'text-emerald-400' : 'text-slate-700'} shrink-0`} />
                      <span>Gestão básica de competições & medalhas</span>
                    </div>

                    <div className={`flex items-center gap-2 ${plan.features.advancedReports ? 'text-slate-300' : 'text-slate-600 line-through'}`}>
                      <Check className={`h-4 w-4 ${plan.features.advancedReports ? 'text-emerald-400' : 'text-slate-700'} shrink-0`} />
                      <span>Relatórios avançados & exportação CSV</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => onSelectPlan(plan.id)}
                  className={`w-full py-2.5 px-4 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    isAdvanced
                      ? 'bg-red-600 hover:bg-red-500 text-white shadow'
                      : isTrial
                      ? 'bg-amber-600 hover:bg-amber-500 text-white shadow'
                      : 'border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {isTrial ? 'Iniciar Teste Grátis de 10 Dias' : 'Contratar Este Plano'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Retention Policy notice */}
        <div className="mt-12 p-4 rounded-xl border border-slate-800/80 bg-slate-900/40 text-center max-w-2xl mx-auto text-xs text-slate-400">
          <span className="font-semibold text-slate-300">Política de Retenção de Dados:</span> Caso seu período de teste expire sem contratação, os cadastros e dados são preservados com segurança por <span className="text-white font-medium">60 dias</span> para que você possa reativar a qualquer momento sem perder o histórico do seu dojo.
        </div>
      </div>
    </section>
  );
};
