import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Search,
  Filter,
  Download,
  Printer,
  Edit2,
  Users,
  Award,
  RefreshCw,
  Info,
  Check,
  ChevronRight,
  ShieldCheck,
  FileSpreadsheet,
  UserCheck,
} from 'lucide-react';
import {
  ClassGroup,
  Student,
  Person,
  Enrollment,
  AttendanceRecord,
  ClassSession,
  User,
  MartialArt,
  BeltRank,
  Branch,
} from '../../types';
import { attendanceService, AttendanceHistoryFilters } from '../../services/attendanceService';
import { formatCPF } from '../../utils/formatters';

interface AttendanceViewProps {
  classes: ClassGroup[];
  enrollments: Enrollment[];
  students: Student[];
  persons: Person[];
  martialArts: MartialArt[];
  beltRanks?: BeltRank[];
  branches?: Branch[];
  currentUser: User;
  tenantId: string;
  tenantName: string;
  initialClassGroup?: ClassGroup | null;
  onRefreshData?: () => Promise<void>;
  onNavigateToClasses?: () => void;
}

export const AttendanceView: React.FC<AttendanceViewProps> = ({
  classes,
  enrollments,
  students,
  persons,
  martialArts,
  beltRanks = [],
  branches = [],
  currentUser,
  tenantId,
  tenantName,
  initialClassGroup = null,
  onRefreshData,
  onNavigateToClasses,
}) => {
  // Abas do Módulo de Frequência
  const [activeTab, setActiveTab] = useState<'roll_call' | 'history' | 'student_sheet'>('roll_call');

  // ==========================================
  // ESTADOS DA ABA 1: CHAMADA OPERACIONAL
  // ==========================================
  const activeClasses = useMemo(() => classes.filter((c) => c.active), [classes]);
  const [selectedClassId, setSelectedClassId] = useState<string>(
    initialClassGroup?.id || activeClasses[0]?.id || ''
  );
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId) || activeClasses[0] || null,
    [classes, activeClasses, selectedClassId]
  );

  // Alunos matriculados ativos na turma selecionada
  const enrolledStudentIds = useMemo(() => {
    if (!selectedClass) return [];
    return enrollments
      .filter((e) => e.classGroupId === selectedClass.id && e.status === 'active')
      .map((e) => e.studentId);
  }, [enrollments, selectedClass]);

  const classStudents = useMemo(() => {
    return students.filter((s) => enrolledStudentIds.includes(s.id));
  }, [students, enrolledStudentIds]);

  // Mapa de status individual dos alunos na chamada em andamento
  const [studentStatusMap, setStudentStatusMap] = useState<
    Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; notes?: string }>
  >({});

  const [sessionNotes, setSessionNotes] = useState('');
  const [sessionStatus, setSessionStatus] = useState<'completed' | 'open'>('completed');
  const [isExistingSession, setIsExistingSession] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Mapas rápidos de apoio
  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const personMap = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);
  const martialArtMap = useMemo(() => new Map(martialArts.map((m) => [m.id, m])), [martialArts]);
  const beltRankMap = useMemo(() => new Map(beltRanks.map((b) => [b.id, b])), [beltRanks]);

  // Carregar dados de chamada pré-existente ao trocar turma ou data
  useEffect(() => {
    let isCancelled = false;

    async function loadExistingAttendance() {
      if (!selectedClass || !selectedDate) return;

      setIsLoadingSession(true);
      setFeedbackMessage(null);

      try {
        const { session, records } = await attendanceService.fetchClassAttendanceForDate(
          tenantId,
          selectedClass.id,
          selectedDate
        );

        if (isCancelled) return;

        if (records && records.length > 0) {
          // Chamada já registrada anteriormente: preencher os estados persistidos
          setIsExistingSession(true);
          setSessionStatus(session?.status === 'open' ? 'open' : 'completed');
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
          setStudentStatusMap(newMap);
        } else {
          // Chamada ainda não registrada para este dia: inicializar alunos com 'present' como padrão
          setIsExistingSession(false);
          setSessionStatus('completed');
          setSessionNotes('');

          const defaultMap: Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; notes?: string }> = {};
          classStudents.forEach((st) => {
            defaultMap[st.id] = { status: 'present' };
          });
          setStudentStatusMap(defaultMap);
        }
      } catch (err) {
        console.warn('Aviso ao carregar chamada:', err);
      } finally {
        if (!isCancelled) {
          setIsLoadingSession(false);
        }
      }
    }

    loadExistingAttendance();

    return () => {
      isCancelled = true;
    };
  }, [tenantId, selectedClassId, selectedDate, classStudents.length]);

  // Atualizar seleção de status do aluno
  const handleSetStudentStatus = (studentId: string, status: 'present' | 'absent' | 'late' | 'excused') => {
    setStudentStatusMap((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || {}),
        status,
      },
    }));
  };

  const handleSetStudentNotes = (studentId: string, notes: string) => {
    setStudentStatusMap((prev) => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || { status: 'present' }),
        notes,
      },
    }));
  };

  const handleMarkAll = (status: 'present' | 'absent') => {
    const updated: Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; notes?: string }> = {};
    classStudents.forEach((s) => {
      updated[s.id] = {
        ...(studentStatusMap[s.id] || {}),
        status,
      };
    });
    setStudentStatusMap(updated);
  };

  // Salvar chamada no Supabase
  const handleSaveAttendance = async () => {
    if (!selectedClass) {
      setFeedbackMessage({ type: 'error', text: 'Selecione uma turma válida.' });
      return;
    }
    if (classStudents.length === 0) {
      setFeedbackMessage({ type: 'error', text: 'Esta turma não possui alunos matriculados para chamada.' });
      return;
    }

    setIsSaving(true);
    setFeedbackMessage(null);

    try {
      const recordsToSave = classStudents.map((s) => {
        const current = studentStatusMap[s.id] || { status: 'present' };
        return {
          studentId: s.id,
          status: current.status,
          notes: current.notes?.trim() || undefined,
        };
      });

      await attendanceService.saveAttendance({
        tenantId,
        classGroupId: selectedClass.id,
        date: selectedDate,
        startTime: selectedClass.startTime,
        endTime: selectedClass.endTime,
        instructorName: selectedClass.headInstructorName,
        sessionStatus,
        sessionNotes: sessionNotes.trim() || undefined,
        records: recordsToSave,
        currentUser,
      });

      setIsExistingSession(true);
      setFeedbackMessage({
        type: 'success',
        text: `Chamada da turma "${selectedClass.name}" para ${selectedDate} salva com sucesso no Supabase!`,
      });

      if (onRefreshData) {
        await onRefreshData();
      }
      // Recarregar histórico
      loadHistory();
    } catch (err: any) {
      console.error('Falha ao salvar chamada:', err);
      setFeedbackMessage({
        type: 'error',
        text: err?.message || 'Erro ao persistir chamada no Supabase.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // ==========================================
  // ESTADOS DA ABA 2: HISTÓRICO & PESQUISA
  // ==========================================
  const [historyFilters, setHistoryFilters] = useState<AttendanceHistoryFilters>({
    classGroupId: 'all',
    studentId: 'all',
    date: '',
    startDate: '',
    endDate: '',
    status: 'all',
    searchTerm: '',
  });

  const [historySessions, setHistorySessions] = useState<ClassSession[]>([]);
  const [historyAttendances, setHistoryAttendances] = useState<AttendanceRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [selectedSessionForModal, setSelectedSessionForModal] = useState<ClassSession | null>(null);

  const loadHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const [sessions, attendances] = await Promise.all([
        attendanceService.fetchSessions(tenantId, {
          classGroupId: historyFilters.classGroupId !== 'all' ? historyFilters.classGroupId : undefined,
          date: historyFilters.date || undefined,
          startDate: historyFilters.startDate || undefined,
          endDate: historyFilters.endDate || undefined,
        }),
        attendanceService.fetchAttendances(tenantId, historyFilters),
      ]);
      setHistorySessions(sessions);
      setHistoryAttendances(attendances);
    } catch (err) {
      console.warn('Erro ao carregar histórico:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab, tenantId, historyFilters.classGroupId, historyFilters.date, historyFilters.startDate, historyFilters.endDate, historyFilters.status]);

  // Cruzar sessões com estatísticas reais de frequência
  const sessionSummaries = useMemo(() => {
    return historySessions.map((session) => {
      const cls = classes.find((c) => c.id === session.classGroupId);
      const sessionRecords = historyAttendances.filter(
        (a) => a.classGroupId === session.classGroupId && a.date === session.sessionDate
      );

      const presentCount = sessionRecords.filter((r) => r.status === 'present').length;
      const absentCount = sessionRecords.filter((r) => r.status === 'absent').length;
      const lateCount = sessionRecords.filter((r) => r.status === 'late').length;
      const excusedCount = sessionRecords.filter((r) => r.status === 'excused').length;
      const totalStudents = sessionRecords.length;
      const effectivePresent = presentCount + lateCount;
      const attendanceRate = totalStudents > 0 ? Math.round((effectivePresent / totalStudents) * 100) : 0;

      return {
        session,
        classGroup: cls,
        presentCount,
        absentCount,
        lateCount,
        excusedCount,
        totalStudents,
        attendanceRate,
        records: sessionRecords,
      };
    }).filter((item) => {
      if (historyFilters.searchTerm?.trim()) {
        const term = historyFilters.searchTerm.toLowerCase().trim();
        const matchClassName = item.classGroup?.name.toLowerCase().includes(term);
        const matchInst = item.session.instructorName?.toLowerCase().includes(term);
        if (!matchClassName && !matchInst) return false;
      }
      return true;
    });
  }, [historySessions, historyAttendances, classes, historyFilters.searchTerm]);

  // Métricas agregadas do Histórico
  const overallMetrics = useMemo(() => {
    let totalClasses = sessionSummaries.length;
    let totalPresences = 0;
    let totalAbsences = 0;
    let totalLates = 0;
    let totalExcused = 0;

    sessionSummaries.forEach((s) => {
      totalPresences += s.presentCount;
      totalAbsences += s.absentCount;
      totalLates += s.lateCount;
      totalExcused += s.excusedCount;
    });

    const totalRecords = totalPresences + totalAbsences + totalLates + totalExcused;
    const overallRate = totalRecords > 0 ? Math.round(((totalPresences + totalLates) / totalRecords) * 100) : 0;

    return {
      totalClasses,
      totalPresences,
      totalAbsences,
      totalLates,
      totalExcused,
      overallRate,
    };
  }, [sessionSummaries]);

  // Exportar histórico para CSV
  const handleExportHistoryCSV = () => {
    const headers = [
      'Data da Aula',
      'Turma',
      'Modalidade',
      'Horário',
      'Instrutor',
      'Situação da Chamada',
      'Total de Alunos',
      'Presentes',
      'Faltas',
      'Atrasos',
      'Justificadas',
      'Taxa de Presença (%)',
    ];

    const rows = sessionSummaries.map((s) => {
      const art = s.classGroup ? martialArtMap.get(s.classGroup.martialArtId) : null;
      return [
        s.session.sessionDate,
        s.classGroup?.name || 'Turma',
        art?.name || '-',
        `${s.session.scheduledStartTime || s.classGroup?.startTime || '--:--'} às ${s.session.scheduledEndTime || s.classGroup?.endTime || '--:--'}`,
        s.session.instructorName || s.classGroup?.headInstructorName || 'Sensei',
        s.session.status === 'completed' ? 'Finalizada' : 'Em Aberto',
        s.totalStudents,
        s.presentCount,
        s.absentCount,
        s.lateCount,
        s.excusedCount,
        `${s.attendanceRate}%`,
      ];
    });

    attendanceService.exportAttendanceToCSV(
      'historico_chamadas_tatamehub',
      headers,
      rows,
      {
        title: 'Relatório Histórico de Frequência e Chamadas',
        academy: tenantName,
        date: new Date().toLocaleDateString('pt-BR'),
      }
    );
  };

  // Abrir uma chamada do histórico diretamente no modo de edição da Aba 1
  const handleOpenCallInRollTab = (classId: string, date: string) => {
    setSelectedClassId(classId);
    setSelectedDate(date);
    setActiveTab('roll_call');
  };

  // ==========================================
  // ESTADOS DA ABA 3: FICHA INDIVIDUAL DO ALUNO
  // ==========================================
  const [selectedStudentId, setSelectedStudentId] = useState<string>(students[0]?.id || '');
  const [studentSearchTerm, setStudentSearchTerm] = useState('');

  const filteredStudentList = useMemo(() => {
    if (!studentSearchTerm.trim()) return students;
    const term = studentSearchTerm.toLowerCase().trim();
    return students.filter((st) => {
      const p = personMap.get(st.personId);
      return (
        p?.fullName.toLowerCase().includes(term) ||
        st.registrationNumber.toLowerCase().includes(term) ||
        (p?.cpf && p.cpf.includes(term))
      );
    });
  }, [students, personMap, studentSearchTerm]);

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) || students[0] || null,
    [students, selectedStudentId]
  );

  const selectedStudentPerson = useMemo(
    () => (selectedStudent ? personMap.get(selectedStudent.personId) : null),
    [selectedStudent, personMap]
  );

  const studentSummary = useMemo(() => {
    if (!selectedStudent) return null;
    return attendanceService.calculateStudentSummary(selectedStudent.id, historyAttendances);
  }, [selectedStudent, historyAttendances]);

  // Exportar ficha individual do aluno para CSV
  const handleExportStudentSheetCSV = () => {
    if (!selectedStudent || !selectedStudentPerson || !studentSummary) return;

    const headers = ['Data', 'Turma', 'Horário', 'Situação', 'Instrutor Responsável', 'Observações'];
    const rows = studentSummary.records.map((r) => {
      const cls = classes.find((c) => c.id === r.classGroupId);
      const statusLabels = {
        present: 'Presente',
        absent: 'Falta',
        late: 'Atraso',
        excused: 'Falta Justificada',
      };
      return [
        r.date,
        cls?.name || 'Turma',
        cls ? `${cls.startTime} - ${cls.endTime}` : '-',
        statusLabels[r.status] || r.status,
        r.recordedByUserName || 'Sensei',
        r.notes || '',
      ];
    });

    attendanceService.exportAttendanceToCSV(
      `frequencia_${selectedStudentPerson.fullName.replace(/\s+/g, '_')}`,
      headers,
      rows,
      {
        title: `Ficha Individual de Frequência - ${selectedStudentPerson.fullName} (Matrícula: ${selectedStudent.registrationNumber})`,
        academy: tenantName,
        date: new Date().toLocaleDateString('pt-BR'),
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* CABEÇALHO DO MÓDULO */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-red-500" />
              Controle de Frequência & Chamadas
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-950/60 border border-red-500/30 text-red-400">
              Persistência Supabase
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Registro diário de presença, atrasos e justificativas com consultas históricas completas e ficha individual.
          </p>
        </div>

        {/* NAVEGAÇÃO ENTRE ABAS */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('roll_call')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === 'roll_call'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <CheckCircle2 className="h-4 w-4" />
            Chamada Operacional
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === 'history'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Clock className="h-4 w-4" />
            Histórico & Pesquisa
          </button>
          <button
            onClick={() => setActiveTab('student_sheet')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
              activeTab === 'student_sheet'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <UserCheck className="h-4 w-4" />
            Ficha do Aluno
          </button>
        </div>
      </div>

      {/* FEEDBACK BANNER */}
      {feedbackMessage && (
        <div
          className={`flex items-center justify-between p-4 rounded-xl border text-xs font-medium animate-fadeIn ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
              : 'bg-red-950/50 border-red-500/40 text-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMessage.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            )}
            <span>{feedbackMessage.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="text-slate-400 hover:text-white ml-2 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 1: CHAMADA OPERACIONAL                                     */}
      {/* ============================================================== */}
      {activeTab === 'roll_call' && (
        <div className="space-y-6">
          {/* BARRA DE SELEÇÃO: DATA E TURMA */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
            {/* Selecionar Turma */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>1. Turma Ativa</span>
                {onNavigateToClasses && (
                  <button
                    onClick={onNavigateToClasses}
                    className="text-[11px] text-red-400 hover:text-red-300 underline cursor-pointer"
                  >
                    Gerenciar Turmas
                  </button>
                )}
              </label>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none"
              >
                {activeClasses.map((c) => {
                  const art = martialArtMap.get(c.martialArtId);
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name} ({art?.name || 'Arte Marcial'} · {c.startTime}-{c.endTime})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Selecionar Data */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>2. Data da Aula</span>
                <div className="flex gap-1 text-[11px]">
                  <button
                    onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
                    className="text-slate-400 hover:text-white hover:underline cursor-pointer"
                  >
                    Hoje
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() - 1);
                      setSelectedDate(d.toISOString().split('T')[0]);
                    }}
                    className="text-slate-400 hover:text-white hover:underline cursor-pointer"
                  >
                    Ontem
                  </button>
                </div>
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Situação da Chamada e Ações Rápidas */}
            <div className="space-y-1.5 flex flex-col justify-end">
              <label className="text-xs font-semibold text-slate-300">Status da Chamada</label>
              <div className="flex items-center gap-2">
                <select
                  value={sessionStatus}
                  onChange={(e) => setSessionStatus(e.target.value as 'completed' | 'open')}
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none font-medium"
                >
                  <option value="completed">Finalizada (Concluída)</option>
                  <option value="open">Em Aberto (Parcial)</option>
                </select>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleMarkAll('present')}
                    title="Marcar todos como presentes"
                    className="px-2.5 py-2 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-900/60 text-[11px] font-semibold cursor-pointer shrink-0"
                  >
                    Todos P
                  </button>
                  <button
                    onClick={() => handleMarkAll('absent')}
                    title="Marcar todos como ausentes"
                    className="px-2.5 py-2 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-400 hover:bg-rose-900/60 text-[11px] font-semibold cursor-pointer shrink-0"
                  >
                    Todos F
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* CARD DE DETALHES DA TURMA SELECIONADA */}
          {selectedClass && (
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl border border-slate-800 bg-slate-950/60 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <span className="text-slate-400">Modalidade:</span>{' '}
                  <span className="font-semibold text-white">
                    {martialArtMap.get(selectedClass.martialArtId)?.name || 'Artes Marciais'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Horário:</span>{' '}
                  <span className="font-semibold text-white">
                    {selectedClass.startTime} às {selectedClass.endTime}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Espaço:</span>{' '}
                  <span className="font-semibold text-white">{selectedClass.tatamiRoom}</span>
                </div>
                <div>
                  <span className="text-slate-400">Instrutor:</span>{' '}
                  <span className="font-semibold text-white">{selectedClass.headInstructorName}</span>
                </div>
                <div>
                  <span className="text-slate-400">Matriculados:</span>{' '}
                  <span className="font-semibold text-white">
                    {classStudents.length} / {selectedClass.maxCapacity} alunos
                  </span>
                </div>
              </div>

              {/* Status de persistência desta data */}
              <div className="flex items-center gap-2">
                {isLoadingSession ? (
                  <span className="flex items-center gap-1.5 text-slate-400 text-xs">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-red-500" />
                    Consultando Supabase...
                  </span>
                ) : isExistingSession ? (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    Chamada Registrada no Banco
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/70 border border-amber-500/40 text-amber-300 text-[11px] font-semibold">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                    Nova Chamada (Não Gravada)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* LISTA OPERACIONAL DE ALUNOS NA CHAMADA */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-2">
              <span>Relação de Alunos Matriculados ({classStudents.length})</span>
              <span className="text-[11px] text-slate-500">
                P = Presente · F = Falta · A = Atraso · J = Justificada
              </span>
            </div>

            {classStudents.length === 0 ? (
              <div className="p-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40">
                <Users className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-300">Nenhum aluno matriculado nesta turma</p>
                <p className="text-xs text-slate-500 mt-1">
                  Adicione matrículas na tela de Turmas & Horários para realizar a chamada.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {classStudents.map((st, index) => {
                  const person = personMap.get(st.personId);
                  const currentData = studentStatusMap[st.id] || { status: 'present' };
                  const grad = st.currentGraduations?.[0];
                  const belt = grad ? beltRankMap.get(grad.beltId) : null;

                  return (
                    <div
                      key={st.id}
                      className={`flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-xl border transition-all ${
                        currentData.status === 'present'
                          ? 'border-emerald-500/20 bg-slate-900/80 hover:border-emerald-500/40'
                          : currentData.status === 'absent'
                          ? 'border-rose-500/30 bg-rose-950/10 hover:border-rose-500/50'
                          : currentData.status === 'late'
                          ? 'border-amber-500/30 bg-amber-950/10 hover:border-amber-500/50'
                          : 'border-sky-500/30 bg-sky-950/10 hover:border-sky-500/50'
                      }`}
                    >
                      {/* Identificação do Aluno */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-300 text-xs font-bold shrink-0 border border-slate-700">
                          {person?.fullName.substring(0, 2).toUpperCase() || 'AL'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white truncate">
                              {person?.fullName || 'Aluno Sem Nome'}
                            </span>
                            {belt && (
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-bold shrink-0"
                                style={{
                                  backgroundColor: `${belt.colorHex}22`,
                                  color: belt.colorHex,
                                  borderColor: belt.colorHex,
                                  borderWidth: 1,
                                }}
                              >
                                {belt.name}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Matrícula: {st.registrationNumber} · CPF: {person?.cpf ? formatCPF(person.cpf) : '-'}
                          </div>
                        </div>
                      </div>

                      {/* Botões de Seleção de Frequência e Observação */}
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        {/* Botões P, F, A, J */}
                        <div className="grid grid-cols-4 sm:flex items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-xl">
                          <button
                            type="button"
                            onClick={() => handleSetStudentStatus(st.id, 'present')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                              currentData.status === 'present'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'text-slate-400 hover:text-emerald-400 hover:bg-emerald-950/30'
                            }`}
                          >
                            Presente
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetStudentStatus(st.id, 'absent')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                              currentData.status === 'absent'
                                ? 'bg-rose-600 text-white shadow-sm'
                                : 'text-slate-400 hover:text-rose-400 hover:bg-rose-950/30'
                            }`}
                          >
                            Falta
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetStudentStatus(st.id, 'late')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                              currentData.status === 'late'
                                ? 'bg-amber-600 text-white shadow-sm'
                                : 'text-slate-400 hover:text-amber-400 hover:bg-amber-950/30'
                            }`}
                          >
                            Atraso
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetStudentStatus(st.id, 'excused')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                              currentData.status === 'excused'
                                ? 'bg-sky-600 text-white shadow-sm'
                                : 'text-slate-400 hover:text-sky-400 hover:bg-sky-950/30'
                            }`}
                          >
                            Justificada
                          </button>
                        </div>

                        {/* Observação rápida */}
                        <input
                          type="text"
                          placeholder="Obs (ex: atestado, atraso de 10m)..."
                          value={currentData.notes || ''}
                          onChange={(e) => handleSetStudentNotes(st.id, e.target.value)}
                          className="w-full sm:w-44 rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* OBSERVAÇÕES GERAIS DA SESSÃO E BOTÃO DE GRAVAÇÃO */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3">
            <label className="text-xs font-semibold text-slate-300">
              Observações Gerais do Treino (Opcional)
            </label>
            <textarea
              rows={2}
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
              placeholder="Ex: Treino focado em técnicas de passagem de guarda e quedas; avaliação para próximo exame..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
            />

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Gravação atômica direta no Supabase com isolamento por <code className="text-slate-300">tenant_id</code>.
              </div>

              <button
                type="button"
                onClick={handleSaveAttendance}
                disabled={isSaving || classStudents.length === 0}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg shadow-red-900/30 transition-all disabled:opacity-50 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Gravando no Supabase...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    {isExistingSession ? 'Salvar Alterações da Chamada' : 'Salvar Chamada no Banco de Dados'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 2: HISTÓRICO & PESQUISA DE CHAMADAS                        */}
      {/* ============================================================== */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* BARRA DE FILTROS AVANÇADOS */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              {/* Filtro por Turma */}
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Filtrar por Turma</label>
                <select
                  value={historyFilters.classGroupId}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, classGroupId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                >
                  <option value="all">Todas as Turmas</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Data Início */}
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Data Inicial</label>
                <input
                  type="date"
                  value={historyFilters.startDate}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, startDate: e.target.value }))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              {/* Data Término */}
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Data Final</label>
                <input
                  type="date"
                  value={historyFilters.endDate}
                  onChange={(e) => setHistoryFilters((prev) => ({ ...prev, endDate: e.target.value }))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              {/* Busca Textual */}
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Pesquisar Turma / Instrutor</label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Nome da turma ou sensei..."
                    value={historyFilters.searchTerm}
                    onChange={(e) => setHistoryFilters((prev) => ({ ...prev, searchTerm: e.target.value }))}
                    className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Ações de Filtro */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
              <button
                onClick={() =>
                  setHistoryFilters({
                    classGroupId: 'all',
                    studentId: 'all',
                    date: '',
                    startDate: '',
                    endDate: '',
                    status: 'all',
                    searchTerm: '',
                  })
                }
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                Limpar Todos os Filtros
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimir
                </button>
                <button
                  onClick={handleExportHistoryCSV}
                  disabled={sessionSummaries.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold shadow cursor-pointer disabled:opacity-50"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Exportar CSV
                </button>
              </div>
            </div>
          </div>

          {/* CARDS DE MÉTRICAS AGREGADAS */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3.5 rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="text-[11px] text-slate-400">Total de Aulas</div>
              <div className="text-xl font-bold text-white mt-1">{overallMetrics.totalClasses}</div>
            </div>
            <div className="p-3.5 rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="text-[11px] text-slate-400">Taxa Média</div>
              <div className="text-xl font-bold text-emerald-400 mt-1">{overallMetrics.overallRate}%</div>
            </div>
            <div className="p-3.5 rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="text-[11px] text-slate-400">Presenças</div>
              <div className="text-xl font-bold text-emerald-400 mt-1">{overallMetrics.totalPresences}</div>
            </div>
            <div className="p-3.5 rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="text-[11px] text-slate-400">Faltas</div>
              <div className="text-xl font-bold text-rose-400 mt-1">{overallMetrics.totalAbsences}</div>
            </div>
            <div className="p-3.5 rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="text-[11px] text-slate-400">Atrasos</div>
              <div className="text-xl font-bold text-amber-400 mt-1">{overallMetrics.totalLates}</div>
            </div>
            <div className="p-3.5 rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="text-[11px] text-slate-400">Justificadas</div>
              <div className="text-xl font-bold text-sky-400 mt-1">{overallMetrics.totalExcused}</div>
            </div>
          </div>

          {/* TABELA DE SESSÕES HISTÓRICAS */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Data da Aula</th>
                    <th className="py-3 px-4">Turma & Modalidade</th>
                    <th className="py-3 px-4">Horário & Sala</th>
                    <th className="py-3 px-4">Instrutor</th>
                    <th className="py-3 px-4 text-center">Alunos</th>
                    <th className="py-3 px-4 text-center">Presentes</th>
                    <th className="py-3 px-4 text-center">Faltas</th>
                    <th className="py-3 px-4 text-center">Taxa</th>
                    <th className="py-3 px-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {isLoadingHistory ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        <RefreshCw className="h-5 w-5 animate-spin text-red-500 mx-auto mb-2" />
                        Carregando histórico do Supabase...
                      </td>
                    </tr>
                  ) : sessionSummaries.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-500">
                        Nenhuma chamada encontrada com os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    sessionSummaries.map((item) => (
                      <tr key={item.session.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-semibold text-white whitespace-nowrap">
                          {item.session.sessionDate}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{item.classGroup?.name || 'Turma'}</div>
                          <div className="text-[11px] text-slate-400">
                            {martialArtMap.get(item.classGroup?.martialArtId || '')?.name || '-'}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div>
                            {item.session.scheduledStartTime || item.classGroup?.startTime} às{' '}
                            {item.session.scheduledEndTime || item.classGroup?.endTime}
                          </div>
                          <div className="text-[11px] text-slate-500">{item.classGroup?.tatamiRoom}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          {item.session.instructorName || item.classGroup?.headInstructorName}
                        </td>
                        <td className="py-3 px-4 text-center font-bold text-white">{item.totalStudents}</td>
                        <td className="py-3 px-4 text-center text-emerald-400 font-semibold">
                          {item.presentCount + item.lateCount}
                        </td>
                        <td className="py-3 px-4 text-center text-rose-400 font-semibold">{item.absentCount}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              item.attendanceRate >= 80
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                                : item.attendanceRate >= 50
                                ? 'bg-amber-950 text-amber-400 border border-amber-500/30'
                                : 'bg-rose-950 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {item.attendanceRate}%
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => handleOpenCallInRollTab(item.session.classGroupId, item.session.sessionDate)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer transition-colors"
                          >
                            <Edit2 className="h-3 w-3 text-red-400" />
                            Editar Chamada
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 3: FICHA INDIVIDUAL DO ALUNO                               */}
      {/* ============================================================== */}
      {activeTab === 'student_sheet' && (
        <div className="space-y-6">
          {/* SELEÇÃO DO ALUNO */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-2xl text-xs">
            <div>
              <label className="font-semibold text-slate-300 mb-1 block">Pesquisar Aluno</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Nome, matrícula ou CPF..."
                  value={studentSearchTerm}
                  onChange={(e) => setStudentSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-300 mb-1 block">Selecione o Aluno</label>
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              >
                {filteredStudentList.map((st) => {
                  const p = personMap.get(st.personId);
                  return (
                    <option key={st.id} value={st.id}>
                      {p?.fullName || 'Aluno'} (Matrícula: {st.registrationNumber})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* PAINEL DE DESEMPENHO DO ALUNO */}
          {selectedStudent && selectedStudentPerson && studentSummary && (
            <div className="space-y-4">
              {/* Header do Aluno */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl border border-slate-800 bg-slate-900">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600 text-white font-bold text-base shadow shrink-0">
                    {selectedStudentPerson.fullName.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">{selectedStudentPerson.fullName}</h3>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Matrícula: <span className="text-white font-semibold">{selectedStudent.registrationNumber}</span> · CPF: {selectedStudentPerson.cpf ? formatCPF(selectedStudentPerson.cpf) : '-'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportStudentSheetCSV}
                    disabled={studentSummary.records.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow cursor-pointer disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Exportar Ficha CSV
                  </button>
                </div>
              </div>

              {/* Indicadores do Aluno */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
                  <div className="text-[11px] text-slate-400">Total de Aulas</div>
                  <div className="text-xl font-bold text-white mt-1">{studentSummary.total}</div>
                </div>
                <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
                  <div className="text-[11px] text-slate-400">Taxa de Presença</div>
                  <div className="text-xl font-bold text-emerald-400 mt-1">{studentSummary.percentage}%</div>
                </div>
                <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
                  <div className="text-[11px] text-slate-400">Presenças</div>
                  <div className="text-xl font-bold text-emerald-400 mt-1">{studentSummary.present}</div>
                </div>
                <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
                  <div className="text-[11px] text-slate-400">Faltas</div>
                  <div className="text-xl font-bold text-rose-400 mt-1">{studentSummary.absent}</div>
                </div>
                <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
                  <div className="text-[11px] text-slate-400">Atrasos</div>
                  <div className="text-xl font-bold text-amber-400 mt-1">{studentSummary.late}</div>
                </div>
                <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
                  <div className="text-[11px] text-slate-400">Justificadas</div>
                  <div className="text-xl font-bold text-sky-400 mt-1">{studentSummary.excused}</div>
                </div>
              </div>

              {/* Histórico Cronológico do Aluno */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
                <div className="p-4 border-b border-slate-800 font-bold text-xs text-white">
                  Registro Cronológico de Presenças do Aluno
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
                      <tr>
                        <th className="py-3 px-4">Data</th>
                        <th className="py-3 px-4">Turma</th>
                        <th className="py-3 px-4">Horário</th>
                        <th className="py-3 px-4">Situação</th>
                        <th className="py-3 px-4">Instrutor</th>
                        <th className="py-3 px-4">Observações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {studentSummary.records.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-500">
                            Nenhum registro de chamada encontrado para este aluno.
                          </td>
                        </tr>
                      ) : (
                        studentSummary.records.map((r) => {
                          const cls = classes.find((c) => c.id === r.classGroupId);
                          return (
                            <tr key={r.id} className="hover:bg-slate-800/40">
                              <td className="py-3 px-4 font-semibold text-white whitespace-nowrap">{r.date}</td>
                              <td className="py-3 px-4">{cls?.name || 'Turma'}</td>
                              <td className="py-3 px-4 text-slate-400">
                                {cls ? `${cls.startTime} - ${cls.endTime}` : '-'}
                              </td>
                              <td className="py-3 px-4">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    r.status === 'present'
                                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                                      : r.status === 'absent'
                                      ? 'bg-rose-950 text-rose-400 border border-rose-500/30'
                                      : r.status === 'late'
                                      ? 'bg-amber-950 text-amber-400 border border-amber-500/30'
                                      : 'bg-sky-950 text-sky-400 border border-sky-500/30'
                                  }`}
                                >
                                  {r.status === 'present'
                                    ? 'Presente'
                                    : r.status === 'absent'
                                    ? 'Falta'
                                    : r.status === 'late'
                                    ? 'Atraso'
                                    : 'Justificada'}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-slate-300">{r.recordedByUserName || 'Sensei'}</td>
                              <td className="py-3 px-4 text-slate-400 italic">{r.notes || '-'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
