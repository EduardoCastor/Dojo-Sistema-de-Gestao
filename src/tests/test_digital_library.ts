import { validateAndParseYouTubeUrl } from '../utils/youtubeValidator';
import { digitalLibraryService } from '../services/digitalLibraryService';
import { DataStore } from '../data/storage';
import { DigitalLibraryItem, SaveVideoPayload } from '../types';

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

async function runAllTests() {
  console.log('🥋 ========================================================');
  console.log('🥋 INICIANDO BATERIA DE TESTES — BIBLIOTECA DIGITAL YOUTUBE');
  console.log('🥋 ========================================================\n');

  // ---------------------------------------------------------------------------
  // CENÁRIO A: Validação e normalização de URLs do YouTube
  // ---------------------------------------------------------------------------
  console.log('--- CENÁRIO A: Validação e Normalização de URLs do YouTube ---');
  
  // A1: Formato padrão watch?v=
  const res1 = validateAndParseYouTubeUrl('https://www.youtube.com/watch?v=0b5_qL2x328');
  assert(res1.isValid === true, 'URL padrão youtube.com/watch?v= deve ser válida');
  assert(res1.videoId === '0b5_qL2x328', 'ID do vídeo extraído corretamente (0b5_qL2x328)');
  assert(
    res1.thumbnailUrl === 'https://img.youtube.com/vi/0b5_qL2x328/hqdefault.jpg',
    'Miniatura hqdefault construída com precisão'
  );
  assert(
    res1.embedUrl === 'https://www.youtube-nocookie.com/embed/0b5_qL2x328',
    'Embed seguro construído com youtube-nocookie.com'
  );

  // A2: Formato encurtado youtu.be
  const res2 = validateAndParseYouTubeUrl('https://youtu.be/x8K7J2Gq-M8');
  assert(res2.isValid === true, 'URL encurtada youtu.be deve ser válida');
  assert(res2.videoId === 'x8K7J2Gq-M8', 'ID do vídeo extraído corretamente (x8K7J2Gq-M8)');

  // A3: Formato YouTube Shorts
  const res3 = validateAndParseYouTubeUrl('https://www.youtube.com/shorts/9bZkp7q19f0');
  assert(res3.isValid === true, 'URL do YouTube Shorts deve ser válida');
  assert(res3.videoId === '9bZkp7q19f0', 'ID do Shorts extraído corretamente (9bZkp7q19f0)');

  // A4: Formato Embed
  const res4 = validateAndParseYouTubeUrl('https://www.youtube.com/embed/kxyfO00j-vI');
  assert(res4.isValid === true, 'URL do YouTube Embed deve ser válida');
  assert(res4.videoId === 'kxyfO00j-vI', 'ID do Embed extraído corretamente (kxyfO00j-vI)');

  // A5: Rejeição de URLs inválidas e de outras plataformas
  const resVimeo = validateAndParseYouTubeUrl('https://vimeo.com/123456789');
  assert(resVimeo.isValid === false, 'URLs do Vimeo devem ser rejeitadas');
  assert(
    Boolean(resVimeo.errorMessage && resVimeo.errorMessage.includes('Apenas URLs oficiais do YouTube')),
    'Mensagem pedagógica clara em PT-BR para URLs não suportadas'
  );

  const resInvalid = validateAndParseYouTubeUrl('texto-qualquer-nao-url');
  assert(resInvalid.isValid === false, 'Strings não-URL devem ser rejeitadas');

  // ---------------------------------------------------------------------------
  // CENÁRIO B: Operações CRUD de Administração de Vídeos
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO B: Operações Administrativas CRUD ---');
  const tenantTest = 'tenant-test-library';

  // Inicializar tenant limpo
  DataStore.saveLibraryItems([]);

  // B1: Cadastrar vídeo liberado para todas as faixas
  const payload1: SaveVideoPayload = {
    tenantId: tenantTest,
    martialArtId: 'art-judo',
    title: 'Kumi-Kata Básico: Pegadas Fundamentais de Gola e Manga',
    description: 'Postura das mãos para controlar a distância e desequilibrar o oponente.',
    youtubeUrl: 'https://www.youtube.com/watch?v=0b5_qL2x328',
    youtubeVideoId: '0b5_qL2x328',
    thumbnailUrl: 'https://img.youtube.com/vi/0b5_qL2x328/hqdefault.jpg',
    category: 'waza_techniques',
    authorInstructor: 'Sensei Yamamoto',
    displayOrder: 1,
    status: 'published',
    allBelts: true,
    targetBeltIds: [],
  };

  const createRes1 = await digitalLibraryService.saveVideo(payload1);
  assert(createRes1.success === true, 'Vídeo cadastrado com sucesso');
  assert(Boolean(createRes1.videoId), 'ID do vídeo gerado');

  // B2: Cadastrar vídeo com faixas específicas
  const payload2: SaveVideoPayload = {
    tenantId: tenantTest,
    martialArtId: 'art-judo',
    title: 'Seoi-Nage Avançado para Faixas Intermediárias',
    description: 'Transição rápida de ataque com pegada cruzada.',
    youtubeUrl: 'https://youtu.be/x8K7J2Gq-M8',
    youtubeVideoId: 'x8K7J2Gq-M8',
    thumbnailUrl: 'https://img.youtube.com/vi/x8K7J2Gq-M8/hqdefault.jpg',
    category: 'waza_techniques',
    authorInstructor: 'Sensei Sato',
    displayOrder: 2,
    status: 'published',
    allBelts: false,
    targetBeltIds: ['rank-judo-amarela', 'rank-judo-laranja'],
  };

  const createRes2 = await digitalLibraryService.saveVideo(payload2);
  assert(createRes2.success === true, 'Vídeo com faixas específicas cadastrado com sucesso');

  // B3: Listar vídeos do tenant
  const listAdmin = await digitalLibraryService.fetchVideos(tenantTest);
  assert(listAdmin.length === 2, 'Admin recupera os 2 vídeos cadastrados no tenant');

  // B4: Atualizar vídeo 1 (edição)
  const videoToEdit = listAdmin.find((v) => v.id === createRes1.videoId)!;
  const updatePayload: SaveVideoPayload = {
    id: videoToEdit.id,
    tenantId: tenantTest,
    martialArtId: 'art-judo',
    title: 'Kumi-Kata Básico (Atualizado 2026)',
    description: 'Instrução aprofundada de pegada.',
    youtubeUrl: 'https://www.youtube.com/watch?v=0b5_qL2x328',
    youtubeVideoId: '0b5_qL2x328',
    thumbnailUrl: 'https://img.youtube.com/vi/0b5_qL2x328/hqdefault.jpg',
    category: 'waza_techniques',
    authorInstructor: 'Sensei Yamamoto',
    displayOrder: 1,
    status: 'published',
    allBelts: true,
    targetBeltIds: [],
  };

  const updateRes = await digitalLibraryService.saveVideo(updatePayload);
  assert(updateRes.success === true, 'Vídeo editado com sucesso');
  const listAfterEdit = await digitalLibraryService.fetchVideos(tenantTest);
  const editedItem = listAfterEdit.find((v) => v.id === videoToEdit.id);
  assert(
    editedItem?.title === 'Kumi-Kata Básico (Atualizado 2026)',
    'Título atualizado refletido na listagem'
  );

  // B5: Alterar situação para rascunho
  await digitalLibraryService.updateVideoStatus(tenantTest, videoToEdit.id, 'draft');
  const listAfterDraft = await digitalLibraryService.fetchVideos(tenantTest);
  const draftItem = listAfterDraft.find((v) => v.id === videoToEdit.id);
  assert(draftItem?.status === 'draft', 'Status alterado com sucesso para draft');

  // ---------------------------------------------------------------------------
  // CENÁRIO C & D: Acesso e Filtragem Estrita do Aluno por Arte Marcial e Faixa
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO C & D: Regras de Acesso e Filtragem do Aluno ---');

  // Cadastrar vídeo de Jiu-Jitsu no mesmo tenant
  const payloadBjj: SaveVideoPayload = {
    tenantId: tenantTest,
    martialArtId: 'art-bjj',
    title: 'Passagem de Guarda BJJ',
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    youtubeVideoId: 'dQw4w9WgXcQ',
    thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    category: 'waza_techniques',
    status: 'published',
    allBelts: true,
    targetBeltIds: [],
  };
  await digitalLibraryService.saveVideo(payloadBjj);

  // Re-publicar vídeo 1 do Judô
  await digitalLibraryService.updateVideoStatus(tenantTest, videoToEdit.id, 'published');

  // Aluno 1: Matriculado em Judô, Faixa Branca
  const studentJudoWhite = {
    id: 'student-judo-white',
    tenantId: tenantTest,
    graduations: [
      { martialArtId: 'art-judo', beltId: 'rank-judo-branca', beltName: 'Faixa Branca (Mukyu)' },
    ],
    enrollments: [{ martialArtId: 'art-judo', status: 'active' }],
  };

  const accessibleStudent1 = await digitalLibraryService.fetchStudentAccessibleVideos(
    tenantTest,
    studentJudoWhite.id,
    {
      studentGraduations: studentJudoWhite.graduations,
      studentEnrollments: studentJudoWhite.enrollments,
    }
  );

  // Deve ver o vídeo de Judô liberado para todas as faixas (Kumi-Kata)
  assert(
    accessibleStudent1.some((v) => v.title.includes('Kumi-Kata')),
    'Aluno de Judô tem acesso ao vídeo de Judô geral (todas as faixas)'
  );

  // NÃO deve ver o vídeo de Jiu-Jitsu (não matriculado em BJJ)
  assert(
    !accessibleStudent1.some((v) => v.martialArtId === 'art-bjj'),
    'Aluno de Judô NÃO tem acesso a vídeos de Jiu-Jitsu'
  );

  // NÃO deve ver o vídeo específico de Faixa Amarela/Laranja
  assert(
    !accessibleStudent1.some((v) => v.title.includes('Seoi-Nage Avançado')),
    'Aluno Faixa Branca NÃO acessa vídeo restrito a Faixas Amarela/Laranja'
  );

  // Aluno 2: Matriculado em Judô, Faixa Amarela
  const studentJudoYellow = {
    id: 'student-judo-yellow',
    tenantId: tenantTest,
    graduations: [
      { martialArtId: 'art-judo', beltId: 'rank-judo-amarela', beltName: 'Faixa Amarela (5º Kyu)' },
    ],
    enrollments: [{ martialArtId: 'art-judo', status: 'active' }],
  };

  const accessibleStudent2 = await digitalLibraryService.fetchStudentAccessibleVideos(
    tenantTest,
    studentJudoYellow.id,
    {
      studentGraduations: studentJudoYellow.graduations,
      studentEnrollments: studentJudoYellow.enrollments,
    }
  );

  // Deve ver AMBOS os vídeos de Judô (Geral + Faixa Amarela)
  assert(
    accessibleStudent2.some((v) => v.title.includes('Kumi-Kata')),
    'Aluno Faixa Amarela acessa vídeo liberado para todas as faixas'
  );
  assert(
    accessibleStudent2.some((v) => v.title.includes('Seoi-Nage Avançado')),
    'Aluno Faixa Amarela acessa vídeo específico de Faixa Amarela'
  );

  // ---------------------------------------------------------------------------
  // CENÁRIO E: Vídeos em Rascunho ou Arquivados NUNCA aparecem para Alunos
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO E: Ocultação de Rascunhos e Arquivados ---');

  // Colocar o vídeo de Faixa Amarela em rascunho
  await digitalLibraryService.updateVideoStatus(tenantTest, createRes2.videoId!, 'draft');

  const accessibleAfterDraft = await digitalLibraryService.fetchStudentAccessibleVideos(
    tenantTest,
    studentJudoYellow.id,
    {
      studentGraduations: studentJudoYellow.graduations,
      studentEnrollments: studentJudoYellow.enrollments,
    }
  );

  assert(
    !accessibleAfterDraft.some((v) => v.id === createRes2.videoId),
    'Vídeo em rascunho (draft) foi omitido do acervo do aluno'
  );

  // Colocar em arquivado
  await digitalLibraryService.updateVideoStatus(tenantTest, createRes2.videoId!, 'archived');
  const accessibleAfterArchived = await digitalLibraryService.fetchStudentAccessibleVideos(
    tenantTest,
    studentJudoYellow.id,
    {
      studentGraduations: studentJudoYellow.graduations,
      studentEnrollments: studentJudoYellow.enrollments,
    }
  );

  assert(
    !accessibleAfterArchived.some((v) => v.id === createRes2.videoId),
    'Vídeo arquivado (archived) foi omitido do acervo do aluno'
  );

  // ---------------------------------------------------------------------------
  // CENÁRIO F: Isolamento Multi-Tenant
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO F: Isolamento Multi-Tenant ---');
  const tenantOther = 'tenant-other-academy';

  const accessibleOtherTenant = await digitalLibraryService.fetchStudentAccessibleVideos(
    tenantOther,
    'student-other',
    {
      studentGraduations: [{ martialArtId: 'art-judo', beltId: 'rank-judo-branca' }],
      studentEnrollments: [{ martialArtId: 'art-judo', status: 'active' }],
    }
  );

  assert(
    accessibleOtherTenant.length === 0,
    'Tenant diferente não possui acesso aos vídeos do tenant de testes'
  );

  // ---------------------------------------------------------------------------
  // CENÁRIO G: Exclusão de Vídeos
  // ---------------------------------------------------------------------------
  console.log('\n--- CENÁRIO G: Exclusão de Vídeos da Biblioteca ---');

  const deleteRes = await digitalLibraryService.deleteVideo(tenantTest, createRes2.videoId!);
  assert(deleteRes.success === true, 'Vídeo excluído com sucesso');

  const listAfterDelete = await digitalLibraryService.fetchVideos(tenantTest);
  assert(
    !listAfterDelete.some((v) => v.id === createRes2.videoId),
    'Vídeo excluído não consta mais na listagem'
  );

  console.log('\n🥋 ========================================================');
  console.log(`🥋 TODOS OS ${passedTests}/${totalTests} TESTES FORAM APROVADOS COM SUCESSO!`);
  console.log('🥋 ========================================================\n');
}

runAllTests().catch((err) => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
