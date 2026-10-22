import React, { useState, useMemo, useEffect } from 'react';
import {
  LayoutGrid,
  Calendar,
  Clock,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Users,
  Search,
  Filter,
  Eye,
  Plus,
  Info,
  Building2,
  ChevronRight,
  ShieldAlert,
  ArrowRight,
  Edit2,
  Trash2,
  Check,
  X,
  Layers,
  HelpCircle,
} from 'lucide-react';
import { ClassGroup, ClassSchedule, MartialArt, User, Branch, Tatami } from '../../types';
import { timeIntervalsOverlap } from '../../services/classService';
import { tatamiService } from '../../services/tatamiService';
import { TatamiFormModal } from './TatamiFormModal';

interface TatamiOccupancyViewProps {
  classes: ClassGroup[];
  martialArts: MartialArt[];
  instructors: User[];
  branches: Branch[];
  currentBranchId: string;
  tenantName: string;
  tenantId?: string;
  tatamis?: Tatami[];
  onRefreshTatamis?: () => Promise<void> | void;
  onOpenClass?: (cls: ClassGroup) => void;
  onNavigateToClasses?: () => void;
  onOpenAttendance?: (cls: ClassGroup) => void;
}

const DAYS_OF_WEEK = [
  { id: 1, label: 'Segunda-feira', short: 'Seg' },
  { id: 2, label: 'Terça-feira', short: 'Ter' },
  { id: 3, label: 'Quarta-feira', short: 'Qua' },
  { id: 4, label: 'Quinta-feira', short: 'Qui' },
  { id: 5, label: 'Sexta-feira', short: 'Sex' },
  { id: 6, label: 'Sábado', short: 'Sáb' },
  { id: 0, label: 'Domingo', short: 'Dom' },
];

const TIME_WINDOWS = [
  { id: 'all', label: 'Dia Inteiro (06:00 - 23:00)', startHour: 6, endHour: 23, startTime: '06:00', endTime: '23:00' },
  { id: 'morning', label: 'Manhã (06:00 - 12:00)', startHour: 6, endHour: 12, startTime: '06:00', endTime: '12:00' },
  { id: 'afternoon', label: 'Tarde (12:00 - 18:00)', startHour: 12, endHour: 18, startTime: '12:00', endTime: '18:00' },
  { id: 'night', label: 'Noite (18:00 - 23:00)', startHour: 18, endHour: 23, startTime: '18:00', endTime: '23:00' },
];

