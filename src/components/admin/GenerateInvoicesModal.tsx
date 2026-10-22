import React, { useState } from 'react';
import { X, Calendar, Play, CheckCircle2, AlertTriangle, Users, ShieldCheck, RefreshCw } from 'lucide-react';
import { Student, ClassGroup, MembershipPlan, Enrollment, Invoice } from '../../types';

interface GenerateInvoicesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (params: {
    competence: string;
    dueDay: number;
    planId?: string;
    classGroupId?: string;
  }) => Promise<{ generatedCount: number; skippedCount: number }>;
  students: Student[];
  classes: ClassGroup[];
  plans: MembershipPlan[];
  existingInvoices: Invoice[];
  currentCompetence: string;
}

export const GenerateInvoicesModal: React.FC<GenerateInvoicesModalProps> = ({
  isOpen,
  onClose,
  onGenerate,
  students,
  classes,
  plans,
  existingInvoices,
  currentCompetence,
}) => {
  const [competence, setCompetence] = useState(currentCompetence || '11/2026');
  const [dueDay, setDueDay] = useState(10);
  const [selectedPlanId, setSelectedPlanId] = useState('all');
  const [selectedClassId, setSelectedClassId] = useState('all');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<{ generatedCount: number; skippedCount: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  if (!isOpen) return null;

  // Cálculo prévio de elegíveis
  const activeStudents = students.filter((s) => s.status === 'active');
  const alreadyGeneratedCount = activeStudents.filter((st) =>
    existingInvoices.some((inv) => inv.studentId === st.id && inv.competence === competence)
  ).length;

  const estimatedNewCount = Math.max(0, activeStudents.length - alreadyGeneratedCount);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setResult(null);

    const compRegex = /^(0[1-9]|1[0-2])\/\d{4}$/;
    if (!compRegex.test(competence.trim())) {
      setErrorMessage('Informe a competência no formato MM/AAAA (ex: 11/2026).');
      return;
    }

    setIsGenerating(true);
    try {
      const res = await onGenerate({
        competence: competence.trim(),
        dueDay,
        planId: selectedPlanId !== 'all' ? selectedPlanId : undefined,
        classGroupId: selectedClassId !== 'all' ? selectedClassId : undefined,
      });

      setResult(res);
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Não foi possível gerar as mensalidades.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
        <button
          onClick={onClose}
          disabled={isGenerating}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-500/30 text-red-400">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Gerar Mensalidades Recorrentes</h3>
            <p className="text-xs text-slate-400">
              Emissão controlada de faturas com validação anti-duplicação e respeito à data de matrícula.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl border border-red-500/40 bg-red-950/40 text-red-200 text-xs flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {result && (
          <div className="mb-4 p-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 text-emerald-200 text-xs space-y-1">
            <div className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Geração concluída com sucesso!</span>
            </div>
            <p>
              • <strong className="text-white">{result.generatedCount}</strong> nova(s) fatura(s) gerada(s).
              <br />• <strong className="text-white">{result.skippedCount}</strong> aluno(s) preservado(s) por já possuírem cobrança nesta competência.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Competência */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Competência (Mês/Ano) <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="Ex: 11/2026"
                value={competence}
                onChange={(e) => setCompetence(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white font-mono focus:outline-none focus:border-red-500 text-xs"
              />
            </div>

            {/* Dia de Vencimento */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Dia de Vencimento</label>
              <select
                value={dueDay}
                onChange={(e) => setDueDay(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs"
              >
                <option value={5}>Dia 05</option>
                <option value={10}>Dia 10 (Padrão)</option>
                <option value={15}>Dia 15</option>
                <option value={20}>Dia 20</option>
                <option value={25}>Dia 25</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Filtro de Turma */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Filtrar por Turma</label>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs"
              >
                <option value="all">Todas as Turmas do Dojo</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Plano de Mensalidade */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Plano Aplicado</label>
              <select
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs"
              >
                <option value="all">Valor Individual da Matrícula do Aluno</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (R$ {p.amount.toFixed(2)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Painel Informativo de Segurança Anti-Duplicação */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/70 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-slate-300 font-semibold">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>Validação e Proteção Financeira:</span>
            </div>
            <ul className="space-y-1 text-slate-400 text-[11px] list-disc list-inside">
              <li>
                Alunos ativos no sistema: <strong className="text-white">{activeStudents.length}</strong>
              </li>
              <li>
                Alunos que já possuem fatura para {competence}:{' '}
                <strong className="text-amber-400">{alreadyGeneratedCount}</strong> (serão ignorados)
              </li>
              <li>
                Estimativa de novas faturas a emitir:{' '}
                <strong className="text-emerald-400">{estimatedNewCount}</strong>
              </li>
              <li>Códigos PIX individuais e descontos familiares serão aplicados automaticamente.</li>
            </ul>
          </div>

          {/* Ações */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isGenerating || estimatedNewCount === 0}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-500 shadow transition-colors cursor-pointer disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Gerando cobranças...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  <span>Confirmar e Gerar Faturas ({estimatedNewCount})</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
