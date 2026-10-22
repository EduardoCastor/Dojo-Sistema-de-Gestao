import React, { useState, useMemo } from 'react';
import {
  Calendar,
  Plus,
  Users,
  Clock,
  MapPin,
  CheckCircle,
  AlertTriangle,
  Search,
  Filter,
  Download,
  Printer,
  Edit2,
  Trash2,
  UserCheck,
  UserMinus,
  RefreshCw,
  X,
  Award,
  ChevronRight,
  ShieldAlert,
  Info,
  LayoutGrid,
} from 'lucide-react';
import { ClassGroup, ClassSchedule, Enrollment, MartialArt, BeltRank, Student, Person, User, Branch, Tatami } from '../../types';
import { getDaysOfWeekLabels, formatCPF } from '../../utils/formatters';
import { classService, ScheduleConflict, ClassScheduleReportRow, GraduationReportOverall } from '../../services/classService';

interface ClassesViewProps {
  classes: ClassGroup[];
  enrollments: Enrollment[];
  martialArts: MartialArt[];
  beltRanks?: BeltRank[];
  students?: Student[];
  persons?: Person[];
  branches?: Branch[];
  tatamis?: Tatami[];
  instructors: User[];
  tenantId?: string;
  tenantName?: string;
  onOpenAttendance: (classGroup: ClassGroup) => void;
  onAddClass?: (newClass: ClassGroup) => void;
  onRefreshData?: () => Promise<void>;
  onNavigateToOccupancy?: () => void;
}

const DAYS_OPTIONS = [
  { id: 1, label: 'Seg', full: 'Segunda-feira' },
  { id: 2, label: 'Ter', full: 'Terça-feira' },
  { id: 3, label: 'Qua', full: 'Quarta-feira' },
  { id: 4, label: 'Qui', full: 'Quinta-feira' },
  { id: 5, label: 'Sex', full: 'Sexta-feira' },
  { id: 6, label: 'Sáb', full: 'Sábado' },
  { id: 0, label: 'Dom', full: 'Domingo' },
];

