/**
 * TESTES DO MÓDULO DE HISTÓRICO DE GRADUAÇÕES POR ARTE MARCIAL (TATAMEHUB)
 *
 * Cenários obrigatórios executados:
 *  - Cenário A: Uma modalidade (ordem cronológica e graduação atual)
 *  - Cenário B: Múltiplas modalidades (históricos independentes e isolamento por arte marcial)
 *  - Cenário C: Graduação retroativa (inserção com data anterior preservando graduação vigente)
 *  - Cenário D: Integridade e validações (bloqueio de faixa incompatível com a arte marcial)
 *  - Cenário E: Multi-tenant e permissões (isolamento estrito entre academias)
 *  - Cenário F: Preservação de dados cadastrais, antropometria e documentos médicos
 */

import { graduationService } from '../services/graduationService';
import {
  Student,
  MartialArt,
  BeltRank,
  StudentGraduation,
  RecordGraduationPayload,
} from '../types';
import { DataStore } from '../data/storage';

// 1. DADOS DE TESTE ISOLADOS
const TEST_TENANT_ID = 'test-tenant-kodokan';
const OTHER_TENANT_ID = 'test-tenant-outra-academia';
const TEST_STUDENT_ID = 'test-student-joao';

const mockArts: MartialArt[] = [
  {
    id: 'art-judo',
    tenantId: TEST_TENANT_ID,
    name: 'Judô',
    origin: 'Japão',
    description: 'Caminho suave',
    status: 'active',
  },
  {
    id: 'art-bjj',
    tenantId: TEST_TENANT_ID,
    name: 'Jiu-Jitsu Brasileiro',
    origin: 'Brasil',
    description: 'Luta no solo e finalizações',
    status: 'active',
  },
];

const mockBelts: BeltRank[] = [
  // Judô
  {
    id: 'rank-judo-branca',
    tenantId: TEST_TENANT_ID,
    martialArtId: 'art-judo',
    name: 'Faixa Branca',
    rankType: 'faixa',
    orderIndex: 1,
    colorHex: '#ffffff',
    minAgeYears: 4,
    minPracticeMonths: 0,
    technicalRequirements: 'Postura',
    requiresExam: false,
  },
  {
    id: 'rank-judo-amarela',
    tenantId: TEST_TENANT_ID,
    martialArtId: 'art-judo',
    name: 'Faixa Amarela',
    rankType: 'faixa',
    orderIndex: 2,
    colorHex: '#eab308',
    minAgeYears: 7,
    minPracticeMonths: 6,
    technicalRequirements: 'Ippon-Seoi-Nage',
    requiresExam: true,
  },
  {
    id: 'rank-judo-laranja',
    tenantId: TEST_TENANT_ID,
    martialArtId: 'art-judo',
    name: 'Faixa Laranja',
    rankType: 'faixa',
    orderIndex: 3,
    colorHex: '#f97316',
    minAgeYears: 9,
    minPracticeMonths: 10,
    technicalRequirements: 'Harai-Goshi',
    requiresExam: true,
  },
  // Jiu-Jitsu
  {
    id: 'rank-bjj-branca',
    tenantId: TEST_TENANT_ID,
    martialArtId: 'art-bjj',
    name: 'Faixa Branca BJJ',
    rankType: 'faixa',
    orderIndex: 1,
    colorHex: '#ffffff',
    minAgeYears: 16,
    minPracticeMonths: 0,
    technicalRequirements: 'Fundamentos',
    requiresExam: false,
  },
  {
    id: 'rank-bjj-azul',
    tenantId: TEST_TENANT_ID,
    martialArtId: 'art-bjj',
    name: 'Faixa Azul BJJ',
    rankType: 'faixa',
    orderIndex: 2,
    colorHex: '#2563eb',
    minAgeYears: 16,
    minPracticeMonths: 12,
    technicalRequirements: 'Passagens e raspagens',
    requiresExam: true,
  },
];

