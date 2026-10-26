/**
 * Suíte de Verificação — Reestruturação Tatame Club (SaaS Multi-Tenant, Painel Exclusivo e Limites por Licença)
 * Execução: npx tsx src/tests/test_tatame_club_restructuring.ts
 */

// Mock de localStorage para execução em ambiente Node/TSX
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
import { teamUserService } from '../services/teamUserService';
import { detectEnvironmentMode, isAuthorizedPlatformOwnerEmail, OFFICIAL_DOMAINS } from '../utils/domainConfig';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FALHA DE ASSERÇÃO: ${message}`);
  }
}

async function expectThrowsAsync(fn: () => Promise<any>, message: string) {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

async function runTests() {
  console.log('=== INICIANDO TESTES DE REESTRUTURAÇÃO DO TATAME CLUB ===\n');

  // 1. Verificar domínios oficiais e validação do proprietário do SaaS
  console.log('1. Testando configuração de domínios e autorização exclusiva de beaverstraining@gmail.com...');
  assert(OFFICIAL_DOMAINS.MAIN_SITE === 'tatameclub.com.br', 'Host principal deve ser tatameclub.com.br');
  assert(OFFICIAL_DOMAINS.SAAS_ADMIN_PANEL === 'painel.tatameclub.com.br', 'Host do painel SaaS deve ser painel.tatameclub.com.br');
  assert(isAuthorizedPlatformOwnerEmail('beaverstraining@gmail.com') === true, 'beaverstraining@gmail.com deve ser autorizado');
  assert(isAuthorizedPlatformOwnerEmail('sensei@kodokanbrasil.com.br') === false, 'Usuário de academia não deve ser autorizado como owner SaaS');

  assert(
    detectEnvironmentMode('painel.tatameclub.com.br', '/', '') === 'saas_admin_panel',
    'Subdomínio painel.tatameclub.com.br deve ativar modo saas_admin_panel'
  );
  assert(
    detectEnvironmentMode('tatameclub.com.br', '/', '') === 'main_site',
    'Domínio tatameclub.com.br na raiz deve ativar modo main_site'
  );
  assert(
    detectEnvironmentMode('tatameclub.com.br', '/painel', '') === 'saas_admin_panel',
    'Rota /painel deve ativar modo saas_admin_panel'
  );
  console.log('   ✅ Domínios e detecção de ambiente validados com sucesso.');

  // 2. Testar bloqueio de bootstrap para e-mail não autorizado
  console.log('2. Testando bloqueio do painel SaaS para contas de academias...');
  await expectThrowsAsync(
    () => saasPlatformService.bootstrapPlatformOwner({ email: 'sensei@academia.com.br' }),
    'Bootstrap deve negar e-mail diferente de beaverstraining@gmail.com'
  );

  const authorizedSuperAdmin = await saasPlatformService.bootstrapPlatformOwner({
    email: 'beaverstraining@gmail.com',
  });
  assert(
    authorizedSuperAdmin.role === 'superadmin' && authorizedSuperAdmin.email === 'beaverstraining@gmail.com',
    'Bootstrap deve autenticar beaverstraining@gmail.com como superadmin'
  );
  console.log('   ✅ Proteção de acesso ao Painel Global SaaS validada.');

  // 3. Testar criação de nova academia isolada (Trial 10 dias, sem misturar com tenant-kodokan)
  console.log('3. Testando cadastro isolado de nova academia (Academia A e Academia B)...');
  const regA = saasPlatformService.registerAcademyIsolated({
    tradeName: 'Dojo Samurai Campinas',
    legalName: 'Samurai Artes Marciais Ltda',
    cnpjOrCpf: '12.345.678/0001-99',
    adminName: 'Sensei Roberto',
    email: 'roberto@dojosamurai.com.br',
    phone: '(19) 99999-1111',
    whatsapp: '(19) 99999-1111',
    address: {
      street: 'Av. Brasil',
      number: '500',
      neighborhood: 'Centro',
      city: 'Campinas',
      state: 'SP',
      zipCode: '13000-000',
    },
  });

  const regB = saasPlatformService.registerAcademyIsolated({
    tradeName: 'Academia Gracie Sul',
    legalName: 'Gracie Sul BJJ Ltda',
    cnpjOrCpf: '98.765.432/0001-10',
    adminName: 'Mestre Fernando',
    email: 'fernando@graciesul.com.br',
    phone: '(51) 98888-2222',
    whatsapp: '(51) 98888-2222',
    address: {
      street: 'Rua da Praia',
      number: '100',
      neighborhood: 'Centro',
      city: 'Porto Alegre',
      state: 'RS',
      zipCode: '90000-000',
    },
  });

  assert(regA.tenant.id !== 'tenant-kodokan', 'Nova academia A não pode usar tenant-kodokan');
  assert(regB.tenant.id !== regA.tenant.id, 'Academia A e B devem ter tenantIds distintos');
  assert(DataStore.getStudents(regA.tenant.id).length === 0, 'Academia A recém-criada não pode herdar alunos da demonstração');
  assert(DataStore.getInvoices(regA.tenant.id).length === 0, 'Academia A recém-criada não pode herdar faturas da demonstração');
  assert(DataStore.getClasses(regA.tenant.id).length === 0, 'Academia A recém-criada não pode herdar turmas da demonstração');
  assert(DataStore.getTatamis(regA.tenant.id).length === 1, 'Academia A deve ter apenas seu próprio tatami inicial');
  assert(
    DataStore.getBranches().filter((b) => b.tenantId === regA.tenant.id).length === 1,
    'Academia A deve iniciar exatamente com 1 unidade (Unidade Matriz)'
  );
  console.log('   ✅ Isolamento multi-tenant entre Academia A, Academia B e dados iniciais validado.');

  // 4. Testar limite de unidades (Unidade Matriz conta como 1ª unidade)
  console.log('4. Testando limite de unidades (Unidade Matriz = 1ª unidade)...');
  // Ajustar para o plano Basic (que possui maxBranches = 1 e maxUsers = 3) para testar bloqueio em 1 unidade e 3 usuários
  await saasPlatformService.changeTenantPlan(
    regA.tenant.id,
    'basic',
    'Teste de limites do plano Básico',
    authorizedSuperAdmin.id,
    authorizedSuperAdmin.name
  );
  // Definir maxUsers customizado = 3 e maxBranches = 1 para validar estritamente os limites
  await saasPlatformService.updateLicenseLimits(
    regA.tenant.id,
    { customMaxUsers: 3, customMaxBranches: 1, customMaxStudents: 100 },
    'Configuração de limites de teste (3 usuários, 1 unidade)',
    authorizedSuperAdmin
  );

  const limitsA = saasPlatformService.getEffectiveLimits(regA.tenant.id);
  assert(limitsA.maxBranches === 1, 'Licença deve ter limite de 1 unidade');
  assert(limitsA.currentBranches === 1, 'Unidade Matriz deve contar como 1ª unidade');
  assert(limitsA.branchesLimitReached === true, 'Com 1 unidade em plano de limite 1, branchesLimitReached deve ser true');

  await expectThrowsAsync(
    () =>
      saasPlatformService.createBranchWithLimitCheck(
        {
          tenantId: regA.tenant.id,
          name: 'Filial 2 Indevida',
          phone: '(19) 3333-4444',
          email: 'filial2@dojosamurai.com.br',
          address: 'Rua 2',
          managerName: 'Gestor 2',
        },
        regA.ownerUser
      ),
    'Deve bloquear criação da 2ª unidade quando o limite contratado é 1'
  );
  console.log('   ✅ Bloqueio ao atingir o limite de unidades validado.');

  // 5. Testar limite de usuários e prevenção de escalonamento de privilégio na equipe
  console.log('5. Testando gestão de usuários da academia e bloqueio de limite de usuários...');
  assert(limitsA.maxUsers === 3, 'Licença deve permitir até 3 usuários');
  assert(limitsA.currentActiveUsers === 1, 'Owner inicial deve contar como 1 usuário ativo');

  const addInstructor1 = await teamUserService.createOrInviteUser(
    {
      tenantId: regA.tenant.id,
      name: 'Professor Lucas',
      email: 'lucas@dojosamurai.com.br',
      role: 'instructor',
      branchId: regA.branch.id,
      mode: 'direct_active',
    },
    regA.ownerUser
  );
  assert(Boolean(addInstructor1.user), 'Deve permitir adicionar o 2º usuário (instrutor)');

  const addReceptionist = await teamUserService.createOrInviteUser(
    {
      tenantId: regA.tenant.id,
      name: 'Secretaria Carla',
      email: 'carla@dojosamurai.com.br',
      role: 'secretary',
      branchId: regA.branch.id,
      mode: 'invite',
    },
    regA.ownerUser
  );
  assert(Boolean(addReceptionist.invitation), 'Deve permitir convidar o 3º usuário (secretaria)');

  // Tentar adicionar o 4º usuário quando o limite é 3 (2 ativos + 1 convite pendente = 3 reservados)
  await expectThrowsAsync(
    () =>
      teamUserService.createOrInviteUser(
        {
          tenantId: regA.tenant.id,
          name: 'Financeiro Marcos',
          email: 'marcos@dojosamurai.com.br',
          role: 'financial',
          branchId: regA.branch.id,
          mode: 'direct_active',
        },
        regA.ownerUser
      ),
    'Deve bloquear o 4º usuário quando o limite da licença é 3'
  );
  console.log('   ✅ Limite de usuários ativos + convites pendentes validado.');

  // 6. Testar revogação de convite e desativação/reativação de usuário
  console.log('6. Testando liberação de vaga ao revogar convite e bloqueio na reativação acima do limite...');
  await teamUserService.revokeInvitation(addReceptionist.invitation!.id, regA.ownerUser);

  const addThirdUserActive = await teamUserService.createOrInviteUser(
    {
      tenantId: regA.tenant.id,
      name: 'Financeiro Marcos',
      email: 'marcos@dojosamurai.com.br',
      role: 'financial',
      branchId: regA.branch.id,
      mode: 'direct_active',
    },
    regA.ownerUser
  );
  assert(Boolean(addThirdUserActive.user), 'Após revogar convite, a 3ª vaga deve estar disponível');

  // Desativar o instrutor Lucas libera 1 vaga
  await teamUserService.updateTenantUser(
    {
      tenantId: regA.tenant.id,
      targetUserId: addInstructor1.user!.id,
      active: false,
    },
    regA.ownerUser
  );

  // Preencher a 3ª vaga com outro membro
  const fillSlotUser = await teamUserService.createOrInviteUser(
    {
      tenantId: regA.tenant.id,
      name: 'Sensei Kenji',
      email: 'kenji@dojosamurai.com.br',
      role: 'instructor',
      branchId: regA.branch.id,
      mode: 'direct_active',
    },
    regA.ownerUser
  );
  assert(Boolean(fillSlotUser.user), 'Deve permitir preencher a vaga liberada pelo usuário inativo');

  // Tentar reativar Lucas agora que já existem 3 ativos deve ser bloqueado
  await expectThrowsAsync(
    () =>
      teamUserService.updateTenantUser(
        {
          tenantId: regA.tenant.id,
          targetUserId: addInstructor1.user!.id,
          active: true,
        },
        regA.ownerUser
      ),
    'Deve bloquear reativação de usuário inativo se o limite já estiver cheio'
  );
  console.log('   ✅ Regras de desativação e bloqueio de reativação acima do limite validadas.');

  // 7. Testar proteção do último Owner da academia
  console.log('7. Testando proteção contra remoção/desativação do último Owner...');
  await expectThrowsAsync(
    () =>
      teamUserService.updateTenantUser(
        {
          tenantId: regA.tenant.id,
          targetUserId: regA.ownerUser.id,
          active: false,
        },
        regA.ownerUser
      ),
    'Não pode permitir desativar o único Owner da academia'
  );
  console.log('   ✅ Proteção do último Owner validada.');

  // 8. Testar personalização individual da licença pelo Proprietário do SaaS
  console.log('8. Testando ampliação individual de limites da licença pelo Proprietário do SaaS...');
  await saasPlatformService.updateLicenseLimits(
    regA.tenant.id,
    { customMaxUsers: 6, customMaxBranches: 3, customMaxStudents: 250 },
    'Contrato especial negociado para 3 unidades e 6 usuários',
    authorizedSuperAdmin
  );

  const updatedLimitsA = saasPlatformService.getEffectiveLimits(regA.tenant.id);
  assert(updatedLimitsA.maxUsers === 6, 'Limite customizado de usuários deve ser 6');
  assert(updatedLimitsA.maxBranches === 3, 'Limite customizado de unidades deve ser 3');
  assert(updatedLimitsA.maxStudents === 250, 'Limite customizado de alunos deve ser 250');
  assert(updatedLimitsA.hasCustomLimits === true, 'Flag hasCustomLimits deve ser true');

  // Agora a reativação de Lucas e a criação da 2ª unidade devem funcionar!
  const reactivatedLucas = await teamUserService.updateTenantUser(
    {
      tenantId: regA.tenant.id,
      targetUserId: addInstructor1.user!.id,
      active: true,
    },
    regA.ownerUser
  );
  assert(reactivatedLucas.active === true, 'Deve permitir reativar usuário após ampliação do limite da licença');

  const secondBranchAfterUpgrade = await saasPlatformService.createBranchWithLimitCheck(
    {
      tenantId: regA.tenant.id,
      name: 'Filial Cambuí',
      phone: '(19) 3333-5555',
      email: 'cambui@dojosamurai.com.br',
      address: 'Rua Coronel Quirino, 100',
      managerName: 'Sensei Kenji',
    },
    regA.ownerUser
  );
  assert(Boolean(secondBranchAfterUpgrade.id), 'Deve permitir criar 2ª unidade após ampliação do limite da licença');
  console.log('   ✅ Personalização individual de limites da licença pelo SaaS Owner validada.');

  console.log('\n🎉 TODOS OS 8 GRUPOS DE TESTES DO TATAME CLUB PASSARAM COM 100% DE SUCESSO!');
}

runTests().catch((err) => {
  console.error('\n❌ ERRO NOS TESTES:', err);
  process.exit(1);
});
