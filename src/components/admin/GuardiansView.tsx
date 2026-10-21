import React, { useState, useMemo } from 'react';
import {
  Users,
  Search,
  Plus,
  Edit,
  Eye,
  GraduationCap,
  Phone,
  Mail,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  UserCheck,
  ArrowUpDown,
  Filter,
  RotateCcw,
} from 'lucide-react';
import { Person, Student, GuardianRelationship } from '../../types';
import { formatCPF, formatPhoneBR, cleanCPF } from '../../utils/cpfValidator';
import { GuardianFormModal } from './GuardianFormModal';
import { GuardianDetailModal } from './GuardianDetailModal';

interface GuardiansViewProps {
  tenantId: string;
  guardians: GuardianRelationship[];
  persons: Person[];
  students: Student[];
  isLoading?: boolean;
  error?: string | null;
  onRefreshData?: () => void;
  onOpenStudentDetail?: (student: Student) => void;
  onUpdatePerson?: (person: Person) => void;
  onResetData?: () => void;
}

export const GuardiansView: React.FC<GuardiansViewProps> = ({
  tenantId,
  guardians,
  persons,
  students,
  isLoading = false,
  error = null,
  onRefreshData,
  onOpenStudentDetail,
  onUpdatePerson,
  onResetData,
}) => {
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'with_students' | 'without_students' | 'also_student'>('all');
  const [sortOrder, setSortOrder] = useState<'name_asc' | 'name_desc' | 'dependents_desc'>('name_asc');

  // Modais
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingGuardian, setEditingGuardian] = useState<Person | null>(null);
  const [selectedGuardianForDetail, setSelectedGuardianForDetail] = useState<{
    guardian: Person;
    isAlsoStudent: boolean;
    dependents: {
      student: Student;
      studentPerson: Person;
      relationship: GuardianRelationship;
    }[];
  } | null>(null);

  // Helper para buscar a pessoa de um aluno
  const getStudentPerson = (student: Student): Person => {
    const found = persons.find((p) => p.id === student.personId);
    if (found) return found;
    return {
      id: student.personId || `person-${student.id}`,
      tenantId: student.tenantId,
      fullName: `Aluno ${student.registrationNumber || student.id.substring(0, 8)}`,
      cpf: '',
      birthDate: '2010-01-01',
      gender: 'other',
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
      createdAt: student.enrollmentDate || new Date().toISOString(),
    };
  };

  // Agrupamento consolidado de todos os Responsáveis da academia
  // Considera todas as pessoas com relacionamentos em guardian_relationships
  // e também pessoas cadastradas como responsáveis mesmo antes de vincular alunos
  const guardiansGrouped = useMemo(() => {
    const map = new Map<
      string,
      {
        person: Person;
        isStudent: boolean;
        studentRecord?: Student;
        dependents: {
          student: Student;
          studentPerson: Person;
          relationship: GuardianRelationship;
        }[];
      }
    >();

    // 1. Identificar quem tem vínculo
    guardians.forEach((rel) => {
      const gPerson = persons.find((p) => p.id === rel.guardianPersonId);
      if (!gPerson) return;

      const student = students.find((s) => s.id === rel.studentId);
      const studentPerson = student ? getStudentPerson(student) : null;
      if (!student || !studentPerson) return;

      if (!map.has(gPerson.id)) {
        const matchingStudent = students.find((s) => s.personId === gPerson.id);
        map.set(gPerson.id, {
          person: gPerson,
          isStudent: Boolean(matchingStudent),
          studentRecord: matchingStudent,
          dependents: [],
        });
      }

      map.get(gPerson.id)!.dependents.push({
        student,
        studentPerson,
        relationship: rel,
      });
    });

    // 2. Incluir também pessoas que foram cadastradas no tenant que não são alunos (ex: cadastros avulsos de responsáveis)
    const studentPersonIds = new Set(students.map((s) => s.personId));
    persons.forEach((p) => {
      // Se não for aluno e ainda não estiver no mapa, mas estiver cadastrada no tenant
      if (!map.has(p.id) && !studentPersonIds.has(p.id)) {
        map.set(p.id, {
          person: p,
          isStudent: false,
          dependents: [],
        });
      }
    });

    return Array.from(map.values());
  }, [guardians, persons, students]);

  // Filtragem e Busca avançada
  const filteredAndSortedGuardians = useMemo(() => {
    let result = [...guardiansGrouped];

    // Filtro por texto (nome, CPF, telefone, email, dependente)
    const term = searchTerm.toLowerCase().trim();
    if (term) {
      const cleanTerm = cleanCPF(term);
      result = result.filter((item) => {
        const matchesName = item.person.fullName.toLowerCase().includes(term);
        const matchesCpf =
          (item.person.cpf && cleanTerm && cleanCPF(item.person.cpf).includes(cleanTerm)) ||
          (item.person.cpf ? item.person.cpf.toLowerCase().includes(term) : false);
        const matchesPhone = item.person.phone ? item.person.phone.includes(term) : false;
        const matchesEmail = item.person.email ? item.person.email.toLowerCase().includes(term) : false;
        const matchesDependent = item.dependents.some(
          (d) =>
            d.studentPerson.fullName.toLowerCase().includes(term) ||
            d.student.registrationNumber.toLowerCase().includes(term)
        );
        return matchesName || matchesCpf || matchesPhone || matchesEmail || matchesDependent;
      });
    }

    // Filtro por categoria
    if (statusFilter === 'with_students') {
      result = result.filter((item) => item.dependents.length > 0);
    } else if (statusFilter === 'without_students') {
      result = result.filter((item) => item.dependents.length === 0);
    } else if (statusFilter === 'also_student') {
      result = result.filter((item) => item.isStudent);
    }

    // Ordenação
    result.sort((a, b) => {
      if (sortOrder === 'name_asc') {
        return a.person.fullName.localeCompare(b.person.fullName);
      }
      if (sortOrder === 'name_desc') {
        return b.person.fullName.localeCompare(a.person.fullName);
      }
      if (sortOrder === 'dependents_desc') {
        return b.dependents.length - a.dependents.length;
      }
      return 0;
    });

    return result;
  }, [guardiansGrouped, searchTerm, statusFilter, sortOrder]);

  // Estatísticas Rápidas
  const totalGuardiansCount = guardiansGrouped.length;
  const guardiansWithStudentsCount = guardiansGrouped.filter((g) => g.dependents.length > 0).length;
  const alsoStudentsCount = guardiansGrouped.filter((g) => g.isStudent).length;
  const totalDependentsCount = guardians.length;

  return (
    <div className="space-y-6">
      {/* Header com Título e Ação de Cadastrar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-white tracking-tight">Central de Responsáveis</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-red-950/80 text-red-400 border border-red-500/30">
              {totalGuardiansCount}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Gerenciamento completo de pessoas responsáveis, contatos de emergência e vínculos com os alunos matriculados.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onResetData && (
            <button
              onClick={() => setIsConfirmingReset(true)}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white font-semibold text-xs shadow-sm transition-all cursor-pointer"
              title="Limpar todos os registros e reiniciar do zero com dados consistentes e válidos"
            >
              <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
              <span>Começar do Zero</span>
            </button>
          )}

          <button
            onClick={() => {
              setEditingGuardian(null);
              setIsFormModalOpen(true);
            }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold text-xs shadow-lg shadow-red-900/30 transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Cadastrar Novo Responsável</span>
          </button>
        </div>
      </div>

      {/* Cards de Métricas e Indicadores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 font-medium block">Total de Responsáveis</span>
            <span className="text-xl font-bold font-mono text-white mt-0.5 block">{totalGuardiansCount}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-800 text-slate-300">
            <Users className="h-5 w-5" />
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 font-medium block">Com Alunos Vinculados</span>
            <span className="text-xl font-bold font-mono text-emerald-400 mt-0.5 block">{guardiansWithStudentsCount}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 font-medium block">Vínculos Ativos</span>
            <span className="text-xl font-bold font-mono text-red-400 mt-0.5 block">{totalDependentsCount}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-500/30 text-red-400">
            <UserCheck className="h-5 w-5" />
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 font-medium block">Também São Alunos</span>
            <span className="text-xl font-bold font-mono text-blue-400 mt-0.5 block">{alsoStudentsCount}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-blue-950/60 border border-blue-500/30 text-blue-400">
            <GraduationCap className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Barra de Pesquisa, Filtro e Ordenação */}
      <div className="flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Pesquisar responsável por nome, CPF (com/sem máscara), telefone ou nome do aluno..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900/80 pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          {/* Filtro por Categoria */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl border border-slate-800 bg-slate-900/60 text-xs">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                statusFilter === 'all' ? 'bg-red-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setStatusFilter('with_students')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                statusFilter === 'with_students' ? 'bg-red-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Com Alunos
            </button>
            <button
              onClick={() => setStatusFilter('without_students')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                statusFilter === 'without_students' ? 'bg-red-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sem Vínculos
            </button>
            <button
              onClick={() => setStatusFilter('also_student')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                statusFilter === 'also_student' ? 'bg-red-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Também Alunos
            </button>
          </div>

          {/* Ordenação */}
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as any)}
            className="rounded-xl border border-slate-800 bg-slate-900/80 px-2.5 py-2 text-xs text-slate-300 focus:border-red-500 focus:outline-none cursor-pointer"
          >
            <option value="name_asc">Nome (A - Z)</option>
            <option value="name_desc">Nome (Z - A)</option>
            <option value="dependents_desc">Mais Alunos Vinculados</option>
          </select>
        </div>
      </div>

      {/* Tratamento Explícito de Erros de Consulta */}
      {error && (
        <div className="p-4 rounded-xl border border-red-500/40 bg-red-950/60 text-red-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
            <span>Erro ao consultar responsáveis no Supabase: {error}</span>
          </div>
          {onRefreshData && (
            <button
              onClick={onRefreshData}
              className="px-2.5 py-1 rounded-lg bg-red-800 hover:bg-red-700 text-white text-[11px] font-semibold transition-colors cursor-pointer"
            >
              Tentar Novamente
            </button>
          )}
        </div>
      )}

      {/* Estado de Carregamento */}
      {isLoading ? (
        <div className="p-16 text-center text-slate-400 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-red-500" />
          <span className="text-xs">Carregando lista de responsáveis do Supabase...</span>
        </div>
      ) : filteredAndSortedGuardians.length === 0 ? (
        /* Estado Vazio */
        <div className="p-12 text-center text-slate-400 rounded-xl border border-dashed border-slate-800 bg-slate-900/30 space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800/80 mx-auto text-slate-500">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Nenhum responsável encontrado</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {searchTerm
                ? 'Nenhum responsável cadastrado corresponde aos termos informados na pesquisa.'
                : 'Não há responsáveis cadastrados nesta academia ainda. Cadastre o primeiro responsável ou vincule durante a matrícula do aluno.'}
            </p>
          </div>
          <button
            onClick={() => {
              setSearchTerm('');
              setEditingGuardian(null);
              setIsFormModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-500 transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Cadastrar Novo Responsável</span>
          </button>
        </div>
      ) : (
        /* Tabela Responsiva de Responsáveis */
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Responsável</th>
                  <th className="py-3 px-4">CPF</th>
                  <th className="py-3 px-4">Contato</th>
                  <th className="py-3 px-4">Alunos Vinculados</th>
                  <th className="py-3 px-4">Papel no Dojo</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredAndSortedGuardians.map((item) => (
                  <tr key={item.person.id} className="hover:bg-slate-800/40 transition-colors">
                    {/* Nome + Avatar */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-red-400 font-bold text-xs border border-slate-700/80 shrink-0">
                          {item.person.fullName ? item.person.fullName.substring(0, 2).toUpperCase() : 'RP'}
                        </div>
                        <div>
                          <div className="font-bold text-white text-xs flex items-center gap-2">
                            <span>{item.person.fullName}</span>
                            {item.person.socialName && (
                              <span className="text-[10px] text-slate-400 font-normal">
                                ({item.person.socialName})
                              </span>
                            )}
                          </div>
                          {item.person.email && (
                            <span className="text-[11px] text-slate-400 block truncate max-w-[180px]">
                              {item.person.email}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* CPF */}
                    <td className="py-3 px-4 font-mono">
                      {item.person.cpf ? (
                        <span className="text-slate-200">{formatCPF(item.person.cpf)}</span>
                      ) : (
                        <span className="text-slate-500 italic">Não informado</span>
                      )}
                    </td>

                    {/* Telefone / WhatsApp */}
                    <td className="py-3 px-4">
                      {item.person.phone ? (
                        <a
                          href={`https://wa.me/55${item.person.phone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-slate-300 hover:text-emerald-400 flex items-center gap-1.5 transition-colors"
                          title="Abrir no WhatsApp"
                        >
                          <Phone className="h-3 w-3 text-slate-500" />
                          <span>{formatPhoneBR(item.person.phone)}</span>
                        </a>
                      ) : (
                        <span className="text-slate-500 italic">Sem telefone</span>
                      )}
                    </td>

                    {/* Quantidade de Alunos Vinculados */}
                    <td className="py-3 px-4">
                      {item.dependents.length > 0 ? (
                        <button
                          onClick={() =>
                            setSelectedGuardianForDetail({
                              guardian: item.person,
                              isAlsoStudent: item.isStudent,
                              dependents: item.dependents,
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-950/60 border border-red-500/40 text-red-300 hover:bg-red-900/60 hover:text-white transition-colors cursor-pointer text-[11px] font-semibold"
                          title="Clique para ver os alunos deste responsável"
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                          <span>{item.dependents.length} {item.dependents.length === 1 ? 'Aluno' : 'Alunos'}</span>
                        </button>
                      ) : (
                        <span className="text-slate-500 text-[11px] italic">Nenhum aluno</span>
                      )}
                    </td>

                    {/* Papel no Dojo */}
                    <td className="py-3 px-4">
                      {item.isStudent ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-950/80 border border-blue-500/40 text-blue-300">
                          <GraduationCap className="h-3 w-3" />
                          <span>Também é Aluno</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Responsável</span>
                      )}
                    </td>

                    {/* Ações */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() =>
                            setSelectedGuardianForDetail({
                              guardian: item.person,
                              isAlsoStudent: item.isStudent,
                              dependents: item.dependents,
                            })
                          }
                          className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
                          title="Visualizar detalhes e alunos vinculados"
                        >
                          <Eye className="h-3.5 w-3.5 text-blue-400" />
                        </button>
                        <button
                          onClick={() => {
                            setEditingGuardian(item.person);
                            setIsFormModalOpen(true);
                          }}
                          className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
                          title="Editar dados cadastrais do responsável"
                        >
                          <Edit className="h-3.5 w-3.5 text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Cadastro / Edição do Responsável */}
      <GuardianFormModal
        isOpen={isFormModalOpen}
        onClose={() => {
          setIsFormModalOpen(false);
          setEditingGuardian(null);
        }}
        tenantId={tenantId}
        guardianToEdit={editingGuardian}
        onSuccess={(savedPerson) => {
          onUpdatePerson?.(savedPerson);
          onRefreshData?.();
        }}
      />

      {/* Modal de Detalhes do Responsável com Seção de Alunos sob sua responsabilidade */}
      {selectedGuardianForDetail && (
        <GuardianDetailModal
          isOpen={true}
          onClose={() => setSelectedGuardianForDetail(null)}
          tenantId={tenantId}
          guardian={selectedGuardianForDetail.guardian}
          isAlsoStudent={selectedGuardianForDetail.isAlsoStudent}
          dependents={selectedGuardianForDetail.dependents}
          allStudents={students}
          allPersons={persons}
          onOpenEditGuardian={(p) => {
            setSelectedGuardianForDetail(null);
            setEditingGuardian(p);
            setIsFormModalOpen(true);
          }}
          onOpenStudentDetail={(s) => {
            setSelectedGuardianForDetail(null);
            onOpenStudentDetail?.(s);
          }}
          onRelationshipChanged={() => {
            onRefreshData?.();
            setSelectedGuardianForDetail(null);
          }}
        />
      )}

      {/* MODAL DE CONFIRMAÇÃO: REINICIAR BASE DO ZERO */}
      {isConfirmingReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-red-500/40 bg-slate-900 p-6 shadow-2xl text-slate-200">
            <div className="flex items-center gap-3 text-red-400 mb-3">
              <RotateCcw className="h-6 w-6 shrink-0" />
              <h3 className="text-base font-bold text-white">Reiniciar Base do Zero</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              Esta ação irá limpar os registros atuais de alunos, responsáveis e vínculos da academia, restaurando uma base limpa e estruturada com dados íntegros e CPFs válidos.
            </p>
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/30 text-[11px] text-red-200 mb-5">
              ⚠️ Vínculos corrompidos ou registros duplicados serão completamente redefinidos para o padrão seguro.
            </div>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsConfirmingReset(false)}
                disabled={isResetting}
                className="px-3.5 py-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isResetting}
                onClick={async () => {
                  if (onResetData) {
                    setIsResetting(true);
                    try {
                      await onResetData();
                    } finally {
                      setIsResetting(false);
                      setIsConfirmingReset(false);
                    }
                  }
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 active:bg-red-700 text-xs text-white font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                {isResetting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Reiniciando...</span>
                  </>
                ) : (
                  <span>Sim, Reiniciar do Zero</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
