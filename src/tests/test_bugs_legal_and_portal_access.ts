import { formDraftStore } from '../utils/formDraftStore';
import { authService } from '../services/supabase';
import { portalAccessService } from '../services/portalAccessService';
import { DataStore } from '../data/storage';
import { LEGAL_DOCUMENT_VERSIONS } from '../components/public/LegalDocumentsModal';
import { Tenant } from '../types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function runTests() {
  console.log('=== INICIANDO BATERIA DE TESTES: BUGS 1 & 2, LGPD/TERMOS, E PORTAL ALUNO/RESPONSÁVEL ===');

  // ---------------------------------------------------------------------------
  // 1. TESTE BUG 1 — Rascunho de formulário com isolamento por tenant/usuário,
  //    remoção de campos sensíveis, preservação de etapa e limpeza
  // ---------------------------------------------------------------------------
  console.log('\n[1/5] Testando BUG 1: Persistência e isolamento de rascunho entre abas...');
  const draftScopeUserA = {
    tenantId: 'tenant-1',
    userId: 'user-admin-1',
    formKey: 'student_form:new',
  };
  const draftScopeUserB = {
    tenantId: 'tenant-1',
    userId: 'user-prof-2',
    formKey: 'student_form:new',
  };

  formDraftStore.saveDraft({
    ...draftScopeUserA,
    data: {
      fullName: 'Carlos Gracie Jr',
      cpf: '123.456.789-01',
      password: 'SUPER_SECRET_PASSWORD_SHOULD_BE_STRIPPED',
      accessToken: 'SECRET_TOKEN_SHOULD_BE_STRIPPED',
      nested: {
        EmergencyPhone: '11999999999',
        apiSecret: 'STRIP_ME',
      },
    },
    step: 2,
  });

  const loadedUserA = formDraftStore.loadDraft<Record<string, any>>(draftScopeUserA);
  assert(loadedUserA !== null, 'Rascunho do usuário A deveria ser recuperado.');
  assert(loadedUserA?.data.fullName === 'Carlos Gracie Jr', 'Nome preenchido no rascunho deve ser mantido.');
  assert(loadedUserA?.step === 2, 'Etapa atual do formulário multi-etapas (step=2) deve ser preservada.');
  assert(!('password' in (loadedUserA?.data || {})), 'Campo password jamais deve ser salvo no rascunho local.');
  assert(!('accessToken' in (loadedUserA?.data || {})), 'Campo accessToken jamais deve ser salvo no rascunho local.');
  assert(!('apiSecret' in (loadedUserA?.data?.nested || {})), 'Campo apiSecret aninhado jamais deve ser salvo.');

  const loadedUserB = formDraftStore.loadDraft<Record<string, any>>(draftScopeUserB);
  assert(loadedUserB === null, 'Dados de rascunho do usuário A NÃO podem aparecer para o usuário B.');

  // Limpeza ao concluir/cancelar
  formDraftStore.clearDraft(draftScopeUserA);
  const afterClear = formDraftStore.loadDraft<Record<string, any>>(draftScopeUserA);
  assert(afterClear === null, 'Rascunho deve ser descartado após conclusão ou cancelamento.');
  console.log('✓ BUG 1 validado com sucesso.');

  // ---------------------------------------------------------------------------
  // 2. TESTE BUG 2 — Persistência completa das configurações do Dojo
  // ---------------------------------------------------------------------------
  console.log('\n[2/5] Testando BUG 2: Gravação e recarregamento de configurações do Dojo...');
  const tenantsBefore = DataStore.getTenants();
  const targetTenant = tenantsBefore[0];
  assert(!!targetTenant, 'Pelo menos um tenant padrão deve existir.');
  const tenantId = targetTenant.id;

  const updatedTenantPayload: Tenant = {
    ...targetTenant,
    tradeName: 'Tatame Club Bushido Matriz',
    legalName: 'Academia Bushido Artes Marciais Ltda',
    cnpj: '12.345.678/0001-99',
    adminName: 'Mestre Kenji Takahashi',
    email: 'contato@bushidodojo.com.br',
    phone: '(11) 3344-5566',
    whatsapp: '(11) 98877-6655',
    website: 'https://bushidodojo.com.br',
    logoUrl: 'https://bushidodojo.com.br/logo.png',
    retentionDays: 730,
    address: {
      ...targetTenant.address,
      zipCode: '01310-100',
      street: 'Avenida Paulista',
      number: '1578',
      complement: 'Conjunto 42',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
    },
    settings: {
      ...targetTenant.settings,
      allowMultipleCheckinsPerDay: true,
      requireMedicalClearance: true,
      autoBlockDelinquentAfterDays: 10,
      pixKey: 'financeiro@bushidodojo.com.br',
      pixBeneficiaryName: 'Academia Bushido Ltda',
      defaultLateFeePercent: 2.5,
      dailyInterestRate: 0.05,
    },
  };

  const savedTenant = await authService.saveTenantSettings(updatedTenantPayload);
  assert(!!savedTenant && savedTenant.id === tenantId, 'Configurações do Dojo devem ser salvas com confirmação.');

  const reloadedTenant = await authService.fetchTenantSettings(tenantId);
  assert(reloadedTenant !== null, 'Configurações do Dojo recarregadas não podem ser nulas.');
  assert(reloadedTenant?.tradeName === 'Tatame Club Bushido Matriz', 'tradeName deve persistir.');
  assert(reloadedTenant?.legalName === 'Academia Bushido Artes Marciais Ltda', 'legalName deve persistir.');
  assert(reloadedTenant?.whatsapp === '(11) 98877-6655', 'whatsapp deve persistir.');
  assert(reloadedTenant?.website === 'https://bushidodojo.com.br', 'website deve persistir.');
  assert(reloadedTenant?.address.complement === 'Conjunto 42', 'address.complement deve persistir.');
  assert(reloadedTenant?.settings.dailyInterestRate === 0.05, 'settings.dailyInterestRate deve persistir.');
  assert(reloadedTenant?.settings.allowMultipleCheckinsPerDay === true, 'allowMultipleCheckinsPerDay deve persistir.');
  console.log('✓ BUG 2 validado com sucesso.');

  // ---------------------------------------------------------------------------
  // 3. TESTE TERMOS DE USO, POLÍTICA DE PRIVACIDADE (LGPD) E ACEITE JURÍDICO
  // ---------------------------------------------------------------------------
  console.log('\n[3/5] Testando Registro de Aceite Jurídico (Termos de Uso e LGPD)...');
  assert(!!LEGAL_DOCUMENT_VERSIONS.termsVersion, 'Versão dos Termos de Uso deve estar definida.');
  assert(!!LEGAL_DOCUMENT_VERSIONS.privacyVersion, 'Versão da Política de Privacidade deve estar definida.');
  assert(LEGAL_DOCUMENT_VERSIONS.developerCnpj === '28.410.730/0001-80', 'CNPJ da Beaver Soluções em Tecnologia deve ser 28.410.730/0001-80.');

  const legalRecord = await authService.recordLegalAcceptance({
    userId: 'user-admin-1',
    tenantId,
    termsVersion: LEGAL_DOCUMENT_VERSIONS.termsVersion,
    privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacyVersion,
    context: 'academy_registration',
  });
  assert(legalRecord.acceptedTerms === true && legalRecord.acknowledgedPrivacy === true, 'Aceite jurídico deve ser registrado com sucesso.');
  console.log('✓ Aceite jurídico e versões dos documentos validados com sucesso.');

  // ---------------------------------------------------------------------------
  // 4. TESTE GESTÃO DE CONTAS, CONVITE SEGURO E DUPLO PAPEL (ALUNO + RESPONSÁVEL)
  // ---------------------------------------------------------------------------
  console.log('\n[4/5] Testando Convite, Vínculo Seguro por CPF e Duplo Papel (Aluno + Responsável)...');
  const students = DataStore.getStudents();
  const persons = DataStore.getPersons();
  const adminActor = DataStore.getUsers().find((u) => u.tenantId === tenantId && u.role === 'owner')!;
  const targetStudent = students.find((s) => s.tenantId === tenantId)!;
  const targetStudentPerson = persons.find((p) => p.id === targetStudent.personId)!;

  // Admin cria convite para o aluno
  const inviteRes = await portalAccessService.manageAccountAccess({
    tenantId,
    targetType: 'student',
    targetId: targetStudent.id,
    action: 'invite',
    email: 'aluno.convidado@tatameclub.com.br',
    actor: adminActor,
  });
  assert(!!inviteRes.inviteCode, 'Convite de acesso do aluno deve gerar código único.');
  assert(inviteRes.status === 'invited', 'Status da conta do aluno deve mudar para invited.');

  // Tentativa de ativar convite com CPF incorreto deve falhar (impede vínculo automático indevido)
  let wrongCpfRejected = false;
  try {
    await portalAccessService.claimPortalInvitation({
      inviteCode: inviteRes.inviteCode!,
      cpf: '000.000.000-00',
      authenticatedUser: {
        id: 'user-new-student-auth',
        email: 'aluno.convidado@tatameclub.com.br',
        name: targetStudentPerson.fullName,
      },
    });
  } catch {
    wrongCpfRejected = true;
  }
  assert(wrongCpfRejected, 'Ativação de convite com CPF divergente DEVE ser bloqueada.');

  // Ativação com código correto + CPF correto do titular deve funcionar
  const validClaim = await portalAccessService.claimPortalInvitation({
    inviteCode: inviteRes.inviteCode!,
    cpf: targetStudentPerson.cpf,
    authenticatedUser: {
      id: 'user-new-student-auth',
      email: 'aluno.convidado@tatameclub.com.br',
      name: targetStudentPerson.fullName,
    },
  });
  assert(validClaim.role === 'student', 'Papel atribuído deve ser student.');

  // Verificar se o mesmo usuário também se tornar responsável na mesma academia (duplo papel)
  const guardians = DataStore.getGuardianRelationships();
  const sampleGuardianRel = guardians.find((g) => g.tenantId === tenantId)!;
  const guardianPerson = persons.find((p) => p.id === sampleGuardianRel.guardianPersonId)!;

  const guardianInvite = await portalAccessService.manageAccountAccess({
    tenantId,
    targetType: 'guardian',
    targetId: guardianPerson.id,
    action: 'invite',
    email: 'aluno.convidado@tatameclub.com.br',
    actor: adminActor,
  });
  assert(!!guardianInvite.inviteCode, 'Convite de responsável deve gerar código.');

  const dualRoleClaim = await portalAccessService.claimPortalInvitation({
    inviteCode: guardianInvite.inviteCode!,
    cpf: guardianPerson.cpf,
    authenticatedUser: {
      id: 'user-new-student-auth',
      email: 'aluno.convidado@tatameclub.com.br',
      name: guardianPerson.fullName,
    },
  });
  assert(!!dualRoleClaim.user, 'Mesmo usuário deve poder vincular também perfil de responsável.');

  const dualUser = DataStore.getAllUsers().find((u) => u.id === 'user-new-student-auth')!;
  const dualContext = portalAccessService.resolveAuthorizedPortalContext(dualUser, tenantId);
  assert(dualContext.canAccessStudentPortal, 'Usuário com duplo papel deve poder acessar portal do aluno.');
  assert(dualContext.canAccessGuardianPortal, 'Usuário com duplo papel deve poder acessar portal do responsável.');
  assert(dualContext.hasDualPortalRole, 'Flag hasDualPortalRole deve ser verdadeira para alternância de visão.');
  console.log('✓ Gestão de convites, proteção contra vínculo falso e duplo papel validados.');

  // ---------------------------------------------------------------------------
  // 5. TESTE PERMISSÕES ESTRITAS: ALUNO vs RESPONSÁVEL e BLOQUEIO DE ACESSO
  // ---------------------------------------------------------------------------
  console.log('\n[5/5] Testando isolamento de dados (Aluno vs Responsável) e revogação/bloqueio...');

  // 5a. Antropometria condicional para o aluno
  await portalAccessService.manageAccountAccess({
    tenantId,
    targetType: 'student',
    targetId: targetStudent.id,
    action: 'toggle_anthropometry',
    allowAnthropometry: false,
    actor: adminActor,
  });
  const assessmentsWhenDisabled = portalAccessService.getAuthorizedStudentAssessments({
    actor: dualUser,
    tenantId,
    targetStudentId: targetStudent.id,
    allAssessments: DataStore.getPhysicalAssessments(),
    students: DataStore.getStudents(),
    persons: DataStore.getPersons(),
    guardians: DataStore.getGuardianRelationships(),
  });
  assert(
    assessmentsWhenDisabled.length === 0,
    'Aluno NÃO deve ver avaliações antropométricas quando allowAnthropometryView=false.'
  );

  await portalAccessService.manageAccountAccess({
    tenantId,
    targetType: 'student',
    targetId: targetStudent.id,
    action: 'toggle_anthropometry',
    allowAnthropometry: true,
    actor: adminActor,
  });
  const statusAfterToggle = portalAccessService.getPortalAccountStatus(tenantId, 'student', targetStudent.id);
  assert(statusAfterToggle.allowAnthropometryView === true, 'allowAnthropometryView deve estar habilitado.');

  // 5b. Biblioteca Digital: Responsável PURO NÃO tem acesso; tentativa deve lançar erro 403
  const pureGuardianUser = DataStore.getAllUsers().find((u) => u.role === 'guardian' && !u.studentId)!;
  let guardianLibraryBlocked = false;
  try {
    await portalAccessService.getAuthorizedDigitalLibraryForActor({
      actor: pureGuardianUser,
      tenantId: pureGuardianUser.tenantId,
      students: DataStore.getStudents(),
      persons: DataStore.getPersons(),
      guardians: DataStore.getGuardianRelationships(),
    });
  } catch {
    guardianLibraryBlocked = true;
  }
  assert(
    guardianLibraryBlocked,
    'Responsável puro NÃO deve ter acesso à Biblioteca Digital do aluno.'
  );

  // 5c. Financeiro do Responsável: Apenas faturas dos alunos vinculados ao responsável
  const linkedStudentIds = guardians
    .filter((g) => g.tenantId === tenantId && g.guardianPersonId === guardianPerson.id)
    .map((g) => g.studentId);
  const authorizedInvoices = portalAccessService.getAuthorizedGuardianInvoices({
    actor: dualUser,
    tenantId,
    allInvoices: DataStore.getInvoices(),
    students: DataStore.getStudents(),
    persons: DataStore.getPersons(),
    guardians: DataStore.getGuardianRelationships(),
  });
  assert(
    authorizedInvoices.every((inv) => linkedStudentIds.includes(inv.studentId)),
    'Responsável deve visualizar exclusivamente cobranças de alunos formalmente vinculados a ele.'
  );

  // 5d. Autoatendimento: Aluno pode atualizar seu telefone/endereço próprio
  const updatedPerson = await portalAccessService.updateOwnStudentPersonalInfo({
    actor: dualUser,
    tenantId,
    studentId: targetStudent.id,
    phone: '(11) 97777-8888',
  });
  assert(updatedPerson.phone === '(11) 97777-8888', 'Aluno deve conseguir atualizar seu telefone de contato.');

  // 5e. Bloqueio administrativo revoga imediatamente o acesso do aluno
  await portalAccessService.manageAccountAccess({
    tenantId,
    targetType: 'student',
    targetId: targetStudent.id,
    action: 'block',
    actor: adminActor,
  });
  const contextAfterStudentBlock = portalAccessService.resolveAuthorizedPortalContext(
    DataStore.getAllUsers().find((u) => u.id === 'user-new-student-auth')!,
    tenantId
  );
  assert(
    !contextAfterStudentBlock.canAccessStudentPortal,
    'Aluno bloqueado pela academia deve perder acesso imediato ao Portal do Aluno.'
  );
  assert(
    contextAfterStudentBlock.canAccessGuardianPortal,
    'Quando apenas o vínculo de aluno é bloqueado, o vínculo de responsável independente deve continuar ativo.'
  );

  console.log('✓ Isolamento de permissões (Aluno/Responsável) e bloqueio imediato validados.');
  console.log('\n=== TODOS OS TESTES PASSARAM COM SUCESSO! ===');
}

runTests().catch((err) => {
  console.error('\n❌ ERRO NOS TESTES:', err);
  process.exit(1);
});
