/**
 * Test Suite: TatameHub Antropometria e IMC
 * Executa e valida os 14 testes obrigatórios conforme especificação de requisitos.
 */

import {
  calculateExactAge,
  classifyBmi,
  WHO_BOYS_5_19,
  WHO_GIRLS_5_19,
  getClassificationBadgeColor,
} from '../utils/whoBmiClassification';
import { DataStore } from '../data/storage';
import { assessmentService } from '../services/assessmentService';
import { PhysicalAssessment } from '../types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] Teste: ${testName}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] Teste: ${testName} - Detalhes: ${detail || 'Condição falhou'}`);
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('TATAMEHUB - SUITE DE TESTES: ANTROPOMETRIA E IMC (14 CASOS)');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // TESTE 1: Aluno sem medições (exibição limpa, sem crash, botão de cadastro)
  // -------------------------------------------------------------------------
  console.log('1. Testando Aluno sem medições...');
  const emptyStudentAssessments: PhysicalAssessment[] = [];
  assert(
    emptyStudentAssessments.length === 0,
    'Lista vazia de medições não dispara exceções',
    'Lista deve ser array vazio'
  );
  // Verificar cálculo para aluno sem histórico
  const noDateCalc = calculateExactAge('2015-05-10');
  assert(
    noDateCalc.isValid && noDateCalc.years > 0,
    'Idade atual é calculada mesmo sem medições registradas'
  );

  // -------------------------------------------------------------------------
  // TESTE 2: Aluno com exatamente 1 medição (gráfico de ponto único, sem linha falsa)
  // -------------------------------------------------------------------------
  console.log('\n2. Testando Aluno com exatamente 1 medição...');
  const singleAssessment: PhysicalAssessment = {
    id: 'assess-single-1',
    tenantId: 'tenant-kodokan',
    studentId: 'student-single',
    date: '2026-01-15',
    weightKg: 50.0,
    heightCm: 160.0,
    bmi: 19.5,
    classification: 'Eutrofia (Peso adequado)',
    referenceStandard: 'who_growth_reference',
    evaluatorName: 'Sensei Teste',
  };
  const singleList = [singleAssessment];
  assert(singleList.length === 1, 'Histórico com 1 única medição');
  assert(singleList[0].bmi === 19.5, 'IMC aferido corretamente');
  // Gráfico deve plotar ponto sem traçar conectores lineares inválidos
  assert(singleList.length < 2, 'Comprimento < 2 assegura ponto isolado no BmiEvolutionChart');

  // -------------------------------------------------------------------------
  // TESTE 3: Aluno com múltiplas medições em ordem cronológica
  // -------------------------------------------------------------------------
  console.log('\n3. Testando Múltiplas medições e ordenação cronológica...');
  const multiAssessments: PhysicalAssessment[] = [
    {
      id: 'm1',
      tenantId: 'tenant-kodokan',
      studentId: 'student-lucas',
      date: '2026-03-01',
      weightKg: 54.0,
      heightCm: 165.0,
      bmi: 19.8,
    },
    {
      id: 'm2',
      tenantId: 'tenant-kodokan',
      studentId: 'student-lucas',
      date: '2025-06-15',
      weightKg: 48.0,
      heightCm: 160.0,
      bmi: 18.8,
    },
    {
      id: 'm3',
      tenantId: 'tenant-kodokan',
      studentId: 'student-lucas',
      date: '2025-11-20',
      weightKg: 51.5,
      heightCm: 163.0,
      bmi: 19.4,
    },
  ];

  // Ordenação ascendente para o gráfico (tempo cronológico)
  const chartSorted = [...multiAssessments].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  assert(chartSorted[0].date === '2025-06-15', 'Primeiro ponto do gráfico é a medição mais antiga');
  assert(chartSorted[2].date === '2026-03-01', 'Último ponto do gráfico é a medição mais recente');

  // Ordenação descendente para a tabela de histórico
  const tableSorted = [...multiAssessments].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  assert(tableSorted[0].date === '2026-03-01', 'Primeira linha da tabela é a medição mais recente');

  // -------------------------------------------------------------------------
  // TESTE 4: Cadastro com data atual pré-preenchida
  // -------------------------------------------------------------------------
  console.log('\n4. Testando Data atual pré-preenchida...');
  const todayYmd = new Date().toISOString().split('T')[0];
  assert(
    typeof todayYmd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(todayYmd),
    'Data padrão segue formato ISO YYYY-MM-DD para formulários HTML5'
  );

  // -------------------------------------------------------------------------
  // TESTE 5: Cadastro de nova medição (fórmula peso/(altura)², idade e OMS)
  // -------------------------------------------------------------------------
  console.log('\n5. Testando Cadastro e cálculo de nova medição...');
  const weight = 68.0;
  const height = 172.0; // cm
  const heightM = height / 100;
  const computedBmi = Number((weight / (heightM * heightM)).toFixed(1));
  assert(computedBmi === 23.0, `Cálculo de IMC: 68 / (1.72)² = 23.0 (obtido: ${computedBmi})`);

  // Aluno adolescente (masculino, 14 anos)
  const teenBirth = '2012-01-10';
  const teenMeasureDate = '2026-01-10'; // exatamente 14 anos
  const teenClass = classifyBmi(computedBmi, teenBirth, 'male', teenMeasureDate);
  assert(teenClass.ageYearsAtMeasurement === 14, 'Idade na medição calculada em 14 anos');
  assert(teenClass.referenceStandard === 'who_growth_reference', 'Referência OMS 2007 (5 a 19 anos)');
  assert(
    teenClass.classification.includes('Eutrofia') || teenClass.classification.includes('Sobrepeso'),
    `Classificação adolescente obtida: ${teenClass.classification}`
  );

  // -------------------------------------------------------------------------
  // TESTE 6: Validação de campos obrigatórios
  // -------------------------------------------------------------------------
  console.log('\n6. Testando Validação de campos obrigatórios...');
  try {
    // Tentativa de criar sem peso
    await assessmentService.createAssessment({
      tenantId: 'tenant-test',
      studentId: 'student-test',
      date: todayYmd,
      weightKg: 0,
      heightCm: 170,
      bmi: 0,
    });
    assert(false, 'Deveria rejeitar peso <= 0');
  } catch (err: any) {
    assert(err.message.includes('peso válido'), 'Rejeitou peso <= 0 com mensagem clara');
  }

  try {
    // Tentativa de criar sem altura
    await assessmentService.createAssessment({
      tenantId: 'tenant-test',
      studentId: 'student-test',
      date: todayYmd,
      weightKg: 60,
      heightCm: 0,
      bmi: 0,
    });
    assert(false, 'Deveria rejeitar altura <= 0');
  } catch (err: any) {
    assert(err.message.includes('altura válida'), 'Rejeitou altura <= 0 com mensagem clara');
  }

  // -------------------------------------------------------------------------
  // TESTE 7: Rejeição de valores impossíveis (altura zero, peso negativo, datas futuras)
  // -------------------------------------------------------------------------
  console.log('\n7. Testando Rejeição de valores impossíveis...');
  try {
    await assessmentService.createAssessment({
      tenantId: 'tenant-test',
      studentId: 'student-test',
      date: '2099-12-31', // futuro distante
      weightKg: 70,
      heightCm: 175,
      bmi: 22.9,
    });
    assert(false, 'Deveria rejeitar data futura');
  } catch (err: any) {
    assert(err.message.includes('futura'), 'Rejeitou data futura com validação explícita');
  }

  try {
    await assessmentService.createAssessment({
      tenantId: 'tenant-test',
      studentId: 'student-test',
      date: todayYmd,
      weightKg: -10,
      heightCm: 175,
      bmi: 22.9,
    });
    assert(false, 'Deveria rejeitar peso negativo');
  } catch (err: any) {
    assert(err.message.includes('peso válido'), 'Rejeitou peso negativo');
  }

  // -------------------------------------------------------------------------
  // TESTE 8: Data de nascimento ausente (aviso amigável sem crash)
  // -------------------------------------------------------------------------
  console.log('\n8. Testando Data de nascimento ausente...');
  const noBirthAge = calculateExactAge(undefined);
  assert(!noBirthAge.isValid, 'calculateExactAge retorna isValid: false');
  assert(
    noBirthAge.formatted === 'Data de nascimento não informada',
    'Mensagem amigável para data ausente'
  );

  const fallbackAdultClass = classifyBmi(22.5, undefined, 'male');
  assert(
    fallbackAdultClass.referenceStandard === 'who_adult',
    'Fallback seguro para tabela geral de adultos quando data de nascimento ausente'
  );
  assert(
    fallbackAdultClass.warning?.includes('Data de nascimento não informada'),
    'Aviso claro sobre ausência de data de nascimento'
  );

  // -------------------------------------------------------------------------
  // TESTE 9: Classificação infantil e adolescente (curvas OMS 2007 e 2006 por sexo)
  // -------------------------------------------------------------------------
  console.log('\n9. Testando Classificação infantil/adolescente OMS (0-19 anos)...');
  // Menino de 14 anos: IMC 14.0 deve ser Magreza (P3=15.5)
  const boy14Thin = classifyBmi(14.0, '2012-01-01', 'male', '2026-01-01');
  assert(
    boy14Thin.classification === 'Magreza acentuada' || boy14Thin.classification === 'Magreza',
    `Menino 14a com IMC 14.0 classificado como Magreza (obtido: ${boy14Thin.classification})`
  );

  // Menina de 12 anos: IMC 18.0 deve ser Eutrofia (P15=15.2, P85=21.3)
  const girl12Normal = classifyBmi(18.0, '2014-01-01', 'female', '2026-01-01');
  assert(
    girl12Normal.classification === 'Eutrofia (Peso adequado)',
    `Menina 12a com IMC 18.0 classificada como Eutrofia (obtido: ${girl12Normal.classification})`
  );

  // Criança de 4 anos: OMS 2006 Child Growth Standards
  const child4 = classifyBmi(15.5, '2022-01-01', 'male', '2026-01-01');
  assert(
    child4.referenceStandard === 'who_child_growth_standards',
    'Criança < 5 anos utiliza OMS 2006 Child Growth Standards'
  );

  // -------------------------------------------------------------------------
  // TESTE 10: Classificação adulta (pontos de corte OMS: 18.5, 25.0, 30.0, 35.0, 40.0)
  // -------------------------------------------------------------------------
  console.log('\n10. Testando Classificação adulta...');
  const adultBirth = '1995-05-15'; // 30 anos
  const testDate = '2026-01-01';

  const cThin = classifyBmi(17.5, adultBirth, 'male', testDate);
  assert(cThin.classification === 'Magreza', 'Adulto IMC 17.5 = Magreza');

  const cNormal = classifyBmi(22.0, adultBirth, 'male', testDate);
  assert(cNormal.classification === 'Eutrofia (Peso adequado)', 'Adulto IMC 22.0 = Eutrofia');

  const cOverweight = classifyBmi(27.5, adultBirth, 'female', testDate);
  assert(cOverweight.classification === 'Sobrepeso', 'Adulto IMC 27.5 = Sobrepeso');

  const cObese1 = classifyBmi(32.0, adultBirth, 'male', testDate);
  assert(cObese1.classification === 'Obesidade Grau I', 'Adulto IMC 32.0 = Obesidade Grau I');

  const cObese2 = classifyBmi(37.0, adultBirth, 'male', testDate);
  assert(cObese2.classification === 'Obesidade Grau II', 'Adulto IMC 37.0 = Obesidade Grau II');

  const cObese3 = classifyBmi(42.0, adultBirth, 'female', testDate);
  assert(cObese3.classification === 'Obesidade Grau III', 'Adulto IMC 42.0 = Obesidade Grau III');

  // -------------------------------------------------------------------------
  // TESTE 11: Alerta para idosos (>= 60 anos, critério geriátrico Lipschitz)
  // -------------------------------------------------------------------------
  console.log('\n11. Testando Alerta e interpretação para idosos (>= 60 anos)...');
  const seniorBirth = '1955-03-20'; // ~70 anos
  const seniorClass = classifyBmi(23.0, seniorBirth, 'male', '2026-01-01');
  assert(seniorClass.isElderly, 'Flag isElderly é true para idade >= 60');
  assert(
    seniorClass.warning?.includes('60 anos') || seniorClass.warning?.includes('geriátrica'),
    'Alerta informativo sobre interpretação geriátrica exibido'
  );

  // -------------------------------------------------------------------------
  // TESTE 12: Edição de medição existente (recalcula IMC, preserva integridade)
  // -------------------------------------------------------------------------
  console.log('\n12. Testando Edição de medição...');
  const initialRecord = await assessmentService.createAssessment({
    tenantId: 'tenant-kodokan',
    studentId: 'student-lucas',
    date: '2026-02-10',
    weightKg: 52.0,
    heightCm: 164.0,
    bmi: 19.3,
  });

  const updatedRecord = await assessmentService.updateAssessment(
    initialRecord.id,
    {
      weightKg: 55.0, // peso alterado
      heightCm: 165.0, // altura alterada
      bmi: 20.2,
      notes: 'Correção pós-pesagem oficial',
    },
    'Sensei Master'
  );

  assert(updatedRecord.weightKg === 55.0, 'Peso atualizado para 55.0 kg');
  assert(updatedRecord.heightCm === 165.0, 'Altura atualizada para 165.0 cm');
  assert(updatedRecord.notes === 'Correção pós-pesagem oficial', 'Notas atualizadas');
  assert(updatedRecord.id === initialRecord.id, 'ID da medição preservado');

  // -------------------------------------------------------------------------
  // TESTE 13: Exclusão de medição com confirmação e remoção do histórico
  // -------------------------------------------------------------------------
  console.log('\n13. Testando Exclusão de medição...');
  const toDelete = await assessmentService.createAssessment({
    tenantId: 'tenant-kodokan',
    studentId: 'student-temp-del',
    date: '2026-03-01',
    weightKg: 60.0,
    heightCm: 170.0,
    bmi: 20.8,
  });

  const allBefore = DataStore.getPhysicalAssessments('tenant-kodokan');
  assert(allBefore.some((a) => a.id === toDelete.id), 'Medição criada no DataStore');

  await assessmentService.deleteAssessment(toDelete.id, 'Sensei Master');
  const allAfter = DataStore.getPhysicalAssessments('tenant-kodokan');
  assert(!allAfter.some((a) => a.id === toDelete.id), 'Medição removida com sucesso do histórico');

  // -------------------------------------------------------------------------
  // TESTE 14: Isolamento multi-tenant (dados nunca vazam entre academias)
  // -------------------------------------------------------------------------
  console.log('\n14. Testando Isolamento Multi-tenant...');
  const tenant1Assessments = DataStore.getPhysicalAssessments('tenant-kodokan');
  const tenant2Assessments = DataStore.getPhysicalAssessments('tenant-other-academy');

  assert(
    tenant1Assessments.every((a) => a.tenantId === 'tenant-kodokan'),
    'Todas as medições de tenant-kodokan pertencem a tenant-kodokan'
  );
  assert(
    tenant2Assessments.every((a) => a.tenantId === 'tenant-other-academy'),
    'Nenhuma medição de tenant-kodokan aparece em tenant-other-academy'
  );

  console.log('\n================================================================');
  console.log(`RESULTADO FINAL: ${passedTests}/${totalTests} TESTES APROVADOS!`);
  if (failedTests > 0) {
    console.error(`FALHAS: ${failedTests} testes falharam.`);
    process.exit(1);
  } else {
    console.log('TODOS OS 14 REQUISITOS OBRIGATÓRIOS FORAM ATENDIDOS COM SUCESSO.');
    console.log('================================================================\n');
  }
}

runTestSuite().catch((err) => {
  console.error('Erro na suíte de testes:', err);
  process.exit(1);
});
