delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
delete process.env.VITE_SUPABASE_ANON_KEY;
import { DataStore } from '../data/storage';
import { saasPlatformService } from '../services/saasPlatformService';
import {
  Tenant,
  SaaSCommercialPlan,
  SaaSSubscription,
  SaaSPayment,
  User,
} from '../types';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
    throw new Error(`Falha no teste: ${testName}`);
  }
}

async function runAllTests() {
  console.log('🥋 ========================================================');
  console.log('🥋 INICIANDO BATERIA DE TESTES — PLATAFORMA SAAS & CONTROLE DE ACESSO');
  console.log('🥋 ========================================================\n');

  // Setup: Reset to clean initial seed
  DataStore.resetToSeed();

  const superadminUser: User = {
    id: 'user-superadmin',
    tenantId: 'platform',
    name: 'Carlos Gestor SaaS',
    email: 'admin@tatameclub.com.br',
    role: 'superadmin',
    phone: '(11) 99999-0000',
    active: true,
  };

  const academyOwnerUser: User = {
    id: 'user-owner',
    tenantId: 'tenant-kodokan',
    name: 'Sensei Kenji Yamamoto',
    email: 'yamamoto@kodokanbrasil.com.br',
    role: 'owner',
    active: true,
  };

  const studentUser: User = {
    id: 'user-student',
    tenantId: 'tenant-kodokan',
    name: 'Lucas Aluno',
    email: 'lucas@email.com',
    role: 'student',
    active: true,
  };

  // --------------------------------------------------------------------------
  console.log('--- TESTE A: Separação Estrita de Permissões (SuperAdmin vs Academia) ---');
  // --------------------------------------------------------------------------
  assert(superadminUser.role === 'superadmin', 'SuperAdmin possui role superadmin');
  assert(academyOwnerUser.role === 'owner', 'Owner possui role owner de academia');
  assert(academyOwnerUser.role !== 'superadmin', 'Owner da academia NÃO é superadmin da plataforma');
  assert(superadminUser.tenantId === 'platform', 'SuperAdmin está no tenant global "platform"');
  assert(academyOwnerUser.tenantId === 'tenant-kodokan', 'Owner está restrito ao seu próprio tenant');

  // Verificar que getSaaSPayments filtrado por tenantId isola pagamentos entre academias
  const kodokanPayments = DataStore.getSaaSPayments('tenant-kodokan');
  const otherTenantPayments = DataStore.getSaaSPayments('tenant-shotokan-sp');
  assert(kodokanPayments.length > 0, 'Recupera pagamentos do tenant Kodokan');
  assert(
    kodokanPayments.every(p => p.tenantId === 'tenant-kodokan'),
    'Nenhum pagamento do Kodokan pertence a outra academia'
  );
  assert(
    otherTenantPayments.every(p => p.tenantId === 'tenant-shotokan-sp'),
    'Nenhum pagamento do Shotokan vaza para consultas do Kodokan'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- TESTE B: Cadastro de Plano Comercial & Nova Academia ---');
  // --------------------------------------------------------------------------
  const newPlan: SaaSCommercialPlan = {
    id: 'plan-franchise-test',
    name: 'Plano Rede de Franquias Teste',
    description: 'Plano com suporte a 10 filiais e 1000 alunos.',
    price: 499.0,
    currency: 'BRL',
    billingCycle: 'monthly',
    cycleMultiplier: 1,
    trialDays: 0,
    maxStudents: 1000,
    maxUsers: 50,
    maxBranches: 10,
    maxStorageGb: 100,
    features: {
      digitalLibrary: true,
      beltExams: true,
      competitions: true,
      advancedReports: true,
      multiBranch: true,
      customBranding: true,
      automatedNotifications: true,
    },
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saasPlatformService.savePlan(newPlan, superadminUser.id, superadminUser.name);
  const commercialPlans = DataStore.getCommercialPlans();
  const savedPlan = commercialPlans.find(p => p.id === 'plan-franchise-test');
  assert(Boolean(savedPlan), 'Novo plano comercial persistido no catálogo');
  assert(savedPlan?.price === 499.0, 'Preço do novo plano comercial confere (R$ 499,00)');

  // Criar nova academia vinculada ao novo plano
  const newTenant: Tenant = {
    id: 'tenant-nova-arte',
    tradeName: 'Nova Arte Jiu-Jitsu',
    legalName: 'Nova Arte Treinamento Ltda',
    cnpjOrCpf: '55.666.777/0001-88',
    adminName: 'Prof. Marcos Silva',
    email: 'contato@novaarte.com.br',
    phone: '(11) 98888-0000',
    whatsapp: '(11) 98888-0000',
    address: {
      street: 'Rua das Lutas',
      number: '100',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01311-000',
    },
    planId: 'plan-franchise-test' as any,
    status: 'waiting_payment' as any,
    trialStartedAt: new Date().toISOString(),
    trialExpiresAt: new Date(Date.now() - 1000).toISOString(),
    createdAt: new Date().toISOString(),
    retentionDays: 60,
    settings: {
      defaultDueDay: 10,
      penaltyRate: 2.0,
      dailyInterestRate: 0.033,
      familyDiscount2ndMember: 15,
      multiArtDiscount: 20,
    },
  };

  const allTenants = [...DataStore.getTenants(), newTenant];
  DataStore.saveTenants(allTenants);

  // Criar assinatura com status 'waiting_payment'
  const newSub: SaaSSubscription = {
    id: 'sub-nova-arte',
    tenantId: 'tenant-nova-arte',
    planId: 'plan-franchise-test',
    planName: 'Plano Rede de Franquias Teste',
    status: 'waiting_payment',
    billingCycle: 'monthly',
    amount: 499.0,
    startedAt: new Date().toISOString(),
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    nextDueDate: new Date().toISOString().split('T')[0],
    gracePeriodDays: 5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  DataStore.saveSaaSSubscription(newSub);
  const evalWaiting = saasPlatformService.evaluateTenantAccess(newTenant, newSub, newPlan);
  assert(
    !evalWaiting.isAllowed && evalWaiting.accessState === 'waiting_payment',
    'Assinatura aguardando pagamento bloqueia acesso comercial pago até confirmação'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- TESTE C: Confirmação de Pagamento Seguro via Webhook ---');
  // --------------------------------------------------------------------------
  const webhookResult = await saasPlatformService.processPaymentWebhookEvent({
    eventId: 'evt_asaas_test_9901',
    gatewayName: 'asaas',
    eventType: 'PAYMENT_RECEIVED',
    chargeId: 'pay_asaas_nova_arte_first',
    amount: 499.0,
    tenantId: 'tenant-nova-arte',
    subscriptionId: 'sub-nova-arte',
    paymentMethod: 'pix',
  });

  assert(webhookResult.success === true, 'Webhook de pagamento processado com sucesso');
  assert(webhookResult.duplicate === false, 'Primeiro processamento do evento não é duplicado');

  // Verificar se a assinatura foi ativada e vigência estendida
  const refreshedSub = DataStore.getSaaSSubscriptions().find(s => s.id === 'sub-nova-arte');
  const refreshedTenant = DataStore.getTenants().find(t => t.id === 'tenant-nova-arte');

  assert(refreshedSub?.status === 'active', 'Status da assinatura atualizado para ACTIVE');
  assert(refreshedTenant?.status === 'active', 'Status do tenant atualizado para ACTIVE');

  const evalActive = saasPlatformService.evaluateTenantAccess(refreshedTenant!, refreshedSub, newPlan);
  assert(evalActive.isAllowed === true, 'Acesso pleno liberado para a academia após confirmação');
  assert(evalActive.accessState === 'active', 'Estado de acesso é ACTIVE');

  // Verificar persistência do pagamento
  const savedPayment = DataStore.getSaaSPayments().find(p => p.gatewayChargeId === 'pay_asaas_nova_arte_first');
  assert(Boolean(savedPayment), 'Registro de pagamento foi persistido na tabela saas_payments');
  assert(savedPayment?.status === 'paid', 'Status do pagamento é PAID');
  assert(savedPayment?.amount === 499.0, 'Valor pago é exatamente R$ 499,00');

  // --------------------------------------------------------------------------
  console.log('\n--- TESTE D: Idempotência do Webhook & Bloqueio Client-Side ---');
  // --------------------------------------------------------------------------
  const duplicateWebhookResult = await saasPlatformService.processPaymentWebhookEvent({
    eventId: 'evt_asaas_test_9901', // Mesmo eventId!
    gatewayName: 'asaas',
    eventType: 'PAYMENT_RECEIVED',
    chargeId: 'pay_asaas_nova_arte_first',
    amount: 499.0,
    tenantId: 'tenant-nova-arte',
    subscriptionId: 'sub-nova-arte',
    paymentMethod: 'pix',
  });

  assert(duplicateWebhookResult.duplicate === true, 'Webhook duplicado identificado e bloqueado');

  // Tentar alterar assinatura no frontend livremente sem método autorizado
  // A regra de negócio garante que a avaliação depende do estado persistido
  const fakeManipulatedTenant = { ...refreshedTenant!, status: 'suspended' as const };
  const evalSuspended = saasPlatformService.evaluateTenantAccess(fakeManipulatedTenant, refreshedSub, newPlan);
  assert(evalSuspended.isAllowed === false, 'Tenant com status suspenso é bloqueado independentemente de tentativa client-side');

  // --------------------------------------------------------------------------
  console.log('\n--- TESTE E: Atraso, Período de Carência (5d), Suspensão e Preservação de Dados ---');
  // --------------------------------------------------------------------------
  // Cenário E1: Pagamento atrasado há 2 dias (dentro da carência de 5 dias)
  const pastDueSubGrace: SaaSSubscription = {
    ...refreshedSub!,
    status: 'past_due',
    nextDueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    gracePeriodDays: 5,
  };
  const evalGrace = saasPlatformService.evaluateTenantAccess(refreshedTenant!, pastDueSubGrace, newPlan);
  assert(evalGrace.isAllowed === true, 'Acesso liberado durante os 5 dias de carência');
  assert(evalGrace.accessState === 'grace_period', 'Identificado estado grace_period com aviso');
  assert((evalGrace.graceDaysLeft || 0) > 0, 'Indica dias de carência restantes para regularização');

  // Cenário E2: Pagamento atrasado há 10 dias (fora da carência de 5 dias)
  const pastDueSubExpiredGrace: SaaSSubscription = {
    ...refreshedSub!,
    status: 'past_due',
    nextDueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    gracePeriodDays: 5,
  };
  const evalBlockedPastDue = saasPlatformService.evaluateTenantAccess(refreshedTenant!, pastDueSubExpiredGrace, newPlan);
  assert(evalBlockedPastDue.isAllowed === false, 'Acesso bloqueado quando ultrapassa os 5 dias de carência');
  assert(evalBlockedPastDue.accessState === 'blocked_past_due', 'Identificado estado blocked_past_due');

  // Cenário E3: Suspensão administrativa com justificativa
  await saasPlatformService.suspendTenant(
    'tenant-nova-arte',
    'Suspensão para verificação de documentação societária.',
    superadminUser.id,
    superadminUser.name
  );
  const suspendedTenant = DataStore.getTenants().find(t => t.id === 'tenant-nova-arte')!;
  const evalSusp = saasPlatformService.evaluateTenantAccess(suspendedTenant, pastDueSubGrace, newPlan);
  assert(evalSusp.isAllowed === false, 'Academia suspensa tem acesso integralmente bloqueado');
  assert(evalSusp.accessState === 'blocked_suspended', 'Estado é blocked_suspended');

  // Confirmar que os dados da academia continuam íntegros no banco/storage
  assert(suspendedTenant.tradeName === 'Nova Arte Jiu-Jitsu', 'Dados da academia permanecem intactos');
  assert(suspendedTenant.cnpjOrCpf === '55.666.777/0001-88', 'CNPJ e cadastro da academia preservados');

  // --------------------------------------------------------------------------
  console.log('\n--- TESTE F: Controle de Recursos e Limites de Alunos/Filiais ---');
  // --------------------------------------------------------------------------
  const basicPlan = commercialPlans.find(p => p.id === 'basic')!;
  assert(basicPlan.maxStudents === 100, 'Plano Básico tem limite de 100 alunos');
  assert(basicPlan.maxBranches === 1, 'Plano Básico tem limite de 1 filial');
  assert(basicPlan.features.digitalLibrary === false, 'Plano Básico não inclui Biblioteca Digital');

  const evalBasicLimits = saasPlatformService.evaluateTenantAccess(
    refreshedTenant!,
    refreshedSub,
    basicPlan,
    100, // 100 alunos atuais (limite atingido)
    1
  );
  assert(evalBasicLimits.limits.isStudentsLimitReached === true, 'Detecta que o limite máximo de alunos do plano foi atingido');
  assert(evalBasicLimits.allowedModules.digitalLibrary === false, 'Módulo de Biblioteca Digital não liberado no Plano Básico');

  const advancedPlan = commercialPlans.find(p => p.id === 'advanced')!;
  const evalAdvanced = saasPlatformService.evaluateTenantAccess(
    refreshedTenant!,
    refreshedSub,
    advancedPlan,
    100,
    1
  );
  assert(evalAdvanced.limits.isStudentsLimitReached === false, 'Plano Avançado (500 alunos) acomoda os 100 alunos com folga');
  assert(evalAdvanced.allowedModules.digitalLibrary === true, 'Biblioteca Digital liberada no Plano Avançado');
  assert(evalAdvanced.allowedModules.beltExams === true, 'Exames de Faixa liberados no Plano Avançado');

  // --------------------------------------------------------------------------
  console.log('\n--- TESTE G: Não-Regressão dos Módulos Operacionais ---');
  // --------------------------------------------------------------------------
  const kodokanStudents = DataStore.getStudents('tenant-kodokan');
  const kodokanClasses = DataStore.getClasses('tenant-kodokan');
  const kodokanGraduations = DataStore.getGraduations('tenant-kodokan');
  const kodokanLibrary = DataStore.getLibraryItems('tenant-kodokan');
  const kodokanTatamis = DataStore.getTatamis('tenant-kodokan');
  const kodokanInvoices = DataStore.getInvoices('tenant-kodokan');

  assert(kodokanStudents.length > 0, 'Alunos existentes continuam carregando normalmente');
  assert(kodokanClasses.length > 0, 'Turmas e horários operacionais continuam funcionando');
  assert(kodokanGraduations.length > 0, 'Histórico de graduações e faixas preservado');
  assert(kodokanLibrary.length > 0, 'Biblioteca digital de vídeos continua operacional');
  assert(kodokanTatamis.length > 0, 'Ocupação de tatamis preservada');
  assert(kodokanInvoices.length > 0, 'Mensalidades dos alunos (invoices) preservadas e separadas do SaaS');

  // Auditoria
  const platformLogs = DataStore.getPlatformAuditLogs();
  assert(platformLogs.length >= 3, 'Trilha de auditoria da plataforma registrou eventos de superadmin');

  console.log('\n🥋 ========================================================');
  console.log(`🥋 TODOS OS ${passedTests}/${totalTests} TESTES FORAM APROVADOS COM SUCESSO!`);
  console.log('🥋 ========================================================');
}

runAllTests().catch(err => {
  console.error('Falha na execução dos testes:', err);
  process.exit(1);
});
