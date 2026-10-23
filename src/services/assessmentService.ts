import { supabase, isSupabaseConfigured } from './supabase';
import { PhysicalAssessment, Person, Student } from '../types';
import { DataStore } from '../data/storage';
import { classifyBmi } from '../utils/whoBmiClassification';

export function isValidUUID(id: string): boolean {
  if (!id) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

export interface CreateAssessmentPayload {
  tenantId: string;
  studentId: string;
  date: string; // YYYY-MM-DD
  weightKg: number;
  heightCm: number;
  evaluatorName?: string;
  notes?: string;
  recordedByUserId?: string;
  // Dados do aluno para cálculo automatizado da idade e classificação OMS
  birthDate?: string | null;
  gender?: string | null;
}

export interface UpdateAssessmentPayload {
  tenantId?: string;
  studentId?: string;
  date?: string;
  weightKg?: number;
  heightCm?: number;
  evaluatorName?: string;
  notes?: string;
  birthDate?: string | null;
  gender?: string | null;
}

export const assessmentService = {
  /**
   * Consulta as avaliações antropométricas de uma academia (tenant_id)
   * e opcionalmente filtradas por aluno.
   */
  async fetchAssessments(tenantId: string, studentId?: string): Promise<PhysicalAssessment[]> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId)) {
      const local = DataStore.getPhysicalAssessments(tenantId);
      if (studentId) {
        return local.filter((a) => a.studentId === studentId);
      }
      return local;
    }

    try {
      let query = supabase
        .from('physical_assessments')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('date', { ascending: false });

      if (studentId && isValidUUID(studentId)) {
        query = query.eq('student_id', studentId);
      }

      const { data, error } = await query;

      if (error || !data || data.length === 0) {
        const local = DataStore.getPhysicalAssessments(tenantId);
        return studentId ? local.filter((a) => a.studentId === studentId) : local;
      }

      return data.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        studentId: r.student_id,
        date: r.date,
        weightKg: Number(r.weight_kg),
        heightCm: Number(r.height_cm),
        bmi: Number(r.bmi),
        evaluatorName: r.evaluator_name || 'Avaliador',
        ageYearsAtMeasurement: r.age_years ?? undefined,
        ageMonthsAtMeasurement: r.age_months ?? undefined,
        classification: r.classification || undefined,
        referenceStandard: r.reference_standard || undefined,
        recordedByUserId: r.recorded_by_user_id || undefined,
        notes: r.notes || undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    } catch (err) {
      console.warn('Erro ao consultar antropometria no Supabase, usando cache local:', err);
      const local = DataStore.getPhysicalAssessments(tenantId);
      return studentId ? local.filter((a) => a.studentId === studentId) : local;
    }
  },

  /**
   * Registra uma nova medição antropométrica.
   * Calcula automaticamente o IMC e a classificação com base na data de nascimento e sexo.
   */
  async createAssessment(payload: CreateAssessmentPayload): Promise<PhysicalAssessment> {
    const {
      tenantId,
      studentId,
      date,
      weightKg,
      heightCm,
      evaluatorName,
      notes,
      recordedByUserId,
      birthDate,
      gender,
    } = payload;

    // Validações rigorosas
    if (!weightKg || weightKg <= 0 || weightKg > 400) {
      throw new Error('Informe um peso válido maior que zero (kg).');
    }
    if (!heightCm || heightCm <= 0 || heightCm > 300) {
      throw new Error('Informe uma altura válida maior que zero (cm).');
    }
    if (!date) {
      throw new Error('A data da medição é obrigatória.');
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (date > todayStr) {
      throw new Error('A data da medição não pode ser futura.');
    }
    if (birthDate && date < birthDate) {
      throw new Error('A data da medição não pode ser anterior à data de nascimento do aluno.');
    }

    // Cálculo oficial do IMC e Classificação OMS
    const classificationRes = classifyBmi({
      weightKg,
      heightCm,
      birthDate,
      gender: (gender as any) || 'male',
      measurementDate: date,
    });

    const calculatedBmi = classificationRes.bmi;
    const nowISO = new Date().toISOString();
    const newId = `phys-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newAssessment: PhysicalAssessment = {
      id: newId,
      tenantId,
      studentId,
      date,
      weightKg: Number(weightKg.toFixed(1)),
      heightCm: Number(heightCm.toFixed(1)),
      bmi: calculatedBmi,
      evaluatorName: evaluatorName?.trim() || 'Avaliador',
      ageYearsAtMeasurement: classificationRes.ageYears || undefined,
      ageMonthsAtMeasurement: classificationRes.ageMonths || undefined,
      classification: classificationRes.classification,
      referenceStandard: classificationRes.referenceStandard,
      recordedByUserId,
      notes: notes?.trim() || undefined,
      createdAt: nowISO,
      updatedAt: nowISO,
    };

    // 1. Tentar persistência no Supabase
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId) && isValidUUID(studentId)) {
      try {
        const { data, error } = await supabase
          .from('physical_assessments')
          .insert({
            tenant_id: tenantId,
            student_id: studentId,
            date,
            weight_kg: newAssessment.weightKg,
            height_cm: newAssessment.heightCm,
            bmi: calculatedBmi,
            evaluator_name: newAssessment.evaluatorName,
            age_years: classificationRes.ageYears || null,
            age_months: classificationRes.ageMonths || null,
            classification: classificationRes.classification,
            reference_standard: classificationRes.referenceStandard,
            recorded_by_user_id: recordedByUserId && isValidUUID(recordedByUserId) ? recordedByUserId : null,
            notes: notes?.trim() || null,
            created_at: nowISO,
            updated_at: nowISO,
          })
          .select()
          .single();

        if (error) {
          throw new Error(`Erro ao gravar medição no Supabase: ${error.message}`);
        }

        if (data) {
          newAssessment.id = data.id;
        }
      } catch (err: any) {
        console.error('Falha ao persistir medição no Supabase:', err);
        throw err;
      }
    }

    // 2. Atualizar DataStore local
    const currentList = DataStore.getPhysicalAssessments(tenantId);
    DataStore.savePhysicalAssessments([newAssessment, ...currentList]);

    // 3. Auditoria
    DataStore.logAudit(
      tenantId,
      recordedByUserId || 'user-admin',
      evaluatorName || 'Avaliador',
      'Registro de Antropometria',
      'PhysicalAssessment',
      newAssessment.id,
      `Nova medição: ${newAssessment.weightKg}kg, ${newAssessment.heightCm}cm, IMC ${calculatedBmi} (${classificationRes.classification}).`
    );

    return newAssessment;
  },

  /**
   * Atualiza uma medição antropométrica existente, recalculando os indicadores derivados.
   */
  async updateAssessment(
    id: string,
    payload: UpdateAssessmentPayload,
    currentUserName?: string
  ): Promise<PhysicalAssessment> {
    const allAssessments = DataStore.getAllPhysicalAssessments();
    const existing = allAssessments.find((a) => a.id === id);

    const tenantId = payload.tenantId || existing?.tenantId || '';
    const studentId = payload.studentId || existing?.studentId || '';
    const date = payload.date || existing?.date || new Date().toISOString().split('T')[0];
    const weightKg = payload.weightKg ?? existing?.weightKg ?? 0;
    const heightCm = payload.heightCm ?? existing?.heightCm ?? 0;
    const evaluatorName = payload.evaluatorName || existing?.evaluatorName || currentUserName || 'Avaliador';
    const notes = payload.notes !== undefined ? payload.notes : existing?.notes;
    const birthDate = payload.birthDate !== undefined ? payload.birthDate : undefined;
    const gender = payload.gender !== undefined ? payload.gender : undefined;

    if (!weightKg || weightKg <= 0 || weightKg > 400) {
      throw new Error('Informe um peso válido maior que zero (kg).');
    }
    if (!heightCm || heightCm <= 0 || heightCm > 300) {
      throw new Error('Informe uma altura válida maior que zero (cm).');
    }
    if (!date) {
      throw new Error('A data da medição é obrigatória.');
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (date > todayStr) {
      throw new Error('A data da medição não pode ser futura.');
    }
    if (birthDate && date < birthDate) {
      throw new Error('A data da medição não pode ser anterior à data de nascimento do aluno.');
    }

    // Recalcular indicadores derivados
    const classificationRes = classifyBmi({
      weightKg,
      heightCm,
      birthDate,
      gender: (gender as any) || 'male',
      measurementDate: date,
    });

    const calculatedBmi = classificationRes.bmi;
    const nowISO = new Date().toISOString();

    const updatedAssessment: PhysicalAssessment = {
      id,
      tenantId,
      studentId,
      date,
      weightKg: Number(weightKg.toFixed(1)),
      heightCm: Number(heightCm.toFixed(1)),
      bmi: calculatedBmi,
      evaluatorName: evaluatorName?.trim() || 'Avaliador',
      ageYearsAtMeasurement: classificationRes.ageYears || undefined,
      ageMonthsAtMeasurement: classificationRes.ageMonths || undefined,
      classification: classificationRes.classification,
      referenceStandard: classificationRes.referenceStandard,
      notes: notes?.trim() || undefined,
      createdAt: existing?.createdAt || nowISO,
      updatedAt: nowISO,
    };

    // 1. Tentar persistência no Supabase
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId) && isValidUUID(id)) {
      try {
        const { error } = await supabase
          .from('physical_assessments')
          .update({
            date,
            weight_kg: updatedAssessment.weightKg,
            height_cm: updatedAssessment.heightCm,
            bmi: calculatedBmi,
            evaluator_name: updatedAssessment.evaluatorName,
            age_years: classificationRes.ageYears || null,
            age_months: classificationRes.ageMonths || null,
            classification: classificationRes.classification,
            reference_standard: classificationRes.referenceStandard,
            notes: notes?.trim() || null,
            updated_at: nowISO,
          })
          .eq('id', id)
          .eq('tenant_id', tenantId);

        if (error) {
          throw new Error(`Erro ao atualizar medição no Supabase: ${error.message}`);
        }
      } catch (err: any) {
        console.error('Falha ao atualizar medição no Supabase:', err);
        throw err;
      }
    }

    // 2. Atualizar DataStore local
    const currentList = DataStore.getPhysicalAssessments(tenantId);
    const nextList = currentList.map((a) => (a.id === id ? { ...a, ...updatedAssessment } : a));
    DataStore.savePhysicalAssessments(nextList);

    // 3. Auditoria
    DataStore.logAudit(
      tenantId,
      'user-admin',
      evaluatorName,
      'Edição de Antropometria',
      'PhysicalAssessment',
      id,
      `Medição corrigida para: ${updatedAssessment.weightKg}kg, ${updatedAssessment.heightCm}cm, IMC ${calculatedBmi}.`
    );

    return updatedAssessment;
  },

  /**
   * Exclui uma medição física após confirmação.
   */
  async deleteAssessment(
    id: string,
    tenantIdOrUserName?: string,
    userNameOrFallback: string = 'Administrador'
  ): Promise<void> {
    const existing = DataStore.getAllPhysicalAssessments().find((a) => a.id === id);
    const tenantId =
      tenantIdOrUserName && (tenantIdOrUserName.startsWith('tenant-') || isValidUUID(tenantIdOrUserName))
        ? tenantIdOrUserName
        : existing?.tenantId || '';
    const userName =
      tenantIdOrUserName && !(tenantIdOrUserName.startsWith('tenant-') || isValidUUID(tenantIdOrUserName))
        ? tenantIdOrUserName
        : userNameOrFallback;

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId) && isValidUUID(id)) {
      try {
        const { error } = await supabase
          .from('physical_assessments')
          .delete()
          .eq('id', id)
          .eq('tenant_id', tenantId);

        if (error) {
          throw new Error(`Erro ao excluir medição no Supabase: ${error.message}`);
        }
      } catch (err: any) {
        console.error('Falha ao excluir medição no Supabase:', err);
        throw err;
      }
    }

    if (tenantId) {
      const currentList = DataStore.getPhysicalAssessments(tenantId);
      const nextList = currentList.filter((a) => a.id !== id);
      DataStore.savePhysicalAssessments(nextList);

      DataStore.logAudit(
        tenantId,
        'user-admin',
        userName,
        'Exclusão de Antropometria',
        'PhysicalAssessment',
        id,
        `Medição ${id} removida do histórico.`
      );
    }
  },
};
