import React, { useState, useEffect } from 'react';
import { X, Check, Award, Building2, DollarSign, Calendar, ShieldAlert } from 'lucide-react';
import { MembershipPlan, Branch, CreateMembershipPlanPayload } from '../../types';

interface PlanFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: CreateMembershipPlanPayload, planId?: string) => Promise<void>;
  planToEdit?: MembershipPlan | null;
  branches: Branch[];
  currentBranchId?: string;
  tenantId: string;
}

export const PlanFormModal: React.FC<PlanFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  planToEdit,
  branches,
  currentBranchId,
  tenantId,
}) => {
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [amount, setAmount] = useState<number>(220);
  const [frequency, setFrequency] = useState<'monthly' | 'quarterly' | 'semiannual' | 'annual'>('monthly');
  const [dueDay, setDueDay] = useState<number>(10);
  const [discountPercentage, setDiscountPercentage] = useState<number>(0);
  const [discountDescription, setDiscountDescription] = useState('');
  const [active, setActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (planToEdit) {
      setName(planToEdit.name);
      setBranchId(planToEdit.branchId || '');
      setAmount(planToEdit.amount);
      setFrequency(planToEdit.frequency);
      setDueDay(planToEdit.dueDay);
      setDiscountPercentage(planToEdit.discountPercentage || 0);
      setDiscountDescription(planToEdit.discountDescription || '');
      setActive(planToEdit.active ?? true);
    } else {
      setName('');
      setBranchId(currentBranchId && currentBranchId !== 'all' ? currentBranchId : '');
      setAmount(220);
      setFrequency('monthly');
      setDueDay(10);
      setDiscountPercentage(0);
      setDiscountDescription('');
      setActive(true);
    }
    setErrorMessage('');
    setIsSubmitting(false);
  }, [planToEdit, isOpen, currentBranchId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage('Por favor, informe o nome do plano de mensalidade.');
      return;
    }
    if (amount <= 0) {
      setErrorMessage('O valor da mensalidade deve ser maior que zero.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave(
        {
          tenantId,
          branchId: branchId || undefined,
          name: trimmedName,
          amount,
          frequency,
          dueDay,
          discountPercentage,
          discountDescription: discountDescription.trim() || undefined,
          active,
        },
        planToEdit?.id
      );
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Não foi possível salvar o plano. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-xl bg-red-950/60 border border-red-500/30 text-red-500">
            <DollarSign className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              {planToEdit ? 'Editar Plano de Mensalidade' : 'Cadastrar Plano de Mensalidade'}
            </h3>
            <p className="text-xs text-slate-400">
              Configure valores-base, periodicidade e regras de vencimento para as cobranças dos alunos.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl border border-red-500/30 bg-red-950/40 text-red-300 text-xs flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Nome do Plano */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Nome do Plano <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Plano Infantil Kodokan, Jiu-Jitsu Livre, Competição..."
              required
              className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:outline-none focus:border-red-500 text-xs"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Valor Base */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Valor Base (R$) <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="1"
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs font-mono font-semibold"
              />
            </div>

            {/* Dia de Vencimento Padrão */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Dia de Vencimento Padrão
              </label>
              <select
                value={dueDay}
                onChange={(e) => setDueDay(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs"
              >
                <option value={5}>Dia 05 de cada mês</option>
                <option value={10}>Dia 10 de cada mês</option>
                <option value={15}>Dia 15 de cada mês</option>
                <option value={20}>Dia 20 de cada mês</option>
                <option value={25}>Dia 25 de cada mês</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Periodicidade */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Periodicidade</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs"
              >
                <option value="monthly">Mensal (Padrão)</option>
                <option value="quarterly">Trimestral</option>
                <option value="semiannual">Semestral</option>
                <option value="annual">Anual</option>
              </select>
            </div>

            {/* Filial */}
            {branches.length > 0 && (
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Unidade / Filial</label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs"
                >
                  <option value="">Todas as Unidades</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Desconto Promocional % */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Desconto Pontualidade (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={discountPercentage}
                onChange={(e) => setDiscountPercentage(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs font-mono"
              />
            </div>

            {/* Descrição do Desconto */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Descrição do Desconto</label>
              <input
                type="text"
                value={discountDescription}
                onChange={(e) => setDiscountDescription(e.target.value)}
                placeholder="Ex: Desconto de 10% até o dia do vencimento"
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:outline-none focus:border-red-500 text-xs"
              />
            </div>
          </div>

          {/* Status Ativo */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/60">
            <div>
              <span className="font-semibold text-slate-200 block">Plano Ativo para Matrículas</span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                Planos inativos deixam de aparecer como opção para novas matrículas.
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
            </label>
          </div>

          {/* Ações */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-500 shadow transition-colors cursor-pointer disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              <span>{isSubmitting ? 'Salvando...' : planToEdit ? 'Salvar Alterações' : 'Cadastrar Plano'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
