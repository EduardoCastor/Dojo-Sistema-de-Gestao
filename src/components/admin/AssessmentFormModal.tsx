import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Scale,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Info,
  User,
  ShieldAlert,
} from 'lucide-react';
import { PhysicalAssessment, Student, Person, User as AppUser } from '../../types';
import {
  calculateExactAge,
  classifyBmi,
  getClassificationBadgeColor,
} from '../../utils/whoBmiClassification';
import { formatDateBR } from '../../utils/formatters';
import { assessmentService } from '../../services/assessmentService';

interface AssessmentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student;
  studentPerson: Person;
  currentUser?: AppUser;
  assessmentToEdit?: PhysicalAssessment | null;
  onSuccess: (saved: PhysicalAssessment, isEdit: boolean) => void;
}

export const AssessmentFormModal: React.FC<AssessmentFormModalProps> = ({
  isOpen,
  onClose,
  student,
  studentPerson,
  currentUser,
  assessmentToEdit,
  onSuccess,
}) => {
  // Obter data de hoje no formato YYYY-MM-DD
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  const [date, setDate] = useState<string>(todayStr);
  const [weightKg, setWeightKg] = useState<string>('');
  const [heightCm, setHeightCm] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [evaluatorName, setEvaluatorName] = useState<string>('');

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Inicializar formulário em caso de criação ou edição
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      if (assessmentToEdit) {
        setDate(assessmentToEdit.date || todayStr);
        setWeightKg(assessmentToEdit.weightKg ? String(assessmentToEdit.weightKg) : '');
        setHeightCm(assessmentToEdit.heightCm ? String(assessmentToEdit.heightCm) : '');
        setNotes(assessmentToEdit.notes || '');
        setEvaluatorName(
          assessmentToEdit.evaluatorName || currentUser?.name || 'Avaliador Responsável'
        );
      } else {
        setDate(todayStr);
        setWeightKg('');
        setHeightCm('');
        setNotes('');
        setEvaluatorName(currentUser?.name || 'Sensei / Avaliador');
      }
    }
  }, [isOpen, assessmentToEdit, currentUser, todayStr]);

  // Cálculo da idade na data da medição
  const ageResult = useMemo(() => {
    if (!studentPerson.birthDate) {
      return {
        formatted: 'Data de nascimento ausente',
        ageYears: undefined,
        ageMonths: undefined,
        isValid: false,
      };
    }
    const calc = calculateExactAge(studentPerson.birthDate, date);
    return {
      formatted: calc.formatted,
      ageYears: calc.years,
      ageMonths: calc.months,
      isValid: calc.isValid,
      isBeforeBirth: calc.isBeforeBirth,
    };
  }, [studentPerson.birthDate, date]);

  // Cálculo imediato de IMC e Classificação OMS/Adulto em tempo real
  const computedCalculation = useMemo(() => {
    const numWeight = parseFloat(weightKg.replace(',', '.'));
    const numHeight = parseFloat(heightCm.replace(',', '.'));

    if (isNaN(numWeight) || isNaN(numHeight) || numHeight <= 0 || numWeight <= 0) {
      return null;
    }

    const heightM = numHeight / 100;
    const rawBmi = numWeight / (heightM * heightM);
    const roundedBmi = Number(rawBmi.toFixed(1));

    const sex: 'male' | 'female' =
      studentPerson.gender === 'female' ? 'female' : 'male';

    const classificationResult = classifyBmi(
      roundedBmi,
      studentPerson.birthDate,
      sex,
      date
    );

    return {
      heightM,
      ...classificationResult,
    };
  }, [weightKg, heightCm, studentPerson.birthDate, studentPerson.gender, date]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Validações
    if (!date) {
      setErrorMsg('Informe a data da medição.');
      return;
    }

    if (date > todayStr) {
      setErrorMsg('A data da medição não pode ser posterior ao dia de hoje.');
      return;
    }

    if (studentPerson.birthDate && date < studentPerson.birthDate) {
      setErrorMsg(
        `A data da medição não pode ser anterior ao nascimento do aluno (${formatDateBR(
          studentPerson.birthDate
        )}).`
      );
      return;
    }

    const numWeight = parseFloat(weightKg.replace(',', '.'));
    const numHeight = parseFloat(heightCm.replace(',', '.'));

    if (isNaN(numWeight) || numWeight <= 0) {
      setErrorMsg('Informe um peso válido maior que zero (kg).');
      return;
    }

    if (numWeight < 5 || numWeight > 350) {
      setErrorMsg('O peso informado parece estar fora dos limites fisiológicos aceitáveis (5 a 350 kg).');
      return;
    }

    if (isNaN(numHeight) || numHeight <= 0) {
      setErrorMsg('Informe uma altura válida maior que zero (cm).');
      return;
    }

    if (numHeight < 40 || numHeight > 260) {
      setErrorMsg('A altura informada deve estar entre 40 cm e 260 cm.');
      return;
    }

    setIsSaving(true);
    try {
      const heightM = numHeight / 100;
      const bmi = Number((numWeight / (heightM * heightM)).toFixed(1));

      const sex: 'male' | 'female' =
        studentPerson.gender === 'female' ? 'female' : 'male';
      const classResult = classifyBmi(bmi, studentPerson.birthDate, sex, date);

      const payload = {
        tenantId: student.tenantId,
        studentId: student.id,
        date,
        weightKg: numWeight,
        heightCm: numHeight,
        bmi,
        ageYearsAtMeasurement: classResult.ageYearsAtMeasurement,
        ageMonthsAtMeasurement: classResult.ageMonthsAtMeasurement,
        classification: classResult.classification,
        referenceStandard: classResult.referenceStandard,
        evaluatorName: evaluatorName.trim() || currentUser?.name || 'Avaliador Tatame Club',
        recordedByUserId: currentUser?.id,
        notes: notes.trim() || undefined,
      };

      let savedRecord: PhysicalAssessment;
      if (assessmentToEdit) {
        savedRecord = await assessmentService.updateAssessment(
          assessmentToEdit.id,
          payload,
          currentUser?.name || 'Administrador'
        );
        onSuccess(savedRecord, true);
      } else {
        savedRecord = await assessmentService.createAssessment(
          payload,
          currentUser?.name || 'Administrador'
        );
        onSuccess(savedRecord, false);
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao salvar medição antropométrica.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-red-950/80 border border-red-500/30 text-red-400">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {assessmentToEdit ? 'Editar Medição Antropométrica' : 'Registrar Medição'}
              </h3>
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <User className="h-3 w-3 text-slate-500" />
                <span className="font-semibold text-slate-300">{studentPerson.fullName}</span>
                {studentPerson.birthDate && (
                  <span className="text-slate-400">
                    · Nasc.: {formatDateBR(studentPerson.birthDate)}
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-950/80 border border-red-500/50 text-red-200 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">{errorMsg}</div>
            </div>
          )}

          {/* Alerta caso data de nascimento esteja ausente */}
          {!studentPerson.birthDate && (
            <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-200 flex items-start gap-2.5">
              <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-amber-300">Data de nascimento ausente</div>
                <div className="text-[11px] text-amber-200/90 mt-0.5">
                  É altamente recomendado cadastrar a data de nascimento no perfil do aluno para permitir a classificação etária segundo os padrões da Organização Mundial da Saúde (OMS). Sem esse dado, serão aplicadas referências gerais de adultos.
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Data da medição */}
            <div className="space-y-1.5">
              <label className="block text-slate-300 font-semibold flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                Data da medição *
              </label>
              <input
                type="date"
                max={todayStr}
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-red-500 font-mono"
              />
              <div className="text-[10px] text-slate-400">
                Preenchida inicialmente com a data atual.
              </div>
            </div>

            {/* Idade calculada na data */}
            <div className="space-y-1.5">
              <label className="block text-slate-400 font-semibold">
                Idade na data da medição
              </label>
              <div className="w-full bg-slate-950/70 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 font-medium text-xs flex items-center justify-between">
                <span>{ageResult.formatted}</span>
                {ageResult.isValid && (
                  <span className="text-[10px] text-emerald-400 font-mono">Calculada</span>
                )}
              </div>
              <div className="text-[10px] text-slate-400">
                Calculada automaticamente a partir da data de nascimento.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Altura */}
            <div className="space-y-1.5">
              <label className="block text-slate-300 font-semibold">
                Altura (em centímetros) *
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.5"
                  min="40"
                  max="260"
                  required
                  placeholder="Ex: 175"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 pr-10 text-white text-xs focus:outline-none focus:border-red-500 font-mono"
                />
                <span className="absolute right-3 top-2 text-slate-500 font-mono text-xs">cm</span>
              </div>
              {parseFloat(heightCm) > 0 && (
                <div className="text-[10px] text-slate-400 font-mono">
                  = {(parseFloat(heightCm) / 100).toFixed(2)} m
                </div>
              )}
            </div>

            {/* Peso */}
            <div className="space-y-1.5">
              <label className="block text-slate-300 font-semibold">
                Peso (em quilogramas) *
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  min="5"
                  max="350"
                  required
                  placeholder="Ex: 72.5"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 pr-10 text-white text-xs focus:outline-none focus:border-red-500 font-mono"
                />
                <span className="absolute right-3 top-2 text-slate-500 font-mono text-xs">kg</span>
              </div>
            </div>
          </div>

          {/* Prévia do IMC e Classificação em Tempo Real */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/80 space-y-2">
            <div className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-2">
              <span className="font-semibold text-slate-300">Cálculo Imediato de IMC</span>
              <span className="text-[10px] text-slate-400">Fórmula: peso / (altura)²</span>
            </div>

            {computedCalculation ? (
              <div className="space-y-2 pt-1">
                <div className="flex items-baseline justify-between">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold font-mono text-emerald-400">
                      {computedCalculation.bmi}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">kg/m²</span>
                  </div>
                  <div className="text-right">
                    <span
                      className={`px-2.5 py-1 rounded text-xs font-semibold border ${getClassificationBadgeColor(
                        computedCalculation.classification
                      )}`}
                    >
                      {computedCalculation.classification}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1">
                  <span>Referência: {computedCalculation.referenceStandardLabel}</span>
                  {computedCalculation.warning && (
                    <span className="text-amber-400">{computedCalculation.warning}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-slate-500 text-center py-2 text-xs italic">
                Preencha a altura e o peso acima para calcular o IMC automaticamente.
              </div>
            )}
          </div>

          {/* Avaliador */}
          <div className="space-y-1.5">
            <label className="block text-slate-300 font-semibold">
              Nome do Avaliador / Responsável pela pesagem
            </label>
            <input
              type="text"
              value={evaluatorName}
              onChange={(e) => setEvaluatorName(e.target.value)}
              placeholder="Ex: Sensei Silva"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-red-500"
            />
          </div>

          {/* Observações opcionais */}
          <div className="space-y-1.5">
            <label className="block text-slate-300 font-semibold">
              Observações (opcional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Pesagem oficial antes do campeonato estadual; acompanhamento nutricional..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-red-500 resize-none"
            />
          </div>

          {/* Footer warning */}
          <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400 flex items-start gap-2">
            <Info className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
            <span>
              O IMC é um indicador de triagem e não substitui uma avaliação profissional de saúde.
            </span>
          </div>

          {/* Modal Actions */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center gap-2 shadow-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Salvando no sistema...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{assessmentToEdit ? 'Atualizar Medição' : 'Salvar Medição'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
