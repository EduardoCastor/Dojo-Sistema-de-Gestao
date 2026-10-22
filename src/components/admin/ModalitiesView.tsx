import React, { useState, useEffect } from 'react';
import {
  Award,
  Plus,
  Edit2,
  Trash2,
  Check,
  Shield,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  X,
  Power,
  RotateCw,
  Info,
} from 'lucide-react';
import { MartialArt, BeltRank, User } from '../../types';
import { studentService } from '../../services/studentService';

interface ModalitiesViewProps {
  tenantId?: string;
  currentUser?: User;
  martialArts: MartialArt[];
  beltRanks: BeltRank[];
  onAddBeltRank?: (rank: BeltRank) => void;
  onUpdateBeltRank?: (rank: BeltRank) => void;
  onDeleteBeltRank?: (id: string) => void;
  onReorderBeltRanks?: (artId: string, orderedRanks: BeltRank[]) => void;
  onAddMartialArt?: (art: MartialArt) => void;
  onUpdateMartialArt?: (art: MartialArt) => void;
  onToggleMartialArtStatus?: (art: MartialArt) => void;
  onDeleteMartialArt?: (id: string) => void;
  onRefresh?: () => void;
}

export const ModalitiesView: React.FC<ModalitiesViewProps> = ({
  tenantId = 'tenant-kodokan',
  currentUser,
  martialArts,
  beltRanks,
  onAddBeltRank,
  onUpdateBeltRank,
  onDeleteBeltRank,
  onReorderBeltRanks,
  onAddMartialArt,
  onUpdateMartialArt,
  onToggleMartialArtStatus,
  onDeleteMartialArt,
  onRefresh,
}) => {
  const [selectedArtId, setSelectedArtId] = useState<string>(
    martialArts[0]?.id || ''
  );

  // Garantir que selectedArtId selecione uma arte válida quando a lista mudar
  useEffect(() => {
    if (martialArts.length > 0) {
      const exists = martialArts.some((m) => m.id === selectedArtId);
      if (!exists) {
        setSelectedArtId(martialArts[0].id);
      }
    }
  }, [martialArts, selectedArtId]);

  // Estados de Modais
  const [isArtModalOpen, setIsArtModalOpen] = useState(false);
  const [artModalMode, setArtModalMode] = useState<'create' | 'edit'>('create');
  const [isBeltModalOpen, setIsBeltModalOpen] = useState(false);
  const [beltModalMode, setBeltModalMode] = useState<'create' | 'edit'>('create');

  // Estado para exclusão com confirmação
  const [itemToDelete, setItemToDelete] = useState<{
    type: 'art' | 'belt';
    id: string;
    name: string;
  } | null>(null);

  // Mensagens de feedback
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form Arte Marcial
  const [artFormId, setArtFormId] = useState('');
  const [artFormName, setArtFormName] = useState('');
  const [artFormOrigin, setArtFormOrigin] = useState('');
  const [artFormFederation, setArtFormFederation] = useState('');
  const [artFormDescription, setArtFormDescription] = useState('');
  const [artFormStatus, setArtFormStatus] = useState<'active' | 'inactive'>('active');

  // Form Graduação / Faixa
  const [beltFormId, setBeltFormId] = useState('');
  const [beltFormName, setBeltFormName] = useState('');
  const [beltFormRankType, setBeltFormRankType] = useState<'faixa' | 'grau' | 'dan' | 'corda'>('faixa');
  const [beltFormColor, setBeltFormColor] = useState('#ffffff');
  const [beltFormHasStripe, setBeltFormHasStripe] = useState(false);
  const [beltFormStripeColor, setBeltFormStripeColor] = useState('#ef4444');
  const [beltFormMinAge, setBeltFormMinAge] = useState<number>(4);
  const [beltFormMinMonths, setBeltFormMinMonths] = useState<number>(0);
  const [beltFormRequiresExam, setBeltFormRequiresExam] = useState<boolean>(true);
  const [beltFormRequirements, setBeltFormRequirements] = useState<string>('');

  const activeArt = martialArts.find((m) => m.id === selectedArtId) || martialArts[0];

  const currentBelts = beltRanks
    .filter((b) => b.martialArtId === selectedArtId)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  // Helper para exibir feedback temporário
  const showFeedback = (type: 'success' | 'error' | 'info', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback(null);
    }, 5000);
  };

  // Abrir Modal de Criação de Arte Marcial
  const handleOpenCreateArt = () => {
    setArtModalMode('create');
    setArtFormId('');
    setArtFormName('');
    setArtFormOrigin('Japão');
    setArtFormFederation('CBJ / IJF');
    setArtFormDescription('');
    setArtFormStatus('active');
    setIsArtModalOpen(true);
  };

  // Abrir Modal de Edição de Arte Marcial
  const handleOpenEditArt = (art: MartialArt) => {
    setArtModalMode('edit');
    setArtFormId(art.id);
    setArtFormName(art.name);
    setArtFormOrigin(art.origin || '');
    setArtFormFederation(art.governingFederation || '');
    setArtFormDescription(art.description || '');
    setArtFormStatus(art.status || 'active');
    setIsArtModalOpen(true);
  };

  // Salvar Arte Marcial (Create / Update)
  const handleSaveArt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artFormName.trim()) {
      showFeedback('error', 'O nome da modalidade é obrigatório.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (artModalMode === 'create') {
        let createdArt: MartialArt;
        try {
          createdArt = await studentService.createMartialArt(tenantId, {
            name: artFormName.trim(),
            origin: artFormOrigin.trim(),
            description: artFormDescription.trim(),
            governingFederation: artFormFederation.trim(),
            status: artFormStatus,
          });
        } catch (dbErr: any) {
          // Fallback se não conectado ao Supabase
          createdArt = {
            id: `art-${Date.now()}`,
            tenantId,
            name: artFormName.trim(),
            origin: artFormOrigin.trim(),
            description: artFormDescription.trim(),
            governingFederation: artFormFederation.trim() || undefined,
            status: artFormStatus,
          };
        }

        if (onAddMartialArt) onAddMartialArt(createdArt);
        setSelectedArtId(createdArt.id);
        showFeedback('success', `Modalidade "${createdArt.name}" cadastrada com sucesso!`);
      } else {
        let updatedArt: MartialArt;
        try {
          updatedArt = await studentService.updateMartialArt(tenantId, artFormId, {
            name: artFormName.trim(),
            origin: artFormOrigin.trim(),
            description: artFormDescription.trim(),
            governingFederation: artFormFederation.trim(),
            status: artFormStatus,
          });
        } catch (dbErr: any) {
          // Fallback se offline
          updatedArt = {
            id: artFormId,
            tenantId,
            name: artFormName.trim(),
            origin: artFormOrigin.trim(),
            description: artFormDescription.trim(),
            governingFederation: artFormFederation.trim() || undefined,
            status: artFormStatus,
          };
        }

        if (onUpdateMartialArt) onUpdateMartialArt(updatedArt);
        showFeedback('success', `Modalidade "${updatedArt.name}" atualizada com sucesso!`);
      }

      setIsArtModalOpen(false);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showFeedback('error', err.message || 'Erro ao salvar modalidade.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Alternar Status Ativa / Inativa da Arte Marcial
  const handleToggleStatus = async (art: MartialArt) => {
    const nextStatus = art.status === 'active' ? 'inactive' : 'active';
    try {
      let updated: MartialArt;
      try {
        updated = await studentService.toggleMartialArtStatus(tenantId, art.id, nextStatus);
      } catch {
        updated = { ...art, status: nextStatus };
      }

      if (onToggleMartialArtStatus) onToggleMartialArtStatus(updated);
      showFeedback(
        'success',
        `Modalidade "${art.name}" agora está ${nextStatus === 'active' ? 'ATIVA' : 'INATIVA'}.`
      );
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showFeedback('error', err.message || 'Erro ao alterar status da modalidade.');
    }
  };

  // Abrir Modal de Criação de Faixa
  const handleOpenCreateBelt = () => {
    if (!activeArt) {
      showFeedback('error', 'Selecione ou cadastre uma modalidade antes de adicionar graduações.');
      return;
    }
    setBeltModalMode('create');
    setBeltFormId('');
    setBeltFormName('');
    setBeltFormRankType('faixa');
    setBeltFormColor('#2563eb');
    setBeltFormHasStripe(false);
    setBeltFormStripeColor('#ffffff');
    setBeltFormMinAge(6);
    setBeltFormMinMonths(6);
    setBeltFormRequiresExam(true);
    setBeltFormRequirements('');
    setIsBeltModalOpen(true);
  };

  // Abrir Modal de Edição de Faixa
  const handleOpenEditBelt = (belt: BeltRank) => {
    setBeltModalMode('edit');
    setBeltFormId(belt.id);
    setBeltFormName(belt.name);
    setBeltFormRankType(belt.rankType || 'faixa');
    setBeltFormColor(belt.colorHex || '#ffffff');
    setBeltFormHasStripe(Boolean(belt.stripeColorHex));
    setBeltFormStripeColor(belt.stripeColorHex || '#ef4444');
    setBeltFormMinAge(belt.minAgeYears ?? 4);
    setBeltFormMinMonths(belt.minPracticeMonths ?? 0);
    setBeltFormRequiresExam(belt.requiresExam !== false);
    setBeltFormRequirements(belt.technicalRequirements || '');
    setIsBeltModalOpen(true);
  };

  // Salvar Graduação / Faixa (Create / Update)
  const handleSaveBelt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!beltFormName.trim()) {
      showFeedback('error', 'O nome da faixa/graduação é obrigatório.');
      return;
    }
    if (!selectedArtId) {
      showFeedback('error', 'Nenhuma modalidade selecionada.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (beltModalMode === 'create') {
        let createdBelt: BeltRank;
        try {
          createdBelt = await studentService.createBeltRank(tenantId, {
            martialArtId: selectedArtId,
            name: beltFormName.trim(),
            rankType: beltFormRankType,
            orderIndex: currentBelts.length + 1,
            colorHex: beltFormColor,
            stripeColorHex: beltFormHasStripe ? beltFormStripeColor : undefined,
            minAgeYears: Number(beltFormMinAge),
            minPracticeMonths: Number(beltFormMinMonths),
            technicalRequirements: beltFormRequirements.trim(),
            requiresExam: beltFormRequiresExam,
          });
        } catch (dbErr: any) {
          // Fallback offline
          createdBelt = {
            id: `rank-${Date.now()}`,
            tenantId,
            martialArtId: selectedArtId,
            name: beltFormName.trim(),
            rankType: beltFormRankType,
            orderIndex: currentBelts.length + 1,
            colorHex: beltFormColor,
            stripeColorHex: beltFormHasStripe ? beltFormStripeColor : undefined,
            minAgeYears: Number(beltFormMinAge),
            minPracticeMonths: Number(beltFormMinMonths),
            technicalRequirements: beltFormRequirements.trim(),
            requiresExam: beltFormRequiresExam,
          };
        }

        if (onAddBeltRank) onAddBeltRank(createdBelt);
        showFeedback('success', `Faixa "${createdBelt.name}" cadastrada com sucesso!`);
      } else {
        let updatedBelt: BeltRank;
        try {
          updatedBelt = await studentService.updateBeltRank(tenantId, beltFormId, {
            name: beltFormName.trim(),
            rankType: beltFormRankType,
            colorHex: beltFormColor,
            stripeColorHex: beltFormHasStripe ? beltFormStripeColor : undefined,
            minAgeYears: Number(beltFormMinAge),
            minPracticeMonths: Number(beltFormMinMonths),
            technicalRequirements: beltFormRequirements.trim(),
            requiresExam: beltFormRequiresExam,
          });
        } catch (dbErr: any) {
          // Fallback offline
          const current = currentBelts.find((b) => b.id === beltFormId);
          updatedBelt = {
            id: beltFormId,
            tenantId,
            martialArtId: selectedArtId,
            name: beltFormName.trim(),
            rankType: beltFormRankType,
            orderIndex: current?.orderIndex ?? 1,
            colorHex: beltFormColor,
            stripeColorHex: beltFormHasStripe ? beltFormStripeColor : undefined,
            minAgeYears: Number(beltFormMinAge),
            minPracticeMonths: Number(beltFormMinMonths),
            technicalRequirements: beltFormRequirements.trim(),
            requiresExam: beltFormRequiresExam,
          };
        }

        if (onUpdateBeltRank) onUpdateBeltRank(updatedBelt);
        showFeedback('success', `Faixa "${updatedBelt.name}" atualizada com sucesso!`);
      }

      setIsBeltModalOpen(false);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showFeedback('error', err.message || 'Erro ao salvar faixa.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reordenar Faixas (Mover para cima / baixo)
  const handleMoveBelt = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentBelts.length) return;

    const newBelts = [...currentBelts];
    const [moved] = newBelts.splice(index, 1);
    newBelts.splice(targetIndex, 0, moved);

    // Atualiza os order_index
    const reindexedBelts = newBelts.map((belt, idx) => ({
      ...belt,
      orderIndex: idx + 1,
    }));

    if (onReorderBeltRanks) {
      onReorderBeltRanks(selectedArtId, reindexedBelts);
    }

    try {
      await studentService.reorderBeltRanks(
        tenantId,
        selectedArtId,
        reindexedBelts.map((b) => b.id)
      );
      showFeedback('success', 'Ordem das faixas atualizada com sucesso.');
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.warn('Falha ao persistir reordenação no Supabase:', err);
      showFeedback('info', 'Ordem atualizada localmente.');
    }
  };

  // Confirmar Exclusão
  const handleConfirmDelete = async () => {
    if (!itemToDelete) return;
    setIsSubmitting(true);

    try {
      if (itemToDelete.type === 'art') {
        try {
          await studentService.deleteMartialArt(tenantId, itemToDelete.id);
        } catch (dbErr: any) {
          console.warn('Exclusão de modalidade via API:', dbErr);
        }
        if (onDeleteMartialArt) onDeleteMartialArt(itemToDelete.id);
        showFeedback('success', `Modalidade "${itemToDelete.name}" removida com sucesso.`);
      } else {
        try {
          await studentService.deleteBeltRank(tenantId, itemToDelete.id);
        } catch (dbErr: any) {
          console.warn('Exclusão de faixa via API:', dbErr);
        }
        if (onDeleteBeltRank) onDeleteBeltRank(itemToDelete.id);
        showFeedback('success', `Graduação "${itemToDelete.name}" removida com sucesso.`);
      }

      setItemToDelete(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showFeedback('error', err.message || 'Erro ao excluir item.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Notificação / Feedback Alert */}
      {feedback && (
        <div
          className={`p-4 rounded-xl text-xs flex items-center justify-between border shadow-sm transition-all animate-in fade-in slide-in-from-top-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-300'
              : feedback.type === 'error'
              ? 'bg-red-950/60 border-red-500/30 text-red-300'
              : 'bg-blue-950/60 border-blue-500/30 text-blue-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' && <Check className="h-4 w-4 shrink-0 text-emerald-400" />}
            {feedback.type === 'error' && <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />}
            {feedback.type === 'info' && <Info className="h-4 w-4 shrink-0 text-blue-400" />}
            <span className="font-medium">{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white cursor-pointer ml-3"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header Principal */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Award className="h-6 w-6 text-red-500" />
            <span>Modalidades & Sistema de Graduações</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Gerencie as artes marciais praticadas no dojo, seus critérios pedagógicos e a sequência progressiva de faixas.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={handleOpenCreateArt}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4 text-red-400" />
            <span>Nova Modalidade</span>
          </button>

          <button
            onClick={handleOpenCreateBelt}
            disabled={!activeArt}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white transition-colors shadow cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Nova Faixa / Graduação</span>
          </button>
        </div>
      </div>

      {/* Seletor de Modalidades em Abas */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
        {martialArts.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-2">
            Nenhuma modalidade cadastrada. Clique em "Nova Modalidade" para começar.
          </div>
        ) : (
          martialArts.map((art) => {
            const isSelected = selectedArtId === art.id;
            const isInactive = art.status === 'inactive';
            return (
              <button
                key={art.id}
                onClick={() => setSelectedArtId(art.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  isSelected
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
                }`}
              >
                <Award className={`h-4 w-4 ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                <span>{art.name}</span>
                {isInactive && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded font-mono uppercase ${
                      isSelected
                        ? 'bg-red-800 text-red-100'
                        : 'bg-slate-800 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    Inativa
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Card da Modalidade Ativa e Controles */}
      {activeArt ? (
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-white text-base">{activeArt.name}</h3>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                  activeArt.status === 'active'
                    ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-950/60 text-amber-400 border border-amber-500/30'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    activeArt.status === 'active' ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                ></span>
                {activeArt.status === 'active' ? 'Ativa no Dojo' : 'Inativa (Oculta nos Alunos)'}
              </span>
            </div>

            <p className="text-slate-400 text-xs max-w-2xl">
              {activeArt.description || 'Nenhuma descrição técnica informada.'}
            </p>

            <div className="flex flex-wrap items-center gap-3 text-slate-500 text-[11px] pt-1">
              {activeArt.origin && <span>Origem: {activeArt.origin}</span>}
              {activeArt.governingFederation && (
                <>
                  <span>•</span>
                  <span>Federação: {activeArt.governingFederation}</span>
                </>
              )}
              <span>•</span>
              <span className="text-slate-300 font-semibold">
                {currentBelts.length} Graduações Cadastradas
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleToggleStatus(activeArt)}
              title={activeArt.status === 'active' ? 'Desativar modalidade' : 'Ativar modalidade'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                activeArt.status === 'active'
                  ? 'border-amber-500/40 text-amber-300 hover:bg-amber-950/50'
                  : 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/50'
              }`}
            >
              <Power className="h-3.5 w-3.5" />
              <span>{activeArt.status === 'active' ? 'Inativar' : 'Ativar'}</span>
            </button>

            <button
              onClick={() => handleOpenEditArt(activeArt)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              <Edit2 className="h-3.5 w-3.5 text-slate-400" />
              <span>Editar Modalidade</span>
            </button>

            <button
              onClick={() =>
                setItemToDelete({
                  type: 'art',
                  id: activeArt.id,
                  name: activeArt.name,
                })
              }
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition-colors cursor-pointer"
              title="Excluir modalidade"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Tabela de Sequência Progressiva de Faixas */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Award className="h-4 w-4 text-red-500" />
              <span>Sequência Progressiva de Graduações ({activeArt?.name || 'Modalidade'})</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Defina a hierarquia de faixas, tempos de carência e requisitos de exame exigidos para troca de graduação.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">
              {currentBelts.length} faixas na progressão
            </span>
          </div>
        </div>

        {currentBelts.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            Nenhuma faixa ou graduação cadastrada para esta modalidade.
            <div className="mt-3">
              <button
                onClick={handleOpenCreateBelt}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Adicionar Primeira Faixa</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4 w-28 text-center">Ordem</th>
                  <th className="py-3 px-4">Faixa / Graduação</th>
                  <th className="py-3 px-4">Tipo</th>
                  <th className="py-3 px-4">Idade Mínima</th>
                  <th className="py-3 px-4">Carência Mínima</th>
                  <th className="py-3 px-4">Exige Exame?</th>
                  <th className="py-3 px-4">Requisitos Técnicos (Gokyo / Kata / Waza)</th>
                  <th className="py-3 px-4 text-right w-24">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {currentBelts.map((b, index) => (
                  <tr key={b.id} className="hover:bg-slate-800/40 transition-colors">
                    {/* Controles de Ordem */}
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className="font-mono font-bold text-slate-400 w-6">
                          #{index + 1}
                        </span>
                        <div className="flex flex-col">
                          <button
                            onClick={() => handleMoveBelt(index, 'up')}
                            disabled={index === 0}
                            title="Mover para cima"
                            className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleMoveBelt(index, 'down')}
                            disabled={index === currentBelts.length - 1}
                            title="Mover para baixo"
                            className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Visual da Faixa e Nome */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {/* Simulação Visual Realista da Faixa */}
                        <div
                          className="relative h-4 w-8 rounded-sm border border-slate-700 shadow-sm shrink-0 overflow-hidden"
                          style={{ backgroundColor: b.colorHex }}
                        >
                          {b.stripeColorHex && (
                            <span
                              className="absolute top-0 right-1 bottom-0 w-2 shadow-inner"
                              style={{ backgroundColor: b.stripeColorHex }}
                              title={`Ponta/Detalhe: ${b.stripeColorHex}`}
                            ></span>
                          )}
                        </div>
                        <span className="font-bold text-white text-xs">{b.name}</span>
                      </div>
                    </td>

                    {/* Tipo de Graduação */}
                    <td className="py-3 px-4 capitalize font-mono text-slate-400">
                      {b.rankType || 'faixa'}
                    </td>

                    {/* Idade Mínima */}
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {b.minAgeYears} anos
                    </td>

                    {/* Carência Mínima */}
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {b.minPracticeMonths === 0 ? 'Iniciação' : `${b.minPracticeMonths} meses`}
                    </td>

                    {/* Exige Exame */}
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                          b.requiresExam
                            ? 'bg-amber-950/60 text-amber-400 border border-amber-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {b.requiresExam ? 'Banca Examinadora' : 'Automática'}
                      </span>
                    </td>

                    {/* Requisitos Técnicos */}
                    <td className="py-3 px-4 text-slate-400 max-w-xs truncate" title={b.technicalRequirements}>
                      {b.technicalRequirements || <span className="text-slate-600 italic">Sem requisitos informados</span>}
                    </td>

                    {/* Ações */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleOpenEditBelt(b)}
                          title="Editar faixa"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            setItemToDelete({
                              type: 'belt',
                              id: b.id,
                              name: b.name,
                            })
                          }
                          title="Excluir faixa"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: CADASTRAR / EDITAR MODALIDADE (ARTE MARCIAL) */}
      {isArtModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Award className="h-5 w-5 text-red-500" />
                <span>
                  {artModalMode === 'create' ? 'Cadastrar Nova Modalidade' : 'Editar Modalidade'}
                </span>
              </h3>
              <button
                onClick={() => setIsArtModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveArt} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Nome da Modalidade *
                </label>
                <input
                  type="text"
                  required
                  value={artFormName}
                  onChange={(e) => setArtFormName(e.target.value)}
                  placeholder="Ex: Judô, Jiu-Jitsu Brasileiro, Karatê Shotokan, Muay Thai..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    País / Região de Origem
                  </label>
                  <input
                    type="text"
                    value={artFormOrigin}
                    onChange={(e) => setArtFormOrigin(e.target.value)}
                    placeholder="Ex: Japão, Brasil, Tailândia..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Federação / Entidade Reguladora
                  </label>
                  <input
                    type="text"
                    value={artFormFederation}
                    onChange={(e) => setArtFormFederation(e.target.value)}
                    placeholder="Ex: CBJ / IJF, CBJJ, CBKB..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Descrição e Filosofia
                </label>
                <textarea
                  rows={3}
                  value={artFormDescription}
                  onChange={(e) => setArtFormDescription(e.target.value)}
                  placeholder="Descreva a modalidade, objetivos pedagógicos, linhagem do dojo..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Status de Atividade
                </label>
                <select
                  value={artFormStatus}
                  onChange={(e) => setArtFormStatus(e.target.value as 'active' | 'inactive')}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none cursor-pointer"
                >
                  <option value="active">Ativa (disponível para matrículas e graduações)</option>
                  <option value="inactive">Inativa (oculta nos formulários de alunos)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsArtModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-red-600 font-semibold text-white hover:bg-red-500 disabled:opacity-50 transition-colors shadow cursor-pointer flex items-center gap-1.5"
                >
                  {isSubmitting && <RotateCw className="h-3.5 w-3.5 animate-spin" />}
                  <span>Salvar Modalidade</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CADASTRAR / EDITAR FAIXA / GRADUAÇÃO */}
      {isBeltModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Award className="h-5 w-5 text-red-500" />
                <span>
                  {beltModalMode === 'create'
                    ? `Nova Graduação (${activeArt?.name})`
                    : `Editar Graduação: ${beltFormName}`}
                </span>
              </h3>
              <button
                onClick={() => setIsBeltModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBelt} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-slate-300 font-medium mb-1">
                    Nome da Faixa / Graduação *
                  </label>
                  <input
                    type="text"
                    required
                    value={beltFormName}
                    onChange={(e) => setBeltFormName(e.target.value)}
                    placeholder="Ex: Faixa Roxa, 1º Dan, Corda Verde..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Tipo de Graduação
                  </label>
                  <select
                    value={beltFormRankType}
                    onChange={(e) =>
                      setBeltFormRankType(e.target.value as 'faixa' | 'grau' | 'dan' | 'corda')
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none cursor-pointer"
                  >
                    <option value="faixa">Faixa (Kyu)</option>
                    <option value="dan">Dan (Preta)</option>
                    <option value="grau">Grau / Stripe</option>
                    <option value="corda">Corda</option>
                  </select>
                </div>
              </div>

              {/* Cores e Detalhes */}
              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Cor Principal da Faixa
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={beltFormColor}
                        onChange={(e) => setBeltFormColor(e.target.value)}
                        className="h-9 w-14 rounded border border-slate-700 bg-slate-800 p-0.5 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={beltFormColor}
                        onChange={(e) => setBeltFormColor(e.target.value)}
                        placeholder="#ffffff"
                        className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 font-mono text-white text-xs uppercase"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="flex items-center gap-2 text-slate-300 font-medium mb-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={beltFormHasStripe}
                        onChange={(e) => setBeltFormHasStripe(e.target.checked)}
                        className="rounded border-slate-700 text-red-600 focus:ring-red-500"
                      />
                      <span>Possui Ponta / Tarja Secundária</span>
                    </label>

                    {beltFormHasStripe ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={beltFormStripeColor}
                          onChange={(e) => setBeltFormStripeColor(e.target.value)}
                          className="h-9 w-14 rounded border border-slate-700 bg-slate-800 p-0.5 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={beltFormStripeColor}
                          onChange={(e) => setBeltFormStripeColor(e.target.value)}
                          placeholder="#ef4444"
                          className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 font-mono text-white text-xs uppercase"
                        />
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500 italic py-1.5">
                        Faixa de cor única contínua.
                      </div>
                    )}
                  </div>
                </div>

                {/* Pré-visualização da Faixa */}
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Pré-visualização:</span>
                  <div className="flex items-center gap-2.5 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
                    <div
                      className="relative h-4 w-12 rounded border border-slate-600 overflow-hidden shadow-inner"
                      style={{ backgroundColor: beltFormColor }}
                    >
                      {beltFormHasStripe && (
                        <span
                          className="absolute top-0 right-1.5 bottom-0 w-2.5 shadow-sm"
                          style={{ backgroundColor: beltFormStripeColor }}
                        ></span>
                      )}
                    </div>
                    <span className="font-bold text-white text-xs">
                      {beltFormName || 'Faixa Exemplo'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Critérios Pedagógicos */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Idade Mínima (Anos)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={beltFormMinAge}
                    onChange={(e) => setBeltFormMinAge(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500">Maturidade mínima para exame</span>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Carência Mínima (Meses de Treino)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={beltFormMinMonths}
                    onChange={(e) => setBeltFormMinMonths(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500">
                    {beltFormMinMonths === 0 ? 'Sem carência (faixa de entrada)' : `${beltFormMinMonths} meses na graduação anterior`}
                  </span>
                </div>
              </div>

              {/* Exigência de Exame */}
              <div>
                <label className="flex items-center gap-2 text-slate-300 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={beltFormRequiresExam}
                    onChange={(e) => setBeltFormRequiresExam(e.target.checked)}
                    className="rounded border-slate-700 text-red-600 focus:ring-red-500"
                  />
                  <span>Exige Exame Perante Banca Examinadora / Senseis</span>
                </label>
                <p className="text-[10px] text-slate-500 pl-5 mt-0.5">
                  Se desmarcado, a troca pode ser homologada automaticamente por tempo de frequência.
                </p>
              </div>

              {/* Requisitos Técnicos */}
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Requisitos Técnicos (Golpes, Katas, Waza e Vocabulário)
                </label>
                <textarea
                  rows={3}
                  value={beltFormRequirements}
                  onChange={(e) => setBeltFormRequirements(e.target.value)}
                  placeholder="Ex: Domínio de Dai-Ikkyo (De-ashi-harai, Hiza-guruma, Sasae-tsurikomi-ashi, Uki-goshi, Osoto-gari, O-goshi...)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsBeltModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-red-600 font-semibold text-white hover:bg-red-500 disabled:opacity-50 transition-colors shadow cursor-pointer flex items-center gap-1.5"
                >
                  {isSubmitting && <RotateCw className="h-3.5 w-3.5 animate-spin" />}
                  <span>Salvar Graduação</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-red-500/30 bg-slate-900 p-6 shadow-2xl text-slate-200 text-xs">
            <div className="flex items-center gap-3 text-red-400 mb-3">
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <h3 className="text-sm font-bold text-white">
                Confirmar Exclusão de {itemToDelete.type === 'art' ? 'Modalidade' : 'Faixa'}
              </h3>
            </div>

            <p className="text-slate-300 mb-4">
              Tem certeza que deseja excluir <strong>"{itemToDelete.name}"</strong>?
              {itemToDelete.type === 'art' && (
                <span className="block mt-2 text-red-400 font-semibold">
                  Atenção: todas as faixas e graduações associadas a esta modalidade serão removidas definitivamente.
                </span>
              )}
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                disabled={isSubmitting}
                className="px-3.5 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-lg bg-red-600 font-semibold text-white hover:bg-red-500 disabled:opacity-50 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                {isSubmitting && <RotateCw className="h-3.5 w-3.5 animate-spin" />}
                <span>Excluir Definitivamente</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
