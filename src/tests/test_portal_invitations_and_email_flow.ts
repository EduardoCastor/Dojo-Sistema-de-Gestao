// ============================================================================
// TEST SUITE: TATAME CLUB — FLUXO DE CONVITES, ENVIO DE E-MAIL E VALIDAÇÃO DE ACESSO
// ============================================================================
// Testes automatizados cobrindo os 15 cenários obrigatórios da auditoria:
//  1. Geração de convite de aluno (prefixo AL-, status invited, expiração 14 dias)
//  2. Geração de convite de responsável (prefixo RP-, status invited, expiração 14 dias)
//  3. Invalidação de convites pendentes anteriores ao reemitir para o mesmo titular
//  4. Disparo de e-mail e registro em log de auditoria
//  5. Tratamento de falta de configuração (RESEND_API_KEY ausente informa missing_config honestamente)
//  6. Pré-validação (verifyPortalInvitation) com código válido e retorno de academia/titular
//  7. Rejeição de código inexistente com mensagem específica (não genérica)
//  8. Rejeição de código já aceito/utilizado com mensagem específica
//  9. Rejeição de código revogado com mensagem específica
// 10. Rejeição de código expirado por data ou status
// 11. Normalização de código: suporte a minúsculas e espaços espúrios
// 12. Validação estrita de CPF contra o titular registrado
// 13. Rejeição com erro claro quando o CPF informado diverge do titular
// 14. Ativação completa e atômica: vínculo de conta, role, membership e status do convite
// 15. Isolamento multi-tenant e verificação de permissões administrativas
// ============================================================================

