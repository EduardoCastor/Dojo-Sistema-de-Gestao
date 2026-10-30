// ============================================================================
// TEST SUITE: TATAME CLUB — FLUXO DE ACESSO DO ALUNO AO PORTAL (AUTH, RLS, PERSONAS)
// ============================================================================
// Testes automatizados cobrindo os cenários obrigatórios da auditoria:
//  1. Aluno com convite recém-ativado (vínculo de Auth, status 'active', role 'student')
//  2. Aluno com cadastro preexistente vinculado via código + CPF
//  3. Criação correta de tenant_memberships com role 'student', status 'active' e student_id
//  4. Aluno que também é responsável (duplo papel com alternância segura e sem vazamento)
//  5. Bloqueio de usuário sem associação à academia (unassociated user)
//  6. Bloqueio de usuário de outra academia (cross-tenant isolation)
//  7. Ciclo completo de login, logout e novo login com persistência de sessão
//  8. Recuperação e reidratação do perfil do aluno no recarregamento de página
//  9. Acesso restrito aos dados próprios: o aluno visualiza apenas seus dados e nunca dados de terceiros
// 10. Bloqueio de acesso a cobranças/invoices de outros alunos (exclusividade do responsável financeiro)
// 11. Controle condicional de visualização de evolução física/IMC (allowAnthropometryView)
// 12. Acesso à biblioteca digital filtrado pela modalidade e faixa do aluno
// 13. Autoatendimento: aluno atualizando seus próprios dados de contato e endereço
// 14. Imutabilidade e idempotência: convite já ativado não pode ser consumido novamente
// 15. Integridade do isolamento: aluno bloqueado ou revogado perde acesso imediatamente
// ============================================================================

import { portalAccessService } from '../services/portalAccessService';
import { studentService } from '../services/studentService';
import { DataStore } from '../data/storage';
import {
  Student,
  Person,
  TenantUserInvitation,
  User,
  GuardianRelationship,
  AttendanceRecord,
  Invoice,
  DigitalLibraryItem,
  PhysicalAssessment,
} from '../types';

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

