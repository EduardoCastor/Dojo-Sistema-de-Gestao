import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  ExternalLink,
  FileText,
  Calendar,
  Clock,
  User,
  ShieldCheck,
  FileCheck,
  Loader2,
  AlertCircle,
  FileSpreadsheet,
  Info,
} from 'lucide-react';
import { StudentMedicalDocument, Student, Person } from '../../types';
import {
  medicalDocumentService,
  getDocumentTypeBadge,
  calculateDocumentStatus,
  formatFileSize,
} from '../../services/medicalDocumentService';
import { formatDateBR } from '../../utils/formatters';

interface MedicalDocumentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: StudentMedicalDocument | null;
  student: Student | null;
  studentPerson: Person | null;
}

export function MedicalDocumentPreviewModal({
  isOpen,
  onClose,
  document: doc,
  student,
  studentPerson,
}: MedicalDocumentPreviewModalProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && doc) {
      let isMounted = true;
      setIsLoadingUrl(true);
      setErrorMsg(null);

      medicalDocumentService
        .getSignedUrl(doc.fileUrl || doc.storagePath, 600)
        .then((url) => {
          if (isMounted) {
            setSignedUrl(url);
            setIsLoadingUrl(false);
          }
        })
        .catch((err) => {
          if (isMounted) {
            console.warn('Erro ao obter signedUrl:', err);
            setErrorMsg('Não foi possível gerar a URL de visualização segura.');
            setIsLoadingUrl(false);
          }
        });

      return () => {
        isMounted = false;
      };
    } else {
      setSignedUrl(null);
    }
  }, [isOpen, doc]);

  if (!isOpen || !doc) return null;

  const statusInfo = calculateDocumentStatus(doc.expiryDate);
  const typeBadge = getDocumentTypeBadge(doc.documentType);
  const isPdf = doc.mimeType?.includes('pdf') || doc.originalFileName?.toLowerCase().endsWith('.pdf');
  const isImage =
    doc.mimeType?.includes('image') ||
    doc.originalFileName?.toLowerCase().endsWith('.jpg') ||
    doc.originalFileName?.toLowerCase().endsWith('.jpeg') ||
    doc.originalFileName?.toLowerCase().endsWith('.png');

  const handleDownload = () => {
    if (!signedUrl) return;

    // Se for data-URI ou URL assinada
    const link = window.document.createElement('a');
    link.href = signedUrl;
    link.download = doc.originalFileName || `${doc.title}.pdf`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[94vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-950/80 border border-red-500/30 text-red-400">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-white truncate max-w-md">{doc.title}</h2>
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${typeBadge.badgeClass}`}>
                  {typeBadge.label}
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${statusInfo.badgeColor}`}>
                  {statusInfo.label}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Aluno: <span className="text-slate-200 font-medium">{studentPerson?.fullName || 'Aluno'}</span>
                {student?.registrationNumber && (
                  <span className="font-mono text-slate-500 ml-1">({student.registrationNumber})</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleDownload}
              title="Baixar arquivo autorizado"
              className="p-2 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 transition flex items-center gap-1 text-xs font-medium"
            >
              <Download className="h-4 w-4 text-emerald-400" />
              <span className="hidden sm:inline">Baixar</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content Area: Split View on Desktop (Preview + Metadata) */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          {/* File Preview Container (7 cols) */}
          <div className="lg:col-span-8 bg-slate-950 p-4 flex flex-col items-center justify-center border-b lg:border-b-0 lg:border-r border-slate-800 overflow-y-auto min-h-[300px]">
            {isLoadingUrl ? (
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin text-red-500" />
                <span className="text-xs">Gerando URL assinada com acesso restrito...</span>
              </div>
            ) : errorMsg ? (
              <div className="text-center p-6 text-slate-400 space-y-2">
                <AlertCircle className="h-8 w-8 text-amber-500 mx-auto" />
                <p className="text-xs text-slate-300">{errorMsg}</p>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium"
                >
                  Tentar Download Direto
                </button>
              </div>
            ) : signedUrl ? (
              isPdf ? (
                <div className="w-full h-full min-h-[460px] flex flex-col">
                  <iframe
                    src={`${signedUrl}#toolbar=0`}
                    title={doc.title}
                    className="w-full flex-1 rounded-lg border border-slate-800 bg-slate-900"
                  />
                  <div className="mt-2 text-center">
                    <a
                      href={signedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Abrir documento em aba cheia
                    </a>
                  </div>
                </div>
              ) : isImage ? (
                <div className="w-full h-full flex flex-col items-center justify-center">
                  <img
                    src={signedUrl}
                    alt={doc.title}
                    className="max-h-[460px] max-w-full object-contain rounded-lg border border-slate-800 shadow-md"
                  />
                </div>
              ) : (
                <div className="text-center space-y-3 p-8">
                  <FileText className="h-12 w-12 text-slate-500 mx-auto" />
                  <p className="text-xs text-slate-300">
                    Pré-visualização direta não disponível para este formato.
                  </p>
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold inline-flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Baixar Arquivo ({formatFileSize(doc.fileSize)})
                  </button>
                </div>
              )
            ) : null}
          </div>

          {/* Metadata Sidebar (4 cols) */}
          <div className="lg:col-span-4 bg-slate-900/90 p-5 overflow-y-auto space-y-4 text-xs">
            <div>
              <h3 className="text-slate-400 font-semibold uppercase tracking-wider text-[10px] mb-2 flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-slate-400" />
                <span>Metadados do Registro</span>
              </h3>

              <div className="space-y-3 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-500 text-[10px] block">Título do Documento:</span>
                  <span className="text-slate-200 font-medium">{doc.title}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-500 text-[10px] block">Data de Emissão:</span>
                    <span className="text-white font-mono">{formatDateBR(doc.issueDate)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] block">Data de Cadastro:</span>
                    <span className="text-white font-mono">
                      {formatDateBR(doc.uploadedAt || doc.createdAt)}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 text-[10px] block">Data de Validade:</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    {doc.expiryDate ? (
                      <span className="text-white font-mono">{formatDateBR(doc.expiryDate)}</span>
                    ) : (
                      <span className="text-slate-400 italic">Sem validade definida</span>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 text-[10px] block">Situação de Validade:</span>
                  <div className="mt-1">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${statusInfo.badgeColor}`}>
                      {statusInfo.label}
                    </span>
                    <p className="text-[10px] text-slate-400 mt-1">{statusInfo.description}</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-slate-400 font-semibold uppercase tracking-wider text-[10px] mb-2 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span>Armazenamento & Segurança</span>
              </h3>

              <div className="space-y-2 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Arquivo Original:</span>
                  <span className="text-slate-300 font-mono text-[10px] truncate max-w-[170px]" title={doc.originalFileName}>
                    {doc.originalFileName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tamanho:</span>
                  <span className="text-slate-300 font-mono">{formatFileSize(doc.fileSize)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tipo MIME:</span>
                  <span className="text-slate-300 font-mono text-[10px]">{doc.mimeType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Registrado por:</span>
                  <span className="text-slate-300">{doc.createdByUserName || 'Administrador'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Armazenamento:</span>
                  <span className="text-emerald-400 font-medium">Supabase Private Storage</span>
                </div>
              </div>
            </div>

            {doc.notes && (
              <div>
                <h3 className="text-slate-400 font-semibold uppercase tracking-wider text-[10px] mb-1.5">
                  Observações & Recomendações
                </h3>
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-slate-300 text-[11px] leading-relaxed whitespace-pre-wrap">
                  {doc.notes}
                </div>
              </div>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={handleDownload}
                className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center justify-center gap-2 transition shadow-lg shadow-red-950 text-xs"
              >
                <Download className="h-4 w-4" />
                <span>Baixar Arquivo Autorizado</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
