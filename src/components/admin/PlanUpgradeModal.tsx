import React from 'react';
import { X, Check, Sparkles } from 'lucide-react';
import { SaaSPlan, SaaSPlanId } from '../../types';

interface PlanUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  plans: SaaSPlan[];
  currentPlanId: SaaSPlanId;
  onConfirmUpgrade: (newPlanId: SaaSPlanId) => void;
}

export const PlanUpgradeModal: React.FC<PlanUpgradeModalProps> = ({
  isOpen,
  onClose,
  plans,
  currentPlanId,
  onConfirmUpgrade,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-red-500" />
            <h3 className="text-lg font-bold text-white">Contratar ou Alterar Plano SaaS</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Selecione o plano ideal para continuar utilizando o Tatame Club sem interrupções após o período de teste.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {plans.filter(p => p.id !== 'trial').map((plan) => {
            const isSelected = plan.id === currentPlanId;
            const isAdvanced = plan.id === 'advanced';

            return (
              <div
                key={plan.id}
                className={`p-5 rounded-xl border flex flex-col justify-between transition-all ${
                  isAdvanced
                    ? 'border-red-500 bg-slate-950/80 shadow-lg'
                    : 'border-slate-800 bg-slate-950/50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-base text-white">{plan.name}</span>
                    {isAdvanced && (
                      <span className="text-[10px] font-bold text-red-400 bg-red-950/60 px-2 py-0.5 rounded border border-red-500/30">
                        Completo
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 mb-4">{plan.tagline}</p>

                  <div className="flex items-baseline gap-1 mb-4 pb-4 border-b border-slate-800">
                    <span className="text-2xl font-black text-white">R$ {plan.pricePerMonth}</span>
                    <span className="text-xs text-slate-400">/mês</span>
                  </div>

                  <div className="space-y-2 text-xs text-slate-300">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>Até {plan.maxStudents} alunos cadastrados</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>Até {plan.maxUsers || 3} usuários ativos na equipe</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>{plan.maxBranches === 1 ? '1 Unidade (Matriz)' : `Até ${plan.maxBranches} Unidades integradas`}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>{plan.features.digitalLibrary ? 'Biblioteca digital de vídeos' : 'Sem biblioteca técnica'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>{plan.features.beltExams ? 'Módulo de exames de graduação' : 'Sem gestão de exames'}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    onConfirmUpgrade(plan.id);
                    onClose();
                  }}
                  className={`mt-6 w-full py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    isAdvanced
                      ? 'bg-red-600 hover:bg-red-500 text-white shadow'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                >
                  {isSelected ? 'Plano Atual Ativo' : `Contratar ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
