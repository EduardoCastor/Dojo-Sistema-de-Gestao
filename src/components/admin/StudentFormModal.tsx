import React, { useState, useEffect } from 'react';
import {
  X,
  UserPlus,
  Check,
  AlertCircle,
  Loader2,
  Edit,
  Award,
  Users,
  Search,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  ShieldCheck,
  Link,
  Sparkles,
  Trash2,
  Plus,
} from 'lucide-react';
import {
  Student,
  Person,
  GuardianRelationship,
  BeltRank,
  MartialArt,
} from '../../types';
import { calculateAge } from '../../utils/formatters';
import {
  cleanCPF,
  validateCPF,
  formatCPF,
  formatPhoneBR,
} from '../../utils/cpfValidator';
import {
  studentService,
  isValidUUID,
  CreateStudentPayload,
  UpdateStudentPayload,
  GuardianSummaryItem,
} from '../../services/studentService';
import { supabase, isSupabaseConfigured } from '../../services/supabase';

interface StudentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  branchId: string;
  belts?: BeltRank[];
  martialArts?: MartialArt[];
  studentToEdit?: Student | null;
  personToEdit?: Person | null;
  guardianRelToEdit?: GuardianRelationship | null;
  guardianPersonToEdit?: Person | null;
  allGuardians?: GuardianRelationship[];
  allPersons?: Person[];
  onSave: (
    newStudent: Student,
    newPerson: Person,
    guardianPerson?: Person,
    relationship?: GuardianRelationship,
    payloadDetails?: CreateStudentPayload
  ) => Promise<void> | void;
  onUpdate?: (
    updatedStudent: Student,
    updatedPerson: Person,
    guardianPerson?: Person,
    relationship?: GuardianRelationship,
    payloadDetails?: UpdateStudentPayload
  ) => Promise<void> | void;
}