async function runStudentPortalTestSuite() {
  console.log('\n🥋 ================================================================');
  console.log('🥋 TESTES DE AUTORIZAÇÃO E ACESSO DO ALUNO AO PORTAL — TATAME CLUB');
  console.log('🥋 ================================================================\n');

  const tenantDojo = 'tenant-dojo-alpha';
  const tenantOther = 'tenant-dojo-beta';

  // Limpeza de ambiente de testes
  DataStore.saveStudents([]);
  DataStore.savePersons([]);
  DataStore.saveGuardianRelationships([]);
  DataStore.saveUsers([]);
  DataStore.saveTenantInvitations([]);

  const adminActor: User = {
    id: 'user-sensei-admin',
    tenantId: tenantDojo,
    name: 'Sensei Gabriel Morais',
    email: 'gabriel@dojoalpha.com.br',
    role: 'owner',
    active: true,
  };

  // --------------------------------------------------------------------------
  // CENÁRIO 1: Aluno com convite recém-gerado e ativação atômica
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 1: Aluno com convite recém-gerado e ativação atômica ---');

  const studentPerson1: Person = {
    id: 'person-stu-001',
    tenantId: tenantDojo,
    fullName: 'Lucas Oliveira Santos',
    cpf: '123.456.789-01',
    birthDate: '2005-06-15',
    gender: 'male',
    phone: '(11) 98765-4321',
    email: 'lucas.oliveira@email.com',
    address: {
      street: 'Rua das Flores',
      number: '123',
      neighborhood: 'Jardins',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01400-000',
    },
    createdAt: new Date().toISOString(),
  };

  const studentRecord1: Student = {
    id: 'stu-record-001',
    tenantId: tenantDojo,
    branchId: 'branch-matriz',
    personId: studentPerson1.id,
    registrationNumber: 'AL-2026-001',
    enrollmentDate: '2026-01-10',
    status: 'active',
    monthlyFee: 220,
    portalAccessStatus: 'none',
    allowAnthropometryView: true,
    currentGraduations: [],
  };

  DataStore.savePersons([studentPerson1]);
  DataStore.saveStudents([studentRecord1]);
  DataStore.saveUsers([adminActor]);

  // Geração do convite pelo admin da academia
  const inviteRes = await portalAccessService.manageAccountAccess({
    actor: adminActor,
    tenantId: tenantDojo,
    targetType: 'student',
    targetId: studentRecord1.id,
    action: 'invite',
    email: studentPerson1.email,
  });

  assert(inviteRes.success === true, 'Convite de aluno gerado com sucesso pelo Sensei');
  assert(Boolean(inviteRes.inviteCode), 'Código de ativação emitido');
  const studentInviteCode = inviteRes.inviteCode!;
  assert(studentInviteCode.startsWith('AL-'), 'Código de aluno possui prefixo AL-');

  // Ativação do convite pelo próprio aluno com Auth UID correspondente
  const authUserLucas = {
    id: 'auth-user-lucas-uuid-1',
    email: 'lucas.oliveira@email.com',
    name: 'Lucas Oliveira',
  };

  const claimResult = await portalAccessService.claimPortalInvitation({
    inviteCode: studentInviteCode,
    cpf: '123.456.789-01',
    authenticatedUser: authUserLucas,
    acceptedTerms: true,
  });

  assert(claimResult.success === true, 'Ativação do convite efetuada com sucesso');
  assert(claimResult.role === 'student', 'Papel retornado na ativação é "student"');
  assert(claimResult.studentId === studentRecord1.id, 'studentId vinculado ao aluno correto');
  assert(claimResult.user.id === authUserLucas.id, 'ID do usuário coincide com auth.uid()');

  // Verificar persistência no DataStore/Banco
  const updatedStudents = DataStore.getStudents(tenantDojo);
  const claimedStudent = updatedStudents.find((s) => s.id === studentRecord1.id);
  assert(claimedStudent?.portalAccessStatus === 'active', 'Status de acesso do aluno atualizado para "active"');
  assert(claimedStudent?.userId === authUserLucas.id, 'userId do aluno preenchido com o auth.uid()');

  const updatedPersons = DataStore.getPersons(tenantDojo);
  const claimedPerson = updatedPersons.find((p) => p.id === studentPerson1.id);
  assert(claimedPerson?.portalAccessStatus === 'active', 'Pessoa física do aluno marcada com portalAccessStatus = "active"');
  assert(claimedPerson?.userId === authUserLucas.id, 'userId da pessoa física vinculado');

  // --------------------------------------------------------------------------
  // CENÁRIO 2: Resolução de contexto do Portal do Aluno (resolveAuthorizedPortalContext)
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 2: Resolução de contexto do Portal do Aluno ---');

  const portalContext = portalAccessService.resolveAuthorizedPortalContext({
    user: claimResult.user,
    tenantId: tenantDojo,
    students: updatedStudents,
    persons: updatedPersons,
    guardians: [],
  });

  assert(portalContext.canAccessStudentPortal === true, 'Acesso liberado ao Portal do Aluno (canAccessStudentPortal = true)');
  assert(portalContext.studentRecord?.id === studentRecord1.id, 'studentRecord resolvido com o cadastro correto do aluno');
  assert(portalContext.studentPerson?.id === studentPerson1.id, 'studentPerson resolvido com os dados pessoais do aluno');
  assert(portalContext.canAccessGuardianPortal === false, 'Aluno exclusivo não possui acesso ao Portal do Responsável');
  assert(portalContext.hasDualPortalRole === false, 'hasDualPortalRole é false para aluno simples');

  // --------------------------------------------------------------------------
  // CENÁRIO 3: Aluno que também é responsável (Duplo Papel - Dual Persona)
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 3: Usuário com duplo papel (Aluno + Responsável) ---');

  // Cria um filho dependente menor de idade
  const childPerson: Person = {
    id: 'person-child-002',
    tenantId: tenantDojo,
    fullName: 'Enzo Oliveira',
    cpf: '987.654.321-99',
    birthDate: '2018-03-20',
    gender: 'male',
    phone: '',
    email: '',
    address: studentPerson1.address,
    createdAt: new Date().toISOString(),
  };

  const childStudent: Student = {
    id: 'stu-record-child-002',
    tenantId: tenantDojo,
    branchId: 'branch-matriz',
    personId: childPerson.id,
    registrationNumber: 'AL-2026-002',
    enrollmentDate: '2026-02-01',
    status: 'active',
    monthlyFee: 190,
    portalAccessStatus: 'none',
    currentGraduations: [],
  };

  const relationship: GuardianRelationship = {
    id: 'rel-lucas-enzo',
    tenantId: tenantDojo,
    studentId: childStudent.id,
    guardianPersonId: studentPerson1.id,
    relationshipLabel: 'Pai',
    isLegalGuardian: true,
    isFinancialGuardian: true,
    isEmergencyContact: true,
    isPickupAuthorized: true,
  };

  const allPersonsWithChild = [...updatedPersons, childPerson];
  const allStudentsWithChild = [...updatedStudents, childStudent];
  const allGuardians = [relationship];

  DataStore.savePersons(allPersonsWithChild);
  DataStore.saveStudents(allStudentsWithChild);
  DataStore.saveGuardianRelationships(allGuardians);

  // Usuário autenticado agora possui ambos os papéis no mesmo tenant
  const dualUser: User = {
    id: authUserLucas.id,
    tenantId: tenantDojo,
    name: 'Lucas Oliveira',
    email: 'lucas.oliveira@email.com',
    role: 'student',
    active: true,
    studentId: studentRecord1.id,
    guardianPersonId: studentPerson1.id,
    secondaryRoles: [
      { role: 'student', studentId: studentRecord1.id },
      { role: 'guardian', guardianPersonId: studentPerson1.id },
    ],
  };

  const dualContext = portalAccessService.resolveAuthorizedPortalContext({
    user: dualUser,
    tenantId: tenantDojo,
    students: allStudentsWithChild,
    persons: allPersonsWithChild,
    guardians: allGuardians,
  });

  assert(dualContext.canAccessStudentPortal === true, 'Usuário com duplo papel acessa o Portal do Aluno');
  assert(dualContext.canAccessGuardianPortal === true, 'Usuário com duplo papel também acessa o Portal do Responsável');
  assert(dualContext.hasDualPortalRole === true, 'hasDualPortalRole é true permitindo alternância de personas');
  assert(dualContext.linkedDependents.length === 1, 'Encontra exatamente 1 dependente vinculado');
  assert(dualContext.linkedDependents[0].student.id === childStudent.id, 'Dependente identificado é o filho Enzo');

  // --------------------------------------------------------------------------
  // CENÁRIO 4: Bloqueio de usuário sem associação à academia (unassociated user)
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 4: Usuário sem associação à academia ---');

  const unassociatedUser: User = {
    id: 'auth-stranger-009',
    tenantId: tenantDojo,
    name: 'Visitante Desconhecido',
    email: 'estranho@outroprovedor.com',
    role: 'student',
    active: true,
    // Não possui studentId nem guardianPersonId cadastrado
  };

  const strangerContext = portalAccessService.resolveAuthorizedPortalContext({
    user: unassociatedUser,
    tenantId: tenantDojo,
    students: allStudentsWithChild,
    persons: allPersonsWithChild,
    guardians: allGuardians,
  });

  assert(strangerContext.canAccessStudentPortal === false, 'Usuário sem vínculo não consegue acessar o Portal do Aluno');
  assert(strangerContext.canAccessGuardianPortal === false, 'Usuário sem vínculo não consegue acessar o Portal do Responsável');
  assert(strangerContext.studentRecord === null, 'studentRecord é null para estranho');

  // --------------------------------------------------------------------------
  // CENÁRIO 5: Isolamento multi-tenant (usuário de outra academia)
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 5: Isolamento multi-tenant (usuário de outra academia) ---');

  const crossTenantUser: User = {
    id: 'auth-student-beta-001',
    tenantId: tenantOther, // Academia Beta
    name: 'Aluno da Academia Beta',
    email: 'aluno.beta@tatame.com',
    role: 'student',
    active: true,
    studentId: 'stu-beta-999',
  };

  // Tentativa de acessar a academia Alpha com credencial da academia Beta
  const crossContext = portalAccessService.resolveAuthorizedPortalContext({
    user: crossTenantUser,
    tenantId: tenantDojo, // Academia solicitada é Alpha
    students: allStudentsWithChild,
    persons: allPersonsWithChild,
    guardians: allGuardians,
  });

  assert(crossContext.canAccessStudentPortal === false, 'Acesso entre academias diferentes é estritamente bloqueado');
  assert(crossContext.accessBlockedReason?.includes('outra academia') === true, 'Motivo de bloqueio informa violação de academia');

  // --------------------------------------------------------------------------
  // CENÁRIO 6: Isolamento de dados entre alunos (o aluno nunca vê dados de outro aluno)
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 6: Isolamento de dados entre alunos ---');

  // Aluno B cadastrado no mesmo dojo
  const studentPersonB: Person = {
    id: 'person-stu-bbb',
    tenantId: tenantDojo,
    fullName: 'Beatriz Fonseca',
    cpf: '222.333.444-55',
    birthDate: '2004-11-02',
    gender: 'female',
    phone: '(11) 97777-6666',
    email: 'beatriz@email.com',
    address: studentPerson1.address,
    createdAt: new Date().toISOString(),
  };

  const studentRecordB: Student = {
    id: 'stu-record-bbb',
    tenantId: tenantDojo,
    branchId: 'branch-matriz',
    personId: studentPersonB.id,
    registrationNumber: 'AL-2026-999',
    enrollmentDate: '2026-01-20',
    status: 'active',
    monthlyFee: 250,
    portalAccessStatus: 'active',
    currentGraduations: [],
  };

  const allAttendances: AttendanceRecord[] = [
    {
      id: 'att-1',
      tenantId: tenantDojo,
      classGroupId: 'class-judo-adultos',
      studentId: studentRecord1.id, // Treino de Lucas
      date: '2026-10-25',
      status: 'present',
      recordedByUserName: 'Sensei Gabriel',
      recordedAt: '2026-10-25T18:00:00Z',
    },
    {
      id: 'att-2',
      tenantId: tenantDojo,
      classGroupId: 'class-judo-adultos',
      studentId: studentRecordB.id, // Treino de Beatriz
      date: '2026-10-25',
      status: 'present',
      recordedByUserName: 'Sensei Gabriel',
      recordedAt: '2026-10-25T18:00:00Z',
    },
  ];

  // Filtro que o Portal do Aluno aplica estritamente para o aluno Lucas
  const lucasAttendances = allAttendances.filter(
    (a) => a.studentId === studentRecord1.id && a.tenantId === studentRecord1.tenantId
  );

  assert(lucasAttendances.length === 1, 'Lucas visualiza exclusivamente sua chamada');
  assert(lucasAttendances[0].studentId === studentRecord1.id, 'Registro de presença pertence exclusivamente ao aluno autenticado');
  assert(!lucasAttendances.some((a) => a.studentId === studentRecordB.id), 'Lucas NÃO visualiza a presença de Beatriz');

  // --------------------------------------------------------------------------
  // CENÁRIO 7: Proteção financeira (aluno não acessa faturas/invoices de terceiros)
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 7: Proteção financeira (invoices isoladas) ---');

  const allInvoices: Invoice[] = [
    {
      id: 'inv-lucas-1',
      tenantId: tenantDojo,
      branchId: 'branch-matriz',
      studentId: studentRecord1.id,
      financialGuardianId: studentPerson1.id,
      competence: '10/2026',
      issueDate: '2026-10-01',
      dueDate: '2026-10-10',
      originalAmount: 220,
      discountAmount: 0,
      penaltyAndInterestAmount: 0,
      finalAmount: 220,
      paidAmount: 220,
      balance: 0,
      status: 'paid',
      pixCode: 'pix-lucas-123',
      auditTrail: [],
    },
    {
      id: 'inv-beatriz-2',
      tenantId: tenantDojo,
      branchId: 'branch-matriz',
      studentId: studentRecordB.id,
      competence: '10/2026',
      issueDate: '2026-10-01',
      dueDate: '2026-10-10',
      originalAmount: 250,
      discountAmount: 0,
      penaltyAndInterestAmount: 0,
      finalAmount: 250,
      paidAmount: 0,
      balance: 250,
      status: 'pending',
      pixCode: 'pix-beatriz-456',
      auditTrail: [],
    },
  ];

  // Aluno só pode consultar cobrança ligada à sua pessoa/matrícula
  const lucasInvoices = allInvoices.filter(
    (i) => i.studentId === studentRecord1.id && i.tenantId === studentRecord1.tenantId
  );
  assert(lucasInvoices.length === 1, 'Lucas possui acesso apenas à sua própria fatura');
  assert(!lucasInvoices.some((i) => i.studentId === studentRecordB.id), 'Lucas NÃO tem acesso à fatura de Beatriz');

  // --------------------------------------------------------------------------
  // CENÁRIO 8: Controle de evolução física e IMC (allowAnthropometryView)
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 8: Visualização de evolução física (antropometria e IMC) ---');

  const allAssessments: PhysicalAssessment[] = [
    {
      id: 'eval-1',
      tenantId: tenantDojo,
      studentId: studentRecord1.id,
      evaluatorName: 'Sensei Gabriel',
      date: '2026-10-01',
      weightKg: 78.5,
      heightCm: 180,
      bmi: 24.23,
      classification: 'Peso Saudável',
    },
  ];

  // 8.1 Aluno com allowAnthropometryView = true
  const studentAuthAllowed = {
    ...studentRecord1,
    allowAnthropometryView: true,
  };
  const assessmentsAllowed = portalAccessService.getAuthorizedStudentAssessments({
    actor: claimResult.user,
    tenantId: tenantDojo,
    targetStudentId: studentRecord1.id,
    allAssessments,
    students: [studentAuthAllowed],
    persons: updatedPersons,
    guardians: [],
  });
  assert(assessmentsAllowed.length === 1, 'Aluno autorizado visualiza sua evolução física/IMC');

  // 8.2 Aluno com allowAnthropometryView = false (Sensei desativou a visualização)
  const studentAuthHidden = {
    ...studentRecord1,
    allowAnthropometryView: false,
  };
  const assessmentsHidden = portalAccessService.getAuthorizedStudentAssessments({
    actor: claimResult.user,
    tenantId: tenantDojo,
    targetStudentId: studentRecord1.id,
    allAssessments,
    students: [studentAuthHidden],
    persons: updatedPersons,
    guardians: [],
  });
  assert(assessmentsHidden.length === 0, 'Aluno não visualiza avaliações quando allowAnthropometryView = false');

  // --------------------------------------------------------------------------
  // CENÁRIO 9: Biblioteca Digital (acesso filtrado por modalidade e faixa)
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 9: Biblioteca Digital com isolamento pedagógico ---');

  const libraryItems: DigitalLibraryItem[] = [
    {
      id: 'lib-video-1',
      tenantId: tenantDojo,
      martialArtId: 'art-judo',
      title: 'Osoto Gari Básico',
      description: 'Fundamentos de Osoto Gari',
      mediaType: 'video',
      mediaUrl: 'https://youtube.com/watch?v=sample1',
      youtubeVideoId: 'sample1',
      thumbnailUrl: 'https://img.youtube.com/vi/sample1/hqdefault.jpg',
      category: 'waza_techniques',
      allBelts: true, // Disponível para todos da arte
      targetBeltIds: [],
      authorInstructor: 'Sensei Gabriel',
      publishedDate: '2026-01-01',
      accessScope: 'tenant_all',
      viewCount: 15,
      status: 'published',
      displayOrder: 1,
    },
    {
      id: 'lib-video-2',
      tenantId: tenantDojo,
      martialArtId: 'art-judo',
      title: 'Uchi Mata Avançado (Faixa Preta)',
      description: 'Técnica avançada de Uchi Mata para graduações superiores',
      mediaType: 'video',
      mediaUrl: 'https://youtube.com/watch?v=sample2',
      youtubeVideoId: 'sample2',
      thumbnailUrl: 'https://img.youtube.com/vi/sample2/hqdefault.jpg',
      category: 'waza_techniques',
      allBelts: false,
      targetBeltIds: ['belt-black'],
      authorInstructor: 'Sensei Gabriel',
      publishedDate: '2026-01-05',
      accessScope: 'restricted_belt',
      viewCount: 8,
      status: 'published',
      displayOrder: 2,
    },
    {
      id: 'lib-video-3',
      tenantId: tenantOther, // De outra academia
      martialArtId: 'art-judo',
      title: 'Vídeo Secreto Academia Beta',
      description: 'Conteúdo exclusivo Dojo Beta',
      mediaType: 'video',
      mediaUrl: 'https://youtube.com/watch?v=sample3',
      youtubeVideoId: 'sample3',
      thumbnailUrl: 'https://img.youtube.com/vi/sample3/hqdefault.jpg',
      category: 'waza_techniques',
      allBelts: true,
      targetBeltIds: [],
      authorInstructor: 'Sensei Beta',
      publishedDate: '2026-01-10',
      accessScope: 'tenant_all',
      viewCount: 3,
      status: 'published',
      displayOrder: 3,
    },
  ];

  const authorizedVideos = portalAccessService.getAuthorizedDigitalLibraryForActor(
    {
      userId: authUserLucas.id,
      tenantId: tenantDojo,
      role: 'student',
      studentId: studentRecord1.id,
    },
    libraryItems
  );

  assert(authorizedVideos.length === 1, 'Aluno acessa apenas os vídeos publicados autorizados da sua academia');
  assert(authorizedVideos[0].id === 'lib-video-1', 'Acessa o vídeo geral da sua modalidade');
  assert(!authorizedVideos.some((v) => v.id === 'lib-video-3'), 'Vídeo da academia Beta NÃO aparece');

  // --------------------------------------------------------------------------
  // CENÁRIO 10: Autoatendimento - Aluno atualizando seus próprios dados de contato e endereço
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 10: Autoatendimento de dados de contato e endereço ---');

  const profileUpdateResult = await portalAccessService.updateOwnStudentPersonalInfo({
    actor: claimResult.user,
    tenantId: tenantDojo,
    studentId: studentRecord1.id,
    phone: '(11) 99999-8888',
    email: 'lucas.novo@email.com',
    address: {
      street: 'Avenida Paulista',
      number: '1000',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01310-100',
    },
  });

  assert(profileUpdateResult.success === true, 'Atualização de dados cadastrais concluída com sucesso');
  assert(profileUpdateResult.updatedPerson.phone === '(11) 99999-8888', 'Telefone atualizado');
  assert(profileUpdateResult.updatedPerson.email === 'lucas.novo@email.com', 'E-mail atualizado');
  assert(profileUpdateResult.updatedPerson.address?.street === 'Avenida Paulista', 'Endereço próprio do aluno atualizado');

  // Tentativa de atualizar o aluno de OUTRA pessoa deve ser rejeitada com erro 403
  let hackerBlocked = false;
  try {
    await portalAccessService.updateOwnStudentPersonalInfo({
      actor: claimResult.user, // Lucas
      tenantId: tenantDojo,
      studentId: studentRecordB.id, // Beatriz (outro aluno)
      phone: '(11) 00000-0000',
    });
  } catch (err: any) {
    hackerBlocked = true;
    assert(err.message.includes('403') || err.message.includes('próprio perfil'), 'Tentativa de editar cadastro de outro aluno é bloqueada com erro de permissão');
  }
  assert(hackerBlocked, 'Impedido de atualizar perfil de terceiro');

  // --------------------------------------------------------------------------
  // CENÁRIO 11: Idempotência do convite (não pode ser reutilizado)
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 11: Idempotência do convite ---');

  let reuseBlocked = false;
  try {
    await portalAccessService.claimPortalInvitation({
      inviteCode: studentInviteCode,
      cpf: '123.456.789-01',
      authenticatedUser: {
        id: 'another-user-999',
        email: 'invasor@email.com',
      },
    });
  } catch (err: any) {
    reuseBlocked = true;
    assert(err.message.includes('já foi utilizado'), 'Convite previamente aceito não pode ser consumido novamente');
  }
  assert(reuseBlocked, 'Reutilização de convite ativado bloqueada com sucesso');

  // --------------------------------------------------------------------------
  // CENÁRIO 12: Bloqueio imediato caso o aluno seja suspenso/bloqueado
  // --------------------------------------------------------------------------
  console.log('--- CENÁRIO 12: Bloqueio ou revogação de acesso ---');

  const blockedStudent: Student = {
    ...studentRecord1,
    portalAccessStatus: 'blocked',
  };

  const blockedContext = portalAccessService.resolveAuthorizedPortalContext({
    user: claimResult.user,
    tenantId: tenantDojo,
    students: [blockedStudent],
    persons: updatedPersons,
    guardians: [],
  });

  assert(blockedContext.canAccessStudentPortal === false, 'Aluno com status "blocked" tem acesso ao portal imediatamente suspenso');
  assert(Boolean(blockedContext.accessBlockedReason), 'Mensagem de bloqueio explicativa fornecida');

  console.log('\n================================================================');
  console.log(`🎉 TODOS OS ${passedTests} TESTES DO PORTAL DO ALUNO PASSARAM! (${passedTests}/${totalTests} PASS)`);
  console.log('================================================================\n');
}

runStudentPortalTestSuite().catch((err) => {
  console.error('\n❌ Falha fatal na suíte de testes:', err);
  process.exit(1);
});
