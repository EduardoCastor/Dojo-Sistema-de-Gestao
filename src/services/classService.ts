import { supabase, isSupabaseConfigured } from './supabase';
import { isValidUUID } from './studentService';
import { ClassGroup, ClassSchedule, Enrollment, MartialArt, BeltRank, Student, Person, User } from '../types';
import { DataStore } from '../data/storage';

export interface ScheduleConflict {
  type: 'room_overlap' | 'instructor_overlap' | 'internal_overlap' | 'student_overlap';
  dayOfWeek: number;
  dayLabel: string;
  startTime: string;
  endTime: string;
  conflictingEntityName: string;
  message: string;
}

export interface ClassScheduleReportRow {
  dayOfWeek: number;
  dayLabel: string;
  startTime: string;
  endTime: string;
  className: string;
  classId: string;
  martialArtName: string;
  instructorName: string;
  tatamiRoom: string;
  branchName?: string;
  enrolledCount: number;
  maxCapacity: number;
  vacancies: number;
  occupancyPercent: number;
  status: 'active' | 'inactive';
}

export interface GraduationReportClassSummary {
  classId: string;
  className: string;
  martialArtName: string;
  tatamiRoom: string;
  instructorName: string;
  totalEnrolled: number;
  ranksDistribution: {
    beltId: string;
    beltName: string;
    colorHex: string;
    orderIndex: number;
    count: number;
    students: { id: string; name: string; registrationNumber: string }[];
  }[];
  unassignedRankStudents: { id: string; name: string; registrationNumber: string }[];
}

export interface GraduationReportOverall {
  classes: GraduationReportClassSummary[];
  overallRanksTotal: {
    beltId: string;
    beltName: string;
    colorHex: string;
    orderIndex: number;
    totalStudents: number;
  }[];
  totalEnrollments: number;
  uniqueStudentsCount: number;
}

const DAYS_MAP: Record<number, string> = {
  0: 'Domingo',
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado',
};

/**
 * Verifica se dois intervalos de horário se sobrepõem: [s1, e1) e [s2, e2)
 */
export function timeIntervalsOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  // Converte "HH:mm" em minutos desde 00:00
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const start1 = toMinutes(s1);
  const end1 = toMinutes(e1);
  const start2 = toMinutes(s2);
  const end2 = toMinutes(e2);

  return start1 < end2 && start2 < end1;
}