export const StudentFormModal: React.FC<StudentFormModalProps> = ({
  isOpen,
  onClose,
  tenantId,
  branchId,
  belts = [],
  martialArts = [],
  studentToEdit,
  personToEdit,
  guardianRelToEdit,
  guardianPersonToEdit,
  allGuardians = [],
  allPersons = [],
  onSave,
  onUpdate,
}) => {
  const isEditing = Boolean(studentToEdit);

  // Modalidades e Graduações carregadas exclusivamente do Supabase
  const [loadedArts, setLoadedArts] = useState<MartialArt[]>([]);
  const [loadedBelts, setLoadedBelts] = useState<BeltRank[]>([]);
  const [isLoadingArts, setIsLoadingArts] = useState(false);
  const [isLoadingBelts, setIsLoadingBelts] = useState(false);
  const [artsError, setArtsError] = useState<string | null>(null);
  const [beltsError, setBeltsError] = useState<string | null>(null);
  const [graduationNotice, setGraduationNotice] = useState<string | null>(null);

  // Seleções do formulário (utilizam UUID real do Supabase)
  const [selectedArtId, setSelectedArtId] = useState<string>('');
  const [selectedBeltId, setSelectedBeltId] = useState<string>('');

  const activePersonToEdit: Person = personToEdit || {
    id: studentToEdit?.personId || `person-${studentToEdit?.id || Date.now()}`,
    tenantId: studentToEdit?.tenantId || tenantId,
    fullName: '',
    socialName: undefined,
    cpf: '',
    birthDate: '2014-05-10',
    gender: 'male',
    phone: '',
    email: '',
    address: {
      street: '',
      number: '',
      neighborhood: '',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '',
    },
    createdAt: new Date().toISOString(),
  };

  // Student Personal Data
  const [fullName, setFullName] = useState('');
  const [socialName, setSocialName] = useState('');
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('2014-05-10');
  const [gender, setGender] = useState<'male' | 'female' | 'other'>('male');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('São Paulo');
  const [monthlyFee, setMonthlyFee] = useState('220');
  const [studentStatus, setStudentStatus] = useState<'active' | 'inactive' | 'suspended' | 'dropped'>('active');

  // Validação em tempo real do CPF do Aluno
  const [studentCpfStatus, setStudentCpfStatus] = useState<{
    isValid: boolean;
    error?: string;
    isDuplicate?: boolean;
    duplicateMsg?: string;
    existingPerson?: Person;
    isStudent?: boolean;
    isGuardian?: boolean;
  } | null>(null);
  const [isCheckingStudentCpf, setIsCheckingStudentCpf] = useState(false);

  // Guardian Data (if minor or linked)
  const [hasGuardian, setHasGuardian] = useState(true);
  const [guardianMode, setGuardianMode] = useState<'select_existing' | 'create_new'>('select_existing');
  const [availableGuardians, setAvailableGuardians] = useState<GuardianSummaryItem[]>([]);
  const [isLoadingGuardians, setIsLoadingGuardians] = useState(false);
  const [guardianSearch, setGuardianSearch] = useState('');
  const [selectedExistingGuardian, setSelectedExistingGuardian] = useState<GuardianSummaryItem | null>(null);

  const [guardianName, setGuardianName] = useState('');
  const [guardianCpf, setGuardianCpf] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [relationshipType, setRelationshipType] = useState('Pai');

  // Validação em tempo real do CPF do Responsável
  const [guardianCpfStatus, setGuardianCpfStatus] = useState<{
    isValid: boolean;
    error?: string;
    isDuplicate?: boolean;
    duplicateMsg?: string;
    existingPerson?: Person;
    isStudent?: boolean;
    dependentsCount?: number;
  } | null>(null);
  const [isCheckingGuardianCpf, setIsCheckingGuardianCpf] = useState(false);

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Vínculos existentes deste aluno (quando em modo de edição)
  const [studentExistingLinks, setStudentExistingLinks] = useState<{
    id: string;
    guardianPerson: Person;
    relationship: GuardianRelationship;
  }[]>([]);
  const [removedLinkIds, setRemovedLinkIds] = useState<string[]>([]);
  const [isAddingAdditionalGuardian, setIsAddingAdditionalGuardian] = useState(false);

  // 1. Carregar Responsáveis Existentes no Tenant para Autocomplete / Reutilização
  useEffect(() => {
    let isMounted = true;
    if (!isOpen) return;

    async function loadGuardians() {
      setIsLoadingGuardians(true);
      try {
        const list = await studentService.fetchGuardiansSummary(tenantId);
        if (isMounted) {
          setAvailableGuardians(list);
        }
      } catch (err) {
        console.warn('Erro ao carregar lista de responsáveis existentes:', err);
      } finally {
        if (isMounted) {
          setIsLoadingGuardians(false);
        }
      }
    }

    loadGuardians();

    // Se estiver editando um aluno, carregar todos os relacionamentos de responsáveis dele
    if (studentToEdit) {
      // 1. Sincronização imediata baseada nas props allGuardians e allPersons
      const localRels = (allGuardians || []).filter((g) => g.studentId === studentToEdit.id);
      if (localRels.length > 0) {
        const localLinks = localRels.map((r) => {
          const person = (allPersons || []).find((p) => p.id === r.guardianPersonId) || guardianPersonToEdit;
          return {
            id: r.id,
            guardianPerson: person || {
              id: r.guardianPersonId,
              tenantId,
              fullName: 'Responsável',
              cpf: '',
              birthDate: '1985-01-01',
              gender: 'other' as const,
              phone: '',
              email: '',
              address: { street: '', number: '', neighborhood: '', city: 'São Paulo', state: 'SP', zipCode: '' },
              createdAt: new Date().toISOString(),
            },
            relationship: r,
          };
        });
        setStudentExistingLinks(localLinks);
        setHasGuardian(true);

        const primary = localLinks[0];
        if (primary && primary.guardianPerson) {
          setGuardianName(primary.guardianPerson.fullName || '');
          setGuardianCpf(primary.guardianPerson.cpf ? formatCPF(primary.guardianPerson.cpf) : '');
          setGuardianPhone(primary.guardianPerson.phone || '');
          setGuardianEmail(primary.guardianPerson.email || '');
          setRelationshipType(primary.relationship.relationshipLabel || 'Pai');
        }
      } else if (guardianPersonToEdit && guardianRelToEdit) {
        setStudentExistingLinks([
          {
            id: guardianRelToEdit.id,
            guardianPerson: guardianPersonToEdit,
            relationship: guardianRelToEdit,
          },
        ]);
        setHasGuardian(true);
        setGuardianName(guardianPersonToEdit.fullName || '');
        setGuardianCpf(guardianPersonToEdit.cpf ? formatCPF(guardianPersonToEdit.cpf) : '');
        setGuardianPhone(guardianPersonToEdit.phone || '');
        setGuardianEmail(guardianPersonToEdit.email || '');
        setRelationshipType(guardianRelToEdit.relationshipLabel || 'Pai');
      }

      // 2. Consulta segura ao Supabase (sem embeddings de chave estrangeira composta)
      if (isValidUUID(studentToEdit.id) && isSupabaseConfigured() && supabase) {
        (async () => {
          try {
            const { data: rels, error: rErr } = await supabase
              .from('guardian_relationships')
              .select('*')
              .eq('student_id', studentToEdit.id)
              .eq('tenant_id', studentToEdit.tenantId || tenantId);

            if (rels && rels.length > 0 && isMounted) {
              const guardianPersonIds = rels.map((r: any) => r.guardian_person_id);
              const { data: personsData } = await supabase
                .from('persons')
                .select('*')
                .in('id', guardianPersonIds)
                .eq('tenant_id', studentToEdit.tenantId || tenantId);

              const personsMap = new Map<string, any>((personsData || []).map((p: any) => [p.id, p]));

              const loaded = rels.map((r: any) => {
                const p = personsMap.get(r.guardian_person_id);
                return {
                  id: r.id,
                  guardianPerson: {
                    id: p?.id || r.guardian_person_id,
                    tenantId: p?.tenant_id || tenantId,
                    fullName: p?.full_name || 'Responsável',
                    socialName: p?.social_name || undefined,
                    cpf: p?.cpf || '',
                    birthDate: p?.birth_date || '1985-01-01',
                    gender: (p?.gender as any) || 'other',
                    phone: p?.phone || '',
                    email: p?.email || '',
                    address: p?.address || {},
                    createdAt: p?.created_at || new Date().toISOString(),
                  },
                  relationship: {
                    id: r.id,
                    tenantId: r.tenant_id,
                    studentId: r.student_id,
                    guardianPersonId: r.guardian_person_id,
                    relationshipLabel: r.relationship_label || 'Responsável',
                    isLegalGuardian: Boolean(r.is_legal_guardian),
                    isFinancialGuardian: Boolean(r.is_financial_guardian),
                    isEmergencyContact: Boolean(r.is_emergency_contact),
                    isPickupAuthorized: Boolean(r.is_pickup_authorized),
                    notes: r.notes,
                  },
                };
              });

              setStudentExistingLinks(loaded);
              setHasGuardian(true);

              if (loaded[0]?.guardianPerson) {
                setGuardianName(loaded[0].guardianPerson.fullName || '');
                setGuardianCpf(loaded[0].guardianPerson.cpf ? formatCPF(loaded[0].guardianPerson.cpf) : '');
                setGuardianPhone(loaded[0].guardianPerson.phone || '');
                setGuardianEmail(loaded[0].guardianPerson.email || '');
                setRelationshipType(loaded[0].relationship.relationshipLabel || 'Pai');
              }
            }
          } catch (err: any) {
            console.warn('Erro ao consultar vínculos de responsáveis do aluno:', err);
          }
        })();
      }
    } else {
      setStudentExistingLinks([]);
      setRemovedLinkIds([]);
      setIsAddingAdditionalGuardian(false);
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen, tenantId, guardianPersonToEdit, guardianRelToEdit, studentToEdit, allGuardians, allPersons]);

  // 2. Carregar Modalidades Reais do Supabase vinculadas à academia ativa (tenant_id)
  useEffect(() => {
    let isMounted = true;

    if (!isOpen) {
      setLoadedArts([]);
      setLoadedBelts([]);
      setSelectedArtId('');
      setSelectedBeltId('');
      setArtsError(null);
      setBeltsError(null);
      setGraduationNotice(null);
      return;
    }

    async function loadArts() {
      setIsLoadingArts(true);
      setArtsError(null);
      setGraduationNotice(null);

      try {
        const arts = await studentService.fetchMartialArts(tenantId);
        if (!isMounted) return;

        setLoadedArts(arts);

        if (arts.length === 0) {
          setArtsError('Nenhuma modalidade ativa encontrada para esta academia no Supabase. Cadastre ao menos uma modalidade no menu "Modalidades".');
          setSelectedArtId('');
          setLoadedBelts([]);
          setSelectedBeltId('');
          return;
        }

        if (studentToEdit) {
          // Identificar se o aluno possui graduação vinculada a alguma modalidade ativa
          const activeGrad = studentToEdit.currentGraduations?.find((g) =>
            arts.some((a) => a.id === g.martialArtId)
          );

          if (activeGrad) {
            setSelectedArtId(activeGrad.martialArtId);
          } else {
            setSelectedArtId('');
            setGraduationNotice(
              'O aluno não possui graduação registrada em nenhuma das modalidades ativas da academia no Supabase. Selecione a modalidade e a faixa para vincular.'
            );
          }
        } else {
          // Cadastro de novo aluno: não seleciona automaticamente
          setSelectedArtId('');
          setSelectedBeltId('');
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.error('Falha ao consultar modalidades do Supabase:', err);
        setArtsError(err.message || 'Erro ao consultar modalidades no Supabase.');
        setLoadedArts([]);
        setSelectedArtId('');
      } finally {
        if (isMounted) {
          setIsLoadingArts(false);
        }
      }
    }

    loadArts();

    return () => {
      isMounted = false;
    };
  }, [isOpen, tenantId, studentToEdit]);

  // 3. Carregar Faixas/Graduações Reais do Supabase correspondentes à modalidade selecionada
  useEffect(() => {
    let isMounted = true;

    if (!isOpen || !selectedArtId || !isValidUUID(selectedArtId)) {
      setLoadedBelts([]);
      setSelectedBeltId('');
      setBeltsError(null);
      setIsLoadingBelts(false);
      return;
    }

    async function loadBelts() {
      setIsLoadingBelts(true);
      setBeltsError(null);

      try {
        const beltsData = await studentService.fetchBeltRanks(tenantId, selectedArtId);
        if (!isMounted) return;

        setLoadedBelts(beltsData);

        if (beltsData.length === 0) {
          setBeltsError('Nenhuma faixa/graduação cadastrada para esta modalidade no Supabase.');
          setSelectedBeltId('');
          return;
        }

        if (studentToEdit) {
          // Verificar se o aluno já possui graduação nesta modalidade específica
          const existingGrad = studentToEdit.currentGraduations?.find(
            (g) => g.martialArtId === selectedArtId
          );

          if (existingGrad) {
            const matchingBelt = beltsData.find((b) => b.id === existingGrad.beltId);
            if (matchingBelt) {
              setSelectedBeltId(matchingBelt.id);
            } else {
              setSelectedBeltId('');
              setGraduationNotice(
                `A faixa registrada anteriormente (${existingGrad.beltName}) não foi encontrada nas graduações cadastradas desta modalidade. Selecione a faixa correspondente para atualizar.`
              );
            }
          } else {
            setSelectedBeltId('');
            setGraduationNotice('O aluno ainda não possui graduação cadastrada nesta modalidade. Selecione a faixa desejada para vincular.');
          }
        } else {
          // Cadastro de novo aluno: limpar graduação anterior e exigir seleção válida
          setSelectedBeltId('');
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.error('Falha ao carregar faixas da modalidade:', err);
        setBeltsError(err.message || 'Erro ao carregar faixas da modalidade no Supabase.');
        setLoadedBelts([]);
        setSelectedBeltId('');
      } finally {
        if (isMounted) {
          setIsLoadingBelts(false);
        }
      }
    }

    loadBelts();

    return () => {
      isMounted = false;
    };
  }, [isOpen, tenantId, selectedArtId, studentToEdit]);

  // 4. Sincronizar dados pessoais ao abrir para criar ou editar
  useEffect(() => {
    if (!isOpen) return;

    setError('');
    setIsSubmitting(false);
    setStudentCpfStatus(null);
    setGuardianCpfStatus(null);
    setGuardianSearch('');

    if (studentToEdit) {
      const p = activePersonToEdit;
      setFullName(p.fullName || '');
      setSocialName(p.socialName || '');
      const rawCpf = p.cpf || '';
      setCpf(rawCpf ? formatCPF(rawCpf) : '');
      setBirthDate(p.birthDate || '2014-05-10');
      setGender(p.gender || 'male');
      setPhone(p.phone || '');
      setEmail(p.email || '');
      setCity(p.address?.city || 'São Paulo');
      setMonthlyFee(String(studentToEdit.monthlyFee ?? 220));
      setStudentStatus(studentToEdit.status || 'active');

      const studentRels = (allGuardians || []).filter((g) => g.studentId === studentToEdit.id);
      const studentHasGuardian = Boolean(guardianPersonToEdit || studentRels.length > 0 || studentExistingLinks.length > 0);

      // A caixa de seleção reflete fielmente se o aluno já possui responsável vinculado no sistema
      setHasGuardian(studentHasGuardian);

      if (studentHasGuardian) {
        const gPerson = guardianPersonToEdit || (studentRels[0] ? (allPersons || []).find((p) => p.id === studentRels[0].guardianPersonId) : undefined) || studentExistingLinks[0]?.guardianPerson;
        if (gPerson) {
          setGuardianName(gPerson.fullName || '');
          setGuardianCpf(gPerson.cpf ? formatCPF(gPerson.cpf) : '');
          setGuardianPhone(gPerson.phone || '');
          setGuardianEmail(gPerson.email || '');
          setRelationshipType(guardianRelToEdit?.relationshipLabel || studentRels[0]?.relationshipLabel || studentExistingLinks[0]?.relationship?.relationshipLabel || 'Pai');
        }
      } else {
        setGuardianName('');
        setGuardianCpf('');
        setGuardianPhone('');
        setGuardianEmail('');
        setRelationshipType('Pai');
        setSelectedExistingGuardian(null);
      }
    } else {
      // Modo Criação
      setFullName('');
      setSocialName('');
      setCpf('');
      setBirthDate('2014-05-10');
      setGender('male');
      setPhone('');
      setEmail('');
      setCity('São Paulo');
      setMonthlyFee('220');
      setStudentStatus('active');
      setHasGuardian(true);
      setGuardianName('');
      setGuardianCpf('');
      setGuardianPhone('');
      setGuardianEmail('');
      setRelationshipType('Pai');
      setSelectedExistingGuardian(null);
      setGuardianMode('select_existing');
    }
  }, [isOpen, studentToEdit, personToEdit, guardianRelToEdit, guardianPersonToEdit, allGuardians, allPersons]);

  if (!isOpen) return null;

  const currentAge = calculateAge(birthDate);

  // Manipulador de digitação do CPF do Aluno com formatação e validação matemática
  const handleStudentCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const clean = cleanCPF(raw);
    if (clean.length > 11) return;

    const formatted = clean.length > 0 ? formatCPF(clean) : '';
    setCpf(formatted);

    if (clean.length === 0) {
      setStudentCpfStatus(null);
      return;
    }

    if (clean.length < 11) {
      setStudentCpfStatus({
        isValid: false,
        error: `Digite 11 dígitos (${clean.length}/11)`,
      });
      return;
    }

    // 11 dígitos: validação matemática oficial do módulo 11
    const validation = validateCPF(clean);
    if (!validation.isValid) {
      setStudentCpfStatus({
        isValid: false,
        error: validation.error,
      });
      return;
    }

    // Validação matemática OK. Checar unicidade por academia (tenant)
    setIsCheckingStudentCpf(true);
    const excludeId = isEditing && activePersonToEdit ? activePersonToEdit.id : undefined;

    studentService
      .checkCpfDuplicity(tenantId, clean, excludeId)
      .then((dupl) => {
        setIsCheckingStudentCpf(false);
        if (dupl.isDuplicate) {
          if (!dupl.isStudent && dupl.existingPerson) {
            // Auto-preencher dados da pessoa que já é responsável na academia
            setFullName(dupl.existingPerson.fullName);
            if (dupl.existingPerson.socialName) setSocialName(dupl.existingPerson.socialName);
            if (dupl.existingPerson.phone) setPhone(dupl.existingPerson.phone);
            if (dupl.existingPerson.email) setEmail(dupl.existingPerson.email);
            if (dupl.existingPerson.birthDate) setBirthDate(dupl.existingPerson.birthDate);
            if (dupl.existingPerson.gender) setGender(dupl.existingPerson.gender as any);
            if (dupl.existingPerson.address?.city) setCity(dupl.existingPerson.address.city);
            const age = calculateAge(dupl.existingPerson.birthDate);
            if (age >= 18) {
              setHasGuardian(false);
            }
          }

          setStudentCpfStatus({
            isValid: !dupl.isStudent, // se for estudante já matriculado, bloqueia; se for responsável, permite matricular como aluno
            isDuplicate: true,
            duplicateMsg: dupl.message,
            existingPerson: dupl.existingPerson,
            isStudent: dupl.isStudent,
            isGuardian: dupl.isGuardian,
          });
        } else {
          setStudentCpfStatus({
            isValid: true,
          });
        }
      })
      .catch(() => {
        setIsCheckingStudentCpf(false);
        setStudentCpfStatus({ isValid: true });
      });
  };

  // Manipulador de digitação do CPF do Responsável
  const handleGuardianCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const clean = cleanCPF(raw);
    if (clean.length > 11) return;

    const formatted = clean.length > 0 ? formatCPF(clean) : '';
    setGuardianCpf(formatted);

    if (clean.length === 0) {
      setGuardianCpfStatus(null);
      return;
    }

    if (clean.length < 11) {
      setGuardianCpfStatus({
        isValid: false,
        error: `Digite 11 dígitos (${clean.length}/11)`,
      });
      return;
    }

    const validation = validateCPF(clean);
    if (!validation.isValid) {
      setGuardianCpfStatus({
        isValid: false,
        error: validation.error,
      });
      return;
    }

    // Verificar se já existe pessoa com esse CPF na academia
    setIsCheckingGuardianCpf(true);
    studentService
      .findPersonByCpf(tenantId, clean)
      .then((found) => {
        setIsCheckingGuardianCpf(false);
        if (found && found.person) {
          // Auto-preencher automaticamente os dados cadastrais do responsável
          setGuardianName(found.person.fullName);
          if (found.person.phone) setGuardianPhone(found.person.phone);
          if (found.person.email) setGuardianEmail(found.person.email);

          setSelectedExistingGuardian({
            person: found.person,
            isStudent: found.isStudent,
            studentProfile: found.student
              ? {
                  id: found.student.id,
                  registrationNumber: found.student.registrationNumber,
                  status: found.student.status,
                  enrollmentDate: found.student.enrollmentDate,
                }
              : undefined,
            dependents: (found.dependents || []).map((d: any) => ({
              relationshipId: d.relationshipId || `rel-${Date.now()}`,
              studentId: d.studentId,
              relationshipLabel: d.relationshipLabel || 'Dependente',
              isLegalGuardian: true,
              isFinancialGuardian: true,
              isEmergencyContact: true,
              isPickupAuthorized: true,
              studentRegistrationNumber: d.studentRegistrationNumber || 'MAT',
              studentStatus: d.studentStatus || 'active',
              studentPerson: {
                id: d.studentId,
                tenantId,
                fullName: d.studentName || 'Aluno',
                cpf: '',
                birthDate: '2010-01-01',
                gender: 'male' as const,
                phone: '',
                email: '',
                address: {
                  street: '',
                  number: '',
                  neighborhood: '',
                  city: '',
                  state: '',
                  zipCode: '',
                },
                createdAt: new Date().toISOString(),
              },
            })),
          });

          setGuardianCpfStatus({
            isValid: true,
            isDuplicate: true,
            existingPerson: found.person,
            isStudent: found.isStudent,
            dependentsCount: found.dependentsCount,
            duplicateMsg: `Responsável localizado no Dojo: ${found.person.fullName}${
              found.isStudent ? ' (Também é Aluno Matriculado)' : ''
            }. Dados preenchidos automaticamente.`,
          });
        } else {
          setGuardianCpfStatus({
            isValid: true,
          });
        }
      })
      .catch(() => {
        setIsCheckingGuardianCpf(false);
        setGuardianCpfStatus({ isValid: true });
      });
  };

  // Selecionar responsável existente da academia
  const handleSelectExistingGuardian = (guardianItem: GuardianSummaryItem) => {
    setSelectedExistingGuardian(guardianItem);
    setGuardianName(guardianItem.person.fullName);
    setGuardianCpf(guardianItem.person.cpf ? formatCPF(guardianItem.person.cpf) : '');
    setGuardianPhone(guardianItem.person.phone || '');
    setGuardianEmail(guardianItem.person.email || '');
    setGuardianCpfStatus({ isValid: true });
  };

  // Limpar responsável selecionado
  const handleClearSelectedGuardian = () => {
    setSelectedExistingGuardian(null);
    setGuardianName('');
    setGuardianCpf('');
    setGuardianPhone('');
    setGuardianEmail('');
    setGuardianCpfStatus(null);
  };

  // Responsáveis filtrados pela busca
  const filteredGuardians = availableGuardians.filter((g) => {
    const term = guardianSearch.toLowerCase().trim();
    if (!term) return true;
    const cleanTerm = cleanCPF(term);
    const matchesName = g.person.fullName.toLowerCase().includes(term);
    const matchesCpf = cleanTerm && cleanCPF(g.person.cpf).includes(cleanTerm);
    const matchesStudent = g.dependents.some((d) =>
      d.studentPerson.fullName.toLowerCase().includes(term)
    );
    return matchesName || matchesCpf || matchesStudent;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!fullName.trim() || !birthDate) {
      setError('Por favor, informe ao menos o nome completo e data de nascimento do aluno.');
      return;
    }

    const cleanStudentCpf = cleanCPF(cpf);
    const studentAgeAtSave = calculateAge(birthDate);

    // O CPF é obrigatório para alunos maiores de 18 anos
    if (studentAgeAtSave >= 18 && !cleanStudentCpf) {
      setError('O CPF é obrigatório para alunos maiores de 18 anos.');
      return;
    }

    // Validação matemática do CPF do Aluno (se informado)
    if (cleanStudentCpf) {
      const val = validateCPF(cleanStudentCpf);
      if (!val.isValid) {
        setError(`CPF do Aluno inválido: ${val.error}`);
        return;
      }
      if (studentCpfStatus?.isDuplicate && studentCpfStatus?.isStudent) {
        setError(`CPF duplicado: ${studentCpfStatus.duplicateMsg}`);
        return;
      }
    }

    // Validações do Responsável
    if (hasGuardian) {
      const hasExisting = studentExistingLinks.length > 0;
      if (guardianMode === 'select_existing') {
        if (!selectedExistingGuardian && !guardianName.trim() && !hasExisting) {
          setError('Selecione um responsável cadastrado na academia ou alterne para a aba "Cadastrar Novo Responsável".');
          return;
        }
      } else {
        if (!guardianName.trim() && !hasExisting) {
          setError('Por favor, informe o nome completo do responsável.');
          return;
        }
        const cleanGrdCpf = cleanCPF(guardianCpf);
        if (!cleanGrdCpf && !selectedExistingGuardian && !hasExisting) {
          setError('O CPF do responsável é obrigatório para garantir o controle de vínculos e evitar cadastros duplicados.');
          return;
        }
        if (cleanGrdCpf) {
          const valG = validateCPF(cleanGrdCpf);
          if (!valG.isValid) {
            setError(`CPF do Responsável inválido: ${valG.error}`);
            return;
          }
        }
      }
    }

    setIsSubmitting(true);

    // Resolução flexível e segura de modalidade e graduação
    let chosenArt = loadedArts.find((m) => m.id === selectedArtId) || martialArts.find((m) => m.id === selectedArtId);
    let chosenBelt = loadedBelts.find((b) => b.id === selectedBeltId) || belts.find((b) => b.id === selectedBeltId);

    // Se estiver em modo edição e o aluno já tiver graduação
    if ((!chosenArt || !chosenBelt) && studentToEdit?.currentGraduations?.[0]) {
      const existingGrad = studentToEdit.currentGraduations[0];
      chosenArt = chosenArt || {
        id: existingGrad.martialArtId,
        tenantId,
        name: existingGrad.martialArtName || 'Judô',
        status: 'active',
      };
      chosenBelt = chosenBelt || {
        id: existingGrad.beltId,
        tenantId,
        martialArtId: existingGrad.martialArtId,
        name: existingGrad.beltName || 'Faixa Branca',
        rankType: 'faixa',
        orderIndex: 1,
        colorHex: existingGrad.beltColorHex || '#ffffff',
        minAgeYears: 4,
        minPracticeMonths: 0,
        requiresExam: false,
      };
    }

    if (!chosenArt || !chosenBelt) {
      if (loadedArts.length > 0 && loadedBelts.length > 0) {
        chosenArt = loadedArts[0];
        chosenBelt = loadedBelts[0];
      } else if (martialArts.length > 0 && belts.length > 0) {
        chosenArt = martialArts[0];
        chosenBelt = belts[0];
      } else {
        chosenArt = { id: selectedArtId || 'art-judo', tenantId, name: 'Judô', status: 'active' };
        chosenBelt = { id: selectedBeltId || 'rank-judo-branca', tenantId, martialArtId: chosenArt.id, name: 'Faixa Branca', rankType: 'faixa', orderIndex: 1, colorHex: '#ffffff', minAgeYears: 4, minPracticeMonths: 0, requiresExam: false };
      }
    }

    const normalizedStudentCpf = cleanStudentCpf ? formatCPF(cleanStudentCpf) : undefined;
    const cleanGrdCpf = cleanCPF(guardianCpf);
    const normalizedGuardianCpf = cleanGrdCpf ? formatCPF(cleanGrdCpf) : undefined;

    // Determinar ID da pessoa do responsável para reaproveitamento
    const effectiveReusedGuardianPersonId =
      selectedExistingGuardian?.person.id ||
      (guardianCpfStatus?.existingPerson ? guardianCpfStatus.existingPerson.id : undefined);

    // ==========================================
    // FLUXO DE EDIÇÃO DE ALUNO EXISTENTE
    // ==========================================
    if (isEditing && studentToEdit) {
      const p = personToEdit || activePersonToEdit;
      const updatedPerson: Person = {
        ...p,
        fullName: fullName.trim(),
        socialName: socialName.trim() || undefined,
        cpf: normalizedStudentCpf || p.cpf || '',
        birthDate,
        gender,
        phone: phone || p.phone,
        email: email || p.email,
        address: {
          ...(p.address || {}),
          city,
        },
      };

      const updatedStudent: Student = {
        ...studentToEdit,
        monthlyFee: Number(monthlyFee) || studentToEdit.monthlyFee,
        status: studentStatus,
        currentGraduations: [
          {
            martialArtId: chosenArt.id,
            martialArtName: chosenArt.name,
            beltId: chosenBelt.id,
            beltName: chosenBelt.name,
            beltColorHex: chosenBelt.colorHex || '#ffffff',
            graduatedAt: new Date().toISOString().split('T')[0],
          },
        ],
      };

      let updatedGuardianPerson: Person | undefined = undefined;
      let updatedRelationship: GuardianRelationship | undefined = undefined;

      // 1. Processar exclusão explícita de vínculos removidos pelo usuário
      if (removedLinkIds.length > 0 && isSupabaseConfigured() && supabase) {
        for (const rId of removedLinkIds) {
          try {
            await supabase.from('guardian_relationships').delete().eq('id', rId);
          } catch (rErr) {
            console.warn('Aviso ao remover vínculo de responsável no Supabase:', rErr);
          }
        }
      }

      // 2. Determinar responsável ativo se hasGuardian for verdadeiro
      if (hasGuardian) {
        if (selectedExistingGuardian) {
          // Prioridade 1: Responsável existente explicitamente selecionado
          updatedGuardianPerson = selectedExistingGuardian.person;
          updatedRelationship = {
            id: guardianRelToEdit?.id || (studentExistingLinks[0]?.id) || `rel-${Date.now()}`,
            tenantId,
            studentId: studentToEdit.id,
            guardianPersonId: selectedExistingGuardian.person.id,
            relationshipLabel: relationshipType || 'Responsável',
            isLegalGuardian: true,
            isFinancialGuardian: true,
            isEmergencyContact: true,
            isPickupAuthorized: true,
          };
        } else if (guardianCpfStatus?.existingPerson || effectiveReusedGuardianPersonId) {
          // Prioridade 2: CPF digitado correspondeu a pessoa/responsável já cadastrado
          const existingPerson =
            guardianCpfStatus?.existingPerson ||
            (allPersons || []).find((p) => p.id === effectiveReusedGuardianPersonId);
          const gId = existingPerson?.id || effectiveReusedGuardianPersonId!;

          updatedGuardianPerson = existingPerson || {
            id: gId,
            tenantId,
            fullName: guardianName.trim(),
            cpf: normalizedGuardianCpf || '',
            birthDate: '1985-01-01',
            gender: 'other',
            phone: guardianPhone || phone || '',
            email: guardianEmail || '',
            address: updatedPerson.address,
            createdAt: new Date().toISOString(),
          };

          updatedRelationship = {
            id: guardianRelToEdit?.id || (studentExistingLinks[0]?.id) || `rel-${Date.now()}`,
            tenantId,
            studentId: studentToEdit.id,
            guardianPersonId: gId,
            relationshipLabel: relationshipType || 'Responsável',
            isLegalGuardian: true,
            isFinancialGuardian: true,
            isEmergencyContact: true,
            isPickupAuthorized: true,
          };
        } else if (guardianMode === 'create_new' && guardianName.trim()) {
          // Prioridade 3: Cadastro de NOVO responsável digitado pelo usuário
          const gId = `person-g-${Date.now()}`;
          updatedGuardianPerson = {
            id: gId,
            tenantId,
            fullName: guardianName.trim(),
            cpf: normalizedGuardianCpf || '',
            birthDate: '1985-01-01',
            gender: 'other',
            phone: guardianPhone || phone || '',
            email: guardianEmail || '',
            address: updatedPerson.address,
            createdAt: new Date().toISOString(),
          };

          updatedRelationship = {
            id: guardianRelToEdit?.id || `rel-${Date.now()}`,
            tenantId,
            studentId: studentToEdit.id,
            guardianPersonId: gId,
            relationshipLabel: relationshipType || 'Responsável',
            isLegalGuardian: true,
            isFinancialGuardian: true,
            isEmergencyContact: true,
            isPickupAuthorized: true,
          };
        } else if (studentExistingLinks.length > 0) {
          // Prioridade 4: Manter com total integridade o responsável já existente
          updatedGuardianPerson = studentExistingLinks[0].guardianPerson;
          updatedRelationship = studentExistingLinks[0].relationship;
        } else if (guardianName.trim()) {
          // Caso genérico com nome informado
          const gId = guardianPersonToEdit?.id || `person-g-${Date.now()}`;
          updatedGuardianPerson = {
            id: gId,
            tenantId,
            fullName: guardianName.trim(),
            cpf: normalizedGuardianCpf || guardianPersonToEdit?.cpf || '',
            birthDate: guardianPersonToEdit?.birthDate || '1985-01-01',
            gender: guardianPersonToEdit?.gender || 'other',
            phone: guardianPhone || guardianPersonToEdit?.phone || '',
            email: guardianEmail || guardianPersonToEdit?.email || '',
            address: updatedPerson.address,
            createdAt: guardianPersonToEdit?.createdAt || new Date().toISOString(),
          };

          updatedRelationship = {
            id: guardianRelToEdit?.id || `rel-${Date.now()}`,
            tenantId,
            studentId: studentToEdit.id,
            guardianPersonId: gId,
            relationshipLabel: relationshipType || 'Responsável',
            isLegalGuardian: true,
            isFinancialGuardian: true,
            isEmergencyContact: true,
            isPickupAuthorized: true,
          };
        }
      }

      const effectiveTenantId = isValidUUID(studentToEdit?.tenantId) ? studentToEdit.tenantId : tenantId;
      const effectiveBranchId = isValidUUID(studentToEdit?.branchId) ? studentToEdit.branchId : branchId;

      const isActuallyLinked = Boolean(
        hasGuardian && (updatedGuardianPerson || selectedExistingGuardian || studentExistingLinks.length > 0 || guardianName.trim())
      );

      const updatePayload: UpdateStudentPayload = {
        studentId: studentToEdit.id,
        personId: p.id,
        tenantId: effectiveTenantId,
        branchId: effectiveBranchId,
        fullName: fullName.trim(),
        socialName: socialName.trim() || undefined,
        birthDate,
        cpf: normalizedStudentCpf,
        gender,
        phone,
        email,
        city,
        monthlyFee: Number(monthlyFee) || studentToEdit.monthlyFee,
        status: studentStatus,
        martialArtId: selectedArtId,
        beltRankId: selectedBeltId,
        selectedArt: chosenArt,
        selectedBelt: chosenBelt,
        hasGuardian: isActuallyLinked,
        guardianPersonId: isActuallyLinked ? (updatedGuardianPerson?.id || selectedExistingGuardian?.person.id || effectiveReusedGuardianPersonId) : undefined,
        reusedGuardianPersonId: isActuallyLinked ? (selectedExistingGuardian?.person.id || effectiveReusedGuardianPersonId || updatedGuardianPerson?.id) : undefined,
        guardianRelId: isActuallyLinked ? (updatedRelationship?.id || guardianRelToEdit?.id) : undefined,
        guardianName: isActuallyLinked ? (updatedGuardianPerson?.fullName || selectedExistingGuardian?.person.fullName || guardianName.trim()) : undefined,
        guardianCpf: isActuallyLinked ? (updatedGuardianPerson?.cpf || selectedExistingGuardian?.person.cpf || normalizedGuardianCpf) : undefined,
        guardianPhone: isActuallyLinked ? (updatedGuardianPerson?.phone || selectedExistingGuardian?.person.phone || guardianPhone) : undefined,
        guardianEmail: isActuallyLinked ? (updatedGuardianPerson?.email || selectedExistingGuardian?.person.email || guardianEmail) : undefined,
        relationshipType: isActuallyLinked ? (updatedRelationship?.relationshipLabel || relationshipType) : undefined,
      };

      try {
        if (onUpdate) {
          await onUpdate(updatedStudent, updatedPerson, updatedGuardianPerson, updatedRelationship, updatePayload);
        } else {
          await onSave(updatedStudent, updatedPerson, updatedGuardianPerson, updatedRelationship);
        }
      } catch (err: any) {
        setError(err?.message || 'Erro ao atualizar dados do aluno.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // ==========================================
    // FLUXO DE CRIAÇÃO DE NOVO ALUNO
    // ==========================================
    const studentPersonId = studentCpfStatus?.existingPerson
      ? studentCpfStatus.existingPerson.id
      : `person-${Date.now()}`;
    const studentId = `student-${Date.now()}`;
    const now = new Date().toISOString();

    const newPerson: Person = {
      id: studentPersonId,
      tenantId,
      fullName: fullName.trim(),
      socialName: socialName.trim() || undefined,
      cpf: normalizedStudentCpf || '',
      birthDate,
      gender,
      phone: phone || '',
      email: email || '',
      address: {
        street: 'Rua das Flores',
        number: '123',
        neighborhood: 'Centro',
        city,
        state: 'SP',
        zipCode: '01000-000',
      },
      createdAt: now,
    };

    const newStudent: Student = {
      id: studentId,
      tenantId,
      branchId,
      personId: studentPersonId,
      registrationNumber: `MAT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      enrollmentDate: new Date().toISOString().split('T')[0],
      status: studentStatus,
      currentGraduations: [
        {
          martialArtId: chosenArt.id,
          martialArtName: chosenArt.name,
          beltId: chosenBelt.id,
          beltName: chosenBelt.name,
          beltColorHex: chosenBelt.colorHex || '#ffffff',
          graduatedAt: new Date().toISOString().split('T')[0],
        },
      ],
      monthlyFee: Number(monthlyFee) || 220,
    };

    let guardianPerson: Person | undefined = undefined;
    let relationship: GuardianRelationship | undefined = undefined;

    if (hasGuardian && (guardianName.trim() || selectedExistingGuardian)) {
      const gName = selectedExistingGuardian?.person.fullName || guardianName.trim();
      const gCpf = selectedExistingGuardian?.person.cpf || normalizedGuardianCpf || '';
      const guardianId = selectedExistingGuardian?.person.id || effectiveReusedGuardianPersonId || `person-g-${Date.now()}`;
      guardianPerson = selectedExistingGuardian?.person || {
        id: guardianId,
        tenantId,
        fullName: gName,
        cpf: gCpf,
        birthDate: '1985-01-01',
        gender: 'other',
        phone: guardianPhone || phone || '',
        email: guardianEmail || '',
        address: newPerson.address,
        createdAt: now,
      };

      relationship = {
        id: `rel-${Date.now()}`,
        tenantId,
        studentId,
        guardianPersonId: guardianId,
        relationshipLabel: relationshipType,
        isLegalGuardian: true,
        isFinancialGuardian: true,
        isEmergencyContact: true,
        isPickupAuthorized: true,
      };
    }

    const payloadDetails: CreateStudentPayload = {
      tenantId,
      branchId,
      fullName: fullName.trim(),
      socialName: socialName.trim() || undefined,
      cpf: normalizedStudentCpf,
      birthDate,
      gender,
      phone,
      email,
      city,
      monthlyFee: Number(monthlyFee) || 220,
      martialArtId: selectedArtId,
      beltRankId: selectedBeltId,
      selectedArt: chosenArt,
      selectedBelt: chosenBelt,
      hasGuardian,
      reusedGuardianPersonId: selectedExistingGuardian?.person.id || effectiveReusedGuardianPersonId,
      guardianName: selectedExistingGuardian?.person.fullName || guardianName.trim(),
      guardianCpf: selectedExistingGuardian?.person.cpf || normalizedGuardianCpf,
      guardianPhone: selectedExistingGuardian?.person.phone || guardianPhone,
      guardianEmail: selectedExistingGuardian?.person.email || guardianEmail,
      relationshipType,
    };

    try {
      await onSave(newStudent, newPerson, guardianPerson, relationship, payloadDetails);
    } catch (err: any) {
      setError(err?.message || 'Erro ao persistir aluno.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600/20 text-red-500">
            {isEditing ? <Edit className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">
              {isEditing ? `Editar Aluno: ${personToEdit?.fullName || fullName}` : 'Cadastrar Novo Aluno'}
            </h3>
            <p className="text-xs text-slate-400">
              {isEditing
                ? `Matrícula: ${studentToEdit?.registrationNumber} · Atualize os dados cadastrais, graduação e vínculos familiares.`
                : 'Preencha os dados de identificação, graduação inicial e responsáveis com validação matemática de CPF.'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-500/50 text-xs text-red-200 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Seção 1: Dados Pessoais do Aluno */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-200 text-xs uppercase tracking-wider">
                1. Identificação do Aluno
              </div>
              <span className="text-[11px] text-slate-400">
                Idade calculada: <strong className="text-white">{currentAge} anos</strong> ({currentAge < 18 ? 'Menor' : 'Maior'})
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nome do atleta"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Nome Social (Opcional)</label>
                <input
                  type="text"
                  value={socialName}
                  onChange={(e) => setSocialName(e.target.value)}
                  placeholder="Como prefere ser chamado"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-medium">CPF do Aluno</label>
                  {isCheckingStudentCpf && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-red-400" />
                      Validando...
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={cpf}
                  onChange={handleStudentCpfChange}
                  placeholder="000.000.000-00"
                  maxLength={14}
                  className={`w-full rounded-lg border px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none ${
                    studentCpfStatus && !studentCpfStatus.isValid
                      ? 'border-red-500 bg-red-950/20'
                      : studentCpfStatus && studentCpfStatus.isValid
                      ? 'border-emerald-500 bg-emerald-950/20'
                      : 'border-slate-700 bg-slate-800 focus:border-red-500'
                  }`}
                />
                {studentCpfStatus && (
                  <div className="mt-1">
                    {studentCpfStatus.isValid ? (
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        CPF matematicamente válido
                        {studentCpfStatus.isDuplicate && !studentCpfStatus.isStudent && (
                          <span className="text-blue-300 ml-1 font-sans">
                            · Reaproveitará cadastro existente de {studentCpfStatus.existingPerson?.fullName}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[10px] text-red-400 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {studentCpfStatus.error || studentCpfStatus.duplicateMsg}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Data de Nascimento *</label>
                <input
                  type="date"
                  required
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Gênero</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                >
                  <option value="male">Masculino</option>
                  <option value="female">Feminino</option>
                  <option value="other">Outro</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Telefone / WhatsApp</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(11) 98888-7777"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-slate-300 font-medium mb-1">E-mail do Aluno</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="aluno@email.com"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Cidade / Estado</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="São Paulo"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Seção 2: Modalidade, Graduação e Mensalidade */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-200 text-xs uppercase tracking-wider">
                2. Modalidade, Graduação & Situação
              </div>
              {isLoadingArts && (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin text-red-400" />
                  <span>Consultando Supabase...</span>
                </div>
              )}
            </div>

            {/* Aviso quando o aluno possui múltiplas artes marciais cadastradas */}
            {studentToEdit && (studentToEdit.currentGraduations || []).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
                <span className="text-slate-400 font-medium">Graduações atuais do aluno:</span>
                {studentToEdit.currentGraduations.map((g, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setSelectedArtId(g.martialArtId);
                      setGraduationNotice(null);
                    }}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                      selectedArtId === g.martialArtId
                        ? 'bg-red-950/80 border-red-500 text-white font-semibold'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                    }`}
                    title={`Clique para selecionar e editar a graduação em ${g.martialArtName}`}
                  >
                    <span
                      className="h-2 w-2 rounded-full border border-slate-500 shrink-0"
                      style={{ backgroundColor: g.beltColorHex }}
                    />
                    <span>{g.martialArtName}: {g.beltName}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Notificação sobre status da graduação */}
            {graduationNotice && (
              <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/40 text-[11px] text-amber-200 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                <span>{graduationNotice}</span>
              </div>
            )}

            {/* Erro de consulta de modalidades */}
            {artsError && (
              <div className="p-2.5 rounded-lg bg-red-950/50 border border-red-500/50 text-[11px] text-red-200 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <span>{artsError}</span>
              </div>
            )}

            {/* Erro de consulta de faixas */}
            {beltsError && (
              <div className="p-2.5 rounded-lg bg-red-950/50 border border-red-500/50 text-[11px] text-red-200 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <span>{beltsError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Arte Marcial * {isLoadingArts && <Loader2 className="inline h-3 w-3 animate-spin text-red-400 ml-1" />}
                </label>
                <select
                  value={selectedArtId}
                  onChange={(e) => {
                    setSelectedArtId(e.target.value);
                    setGraduationNotice(null);
                  }}
                  required
                  disabled={isLoadingArts || loadedArts.length === 0}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="">Selecione a Modalidade...</option>
                  {loadedArts.map((art) => (
                    <option key={art.id} value={art.id}>
                      {art.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Faixa / Graduação * {isLoadingBelts && <Loader2 className="inline h-3 w-3 animate-spin text-red-400 ml-1" />}
                </label>
                <select
                  value={selectedBeltId}
                  onChange={(e) => {
                    setSelectedBeltId(e.target.value);
                    setGraduationNotice(null);
                  }}
                  required
                  disabled={isLoadingBelts || !selectedArtId || loadedBelts.length === 0}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none disabled:opacity-50"
                >
                  {!selectedArtId ? (
                    <option value="">Selecione a modalidade primeiro</option>
                  ) : isLoadingBelts ? (
                    <option value="">Carregando faixas da modalidade...</option>
                  ) : loadedBelts.length === 0 ? (
                    <option value="">Nenhuma faixa cadastrada nesta modalidade</option>
                  ) : (
                    <>
                      <option value="">Selecione a Faixa / Graduação...</option>
                      {loadedBelts.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.rankType === 'dan' ? 'Dan' : 'Faixa'})
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Mensalidade (R$)</label>
                <input
                  type="number"
                  value={monthlyFee}
                  onChange={(e) => setMonthlyFee(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Situação / Status</label>
                <select
                  value={studentStatus}
                  onChange={(e) => setStudentStatus(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                >
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                  <option value="suspended">Trancado / Suspenso</option>
                  <option value="dropped">Cancelado</option>
                </select>
              </div>
            </div>
          </div>

          {/* Seção 3: Responsável Legal & Financeiro (Reutilização de Pessoas e Vínculos Familiares) */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-1.5">
                <Users className="h-4 w-4 text-red-400" />
                <span>3. Responsável Legal & Financeiro {currentAge < 18 ? '(Obrigatório para Menores)' : '(Opcional)'}</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-300">
                <input
                  type="checkbox"
                  checked={hasGuardian}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setHasGuardian(checked);
                    if (!checked) {
                      setSelectedExistingGuardian(null);
                      if (studentExistingLinks.length > 0) {
                        setRemovedLinkIds((prev) => [...prev, ...studentExistingLinks.map((l) => l.id)]);
                        setStudentExistingLinks([]);
                      }
                      setGuardianName('');
                      setGuardianCpf('');
                      setGuardianPhone('');
                      setGuardianEmail('');
                      setGuardianCpfStatus(null);
                    }
                  }}
                  className="rounded border-slate-700 text-red-600 focus:ring-0 cursor-pointer"
                />
                <span>Vincular Responsável</span>
              </label>
            </div>

            {hasGuardian && (
              <div className="space-y-3 pt-2">
                {/* 1. SE EXISTIREM VÍNCULOS JÁ CADASTRADOS (MODO EDIÇÃO) */}
                {isEditing && studentExistingLinks.length > 0 && (
                  <div className="p-3 rounded-xl border border-slate-700 bg-slate-900/90 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                        <ShieldCheck className="h-4 w-4 text-emerald-400" />
                        <span>Responsáveis Vinculados ao Aluno ({studentExistingLinks.length})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsAddingAdditionalGuardian(!isAddingAdditionalGuardian)}
                        className="text-[11px] font-semibold text-red-400 hover:text-red-300 flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="h-3 w-3" />
                        <span>{isAddingAdditionalGuardian ? 'Ocultar Novo Vínculo' : 'Vincular Outro Responsável'}</span>
                      </button>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      {studentExistingLinks.map((link) => (
                        <div
                          key={link.id}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white">{link.guardianPerson.fullName}</span>
                              <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                                {link.relationship.relationshipLabel}
                              </span>
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                                Gravado no Banco ✓
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex gap-2">
                              <span>CPF: {formatCPF(link.guardianPerson.cpf) || 'Sem CPF'}</span>
                              <span>·</span>
                              <span>{formatPhoneBR(link.guardianPerson.phone)}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setRemovedLinkIds((prev) => [...prev, link.id]);
                              const remaining = studentExistingLinks.filter((l) => l.id !== link.id);
                              setStudentExistingLinks(remaining);
                              if (remaining.length === 0 && !selectedExistingGuardian) {
                                setGuardianName('');
                                setGuardianCpf('');
                                setGuardianPhone('');
                                setGuardianEmail('');
                                setGuardianCpfStatus(null);
                                setHasGuardian(false);
                              }
                            }}
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-red-950/80 text-slate-400 hover:text-red-300 border border-slate-700 transition-colors text-[10px] cursor-pointer"
                            title="Remover este vínculo do aluno"
                          >
                            <Trash2 className="h-3 w-3 text-red-400" />
                            <span>Remover Vínculo</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. ÁREA DE SELEÇÃO OU CADASTRO DE RESPONSÁVEL */}
                {(!isEditing || studentExistingLinks.length === 0 || isAddingAdditionalGuardian) && (
                  <>
                    {/* Abas de Escolha do Responsável: Reutilizar Existente vs. Novo Cadastro */}
                    <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                      <button
                        type="button"
                        onClick={() => setGuardianMode('select_existing')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                          guardianMode === 'select_existing'
                            ? 'bg-red-600 text-white shadow'
                            : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                        }`}
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        <span>Selecionar Responsável Existente ({availableGuardians.length})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setGuardianMode('create_new');
                          setSelectedExistingGuardian(null);
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                          guardianMode === 'create_new'
                            ? 'bg-red-600 text-white shadow'
                            : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                        }`}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        <span>Cadastrar Novo Responsável</span>
                      </button>
                    </div>

                {/* MODO 1: SELECIONAR RESPONSÁVEL EXISTENTE NA ACADEMIA */}
                {guardianMode === 'select_existing' && (
                  <div className="space-y-3">
                    {selectedExistingGuardian ? (
                      <div className="p-3 rounded-xl border border-emerald-500/40 bg-emerald-950/20 space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">
                                {selectedExistingGuardian.person.fullName}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-900/60 border border-emerald-500/40 text-emerald-300 font-semibold">
                                Responsável Selecionado ✓
                              </span>
                              {selectedExistingGuardian.isStudent && (
                                <span className="px-2 py-0.5 rounded text-[10px] bg-blue-900/60 border border-blue-500/40 text-blue-300 font-semibold">
                                  🥋 Também é Aluno do Dojo
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-3 text-[11px] text-slate-400 mt-1 font-mono">
                              <span>CPF: {formatCPF(selectedExistingGuardian.person.cpf) || 'Não informado'}</span>
                              <span>·</span>
                              <span>Tel: {selectedExistingGuardian.person.phone || 'Sem telefone'}</span>
                              <span>·</span>
                              <span>E-mail: {selectedExistingGuardian.person.email || 'Sem e-mail'}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleClearSelectedGuardian}
                            className="px-2 py-1 rounded text-[11px] bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                          >
                            Trocar
                          </button>
                        </div>

                        {selectedExistingGuardian.dependents.length > 0 && (
                          <div className="pt-1 border-t border-slate-800/80 text-[11px] text-slate-300">
                            <span className="text-slate-400 font-medium">Já vinculado a outros dependentes: </span>
                            {selectedExistingGuardian.dependents.map((d, idx) => (
                              <span key={d.relationshipId} className="inline-block mr-2 font-semibold text-slate-200">
                                {d.studentPerson.fullName} ({d.relationshipLabel}){idx < selectedExistingGuardian.dependents.length - 1 ? ',' : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                          <input
                            type="text"
                            value={guardianSearch}
                            onChange={(e) => setGuardianSearch(e.target.value)}
                            placeholder="Buscar responsável já cadastrado por nome, CPF ou nome do filho..."
                            className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                          />
                        </div>

                        {isLoadingGuardians ? (
                          <div className="p-4 text-center text-slate-400 flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin text-red-500" />
                            <span>Carregando responsáveis cadastrados...</span>
                          </div>
                        ) : filteredGuardians.length === 0 ? (
                          <div className="p-4 rounded-lg border border-dashed border-slate-800 text-center text-slate-400 space-y-1">
                            <p>Nenhum responsável encontrado com esse termo.</p>
                            <button
                              type="button"
                              onClick={() => setGuardianMode('create_new')}
                              className="text-red-400 hover:underline font-semibold"
                            >
                              Clique aqui para cadastrar um novo responsável
                            </button>
                          </div>
                        ) : (
                          <div className="max-h-48 overflow-y-auto divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
                            {filteredGuardians.map((g) => (
                              <div
                                key={g.person.id}
                                className="p-2.5 flex items-center justify-between hover:bg-slate-800/60 transition-colors"
                              >
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-white">{g.person.fullName}</span>
                                    {g.isStudent && (
                                      <span className="px-1.5 py-0.2 rounded text-[9px] bg-blue-950 border border-blue-500/40 text-blue-300 font-semibold">
                                        Aluno
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                                    <span className="font-mono">{formatCPF(g.person.cpf) || 'Sem CPF'}</span>
                                    <span>·</span>
                                    <span>{g.person.phone || 'Sem telefone'}</span>
                                    {g.dependents.length > 0 && (
                                      <>
                                        <span>·</span>
                                        <span className="text-slate-300">
                                          {g.dependents.length} dependente(s): {g.dependents.map((d) => d.studentPerson.fullName).join(', ')}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleSelectExistingGuardian(g)}
                                  className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-red-600 text-slate-200 hover:text-white text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
                                >
                                  Selecionar
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* MODO 2: CADASTRAR NOVO RESPONSÁVEL */}
                {guardianMode === 'create_new' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-300 font-medium mb-1">Nome do Responsável *</label>
                        <input
                          type="text"
                          value={guardianName}
                          onChange={(e) => setGuardianName(e.target.value)}
                          placeholder="Nome do Pai, Mãe ou Tutor legal"
                          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-slate-300 font-medium">CPF do Responsável</label>
                          {isCheckingGuardianCpf && (
                            <span className="text-[10px] text-slate-400 flex items-center gap-1">
                              <Loader2 className="h-2.5 w-2.5 animate-spin text-red-400" />
                              Validando...
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          value={guardianCpf}
                          onChange={handleGuardianCpfChange}
                          placeholder="000.000.000-00"
                          maxLength={14}
                          className={`w-full rounded-lg border px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none ${
                            guardianCpfStatus && !guardianCpfStatus.isValid
                              ? 'border-red-500 bg-red-950/20'
                              : guardianCpfStatus && guardianCpfStatus.isValid
                              ? 'border-emerald-500 bg-emerald-950/20'
                              : 'border-slate-700 bg-slate-800 focus:border-red-500'
                          }`}
                        />
                        {guardianCpfStatus && (
                          <div className="mt-1">
                            {guardianCpfStatus.isValid ? (
                              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 shrink-0" />
                                CPF matematicamente válido
                                {guardianCpfStatus.isDuplicate && (
                                  <span className="text-blue-300 ml-1 font-sans">
                                    · {guardianCpfStatus.duplicateMsg}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-[10px] text-red-400 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                {guardianCpfStatus.error}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-300 font-medium mb-1">WhatsApp do Responsável</label>
                        <input
                          type="text"
                          value={guardianPhone}
                          onChange={(e) => setGuardianPhone(e.target.value)}
                          placeholder="(11) 98888-7777"
                          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-slate-300 font-medium mb-1">E-mail do Responsável</label>
                        <input
                          type="email"
                          value={guardianEmail}
                          onChange={(e) => setGuardianEmail(e.target.value)}
                          placeholder="responsavel@email.com"
                          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Tipo de Parentesco / Vínculo (comum aos dois modos) */}
                <div className="pt-1">
                  <label className="block text-slate-300 font-medium mb-1">Parentesco / Vínculo com o Aluno</label>
                  <select
                    value={relationshipType}
                    onChange={(e) => setRelationshipType(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  >
                    <option value="Pai">Pai</option>
                    <option value="Mãe">Mãe</option>
                    <option value="Tutor Legal">Tutor Legal (Documentado)</option>
                    <option value="Tio(a)">Tio(a)</option>
                    <option value="Avô(ó)">Avô(ó)</option>
                    <option value="Irmão/Irmã">Irmão/Irmã (Maior de Idade)</option>
                    <option value="Outro">Outro Representante</option>
                  </select>
                </div>
              </>
            )}
          </div>
        )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (studentCpfStatus !== null && !studentCpfStatus.isValid)}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-500 transition-colors shadow cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{isEditing ? 'Atualizando no Banco...' : 'Gravando no Banco...'}</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>{isEditing ? 'Salvar Alterações' : 'Salvar Aluno'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
