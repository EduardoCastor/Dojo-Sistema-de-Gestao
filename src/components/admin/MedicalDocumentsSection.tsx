import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Plus,
  Eye,
  Download,
  Edit2,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Clock,
  Search,
  Filter,
  FileCheck,
  ShieldCheck,
  Loader2,
  FileSpreadsheet,
  Paperclip,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import {
  Student,
  Person,
  User,
  StudentMedicalDocument,
  MedicalDocumentType,
  MedicalDocumentStatus,
} from '../../types';
import {
  medicalDocumentService,
  getDocumentTypeBadge,
  calculateDocumentStatus,
  formatFileSize,
} from '../../services/medicalDocumentService';
import { formatDateBR } from '../../utils/formatters';
import { MedicalDocumentFormModal } from './MedicalDocumentFormModal';
import { MedicalDocumentPreviewModal } from './MedicalDocumentPreviewModal';

interface MedicalDocumentsSectionProps {
  student: Student;
  studentPerson: Person | null;
  currentUser: User | null;
  onDocumentChange?: () => void;
}

export function MedicalDocumentsSection({
  student,
  studentPerson,
  currentUser,
  onDocumentChange,
}: MedicalDocumentsSectionProps) {
  const [documents, setDocuments] = useState<StudentMedicalDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filtros
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modais
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [documentToEdit, setDocumentToEdit] = useState<StudentMedicalDocument | null>(null);

  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [documentToPreview, setDocumentToPreview] = useState<StudentMedicalDocument | null>(null);

  const [documentToDelete, setDocumentToDelete] = useState<StudentMedicalDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Carrega documentos do aluno selecionado
  const loadDocuments = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await medicalDocumentService.fetchStudentDocuments(student.tenantId, student.id);
      setDocuments(data);
    } catch (err: any) {
      console.error('Erro ao carregar documentos médicos:', err);
      setErrorMsg('Falha ao carregar documentos de saúde do aluno.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [student.id, student.tenantId]);

  // Estatísticas de Documentos
  const stats = useMemo(() => {
    let validCount = 0;
    let expiringCount = 0;
    let expiredCount = 0;
    let noExpiryCount = 0;

    documents.forEach((d) => {
      const st = calculateDocumentStatus(d.expiryDate);
      if (st.status === 'valid') validCount++;
      else if (st.status === 'expiring_soon') expiringCount++;
      else if (st.status === 'expired') expiredCount++;
      else if (st.status === 'no_expiry') noExpiryCount++;
    });

    return {
      total: documents.length,
      valid: validCount,
      expiringSoon: expiringCount,
      expired: expiredCount,
      noExpiry: noExpiryCount,
    };
  }, [documents]);

  // Lista filtrada
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      // Busca textual
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchTitle = doc.title.toLowerCase().includes(query);
        const matchFile = doc.originalFileName.toLowerCase().includes(query);
        const matchNotes = doc.notes?.toLowerCase().includes(query);
        if (!matchTitle && !matchFile && !matchNotes) return false;
      }

      // Filtro de tipo
      if (typeFilter !== 'all' && doc.documentType !== typeFilter) {
        return false;
      }

      // Filtro de situação
      if (statusFilter !== 'all') {
        const docStatus = calculateDocumentStatus(doc.expiryDate).status;
        if (docStatus !== statusFilter) return false;
      }

      return true;
    });
  }, [documents, searchQuery, typeFilter, statusFilter]);

  // Handler para download
  const handleDownloadDoc = async (doc: StudentMedicalDocument) => {
    try {
      const url = await medicalDocumentService.getSignedUrl(doc.fileUrl || doc.storagePath, 300);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = doc.originalFileName || `${doc.title}.pdf`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
    } catch (err: any) {
      setErrorMsg('Não foi possível obter o link assinado para download.');
    }
  };

  // Handler para exclusão confirmada
  const handleConfirmDelete = async () => {
    if (!documentToDelete) return;
    setIsDeleting(true);
    setErrorMsg(null);
    try {
      await medicalDocumentService.deleteDocument(
        documentToDelete.id,
        student.tenantId,
        student.id,
        {
          id: currentUser?.id || 'user-admin',
          name: currentUser?.name || 'Administrador',
        }
      );
      setSuccessMsg(`Documento "${documentToDelete.title}" excluído com sucesso do banco e do storage.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      setDocumentToDelete(null);
      await loadDocuments();
      onDocumentChange?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao excluir documento de saúde.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toast de Sucesso */}
      {successMsg && (
        <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Toast de Erro */}
      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-950/80 border border-red-500/40 text-red-300 text-xs flex items-center gap-2 animate-in fade-in">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Header com Ação Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-red-500" />
            <span>Documentos Médicos & Atestados de Saúde</span>
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Armazenamento seguro em bucket privado com URLs assinadas e controle de validade (PDF, JPG e JPEG).
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setDocumentToEdit(null);
            setIsFormModalOpen(true);
          }}
          className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition shadow-lg shadow-red-950 shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Novo Documento</span>
        </button>
      </div>

      {/* Indicadores / Cards de Estatística */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/60">
          <span className="text-[10px] text-slate-400 font-medium block">Total de Documentos</span>
          <span className="text-xl font-bold text-white font-mono mt-0.5 block">{stats.total}</span>
        </div>

        <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-950/10">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-emerald-400 font-medium">Válidos</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <span className="text-xl font-bold text-emerald-300 font-mono mt-0.5 block">{stats.valid}</span>
        </div>

        <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-950/10">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-amber-400 font-medium">Vence em ≤ 30d</span>
            <Clock className="h-3.5 w-3.5 text-amber-400" />
          </div>
          <span className="text-xl font-bold text-amber-300 font-mono mt-0.5 block">{stats.expiringSoon}</span>
        </div>

        <div className="p-3 rounded-xl border border-red-500/20 bg-red-950/10">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-red-400 font-medium">Vencidos</span>
            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          </div>
          <span className="text-xl font-bold text-red-300 font-mono mt-0.5 block">{stats.expired}</span>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between text-xs">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por título ou arquivo..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-white placeholder-slate-500 text-xs focus:outline-none focus:border-red-500"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 text-xs focus:outline-none focus:border-red-500"
          >
            <option value="all">Todos os Tipos</option>
            <option value="medical_certificate">Atestado Médico</option>
            <option value="medical_report">Laudo Médico</option>
            <option value="exam">Exame Médico</option>
            <option value="declaration">Declaração Médica</option>
            <option value="authorization">Autorização Médica</option>
            <option value="other">Outro</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 text-xs focus:outline-none focus:border-red-500"
          >
            <option value="all">Todas as Situações</option>
            <option value="valid">Válidos</option>
            <option value="expiring_soon">Próximos do Vencimento</option>
            <option value="expired">Vencidos</option>
            <option value="no_expiry">Sem validade definida</option>
          </select>
        </div>
      </div>

      {/* Tabela de Histórico de Documentos */}
      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <Loader2 className="h-6 w-6 animate-spin text-red-500 mx-auto" />
            <p className="text-xs">Carregando documentos médicos do aluno...</p>
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-3">
            <FileText className="h-10 w-10 text-slate-600 mx-auto" />
            <div>
              <p className="text-xs font-semibold text-slate-300">Nenhum documento médico encontrado.</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {searchQuery || typeFilter !== 'all' || statusFilter !== 'all'
                  ? 'Nenhum documento atende aos filtros selecionados.'
                  : 'Cadastre o primeiro laudo, atestado ou exame do aluno.'}
              </p>
            </div>
            {!(searchQuery || typeFilter !== 'all' || statusFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setDocumentToEdit(null);
                  setIsFormModalOpen(true);
                }}
                className="px-3 py-1.5 rounded-lg bg-red-600/90 hover:bg-red-500 text-white text-xs font-medium inline-flex items-center gap-1.5 transition"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Adicionar Documento</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 text-[11px] uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-3.5">Documento</th>
                  <th className="py-3 px-3">Tipo</th>
                  <th className="py-3 px-3">Emissão</th>
                  <th className="py-3 px-3">Cadastro</th>
                  <th className="py-3 px-3">Validade</th>
                  <th className="py-3 px-3">Situação</th>
                  <th className="py-3 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredDocuments.map((doc) => {
                  const typeBadge = getDocumentTypeBadge(doc.documentType);
                  const statusInfo = calculateDocumentStatus(doc.expiryDate);
                  const isPdf =
                    doc.mimeType?.includes('pdf') || doc.originalFileName?.toLowerCase().endsWith('.pdf');

                  return (
                    <tr key={doc.id} className="hover:bg-slate-900/50 transition group">
                      {/* Título & Arquivo */}
                      <td className="py-3 px-3.5">
                        <div className="flex items-start gap-2.5">
                          <div className="p-1.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300 mt-0.5 shrink-0">
                            {isPdf ? (
                              <FileText className="h-4 w-4 text-red-400" />
                            ) : (
                              <Paperclip className="h-4 w-4 text-blue-400" />
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-white group-hover:text-red-400 transition">
                              {doc.title}
                            </div>
                            <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono text-slate-400 truncate max-w-[200px]" title={doc.originalFileName}>
                                {doc.originalFileName}
                              </span>
                              <span>•</span>
                              <span>{formatFileSize(doc.fileSize)}</span>
                            </div>
                            {doc.notes && (
                              <div className="text-[10px] text-slate-500 italic mt-0.5 line-clamp-1 max-w-xs">
                                Obs: {doc.notes}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Tipo */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${typeBadge.badgeClass}`}>
                          {typeBadge.label}
                        </span>
                      </td>

                      {/* Data de Emissão */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="font-mono text-slate-200">{formatDateBR(doc.issueDate)}</span>
                      </td>

                      {/* Data de Cadastro */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="font-mono text-slate-400 text-[11px]">
                          {formatDateBR(doc.uploadedAt || doc.createdAt)}
                        </span>
                      </td>

                      {/* Data de Validade */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {doc.expiryDate ? (
                          <span className="font-mono text-slate-200">{formatDateBR(doc.expiryDate)}</span>
                        ) : (
                          <span className="text-slate-500 italic text-[11px]">Sem validade</span>
                        )}
                      </td>

                      {/* Situação */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${statusInfo.badgeColor}`}
                          title={statusInfo.description}
                        >
                          {statusInfo.status === 'valid' && <CheckCircle2 className="h-3 w-3" />}
                          {statusInfo.status === 'expiring_soon' && <Clock className="h-3 w-3" />}
                          {statusInfo.status === 'expired' && <AlertTriangle className="h-3 w-3" />}
                          <span>{statusInfo.label}</span>
                        </span>
                      </td>

                      {/* Ações */}
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {/* Visualizar */}
                          <button
                            type="button"
                            onClick={() => {
                              setDocumentToPreview(doc);
                              setIsPreviewModalOpen(true);
                            }}
                            title="Visualizar documento e detalhes"
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          {/* Download */}
                          <button
                            type="button"
                            onClick={() => handleDownloadDoc(doc)}
                            title="Baixar arquivo autorizado"
                            className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-md transition"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>

                          {/* Editar */}
                          <button
                            type="button"
                            onClick={() => {
                              setDocumentToEdit(doc);
                              setIsFormModalOpen(true);
                            }}
                            title="Editar metadados ou substituir arquivo"
                            className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded-md transition"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>

                          {/* Excluir */}
                          <button
                            type="button"
                            onClick={() => setDocumentToDelete(doc)}
                            title="Excluir documento"
                            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-md transition"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Formulário (Cadastro / Edição) */}
      <MedicalDocumentFormModal
        isOpen={isFormModalOpen}
        onClose={() => {
          setIsFormModalOpen(false);
          setDocumentToEdit(null);
        }}
        student={student}
        studentPerson={studentPerson}
        currentUser={currentUser}
        documentToEdit={documentToEdit}
        onSuccess={(savedDoc, isEdit) => {
          loadDocuments();
          onDocumentChange?.();
          setSuccessMsg(
            isEdit
              ? `Documento "${savedDoc.title}" atualizado com sucesso!`
              : `Documento "${savedDoc.title}" cadastrado e enviado com sucesso!`
          );
          setTimeout(() => setSuccessMsg(null), 4000);
        }}
      />

      {/* Modal de Pré-visualização & Detalhes */}
      <MedicalDocumentPreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => {
          setIsPreviewModalOpen(false);
          setDocumentToPreview(null);
        }}
        document={documentToPreview}
        student={student}
        studentPerson={studentPerson}
      />

      {/* Modal de Confirmação Explícita de Exclusão */}
      {documentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-red-950/80 border border-red-500/30 text-red-400 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Confirmar Exclusão de Documento</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Tem certeza que deseja remover o documento{' '}
                  <strong className="text-white">"{documentToDelete.title}"</strong> (
                  {documentToDelete.originalFileName})?
                </p>
                <div className="mt-2 p-2 rounded bg-red-950/30 border border-red-500/20 text-[11px] text-red-400">
                  Esta ação é irreversível: o arquivo será removido do Storage privado e o registro excluído do banco de dados.
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDocumentToDelete(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-800 text-slate-300 hover:bg-slate-800 transition text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-xs flex items-center gap-1.5 transition disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Excluindo...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Confirmar Exclusão</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
