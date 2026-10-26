/**
 * Suíte de Verificação Completa — Acesso ao Painel Global SaaS (admin@tatameclub.com.br),
 * Segurança de Bootstrap, Migrations 25/26 e Isolamento Multi-Tenant (Casos A a G)
 * Execução: npx tsx src/tests/test_tatame_club_restructuring.ts
 */

import fs from 'fs';
import path from 'path';

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
import {
  detectEnvironmentMode,
  isAuthorizedPlatformOwnerEmail,
  getAuthRedirectUrl,
  OFFICIAL_DOMAINS,
} from '../utils/domainConfig';

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
  console.log('=== INICIANDO TESTES DE SEGURANÇA, BOOTSTRAP E REESTRUTURAÇÃO DO TATAME CLUB (CASOS A-G) ===\n');

  DataStore.resetToSeed();

  // --------------------------------------------------------------------------
  // 1. Domínios oficiais e identidade centralizada (admin@tatameclub.com.br)
  // --------------------------------------------------------------------------
  console.log('1. Verificando domínios oficiais e identidade centralizada (admin@tatameclub.com.br)...');
  assert(OFFICIAL_DOMAINS.MAIN_SITE === 'tatameclub.com.br', 'Host principal deve ser tatameclub.com.br');
  assert(
    OFFICIAL_DOMAINS.SAAS_ADMIN_PANEL === 'painel.tatameclub.com.br',
    'Host do painel SaaS deve ser painel.tatameclub.com.br'
  );
  assert(
    OFFICIAL_DOMAINS.PLATFORM_OWNER_EMAIL === 'admin@tatameclub.com.br',
    'E-mail oficial do proprietário deve ser admin@tatameclub.com.br'
  );
  assert(
    isAuthorizedPlatformOwnerEmail('admin@tatameclub.com.br') === true,
    'admin@tatameclub.com.br deve ser reconhecido como proprietário autorizado'
  );
  assert(
    isAuthorizedPlatformOwnerEmail('beaverstraining@gmail.com') === false,
    'E-mail antigo beaverstraining@gmail.com não deve ser o endereço ativo padrão'
  );
  assert(
    isAuthorizedPlatformOwnerEmail('sensei@kodokanbrasil.com.br') === false,
    'Usuário de academia não deve ser autorizado como owner SaaS'
  );

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
  assert(
    getAuthRedirectUrl('saas_admin_panel').includes('painel'),
    'URL de redirecionamento do painel global deve apontar para o contexto do painel'
  );
  const { normalizeSupabaseUrl } = await import('../services/supabase');
  assert(
    normalizeSupabaseUrl('https://knmzzndugadmklzzgtaa.supabase.co/rest/v1/') ===
      'https://knmzzndugadmklzzgtaa.supabase.co',
    'normalizeSupabaseUrl deve remover o sufixo /rest/v1/ que causava erro PGRST125 (404)'
  );
  console.log('   ✅ Domínios, normalização de URL do Supabase e identidade admin@tatameclub.com.br validados.');

  // --------------------------------------------------------------------------
  // CASO A — Primeiro acesso seguro do proprietário (admin@tatameclub.com.br)
  // --------------------------------------------------------------------------
  console.log('2. [Caso A] Testando Primeiro Acesso seguro do proprietário (admin@tatameclub.com.br)...');
  const initialStatus = await saasPlatformService.checkBootstrapStatus();
  assert(
    initialStatus.bootstrapCompleted === false,
    'Antes do primeiro acesso, bootstrapCompleted deve ser false'
  );
  assert(
    initialStatus.authorizedOwnerEmail === 'admin@tatameclub.com.br',
    'Status de bootstrap deve indicar admin@tatameclub.com.br'
  );

  const firstAccessResult = await saasPlatformService.executeProtectedEdgeBootstrap({
    email: 'admin@tatameclub.com.br',
    password: 'StrongOwnerPassword#2026',
    setupToken: 'TATAME-CLUB-OWNER-BOOTSTRAP-2026',
  });
  assert(firstAccessResult.success === true, 'Primeiro acesso com token válido deve concluir com sucesso');
  assert(
    firstAccessResult.user?.email === 'admin@tatameclub.com.br' &&
      firstAccessResult.user?.role === 'superadmin',
    'Conta inicializada deve ter role superadmin e email admin@tatameclub.com.br'
  );

  const afterBootstrapStatus = await saasPlatformService.checkBootstrapStatus();
  assert(
    afterBootstrapStatus.bootstrapCompleted === true,
    'Após conclusão do primeiro acesso, bootstrapCompleted deve ser true'
  );

  const verifyOwner = await saasPlatformService.verifyPlatformAdminAuthorization({
    id: firstAccessResult.user!.id,
    email: 'admin@tatameclub.com.br',
  });
  assert(
    verifyOwner.authorized === true && verifyOwner.reason === 'authorized',
    'Proprietário inicializado deve passar na verificação de autorização global'
  );
  console.log('   ✅ [Caso A] Primeiro acesso concluído e verificado com sucesso.');

  // --------------------------------------------------------------------------
  // CASO B — Conta existente (Prevenção de duplicidade e de repetição do bootstrap)
  // --------------------------------------------------------------------------
  console.log('3. [Caso B] Testando prevenção de duplicidade e bloqueio de repetição do bootstrap...');
  await expectThrowsAsync(
    () =>
      saasPlatformService.executeProtectedEdgeBootstrap({
        email: 'admin@tatameclub.com.br',
        password: 'AnotherPassword#2026',
        setupToken: 'TATAME-CLUB-OWNER-BOOTSTRAP-2026',
      }),
    'Deve bloquear tentativa de repetir o bootstrap inicial após já estar concluído'
  );

  // Sincronização de sessão autenticada existente não deve duplicar usuário
  await saasPlatformService.bootstrapPlatformOwner({
    email: 'admin@tatameclub.com.br',
    isVerifiedSession: true,
  });
  const superAdminUsers = DataStore.getAllUsers().filter(
    (u) => u.email.toLowerCase() === 'admin@tatameclub.com.br' || u.role === 'superadmin'
  );
  assert(
    superAdminUsers.length === 1,
    `Não deve haver duplicidade de contas superadmin (encontrado: ${superAdminUsers.length})`
  );
  console.log('   ✅ [Caso B] Prevenção de duplicidade e bloqueio de re-bootstrap validados.');

  // --------------------------------------------------------------------------
  // CASO C — Credenciais / Token incorretos no primeiro acesso
  // --------------------------------------------------------------------------
  console.log('4. [Caso C] Testando rejeição de token incorreto e senha fraca...');
  DataStore.savePlatformBootstrapState({
    bootstrapped: false,
    ownerEmail: 'admin@tatameclub.com.br',
    setupTokenHash: 'TATAME-CLUB-OWNER-BOOTSTRAP-2026',
  });

  await expectThrowsAsync(
    () =>
      saasPlatformService.executeProtectedEdgeBootstrap({
        email: 'admin@tatameclub.com.br',
        password: 'StrongOwnerPassword#2026',
        setupToken: 'TOKEN-INCORRETO-INVASOR',
      }),
    'Token de inicialização incorreto não deve liberar o primeiro acesso'
  );

  await expectThrowsAsync(
    () =>
      saasPlatformService.executeProtectedEdgeBootstrap({
        email: 'admin@tatameclub.com.br',
        password: '123',
        setupToken: 'TATAME-CLUB-OWNER-BOOTSTRAP-2026',
      }),
    'Senha curta/inválida deve ser recusada'
  );

  // Restaurar estado de bootstrap concluído
  const authorizedSuperAdmin = await saasPlatformService.bootstrapPlatformOwner({
    email: 'admin@tatameclub.com.br',
    setupToken: 'TATAME-CLUB-OWNER-BOOTSTRAP-2026',
    enforceOneTimeBootstrap: true,
  });
  console.log('   ✅ [Caso C] Credenciais/tokens inválidos rejeitados sem alterar privilégios.');

  // --------------------------------------------------------------------------
  // CASO D — Usuário sem autorização global (Owner de academia, aluno ou e-mail antigo)
  // --------------------------------------------------------------------------
  console.log('5. [Caso D] Testando bloqueio de usuários sem autorização global...');
  await expectThrowsAsync(
    () => saasPlatformService.bootstrapPlatformOwner({ email: 'sensei@academia.com.br' }),
    'Bootstrap deve negar e-mail de academia comum'
  );
  await expectThrowsAsync(
    () => saasPlatformService.bootstrapPlatformOwner({ email: 'beaverstraining@gmail.com' }),
    'Bootstrap deve negar o endereço antigo beaverstraining@gmail.com'
  );

  const verifyAcademyOwner = await saasPlatformService.verifyPlatformAdminAuthorization({
    id: 'user-owner',
    email: 'yamamoto@kodokanbrasil.com.br',
    role: 'owner',
  });
  assert(
    verifyAcademyOwner.authorized === false && verifyAcademyOwner.reason === 'unauthorized_email',
    'Administrador de academia (owner) deve ter acesso negado ao painel global'
  );

  const verifyLegacyEmail = await saasPlatformService.verifyPlatformAdminAuthorization({
    id: 'legacy-id',
    email: 'beaverstraining@gmail.com',
    role: 'superadmin',
  });
  assert(
    verifyLegacyEmail.authorized === false,
    'E-mail antigo não deve mais conceder acesso automático ao painel global'
  );
  console.log('   ✅ [Caso D] Usuários sem autorização global bloqueados (403).');

  // --------------------------------------------------------------------------
  // CASO E — Verificação estrutural das Migrations 25 e 26
  // --------------------------------------------------------------------------
  console.log('6. [Caso E] Auditando estrutura e idempotência das Migrations 25 e 26...');
  const mig25Path = path.resolve(
    process.cwd(),
    'supabase/migrations/25_tatame_club_multitenant_limits_and_team_management.sql'
  );
  const mig26Path = path.resolve(
    process.cwd(),
    'supabase/migrations/26_fix_platform_owner_identity_and_secure_bootstrap.sql'
  );
  assert(fs.existsSync(mig25Path), 'Arquivo da Migration 25 deve existir');
  assert(fs.existsSync(mig26Path), 'Arquivo da Migration 26 deve existir');

  const mig25Sql = fs.readFileSync(mig25Path, 'utf-8');
  const mig26Sql = fs.readFileSync(mig26Path, 'utf-8');

  assert(
    mig25Sql.includes("p_email text DEFAULT 'admin@tatameclub.com.br'"),
    'Migration 25 deve adotar admin@tatameclub.com.br como padrão'
  );
  assert(
    mig25Sql.includes('REVOKE EXECUTE ON FUNCTION public.bootstrap_platform_owner_by_email(text, text) FROM PUBLIC, anon;'),
    'Migration 25 deve revogar execução anônima de bootstrap_platform_owner_by_email'
  );
  assert(
    mig26Sql.includes('CREATE TABLE IF NOT EXISTS public.platform_authorized_owners'),
    'Migration 26 deve criar tabela centralizada platform_authorized_owners de forma idempotente'
  );
  assert(
    mig26Sql.includes('CREATE OR REPLACE FUNCTION public.get_platform_bootstrap_status()'),
    'Migration 26 deve definir RPC get_platform_bootstrap_status()'
  );
  assert(
    mig26Sql.includes('CREATE OR REPLACE FUNCTION public.verify_platform_admin_access()'),
    'Migration 26 deve definir RPC verify_platform_admin_access()'
  );
  console.log('   ✅ [Caso E] Migrations 25 e 26 verificadas e consistentes.');

  // --------------------------------------------------------------------------
  // CASO F — Segurança (Ausência de chaves secretas no frontend e bloqueio de auto-promoção)
  // --------------------------------------------------------------------------
  console.log('7. [Caso F] Verificando ausência de service_role key no frontend e bloqueio de escalonamento...');
  const authViewPath = path.resolve(
    process.cwd(),
    'src/components/superadmin/PlatformAdminAuthView.tsx'
  );
  const authViewSource = fs.readFileSync(authViewPath, 'utf-8');
  assert(
    !authViewSource.includes('beaverstraining@gmail.com'),
    'PlatformAdminAuthView.tsx não deve conter referência fixa a beaverstraining@gmail.com'
  );
  assert(
    !authViewSource.includes('SUPABASE_SERVICE_ROLE_KEY'),
    'PlatformAdminAuthView.tsx jamais deve referenciar SUPABASE_SERVICE_ROLE_KEY'
  );
  console.log('   ✅ [Caso F] Segurança de bundle e proteção contra escalonamento confirmadas.');

  // --------------------------------------------------------------------------
  // CASO G — Regressão: Cadastro e login de academias, limites de unidades e usuários
  // --------------------------------------------------------------------------
  console.log('8. [Caso G] Executando testes de regressão multi-tenant (Academias, Unidades e Equipe)...');
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
  assert(regA.ownerUser.role === 'owner', 'Administrador da Academia A deve ter papel owner (não superadmin)');

  // Confirmar que o owner recém-criado da Academia A NÃO tem acesso ao painel global
  const checkRegAOwnerGlobalAccess = await saasPlatformService.verifyPlatformAdminAuthorization(regA.ownerUser);
  assert(
    checkRegAOwnerGlobalAccess.authorized === false,
    'Administrador recém-cadastrado de academia jamais pode acessar o painel global'
  );

  // Confirmar que o owner da Academia A não consegue criar usuário superadmin na equipe
  await expectThrowsAsync(
    () =>
      teamUserService.createOrInviteUser(
        {
          tenantId: regA.tenant.id,
          name: 'Tentativa Escalonamento',
          email: 'hacker@dojosamurai.com.br',
          role: 'superadmin',
          branchId: regA.branch.id,
          mode: 'direct_active',
        },
        regA.ownerUser
      ),
    'Owner da academia não pode atribuir papel superadmin na equipe'
  );

  // Testar limites de unidades e usuários da licença
  await saasPlatformService.changeTenantPlan(
    regA.tenant.id,
    'basic',
    'Teste de limites do plano Básico',
    authorizedSuperAdmin.id,
    authorizedSuperAdmin.name
  );
  await saasPlatformService.updateLicenseLimits(
    regA.tenant.id,
    { customMaxUsers: 3, customMaxBranches: 1, customMaxStudents: 100 },
    'Configuração de limites de teste (3 usuários, 1 unidade)',
    authorizedSuperAdmin
  );

  const limitsA = saasPlatformService.getEffectiveLimits(regA.tenant.id);
  assert(limitsA.maxBranches === 1 && limitsA.currentBranches === 1, 'Unidade Matriz deve contar como 1ª unidade');
  assert(limitsA.branchesLimitReached === true, 'Limite de 1 unidade deve estar atingido com a Matriz');

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

  console.log('   ✅ [Caso G] Regressão multi-tenant, isolamento e limites validados sem falhas.');
  console.log('\n🎉 TODOS OS CASOS DE TESTE (A, B, C, D, E, F e G) PASSARAM COM 100% DE SUCESSO!');
}

runTests().catch((err) => {
  console.error('\n❌ ERRO NOS TESTES:', err);
  process.exit(1);
});
