import React, { useState } from 'react';
import {
  X,
  UserCheck,
  GraduationCap,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Eye,
  Edit,
  UserPlus,
  Trash2,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { Person, Student, GuardianRelationship } from '../../types';
import { formatCPF, formatPhoneBR, formatDateBR } from '../../utils/cpfValidator';
import { studentService } from '../../services/studentService';
import { PortalAccountControlSection } from './PortalAccountControlSection';

interface GuardianDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  guardian: Person;
  isAlsoStudent: boolean;
  dependents: {
    student: Student;
    studentPerson: Person;
    relationship: GuardianRelationship;
  }[];
  allStudents: Student[];
  allPersons: Person[];
  onOpenEditGuardian: (person: Person) => void;
  onOpenStudentDetail: (student: Student) => void;
  onRelationshipChanged: () => void;
}

export const GuardianDetailModal: React.FC<GuardianDetailModalProps> = ({
  isOpen,
  onClose,
  tenantId,
  guardian,
  isAlsoStudent,
  dependents,
  allStudents,
  allPersons,
  onOpenEditGuardian,
  onOpenStudentDetail,
  onRelationshipChanged,
}) => {
  const [isLinkingStudent, setIsLinkingStudent] = useState(false);
  const [selectedStudentToLink, setSelectedStudentToLink] = useState('');
  const [newRelationshipLabel, setNewRelationshipLabel] = useState('Pai');
  const [isSavingLink, setIsSavingLink] = useState(false);
  const [unlinkingStudentId, setUnlinkingStudentId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  // Alunos da academia que ainda NÃO estão vinculados a este responsável
  const linkedStudentIds = new Set(dependents.map((d) => d.student.id));
  const availableStudentsToLink = allStudents.filter((s) => !linkedStudentIds.has(s.id));

  // Vincular novo aluno existente diretamente a este responsável
  const handleLinkStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentToLink) return;

    setErrorMsg('');
    setSuccessMsg('');
    setIsSavingLink(true);

    try {
      await studentService.linkStudentToGuardian(
        tenantId,
        selectedStudentToLink,
        guardian.id,
        newRelationshipLabel,
        {
          isLegalGuardian: true,
          isFinancialGuardian: true,
          isEmergencyContact: true,
          isPickupAuthorized: true,
        }
      );

      setSuccessMsg('Aluno vinculado com sucesso a este responsável!');
      setSelectedStudentToLink('');
      setIsLinkingStudent(false);
      onRelationshipChanged();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao vincular aluno.');
    } finally {
      setIsSavingLink(false);
    }
  };

  // Desvincular aluno deste responsável
  const handleUnlink = async (studentId: string, studentName: string) => {
    if (!confirm(`Deseja realmente remover o vínculo entre o aluno ${studentName} e o responsável ${guardian.fullName}? O cadastro do aluno continuará preservado.`)) {
      return;
    }

    setErrorMsg('');
    setSuccessMsg('');
    setUnlinkingStudentId(studentId);

    try {
      await studentService.unlinkStudentGuardian(tenantId, studentId, guardian.id);
      setSuccessMsg(`Vínculo com ${studentName} removido com sucesso.`);
      onRelationshipChanged();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao desvincular aluno.');
    } finally {
      setUnlinkingStudentId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl text-slate-100 max-h-[92vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header do Responsável */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-800 gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-600/20 text-red-400 border border-red-500/30 text-lg font-bold">
              {guardian.fullName ? guardian.fullName.substring(0, 2).toUpperCase() : 'RP'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">{guardian.fullName}</h3>
                {isAlsoStudent && (
                  <span className="px-2 py-0.5 rounded text-[10px] bg-blue-950/90 border border-blue-500/40 text-blue-300 font-semibold flex items-center gap-1">
                    <GraduationCap className="h-3 w-3" />
                    Também é Aluno do Dojo
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-400 mt-1 font-mono">
                <span>CPF: {formatCPF(guardian.cpf) || 'Não informado'}</span>
                <span>·</span>
                <span>Tel: {formatPhoneBR(guardian.phone)}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenEditGuardian(guardian)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors text-xs font-semibold cursor-pointer"
            >
              <Edit className="h-3.5 w-3.5 text-red-400" />
              <span>Editar Responsável</span>
            </button>
          </div>
        </div>

        {/* Feedback Messages */}
        {errorMsg && (
          <div className="mt-4 p-3 rounded-lg bg-red-950/60 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Ficha de Dados do Responsável */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/60">
            <span className="text-[11px] text-slate-400 block mb-1">Contato</span>
            <div className="space-y-1 font-mono">
              <div className="flex items-center gap-1.5 text-slate-200">
                <Phone className="h-3.5 w-3.5 text-slate-500" />
                <span>{formatPhoneBR(guardian.phone) || 'Sem telefone'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-200 truncate">
                <Mail className="h-3.5 w-3.5 text-slate-500" />
                <span className="truncate">{guardian.email || 'Sem e-mail'}</span>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/60">
            <span className="text-[11px] text-slate-400 block mb-1">Dados Pessoais</span>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-slate-200">
                <Calendar className="h-3.5 w-3.5 text-slate-500" />
                <span>Nasc: {formatDateBR(guardian.birthDate)}</span>
              </div>
              <div className="text-slate-400 capitalize">
                Gênero: {guardian.gender === 'male' ? 'Masculino' : guardian.gender === 'female' ? 'Feminino' : 'Outro'}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/60">
            <span className="text-[11px] text-slate-400 block mb-1">Endereço</span>
            <div className="text-slate-200 flex items-start gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
              <span className="truncate">
                {guardian.address?.street
                  ? `${guardian.address.street}, ${guardian.address.number || 'S/N'} - ${guardian.address.city}/${guardian.address.state}`
                  : 'Endereço não cadastrado'}
              </span>
            </div>
          </div>
        </div>

        {/* Gestão de Conta e Acesso ao Portal do Responsável */}
        <div className="mt-4">
          <PortalAccountControlSection
            tenantId={tenantId}
            targetType="guardian"
            person={guardian}
            onUpdated={onRelationshipChanged}
          />
        </div>

        {/* SEÇÃO PRINCIPAL: ALUNOS SOB SUA RESPONSABILIDADE */}
        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-red-500" />
              <h4 className="font-bold text-white text-sm">Alunos sob sua responsabilidade</h4>
              <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-red-950/80 text-red-400 border border-red-500/30">
                {dependents.length}
              </span>
            </div>

            <button
              onClick={() => setIsLinkingStudent(!isLinkingStudent)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-950/30 hover:bg-red-900/40 text-red-300 hover:text-white transition-colors text-xs font-semibold cursor-pointer"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>{isLinkingStudent ? 'Fechar Associação' : 'Vincular Outro Aluno'}</span>
            </button>
          </div>

          {/* Form Inline para Vincular Aluno Existente a este Responsável */}
          {isLinkingStudent && (
            <form onSubmit={handleLinkStudent} className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/80 space-y-3 text-xs">
              <span className="font-semibold text-slate-200 block">Vincular aluno cadastrado no Dojo a este responsável:</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Selecione o Aluno</label>
                  <select
                    required
                    value={selectedStudentToLink}
                    onChange={(e) => setSelectedStudentToLink(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  >
                    <option value="">Selecione um aluno da academia...</option>
                    {availableStudentsToLink.map((s) => {
                      const sp = allPersons.find((p) => p.id === s.personId);
                      return (
                        <option key={s.id} value={s.id}>
                          {sp?.fullName || 'Aluno'} (Mat: {s.registrationNumber})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Grau de Parentesco / Relação</label>
                  <select
                    value={newRelationshipLabel}
                    onChange={(e) => setNewRelationshipLabel(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  >
                    <option value="Pai">Pai</option>
                    <option value="Mãe">Mãe</option>
                    <option value="Tutor Legal">Tutor Legal</option>
                    <option value="Tio(a)">Tio(a)</option>
                    <option value="Avô(ó)">Avô(ó)</option>
                    <option value="Irmão/Irmã">Irmão/Irmã</option>
                    <option value="Outro">Outro</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsLinkingStudent(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingLink || !selectedStudentToLink}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors disabled:opacity-50"
                >
                  {isSavingLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  <span>Confirmar Vínculo</span>
                </button>
              </div>
            </form>
          )}

          {/* Lista de Alunos Dependentes */}
          {dependents.length === 0 ? (
            <div className="p-8 text-center text-slate-400 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 space-y-2">
              <p className="text-sm font-medium">Este responsável ainda não possui alunos vinculados.</p>
              <p className="text-xs text-slate-500">
                Você pode associar um aluno existente clicando no botão "Vincular Outro Aluno" acima ou selecionando este responsável durante a matrícula do aluno.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {dependents.map((dep) => {
                const currentGrad = dep.student.currentGraduations?.[0];
                return (
                  <div
                    key={dep.relationship.id}
                    className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/70 hover:border-slate-700 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{dep.studentPerson.fullName}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-300 font-semibold">
                          {dep.relationship.relationshipLabel}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            dep.student.status === 'active'
                              ? 'bg-emerald-950/60 text-emerald-400 border-emerald-500/30'
                              : dep.student.status === 'suspended'
                              ? 'bg-amber-950/60 text-amber-400 border-amber-500/30'
                              : 'bg-red-950/60 text-red-400 border-red-500/30'
                          }`}
                        >
                          {dep.student.status === 'active'
                            ? 'Ativo'
                            : dep.student.status === 'suspended'
                            ? 'Trancado'
                            : 'Inativo'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 font-mono">
                        <span>Matrícula: <strong className="text-slate-300">{dep.student.registrationNumber}</strong></span>
                        {currentGrad && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-1">
                              <span
                                className="h-2.5 w-2.5 rounded-full inline-block border border-slate-700"
                                style={{ backgroundColor: currentGrad.beltColorHex }}
                              />
                              <span className="text-slate-300">{currentGrad.martialArtName} - {currentGrad.beltName}</span>
                            </span>
                          </>
                        )}
                        <span>·</span>
                        <span>Ingresso: {formatDateBR(dep.student.enrollmentDate)}</span>
                      </div>

                      {/* Atribuições do Vínculo */}
                      <div className="flex flex-wrap gap-2 text-[10px] text-slate-400 pt-1">
                        {dep.relationship.isFinancialGuardian && (
                          <span className="px-1.5 py-0.2 rounded bg-emerald-950/40 border border-emerald-500/30 text-emerald-300">
                            ✓ Responsável Financeiro
                          </span>
                        )}
                        {dep.relationship.isLegalGuardian && (
                          <span className="px-1.5 py-0.2 rounded bg-blue-950/40 border border-blue-500/30 text-blue-300">
                            ✓ Responsável Legal
                          </span>
                        )}
                        {dep.relationship.isEmergencyContact && (
                          <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                            ✓ Contato Emergência
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        onClick={() => {
                          onClose();
                          onOpenStudentDetail(dep.student);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
                        title="Ver prontuário completo do aluno"
                      >
                        <Eye className="h-3.5 w-3.5 text-blue-400" />
                        <span>Ver Aluno</span>
                      </button>

                      <button
                        onClick={() => handleUnlink(dep.student.id, dep.studentPerson.fullName)}
                        disabled={unlinkingStudentId === dep.student.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-red-950/60 hover:border-red-500/40 text-slate-400 hover:text-red-300 transition-colors cursor-pointer disabled:opacity-50"
                        title="Desvincular este aluno do responsável"
                      >
                        {unlinkingStudentId === dep.student.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-red-400" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        )}
                        <span>Desvincular</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
