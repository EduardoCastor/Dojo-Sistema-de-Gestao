import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  Eye,
  Edit,
  ShieldCheck,
  User,
  Users,
  Award,
  Activity,
  HeartPulse,
  Calendar,
  X,
  FileText,
  AlertCircle,
  FileCheck,
  UserCheck,
  Link as LinkIcon,
  Phone,
  Mail,
  GraduationCap,
  Loader2,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import {
  Student,
  Person,
  GuardianRelationship,
  PhysicalAssessment,
  HealthRecord,
  BeltRank,
  ClassGroup,
  Enrollment,
  MembershipPlan,
} from '../../types';
import {
  formatDateBR,
  calculateAge,
  calculateBMI,
  formatCPF,
  formatPhoneBR,
  formatCurrencyBRL,
} from '../../utils/formatters';
import { validateCPF, cleanCPF } from '../../utils/cpfValidator';
import { studentService } from '../../services/studentService';
import { financialService } from '../../services/financialService';
import { DataStore } from '../../data/storage';

interface StudentsViewProps {
  students: Student[];
  persons: Person[];
  guardians: GuardianRelationship[];
  assessments: PhysicalAssessment[];
  healthRecords: HealthRecord[];
  belts: BeltRank[];
  classes: ClassGroup[];
  enrollments: Enrollment[];
  isLoading?: boolean;
  tenantId?: string;
  onOpenCreateStudent: () => void;
  onEditStudent: (student: Student) => void;
  onUpdatePerson?: (updatedPerson: Person) => void;
  onResetData?: () => void;
}

