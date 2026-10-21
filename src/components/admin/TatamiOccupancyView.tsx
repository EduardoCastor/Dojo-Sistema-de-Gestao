import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { ClassGroup, ClassSchedule, MartialArt, User, Branch } from '../../types';
import { timeIntervalsOverlap } from '../../services/classService';

interface TatamiOccupancyViewProps {
  classes: ClassGroup[];
  martialArts: MartialArt[];
  instructors: User[];
  branches: Branch[];
  currentBranchId: string;
  tenantName: string;
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
  { id: 'all', label: 'Dia Inteiro (06:00 - 23:00)', startHour: 6, endHour: 23 },
  { id: 'morning', label: 'Manhã (06:00 - 12:00)', startHour: 6, endHour: 12 },
  { id: 'afternoon', label: 'Tarde (12:00 - 18:00)', startHour: 12, endHour: 18 },
  { id: 'night', label: 'Noite (18:00 - 23:00)', startHour: 18, endHour: 23 },
];

export const TatamiOccupancyView: React.FC<TatamiOccupancyViewProps> = ({
  classes,
  martialArts,
  instructors,
  branches,
  currentBranchId,
  tenantName,
  onOpenClass,
  onNavigateToClasses,
  onOpenAttendance,
}) => {
  // Estados de Filtro
  const [selectedDay, setSelectedDay] = useState<number>(1); // Padrão: Segunda-feira
  const [selectedBranchId, setSelectedBranchId] = useState<string>(currentBranchId || 'all');
  const [selectedTimeWindow, setSelectedTimeWindow] = useState<string>('all');
  const [selectedTatamiFilter, setSelectedTatamiFilter] = useState<string>('all');
  const [includeInactive, setIncludeInactive] = useState<boolean>(false);

  // Modal de Detalhes da Turma Ocupante
  const [detailModalClass, setDetailModalClass] = useState<ClassGroup | null>(null);
  const [freeSlotDetail, setFreeSlotDetail] = useState<{
    tatami: string;
    dayLabel: string;
    timeSlot: string;
  } | null>(null);

  const martialArtMap = useMemo(() => new Map(martialArts.map((m) => [m.id, m])), [martialArts]);

  // Filtrar turmas ativas/inativas e por filial
  const filteredClasses = useMemo(() => {
    return classes.filter((c) => {
      if (!includeInactive && !c.active) return false;
      if (selectedBranchId !== 'all' && c.branchId && c.branchId !== selectedBranchId) {
        return false;
      }
      return true;
    });
  }, [classes, includeInactive, selectedBranchId]);

  // Identificar espaços/tatamis cadastrados a partir das turmas e horários
  const distinctTatamis = useMemo(() => {
    const set = new Set<string>();

    classes.forEach((c) => {
      if (c.tatamiRoom?.trim()) {
        set.add(c.tatamiRoom.trim());
      }
      if (c.schedules) {
        c.schedules.forEach((s) => {
          if (s.tatamiRoom?.trim()) {
            set.add(s.tatamiRoom.trim());
          }
        });
      }
    });

    const list = Array.from(set).sort();
    return list.length > 0 ? list : ['Tatami Principal'];
  }, [classes]);

  // Lista de tatamis exibidos (após filtro de espaço)
  const displayTatamis = useMemo(() => {
    if (selectedTatamiFilter !== 'all') {
      return distinctTatamis.filter((t) => t === selectedTatamiFilter);
    }
    return distinctTatamis;
  }, [distinctTatamis, selectedTatamiFilter]);

  // Faixa de horas exibida nas colunas
  const activeWindowConfig = useMemo(() => {
    return TIME_WINDOWS.find((w) => w.id === selectedTimeWindow) || TIME_WINDOWS[0];
  }, [selectedTimeWindow]);

  const timeSlots = useMemo(() => {
    const slots: string[] = [];
    for (let h = activeWindowConfig.startHour; h < activeWindowConfig.endHour; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`);
    }
    return slots;
  }, [activeWindowConfig]);

  // Extrair todas as alocações de horários para o dia da semana selecionado
  interface OccupancySlot {
    classGroup: ClassGroup;
    tatami: string;
    startTime: string;
    endTime: string;
    instructor: string;
    hasConflict: boolean;
    conflictingClasses: string[];
    durationMinutes: number;
  }

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
        });
      });
    });

    // Detectar conflitos estritos: sobreposição de horário no MESMO tatami, MESMO dia e MESMA filial
    for (let i = 0; i < allocations.length; i++) {
      const a = allocations[i];
      for (let j = i + 1; j < allocations.length; j++) {
        const b = allocations[j];

        // Verificar mesmo tatami e mesma filial
        const sameRoom = a.tatami.trim().toLowerCase() === b.tatami.trim().toLowerCase();
        const sameBranch = !a.classGroup.branchId || !b.classGroup.branchId || a.classGroup.branchId === b.classGroup.branchId;

        if (sameRoom && sameBranch) {
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
  }, [filteredClasses, selectedDay, includeInactive]);

  // Indicadores de Ocupação
  const indicators = useMemo(() => {
    const totalTatamis = distinctTatamis.length;

    // Tatamis que possuem pelo menos 1 turma no dia
    const occupiedTatamiNames = new Set(dayAllocations.map((a) => a.tatami));
    const occupiedCount = occupiedTatamiNames.size;
    const availableCount = Math.max(0, totalTatamis - occupiedCount);

    // Total de horas ocupadas em todos os tatamis no dia
    const totalMinutesOccupied = dayAllocations.reduce((acc, a) => acc + a.durationMinutes, 0);
    const totalHoursOccupied = (totalMinutesOccupied / 60).toFixed(1);

    // Janela diária teórica: 06:00 às 23:00 = 17 horas por tatami
    const dailyOperatingHoursPerTatami = 17;
    const totalPotentialHours = totalTatamis * dailyOperatingHoursPerTatami;
    const occupancyRate =
      totalPotentialHours > 0
        ? Math.min(100, Math.round(((totalMinutesOccupied / 60) / totalPotentialHours) * 100))
        : 0;

    // Conflitos identificados
    const conflictsCount = dayAllocations.filter((a) => a.hasConflict).length;

    return {
      totalTatamis,
      occupiedCount,
      availableCount,
      totalHoursOccupied,
      occupancyRate,
      conflictsCount,
    };
  }, [distinctTatamis, dayAllocations]);

  const currentDayLabel = useMemo(
    () => DAYS_OF_WEEK.find((d) => d.id === selectedDay)?.label || 'Segunda-feira',
    [selectedDay]
  );

  return (
    <div className="space-y-6">
      {/* CABEÇALHO */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-red-500" />
              Quadro de Ocupação & Disponibilidade dos Tatamis
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-950/60 border border-red-500/30 text-red-400">
              Grade Semanal
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Visualização dos espaços cadastrados, horários de treino ocupados, janelas livres e detector de sobreposições.
          </p>
        </div>

        {onNavigateToClasses && (
          <button
            onClick={onNavigateToClasses}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            <Calendar className="h-4 w-4 text-red-400" />
            Cadastrar / Editar Turmas
          </button>
        )}
      </div>

      {/* PAINEL DE INDICADORES PRINCIPAIS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400">Tatamis Identificados</div>
          <div className="text-xl font-bold text-white mt-1">{indicators.totalTatamis}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Espaços do Dojo</div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400">Tatamis Ocupados ({currentDayLabel.slice(0, 3)})</div>
          <div className="text-xl font-bold text-red-400 mt-1">{indicators.occupiedCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Com aulas agendadas</div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400">Tatamis Totalmente Livres</div>
          <div className="text-xl font-bold text-emerald-400 mt-1">{indicators.availableCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Sem agendamentos hoje</div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400">Total de Horas Ocupadas</div>
          <div className="text-xl font-bold text-white mt-1">{indicators.totalHoursOccupied}h</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Carga horária semanal</div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400">Taxa de Utilização Diária</div>
          <div className="text-xl font-bold text-emerald-400 mt-1">{indicators.occupancyRate}%</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Janela 06h às 23h</div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="text-[11px] text-slate-400">Conflitos de Horário</div>
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
      <div className="bg-slate-900 border border-slate-800 p-2 rounded-2xl">
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
                onClick={() => setSelectedDay(day.id)}
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

      {/* FILTROS SECUNDÁRIOS & LEGENDA */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 bg-slate-900/70 border border-slate-800 p-4 rounded-2xl text-xs">
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

          {/* Faixa de Horário */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-semibold">Período:</span>
            <select
              value={selectedTimeWindow}
              onChange={(e) => setSelectedTimeWindow(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white focus:border-red-500 focus:outline-none"
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
            <span>Ocupado (Aula Ativa)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded border border-dashed border-slate-600 bg-slate-950/60"></div>
            <span>Disponível / Livre</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded bg-amber-500 animate-pulse"></div>
            <span className="text-amber-400 font-bold">Conflito de Horário</span>
          </div>
        </div>
      </div>

      {/* AVISO SE HOUVER CONFLITO NO DIA */}
      {indicators.conflictsCount > 0 && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl border border-amber-500/40 bg-amber-950/40 text-amber-200 text-xs font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span>
            Atenção: Existem turmas ocupando o mesmo espaço em horários sobrepostos neste dia. Verifique os blocos em destaque amarelo.
          </span>
        </div>
      )}

      {/* QUADRO VISUAL DE OCUPAÇÃO (GRID) */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Calendar className="h-4 w-4 text-red-500" />
              Grade de Horários · {currentDayLabel}
            </h3>
            <span className="text-xs text-slate-400">({dayAllocations.length} alocações)</span>
          </div>
          <div className="text-xs text-slate-400">
            Origem dos dados: <code className="text-slate-300">class_groups</code> & <code className="text-slate-300">class_group_schedules</code>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[850px] p-4 space-y-6">
            {displayTatamis.map((tatamiName) => {
              // Alocações para este tatami específico
              const tatamiSlots = dayAllocations
                .filter((a) => a.tatami.trim().toLowerCase() === tatamiName.trim().toLowerCase())
                .sort((a, b) => a.startTime.localeCompare(b.startTime));

              return (
                <div key={tatamiName} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-red-500"></div>
                      <span className="text-xs font-bold text-white uppercase tracking-wider">{tatamiName}</span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {tatamiSlots.length === 0 ? (
                        <span className="text-emerald-400 font-semibold">100% Livre hoje</span>
                      ) : (
                        `${tatamiSlots.length} ${tatamiSlots.length === 1 ? 'aula agendada' : 'aulas agendadas'}`
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
                            timeSlot: 'Dia Inteiro (06:00 às 23:00)',
                          })
                        }
                        className="w-full h-14 rounded-lg border border-dashed border-emerald-500/30 bg-emerald-950/10 hover:bg-emerald-950/20 flex items-center justify-center gap-2 text-xs text-emerald-400 font-medium transition-colors cursor-pointer"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Espaço totalmente livre na {currentDayLabel}. Clique para ver detalhes de agendamento.
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
                                <span className="truncate">Prof. {slot.instructor}</span>
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
