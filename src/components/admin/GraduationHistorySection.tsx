import React, { useState, useEffect, useMemo } from 'react';
import {
  Award,
  Plus,
  Edit2,
  Trash2,
  Calendar,
  User,
  Building2,
  FileCheck,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Clock,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Check,
  Copy,
  Info,
} from 'lucide-react';
import {
  Student,
  Person,
  MartialArt,
  BeltRank,
  StudentGraduation,
  User as AppUser,
} from '../../types';
import { formatDateBR } from '../../utils/formatters';
import { graduationService, MartialArtGraduationGroup } from '../../services/graduationService';
import { GraduationFormModal } from './GraduationFormModal';

interface GraduationHistorySectionProps {
  student: Student;
  studentPerson?: Person | null;
  martialArts: MartialArt[];
  beltRanks: BeltRank[];
  currentUser?: AppUser | null;
  branchName?: string;
  onStudentUpdated?: (updatedStudent: Student) => void;
}

export const GraduationHistorySection: React.FC<GraduationHistorySectionProps> = ({
  student,
  studentPerson,
  martialArts,
  beltRanks,
  currentUser,
  branchName = 'Matriz',
  onStudentUpdated,
}) => {
  const [graduations, setGraduations] = useState<StudentGraduation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal de Formulário
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [graduationToEdit, setGraduationToEdit] = useState<StudentGraduation | null>(null);
  const [formInitialArtId, setFormInitialArtId] = useState<string | undefined>(undefined);

  // Modal de Confirmação de Exclusão
  const [graduationToDelete, setGraduationToDelete] = useState<StudentGraduation | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filtro de aba de arte marcial ativa (quando o aluno tem mais de uma)
  const [activeArtFilter, setActiveArtFilter] = useState<string>('all');

  // Cópia de código do certificado
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  // Carregar histórico de graduações do aluno
  const loadHistory = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const list = await graduationService.fetchStudentGraduations(student.tenantId, student.id);
      setGraduations(list);
    } catch (err: any) {
      console.error('Erro ao carregar histórico de graduações:', err);
      setErrorMsg('Não foi possível carregar o histórico de graduações do aluno.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [student.id, student.tenantId]);

  // Agrupamento estruturado por arte marcial
  const organizedGroups: MartialArtGraduationGroup[] = useMemo(() => {
    return graduationService.organizeGraduationsByMartialArt(
      graduations,
      martialArts,
      student.currentGraduations || []
    );
  }, [graduations, martialArts, student.currentGraduations]);

  // Se a aba selecionada for de uma arte específica ou 'all'
  const visibleGroups = useMemo(() => {
    if (activeArtFilter === 'all') return organizedGroups;
    return organizedGroups.filter((g) => g.martialArtId === activeArtFilter);
  }, [organizedGroups, activeArtFilter]);

  // Sincronizar e notificar atualização do aluno quando o histórico muda
  const handleGraduationSaved = (saved: StudentGraduation, isEdit: boolean) => {
    // Atualizar lista local
    const updatedList = isEdit
      ? graduations.map((g) => (g.id === saved.id ? saved : g))
      : [saved, ...graduations.filter((g) => g.id !== saved.id)];

    setGraduations(updatedList);

    // Recalcular as graduações atuais do aluno
    const recalculatedCurrents = graduationService.recalculateStudentCurrentGraduations(
      updatedList,
      martialArts,
      beltRanks
    );

    const updatedStudent: Student = {
      ...student,
      currentGraduations: recalculatedCurrents,
    };

    onStudentUpdated?.(updatedStudent);

    setSuccessMsg(
      isEdit
        ? `Graduação "${saved.beltRankName}" atualizada com sucesso no histórico!`
        : `Nova graduação "${saved.beltRankName}" registrada com sucesso!`
    );
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // Excluir graduação
  const handleConfirmDelete = async () => {
    if (!graduationToDelete) return;

    setIsDeleting(true);
    setErrorMsg(null);
    try {
      await graduationService.deleteGraduation(
        student.tenantId,
        graduationToDelete.id,
        student.id
      );

      const updatedList = graduations.filter((g) => g.id !== graduationToDelete.id);
      setGraduations(updatedList);

      // Recalcular graduações atuais
      const recalculatedCurrents = graduationService.recalculateStudentCurrentGraduations(
        updatedList,
        martialArts,
        beltRanks
      );

      const updatedStudent: Student = {
        ...student,
        currentGraduations: recalculatedCurrents,
      };

      onStudentUpdated?.(updatedStudent);

      setSuccessMsg('Registro de graduação removido com sucesso.');
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      console.error('Erro ao excluir graduação:', err);
      setErrorMsg(err?.message || 'Falha ao excluir graduação.');
    } finally {
      setIsDeleting(false);
      setGraduationToDelete(null);
    }
  };

  const handleCopyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  // Verificar se o usuário atual tem permissão para excluir (owner, branch_manager ou superadmin)
  const canDelete =
    currentUser?.role === 'owner' ||
    currentUser?.role === 'branch_manager' ||
    currentUser?.role === 'superadmin';

  return (
    <div className="space-y-6">
      {/* Mensagens de Feedback */}
      {successMsg && (
        <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/40 text-emerald-200 text-xs flex items-center gap-2.5 shadow-lg shadow-emerald-950/20">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-950/40 text-red-200 text-xs flex items-center gap-2.5">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Header Principal da Seção com Ação de Registro */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950/70 p-4 rounded-xl border border-slate-800 shadow-md">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-red-400">
            <Award className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white tracking-tight">
                Histórico de Graduações
              </h3>
              <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                Por Modalidade
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Evolução cronológica de faixas e graus, com identificação clara da graduação vigente por arte marcial.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setGraduationToEdit(null);
            setFormInitialArtId(
              activeArtFilter !== 'all' ? activeArtFilter : organizedGroups[0]?.martialArtId
            );
            setIsFormModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-semibold text-xs transition-colors shadow-lg shadow-red-950/50 cursor-pointer shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Registrar graduação</span>
        </button>
      </div>

      {/* Seletor de Modalidades (se houver múltiplas) */}
      {organizedGroups.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-800">
          <button
            type="button"
            onClick={() => setActiveArtFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              activeArtFilter === 'all'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            Todas as Modalidades ({graduations.length})
          </button>
          {organizedGroups.map((g) => (
            <button
              key={g.martialArtId}
              type="button"
              onClick={() => setActiveArtFilter(g.martialArtId)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeArtFilter === g.martialArtId
                  ? 'bg-red-950/70 text-red-200 border border-red-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <span>{g.martialArtName}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800/80 text-slate-300">
                {g.totalCount}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Conteúdo do Histórico */}
      {isLoading ? (
        <div className="p-12 text-center text-slate-400 space-y-3">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-red-500" />
          <p className="text-xs">Carregando histórico de graduações do aluno...</p>
        </div>
      ) : organizedGroups.length === 0 ? (
        <div className="p-8 text-center rounded-xl border border-slate-800 bg-slate-950/50 space-y-3">
          <div className="h-12 w-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
            <Award className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-white text-sm">Nenhuma graduação registrada</h4>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Este aluno ainda não possui graduações ou faixas cadastradas no sistema.
              Registre a faixa inicial para começar a acompanhar sua evolução técnica.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setGraduationToEdit(null);
              setIsFormModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow transition-colors cursor-pointer mt-2"
          >
            <Plus className="h-4 w-4" />
            <span>Registrar 1ª Faixa</span>
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {visibleGroups.map((group) => {
            const hasGrads = group.graduations.length > 0;
            const current = group.currentGraduation;

            return (
              <div
                key={group.martialArtId}
                className="rounded-2xl border border-slate-800 bg-slate-950/60 overflow-hidden shadow-lg transition-all"
              >
                {/* Header da Modalidade */}
                <div className="bg-slate-900/90 border-b border-slate-800 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full bg-red-500 ring-4 ring-red-500/20" />
                    <div>
                      <h4 className="font-bold text-white text-sm">{group.martialArtName}</h4>
                      <p className="text-[11px] text-slate-400">
                        {group.totalCount === 0
                          ? 'Nenhuma graduação cadastrada para esta arte marcial'
                          : `${group.totalCount} ${
                              group.totalCount === 1 ? 'registro de graduação' : 'registros no histórico'
                            }`}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setGraduationToEdit(null);
                      setFormInitialArtId(group.martialArtId);
                      setIsFormModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5 text-red-400" />
                    <span>Graduar em {group.martialArtName}</span>
                  </button>
                </div>

                {/* Banner de Inconsistência Detectada (duas graduações na mesma data) */}
                {group.hasInconsistency && (
                  <div className="m-4 p-3 rounded-xl border border-amber-500/40 bg-amber-950/30 flex items-start gap-3 text-amber-200 text-xs">
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-semibold block text-amber-300">
                        Inconsistência identificada no histórico:
                      </strong>
                      <span>{group.inconsistencyMessage}</span>
                    </div>
                  </div>
                )}

                <div className="p-5 space-y-6">
                  {/* Bloco 1: Graduação Atual (Destaque Principal) */}
                  {current ? (
                    <div className="p-4 rounded-xl border border-red-500/30 bg-gradient-to-r from-red-950/30 to-slate-900/60 shadow-md">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5">
                          {/* Faixa visual com barra colorida */}
                          <div className="relative">
                            <span
                              className="h-10 w-4 rounded-full border border-slate-600 block shadow-inner"
                              style={{ backgroundColor: current.beltColorHex }}
                            />
                          </div>

                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/30">
                                Graduação Atual
                              </span>
                              <span className="text-xs text-slate-400 font-mono">
                                Desde {formatDateBR(current.graduatedAt)}
                              </span>
                            </div>
                            <h5 className="text-lg font-extrabold text-white mt-1">
                              {current.beltRankName}
                            </h5>
                            <div className="text-xs text-slate-300 flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                              <span>
                                Avaliador:{' '}
                                <strong className="text-slate-100">{current.examinerName}</strong>
                              </span>
                              {current.certificateCode && (
                                <span className="font-mono text-[11px] text-slate-400">
                                  Doc: {current.certificateCode}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Ações da Graduação Atual */}
                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setGraduationToEdit(current);
                              setIsFormModalOpen(true);
                            }}
                            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer"
                            title="Editar este registro"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setGraduationToDelete(current)}
                              className="p-2 rounded-lg bg-slate-800 hover:bg-red-950/80 text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-500/30 transition-colors cursor-pointer"
                              title="Excluir este registro"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {current.notes && (
                        <div className="mt-3 pt-3 border-t border-slate-800/80 text-xs text-slate-400 leading-relaxed italic">
                          "{current.notes}"
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
                      Nenhuma graduação vigente definida para {group.martialArtName}.
                    </div>
                  )}

                  {/* Bloco 2: Linha do Tempo Cronológica Completa */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h5 className="font-bold text-slate-200 text-xs flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        <span>Histórico Cronológico Completo ({group.graduations.length})</span>
                      </h5>
                      <span className="text-[11px] text-slate-500">
                        Do mais recente para o mais antigo
                      </span>
                    </div>

                    {!hasGrads ? (
                      <p className="text-xs text-slate-500 italic">
                        Sem eventos registrados no histórico desta arte marcial.
                      </p>
                    ) : (
                      <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                        {group.graduations.map((grad, idx) => {
                          const isCurrentBelt = current?.id === grad.id;

                          return (
                            <div
                              key={grad.id}
                              className={`relative p-3.5 rounded-xl border transition-colors ${
                                isCurrentBelt
                                  ? 'bg-slate-900/90 border-slate-700 ring-1 ring-slate-700/50'
                                  : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
                              }`}
                            >
                              {/* Marcador na linha do tempo */}
                              <div
                                className="absolute -left-6 top-4 h-3.5 w-3.5 rounded-full border-2 border-slate-950 shadow"
                                style={{ backgroundColor: grad.beltColorHex }}
                              />

                              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span
                                      className="h-3 w-5 rounded-sm border border-slate-600 inline-block shrink-0"
                                      style={{ backgroundColor: grad.beltColorHex }}
                                    />
                                    <strong className="text-white text-xs font-bold">
                                      {grad.beltRankName}
                                    </strong>
                                    {isCurrentBelt && (
                                      <span className="text-[10px] font-semibold text-amber-400 bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-500/30">
                                        Atual
                                      </span>
                                    )}
                                    <span className="text-[11px] text-slate-400 font-mono">
                                      · {formatDateBR(grad.graduatedAt)}
                                    </span>
                                  </div>

                                  <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                    <span>
                                      Responsável:{' '}
                                      <span className="text-slate-300 font-medium">
                                        {grad.examinerName}
                                      </span>
                                    </span>
                                    {grad.branchName && (
                                      <span>
                                        Unidade:{' '}
                                        <span className="text-slate-300">{grad.branchName}</span>
                                      </span>
                                    )}
                                    {grad.certificateCode && (
                                      <span className="inline-flex items-center gap-1 font-mono text-slate-300 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                        <FileCheck className="h-3 w-3 text-red-400" />
                                        <span>{grad.certificateCode}</span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleCopyCode(grad.certificateCode!, grad.id)
                                          }
                                          className="text-slate-500 hover:text-white transition-colors cursor-pointer ml-0.5"
                                          title="Copiar código do certificado"
                                        >
                                          {copiedCodeId === grad.id ? (
                                            <Check className="h-3 w-3 text-emerald-400" />
                                          ) : (
                                            <Copy className="h-3 w-3" />
                                          )}
                                        </button>
                                      </span>
                                    )}
                                  </div>

                                  {grad.notes && (
                                    <p className="text-xs text-slate-300 mt-1.5 leading-relaxed bg-slate-900/60 p-2 rounded border border-slate-800/80">
                                      {grad.notes}
                                    </p>
                                  )}
                                </div>

                                {/* Ações do Registro Individual */}
                                <div className="flex items-center gap-1.5 self-end sm:self-start shrink-0 pt-1 sm:pt-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setGraduationToEdit(grad);
                                      setIsFormModalOpen(true);
                                    }}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                                    title="Editar este registro"
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                  {canDelete && (
                                    <button
                                      type="button"
                                      onClick={() => setGraduationToDelete(grad)}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/50 transition-colors cursor-pointer"
                                      title="Excluir este registro"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Cadastro / Edição de Graduação */}
      <GraduationFormModal
        isOpen={isFormModalOpen}
        onClose={() => {
          setIsFormModalOpen(false);
          setGraduationToEdit(null);
          setFormInitialArtId(undefined);
        }}
        student={student}
        studentPerson={studentPerson}
        martialArts={martialArts}
        beltRanks={beltRanks}
        currentUser={currentUser}
        branchName={branchName}
        graduationToEdit={graduationToEdit}
        initialMartialArtId={formInitialArtId}
        onSuccess={handleGraduationSaved}
      />

      {/* Modal de Confirmação de Exclusão */}
      {graduationToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="p-2 rounded-lg bg-red-950/80 border border-red-500/30">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">Excluir Graduação</h4>
                <p className="text-xs text-slate-400">Esta ação não pode ser desfeita.</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Deseja realmente remover o registro da faixa{' '}
              <strong className="text-white font-bold">{graduationToDelete.beltRankName}</strong>{' '}
              ({graduationToDelete.martialArtName}) de{' '}
              <strong className="text-white font-mono">
                {formatDateBR(graduationToDelete.graduatedAt)}
              </strong>
              ? A graduação atual do aluno será recalculada automaticamente com base nas faixas
              remanescentes.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setGraduationToDelete(null)}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Excluindo...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Confirmar Exclusão</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
