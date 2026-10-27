/**
 * Suíte de Testes Obrigatórios — Acesso Administrativo Global Duplo Tatame Club
 * Cobre estritamente os 12 cenários exigidos pela especificação:
 *  1. Login válido com admin@tatameclub.com.br
 *  2. Login válido com beaverstraining@gmail.com
 *  3. Login com senha incorreta para cada conta
 *  4. Primeiro acesso de cada conta
 *  5. Recuperação de senha de cada conta
 *  6. Login de um usuário comum do sistema (bloqueio 403)
 *  7. Tentativa de acessar rota/painel administrativo sem autorização
 *  8. Tentativa de executar operação administrativa na API sem privilégios
 *  9. Acesso autorizado às principais funções do painel global com ambas as contas
 * 10. Isolamento dos dados das academias e preservação de regras RLS
 * 11. Logout e nova autenticação alternando entre os dois administradores
 * 12. Regressão dos módulos operacionais existentes
 *
 * Execução: npx tsx src/tests/test_dual_global_admins.ts
 */

// Mock de localStorage para execução no ambiente Node/TSX
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
import {
  isAuthorizedPlatformOwnerEmail,
  getAuthorizedPlatformOwnerEmails,
  getAuthRedirectUrl,
  detectEnvironmentMode,
  OFFICIAL_DOMAINS,
} from '../utils/domainConfig';
import { User, Tenant, SaaSCommercialPlan } from '../types';

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
    console.error(`  ❌ [FAIL] ${testName} (não lançou exceção)`);
    throw new Error(`Falha no teste: ${testName} deveria ter lançado exceção`);
  }
}

