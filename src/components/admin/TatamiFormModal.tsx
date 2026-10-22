import React, { useState, useEffect } from 'react';
import { X, Check, LayoutGrid, Building2, Users, Palette, Info, ShieldAlert } from 'lucide-react';
import { Tatami, Branch } from '../../types';

interface TatamiFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (tatamiData: {
    id?: string;
    name: string;
    branchId?: string;
    dimensions?: string;
    maxCapacity: number;
    colorHex: string;
    description?: string;
    active: boolean;
  }) => Promise<void>;
  tatamiToEdit?: Tatami | null;
  branches: Branch[];
  currentBranchId?: string;
}

const PRESET_COLORS = [
  { hex: '#dc2626', label: 'Vermelho Tradicional' },
  { hex: '#2563eb', label: 'Azul Olímpico' },
  { hex: '#16a34a', label: 'Verde Judô' },
  { hex: '#d97706', label: 'Âmbar / Amarelo' },
  { hex: '#7c3aed', label: 'Roxo BJJ' },
  { hex: '#0f766e', label: 'Verde Petróleo' },
  { hex: '#475569', label: 'Cinza Tatami' },
];

export const TatamiFormModal: React.FC<TatamiFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  tatamiToEdit,
  branches,
  currentBranchId,
}) => {
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [maxCapacity, setMaxCapacity] = useState(20);
  const [colorHex, setColorHex] = useState('#dc2626');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (tatamiToEdit) {
      setName(tatamiToEdit.name);
      setBranchId(tatamiToEdit.branchId || branches[0]?.id || '');
      setDimensions(tatamiToEdit.dimensions || '');
      setMaxCapacity(tatamiToEdit.maxCapacity || 20);
      setColorHex(tatamiToEdit.colorHex || '#dc2626');
      setDescription(tatamiToEdit.description || '');
      setActive(tatamiToEdit.active ?? true);
    } else {
      setName('');
      setBranchId(currentBranchId && currentBranchId !== 'all' ? currentBranchId : branches[0]?.id || '');
      setDimensions('10x10m (100m²)');
      setMaxCapacity(20);
      setColorHex('#dc2626');
      setDescription('');
      setActive(true);
    }
    setErrorMessage('');
    setIsSubmitting(false);
  }, [tatamiToEdit, isOpen, branches, currentBranchId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage('Por favor, informe o nome do tatami ou espaço.');
      return;
    }
    if (maxCapacity <= 0) {
      setErrorMessage('A capacidade máxima deve ser de pelo menos 1 praticante.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave({
        id: tatamiToEdit?.id,
        name: trimmedName,
        branchId: branchId || undefined,
        dimensions: dimensions.trim() || undefined,
        maxCapacity,
        colorHex,
        description: description.trim() || undefined,
        active,
      });
      onClose();
    } catch (err: any) {
      console.error('Erro ao salvar tatami:', err);
      setErrorMessage(err.message || 'Erro ao persistir tatami.');
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
            <LayoutGrid className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              {tatamiToEdit ? 'Editar Tatami / Espaço' : 'Cadastrar Novo Tatami'}
            </h3>
            <p className="text-xs text-slate-400">
              Defina as dimensões, capacidade e unidade para controle de ocupação e horários.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl border border-red-500/30 bg-red-950/40 text-red-300 text-xs flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Nome do Tatami */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Nome do Tatami / Sala <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Tatami Principal, Tatami 2, Sala Infantil..."
              required
              className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:outline-none focus:border-red-500 text-xs"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Unidade / Filial */}
            {branches.length > 0 && (
              <div>
                <label className="block text-slate-300 font-semibold mb-1 flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5 text-slate-400" />
                  <span>Unidade / Filial</span>
                </label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Capacidade Máxima */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1 flex items-center gap-1">
                <Users className="h-3.5 w-3.5 text-slate-400" />
                <span>Capacidade Máxima (Alunos)</span>
              </label>
              <input
                type="number"
                min="1"
                max="200"
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(Math.max(1, parseInt(e.target.value) || 1))}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Dimensões / Área */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Dimensões / Área
              </label>
              <input
                type="text"
                value={dimensions}
                onChange={(e) => setDimensions(e.target.value)}
                placeholder="Ex: 12x12m (144m²), 8x8m..."
                className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:outline-none focus:border-red-500 text-xs"
              />
            </div>

            {/* Cor de Identificação */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1 flex items-center gap-1">
                <Palette className="h-3.5 w-3.5 text-slate-400" />
                <span>Cor de Identificação</span>
              </label>
              <div className="flex items-center gap-2">
                <div
                  className="h-8 w-8 rounded-lg border border-slate-600 shrink-0 shadow"
                  style={{ backgroundColor: colorHex }}
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.label}
                      onClick={() => setColorHex(c.hex)}
                      className={`h-5 w-5 rounded-full border transition-transform cursor-pointer ${
                        colorHex === c.hex ? 'scale-125 border-white ring-2 ring-red-500/50' : 'border-slate-700 hover:scale-110'
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Descrição / Observações */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Observações / Especificações Técnicas
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Solo com amortecimento olímpico, proteção lateral estofada, climatizado..."
              className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:outline-none focus:border-red-500 text-xs resize-none"
            />
          </div>

          {/* Status Ativo / Inativo */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/60">
            <div>
              <span className="font-semibold text-slate-200 block">Tatami Ativo</span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                Desative temporariamente para reformas ou eventos sem perder o histórico das turmas.
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

          {/* Ações do Formulário */}
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
              <span>{isSubmitting ? 'Salvando...' : tatamiToEdit ? 'Salvar Alterações' : 'Cadastrar Tatami'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
