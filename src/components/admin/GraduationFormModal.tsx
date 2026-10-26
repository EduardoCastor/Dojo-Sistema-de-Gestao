import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Award,
  Calendar,
  User,
  Building2,
  FileCheck,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import {
  Student,
  Person,
  MartialArt,
  BeltRank,
  StudentGraduation,
  RecordGraduationPayload,
  UpdateGraduationPayload,
  User as AppUser,
} from '../../types';
import { formatDateBR } from '../../utils/formatters';

interface GraduationFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student;
  studentPerson?: Person | null;
  martialArts: MartialArt[];
  beltRanks: BeltRank[];
  currentUser?: AppUser | null;
  branchName?: string;
  graduationToEdit?: StudentGraduation | null;
  initialMartialArtId?: string;
  onSuccess: (savedGraduation: StudentGraduation, isEdit: boolean) => void;
}

export const GraduationFormModal: React.FC<GraduationFormModalProps> = ({
  isOpen,
  onClose,
  student,
  studentPerson,
  martialArts,
  beltRanks,
  currentUser,
  branchName = 'Matriz',
  graduationToEdit,
  initialMartialArtId,
  onSuccess,
}) => {
  const isEdit = Boolean(graduationToEdit);
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Form states
  const [selectedArtId, setSelectedArtId] = useState<string>('');
  const [selectedBeltId, setSelectedBeltId] = useState<string>('');
  const [graduatedAt, setGraduatedAt] = useState<string>(todayStr);
  const [examinerName, setExaminerName] = useState<string>('');
  const [certificateCode, setCertificateCode] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Inicializar o formulário ao abrir
  useEffect(() => {
    if (!isOpen) {
      setErrorMsg(null);
      return;
    }

    setErrorMsg(null);

    if (graduationToEdit) {
      setSelectedArtId(graduationToEdit.martialArtId);
      setSelectedBeltId(graduationToEdit.beltRankId);
      setGraduatedAt(graduationToEdit.graduatedAt || todayStr);
      setExaminerName(graduationToEdit.examinerName || '');
      setCertificateCode(graduationToEdit.certificateCode || '');
      setNotes(graduationToEdit.notes || '');
    } else {
      // Definir arte inicial
      const defaultArtId =
        initialMartialArtId ||
        student.currentGraduations?.[0]?.martialArtId ||
        martialArts[0]?.id ||
        '';
      setSelectedArtId(defaultArtId);

      // Limpar faixa para escolha do usuário
      setSelectedBeltId('');
      setGraduatedAt(todayStr);
      setExaminerName(currentUser?.name ? `Sensei ${currentUser.name}` : 'Sensei Responsável');
      setCertificateCode('');
      setNotes('');
    }
  }, [isOpen, graduationToEdit, initialMartialArtId, student, martialArts, currentUser, todayStr]);

  // Faixas disponíveis EXCLUSIVAMENTE para a modalidade selecionada (filtragem estrita)
  const availableBeltsForSelectedArt = useMemo(() => {
    if (!selectedArtId) return [];
    return beltRanks
      .filter((b) => b.martialArtId === selectedArtId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }, [selectedArtId, beltRanks]);

  // Quando o usuário troca de arte marcial, se a faixa selecionada não pertencer a ela, resetar
  const handleArtChange = (newArtId: string) => {
    setSelectedArtId(newArtId);
    const beltsForNewArt = beltRanks.filter((b) => b.martialArtId === newArtId);
    if (!beltsForNewArt.some((b) => b.id === selectedBeltId)) {
      setSelectedBeltId(beltsForNewArt[0]?.id || '');
    }
  };

  const selectedBelt = useMemo(() => {
    return beltRanks.find((b) => b.id === selectedBeltId);
  }, [selectedBeltId, beltRanks]);

  const selectedArt = useMemo(() => {
    return martialArts.find((a) => a.id === selectedArtId);
  }, [selectedArtId, martialArts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Validações
    if (!selectedArtId) {
      setErrorMsg('Selecione a arte marcial correspondente.');
      return;
    }

    if (!selectedBeltId) {
      setErrorMsg('Selecione a nova faixa ou graduação a ser registrada.');
      return;
    }

    if (!graduatedAt) {
      setErrorMsg('A data da graduação é obrigatória.');
      return;
    }

    // Conferência estrita: faixa precisa pertencer à modalidade
    const beltMatches = availableBeltsForSelectedArt.some((b) => b.id === selectedBeltId);
    if (!beltMatches) {
      setErrorMsg('A faixa selecionada não pertence à arte marcial informada.');
      return;
    }

    setIsSaving(true);
    try {
      if (isEdit && graduationToEdit) {
        const updatePayload: UpdateGraduationPayload = {
          id: graduationToEdit.id,
          tenantId: student.tenantId,
          studentId: student.id,
          martialArtId: selectedArtId,
          beltRankId: selectedBeltId,
          graduatedAt,
          examinerName: examinerName.trim() || 'Sensei Responsável',
          branchName,
          certificateCode: certificateCode.trim() || undefined,
          notes: notes.trim() || undefined,
        };

        const { graduationService } = await import('../../services/graduationService');
        const updated = await graduationService.updateGraduation(
          updatePayload,
          martialArts,
          beltRanks,
          currentUser?.name
        );
        onSuccess(updated, true);
      } else {
        const recordPayload: RecordGraduationPayload = {
          tenantId: student.tenantId,
          studentId: student.id,
          martialArtId: selectedArtId,
          beltRankId: selectedBeltId,
          graduatedAt,
          examinerName: examinerName.trim() || 'Sensei Responsável',
          branchName,
          certificateCode: certificateCode.trim() || undefined,
          notes: notes.trim() || undefined,
        };

        const { graduationService } = await import('../../services/graduationService');
        const created = await graduationService.recordGraduation(
          recordPayload,
          martialArts,
          beltRanks,
          currentUser?.name
        );
        onSuccess(created, false);
      }
      onClose();
    } catch (err: any) {
      console.error('Erro ao salvar graduação:', err);
      setErrorMsg(err?.message || 'Falha ao registrar graduação. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl text-slate-200 overflow-hidden my-6">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600/20 text-red-400 border border-red-500/30">
              <Award className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white leading-tight">
                {isEdit ? 'Editar Registro de Graduação' : 'Registrar Nova Graduação'}
              </h3>
              <p className="text-xs text-slate-400">
                {isEdit
                  ? 'Corrija os dados da graduação mantendo a integridade do histórico.'
                  : 'Acrescente uma nova evolução de faixa ao histórico do aluno.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Banner de Erro */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl border border-red-500/40 bg-red-950/40 flex items-start gap-3 text-red-200 text-xs">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block text-white">Não foi possível prosseguir:</strong>
                <span>{errorMsg}</span>
              </div>
            </div>
          )}

          {/* Cartão de Identificação do Aluno (Read-only) */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300 shrink-0">
                <User className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Aluno Selecionado
                </div>
                <div className="text-sm font-bold text-white truncate">
                  {studentPerson?.fullName || 'Aluno'}
                </div>
                <div className="text-xs text-slate-400 font-mono">
                  Matrícula: {student.registrationNumber}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] text-slate-400 flex items-center gap-1 justify-end">
                <Building2 className="h-3 w-3" />
                <span>{branchName}</span>
              </div>
              <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-500/30">
                {student.status === 'active' ? 'Ativo' : student.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Campo 1: Arte Marcial */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Arte Marcial <span className="text-red-400">*</span>
              </label>
              <select
                value={selectedArtId}
                onChange={(e) => handleArtChange(e.target.value)}
                disabled={isSaving}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none transition-colors cursor-pointer"
              >
                <option value="">Selecione a modalidade...</option>
                {martialArts.map((art) => (
                  <option key={art.id} value={art.id}>
                    {art.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Apenas faixas desta modalidade serão disponibilizadas.
              </p>
            </div>

            {/* Campo 2: Faixa / Graduação (Filtrada por arte) */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Nova Graduação / Faixa <span className="text-red-400">*</span>
              </label>
              <select
                value={selectedBeltId}
                onChange={(e) => setSelectedBeltId(e.target.value)}
                disabled={isSaving || !selectedArtId || availableBeltsForSelectedArt.length === 0}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none transition-colors cursor-pointer disabled:opacity-50"
              >
                <option value="">
                  {availableBeltsForSelectedArt.length === 0
                    ? 'Nenhuma faixa cadastrada para esta arte'
                    : 'Selecione a graduação...'}
                </option>
                {availableBeltsForSelectedArt.map((belt) => (
                  <option key={belt.id} value={belt.id}>
                    {belt.name} ({belt.rankType})
                  </option>
                ))}
              </select>

              {/* Preview visual da faixa selecionada */}
              {selectedBelt && (
                <div className="flex items-center gap-2 mt-1.5 p-1.5 rounded bg-slate-950/80 border border-slate-800">
                  <span
                    className="h-3.5 w-7 rounded-sm border border-slate-600 shrink-0 shadow-sm"
                    style={{ backgroundColor: selectedBelt.colorHex }}
                  />
                  <span className="text-xs font-medium text-slate-200">
                    {selectedBelt.name}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Campo 3: Data da Graduação */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Data da Graduação <span className="text-red-400">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setGraduatedAt(todayStr)}
                  className="text-[10px] text-red-400 hover:text-red-300 font-medium underline cursor-pointer"
                >
                  Definir Hoje
                </button>
              </div>
              <div className="relative">
                <input
                  type="date"
                  value={graduatedAt}
                  onChange={(e) => setGraduatedAt(e.target.value)}
                  disabled={isSaving}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none transition-colors"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Pode ser informada uma data anterior (registro retroativo).
              </p>
            </div>

            {/* Campo 4: Professor / Avaliador */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Professor ou Responsável pela Avaliação
              </label>
              <input
                type="text"
                placeholder="Ex: Sensei Takeshi Sato"
                value={examinerName}
                onChange={(e) => setExaminerName(e.target.value)}
                disabled={isSaving}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-red-500 focus:outline-none transition-colors"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Nome do mestre ou sensei que realizou o exame.
              </p>
            </div>
          </div>

          {/* Campo 5: Código do Certificado / Documento Comprobatório */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Documento Comprobatório / Código do Certificado (Opcional)
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                <FileCheck className="h-4 w-4" />
              </div>
              <input
                type="text"
                placeholder="Ex: CERT-JUDO-2025-089 ou Registro da Federação"
                value={certificateCode}
                onChange={(e) => setCertificateCode(e.target.value)}
                disabled={isSaving}
                className="w-full pl-9 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-red-500 focus:outline-none transition-colors"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Número de certificado, homologação da federação ou link de ata.
            </p>
          </div>

          {/* Campo 6: Observações */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Observações & Parecer Técnico (Opcional)
            </label>
            <textarea
              rows={2}
              placeholder="Descreva detalhes do exame, técnicas avaliadas, motivo da promoção ou méritos do aluno..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isSaving}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-red-500 focus:outline-none transition-colors resize-none"
            />
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-lg shadow-red-950/40 disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Salvando no banco...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{isEdit ? 'Atualizar Graduação' : 'Salvar Graduação'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