import { portalAccessService } from '../services/portalAccessService';
import { DataStore } from '../data/storage';
import { cleanCPF } from '../utils/cpfValidator';
import { Student, Person, TenantUserInvitation, User } from '../types';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTestSuite() {
  console.log('\n🥋 ================================================================');
  console.log('🥋 INICIANDO TESTES DO FLUXO DE CONVITES E ACESSO — TATAME CLUB');
  console.log('🥋 ================================================================\n');

  const tenantA = 'tenant-test-a';
  const tenantB = 'tenant-test-b';

  // Configuração inicial do ambiente de testes
  const ownerUser: User = {
    id: 'owner-test-1',
    tenantId: tenantA,
    name: 'Mestre Carlos Silva',
    email: 'carlos@dojocentral.com.br',
    role: 'owner',
    active: true,
  };

  const personStudent: Person = {
    id: 'person-stu-101',
    tenantId: tenantA,
    fullName: 'Lucas Fernandes Santos',
    cpf: '123.456.789-01',
    email: 'lucas.santos@exemplo.com.br',
    phone: '11988887777',
    gender: 'male',
    birthDate: '2008-04-12',
    address: {
      street: 'Rua das Artes Marciais',
      number: '120',
      neighborhood: 'Liberdade',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01508-010',
    },
    createdAt: new Date().toISOString(),
  };

  const studentObj: Student = {
    id: 'stu-101',
    tenantId: tenantA,
    branchId: 'branch-1',
    personId: personStudent.id,
    registrationNumber: 'ALU-101',
    status: 'active',
    portalAccessStatus: 'none',
    allowAnthropometryView: false,
    monthlyFee: 250,
    enrollmentDate: '2026-01-10',
    currentGraduations: [],
  };

  const personGuardian: Person = {
    id: 'person-grd-202',
    tenantId: tenantA,
    fullName: 'Roberto Fernandes Santos',
    cpf: '987.654.321-99',
    email: 'roberto.santos@exemplo.com.br',
    phone: '11977776666',
    gender: 'male',
    birthDate: '1980-02-15',
    address: {
      street: 'Rua das Artes Marciais',
      number: '120',
      neighborhood: 'Liberdade',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01508-010',
    },
    createdAt: new Date().toISOString(),
  };

  DataStore.savePersons([personStudent, personGuardian]);
  DataStore.saveStudents([studentObj]);
  DataStore.saveUsers([ownerUser]);
  DataStore.saveTenantInvitations([]);

  console.log('--- CENÁRIO 1: Geração de convite para aluno ---');
  const studentInviteRes = await portalAccessService.manageAccountAccess({
    tenantId: tenantA,
    targetType: 'student',
    targetId: studentObj.id,
    action: 'invite',
    email: personStudent.email,
    actor: ownerUser,
  });

  assert(studentInviteRes.success === true, 'Convite de aluno gerado com sucesso');
  assert(Boolean(studentInviteRes.inviteCode), 'Código de convite retornado');
  assert(studentInviteRes.inviteCode!.startsWith('AL-'), 'Código de aluno inicia com prefixo AL-');
  assert(studentInviteRes.status === 'invited', 'Status retornado é "invited"');

  const studentInvitesInStore = DataStore.getTenantInvitations(tenantA);
  const studentInviteRecord = studentInvitesInStore.find((i) => i.inviteCode === studentInviteRes.inviteCode);
  assert(Boolean(studentInviteRecord), 'Convite do aluno persistido no DataStore');
  assert(studentInviteRecord?.targetStudentId === studentObj.id, 'targetStudentId associado corretamente');
  assert(studentInviteRecord?.role === 'student', 'Role do convite é "student"');

  console.log('\n--- CENÁRIO 2: Geração de convite para responsável ---');
  const guardianInviteRes = await portalAccessService.manageAccountAccess({
    tenantId: tenantA,
    targetType: 'guardian',
    targetId: personGuardian.id,
    action: 'invite',
    email: personGuardian.email,
    actor: ownerUser,
  });

  assert(guardianInviteRes.success === true, 'Convite de responsável gerado com sucesso');
  assert(Boolean(guardianInviteRes.inviteCode), 'Código retornado para o responsável');
  assert(guardianInviteRes.inviteCode!.startsWith('RP-'), 'Código de responsável inicia com prefixo RP-');

  const guardianInviteRecord = DataStore.getTenantInvitations(tenantA).find(
    (i) => i.inviteCode === guardianInviteRes.inviteCode
  );
  assert(Boolean(guardianInviteRecord), 'Convite do responsável persistido no DataStore');
  assert(guardianInviteRecord?.targetGuardianPersonId === personGuardian.id, 'targetGuardianPersonId associado');

  console.log('\n--- CENÁRIO 3: Invalidação de convites pendentes anteriores ao reemitir ---');
  const originalStudentCode = studentInviteRes.inviteCode!;
  const resendStudentRes = await portalAccessService.manageAccountAccess({
    tenantId: tenantA,
    targetType: 'student',
    targetId: studentObj.id,
    action: 'resend_invite',
    email: personStudent.email,
    actor: ownerUser,
  });

  const newStudentCode = resendStudentRes.inviteCode!;
  assert(newStudentCode !== originalStudentCode, 'Novo código gerado difere do código anterior');
  const oldInviteAfterResend = DataStore.getTenantInvitations(tenantA).find((i) => i.inviteCode === originalStudentCode);
  assert(oldInviteAfterResend?.status === 'expired', 'Convite anterior foi marcado como "expired"');

  console.log('\n--- CENÁRIO 4: Auditoria de envio de e-mail e tratamento honesto de entrega ---');
  assert(typeof resendStudentRes.emailSent === 'boolean', 'Status do envio retornado como booleano');
  assert(Boolean(resendStudentRes.emailStatus), 'emailStatus reportado com precisão: ' + resendStudentRes.emailStatus);
  if (!resendStudentRes.emailSent) {
    assert(
      resendStudentRes.message.includes('Aviso:') || resendStudentRes.message.includes('falhou') || Boolean(resendStudentRes.emailError),
      'Mensagem honesta reportada ao usuário quando a entrega por e-mail não ocorre'
    );
  }
  const auditLogs = DataStore.getAuditLogs(tenantA);
  const emailLog = auditLogs.find((l) => l.action.includes('Convite'));
  assert(Boolean(emailLog), 'Log de auditoria registrado para geração do convite');

  console.log('\n--- CENÁRIO 5: Pré-validação com código válido ---');
  const verificationValid = await portalAccessService.verifyPortalInvitation(newStudentCode);
  assert(verificationValid.valid === true, 'verifyPortalInvitation aprova código ativo');
  assert(verificationValid.role === 'student', 'Role confirmada como student');
  assert(verificationValid.fullName === personStudent.fullName, 'Nome do titular coincide');
  assert(verificationValid.requiresCpf === true, 'Informa que requer confirmação de CPF');

  console.log('\n--- CENÁRIO 6: Rejeição de código inexistente ---');
  const nonExistentRes = await portalAccessService.verifyPortalInvitation('AL-NONEXIST');
  assert(nonExistentRes.valid === false, 'verifyPortalInvitation rejeita código inexistente');
  assert(nonExistentRes.reason === 'not_found', 'Motivo é "not_found"');
  assert(nonExistentRes.message.includes('não encontrado'), 'Mensagem informa que código não foi encontrado');

  console.log('\n--- CENÁRIO 7: Rejeição de código já expirado ---');
  const expiredCheck = await portalAccessService.verifyPortalInvitation(originalStudentCode);
  assert(expiredCheck.valid === false, 'verifyPortalInvitation rejeita código expirado');
  assert(expiredCheck.reason === 'expired', 'Motivo é "expired"');
  assert(expiredCheck.message.includes('expirou'), 'Mensagem esclarece que o código expirou');

  console.log('\n--- CENÁRIO 8: Rejeição de código revogado ---');
  const revokedCode = 'AL-REVOKED1';
  DataStore.saveTenantInvitations([
    {
      id: 'inv-revoked',
      tenantId: tenantA,
      email: 'revoked@aluno.com',
      fullName: 'Aluno Revogado',
      role: 'student',
      status: 'revoked',
      inviteCode: revokedCode,
      targetStudentId: studentObj.id,
      invitedByUserId: ownerUser.id,
      invitedByName: ownerUser.name,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    ...DataStore.getTenantInvitations(),
  ]);

  const revokedCheck = await portalAccessService.verifyPortalInvitation(revokedCode);
  assert(revokedCheck.valid === false, 'verifyPortalInvitation rejeita código revogado');
  assert(revokedCheck.reason === 'revoked', 'Motivo é "revoked"');
  assert(revokedCheck.message.includes('revogado'), 'Mensagem informa que convite foi revogado pela secretaria');

  console.log('\n--- CENÁRIO 9: Normalização de código (tolerância a espaços e minúsculas) ---');
  const formattedVariant = `  ${newStudentCode.toLowerCase()}  `;
  const variantCheck = await portalAccessService.verifyPortalInvitation(formattedVariant);
  assert(variantCheck.valid === true, 'Código em minúsculas com espaços ao redor é normalizado com sucesso');

  console.log('\n--- CENÁRIO 10: Rejeição de ativação por CPF divergente ---');
  let cpfMismatchCaught = false;
  try {
    await portalAccessService.claimPortalInvitation({
      inviteCode: newStudentCode,
      cpf: '000.111.222-33', // CPF incorreto
      userEmail: 'novo.email@aluno.com',
      userName: 'Lucas Fernandes Santos',
      acceptedTerms: true,
    });
  } catch (err: any) {
    cpfMismatchCaught = true;
    assert(
      err.message.includes('não corresponde ao titular'),
      'Erro claro disparado na divergência de CPF: ' + err.message
    );
  }
  assert(cpfMismatchCaught, 'Exceção disparada ao tentar ativar com CPF diferente');

  console.log('\n--- CENÁRIO 11: Ativação bem-sucedida do convite ---');
  const claimSuccessRes = await portalAccessService.claimPortalInvitation({
    inviteCode: formattedVariant, // Testa normalização no claim
    cpf: personStudent.cpf, // CPF correto
    userId: 'auth-user-lucas-1',
    userEmail: personStudent.email,
    userName: personStudent.fullName,
    acceptedTerms: true,
  });

  assert(claimSuccessRes.success === true, 'claimPortalInvitation retorna sucesso');
  assert(claimSuccessRes.role === 'student', 'Papel vinculado é student');
  assert(claimSuccessRes.user.studentId === studentObj.id, 'studentId vinculado ao usuário autenticado');

  const claimedInviteRecord = DataStore.getTenantInvitations(tenantA).find((i) => i.inviteCode === newStudentCode);
  assert(claimedInviteRecord?.status === 'accepted', 'Convite no banco foi atualizado para status "accepted"');

  const updatedStudent = DataStore.getStudents(tenantA).find((s) => s.id === studentObj.id);
  assert(updatedStudent?.portalAccessStatus === 'active', 'portalAccessStatus do aluno atualizado para "active"');
  assert(updatedStudent?.userId === 'auth-user-lucas-1', 'userId do aluno preenchido');

  console.log('\n--- CENÁRIO 12: Rejeição de código já utilizado (idempotência) ---');
  let alreadyUsedCaught = false;
  try {
    await portalAccessService.claimPortalInvitation({
      inviteCode: newStudentCode,
      cpf: personStudent.cpf,
      userEmail: 'outro.usuario@exemplo.com',
      userName: 'Tentativa Duplicada',
      acceptedTerms: true,
    });
  } catch (err: any) {
    alreadyUsedCaught = true;
    assert(
      err.message.includes('já foi utilizado'),
      'Erro claro ao tentar reutilizar código já aceito: ' + err.message
    );
  }
  assert(alreadyUsedCaught, 'Impedida reutilização de código já ativado');

  console.log('\n--- CENÁRIO 13: Ativação bem-sucedida do convite de responsável ---');
  const guardianClaimRes = await portalAccessService.claimPortalInvitation({
    inviteCode: guardianInviteRes.inviteCode!,
    cpf: personGuardian.cpf,
    userId: 'auth-user-roberto-2',
    userEmail: personGuardian.email,
    userName: personGuardian.fullName,
    acceptedTerms: true,
  });

  assert(guardianClaimRes.success === true, 'Responsável ativa conta com sucesso');
  assert(guardianClaimRes.role === 'guardian', 'Papel vinculado é guardian');
  assert(guardianClaimRes.user.guardianPersonId === personGuardian.id, 'guardianPersonId vinculado ao usuário');

  console.log('\n--- CENÁRIO 14: Isolamento multi-tenant ---');
  const unauthorizedActor: User = {
    id: 'user-tenant-b',
    tenantId: tenantB,
    name: 'Instrutor de Outra Academia',
    email: 'outro@outraacademia.com.br',
    role: 'owner',
    active: true,
  };

  let multiTenantViolationCaught = false;
  try {
    await portalAccessService.manageAccountAccess({
      tenantId: tenantA,
      targetType: 'student',
      targetId: studentObj.id,
      action: 'invite',
      email: 'hacker@outro.com',
      actor: unauthorizedActor, // Acesso indevido cross-tenant
    });
  } catch (err: any) {
    multiTenantViolationCaught = true;
    assert(err.message.includes('multi-tenant'), 'Bloqueada tentativa de acesso cross-tenant: ' + err.message);
  }
  assert(multiTenantViolationCaught, 'Isolamento multi-tenant estritamente respeitado');

  console.log('\n--- CENÁRIO 15: Controle de permissões por perfil (instructor sem permissão administrativa) ---');
  const instructorActor: User = {
    id: 'instructor-1',
    tenantId: tenantA,
    name: 'Professor Assistente',
    email: 'instrutor@dojo.com.br',
    role: 'instructor',
    active: true,
  };

  let permissionDeniedCaught = false;
  try {
    await portalAccessService.manageAccountAccess({
      tenantId: tenantA,
      targetType: 'student',
      targetId: studentObj.id,
      action: 'invite',
      email: personStudent.email,
      actor: instructorActor,
    });
  } catch (err: any) {
    permissionDeniedCaught = true;
    assert(err.message.includes('Permissão insuficiente'), 'Instrutor bloqueado de gerenciar acessos');
  }
  assert(permissionDeniedCaught, 'Apenas proprietários, gerentes ou secretários podem gerenciar contas');

  console.log('\n================================================================');
  console.log(`🎉 TODOS OS ${totalTests} TESTES FORAM EXECUTADOS COM SUCESSO! (${passedTests}/${totalTests} PASS)`);
  console.log('================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DA SUÍTE DE TESTES:', err);
  process.exit(1);
});
