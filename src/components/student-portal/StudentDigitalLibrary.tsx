import React, { useState, useMemo, useEffect } from 'react';
import {
  Video,
  Play,
  Search,
  BookOpen,
  Lock,
  Globe,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Award,
} from 'lucide-react';
import {
  Student,
  Person,
  ClassGroup,
  DigitalLibraryItem,
  Enrollment,
} from '../../types';
import { YouTubePlayerModal } from '../common/YouTubePlayerModal';
import { digitalLibraryService } from '../../services/digitalLibraryService';

interface StudentDigitalLibraryProps {
  student: Student;
  person: Person;
  classes?: ClassGroup[];
  enrollments?: Enrollment[];
  libraryItems?: DigitalLibraryItem[];
}

export const StudentDigitalLibrary: React.FC<StudentDigitalLibraryProps> = ({
  student,
  person,
  classes = [],
  enrollments = [],
  libraryItems: propItems,
}) => {
  const [accessibleVideos, setAccessibleVideos] = useState<DigitalLibraryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedArtFilter, setSelectedArtFilter] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activePlayerVideo, setActivePlayerVideo] = useState<DigitalLibraryItem | null>(null);

  // Carregar vídeos autorizados para o aluno
  useEffect(() => {
    let isMounted = true;

    async function loadStudentVideos() {
      if (!student) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const studentEnrollments = enrollments.filter(
          (e) => e.studentId === student.id && e.status === 'active'
        );

        const videos = await digitalLibraryService.fetchStudentAccessibleVideos(
          student.tenantId,
          student.id,
          {
            studentGraduations: student.currentGraduations,
            studentEnrollments,
          }
        );

        if (isMounted) {
          setAccessibleVideos(videos);
        }
      } catch (err) {
        console.warn('Erro ao carregar acervo do aluno:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadStudentVideos();

    return () => {
      isMounted = false;
    };
  }, [student, enrollments]);

  // Modalidades presentes no acervo do aluno
  const studentModalities = useMemo(() => {
    const map = new Map<string, string>();
    if (student?.currentGraduations) {
      student.currentGraduations.forEach((g) => {
        if (g.martialArtId && g.martialArtName) {
          map.set(g.martialArtId, g.martialArtName);
        }
      });
    }
    accessibleVideos.forEach((v) => {
      if (v.martialArtId && v.martialArtName) {
        map.set(v.martialArtId, v.martialArtName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [student, accessibleVideos]);

  // Filtragem de vídeos
  const filteredVideos = useMemo(() => {
    return accessibleVideos.filter((video) => {
      const matchesSearch =
        video.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        video.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (video.authorInstructor && video.authorInstructor.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesArt =
        selectedArtFilter === 'all' || video.martialArtId === selectedArtFilter;

      const matchesCat =
        selectedCategory === 'all' || video.category === selectedCategory;

      return matchesSearch && matchesArt && matchesCat;
    });
  }, [accessibleVideos, searchTerm, selectedArtFilter, selectedCategory]);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-6 rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-600/15 border border-red-500/30 text-red-500">
            <BookOpen className="h-7 w-7" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-semibold text-slate-300">TatameHub Acervo Pedagógico</span>
              <span>·</span>
              <span>Conteúdo Exclusivo do Aluno</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight mt-0.5">
              Biblioteca Digital de Vídeos Técnicos
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Videoaulas, princípios de pegada (kumi-kata), katas e requisitos de exame selecionados para a sua graduação.
            </p>
          </div>
        </div>

        {/* Current Belts Badges */}
        <div className="flex flex-col items-start md:items-end gap-1.5 border-t md:border-t-0 md:border-l border-slate-800 pt-4 md:pt-0 md:pl-6">
          <span className="text-[11px] text-slate-400">Suas Graduações Atuais:</span>
          <div className="flex flex-wrap gap-2">
            {student?.currentGraduations && student.currentGraduations.length > 0 ? (
              student.currentGraduations.map((g, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs"
                >
                  <span
                    className="h-2.5 w-3.5 rounded-sm border border-slate-600 shrink-0 shadow-sm"
                    style={{ backgroundColor: g.beltColorHex }}
                  />
                  <span className="font-bold text-white">{g.martialArtName}:</span>
                  <span className="text-slate-300">{g.beltName}</span>
                </div>
              ))
            ) : (
              <span className="text-xs text-slate-400">Sem graduação registrada</span>
            )}
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Pesquisar por golpe, técnica, kata ou professor..."
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Modality Filter */}
          {studentModalities.length > 1 && (
            <select
              value={selectedArtFilter}
              onChange={(e) => setSelectedArtFilter(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 focus:border-red-500 focus:outline-none"
            >
              <option value="all">Todas as Modalidades</option>
              {studentModalities.map((art) => (
                <option key={art.id} value={art.id}>
                  {art.name}
                </option>
              ))}
            </select>
          )}

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 focus:border-red-500 focus:outline-none"
          >
            <option value="all">Todas as Categorias</option>
            <option value="waza_techniques">Técnicas (Waza)</option>
            <option value="kata">Katas Oficiais</option>
            <option value="rules_referee">Arbitragem</option>
            <option value="physical_prep">Prep. Física</option>
            <option value="philosophy_history">Filosofia</option>
            <option value="general">Geral</option>
          </select>
        </div>
      </div>

      {/* Videos Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-64 rounded-xl border border-slate-800 bg-slate-900/40 animate-pulse"
            />
          ))}
        </div>
      ) : filteredVideos.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredVideos.map((video) => (
            <div
              key={video.id}
              onClick={() => setActivePlayerVideo(video)}
              className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden hover:border-slate-700 hover:bg-slate-900/90 transition-all cursor-pointer group shadow-sm hover:shadow-md"
            >
              <div>
                {/* Thumbnail Container */}
                <div className="relative w-full aspect-video bg-black overflow-hidden">
                  <img
                    src={
                      video.thumbnailUrl ||
                      (video.youtubeVideoId
                        ? `https://img.youtube.com/vi/${video.youtubeVideoId}/hqdefault.jpg`
                        : '/src/assets/images/martial_arts_technique_1792068010372.jpg')
                    }
                    alt={video.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-85 group-hover:opacity-100 transition-opacity">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600/95 text-white shadow-xl group-hover:scale-110 transition-transform">
                      <Play className="h-5 w-5 fill-white ml-0.5" />
                    </div>
                  </div>

                  {/* Badges on Thumbnail */}
                  <div className="absolute top-2.5 left-2.5">
                    <span className="text-[10px] font-bold text-white bg-slate-900/80 backdrop-blur-sm px-2 py-0.5 rounded border border-slate-700">
                      {video.martialArtName || 'Arte Marcial'}
                    </span>
                  </div>

                  <div className="absolute bottom-2.5 right-2.5">
                    <span className="text-[10px] font-semibold text-slate-200 bg-black/75 backdrop-blur-sm px-2 py-0.5 rounded">
                      YouTube HD
                    </span>
                  </div>
                </div>

                {/* Body Content */}
                <div className="p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="capitalize">{video.category.replace('_', ' ')}</span>
                    {video.authorInstructor && (
                      <>
                        <span>·</span>
                        <span>Prof. {video.authorInstructor}</span>
                      </>
                    )}
                  </div>

                  <h3 className="text-sm font-bold text-white group-hover:text-red-400 transition-colors line-clamp-2">
                    {video.title}
                  </h3>

                  {video.description && (
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {video.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Bottom Card Footer */}
              <div className="p-4 border-t border-slate-800/80 flex items-center justify-between text-xs bg-slate-950/40">
                <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-medium">
                  {video.allBelts ? 'Liberado Geral' : 'Recomendado para sua Faixa'}
                </span>

                <button
                  type="button"
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 group-hover:bg-red-600 text-slate-200 group-hover:text-white transition-colors"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>Assistir</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Pedagogical Friendly Empty State */
        <div className="p-12 text-center rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-slate-400 mx-auto">
            <Lock className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-white">Nenhum vídeo disponível para sua graduação no momento</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Seus instrutores publicam videoaulas específicas conforme o cronograma pedagógico e as exigências do exame de faixa. Continue treinando firme no tatami!
          </p>
        </div>
      )}

      {/* On-Demand YouTube Player Modal */}
      <YouTubePlayerModal
        isOpen={Boolean(activePlayerVideo)}
        video={activePlayerVideo}
        onClose={() => setActivePlayerVideo(null)}
      />
    </div>
  );
};