export const ClassesView: React.FC<ClassesViewProps> = ({
  classes,
  enrollments,
  martialArts,
  beltRanks = [],
  students = [],
  persons = [],
  branches = [],
  tatamis = [],
  instructors,
  tenantId = 'tenant-kodokan',
  tenantName = 'TatameHub Dojo',
  onOpenAttendance,
  onAddClass,
  onRefreshData,
  onNavigateToOccupancy,
}) => {
  // Navegação por abas
  const [activeTab, setActiveTab] = useState<'grid' | 'schedule_report' | 'graduation_report'>('grid');

  // Estados de Busca e Filtros para a Grade de Turmas
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedArtFilter, setSelectedArtFilter] = useState('all');
  const [selectedDayFilter, setSelectedDayFilter] = useState<number | 'all'>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedInstructorFilter, setSelectedInstructorFilter] = useState('all');

  // Modais
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassGroup | null>(null);
  const [selectedClassForEnrollments, setSelectedClassForEnrollments] = useState<ClassGroup | null>(null);

  // Estados do formulário de turma
  const [formName, setFormName] = useState('');
  const [formBranchId, setFormBranchId] = useState('');
  const [formMartialArtId, setFormMartialArtId] = useState('');
  const [formInstructorId, setFormInstructorId] = useState('');
  const [formMaxCapacity, setFormMaxCapacity] = useState(20);
  const [formMinAge, setFormMinAge] = useState(6);
  const [formMaxAge, setFormMaxAge] = useState<number | ''>('');
  const [formTatamiRoom, setFormTatamiRoom] = useState('Tatami Principal');
  const [formActive, setFormActive] = useState(true);
  const [formNotes, setFormNotes] = useState('');

  // Horários estruturados no formulário
  const [formSchedules, setFormSchedules] = useState<
    Array<{
      id?: string;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      tatamiRoom: string;
      instructorName: string;
      instructorUserId?: string;
    }>
  >([]);

  // Estados de feedback do formulário
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [conflictWarnings, setConflictWarnings] = useState<ScheduleConflict[]>([]);

  // Estado do Modal de Matrículas
  const [selectedStudentToEnroll, setSelectedStudentToEnroll] = useState('');
  const [enrollmentError, setEnrollmentError] = useState('');
  const [enrollmentSuccess, setEnrollmentSuccess] = useState('');
  const [isProcessingEnrollment, setIsProcessingEnrollment] = useState(false);

  // Estados de Filtro para Relatório por Horário
  const [repScheduleDay, setRepScheduleDay] = useState<number | 'all'>('all');
  const [repScheduleArt, setRepScheduleArt] = useState('all');
  const [repScheduleStatus, setRepScheduleStatus] = useState<'all' | 'active' | 'inactive'>('all');

  // Estados de Filtro para Relatório por Graduação
  const [repGradArt, setRepGradArt] = useState('all');
  const [repGradClass, setRepGradClass] = useState('all');
  const [repGradRank, setRepGradRank] = useState('all');

  // Mapas auxiliares para renderização rápida
  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const personMap = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);
  const martialArtMap = useMemo(() => new Map(martialArts.map((m) => [m.id, m])), [martialArts]);

  // Contagem de matriculados ativos por turma
  const getEnrolledCount = (classId: string) => {
    return enrollments.filter((e) => e.classGroupId === classId && e.status === 'active').length;
  };

  // Filtragem e busca da grade de turmas
  const filteredClasses = useMemo(() => {
    return classes.filter((cls) => {
      // Filtro de texto (nome, sala, instrutor)
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim();
        const matchesName = cls.name.toLowerCase().includes(term);
        const matchesRoom = cls.tatamiRoom.toLowerCase().includes(term);
        const matchesInst = cls.headInstructorName.toLowerCase().includes(term);
        if (!matchesName && !matchesRoom && !matchesInst) return false;
      }

      // Filtro de modalidade
      if (selectedArtFilter !== 'all' && cls.martialArtId !== selectedArtFilter) {
        return false;
      }

      // Filtro de instrutor
      if (selectedInstructorFilter !== 'all') {
        const instMatch = cls.headInstructorName.toLowerCase() === selectedInstructorFilter.toLowerCase();
        if (!instMatch) return false;
      }

      // Filtro de dia da semana
      if (selectedDayFilter !== 'all') {
        const hasDayInArray = (cls.daysOfWeek || []).includes(selectedDayFilter);
        const hasDayInSchedules = cls.schedules?.some((s) => s.dayOfWeek === selectedDayFilter);
        if (!hasDayInArray && !hasDayInSchedules) return false;
      }

      // Filtro de status
      if (selectedStatusFilter === 'active' && !cls.active) return false;
      if (selectedStatusFilter === 'inactive' && cls.active) return false;

      return true;
    });
  }, [classes, searchTerm, selectedArtFilter, selectedInstructorFilter, selectedDayFilter, selectedStatusFilter]);

  // Abertura do Modal de Criação / Edição
  const handleOpenCreateModal = () => {
    setEditingClass(null);
    setFormName('');
    setFormBranchId(branches[0]?.id || '');
    setFormMartialArtId(martialArts[0]?.id || '');
    setFormInstructorId(instructors[0]?.id || '');
    setFormMaxCapacity(20);
    setFormMinAge(6);
    setFormMaxAge('');
    setFormTatamiRoom('Tatami Principal');
    setFormActive(true);
    setFormNotes('');
    setFormSchedules([
      {
        dayOfWeek: 1,
        startTime: '18:00',
        endTime: '19:00',
        tatamiRoom: 'Tatami Principal',
        instructorName: instructors[0]?.name || 'Sensei Responsável',
        instructorUserId: instructors[0]?.id,
      },
      {
        dayOfWeek: 3,
        startTime: '18:00',
        endTime: '19:00',
        tatamiRoom: 'Tatami Principal',
        instructorName: instructors[0]?.name || 'Sensei Responsável',
        instructorUserId: instructors[0]?.id,
      },
      {
        dayOfWeek: 5,
        startTime: '18:00',
        endTime: '19:00',
        tatamiRoom: 'Tatami Principal',
        instructorName: instructors[0]?.name || 'Sensei Responsável',
        instructorUserId: instructors[0]?.id,
      },
    ]);
    setFormError('');
    setFormSuccess('');
    setConflictWarnings([]);
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (cls: ClassGroup) => {
    setEditingClass(cls);
    setFormName(cls.name);
    setFormBranchId(cls.branchId);
    setFormMartialArtId(cls.martialArtId);
    setFormInstructorId(cls.headInstructorId || instructors[0]?.id || '');
    setFormMaxCapacity(cls.maxCapacity);
    setFormMinAge(cls.minAge);
    setFormMaxAge(cls.maxAge || '');
    setFormTatamiRoom(cls.tatamiRoom);
    setFormActive(cls.active);
    setFormNotes(cls.notes || '');

    if (cls.schedules && cls.schedules.length > 0) {
      setFormSchedules(
        cls.schedules.map((s) => ({
          id: s.id,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          tatamiRoom: s.tatamiRoom || cls.tatamiRoom,
          instructorName: s.instructorName || cls.headInstructorName,
          instructorUserId: s.instructorUserId || cls.headInstructorId,
        }))
      );
    } else {
      setFormSchedules(
        (cls.daysOfWeek || [1, 3, 5]).map((d) => ({
          dayOfWeek: d,
          startTime: cls.startTime,
          endTime: cls.endTime,
          tatamiRoom: cls.tatamiRoom,
          instructorName: cls.headInstructorName,
          instructorUserId: cls.headInstructorId,
        }))
      );
    }

    setFormError('');
    setFormSuccess('');
    setConflictWarnings([]);
    setIsFormModalOpen(true);
  };

  // Adicionar e remover horários no formulário dinâmico
  const handleAddScheduleSlot = () => {
    setFormSchedules((prev) => [
      ...prev,
      {
        dayOfWeek: 2,
        startTime: '19:00',
        endTime: '20:00',
        tatamiRoom: formTatamiRoom || 'Tatami Principal',
        instructorName: instructors.find((i) => i.id === formInstructorId)?.name || 'Sensei Responsável',
        instructorUserId: formInstructorId,
      },
    ]);
  };

  const handleRemoveScheduleSlot = (index: number) => {
    setFormSchedules((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleScheduleChange = (index: number, field: string, value: any) => {
    setFormSchedules((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });

    // Validar conflitos em tempo real
    setTimeout(verifyFormConflicts, 50);
  };

  const verifyFormConflicts = () => {
    const slots = formSchedules.map((s) => ({
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      tatamiRoom: s.tatamiRoom || formTatamiRoom,
      instructorName: s.instructorName,
      instructorId: s.instructorUserId,
    }));

    const conflicts = classService.detectScheduleConflicts(slots, classes, editingClass?.id);
    setConflictWarnings(conflicts);
    return conflicts;
  };

  // Salvar Turma (Criação ou Edição)
  const handleSaveClassSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('O nome da turma é obrigatório.');
      return;
    }
    if (formSchedules.length === 0) {
      setFormError('Adicione pelo menos um horário semanal para a turma.');
      return;
    }

    // Verificar se algum horário tem início >= término
    const invalidTimeSlot = formSchedules.find((s) => s.startTime >= s.endTime);
    if (invalidTimeSlot) {
      setFormError(`O horário de início (${invalidTimeSlot.startTime}) deve ser anterior ao de término (${invalidTimeSlot.endTime}).`);
      return;
    }

    setFormError('');
    setFormSuccess('');
    setIsSaving(true);

    try {
      const chosenInstructor = instructors.find((i) => i.id === formInstructorId);
      const daysArray = Array.from(new Set(formSchedules.map((s) => s.dayOfWeek))).sort();

      const payload = {
        id: editingClass?.id,
        branchId: formBranchId || branches[0]?.id || 'branch-matriz',
        martialArtId: formMartialArtId || martialArts[0]?.id || '',
        name: formName.trim(),
        headInstructorId: formInstructorId,
        headInstructorName: chosenInstructor?.name || 'Sensei Responsável',
        daysOfWeek: daysArray,
        startTime: formSchedules[0]?.startTime || '18:00',
        endTime: formSchedules[0]?.endTime || '19:00',
        maxCapacity: Number(formMaxCapacity) || 20,
        minAge: Number(formMinAge) || 5,
        maxAge: formMaxAge ? Number(formMaxAge) : undefined,
        tatamiRoom: formTatamiRoom || 'Tatami Principal',
        active: formActive,
        notes: formNotes.trim() || undefined,
      };

      const saved = await classService.saveClass(tenantId, payload, formSchedules);

      setFormSuccess(editingClass ? 'Turma atualizada com sucesso!' : 'Turma cadastrada com sucesso!');
      if (onAddClass) {
        onAddClass(saved);
      }
      if (onRefreshData) {
        await onRefreshData();
      }

      setTimeout(() => {
        setIsFormModalOpen(false);
      }, 700);
    } catch (err: any) {
      setFormError(err?.message || 'Falha ao salvar turma no banco de dados.');
    } finally {
      setIsSaving(false);
    }
  };

  // Alternar ativação / exclusão lógica
  const handleToggleStatus = async (cls: ClassGroup) => {
    const nextStatus = !cls.active;
    const confirmMsg = nextStatus
      ? `Deseja reativar a turma "${cls.name}"?`
      : `Deseja desativar a turma "${cls.name}"? As matrículas e históricos anteriores permanecerão preservados.`;

    if (!confirm(confirmMsg)) return;

    try {
      await classService.toggleClassStatus(tenantId, cls.id, nextStatus);
      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (err: any) {
      alert(err?.message || 'Falha ao alterar status da turma.');
    }
  };

  // Matricular aluno selecionado na turma aberta
  const handleEnrollStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassForEnrollments || !selectedStudentToEnroll) return;

    setEnrollmentError('');
    setEnrollmentSuccess('');
    setIsProcessingEnrollment(true);

    try {
      const studentEnrolledClassIds = enrollments
        .filter((enr) => enr.studentId === selectedStudentToEnroll && enr.status === 'active')
        .map((enr) => enr.classGroupId);

      const studentEnrolledClasses = classes.filter((c) => studentEnrolledClassIds.includes(c.id));

      await classService.enrollStudent(
        tenantId,
        selectedClassForEnrollments.branchId,
        selectedStudentToEnroll,
        selectedClassForEnrollments.id,
        {
          enrolledClasses: studentEnrolledClasses,
          targetClass: selectedClassForEnrollments,
        }
      );

      setEnrollmentSuccess('Aluno matriculado na turma com sucesso!');
      setSelectedStudentToEnroll('');
      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (err: any) {
      setEnrollmentError(err?.message || 'Falha ao matricular aluno na turma.');
    } finally {
      setIsProcessingEnrollment(false);
    }
  };

  // Remover matrícula
  const handleUnenrollStudent = async (enrollmentId: string, studentName: string) => {
    if (!confirm(`Deseja realmente desmatricular o aluno "${studentName}" desta turma?`)) {
      return;
    }

    setEnrollmentError('');
    setEnrollmentSuccess('');
    setIsProcessingEnrollment(true);

    try {
      await classService.unenrollStudent(tenantId, enrollmentId);
      setEnrollmentSuccess(`Aluno "${studentName}" desmatriculado da turma.`);
      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (err: any) {
      setEnrollmentError(err?.message || 'Falha ao remover matrícula.');
    } finally {
      setIsProcessingEnrollment(false);
    }
  };

  // Estatísticas Rápidas
  const totalClassesCount = classes.length;
  const activeClassesCount = classes.filter((c) => c.active).length;
  const totalEnrollmentsCount = enrollments.filter((e) => e.status === 'active').length;
  const totalVacancies = classes
    .filter((c) => c.active)
    .reduce((acc, c) => acc + Math.max(0, c.maxCapacity - getEnrolledCount(c.id)), 0);

  // Relatório por Horário Computado
  const scheduleReportRows = useMemo(() => {
    const raw = classService.generateScheduleReport(classes, enrollments, {
      dayOfWeek: repScheduleDay,
      martialArtId: repScheduleArt,
      status: repScheduleStatus,
    });

    return raw.map((r) => {
      const art = martialArtMap.get(r.martialArtName);
      return {
        ...r,
        martialArtName: art?.name || 'Arte Marcial',
      };
    });
  }, [classes, enrollments, repScheduleDay, repScheduleArt, repScheduleStatus, martialArtMap]);

  // Exportação CSV do Relatório por Horário
  const handleExportScheduleReportCSV = () => {
    const headers = [
      'Dia da Semana',
      'Horário Início',
      'Horário Término',
      'Turma',
      'Modalidade',
      'Sensei / Instrutor',
      'Tatami / Sala',
      'Matriculados',
      'Lotação Máx.',
      'Vagas Livres',
      'Ocupação (%)',
      'Status',
    ];

    const rows = scheduleReportRows.map((r) => [
      r.dayLabel,
      r.startTime,
      r.endTime,
      r.className,
      r.martialArtName,
      r.instructorName,
      r.tatamiRoom,
      r.enrolledCount,
      r.maxCapacity,
      r.vacancies,
      `${r.occupancyPercent}%`,
      r.status === 'active' ? 'Ativa' : 'Inativa',
    ]);

    classService.exportToCSV('relatorio_turmas_horarios', headers, rows, {
      title: 'Relatório de Turmas e Horários Semanais',
      academy: tenantName,
      date: new Date().toLocaleDateString('pt-BR'),
    });
  };

  // Relatório por Graduação Computado
  const graduationReportData: GraduationReportOverall = useMemo(() => {
    return classService.generateGraduationReport(
      classes,
      enrollments,
      students,
      persons,
      martialArts,
      beltRanks,
      {
        martialArtId: repGradArt,
        classId: repGradClass,
        beltRankId: repGradRank,
      }
    );
  }, [classes, enrollments, students, persons, martialArts, beltRanks, repGradArt, repGradClass, repGradRank]);

  // Exportação CSV do Relatório por Graduação
  const handleExportGraduationReportCSV = () => {
    const headers = [
      'Turma',
      'Modalidade',
      'Tatami / Espaço',
      'Sensei',
      'Faixa / Graduação',
      'Alunos nesta Faixa',
      'Total da Turma',
    ];

    const rows: (string | number)[][] = [];

    graduationReportData.classes.forEach((c) => {
      if (c.ranksDistribution.length === 0) {
        rows.push([c.className, c.martialArtName, c.tatamiRoom, c.instructorName, 'Nenhuma faixa configurada', 0, c.totalEnrolled]);
      } else {
        c.ranksDistribution.forEach((rd) => {
          rows.push([c.className, c.martialArtName, c.tatamiRoom, c.instructorName, rd.beltName, rd.count, c.totalEnrolled]);
        });
      }
      if (c.unassignedRankStudents.length > 0) {
        rows.push([c.className, c.martialArtName, c.tatamiRoom, c.instructorName, 'Sem Faixa Registrada', c.unassignedRankStudents.length, c.totalEnrolled]);
      }
    });

    classService.exportToCSV('relatorio_turmas_por_graduacao', headers, rows, {
      title: 'Relatório de Distribuição de Alunos por Graduação e Turma',
      academy: tenantName,
      date: new Date().toLocaleDateString('pt-BR'),
    });
  };

  // Alunos disponíveis para matrícula na turma aberta
  const studentsAvailableForEnrollment = useMemo(() => {
    if (!selectedClassForEnrollments) return [];
    const enrolledStudentIds = new Set(
      enrollments
        .filter((e) => e.classGroupId === selectedClassForEnrollments.id && e.status === 'active')
        .map((e) => e.studentId)
    );

    return students
      .filter((s) => s.status === 'active' && !enrolledStudentIds.has(s.id))
      .map((s) => {
        const p = personMap.get(s.personId);
        return {
          student: s,
          person: p,
          fullName: p?.fullName || 'Aluno',
          cpf: p?.cpf || '',
          registrationNumber: s.registrationNumber,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [selectedClassForEnrollments, students, enrollments, personMap]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white tracking-tight">Turmas, Horários & Capacidade</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-red-950/80 text-red-400 border border-red-500/30">
              {activeClassesCount} ativas
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Gestão estruturada de treinos, grades de horários semanais, matrículas de alunos e relatórios por faixa.
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {onRefreshData && (
            <button
              onClick={() => onRefreshData()}
              title="Recarregar turmas e horários do Supabase"
              className="p-2 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}

          <button
            onClick={handleOpenCreateModal}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition-colors shadow-lg shadow-red-600/20 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Nova Turma</span>
          </button>
        </div>
      </div>

      {/* Cards de Métricas Rápidas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60">
          <span className="text-[11px] text-slate-400 block mb-1">Total de Turmas</span>
          <div className="text-lg font-bold text-white font-mono">{totalClassesCount}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60">
          <span className="text-[11px] text-slate-400 block mb-1">Turmas Ativas</span>
          <div className="text-lg font-bold text-emerald-400 font-mono">{activeClassesCount}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60">
          <span className="text-[11px] text-slate-400 block mb-1">Total de Matrículas</span>
          <div className="text-lg font-bold text-blue-400 font-mono">{totalEnrollmentsCount}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60">
          <span className="text-[11px] text-slate-400 block mb-1">Vagas Livres (Tatami)</span>
          <div className="text-lg font-bold text-amber-400 font-mono">{totalVacancies}</div>
        </div>
      </div>

      {/* Navegação entre Abas Principais */}
      <div className="flex border-b border-slate-800 gap-2">
        <button
          onClick={() => setActiveTab('grid')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'grid'
              ? 'border-red-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Calendar className="h-4 w-4" />
          <span>Grade de Turmas</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
            {filteredClasses.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('schedule_report')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'schedule_report'
              ? 'border-red-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock className="h-4 w-4 text-amber-400" />
          <span>Relatório por Horário</span>
        </button>

        <button
          onClick={() => setActiveTab('graduation_report')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'graduation_report'
              ? 'border-red-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Award className="h-4 w-4 text-red-500" />
          <span>Relatório por Graduação</span>
        </button>

        {onNavigateToOccupancy && (
          <button
            onClick={onNavigateToOccupancy}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 border-transparent text-slate-400 hover:text-white hover:border-red-500/50 transition-colors cursor-pointer"
          >
            <LayoutGrid className="h-4 w-4 text-emerald-400" />
            <span>Ocupação dos Tatamis</span>
          </button>
        )}
      </div>

      {/* ABA 1: GRADE DE TURMAS */}
      {activeTab === 'grid' && (
        <div className="space-y-4">
          {/* Barra de Busca e Filtros */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome da turma, tatami ou sensei..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-2.5 text-slate-500 hover:text-white cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* Modalidade */}
              <select
                value={selectedArtFilter}
                onChange={(e) => setSelectedArtFilter(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-red-500"
              >
                <option value="all">Todas Modalidades</option>
                {martialArts.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>

              {/* Dia da Semana */}
              <select
                value={selectedDayFilter}
                onChange={(e) => setSelectedDayFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-red-500"
              >
                <option value="all">Todos os Dias</option>
                {DAYS_OPTIONS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full}
                  </option>
                ))}
              </select>

              {/* Status */}
              <select
                value={selectedStatusFilter}
                onChange={(e) => setSelectedStatusFilter(e.target.value as any)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-red-500"
              >
                <option value="all">Todas (Ativas/Inativas)</option>
                <option value="active">Somente Ativas</option>
                <option value="inactive">Somente Inativas</option>
              </select>

              {(searchTerm || selectedArtFilter !== 'all' || selectedDayFilter !== 'all' || selectedStatusFilter !== 'all') && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedArtFilter('all');
                    setSelectedDayFilter('all');
                    setSelectedStatusFilter('all');
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>

          {/* Listagem de Turmas */}
          {filteredClasses.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-slate-800 bg-slate-900/40 text-slate-400">
              <Calendar className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-300">Nenhuma turma encontrada</p>
              <p className="text-xs text-slate-500 mt-1">Tente ajustar seus termos de pesquisa ou cadastre uma nova turma.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredClasses.map((cls) => {
                const enrolled = getEnrolledCount(cls.id);
                const percent = cls.maxCapacity > 0 ? Math.min(100, Math.round((enrolled / cls.maxCapacity) * 100)) : 0;
                const isFull = enrolled >= cls.maxCapacity;
                const art = martialArtMap.get(cls.martialArtId);

                return (
                  <div
                    key={cls.id}
                    className={`flex flex-col justify-between rounded-xl border p-5 transition-all ${
                      cls.active
                        ? 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                        : 'border-slate-800/60 bg-slate-950/40 opacity-75'
                    }`}
                  >
                    <div>
                      {/* Top Header do Card */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-white tracking-tight">{cls.name}</h3>
                            {!cls.active && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-slate-800 text-slate-400 uppercase font-mono">
                                Inativa
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-red-400 font-medium block">
                            {art?.name || 'Arte Marcial'}
                          </span>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            isFull
                              ? 'bg-red-950/60 text-red-400 border border-red-500/30'
                              : 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                          }`}
                        >
                          {isFull ? 'Lotada' : `${cls.maxCapacity - enrolled} vagas livres`}
                        </span>
                      </div>

                      {/* Informações de Horário e Local */}
                      <div className="space-y-1.5 text-xs text-slate-400 my-3">
                        <div className="flex items-center gap-2 text-slate-300">
                          <Clock className="h-3.5 w-3.5 text-red-500 shrink-0" />
                          <span>
                            {getDaysOfWeekLabels(cls.daysOfWeek)} · {cls.startTime} às {cls.endTime}
                          </span>
                        </div>

                        {cls.schedules && cls.schedules.length > 1 && (
                          <div className="text-[10px] text-amber-400/90 pl-5.5">
                            Grade com {cls.schedules.length} horários detalhados cadastrados
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          <span>{cls.tatamiRoom}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <Users className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          <span>Sensei {cls.headInstructorName}</span>
                        </div>

                        <div className="text-[11px] text-slate-500 pt-1">
                          Faixa etária: {cls.minAge} {cls.maxAge ? `a ${cls.maxAge}` : '+'} anos
                        </div>
                      </div>

                      {/* Barra de Ocupação da Turma */}
                      <div className="my-3">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-slate-400">Lotação do Tatami</span>
                          <span className="font-mono text-slate-200 font-semibold">
                            {enrolled}/{cls.maxCapacity} ({percent}%)
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              percent >= 100 ? 'bg-red-500' : percent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Ações da Turma */}
                    <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setSelectedClassForEnrollments(cls)}
                          title="Gerenciar alunos matriculados"
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                        >
                          <UserCheck className="h-3.5 w-3.5 text-blue-400" />
                          <span>Alunos ({enrolled})</span>
                        </button>

                        <button
                          onClick={() => onOpenAttendance(cls)}
                          title="Realizar chamada oficial"
                          className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                        >
                          Chamada
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenEditModal(cls)}
                          title="Editar turma e horários"
                          className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>

                        <button
                          onClick={() => handleToggleStatus(cls)}
                          title={cls.active ? 'Desativar turma' : 'Reativar turma'}
                          className={`p-1.5 rounded-lg border border-slate-800 transition-colors cursor-pointer ${
                            cls.active ? 'text-amber-400/80 hover:bg-amber-950/40' : 'text-emerald-400/80 hover:bg-emerald-950/40'
                          }`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ABA 2: RELATÓRIO DE TURMAS POR HORÁRIO */}
      {activeTab === 'schedule_report' && (
        <div className="space-y-4">
          {/* Controles de Filtros e Exportação do Relatório */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={repScheduleDay}
                onChange={(e) => setRepScheduleDay(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-slate-200 focus:outline-none focus:border-red-500"
              >
                <option value="all">Todos os Dias da Semana</option>
                {DAYS_OPTIONS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full}
                  </option>
                ))}
              </select>

              <select
                value={repScheduleArt}
                onChange={(e) => setRepScheduleArt(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-slate-200 focus:outline-none focus:border-red-500"
              >
                <option value="all">Todas as Modalidades</option>
                {martialArts.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>

              <select
                value={repScheduleStatus}
                onChange={(e) => setRepScheduleStatus(e.target.value as any)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-slate-200 focus:outline-none focus:border-red-500"
              >
                <option value="all">Todas as Turmas</option>
                <option value="active">Somente Ativas</option>
                <option value="inactive">Somente Inativas</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Imprimir</span>
              </button>

              <button
                onClick={handleExportScheduleReportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Exportar CSV</span>
              </button>
            </div>
          </div>

          {/* Tabela de Horários */}
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 font-mono text-[11px] uppercase">
                <tr>
                  <th className="py-3 px-4">Dia</th>
                  <th className="py-3 px-3">Horário</th>
                  <th className="py-3 px-4">Turma</th>
                  <th className="py-3 px-3">Modalidade</th>
                  <th className="py-3 px-3">Sensei</th>
                  <th className="py-3 px-3">Tatami / Espaço</th>
                  <th className="py-3 px-3 text-center">Matriculados</th>
                  <th className="py-3 px-3 text-center">Vagas Livres</th>
                  <th className="py-3 px-3 text-center">Ocupação</th>
                  <th className="py-3 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {scheduleReportRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-500">
                      Nenhum treino programado para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  scheduleReportRows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 font-semibold text-white whitespace-nowrap">{row.dayLabel}</td>
                      <td className="py-3 px-3 font-mono text-red-400 whitespace-nowrap">
                        {row.startTime} - {row.endTime}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-200">{row.className}</td>
                      <td className="py-3 px-3 text-slate-300">{row.martialArtName}</td>
                      <td className="py-3 px-3 text-slate-300">{row.instructorName}</td>
                      <td className="py-3 px-3 text-slate-400">{row.tatamiRoom}</td>
                      <td className="py-3 px-3 text-center font-mono font-bold text-white">{row.enrolledCount}</td>
                      <td className="py-3 px-3 text-center font-mono text-emerald-400">{row.vacancies}</td>
                      <td className="py-3 px-3 text-center font-mono">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            row.occupancyPercent >= 100
                              ? 'bg-red-950 text-red-400'
                              : row.occupancyPercent >= 80
                              ? 'bg-amber-950 text-amber-400'
                              : 'bg-emerald-950 text-emerald-400'
                          }`}
                        >
                          {row.occupancyPercent}%
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            row.status === 'active'
                              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {row.status === 'active' ? 'Ativa' : 'Inativa'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA 3: RELATÓRIO DE TURMAS POR GRADUAÇÃO */}
      {activeTab === 'graduation_report' && (
        <div className="space-y-5">
          {/* Filtros e Exportação do Relatório por Graduação */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={repGradArt}
                onChange={(e) => setRepGradArt(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-slate-200 focus:outline-none focus:border-red-500"
              >
                <option value="all">Todas as Modalidades</option>
                {martialArts.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>

              <select
                value={repGradClass}
                onChange={(e) => setRepGradClass(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-slate-200 focus:outline-none focus:border-red-500"
              >
                <option value="all">Todas as Turmas</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={repGradRank}
                onChange={(e) => setRepGradRank(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-slate-200 focus:outline-none focus:border-red-500"
              >
                <option value="all">Todas as Faixas</option>
                {beltRanks
                  .filter((b) => repGradArt === 'all' || b.martialArtId === repGradArt)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Imprimir</span>
              </button>

              <button
                onClick={handleExportGraduationReportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Exportar CSV</span>
              </button>
            </div>
          </div>

          {/* Resumo Global de Faixas na Academia */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3">
              Total de Alunos Matriculados por Faixa (Vigência Atual)
            </h4>
            <div className="flex flex-wrap gap-2.5">
              {graduationReportData.overallRanksTotal.map((item) => (
                <div
                  key={item.beltId}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-800 bg-slate-950"
                >
                  <span
                    className="h-3 w-3 rounded-full border border-slate-700 shrink-0"
                    style={{ backgroundColor: item.colorHex }}
                  />
                  <span className="text-xs font-medium text-slate-200">{item.beltName}:</span>
                  <span className="font-mono text-xs font-bold text-red-400">{item.totalStudents}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Lista por Turma com Distribuição de Alunos */}
          <div className="space-y-4">
            {graduationReportData.classes.length === 0 ? (
              <div className="p-8 text-center text-slate-500 border border-slate-800 rounded-xl">
                Nenhuma turma correspondente encontrada.
              </div>
            ) : (
              graduationReportData.classes.map((clsSummary) => (
                <div
                  key={clsSummary.classId}
                  className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800/80 gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>{clsSummary.className}</span>
                        <span className="text-xs text-red-400 font-normal">({clsSummary.martialArtName})</span>
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        {clsSummary.tatamiRoom} · Sensei {clsSummary.instructorName}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-slate-400">Total na Turma:</span>
                      <span className="font-bold text-white px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                        {clsSummary.totalEnrolled} alunos
                      </span>
                    </div>
                  </div>

                  {/* Badges de Faixas na Turma */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                    {clsSummary.ranksDistribution.map((rank) => (
                      <div
                        key={rank.beltId}
                        className="p-2.5 rounded-lg border border-slate-800/80 bg-slate-950/70 text-xs"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-2.5 w-2.5 rounded-full border border-slate-700"
                              style={{ backgroundColor: rank.colorHex }}
                            />
                            <span className="font-semibold text-slate-200">{rank.beltName}</span>
                          </div>
                          <span className="font-mono font-bold text-red-400">{rank.count}</span>
                        </div>

                        {rank.students.length > 0 && (
                          <div className="text-[10px] text-slate-400 space-y-0.5 pl-4 border-l border-slate-800 mt-1 max-h-24 overflow-y-auto">
                            {rank.students.map((st) => (
                              <div key={st.id} className="truncate">
                                {st.name} <span className="font-mono text-slate-500">({st.registrationNumber})</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}

                    {clsSummary.unassignedRankStudents.length > 0 && (
                      <div className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-950/20 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-amber-300">Sem Faixa Registrada</span>
                          <span className="font-mono font-bold text-amber-400">
                            {clsSummary.unassignedRankStudents.length}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 space-y-0.5 pl-2 max-h-24 overflow-y-auto">
                          {clsSummary.unassignedRankStudents.map((st) => (
                            <div key={st.id} className="truncate">
                              {st.name}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CADASTRO E EDIÇÃO DE TURMA COM HORÁRIOS ESTRUTURADOS E CONFLITOS */}
      {/* ========================================================================= */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200 max-h-[92vh] overflow-y-auto">
            <button
              onClick={() => setIsFormModalOpen(false)}
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-base font-bold text-white mb-1">
              {editingClass ? `Editar Turma: ${editingClass.name}` : 'Cadastrar Nova Turma de Treino'}
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Defina os dados gerais, capacidade e horários semanais com validação automática de sobreposição.
            </p>

            {formError && (
              <div className="p-3 mb-4 rounded-lg bg-red-950/80 border border-red-500/50 text-red-200 text-xs flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{formError}</span>
              </div>
            )}

            {formSuccess && (
              <div className="p-3 mb-4 rounded-lg bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 text-xs flex items-center gap-2">
                <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{formSuccess}</span>
              </div>
            )}

            {/* Alertas de Conflito em Tempo Real */}
            {conflictWarnings.length > 0 && (
              <div className="p-3 mb-4 rounded-lg bg-amber-950/70 border border-amber-500/40 text-amber-200 text-xs space-y-1.5">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                  <span>Atenção: Conflito(s) de Horário Identificado(s)</span>
                </div>
                {conflictWarnings.map((c, i) => (
                  <p key={i} className="text-[11px] text-amber-300/90 pl-6">
                    • {c.message}
                  </p>
                ))}
              </div>
            )}

            <form onSubmit={handleSaveClassSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Nome da Turma *</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Judô Infantil / Iniciação (Tarde)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Modalidade *</label>
                  <select
                    value={formMartialArtId}
                    onChange={(e) => setFormMartialArtId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  >
                    {martialArts.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Sensei Responsável</label>
                  <select
                    value={formInstructorId}
                    onChange={(e) => {
                      setFormInstructorId(e.target.value);
                      setTimeout(verifyFormConflicts, 50);
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  >
                    {instructors.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Tatami / Espaço</label>
                  <input
                    type="text"
                    list="tatami-rooms-datalist"
                    value={formTatamiRoom}
                    onChange={(e) => {
                      setFormTatamiRoom(e.target.value);
                      setTimeout(verifyFormConflicts, 50);
                    }}
                    placeholder="Ex: Tatami Principal"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  />
                  <datalist id="tatami-rooms-datalist">
                    {(tatamis || []).map((t) => (
                      <option key={t.id} value={t.name} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Lotação Máx. (Alunos)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={formMaxCapacity}
                    onChange={(e) => setFormMaxCapacity(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Idade Mínima</label>
                  <input
                    type="number"
                    min="3"
                    value={formMinAge}
                    onChange={(e) => setFormMinAge(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Idade Máxima</label>
                  <input
                    type="number"
                    value={formMaxAge}
                    onChange={(e) => setFormMaxAge(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Livre"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Seção de Horários Estruturados */}
              <div className="pt-3 border-t border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-slate-200 font-bold">Grade de Horários Semanais</label>
                    <span className="text-[11px] text-slate-400">
                      Cadastre um ou múltiplos dias e intervalos de treinamento.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddScheduleSlot}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Adicionar Horário</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {formSchedules.map((slot, sIdx) => (
                    <div
                      key={sIdx}
                      className="p-3 rounded-lg border border-slate-800 bg-slate-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5"
                    >
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1 w-full">
                        {/* Dia da Semana */}
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-0.5">Dia</label>
                          <select
                            value={slot.dayOfWeek}
                            onChange={(e) => handleScheduleChange(sIdx, 'dayOfWeek', Number(e.target.value))}
                            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-white text-xs"
                          >
                            {DAYS_OPTIONS.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.full}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Início */}
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-0.5">Início</label>
                          <input
                            type="time"
                            value={slot.startTime}
                            onChange={(e) => handleScheduleChange(sIdx, 'startTime', e.target.value)}
                            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-white text-xs"
                          />
                        </div>

                        {/* Término */}
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-0.5">Término</label>
                          <input
                            type="time"
                            value={slot.endTime}
                            onChange={(e) => handleScheduleChange(sIdx, 'endTime', e.target.value)}
                            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-white text-xs"
                          />
                        </div>

                        {/* Sala / Tatami do horário */}
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-0.5">Tatami</label>
                          <input
                            type="text"
                            value={slot.tatamiRoom}
                            onChange={(e) => handleScheduleChange(sIdx, 'tatamiRoom', e.target.value)}
                            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-white text-xs"
                          />
                        </div>
                      </div>

                      {formSchedules.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveScheduleSlot(sIdx)}
                          className="p-1 text-slate-500 hover:text-red-400 rounded hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                          title="Remover horário"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Observações */}
              <div>
                <label className="block text-slate-300 font-medium mb-1">Observações da Turma</label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Ex: Treinamento voltado para competições estaduais ou requisitos para matrícula..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                    className="rounded border-slate-700 text-red-600 focus:ring-red-500"
                  />
                  <span className="text-xs text-slate-300 font-medium">Turma Ativa</span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsFormModalOpen(false)}
                    className="px-3.5 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-2 rounded-lg bg-red-600 font-semibold text-white hover:bg-red-500 transition-colors disabled:opacity-50 cursor-pointer shadow-lg shadow-red-600/20"
                  >
                    {isSaving ? 'Salvando...' : editingClass ? 'Salvar Alterações' : 'Criar Turma'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ALUNOS MATRICULADOS NA TURMA (CONSULTA E GERENCIAMENTO)            */}
      {/* ========================================================================= */}
      {selectedClassForEnrollments && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200 max-h-[92vh] overflow-y-auto">
            <button
              onClick={() => setSelectedClassForEnrollments(null)}
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Alunos Matriculados: {selectedClassForEnrollments.name}</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {selectedClassForEnrollments.tatamiRoom} · Horário: {selectedClassForEnrollments.startTime} às{' '}
                {selectedClassForEnrollments.endTime}
              </p>
            </div>

            {enrollmentError && (
              <div className="p-3 mb-3 rounded-lg bg-red-950/80 border border-red-500/50 text-red-200 text-xs flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{enrollmentError}</span>
              </div>
            )}

            {enrollmentSuccess && (
              <div className="p-3 mb-3 rounded-lg bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 text-xs flex items-center gap-2">
                <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{enrollmentSuccess}</span>
              </div>
            )}

            {/* Formulário Rápido de Matrícula de Aluno */}
            <form onSubmit={handleEnrollStudentSubmit} className="p-3.5 mb-4 rounded-xl border border-slate-800 bg-slate-950 flex flex-col sm:flex-row gap-2.5 items-end">
              <div className="flex-1 w-full">
                <label className="block text-[11px] text-slate-400 font-medium mb-1">
                  Matricular Novo Aluno nesta Turma:
                </label>
                <select
                  value={selectedStudentToEnroll}
                  onChange={(e) => setSelectedStudentToEnroll(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-500"
                >
                  <option value="">Selecione um aluno da academia...</option>
                  {studentsAvailableForEnrollment.map((st) => (
                    <option key={st.student.id} value={st.student.id}>
                      {st.fullName} ({st.registrationNumber}) {st.cpf ? `- CPF: ${formatCPF(st.cpf)}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={!selectedStudentToEnroll || isProcessingEnrollment}
                className="w-full sm:w-auto px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {isProcessingEnrollment ? 'Matriculando...' : 'Confirmar Matrícula'}
              </button>
            </form>

            {/* Tabela de Alunos Atualmente Matriculados */}
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 font-mono text-[11px] uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Aluno</th>
                    <th className="py-2.5 px-3">Matrícula</th>
                    <th className="py-2.5 px-3">Faixa Vigente</th>
                    <th className="py-2.5 px-3">Data Matrícula</th>
                    <th className="py-2.5 px-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {enrollments.filter(
                    (e) => e.classGroupId === selectedClassForEnrollments.id && e.status === 'active'
                  ).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        Nenhum aluno matriculado nesta turma até o momento.
                      </td>
                    </tr>
                  ) : (
                    enrollments
                      .filter((e) => e.classGroupId === selectedClassForEnrollments.id && e.status === 'active')
                      .map((enr) => {
                        const student = studentMap.get(enr.studentId);
                        const person = student ? personMap.get(student.personId) : null;
                        const studentName = person?.fullName || 'Aluno';
                        const grad = student?.currentGraduations?.find(
                          (g) => g.martialArtId === selectedClassForEnrollments.martialArtId
                        );

                        return (
                          <tr key={enr.id} className="hover:bg-slate-900/40 transition-colors">
                            <td className="py-2.5 px-3 font-semibold text-white">{studentName}</td>
                            <td className="py-2.5 px-3 font-mono text-slate-400">
                              {student?.registrationNumber || '-'}
                            </td>
                            <td className="py-2.5 px-3">
                              {grad ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 border border-slate-700">
                                  <span
                                    className="h-2 w-2 rounded-full border border-slate-600"
                                    style={{ backgroundColor: grad.beltColorHex }}
                                  />
                                  <span>{grad.beltName}</span>
                                </span>
                              ) : (
                                <span className="text-slate-500 text-[11px]">Sem faixa registrada</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-400 text-[11px]">{enr.enrolledAt}</td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                onClick={() => handleUnenrollStudent(enr.id, studentName)}
                                disabled={isProcessingEnrollment}
                                className="px-2 py-1 rounded text-[11px] font-semibold text-red-400 hover:text-white hover:bg-red-950/80 border border-red-500/30 transition-colors cursor-pointer"
                                title="Desmatricular da turma"
                              >
                                Desmatricular
                              </button>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={() => setSelectedClassForEnrollments(null)}
                className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer text-xs"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