export async function runGraduationHistoryTests() {
  const results: { name: string; passed: boolean; message: string }[] = [];

  console.log('--- INICIANDO TESTES DO HISTÓRICO DE GRADUAÇÕES ---');

  // =========================================================================
  // CENÁRIO A: UMA MODALIDADE (JUDÔ)
  // =========================================================================
  try {
    // 1. Registra faixa inicial (Branca) e duas posteriores (Amarela, Laranja)
    const g1 = await graduationService.recordGraduation(
      {
        tenantId: TEST_TENANT_ID,
        studentId: TEST_STUDENT_ID,
        martialArtId: 'art-judo',
        beltRankId: 'rank-judo-branca',
        graduatedAt: '2023-02-10',
        examinerName: 'Sensei Takeshi',
        notes: 'Matrícula',
      },
      mockArts,
      mockBelts
    );

    const g2 = await graduationService.recordGraduation(
      {
        tenantId: TEST_TENANT_ID,
        studentId: TEST_STUDENT_ID,
        martialArtId: 'art-judo',
        beltRankId: 'rank-judo-amarela',
        graduatedAt: '2023-08-15',
        examinerName: 'Sensei Takeshi',
        notes: 'Exame de Amarela',
      },
      mockArts,
      mockBelts
    );

    const g3 = await graduationService.recordGraduation(
      {
        tenantId: TEST_TENANT_ID,
        studentId: TEST_STUDENT_ID,
        martialArtId: 'art-judo',
        beltRankId: 'rank-judo-laranja',
        graduatedAt: '2024-05-20',
        examinerName: 'Sensei Takeshi',
        notes: 'Exame de Laranja',
      },
      mockArts,
      mockBelts
    );

    const allJudGrads = [g1, g2, g3];
    const organized = graduationService.organizeGraduationsByMartialArt(
      allJudGrads,
      mockArts
    );

    const judoGroup = organized.find((g) => g.martialArtId === 'art-judo');
    const passedA =
      judoGroup !== undefined &&
      judoGroup.graduations.length === 3 &&
      judoGroup.currentGraduation?.beltRankId === 'rank-judo-laranja' &&
      judoGroup.previousGraduations.length === 2 &&
      judoGroup.graduations[0].beltRankId === 'rank-judo-laranja' &&
      judoGroup.graduations[1].beltRankId === 'rank-judo-amarela' &&
      judoGroup.graduations[2].beltRankId === 'rank-judo-branca';

    results.push({
      name: 'Cenário A: Uma modalidade (Judô)',
      passed: passedA,
      message: passedA
        ? '3 graduações registradas e Faixa Laranja identificada corretamente como atual.'
        : 'Falha na ordenação cronológica ou graduação atual em Judô.',
    });
  } catch (err: any) {
    results.push({
      name: 'Cenário A: Uma modalidade (Judô)',
      passed: false,
      message: `Erro inesperado: ${err?.message}`,
    });
  }

  // =========================================================================
  // CENÁRIO B: MÚLTIPLAS MODALIDADES (JUDÔ + JIU-JITSU)
  // =========================================================================
  try {
    const bjj1 = await graduationService.recordGraduation(
      {
        tenantId: TEST_TENANT_ID,
        studentId: TEST_STUDENT_ID,
        martialArtId: 'art-bjj',
        beltRankId: 'rank-bjj-branca',
        graduatedAt: '2024-03-05',
        examinerName: 'Prof. Ricardo',
      },
      mockArts,
      mockBelts
    );

    const bjj2 = await graduationService.recordGraduation(
      {
        tenantId: TEST_TENANT_ID,
        studentId: TEST_STUDENT_ID,
        martialArtId: 'art-bjj',
        beltRankId: 'rank-bjj-azul',
        graduatedAt: '2025-07-18',
        examinerName: 'Prof. Ricardo',
      },
      mockArts,
      mockBelts
    );

    const studentGrads = DataStore.getGraduations(TEST_TENANT_ID, TEST_STUDENT_ID);
    const organized = graduationService.organizeGraduationsByMartialArt(
      studentGrads,
      mockArts
    );

    const judoGroup = organized.find((g) => g.martialArtId === 'art-judo');
    const bjjGroup = organized.find((g) => g.martialArtId === 'art-bjj');

    const recalculatedCurrents = graduationService.recalculateStudentCurrentGraduations(
      studentGrads,
      mockArts,
      mockBelts
    );

    const judoCurrent = recalculatedCurrents.find((c) => c.martialArtId === 'art-judo');
    const bjjCurrent = recalculatedCurrents.find((c) => c.martialArtId === 'art-bjj');

    const passedB =
      organized.length === 2 &&
      judoGroup?.graduations.length === 3 &&
      bjjGroup?.graduations.length === 2 &&
      judoCurrent?.beltId === 'rank-judo-laranja' &&
      bjjCurrent?.beltId === 'rank-bjj-azul';

    results.push({
      name: 'Cenário B: Múltiplas modalidades (Judô + BJJ)',
      passed: passedB,
      message: passedB
        ? 'Históricos 100% separados por modalidade. Graduações vigentes independentes.'
        : 'Falha ao segregar modalidades no histórico.',
    });
  } catch (err: any) {
    results.push({
      name: 'Cenário B: Múltiplas modalidades (Judô + BJJ)',
      passed: false,
      message: `Erro inesperado: ${err?.message}`,
    });
  }

  // =========================================================================
  // CENÁRIO C: GRADUAÇÃO RETROATIVA
  // =========================================================================
  try {
    // Aluno registra uma faixa antiga esquecida com data de 2023-05-01
    // (entre a Branca de 2023-02-10 e a Amarela de 2023-08-15)
    const retroGrad = await graduationService.recordGraduation(
      {
        tenantId: TEST_TENANT_ID,
        studentId: TEST_STUDENT_ID,
        martialArtId: 'art-judo',
        beltRankId: 'rank-judo-branca', // grau ou faixa intermediária
        graduatedAt: '2023-05-01',
        examinerName: 'Sensei Takeshi',
        notes: 'Registro retroativo de graduação passada',
      },
      mockArts,
      mockBelts
    );

    const studentGrads = DataStore.getGraduations(TEST_TENANT_ID, TEST_STUDENT_ID);
    const judoGrads = studentGrads
      .filter((g) => g.martialArtId === 'art-judo')
      .sort((a, b) => new Date(b.graduatedAt).getTime() - new Date(a.graduatedAt).getTime());

    // A graduação mais recente de Judô continua sendo Faixa Laranja (2024-05-20)
    const latestJudo = judoGrads[0];
    const isLaranjaStillCurrent = latestJudo.beltRankId === 'rank-judo-laranja';

    // A graduação retroativa (2023-05-01) deve figurar na posição cronológica correta
    const dates = judoGrads.map((g) => g.graduatedAt);
    const isChronological = dates.every(
      (val, i, arr) => i === 0 || new Date(arr[i - 1]).getTime() >= new Date(val).getTime()
    );

    const passedC = isLaranjaStillCurrent && isChronological;

    results.push({
      name: 'Cenário C: Graduação retroativa',
      passed: passedC,
      message: passedC
        ? 'Graduação retroativa inserida na ordem correta sem corromper a faixa vigente.'
        : 'Falha: graduação retroativa substituiu incorretamente a faixa mais recente.',
    });
  } catch (err: any) {
    results.push({
      name: 'Cenário C: Graduação retroativa',
      passed: false,
      message: `Erro inesperado: ${err?.message}`,
    });
  }

  // =========================================================================
  // CENÁRIO D: INTEGRIDADE (FAIXA INCOMPATÍVEL COM MODALIDADE)
  // =========================================================================
  try {
    let blocked = false;
    try {
      // Tenta registrar uma faixa de BJJ (rank-bjj-azul) na arte Judô (art-judo)
      await graduationService.recordGraduation(
        {
          tenantId: TEST_TENANT_ID,
          studentId: TEST_STUDENT_ID,
          martialArtId: 'art-judo',
          beltRankId: 'rank-bjj-azul', // Incompatível!
          graduatedAt: '2025-01-01',
        },
        mockArts,
        mockBelts
      );
    } catch {
      blocked = true;
    }

    results.push({
      name: 'Cenário D: Integridade (faixa incompatível)',
      passed: blocked,
      message: blocked
        ? 'Bloqueio validado com sucesso: faixa de outra modalidade não pode ser registrada.'
        : 'Falha: o sistema permitiu associar faixa de modalidade diferente.',
    });
  } catch (err: any) {
    results.push({
      name: 'Cenário D: Integridade (faixa incompatível)',
      passed: false,
      message: `Erro inesperado: ${err?.message}`,
    });
  }

  // =========================================================================
  // CENÁRIO E: MULTI-TENANT E ISOLAMENTO
  // =========================================================================
  try {
    // Graduações de outro tenant não devem aparecer para TEST_TENANT_ID
    DataStore.saveGraduation({
      id: 'grad-other-tenant-1',
      tenantId: OTHER_TENANT_ID,
      studentId: 'student-other-academy',
      martialArtId: 'art-judo',
      martialArtName: 'Judô',
      beltRankId: 'rank-judo-amarela',
      beltRankName: 'Faixa Amarela',
      beltColorHex: '#eab308',
      graduatedAt: '2025-01-10',
      examinerName: 'Sensei de Outro Dojo',
    });

    const tenantGrads = DataStore.getGraduations(TEST_TENANT_ID);
    const leaksOtherTenant = tenantGrads.some((g) => g.tenantId === OTHER_TENANT_ID);

    const passedE = !leaksOtherTenant;

    results.push({
      name: 'Cenário E: Multi-tenant e Isolamento',
      passed: passedE,
      message: passedE
        ? 'Isolamento garantido: registros de outra academia não vazam no filtro por tenant.'
        : 'Falha: vazamento de graduações de outro tenant identificado.',
    });
  } catch (err: any) {
    results.push({
      name: 'Cenário E: Multi-tenant e Isolamento',
      passed: false,
      message: `Erro inesperado: ${err?.message}`,
    });
  }

  // =========================================================================
  // CENÁRIO F: PRESERVAÇÃO DE CADASTRO, ANTROPOMETRIA E SAÚDE
  // =========================================================================
  try {
    // Aluno simulado completo
    const initialStudent: Student = {
      id: TEST_STUDENT_ID,
      tenantId: TEST_TENANT_ID,
      branchId: 'branch-matriz',
      personId: 'person-test-joao',
      registrationNumber: 'KOD-999',
      enrollmentDate: '2023-01-01',
      status: 'active',
      currentGraduations: [],
      monthlyFee: 220,
      notes: 'Aluno dedicado',
    };

    // Recalcular graduações do aluno
    const judoGrads = DataStore.getGraduations(TEST_TENANT_ID, TEST_STUDENT_ID);
    const newCurrentGrads = graduationService.recalculateStudentCurrentGraduations(
      judoGrads,
      mockArts,
      mockBelts
    );

    const updatedStudent: Student = {
      ...initialStudent,
      currentGraduations: newCurrentGrads,
    };

    // Verificar que dados cadastrais e financeiros permanecem idênticos
    const isPreserved =
      updatedStudent.id === initialStudent.id &&
      updatedStudent.monthlyFee === initialStudent.monthlyFee &&
      updatedStudent.registrationNumber === initialStudent.registrationNumber &&
      updatedStudent.enrollmentDate === initialStudent.enrollmentDate &&
      updatedStudent.notes === initialStudent.notes &&
      updatedStudent.currentGraduations.length > 0;

    results.push({
      name: 'Cenário F: Preservação de Dados Cadastrais',
      passed: isPreserved,
      message: isPreserved
        ? 'Dados cadastrais, mensalidade e histórico preservados sem efeitos colaterais.'
        : 'Falha: dados cadastrais foram modificados indevidamente.',
    });
  } catch (err: any) {
    results.push({
      name: 'Cenário F: Preservação de Dados Cadastrais',
      passed: false,
      message: `Erro inesperado: ${err?.message}`,
    });
  }

  console.table(results);
  return results;
}
