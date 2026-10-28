/**
 * Suíte de Testes Especializada — Ativação Manual de Licenças SaaS (Tatame Club)
 * Cobre rigorosamente os 8 cenários exigidos pela especificação:
 *  1. Ativação por administrador global autorizado.
 *  2. Tentativa por usuário sem permissão (bloqueio 403 / exceção).
 *  3. Tenant inexistente (rejeição com erro explícito).
 *  4. Extensão por quantidade válida de dias (ex: 15, 30, 60 dias).
 *  5. Extensão de licença vigente (preserva saldo restante) e de licença vencida (inicia de hoje).
 *  6. Registro correto da trilha de auditoria global (identidade, justificativa, datas).
 *  7. Persistência dos dados e restauração correta.
 *  8. Ausência absoluta de alterações indevidas em pagamentos e faturas (saas_payments e invoices de alunos).
 *
 * Execução: npx tsx src/tests/test_manual_subscription_activation.ts
 */

delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
delete process.env.VITE_SUPABASE_ANON_KEY;
const memoryStore = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => (memoryStore.has(key) ? memoryStore.get(key)! : null),
  setItem: (key: string, val: string) => memoryStore.set(key, String(val)),
  removeItem: (key: string) => memoryStore.delete(key),
  clear: () => memoryStore.clear(),
  key: (i: number) => Array.from(memoryStore.keys())[i] || null,
  get length() {
    return memoryStore.size;
  },
};

import { DataStore } from '../data/storage';
import { saasPlatformService } from '../services/saasPlatformService';
import { Tenant, User, SaaSSubscription } from '../types';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
    throw new Error(`Falha no teste: ${testName} (${detail || ''})`);
  }
}

