import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar,
  CheckCircle2,
  BookOpen,
  ChevronRight,
  Play,
  LayoutDashboard,
  Video,
  User,
  Award,
  Activity,
  Save,
  Clock,
  AlertCircle,
} from 'lucide-react';
import {
  Student,
  Person,
  ClassGroup,
  Invoice,
  AttendanceRecord,
  DigitalLibraryItem,
  Enrollment,
  PhysicalAssessment,
  GraduationEvent,
} from '../../types';
import { formatDateBR, formatCPF, formatPhoneBR } from '../../utils/formatters';
import { StudentDigitalLibrary } from './StudentDigitalLibrary';
import { YouTubePlayerModal } from '../common/YouTubePlayerModal';
import { BmiEvolutionChart } from '../admin/BmiEvolutionChart';
import { portalAccessService } from '../../services/portalAccessService';
import { CepInput } from '../common/CepInput';

interface StudentDashboardProps {
  student: Student | null;
  person: Person | null;
  classes: ClassGroup[];
  invoices?: Invoice[];
  attendances: AttendanceRecord[];
  libraryItems: DigitalLibraryItem[];
  enrollments?: Enrollment[];
  assessments?: PhysicalAssessment[];
  graduations?: GraduationEvent[];
  onOpenLibraryItem?: (item: DigitalLibraryItem) => void;
  onPersonUpdated?: (updatedPerson: Person) => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  student,
  person,
  classes,
  attendances,
  libraryItems,
  enrollments = [],
  assessments = [],
  graduations = [],
  onOpenLibraryItem,
  onPersonUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'attendance' | 'library' | 'anthropometry' | 'profile'
  >('overview');
  const [activePlayerVideo, setActivePlayerVideo] = useState<DigitalLibraryItem | null>(null);

