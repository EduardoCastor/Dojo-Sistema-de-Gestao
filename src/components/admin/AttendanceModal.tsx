import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Check,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Calendar,
  Clock,
  Loader2,
  ArrowRight,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { ClassGroup, Student, Person, Enrollment, AttendanceRecord, User } from '../../types';
import { attendanceService } from '../../services/attendanceService';
import { DataStore } from '../../data/storage';

interface AttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  classGroup: ClassGroup;
  students: Student[];
  persons: Person[];
  enrollments: Enrollment[];
  currentUser: User;
  tenantId?: string;
  onSaveAttendance?: (records: AttendanceRecord[]) => void;
  onSaved?: () => Promise<void> | void;
  onNavigateToFullControl?: () => void;
}

export const AttendanceModal: React.FC<AttendanceModalProps> = ({
  isOpen,
  onClose,
  classGroup,
  students,
  persons,
  enrollments,
  currentUser,
  tenantId = classGroup.tenantId,
  onSaveAttendance,
  onSaved,
  onNavigateToFullControl,
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExistingSession, setIsExistingSession] = useState(false);
  const [sessionNotes, setSessionNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Alunos matriculados e ativos nesta turma
  const enrolledStudentIds = useMemo(() => {
    return enrollments
      .filter((e) => e.classGroupId === classGroup.id && e.status === 'active')
      .map((e) => e.studentId);
  }, [enrollments, classGroup.id]);

  const classStudents = useMemo(() => {
    return students.filter((s) => enrolledStudentIds.includes(s.id));
  }, [students, enrolledStudentIds]);

  // Mapa de status individual dos alunos
  const [statusMap, setStatusMap] = useState<
    Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; notes?: string }>
  >({});

  // Carregar dados de chamada pré-existente ao abrir o modal ou ao trocar de data
  useEffect(() => {
    let isCancelled = false;

    async function loadAttendanceForDate() {
      if (!isOpen || !classGroup.id || !selectedDate) return;

      setIsLoading(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      try {
        const { session, records } = await attendanceService.fetchClassAttendanceForDate(
          tenantId,
          classGroup.id,
          selectedDate
        );

        if (isCancelled) return;

        if (records && records.length > 0) {
          // Chamada já gravada no Supabase para esta data
          setIsExistingSession(true);
          setSessionNotes(session?.notes || '');

          const newMap: Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; notes?: string }> = {};
          classStudents.forEach((st) => {
            const found = records.find((r) => r.studentId === st.id);
            if (found) {
              newMap[st.id] = {
                status: found.status,
                notes: found.notes || '',
              };
            } else {
              newMap[st.id] = { status: 'present' };
            }
          });
          setStatusMap(newMap);
        } else {
          // Nova chamada: inicializa todos os matriculados como 'present'
          setIsExistingSession(false);
          setSessionNotes('');

          const defaultMap: Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; notes?: string }> = {};
          classStudents.forEach((st) => {
            defaultMap[st.id] = { status: 'present' };
          });
          setStatusMap(defaultMap);
        }
      } catch (err: any) {
        console.warn('Aviso ao consultar chamada no Supabase para o modal:', err);
        // Fallback local do DataStore
        const local = DataStore.getAttendances(tenantId).filter(
          (a) => a.classGroupId === classGroup.id && a.date === selectedDate
        );

        if (local.length > 0) {
          setIsExistingSession(true);
          const map: Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; notes?: string }> = {};
          classStudents.forEach((st) => {
            const found = local.find((r) => r.studentId === st.id);
            map[st.id] = found ? { status: found.status, notes: found.notes || '' } : { status: 'present' };
          });
          setStatusMap(map);
        } else {
          setIsExistingSession(false);
          const map: Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; notes?: string }> = {};
          classStudents.forEach((st) => {
            map[st.id] = { status: 'present' };
          });
          setStatusMap(map);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    loadAttendanceForDate();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, classGroup.id, selectedDate, tenantId, classStudents.length]);

  if (!isOpen) return null;

  const handleStatusChange = (studentId: string, status: 'present' | 'absent' | 'late' | 'excused') => {
    setStatusMap((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], status },
    }));
  };

  const handleNotesChange = (studentId: string, notes: string) => {
    setStatusMap((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], notes },
    }));
  };

  const markAll = (status: 'present' | 'absent') => {
    const updated: Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; notes?: string }> = {};
    classStudents.forEach((s) => {
      updated[s.id] = { status };
    });
    setStatusMap(updated);
  };

  // Salvar chamada no Supabase
  const handleSave = async () => {
    if (classStudents.length === 0) {
      setErrorMessage('Esta turma não possui alunos matriculados ativos.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const recordsToSave = classStudents.map((s) => {
        const current = statusMap[s.id] || { status: 'present' };
        return {
          studentId: s.id,
          status: current.status,
          notes: current.notes?.trim() || undefined,
        };
      });

      const result = await attendanceService.saveAttendance({
        tenantId,
        classGroupId: classGroup.id,
        date: selectedDate,
        startTime: classGroup.startTime,
        endTime: classGroup.endTime,
        instructorName: classGroup.headInstructorName,
        sessionStatus: 'completed',
        sessionNotes: sessionNotes.trim() || undefined,
        records: recordsToSave,
        currentUser,
      });

      setIsExistingSession(true);
      setSuccessMessage('Chamada salva com sucesso!');

      // Notificar componentes pais
      if (onSaveAttendance) {
        onSaveAttendance(result.records);
      }
      if (onSaved) {
        await onSaved();
      }

      // Fechar modal após confirmação visual breve
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      console.error('Falha ao salvar chamada no modal:', err);
      setErrorMessage(
        err?.message || 'Não foi possível salvar a chamada. Verifique suas permissões e tente novamente.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200 max-h-[92vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Cabeçalho do Modal */}
        <div className="mb-4 pr-8">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-white">Chamada de Frequência · {classGroup.name}</h3>
            {isExistingSession ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 border border-emerald-500/40 text-emerald-400">
                Chamada Registrada (Modo Edição)
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-950/60 border border-blue-500/40 text-blue-400">
                Primeiro Registro
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {classGroup.startTime} às {classGroup.endTime} · {classGroup.tatamiRoom} · Sensei {classGroup.headInstructorName}
          </p>
        </div>

        {/* Mensagens de Feedback */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl border border-red-500/30 bg-red-950/50 flex items-start gap-2.5 text-xs text-red-300">
            <ShieldAlert className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-200">Não foi possível salvar:</p>
              <p className="mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3 rounded-xl border border-emerald-500/30 bg-emerald-950/50 flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Barra de Data e Ações em Massa */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-800 bg-slate-950/70 mb-4 text-xs">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-red-500 shrink-0" />
            <span className="font-semibold text-slate-300">Data do Treino:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              disabled={isLoading || isSaving}
              className="rounded-lg border border-slate-700 bg-slate-850 px-2.5 py-1 text-white focus:border-red-500 focus:outline-none text-xs"
            />
            {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 ml-1" />}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => markAll('present')}
              disabled={isLoading || isSaving || classStudents.length === 0}
              className="px-2.5 py-1 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-900/40 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            >
              Todos Presentes
            </button>
            <button
              onClick={() => markAll('absent')}
              disabled={isLoading || isSaving || classStudents.length === 0}
              className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            >
              Marcar Faltas
            </button>
          </div>
        </div>

        {/* Lista de Alunos Matriculados */}
        {isLoading ? (
          <div className="p-10 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
            <Loader2 className="h-6 w-6 animate-spin text-red-500" />
            <span>Carregando dados de frequência...</span>
          </div>
        ) : classStudents.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl mb-6">
            Nenhum aluno matriculado ativo nesta turma. Matricule alunos na aba "Grade de Turmas" para registrar presença.
          </div>
        ) : (
          <div className="space-y-2 mb-4 max-h-[46vh] overflow-y-auto pr-1">
            {classStudents.map((s) => {
              const person = persons.find((p) => p.id === s.personId);
              const currentStatus = statusMap[s.id]?.status || 'present';
              const currentNotes = statusMap[s.id]?.notes || '';
              const belt = s.currentGraduations?.[0];

              return (
                <div
                  key={s.id}
                  className="p-3 rounded-xl border border-slate-800 bg-slate-950/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-slate-500 shrink-0"
                      style={{ backgroundColor: belt?.beltColorHex || '#fff' }}
                      title={belt?.beltName}
                    />
                    <div>
                      <div className="text-xs font-bold text-white">{person?.fullName || 'Aluno'}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {s.registrationNumber} {belt?.beltName ? `· ${belt.beltName}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 w-full sm:w-auto">
                    {/* Botões de Seleção de Presença */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStatusChange(s.id, 'present')}
                        disabled={isSaving}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                          currentStatus === 'present'
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Presente</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStatusChange(s.id, 'absent')}
                        disabled={isSaving}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                          currentStatus === 'absent'
                            ? 'bg-red-600 text-white shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <XCircle className="h-3 w-3" />
                        <span>Falta</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStatusChange(s.id, 'late')}
                        disabled={isSaving}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                          currentStatus === 'late'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        <span>Atraso</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStatusChange(s.id, 'excused')}
                        disabled={isSaving}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                          currentStatus === 'excused'
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <AlertCircle className="h-3 w-3" />
                        <span>Justificada</span>
                      </button>
                    </div>

                    {(currentStatus === 'excused' || currentStatus === 'late') && (
                      <input
                        type="text"
                        placeholder="Observação..."
                        value={currentNotes}
                        onChange={(e) => handleNotesChange(s.id, e.target.value)}
                        disabled={isSaving}
                        className="w-full sm:w-40 text-[11px] rounded border border-slate-700 bg-slate-800 px-2 py-1 text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Rodapé e Botões de Ação */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-slate-800 text-xs">
          {onNavigateToFullControl ? (
            <button
              type="button"
              onClick={onNavigateToFullControl}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer self-start sm:self-center"
            >
              <span>Abrir no Controle de Frequência</span>
              <ArrowRight className="h-3.5 w-3.5 text-red-500" />
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isLoading || classStudents.length === 0}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-500 shadow transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Salvando chamada...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>
                    {isExistingSession ? 'Atualizar Chamada' : 'Salvar Chamada'} ({classStudents.length} alunos)
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
