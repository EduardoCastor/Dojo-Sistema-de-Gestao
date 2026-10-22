import React, { useState, useEffect } from 'react';
import { X, Check, DollarSign, Users, Calendar, AlertCircle, ShoppingBag, Trophy, Award, Layers } from 'lucide-react';
import { FinancialTransaction, Student, Person, ClassGroup, CreateTransactionPayload } from '../../types';

interface TransactionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveIndividual: (payload: CreateTransactionPayload) => Promise<void>;
  onSaveBatch: (payload: {
    tenantId: string;
    branchId?: string;
    studentIds: string[];
    classGroupId?: string;
    category: FinancialTransaction['category'];
    description: string;
    amount: number;
    competence: string;
    dueDate?: string;
  }) => Promise<void>;
  students: Student[];
  persons: Person[];
  classes: ClassGroup[];
  tenantId: string;
  currentCompetence: string;
  currentUserName: string;
}

export const TransactionFormModal: React.FC<TransactionFormModalProps> = ({
  isOpen,
  onClose,
  onSaveIndividual,
  onSaveBatch,
  students,
  persons,
  classes,
  tenantId,
  currentCompetence,
  currentUserName,
}) => {
  const [type, setType] = useState<'income' | 'expense'>('income');
  const [category, setCategory] = useState<FinancialTransaction['category']>('competition');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number>(100);
  const [competence, setCompetence] = useState(currentCompetence || '10/2026');
  const [mode, setMode] = useState<'single' | 'batch_class' | 'general'>('single');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<FinancialTransaction['paymentMethod']>('pix');
  const [isCompleted, setIsCompleted] = useState(true);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setType('income');
      setCategory('competition');
      setDescription('');
      setAmount(100);
      setCompetence(currentCompetence || '10/2026');
      setMode('single');
      setSelectedStudentId(students[0]?.id || '');
      setSelectedClassId(classes[0]?.id || '');
      const today = new Date().toISOString().split('T')[0];
      setDueDate(today);
      setPaymentDate(today);
      setPaymentMethod('pix');
      setIsCompleted(true);
      setNotes('');
      setErrorMessage('');
      setIsSubmitting(false);
    }
  }, [isOpen, currentCompetence, students, classes]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const trimmedDesc = description.trim();
    if (!trimmedDesc) {
      setErrorMessage('Por favor, informe a descrição do lançamento.');
      return;
    }
    if (amount <= 0) {
      setErrorMessage('O valor deve ser maior que zero.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'batch_class' && selectedClassId) {
        // Encontrar alunos matriculados na turma
        const classObj = classes.find((c) => c.id === selectedClassId);
        const batchStudentIds = students
          .filter((s) => s.status === 'active')
          .map((s) => s.id);

        if (batchStudentIds.length === 0) {
          throw new Error('Nenhum aluno ativo encontrado para gerar cobrança em lote.');
        }

        await onSaveBatch({
          tenantId,
          studentIds: batchStudentIds,
          classGroupId: selectedClassId,
          category,
          description: `${trimmedDesc} (${classObj?.name || 'Turma'})`,
          amount,
          competence,
          dueDate: dueDate || undefined,
        });
      } else {
        await onSaveIndividual({
          tenantId,
          type,
          category,
          description: trimmedDesc,
          amount,
          competence,
          dueDate: dueDate || undefined,
          paymentDate: isCompleted ? paymentDate || new Date().toISOString().split('T')[0] : undefined,
          status: isCompleted ? 'completed' : 'pending',
          studentId: mode === 'single' && selectedStudentId ? selectedStudentId : undefined,
          classGroupId: selectedClassId || undefined,
          paymentMethod,
          notes: notes.trim() || undefined,
          createdByUserName: currentUserName,
        });
      }

      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Não foi possível salvar o lançamento. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-500/30 text-red-400">
            <DollarSign className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Novo Lançamento Extra (Receita ou Despesa)</h3>
            <p className="text-xs text-slate-400">
              Registre taxas de competição, venda de quimonos, exames de faixa ou despesas gerais da academia.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl border border-red-500/40 bg-red-950/40 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Tipo: Receita ou Despesa */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Tipo de Movimentação</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType('income')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  type === 'income'
                    ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                <DollarSign className="h-4 w-4 text-emerald-400" />
                <span>Receita Extra (Cobrança)</span>
              </button>

              <button
                type="button"
                onClick={() => setType('expense')}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  type === 'expense'
                    ? 'border-red-500 bg-red-950/40 text-red-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                <ShoppingBag className="h-4 w-4 text-red-400" />
                <span>Despesa da Academia</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Categoria */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Categoria</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs"
              >
                <option value="competition">Inscrição em Competição</option>
                <option value="merchandise">Material / Quimono / Faixa</option>
                <option value="exam">Exame de Graduação</option>
                <option value="event">Seminário / Evento</option>
                <option value="administrative">Taxa Administrativa / Anuidade</option>
                <option value="facilities">Manutenção / Tatami / Espaço</option>
                <option value="payroll">Honorários de Professores</option>
                <option value="other">Outros Lançamentos</option>
              </select>
            </div>

            {/* Competência (Mês/Ano) */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Competência (Mês/Ano)</label>
              <input
                type="text"
                placeholder="Ex: 10/2026"
                value={competence}
                onChange={(e) => setCompetence(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white font-mono focus:outline-none focus:border-red-500 text-xs"
              />
            </div>
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Descrição do Lançamento <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Inscrição Campeonato Sul-Brasileiro, Quimono Judogi Trançado M2..."
              required
              className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:outline-none focus:border-red-500 text-xs"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Valor */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Valor Total (R$) <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.50"
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs font-mono font-bold"
              />
            </div>

            {/* Forma de Pagamento */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Forma de Pagamento</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs"
              >
                <option value="pix">PIX Instantâneo</option>
                <option value="credit_card">Cartão de Crédito</option>
                <option value="cash">Dinheiro em Espécie</option>
                <option value="boleto">Boleto Bancário</option>
                <option value="transfer">Transferência / TED</option>
              </select>
            </div>
          </div>

          {/* Modo de Vinculação */}
          {type === 'income' && (
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Vincular a:</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('single')}
                  className={`py-1.5 px-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                    mode === 'single'
                      ? 'border-red-500 bg-red-950/40 text-white'
                      : 'border-slate-800 bg-slate-950 text-slate-400'
                  }`}
                >
                  Aluno Específico
                </button>
                <button
                  type="button"
                  onClick={() => setMode('batch_class')}
                  className={`py-1.5 px-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                    mode === 'batch_class'
                      ? 'border-red-500 bg-red-950/40 text-white'
                      : 'border-slate-800 bg-slate-950 text-slate-400'
                  }`}
                >
                  Lote para Turma
                </button>
                <button
                  type="button"
                  onClick={() => setMode('general')}
                  className={`py-1.5 px-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                    mode === 'general'
                      ? 'border-red-500 bg-red-950/40 text-white'
                      : 'border-slate-800 bg-slate-950 text-slate-400'
                  }`}
                >
                  Receita Geral
                </button>
              </div>

              {mode === 'single' && (
                <div className="mt-2.5">
                  <select
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs"
                  >
                    <option value="">Selecione o Aluno...</option>
                    {students.map((st) => {
                      const p = persons.find((person) => person.id === st.personId);
                      return (
                        <option key={st.id} value={st.id}>
                          {p?.fullName || st.registrationNumber} (Matrícula: {st.registrationNumber})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {mode === 'batch_class' && (
                <div className="mt-2.5">
                  <select
                    value={selectedClassId}
                    onChange={(e) => setSelectedClassId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs"
                  >
                    <option value="">Selecione a Turma para cobrança em lote...</option>
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {cls.name} ({cls.tatamiRoom})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-amber-400 mt-1">
                    Uma cobrança individual será gerada para cada aluno com matrícula ativa nesta turma.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Situação da Cobrança */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/60">
            <div>
              <span className="font-semibold text-slate-200 block">
                {type === 'income' ? 'Valor já recebido' : 'Despesa já paga'}
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                {isCompleted
                  ? 'Contabiliza imediatamente no saldo realizado da academia.'
                  : 'Ficará como pendente com data de vencimento prevista.'}
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isCompleted}
                onChange={(e) => setIsCompleted(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Observações Adicionais</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Pedido nº 1042, fornecedor Shiroi, comprovante anexo..."
              className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:outline-none focus:border-red-500 text-xs"
            />
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
              <span>{isSubmitting ? 'Salvando...' : 'Confirmar Lançamento'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
