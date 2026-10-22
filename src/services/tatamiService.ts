import { supabase, isSupabaseConfigured } from './supabase';
import { isValidUUID } from './studentService';
import { Tatami, CreateTatamiPayload, UpdateTatamiPayload, ClassGroup } from '../types';
import { DataStore } from '../data/storage';
import { timeIntervalsOverlap } from './classService';

export interface TatamiAvailabilityResult {
  availableTatamis: Tatami[];
  occupiedTatamis: Array<{
    tatami: Tatami;
    conflictingClass: ClassGroup;
    timeSlot: string;
    instructorName: string;
  }>;
  totalCount: number;
  availableCount: number;
  occupiedCount: number;
}

export const tatamiService = {
  /**
   * Consulta os tatamis cadastrados da academia e filial correspondentes.
   */
  async fetchTatamis(tenantId: string, branchId?: string): Promise<Tatami[]> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId)) {
      const local = DataStore.getTatamis(tenantId);
      if (branchId && branchId !== 'all') {
        return local.filter((t) => !t.branchId || t.branchId === branchId);
      }
      return local;
    }

    try {
      let query = supabase
        .from('tatamis')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true });

      if (branchId && branchId !== 'all' && isValidUUID(branchId)) {
        query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
      }

      const { data, error } = await query;

      if (error) {
        // Tabela ainda não criada no Supabase (código 42P01) ou sem acesso: usar fallback local
        if (error.code === '42P01') {
          console.warn('Aviso: Tabela tatamis ainda não criada no Supabase remoto. Usando armazenamento local.');
        } else {
          console.warn('Aviso ao consultar tatamis no Supabase:', error.message);
        }
        const local = DataStore.getTatamis(tenantId);
        return branchId && branchId !== 'all' ? local.filter((t) => !t.branchId || t.branchId === branchId) : local;
      }

      // Se não houver nenhum registro retornado no banco remoto, inicializar com fallback
      if (!data || data.length === 0) {
        const local = DataStore.getTatamis(tenantId);
        return branchId && branchId !== 'all' ? local.filter((t) => !t.branchId || t.branchId === branchId) : local;
      }

      const mapped: Tatami[] = data.map((t: any) => ({
        id: t.id,
        tenantId: t.tenant_id,
        branchId: t.branch_id || undefined,
        name: t.name,
        dimensions: t.dimensions || undefined,
        maxCapacity: t.max_capacity || 20,
        colorHex: t.color_hex || '#dc2626',
        description: t.description || undefined,
        active: t.active ?? true,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }));

      DataStore.saveTatamis(mapped);
      return branchId && branchId !== 'all' ? mapped.filter((t) => !t.branchId || t.branchId === branchId) : mapped;
    } catch (err) {
      console.warn('Erro ao carregar tatamis:', err);
      const local = DataStore.getTatamis(tenantId);
      return branchId && branchId !== 'all' ? local.filter((t) => !t.branchId || t.branchId === branchId) : local;
    }
  },

  /**
   * CREATE: Cadastrar um novo tatami no Supabase com validação de unicidade.
   */
  async createTatami(payload: CreateTatamiPayload): Promise<Tatami> {
    const {
      tenantId,
      branchId,
      name,
      dimensions,
      maxCapacity,
      colorHex = '#dc2626',
      description,
      active = true,
    } = payload;

    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('O nome do tatami é obrigatório.');
    }
    if (maxCapacity <= 0) {
      throw new Error('A capacidade máxima do tatami deve ser maior que zero.');
    }

    // 1. Verificar duplicidade no cache local / pré-existente
    const existingList = DataStore.getTatamis(tenantId);
    const hasDuplicate = existingList.some(
      (t) =>
        t.name.trim().toLowerCase() === trimmedName.toLowerCase() &&
        (t.branchId === branchId || !t.branchId || !branchId)
    );
    if (hasDuplicate) {
      throw new Error(`Já existe um tatami cadastrado com o nome "${trimmedName}". Escolha um nome diferente.`);
    }

    // 2. Persistir no Supabase se configurado
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('tatamis')
          .insert({
            tenant_id: tenantId,
            branch_id: branchId && isValidUUID(branchId) ? branchId : null,
            name: trimmedName,
            dimensions: dimensions?.trim() || null,
            max_capacity: maxCapacity,
            color_hex: colorHex,
            description: description?.trim() || null,
            active: active,
          })
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            throw new Error(`Já existe um tatami com o nome "${trimmedName}" nesta filial.`);
          }
          console.warn('Aviso ao persistir tatami no Supabase (salvando localmente):', error.message);
        } else if (data) {
          const newTatami: Tatami = {
            id: data.id,
            tenantId: data.tenant_id,
            branchId: data.branch_id || undefined,
            name: data.name,
            dimensions: data.dimensions || undefined,
            maxCapacity: data.max_capacity,
            colorHex: data.color_hex || '#dc2626',
            description: data.description || undefined,
            active: data.active,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          };

          const updated = [newTatami, ...existingList.filter((t) => t.id !== newTatami.id)];
          DataStore.saveTatamis(updated);
          return newTatami;
        }
      } catch (err: any) {
        if (err.message?.includes('Já existe')) {
          throw err;
        }
        console.warn('Fallback para gravação local de tatami:', err.message);
      }
    }

    // 3. Fallback de persistência local (DataStore)
    const newTatami: Tatami = {
      id: `tatami-${Date.now()}`,
      tenantId,
      branchId,
      name: trimmedName,
      dimensions: dimensions?.trim() || undefined,
      maxCapacity,
      colorHex,
      description: description?.trim() || undefined,
      active,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updated = [newTatami, ...existingList];
    DataStore.saveTatamis(updated);
    return newTatami;
  },

  /**
   * UPDATE: Atualizar dados de um tatami existente.
   */
  async updateTatami(
    tatamiId: string,
    tenantId: string,
    payload: UpdateTatamiPayload
  ): Promise<Tatami> {
    const existingList = DataStore.getTatamis(tenantId);
    const current = existingList.find((t) => t.id === tatamiId);
    if (!current) {
      throw new Error('Tatami não encontrado.');
    }

    const trimmedName = payload.name !== undefined ? payload.name.trim() : current.name;
    if (!trimmedName) {
      throw new Error('O nome do tatami não pode ficar vazio.');
    }

    // Checar duplicidade caso o nome tenha mudado
    if (trimmedName.toLowerCase() !== current.name.toLowerCase()) {
      const hasDuplicate = existingList.some(
        (t) =>
          t.id !== tatamiId &&
          t.name.trim().toLowerCase() === trimmedName.toLowerCase() &&
          t.branchId === (payload.branchId !== undefined ? payload.branchId : current.branchId)
      );
      if (hasDuplicate) {
        throw new Error(`Já existe outro tatami com o nome "${trimmedName}".`);
      }
    }

    const updatedObj: Tatami = {
      ...current,
      name: trimmedName,
      branchId: payload.branchId !== undefined ? payload.branchId : current.branchId,
      dimensions: payload.dimensions !== undefined ? payload.dimensions.trim() || undefined : current.dimensions,
      maxCapacity: payload.maxCapacity !== undefined ? payload.maxCapacity : current.maxCapacity,
      colorHex: payload.colorHex !== undefined ? payload.colorHex : current.colorHex,
      description: payload.description !== undefined ? payload.description.trim() || undefined : current.description,
      active: payload.active !== undefined ? payload.active : current.active,
      updatedAt: new Date().toISOString(),
    };

    // Atualizar no Supabase se configurado
    if (isSupabaseConfigured() && supabase && isValidUUID(tatamiId) && isValidUUID(tenantId)) {
      try {
        const { error } = await supabase
          .from('tatamis')
          .update({
            name: updatedObj.name,
            branch_id: updatedObj.branchId && isValidUUID(updatedObj.branchId) ? updatedObj.branchId : null,
            dimensions: updatedObj.dimensions || null,
            max_capacity: updatedObj.maxCapacity,
            color_hex: updatedObj.colorHex,
            description: updatedObj.description || null,
            active: updatedObj.active,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tatamiId)
          .eq('tenant_id', tenantId);

        if (error) {
          console.warn('Aviso ao atualizar tatami no Supabase:', error.message);
        }
      } catch (err: any) {
        console.warn('Aviso de rede ao atualizar tatami no Supabase:', err);
      }
    }

    // Atualizar no cache local
    const nextList = existingList.map((t) => (t.id === tatamiId ? updatedObj : t));
    DataStore.saveTatamis(nextList);
    return updatedObj;
  },

  /**
   * DELETE: Solicita confirmação e preserva o histórico de ocupações.
   * Se houver turmas ou horários vinculados ao tatami, realiza desativação lógica (active = false).
   */
  async deleteTatami(
    tatamiId: string,
    tenantId: string,
    existingClasses: ClassGroup[] = []
  ): Promise<{ success: boolean; softDeleted: boolean; message: string }> {
    const existingList = DataStore.getTatamis(tenantId);
    const target = existingList.find((t) => t.id === tatamiId);
    if (!target) {
      throw new Error('Tatami não encontrado para exclusão.');
    }

    // Verificar se há turmas ou horários vinculados a este tatami
    const linkedClasses = existingClasses.filter((c) => {
      const matchMain = c.tatamiRoom?.trim().toLowerCase() === target.name.trim().toLowerCase();
      const matchSched = c.schedules?.some(
        (s) => s.tatamiRoom?.trim().toLowerCase() === target.name.trim().toLowerCase()
      );
      return matchMain || matchSched;
    });

    const isLinked = linkedClasses.length > 0;

    if (isLinked) {
      // Desativação Lógica: preserva 100% das turmas e histórico de chamadas
      await this.updateTatami(tatamiId, tenantId, { active: false });
      return {
        success: true,
        softDeleted: true,
        message: `O tatami "${target.name}" possui ${linkedClasses.length} turma(s) vinculada(s). Para preservar o histórico de horários e chamadas, ele foi desativado logicamente.`,
      };
    }

    // Exclusão física caso não haja nenhum vínculo
    if (isSupabaseConfigured() && supabase && isValidUUID(tatamiId) && isValidUUID(tenantId)) {
      try {
        const { error } = await supabase
          .from('tatamis')
          .delete()
          .eq('id', tatamiId)
          .eq('tenant_id', tenantId);

        if (error) {
          console.warn('Aviso ao excluir tatami do Supabase:', error.message);
        }
      } catch (err) {
        console.warn('Falha na exclusão do tatami no Supabase:', err);
      }
    }

    const nextList = existingList.filter((t) => t.id !== tatamiId);
    DataStore.saveTatamis(nextList);

    return {
      success: true,
      softDeleted: false,
      message: `Tatami "${target.name}" excluído com sucesso.`,
    };
  },

  /**
   * PARTE B — Checagem rigorosa de disponibilidade por período e horário.
   * Considera sobreposições [start, end) e trata intervalos adjacentes (10h-11h e 11h-12h) como consecutivos.
   */
  checkAvailability(params: {
    tenantId: string;
    branchId?: string;
    dayOfWeek: number;
    startTime: string; // "10:00"
    endTime: string; // "11:00"
    tatamis: Tatami[];
    classes: ClassGroup[];
    ignoreClassId?: string; // Turma sendo editada no momento
  }): TatamiAvailabilityResult {
    const {
      branchId,
      dayOfWeek,
      startTime,
      endTime,
      tatamis,
      classes,
      ignoreClassId,
    } = params;

    // 1. Filtrar tatamis ativos da filial especificada
    const candidateTatamis = tatamis.filter((t) => {
      if (!t.active) return false;
      if (branchId && branchId !== 'all' && t.branchId && t.branchId !== branchId) {
        return false;
      }
      return true;
    });

    const occupiedTatamis: TatamiAvailabilityResult['occupiedTatamis'] = [];
    const availableTatamis: Tatami[] = [];

    // 2. Extrair alocações para o dia da semana nas turmas ativas
    const activeClasses = classes.filter((c) => {
      if (!c.active) return false;
      if (ignoreClassId && c.id === ignoreClassId) return false;
      if (branchId && branchId !== 'all' && c.branchId && c.branchId !== branchId) return false;
      return true;
    });

    candidateTatamis.forEach((tatami) => {
      const tatamiNorm = tatami.name.trim().toLowerCase();
      let hasConflict = false;
      let conflictDetail: TatamiAvailabilityResult['occupiedTatamis'][0] | null = null;

      for (const cls of activeClasses) {
        // Verificar grade estruturada ou horários padrão
        const occurrences: Array<{ start: string; end: string; room: string; instructor: string }> = [];

        if (cls.schedules && cls.schedules.length > 0) {
          cls.schedules
            .filter((s) => s.dayOfWeek === dayOfWeek && s.active)
            .forEach((s) => {
              occurrences.push({
                start: s.startTime,
                end: s.endTime,
                room: s.tatamiRoom || cls.tatamiRoom || 'Tatami Principal',
                instructor: s.instructorName || cls.headInstructorName || 'Sensei',
              });
            });
        } else if (cls.daysOfWeek?.includes(dayOfWeek)) {
          occurrences.push({
            start: cls.startTime,
            end: cls.endTime,
            room: cls.tatamiRoom || 'Tatami Principal',
            instructor: cls.headInstructorName || 'Sensei',
          });
        }

        // Testar sobreposição com este tatami
        for (const occ of occurrences) {
          if (occ.room.trim().toLowerCase() === tatamiNorm) {
            // Verificar colisão de intervalo: s1 < e2 && s2 < e1 (intervalos adjacentes não colidem)
            if (timeIntervalsOverlap(occ.start, occ.end, startTime, endTime)) {
              hasConflict = true;
              conflictDetail = {
                tatami,
                conflictingClass: cls,
                timeSlot: `${occ.start} às ${occ.end}`,
                instructorName: occ.instructor,
              };
              break;
            }
          }
        }

        if (hasConflict) break;
      }

      if (hasConflict && conflictDetail) {
        occupiedTatamis.push(conflictDetail);
      } else {
        availableTatamis.push(tatami);
      }
    });

    return {
      availableTatamis,
      occupiedTatamis,
      totalCount: candidateTatamis.length,
      availableCount: availableTatamis.length,
      occupiedCount: occupiedTatamis.length,
    };
  },
};
