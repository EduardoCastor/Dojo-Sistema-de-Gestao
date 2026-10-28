import { supabase, isSupabaseConfigured } from './supabase';
import { Student, Person, GuardianRelationship, BeltRank, MartialArt } from '../types';
import { cleanCPF, validateCPF, formatCPF } from '../utils/cpfValidator';
import { DataStore } from '../data/storage';
import { INITIAL_PERSONS, INITIAL_STUDENTS, INITIAL_GUARDIAN_RELATIONSHIPS } from '../data/initialData';

/**
 * Validador de formato UUID v4 para evitar erro 'invalid input syntax for type uuid'
 */
export function isValidUUID(id: string): boolean {
  if (!id) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

export interface CreateStudentPayload {
  tenantId: string;
  branchId: string;
  fullName: string;
  birthDate: string;
  cpf?: string;
  socialName?: string;
  gender: 'male' | 'female' | 'other';
  phone?: string;
  email?: string;
  city?: string;
  address?: {
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  monthlyFee: number;
  planId?: string | null;
  martialArtId: string;
  beltRankId: string;
  selectedBelt?: BeltRank;
  selectedArt?: MartialArt;
  hasGuardian?: boolean;
  guardianName?: string;
  guardianCpf?: string;
  guardianPhone?: string;
  guardianEmail?: string;
  relationshipType?: string;
  reusedPersonId?: string;
  reusedGuardianPersonId?: string;
  guardianPersonId?: string;
  guardianRelId?: string;
}

export interface UpdateStudentPayload {
  studentId: string;
  personId: string;
  tenantId: string;
  branchId: string;
  fullName: string;
  birthDate: string;
  cpf?: string;
  socialName?: string;
  gender: 'male' | 'female' | 'other';
  phone?: string;
  email?: string;
  city?: string;
  address?: {
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  monthlyFee: number;
  planId?: string | null;
  effectiveCompetence?: string;
  status: 'active' | 'inactive' | 'suspended' | 'dropped';
  martialArtId: string;
  beltRankId: string;
  selectedBelt?: BeltRank;
  selectedArt?: MartialArt;
  hasGuardian?: boolean;
  guardianPersonId?: string;
  guardianRelId?: string;
  guardianName?: string;
  guardianCpf?: string;
  guardianPhone?: string;
  guardianEmail?: string;
  relationshipType?: string;
  reusedGuardianPersonId?: string;
}

export interface GuardianSummaryItem {
  person: Person;
  isStudent: boolean;
  studentProfile?: {
    id: string;
    registrationNumber: string;
    status: string;
    enrollmentDate: string;
    beltName?: string;
    beltColorHex?: string;
    martialArtName?: string;
  };
  dependents: {
    relationshipId: string;
    studentId: string;
    relationshipLabel: string;
    isLegalGuardian: boolean;
    isFinancialGuardian: boolean;
    isEmergencyContact: boolean;
    isPickupAuthorized: boolean;
    notes?: string;
    studentRegistrationNumber: string;
    studentStatus: string;
    studentPerson: Person;
    studentGraduations?: any[];
  }[];
}

export interface StudentServiceResult {
  student: Student;
  person: Person;
  guardianPerson?: Person;
  relationship?: GuardianRelationship;
}

export const studentService = {
  /**
   * Consulta as modalidades de artes marciais da academia informada (tenant_id) no Supabase.
   * Filtra por tenant_id e opcionalmente por status='active' (padrão true para formulários de alunos).
   */
  async fetchMartialArts(tenantId: string, includeInactive: boolean = false): Promise<MartialArt[]> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado');
    }
    if (!isValidUUID(tenantId)) {
      throw new Error('ID da academia (tenant_id) deve ser um UUID válido no Supabase.');
    }

    let query = supabase
      .from('martial_arts')
      .select('id, tenant_id, name, origin, description, governing_federation, status')
      .eq('tenant_id', tenantId);

    if (!includeInactive) {
      query = query.eq('status', 'active');
    }

    const { data, error } = await query.order('name', { ascending: true });

    if (error) {
      console.error('Erro ao consultar public.martial_arts no Supabase:', error);
      throw new Error(`Erro ao consultar modalidades: ${error.message}`);
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      origin: row.origin || '',
      description: row.description || '',
      governingFederation: row.governing_federation || undefined,
      status: (row.status || 'active') as 'active' | 'inactive',
    }));
  },

  /**
   * Cadastra uma nova modalidade de arte marcial no Supabase.
   */
  async createMartialArt(
    tenantId: string,
    data: {
      name: string;
      origin?: string;
      description?: string;
      governingFederation?: string;
      status?: 'active' | 'inactive';
    }
  ): Promise<MartialArt> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado');
    }
    if (!isValidUUID(tenantId)) {
      throw new Error('ID da academia (tenant_id) deve ser um UUID válido.');
    }
    if (!data.name || !data.name.trim()) {
      throw new Error('O nome da arte marcial é obrigatório.');
    }

    const insertPayload = {
      tenant_id: tenantId,
      name: data.name.trim(),
      origin: data.origin?.trim() || null,
      description: data.description?.trim() || null,
      governing_federation: data.governingFederation?.trim() || null,
      status: data.status || 'active',
    };

    const { data: created, error } = await supabase
      .from('martial_arts')
      .insert(insertPayload)
      .select('id, tenant_id, name, origin, description, governing_federation, status')
      .single();

    if (error) {
      console.error('Erro ao inserir arte marcial no Supabase:', error);
      throw new Error(`Erro ao cadastrar modalidade: ${error.message}`);
    }

    return {
      id: created.id,
      tenantId: created.tenant_id,
      name: created.name,
      origin: created.origin || '',
      description: created.description || '',
      governingFederation: created.governing_federation || undefined,
      status: created.status as 'active' | 'inactive',
    };
  },

  /**
   * Atualiza os dados de uma modalidade existente no Supabase.
   */
  async updateMartialArt(
    tenantId: string,
    id: string,
    data: Partial<{
      name: string;
      origin: string;
      description: string;
      governingFederation: string;
      status: 'active' | 'inactive';
    }>
  ): Promise<MartialArt> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado');
    }
    if (!isValidUUID(tenantId) || !isValidUUID(id)) {
      throw new Error('tenantId e id devem ser UUIDs válidos.');
    }

    const updatePayload: Record<string, any> = {};
    if (data.name !== undefined) updatePayload.name = data.name.trim();
    if (data.origin !== undefined) updatePayload.origin = data.origin.trim();
    if (data.description !== undefined) updatePayload.description = data.description.trim();
    if (data.governingFederation !== undefined) updatePayload.governing_federation = data.governingFederation.trim() || null;
    if (data.status !== undefined) updatePayload.status = data.status;

    const { data: updated, error } = await supabase
      .from('martial_arts')
      .update(updatePayload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, tenant_id, name, origin, description, governing_federation, status')
      .single();

    if (error) {
      console.error('Erro ao atualizar arte marcial no Supabase:', error);
      throw new Error(`Erro ao atualizar modalidade: ${error.message}`);
    }

    return {
      id: updated.id,
      tenantId: updated.tenant_id,
      name: updated.name,
      origin: updated.origin || '',
      description: updated.description || '',
      governingFederation: updated.governing_federation || undefined,
      status: updated.status as 'active' | 'inactive',
    };
  },

  /**
   * Altera o status (active / inactive) de uma modalidade.
   */
  async toggleMartialArtStatus(
    tenantId: string,
    id: string,
    status: 'active' | 'inactive'
  ): Promise<MartialArt> {
    return this.updateMartialArt(tenantId, id, { status });
  },

  /**
   * Exclui uma modalidade do Supabase (se não houver registros dependentes ou regras de restrição).
   */
  async deleteMartialArt(tenantId: string, id: string): Promise<void> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado');
    }
    if (!isValidUUID(tenantId) || !isValidUUID(id)) {
      throw new Error('tenantId e id devem ser UUIDs válidos.');
    }

    const { error } = await supabase
      .from('martial_arts')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Erro ao excluir arte marcial no Supabase:', error);
      throw new Error(`Erro ao excluir modalidade: ${error.message}`);
    }
  },

  /**
   * Consulta as faixas/graduações da academia informada (tenant_id) no Supabase.
   * Filtra exclusivamente por tenant_id e martial_art_id correspondente, ordenando por order_index crescente.
   */
  async fetchBeltRanks(tenantId: string, martialArtId?: string): Promise<BeltRank[]> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado');
    }
    if (!isValidUUID(tenantId)) {
      throw new Error('ID da academia (tenant_id) deve ser um UUID válido no Supabase.');
    }

    let query = supabase
      .from('belt_ranks')
      .select('id, tenant_id, martial_art_id, name, rank_type, order_index, color_hex, stripe_color_hex, min_age_years, min_practice_months, technical_requirements, requires_exam')
      .eq('tenant_id', tenantId);

    if (martialArtId) {
      if (!isValidUUID(martialArtId)) {
        throw new Error('ID da modalidade deve ser um UUID válido.');
      }
      query = query.eq('martial_art_id', martialArtId);
    }

    const { data, error } = await query.order('order_index', { ascending: true });

    if (error) {
      console.error('Erro ao consultar public.belt_ranks no Supabase:', error);
      throw new Error(`Erro ao consultar graduações: ${error.message}`);
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      martialArtId: row.martial_art_id,
      name: row.name,
      rankType: row.rank_type || 'faixa',
      orderIndex: row.order_index,
      colorHex: row.color_hex || '#ffffff',
      stripeColorHex: row.stripe_color_hex || undefined,
      minAgeYears: row.min_age_years ?? 4,
      minPracticeMonths: row.min_practice_months ?? 0,
      technicalRequirements: row.technical_requirements || '',
      requiresExam: Boolean(row.requires_exam),
    }));
  },

  /**
   * Cadastra uma nova faixa/graduação vinculada a uma modalidade no Supabase.
   */
  async createBeltRank(
    tenantId: string,
    data: {
      martialArtId: string;
      name: string;
      rankType?: 'faixa' | 'grau' | 'dan' | 'corda';
      orderIndex?: number;
      colorHex: string;
      stripeColorHex?: string;
      minAgeYears?: number;
      minPracticeMonths?: number;
      technicalRequirements?: string;
      requiresExam?: boolean;
    }
  ): Promise<BeltRank> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado');
    }
    if (!isValidUUID(tenantId) || !isValidUUID(data.martialArtId)) {
      throw new Error('tenantId e martialArtId devem ser UUIDs válidos.');
    }
    if (!data.name || !data.name.trim()) {
      throw new Error('O nome da faixa/graduação é obrigatório.');
    }

    // Se orderIndex não foi informado, buscar o maior atual e somar 1
    let nextOrder = data.orderIndex;
    if (nextOrder === undefined || nextOrder === null) {
      const { data: existing } = await supabase
        .from('belt_ranks')
        .select('order_index')
        .eq('tenant_id', tenantId)
        .eq('martial_art_id', data.martialArtId)
        .order('order_index', { ascending: false })
        .limit(1);

      nextOrder = (existing?.[0]?.order_index ?? 0) + 1;
    }

    const insertPayload = {
      tenant_id: tenantId,
      martial_art_id: data.martialArtId,
      name: data.name.trim(),
      rank_type: data.rankType || 'faixa',
      order_index: nextOrder,
      color_hex: data.colorHex || '#ffffff',
      stripe_color_hex: data.stripeColorHex || null,
      min_age_years: data.minAgeYears ?? 4,
      min_practice_months: data.minPracticeMonths ?? 0,
      technical_requirements: data.technicalRequirements?.trim() || null,
      requires_exam: data.requiresExam !== false,
    };

    const { data: created, error } = await supabase
      .from('belt_ranks')
      .insert(insertPayload)
      .select('id, tenant_id, martial_art_id, name, rank_type, order_index, color_hex, stripe_color_hex, min_age_years, min_practice_months, technical_requirements, requires_exam')
      .single();

    if (error) {
      console.error('Erro ao cadastrar faixa no Supabase:', error);
      throw new Error(`Erro ao cadastrar graduação: ${error.message}`);
    }

    return {
      id: created.id,
      tenantId: created.tenant_id,
      martialArtId: created.martial_art_id,
      name: created.name,
      rankType: created.rank_type as any,
      orderIndex: created.order_index,
      colorHex: created.color_hex,
      stripeColorHex: created.stripe_color_hex || undefined,
      minAgeYears: created.min_age_years,
      minPracticeMonths: created.min_practice_months,
      technicalRequirements: created.technical_requirements || '',
      requiresExam: created.requires_exam,
    };
  },

  /**
   * Atualiza os dados de uma faixa/graduação existente no Supabase.
   */
  async updateBeltRank(
    tenantId: string,
    id: string,
    data: Partial<{
      name: string;
      rankType: 'faixa' | 'grau' | 'dan' | 'corda';
      orderIndex: number;
      colorHex: string;
      stripeColorHex: string;
      minAgeYears: number;
      minPracticeMonths: number;
      technicalRequirements: string;
      requiresExam: boolean;
    }>
  ): Promise<BeltRank> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado');
    }
    if (!isValidUUID(tenantId) || !isValidUUID(id)) {
      throw new Error('tenantId e id devem ser UUIDs válidos.');
    }

    const updatePayload: Record<string, any> = {};
    if (data.name !== undefined) updatePayload.name = data.name.trim();
    if (data.rankType !== undefined) updatePayload.rank_type = data.rankType;
    if (data.orderIndex !== undefined) updatePayload.order_index = Number(data.orderIndex);
    if (data.colorHex !== undefined) updatePayload.color_hex = data.colorHex;
    if (data.stripeColorHex !== undefined) updatePayload.stripe_color_hex = data.stripeColorHex || null;
    if (data.minAgeYears !== undefined) updatePayload.min_age_years = Number(data.minAgeYears);
    if (data.minPracticeMonths !== undefined) updatePayload.min_practice_months = Number(data.minPracticeMonths);
    if (data.technicalRequirements !== undefined) updatePayload.technical_requirements = data.technicalRequirements.trim();
    if (data.requiresExam !== undefined) updatePayload.requires_exam = Boolean(data.requiresExam);

    const { data: updated, error } = await supabase
      .from('belt_ranks')
      .update(updatePayload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, tenant_id, martial_art_id, name, rank_type, order_index, color_hex, stripe_color_hex, min_age_years, min_practice_months, technical_requirements, requires_exam')
      .single();

    if (error) {
      console.error('Erro ao atualizar faixa no Supabase:', error);
      throw new Error(`Erro ao atualizar graduação: ${error.message}`);
    }

    return {
      id: updated.id,
      tenantId: updated.tenant_id,
      martialArtId: updated.martial_art_id,
      name: updated.name,
      rankType: updated.rank_type as any,
      orderIndex: updated.order_index,
      colorHex: updated.color_hex,
      stripeColorHex: updated.stripe_color_hex || undefined,
      minAgeYears: updated.min_age_years,
      minPracticeMonths: updated.min_practice_months,
      technicalRequirements: updated.technical_requirements || '',
      requiresExam: updated.requires_exam,
    };
  },

  /**
   * Exclui uma faixa/graduação do Supabase.
   */
  async deleteBeltRank(tenantId: string, id: string): Promise<void> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado');
    }
    if (!isValidUUID(tenantId) || !isValidUUID(id)) {
      throw new Error('tenantId e id devem ser UUIDs válidos.');
    }

    const { error } = await supabase
      .from('belt_ranks')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Erro ao excluir faixa no Supabase:', error);
      throw new Error(`Erro ao excluir graduação: ${error.message}`);
    }
  },

  /**
   * Reordena as faixas de uma arte marcial atualizando seu order_index progressivo.
   * Tenta primeiro a função RPC atômica reorder_belt_ranks e faz fallback seguro para updates individuais.
   */
  async reorderBeltRanks(tenantId: string, martialArtId: string, orderedBeltIds: string[]): Promise<void> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado');
    }
    if (!isValidUUID(tenantId) || !isValidUUID(martialArtId)) {
      throw new Error('tenantId e martialArtId devem ser UUIDs válidos.');
    }

    // 1. Tentar via RPC atômica
    try {
      const { error: rpcError } = await supabase.rpc('reorder_belt_ranks', {
        p_tenant_id: tenantId,
        p_martial_art_id: martialArtId,
        p_ordered_belt_ids: orderedBeltIds,
      });

      if (!rpcError) {
        return;
      }
    } catch {
      // Se a função RPC ainda não foi aplicada na migration, prosseguir para fallback
    }

    // 2. Fallback: update individual em paralelo/sequencial
    for (let index = 0; index < orderedBeltIds.length; index++) {
      const beltId = orderedBeltIds[index];
      await supabase
        .from('belt_ranks')
        .update({ order_index: index + 1 })
        .eq('id', beltId)
        .eq('tenant_id', tenantId)
        .eq('martial_art_id', martialArtId);
    }
  },

  /**
   * Localiza uma pessoa cadastrada na academia informada pelo CPF (normalizado/11 dígitos).
   * Retorna os dados pessoais, se ela é aluno(a), se ela é responsável e dependentes vinculados.
   */
  async findPersonByCpf(tenantId: string, cpfInput: string): Promise<{
    person: Person | null;
    isStudent: boolean;
    student?: Student;
    isGuardian: boolean;
    dependentsCount: number;
    dependents?: { studentId: string; studentName: string; relationshipLabel: string }[];
  } | null> {
    const clean = cleanCPF(cpfInput);
    if (!clean || clean.length !== 11) {
      return null;
    }

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      try {
        // Consultar pessoas do tenant que tenham o CPF (limpo ou formatado)
        const { data: personsData, error } = await supabase
          .from('persons')
          .select('id, tenant_id, full_name, social_name, cpf, birth_date, gender, phone, email, address, created_at')
          .eq('tenant_id', tenantId)
          .in('cpf', [clean, formatCPF(clean)])
          .limit(1);

        if (error || !personsData || personsData.length === 0) {
          return null;
        }

        const rawPerson = personsData[0];
        const person: Person = {
          id: rawPerson.id,
          tenantId: rawPerson.tenant_id,
          fullName: rawPerson.full_name,
          socialName: rawPerson.social_name || undefined,
          cpf: rawPerson.cpf || clean,
          birthDate: rawPerson.birth_date,
          gender: rawPerson.gender || 'male',
          phone: rawPerson.phone || '',
          email: rawPerson.email || '',
          address: rawPerson.address || {},
          createdAt: rawPerson.created_at,
        };

        // Verificar se esta pessoa já possui registro em students
        const { data: studentRows } = await supabase
          .from('students')
          .select('id, tenant_id, branch_id, person_id, registration_number, enrollment_date, status, monthly_fee, notes')
          .eq('tenant_id', tenantId)
          .eq('person_id', person.id)
        let student: Student | undefined = undefined;
        if (studentRows && studentRows.length > 0) {
          const sr = studentRows[0];
          student = {
            id: sr.id,
            tenantId: sr.tenant_id,
            branchId: sr.branch_id,
            personId: sr.person_id,
            registrationNumber: sr.registration_number,
            enrollmentDate: sr.enrollment_date,
            status: sr.status,
            currentGraduations: [],
            monthlyFee: Number(sr.monthly_fee) || 0,
            notes: sr.notes || undefined,
          };
        }
        const isStudent = Boolean(student);

        // Verificar vínculos de responsável
        const { data: guardianRows } = await supabase
          .from('guardian_relationships')
          .select(`
            id,
            relationship_label,
            student_id,
            student:students (
              id,
              registration_number,
              person:persons (id, full_name)
            )
          `)
          .eq('tenant_id', tenantId)
          .eq('guardian_person_id', person.id);

        const dependents = (guardianRows || []).map((row: any) => ({
          studentId: row.student_id,
          studentName: row.student?.person?.full_name || 'Aluno',
          relationshipLabel: row.relationship_label,
        }));

        return {
          person,
          isStudent,
          student,
          isGuardian: dependents.length > 0,
          dependentsCount: dependents.length,
          dependents,
        };
      } catch (err) {
        console.warn('Erro ao consultar pessoa por CPF no Supabase:', err);
      }
    }

    // Fallback: LocalStorage / DataStore
    const localPersons = DataStore.getPersons(tenantId);
    const matched = localPersons.find((p) => cleanCPF(p.cpf) === clean);
    if (!matched) return null;

    const localStudents = DataStore.getStudents(tenantId);
    const student = localStudents.find((s) => s.personId === matched.id);
    const localRels = DataStore.getGuardianRelationships(tenantId).filter((r) => r.guardianPersonId === matched.id);

    const dependents = localRels.map((r) => {
      const st = localStudents.find((s) => s.id === r.studentId);
      const sp = localPersons.find((p) => p.id === st?.personId);
      return {
        studentId: r.studentId,
        studentName: sp?.fullName || 'Aluno',
        relationshipLabel: r.relationshipLabel,
      };
    });

    return {
      person: matched,
      isStudent: Boolean(student),
      student,
      isGuardian: dependents.length > 0,
      dependentsCount: dependents.length,
      dependents,
    };
  },

  /**
   * Consulta uma pessoa física pelo seu UUID no tenant.
   */
  async findPersonById(tenantId: string, personId: string): Promise<Person | null> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(personId) || !isValidUUID(tenantId)) {
      return null;
    }
    try {
      const { data, error } = await supabase
        .from('persons')
        .select('*')
        .eq('id', personId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error || !data) return null;
      return {
        id: data.id,
        tenantId: data.tenant_id,
        fullName: data.full_name,
        socialName: data.social_name || undefined,
        cpf: data.cpf || '',
        birthDate: data.birth_date,
        gender: (data.gender as any) || 'other',
        phone: data.phone || '',
        email: data.email || '',
        address: data.address || {},
        createdAt: data.created_at,
      };
    } catch {
      return null;
    }
  },

  /**
   * Valida unicidade de CPF na mesma academia (tenant_id).
   * Impede que duas pessoas distintas utilizem o mesmo CPF.
   * Permite que a pessoa sendo editada (excludePersonId) mantenha seu próprio CPF.
   */
  async checkCpfDuplicity(
    tenantId: string,
    cpfInput: string,
    excludePersonId?: string
  ): Promise<{
    isDuplicate: boolean;
    existingPerson?: Person;
    isStudent?: boolean;
    isGuardian?: boolean;
    message?: string;
  }> {
    const clean = cleanCPF(cpfInput);
    if (!clean || clean.length !== 11) {
      return { isDuplicate: false };
    }

    // 1. Validação matemática do CPF primeiro
    const validation = validateCPF(clean);
    if (!validation.isValid) {
      return {
        isDuplicate: false,
        message: validation.error,
      };
    }

    const found = await this.findPersonByCpf(tenantId, clean);
    if (!found || !found.person) {
      return { isDuplicate: false };
    }

    // Se a pessoa encontrada for o próprio registro que está sendo editado, não é duplicidade
    if (excludePersonId && found.person.id === excludePersonId) {
      return { isDuplicate: false };
    }

    const roleDesc =
      found.isStudent && found.isGuardian
        ? 'Aluno e Responsável'
        : found.isStudent
        ? 'Aluno'
        : 'Responsável';

    return {
      isDuplicate: true,
      existingPerson: found.person,
      isStudent: found.isStudent,
      isGuardian: found.isGuardian,
      message: `Este CPF já está cadastrado para ${found.person.fullName} (${roleDesc}) nesta academia.`,
    };
  },

  /**
   * Consulta o resumo de todos os responsáveis da academia ativa, seus dependentes
   * e indica se o responsável também possui matrícula de aluno no Dojo.
   */
  async fetchGuardiansSummary(tenantId: string, searchTerm?: string): Promise<GuardianSummaryItem[]> {
    const cleanSearch = cleanCPF(searchTerm || '');
    const textSearch = (searchTerm || '').toLowerCase().trim();

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      // 1. Tentar via RPC atômica search_guardians_summary
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('search_guardians_summary', {
          p_tenant_id: tenantId,
          p_search_query: searchTerm || null,
        });

        if (!rpcErr && Array.isArray(rpcData)) {
          return rpcData.map((item: any) => ({
            person: {
              id: item.person_id,
              tenantId,
              fullName: item.full_name,
              socialName: item.social_name || undefined,
              cpf: item.cpf || '',
              birthDate: item.birth_date,
              gender: item.gender || 'other',
              phone: item.phone || '',
              email: item.email || '',
              address: item.address || {},
              createdAt: item.created_at || new Date().toISOString(),
            },
            isStudent: Boolean(item.is_student),
            studentProfile: item.is_student
              ? {
                  id: item.student_id,
                  registrationNumber: item.registration_number,
                  status: item.student_status,
                  enrollmentDate: '',
                }
              : undefined,
            dependents: (item.dependents || []).map((d: any) => ({
              relationshipId: d.relationship_id,
              studentId: d.student_id,
              relationshipLabel: d.relationship_label,
              isLegalGuardian: Boolean(d.is_legal_guardian),
              isFinancialGuardian: Boolean(d.is_financial_guardian),
              isEmergencyContact: Boolean(d.is_emergency_contact),
              isPickupAuthorized: Boolean(d.is_pickup_authorized),
              notes: d.notes,
              studentRegistrationNumber: d.student_registration_number,
              studentStatus: d.student_status,
              studentPerson: {
                id: d.student_id,
                tenantId,
                fullName: d.student_name,
                cpf: '',
                birthDate: '2010-01-01',
                gender: 'male',
                phone: '',
                email: '',
                address: {} as any,
                createdAt: new Date().toISOString(),
              },
            })),
          }));
        }
      } catch (rpcEx) {
        console.warn('search_guardians_summary RPC indisponível, usando fallback direto:', rpcEx);
      }

      // 2. Fallback direto Supabase (sem embeddings de composite foreign key)
      try {
        const [personsRes, relsRes, studentsRes] = await Promise.all([
          supabase.from('persons').select('*').eq('tenant_id', tenantId),
          supabase.from('guardian_relationships').select('*').eq('tenant_id', tenantId),
          supabase.from('students').select('id, person_id, registration_number, status, enrollment_date').eq('tenant_id', tenantId),
        ]);

        const dbPersons: any[] = personsRes.data || [];
        const dbRels: any[] = relsRes.data || [];
        const dbStudents: any[] = studentsRes.data || [];

        const studentByPersonId = new Map<string, any>();
        dbStudents.forEach((st) => studentByPersonId.set(st.person_id, st));

        const studentById = new Map<string, any>();
        dbStudents.forEach((st) => studentById.set(st.id, st));

        const personById = new Map<string, any>();
        dbPersons.forEach((p) => personById.set(p.id, p));

        // Pessoas que são responsáveis (possuem vínculo) OU que batem com a busca
        const guardianPersonIds = new Set(dbRels.map((r) => r.guardian_person_id));
        const matchedPersons = dbPersons.filter((p) => {
          if (guardianPersonIds.has(p.id)) return true;
          if (!searchTerm) return false;
          const matchesName = p.full_name?.toLowerCase().includes(textSearch);
          const matchesCpf = cleanSearch && cleanCPF(p.cpf).includes(cleanSearch);
          return matchesName || matchesCpf;
        });

        const result: GuardianSummaryItem[] = matchedPersons.map((p) => {
          const stProfile = studentByPersonId.get(p.id);
          const pRels = dbRels.filter((r) => r.guardian_person_id === p.id);

          const dependents = pRels.map((r) => {
            const st = studentById.get(r.student_id);
            const sp = st ? personById.get(st.person_id) : null;
            return {
              relationshipId: r.id,
              studentId: r.student_id,
              relationshipLabel: r.relationship_label || 'Responsável',
              isLegalGuardian: Boolean(r.is_legal_guardian),
              isFinancialGuardian: Boolean(r.is_financial_guardian),
              isEmergencyContact: Boolean(r.is_emergency_contact),
              isPickupAuthorized: Boolean(r.is_pickup_authorized),
              notes: r.notes || undefined,
              studentRegistrationNumber: st?.registration_number || 'MAT-000',
              studentStatus: st?.status || 'active',
              studentPerson: sp ? {
                id: sp.id,
                tenantId: sp.tenant_id,
                fullName: sp.full_name,
                socialName: sp.social_name || undefined,
                cpf: sp.cpf || '',
                birthDate: sp.birth_date,
                gender: ((sp.gender as 'male' | 'female' | 'other') || 'other') as 'male' | 'female' | 'other',
                phone: sp.phone || '',
                email: sp.email || '',
                address: sp.address || {},
                createdAt: sp.created_at,
              } : {
                id: r.student_id,
                tenantId,
                fullName: 'Aluno',
                cpf: '',
                birthDate: '2010-01-01',
                gender: 'male' as const,
                phone: '',
                email: '',
                address: {} as any,
                createdAt: new Date().toISOString(),
              },
            };
          });

          return {
            person: {
              id: p.id,
              tenantId: p.tenant_id,
              fullName: p.full_name,
              socialName: p.social_name || undefined,
              cpf: p.cpf || '',
              birthDate: p.birth_date,
              gender: ((p.gender as 'male' | 'female' | 'other') || 'other') as 'male' | 'female' | 'other',
              phone: p.phone || '',
              email: p.email || '',
              address: p.address || {},
              createdAt: p.created_at,
            },
            isStudent: Boolean(stProfile),
            studentProfile: stProfile ? {
              id: stProfile.id,
              registrationNumber: stProfile.registration_number,
              status: stProfile.status,
              enrollmentDate: stProfile.enrollment_date,
            } : undefined,
            dependents,
          };
        });

        // Filtrar pelo termo de busca
        if (textSearch || cleanSearch) {
          return result.filter((g) => {
            const matchesName = g.person.fullName.toLowerCase().includes(textSearch);
            const matchesCpf = cleanSearch && cleanCPF(g.person.cpf).includes(cleanSearch);
            const matchesDependent = g.dependents.some((d) =>
              d.studentPerson.fullName.toLowerCase().includes(textSearch) ||
              d.studentRegistrationNumber.toLowerCase().includes(textSearch)
            );
            return matchesName || matchesCpf || matchesDependent;
          }).sort((a, b) => a.person.fullName.localeCompare(b.person.fullName));
        }

        return result.sort((a, b) => a.person.fullName.localeCompare(b.person.fullName));
      } catch (directErr) {
        console.warn('Erro ao consultar responsáveis via fallback direto:', directErr);
      }
    }

    // Fallback: DataStore
    const localPersons = DataStore.getPersons(tenantId);
    const localRels = DataStore.getGuardianRelationships(tenantId);
    const localStudents = DataStore.getStudents(tenantId);

    const guardiansMap = new Map<string, GuardianSummaryItem>();

    localRels.forEach((r) => {
      const gp = localPersons.find((p) => p.id === r.guardianPersonId);
      if (!gp) return;

      if (!guardiansMap.has(gp.id)) {
        const stProfile = localStudents.find((s) => s.personId === gp.id);
        const grad = stProfile?.currentGraduations?.[0];

        guardiansMap.set(gp.id, {
          person: gp,
          isStudent: Boolean(stProfile),
          studentProfile: stProfile
            ? {
                id: stProfile.id,
                registrationNumber: stProfile.registrationNumber,
                status: stProfile.status,
                enrollmentDate: stProfile.enrollmentDate,
                beltName: grad?.beltName,
                beltColorHex: grad?.beltColorHex,
                martialArtName: grad?.martialArtName,
              }
            : undefined,
          dependents: [],
        });
      }

      const item = guardiansMap.get(gp.id)!;
      const st = localStudents.find((s) => s.id === r.studentId);
      const sp = localPersons.find((p) => p.id === st?.personId);

      item.dependents.push({
        relationshipId: r.id,
        studentId: r.studentId,
        relationshipLabel: r.relationshipLabel,
        isLegalGuardian: r.isLegalGuardian,
        isFinancialGuardian: r.isFinancialGuardian,
        isEmergencyContact: r.isEmergencyContact,
        isPickupAuthorized: r.isPickupAuthorized,
        notes: r.notes,
        studentRegistrationNumber: st?.registrationNumber || 'MAT-000',
        studentStatus: st?.status || 'active',
        studentPerson: sp || {
          id: r.studentId,
          tenantId,
          fullName: 'Aluno',
          cpf: '',
          birthDate: '2015-01-01',
          gender: 'male',
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
          createdAt: new Date().toISOString(),
        },
      });
    });

    let result = Array.from(guardiansMap.values());

    if (textSearch || cleanSearch) {
      result = result.filter((g) => {
        const matchesName = g.person.fullName.toLowerCase().includes(textSearch);
        const matchesCpf = cleanSearch && cleanCPF(g.person.cpf).includes(cleanSearch);
        const matchesDependent = g.dependents.some((d) =>
          d.studentPerson.fullName.toLowerCase().includes(textSearch)
        );
        return matchesName || matchesCpf || matchesDependent;
      });
    }

    return result.sort((a, b) => a.person.fullName.localeCompare(b.person.fullName));
  },

  /**
   * Atualiza os dados de contato de uma pessoa responsável.
   */
  async updateGuardianPerson(
    tenantId: string,
    personId: string,
    updates: Partial<{
      fullName: string;
      cpf: string;
      phone: string;
      email: string;
      address: any;
    }>
  ): Promise<Person> {
    if (updates.cpf) {
      const clean = cleanCPF(updates.cpf);
      const val = validateCPF(clean);
      if (!val.isValid) {
        throw new Error(`CPF do responsável inválido: ${val.error}`);
      }
      const dupl = await this.checkCpfDuplicity(tenantId, clean, personId);
      if (dupl.isDuplicate) {
        throw new Error(dupl.message);
      }
    }

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId) && isValidUUID(personId)) {
      const dbPayload: any = { updated_at: new Date().toISOString() };
      if (updates.fullName !== undefined) dbPayload.full_name = updates.fullName.trim();
      if (updates.cpf !== undefined) dbPayload.cpf = cleanCPF(updates.cpf) || null;
      if (updates.phone !== undefined) dbPayload.phone = updates.phone.trim() || null;
      if (updates.email !== undefined) dbPayload.email = updates.email.trim() || null;
      if (updates.address !== undefined) dbPayload.address = updates.address;

      const { data, error } = await supabase
        .from('persons')
        .update(dbPayload)
        .eq('id', personId)
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (error || !data) {
        throw new Error(`Erro ao atualizar dados do responsável: ${error?.message || 'Falha na resposta'}`);
      }

      return {
        id: data.id,
        tenantId: data.tenant_id,
        fullName: data.full_name,
        socialName: data.social_name || undefined,
        cpf: data.cpf || '',
        birthDate: data.birth_date,
        gender: data.gender || 'other',
        phone: data.phone || '',
        email: data.email || '',
        address: data.address || {},
        createdAt: data.created_at,
      };
    }

    // Fallback: DataStore
    const localPersons = DataStore.getPersons(tenantId);
    const existing = localPersons.find((p) => p.id === personId);
    if (!existing) throw new Error('Responsável não localizado');

    const updated: Person = {
      ...existing,
      fullName: updates.fullName !== undefined ? updates.fullName.trim() : existing.fullName,
      cpf: updates.cpf !== undefined ? cleanCPF(updates.cpf) : existing.cpf,
      phone: updates.phone !== undefined ? updates.phone.trim() : existing.phone,
      email: updates.email !== undefined ? updates.email.trim() : existing.email,
      address: updates.address !== undefined ? updates.address : existing.address,
    };

    DataStore.savePersons(localPersons.map((p) => (p.id === personId ? updated : p)));
    return updated;
  },

  /**
   * Cadastra um novo responsável de forma independente na academia (sem vincular a aluno ainda).
   */
  async createGuardian(
    tenantId: string,
    payload: {
      fullName: string;
      socialName?: string;
      cpf?: string;
      birthDate?: string;
      gender?: 'male' | 'female' | 'other';
      phone?: string;
      email?: string;
      address?: any;
    }
  ): Promise<Person> {
    if (!payload.fullName?.trim()) {
      throw new Error('O nome completo do responsável é obrigatório.');
    }

    let cleanCpfValue: string | null = null;
    if (payload.cpf) {
      cleanCpfValue = cleanCPF(payload.cpf);
      if (cleanCpfValue) {
        const val = validateCPF(cleanCpfValue);
        if (!val.isValid) {
          throw new Error(`CPF do responsável inválido: ${val.error}`);
        }
        const dupl = await this.checkCpfDuplicity(tenantId, cleanCpfValue);
        if (dupl.isDuplicate) {
          throw new Error(dupl.message);
        }
      }
    }

    const defaultAddress = payload.address || {
      street: '',
      number: '',
      neighborhood: '',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '',
    };

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      const { data, error } = await supabase
        .from('persons')
        .insert({
          tenant_id: tenantId,
          full_name: payload.fullName.trim(),
          social_name: payload.socialName?.trim() || null,
          cpf: cleanCpfValue,
          birth_date: payload.birthDate || '1985-01-01',
          gender: payload.gender || 'other',
          phone: payload.phone?.trim() || null,
          email: payload.email?.trim() || null,
          address: defaultAddress,
        })
        .select()
        .single();

      if (error || !data) {
        throw new Error(`Erro ao cadastrar responsável no Supabase: ${error?.message || 'Falha na resposta'}`);
      }

      return {
        id: data.id,
        tenantId: data.tenant_id,
        fullName: data.full_name,
        socialName: data.social_name || undefined,
        cpf: data.cpf || '',
        birthDate: data.birth_date,
        gender: data.gender || 'other',
        phone: data.phone || '',
        email: data.email || '',
        address: data.address || defaultAddress,
        createdAt: data.created_at,
      };
    }

    // Fallback: DataStore
    const newPerson: Person = {
      id: `person-g-${Date.now()}`,
      tenantId,
      fullName: payload.fullName.trim(),
      socialName: payload.socialName?.trim(),
      cpf: cleanCpfValue || '',
      birthDate: payload.birthDate || '1985-01-01',
      gender: payload.gender || 'other',
      phone: payload.phone?.trim() || '',
      email: payload.email?.trim() || '',
      address: defaultAddress,
      createdAt: new Date().toISOString(),
    };

    const existingPersons = DataStore.getPersons(tenantId);
    DataStore.savePersons([...existingPersons, newPerson]);
    return newPerson;
  },

  /**
   * Salva ou atualiza atomicamente o vínculo de um responsável com um aluno.
   * Utiliza RPC save_student_guardian_link no Supabase com fallback seguro.
   */
  async saveStudentGuardianLink(
    tenantId: string,
    studentId: string,
    hasGuardian: boolean,
    guardianPerson?: {
      id?: string;
      fullName: string;
      cpf?: string;
      phone?: string;
      email?: string;
      birthDate?: string;
      gender?: string;
      address?: any;
    },
    relationship?: {
      relationshipLabel?: string;
      isLegalGuardian?: boolean;
      isFinancialGuardian?: boolean;
      isEmergencyContact?: boolean;
      isPickupAuthorized?: boolean;
      notes?: string;
    }
  ): Promise<{ success: boolean; guardianPersonId?: string; relationshipId?: string }> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId) || !isValidUUID(studentId)) {
      return { success: true };
    }

    try {
      const { data, error } = await supabase.rpc('save_student_guardian_link', {
        p_tenant_id: tenantId,
        p_student_id: studentId,
        p_has_guardian: hasGuardian,
        p_guardian_person: guardianPerson ? {
          id: guardianPerson.id || null,
          full_name: guardianPerson.fullName.trim(),
          cpf: guardianPerson.cpf ? cleanCPF(guardianPerson.cpf) : null,
          phone: guardianPerson.phone || null,
          email: guardianPerson.email || null,
          birth_date: guardianPerson.birthDate || '1985-01-01',
          gender: guardianPerson.gender || 'other',
          address: guardianPerson.address || {},
        } : null,
        p_guardian_rel: relationship ? {
          relationship_label: relationship.relationshipLabel || 'Responsável',
          is_legal_guardian: relationship.isLegalGuardian ?? true,
          is_financial_guardian: relationship.isFinancialGuardian ?? true,
          is_emergency_contact: relationship.isEmergencyContact ?? true,
          is_pickup_authorized: relationship.isPickupAuthorized ?? true,
          notes: relationship.notes || null,
        } : null,
      });

      if (!error && data?.success) {
        return {
          success: true,
          guardianPersonId: data.guardian_person_id,
          relationshipId: data.guardian_relationship_id,
        };
      }
    } catch (err) {
      console.warn('RPC save_student_guardian_link falhou, aplicando fallback:', err);
    }

    // Fallback direto via REST no Supabase
    if (!hasGuardian) {
      await supabase
        .from('guardian_relationships')
        .delete()
        .eq('student_id', studentId)
        .eq('tenant_id', tenantId);
      return { success: true };
    }

    return { success: true };
  },

  /**
   * Vincula um aluno a um responsável já existente na academia.
   */
  async linkStudentToGuardian(
    tenantId: string,
    studentId: string,
    guardianPersonId: string,
    relationshipLabel: string = 'Responsável',
    options?: {
      isLegalGuardian?: boolean;
      isFinancialGuardian?: boolean;
      isEmergencyContact?: boolean;
      isPickupAuthorized?: boolean;
      notes?: string;
    }
  ): Promise<GuardianRelationship> {
    if (!isValidUUID(tenantId) || !isValidUUID(studentId) || !isValidUUID(guardianPersonId)) {
      throw new Error('Identificadores inválidos para vincular responsável.');
    }

    if (isSupabaseConfigured() && supabase) {
      // 1. Tentar RPC
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('link_student_to_guardian', {
          p_tenant_id: tenantId,
          p_student_id: studentId,
          p_guardian_person_id: guardianPersonId,
          p_relationship_label: relationshipLabel,
          p_is_financial: options?.isFinancialGuardian ?? true,
          p_is_legal: options?.isLegalGuardian ?? true,
          p_is_emergency: options?.isEmergencyContact ?? true,
          p_is_pickup: options?.isPickupAuthorized ?? true,
          p_notes: options?.notes || null,
        });

        if (!rpcErr && rpcData?.success) {
          return {
            id: rpcData.relationship_id,
            tenantId,
            studentId,
            guardianPersonId,
            relationshipLabel,
            isLegalGuardian: options?.isLegalGuardian ?? true,
            isFinancialGuardian: options?.isFinancialGuardian ?? true,
            isEmergencyContact: options?.isEmergencyContact ?? true,
            isPickupAuthorized: options?.isPickupAuthorized ?? true,
            notes: options?.notes,
          };
        }
      } catch (err) {
        console.warn('link_student_to_guardian RPC fallback:', err);
      }

      // 2. Direct REST Upsert
      const { data, error } = await supabase
        .from('guardian_relationships')
        .upsert(
          {
            tenant_id: tenantId,
            student_id: studentId,
            guardian_person_id: guardianPersonId,
            relationship_label: relationshipLabel,
            is_legal_guardian: options?.isLegalGuardian ?? true,
            is_financial_guardian: options?.isFinancialGuardian ?? true,
            is_emergency_contact: options?.isEmergencyContact ?? true,
            is_pickup_authorized: options?.isPickupAuthorized ?? true,
            notes: options?.notes || null,
          },
          { onConflict: 'tenant_id,student_id,guardian_person_id' }
        )
        .select()
        .single();

      if (error || !data) {
        throw new Error(`Erro ao vincular aluno ao responsável no Supabase: ${error?.message}`);
      }

      return {
        id: data.id,
        tenantId: data.tenant_id,
        studentId: data.student_id,
        guardianPersonId: data.guardian_person_id,
        relationshipLabel: data.relationship_label,
        isLegalGuardian: data.is_legal_guardian,
        isFinancialGuardian: data.is_financial_guardian,
        isEmergencyContact: data.is_emergency_contact,
        isPickupAuthorized: data.is_pickup_authorized,
        notes: data.notes || undefined,
      };
    }

    // Fallback: DataStore
    const newRel: GuardianRelationship = {
      id: `rel-${Date.now()}`,
      tenantId,
      studentId,
      guardianPersonId,
      relationshipLabel,
      isLegalGuardian: options?.isLegalGuardian ?? true,
      isFinancialGuardian: options?.isFinancialGuardian ?? true,
      isEmergencyContact: options?.isEmergencyContact ?? true,
      isPickupAuthorized: options?.isPickupAuthorized ?? true,
      notes: options?.notes,
    };
    const localRels = DataStore.getGuardianRelationships(tenantId);
    const filtered = localRels.filter(
      (r) => !(r.studentId === studentId && r.guardianPersonId === guardianPersonId)
    );
    DataStore.saveGuardianRelationships([...filtered, newRel]);
    return newRel;
  },

  /**
   * Desvincula um aluno de um responsável específico mantendo o cadastro da pessoa.
   */
  async unlinkStudentGuardian(tenantId: string, studentId: string, guardianPersonId: string): Promise<void> {
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      try {
        const { error: rpcErr } = await supabase.rpc('unlink_student_from_guardian', {
          p_tenant_id: tenantId,
          p_student_id: studentId,
          p_guardian_person_id: guardianPersonId,
        });

        if (!rpcErr) return;
      } catch {
        // Fallback direto
      }

      const { error } = await supabase
        .from('guardian_relationships')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('student_id', studentId)
        .eq('guardian_person_id', guardianPersonId);

      if (error) {
        throw new Error(`Erro ao desvincular aluno do responsável: ${error.message}`);
      }
      return;
    }

    // Fallback DataStore
    const localRels = DataStore.getGuardianRelationships(tenantId);
    const updated = localRels.filter(
      (r) => !(r.studentId === studentId && r.guardianPersonId === guardianPersonId)
    );
    DataStore.saveGuardianRelationships(updated);
  },

  /**
   * Consulta a lista de alunos da academia informada (filtrada por tenant_id e RLS).
   * Retorna os registros normalizados para o modelo utilizado na interface do React.
   */
  async fetchStudentsWithDetails(tenantId: string): Promise<{
    students: Student[];
    persons: Person[];
    guardians: GuardianRelationship[];
  } | null> {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId)) {
      return null;
    }

    try {
      // 1. Buscar alunos com dados da pessoa vinculada e graduações
      const { data: studentsData, error: studentsError } = await supabase
        .from('students')
        .select(`
          id,
          tenant_id,
          branch_id,
          person_id,
          registration_number,
          enrollment_date,
          status,
          monthly_fee,
          notes,
          created_at,
          person:persons (
            id,
            tenant_id,
            full_name,
            social_name,
            cpf,
            birth_date,
            gender,
            phone,
            email,
            address,
            created_at
          )
        `)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (studentsError) {
        console.warn('Aviso ao carregar alunos do Supabase (RLS ou conexão):', studentsError.message);
        return null;
      }

      // 2. Buscar TODOS os registros de persons da academia ativa no Supabase (alunos e responsáveis)
      const { data: allPersonsData, error: personsError } = await supabase
        .from('persons')
        .select('*')
        .eq('tenant_id', tenantId);

      if (personsError) {
        console.warn('Aviso ao carregar pessoas do Supabase:', personsError.message);
      }

      // 3. Buscar vínculos de responsáveis na tabela guardian_relationships
      const { data: guardiansData, error: guardiansError } = await supabase
        .from('guardian_relationships')
        .select('*')
        .eq('tenant_id', tenantId);

      if (guardiansError) {
        console.warn('Aviso ao carregar responsáveis do Supabase:', guardiansError.message);
      }

      // 4. Buscar histórico de graduações
      const { data: graduationsData } = await supabase
        .from('student_graduations')
        .select(`
          id,
          tenant_id,
          student_id,
          martial_art_id,
          belt_rank_id,
          graduated_at,
          martial_art:martial_arts (id, name),
          belt_rank:belt_ranks (id, name, color_hex)
        `)
        .eq('tenant_id', tenantId);

      // Normalizar TODAS as pessoas da academia (alunos e responsáveis)
      const loadedPersons: Person[] = [];
      const personMap = new Map<string, Person>();

      (allPersonsData || []).forEach((p: any) => {
        const parsedPerson: Person = {
          id: p.id,
          tenantId: p.tenant_id,
          fullName: p.full_name,
          socialName: p.social_name || undefined,
          cpf: p.cpf || '',
          birthDate: p.birth_date,
          gender: (p.gender as any) || 'male',
          phone: p.phone || '',
          email: p.email || '',
          address: {
            street: p.address?.street || '',
            number: p.address?.number || '',
            neighborhood: p.address?.neighborhood || '',
            city: p.address?.city || '',
            state: p.address?.state || 'SP',
            zipCode: p.address?.zipCode || '',
          },
          createdAt: p.created_at || new Date().toISOString(),
        };
        personMap.set(p.id, parsedPerson);
        loadedPersons.push(parsedPerson);
      });

      const loadedStudents: Student[] = (studentsData || []).map((row: any) => {
        // Se a pessoa do aluno não estava na lista geral, incluir
        const p = row.person;
        if (p && !personMap.has(p.id)) {
          const parsedPerson: Person = {
            id: p.id,
            tenantId: p.tenant_id,
            fullName: p.full_name,
            socialName: p.social_name || undefined,
            cpf: p.cpf || '',
            birthDate: p.birth_date,
            gender: (p.gender as any) || 'male',
            phone: p.phone || '',
            email: p.email || '',
            address: {
              street: p.address?.street || '',
              number: p.address?.number || '',
              neighborhood: p.address?.neighborhood || '',
              city: p.address?.city || '',
              state: p.address?.state || 'SP',
              zipCode: p.address?.zipCode || '',
            },
            createdAt: p.created_at || new Date().toISOString(),
          };
          personMap.set(p.id, parsedPerson);
          loadedPersons.push(parsedPerson);
        }

        // Buscar graduações do aluno no Supabase ordenadas pela mais recente
        // Agrupar a graduação mais recente por modalidade (suporte a múltiplas artes marciais)
        const latestByArt = new Map<string, any>();
        (graduationsData || [])
          .filter((g: any) => g.student_id === row.id)
          .sort((a: any, b: any) => new Date(b.graduated_at || 0).getTime() - new Date(a.graduated_at || 0).getTime())
          .forEach((g: any) => {
            if (!latestByArt.has(g.martial_art_id)) {
              latestByArt.set(g.martial_art_id, {
                martialArtId: g.martial_art_id,
                martialArtName: g.martial_art?.name || 'Arte Marcial',
                beltId: g.belt_rank_id,
                beltName: g.belt_rank?.name || 'Faixa Cadastrada',
                beltColorHex: g.belt_rank?.color_hex || '#ffffff',
                graduatedAt: g.graduated_at || row.enrollment_date,
              });
            }
          });
        const studentGrads = Array.from(latestByArt.values());

        return {
          id: row.id,
          tenantId: row.tenant_id,
          branchId: row.branch_id,
          personId: row.person_id,
          registrationNumber: row.registration_number,
          enrollmentDate: row.enrollment_date,
          status: row.status,
          currentGraduations: studentGrads,
          monthlyFee: Number(row.monthly_fee) || 0,
          planId: row.plan_id || undefined,
          notes: row.notes || undefined,
        };
      });

      const loadedGuardians: GuardianRelationship[] = (guardiansData || []).map((row: any) => ({
        id: row.id,
        tenantId: row.tenant_id,
        studentId: row.student_id,
        guardianPersonId: row.guardian_person_id,
        relationshipLabel: row.relationship_label || 'Responsável',
        isLegalGuardian: Boolean(row.is_legal_guardian),
        isFinancialGuardian: Boolean(row.is_financial_guardian),
        isEmergencyContact: Boolean(row.is_emergency_contact),
        isPickupAuthorized: Boolean(row.is_pickup_authorized),
        notes: row.notes || undefined,
      }));

      return {
        students: loadedStudents,
        persons: loadedPersons,
        guardians: loadedGuardians,
      };
    } catch (err) {
      console.error('Erro na requisição ao Supabase ao listar alunos:', err);
      return null;
    }
  },

  /**
   * Persiste um novo aluno no Supabase.
   * Utiliza preferencialmente a função RPC atômica register_student_atomic.
   * Em caso de ausência do RPC, utiliza inserções sequenciais com salvaguarda de integridade.
   */
  async createStudent(payload: CreateStudentPayload): Promise<StudentServiceResult> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado');
    }

    if (!isValidUUID(payload.tenantId)) {
      throw new Error('ID da academia (tenant_id) deve ser um UUID válido no Supabase.');
    }

    // 1. Validação matemática rigorosa do CPF do Aluno e verificação de duplicidade por tenant
    const studentCpfClean = cleanCPF(payload.cpf);
    if (studentCpfClean) {
      const valStudent = validateCPF(studentCpfClean);
      if (!valStudent.isValid) {
        throw new Error(`CPF do aluno inválido: ${valStudent.error}`);
      }
      const dupl = await this.checkCpfDuplicity(payload.tenantId, studentCpfClean);
      if (dupl.isDuplicate) {
        if (dupl.isStudent) {
          throw new Error(`CPF em duplicidade: Este CPF já possui uma matrícula de aluno ativa nesta academia (${dupl.existingPerson?.fullName}).`);
        }
        // Se a pessoa já existe na academia (ex: é um responsável) e NÃO possui matrícula de aluno ainda,
        // permitimos reaproveitar esta mesma pessoa para a nova matrícula de aluno
        if (!payload.reusedPersonId && dupl.existingPerson) {
          payload.reusedPersonId = dupl.existingPerson.id;
        }
      }
    }

    // 2. Validação matemática do CPF do Responsável e reaproveitamento inteligente
    if (payload.hasGuardian && payload.guardianName?.trim()) {
      const guardianCpfClean = cleanCPF(payload.guardianCpf);
      if (guardianCpfClean) {
        const valGuardian = validateCPF(guardianCpfClean);
        if (!valGuardian.isValid) {
          throw new Error(`CPF do responsável inválido: ${valGuardian.error}`);
        }
        if (!payload.reusedGuardianPersonId) {
          const foundGuardian = await this.findPersonByCpf(payload.tenantId, guardianCpfClean);
          if (foundGuardian?.person) {
            payload.reusedGuardianPersonId = foundGuardian.person.id;
          }
        }
      }
    }

    const regNumber = `MAT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const studentAddress = {
      street: payload.address?.street?.trim() || '',
      number: payload.address?.number?.trim() || '',
      complement: payload.address?.complement?.trim() || undefined,
      neighborhood: payload.address?.neighborhood?.trim() || '',
      city: payload.address?.city?.trim() || payload.city?.trim() || '',
      state: (payload.address?.state?.trim() || 'SP').toUpperCase(),
      zipCode: payload.address?.zipCode?.trim() || '',
    };

    const personPayload = {
      full_name: payload.fullName.trim(),
      social_name: payload.socialName?.trim() || null,
      cpf: studentCpfClean || null,
      birth_date: payload.birthDate,
      gender: payload.gender || 'male',
      phone: payload.phone?.trim() || null,
      email: payload.email?.trim() || null,
      address: studentAddress,
    };

    const studentPayload = {
      registration_number: regNumber,
      enrollment_date: new Date().toISOString().split('T')[0],
      status: 'active',
      monthly_fee: payload.monthlyFee,
      plan_id: payload.planId && isValidUUID(payload.planId) ? payload.planId : null,
      notes: null,
      address: studentAddress,
    };

    const effectiveReusedGuardianId = payload.reusedGuardianPersonId || payload.guardianPersonId;
    let initialGuardianAddress: any = {};
    if (effectiveReusedGuardianId) {
      const existingG = await this.findPersonById(payload.tenantId, effectiveReusedGuardianId);
      if (existingG?.address) {
        initialGuardianAddress = existingG.address;
      }
    }
    const guardianPersonPayload = (payload.hasGuardian && payload.guardianName?.trim()) ? {
      id: effectiveReusedGuardianId || null,
      full_name: payload.guardianName.trim(),
      cpf: payload.guardianCpf?.trim() || null,
      birth_date: '1985-01-01',
      gender: 'other',
      phone: payload.guardianPhone?.trim() || payload.phone?.trim() || null,
      email: payload.guardianEmail?.trim() || 'responsavel@tatamehub.com.br',
      address: initialGuardianAddress,
    } : null;

    const guardianRelPayload = guardianPersonPayload ? {
      relationship_label: payload.relationshipType || 'Responsável',
      is_legal_guardian: true,
      is_financial_guardian: true,
      is_emergency_contact: true,
      is_pickup_authorized: true,
      notes: null,
    } : null;

    let graduationPayload: any = null;
    if (payload.martialArtId && payload.beltRankId) {
      if (!isValidUUID(payload.martialArtId) || !isValidUUID(payload.beltRankId)) {
        throw new Error('A modalidade ou faixa selecionada deve ser um UUID válido no Supabase.');
      }

      // Validar que a modalidade pertence à academia ativa e está ativa
      const { data: validArt, error: artErr } = await supabase
        .from('martial_arts')
        .select('id, name')
        .eq('id', payload.martialArtId)
        .eq('tenant_id', payload.tenantId)
        .eq('status', 'active')
        .maybeSingle();

      if (artErr || !validArt) {
        throw new Error('A modalidade selecionada não pertence à academia ativa ou não está ativa.');
      }

      // Validar que a faixa pertence à mesma academia e modalidade
      const { data: validBelt, error: beltErr } = await supabase
        .from('belt_ranks')
        .select('id, name, color_hex')
        .eq('id', payload.beltRankId)
        .eq('tenant_id', payload.tenantId)
        .eq('martial_art_id', payload.martialArtId)
        .maybeSingle();

      if (beltErr || !validBelt) {
        throw new Error('A graduação selecionada não pertence à modalidade ou à academia ativa.');
      }

      graduationPayload = {
        martial_art_id: payload.martialArtId,
        belt_rank_id: payload.beltRankId,
        graduated_at: new Date().toISOString().split('T')[0],
        examiner_name: 'Sensei Responsável',
        notes: 'Graduação inicial no ato da matrícula',
      };
    }

    // Tentar executar via RPC atômica register_student_atomic
    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('register_student_atomic', {
        p_tenant_id: payload.tenantId,
        p_branch_id: isValidUUID(payload.branchId) ? payload.branchId : null,
        p_person: personPayload,
        p_student: studentPayload,
        p_guardian_person: guardianPersonPayload,
        p_guardian_rel: guardianRelPayload,
        p_graduation: graduationPayload,
      });

      if (!rpcError && rpcResult?.success) {
        const studentId = rpcResult.student_id;
        const personId = rpcResult.person_id;
        const guardianPersonId = rpcResult.guardian_person_id;
        const guardianRelId = rpcResult.guardian_relationship_id;

        const newPerson: Person = {
          id: personId,
          tenantId: payload.tenantId,
          fullName: payload.fullName,
          socialName: payload.socialName,
          cpf: payload.cpf || '000.000.000-00',
          birthDate: payload.birthDate,
          gender: payload.gender,
          phone: payload.phone || '',
          email: payload.email || '',
          address: personPayload.address,
          createdAt: new Date().toISOString(),
        };

        const newStudent: Student = {
          id: studentId,
          tenantId: payload.tenantId,
          branchId: payload.branchId,
          personId: personId,
          registrationNumber: rpcResult.registration_number || regNumber,
          enrollmentDate: studentPayload.enrollment_date,
          status: 'active',
          currentGraduations: [
            {
              martialArtId: payload.selectedArt?.id || payload.martialArtId,
              martialArtName: payload.selectedArt?.name || 'Judô',
              beltId: payload.selectedBelt?.id || payload.beltRankId,
              beltName: payload.selectedBelt?.name || 'Faixa Branca',
              beltColorHex: payload.selectedBelt?.colorHex || '#ffffff',
              graduatedAt: studentPayload.enrollment_date,
            },
          ],
          monthlyFee: payload.monthlyFee,
          planId: payload.planId || undefined,
        };

        let createdGuardianPerson: Person | undefined = undefined;
        let createdRelationship: GuardianRelationship | undefined = undefined;

        if (guardianPersonPayload && guardianPersonId && guardianRelId) {
          createdGuardianPerson = {
            id: guardianPersonId,
            tenantId: payload.tenantId,
            fullName: guardianPersonPayload.full_name,
            cpf: guardianPersonPayload.cpf || '',
            birthDate: '1985-01-01',
            gender: 'other',
            phone: guardianPersonPayload.phone || '',
            email: guardianPersonPayload.email || '',
            address: initialGuardianAddress || {},
            createdAt: new Date().toISOString(),
          };

          createdRelationship = {
            id: guardianRelId,
            tenantId: payload.tenantId,
            studentId: studentId,
            guardianPersonId: guardianPersonId,
            relationshipLabel: payload.relationshipType || 'Responsável',
            isLegalGuardian: true,
            isFinancialGuardian: true,
            isEmergencyContact: true,
            isPickupAuthorized: true,
          };
        }

        return {
          student: newStudent,
          person: newPerson,
          guardianPerson: createdGuardianPerson,
          relationship: createdRelationship,
        };
      }
    } catch (err: any) {
      console.warn('RPC register_student_atomic indisponível ou falhou, tentando fallback direto:', err?.message);
    }

    // FALLBACK DIRETO VIA REST (Caso a migration 06 ainda não tenha sido executada no SQL Editor)
    // 1. Inserir Person
    const { data: personData, error: personErr } = await supabase
      .from('persons')
      .insert({
        tenant_id: payload.tenantId,
        full_name: payload.fullName.trim(),
        social_name: payload.socialName?.trim() || null,
        cpf: payload.cpf?.trim() || null,
        birth_date: payload.birthDate,
        gender: payload.gender || 'male',
        phone: payload.phone?.trim() || null,
        email: payload.email?.trim() || null,
        address: personPayload.address,
      })
      .select()
      .single();

    if (personErr || !personData) {
      throw new Error(`Erro ao salvar pessoa do aluno no Supabase: ${personErr?.message || 'Falha no retorno'}`);
    }

    const studentPersonId = personData.id;

    // 2. Inserir Student
    const { data: studentData, error: studentErr } = await supabase
      .from('students')
      .insert({
        tenant_id: payload.tenantId,
        branch_id: payload.branchId,
        person_id: studentPersonId,
        registration_number: regNumber,
        enrollment_date: studentPayload.enrollment_date,
        status: 'active',
        monthly_fee: payload.monthlyFee,
        plan_id: payload.planId && isValidUUID(payload.planId) ? payload.planId : null,
        address: studentAddress,
      })
      .select()
      .single();

    if (studentErr || !studentData) {
      // Rollback da pessoa criada
      await supabase.from('persons').delete().eq('id', studentPersonId);
      throw new Error(`Erro ao salvar matrícula do aluno no Supabase: ${studentErr?.message}`);
    }

    const createdStudentId = studentData.id;

    // 3. Inserir Responsável (se houver)
    let createdGuardianPerson: Person | undefined = undefined;
    let createdRelationship: GuardianRelationship | undefined = undefined;

    if (guardianPersonPayload) {
      try {
        let guardianPersonIdToLink: string | null = payload.reusedGuardianPersonId || payload.guardianPersonId || null;

        // Se NÃO temos o ID de um responsável existente, verificar se pessoa com esse CPF já existe no tenant
        if (!guardianPersonIdToLink && guardianPersonPayload.cpf) {
          const cleanGCpf = cleanCPF(guardianPersonPayload.cpf);
          const { data: existingPersonByCpf } = await supabase
            .from('persons')
            .select('*')
            .eq('tenant_id', payload.tenantId)
            .eq('cpf', cleanGCpf)
            .maybeSingle();

          if (existingPersonByCpf) {
            guardianPersonIdToLink = existingPersonByCpf.id;
            createdGuardianPerson = {
              id: existingPersonByCpf.id,
              tenantId: payload.tenantId,
              fullName: existingPersonByCpf.full_name,
              cpf: existingPersonByCpf.cpf || '',
              birthDate: existingPersonByCpf.birth_date,
              gender: existingPersonByCpf.gender,
              phone: existingPersonByCpf.phone || '',
              email: existingPersonByCpf.email || '',
              address: existingPersonByCpf.address || {},
              createdAt: existingPersonByCpf.created_at,
            };
          }
        }

        // Se ainda não temos a pessoa, inserir nova em persons com endereço próprio
        if (!guardianPersonIdToLink) {
          const { data: gpData, error: gpErr } = await supabase
            .from('persons')
            .insert({
              tenant_id: payload.tenantId,
              full_name: guardianPersonPayload.full_name,
              cpf: cleanCPF(guardianPersonPayload.cpf) || null,
              birth_date: guardianPersonPayload.birth_date,
              gender: guardianPersonPayload.gender,
              phone: guardianPersonPayload.phone,
              email: guardianPersonPayload.email,
              address: initialGuardianAddress || {},
            })
            .select()
            .single();

          if (gpErr) {
            console.error('Erro ao inserir novo responsável:', gpErr);
          } else if (gpData) {
            guardianPersonIdToLink = gpData.id;
            createdGuardianPerson = {
              id: gpData.id,
              tenantId: payload.tenantId,
              fullName: gpData.full_name,
              cpf: gpData.cpf || '',
              birthDate: gpData.birth_date,
              gender: gpData.gender,
              phone: gpData.phone || '',
              email: gpData.email || '',
              address: gpData.address || initialGuardianAddress || {},
              createdAt: gpData.created_at,
            };
          }
        } else if (!createdGuardianPerson) {
          // Atualiza dados da pessoa existente
          const { data: gpData } = await supabase
            .from('persons')
            .update({
              full_name: guardianPersonPayload.full_name,
              phone: guardianPersonPayload.phone,
              email: guardianPersonPayload.email,
              updated_at: new Date().toISOString(),
            })
            .eq('id', guardianPersonIdToLink)
            .select()
            .maybeSingle();

          if (gpData) {
            createdGuardianPerson = {
              id: gpData.id,
              tenantId: gpData.tenant_id,
              fullName: gpData.full_name,
              cpf: gpData.cpf || '',
              birthDate: gpData.birth_date,
              gender: gpData.gender,
              phone: gpData.phone || '',
              email: gpData.email || '',
              address: gpData.address || {},
              createdAt: gpData.created_at,
            };
          }
        }

        // Criar o vínculo em guardian_relationships
        if (guardianPersonIdToLink) {
          const { data: grData, error: grErr } = await supabase
            .from('guardian_relationships')
            .insert({
              tenant_id: payload.tenantId,
              student_id: createdStudentId,
              guardian_person_id: guardianPersonIdToLink,
              relationship_label: payload.relationshipType || 'Responsável',
              is_legal_guardian: true,
              is_financial_guardian: true,
              is_emergency_contact: true,
              is_pickup_authorized: true,
            })
            .select()
            .single();

          if (grErr) {
            console.error('Erro ao criar vínculo de responsável:', grErr);
          } else if (grData) {
            createdRelationship = {
              id: grData.id,
              tenantId: payload.tenantId,
              studentId: createdStudentId,
              guardianPersonId: guardianPersonIdToLink,
              relationshipLabel: grData.relationship_label,
              isLegalGuardian: grData.is_legal_guardian,
              isFinancialGuardian: grData.is_financial_guardian,
              isEmergencyContact: grData.is_emergency_contact,
              isPickupAuthorized: grData.is_pickup_authorized,
            };
          }
        }
      } catch (gErr) {
        console.error('Falha ao persistir responsável ou vínculo no fallback:', gErr);
      }
    }

    // 4. Inserir Graduação se os IDs forem UUIDs válidos
    if (isValidUUID(payload.martialArtId) && isValidUUID(payload.beltRankId)) {
      try {
        await supabase.from('student_graduations').insert({
          tenant_id: payload.tenantId,
          student_id: createdStudentId,
          martial_art_id: payload.martialArtId,
          belt_rank_id: payload.beltRankId,
          graduated_at: studentPayload.enrollment_date,
          examiner_name: 'Sensei Responsável',
        });
      } catch (gradErr) {
        console.warn('Aviso: Graduação inicial não pode ser inserida:', gradErr);
      }
    }

    const resultStudent: Student = {
      id: createdStudentId,
      tenantId: payload.tenantId,
      branchId: payload.branchId,
      personId: studentPersonId,
      registrationNumber: regNumber,
      enrollmentDate: studentPayload.enrollment_date,
      status: 'active',
      currentGraduations: [
        {
          martialArtId: payload.selectedArt?.id || payload.martialArtId,
          martialArtName: payload.selectedArt?.name || 'Judô',
          beltId: payload.selectedBelt?.id || payload.beltRankId,
          beltName: payload.selectedBelt?.name || 'Faixa Branca',
          beltColorHex: payload.selectedBelt?.colorHex || '#ffffff',
          graduatedAt: studentPayload.enrollment_date,
        },
      ],
      monthlyFee: payload.monthlyFee,
      planId: payload.planId || undefined,
      address: studentAddress,
    };

    const resultPerson: Person = {
      id: studentPersonId,
      tenantId: payload.tenantId,
      fullName: payload.fullName,
      socialName: payload.socialName,
      cpf: payload.cpf || '000.000.000-00',
      birthDate: payload.birthDate,
      gender: payload.gender,
      phone: payload.phone || '',
      email: payload.email || '',
      address: personPayload.address,
      createdAt: new Date().toISOString(),
    };

    return {
      student: resultStudent,
      person: resultPerson,
      guardianPerson: createdGuardianPerson,
      relationship: createdRelationship,
    };
  },

  /**
   * Atualiza dados de um aluno existente no Supabase.
   * Modifica `persons`, `students`, e `guardian_relationships` preservando integridade e RLS.
   */
  async updateStudent(payload: UpdateStudentPayload): Promise<StudentServiceResult> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado');
    }

    if (!isValidUUID(payload.tenantId)) {
      throw new Error('ID da academia (tenant_id) deve ser um UUID válido no Supabase.');
    }

    if (!isValidUUID(payload.studentId) || !isValidUUID(payload.personId)) {
      throw new Error('Identificadores de aluno ou pessoa física inválidos.');
    }

    // 0. Validações matemáticas de CPF e proteção contra duplicidade
    const studentCpfClean = cleanCPF(payload.cpf);
    if (studentCpfClean) {
      const valStudent = validateCPF(studentCpfClean);
      if (!valStudent.isValid) {
        throw new Error(`CPF do aluno inválido: ${valStudent.error}`);
      }
      const dupl = await this.checkCpfDuplicity(payload.tenantId, studentCpfClean, payload.personId);
      if (dupl.isDuplicate) {
        throw new Error(dupl.message);
      }
    }

    let effectiveGuardianPersonId = payload.guardianPersonId || payload.reusedGuardianPersonId;

    if (payload.hasGuardian && payload.guardianName?.trim()) {
      const guardianCpfClean = cleanCPF(payload.guardianCpf);
      if (guardianCpfClean) {
        const valGuardian = validateCPF(guardianCpfClean);
        if (!valGuardian.isValid) {
          throw new Error(`CPF do responsável inválido: ${valGuardian.error}`);
        }

        // Buscar se já existe uma pessoa com este CPF para reaproveitar
        const found = await this.findPersonByCpf(payload.tenantId, guardianCpfClean);
        if (found?.person) {
          effectiveGuardianPersonId = found.person.id;
        }
      }
    }

    const studentAddress = payload.address ? {
      street: payload.address.street?.trim() || '',
      number: payload.address.number?.trim() || '',
      complement: payload.address.complement?.trim() || undefined,
      neighborhood: payload.address.neighborhood?.trim() || '',
      city: payload.address.city?.trim() || payload.city?.trim() || '',
      state: (payload.address.state?.trim() || 'SP').toUpperCase(),
      zipCode: payload.address.zipCode?.trim() || '',
    } : (payload.city ? { city: payload.city.trim() } : undefined);

    let guardianInitialAddress: any = {};
    if (effectiveGuardianPersonId) {
      const foundG = await this.findPersonById(payload.tenantId, effectiveGuardianPersonId);
      if (foundG?.address) {
        guardianInitialAddress = foundG.address;
      }
    }

    // 0.1. Tentar executar via RPC atômica update_student_atomic (transação segura ACID)
    try {
      const guardianPersonPayload = (payload.hasGuardian && payload.guardianName?.trim()) ? {
        id: effectiveGuardianPersonId || null,
        full_name: payload.guardianName.trim(),
        cpf: payload.guardianCpf ? cleanCPF(payload.guardianCpf) || null : null,
        birth_date: '1985-01-01',
        gender: 'other',
        phone: payload.guardianPhone?.trim() || payload.phone?.trim() || null,
        email: payload.guardianEmail?.trim() || 'responsavel@tatamehub.com.br',
        address: guardianInitialAddress,
      } : null;

      const guardianRelPayload = guardianPersonPayload ? {
        relationship_label: payload.relationshipType || 'Responsável',
        is_legal_guardian: true,
        is_financial_guardian: true,
        is_emergency_contact: true,
        is_pickup_authorized: true,
      } : null;

      const graduationPayload = (isValidUUID(payload.martialArtId) && isValidUUID(payload.beltRankId)) ? {
        martial_art_id: payload.martialArtId,
        belt_rank_id: payload.beltRankId,
        graduated_at: new Date().toISOString().split('T')[0],
        examiner_name: 'Atualização administrativa',
        notes: 'Graduação atualizada no cadastro do aluno',
      } : null;

      const { data: rpcResult, error: rpcError } = await supabase.rpc('update_student_atomic', {
        p_tenant_id: payload.tenantId,
        p_student_id: payload.studentId,
        p_person_id: payload.personId,
        p_branch_id: isValidUUID(payload.branchId) ? payload.branchId : null,
        p_person: {
          full_name: payload.fullName.trim(),
          social_name: payload.socialName?.trim() || null,
          cpf: studentCpfClean || null,
          birth_date: payload.birthDate,
          gender: payload.gender || 'male',
          phone: payload.phone?.trim() || null,
          email: payload.email?.trim() || null,
          address: studentAddress,
        },
        p_student: {
          monthly_fee: payload.monthlyFee,
          plan_id: payload.planId || null,
          status: payload.status || 'active',
          notes: null,
          address: studentAddress,
        },
        p_guardian_person: guardianPersonPayload,
        p_guardian_rel: guardianRelPayload,
        p_remove_guardian: payload.hasGuardian === false,
        p_graduation: graduationPayload,
      });

      if (!rpcError && rpcResult?.success) {
        // Consultar graduações atualizadas do aluno
        let finalGrads: any[] = [];
        try {
          const { data: allStudentGrads } = await supabase
            .from('student_graduations')
            .select(`
              id,
              martial_art_id,
              belt_rank_id,
              graduated_at,
              martial_art:martial_arts (id, name),
              belt_rank:belt_ranks (id, name, color_hex)
            `)
            .eq('student_id', payload.studentId)
            .eq('tenant_id', payload.tenantId)
            .order('graduated_at', { ascending: false });

          const latestMap = new Map<string, any>();
          (allStudentGrads || []).forEach((g: any) => {
            if (!latestMap.has(g.martial_art_id)) {
              latestMap.set(g.martial_art_id, {
                martialArtId: g.martial_art_id,
                martialArtName: g.martial_art?.name || 'Arte Marcial',
                beltId: g.belt_rank_id,
                beltName: g.belt_rank?.name || 'Faixa',
                beltColorHex: g.belt_rank?.color_hex || '#ffffff',
                graduatedAt: g.graduated_at,
              });
            }
          });
          finalGrads = Array.from(latestMap.values());
        } catch {
          if (payload.selectedArt && payload.selectedBelt) {
            finalGrads = [{
              martialArtId: payload.selectedArt.id,
              martialArtName: payload.selectedArt.name,
              beltId: payload.selectedBelt.id,
              beltName: payload.selectedBelt.name,
              beltColorHex: payload.selectedBelt.colorHex || '#ffffff',
              graduatedAt: new Date().toISOString().split('T')[0],
            }];
          }
        }

        const rPerson = rpcResult.person || {};
        const rStudent = rpcResult.student || {};
        const rGuardianPerson = rpcResult.guardian_person;
        const rGuardianRel = rpcResult.guardian_relationship;

        return {
          student: {
            id: payload.studentId,
            tenantId: payload.tenantId,
            branchId: payload.branchId,
            personId: payload.personId,
            registrationNumber: rStudent.registration_number || 'MAT-ATUALIZADO',
            enrollmentDate: rStudent.enrollment_date || new Date().toISOString().split('T')[0],
            status: rStudent.status || payload.status || 'active',
            currentGraduations: finalGrads,
            monthlyFee: Number(rStudent.monthly_fee) || payload.monthlyFee,
            planId: rStudent.plan_id || payload.planId || undefined,
            notes: rStudent.notes || undefined,
            address: rStudent.address || studentAddress,
          },
          person: {
            id: payload.personId,
            tenantId: payload.tenantId,
            fullName: rPerson.full_name || payload.fullName.trim(),
            socialName: rPerson.social_name || payload.socialName?.trim() || undefined,
            cpf: rPerson.cpf || payload.cpf || '',
            birthDate: rPerson.birth_date || payload.birthDate,
            gender: rPerson.gender || payload.gender || 'male',
            phone: rPerson.phone || payload.phone || '',
            email: rPerson.email || payload.email || '',
            address: rPerson.address || studentAddress,
            createdAt: rPerson.created_at || new Date().toISOString(),
          },
          guardianPerson: rGuardianPerson ? {
            id: rGuardianPerson.id,
            tenantId: rGuardianPerson.tenant_id,
            fullName: rGuardianPerson.full_name,
            socialName: rGuardianPerson.social_name || undefined,
            cpf: rGuardianPerson.cpf || '',
            birthDate: rGuardianPerson.birth_date,
            gender: rGuardianPerson.gender || 'other',
            phone: rGuardianPerson.phone || '',
            email: rGuardianPerson.email || '',
            address: rGuardianPerson.address || guardianInitialAddress || {},
            createdAt: rGuardianPerson.created_at,
          } : undefined,
          relationship: rGuardianRel ? {
            id: rGuardianRel.id,
            tenantId: rGuardianRel.tenant_id,
            studentId: payload.studentId,
            guardianPersonId: rGuardianRel.guardian_person_id,
            relationshipLabel: rGuardianRel.relationship_label,
            isLegalGuardian: rGuardianRel.is_legal_guardian,
            isFinancialGuardian: rGuardianRel.is_financial_guardian,
            isEmergencyContact: rGuardianRel.is_emergency_contact,
            isPickupAuthorized: rGuardianRel.is_pickup_authorized,
          } : undefined,
        };
      }
    } catch (rpcEx) {
      console.warn('Aviso: RPC update_student_atomic indisponível, executando atualização direta:', rpcEx);
    }

    // 1. Atualizar registro na tabela persons com tratamento para 'permission denied for table users'
    const personUpdatePayload = {
      full_name: payload.fullName.trim(),
      social_name: payload.socialName?.trim() || null,
      cpf: studentCpfClean || null,
      birth_date: payload.birthDate,
      gender: payload.gender || 'male',
      phone: payload.phone?.trim() || null,
      email: payload.email?.trim() || null,
      address: studentAddress,
      updated_at: new Date().toISOString(),
    };

    let updatedPerson: any = null;
    const { data: pSelectData, error: personError } = await supabase
      .from('persons')
      .update(personUpdatePayload)
      .eq('id', payload.personId)
      .eq('tenant_id', payload.tenantId)
      .select()
      .maybeSingle();

    if (personError) {
      // Se o erro for 'permission denied for table users', decorre da política persons_select avaliando
      // subconsulta de auth.users no RETURNING clause. Tentamos o update direto sem select.
      if (personError.message?.toLowerCase().includes('table users')) {
        const { error: rawUpdateError } = await supabase
          .from('persons')
          .update(personUpdatePayload)
          .eq('id', payload.personId)
          .eq('tenant_id', payload.tenantId);

        if (rawUpdateError) {
          throw new Error(`Erro ao atualizar dados pessoais do aluno: ${rawUpdateError.message}`);
        }

        updatedPerson = {
          id: payload.personId,
          tenant_id: payload.tenantId,
          ...personUpdatePayload,
          created_at: new Date().toISOString(),
        };
      } else {
        throw new Error(`Erro ao atualizar dados pessoais do aluno: ${personError.message}`);
      }
    } else {
      updatedPerson = pSelectData || {
        id: payload.personId,
        tenant_id: payload.tenantId,
        ...personUpdatePayload,
        created_at: new Date().toISOString(),
      };
    }

    // 2. Atualizar registro na tabela students
    const studentUpdatePayload: any = {
      monthly_fee: payload.monthlyFee,
      status: payload.status || 'active',
      branch_id: payload.branchId,
      address: studentAddress,
      updated_at: new Date().toISOString(),
    };
    if (payload.planId !== undefined) {
      studentUpdatePayload.plan_id = payload.planId && isValidUUID(payload.planId) ? payload.planId : null;
    }

    let updatedStudentData: any = null;
    const { data: sSelectData, error: studentError } = await supabase
      .from('students')
      .update(studentUpdatePayload)
      .eq('id', payload.studentId)
      .eq('tenant_id', payload.tenantId)
      .select()
      .maybeSingle();

    if (studentError) {
      if (studentError.message?.toLowerCase().includes('table users')) {
        const { error: rawStudentError } = await supabase
          .from('students')
          .update(studentUpdatePayload)
          .eq('id', payload.studentId)
          .eq('tenant_id', payload.tenantId);

        if (rawStudentError) {
          throw new Error(`Erro ao atualizar matrícula do aluno: ${rawStudentError.message}`);
        }

        updatedStudentData = {
          id: payload.studentId,
          tenant_id: payload.tenantId,
          ...studentUpdatePayload,
          registration_number: 'MAT-ATUALIZADO',
          enrollment_date: new Date().toISOString().split('T')[0],
        };
      } else {
        throw new Error(`Erro ao atualizar matrícula do aluno: ${studentError.message}`);
      }
    } else {
      updatedStudentData = sSelectData || {
        id: payload.studentId,
        tenant_id: payload.tenantId,
        ...studentUpdatePayload,
        registration_number: 'MAT-ATUALIZADO',
        enrollment_date: new Date().toISOString().split('T')[0],
      };
    }

    // 3. Atualizar, Vincular ou Desvincular Responsável Legal / Financeiro
    let resultGuardianPerson: Person | undefined = undefined;
    let resultRelationship: GuardianRelationship | undefined = undefined;

    if (payload.hasGuardian === false) {
      // Usuário optou explicitamente por desvincular o responsável deste aluno
      const { error: unlinkError } = await supabase
        .from('guardian_relationships')
        .delete()
        .eq('student_id', payload.studentId)
        .eq('tenant_id', payload.tenantId);

      if (unlinkError) {
        console.warn('Aviso ao desvincular responsável no Supabase:', unlinkError.message);
      }
    } else if (payload.hasGuardian) {
      let guardianPersonIdToLink = effectiveGuardianPersonId;
      const cleanGCpf = payload.guardianCpf ? cleanCPF(payload.guardianCpf) : '';

      // Se não temos ID prévio de pessoa, verificar se já existe pessoa com esse CPF no tenant
      if (!guardianPersonIdToLink && cleanGCpf) {
        const { data: existingPersonByCpf } = await supabase
          .from('persons')
          .select('*')
          .eq('tenant_id', payload.tenantId)
          .eq('cpf', cleanGCpf)
          .maybeSingle();

        if (existingPersonByCpf) {
          guardianPersonIdToLink = existingPersonByCpf.id;
          resultGuardianPerson = {
            id: existingPersonByCpf.id,
            tenantId: payload.tenantId,
            fullName: existingPersonByCpf.full_name,
            socialName: existingPersonByCpf.social_name || undefined,
            cpf: existingPersonByCpf.cpf || '',
            birthDate: existingPersonByCpf.birth_date,
            gender: existingPersonByCpf.gender || 'other',
            phone: existingPersonByCpf.phone || '',
            email: existingPersonByCpf.email || '',
            address: existingPersonByCpf.address || {},
            createdAt: existingPersonByCpf.created_at,
          };
        }
      }

      if (guardianPersonIdToLink && isValidUUID(guardianPersonIdToLink)) {
        // Atualizar dados cadastrais do responsável existente se foram fornecidos
        if (payload.guardianName?.trim()) {
          const { data: gpData } = await supabase
            .from('persons')
            .update({
              full_name: payload.guardianName.trim(),
              cpf: cleanGCpf || null,
              phone: payload.guardianPhone?.trim() || null,
              email: payload.guardianEmail?.trim() || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', guardianPersonIdToLink)
            .eq('tenant_id', payload.tenantId)
            .select()
            .maybeSingle();

          if (gpData) {
            resultGuardianPerson = {
              id: gpData.id,
              tenantId: gpData.tenant_id,
              fullName: gpData.full_name,
              socialName: gpData.social_name || undefined,
              cpf: gpData.cpf || '',
              birthDate: gpData.birth_date,
              gender: gpData.gender || 'other',
              phone: gpData.phone || '',
              email: gpData.email || '',
              address: gpData.address || {},
              createdAt: gpData.created_at,
            };
          }
        } else if (!resultGuardianPerson) {
          const { data: gpData } = await supabase
            .from('persons')
            .select('*')
            .eq('id', guardianPersonIdToLink)
            .eq('tenant_id', payload.tenantId)
            .maybeSingle();

          if (gpData) {
            resultGuardianPerson = {
              id: gpData.id,
              tenantId: gpData.tenant_id,
              fullName: gpData.full_name,
              socialName: gpData.social_name || undefined,
              cpf: gpData.cpf || '',
              birthDate: gpData.birth_date,
              gender: gpData.gender || 'other',
              phone: gpData.phone || '',
              email: gpData.email || '',
              address: gpData.address || {},
              createdAt: gpData.created_at,
            };
          }
        }

        // Buscar vínculos existentes deste aluno no Supabase de forma segura
        const { data: existingRels } = await supabase
          .from('guardian_relationships')
          .select('*')
          .eq('student_id', payload.studentId)
          .eq('tenant_id', payload.tenantId);

        if (existingRels && existingRels.length > 0) {
          const targetRel = existingRels.find((r) => r.id === payload.guardianRelId) || existingRels[0];
          const { data: updatedGr } = await supabase
            .from('guardian_relationships')
            .update({
              guardian_person_id: guardianPersonIdToLink,
              relationship_label: payload.relationshipType || 'Responsável',
              is_legal_guardian: true,
              is_financial_guardian: true,
              is_emergency_contact: true,
              is_pickup_authorized: true,
            })
            .eq('id', targetRel.id)
            .select()
            .maybeSingle();

          if (updatedGr) {
            resultRelationship = {
              id: updatedGr.id,
              tenantId: updatedGr.tenant_id,
              studentId: payload.studentId,
              guardianPersonId: guardianPersonIdToLink,
              relationshipLabel: updatedGr.relationship_label,
              isLegalGuardian: updatedGr.is_legal_guardian,
              isFinancialGuardian: updatedGr.is_financial_guardian,
              isEmergencyContact: updatedGr.is_emergency_contact,
              isPickupAuthorized: updatedGr.is_pickup_authorized,
            };
          }
        } else {
          const { data: newGr } = await supabase
            .from('guardian_relationships')
            .insert({
              tenant_id: payload.tenantId,
              student_id: payload.studentId,
              guardian_person_id: guardianPersonIdToLink,
              relationship_label: payload.relationshipType || 'Responsável',
              is_legal_guardian: true,
              is_financial_guardian: true,
              is_emergency_contact: true,
              is_pickup_authorized: true,
            })
            .select()
            .single();

          if (newGr) {
            resultRelationship = {
              id: newGr.id,
              tenantId: newGr.tenant_id,
              studentId: payload.studentId,
              guardianPersonId: guardianPersonIdToLink,
              relationshipLabel: newGr.relationship_label,
              isLegalGuardian: newGr.is_legal_guardian,
              isFinancialGuardian: newGr.is_financial_guardian,
              isEmergencyContact: newGr.is_emergency_contact,
              isPickupAuthorized: newGr.is_pickup_authorized,
            };
          }
        }
      } else if (payload.guardianName?.trim()) {
        // Inserir novo responsável para este aluno caso realmente não exista no sistema
        const { data: newGp } = await supabase
          .from('persons')
          .insert({
            tenant_id: payload.tenantId,
            full_name: payload.guardianName.trim(),
            cpf: cleanGCpf || null,
            birth_date: '1985-01-01',
            gender: 'other',
            phone: payload.guardianPhone?.trim() || null,
            email: payload.guardianEmail?.trim() || 'responsavel@tatamehub.com.br',
            address: personAddress,
          })
          .select()
          .single();

        if (newGp) {
          resultGuardianPerson = {
            id: newGp.id,
            tenantId: newGp.tenant_id,
            fullName: newGp.full_name,
            socialName: newGp.social_name || undefined,
            cpf: newGp.cpf || '',
            birthDate: newGp.birth_date,
            gender: newGp.gender || 'other',
            phone: newGp.phone || '',
            email: newGp.email || '',
            address: newGp.address || {},
            createdAt: newGp.created_at,
          };

          const { data: existingRels } = await supabase
            .from('guardian_relationships')
            .select('*')
            .eq('student_id', payload.studentId)
            .eq('tenant_id', payload.tenantId);

          if (existingRels && existingRels.length > 0) {
            const targetRel = existingRels[0];
            const { data: updatedGr } = await supabase
              .from('guardian_relationships')
              .update({
                guardian_person_id: newGp.id,
                relationship_label: payload.relationshipType || 'Responsável',
              })
              .eq('id', targetRel.id)
              .select()
              .maybeSingle();

            if (updatedGr) {
              resultRelationship = {
                id: updatedGr.id,
                tenantId: updatedGr.tenant_id,
                studentId: payload.studentId,
                guardianPersonId: newGp.id,
                relationshipLabel: updatedGr.relationship_label,
                isLegalGuardian: updatedGr.is_legal_guardian,
                isFinancialGuardian: updatedGr.is_financial_guardian,
                isEmergencyContact: updatedGr.is_emergency_contact,
                isPickupAuthorized: updatedGr.is_pickup_authorized,
              };
            }
          } else {
            const { data: newGr } = await supabase
              .from('guardian_relationships')
              .insert({
                tenant_id: payload.tenantId,
                student_id: payload.studentId,
                guardian_person_id: newGp.id,
                relationship_label: payload.relationshipType || 'Responsável',
                is_legal_guardian: true,
                is_financial_guardian: true,
                is_emergency_contact: true,
                is_pickup_authorized: true,
              })
              .select()
              .single();

            if (newGr) {
              resultRelationship = {
                id: newGr.id,
                tenantId: newGr.tenant_id,
                studentId: payload.studentId,
                guardianPersonId: newGp.id,
                relationshipLabel: newGr.relationship_label,
                isLegalGuardian: newGr.is_legal_guardian,
                isFinancialGuardian: newGr.is_financial_guardian,
                isEmergencyContact: newGr.is_emergency_contact,
                isPickupAuthorized: newGr.is_pickup_authorized,
              };
            }
          }
        }
      }
    }

    // 4. Persistir a graduação do aluno no Supabase se IDs válidos forem fornecidos
    let validArt: any = null;
    let validBelt: any = null;

    if (
      isValidUUID(payload.martialArtId) &&
      isValidUUID(payload.beltRankId)
    ) {
      try {
        const { data: artData } = await supabase
          .from('martial_arts')
          .select('id, tenant_id, name, status')
          .eq('id', payload.martialArtId)
          .eq('tenant_id', payload.tenantId)
          .maybeSingle();
        validArt = artData;

        const { data: beltData } = await supabase
          .from('belt_ranks')
          .select('id, tenant_id, martial_art_id, name, color_hex')
          .eq('id', payload.beltRankId)
          .eq('tenant_id', payload.tenantId)
          .eq('martial_art_id', payload.martialArtId)
          .maybeSingle();
        validBelt = beltData;
      } catch (errGrad) {
        console.warn('Aviso ao consultar modalidade/graduação:', errGrad);
      }
    }

    let finalCurrentGraduations: any[] = [];

    if (validArt && validBelt) {
      // 4.3. Consultar a graduação mais recente do aluno especificamente para a modalidade selecionada
      const { data: existingGrads } = await supabase
        .from('student_graduations')
        .select('id, martial_art_id, belt_rank_id, graduated_at')
        .eq('student_id', payload.studentId)
        .eq('tenant_id', payload.tenantId)
        .eq('martial_art_id', payload.martialArtId)
        .order('graduated_at', { ascending: false })
        .limit(1);

      const currentGradForModality = existingGrads?.[0];
      const graduationChanged =
        !currentGradForModality ||
        currentGradForModality.belt_rank_id !== payload.beltRankId;

      if (graduationChanged) {
        let rpcSucceeded = false;
        try {
          const { data: rpcData, error: rpcError } = await supabase.rpc('record_student_graduation', {
            p_tenant_id: payload.tenantId,
            p_student_id: payload.studentId,
            p_martial_art_id: payload.martialArtId,
            p_belt_rank_id: payload.beltRankId,
            p_examiner_name: 'Atualização administrativa',
            p_notes: 'Graduação atualizada no cadastro do aluno',
          });

          if (!rpcError && rpcData?.id) {
            rpcSucceeded = true;
          }
        } catch (rpcErr) {
          // fallback direto
        }

        if (!rpcSucceeded) {
          try {
            await supabase
              .from('student_graduations')
              .insert({
                tenant_id: payload.tenantId,
                student_id: payload.studentId,
                martial_art_id: payload.martialArtId,
                belt_rank_id: payload.beltRankId,
                graduated_at: new Date().toISOString().split('T')[0],
                examiner_name: 'Atualização administrativa',
                notes: 'Graduação atualizada no cadastro do aluno',
              });
          } catch (insErr) {
            console.warn('Aviso ao registrar graduação no Supabase:', insErr);
          }
        }
      }

      // 4.4. Consultar todas as graduações vigentes do aluno
      const { data: allStudentGrads } = await supabase
        .from('student_graduations')
        .select(`
          id,
          martial_art_id,
          belt_rank_id,
          graduated_at,
          martial_art:martial_arts (id, name),
          belt_rank:belt_ranks (id, name, color_hex)
        `)
        .eq('student_id', payload.studentId)
        .eq('tenant_id', payload.tenantId)
        .order('graduated_at', { ascending: false });

      const latestByArtMap = new Map<string, any>();
      latestByArtMap.set(payload.martialArtId, {
        martialArtId: payload.martialArtId,
        martialArtName: validArt.name,
        beltId: payload.beltRankId,
        beltName: validBelt.name,
        beltColorHex: validBelt.color_hex || '#ffffff',
        graduatedAt: new Date().toISOString().split('T')[0],
      });

      (allStudentGrads || []).forEach((g: any) => {
        if (!latestByArtMap.has(g.martial_art_id)) {
          latestByArtMap.set(g.martial_art_id, {
            martialArtId: g.martial_art_id,
            martialArtName: g.martial_art?.name || 'Arte Marcial',
            beltId: g.belt_rank_id,
            beltName: g.belt_rank?.name || 'Faixa',
            beltColorHex: g.belt_rank?.color_hex || '#ffffff',
            graduatedAt: g.graduated_at || new Date().toISOString().split('T')[0],
          });
        }
      });

      finalCurrentGraduations = Array.from(latestByArtMap.values());
    } else if (payload.selectedArt && payload.selectedBelt) {
      finalCurrentGraduations = [
        {
          martialArtId: payload.selectedArt.id,
          martialArtName: payload.selectedArt.name,
          beltId: payload.selectedBelt.id,
          beltName: payload.selectedBelt.name,
          beltColorHex: payload.selectedBelt.colorHex || '#ffffff',
          graduatedAt: new Date().toISOString().split('T')[0],
        },
      ];
    }

    // 5. Registrar log de auditoria
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const currentSession = sessionData?.session;
      const currentUserId = currentSession?.user?.id;
      if (currentUserId) {
        await supabase.from('audit_logs').insert({
          tenant_id: payload.tenantId,
          user_id: currentUserId,
          user_name: currentSession.user.user_metadata?.full_name || 'Usuário',
          action: 'Atualização de Aluno',
          entity: 'Student',
          entity_id: payload.studentId,
          details: `Cadastro do aluno "${payload.fullName}" atualizado com sucesso.`,
        });
      }
    } catch (auditErr) {
      console.warn('Aviso: falha ao registrar audit log da edição:', auditErr);
    }

    const finalPerson: Person = {
      id: payload.personId,
      tenantId: payload.tenantId,
      fullName: payload.fullName.trim(),
      socialName: payload.socialName?.trim() || undefined,
      cpf: payload.cpf || '',
      birthDate: payload.birthDate,
      gender: payload.gender,
      phone: payload.phone || '',
      email: payload.email || '',
      address: updatedPerson.address || personAddress,
      createdAt: updatedPerson.created_at,
    };

    const finalStudent: Student = {
      id: payload.studentId,
      tenantId: payload.tenantId,
      branchId: payload.branchId,
      personId: payload.personId,
      registrationNumber: updatedStudentData.registration_number,
      enrollmentDate: updatedStudentData.enrollment_date,
      status: updatedStudentData.status,
      currentGraduations: finalCurrentGraduations,
      monthlyFee: Number(updatedStudentData.monthly_fee) || payload.monthlyFee,
      planId: updatedStudentData?.plan_id || payload.planId || undefined,
      notes: updatedStudentData.notes || undefined,
    };

    return {
      student: finalStudent,
      person: finalPerson,
      guardianPerson: resultGuardianPerson,
      relationship: resultRelationship,
    };
  },

  /**
   * Atualiza dados de identificação e contato de uma pessoa física no Supabase (aluno ou responsável).
   */
  async updatePerson(
    tenantId: string,
    personId: string,
    data: {
      fullName: string;
      cpf?: string;
      socialName?: string;
      phone?: string;
      email?: string;
      birthDate?: string;
      gender?: 'male' | 'female' | 'other';
      address?: any;
    }
  ): Promise<Person> {
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Supabase não configurado');
    }
    if (!isValidUUID(tenantId) || !isValidUUID(personId)) {
      throw new Error('Identificadores de academia ou pessoa física inválidos.');
    }

    const clean = cleanCPF(data.cpf);
    if (clean) {
      const val = validateCPF(clean);
      if (!val.isValid) {
        throw new Error(`CPF inválido: ${val.error}`);
      }
      const dupl = await this.checkCpfDuplicity(tenantId, clean, personId);
      if (dupl.isDuplicate) {
        throw new Error(dupl.message);
      }
    }

    const updatePayload: any = {
      full_name: data.fullName.trim(),
      cpf: clean || null,
      social_name: data.socialName?.trim() || null,
      phone: data.phone?.trim() || null,
      email: data.email?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (data.birthDate) updatePayload.birth_date = data.birthDate;
    if (data.gender) updatePayload.gender = data.gender;
    if (data.address) updatePayload.address = data.address;

    let updated: any = null;
    const { data: selectUpdated, error } = await supabase
      .from('persons')
      .update(updatePayload)
      .eq('id', personId)
      .eq('tenant_id', tenantId)
      .select()
      .maybeSingle();

    if (error) {
      if (error.message?.toLowerCase().includes('table users')) {
        const { error: rawError } = await supabase
          .from('persons')
          .update(updatePayload)
          .eq('id', personId)
          .eq('tenant_id', tenantId);

        if (rawError) {
          throw new Error(`Erro ao atualizar dados pessoais no Supabase: ${rawError.message}`);
        }

        updated = {
          id: personId,
          tenant_id: tenantId,
          ...updatePayload,
          created_at: new Date().toISOString(),
        };
      } else {
        throw new Error(`Erro ao atualizar dados pessoais no Supabase: ${error.message}`);
      }
    } else {
      updated = selectUpdated || {
        id: personId,
        tenant_id: tenantId,
        ...updatePayload,
        created_at: new Date().toISOString(),
      };
    }

    return {
      id: updated.id,
      tenantId: updated.tenant_id,
      fullName: updated.full_name,
      socialName: updated.social_name || undefined,
      cpf: updated.cpf || '',
      birthDate: updated.birth_date,
      gender: updated.gender || 'other',
      phone: updated.phone || '',
      email: updated.email || '',
      address: updated.address || {},
      createdAt: updated.created_at,
    };
  },

  /**
   * Limpa todos os dados de alunos, responsáveis e vínculos salvos no Supabase e DataStore,
   * e reinicia o Dojo do zero com registros limpos, válidos e estruturados.
   */
  async resetAcademyData(tenantId: string): Promise<{ success: boolean; message: string }> {
    // 1. Reset no Supabase se configurado
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      try {
        // Remover vínculos e dados de alunos e responsáveis do tenant
        await supabase.from('guardian_relationships').delete().eq('tenant_id', tenantId);
        await supabase.from('student_graduations').delete().eq('tenant_id', tenantId);
        await supabase.from('students').delete().eq('tenant_id', tenantId);
        await supabase.from('persons').delete().eq('tenant_id', tenantId);

        // Buscar uma filial ativa do tenant
        const { data: branchData } = await supabase
          .from('branches')
          .select('id')
          .eq('tenant_id', tenantId)
          .limit(1)
          .maybeSingle();

        const branchId = branchData?.id || null;

        // Inserir Responsável 1: Marcos (Pai) com CPF matematicamente válido
        const { data: pMarcos } = await supabase
          .from('persons')
          .insert({
            tenant_id: tenantId,
            full_name: 'Marcos Antônio Silva',
            cpf: '03792093812',
            birth_date: '1984-06-15',
            gender: 'male',
            phone: '(11) 98666-7788',
            email: 'marcos.pai@email.com',
            address: { street: 'Alameda das Acácias', number: '120', neighborhood: 'Jardins', city: 'São Paulo', state: 'SP', zipCode: '01420-000' },
          })
          .select()
          .single();

        // Inserir Responsável 2: Camila (Mãe) com CPF matematicamente válido
        const { data: pCamila } = await supabase
          .from('persons')
          .insert({
            tenant_id: tenantId,
            full_name: 'Camila Oliveira Silva',
            cpf: '45737048098',
            birth_date: '1986-09-22',
            gender: 'female',
            phone: '(11) 97111-2233',
            email: 'camila.mae@email.com',
            address: { street: 'Alameda das Acácias', number: '120', neighborhood: 'Jardins', city: 'São Paulo', state: 'SP', zipCode: '01420-000' },
          })
          .select()
          .single();

        // Inserir Aluno 1: Lucas (Menor) com CPF matematicamente válido
        const { data: pLucas } = await supabase
          .from('persons')
          .insert({
            tenant_id: tenantId,
            full_name: 'Lucas Oliveira Silva',
            cpf: '19385292510',
            birth_date: '2015-04-12',
            gender: 'male',
            phone: '(11) 98555-6677',
            email: 'lucas.aluno@email.com',
            address: { street: 'Alameda das Acácias', number: '120', neighborhood: 'Jardins', city: 'São Paulo', state: 'SP', zipCode: '01420-000' },
          })
          .select()
          .single();

        if (pLucas) {
          const { data: stLucas } = await supabase
            .from('students')
            .insert({
              tenant_id: tenantId,
              branch_id: branchId,
              person_id: pLucas.id,
              registration_number: 'MAT-2025-001',
              enrollment_date: '2025-01-15',
              status: 'active',
              monthly_fee: 250,
            })
            .select()
            .single();

          if (stLucas && pMarcos) {
            await supabase.from('guardian_relationships').insert({
              tenant_id: tenantId,
              student_id: stLucas.id,
              guardian_person_id: pMarcos.id,
              relationship_label: 'Pai',
              is_legal_guardian: true,
              is_financial_guardian: true,
              is_emergency_contact: true,
              is_pickup_authorized: true,
              notes: 'Responsável legal e financeiro principal.',
            });
          }

          if (stLucas && pCamila) {
            await supabase.from('guardian_relationships').insert({
              tenant_id: tenantId,
              student_id: stLucas.id,
              guardian_person_id: pCamila.id,
              relationship_label: 'Mãe',
              is_legal_guardian: true,
              is_financial_guardian: false,
              is_emergency_contact: true,
              is_pickup_authorized: true,
              notes: 'Contato de emergência e autorizada para retirada.',
            });
          }
        }

        // Inserir Aluna 2: Sofia (Menor, irmã de Lucas - REUSANDO o pai Marcos)
        const { data: pSofia } = await supabase
          .from('persons')
          .insert({
            tenant_id: tenantId,
            full_name: 'Sofia Oliveira Silva',
            cpf: '23662117592',
            birth_date: '2018-08-20',
            gender: 'female',
            phone: '(11) 98555-6677',
            email: 'sofia.aluna@email.com',
            address: { street: 'Alameda das Acácias', number: '120', neighborhood: 'Jardins', city: 'São Paulo', state: 'SP', zipCode: '01420-000' },
          })
          .select()
          .single();

        if (pSofia && pMarcos) {
          const { data: stSofia } = await supabase
            .from('students')
            .insert({
              tenant_id: tenantId,
              branch_id: branchId,
              person_id: pSofia.id,
              registration_number: 'MAT-2025-002',
              enrollment_date: '2025-02-10',
              status: 'active',
              monthly_fee: 220,
            })
            .select()
            .single();

          if (stSofia) {
            await supabase.from('guardian_relationships').insert({
              tenant_id: tenantId,
              student_id: stSofia.id,
              guardian_person_id: pMarcos.id,
              relationship_label: 'Pai',
              is_legal_guardian: true,
              is_financial_guardian: true,
              is_emergency_contact: true,
              is_pickup_authorized: true,
              notes: 'Concentra o pagamento familiar de mensalidades dos dois filhos.',
            });
          }
        }

        // Inserir Aluna 3: Beatriz (Adulta, sem responsável)
        const { data: pBeatriz } = await supabase
          .from('persons')
          .insert({
            tenant_id: tenantId,
            full_name: 'Beatriz Ferreira',
            cpf: '17782403995',
            birth_date: '2003-11-05',
            gender: 'female',
            phone: '(11) 99444-5566',
            email: 'beatriz.ferreira@email.com',
            address: { street: 'Av. Rebouças', number: '2100', neighborhood: 'Cerqueira César', city: 'São Paulo', state: 'SP', zipCode: '05402-000' },
          })
          .select()
          .single();

        if (pBeatriz) {
          await supabase.from('students').insert({
            tenant_id: tenantId,
            branch_id: branchId,
            person_id: pBeatriz.id,
            registration_number: 'MAT-2025-003',
            enrollment_date: '2025-03-01',
            status: 'active',
            monthly_fee: 260,
          });
        }
      } catch (err: any) {
        console.error('Erro ao reiniciar dados no Supabase:', err);
      }
    }

    // 2. Reset no DataStore (LocalStorage)
    DataStore.savePersons(INITIAL_PERSONS);
    DataStore.saveStudents(INITIAL_STUDENTS);
    DataStore.saveGuardianRelationships(INITIAL_GUARDIAN_RELATIONSHIPS);

    return {
      success: true,
      message: 'Base de alunos, responsáveis e vínculos reiniciada com sucesso a partir do zero.',
    };
  },
};
