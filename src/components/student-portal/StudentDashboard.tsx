import React, { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  DollarSign,
  BookOpen,
  Copy,
  Check,
  ChevronRight,
  Play,
  LayoutDashboard,
  Video,
} from 'lucide-react';
import {
  Student,
  Person,
  ClassGroup,
  Invoice,
  AttendanceRecord,
  DigitalLibraryItem,
  Enrollment,
} from '../../types';
import { formatCurrencyBRL, formatDateBR } from '../../utils/formatters';
import { StudentDigitalLibrary } from './StudentDigitalLibrary';
import { YouTubePlayerModal } from '../common/YouTubePlayerModal';

interface StudentDashboardProps {
  student: Student;
  person: Person;
  classes: ClassGroup[];
  invoices: Invoice[];
  attendances: AttendanceRecord[];
  libraryItems: DigitalLibraryItem[];
  enrollments?: Enrollment[];
  onOpenLibraryItem?: (item: DigitalLibraryItem) => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  student,
  person,
  classes,
  invoices,
  attendances,
  libraryItems,
  enrollments = [],
  onOpenLibraryItem,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'library'>('overview');
  const [copiedPix, setCopiedPix] = useState(false);
  const [activePlayerVideo, setActivePlayerVideo] = useState<DigitalLibraryItem | null>(null);

  if (!student || !person) {
    return (
      <div className="p-8 text-center text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800 my-8">
        <p className="text-sm font-semibold text-white mb-1">Área do Aluno</p>
        <p className="text-xs text-slate-400">Nenhum prontuário de aluno vinculado a este perfil no momento.</p>
      </div>
    );
  }

  const currentBelt = student?.currentGraduations?.[0];

  // Attendance metrics
  const studentAtt = attendances.filter((a) => a.studentId === student.id);
  const presents = studentAtt.filter((a) => a.status === 'present' || a.status === 'excused').length;
  const attendanceRate = studentAtt.length > 0 ? Math.round((presents / studentAtt.length) * 100) : 100;

  // Student invoices
  const studentInvoices = invoices.filter((i) => i.studentId === student.id);
  const pendingInvoice = studentInvoices.find((i) => i.status === 'pending' || i.status === 'overdue');

  const handleCopyPix = (code?: string) => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopiedPix(true);
    setTimeout(() => setCopiedPix(false), 2000);
  };

  const handleCardClick = (item: DigitalLibraryItem) => {
    setActivePlayerVideo(item);
    if (onOpenLibraryItem) onOpenLibraryItem(item);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Student Portal Navigation Tabs */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <LayoutDashboard className="h-4 w-4" />
            <span>Visão Geral</span>
          </button>

          <button
            onClick={() => setActiveTab('library')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              activeTab === 'library'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Video className="h-4 w-4 text-red-500" />
            <span>Biblioteca Digital</span>
          </button>
        </div>

        <span className="text-xs text-slate-400 hidden sm:inline">
          Matrícula: <span className="font-mono text-slate-200">{student.registrationNumber}</span>
        </span>
      </div>

      {activeTab === 'library' ? (
        <StudentDigitalLibrary
          student={student}
          person={person}
          classes={classes}
          enrollments={enrollments}
          libraryItems={libraryItems}
        />
      ) : (
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
                  <span className="text-xs text-slate-400 font-mono">Matrícula: {student.registrationNumber}</span>
                  <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30">
                    {student.status === 'active' ? 'Ativo' : student.status}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-white mt-0.5">{person.fullName}</h2>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {student.currentGraduations && student.currentGraduations.length > 0 ? (
                    student.currentGraduations.map((g, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/90 border border-slate-700">
                        <span
                          className="h-2.5 w-4 rounded-sm border border-slate-600 shrink-0 shadow-sm"
                          style={{ backgroundColor: g.beltColorHex }}
                        />
                        <span className="text-[11px] font-bold text-white">{g.martialArtName}:</span>
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
                <div className="text-xs text-slate-400">Frequência Recente</div>
                <div className="text-2xl font-bold text-emerald-400 font-mono tabular-nums">{attendanceRate}%</div>
                <div className="text-[10px] text-slate-500">{presents} treinos confirmados</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-800 border border-slate-700 text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
            </div>
          </div>

          {/* Grid: Pending Bill Alert & Next Classes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Next Training Sessions */}
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-red-500" />
                  <span>Minhas Turmas & Horários</span>
                </h3>

                <div className="space-y-2.5">
                  {classes.map((cls) => (
                    <div key={cls.id} className="p-3 rounded-xl border border-slate-800 bg-slate-950/60">
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

            {/* Monthly Invoices & PIX Payment */}
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                  <span>Mensalidades & Pagamentos</span>
                </h3>

                {pendingInvoice ? (
                  <div className="p-4 rounded-xl border border-amber-600/40 bg-amber-950/20 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white">Mensalidade {pendingInvoice.competence}</span>
                      <span className="text-[10px] font-bold text-amber-400 uppercase bg-amber-950 px-2 py-0.5 rounded border border-amber-500/30">
                        Aguardando Pagamento
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-slate-400">Vencimento: {formatDateBR(pendingInvoice.dueDate)}</span>
                      <span className="text-lg font-bold text-white font-mono">{formatCurrencyBRL(pendingInvoice.finalAmount)}</span>
                    </div>

                    <button
                      onClick={() => handleCopyPix(pendingInvoice.pixCode)}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow transition-colors cursor-pointer"
                    >
                      {copiedPix ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      <span>{copiedPix ? 'Chave PIX Copiada!' : 'Pagar via PIX (Copia e Cola)'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-center text-xs text-emerald-300">
                    <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
                    <span className="font-semibold">Parabéns! Suas mensalidades estão em dia.</span>
                  </div>
                )}
              </div>

              <div className="pt-3 mt-3 border-t border-slate-800 text-[11px] text-slate-500 flex justify-between">
                <span>Recibos disponíveis com a secretaria</span>
                <span>Unidade Matriz</span>
              </div>
            </div>
          </div>

          {/* Suggested Lessons from Digital Library */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-red-500" />
                <span>Videoaulas Recomendadas para sua Faixa</span>
              </h3>

              <button
                onClick={() => setActiveTab('library')}
                className="text-xs text-red-400 hover:text-red-300 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>Ver Acervo Completo</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {libraryItems.slice(0, 2).map((item) => (
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
