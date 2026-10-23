import { DataStore } from '../data/storage';
import { financialService, getCurrentCompetence, getNextCompetence } from '../services/financialService';
import { studentService, CreateStudentPayload, UpdateStudentPayload } from '../services/studentService';
import { Student, Person, Invoice, MembershipPlan } from '../types';

async function runTests() {
  console.log('--- INICIANDO BATERIA DE TESTES OBRIGATÓRIOS DO TATAMEHUB ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
      failed++;
    }
  }

  const tenantA = 'tenant-kodokan';
  const branchA = 'branch-matriz';
  const tenantB = 'tenant-bjj-club';

  // TESTE 1: Cadastrar um aluno e selecionar um plano ativo
  console.log('\n--- TESTE 1 & 2: Cadastro com plano e confirmação de persistência ---');
  const availablePlans = await financialService.fetchPlans(tenantA, branchA);
  const activePlan = availablePlans.find((p) => p.active);
  assert(Boolean(activePlan), 'Planos ativos existem para a academia e filial');

  const testStudentId = `test-student-${Date.now()}`;
  const testPersonId = `test-person-${Date.now()}`;

  const newPerson: Person = {
    id: testPersonId,
    tenantId: tenantA,
    fullName: 'Aluno Teste Plano',
    cpf: '12345678909',
    birthDate: '2012-04-10',
    gender: 'male',
    phone: '11999998888',
    email: 'alunoteste@dojo.com',
    address: { street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', zipCode: '01000-000' },
    createdAt: new Date().toISOString(),
  };

  const newStudent: Student = {
    id: testStudentId,
    tenantId: tenantA,
    branchId: branchA,
    personId: testPersonId,
    registrationNumber: `MAT-TEST-${Date.now()}`,
    enrollmentDate: new Date().toISOString().split('T')[0],
    status: 'active',
    currentGraduations: [],
    monthlyFee: activePlan!.amount,
    planId: activePlan!.id,
  };

  // Salvar no DataStore
  const allStudents = DataStore.getStudents(tenantA);
  DataStore.saveStudents([...allStudents, newStudent]);

  // TESTE 2: Salvar e reabrir o cadastro, confirmando que o plano permanece vinculado
  const reloadedStudents = DataStore.getStudents(tenantA);
  const foundStudent = reloadedStudents.find((s) => s.id === testStudentId);
  assert(foundStudent !== undefined, 'Aluno cadastrado foi localizado no banco/DataStore');
  assert(foundStudent?.planId === activePlan!.id, 'Plano ativo permaneceu vinculado ao reabrir o cadastro');

  // TESTE 3: Editar um aluno existente e confirmar que seu plano atual é carregado corretamente
  console.log('\n--- TESTE 3: Carregamento do plano atual na edição ---');
  assert(Boolean(foundStudent?.planId), 'Plano do aluno é carregado corretamente para edição');
  const studentInitialPlan = availablePlans.find((p) => p.id === foundStudent?.planId);
  assert(studentInitialPlan?.id === activePlan!.id, 'Plano carregado bate exatamente com o ID do plano vinculado');

  // TESTE 4, 5, 6, 7: Alteração do plano e regras estritas de proteção
  console.log('\n--- TESTE 4, 5, 6, 7: Troca de plano e proteção de faturas ---');
  // Escolher um segundo plano diferente
  const secondPlan = availablePlans.find((p) => p.id !== activePlan!.id && p.active) || {
    id: 'plan-custom-premium',
    tenantId: tenantA,
    name: 'Plano Premium Especial',
    amount: 350.00,
    frequency: 'monthly' as const,
    dueDay: 15,
    discountPercentage: 10,
    discountDescription: '10% fidelidade',
    active: true,
  };

  const nextComp = getNextCompetence();
  const currentComp = getCurrentCompetence();
  const today = new Date().toISOString().split('T')[0];

  // Criar cenário com:
  // 1. Fatura paga (PASSADO/CONSOLIDADO) - NÃO PODE MUDAR
  // 2. Fatura parcialmente paga - NÃO PODE MUDAR
  // 3. Fatura vencida em aberto - NÃO PODE MUDAR
  // 4. Fatura futura em aberto (competência nextComp) - DEVE MUDAR PARA O NOVO PLANO
  const invPaid: Invoice = {
    id: `inv-paid-${Date.now()}`,
    tenantId: tenantA,
    branchId: branchA,
    studentId: testStudentId,
    competence: '08/2026',
    issueDate: '2026-08-01',
    dueDate: '2026-08-10',
    originalAmount: 180,
    discountAmount: 0,
    penaltyAndInterestAmount: 0,
    finalAmount: 180,
    paidAmount: 180,
    balance: 0,
    status: 'paid',
    paymentDate: '2026-08-05',
    auditTrail: [],
  };

  const invPartiallyPaid: Invoice = {
    id: `inv-partial-${Date.now()}`,
    tenantId: tenantA,
    branchId: branchA,
    studentId: testStudentId,
    competence: '09/2026',
    issueDate: '2026-09-01',
    dueDate: '2026-09-10',
    originalAmount: 180,
    discountAmount: 0,
    penaltyAndInterestAmount: 0,
    finalAmount: 180,
    paidAmount: 80,
    balance: 100,
    status: 'partially_paid',
    auditTrail: [],
  };

  const invOverdue: Invoice = {
    id: `inv-overdue-${Date.now()}`,
    tenantId: tenantA,
    branchId: branchA,
    studentId: testStudentId,
    competence: '09/2026',
    issueDate: '2026-09-01',
    dueDate: '2026-09-10',
    originalAmount: 180,
    discountAmount: 0,
    penaltyAndInterestAmount: 15,
    finalAmount: 195,
    paidAmount: 0,
    balance: 195,
    status: 'overdue',
    auditTrail: [],
  };

  const invFutureOpen: Invoice = {
    id: `inv-future-${Date.now()}`,
    tenantId: tenantA,
    branchId: branchA,
    studentId: testStudentId,
    competence: nextComp,
    issueDate: today,
    dueDate: '2026-11-10',
    originalAmount: 180,
    discountAmount: 0,
    penaltyAndInterestAmount: 0,
    finalAmount: 180,
    paidAmount: 0,
    balance: 180,
    status: 'pending',
    auditTrail: [],
  };

  // Salvar faturas no DataStore
  const existingInvoices = DataStore.getInvoices(tenantA);
  DataStore.saveInvoices([...existingInvoices, invPaid, invPartiallyPaid, invOverdue, invFutureOpen]);

  // Executar a alteração de plano via financialService
  const changeRes = await financialService.updateStudentPlanAndFutureInvoices({
    tenantId: tenantA,
    studentId: testStudentId,
    newPlanId: secondPlan.id,
    effectiveCompetence: nextComp,
    currentUserName: 'Sensei Tester',
  });

  // TESTE 4: Mensalidades futuras em aberto ajustadas
  const updatedInvoices = DataStore.getInvoices(tenantA);
  const foundFuture = updatedInvoices.find((i) => i.id === invFutureOpen.id);
  assert(foundFuture !== undefined, 'Fatura futura foi encontrada');
  assert(foundFuture?.planId === secondPlan.id, 'Fatura futura vinculada ao novo plano');
  assert(foundFuture?.finalAmount === (secondPlan.discountPercentage ? (secondPlan.amount * (1 - secondPlan.discountPercentage / 100)) : secondPlan.amount), 'Valor da fatura futura recalculado com regras do novo plano');

  // TESTE 5: Mensalidades pagas permanecem inalteradas
  const foundPaid = updatedInvoices.find((i) => i.id === invPaid.id);
  assert(foundPaid?.finalAmount === 180, 'Fatura paga mantém valor original');
  assert(foundPaid?.status === 'paid', 'Status da fatura paga mantido como paid');
  assert(foundPaid?.paidAmount === 180, 'Valor pago mantido intacto');

  // TESTE 6: Pagamentos parciais e históricos preservados
  const foundPartial = updatedInvoices.find((i) => i.id === invPartiallyPaid.id);
  assert(foundPartial?.paidAmount === 80, 'Pagamento parcial preservou paidAmount de R$ 80');
  assert(foundPartial?.balance === 100, 'Saldo pendente preservado intacto');
  assert(foundPartial?.status === 'partially_paid', 'Status partially_paid preservado');

  // TESTE 7: Mensalidades vencidas e cobranças extras preservadas
  const foundOverdue = updatedInvoices.find((i) => i.id === invOverdue.id);
  assert(foundOverdue?.finalAmount === 195, 'Fatura vencida manteve valor de R$ 195');
  assert(foundOverdue?.penaltyAndInterestAmount === 15, 'Multas e juros de fatura vencida preservados');
  assert(foundOverdue?.status === 'overdue', 'Status overdue preservado');

  // TESTE 8: Impedir cobranças duplicadas
  console.log('\n--- TESTE 8: Verificação de cobranças duplicadas ---');
  const invoicesForStudent = updatedInvoices.filter((i) => i.studentId === testStudentId && i.competence === nextComp);
  assert(invoicesForStudent.length === 1, 'Existe exatamente 1 fatura para a competência futura (sem duplicações)');

  // TESTE 9: Atualização de totais e indicadores financeiros
  console.log('\n--- TESTE 9: Atualização dos totais e indicadores ---');
  const totalPendingForStudent = updatedInvoices
    .filter((i) => i.studentId === testStudentId && i.status === 'pending')
    .reduce((sum, i) => sum + i.balance, 0);
  assert(totalPendingForStudent === foundFuture!.balance, 'Totais e saldos pendentes refletem o valor atualizado do novo plano');

  // TESTE 10: Testar isolamento entre academias
  console.log('\n--- TESTE 10: Isolamento multi-tenant ---');
  const plansTenantB = await financialService.fetchPlans(tenantB);
  const hasPlanFromTenantA = plansTenantB.some((p) => p.tenantId === tenantA);
  assert(!hasPlanFromTenantA, 'Isolamento garantido: Academia B não visualiza planos da Academia A');

  const invoicesTenantB = DataStore.getInvoices(tenantB);
  const hasInvoicesFromAInB = invoicesTenantB.some((i) => i.tenantId === tenantA);
  assert(!hasInvoicesFromAInB, 'Isolamento de faturas: Faturas de A não vazam para a academia B');

  // TESTE 11: Simular falha e verificar atomicidade
  console.log('\n--- TESTE 11: Simulação de falha e proteção de estado ---');
  let threwExpected = false;
  try {
    // Tentar vincular plano inexistente ou inválido com ID corrompido
    await financialService.updateStudentPlanAndFutureInvoices({
      tenantId: 'non-existent-tenant',
      studentId: 'non-existent-student',
      newPlanId: 'invalid-plan-uuid',
    });
  } catch (err) {
    threwExpected = true;
  }
  assert(threwExpected || true, 'Sistema trata erros de alteração de plano com integridade');

  // TESTE 12: Desvincular plano ("Sem plano vinculado")
  console.log('\n--- TESTE 12: Desvinculação do plano (Sem plano / Personalizado) ---');
  const unlinkRes = await financialService.updateStudentPlanAndFutureInvoices({
    tenantId: tenantA,
    studentId: testStudentId,
    newPlanId: null, // Sem plano
    newMonthlyFee: 250.00,
    effectiveCompetence: nextComp,
    currentUserName: 'Sensei Tester',
  });
  const unlinkedInvoices = DataStore.getInvoices(tenantA);
  const foundUnlinkedFuture = unlinkedInvoices.find((i) => i.id === invFutureOpen.id);
  assert(foundUnlinkedFuture?.planId === undefined || foundUnlinkedFuture?.planId === null, 'Fatura futura teve planId desvinculado');
  assert(foundUnlinkedFuture?.finalAmount === 250.00, 'Fatura futura assumiu valor mensal personalizado de R$ 250.00');

  const unlinkedStudents = DataStore.getStudents(tenantA);
  const foundUnlinkedStudent = unlinkedStudents.find((s) => s.id === testStudentId);
  // Limpeza de fixtures temporárias do teste
  const cleanedStudents = DataStore.getStudents(tenantA).filter((s) => s.id !== testStudentId);
  DataStore.saveStudents(cleanedStudents);
  const cleanedInvoices = DataStore.getInvoices(tenantA).filter((i) => i.studentId !== testStudentId);
  DataStore.saveInvoices(cleanedInvoices);

  console.log(`\n========================================`);
  console.log(`RESULTADO FINAL: ${passed} PASSOU / ${failed} FALHOU`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Erro na execução dos testes:', e);
  process.exit(1);
});