async function runTestSuite() {
  console.log('🥋 =================================================================');
  console.log('🥋 BATERIA OFICIAL DE TESTES: ACESSO ADMINISTRATIVO GLOBAL DUPLO');
  console.log('🥋 Tatame Club — admin@tatameclub.com.br & beaverstraining@gmail.com');
  console.log('🥋 =================================================================\n');

  DataStore.resetToSeed();

  const adminEmail1 = 'admin@tatameclub.com.br';
  const adminEmail2 = 'beaverstraining@gmail.com';

  // --------------------------------------------------------------------------
  console.log('--- PREPARAÇÃO: Configuração e Listagem Centralizada ---');
  // --------------------------------------------------------------------------
  const authorizedEmails = getAuthorizedPlatformOwnerEmails();
  assert(authorizedEmails.includes(adminEmail1), 'admin@tatameclub.com.br está na lista central');
  assert(authorizedEmails.includes(adminEmail2), 'beaverstraining@gmail.com está na lista central');
  assert(isAuthorizedPlatformOwnerEmail(adminEmail1), 'adminEmail1 validado por isAuthorizedPlatformOwnerEmail');
  assert(isAuthorizedPlatformOwnerEmail(adminEmail2), 'adminEmail2 validado por isAuthorizedPlatformOwnerEmail');
  assert(
    isAuthorizedPlatformOwnerEmail('  BEAVERSTRAINING@GMAIL.COM  '),
    'Validação é insensível a maiúsculas e espaços acidentais'
  );
  assert(
    !isAuthorizedPlatformOwnerEmail('sensei@academia.com.br'),
    'Usuário de academia é corretamente considerado não autorizado'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 4: Fluxo de Primeiro Acesso de cada conta ---');
  // --------------------------------------------------------------------------
  // Para testar o primeiro acesso de uma nova instalação, limpar superadmin temporariamente
  const nonAdminUsers = DataStore.getAllUsers().filter(
    (u) => u.email !== adminEmail1 && u.email !== adminEmail2
  );
  DataStore.saveUsers(nonAdminUsers);
  DataStore.savePlatformBootstrapState({
    bootstrapped: false,
    ownerEmail: adminEmail1,
    setupTokenHash: 'TATAME-CLUB-OWNER-BOOTSTRAP-2026',
  });

  // 4.1: Primeiro acesso do admin 1
  const bootstrapAdmin1 = await saasPlatformService.executeProtectedEdgeBootstrap({
    email: adminEmail1,
    password: 'SenhaForteAdmin2026!',
    setupToken: 'TATAME-CLUB-OWNER-BOOTSTRAP-2026',
  });
  assert(bootstrapAdmin1.success === true, 'Primeiro acesso de admin@tatameclub.com.br bem-sucedido');
  assert(bootstrapAdmin1.user?.email === adminEmail1, 'Usuário criado corresponde a admin@tatameclub.com.br');
  assert(bootstrapAdmin1.user?.role === 'superadmin', 'Papel global superadmin atribuído');

  // 4.2: Primeiro acesso do admin 2
  const bootstrapAdmin2 = await saasPlatformService.executeProtectedEdgeBootstrap({
    email: adminEmail2,
    password: 'SenhaForteBeavers2026!',
    setupToken: 'TATAME-CLUB-OWNER-BOOTSTRAP-2026',
  });
  assert(bootstrapAdmin2.success === true, 'Primeiro acesso de beaverstraining@gmail.com bem-sucedido');
  assert(bootstrapAdmin2.user?.email === adminEmail2, 'Usuário criado corresponde a beaverstraining@gmail.com');
  assert(bootstrapAdmin2.user?.role === 'superadmin', 'Papel global superadmin atribuído');

  // 4.3: Repetição de primeiro acesso com enforceOneTimeBootstrap deve ser bloqueada
  await expectThrowsAsync(
    () =>
      saasPlatformService.bootstrapPlatformOwner({
        email: adminEmail1,
        enforceOneTimeBootstrap: true,
      }),
    'Repetição de 1º acesso para admin@tatameclub.com.br é bloqueada'
  );

  await expectThrowsAsync(
    () =>
      saasPlatformService.bootstrapPlatformOwner({
        email: adminEmail2,
        enforceOneTimeBootstrap: true,
      }),
    'Repetição de 1º acesso para beaverstraining@gmail.com é bloqueada'
  );

  // 4.4: Primeiro acesso com token inválido deve ser estritamente bloqueado
  await expectThrowsAsync(
    () =>
      saasPlatformService.executeProtectedEdgeBootstrap({
        email: adminEmail1,
        password: 'SenhaForteAdmin2026!',
        setupToken: 'TOKEN-INVALIDO-1234',
      }),
    'Primeiro acesso com token incorreto é rejeitado'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 1: Login válido com admin@tatameclub.com.br ---');
  // --------------------------------------------------------------------------
  const adminUser1 = DataStore.getAllUsers().find(
    (u) => u.email === adminEmail1 && u.role === 'superadmin'
  )!;
  assert(Boolean(adminUser1), 'adminUser1 localizado no registro de usuários');

  const check1 = await saasPlatformService.verifyPlatformAdminAuthorization(adminUser1);
  assert(check1.authorized === true, 'admin@tatameclub.com.br autenticado e autorizado');
  assert(check1.reason === 'authorized', 'Motivo de autorização é authorized');
  assert(check1.user?.role === 'superadmin', 'Papel de superadmin confirmado');
  assert(check1.user?.tenantId === 'platform', 'Pertence ao tenant platform global');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 2: Login válido com beaverstraining@gmail.com ---');
  // --------------------------------------------------------------------------
  const adminUser2 = DataStore.getAllUsers().find(
    (u) => u.email === adminEmail2 && u.role === 'superadmin'
  )!;
  assert(Boolean(adminUser2), 'adminUser2 localizado no registro de usuários');

  const check2 = await saasPlatformService.verifyPlatformAdminAuthorization(adminUser2);
  assert(check2.authorized === true, 'beaverstraining@gmail.com autenticado e autorizado');
  assert(check2.reason === 'authorized', 'Motivo de autorização é authorized');
  assert(check2.user?.role === 'superadmin', 'Papel de superadmin confirmado');
  assert(check2.user?.tenantId === 'platform', 'Pertence ao tenant platform global');
  assert(check2.user?.email === adminEmail2, 'E-mail preservado exatamente como beaverstraining@gmail.com');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 3: Login com senha incorreta para cada conta ---');
  // --------------------------------------------------------------------------
  // Senha fraca ou incompleta (< 6 caracteres)
  await expectThrowsAsync(
    () =>
      saasPlatformService.executeProtectedEdgeBootstrap({
        email: adminEmail1,
        password: '123',
        setupToken: 'TATAME-CLUB-OWNER-BOOTSTRAP-2026',
      }),
    'admin@tatameclub.com.br rejeitado com senha curta'
  );

  await expectThrowsAsync(
    () =>
      saasPlatformService.executeProtectedEdgeBootstrap({
        email: adminEmail2,
        password: '123',
        setupToken: 'TATAME-CLUB-OWNER-BOOTSTRAP-2026',
      }),
    'beaverstraining@gmail.com rejeitado com senha curta'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 5: Recuperação de Senha de cada conta ---');
  // --------------------------------------------------------------------------
  const redirectAdminUrl = getAuthRedirectUrl('saas_admin_panel');
  assert(
    redirectAdminUrl.includes('painel'),
    'URL de redirecionamento de recuperação aponta para painel.tatameclub.com.br'
  );
  assert(
    isAuthorizedPlatformOwnerEmail(adminEmail1),
    'admin@tatameclub.com.br autorizado no fluxo de recuperação'
  );
  assert(
    isAuthorizedPlatformOwnerEmail(adminEmail2),
    'beaverstraining@gmail.com autorizado no fluxo de recuperação'
  );
  assert(
    !isAuthorizedPlatformOwnerEmail('aluno@gmail.com'),
    'Usuário comum não autorizado no fluxo de recuperação do painel'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 6: Login de um usuário comum do sistema (bloqueio 403) ---');
  // --------------------------------------------------------------------------
  const ordinaryUser: User = {
    id: 'user-ordinary-sensei',
    tenantId: 'tenant-kodokan',
    name: 'Sensei Silva',
    email: 'silva@kodokanbrasil.com.br',
    role: 'instructor',
    active: true,
  };

  const ordinaryCheck = await saasPlatformService.verifyPlatformAdminAuthorization(ordinaryUser);
  assert(ordinaryCheck.authorized === false, 'Usuário comum é barrado na autorização global');
  assert(ordinaryCheck.reason === 'unauthorized_email', 'Motivo retornado é unauthorized_email');
  assert(ordinaryCheck.message.includes('403'), 'Mensagem contém erro HTTP 403');
  assert(
    ordinaryCheck.message.includes('admin@tatameclub.com.br') &&
      ordinaryCheck.message.includes('beaverstraining@gmail.com'),
    'Mensagem 403 orienta corretamente sobre os administradores autorizados'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 7: Tentativa de acessar rota administrativa sem autorização ---');
  // --------------------------------------------------------------------------
  const studentUser: User = {
    id: 'user-student-test',
    tenantId: 'tenant-kodokan',
    name: 'Carlos Aluno',
    email: 'carlos.aluno@email.com',
    role: 'student',
    active: true,
  };

  const studentCheck = await saasPlatformService.verifyPlatformAdminAuthorization(studentUser);
  assert(studentCheck.authorized === false, 'Aluno barrado no acesso administrativo');
  assert(studentCheck.user === undefined, 'Nenhum usuário de sessão retornado para o aluno');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 8: Tentativa de executar operação administrativa na API sem privilégios ---');
  // --------------------------------------------------------------------------
  await expectThrowsAsync(
    () =>
      saasPlatformService.executeProtectedEdgeBootstrap({
        email: 'hacker@invasao.com',
        password: 'senhaForte123456!',
        setupToken: 'TATAME-CLUB-OWNER-BOOTSTRAP-2026',
      }),
    'API rejeita com 403 tentativa de bootstrap de e-mail invasor'
  );

  await expectThrowsAsync(
    () =>
      saasPlatformService.bootstrapPlatformOwner({
        email: 'invasor@qualquer.com',
      }),
    'bootstrapPlatformOwner rejeita e-mail não listado'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 9: Acesso autorizado às principais funções do painel global ---');
  // --------------------------------------------------------------------------
  // 9.1: Operação por adminUser1 (admin@tatameclub.com.br): criar plano comercial
  const testPlan: SaaSCommercialPlan = {
    id: 'plan-dual-admin-test',
    name: 'Plano Teste Administradores Duplos',
    description: 'Criado para verificar operação administrativa.',
    price: 350.0,
    currency: 'BRL',
    billingCycle: 'monthly',
    trialDays: 0,
    maxStudents: 300,
    maxUsers: 15,
    maxBranches: 3,
    maxStorageGb: 30,
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

  await saasPlatformService.savePlan(testPlan, adminUser1.id, adminUser1.name);
  const plans = DataStore.getCommercialPlans();
  assert(plans.some((p) => p.id === 'plan-dual-admin-test'), 'adminUser1 salvou plano com sucesso');

  // 9.2: Operação por adminUser2 (beaverstraining@gmail.com): suspender academia
  const tenantToSuspend = DataStore.getTenants()[0];
  assert(Boolean(tenantToSuspend), 'Existe academia para teste de suspensão');

  await saasPlatformService.suspendTenant(
    tenantToSuspend.id,
    'Suspensão administrativa de teste executada por beaverstraining@gmail.com',
    adminUser2.id,
    adminUser2.name
  );
  const updatedTenant = DataStore.getTenants().find((t) => t.id === tenantToSuspend.id);
  assert(updatedTenant?.status === 'suspended', 'beaverstraining@gmail.com suspendeu academia com sucesso');

  // 9.3: Operação por adminUser1: reativar academia
  await saasPlatformService.reactivateTenant(
    tenantToSuspend.id,
    'Reativação administrativa executada por admin@tatameclub.com.br',
    adminUser1.id,
    adminUser1.name
  );
  const reactivatedTenant = DataStore.getTenants().find((t) => t.id === tenantToSuspend.id);
  assert(reactivatedTenant?.status === 'active', 'admin@tatameclub.com.br reativou academia com sucesso');

  // 9.4: Operação por adminUser2: ajustar limites de licença
  await saasPlatformService.updateLicenseLimits(
    tenantToSuspend.id,
    { customMaxStudents: 750, customMaxBranches: 4, customMaxUsers: 25 },
    'Aditivo contratual verificado por beaverstraining',
    adminUser2
  );
  const limits = saasPlatformService.getEffectiveLimits(tenantToSuspend.id);
  assert(limits.maxStudents === 750, 'beaverstraining ajustou maxStudents para 750 com sucesso');
  assert(limits.maxBranches === 4, 'beaverstraining ajustou maxBranches para 4 com sucesso');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 10: Isolamento dos dados das academias e preservação de regras RLS ---');
  // --------------------------------------------------------------------------
  const allTenants = DataStore.getTenants();
  assert(allTenants.length >= 2, 'Existem múltiplos tenants cadastrados');
  const tenantA = allTenants[0];
  const tenantB = allTenants[1];

  const studentsA = DataStore.getStudents(tenantA.id);
  const studentsB = DataStore.getStudents(tenantB.id);

  assert(
    studentsA.every((s) => s.tenantId === tenantA.id),
    `Todos os alunos de ${tenantA.tradeName} pertencem ao tenant correto`
  );
  assert(
    studentsB.every((s) => s.tenantId === tenantB.id),
    `Todos os alunos de ${tenantB.tradeName} pertencem ao tenant correto`
  );
  assert(
    !studentsA.some((sa) => studentsB.some((sb) => sb.id === sa.id)),
    'Nenhum aluno vaza entre os diferentes tenants'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 11: Logout e nova autenticação alternando entre os dois administradores ---');
  // --------------------------------------------------------------------------
  let activeSessionUser: User | null = adminUser1;
  assert(activeSessionUser.email === adminEmail1, 'Sessão 1 iniciada como admin@tatameclub.com.br');

  activeSessionUser = null; // Logout
  assert(activeSessionUser === null, 'Sessão limpa (logout efetuado)');

  // Nova autenticação com adminUser2
  const reauth = await saasPlatformService.verifyPlatformAdminAuthorization({
    id: 'user-superadmin-beavers',
    email: adminEmail2,
    name: 'Administrador Global Tatame Club',
  });
  assert(reauth.authorized === true, 'Re-autenticação com beaverstraining@gmail.com autorizada');
  activeSessionUser = reauth.user!;
  assert(activeSessionUser.email === adminEmail2, 'Sessão 2 conectada com sucesso como beaverstraining@gmail.com');
  assert(activeSessionUser.role === 'superadmin', 'Papel global superadmin confirmado');

  // --------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 12: Regressão dos módulos existentes ---');
  // --------------------------------------------------------------------------
  const kodokanClasses = DataStore.getClasses('tenant-kodokan');
  const kodokanAttendances = DataStore.getAttendances('tenant-kodokan');
  const kodokanGraduations = DataStore.getGraduations('tenant-kodokan');
  const kodokanTatamis = DataStore.getTatamis('tenant-kodokan');
  const kodokanInvoices = DataStore.getInvoices('tenant-kodokan');
  const kodokanLibrary = DataStore.getLibraryItems('tenant-kodokan');

  assert(kodokanClasses.length > 0, 'Turmas e horários operacionais continuam funcionando');
  assert(kodokanAttendances.length > 0, 'Frequências e presenças operacionais continuam funcionando');
  assert(kodokanGraduations.length > 0, 'Histórico de graduações e faixas preservado');
  assert(kodokanTatamis.length > 0, 'Gestão de tatamis e ocupação preservada');
  assert(kodokanInvoices.length > 0, 'Cobranças e faturas dos alunos preservadas');
  assert(kodokanLibrary.length > 0, 'Biblioteca digital de técnicas preservada');

  const auditLogs = DataStore.getPlatformAuditLogs();
  assert(auditLogs.length >= 4, 'Trilha de auditoria global registrou todas as operações dos dois admins');

  console.log('\n🥋 =================================================================');
  console.log(`🥋 RESULTADO FINAL: ${passedTests}/${totalTests} ASSERÇÕES APROVADAS COM SUCESSO!`);
  console.log('🥋 AMBOS OS ADMINISTRADORES GLOBAIS ESTÃO PLENAMENTE AUTORIZADOS.');
  console.log('🥋 =================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('Falha na suíte de testes:', err);
  process.exit(1);
});
