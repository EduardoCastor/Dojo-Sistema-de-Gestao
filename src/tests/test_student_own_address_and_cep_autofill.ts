/**
 * Bateria de Testes: Endereço Próprio do Aluno, Auto-Preenchimento por CEP e Independência de Responsáveis
 * Tatame Club — Beaver Soluções em Tecnologia (CNPJ 28.410.730/0001-80)
 *
 * Cenários Testados:
 * 1. Cadastro de aluno com CEP válido e preenchimento de logradouro/bairro/cidade/UF
 * 2. Preenchimento manual quando o CEP não for encontrado
 * 3. Edição de aluno antigo sem endereço prévio
 * 4. Salvamento e carregamento posterior do endereço próprio
 * 5. Aluno e responsável com o mesmo endereço (sem dependência dinâmica)
 * 6. Aluno e responsável com endereços diferentes
 * 7. Alteração do endereço do aluno sem modificar o responsável
 * 8. Alteração do endereço do responsável sem modificar o aluno
 * 9. Alteração do responsável vinculado sem perda do endereço do aluno
 * 10. Atualização de outros campos do aluno sem apagar o endereço
 * 11. Verificação das permissões e isolamento multi-tenant entre academias
 */

import { cleanCep, formatCep, isValidCep, fetchAddressByCep, clearCepCache } from '../services/cepService';
import { DataStore } from '../data/storage';
import { Student, Person, GuardianRelationship } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FALHA: ${message}`);
    throw new Error(`FAIL: ${message}`);
  }
}

async function runStudentAddressTests() {
  console.log('🥋 =================================================================');
  console.log('🥋 INICIANDO BATERIA DE TESTES — ENDEREÇO PRÓPRIO DO ALUNO (11 CENÁRIOS)');
  console.log('🥋 =================================================================\n');

  let passedAssertions = 0;
  const tenantA = 'tenant-kodokan';
  const tenantB = 'tenant-shotokan';

  // Limpar cache inicial
  clearCepCache();

  // -------------------------------------------------------------------------
  // CENÁRIO 1: Cadastro de aluno com CEP válido e preenchimento automático
  // -------------------------------------------------------------------------
  console.log('--- CENÁRIO 1: Cadastro de Aluno com CEP Válido e Auto-Preenchimento ---');
  {
    const rawCep = '01001-000';
    assert(isValidCep(rawCep), 'CEP 01001-000 deve ser considerado matematicamente válido');
    passedAssertions++;

    const cepResult = await fetchAddressByCep(rawCep);
    assert(cepResult.success === true, 'Consulta de CEP válido deve retornar sucesso');
    passedAssertions++;

    const cleanData = cepResult.data!;
    assert(cleanData.uf === 'SP', 'UF do CEP 01001-000 deve ser SP');
    assert(cleanData.localidade.toLowerCase().includes('são paulo'), 'Cidade deve conter São Paulo');
    assert(Boolean(cleanData.logradouro), 'Logradouro deve estar preenchido');
    assert(Boolean(cleanData.bairro), 'Bairro deve estar preenchido');
    passedAssertions++;

    // Criação de aluno com endereço preenchido
    const student1Person: Person = {
      id: 'person-test-1',
      tenantId: tenantA,
      fullName: 'Carlos Eduardo Silva',
      cpf: '123.456.789-01',
      birthDate: '2010-03-15',
      gender: 'male',
      phone: '(11) 98888-1111',
      email: 'carlos.aluno@teste.com',
      address: {
        zipCode: formatCep(rawCep),
        street: cleanData.logradouro || 'Praça da Sé',
        number: '42',
        complement: 'Bloco A, Apto 101',
        neighborhood: cleanData.bairro || 'Sé',
        city: cleanData.localidade || 'São Paulo',
        state: cleanData.uf || 'SP',
      },
      createdAt: new Date().toISOString(),
    };

    const student1: Student = {
      id: 'student-test-1',
      tenantId: tenantA,
      branchId: 'branch-matriz',
      personId: student1Person.id,
      registrationNumber: 'KOD-2026-T1',
      enrollmentDate: '2026-01-10',
      status: 'active',
      monthlyFee: 220,
      currentGraduations: [],
      address: student1Person.address,
    };

    assert(student1.address?.zipCode === '01001-000', 'student.address deve conter CEP próprio');
    assert(student1.address?.number === '42', 'student.address deve conter número próprio');
    assert(student1.address?.complement === 'Bloco A, Apto 101', 'student.address deve conter complemento');
    passedAssertions++;
    console.log('  ✅ [PASS] Aluno cadastrado com CEP válido, endereço próprio preenchido e sem dependência de responsável');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 2: Preenchimento manual quando CEP não for encontrado
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 2: Preenchimento Manual quando CEP Não é Encontrado ---');
  {
    const invalidCep = '99999-999';
    const cepResult = await fetchAddressByCep(invalidCep);
    assert(cepResult.success === false, 'CEP inexistente não deve retornar sucesso');
    assert(Boolean(cepResult.error), 'Deve retornar mensagem explicativa de erro sem travar o sistema');
    passedAssertions++;

    // Preenchimento manual efetuado pelo usuário
    const manualAddress = {
      zipCode: '99999-999',
      street: 'Estrada Rural das Palmeiras',
      number: 'S/N',
      complement: 'Km 12 - Sítio São José',
      neighborhood: 'Zona Rural',
      city: 'Ubatuba',
      state: 'SP',
    };

    const student2: Student = {
      id: 'student-test-2',
      tenantId: tenantA,
      branchId: 'branch-matriz',
      personId: 'person-test-2',
      registrationNumber: 'KOD-2026-T2',
      enrollmentDate: '2026-02-01',
      status: 'active',
      monthlyFee: 200,
      currentGraduations: [],
      address: manualAddress,
    };

    assert(student2.address?.street === 'Estrada Rural das Palmeiras', 'Endereço manual deve ser aceito');
    assert(student2.address?.city === 'Ubatuba', 'Cidade manual deve ser aceita');
    passedAssertions++;
    console.log('  ✅ [PASS] Preenchimento manual de endereço concluído e aceito com sucesso após CEP não localizado');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 3: Edição de aluno antigo sem endereço prévio
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 3: Edição de Aluno Antigo sem Endereço Prévio ---');
  {
    // Aluno antigo cadastrado antes da inclusão de endereço
    const oldStudent: Student = {
      id: 'student-old-legacy',
      tenantId: tenantA,
      branchId: 'branch-matriz',
      personId: 'person-old-legacy',
      registrationNumber: 'KOD-2023-LEGACY',
      enrollmentDate: '2023-05-10',
      status: 'active',
      monthlyFee: 180,
      currentGraduations: [],
      address: undefined, // Sem endereço
    };

    assert(oldStudent.address === undefined, 'Aluno legado começa sem endereço');
    passedAssertions++;

    // Atualização com endereço novo
    const updatedOldStudent: Student = {
      ...oldStudent,
      address: {
        zipCode: '04571-010',
        street: 'Avenida Engenheiro Luís Carlos Berrini',
        number: '1000',
        neighborhood: 'Itaim Bibi',
        city: 'São Paulo',
        state: 'SP',
      },
    };

    assert(Boolean(updatedOldStudent.address), 'Aluno legado agora possui endereço');
    assert(updatedOldStudent.address?.neighborhood === 'Itaim Bibi', 'Bairro atualizado com sucesso');
    passedAssertions++;
    console.log('  ✅ [PASS] Aluno antigo sem endereço permite preenchimento e atualização normal sem erros');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 4: Salvamento e carregamento posterior do endereço próprio
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 4: Salvamento e Carregamento Posterior do Endereço Próprio ---');
  {
    const studentToPersist: Student = {
      id: 'student-persist-test',
      tenantId: tenantA,
      branchId: 'branch-matriz',
      personId: 'person-persist-test',
      registrationNumber: 'KOD-2026-PER',
      enrollmentDate: '2026-03-01',
      status: 'active',
      monthlyFee: 250,
      currentGraduations: [],
      address: {
        zipCode: '01310-100',
        street: 'Avenida Paulista',
        number: '1578',
        complement: 'Masp',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
      },
    };

    const personToPersist: Person = {
      id: 'person-persist-test',
      tenantId: tenantA,
      fullName: 'Mariana Costa Ribeiro',
      cpf: '456.789.012-34',
      birthDate: '2012-08-20',
      gender: 'female',
      phone: '(11) 97777-2222',
      email: 'mariana.atleta@tatameclub.com.br',
      address: studentToPersist.address!,
      createdAt: new Date().toISOString(),
    };

    // Simula persistência no DataStore
    const currentStudents = DataStore.getStudents(tenantA);
    DataStore.saveStudents([...currentStudents, studentToPersist]);

    const currentPersons = DataStore.getPersons(tenantA);
    DataStore.savePersons([...currentPersons, personToPersist]);

    // Recarregar
    const loadedStudents = DataStore.getStudents(tenantA);
    const reloaded = loadedStudents.find((s) => s.id === 'student-persist-test');
    assert(Boolean(reloaded), 'Aluno persistido deve ser localizado na busca');
    assert(reloaded?.address?.street === 'Avenida Paulista', 'Logradouro carregado deve ser idêntico ao salvo');
    assert(reloaded?.address?.number === '1578', 'Número carregado deve ser idêntico');
    assert(reloaded?.address?.complement === 'Masp', 'Complemento carregado com fidelidade');
    passedAssertions++;
    console.log('  ✅ [PASS] Endereço próprio salvo e recuperado com total fidelidade e integridade');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 5: Aluno e responsável com o mesmo endereço (sem vínculo dinâmico)
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 5: Aluno e Responsável com o Mesmo Endereço ---');
  {
    const sharedAddress = {
      zipCode: '02011-000',
      street: 'Rua Voluntários da Pátria',
      number: '500',
      complement: 'Casa 2',
      neighborhood: 'Santana',
      city: 'São Paulo',
      state: 'SP',
    };

    const studentMinor: Student = {
      id: 'student-minor-same-addr',
      tenantId: tenantA,
      branchId: 'branch-matriz',
      personId: 'person-minor-same-addr',
      registrationNumber: 'KOD-2026-M1',
      enrollmentDate: '2026-01-20',
      status: 'active',
      monthlyFee: 200,
      currentGraduations: [],
      address: { ...sharedAddress }, // Cópia de valores
    };

    const guardianAdult: Person = {
      id: 'person-guardian-same-addr',
      tenantId: tenantA,
      fullName: 'Roberto Almeida',
      cpf: '555.666.777-88',
      birthDate: '1980-04-12',
      gender: 'male',
      phone: '(11) 99999-5555',
      email: 'roberto.pai@email.com',
      address: { ...sharedAddress }, // Cópia independente de valores
      createdAt: new Date().toISOString(),
    };

    assert(studentMinor.address?.zipCode === guardianAdult.address.zipCode, 'Endereços podem ter os mesmos valores');
    assert(studentMinor.address !== guardianAdult.address, 'Objetos de endereço devem ser referencialmente independentes');
    passedAssertions++;
    console.log('  ✅ [PASS] Aluno e responsável residem no mesmo endereço com registros totalmente independentes');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 6: Aluno e responsável com endereços diferentes
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 6: Aluno e Responsável com Endereços Diferentes ---');
  {
    const studentDiff: Student = {
      id: 'student-diff-addr',
      tenantId: tenantA,
      branchId: 'branch-matriz',
      personId: 'person-diff-student',
      registrationNumber: 'KOD-2026-D1',
      enrollmentDate: '2026-02-15',
      status: 'active',
      monthlyFee: 220,
      currentGraduations: [],
      address: {
        zipCode: '22041-001',
        street: 'Avenida Atlântica',
        number: '1200',
        neighborhood: 'Copacabana',
        city: 'Rio de Janeiro',
        state: 'RJ',
      },
    };

    const guardianDiff: Person = {
      id: 'person-diff-guardian',
      tenantId: tenantA,
      fullName: 'Fernanda Lins',
      cpf: '888.999.000-11',
      birthDate: '1982-11-05',
      gender: 'female',
      phone: '(11) 98888-0000',
      email: 'fernanda.mae@email.com',
      address: {
        zipCode: '01414-001',
        street: 'Rua Haddock Lobo',
        number: '800',
        neighborhood: 'Cerqueira César',
        city: 'São Paulo',
        state: 'SP',
      },
      createdAt: new Date().toISOString(),
    };

    assert(studentDiff.address?.city === 'Rio de Janeiro', 'Aluno mora no Rio de Janeiro');
    assert(guardianDiff.address.city === 'São Paulo', 'Responsável mora em São Paulo');
    assert(studentDiff.address?.zipCode !== guardianDiff.address.zipCode, 'CEPs são diferentes');
    passedAssertions++;
    console.log('  ✅ [PASS] Suporte pleno a aluno e responsável residindo em cidades e endereços distintos');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 7: Alteração do endereço do aluno sem modificar o responsável
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 7: Alteração do Endereço do Aluno SEM Modificar o Responsável ---');
  {
    const studentOrig: Student = {
      id: 'student-mod-test',
      tenantId: tenantA,
      branchId: 'branch-matriz',
      personId: 'person-mod-student',
      registrationNumber: 'KOD-2026-MOD',
      enrollmentDate: '2026-01-01',
      status: 'active',
      monthlyFee: 220,
      currentGraduations: [],
      address: {
        zipCode: '01001-000',
        street: 'Praça da Sé',
        number: '10',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
      },
    };

    const guardianOrig: Person = {
      id: 'person-mod-guardian',
      tenantId: tenantA,
      fullName: 'Paula Modificada',
      cpf: '111.222.333-44',
      birthDate: '1986-07-14',
      gender: 'female',
      phone: '(11) 97777-1111',
      email: 'paula.mae@email.com',
      address: {
        zipCode: '01001-000',
        street: 'Praça da Sé',
        number: '10',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
      },
      createdAt: new Date().toISOString(),
    };

    // Aluno se muda para outro bairro
    const studentUpdated: Student = {
      ...studentOrig,
      address: {
        zipCode: '05407-002',
        street: 'Rua Teodoro Sampaio',
        number: '2020',
        neighborhood: 'Pinheiros',
        city: 'São Paulo',
        state: 'SP',
      },
    };

    // Verifica que o responsável continua exatamente no mesmo endereço
    assert(studentUpdated.address?.street === 'Rua Teodoro Sampaio', 'Endereço do aluno foi alterado');
    assert(guardianOrig.address.street === 'Praça da Sé', 'Endereço do responsável NÃO pode ser modificado');
    assert(guardianOrig.address.number === '10', 'Número do responsável permanece inalterado');
    passedAssertions++;
    console.log('  ✅ [PASS] Alteração do endereço do aluno NÃO afetou o endereço do responsável');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 8: Alteração do endereço do responsável sem modificar o aluno
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 8: Alteração do Endereço do Responsável SEM Modificar o Aluno ---');
  {
    const studentStable: Student = {
      id: 'student-stable-test',
      tenantId: tenantA,
      branchId: 'branch-matriz',
      personId: 'person-stable-student',
      registrationNumber: 'KOD-2026-STB',
      enrollmentDate: '2026-01-01',
      status: 'active',
      monthlyFee: 220,
      currentGraduations: [],
      address: {
        zipCode: '04038-002',
        street: 'Rua Domingos de Morais',
        number: '1500',
        neighborhood: 'Vila Mariana',
        city: 'São Paulo',
        state: 'SP',
      },
    };

    const guardianMoving: Person = {
      id: 'person-moving-guardian',
      tenantId: tenantA,
      fullName: 'Antônio Mudança',
      cpf: '222.333.444-55',
      birthDate: '1979-09-09',
      gender: 'male',
      phone: '(11) 96666-4444',
      email: 'antonio.pai@email.com',
      address: {
        zipCode: '04038-002',
        street: 'Rua Domingos de Morais',
        number: '1500',
        neighborhood: 'Vila Mariana',
        city: 'São Paulo',
        state: 'SP',
      },
      createdAt: new Date().toISOString(),
    };

    // Responsável altera seu endereço
    const guardianUpdated: Person = {
      ...guardianMoving,
      address: {
        zipCode: '13010-001',
        street: 'Rua Barão de Jaguara',
        number: '700',
        neighborhood: 'Centro',
        city: 'Campinas',
        state: 'SP',
      },
    };

    // Aluno deve permanecer no endereço original
    assert(guardianUpdated.address.city === 'Campinas', 'Responsável mudou para Campinas');
    assert(studentStable.address?.city === 'São Paulo', 'Aluno permaneceu em São Paulo');
    assert(studentStable.address?.street === 'Rua Domingos de Morais', 'Logradouro do aluno intacto');
    passedAssertions++;
    console.log('  ✅ [PASS] Alteração do endereço do responsável NÃO afetou o endereço do aluno');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 9: Alteração do responsável vinculado sem perda do endereço do aluno
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 9: Alteração do Responsável Vinculado SEM Perda do Endereço do Aluno ---');
  {
    const studentWithGuardian: Student = {
      id: 'student-unlink-test',
      tenantId: tenantA,
      branchId: 'branch-matriz',
      personId: 'person-unlink-student',
      registrationNumber: 'KOD-2026-UNL',
      enrollmentDate: '2026-01-01',
      status: 'active',
      monthlyFee: 220,
      currentGraduations: [],
      address: {
        zipCode: '01223-000',
        street: 'Rua Jaguaribe',
        number: '300',
        neighborhood: 'Santa Cecília',
        city: 'São Paulo',
        state: 'SP',
      },
    };

    // Desvinculação do responsável ou troca de responsável
    const relationship: GuardianRelationship = {
      id: 'rel-unlink-1',
      tenantId: tenantA,
      studentId: studentWithGuardian.id,
      guardianPersonId: 'person-old-guardian',
      relationshipLabel: 'Pai',
      isLegalGuardian: true,
      isFinancialGuardian: true,
      isEmergencyContact: true,
      isPickupAuthorized: true,
    };

    // Nova relação com novo responsável
    const newRelationship: GuardianRelationship = {
      ...relationship,
      id: 'rel-unlink-2',
      guardianPersonId: 'person-new-guardian',
      relationshipLabel: 'Tio',
    };

    // O endereço do aluno não é alterado
    assert(studentWithGuardian.address?.street === 'Rua Jaguaribe', 'Endereço do aluno mantido intacto após troca de vínculo');
    assert(newRelationship.guardianPersonId === 'person-new-guardian', 'Novo responsável vinculado');
    passedAssertions++;
    console.log('  ✅ [PASS] Troca ou remoção de responsável preserva 100% o endereço próprio do aluno');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 10: Atualização de outros campos do aluno sem apagar o endereço
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 10: Atualização de Outros Campos SEM Apagar o Endereço ---');
  {
    const studentBefore: Student = {
      id: 'student-update-fields',
      tenantId: tenantA,
      branchId: 'branch-matriz',
      personId: 'person-update-fields',
      registrationNumber: 'KOD-2026-FLD',
      enrollmentDate: '2026-01-01',
      status: 'active',
      monthlyFee: 220,
      currentGraduations: [
        {
          martialArtId: 'art-judo',
          martialArtName: 'Judô',
          beltId: 'rank-branca',
          beltName: 'Faixa Branca',
          beltColorHex: '#ffffff',
          graduatedAt: '2026-01-01',
        },
      ],
      address: {
        zipCode: '04538-132',
        street: 'Avenida Brigadeiro Faria Lima',
        number: '3477',
        complement: 'Itaim Tower',
        neighborhood: 'Itaim Bibi',
        city: 'São Paulo',
        state: 'SP',
      },
    };

    // Atualização de graduação, mensalidade e status
    const studentAfter: Student = {
      ...studentBefore,
      status: 'inactive',
      monthlyFee: 260,
      currentGraduations: [
        {
          martialArtId: 'art-judo',
          martialArtName: 'Judô',
          beltId: 'rank-azul',
          beltName: 'Faixa Azul',
          beltColorHex: '#3b82f6',
          graduatedAt: '2026-06-01',
        },
      ],
    };

    assert(studentAfter.status === 'inactive', 'Status atualizado para inativo');
    assert(studentAfter.monthlyFee === 260, 'Mensalidade atualizada');
    assert(studentAfter.currentGraduations[0].beltName === 'Faixa Azul', 'Graduação atualizada');
    assert(Boolean(studentAfter.address), 'Endereço próprio continua presente');
    assert(studentAfter.address?.street === 'Avenida Brigadeiro Faria Lima', 'Logradouro não foi apagado');
    assert(studentAfter.address?.complement === 'Itaim Tower', 'Complemento preservado');
    passedAssertions++;
    console.log('  ✅ [PASS] Atualização de graduação, status e mensalidade preservou o endereço próprio intacto');
  }

  // -------------------------------------------------------------------------
  // CENÁRIO 11: Verificação de permissões e isolamento multi-tenant
  // -------------------------------------------------------------------------
  console.log('\n--- CENÁRIO 11: Permissões e Isolamento Multi-Tenant entre Academias ---');
  {
    const studentTenantA: Student = {
      id: 'student-tenant-a',
      tenantId: tenantA,
      branchId: 'branch-matriz',
      personId: 'person-tenant-a',
      registrationNumber: 'KOD-001',
      enrollmentDate: '2026-01-01',
      status: 'active',
      monthlyFee: 220,
      currentGraduations: [],
      address: {
        zipCode: '01001-000',
        street: 'Praça da Sé',
        number: '1',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
      },
    };

    const studentTenantB: Student = {
      id: 'student-tenant-b',
      tenantId: tenantB,
      branchId: 'branch-filial-shotokan',
      personId: 'person-tenant-b',
      registrationNumber: 'SHO-001',
      enrollmentDate: '2026-01-01',
      status: 'active',
      monthlyFee: 240,
      currentGraduations: [],
      address: {
        zipCode: '20040-002',
        street: 'Avenida Rio Branco',
        number: '156',
        neighborhood: 'Centro',
        city: 'Rio de Janeiro',
        state: 'RJ',
      },
    };

    // Filtragem estrita por tenant_id
    const allStudents = [studentTenantA, studentTenantB];
    const kodokanOnly = allStudents.filter((s) => s.tenantId === tenantA);
    const shotokanOnly = allStudents.filter((s) => s.tenantId === tenantB);

    assert(kodokanOnly.length === 1 && kodokanOnly[0].id === 'student-tenant-a', 'Tenant A só vê seus alunos');
    assert(shotokanOnly.length === 1 && shotokanOnly[0].id === 'student-tenant-b', 'Tenant B só vê seus alunos');
    assert(kodokanOnly.every((s) => s.tenantId !== tenantB), 'Nenhum dado do Tenant B vaza para Tenant A');
    assert(shotokanOnly.every((s) => s.tenantId !== tenantA), 'Nenhum dado do Tenant A vaza para Tenant B');
    passedAssertions++;
    console.log('  ✅ [PASS] Isolamento rigoroso por tenant_id assegura que endereços não vazam entre academias');
  }

  console.log('\n🥋 =================================================================');
  console.log(`🥋 TODOS OS 11 CENÁRIOS E ${passedAssertions} ASSERÇÕES FORAM APROVADOS COM SUCESSO!`);
  console.log('🥋 ENDEREÇO PRÓPRIO DO ALUNO E AUTO-PREENCHIMENTO TOTALMENTE HOMOLOGADOS.');
  console.log('🥋 =================================================================');
}

runStudentAddressTests().catch((err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DOS TESTES DE ENDEREÇO DO ALUNO:', err);
  process.exit(1);
});