export const StudentsView: React.FC<StudentsViewProps> = ({
  students,
  persons,
  guardians,
  assessments,
  healthRecords,
  belts,
  classes,
  enrollments,
  isLoading,
  tenantId,
  onOpenCreateStudent,
  onEditStudent,
  onUpdatePerson,
  onResetData,
}) => {
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [viewMode, setViewMode] = useState<'students' | 'guardians'>('students');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [profileTab, setProfileTab] = useState<'id' | 'guardians' | 'anthropometry' | 'health' | 'ranks' | 'classes'>('id');

  // Planos Financeiros para exibição na lista e no perfil
  const [membershipPlans, setMembershipPlans] = useState<MembershipPlan[]>(() =>
    tenantId ? DataStore.getMembershipPlans(tenantId) : []
  );

  React.useEffect(() => {
    if (tenantId) {
      financialService
        .fetchPlans(tenantId)
        .then((plans: MembershipPlan[]) => setMembershipPlans(plans))
        .catch(() => setMembershipPlans(DataStore.getMembershipPlans(tenantId)));
    }
  }, [tenantId]);

  const plansMap = useMemo(() => {
    return new Map(membershipPlans.map((p) => [p.id, p]));
  }, [membershipPlans]);

  // Estado para Edição de Responsável diretamente na aba Famílias & Responsáveis
  const [editingGuardian, setEditingGuardian] = useState<Person | null>(null);
  const [editGName, setEditGName] = useState('');
  const [editGCpf, setEditGCpf] = useState('');
  const [editGPhone, setEditGPhone] = useState('');
  const [editGEmail, setEditGEmail] = useState('');
  const [editGBirthDate, setEditGBirthDate] = useState('1985-01-01');
  const [editGGender, setEditGGender] = useState<'male' | 'female' | 'other'>('male');
  const [editGCpfStatus, setEditGCpfStatus] = useState<{ isValid: boolean; error?: string } | null>(null);
  const [editGError, setEditGError] = useState('');
  const [editGSuccess, setEditGSuccess] = useState('');
  const [isSavingGuardian, setIsSavingGuardian] = useState(false);

  const handleStartEditGuardian = (p: Person) => {
    setEditingGuardian(p);
    setEditGName(p.fullName);
    setEditGCpf(p.cpf ? formatCPF(p.cpf) : '');
    setEditGPhone(p.phone || '');
    setEditGEmail(p.email || '');
    setEditGBirthDate(p.birthDate || '1985-01-01');
    setEditGGender(p.gender || 'male');
    setEditGCpfStatus(p.cpf ? { isValid: validateCPF(p.cpf).isValid } : null);
    setEditGError('');
    setEditGSuccess('');
  };

  const handleEditGCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const clean = cleanCPF(raw);
    if (clean.length > 11) return;
    const formatted = clean.length > 0 ? formatCPF(clean) : '';
    setEditGCpf(formatted);

    if (clean.length === 0) {
      setEditGCpfStatus(null);
      return;
    }
    if (clean.length < 11) {
      setEditGCpfStatus({ isValid: false, error: `Digite 11 dígitos (${clean.length}/11)` });
      return;
    }
    const val = validateCPF(clean);
    setEditGCpfStatus({ isValid: val.isValid, error: val.error });
  };

  const handleSaveGuardianEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGuardian) return;
    setEditGError('');
    setEditGSuccess('');

    if (!editGName.trim()) {
      setEditGError('O nome completo do responsável é obrigatório.');
      return;
    }

    const cleanC = cleanCPF(editGCpf);
    if (cleanC) {
      const val = validateCPF(cleanC);
      if (!val.isValid) {
        setEditGError(`CPF inválido: ${val.error}`);
        return;
      }
    }

    setIsSavingGuardian(true);
    try {
      const activeTenant = tenantId || editingGuardian.tenantId;
      const updated = await studentService.updatePerson(activeTenant, editingGuardian.id, {
        fullName: editGName.trim(),
        cpf: cleanC || undefined,
        phone: editGPhone.trim() || undefined,
        email: editGEmail.trim() || undefined,
        birthDate: editGBirthDate,
        gender: editGGender,
      });

      onUpdatePerson?.(updated);
      setEditGSuccess('Dados do responsável atualizados com sucesso!');
      setTimeout(() => {
        setEditingGuardian(null);
      }, 1000);
    } catch (err: any) {
      setEditGError(err?.message || 'Falha ao atualizar responsável.');
    } finally {
      setIsSavingGuardian(false);
    }
  };

  const getStudentPerson = (student: Student): Person => {
    const found = persons.find((p) => p.id === student.personId);
    if (found) return found;
    return {
      id: student.personId || `person-${student.id}`,
      tenantId: student.tenantId,
      fullName: `Aluno ${student.registrationNumber || student.id.substring(0, 8)}`,
      cpf: '',
      birthDate: '2010-01-01',
      gender: 'other',
      phone: '',
      email: '',
      address: {
        street: '',
        number: '',
        neighborhood: '',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '',
      },
      createdAt: student.enrollmentDate || new Date().toISOString(),
    };
  };

  // Filter students
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const person = getStudentPerson(s);

      const matchesSearch =
        (person.fullName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.registrationNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (person.cpf ? person.cpf.includes(searchTerm) : false);

      const matchesStatus =
        statusFilter === 'all' || s.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [students, persons, searchTerm, statusFilter]);

  // Agrupamento consolidado de todos os Responsáveis da academia ativa
  const guardiansGrouped = useMemo(() => {
    const map = new Map<
      string,
      {
        person: Person;
        isStudent: boolean;
        studentRecord?: Student;
        dependents: {
          student: Student;
          studentPerson: Person;
          relationship: GuardianRelationship;
        }[];
      }
    >();

    guardians.forEach((rel) => {
      const gPerson = persons.find((p) => p.id === rel.guardianPersonId);
      if (!gPerson) return;

      const student = students.find((s) => s.id === rel.studentId);
      const studentPerson = student ? getStudentPerson(student) : null;
      if (!student || !studentPerson) return;

      if (!map.has(gPerson.id)) {
        // Verificar se este responsável também possui matrícula de aluno no Dojo
        const matchingStudent = students.find((s) => s.personId === gPerson.id);
        map.set(gPerson.id, {
          person: gPerson,
          isStudent: Boolean(matchingStudent),
          studentRecord: matchingStudent,
          dependents: [],
        });
      }

      map.get(gPerson.id)!.dependents.push({
        student,
        studentPerson,
        relationship: rel,
      });
    });

    return Array.from(map.values());
  }, [guardians, persons, students]);

  // Responsáveis filtrados pela busca (nome, CPF com ou sem máscara, dependente, telefone, e-mail)
  const filteredGuardians = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return guardiansGrouped;
    const cleanTerm = cleanCPF(term);

    return guardiansGrouped.filter((item) => {
      const matchesName = item.person.fullName.toLowerCase().includes(term);
      const matchesCpf =
        (item.person.cpf && cleanTerm && cleanCPF(item.person.cpf).includes(cleanTerm)) ||
        (item.person.cpf ? item.person.cpf.toLowerCase().includes(term) : false);
      const matchesPhone = item.person.phone ? item.person.phone.includes(term) : false;
      const matchesEmail = item.person.email ? item.person.email.toLowerCase().includes(term) : false;
      const matchesDependent = item.dependents.some((d) =>
        d.studentPerson.fullName.toLowerCase().includes(term) ||
        d.student.registrationNumber.toLowerCase().includes(term)
      );
      return matchesName || matchesCpf || matchesPhone || matchesEmail || matchesDependent;
    });
  }, [guardiansGrouped, searchTerm]);

  const getStudentGuardians = (studentId: string) => {
    const rels = guardians.filter((g) => g.studentId === studentId);
    return rels.map((r) => {
      const gPerson = persons.find((p) => p.id === r.guardianPersonId);
      // Verificar se o responsável também é aluno
      const isAlsoStudent = students.some((s) => s.personId === gPerson?.id);
      // Verificar outros dependentes vinculados a esse mesmo responsável
      const otherDependents = guardians
        .filter((otherRel) => otherRel.guardianPersonId === r.guardianPersonId && otherRel.studentId !== studentId)
        .map((otherRel) => {
          const st = students.find((s) => s.id === otherRel.studentId);
          const stPerson = st ? getStudentPerson(st) : null;
          return {
            student: st,
            person: stPerson,
            relationshipLabel: otherRel.relationshipLabel,
          };
        })
        .filter((d) => d.student && d.person);

      return {
        relationship: r,
        person: gPerson,
        isAlsoStudent,
        otherDependents,
      };
    });
  };

  const getStudentAssessments = (studentId: string) => {
    return assessments.filter((a) => a.studentId === studentId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  const getStudentHealthRecord = (studentId: string) => {
    return healthRecords.find((h) => h.studentId === studentId);
  };

  const getStudentClasses = (studentId: string) => {
    const studentEnrollments = enrollments.filter((e) => e.studentId === studentId && e.status === 'active');
    return classes.filter((c) => studentEnrollments.some((e) => e.classGroupId === c.id));
  };

  const activePerson = selectedStudent ? getStudentPerson(selectedStudent) : null;
  const studentAge = activePerson ? calculateAge(activePerson.birthDate) : 0;
  const activeAssessments = selectedStudent ? getStudentAssessments(selectedStudent.id) : [];
  const latestAssessment = activeAssessments[0];
  const activeHealth = selectedStudent ? getStudentHealthRecord(selectedStudent.id) : null;
  const activeGuardians = selectedStudent ? getStudentGuardians(selectedStudent.id) : [];
  const activeClasses = selectedStudent ? getStudentClasses(selectedStudent.id) : [];

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Gestão de Alunos, Responsáveis & Famílias</h2>
          <p className="text-xs text-slate-400">
            Ficha cadastral completa, validação de CPF, vínculos familiares sem duplicidade e prontuários esportivos.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onResetData && (
            <button
              onClick={() => setIsConfirmingReset(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-700 hover:border-slate-600 transition-colors cursor-pointer shadow-sm"
              title="Limpar todos os registros e reiniciar do zero com dados consistentes e válidos"
            >
              <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
              <span>Começar do Zero</span>
            </button>
          )}

          <button
            onClick={onOpenCreateStudent}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 active:bg-red-700 transition-colors shadow cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Cadastrar Novo Aluno</span>
          </button>
        </div>
      </div>

      {/* Navegação entre Visualização de Alunos vs. Vínculos Familiares */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setViewMode('students')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            viewMode === 'students'
              ? 'bg-red-600 text-white shadow'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <User className="h-4 w-4" />
          <span>Alunos Matriculados ({students.length})</span>
        </button>

        <button
          onClick={() => setViewMode('guardians')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            viewMode === 'guardians'
              ? 'bg-red-600 text-white shadow'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Famílias & Responsáveis ({guardiansGrouped.length})</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={
              viewMode === 'students'
                ? 'Buscar aluno por nome, matrícula ou CPF...'
                : 'Buscar responsável por nome, CPF ou nome do dependente...'
            }
            className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
          />
        </div>

        {viewMode === 'students' && (
          <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                statusFilter === 'all' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Todos ({students.length})
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                statusFilter === 'active' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Ativos ({students.filter((s) => s.status === 'active').length})
            </button>
            <button
              onClick={() => setStatusFilter('inactive')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                statusFilter === 'inactive' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Inativos ({students.filter((s) => s.status !== 'active').length})
            </button>
          </div>
        )}
      </div>

      {/* MODO 1: TABELA DE ALUNOS */}
      {viewMode === 'students' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">Aluno / Matrícula</th>
                  <th className="py-3 px-4">Idade</th>
                  <th className="py-3 px-4">Graduação Atual</th>
                  <th className="py-3 px-4">Responsável Legal</th>
                  <th className="py-3 px-4">Mensalidade</th>
                  <th className="py-3 px-4">Situação</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Nenhum aluno encontrado com os filtros informados.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((s) => {
                    const person = getStudentPerson(s);
                    if (!person) return null;
                    const age = calculateAge(person.birthDate);
                    const guardianRels = getStudentGuardians(s.id);
                    const legalGuardian = guardianRels.find((g) => g.relationship.isLegalGuardian);
                    const currentBelt = s.currentGraduations?.[0];

                    return (
                      <tr key={s.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{person.fullName}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            Matrícula: {s.registrationNumber} {person.cpf ? `· CPF: ${formatCPF(person.cpf)}` : ''}
                          </div>
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums text-slate-300">
                          {age} anos
                          <span className="block text-[10px] text-slate-500">{formatDateBR(person.birthDate)}</span>
                        </td>

                        <td className="py-3 px-4">
                          {currentBelt ? (
                            <div className="flex items-center gap-2">
                              <span
                                className="h-3 w-3 rounded-full border border-slate-600 shrink-0"
                                style={{ backgroundColor: currentBelt.beltColorHex }}
                              ></span>
                              <span className="font-medium text-slate-200">{currentBelt.beltName}</span>
                            </div>
                          ) : (
                            <span className="text-slate-500 italic">Sem faixa</span>
                          )}
                          {currentBelt && (
                            <span className="text-[10px] text-slate-400 block">{currentBelt.martialArtName}</span>
                          )}
                        </td>

                        <td className="py-3 px-4">
                          {legalGuardian && legalGuardian.person ? (
                            <div>
                              <div className="font-medium text-slate-300 flex items-center gap-1.5">
                                <span>{legalGuardian.person.fullName}</span>
                                {legalGuardian.isAlsoStudent && (
                                  <span className="text-[9px] bg-blue-950/80 border border-blue-500/40 text-blue-300 px-1 py-0.2 rounded font-semibold">
                                    Aluno
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400">
                                {legalGuardian.relationship.relationshipLabel} · {formatPhoneBR(legalGuardian.person.phone)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-500 italic">Próprio aluno (Maior)</span>
                          )}
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-mono font-medium text-emerald-400">
                            {formatCurrencyBRL(s.monthlyFee || 0)}
                          </div>
                          {s.planId && plansMap.has(s.planId) ? (
                            <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] text-indigo-300 bg-indigo-950/70 border border-indigo-700/50 px-1.5 py-0.5 rounded font-medium max-w-[170px] truncate" title={plansMap.get(s.planId)!.name}>
                              {plansMap.get(s.planId)!.name}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-500 italic block mt-0.5">
                              Sem plano vinculado
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${
                              s.status === 'active'
                                ? 'bg-emerald-950/60 text-emerald-400 border-emerald-500/30'
                                : s.status === 'suspended'
                                ? 'bg-amber-950/60 text-amber-400 border-amber-500/30'
                                : 'bg-red-950/60 text-red-400 border-red-500/30'
                            }`}
                          >
                            {s.status === 'active'
                              ? 'Ativo'
                              : s.status === 'suspended'
                              ? 'Trancado'
                              : s.status === 'inactive'
                              ? 'Inativo'
                              : 'Cancelado'}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setSelectedStudent(s)}
                              className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
                              title="Ver prontuário completo do aluno"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => onEditStudent(s)}
                              className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
                              title="Editar dados e responsáveis do aluno"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODO 2: VISUALIZAÇÃO DE FAMÍLIAS & RESPONSÁVEIS */}
      {viewMode === 'guardians' && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/40 text-xs text-slate-300 flex items-center justify-between">
            <div>
              <span className="font-bold text-white">Central de Responsáveis e Vínculos Familiares</span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Uma mesma pessoa pode ser responsável por múltiplos alunos (irmãos/dependentes) e também ser aluna matriculada no Dojo, sem duplicação de CPF.
              </p>
            </div>
            <div className="text-right">
              <span className="font-mono text-sm font-bold text-red-400">{guardiansGrouped.length}</span>
              <span className="text-[11px] text-slate-400 block">responsáveis cadastrados</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredGuardians.length === 0 ? (
              <div className="col-span-2 p-8 text-center text-slate-500 rounded-xl border border-slate-800 bg-slate-900/40">
                Nenhum responsável encontrado com o termo pesquisado.
              </div>
            ) : (
              filteredGuardians.map((item) => (
                <div
                  key={item.person.id}
                  className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 transition-all space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{item.person.fullName}</span>
                        {item.isStudent && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-blue-950/80 border border-blue-500/40 text-blue-300 font-semibold flex items-center gap-1">
                            <GraduationCap className="h-3 w-3" />
                            Também é Aluno
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-slate-400 mt-1 font-mono">
                        <span>CPF: {formatCPF(item.person.cpf) || 'Não informado'}</span>
                        <span>·</span>
                        <span>{formatPhoneBR(item.person.phone)}</span>
                      </div>
                      {item.person.email && (
                        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                          <Mail className="h-3 w-3 text-slate-500" />
                          <span>{item.person.email}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleStartEditGuardian(item.person)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors text-xs font-semibold cursor-pointer"
                        title="Editar dados cadastrais do responsável"
                      >
                        <Edit className="h-3.5 w-3.5 text-red-400" />
                        <span>Editar</span>
                      </button>
                    </div>
                  </div>

                  {/* Dependentes vinculados a esta pessoa */}
                  <div className="pt-2 border-t border-slate-800/80 space-y-2">
                    <span className="text-[11px] font-semibold text-slate-300 block uppercase tracking-wider">
                      Alunos Dependentes ({item.dependents.length}):
                    </span>
                    <div className="space-y-1.5">
                      {item.dependents.map((dep) => (
                        <div
                          key={dep.relationship.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-white flex items-center gap-2">
                              <span>{dep.studentPerson.fullName}</span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                {dep.relationship.relationshipLabel}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                              Matrícula: {dep.student.registrationNumber}
                              {dep.relationship.isFinancialGuardian && ' · Resp. Financeiro'}
                              {dep.relationship.isLegalGuardian && ' · Resp. Legal'}
                            </div>
                          </div>

                          <button
                            onClick={() => setSelectedStudent(dep.student)}
                            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                            title="Ver ficha deste aluno"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Complete Student Profile Modal / Drawer */}
      {selectedStudent && activePerson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setSelectedStudent(null)}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Profile Header */}
            <div className="flex items-start gap-4 pb-4 border-b border-slate-800">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-800 border border-slate-700 text-red-400 text-lg font-bold">
                {activePerson.fullName ? activePerson.fullName.substring(0, 2).toUpperCase() : 'AL'}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-white">{activePerson.fullName || 'Aluno'}</h3>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                    {selectedStudent.status === 'active' ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-1">
                  <span>Matrícula: <strong className="text-slate-200 font-mono">{selectedStudent.registrationNumber}</strong></span>
                  <span>·</span>
                  <span>Idade: <strong className="text-slate-200 font-mono">{studentAge} anos</strong></span>
                  <span>·</span>
                  <span>Ingresso: {formatDateBR(selectedStudent.enrollmentDate)}</span>
                </div>
              </div>
              <button
                onClick={() => {
                  const s = selectedStudent;
                  setSelectedStudent(null);
                  onEditStudent(s);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:text-white hover:bg-slate-700 transition-colors text-xs font-semibold cursor-pointer"
              >
                <Edit className="h-3.5 w-3.5" />
                <span>Editar Aluno</span>
              </button>
            </div>

            {/* Profile Tabs */}
            <div className="flex border-b border-slate-800 my-4 text-xs font-semibold overflow-x-auto">
              <button
                onClick={() => setProfileTab('id')}
                className={`py-2 px-3 border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                  profileTab === 'id' ? 'border-red-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Identificação & Contato
              </button>
              <button
                onClick={() => setProfileTab('guardians')}
                className={`py-2 px-3 border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                  profileTab === 'guardians' ? 'border-red-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Responsáveis & Família ({activeGuardians.length})
              </button>
              <button
                onClick={() => setProfileTab('anthropometry')}
                className={`py-2 px-3 border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                  profileTab === 'anthropometry' ? 'border-red-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Antropometria & IMC
              </button>
              <button
                onClick={() => setProfileTab('health')}
                className={`py-2 px-3 border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                  profileTab === 'health' ? 'border-red-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Saúde & Atestados (LGPD)
              </button>
              <button
                onClick={() => setProfileTab('ranks')}
                className={`py-2 px-3 border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                  profileTab === 'ranks' ? 'border-red-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Graduações & Faixas
              </button>
              <button
                onClick={() => setProfileTab('classes')}
                className={`py-2 px-3 border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                  profileTab === 'classes' ? 'border-red-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Turmas Ativas ({activeClasses.length})
              </button>
            </div>

            {/* Tab Contents */}
            <div className="text-xs space-y-4">
              {/* TAB 1: IDENTIFICAÇÃO */}
              {profileTab === 'id' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 space-y-2">
                    {activePerson.socialName && (
                      <div className="text-slate-400">Nome Social: <span className="text-red-400 font-semibold">{activePerson.socialName}</span></div>
                    )}
                    <div className="text-slate-400">CPF: <span className="text-white font-mono">{formatCPF(activePerson.cpf)}</span></div>
                    <div className="text-slate-400">Nascimento: <span className="text-white font-mono">{formatDateBR(activePerson.birthDate)}</span></div>
                    <div className="text-slate-400">Gênero: <span className="text-white capitalize">{activePerson.gender === 'male' ? 'Masculino' : 'Feminino'}</span></div>
                    <div className="text-slate-400">Telefone: <span className="text-white">{formatPhoneBR(activePerson.phone)}</span></div>
                    <div className="text-slate-400">E-mail: <span className="text-white">{activePerson.email}</span></div>
                  </div>

                  <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 space-y-2">
                    <div className="font-semibold text-slate-300">Endereço Residencial:</div>
                    <div className="text-slate-400">{activePerson.address?.street || '-'}, {activePerson.address?.number || 'S/N'}</div>
                    <div className="text-slate-400">Bairro: {activePerson.address?.neighborhood || '-'}</div>
                    <div className="text-slate-400">{activePerson.address?.city || 'São Paulo'} - {activePerson.address?.state || 'SP'}</div>
                    <div className="text-slate-400 font-mono">CEP: {activePerson.address?.zipCode || '-'}</div>
                  </div>

                  <div className="sm:col-span-2 p-3.5 rounded-lg border border-slate-800 bg-slate-950/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">Plano de Mensalidade:</span>
                        {selectedStudent.planId && plansMap.has(selectedStudent.planId) ? (
                          <span className="inline-flex items-center text-xs font-semibold text-indigo-300 bg-indigo-950/80 border border-indigo-700/60 px-2 py-0.5 rounded">
                            {plansMap.get(selectedStudent.planId)!.name}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Sem plano vinculado / Personalizado</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {selectedStudent.planId && plansMap.has(selectedStudent.planId) && plansMap.get(selectedStudent.planId)!.discountPercentage ? (
                          <span>Desconto contratual: {plansMap.get(selectedStudent.planId)!.discountPercentage}% · </span>
                        ) : null}
                        Matrícula registrada em: <span className="font-mono text-slate-300">{formatDateBR(selectedStudent.enrollmentDate)}</span>
                      </div>
                    </div>
                    <div className="sm:text-right">
                      <span className="text-[10px] text-slate-400 block uppercase tracking-wider font-semibold">Mensalidade Efetiva</span>
                      <span className="text-base font-bold font-mono text-emerald-400">
                        {formatCurrencyBRL(selectedStudent.monthlyFee || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: RESPONSÁVEIS */}
              {profileTab === 'guardians' && (
                <div className="space-y-3">
                  <div className="text-slate-400 text-[11px]">
                    Conforme diretrizes legais e LGPD, parentesco biológico não presume automaticamente representação financeira ou autorização de retirada.
                  </div>
                  {activeGuardians.length === 0 ? (
                    <div className="p-4 rounded-lg border border-slate-800 text-center text-slate-500">
                      Nenhum responsável legal cadastrado para este aluno.
                    </div>
                  ) : (
                    activeGuardians.map((g, idx) => (
                      <div key={idx} className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="font-bold text-white text-sm flex items-center gap-2">
                            <span>{g.person?.fullName || 'Responsável'}</span>
                            <span className="text-slate-400 font-normal">({g.relationship.relationshipLabel})</span>
                            {g.isAlsoStudent && (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-blue-950/80 border border-blue-500/40 text-blue-300 font-semibold">
                                🥋 Também é Aluno do Dojo
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {g.relationship.isLegalGuardian && (
                              <span className="px-2 py-0.5 rounded bg-blue-950/60 border border-blue-500/30 text-blue-400 text-[10px] font-semibold">
                                Responsável Legal
                              </span>
                            )}
                            {g.relationship.isFinancialGuardian && (
                              <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-[10px] font-semibold">
                                Responsável Financeiro
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 font-mono">
                          <div>CPF: <span className="text-slate-200">{formatCPF(g.person?.cpf) || '-'}</span></div>
                          <div>Telefone: <span className="text-slate-200">{g.person ? formatPhoneBR(g.person.phone) : '-'}</span></div>
                          <div>E-mail: <span className="text-slate-200 font-sans">{g.person?.email || '-'}</span></div>
                          <div>Autorizado p/ Retirada: <span className={g.relationship.isPickupAuthorized ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>{g.relationship.isPickupAuthorized ? 'Sim' : 'Não'}</span></div>
                        </div>

                        {/* Outros dependentes vinculados a esse responsável no Dojo */}
                        {g.otherDependents && g.otherDependents.length > 0 && (
                          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
                            <span className="text-slate-300 font-semibold block mb-1">
                              Outros alunos vinculados a este responsável (Família no Dojo):
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {g.otherDependents.map((other, oIdx) => (
                                <button
                                  key={oIdx}
                                  onClick={() => {
                                    if (other.student) {
                                      setSelectedStudent(other.student);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition-colors cursor-pointer"
                                >
                                  <User className="h-3 w-3 text-red-400" />
                                  <span>{other.person?.fullName} ({other.relationshipLabel})</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {g.relationship.notes && (
                          <div className="text-[11px] text-slate-400 bg-slate-900 p-2 rounded border border-slate-800">
                            Observações: {g.relationship.notes}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 3: ANTROPOMETRIA & IMC */}
              {profileTab === 'anthropometry' && (
                <div className="space-y-4">
                  {latestAssessment ? (
                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                      <div className="p-2 rounded bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400 uppercase">Peso Atual</div>
                        <div className="text-lg font-bold text-white font-mono tabular-nums">{latestAssessment.weightKg} kg</div>
                      </div>
                      <div className="p-2 rounded bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400 uppercase">Altura</div>
                        <div className="text-lg font-bold text-white font-mono tabular-nums">{latestAssessment.heightCm} cm</div>
                      </div>
                      <div className="p-2 rounded bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400 uppercase">IMC Calculado</div>
                        <div className="text-lg font-bold text-emerald-400 font-mono tabular-nums">{latestAssessment.bmi}</div>
                      </div>
                      <div className="p-2 rounded bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400 uppercase">Classificação</div>
                        <div className="text-xs font-semibold text-slate-200 mt-1">
                          {calculateBMI(latestAssessment.weightKg, latestAssessment.heightCm).classification}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-slate-500">Nenhuma avaliação antropométrica registrada.</div>
                  )}

                  <div className="p-3 rounded-lg bg-slate-900/40 border border-slate-800 text-[11px] text-slate-400">
                    <span className="font-semibold text-amber-300">Aviso:</span> O Índice de Massa Corporal (IMC) é exibido apenas como indicador biométrico auxiliar e não substitui avaliação médica clínica. Categorias de peso para torneios respeitam as regras oficiais da federação.
                  </div>

                  {activeAssessments.length > 0 && (
                    <div className="border border-slate-800 rounded-lg overflow-hidden">
                      <div className="bg-slate-950 px-3 py-2 font-semibold text-slate-300 text-[11px]">
                        Histórico de Pesagens
                      </div>
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-900 text-slate-400 text-[10px] uppercase">
                          <tr>
                            <th className="py-2 px-3">Data</th>
                            <th className="py-2 px-3">Peso</th>
                            <th className="py-2 px-3">Altura</th>
                            <th className="py-2 px-3">IMC</th>
                            <th className="py-2 px-3">Avaliador</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {activeAssessments.map((a) => (
                            <tr key={a.id}>
                              <td className="py-2 px-3 font-mono">{formatDateBR(a.date)}</td>
                              <td className="py-2 px-3 font-mono">{a.weightKg} kg</td>
                              <td className="py-2 px-3 font-mono">{a.heightCm} cm</td>
                              <td className="py-2 px-3 font-mono text-emerald-400">{a.bmi}</td>
                              <td className="py-2 px-3 text-slate-400">{a.evaluatorName}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: SAÚDE & ATESTADOS (LGPD) */}
              {profileTab === 'health' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl border border-red-500/20 bg-red-950/20 flex items-start gap-3">
                    <ShieldCheck className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-white text-xs">Proteção LGPD de Dados Sensíveis de Saúde</div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Registros médicos, restrições e atestados são classificados como dados sensíveis e acessíveis apenas a administradores e instrutores autorizados.
                      </p>
                    </div>
                  </div>

                  {activeHealth ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 space-y-2">
                        <div className="font-semibold text-slate-200">Condições Clínicas & Restrições</div>
                        <div className="text-slate-400">Condições: <span className="text-white font-medium">{activeHealth.conditions?.join(', ') || 'Nenhuma informada'}</span></div>
                        <div className="text-slate-400">Alergias: <span className="text-white">{activeHealth.allergies?.join(', ') || 'Nenhuma informada'}</span></div>
                        <div className="text-slate-400">Restrições Físicas: <span className="text-white">{activeHealth.physicalRestrictions?.join(', ') || 'Nenhuma'}</span></div>
                        <div className="text-slate-400">Medicamentos: <span className="text-white">{activeHealth.voluntaryMedications || 'Nenhum'}</span></div>
                      </div>

                      <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 space-y-2">
                        <div className="font-semibold text-slate-200">Atestado Médico & Liberação</div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                              activeHealth.medicalCertExpiryDate && new Date(activeHealth.medicalCertExpiryDate) > new Date()
                                ? 'bg-emerald-950/60 text-emerald-400 border-emerald-500/30'
                                : 'bg-red-950/60 text-red-400 border-red-500/30'
                            }`}
                          >
                            {activeHealth.medicalCertExpiryDate && new Date(activeHealth.medicalCertExpiryDate) > new Date()
                              ? 'Apto para Treinos e Competições'
                              : 'Atestado Pendente ou Vencido'}
                          </span>
                        </div>
                        <div className="text-slate-400 text-[11px]">
                          Vencimento do Atestado: <span className="text-white font-mono">{formatDateBR(activeHealth.medicalCertExpiryDate)}</span>
                        </div>
                        {activeHealth.emergencyContactNotes && (
                          <div className="text-amber-400 text-[11px] bg-amber-950/20 p-2 rounded border border-amber-500/30">
                            Emergência: {activeHealth.emergencyContactNotes}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-slate-500">Nenhum prontuário de saúde preenchido para este aluno.</div>
                  )}
                </div>
              )}

              {/* TAB 5: GRADUAÇÕES & FAIXAS */}
              {profileTab === 'ranks' && (
                <div className="space-y-4">
                  <div className="border border-slate-800 rounded-lg overflow-hidden">
                    <div className="bg-slate-950 px-3 py-2 font-semibold text-slate-300 text-[11px] flex items-center justify-between">
                      <span>Graduações Registradas</span>
                      <span className="text-[10px] text-slate-400">Total: {selectedStudent.currentGraduations?.length || 0}</span>
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900 text-slate-400 text-[10px] uppercase">
                        <tr>
                          <th className="py-2 px-3">Modalidade</th>
                          <th className="py-2 px-3">Faixa / Grau</th>
                          <th className="py-2 px-3">Data da Graduação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {(!selectedStudent.currentGraduations || selectedStudent.currentGraduations.length === 0) ? (
                          <tr>
                            <td colSpan={3} className="py-4 text-center text-slate-500">
                              Nenhuma graduação registrada.
                            </td>
                          </tr>
                        ) : (
                          selectedStudent.currentGraduations.map((g, idx) => (
                            <tr key={idx}>
                              <td className="py-2 px-3 font-semibold text-white">{g.martialArtName}</td>
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="h-3 w-3 rounded-full border border-slate-600 shrink-0"
                                    style={{ backgroundColor: g.beltColorHex }}
                                  />
                                  <span className="font-medium text-slate-200">{g.beltName}</span>
                                </div>
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-400">{formatDateBR(g.graduatedAt)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 6: TURMAS */}
              {profileTab === 'classes' && (
                <div className="space-y-3">
                  {activeClasses.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 rounded-lg border border-slate-800">
                      O aluno não está enturmado em nenhuma classe ativa.
                    </div>
                  ) : (
                    activeClasses.map((c) => {
                      const dayLabels: Record<number, string> = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' };
                      const daysText = c.daysOfWeek?.map((d) => dayLabels[d] || String(d)).join(', ');
                      return (
                        <div key={c.id} className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-between">
                          <div>
                            <div className="font-bold text-white text-xs">{c.name}</div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              Instrutor Responsável: {c.headInstructorName}
                            </div>
                          </div>
                          <div className="text-right text-[11px] text-slate-400 font-mono">
                            {daysText ? `${daysText} · ` : ''}{c.startTime} - {c.endTime}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição de Dados do Responsável */}
      {editingGuardian && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
            <button
              onClick={() => setEditingGuardian(null)}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600/20 text-red-500">
                <Edit className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Editar Responsável</h3>
                <p className="text-xs text-slate-400">
                  Atualize os dados cadastrais da pessoa física.
                </p>
              </div>
            </div>

            {editGError && (
              <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-500/50 text-xs text-red-200 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{editGError}</span>
              </div>
            )}

            {editGSuccess && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-950/50 border border-emerald-500/50 text-xs text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{editGSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSaveGuardianEdit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  value={editGName}
                  onChange={(e) => setEditGName(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-medium">CPF (11 dígitos)</label>
                  {editGCpfStatus && (
                    <span className={`text-[10px] flex items-center gap-1 ${editGCpfStatus.isValid ? 'text-emerald-400' : 'text-red-400'}`}>
                      {editGCpfStatus.isValid ? (
                        <>
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          <span>CPF Válido</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-2.5 w-2.5" />
                          <span>{editGCpfStatus.error}</span>
                        </>
                      )}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={editGCpf}
                  onChange={handleEditGCpfChange}
                  placeholder="000.000.000-00"
                  maxLength={14}
                  className={`w-full rounded-lg border px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none ${
                    editGCpfStatus && !editGCpfStatus.isValid
                      ? 'border-red-500 bg-red-950/20'
                      : editGCpfStatus && editGCpfStatus.isValid
                      ? 'border-emerald-500 bg-emerald-950/20'
                      : 'border-slate-700 bg-slate-800 focus:border-red-500'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Telefone / WhatsApp</label>
                  <input
                    type="text"
                    value={editGPhone}
                    onChange={(e) => setEditGPhone(e.target.value)}
                    placeholder="(11) 98888-7777"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">E-mail</label>
                  <input
                    type="email"
                    value={editGEmail}
                    onChange={(e) => setEditGEmail(e.target.value)}
                    placeholder="responsavel@email.com"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Data de Nascimento</label>
                  <input
                    type="date"
                    value={editGBirthDate}
                    onChange={(e) => setEditGBirthDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Gênero</label>
                  <select
                    value={editGGender}
                    onChange={(e) => setEditGGender(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  >
                    <option value="male">Masculino</option>
                    <option value="female">Feminino</option>
                    <option value="other">Outro</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingGuardian(null)}
                  className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingGuardian}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-semibold transition-colors disabled:opacity-50"
                >
                  {isSavingGuardian ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <span>Salvar Alterações</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO: REINICIAR BASE DO ZERO */}
      {isConfirmingReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-red-500/40 bg-slate-900 p-6 shadow-2xl text-slate-200">
            <div className="flex items-center gap-3 text-red-400 mb-3">
              <RotateCcw className="h-6 w-6 shrink-0" />
              <h3 className="text-base font-bold text-white">Reiniciar Base do Zero</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              Esta ação irá limpar os registros atuais de alunos, responsáveis e vínculos da academia, restaurando uma base limpa e estruturada com dados íntegros e CPFs válidos.
            </p>
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/30 text-[11px] text-red-200 mb-5">
              ⚠️ Vínculos corrompidos ou registros duplicados serão completamente redefinidos para o padrão seguro.
            </div>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsConfirmingReset(false)}
                disabled={isResetting}
                className="px-3.5 py-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isResetting}
                onClick={async () => {
                  if (onResetData) {
                    setIsResetting(true);
                    try {
                      await onResetData();
                    } finally {
                      setIsResetting(false);
                      setIsConfirmingReset(false);
                    }
                  }
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 active:bg-red-700 text-xs text-white font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                {isResetting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Reiniciando...</span>
                  </>
                ) : (
                  <span>Sim, Reiniciar do Zero</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