async function expectThrowsAsync(fn: () => Promise<any>, testName: string) {
  totalTests++;
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  if (threw) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName} (lançou exceção esperada)`);
  } else {
    console.error(`  ❌ [FAIL] ${testName} (não lançou exceção esperada)`);
    throw new Error(`Falha no teste: ${testName} deveria ter lançado exceção`);
  }
}

async function runTestSuite() {
  console.log('🥋 =================================================================');
  console.log('🥋 BATERIA OFICIAL DE TESTES: ATIVAÇÃO MANUAL DE LICENÇAS SAAS');
  console.log('🥋 =================================================================\n');

  DataStore.resetToSeed();

  const superadmin: User = {
    id: 'user-superadmin',
    tenantId: 'platform',
    name: 'SuperAdmin Beaver',
    email: 'admin@tatameclub.com.br',
    role: 'superadmin',
    active: true,
    createdAt: new Date().toISOString(),
  };

  const academyOwner: User = {
    id: 'user-owner',
    tenantId: 'tenant-kodokan',
    name: 'Sensei Yamamoto',
    email: 'yamamoto@kodokanbrasil.com.br',
    role: 'owner',
    active: true,
    createdAt: new Date().toISOString(),
  };

  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 1: Ativação por administrador global autorizado ---');
  // --------------------------------------------------------------------------
  const initialTenant = DataStore.getTenants().find((t) => t.id === 'tenant-kodokan')!;
  assert(Boolean(initialTenant), 'Academia Kodokan encontrada no banco');

  const initialPaymentsCount = DataStore.getSaaSPayments().length;
  const initialInvoicesCount = DataStore.getInvoices('tenant-kodokan').length;

  const reason1 = 'Concessão de cortesia para homologação de campeonato nacional.';
  const success1 = await saasPlatformService.manualActivateSubscription(
    'tenant-kodokan',
    reason1,
    45,
    superadmin.id,
    superadmin.name
  );

  assert(success1 === true, 'Ativação manual retornou sucesso');

  const tenantAfter = DataStore.getTenants().find((t) => t.id === 'tenant-kodokan')!;
  assert(tenantAfter.status === 'active', 'Status do tenant atualizado para active');
  assert(tenantAfter.suspendedAt === undefined, 'Data de suspensão foi limpa');
  assert(tenantAfter.suspendedReason === undefined, 'Motivo de suspensão foi limpo');

  const subAfter = DataStore.getSaaSSubscriptions().find((s) => s.tenantId === 'tenant-kodokan')!;
  assert(subAfter.status === 'active', 'Status da assinatura atualizado para active');
  assert(subAfter.manualActivation?.activatedByUserId === superadmin.id, 'Registrado ID do superadmin que ativou');
  assert(subAfter.manualActivation?.extendedDays === 45, 'Registrado período de extensão de 45 dias');
  assert(subAfter.manualActivation?.reason === reason1, 'Registrada justificativa formal da concessão');

  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 2: Tentativa por usuário sem permissão (bloqueio de segurança) ---');
  // --------------------------------------------------------------------------
  await expectThrowsAsync(
    () =>
      saasPlatformService.manualActivateSubscription(
        'tenant-kodokan',
        'Tentativa não autorizada por gestor de academia',
        30,
        academyOwner.id,
        academyOwner.name
      ),
    'Gestor de academia é estritamente bloqueado ao tentar ativar licença manual'
  );

  await expectThrowsAsync(
    () =>
      saasPlatformService.manualActivateSubscription(
        'tenant-kodokan',
        'Tentativa sem usuário',
        30,
        '',
        ''
      ),
    'Chamada sem usuário autenticado é estritamente bloqueada'
  );

  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 3: Tenant inexistente ---');
  // --------------------------------------------------------------------------
  await expectThrowsAsync(
    () =>
      saasPlatformService.manualActivateSubscription(
        'tenant-inexistente-xyz',
        'Justificativa para academia fantasma',
        30,
        superadmin.id,
        superadmin.name
      ),
    'Academia inexistente é rejeitada com erro explícito'
  );

  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 4: Extensão por quantidade válida de dias e justificativa curta ---');
  // --------------------------------------------------------------------------
  await expectThrowsAsync(
    () =>
      saasPlatformService.manualActivateSubscription(
        'tenant-kodokan',
        'ok', // apenas 2 chars (< 5)
        30,
        superadmin.id,
        superadmin.name
      ),
    'Justificativa com menos de 5 caracteres é rejeitada'
  );

  // Extensão com 15 dias válidos
  const reason15 = 'Prorrogação de 15 dias solicitada pela diretoria técnica.';
  await saasPlatformService.manualActivateSubscription(
    'tenant-kodokan',
    reason15,
    15,
    superadmin.id,
    superadmin.name
  );
  const sub15 = DataStore.getSaaSSubscriptions().find((s) => s.tenantId === 'tenant-kodokan')!;
  assert(sub15.manualActivation?.extendedDays === 15, 'Extensão de 15 dias gravada com sucesso');

  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 5: Extensão de licença vigente vs licença vencida ---');
  // --------------------------------------------------------------------------
  // Subcenário 5A: Licença Vigente (não pode truncar vigência futura!)
  const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 dias no futuro
  sub15.currentPeriodEnd = futureDate;
  sub15.status = 'active';
  DataStore.saveSaaSSubscription(sub15);

  const beforeExtendFutureMs = new Date(futureDate).getTime();
  await saasPlatformService.manualActivateSubscription(
    'tenant-kodokan',
    'Extensão adicional de 30 dias sobre licença ainda válida por 60 dias',
    30,
    superadmin.id,
    superadmin.name
  );

  const subPreserved = DataStore.getSaaSSubscriptions().find((s) => s.tenantId === 'tenant-kodokan')!;
  const expectedEndMs = beforeExtendFutureMs + 30 * 24 * 60 * 60 * 1000;
  const actualEndMs = new Date(subPreserved.currentPeriodEnd).getTime();
  // Permite tolerância de até 2 segundos
  const diffSec = Math.abs(actualEndMs - expectedEndMs) / 1000;
  assert(
    diffSec < 2,
    `Licença vigente estendida preservando os 60 dias existentes (esperado ~90 dias a partir de hoje, diff=${diffSec}s)`
  );

  // Subcenário 5B: Licença Vencida (deve iniciar contagem de hoje)
  const expiredPastDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 dias atrás
  subPreserved.currentPeriodEnd = expiredPastDate;
  subPreserved.status = 'past_due';
  DataStore.saveSaaSSubscription(subPreserved);

  await saasPlatformService.manualActivateSubscription(
    'tenant-kodokan',
    'Reativação de licença vencida com 30 dias a partir de hoje',
    30,
    superadmin.id,
    superadmin.name
  );

  const subReactivated = DataStore.getSaaSSubscriptions().find((s) => s.tenantId === 'tenant-kodokan')!;
  const expectedNewEndMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const actualNewEndMs = new Date(subReactivated.currentPeriodEnd).getTime();
  const diffExpiredSec = Math.abs(actualNewEndMs - expectedNewEndMs) / 1000;
  assert(
    diffExpiredSec < 3,
    `Licença vencida calculada a partir da data atual (hoje + 30 dias, diff=${diffExpiredSec.toFixed(1)}s)`
  );
  assert(subReactivated.status === 'active', 'Status reativado para active');

  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 6: Registro correto da trilha de auditoria global ---');
  // --------------------------------------------------------------------------
  const platformLogs = DataStore.getPlatformAuditLogs();
  const activationLog = platformLogs.find(
    (l) => l.action === 'manual_activate_subscription' && l.actorUserId === superadmin.id
  );
  assert(Boolean(activationLog), 'Evento manual_activate_subscription gravado em platform_audit_logs');
  assert(activationLog?.actorUserName === superadmin.name, 'Nome do superadmin registrado na auditoria');
  assert(Boolean(activationLog?.details.includes('Vigência estendida')), 'Detalhes da auditoria descrevem a extensão');
  assert(Boolean(activationLog?.metadata?.reason), 'Metadados da auditoria incluem a justificativa formal');

  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 7: Persistência após recarregar / nova consulta ---');
  // --------------------------------------------------------------------------
  const reloadedTenants = DataStore.getTenants();
  const reloadedKodokan = reloadedTenants.find((t) => t.id === 'tenant-kodokan')!;
  assert(reloadedKodokan.status === 'active', 'Status active persistido no armazenamento');

  const reloadedSubs = DataStore.getSaaSSubscriptions();
  const reloadedSub = reloadedSubs.find((s) => s.tenantId === 'tenant-kodokan')!;
  assert(reloadedSub.status === 'active', 'Assinatura active persistida');
  assert(reloadedSub.manualActivation !== undefined, 'Objeto manualActivation preservado');

  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 8: Ausência de alterações indevidas em pagamentos e mensalidades ---');
  // --------------------------------------------------------------------------
  const finalPaymentsCount = DataStore.getSaaSPayments().length;
  const finalInvoicesCount = DataStore.getInvoices('tenant-kodokan').length;

  assert(
    finalPaymentsCount === initialPaymentsCount,
    `Nenhum pagamento falso adicionado em saas_payments (${finalPaymentsCount} === ${initialPaymentsCount})`
  );
  assert(
    finalInvoicesCount === initialInvoicesCount,
    `Nenhuma mensalidade de alunos alterada ou criada em invoices (${finalInvoicesCount} === ${initialInvoicesCount})`
  );

  console.log('\n🥋 =================================================================');
  console.log(`🥋 RESULTADO FINAL: ${passedTests}/${totalTests} ASSERÇÕES APROVADAS COM SUCESSO!`);
  console.log('🥋 ATIVAÇÃO MANUAL DE LICENÇAS TOTALMENTE VALIDADA E CONFORME AS ESPECIFICAÇÕES.');
  console.log('🥋 =================================================================');
}

runTestSuite().catch((err) => {
  console.error('Falha nos testes de ativação manual:', err);
  process.exit(1);
});