export const TatamiOccupancyView: React.FC<TatamiOccupancyViewProps> = ({
  classes,
  martialArts,
  instructors,
  branches,
  currentBranchId,
  tenantName,
  tenantId = 'tenant-kodokan',
  tatamis: externalTatamis,
  onRefreshTatamis,
  onOpenClass,
  onNavigateToClasses,
  onOpenAttendance,
}) => {
  // Aba ativa: 'occupancy' (Quadro de Ocupação & Horários) ou 'tatamis' (Gerenciar Tatamis)
  const [activeMainTab, setActiveMainTab] = useState<'occupancy' | 'tatamis'>('occupancy');

  // Estados de Tatamis (carregados do Supabase/Service ou props)
  const [localTatamis, setLocalTatamis] = useState<Tatami[]>(externalTatamis || []);
  const [isTatamiModalOpen, setIsTatamiModalOpen] = useState(false);
  const [editingTatami, setEditingTatami] = useState<Tatami | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ tatami: Tatami; linkedCount: number } | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Estados de Filtro da Grade de Ocupação
  const [selectedDay, setSelectedDay] = useState<number>(1); // Padrão: Segunda-feira
  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranchId || 'all');
  const [selectedTimeWindow, setSelectedTimeWindow] = useState<string>('all');
  const [selectedTatamiFilter, setSelectedTatamiFilter] = useState<string>('all');
  const [includeInactive, setIncludeInactive] = useState<boolean>(false);

  // Modais de Detalhe
  const [detailModalClass, setDetailModalClass] = useState<ClassGroup | null>(null);
  const [freeSlotDetail, setFreeSlotDetail] = useState<{
    tatami: string;
    dayLabel: string;
    timeSlot: string;
  } | null>(null);

  // Sincronizar tatamis externos quando alterados
  useEffect(() => {
    if (externalTatamis && externalTatamis.length > 0) {
      setLocalTatamis(externalTatamis);
    }
  }, [externalTatamis]);

  // Carregar tatamis do Supabase ao montar ou ao trocar de tenant
  useEffect(() => {
    let isCancelled = false;
    async function loadTatamisData() {
      try {
        const loaded = await tatamiService.fetchTatamis(tenantId, selectedBranchId !== 'all' ? selectedBranchId : undefined);
        if (!isCancelled && loaded && loaded.length > 0) {
          setLocalTatamis(loaded);
        }
      } catch (err) {
        console.warn('Aviso ao carregar tatamis:', err);
      }
    }
    loadTatamisData();
    return () => {
      isCancelled = true;
    };
  }, [tenantId, selectedBranchId]);

  const martialArtMap = useMemo(() => new Map(martialArts.map((m) => [m.id, m])), [martialArts]);
  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);

  // Lista unificada de tatamis ativos para exibição (mescla tatamis cadastrados + eventuais salas nas turmas)
  const allTatamisList = useMemo(() => {
    const list: Tatami[] = [...localTatamis];

    // Se houver salas nas turmas que ainda não têm registro em tatamis, adiciona representação dinâmica
    classes.forEach((c) => {
      const room = c.tatamiRoom?.trim();
      if (room && !list.some((t) => t.name.trim().toLowerCase() === room.toLowerCase())) {
        list.push({
          id: `tatami-dyn-${room.toLowerCase().replace(/\s+/g, '-')}`,
          tenantId: c.tenantId,
          branchId: c.branchId,
          name: room,
          maxCapacity: c.maxCapacity || 20,
          colorHex: '#dc2626',
          active: true,
        });
      }
    });

    return list;
  }, [localTatamis, classes]);

  // Filtrar turmas ativas/inativas e por filial selecionada
  const filteredClasses = useMemo(() => {
    return classes.filter((c) => {
      if (!includeInactive && !c.active) return false;
      if (selectedBranchId !== 'all' && c.branchId && c.branchId !== selectedBranchId) {
        return false;
      }
      return true;
    });
  }, [classes, includeInactive, selectedBranchId]);

  // Lista de nomes de tatamis distintos para os filtros
  const distinctTatamis = useMemo(() => {
    const set = new Set<string>();

    allTatamisList.forEach((t) => {
      if (includeInactive || t.active) {
        set.add(t.name.trim());
      }
    });

    const list = Array.from(set).sort();
    return list.length > 0 ? list : ['Tatami Principal'];
  }, [allTatamisList, includeInactive]);

  // Lista de tatamis a exibir nas colunas (após filtro de espaço)
  const displayTatamis = useMemo(() => {
    if (selectedTatamiFilter !== 'all') {
      return distinctTatamis.filter((t) => t === selectedTatamiFilter);
    }
    return distinctTatamis;
  }, [distinctTatamis, selectedTatamiFilter]);

  // Configuração da janela de período selecionada (PARTE B: Correção do Filtro de Período)
  const activeWindowConfig = useMemo(() => {
    return TIME_WINDOWS.find((w) => w.id === selectedTimeWindow) || TIME_WINDOWS[0];
  }, [selectedTimeWindow]);

  // Estrutura de Alocação de Turma em Tatami
  interface OccupancySlot {
    classGroup: ClassGroup;
    tatami: string;
    startTime: string;
    endTime: string;
    instructor: string;
    hasConflict: boolean;
    conflictingClasses: string[];
    durationMinutes: number;
    overlapsSelectedPeriod: boolean;
  }

  // PARTE B — Extrair alocações para o dia da semana considerando estritamente o período selecionado
  const dayAllocations = useMemo(() => {
    const allocations: OccupancySlot[] = [];

    filteredClasses.forEach((cls) => {
      // Obter slots deste dia para esta turma
      const slotsForDay: Array<{
        startTime: string;
        endTime: string;
        tatami: string;
        instructor: string;
      }> = [];

      if (cls.schedules && cls.schedules.length > 0) {
        cls.schedules
          .filter((s) => s.dayOfWeek === selectedDay && (includeInactive || s.active))
          .forEach((s) => {
            slotsForDay.push({
              startTime: s.startTime,
              endTime: s.endTime,
              tatami: s.tatamiRoom || cls.tatamiRoom || 'Tatami Principal',
              instructor: s.instructorName || cls.headInstructorName || 'Sensei',
            });
          });
      } else if (cls.daysOfWeek?.includes(selectedDay)) {
        slotsForDay.push({
          startTime: cls.startTime,
          endTime: cls.endTime,
          tatami: cls.tatamiRoom || 'Tatami Principal',
          instructor: cls.headInstructorName || 'Sensei',
        });
      }

      slotsForDay.forEach((s) => {
        // PARTE B: Checar sobreposição com a janela de período selecionada
        const overlapsWindow =
          selectedTimeWindow === 'all' ||
          timeIntervalsOverlap(s.startTime, s.endTime, activeWindowConfig.startTime, activeWindowConfig.endTime);

        // Se o filtro de período estiver ativo e a aula NÃO estiver no período, descartar
        if (!overlapsWindow) {
          return;
        }

        const toMin = (t: string) => {
          const [h, m] = t.split(':').map(Number);
          return (h || 0) * 60 + (m || 0);
        };
        const duration = Math.max(0, toMin(s.endTime) - toMin(s.startTime));

        allocations.push({
          classGroup: cls,
          tatami: s.tatami,
          startTime: s.startTime,
          endTime: s.endTime,
          instructor: s.instructor,
          hasConflict: false,
          conflictingClasses: [],
          durationMinutes: duration,
          overlapsSelectedPeriod: overlapsWindow,
        });
      });
    });

    // Detectar conflitos estritos: sobreposição de horário no MESMO tatami, MESMO dia e MESMA filial
    for (let i = 0; i < allocations.length; i++) {
      const a = allocations[i];
      for (let j = i + 1; j < allocations.length; j++) {
        const b = allocations[j];

        const sameRoom = a.tatami.trim().toLowerCase() === b.tatami.trim().toLowerCase();
        const sameBranch = !a.classGroup.branchId || !b.classGroup.branchId || a.classGroup.branchId === b.classGroup.branchId;

        if (sameRoom && sameBranch) {
          // Sobreposição estrita [s1, e1) e [s2, e2) — horários adjacentes 10h-11h e 11h-12h não colidem
          if (timeIntervalsOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
            a.hasConflict = true;
            b.hasConflict = true;
            if (!a.conflictingClasses.includes(b.classGroup.name)) {
              a.conflictingClasses.push(b.classGroup.name);
            }
            if (!b.conflictingClasses.includes(a.classGroup.name)) {
              b.conflictingClasses.push(a.classGroup.name);
            }
          }
        }
      }
    }

    return allocations;
  }, [filteredClasses, selectedDay, includeInactive, selectedTimeWindow, activeWindowConfig]);

  // PARTE B — Indicadores de Ocupação recalculados estritamente pelo período ativo
  const indicators = useMemo(() => {
    const totalTatamis = displayTatamis.length;

    // Tatamis que possuem pelo menos 1 aula agendada dentro deste período
    const occupiedTatamiNames = new Set(dayAllocations.map((a) => a.tatami.trim().toLowerCase()));
    const occupiedCount = displayTatamis.filter((t) => occupiedTatamiNames.has(t.trim().toLowerCase())).length;
    const availableCount = Math.max(0, totalTatamis - occupiedCount);

    // Duração total em horas ocupadas
    const totalMinutesOccupied = dayAllocations.reduce((acc, a) => acc + a.durationMinutes, 0);
    const totalHoursOccupied = (totalMinutesOccupied / 60).toFixed(1);

    // Janela diária teórica baseada no período selecionado (evita 17h fixas quando selecionado Manhã de 6h)
    const windowHours = activeWindowConfig.endHour - activeWindowConfig.startHour;
    const totalPotentialHours = totalTatamis * windowHours;
    const occupancyRate =
      totalPotentialHours > 0
        ? Math.min(100, Math.round(((totalMinutesOccupied / 60) / totalPotentialHours) * 100))
        : 0;

    // Conflitos identificados no período
    const conflictsCount = dayAllocations.filter((a) => a.hasConflict).length;

    return {
      totalTatamis,
      occupiedCount,
      availableCount,
      totalHoursOccupied,
      occupancyRate,
      conflictsCount,
      windowLabel: activeWindowConfig.label,
    };
  }, [displayTatamis, dayAllocations, activeWindowConfig]);

  const currentDayLabel = useMemo(
    () => DAYS_OF_WEEK.find((d) => d.id === selectedDay)?.label || 'Segunda-feira',
    [selectedDay]
  );

  // AÇÕES DE GESTÃO DE TATAMIS
  const handleOpenCreateTatami = () => {
    setEditingTatami(null);
    setIsTatamiModalOpen(true);
  };

  const handleOpenEditTatami = (tatami: Tatami) => {
    setEditingTatami(tatami);
    setIsTatamiModalOpen(true);
  };

  const handleSaveTatami = async (data: {
    id?: string;
    name: string;
    branchId?: string;
    dimensions?: string;
    maxCapacity: number;
    colorHex: string;
    description?: string;
    active: boolean;
  }) => {
    if (data.id) {
      // UPDATE
      const updated = await tatamiService.updateTatami(data.id, tenantId, {
        name: data.name,
        branchId: data.branchId,
        dimensions: data.dimensions,
        maxCapacity: data.maxCapacity,
        colorHex: data.colorHex,
        description: data.description,
        active: data.active,
      });

      setLocalTatamis((prev) => prev.map((t) => (t.id === data.id ? updated : t)));
      setFeedbackBanner({
        type: 'success',
        message: `Tatami "${updated.name}" atualizado com sucesso.`,
      });
    } else {
      // CREATE
      const created = await tatamiService.createTatami({
        tenantId,
        branchId: data.branchId,
        name: data.name,
        dimensions: data.dimensions,
        maxCapacity: data.maxCapacity,
        colorHex: data.colorHex,
        description: data.description,
        active: data.active,
      });

      setLocalTatamis((prev) => [created, ...prev]);
      setFeedbackBanner({
        type: 'success',
        message: `Tatami "${created.name}" cadastrado com sucesso no TatameHub.`,
      });
    }

    if (onRefreshTatamis) {
      await onRefreshTatamis();
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmation) return;

    try {
      const res = await tatamiService.deleteTatami(
        deleteConfirmation.tatami.id,
        tenantId,
        classes
      );

      if (res.softDeleted) {
        // Atualiza como inativo no estado local
        setLocalTatamis((prev) =>
          prev.map((t) => (t.id === deleteConfirmation.tatami.id ? { ...t, active: false } : t))
        );
      } else {
        // Exclui da lista
        setLocalTatamis((prev) => prev.filter((t) => t.id !== deleteConfirmation.tatami.id));
      }

      setFeedbackBanner({
        type: 'success',
        message: res.message,
      });

      if (onRefreshTatamis) {
        await onRefreshTatamis();
      }
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err.message || 'Falha ao excluir tatami.',
      });
    } finally {
      setDeleteConfirmation(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* CABEÇALHO */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-red-500" />
              Gerenciador de Tatamis
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-950/60 border border-red-500/30 text-red-400">
              {activeMainTab === 'occupancy' ? 'Quadro de Ocupação' : 'Cadastro de Tatamis'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Gestão física de áreas de treino, detecção de conflitos de horários em tempo real e consulta de disponibilidade.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeMainTab === 'tatamis' ? (
            <button
              onClick={handleOpenCreateTatami}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Novo Tatami
            </button>
          ) : (
            <button
              onClick={handleOpenCreateTatami}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4 text-red-400" />
              Cadastrar Tatami
            </button>
          )}

          {onNavigateToClasses && (
            <button
              onClick={onNavigateToClasses}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
            >
              <Calendar className="h-4 w-4 text-red-400" />
              Grade de Turmas
            </button>
          )}
        </div>
      </div>

      {/* BANNER DE FEEDBACK */}
      {feedbackBanner && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs animate-fadeIn ${
            feedbackBanner.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-300'
              : 'bg-red-950/60 border-red-500/30 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackBanner.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-red-400 shrink-0" />
            )}
            <span>{feedbackBanner.message}</span>
          </div>
          <button
            onClick={() => setFeedbackBanner(null)}
            className="text-slate-400 hover:text-white cursor-pointer ml-3"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* NAVEGAÇÃO ENTRE ABAS PRINCIPAIS */}
      <div className="flex border-b border-slate-800 gap-2">
        <button
          onClick={() => setActiveMainTab('occupancy')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeMainTab === 'occupancy'
              ? 'border-red-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <LayoutGrid className="h-4 w-4 text-red-500" />
          <span>Quadro de Ocupação & Horários</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
            {dayAllocations.length}
          </span>
        </button>

        <button
          onClick={() => setActiveMainTab('tatamis')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
            activeMainTab === 'tatamis'
              ? 'border-red-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="h-4 w-4 text-amber-400" />
          <span>Gerenciar Tatamis</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
            {localTatamis.length}
          </span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* ABA 1: QUADRO DE OCUPAÇÃO & DISPONIBILIDADE                     */}
      {/* ============================================================== */}
      {activeMainTab === 'occupancy' && (
        <div className="space-y-6">
          {/* PAINEL DE INDICADORES DINÂMICOS DO PERÍODO */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="text-[11px] text-slate-400">Tatamis Ativos</div>
              <div className="text-xl font-bold text-white mt-1">{indicators.totalTatamis}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Espaços do Dojo</div>
            </div>

            <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="text-[11px] text-slate-400 truncate">Ocupados ({currentDayLabel.slice(0, 3)})</div>
              <div className="text-xl font-bold text-red-400 mt-1">{indicators.occupiedCount}</div>
              <div className="text-[10px] text-slate-500 mt-0.5 truncate">{indicators.windowLabel}</div>
            </div>

            <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="text-[11px] text-slate-400 truncate">Tatamis Livres</div>
              <div className="text-xl font-bold text-emerald-400 mt-1">{indicators.availableCount}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Sem treinos no período</div>
            </div>

            <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="text-[11px] text-slate-400">Horas em Treino</div>
              <div className="text-xl font-bold text-white mt-1">{indicators.totalHoursOccupied}h</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Carga horária acumulada</div>
            </div>

            <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="text-[11px] text-slate-400">Ocupação do Período</div>
              <div className="text-xl font-bold text-emerald-400 mt-1">{indicators.occupancyRate}%</div>
              <div className="text-[10px] text-slate-500 mt-0.5 truncate">{indicators.windowLabel}</div>
            </div>

            <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
              <div className="text-[11px] text-slate-400">Conflitos no Período</div>
              <div
                className={`text-xl font-bold mt-1 ${
                  indicators.conflictsCount > 0 ? 'text-amber-400 animate-pulse' : 'text-slate-400'
                }`}
              >
                {indicators.conflictsCount}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {indicators.conflictsCount > 0 ? 'Sobreposição detectada' : 'Sem choques'}
              </div>
            </div>
          </div>

          {/* SELETOR DE DIA DA SEMANA */}
          <div className="bg-slate-900 border border-slate-800 p-2 rounded-2xl shadow-sm">
            <div className="grid grid-cols-7 gap-1">
              {DAYS_OF_WEEK.map((day) => {
                const isSelected = selectedDay === day.id;
                const countForDay = filteredClasses.filter((c) => {
                  if (c.schedules && c.schedules.length > 0) {
                    return c.schedules.some((s) => s.dayOfWeek === day.id);
                  }
                  return c.daysOfWeek?.includes(day.id);
                }).length;

                return (
                  <button
                    key={day.id}
                    onClick={() => {
                      setSelectedDay(day.id);
                    }}
                    className={`flex flex-col items-center justify-center py-2.5 px-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-red-600 text-white shadow-md shadow-red-900/30'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <span>{day.short}</span>
                    <span className={`text-[10px] mt-0.5 ${isSelected ? 'text-red-100' : 'text-slate-500'}`}>
                      {countForDay} {countForDay === 1 ? 'aula' : 'aulas'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* BARRA DE FILTROS (FILIAL, PERÍODO, TATAMI) E LEGENDA */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 p-4 rounded-2xl text-xs">
            <div className="flex flex-wrap items-center gap-3">
              {/* Filial */}
              {branches.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">Unidade:</span>
                  <select
                    value={selectedBranchId}
                    onChange={(e) => setSelectedBranchId(e.target.value)}
                    className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white focus:border-red-500 focus:outline-none"
                  >
                    <option value="all">Todas as Unidades</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* PARTE B: Filtro de Período Atualizado em Tempo Real */}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-semibold">Período:</span>
                <select
                  value={selectedTimeWindow}
                  onChange={(e) => setSelectedTimeWindow(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white focus:border-red-500 focus:outline-none font-medium"
                >
                  {TIME_WINDOWS.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tatami específico */}
              {distinctTatamis.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-semibold">Tatami:</span>
                  <select
                    value={selectedTatamiFilter}
                    onChange={(e) => setSelectedTatamiFilter(e.target.value)}
                    className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white focus:border-red-500 focus:outline-none"
                  >
                    <option value="all">Todos os Espaços</option>
                    {distinctTatamis.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Legenda Visual */}
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-300">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded bg-red-600"></div>
                <span>Ocupado</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded border border-dashed border-emerald-500 bg-emerald-950/20"></div>
                <span className="text-emerald-400">100% Livre</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded bg-amber-500 animate-pulse"></div>
                <span className="text-amber-400 font-bold">Conflito de Horário</span>
              </div>
            </div>
          </div>

          {/* AVISO SE HOUVER CONFLITO NO PERÍODO */}
          {indicators.conflictsCount > 0 && (
            <div className="flex items-center gap-2 p-3.5 rounded-xl border border-amber-500/40 bg-amber-950/40 text-amber-200 text-xs font-semibold">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                Atenção: Existem turmas ocupando o mesmo tatami em horários sobrepostos neste período ({activeWindowConfig.label}). Verifique os blocos amarelos abaixo.
              </span>
            </div>
          )}

          {/* QUADRO VISUAL DE OCUPAÇÃO (GRID) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-red-500" />
                <h3 className="text-sm font-bold text-white">
                  Grade de Horários · {currentDayLabel} ({activeWindowConfig.label})
                </h3>
                <span className="text-xs text-slate-400">({dayAllocations.length} alocações)</span>
              </div>
              <div className="text-xs text-slate-400">
                Filial: <strong className="text-white">{selectedBranchId === 'all' ? 'Todas' : branchMap.get(selectedBranchId)?.name || 'Matriz'}</strong>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[850px] p-4 space-y-6">
                {displayTatamis.map((tatamiName) => {
                  const tatamiSlots = dayAllocations
                    .filter((a) => a.tatami.trim().toLowerCase() === tatamiName.trim().toLowerCase())
                    .sort((a, b) => a.startTime.localeCompare(b.startTime));

                  const tatamiObj = allTatamisList.find(
                    (t) => t.name.trim().toLowerCase() === tatamiName.trim().toLowerCase()
                  );

                  return (
                    <div key={tatamiName} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: tatamiObj?.colorHex || '#dc2626' }}
                          />
                          <span className="text-xs font-bold text-white uppercase tracking-wider">{tatamiName}</span>
                          {tatamiObj?.dimensions && (
                            <span className="text-[10px] text-slate-400 font-mono">({tatamiObj.dimensions})</span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400">
                          {tatamiSlots.length === 0 ? (
                            <span className="text-emerald-400 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              100% Livre neste período ({activeWindowConfig.label.split(' ')[0]})
                            </span>
                          ) : (
                            `${tatamiSlots.length} ${tatamiSlots.length === 1 ? 'aula no período' : 'aulas no período'}`
                          )}
                        </span>
                      </div>

                      {/* Timeline Bar dos Horários */}
                      <div className="relative rounded-xl border border-slate-800 bg-slate-950 p-3 min-h-[90px] flex items-center">
                        {tatamiSlots.length === 0 ? (
                          <div
                            onClick={() =>
                              setFreeSlotDetail({
                                tatami: tatamiName,
                                dayLabel: currentDayLabel,
                                timeSlot: activeWindowConfig.label,
                              })
                            }
                            className="w-full h-14 rounded-lg border border-dashed border-emerald-500/30 bg-emerald-950/10 hover:bg-emerald-950/20 flex items-center justify-center gap-2 text-xs text-emerald-400 font-medium transition-colors cursor-pointer"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Espaço totalmente livre no período ({activeWindowConfig.label}). Clique para detalhes.
                          </div>
                        ) : (
                          <div className="w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                            {tatamiSlots.map((slot, idx) => {
                              const art = martialArtMap.get(slot.classGroup.martialArtId);

                              return (
                                <div
                                  key={`${slot.classGroup.id}-${idx}`}
                                  onClick={() => setDetailModalClass(slot.classGroup)}
                                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                                    slot.hasConflict
                                      ? 'border-amber-500 bg-amber-950/30 hover:bg-amber-950/50 shadow-md shadow-amber-900/20'
                                      : 'border-red-600/30 bg-slate-900 hover:border-red-500/70 hover:bg-slate-800/80 shadow'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-bold text-xs text-white truncate">
                                      {slot.classGroup.name}
                                    </span>
                                    {slot.hasConflict ? (
                                      <span className="px-1.5 py-0.5 rounded bg-amber-500 text-black font-extrabold text-[9px] uppercase tracking-wider shrink-0 flex items-center gap-1">
                                        <AlertTriangle className="h-2.5 w-2.5" />
                                        Conflito
                                      </span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 rounded bg-red-950 border border-red-500/30 text-red-400 font-bold text-[10px] shrink-0">
                                        {art?.name || 'Arte Marcial'}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 mt-1.5">
                                    <Clock className="h-3.5 w-3.5 text-red-400 shrink-0" />
                                    <span>
                                      {slot.startTime} às {slot.endTime}
                                    </span>
                                  </div>

                                  <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                                    <span className="truncate">Sensei {slot.instructor}</span>
                                    <span className="text-slate-500 font-medium">
                                      Cap: {slot.classGroup.maxCapacity}
                                    </span>
                                  </div>

                                  {slot.hasConflict && (
                                    <div className="text-[10px] text-amber-300 font-semibold mt-1.5 pt-1.5 border-t border-amber-500/30">
                                      Conflito com: {slot.conflictingClasses.join(', ')}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 2: GESTÃO DE TATAMIS & ESPAÇOS FÍSICOS                    */}
      {/* ============================================================== */}
      {activeMainTab === 'tatamis' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-red-500" />
              <div>
                <h3 className="text-sm font-bold text-white">Tatamis & Espaços Físicos Cadastrados</h3>
                <p className="text-xs text-slate-400">
                  Gerencie as salas de treino, limites de capacidade e identidades visuais de cada tatami.
                </p>
              </div>
            </div>

            <button
              onClick={handleOpenCreateTatami}
              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Cadastrar Novo Tatami</span>
            </button>
          </div>

          {/* Cards dos Tatamis Cadastrados */}
          {localTatamis.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-950/40 space-y-3">
              <LayoutGrid className="h-8 w-8 text-slate-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-300">Nenhum tatami cadastrado ainda</div>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Cadastre o primeiro tatami para organizar a grade de horários, alocação de turmas e controle de lotação.
              </p>
              <button
                onClick={handleOpenCreateTatami}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Cadastrar Primeiro Tatami
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {localTatamis.map((tatami) => {
                const linkedClasses = classes.filter((c) => {
                  const matchMain = c.tatamiRoom?.trim().toLowerCase() === tatami.name.trim().toLowerCase();
                  const matchSched = c.schedules?.some(
                    (s) => s.tatamiRoom?.trim().toLowerCase() === tatami.name.trim().toLowerCase()
                  );
                  return matchMain || matchSched;
                });

                const branch = tatami.branchId ? branchMap.get(tatami.branchId) : null;

                return (
                  <div
                    key={tatami.id}
                    className={`p-5 rounded-2xl border transition-all ${
                      tatami.active
                        ? 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                        : 'border-slate-800/60 bg-slate-950/40 opacity-75'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="h-4 w-4 rounded-lg shrink-0 shadow"
                          style={{ backgroundColor: tatami.colorHex || '#dc2626' }}
                        />
                        <div>
                          <h4 className="text-sm font-bold text-white">{tatami.name}</h4>
                          <span className="text-[11px] text-slate-400 block">
                            {branch ? branch.name : 'Todas as Unidades'}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          tatami.active
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {tatami.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-300 my-3">
                      <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-400">Capacidade Máxima:</span>
                        <span className="font-semibold text-white font-mono">{tatami.maxCapacity} alunos</span>
                      </div>
                      <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-400">Dimensões / Área:</span>
                        <span className="font-semibold text-white">{tatami.dimensions || 'Não informada'}</span>
                      </div>
                      <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
                        <span className="text-slate-400">Turmas Vinculadas:</span>
                        <span className="font-semibold text-red-400 font-mono">{linkedClasses.length} turma(s)</span>
                      </div>
                      {tatami.description && (
                        <p className="text-[11px] text-slate-400 italic pt-1">{tatami.description}</p>
                      )}
                    </div>

                    {/* Ações do Card */}
                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-end gap-2 text-xs">
                      <button
                        onClick={() => handleOpenEditTatami(tatami)}
                        title="Editar dados do tatami"
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                      >
                        <Edit2 className="h-3.5 w-3.5 text-blue-400" />
                        <span>Editar</span>
                      </button>

                      <button
                        onClick={() =>
                          setDeleteConfirmation({
                            tatami,
                            linkedCount: linkedClasses.length,
                          })
                        }
                        title={linkedClasses.length > 0 ? 'Desativar logicamente' : 'Excluir tatami'}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-red-950/60 text-slate-300 hover:text-red-400 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        <span>{linkedClasses.length > 0 ? 'Desativar' : 'Excluir'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO DE TATAMI */}
      <TatamiFormModal
        isOpen={isTatamiModalOpen}
        onClose={() => {
          setIsTatamiModalOpen(false);
          setEditingTatami(null);
        }}
        onSave={handleSaveTatami}
        tatamiToEdit={editingTatami}
        branches={branches}
        currentBranchId={selectedBranchId !== 'all' ? selectedBranchId : currentBranchId}
      />

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO / DESATIVAÇÃO */}
      {deleteConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
            <div className="flex items-center gap-2 mb-3 text-red-400">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <h3 className="text-base font-bold text-white">
                {deleteConfirmation.linkedCount > 0 ? 'Desativação de Tatami' : 'Excluir Tatami'}
              </h3>
            </div>

            <p className="text-xs text-slate-300 mb-3">
              Tem certeza que deseja {deleteConfirmation.linkedCount > 0 ? 'desativar' : 'excluir'} o tatami{' '}
              <strong className="text-white">"{deleteConfirmation.tatami.name}"</strong>?
            </p>

            {deleteConfirmation.linkedCount > 0 ? (
              <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-950/40 text-amber-200 text-xs mb-5 space-y-1.5">
                <p className="font-semibold text-amber-100 flex items-center gap-1.5">
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                  Preservação do Histórico de Treinos:
                </p>
                <p>
                  Este tatami possui <strong className="text-white">{deleteConfirmation.linkedCount} turma(s)</strong> vinculada(s). Para preservar todo o histórico de frequências, grades e relatórios, ele será <strong>desativado logicamente</strong>.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 mb-5">
                Este espaço não possui turmas vinculadas e será removido com segurança.
              </p>
            )}

            <div className="flex items-center justify-end gap-2.5 text-xs font-semibold">
              <button
                onClick={() => setDeleteConfirmation(null)}
                className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white shadow cursor-pointer"
              >
                {deleteConfirmation.linkedCount > 0 ? 'Confirmar Desativação' : 'Confirmar Exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALHES DA TURMA OCUPANTE */}
      {detailModalClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
            <button
              onClick={() => setDetailModalClass(null)}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              ✕
            </button>

            <div className="flex items-center gap-2 mb-3">
              <div className="h-3 w-3 rounded-full bg-red-500"></div>
              <h3 className="text-base font-bold text-white">{detailModalClass.name}</h3>
            </div>

            <div className="space-y-3 text-xs bg-slate-950 p-4 rounded-xl border border-slate-800 mb-5">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Modalidade:</span>
                <span className="font-semibold text-white">
                  {martialArtMap.get(detailModalClass.martialArtId)?.name || 'Arte Marcial'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Horário Previsto:</span>
                <span className="font-semibold text-white">
                  {detailModalClass.startTime} às {detailModalClass.endTime}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Espaço / Tatami:</span>
                <span className="font-semibold text-white">{detailModalClass.tatamiRoom}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Instrutor Responsável:</span>
                <span className="font-semibold text-white">{detailModalClass.headInstructorName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Capacidade Máxima:</span>
                <span className="font-semibold text-white">{detailModalClass.maxCapacity} alunos</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Faixa Etária:</span>
                <span className="font-semibold text-white">
                  {detailModalClass.minAge} a {detailModalClass.maxAge ? `${detailModalClass.maxAge} anos` : 'livre'}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 text-xs font-semibold">
              <button
                onClick={() => setDetailModalClass(null)}
                className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
              >
                Fechar
              </button>
              {onOpenAttendance && (
                <button
                  onClick={() => {
                    const cls = detailModalClass;
                    setDetailModalClass(null);
                    onOpenAttendance(cls);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white shadow cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Realizar Chamada Desta Turma
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALHES DE ESPAÇO LIVRE */}
      {freeSlotDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
            <button
              onClick={() => setFreeSlotDetail(null)}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              ✕
            </button>

            <div className="flex items-center gap-2 mb-2 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
              <h3 className="text-base font-bold text-white">Espaço Disponível</h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              O espaço <strong className="text-white">{freeSlotDetail.tatami}</strong> está livre na{' '}
              <strong className="text-white">{freeSlotDetail.dayLabel}</strong> no intervalo{' '}
              <strong className="text-white">{freeSlotDetail.timeSlot}</strong>.
            </p>

            <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950 text-xs text-slate-300 space-y-2 mb-5">
              <p>
                Deseja utilizar este espaço para cadastrar uma nova turma com grade semanal ou horário avulso?
              </p>
              <p className="text-slate-400 text-[11px]">
                O cadastro de turmas permite definir modalidade, professor, capacidade e validação automática de choques.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 text-xs font-semibold">
              <button
                onClick={() => setFreeSlotDetail(null)}
                className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
              >
                Voltar
              </button>
              {onNavigateToClasses && (
                <button
                  onClick={() => {
                    setFreeSlotDetail(null);
                    onNavigateToClasses();
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white shadow cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Ir para Cadastro de Turmas
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
