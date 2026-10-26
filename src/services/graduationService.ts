import { supabase, isSupabaseConfigured } from './supabase';
import {
  StudentGraduation,
  RecordGraduationPayload,
  UpdateGraduationPayload,
  MartialArt,
  BeltRank,
  Student,
} from '../types';
import { DataStore } from '../data/storage';
import { isValidUUID } from './studentService';

export interface MartialArtGraduationGroup {
  martialArtId: string;
  martialArtName: string;
  graduations: StudentGraduation[];
  currentGraduation: StudentGraduation | null;
  previousGraduations: StudentGraduation[];
  hasInconsistency: boolean;
  inconsistencyMessage?: string;
  totalCount: number;
}

export const graduationService = {
  /**
   * Consulta o histórico completo de graduações de um aluno no Supabase.
   * Se o Supabase estiver indisponível ou não configurado, recorre ao DataStore local.
   */
  async fetchStudentGraduations(
    tenantId: string,
    studentId: string
  ): Promise<StudentGraduation[]> {
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId) && isValidUUID(studentId)) {
      try {
        const { data, error } = await supabase
          .from('student_graduations')
          .select(`
            id,
            tenant_id,
            student_id,
            martial_art_id,
            belt_rank_id,
            graduated_at,
            examiner_name,
            certificate_code,
            notes,
            created_at,
            updated_at,
            martial_art:martial_arts (id, name),
            belt_rank:belt_ranks (id, name, color_hex, order_index)
          `)
          .eq('tenant_id', tenantId)
          .eq('student_id', studentId)
          .order('graduated_at', { ascending: false })
          .order('created_at', { ascending: false });

        if (!error && data) {
          const mapped: StudentGraduation[] = data.map((row: any) => {
            const art = Array.isArray(row.martial_art) ? row.martial_art[0] : row.martial_art;
            const belt = Array.isArray(row.belt_rank) ? row.belt_rank[0] : row.belt_rank;

            return {
              id: row.id,
              tenantId: row.tenant_id,
              studentId: row.student_id,
              martialArtId: row.martial_art_id,
              martialArtName: art?.name || 'Arte Marcial',
              beltRankId: row.belt_rank_id,
              beltRankName: belt?.name || 'Graduação',
              beltColorHex: belt?.color_hex || '#ffffff',
              graduatedAt: row.graduated_at,
              examinerName: row.examiner_name || 'Sensei Responsável',
              certificateCode: row.certificate_code || undefined,
              notes: row.notes || undefined,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            };
          });

          // Sincronizar cache local com dados reais do Supabase
          if (mapped.length > 0) {
            const allLocal = DataStore.getAllGraduations();
            const withoutCurrent = allLocal.filter((g) => g.studentId !== studentId);
            DataStore.saveGraduations([...withoutCurrent, ...mapped]);
          }

          return mapped;
        }
      } catch (err) {
        console.warn('Aviso ao consultar graduações no Supabase, utilizando cache local:', err);
      }
    }

    // Fallback: DataStore local (ordem cronológica decrescente por data da graduação)
    const local = DataStore.getGraduations(tenantId, studentId);
    return local.sort(
      (a, b) => new Date(b.graduatedAt).getTime() - new Date(a.graduatedAt).getTime()
    );
  },

  /**
   * Registra uma nova graduação no histórico do aluno.
   * Utiliza preferencialmente a função RPC atômica record_student_graduation.
   * Fallback: INSERT direto com verificação RLS e persistência no DataStore.
   */
  async recordGraduation(
    payload: RecordGraduationPayload,
    availableArts: MartialArt[] = [],
    availableBelts: BeltRank[] = [],
    operatorName?: string
  ): Promise<StudentGraduation> {
    if (!payload.studentId || !payload.tenantId || !payload.martialArtId || !payload.beltRankId) {
      throw new Error('Preencha todos os campos obrigatórios (aluno, modalidade, graduação e data).');
    }

    if (!payload.graduatedAt) {
      throw new Error('A data da graduação é obrigatória.');
    }

    // Validar se a faixa pertence à modalidade informada
    const matchedBelt = availableBelts.find(
      (b) => b.id === payload.beltRankId && b.martialArtId === payload.martialArtId
    );
    const matchedArt = availableArts.find((a) => a.id === payload.martialArtId);

    if (availableBelts.length > 0 && !matchedBelt) {
      throw new Error('A faixa ou graduação selecionada não pertence à arte marcial informada.');
    }

    const examiner = payload.examinerName?.trim() || operatorName || 'Sensei Responsável';

    // 1. Tentar via Supabase quando conectado com UUIDs válidos
    if (
      isSupabaseConfigured() &&
      supabase &&
      isValidUUID(payload.tenantId) &&
      isValidUUID(payload.studentId) &&
      isValidUUID(payload.martialArtId) &&
      isValidUUID(payload.beltRankId)
    ) {
      // 1.1 Tentar RPC atômica record_student_graduation
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'record_student_graduation',
          {
            p_tenant_id: payload.tenantId,
            p_student_id: payload.studentId,
            p_martial_art_id: payload.martialArtId,
            p_belt_rank_id: payload.beltRankId,
            p_graduated_at: payload.graduatedAt,
            p_examiner_name: examiner,
            p_notes: payload.notes?.trim() || null,
            p_certificate_code: payload.certificateCode?.trim() || null,
          }
        );

        if (!rpcError && rpcData?.id) {
          const newGraduation: StudentGraduation = {
            id: rpcData.id,
            tenantId: payload.tenantId,
            studentId: payload.studentId,
            martialArtId: payload.martialArtId,
            martialArtName: rpcData.martial_art_name || matchedArt?.name || 'Arte Marcial',
            beltRankId: payload.beltRankId,
            beltRankName: rpcData.belt_rank_name || matchedBelt?.name || 'Graduação',
            beltColorHex: matchedBelt?.colorHex || '#ffffff',
            graduatedAt: payload.graduatedAt,
            examinerName: examiner,
            branchName: payload.branchName,
            certificateCode: payload.certificateCode?.trim() || undefined,
            notes: payload.notes?.trim() || undefined,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          DataStore.saveGraduation(newGraduation);
          return newGraduation;
        }
      } catch (rpcErr) {
        console.warn('RPC record_student_graduation indisponível, tentando INSERT direto:', rpcErr);
      }

      // 1.2 Fallback: INSERT direto na tabela student_graduations
      const { data: insertData, error: insertError } = await supabase
        .from('student_graduations')
        .insert({
          tenant_id: payload.tenantId,
          student_id: payload.studentId,
          martial_art_id: payload.martialArtId,
          belt_rank_id: payload.beltRankId,
          graduated_at: payload.graduatedAt,
          examiner_name: examiner,
          certificate_code: payload.certificateCode?.trim() || null,
          notes: payload.notes?.trim() || null,
        })
        .select(`
          id,
          tenant_id,
          student_id,
          martial_art_id,
          belt_rank_id,
          graduated_at,
          examiner_name,
          certificate_code,
          notes,
          created_at,
          updated_at,
          martial_art:martial_arts (id, name),
          belt_rank:belt_ranks (id, name, color_hex)
        `)
        .single();

      if (insertError) {
        console.error('Erro ao persistir graduação no Supabase:', insertError);
        throw new Error(`Falha ao registrar graduação no banco de dados: ${insertError.message}`);
      }

      const art = Array.isArray(insertData.martial_art)
        ? insertData.martial_art[0]
        : insertData.martial_art;
      const belt = Array.isArray(insertData.belt_rank)
        ? insertData.belt_rank[0]
        : insertData.belt_rank;

      const created: StudentGraduation = {
        id: insertData.id,
        tenantId: insertData.tenant_id,
        studentId: insertData.student_id,
        martialArtId: insertData.martial_art_id,
        martialArtName: art?.name || matchedArt?.name || 'Arte Marcial',
        beltRankId: insertData.belt_rank_id,
        beltRankName: belt?.name || matchedBelt?.name || 'Graduação',
        beltColorHex: belt?.color_hex || matchedBelt?.colorHex || '#ffffff',
        graduatedAt: insertData.graduated_at,
        examinerName: insertData.examiner_name || examiner,
        branchName: payload.branchName,
        certificateCode: insertData.certificate_code || undefined,
        notes: insertData.notes || undefined,
        createdAt: insertData.created_at,
        updatedAt: insertData.updated_at,
      };

      DataStore.saveGraduation(created);
      return created;
    }

    // 2. Fallback: modo offline / DataStore local
    const newLocalGraduation: StudentGraduation = {
      id: `grad-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      tenantId: payload.tenantId,
      studentId: payload.studentId,
      martialArtId: payload.martialArtId,
      martialArtName: matchedArt?.name || 'Arte Marcial',
      beltRankId: payload.beltRankId,
      beltRankName: matchedBelt?.name || 'Graduação',
      beltColorHex: matchedBelt?.colorHex || '#ffffff',
      graduatedAt: payload.graduatedAt,
      examinerName: examiner,
      branchName: payload.branchName,
      certificateCode: payload.certificateCode?.trim() || undefined,
      notes: payload.notes?.trim() || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    DataStore.saveGraduation(newLocalGraduation);
    return newLocalGraduation;
  },

  /**
   * Atualiza / corrige um registro existente no histórico de graduações.
   */
  async updateGraduation(
    payload: UpdateGraduationPayload,
    availableArts: MartialArt[] = [],
    availableBelts: BeltRank[] = [],
    operatorName?: string
  ): Promise<StudentGraduation> {
    if (!payload.id || !payload.martialArtId || !payload.beltRankId) {
      throw new Error('Dados de graduação incompletos para atualização.');
    }

    if (!payload.graduatedAt) {
      throw new Error('A data da graduação é obrigatória.');
    }

    const matchedBelt = availableBelts.find(
      (b) => b.id === payload.beltRankId && b.martialArtId === payload.martialArtId
    );
    const matchedArt = availableArts.find((a) => a.id === payload.martialArtId);

    if (availableBelts.length > 0 && !matchedBelt) {
      throw new Error('A faixa ou graduação selecionada não pertence à arte marcial informada.');
    }

    const examiner = payload.examinerName?.trim() || operatorName || 'Sensei Responsável';

    if (
      isSupabaseConfigured() &&
      supabase &&
      isValidUUID(payload.tenantId) &&
      isValidUUID(payload.id)
    ) {
      // 1. Tentar RPC atômica
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'update_student_graduation',
          {
            p_tenant_id: payload.tenantId,
            p_graduation_id: payload.id,
            p_martial_art_id: payload.martialArtId,
            p_belt_rank_id: payload.beltRankId,
            p_graduated_at: payload.graduatedAt,
            p_examiner_name: examiner,
            p_notes: payload.notes?.trim() || null,
            p_certificate_code: payload.certificateCode?.trim() || null,
          }
        );

        if (!rpcError && rpcData?.success) {
          const updated: StudentGraduation = {
            id: payload.id,
            tenantId: payload.tenantId,
            studentId: payload.studentId,
            martialArtId: payload.martialArtId,
            martialArtName: rpcData.martial_art_name || matchedArt?.name || 'Arte Marcial',
            beltRankId: payload.beltRankId,
            beltRankName: rpcData.belt_rank_name || matchedBelt?.name || 'Graduação',
            beltColorHex: matchedBelt?.colorHex || '#ffffff',
            graduatedAt: payload.graduatedAt,
            examinerName: examiner,
            branchName: payload.branchName,
            certificateCode: payload.certificateCode?.trim() || undefined,
            notes: payload.notes?.trim() || undefined,
            updatedAt: new Date().toISOString(),
          };

          DataStore.saveGraduation(updated);
          return updated;
        }
      } catch (rpcEx) {
        console.warn('RPC update_student_graduation falhou, tentando UPDATE direto:', rpcEx);
      }

      // 2. Fallback UPDATE direto
      const { data: updateData, error: updateError } = await supabase
        .from('student_graduations')
        .update({
          martial_art_id: payload.martialArtId,
          belt_rank_id: payload.beltRankId,
          graduated_at: payload.graduatedAt,
          examiner_name: examiner,
          certificate_code: payload.certificateCode?.trim() || null,
          notes: payload.notes?.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.id)
        .eq('tenant_id', payload.tenantId)
        .select(`
          id,
          tenant_id,
          student_id,
          martial_art_id,
          belt_rank_id,
          graduated_at,
          examiner_name,
          certificate_code,
          notes,
          created_at,
          updated_at,
          martial_art:martial_arts (id, name),
          belt_rank:belt_ranks (id, name, color_hex)
        `)
        .single();

      if (updateError) {
        console.error('Erro ao atualizar graduação no Supabase:', updateError);
        throw new Error(`Falha ao atualizar graduação: ${updateError.message}`);
      }

      const art = Array.isArray(updateData.martial_art)
        ? updateData.martial_art[0]
        : updateData.martial_art;
      const belt = Array.isArray(updateData.belt_rank)
        ? updateData.belt_rank[0]
        : updateData.belt_rank;

      const updated: StudentGraduation = {
        id: updateData.id,
        tenantId: updateData.tenant_id,
        studentId: updateData.student_id,
        martialArtId: updateData.martial_art_id,
        martialArtName: art?.name || matchedArt?.name || 'Arte Marcial',
        beltRankId: updateData.belt_rank_id,
        beltRankName: belt?.name || matchedBelt?.name || 'Graduação',
        beltColorHex: belt?.color_hex || matchedBelt?.colorHex || '#ffffff',
        graduatedAt: updateData.graduated_at,
        examinerName: updateData.examiner_name || examiner,
        branchName: payload.branchName,
        certificateCode: updateData.certificate_code || undefined,
        notes: updateData.notes || undefined,
        createdAt: updateData.created_at,
        updatedAt: updateData.updated_at,
      };

      DataStore.saveGraduation(updated);
      return updated;
    }

    // Fallback: DataStore local
    const updatedLocal: StudentGraduation = {
      id: payload.id,
      tenantId: payload.tenantId,
      studentId: payload.studentId,
      martialArtId: payload.martialArtId,
      martialArtName: matchedArt?.name || 'Arte Marcial',
      beltRankId: payload.beltRankId,
      beltRankName: matchedBelt?.name || 'Graduação',
      beltColorHex: matchedBelt?.colorHex || '#ffffff',
      graduatedAt: payload.graduatedAt,
      examinerName: examiner,
      branchName: payload.branchName,
      certificateCode: payload.certificateCode?.trim() || undefined,
      notes: payload.notes?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };

    DataStore.saveGraduation(updatedLocal);
    return updatedLocal;
  },

  /**
   * Exclui um registro do histórico de graduações com confirmação e verificação de privilégios.
   */
  async deleteGraduation(
    tenantId: string,
    graduationId: string,
    studentId: string
  ): Promise<void> {
    if (!graduationId || !tenantId) {
      throw new Error('Identificadores ausentes para exclusão da graduação.');
    }

    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId) && isValidUUID(graduationId)) {
      // 1. Tentar RPC atômica
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'delete_student_graduation',
          {
            p_tenant_id: tenantId,
            p_graduation_id: graduationId,
          }
        );

        if (!rpcError && rpcData?.success) {
          DataStore.deleteGraduation(graduationId);
          return;
        }
      } catch (rpcEx) {
        console.warn('RPC delete_student_graduation falhou, tentando DELETE direto:', rpcEx);
      }

      // 2. Fallback: DELETE direto
      const { error: delError } = await supabase
        .from('student_graduations')
        .delete()
        .eq('id', graduationId)
        .eq('tenant_id', tenantId);

      if (delError) {
        console.error('Erro ao excluir graduação no Supabase:', delError);
        throw new Error(`Falha ao excluir registro de graduação: ${delError.message}`);
      }
    }

    DataStore.deleteGraduation(graduationId);
  },

  /**
   * Agrupa e organiza as graduações cronologicamente separadas por cada arte marcial.
   * Identifica:
   *  - Graduação atual (mais recente por data efetiva);
   *  - Graduações anteriores;
   *  - Inconsistências (ex: mais de uma graduação diferente na mesma data para a mesma modalidade).
   */
  organizeGraduationsByMartialArt(
    graduations: StudentGraduation[],
    allArts: MartialArt[] = [],
    studentCurrentGrads: Student['currentGraduations'] = []
  ): MartialArtGraduationGroup[] {
    // 1. Identificar todas as modalidades relevantes para este aluno
    const artIds = new Set<string>();

    // Incluir modalidades presentes no histórico
    graduations.forEach((g) => {
      if (g.martialArtId) artIds.add(g.martialArtId);
    });

    // Incluir modalidades nas quais o aluno está inscrito atualmente
    studentCurrentGrads.forEach((cg) => {
      if (cg.martialArtId) artIds.add(cg.martialArtId);
    });

    // Se o aluno ainda não possui nenhuma graduação nem modalidade no cadastro, mas há modalidades cadastradas
    if (artIds.size === 0 && allArts.length > 0) {
      // Deixar vazio ou incluir as artes ativas da academia
    }

    const groups: MartialArtGraduationGroup[] = [];

    artIds.forEach((artId) => {
      const art = allArts.find((a) => a.id === artId);
      const artName =
        art?.name ||
        graduations.find((g) => g.martialArtId === artId)?.martialArtName ||
        studentCurrentGrads.find((cg) => cg.martialArtId === artId)?.martialArtName ||
        'Arte Marcial';

      // Filtrar graduações exclusivamente desta arte marcial
      const artGrads = graduations
        .filter((g) => g.martialArtId === artId)
        .sort((a, b) => {
          // Ordenação cronológica estrita: do mais recente para o mais antigo
          const dateDiff = new Date(b.graduatedAt).getTime() - new Date(a.graduatedAt).getTime();
          if (dateDiff !== 0) return dateDiff;
          // Desempate por timestamp de criação se disponível
          const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bCreated - aCreated;
        });

      // Verificação de inconsistência: duas graduações com faixas diferentes na mesma data
      let hasInconsistency = false;
      let inconsistencyMessage: string | undefined;

      const dateBeltMap = new Map<string, string>();
      for (const g of artGrads) {
        const existingBeltId = dateBeltMap.get(g.graduatedAt);
        if (existingBeltId && existingBeltId !== g.beltRankId) {
          hasInconsistency = true;
          inconsistencyMessage = `Atenção: existem duas graduações com faixas diferentes registradas na mesma data (${g.graduatedAt}). Verifique e corrija os registros para evitar divergências.`;
          break;
        }
        dateBeltMap.set(g.graduatedAt, g.beltRankId);
      }

      // Determinar graduação atual e anteriores
      const currentGraduation = artGrads.length > 0 ? artGrads[0] : null;
      const previousGraduations = artGrads.length > 1 ? artGrads.slice(1) : [];

      groups.push({
        martialArtId: artId,
        martialArtName: artName,
        graduations: artGrads,
        currentGraduation,
        previousGraduations,
        hasInconsistency,
        inconsistencyMessage,
        totalCount: artGrads.length,
      });
    });

    // Ordenar grupos alfabeticamente pelo nome da arte marcial
    return groups.sort((a, b) => a.martialArtName.localeCompare(b.martialArtName));
  },

  /**
   * Recalcula o vetor `currentGraduations` do aluno com base no histórico real consolidado.
   * Mantém a graduação mais recente por data de cada modalidade ativa,
   * sem modificar outras modalidades nem informações cadastrais/antropométricas.
   */
  recalculateStudentCurrentGraduations(
    allGraduations: StudentGraduation[],
    allArts: MartialArt[] = [],
    allBelts: BeltRank[] = []
  ): Student['currentGraduations'] {
    const artMap = new Map<string, MartialArt>(allArts.map((a) => [a.id, a]));
    const beltMap = new Map<string, BeltRank>(allBelts.map((b) => [b.id, b]));

    // Agrupar graduações por modalidade
    const gradsByArt = new Map<string, StudentGraduation[]>();
    allGraduations.forEach((g) => {
      const list = gradsByArt.get(g.martialArtId) || [];
      list.push(g);
      gradsByArt.set(g.martialArtId, list);
    });

    const result: Student['currentGraduations'] = [];

    gradsByArt.forEach((grads, artId) => {
      // Ordenar do mais recente para o mais antigo por data de graduação
      const sorted = [...grads].sort(
        (a, b) => new Date(b.graduatedAt).getTime() - new Date(a.graduatedAt).getTime()
      );
      const latest = sorted[0];
      if (latest) {
        const art = artMap.get(artId);
        const belt = beltMap.get(latest.beltRankId);

        result.push({
          martialArtId: artId,
          martialArtName: latest.martialArtName || art?.name || 'Arte Marcial',
          beltId: latest.beltRankId,
          beltName: latest.beltRankName || belt?.name || 'Faixa Atual',
          beltColorHex: latest.beltColorHex || belt?.colorHex || '#ffffff',
          graduatedAt: latest.graduatedAt,
        });
      }
    });

    return result.sort((a, b) => a.martialArtName.localeCompare(b.martialArtName));
  },
};
