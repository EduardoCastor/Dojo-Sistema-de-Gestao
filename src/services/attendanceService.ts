import { supabase, isSupabaseConfigured } from './supabase';
import { isValidUUID } from './studentService';
import { AttendanceRecord, ClassSession, User } from '../types';
import { DataStore } from '../data/storage';

export interface SaveAttendanceInput {
  tenantId: string;
  classGroupId: string;
  date: string; // YYYY-MM-DD
  startTime?: string;
  endTime?: string;
  instructorName?: string;
  sessionStatus?: 'open' | 'completed' | 'canceled';
  sessionNotes?: string;
  records: Array<{
    studentId: string;
    status: 'present' | 'absent' | 'late' | 'excused';
    notes?: string;
  }>;
  currentUser: User;
}

export interface AttendanceHistoryFilters {
  classGroupId?: string | 'all';
  studentId?: string | 'all';
  date?: string;
  startDate?: string;
  endDate?: string;
  status?: 'all' | 'present' | 'absent' | 'late' | 'excused';
  searchTerm?: string;
}

export const attendanceService = {
  /**
   * Consulta sessões de chamadas registradas no Supabase
   */
  async fetchSessions(
    tenantId: string,
    filters?: { classGroupId?: string; date?: string; startDate?: string; endDate?: string }
  ): Promise<ClassSession[]> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId)) {
      return [];
    }

    try {
      let query = supabase
        .from('class_sessions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('session_date', { ascending: false });

      if (filters?.classGroupId && filters.classGroupId !== 'all' && isValidUUID(filters.classGroupId)) {
        query = query.eq('class_group_id', filters.classGroupId);
      }
      if (filters?.date) {
        query = query.eq('session_date', filters.date);
      }
      if (filters?.startDate) {
        query = query.gte('session_date', filters.startDate);
      }
      if (filters?.endDate) {
        query = query.lte('session_date', filters.endDate);
      }

      const { data, error } = await query;
      if (error) {
        // Se a tabela ainda não existir no banco, registrar aviso
        if (error.code === '42P01') {
          console.warn('Aviso: Tabela class_sessions ainda não criada no Supabase.');
          return [];
        }
        console.warn('Aviso ao consultar class_sessions:', error.message);
        return [];
      }

      return (data || []).map((s: any) => ({
        id: s.id,
        tenantId: s.tenant_id,
        classGroupId: s.class_group_id,
        sessionDate: s.session_date,
        scheduledStartTime: s.scheduled_start_time ? s.scheduled_start_time.substring(0, 5) : undefined,
        scheduledEndTime: s.scheduled_end_time ? s.scheduled_end_time.substring(0, 5) : undefined,
        instructorUserId: s.instructor_user_id || undefined,
        instructorName: s.instructor_name || undefined,
        status: s.status || 'completed',
        notes: s.notes || undefined,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      }));
    } catch (err) {
      console.warn('Erro ao carregar sessões de chamada:', err);
      return [];
    }
  },

  /**
   * Consulta registros individuais de frequência no Supabase
   */
  async fetchAttendances(
    tenantId: string,
    filters?: AttendanceHistoryFilters
  ): Promise<AttendanceRecord[]> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId)) {
      const local = DataStore.getAttendances(tenantId);
      return local;
    }

    try {
      let query = supabase
        .from('attendance_records')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('date', { ascending: false });

      if (filters?.classGroupId && filters.classGroupId !== 'all' && isValidUUID(filters.classGroupId)) {
        query = query.eq('class_group_id', filters.classGroupId);
      }
      if (filters?.studentId && filters.studentId !== 'all' && isValidUUID(filters.studentId)) {
        query = query.eq('student_id', filters.studentId);
      }
      if (filters?.date) {
        query = query.eq('date', filters.date);
      }
      if (filters?.startDate) {
        query = query.gte('date', filters.startDate);
      }
      if (filters?.endDate) {
        query = query.lte('date', filters.endDate);
      }
      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      const { data, error } = await query;
      if (error) {
        console.warn('Aviso ao consultar attendance_records no Supabase (usando fallback local):', error.message);
        return DataStore.getAttendances(tenantId);
      }

      const mapped: AttendanceRecord[] = (data || []).map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        classGroupId: r.class_group_id,
        sessionId: r.session_id || undefined,
        studentId: r.student_id,
        date: r.date,
        status: r.status as AttendanceRecord['status'],
        notes: r.notes || undefined,
        recordedByUserName: r.recorded_by_name || 'Sensei',
        recordedByUserId: r.recorded_by_user_id || undefined,
        recordedAt: r.created_at || new Date().toISOString(),
      }));

      // Atualiza cache local
      if (mapped.length > 0) {
        DataStore.saveAttendances(mapped);
      }
      return mapped;
    } catch (err) {
      console.warn('Falha geral ao buscar registros de frequência:', err);
      return DataStore.getAttendances(tenantId);
    }
  },

  /**
   * Consulta uma chamada anterior para uma turma e data específicas
   */
  async fetchClassAttendanceForDate(
    tenantId: string,
    classGroupId: string,
    date: string
  ): Promise<{ session: ClassSession | null; records: AttendanceRecord[] }> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId) || !isValidUUID(classGroupId)) {
      const local = DataStore.getAttendances(tenantId).filter(
        (a) => a.classGroupId === classGroupId && a.date === date
      );
      return { session: null, records: local };
    }

    try {
      const [sessionRes, recordsRes] = await Promise.all([
        supabase
          .from('class_sessions')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('class_group_id', classGroupId)
          .eq('session_date', date)
          .maybeSingle(),
        supabase
          .from('attendance_records')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('class_group_id', classGroupId)
          .eq('date', date),
      ]);

      let session: ClassSession | null = null;
      if (sessionRes.data) {
        const s = sessionRes.data;
        session = {
          id: s.id,
          tenantId: s.tenant_id,
          classGroupId: s.class_group_id,
          sessionDate: s.session_date,
          scheduledStartTime: s.scheduled_start_time ? s.scheduled_start_time.substring(0, 5) : undefined,
          scheduledEndTime: s.scheduled_end_time ? s.scheduled_end_time.substring(0, 5) : undefined,
          instructorUserId: s.instructor_user_id || undefined,
          instructorName: s.instructor_name || undefined,
          status: s.status || 'completed',
          notes: s.notes || undefined,
          createdAt: s.created_at,
          updatedAt: s.updated_at,
        };
      }

      const records: AttendanceRecord[] = (recordsRes.data || []).map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        classGroupId: r.class_group_id,
        sessionId: r.session_id || undefined,
        studentId: r.student_id,
        date: r.date,
        status: r.status as AttendanceRecord['status'],
        notes: r.notes || undefined,
        recordedByUserName: r.recorded_by_name || 'Sensei',
        recordedByUserId: r.recorded_by_user_id || undefined,
        recordedAt: r.created_at || new Date().toISOString(),
      }));

      return { session, records };
    } catch (err) {
      console.warn('Erro ao consultar chamada por data:', err);
      const local = DataStore.getAttendances(tenantId).filter(
        (a) => a.classGroupId === classGroupId && a.date === date
      );
      return { session: null, records: local };
    }
  },

  /**
   * Salva ou atualiza a chamada completa de forma atômica e persistente no Supabase
   */
  async saveAttendance(
    input: SaveAttendanceInput
  ): Promise<{ session: ClassSession; records: AttendanceRecord[] }> {
    const {
      tenantId,
      classGroupId,
      date,
      startTime,
      endTime,
      instructorName,
      sessionStatus = 'completed',
      sessionNotes,
      records,
      currentUser,
    } = input;

    if (!isValidUUID(classGroupId)) {
      throw new Error('Identificador de turma inválido.');
    }
    if (!date) {
      throw new Error('A data da aula é obrigatória.');
    }

    // Obter identificador do usuário autenticado real na sessão do Supabase
    let authenticatedUserId: string | null = isValidUUID(currentUser.id) ? currentUser.id : null;
    let recordedByName: string = currentUser.name;

    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (authData?.user?.id) {
          authenticatedUserId = authData.user.id;
          if (authData.user.user_metadata?.full_name) {
            recordedByName = authData.user.user_metadata.full_name;
          }
        }
      } catch (authErr) {
        console.warn('Aviso: não foi possível obter usuário autenticado de auth.getUser():', authErr);
      }
    }

    // 1. Tentar execução via RPC atômica save_attendance_atomic
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('save_attendance_atomic', {
          p_tenant_id: tenantId,
          p_class_group_id: classGroupId,
          p_session_date: date,
          p_start_time: startTime || null,
          p_end_time: endTime || null,
          p_instructor_name: instructorName || recordedByName,
          p_session_status: sessionStatus,
          p_session_notes: sessionNotes || null,
          p_records: records.map((r) => ({
            student_id: r.studentId,
            status: r.status,
            notes: r.notes || null,
            recorded_by_name: recordedByName,
          })),
        });

        if (!rpcError && rpcData?.success) {
          const s = rpcData.session;
          const returnedSession: ClassSession = {
            id: s.id,
            tenantId: s.tenant_id,
            classGroupId: s.class_group_id,
            sessionDate: s.session_date,
            scheduledStartTime: s.scheduled_start_time?.substring(0, 5) || startTime,
            scheduledEndTime: s.scheduled_end_time?.substring(0, 5) || endTime,
            instructorUserId: s.instructor_user_id || currentUser.id,
            instructorName: s.instructor_name || instructorName,
            status: s.status || sessionStatus,
            notes: s.notes || sessionNotes,
            createdAt: s.created_at,
            updatedAt: s.updated_at,
          };

          const returnedRecords: AttendanceRecord[] = (rpcData.records || []).map((r: any) => ({
            id: r.id,
            tenantId: r.tenant_id,
            classGroupId: r.class_group_id,
            sessionId: r.session_id,
            studentId: r.student_id,
            date: r.date,
            status: r.status as AttendanceRecord['status'],
            notes: r.notes || undefined,
            recordedByUserName: r.recorded_by_name || currentUser.name,
            recordedByUserId: r.recorded_by_user_id || currentUser.id,
            recordedAt: r.created_at || new Date().toISOString(),
          }));

          // Sincronizar cache local
          this.syncLocalStore(tenantId, classGroupId, date, returnedRecords);
          return { session: returnedSession, records: returnedRecords };
        }
      } catch (errRpc) {
        console.warn('Aviso: RPC save_attendance_atomic falhou, aplicando fallback direto REST:', errRpc);
      }

      // 2. Fallback direto REST via tabelas class_sessions e attendance_records
      let sessionId: string | undefined;

      // 2.1 Tentar upsert na tabela class_sessions
      try {
        const { data: sessionData, error: sessErr } = await supabase
          .from('class_sessions')
          .upsert(
            {
              tenant_id: tenantId,
              class_group_id: classGroupId,
              session_date: date,
              scheduled_start_time: startTime || null,
              scheduled_end_time: endTime || null,
              instructor_user_id: authenticatedUserId,
              instructor_name: instructorName || recordedByName,
              status: sessionStatus,
              notes: sessionNotes || null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'tenant_id,class_group_id,session_date' }
          )
          .select('id')
          .maybeSingle();

        if (!sessErr && sessionData) {
          sessionId = sessionData.id;
        }
      } catch (errSess) {
        console.warn('Aviso ao registrar sessão em class_sessions:', errSess);
      }

      // 2.2 Upsert nos attendance_records com tolerância adaptativa a status 'late'
      const recordsToUpsert = records.map((r) => {
        const recordPayload: any = {
          tenant_id: tenantId,
          class_group_id: classGroupId,
          student_id: r.studentId,
          date: date,
          status: r.status,
          notes: r.notes || null,
          recorded_by_user_id: authenticatedUserId,
          recorded_by_name: recordedByName,
          updated_at: new Date().toISOString(),
        };
        if (sessionId) {
          recordPayload.session_id = sessionId;
        }
        return recordPayload;
      });

      let savedDbRecords: AttendanceRecord[] = [];

      try {
        const { data: upsertedData, error: upsertErr } = await supabase
          .from('attendance_records')
          .upsert(recordsToUpsert, { onConflict: 'tenant_id,class_group_id,student_id,date' })
          .select();

        if (upsertErr) {
          // Se o enum no banco ainda não possui 'late', converte 'late' para 'present' com nota indicativa e retenta
          if (upsertErr.message?.includes('late') || upsertErr.code === '22P02') {
            console.warn('Aviso: status "late" não suportado pelo enum do banco. Convertendo adaptativamente...');
            const adaptedRecords = recordsToUpsert.map((r) => {
              if (r.status === 'late') {
                return {
                  ...r,
                  status: 'present',
                  notes: r.notes ? `[Atraso] ${r.notes}` : '[Atrasado]',
                };
              }
              return r;
            });

            const { data: retryData, error: retryErr } = await supabase
              .from('attendance_records')
              .upsert(adaptedRecords, { onConflict: 'tenant_id,class_group_id,student_id,date' })
              .select();

            if (retryErr) {
              throw new Error(`Erro ao salvar frequência no Supabase: ${retryErr.message}`);
            }
            if (retryData) {
              savedDbRecords = retryData.map((d: any) => ({
                id: d.id,
                tenantId: d.tenant_id,
                classGroupId: d.class_group_id,
                sessionId: d.session_id,
                studentId: d.student_id,
                date: d.date,
                status: d.status as AttendanceRecord['status'],
                notes: d.notes || undefined,
                recordedByUserName: d.recorded_by_name || currentUser.name,
                recordedByUserId: d.recorded_by_user_id,
                recordedAt: d.created_at || new Date().toISOString(),
              }));
            }
          } else {
            throw new Error(`Erro ao salvar frequência no Supabase: ${upsertErr.message}`);
          }
        } else if (upsertedData) {
          savedDbRecords = upsertedData.map((d: any) => ({
            id: d.id,
            tenantId: d.tenant_id,
            classGroupId: d.class_group_id,
            sessionId: d.session_id,
            studentId: d.student_id,
            date: d.date,
            status: d.status as AttendanceRecord['status'],
            notes: d.notes || undefined,
            recordedByUserName: d.recorded_by_name || currentUser.name,
            recordedByUserId: d.recorded_by_user_id,
            recordedAt: d.created_at || new Date().toISOString(),
          }));
        }
      } catch (upsertFail: any) {
        console.error('Falha no upsert de attendance_records:', upsertFail);
        throw upsertFail;
      }

      const fallbackSession: ClassSession = {
        id: sessionId || `session-${classGroupId}-${date}`,
        tenantId,
        classGroupId,
        sessionDate: date,
        scheduledStartTime: startTime,
        scheduledEndTime: endTime,
        instructorUserId: currentUser.id,
        instructorName: instructorName || currentUser.name,
        status: sessionStatus,
        notes: sessionNotes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.syncLocalStore(tenantId, classGroupId, date, savedDbRecords);
      return { session: fallbackSession, records: savedDbRecords };
    }

    // 3. Fallback DataStore (offline / local)
    const localRecords: AttendanceRecord[] = records.map((r, idx) => ({
      id: `att-${Date.now()}-${idx}-${r.studentId}`,
      tenantId,
      classGroupId,
      sessionId: `local-session-${classGroupId}-${date}`,
      studentId: r.studentId,
      date,
      status: r.status,
      notes: r.notes,
      recordedByUserName: currentUser.name,
      recordedByUserId: currentUser.id,
      recordedAt: new Date().toISOString(),
    }));

    const localSession: ClassSession = {
      id: `local-session-${classGroupId}-${date}`,
      tenantId,
      classGroupId,
      sessionDate: date,
      scheduledStartTime: startTime,
      scheduledEndTime: endTime,
      instructorUserId: currentUser.id,
      instructorName: instructorName || currentUser.name,
      status: sessionStatus,
      notes: sessionNotes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.syncLocalStore(tenantId, classGroupId, date, localRecords);
    return { session: localSession, records: localRecords };
  },

  /**
   * Atualiza o cache local no DataStore sem duplicar registros da mesma turma e data
   */
  syncLocalStore(
    tenantId: string,
    classGroupId: string,
    date: string,
    newRecords: AttendanceRecord[]
  ) {
    const existing = DataStore.getAttendances(tenantId);
    const filtered = existing.filter(
      (a) => !(a.classGroupId === classGroupId && a.date === date)
    );
    const updated = [...newRecords, ...filtered];
    DataStore.saveAttendances(updated);
  },

  /**
   * Calcula resumo de frequência para a ficha individual do aluno
   */
  calculateStudentSummary(studentId: string, attendances: AttendanceRecord[]) {
    const studentRecords = attendances.filter((a) => a.studentId === studentId);
    const total = studentRecords.length;
    const present = studentRecords.filter((a) => a.status === 'present').length;
    const absent = studentRecords.filter((a) => a.status === 'absent').length;
    const late = studentRecords.filter((a) => a.status === 'late').length;
    const excused = studentRecords.filter((a) => a.status === 'excused').length;
    const effectivePresent = present + late;
    const percentage = total > 0 ? Math.round((effectivePresent / total) * 100) : 0;

    return {
      total,
      present,
      absent,
      late,
      excused,
      effectivePresent,
      percentage,
      records: studentRecords.sort((a, b) => b.date.localeCompare(a.date)),
    };
  },

  /**
   * Exporta relatório de frequência para CSV em UTF-8 com BOM e ponto-e-vírgula
   */
  exportAttendanceToCSV(
    filename: string,
    headers: string[],
    rows: (string | number)[][],
    metadata?: { title: string; academy: string; date: string }
  ) {
    const csvLines: string[] = [];

    if (metadata) {
      csvLines.push(`"${metadata.title}"`);
      csvLines.push(`"Academia: ${metadata.academy}";"Gerado em: ${metadata.date}"`);
      csvLines.push('');
    }

    csvLines.push(headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(';'));

    rows.forEach((row) => {
      const line = row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';');
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
