import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  FileText,
  Upload,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Lock,
  Loader2,
  FileCheck,
  FileSpreadsheet,
  Image as ImageIcon,
  Paperclip,
} from 'lucide-react';
import {
  Student,
  Person,
  User,
  StudentMedicalDocument,
  MedicalDocumentType,
} from '../../types';
import {
  medicalDocumentService,
  validateMedicalFile,
  formatFileSize,
  getDocumentTypeLabel,
  MAX_FILE_SIZE_BYTES,
} from '../../services/medicalDocumentService';
import { formatDateBR } from '../../utils/formatters';

interface MedicalDocumentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student | null;
  studentPerson: Person | null;
  currentUser: User | null;
  documentToEdit?: StudentMedicalDocument | null;
  onSuccess: (savedDoc: StudentMedicalDocument, isEdit: boolean) => void;
}

export function MedicalDocumentFormModal({
  isOpen,
  onClose,
  student,
  studentPerson,
  currentUser,
  documentToEdit,
  onSuccess,
}: MedicalDocumentFormModalProps) {
  const [documentType, setDocumentType] = useState<MedicalDocumentType>('medical_certificate');
  const [title, setTitle] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [hasExpiry, setHasExpiry] = useState(true);
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (documentToEdit) {
        setDocumentType(documentToEdit.documentType);
        setTitle(documentToEdit.title);
        setIssueDate(documentToEdit.issueDate || '');
        if (documentToEdit.expiryDate) {
          setHasExpiry(true);
          setExpiryDate(documentToEdit.expiryDate);
        } else {
          setHasExpiry(false);
          setExpiryDate('');
        }
        setNotes(documentToEdit.notes || '');
        setSelectedFile(null);
      } else {
        const todayStr = new Date().toISOString().split('T')[0];
        setDocumentType('medical_certificate');
        setTitle('Atestado Médico de Aptidão Física');
        setIssueDate(todayStr);
        setHasExpiry(true);
        // Sugere 1 ano à frente para atestado médico padrão
        const nextYear = new Date();
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        setExpiryDate(nextYear.toISOString().split('T')[0]);
        setNotes('');
        setSelectedFile(null);
      }
      setFileError(null);
      setErrorMsg(null);
    }
  }, [isOpen, documentToEdit]);

  if (!isOpen || !student) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    const validation = validateMedicalFile(file);
    if (!validation.isValid) {
      setFileError(validation.error || 'Arquivo inválido.');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    setFileError(null);
    const validation = validateMedicalFile(file);
    if (!validation.isValid) {
      setFileError(validation.error || 'Arquivo inválido.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Validações locais
    if (!title.trim()) {
      setErrorMsg('Informe o título ou descrição do documento.');
      return;
    }

    if (!issueDate) {
      setErrorMsg('A data de emissão do documento é obrigatória.');
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (issueDate > todayStr) {
      setErrorMsg('A data de emissão não pode ser posterior à data de hoje.');
      return;
    }

    if (hasExpiry && expiryDate && expiryDate < issueDate) {
      setErrorMsg('A data de validade não pode ser anterior à data de emissão.');
      return;
    }

    if (!documentToEdit && !selectedFile) {
      setErrorMsg('É obrigatório anexar o arquivo do documento (PDF, JPG ou PNG de até 10 MB).');
      return;
    }

    setIsSaving(true);
    try {
      if (documentToEdit) {
        const updated = await medicalDocumentService.updateDocument(
          documentToEdit.id,
          {
            title: title.trim(),
            documentType,
            issueDate,
            expiryDate: hasExpiry && expiryDate ? expiryDate : null,
            notes: notes.trim() || null,
          },
          selectedFile,
          {
            id: currentUser?.id || 'user-admin',
            name: currentUser?.name || 'Administrador',
          }
        );
        onSuccess(updated, true);
      } else {
        if (!selectedFile) {
          throw new Error('Selecione o arquivo do documento para upload.');
        }

        const created = await medicalDocumentService.createDocument(
          {
            tenantId: student.tenantId,
            studentId: student.id,
            documentType,
            title: title.trim(),
            issueDate,
            expiryDate: hasExpiry && expiryDate ? expiryDate : undefined,
            notes: notes.trim() || undefined,
          },
          selectedFile,
          {
            id: currentUser?.id || 'user-admin',
            name: currentUser?.name || 'Administrador',
          }
        );
        onSuccess(created, false);
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao salvar o documento de saúde.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-red-950/80 border border-red-500/30 text-red-400">
              <FileCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {documentToEdit ? 'Editar Documento de Saúde' : 'Cadastrar Documento de Saúde'}
              </h2>
              <p className="text-xs text-slate-400">
                Aluno: <span className="text-slate-200 font-medium">{studentPerson?.fullName || 'Aluno Selecionado'}</span>
                {student.registrationNumber && (
                  <span className="font-mono ml-1.5 text-slate-500">({student.registrationNumber})</span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-950/80 border border-red-500/40 rounded-lg flex items-start gap-2 text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Tipo de Documento */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Tipo de Documento <span className="text-red-400">*</span>
            </label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as MedicalDocumentType)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-red-500 transition"
            >
              <option value="medical_certificate">Atestado Médico (Aptidão Física / Esportiva)</option>
              <option value="medical_report">Laudo Médico (Especialista / Ortopedia / Cardiologia)</option>
              <option value="exam">Exame Médico (Eletrocardiograma, Sangue, Ergométrico)</option>
              <option value="declaration">Declaração Médica (Comparecimento / Recomendações)</option>
              <option value="authorization">Autorização Médica (Retorno aos treinos / Torneios)</option>
              <option value="other">Outro Documento de Saúde</option>
            </select>
          </div>

          {/* Título ou Descrição */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Título ou Descrição do Documento <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Atestado de Aptidão para Treinos de Judô 2026"
              maxLength={150}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-red-500 transition"
            />
          </div>

          {/* Grid de Datas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Data de Emissão (informada pelo usuário) */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Data de Emissão (Documento) <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={issueDate}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-red-500 transition"
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Data impressa no atestado/laudo.</p>
            </div>

            {/* Data de Validade */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-300 font-semibold">Data de Validade</label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-400 select-none">
                  <input
                    type="checkbox"
                    checked={!hasExpiry}
                    onChange={(e) => {
                      const withoutExpiry = e.target.checked;
                      setHasExpiry(!withoutExpiry);
                      if (withoutExpiry) setExpiryDate('');
                    }}
                    className="rounded border-slate-700 bg-slate-950 text-red-600 focus:ring-0"
                  />
                  <span>Sem validade</span>
                </label>
              </div>
              <input
                type="date"
                value={expiryDate}
                disabled={!hasExpiry}
                min={issueDate || undefined}
                onChange={(e) => setExpiryDate(e.target.value)}
                className={`w-full bg-slate-950 border rounded-lg px-3 py-2 text-white focus:outline-none transition ${
                  hasExpiry
                    ? 'border-slate-800 focus:border-red-500'
                    : 'border-slate-800/50 text-slate-600 cursor-not-allowed bg-slate-950/40'
                }`}
              />
              <p className="text-[10px] text-slate-500 mt-1">
                {hasExpiry
                  ? 'Geralmente 12 meses para atestados escolares/esportivos.'
                  : 'Documentos sem validade médica definida não serão marcados como vencidos.'}
              </p>
            </div>
          </div>

          {/* Data de Cadastro - Informativo automático */}
          <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Calendar className="h-3.5 w-3.5 text-slate-500" />
              <span>Data de Cadastro no Sistema:</span>
            </div>
            <span className="font-mono text-slate-300">
              {documentToEdit
                ? formatDateBR(documentToEdit.uploadedAt || documentToEdit.createdAt)
                : 'Gerada automaticamente hoje'}
            </span>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Observações Médicas ou Recomendações (Opcional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Liberado sem restrições; ou evitar quedas de grande impacto por 15 dias."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-red-500 transition resize-none"
            />
          </div>

          {/* Upload de Arquivo */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Arquivo Anexo (PDF, JPG ou PNG — Máx 10 MB){' '}
              {!documentToEdit && <span className="text-red-400">*</span>}
            </label>

            {documentToEdit && !selectedFile && (
              <div className="mb-2 p-3 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-emerald-400" />
                  <div>
                    <div className="font-medium text-slate-200 text-xs truncate max-w-[280px]">
                      {documentToEdit.originalFileName}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Tamanho: {formatFileSize(documentToEdit.fileSize)} • {documentToEdit.mimeType}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition"
                >
                  Substituir
                </button>
              </div>
            )}

            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition flex flex-col items-center justify-center gap-1.5 ${
                fileError
                  ? 'border-red-500/60 bg-red-950/20'
                  : selectedFile
                  ? 'border-emerald-500/60 bg-emerald-950/20'
                  : 'border-slate-800 hover:border-slate-700 bg-slate-950/40 hover:bg-slate-950/70'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={handleFileChange}
                className="hidden"
              />

              {selectedFile ? (
                <>
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                  <div className="font-semibold text-emerald-300">{selectedFile.name}</div>
                  <div className="text-[10px] text-slate-400">
                    {formatFileSize(selectedFile.size)} • Clique para trocar de arquivo
                  </div>
                </>
              ) : (
                <>
                  <Upload className="h-6 w-6 text-slate-400" />
                  <div className="font-semibold text-slate-300">
                    {documentToEdit ? 'Clique para substituir o arquivo atual' : 'Clique ou arraste o arquivo aqui'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Formatos aceitos: PDF, JPG, JPEG ou PNG (limite de 10 MB)
                  </div>
                </>
              )}
            </div>

            {fileError && (
              <p className="text-red-400 text-[11px] mt-1.5 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{fileError}</span>
              </p>
            )}
          </div>

          {/* Alerta de Privacidade LGPD */}
          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 flex items-start gap-2 text-slate-400 text-[10px]">
            <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span>
              <strong>Privacidade & LGPD:</strong> Os documentos médicos são criptografados no Supabase Storage em bucket privado e acessíveis somente via URLs assinadas temporárias para usuários com papéis autorizados.
            </span>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-800 text-slate-300 hover:bg-slate-800 transition font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center gap-1.5 transition disabled:opacity-50 shadow-lg shadow-red-950"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <FileCheck className="h-3.5 w-3.5" />
                  <span>{documentToEdit ? 'Salvar Alterações' : 'Salvar Documento'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