  // Self-service contact & address form state
  const [phone, setPhone] = useState(person?.phone || '');
  const [email, setEmail] = useState(person?.email || '');
  const [street, setStreet] = useState(person?.address?.street || '');
  const [number, setNumber] = useState(person?.address?.number || '');
  const [neighborhood, setNeighborhood] = useState(person?.address?.neighborhood || '');
  const [city, setCity] = useState(person?.address?.city || '');
  const [state, setState] = useState(person?.address?.state || 'SP');
  const [zipCode, setZipCode] = useState(person?.address?.zipCode || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const numberInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (person) {
      setPhone(person.phone || '');
      setEmail(person.email || '');
      setStreet(person.address?.street || '');
      setNumber(person.address?.number || '');
      setNeighborhood(person.address?.neighborhood || '');
      setCity(person.address?.city || '');
      setState(person.address?.state || 'SP');
      setZipCode(person.address?.zipCode || '');
    }
  }, [person]);

  if (!student || !person) {
    return (
      <div className="p-8 text-center text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800 my-8 max-w-2xl mx-auto space-y-2">
        <AlertCircle className="h-8 w-8 text-red-400 mx-auto" />
        <p className="text-sm font-semibold text-white">Acesso ao Portal do Aluno</p>
        <p className="text-xs text-slate-400">
          Nenhum cadastro de aluno ativo e autorizado está vinculado a esta conta no momento. Solicite um código de convite na secretaria do seu dojo.
        </p>
      </div>
    );
  }

  const currentBelt = student?.currentGraduations?.[0];
  const allowAnthropometry = Boolean(student.allowAnthropometryView);

  // Strictly filter data to this student only
  const studentAtt = attendances
    .filter((a) => a.studentId === student.id && a.tenantId === student.tenantId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const presents = studentAtt.filter((a) => a.status === 'present' || a.status === 'excused').length;
  const attendanceRate =
    studentAtt.length > 0 ? Math.round((presents / studentAtt.length) * 100) : 100;

  const studentEnrollments = enrollments.filter(
    (e) => e.studentId === student.id && e.status === 'active'
  );
  const enrolledClassIds = new Set(studentEnrollments.map((e) => e.classId));
  const myClasses =
    enrolledClassIds.size > 0
      ? classes.filter((c) => enrolledClassIds.has(c.id))
      : classes.filter((c) => c.tenantId === student.tenantId);

  const studentGraduations = graduations
    .filter((g) => g.studentId === student.id && g.tenantId === student.tenantId)
    .sort((a, b) => (b.graduationDate || b.graduatedAt || '').localeCompare(a.graduationDate || a.graduatedAt || ''));

  const studentAssessments = allowAnthropometry
    ? assessments
        .filter((a) => a.studentId === student.id && a.tenantId === student.tenantId)
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];

  // Filter Digital Library strictly to the student's modality & belt
  const authorizedLibraryItems = portalAccessService.getAuthorizedDigitalLibraryForActor(
    {
      userId: student.userId || person.id,
      tenantId: student.tenantId,
      role: 'student',
      studentId: student.id,
    },
    libraryItems
  );

  const handleCardClick = (item: DigitalLibraryItem) => {
    setActivePlayerVideo(item);
    if (onOpenLibraryItem) onOpenLibraryItem(item);
  };

  const handleSavePersonalInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const res = await portalAccessService.updateOwnStudentPersonalInfo({
        tenantId: student.tenantId,
        studentId: student.id,
        personId: person.id,
        phone: phone.trim(),
        email: email.trim(),
        address: {
          street: street.trim(),
          number: number.trim(),
          neighborhood: neighborhood.trim(),
          city: city.trim(),
          state: state.trim(),
          zipCode: zipCode.trim(),
        },
      });

      setProfileMsg({
        type: res.success ? 'success' : 'error',
        text: res.message,
      });

      if (res.success && res.updatedPerson && onPersonUpdated) {
        onPersonUpdated(res.updatedPerson);
      }
    } catch (err: any) {
      setProfileMsg({
        type: 'error',
        text: err?.message || 'Não foi possível salvar seus dados de contato.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Student Portal Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            <span>Visão Geral & Faixa</span>
          </button>

          <button
            onClick={() => setActiveTab('attendance')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              activeTab === 'attendance'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Calendar className="h-3.5 w-3.5 text-emerald-400" />
            <span>Minha Presença ({studentAtt.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('library')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              activeTab === 'library'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Video className="h-3.5 w-3.5 text-red-500" />
            <span>Biblioteca Digital</span>
          </button>

          {allowAnthropometry && (
            <button
              onClick={() => setActiveTab('anthropometry')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                activeTab === 'anthropometry'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="h-3.5 w-3.5 text-blue-400" />
              <span>Evolução Física & IMC</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('profile')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              activeTab === 'profile'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <User className="h-3.5 w-3.5 text-amber-400" />
            <span>Meus Dados</span>
          </button>
        </div>

        <span className="text-xs text-slate-400 hidden sm:inline">
          Matrícula: <span className="font-mono text-slate-200">{student.registrationNumber}</span>
        </span>
      </div>

      {/* TAB: BIBLIOTECA DIGITAL */}
      {activeTab === 'library' && (
        <StudentDigitalLibrary
          student={student}
          person={person}
          classes={myClasses}
          enrollments={enrollments}
          libraryItems={authorizedLibraryItems}
        />
      )}

      {/* TAB: MINHA PRESENÇA */}
      {activeTab === 'attendance' && (
        <div className="space-y-4">
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Calendar className="h-4 w-4 text-emerald-400" />
                <span>Histórico Individual de Presença no Tatame</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Acompanhe todas as suas presenças registradas nas chamadas das suas turmas.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                  Assiduidade
                </span>
                <span className="text-lg font-bold font-mono text-emerald-400">
                  {attendanceRate}%
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                  Treinos Confirmados
                </span>
                <span className="text-lg font-bold font-mono text-white">{presents}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            {studentAtt.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                Nenhum registro de chamada lançado para sua matrícula até o momento.
              </div>
            ) : (
              <div className="divide-y divide-slate-800 text-xs">
                {studentAtt.map((att) => {
                  const cls = classes.find((c) => c.id === att.classId);
                  return (
                    <div
                      key={att.id}
                      className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-900/80"
                    >
                      <div>
                        <div className="font-semibold text-white">
                          {cls?.name || 'Treino Regular'}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                          <Clock className="h-3 w-3 text-slate-500" />
                          <span>Data: {formatDateBR(att.date)}</span>
                          {att.justification && <span>· Obs: {att.justification}</span>}
                        </div>
                      </div>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                          att.status === 'present'
                            ? 'bg-emerald-950/60 text-emerald-400 border-emerald-500/30'
                            : att.status === 'late'
                            ? 'bg-amber-950/60 text-amber-300 border-amber-500/30'
                            : att.status === 'excused'
                            ? 'bg-blue-950/60 text-blue-300 border-blue-500/30'
                            : 'bg-red-950/60 text-red-400 border-red-500/30'
                        }`}
                      >
                        {att.status === 'present'
                          ? 'Presente'
                          : att.status === 'late'
                          ? 'Atraso'
                          : att.status === 'excused'
                          ? 'Justificado'
                          : 'Ausente'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: EVOLUÇÃO FÍSICA & IMC (somente quando habilitado pela academia) */}
      {activeTab === 'anthropometry' && allowAnthropometry && (
        <div className="space-y-4">
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-blue-400" />
              <span>Minha Evolução Antropométrica & IMC</span>
            </h3>
            <p className="text-xs text-slate-400">
              Acompanhamento de peso, altura e índice de massa corporal registrado pelos avaliadores do dojo.
            </p>
          </div>

          <BmiEvolutionChart
            assessments={studentAssessments}
            studentBirthDate={person.birthDate}
          />
        </div>
      )}

      {/* TAB: MEUS DADOS CADASTRAIS */}
      {activeTab === 'profile' && (
        <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-5 text-xs">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <User className="h-4 w-4 text-red-400" />
              <span>Meus Dados Cadastrais</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Consulte seus dados institucionais e mantenha seu telefone, e-mail e endereço residencial atualizados.
            </p>
          </div>

          {profileMsg && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                profileMsg.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                  : 'bg-red-950/60 border-red-500/40 text-red-200'
              }`}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{profileMsg.text}</span>
            </div>
          )}

          {/* Dados somente leitura controlados pela secretaria */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
            <div>
              <span className="text-[10px] text-slate-500 uppercase block">Nome Completo</span>
              <span className="font-semibold text-white">{person.fullName}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase block">CPF</span>
              <span className="font-mono text-slate-200">{formatCPF(person.cpf) || 'Não informado'}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase block">Data de Nascimento</span>
              <span className="font-mono text-slate-200">{formatDateBR(person.birthDate)}</span>
            </div>
          </div>

          {/* Dados de contato e endereço editáveis pelo próprio aluno */}
          <form onSubmit={handleSavePersonalInfo} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Telefone / WhatsApp</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneBR(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">E-mail de Contato</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <CepInput
                  value={zipCode}
                  onChange={setZipCode}
                  onAddressResolved={(addr) => {
                    if (addr.logradouro) setStreet(addr.logradouro);
                    if (addr.bairro) setNeighborhood(addr.bairro);
                    if (addr.localidade) setCity(addr.localidade);
                    if (addr.uf) setState(addr.uf.toUpperCase());
                  }}
                  nextInputRef={numberInputRef}
                  label="CEP"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-slate-300 font-medium mb-1">Logradouro</label>
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="Rua / Avenida"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Número</label>
                <input
                  ref={numberInputRef}
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="123"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Bairro</label>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Cidade</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">UF</label>
                <input
                  type="text"
                  maxLength={2}
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingProfile}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-xs shadow transition-colors cursor-pointer disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{savingProfile ? 'Salvando...' : 'Atualizar Meus Dados de Contato'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB: VISÃO GERAL */}
      {activeTab === 'overview' && (
        <>
          {/* Top Banner: Student Rank Progression */}
          <div className="p-6 rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 to-slate-950 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div
                className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-slate-700 shadow-md text-slate-950 font-black text-xl"
                style={{ backgroundColor: currentBelt?.beltColorHex || '#fff' }}
              >
                🥋
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-mono">
                    Matrícula: {student.registrationNumber}
                  </span>
                  <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30">
                    {student.status === 'active' ? 'Ativo' : student.status}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-white mt-0.5">{person.fullName}</h2>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {student.currentGraduations && student.currentGraduations.length > 0 ? (
                    student.currentGraduations.map((g, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/90 border border-slate-700"
                      >
                        <span
                          className="h-2.5 w-4 rounded-sm border border-slate-600 shrink-0 shadow-sm"
                          style={{ backgroundColor: g.beltColorHex }}
                        />
                        <span className="text-[11px] font-bold text-white">
                          {g.martialArtName}:
                        </span>
                        <span className="text-[11px] text-slate-200">{g.beltName}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-400">Sem graduação registrada</div>
                  )}
                </div>
              </div>
            </div>

            {/* Attendance Rate */}
            <div className="flex items-center gap-6 border-t md:border-t-0 md:border-l border-slate-800 pt-4 md:pt-0 md:pl-6">
              <div className="text-right">
                <div className="text-xs text-slate-400">Frequência Pessoal</div>
                <div className="text-2xl font-bold text-emerald-400 font-mono tabular-nums">
                  {attendanceRate}%
                </div>
                <div className="text-[10px] text-slate-500">{presents} treinos confirmados</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-800 border border-slate-700 text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
            </div>
          </div>

          {/* Grid: My Classes & My Graduation History */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* My Classes */}
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-red-500" />
                  <span>Minhas Turmas & Horários</span>
                </h3>

                <div className="space-y-2.5">
                  {myClasses.map((cls) => (
                    <div
                      key={cls.id}
                      className="p-3 rounded-xl border border-slate-800 bg-slate-950/60"
                    >
                      <div className="font-semibold text-white text-xs">{cls.name}</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        {cls.startTime} às {cls.endTime} · {cls.tatamiRoom}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Instrutor: Prof. {cls.headInstructorName}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* My Graduation History */}
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <Award className="h-4 w-4 text-amber-400" />
                  <span>Minha Evolução de Faixa</span>
                </h3>

                <div className="space-y-2.5">
                  {studentGraduations.length > 0 ? (
                    studentGraduations.slice(0, 4).map((grad) => (
                      <div
                        key={grad.id}
                        className="p-3 rounded-xl border border-slate-800 bg-slate-950/60 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-semibold text-white text-xs">
                            {grad.newBeltName || grad.beltRankName || 'Graduação'}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {grad.martialArtName || currentBelt?.martialArtName || 'Modalidade'} · Avaliador:{' '}
                            {grad.evaluatorName || grad.examinerName}
                          </div>
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">
                          {formatDateBR(grad.graduationDate || grad.graduatedAt)}
                        </span>
                      </div>
                    ))
                  ) : currentBelt ? (
                    <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/60 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-white text-xs">
                          {currentBelt.beltName}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {currentBelt.martialArtName}
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400">
                        {formatDateBR(currentBelt.graduatedAt)}
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">
                      Nenhum histórico de promoção registrado.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Suggested Lessons from Authorized Digital Library */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-red-500" />
                <span>Videoaulas Recomendadas para sua Modalidade e Faixa</span>
              </h3>

              <button
                onClick={() => setActiveTab('library')}
                className="text-xs text-red-400 hover:text-red-300 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>Ver Acervo Completo ({authorizedLibraryItems.length})</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {authorizedLibraryItems.length === 0 ? (
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40 text-xs text-slate-400">
                Nenhum vídeo disponível para a sua modalidade/graduação no momento.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {authorizedLibraryItems.slice(0, 2).map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleCardClick(item)}
                    className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900 transition-all cursor-pointer flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                      <div className="relative w-16 aspect-video rounded bg-black shrink-0 overflow-hidden border border-slate-800">
                        <img
                          src={
                            item.thumbnailUrl ||
                            (item.youtubeVideoId
                              ? `https://img.youtube.com/vi/${item.youtubeVideoId}/hqdefault.jpg`
                              : '/src/assets/images/martial_arts_technique_1792068010372.jpg')
                          }
                          alt={item.title}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <Play className="h-3 w-3 fill-white text-white" />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold text-red-400 uppercase">
                          {item.category.replace('_', ' ')}
                        </div>
                        <div className="font-semibold text-white text-xs mt-0.5 truncate group-hover:text-red-400 transition-colors">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                          Por {item.authorInstructor}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-500 shrink-0 group-hover:text-slate-300 transition-colors" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Embedded Player Modal for on-demand playback */}
      <YouTubePlayerModal
        isOpen={Boolean(activePlayerVideo)}
        video={activePlayerVideo}
        onClose={() => setActivePlayerVideo(null)}
      />
    </div>
  );
};