export const classService = {
  /**
   * Consulta todas as turmas da academia, acompanhadas de seus horários estruturados.
   */
  async fetchClasses(tenantId: string): Promise<ClassGroup[]> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId)) {
      return DataStore.getClasses(tenantId);
    }

    try {
      // 1. Buscar turmas
      const { data: classesData, error: classesError } = await supabase
        .from('class_groups')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true });

      if (classesError) {
        console.warn('Aviso ao consultar class_groups no Supabase (usando fallback local):', classesError.message);
        return DataStore.getClasses(tenantId);
      }

      // 2. Buscar horários estruturados
      let schedulesMap = new Map<string, ClassSchedule[]>();
      try {
        const { data: schedulesData } = await supabase
          .from('class_schedules')
          .select('*')
          .eq('tenant_id', tenantId);

        if (schedulesData) {
          schedulesData.forEach((s: any) => {
            const sched: ClassSchedule = {
              id: s.id,
              tenantId: s.tenant_id,
              classGroupId: s.class_group_id,
              dayOfWeek: s.day_of_week,
              startTime: s.start_time ? s.start_time.substring(0, 5) : '18:00',
              endTime: s.end_time ? s.end_time.substring(0, 5) : '19:00',
              tatamiRoom: s.tatami_room || 'Tatami Principal',
              instructorUserId: s.instructor_user_id || undefined,
              instructorName: s.instructor_name || undefined,
              active: s.active ?? true,
              notes: s.notes || undefined,
              createdAt: s.created_at,
            };
            const current = schedulesMap.get(s.class_group_id) || [];
            current.push(sched);
            schedulesMap.set(s.class_group_id, current);
          });
        }
      } catch (errSched) {
        console.warn('Aviso ao consultar class_schedules:', errSched);
      }

      const mapped: ClassGroup[] = (classesData || []).map((c: any) => {
        const scheds = schedulesMap.get(c.id) || [];
        return {
          id: c.id,
          tenantId: c.tenant_id,
          branchId: c.branch_id,
          martialArtId: c.martial_art_id,
          name: c.name,
          headInstructorId: c.head_instructor_user_id || undefined,
          headInstructorName: c.head_instructor_name || 'Sensei Responsável',
          daysOfWeek: Array.isArray(c.days_of_week) ? c.days_of_week : [1, 3, 5],
          startTime: c.start_time ? c.start_time.substring(0, 5) : '18:00',
          endTime: c.end_time ? c.end_time.substring(0, 5) : '19:00',
          maxCapacity: c.max_capacity || 20,
          minAge: c.min_age || 5,
          maxAge: c.max_age || undefined,
          allowedBeltRanks: c.allowed_belt_ranks || undefined,
          tatamiRoom: c.tatami_room || 'Tatami Principal',
          active: c.active ?? true,
          notes: c.notes || undefined,
          schedules: scheds.length > 0 ? scheds : undefined,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        };
      });

      // Atualiza cache local
      if (mapped.length > 0) {
        DataStore.saveClasses(mapped);
      }
      return mapped;
    } catch (err) {
      console.error('Falha geral ao buscar turmas no Supabase:', err);
      return DataStore.getClasses(tenantId);
    }
  },

  /**
   * Consulta matrículas ativas em turmas no Supabase.
   */
  async fetchEnrollments(tenantId: string): Promise<Enrollment[]> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId)) {
      return DataStore.getEnrollments(tenantId);
    }

    try {
      const { data, error } = await supabase
        .from('enrollments')
        .select('*')
        .eq('tenant_id', tenantId);

      if (error) {
        console.warn('Aviso ao consultar enrollments no Supabase (usando fallback local):', error.message);
        return DataStore.getEnrollments(tenantId);
      }

      const mapped: Enrollment[] = (data || []).map((e: any) => ({
        id: e.id,
        tenantId: e.tenant_id,
        branchId: e.branch_id,
        studentId: e.student_id,
        classGroupId: e.class_group_id,
        enrolledAt: e.enrolled_at || new Date().toISOString().split('T')[0],
        status: e.status || 'active',
      }));

      DataStore.saveEnrollments(mapped);
      return mapped;
    } catch (err) {
      console.warn('Erro ao carregar matrículas:', err);
      return DataStore.getEnrollments(tenantId);
    }
  },

  /**
   * Valida conflitos operacionais antes de salvar uma turma e seus horários:
   * 1. Conflito de horário do mesmo espaço (Tatami)
   * 2. Conflito de horário do mesmo instrutor
   * 3. Conflitos internos dentro da própria grade da turma
   */
  detectScheduleConflicts(
    slotsToValidate: Array<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      tatamiRoom: string;
      instructorName?: string;
      instructorId?: string;
    }>,
    existingClasses: ClassGroup[],
    editingClassId?: string
  ): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];

    // 1. Validar sobreposição interna dentro dos próprios slots a serem salvos
    for (let i = 0; i < slotsToValidate.length; i++) {
      const s1 = slotsToValidate[i];
      for (let j = i + 1; j < slotsToValidate.length; j++) {
        const s2 = slotsToValidate[j];
        if (s1.dayOfWeek === s2.dayOfWeek && timeIntervalsOverlap(s1.startTime, s1.endTime, s2.startTime, s2.endTime)) {
          conflicts.push({
            type: 'internal_overlap',
            dayOfWeek: s1.dayOfWeek,
            dayLabel: DAYS_MAP[s1.dayOfWeek] || `Dia ${s1.dayOfWeek}`,
            startTime: s1.startTime,
            endTime: s1.endTime,
            conflictingEntityName: 'Mesma Turma',
            message: `Dois horários definidos para esta mesma turma se sobrepõem na ${DAYS_MAP[s1.dayOfWeek]} (${s1.startTime}-${s1.endTime} e ${s2.startTime}-${s2.endTime}).`,
          });
        }
      }
    }

    // 2. Validar sobreposição com outras turmas ativas da academia
    const otherClasses = existingClasses.filter((c) => c.active && c.id !== editingClassId);

    slotsToValidate.forEach((slot) => {
      otherClasses.forEach((other) => {
        // Obter os horários da outra turma (seja por schedules estruturados ou por daysOfWeek)
        const otherSlots: Array<{
          dayOfWeek: number;
          startTime: string;
          endTime: string;
          tatamiRoom: string;
          instructorName: string;
        }> = [];

        if (other.schedules && other.schedules.length > 0) {
          other.schedules
            .filter((s) => s.active)
            .forEach((s) => {
              otherSlots.push({
                dayOfWeek: s.dayOfWeek,
                startTime: s.startTime,
                endTime: s.endTime,
                tatamiRoom: s.tatamiRoom || other.tatamiRoom,
                instructorName: s.instructorName || other.headInstructorName,
              });
            });
        } else {
          (other.daysOfWeek || []).forEach((d) => {
            otherSlots.push({
              dayOfWeek: d,
              startTime: other.startTime,
              endTime: other.endTime,
              tatamiRoom: other.tatamiRoom,
              instructorName: other.headInstructorName,
            });
          });
        }

        otherSlots.forEach((oSlot) => {
          if (slot.dayOfWeek === oSlot.dayOfWeek && timeIntervalsOverlap(slot.startTime, slot.endTime, oSlot.startTime, oSlot.endTime)) {
            // Verificar conflito de espaço/tatami
            const sameRoom =
              slot.tatamiRoom &&
              oSlot.tatamiRoom &&
              slot.tatamiRoom.trim().toLowerCase() === oSlot.tatamiRoom.trim().toLowerCase();

            if (sameRoom) {
              conflicts.push({
                type: 'room_overlap',
                dayOfWeek: slot.dayOfWeek,
                dayLabel: DAYS_MAP[slot.dayOfWeek] || `Dia ${slot.dayOfWeek}`,
                startTime: slot.startTime,
                endTime: slot.endTime,
                conflictingEntityName: other.name,
                message: `Conflito de espaço: O "${slot.tatamiRoom}" já está ocupado pela turma "${other.name}" na ${DAYS_MAP[slot.dayOfWeek]} das ${oSlot.startTime} às ${oSlot.endTime}.`,
              });
            }

            // Verificar conflito de instrutor
            const currentInst = slot.instructorName?.trim().toLowerCase();
            const otherInst = oSlot.instructorName?.trim().toLowerCase();
            if (currentInst && otherInst && currentInst === otherInst) {
              conflicts.push({
                type: 'instructor_overlap',
                dayOfWeek: slot.dayOfWeek,
                dayLabel: DAYS_MAP[slot.dayOfWeek] || `Dia ${slot.dayOfWeek}`,
                startTime: slot.startTime,
                endTime: slot.endTime,
                conflictingEntityName: other.name,
                message: `Conflito de instrutor: O professor "${slot.instructorName}" já possui aula agendada na turma "${other.name}" na ${DAYS_MAP[slot.dayOfWeek]} das ${oSlot.startTime} às ${oSlot.endTime}.`,
              });
            }
          }
        });
      });
    });

    return conflicts;
  },

  /**
   * Salva uma turma com múltiplos horários estruturados de forma atômica no Supabase.
   */
  async saveClass(
    tenantId: string,
    classPayload: {
      id?: string;
      branchId: string;
      martialArtId: string;
      name: string;
      headInstructorId?: string;
      headInstructorName: string;
      daysOfWeek: number[];
      startTime: string;
      endTime: string;
      maxCapacity: number;
      minAge: number;
      maxAge?: number;
      tatamiRoom: string;
      active: boolean;
      notes?: string;
    },
    schedules: Array<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      tatamiRoom?: string;
      instructorUserId?: string;
      instructorName?: string;
      active?: boolean;
      notes?: string;
    }>
  ): Promise<ClassGroup> {
    if (!classPayload.name.trim()) {
      throw new Error('O nome da turma é obrigatório.');
    }
    if (!isValidUUID(classPayload.martialArtId)) {
      throw new Error('Selecione uma arte marcial válida.');
    }

    // Preparar horários se não informados explicitamente
    const finalSchedules: Array<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      tatamiRoom?: string;
      instructorUserId?: string;
      instructorName?: string;
      active?: boolean;
      notes?: string;
    }> =
      schedules.length > 0
        ? schedules
        : classPayload.daysOfWeek.map((d) => ({
            dayOfWeek: d,
            startTime: classPayload.startTime,
            endTime: classPayload.endTime,
            tatamiRoom: classPayload.tatamiRoom,
            instructorUserId: classPayload.headInstructorId,
            instructorName: classPayload.headInstructorName,
            active: classPayload.active,
            notes: undefined,
          }));

    // 1. Tentar execução via RPC atômica save_class_with_schedules_atomic
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('save_class_with_schedules_atomic', {
          p_tenant_id: tenantId,
          p_class_data: {
            id: classPayload.id && isValidUUID(classPayload.id) ? classPayload.id : null,
            branch_id: classPayload.branchId,
            martial_art_id: classPayload.martialArtId,
            name: classPayload.name.trim(),
            head_instructor_user_id: classPayload.headInstructorId && isValidUUID(classPayload.headInstructorId) ? classPayload.headInstructorId : null,
            head_instructor_name: classPayload.headInstructorName,
            days_of_week: classPayload.daysOfWeek,
            start_time: classPayload.startTime,
            end_time: classPayload.endTime,
            max_capacity: classPayload.maxCapacity,
            min_age: classPayload.minAge,
            max_age: classPayload.maxAge || null,
            tatami_room: classPayload.tatamiRoom,
            active: classPayload.active,
            notes: classPayload.notes || null,
          },
          p_schedules: finalSchedules.map((s) => ({
            day_of_week: s.dayOfWeek,
            start_time: s.startTime,
            end_time: s.endTime,
            tatami_room: s.tatamiRoom || classPayload.tatamiRoom,
            instructor_user_id: s.instructorUserId && isValidUUID(s.instructorUserId) ? s.instructorUserId : null,
            instructor_name: s.instructorName || classPayload.headInstructorName,
            active: s.active ?? true,
            notes: s.notes || null,
          })),
        });

        if (!rpcError && rpcData?.success) {
          const c = rpcData.class;
          const schedList = (rpcData.schedules || []).map((s: any) => ({
            id: s.id,
            tenantId: s.tenant_id,
            classGroupId: s.class_group_id,
            dayOfWeek: s.day_of_week,
            startTime: s.start_time?.substring(0, 5) || classPayload.startTime,
            endTime: s.end_time?.substring(0, 5) || classPayload.endTime,
            tatamiRoom: s.tatami_room || classPayload.tatamiRoom,
            instructorUserId: s.instructor_user_id || undefined,
            instructorName: s.instructor_name || classPayload.headInstructorName,
            active: s.active ?? true,
            notes: s.notes || undefined,
            createdAt: s.created_at,
          }));

          const savedClass: ClassGroup = {
            id: c.id,
            tenantId: c.tenant_id,
            branchId: c.branch_id,
            martialArtId: c.martial_art_id,
            name: c.name,
            headInstructorId: c.head_instructor_user_id || undefined,
            headInstructorName: c.head_instructor_name,
            daysOfWeek: c.days_of_week || classPayload.daysOfWeek,
            startTime: c.start_time?.substring(0, 5) || classPayload.startTime,
            endTime: c.end_time?.substring(0, 5) || classPayload.endTime,
            maxCapacity: c.max_capacity,
            minAge: c.min_age,
            maxAge: c.max_age || undefined,
            tatamiRoom: c.tatami_room,
            active: c.active,
            notes: c.notes || undefined,
            schedules: schedList,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
          };

          return savedClass;
        }
      } catch (errRpc) {
        console.warn('Aviso: RPC save_class_with_schedules_atomic falhou, aplicando fallback direto:', errRpc);
      }

      // 2. Fallback direto REST via tabelas class_groups e class_schedules
      const classUpsertData: any = {
        tenant_id: tenantId,
        branch_id: classPayload.branchId,
        martial_art_id: classPayload.martialArtId,
        name: classPayload.name.trim(),
        head_instructor_name: classPayload.headInstructorName,
        days_of_week: classPayload.daysOfWeek,
        start_time: classPayload.startTime,
        end_time: classPayload.endTime,
        max_capacity: classPayload.maxCapacity,
        min_age: classPayload.minAge,
        max_age: classPayload.maxAge || null,
        tatami_room: classPayload.tatamiRoom,
        active: classPayload.active,
        notes: classPayload.notes || null,
        updated_at: new Date().toISOString(),
      };

      if (classPayload.headInstructorId && isValidUUID(classPayload.headInstructorId)) {
        classUpsertData.head_instructor_user_id = classPayload.headInstructorId;
      }

      let classId = classPayload.id;
      if (classId && isValidUUID(classId)) {
        const { error: updateErr } = await supabase
          .from('class_groups')
          .update(classUpsertData)
          .eq('id', classId)
          .eq('tenant_id', tenantId);

        if (updateErr) throw new Error(`Erro ao atualizar turma no Supabase: ${updateErr.message}`);
      } else {
        const { data: newClassData, error: insertErr } = await supabase
          .from('class_groups')
          .insert(classUpsertData)
          .select('id')
          .single();

        if (insertErr || !newClassData) throw new Error(`Erro ao cadastrar turma no Supabase: ${insertErr?.message}`);
        classId = newClassData.id;
      }

      // Sincronizar schedules
      try {
        await supabase
          .from('class_schedules')
          .delete()
          .eq('class_group_id', classId)
          .eq('tenant_id', tenantId);

        const schedulesToInsert = finalSchedules.map((s) => ({
          tenant_id: tenantId,
          class_group_id: classId,
          day_of_week: s.dayOfWeek,
          start_time: s.startTime,
          end_time: s.endTime,
          tatami_room: s.tatamiRoom || classPayload.tatamiRoom,
          instructor_name: s.instructorName || classPayload.headInstructorName,
          active: s.active ?? true,
          notes: s.notes || null,
        }));

        await supabase.from('class_schedules').insert(schedulesToInsert);
      } catch (errSched) {
        console.warn('Aviso ao sincronizar horários detalhados:', errSched);
      }

      const completeSchedules: ClassSchedule[] = finalSchedules.map((s, idx) => ({
        id: `sched-${classId}-${idx}`,
        tenantId,
        classGroupId: classId!,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        tatamiRoom: s.tatamiRoom || classPayload.tatamiRoom,
        instructorUserId: s.instructorUserId,
        instructorName: s.instructorName || classPayload.headInstructorName,
        active: s.active ?? true,
        notes: s.notes,
      }));

      return {
        id: classId!,
        tenantId,
        branchId: classPayload.branchId,
        martialArtId: classPayload.martialArtId,
        name: classPayload.name.trim(),
        headInstructorId: classPayload.headInstructorId,
        headInstructorName: classPayload.headInstructorName,
        daysOfWeek: classPayload.daysOfWeek,
        startTime: classPayload.startTime,
        endTime: classPayload.endTime,
        maxCapacity: classPayload.maxCapacity,
        minAge: classPayload.minAge,
        maxAge: classPayload.maxAge,
        tatamiRoom: classPayload.tatamiRoom,
        active: classPayload.active,
        notes: classPayload.notes,
        schedules: completeSchedules,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // 3. Fallback DataStore (offline / local)
    const localClassId = classPayload.id || `class-${Date.now()}`;
    const completeSchedules: ClassSchedule[] = finalSchedules.map((s, idx) => ({
      id: `sched-${localClassId}-${idx}`,
      tenantId,
      classGroupId: localClassId,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      tatamiRoom: s.tatamiRoom || classPayload.tatamiRoom,
      instructorUserId: s.instructorUserId,
      instructorName: s.instructorName || classPayload.headInstructorName,
      active: s.active ?? true,
      notes: s.notes,
    }));

    const resultClass: ClassGroup = {
      id: localClassId,
      tenantId,
      branchId: classPayload.branchId,
      martialArtId: classPayload.martialArtId,
      name: classPayload.name.trim(),
      headInstructorId: classPayload.headInstructorId,
      headInstructorName: classPayload.headInstructorName,
      daysOfWeek: classPayload.daysOfWeek,
      startTime: classPayload.startTime,
      endTime: classPayload.endTime,
      maxCapacity: classPayload.maxCapacity,
      minAge: classPayload.minAge,
      maxAge: classPayload.maxAge,
      tatamiRoom: classPayload.tatamiRoom,
      active: classPayload.active,
      notes: classPayload.notes,
      schedules: completeSchedules,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const currentClasses = DataStore.getClasses(tenantId);
    const updatedClasses = currentClasses.some((c) => c.id === localClassId)
      ? currentClasses.map((c) => (c.id === localClassId ? resultClass : c))
      : [...currentClasses, resultClass];

    DataStore.saveClasses(updatedClasses);
    return resultClass;
  },

  /**
   * Altera status de ativação da turma (exclusão lógica e reativação).
   */
  async toggleClassStatus(tenantId: string, classId: string, active: boolean): Promise<void> {
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId) && isValidUUID(classId)) {
      const { error } = await supabase
        .from('class_groups')
        .update({ active, updated_at: new Date().toISOString() })
        .eq('id', classId)
        .eq('tenant_id', tenantId);

      if (error) {
        throw new Error(`Erro ao alterar status da turma no Supabase: ${error.message}`);
      }
    }

    const current = DataStore.getClasses(tenantId);
    const updated = current.map((c) => (c.id === classId ? { ...c, active } : c));
    DataStore.saveClasses(updated);
  },

  /**
   * Matricula um aluno em uma turma com verificação de lotação e conflito de horário do aluno.
   */
  async enrollStudent(
    tenantId: string,
    branchId: string,
    studentId: string,
    classGroupId: string,
    options?: {
      enrolledClasses?: ClassGroup[];
      targetClass?: ClassGroup;
    }
  ): Promise<Enrollment> {
    if (!isValidUUID(studentId) || !isValidUUID(classGroupId)) {
      throw new Error('Identificadores de aluno ou turma inválidos.');
    }

    // 1. Verificar conflito de horário do aluno com outras turmas onde ele já está matriculado
    if (options?.enrolledClasses && options?.targetClass) {
      const target = options.targetClass;
      const targetDays = target.daysOfWeek || [];

      for (const enrolledClass of options.enrolledClasses) {
        if (enrolledClass.id === classGroupId) continue;
        const enrolledDays = enrolledClass.daysOfWeek || [];
        const commonDays = targetDays.filter((d) => enrolledDays.includes(d));

        for (const day of commonDays) {
          if (timeIntervalsOverlap(target.startTime, target.endTime, enrolledClass.startTime, enrolledClass.endTime)) {
            throw new Error(
              `Conflito de horário do aluno: O aluno já possui aula na turma "${enrolledClass.name}" na ${DAYS_MAP[day] || `dia ${day}`} das ${enrolledClass.startTime} às ${enrolledClass.endTime}.`
            );
          }
        }
      }
    }

    // 2. Tentar via RPC enroll_student_atomic
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('enroll_student_atomic', {
          p_tenant_id: tenantId,
          p_branch_id: isValidUUID(branchId) ? branchId : null,
          p_student_id: studentId,
          p_class_group_id: classGroupId,
        });

        if (!rpcErr && rpcData?.success) {
          return {
            id: rpcData.enrollment_id,
            tenantId,
            branchId,
            studentId,
            classGroupId,
            enrolledAt: new Date().toISOString().split('T')[0],
            status: 'active',
          };
        }
      } catch (errRpc) {
        console.warn('Aviso: RPC enroll_student_atomic falhou, usando upsert direto:', errRpc);
      }

      // 3. Fallback direto REST
      const { data, error } = await supabase
        .from('enrollments')
        .upsert(
          {
            tenant_id: tenantId,
            branch_id: branchId,
            student_id: studentId,
            class_group_id: classGroupId,
            enrolled_at: new Date().toISOString().split('T')[0],
            status: 'active',
          },
          { onConflict: 'tenant_id,student_id,class_group_id' }
        )
        .select()
        .single();

      if (error || !data) {
        throw new Error(`Erro ao matricular aluno na turma no Supabase: ${error?.message}`);
      }

      return {
        id: data.id,
        tenantId: data.tenant_id,
        branchId: data.branch_id,
        studentId: data.student_id,
        classGroupId: data.class_group_id,
        enrolledAt: data.enrolled_at,
        status: data.status,
      };
    }

    // 4. Fallback DataStore
    const newEnrollment: Enrollment = {
      id: `enr-${Date.now()}`,
      tenantId,
      branchId,
      studentId,
      classGroupId,
      enrolledAt: new Date().toISOString().split('T')[0],
      status: 'active',
    };

    const currentEnrollments = DataStore.getEnrollments(tenantId);
    const filtered = currentEnrollments.filter(
      (e) => !(e.studentId === studentId && e.classGroupId === classGroupId)
    );
    const updated = [...filtered, newEnrollment];
    DataStore.saveEnrollments(updated);
    return newEnrollment;
  },

  /**
   * Remove a matrícula de um aluno de uma turma específica.
   */
  async unenrollStudent(tenantId: string, enrollmentId: string): Promise<void> {
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId) && isValidUUID(enrollmentId)) {
      const { error } = await supabase
        .from('enrollments')
        .delete()
        .eq('id', enrollmentId)
        .eq('tenant_id', tenantId);

      if (error) {
        throw new Error(`Erro ao remover matrícula no Supabase: ${error.message}`);
      }
    }

    const currentEnrollments = DataStore.getEnrollments(tenantId);
    const updated = currentEnrollments.filter((e) => e.id !== enrollmentId);
    DataStore.saveEnrollments(updated);
  },

  /**
   * Gera relatório de turmas organizadas por horário da semana.
   */
  generateScheduleReport(
    classes: ClassGroup[],
    enrollments: Enrollment[],
    filters?: {
      dayOfWeek?: number | 'all';
      martialArtId?: string;
      tatamiRoom?: string;
      instructorName?: string;
      status?: 'all' | 'active' | 'inactive';
      searchTerm?: string;
    }
  ): ClassScheduleReportRow[] {
    const rows: ClassScheduleReportRow[] = [];

    classes.forEach((cls) => {
      // Filtro de status da turma
      if (filters?.status === 'active' && !cls.active) return;
      if (filters?.status === 'inactive' && cls.active) return;

      // Filtro de modalidade
      if (filters?.martialArtId && filters.martialArtId !== 'all' && cls.martialArtId !== filters.martialArtId) {
        return;
      }

      // Contagem de matrículas ativas
      const enrolledCount = enrollments.filter(
        (e) => e.classGroupId === cls.id && e.status === 'active'
      ).length;
      const vacancies = Math.max(0, cls.maxCapacity - enrolledCount);
      const occupancyPercent = cls.maxCapacity > 0 ? Math.round((enrolledCount / cls.maxCapacity) * 100) : 0;

      // Extrair ocorrências de horários da turma
      const occurrences: Array<{
        day: number;
        start: string;
        end: string;
        room: string;
        instructor: string;
      }> = [];

      if (cls.schedules && cls.schedules.length > 0) {
        cls.schedules.forEach((s) => {
          occurrences.push({
            day: s.dayOfWeek,
            start: s.startTime,
            end: s.endTime,
            room: s.tatamiRoom || cls.tatamiRoom,
            instructor: s.instructorName || cls.headInstructorName,
          });
        });
      } else {
        (cls.daysOfWeek || []).forEach((d) => {
          occurrences.push({
            day: d,
            start: cls.startTime,
            end: cls.endTime,
            room: cls.tatamiRoom,
            instructor: cls.headInstructorName,
          });
        });
      }

      occurrences.forEach((occ) => {
        // Filtro por dia da semana
        if (filters?.dayOfWeek !== undefined && filters.dayOfWeek !== 'all' && occ.day !== filters.dayOfWeek) {
          return;
        }

        // Filtro por espaço / tatami
        if (filters?.tatamiRoom && filters.tatamiRoom !== 'all' && occ.room.toLowerCase() !== filters.tatamiRoom.toLowerCase()) {
          return;
        }

        // Filtro por instrutor
        if (filters?.instructorName && filters.instructorName !== 'all' && occ.instructor.toLowerCase() !== filters.instructorName.toLowerCase()) {
          return;
        }

        // Filtro por termo de busca
        if (filters?.searchTerm?.trim()) {
          const term = filters.searchTerm.toLowerCase().trim();
          const match =
            cls.name.toLowerCase().includes(term) ||
            occ.room.toLowerCase().includes(term) ||
            occ.instructor.toLowerCase().includes(term);
          if (!match) return;
        }

        rows.push({
          dayOfWeek: occ.day,
          dayLabel: DAYS_MAP[occ.day] || `Dia ${occ.day}`,
          startTime: occ.start,
          endTime: occ.end,
          className: cls.name,
          classId: cls.id,
          martialArtName: cls.martialArtId, // Será mapeado para o nome real
          instructorName: occ.instructor,
          tatamiRoom: occ.room,
          enrolledCount,
          maxCapacity: cls.maxCapacity,
          vacancies,
          occupancyPercent,
          status: cls.active ? 'active' : 'inactive',
        });
      });
    });

    // Ordenar por dia da semana (Seg=1, Ter=2 ... Dom=0/7) e depois por horário de início
    rows.sort((a, b) => {
      const orderA = a.dayOfWeek === 0 ? 7 : a.dayOfWeek;
      const orderB = b.dayOfWeek === 0 ? 7 : b.dayOfWeek;
      if (orderA !== orderB) return orderA - orderB;
      return a.startTime.localeCompare(b.startTime);
    });

    return rows;
  },

  /**
   * Gera relatório detalhado de distribuição de alunos por graduação e turma.
   */
  generateGraduationReport(
    classes: ClassGroup[],
    enrollments: Enrollment[],
    students: Student[],
    persons: Person[],
    martialArts: MartialArt[],
    beltRanks: BeltRank[],
    filters?: {
      martialArtId?: string;
      classId?: string;
      beltRankId?: string;
      searchTerm?: string;
    }
  ): GraduationReportOverall {
    const studentMap = new Map<string, Student>();
    students.forEach((s) => studentMap.set(s.id, s));

    const personMap = new Map<string, Person>();
    persons.forEach((p) => personMap.set(p.id, p));

    const martialArtMap = new Map<string, MartialArt>();
    martialArts.forEach((m) => martialArtMap.set(m.id, m));

    // Filtrar turmas
    const filteredClasses = classes.filter((cls) => {
      if (filters?.martialArtId && filters.martialArtId !== 'all' && cls.martialArtId !== filters.martialArtId) {
        return false;
      }
      if (filters?.classId && filters.classId !== 'all' && cls.id !== filters.classId) {
        return false;
      }
      if (filters?.searchTerm?.trim()) {
        const term = filters.searchTerm.toLowerCase().trim();
        return (
          cls.name.toLowerCase().includes(term) ||
          cls.tatamiRoom.toLowerCase().includes(term) ||
          cls.headInstructorName.toLowerCase().includes(term)
        );
      }
      return true;
    });

    const uniqueStudentsSet = new Set<string>();
    let totalEnrollmentsCount = 0;
    const overallRanksCount = new Map<string, { belt: BeltRank; count: number }>();

    // Inicializar mapa de faixas globais
    beltRanks.forEach((b) => {
      if (!filters?.martialArtId || filters.martialArtId === 'all' || b.martialArtId === filters.martialArtId) {
        overallRanksCount.set(b.id, { belt: b, count: 0 });
      }
    });

    const classSummaries: GraduationReportClassSummary[] = filteredClasses.map((cls) => {
      const art = martialArtMap.get(cls.martialArtId);
      const artName = art?.name || 'Arte Marcial';

      // Faixas desta modalidade
      const artRanks = beltRanks
        .filter((b) => b.martialArtId === cls.martialArtId)
        .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));

      const classEnrollments = enrollments.filter(
        (e) => e.classGroupId === cls.id && e.status === 'active'
      );

      totalEnrollmentsCount += classEnrollments.length;

      const rankDistributionMap = new Map<
        string,
        {
          belt: BeltRank;
          students: { id: string; name: string; registrationNumber: string }[];
        }
      >();

      artRanks.forEach((b) => {
        rankDistributionMap.set(b.id, { belt: b, students: [] });
      });

      const unassignedStudents: { id: string; name: string; registrationNumber: string }[] = [];

      classEnrollments.forEach((enr) => {
        uniqueStudentsSet.add(enr.studentId);
        const student = studentMap.get(enr.studentId);
        if (!student) return;

        const person = personMap.get(student.personId);
        const studentItem = {
          id: student.id,
          name: person?.fullName || 'Aluno',
          registrationNumber: student.registrationNumber || '-',
        };

        // Encontrar a graduação vigente do aluno para a modalidade da turma
        const grad = student.currentGraduations?.find((g) => g.martialArtId === cls.martialArtId);

        if (grad && grad.beltId && rankDistributionMap.has(grad.beltId)) {
          rankDistributionMap.get(grad.beltId)!.students.push(studentItem);

          // Contabilizar no overall
          if (overallRanksCount.has(grad.beltId)) {
            overallRanksCount.get(grad.beltId)!.count += 1;
          }
        } else {
          unassignedStudents.push(studentItem);
        }
      });

      // Mapear distribuição de faixas
      const ranksDistribution = artRanks
        .map((b) => {
          const entry = rankDistributionMap.get(b.id);
          const studentList = entry?.students || [];
          return {
            beltId: b.id,
            beltName: b.name,
            colorHex: b.colorHex || '#ffffff',
            orderIndex: b.orderIndex || 0,
            count: studentList.length,
            students: studentList,
          };
        })
        .filter((r) => {
          if (filters?.beltRankId && filters.beltRankId !== 'all') {
            return r.beltId === filters.beltRankId;
          }
          return true;
        });

      return {
        classId: cls.id,
        className: cls.name,
        martialArtName: artName,
        tatamiRoom: cls.tatamiRoom,
        instructorName: cls.headInstructorName,
        totalEnrolled: classEnrollments.length,
        ranksDistribution,
        unassignedRankStudents: unassignedStudents,
      };
    });

    const overallRanksTotal = Array.from(overallRanksCount.values())
      .map((entry) => ({
        beltId: entry.belt.id,
        beltName: entry.belt.name,
        colorHex: entry.belt.colorHex || '#ffffff',
        orderIndex: entry.belt.orderIndex || 0,
        totalStudents: entry.count,
      }))
      .filter((r) => {
        if (filters?.beltRankId && filters.beltRankId !== 'all') {
          return r.beltId === filters.beltRankId;
        }
        return true;
      })
      .sort((a, b) => a.orderIndex - b.orderIndex);

    return {
      classes: classSummaries,
      overallRanksTotal,
      totalEnrollments: totalEnrollmentsCount,
      uniqueStudentsCount: uniqueStudentsSet.size,
    };
  },

  /**
   * Exporta os dados do relatório para formato CSV em UTF-8 com BOM e delimitador ponto-e-vírgula.
   */
  exportToCSV(filename: string, headers: string[], rows: (string | number)[][], metadata?: { title: string; academy: string; date: string }): void {
    const csvLines: string[] = [];

    // Cabeçalho institucional
    if (metadata) {
      csvLines.push(`"${metadata.title}"`);
      csvLines.push(`"Academia: ${metadata.academy}";"Gerado em: ${metadata.date}"`);
      csvLines.push('');
    }

    // Colunas
    csvLines.push(headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(';'));

    // Linhas de dados
    rows.forEach((row) => {
      const line = row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';');
      csvLines.push(line);
    });

    const csvContent = '\uFEFF' + csvLines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },
};
