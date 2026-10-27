import { saasPlatformService } from '../services/saasPlatformService';
import { DataStore } from '../data/storage';
import { Tenant, SaaSCommercialPlan } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ [PASS] ${message}`);
}

async function runTestSuite() {
  console.log('🥋 ========================================================');
  console.log('🥋 TESTES: FLUXO DE SOLICITAÇÃO DE PLANO SAAS E PIX');
  console.log('🥋 ========================================================');

  // Setup Mock Tenant
  const testTenantId = 'tenant-test-pix-flow';
  const testTenant: Tenant = {
    id: testTenantId,
    tradeName: 'Dojo Teste Pix',
    legalName: 'Dojo Teste Pix Ltda',
    cnpjOrCpf: '12.345.678/0001-99',
    adminName: 'Sensei Teste',
    email: 'admin@dojopix.com.br',
    phone: '(11) 97777-6666',
    whatsapp: '(11) 97777-6666',
    address: {
      street: 'Rua do Tatame',
      number: '100',
      neighborhood: 'Bairro',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01000-000',
    },
    planId: 'trial',
    status: 'trial',
    trialStartedAt: new Date().toISOString(),
    trialExpiresAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    retentionDays: 60,
    settings: {
      defaultDueDay: 10,
      penaltyRate: 2,
      dailyInterestRate: 0.033,
      familyDiscount2ndMember: 15,
      multiArtDiscount: 20,
      customBrandColor: '#dc2626',
    },
  };

  const existingTenants = DataStore.getTenants();
  DataStore.saveTenants([testTenant, ...existingTenants.filter(t => t.id !== testTenantId)]);

  console.log('\n--- CENÁRIO 1: Validação de Ciclos de Cobrança e Descontos Pix ---');
  const planAdvanced = DataStore.getCommercialPlans().find(p => p.id === 'advanced')!;
  assert(Boolean(planAdvanced), 'Plano Avançado encontrado no catálogo comercial');

  const monthlyPrice = saasPlatformService.calculatePlanCyclePricing(planAdvanced, 'monthly');
  assert(monthlyPrice.totalAmount === 299.00, 'Ciclo Mensal totaliza R$ 299.00');

  const quarterlyPrice = saasPlatformService.calculatePlanCyclePricing(planAdvanced, 'quarterly');
  assert(quarterlyPrice.totalAmount === 852.15, 'Ciclo Trimestral com 5% de desconto calcula R$ 852.15');

  const semiannualPrice = saasPlatformService.calculatePlanCyclePricing(planAdvanced, 'semiannual');
  assert(semiannualPrice.totalAmount === 1614.60, 'Ciclo Semestral com 10% de desconto calcula R$ 1614.60');

  const annualPrice = saasPlatformService.calculatePlanCyclePricing(planAdvanced, 'annual');
  assert(annualPrice.totalAmount === 3049.80 || annualPrice.totalAmount === 2990.00, 'Ciclo Anual com desconto calcula corretamente');

  console.log('\n--- CENÁRIO 2: Rejeição de Dados Inválidos ---');
  let rejectedTrial = false;
  try {
    await saasPlatformService.requestPlanSubscriptionAndSendEmail({
      tenantId: testTenantId,
      planId: 'trial',
      billingCycle: 'monthly',
    });
  } catch (err: any) {
    rejectedTrial = true;
    assert(err.message.includes('plano comercial válido'), 'Rejeitou tentativa de contratar plano trial como comercial');
  }
  assert(rejectedTrial, 'Tentativa de contratação do trial bloqueada');

  let rejectedCycle = false;
  try {
    await saasPlatformService.requestPlanSubscriptionAndSendEmail({
      tenantId: testTenantId,
      planId: 'advanced',
      billingCycle: 'biennial' as any,
    });
  } catch (err: any) {
    rejectedCycle = true;
    assert(err.message.includes('Ciclo de cobrança inválido'), 'Rejeitou ciclo de cobrança não suportado');
  }
  assert(rejectedCycle, 'Ciclo inválido bloqueado com sucesso');

  console.log('\n--- CENÁRIO 3: Solicitação Válida de Plano Comercial com Chave Pix ---');
  const requestResult = await saasPlatformService.requestPlanSubscriptionAndSendEmail({
    tenantId: testTenantId,
    planId: 'advanced',
    billingCycle: 'quarterly',
    recipientEmail: 'financeiro@dojopix.com.br',
    actorUserName: 'Sensei Teste',
  });

  assert(Boolean(requestResult), 'Solicitação de plano processada');
  assert(requestResult.subscription.status === 'pending_payment', 'Status da assinatura definido como pending_payment (não ativa prematuramente)');
  assert(requestResult.subscription.requestedPlanId === 'advanced', 'requestedPlanId registrado como advanced');
  assert(requestResult.payment.status === 'pending', 'Pagamento registrado com status pending');
  assert(requestResult.payment.amount === quarterlyPrice.totalAmount, 'Valor do pagamento confere com cálculo do ciclo trimestral');
  assert(requestResult.payment.paymentMethod === 'pix', 'Método de pagamento é Pix');
  assert(requestResult.payment.pixKey === '28410730000180', 'Chave Pix oficial da Beaver Soluções é utilizada');
  assert(Boolean(requestResult.payment.referenceId), 'Código de identificador/referência TC-... gerado para o comprovante');

  console.log('\n--- CENÁRIO 4: Idempotência Contra Múltiplos Cliques ou Repetição ---');
  const secondRequest = await saasPlatformService.requestPlanSubscriptionAndSendEmail({
    tenantId: testTenantId,
    planId: 'advanced',
    billingCycle: 'quarterly',
    recipientEmail: 'financeiro@dojopix.com.br',
    actorUserName: 'Sensei Teste',
  });

  assert(secondRequest.reusedExistingPayment === true, 'Identificou pagamento idêntico pendente e ativou idempotência (reusedExistingPayment: true)');
  assert(secondRequest.payment.id === requestResult.payment.id, 'Preservou o mesmo identificador de pagamento sem criar cobranças duplicadas');

  console.log('\n--- CENÁRIO 5: Não Liberação Prematura de Acesso ---');
  const evaluatedAccess = saasPlatformService.evaluateTenantAccess(
    { ...testTenant, status: 'trial', planId: 'trial' },
    secondRequest.subscription,
    planAdvanced,
    10,
    1
  );
  // Se o trial tiver expirado, o status pending_payment deve manter o acesso bloqueado até validação real
  const expiredTenant: Tenant = {
    ...testTenant,
    status: 'expired',
    planId: 'trial',
    trialExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  };
  const evaluatedBlocked = saasPlatformService.evaluateTenantAccess(
    expiredTenant,
    secondRequest.subscription,
    planAdvanced,
    10,
    1
  );
  assert(evaluatedBlocked.isAllowed === false, 'Academia com trial expirado e pagamento pendente permanece bloqueada até aprovação do Pix');

  console.log('\n🥋 ========================================================');
  console.log('🥋 TODOS OS TESTES DO FLUXO PIX FORAM APROVADOS COM SUCESSO!');
  console.log('🥋 ========================================================');
}

runTestSuite();
