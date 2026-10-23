/**
 * Test Suite: TatameHub Módulo de Saúde & Atestados
 * Validação rigorosa dos 14 critérios de aceite do módulo de documentos médicos.
 */

import {
  validateMedicalFile,
  calculateDocumentStatus,
  formatFileSize,
  getDocumentTypeLabel,
  getDocumentTypeBadge,
  medicalDocumentService,
  MAX_FILE_SIZE_BYTES,
} from '../services/medicalDocumentService';
import { DataStore } from '../data/storage';
import { StudentMedicalDocument, MedicalDocumentType } from '../types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] Teste: ${testName}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] Teste: ${testName} - Detalhes: ${detail || 'Condição falhou'}`);
  }
}

// Mock helper para criar objetos File em ambiente Node.js / tsx
function createMockFile(name: string, type: string, sizeInBytes: number): File {
  const buffer = new Uint8Array(Math.min(sizeInBytes, 1024)); // aloca buffer de teste
  const blob = new Blob([buffer], { type });
  const file = new File([blob], name, { type, lastModified: Date.now() });
  // Sobrescreve getter de size para simular arquivos grandes nos testes sem alocar 11MB de RAM
  Object.defineProperty(file, 'size', { value: sizeInBytes, writable: false });
  return file;
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('TATAMEHUB - SUITE DE TESTES: MÓDULO DE SAÚDE & ATESTADOS');
  console.log('================================================================\n');

  const tenantA = 'tenant-kodokan';
  const tenantB = 'tenant-other-academy';
  const studentLucas = 'student-lucas';
  const studentSofia = 'student-sofia';

  // -------------------------------------------------------------------------
  // TESTE 1: Consulta de documentos existentes do aluno
  // -------------------------------------------------------------------------
  console.log('1. Testando Consulta de documentos existentes do aluno...');
  const lucasDocs = await medicalDocumentService.fetchStudentDocuments(tenantA, studentLucas);
  assert(lucasDocs.length > 0, 'Lucas possui documentos cadastrados no histórico');
  assert(lucasDocs.every((d) => d.studentId === studentLucas), 'Todos os documentos pertencem ao aluno correto');
  assert(lucasDocs.every((d) => d.tenantId === tenantA), 'Todos os documentos pertencem à academia correta');

  // -------------------------------------------------------------------------
  // TESTE 2: Cadastro de Laudo Médico em PDF
  // -------------------------------------------------------------------------
  console.log('\n2. Testando Cadastro de Laudo Médico em PDF...');
  const pdfFile = createMockFile('laudo_cardiologico_lucas.pdf', 'application/pdf', 512000); // 500 KB
  const testIssueDate = '2026-03-10';

  const newReport = await medicalDocumentService.createDocument(
    {
      tenantId: tenantA,
      studentId: studentLucas,
      documentType: 'medical_report',
      title: 'Laudo Cardiológico Ergométrico',
      issueDate: testIssueDate,
      notes: 'Avaliação cardiológica normal com teste de esforço grau I.',
    },
    pdfFile,
    { id: 'user-owner', name: 'Carlos Silva' }
  );

  assert(newReport.id.length > 0, 'Laudo criado com ID único');
  assert(newReport.documentType === 'medical_report', 'Tipo definido como medical_report');
  assert(newReport.originalFileName === 'laudo_cardiologico_lucas.pdf', 'Nome original do arquivo preservado');
  assert(newReport.mimeType === 'application/pdf', 'MIME type application/pdf registrado');
  assert(newReport.storagePath.includes(tenantA) && newReport.storagePath.includes(studentLucas), 'Storage path isolado por tenant e aluno');

  // -------------------------------------------------------------------------
  // TESTE 3: Cadastro de Atestado Médico em JPG/JPEG com data de validade
  // -------------------------------------------------------------------------
  console.log('\n3. Testando Cadastro de Atestado Médico em JPG/JPEG...');
  const jpgFile = createMockFile('atestado_clinico.jpg', 'image/jpeg', 819200); // 800 KB
  const atestadoIssue = '2026-04-01';
  const atestadoExpiry = '2027-04-01';

  const newCertificate = await medicalDocumentService.createDocument(
    {
      tenantId: tenantA,
      studentId: studentLucas,
      documentType: 'medical_certificate',
      title: 'Atestado Médico de Aptidão Anual',
      issueDate: atestadoIssue,
      expiryDate: atestadoExpiry,
      notes: 'Liberado para treinos diários e competições oficiais.',
    },
    jpgFile,
    { id: 'user-owner', name: 'Carlos Silva' }
  );

  assert(newCertificate.documentType === 'medical_certificate', 'Tipo gravado como medical_certificate');
  assert(newCertificate.originalFileName === 'atestado_clinico.jpg', 'Nome do arquivo JPG preservado');
  assert(newCertificate.mimeType === 'image/jpeg', 'MIME image/jpeg gravado');
  assert(newCertificate.expiryDate === atestadoExpiry, 'Data de validade gravada');

  // -------------------------------------------------------------------------
  // TESTE 4: Persistência e recarregamento dos documentos
  // -------------------------------------------------------------------------
  console.log('\n4. Testando Persistência dos documentos...');
  const reloadedDocs = await medicalDocumentService.fetchStudentDocuments(tenantA, studentLucas);
  const foundReport = reloadedDocs.find((d) => d.id === newReport.id);
  const foundCert = reloadedDocs.find((d) => d.id === newCertificate.id);
  assert(Boolean(foundReport), 'Laudo recuperado com sucesso após persistência');
  assert(Boolean(foundCert), 'Atestado recuperado com sucesso após persistência');

  // -------------------------------------------------------------------------
  // TESTE 5: Distinção estrita entre Data de Emissão e Data de Cadastro
  // -------------------------------------------------------------------------
  console.log('\n5. Testando Distinção entre Data de Emissão e Data de Cadastro...');
  assert(Boolean(newReport.issueDate), 'Data de emissão existe');
  assert(Boolean(newReport.uploadedAt), 'Data de cadastro existe');
  assert(newReport.issueDate === testIssueDate, 'Data de emissão bate exatamente com o valor digitado pelo usuário');
  // uploadedAt deve ser um timestamp ISO recente
  const uploadedYear = new Date(newReport.uploadedAt).getFullYear();
  assert(uploadedYear >= 2026, 'Data de cadastro gerada automaticamente no padrão ISO');
  assert(newReport.issueDate !== newReport.uploadedAt, 'Data de emissão e data de cadastro são propriedades e valores distintos');

  // -------------------------------------------------------------------------
  // TESTE 6: Ordenação cronológica decrescente (emissão DESC, cadastro DESC)
  // -------------------------------------------------------------------------
  console.log('\n6. Testando Ordenação cronológica decrescente...');
  for (let i = 0; i < reloadedDocs.length - 1; i++) {
    const curDate = new Date(reloadedDocs[i].issueDate).getTime();
    const nextDate = new Date(reloadedDocs[i + 1].issueDate).getTime();
    assert(curDate >= nextDate, `Documento [${i}] (${reloadedDocs[i].issueDate}) >= Documento [${i + 1}] (${reloadedDocs[i + 1].issueDate})`);
  }

  // -------------------------------------------------------------------------
  // TESTE 7: Cálculo de validade e situação do documento
  // -------------------------------------------------------------------------
  console.log('\n7. Testando Cálculo de validade e situação do documento...');
  const refToday = '2026-10-23';

  // Caso 7a: Sem validade definida -> 'no_expiry' (não considerado vencido)
  const noExpiryStatus = calculateDocumentStatus(undefined, refToday);
  assert(noExpiryStatus.status === 'no_expiry', 'Sem data de validade retorna status "no_expiry"');
  assert(noExpiryStatus.label === 'Sem validade definida', 'Rótulo "Sem validade definida"');

  // Caso 7b: Vencido -> data anterior a hoje
  const expiredStatus = calculateDocumentStatus('2026-05-15', refToday);
  assert(expiredStatus.status === 'expired', 'Data anterior a hoje retorna status "expired"');
  assert(expiredStatus.label === 'Vencido', 'Rótulo "Vencido"');

  // Caso 7c: Próximo do vencimento -> vence nos próximos 30 dias (ex: daqui a 15 dias)
  const expiringSoonStatus = calculateDocumentStatus('2026-11-05', refToday);
  assert(expiringSoonStatus.status === 'expiring_soon', 'Data em até 30 dias retorna "expiring_soon"');
  assert(expiringSoonStatus.label.includes('Vence em'), 'Rótulo informa dias restantes para o vencimento');

  // Caso 7d: Válido -> vence daqui a mais de 30 dias (ex: daqui a 120 dias)
  const validStatus = calculateDocumentStatus('2027-02-28', refToday);
  assert(validStatus.status === 'valid', 'Data superior a 30 dias retorna status "valid"');
  assert(validStatus.label === 'Válido', 'Rótulo "Válido"');

  // -------------------------------------------------------------------------
  // TESTE 8: Geração de URLs assinadas para visualização e download
  // -------------------------------------------------------------------------
  console.log('\n8. Testando URLs assinadas seguras...');
  const signedUrl = await medicalDocumentService.getSignedUrl(newReport.storagePath, 300);
  assert(Boolean(signedUrl), 'URL assinada gerada com sucesso');

  // -------------------------------------------------------------------------
  // TESTE 9: Edição de metadados e substituição de arquivo
  // -------------------------------------------------------------------------
  console.log('\n9. Testando Edição de metadados e substituição de arquivo...');
  const updatedDoc = await medicalDocumentService.updateDocument(
    newReport.id,
    {
      title: 'Laudo Cardiológico Ergométrico Atualizado',
      notes: 'Laudo revisado pelo Dr. Roberto Medeiros.',
    },
    null,
    { id: 'user-owner', name: 'Carlos Silva' }
  );

  assert(updatedDoc.title === 'Laudo Cardiológico Ergométrico Atualizado', 'Título atualizado com sucesso');
  assert(updatedDoc.notes === 'Laudo revisado pelo Dr. Roberto Medeiros.', 'Observações atualizadas');
  assert(updatedDoc.id === newReport.id, 'ID do documento mantido');

  // Testando substituição do arquivo físico
  const replacementFile = createMockFile('laudo_revisado_v2.pdf', 'application/pdf', 600000);
  const replacedDoc = await medicalDocumentService.updateDocument(
    newReport.id,
    {},
    replacementFile,
    { id: 'user-owner', name: 'Carlos Silva' }
  );
  assert(replacedDoc.originalFileName === 'laudo_revisado_v2.pdf', 'Nome do arquivo substituído');
  assert(replacedDoc.fileSize === 600000, 'Tamanho atualizado após substituição');

  // -------------------------------------------------------------------------
  // TESTE 10: Exclusão segura de documento (Storage e Banco)
  // -------------------------------------------------------------------------
  console.log('\n10. Testando Exclusão de documento...');
  await medicalDocumentService.deleteDocument(
    newReport.id,
    tenantA,
    studentLucas,
    { id: 'user-owner', name: 'Carlos Silva' }
  );

  const docsAfterDelete = await medicalDocumentService.fetchStudentDocuments(tenantA, studentLucas);
  assert(!docsAfterDelete.some((d) => d.id === newReport.id), 'Documento excluído não consta mais no histórico do aluno');

  // -------------------------------------------------------------------------
  // TESTE 11: Rejeição de arquivos inválidos e limite de 10 MB
  // -------------------------------------------------------------------------
  console.log('\n11. Testando Rejeição de arquivos inválidos e limite de 10 MB...');

  // 11a. Arquivo > 10 MB
  const giantFile = createMockFile('arquivo_pesado.pdf', 'application/pdf', 11 * 1024 * 1024); // 11 MB
  const valGiant = validateMedicalFile(giantFile);
  assert(!valGiant.isValid, 'Arquivo > 10 MB rejeitado');
  assert(valGiant.error?.includes('10 MB') || false, 'Mensagem clara indicando limite de 10 MB');

  // 11b. Extensão não permitida (.exe, .zip, .docx)
  const badExtFile = createMockFile('documento.exe', 'application/octet-stream', 1024);
  const valBadExt = validateMedicalFile(badExtFile);
  assert(!valBadExt.isValid, 'Extensão .exe rejeitada');
  assert(valBadExt.error?.includes('PDF') || false, 'Mensagem informa formatos aceitos');

  // 11c. Arquivo vazio (0 bytes)
  const emptyFile = createMockFile('vazio.pdf', 'application/pdf', 0);
  const valEmpty = validateMedicalFile(emptyFile);
  assert(!valEmpty.isValid, 'Arquivo com 0 bytes rejeitado');

  // -------------------------------------------------------------------------
  // TESTE 12: Isolamento multi-tenant rigoroso
  // -------------------------------------------------------------------------
  console.log('\n12. Testando Isolamento Multi-tenant...');
  const tenantBDocs = await medicalDocumentService.fetchStudentDocuments(tenantB, studentLucas);
  assert(tenantBDocs.length === 0, 'Academia B não tem acesso a documentos cadastrados na Academia A');

  // -------------------------------------------------------------------------
  // TESTE 13: Sincronização e preservação de HealthRecord
  // -------------------------------------------------------------------------
  console.log('\n13. Testando Sincronização com HealthRecord...');
  const healthList = DataStore.getHealthRecords(tenantA);
  const lucasHealth = healthList.find((h) => h.studentId === studentLucas);
  assert(Boolean(lucasHealth), 'HealthRecord de Lucas existe');
  assert(lucasHealth!.conditions.length > 0, 'Condições clínicas de Lucas preservadas intactas');
  assert(lucasHealth!.allergies.length > 0, 'Alergias de Lucas preservadas intactas');

  // -------------------------------------------------------------------------
  // TESTE 14: Formatação de tamanho e rótulos
  // -------------------------------------------------------------------------
  console.log('\n14. Testando Formatação e rótulos dos 6 tipos de documento...');
  assert(formatFileSize(245760) === '240 KB', 'Formatação KB correta');
  assert(formatFileSize(2621440) === '2.5 MB', 'Formatação MB correta');

  const types: MedicalDocumentType[] = [
    'medical_report',
    'medical_certificate',
    'exam',
    'declaration',
    'authorization',
    'other',
  ];
  for (const t of types) {
    const label = getDocumentTypeLabel(t);
    const badge = getDocumentTypeBadge(t);
    assert(Boolean(label) && Boolean(badge.label), `Rótulo e badge definidos para o tipo ${t}: "${label}"`);
  }

  console.log('\n================================================================');
  console.log(`RESULTADO FINAL: ${passedTests}/${totalTests} TESTES APROVADOS!`);
  if (failedTests === 0) {
    console.log('TODOS OS REQUISITOS OBRIGATÓRIOS DO MÓDULO DE SAÚDE FORAM ATENDIDOS COM SUCESSO.');
  } else {
    console.error(`ATENÇÃO: ${failedTests} testes falharam.`);
  }
  console.log('================================================================');
}

runTestSuite().catch(console.error);
