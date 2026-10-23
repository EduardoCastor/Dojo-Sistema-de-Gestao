import { supabase, isSupabaseConfigured } from './supabase';
import {
  StudentMedicalDocument,
  CreateMedicalDocumentPayload,
  UpdateMedicalDocumentPayload,
  MedicalDocumentType,
  MedicalDocumentStatus,
} from '../types';
import { DataStore } from '../data/storage';

export function isValidUUID(id: string): boolean {
  if (!id) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
];
export const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
export const MEDICAL_STORAGE_BUCKET = 'medical-documents';

export interface DocumentStatusInfo {
  status: MedicalDocumentStatus;
  label: string;
  badgeColor: string;
  daysRemaining?: number;
  description: string;
}

/**
 * Validação rigorosa de arquivo (MIME type, extensão e tamanho máximo de 10 MB)
 */
export function validateMedicalFile(file: File): { isValid: boolean; error?: string } {
  if (!file) {
    return { isValid: false, error: 'Nenhum arquivo foi selecionado.' };
  }

  // 1. Validação de tamanho (máximo 10 MB)
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeInMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      isValid: false,
      error: `O arquivo selecionado possui ${sizeInMB} MB e ultrapassa o limite máximo permitido de 10 MB. Escolha um arquivo menor.`,
    };
  }

  if (file.size === 0) {
    return {
      isValid: false,
      error: 'O arquivo selecionado está vazio (0 bytes). Selecione um arquivo válido.',
    };
  }

  // 2. Validação de extensão
  const fileNameLower = file.name.toLowerCase();
  const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => fileNameLower.endsWith(ext));
  if (!hasValidExt) {
    return {
      isValid: false,
      error: 'Extensão de arquivo inválida. São aceitos somente arquivos em formato PDF (.pdf) ou imagem (.jpg, .jpeg, .png).',
    };
  }

  // 3. Validação de MIME type
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
    return {
      isValid: false,
      error: `Tipo de mídia (${file.type}) não autorizado. São aceitos somente documentos PDF ou imagens JPEG/PNG.`,
    };
  }

  return { isValid: true };
}

/**
 * Formata tamanho em bytes para representação legível (KB ou MB)
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Retorna rótulo em português para o tipo de documento
 */
export function getDocumentTypeLabel(type: MedicalDocumentType): string {
  switch (type) {
    case 'medical_report':
      return 'Laudo Médico';
    case 'medical_certificate':
      return 'Atestado Médico';
    case 'exam':
      return 'Exame Médico';
    case 'declaration':
      return 'Declaração Médica';
    case 'authorization':
      return 'Autorização Médica';
    case 'other':
      return 'Outro Documento de Saúde';
    default:
      return 'Documento de Saúde';
  }
}

/**
 * Retorna classes de estilo e cor da badge do tipo de documento
 */
export function getDocumentTypeBadge(type: MedicalDocumentType): { label: string; badgeClass: string } {
  const label = getDocumentTypeLabel(type);
  switch (type) {
    case 'medical_certificate':
      return { label, badgeClass: 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40' };
    case 'medical_report':
      return { label, badgeClass: 'bg-blue-950/80 text-blue-400 border-blue-500/40' };
    case 'exam':
      return { label, badgeClass: 'bg-purple-950/80 text-purple-400 border-purple-500/40' };
    case 'declaration':
      return { label, badgeClass: 'bg-indigo-950/80 text-indigo-400 border-indigo-500/40' };
    case 'authorization':
      return { label, badgeClass: 'bg-teal-950/80 text-teal-400 border-teal-500/40' };
    case 'other':
    default:
      return { label, badgeClass: 'bg-slate-800 text-slate-300 border-slate-700' };
  }
}

/**
 * Calcula a situação (status) do documento com base na data de validade.
 * Regras:
 * - Sem validade definida: 'no_expiry' (não considerado vencido)
 * - Expirado (data anterior à data de hoje): 'expired'
 * - Próximo do vencimento (<= 30 dias para expirar): 'expiring_soon'
 * - Válido (> 30 dias para expirar): 'valid'
 */
export function calculateDocumentStatus(expiryDate?: string | null, referenceDateStr?: string): DocumentStatusInfo {
  if (!expiryDate || expiryDate.trim() === '') {
    return {
      status: 'no_expiry',
      label: 'Sem validade definida',
      badgeColor: 'bg-slate-800 text-slate-300 border-slate-700',
      description: 'Documento permanente ou sem prazo de renovação especificado pelo médico.',
    };
  }

  const today = referenceDateStr ? new Date(referenceDateStr) : new Date();
  today.setHours(0, 0, 0, 0);

  const [year, month, day] = expiryDate.split('-').map(Number);
  const expiry = new Date(year, month - 1, day);
  expiry.setHours(0, 0, 0, 0);

  const diffTime = expiry.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      status: 'expired',
      label: 'Vencido',
      badgeColor: 'bg-red-950/80 text-red-400 border-red-500/40',
      daysRemaining: diffDays,
      description: `Documento expirado há ${Math.abs(diffDays)} dia(s). Requer renovação médica.`,
    };
  }

  if (diffDays <= 30) {
    return {
      status: 'expiring_soon',
      label: diffDays === 0 ? 'Vence hoje' : `Vence em ${diffDays}d`,
      badgeColor: 'bg-amber-950/80 text-amber-400 border-amber-500/40',
      daysRemaining: diffDays,
      description: `Vencimento próximo: restam ${diffDays} dia(s) de validade.`,
    };
  }

  return {
    status: 'valid',
    label: 'Válido',
    badgeColor: 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40',
    daysRemaining: diffDays,
    description: `Documento em vigor (${diffDays} dias restantes).`,
  };
}

/**
 * Sanitiza o nome do arquivo para compor o caminho do Supabase Storage
 */
function sanitizeFileName(fileName: string): string {
  return fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-zA-Z0-9._-]/g, '_') // substitui caracteres especiais por underline
    .toLowerCase();
}

/**
 * Converte um arquivo em Data URI para persistência no navegador (fallback offline / local)
 */
async function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Falha ao ler arquivo local.'));
    reader.readAsDataURL(file);
  });
}

export const medicalDocumentService = {
  /**
   * Consulta o histórico de documentos médicos do aluno, ordenados pela data de emissão
   * da mais recente para a mais antiga, utilizando a data de cadastro como critério secundário.
   */
  async fetchStudentDocuments(tenantId: string, studentId: string): Promise<StudentMedicalDocument[]> {
    if (!tenantId || !studentId) return [];

    if (!isSupabaseConfigured() || !supabase || !isValidUUID(tenantId)) {
      const localDocs = DataStore.getMedicalDocuments(tenantId, studentId);
      return this.sortDocuments(localDocs);
    }

    try {
      const { data, error } = await supabase
        .from('student_medical_documents')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('student_id', studentId)
        .order('issue_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error || !data || data.length === 0) {
        // Fallback para DataStore se a tabela ainda não tiver dados
        const localDocs = DataStore.getMedicalDocuments(tenantId, studentId);
        return this.sortDocuments(localDocs);
      }

      const mapped: StudentMedicalDocument[] = data.map((r: any) => ({
        id: r.id,
        tenantId: r.tenant_id,
        studentId: r.student_id,
        documentType: r.document_type as MedicalDocumentType,
        title: r.title,
        issueDate: r.issue_date,
        uploadedAt: r.uploaded_at || r.created_at,
        expiryDate: r.expiry_date || undefined,
        notes: r.notes || undefined,
        storagePath: r.storage_path,
        originalFileName: r.original_file_name,
        mimeType: r.mime_type,
        fileSize: Number(r.file_size),
        createdByUserId: r.created_by_user_id || undefined,
        createdByUserName: r.created_by_user_name || undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      return this.sortDocuments(mapped);
    } catch (err) {
      console.warn('Erro ao consultar student_medical_documents no Supabase, usando DataStore:', err);
      const localDocs = DataStore.getMedicalDocuments(tenantId, studentId);
      return this.sortDocuments(localDocs);
    }
  },

  /**
   * Ordena documentos: data de emissão decrescente, depois data de cadastro decrescente
   */
  sortDocuments(docs: StudentMedicalDocument[]): StudentMedicalDocument[] {
    return [...docs].sort((a, b) => {
      const dateA = new Date(a.issueDate).getTime();
      const dateB = new Date(b.issueDate).getTime();
      if (dateB !== dateA) {
        return dateB - dateA;
      }
      const createdA = new Date(a.uploadedAt || a.createdAt || '').getTime();
      const createdB = new Date(b.uploadedAt || b.createdAt || '').getTime();
      return createdB - createdA;
    });
  },

  /**
   * Gera uma URL assinada (Signed URL) de curta duração para visualização ou download seguro
   */
  async getSignedUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
    if (!storagePath) {
      throw new Error('Caminho de armazenamento do documento não informado.');
    }

    // Se o storagePath for uma data-URI local ou mock URL
    if (storagePath.startsWith('data:') || storagePath.startsWith('blob:') || storagePath.startsWith('#')) {
      return storagePath;
    }

    if (!isSupabaseConfigured() || !supabase) {
      // Procurar em DataStore se existe cache do arquivo
      const all = DataStore.getAllMedicalDocuments();
      const match = all.find((d) => d.storagePath === storagePath || d.id === storagePath);
      if (match?.fileUrl) {
        return match.fileUrl;
      }
      return storagePath;
    }

    try {
      const { data, error } = await supabase.storage
        .from(MEDICAL_STORAGE_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);

      if (error || !data?.signedUrl) {
        console.warn('Aviso ao gerar URL assinada do Supabase Storage:', error?.message);
        // Fallback para cache local se disponível
        const all = DataStore.getAllMedicalDocuments();
        const match = all.find((d) => d.storagePath === storagePath);
        return match?.fileUrl || storagePath;
      }

      return data.signedUrl;
    } catch (err: any) {
      console.warn('Erro na chamada createSignedUrl:', err?.message);
      return storagePath;
    }
  },

  /**
   * Cadastra um novo documento médico no Supabase Storage e na tabela student_medical_documents.
   */
  async createDocument(
    payload: CreateMedicalDocumentPayload,
    file: File,
    currentUser?: { id: string; name: string }
  ): Promise<StudentMedicalDocument> {
    // 1. Validações de campos obrigatórios
    const { tenantId, studentId, documentType, title, issueDate, expiryDate, notes } = payload;

    if (!tenantId) throw new Error('Identificador da academia (tenant) é obrigatório.');
    if (!studentId) throw new Error('Identificador do aluno é obrigatório.');
    if (!title || !title.trim()) throw new Error('O título ou descrição do documento é obrigatório.');
    if (!documentType) throw new Error('O tipo de documento de saúde é obrigatório.');
    if (!issueDate) throw new Error('A data de emissão do documento é obrigatória.');

    const todayStr = new Date().toISOString().split('T')[0];
    if (issueDate > todayStr) {
      throw new Error('A data de emissão do documento não pode ser uma data futura.');
    }

    if (expiryDate && expiryDate < issueDate) {
      throw new Error('A data de validade não pode ser anterior à data de emissão do documento.');
    }

    // 2. Validação rigorosa do arquivo
    const fileVal = validateMedicalFile(file);
    if (!fileVal.isValid) {
      throw new Error(fileVal.error);
    }

    // 3. Montar caminho único seguro no bucket privado: {tenant_id}/{student_id}/{filename}
    const cleanFileName = sanitizeFileName(file.name);
    const uniqueToken = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const storagePath = `${tenantId}/${studentId}/${uniqueToken}_${cleanFileName}`;

    const uploadedAt = new Date().toISOString();
    const docId = isValidUUID(tenantId) ? crypto.randomUUID() : `meddoc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    let localDataUri: string | undefined = undefined;
    try {
      localDataUri = await fileToDataUri(file);
    } catch {
      // Ignorar se leitura em memória falhar
    }

    // 4. Upload para o Supabase Storage se conectado
    if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
      try {
        const { error: uploadError } = await supabase.storage
          .from(MEDICAL_STORAGE_BUCKET)
          .upload(storagePath, file, {
            contentType: file.type || 'application/pdf',
            upsert: false,
          });

        if (uploadError) {
          console.warn('Erro ao enviar arquivo para o Supabase Storage:', uploadError.message);
          // Se o bucket não existir, o arquivo fica salvo no DataStore com data-URI para visualização imediata
        }
      } catch (storageErr) {
        console.warn('Falha na comunicação com Supabase Storage:', storageErr);
      }

      // Inserir registro na tabela do banco
      try {
        const { data: dbData, error: dbError } = await supabase
          .from('student_medical_documents')
          .insert({
            id: docId,
            tenant_id: tenantId,
            student_id: studentId,
            document_type: documentType,
            title: title.trim(),
            issue_date: issueDate,
            uploaded_at: uploadedAt,
            expiry_date: expiryDate || null,
            notes: notes?.trim() || null,
            storage_path: storagePath,
            original_file_name: file.name,
            mime_type: file.type || 'application/pdf',
            file_size: file.size,
            created_by_user_id: currentUser?.id && isValidUUID(currentUser.id) ? currentUser.id : null,
            created_by_user_name: currentUser?.name || 'Administrador',
          })
          .select()
          .single();

        if (dbError) {
          console.warn('Erro ao inserir registro em student_medical_documents:', dbError.message);
        }
      } catch (insertErr) {
        console.warn('Falha ao persistir student_medical_documents no banco:', insertErr);
      }
    }

    // 5. Criar entidade StudentMedicalDocument
    const newDoc: StudentMedicalDocument = {
      id: docId,
      tenantId,
      studentId,
      documentType,
      title: title.trim(),
      issueDate,
      uploadedAt,
      expiryDate: expiryDate || undefined,
      notes: notes?.trim() || undefined,
      storagePath,
      originalFileName: file.name,
      mimeType: file.type || 'application/pdf',
      fileSize: file.size,
      createdByUserId: currentUser?.id,
      createdByUserName: currentUser?.name || 'Administrador',
      fileUrl: localDataUri,
      createdAt: uploadedAt,
      updatedAt: uploadedAt,
    };

    // 6. Atualizar DataStore local
    DataStore.saveMedicalDocument(newDoc);

    // 7. Sincronizar com HealthRecord do aluno para manter compatibilidade
    this.syncWithHealthRecord(tenantId, studentId, newDoc);

    // 8. Log de Auditoria
    DataStore.logAudit(
      tenantId,
      currentUser?.id || 'user-admin',
      currentUser?.name || 'Administrador',
      'Cadastro de Documento Médico',
      'StudentMedicalDocument',
      docId,
      `Upload do documento "${newDoc.title}" (${getDocumentTypeLabel(newDoc.documentType)}), emissão ${newDoc.issueDate}, arquivo ${newDoc.originalFileName} (${formatFileSize(newDoc.fileSize)}).`
    );

    return newDoc;
  },

  /**
   * Atualiza os metadados de um documento existente e opcionalmente substitui o arquivo.
   */
  async updateDocument(
    id: string,
    payload: UpdateMedicalDocumentPayload,
    newFile?: File | null,
    currentUser?: { id: string; name: string }
  ): Promise<StudentMedicalDocument> {
    const all = DataStore.getAllMedicalDocuments();
    const existing = all.find((d) => d.id === id);

    if (!existing) {
      throw new Error(`Documento médico com ID ${id} não foi encontrado.`);
    }

    const title = payload.title !== undefined ? payload.title.trim() : existing.title;
    const documentType = payload.documentType || existing.documentType;
    const issueDate = payload.issueDate || existing.issueDate;
    const expiryDate = payload.expiryDate !== undefined ? (payload.expiryDate || undefined) : existing.expiryDate;
    const notes = payload.notes !== undefined ? (payload.notes?.trim() || undefined) : existing.notes;

    if (!title) throw new Error('O título do documento não pode ficar vazio.');
    if (!issueDate) throw new Error('A data de emissão é obrigatória.');

    const todayStr = new Date().toISOString().split('T')[0];
    if (issueDate > todayStr) {
      throw new Error('A data de emissão do documento não pode ser uma data futura.');
    }

    if (expiryDate && expiryDate < issueDate) {
      throw new Error('A data de validade não pode ser anterior à data de emissão do documento.');
    }

    let storagePath = existing.storagePath;
    let originalFileName = existing.originalFileName;
    let mimeType = existing.mimeType;
    let fileSize = existing.fileSize;
    let fileUrl = existing.fileUrl;

    // Se um novo arquivo foi enviado para substituição
    if (newFile) {
      const fileVal = validateMedicalFile(newFile);
      if (!fileVal.isValid) {
        throw new Error(fileVal.error);
      }

      const cleanFileName = sanitizeFileName(newFile.name);
      const uniqueToken = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const newStoragePath = `${existing.tenantId}/${existing.studentId}/${uniqueToken}_${cleanFileName}`;

      // Upload do novo arquivo no Supabase Storage
      if (isSupabaseConfigured() && supabase && isValidUUID(existing.tenantId)) {
        try {
          await supabase.storage
            .from(MEDICAL_STORAGE_BUCKET)
            .upload(newStoragePath, newFile, {
              contentType: newFile.type || 'application/pdf',
              upsert: false,
            });

          // Remover o arquivo antigo do Storage para não deixar órfãos
          if (existing.storagePath && existing.storagePath !== newStoragePath) {
            await supabase.storage.from(MEDICAL_STORAGE_BUCKET).remove([existing.storagePath]);
          }
        } catch (uploadErr) {
          console.warn('Aviso ao substituir arquivo no Supabase Storage:', uploadErr);
        }
      }

      try {
        fileUrl = await fileToDataUri(newFile);
      } catch {
        // Ignorar
      }

      storagePath = newStoragePath;
      originalFileName = newFile.name;
      mimeType = newFile.type || 'application/pdf';
      fileSize = newFile.size;
    }

    const nowISO = new Date().toISOString();

    // Atualizar no banco de dados Supabase
    if (isSupabaseConfigured() && supabase && isValidUUID(existing.tenantId)) {
      try {
        await supabase
          .from('student_medical_documents')
          .update({
            title,
            document_type: documentType,
            issue_date: issueDate,
            expiry_date: expiryDate || null,
            notes: notes || null,
            storage_path: storagePath,
            original_file_name: originalFileName,
            mime_type: mimeType,
            file_size: fileSize,
            updated_at: nowISO,
          })
          .eq('id', id)
          .eq('tenant_id', existing.tenantId);
      } catch (dbErr) {
        console.warn('Erro ao atualizar student_medical_documents no Supabase:', dbErr);
      }
    }

    const updatedDoc: StudentMedicalDocument = {
      ...existing,
      title,
      documentType,
      issueDate,
      expiryDate,
      notes,
      storagePath,
      originalFileName,
      mimeType,
      fileSize,
      fileUrl,
      updatedAt: nowISO,
    };

    DataStore.saveMedicalDocument(updatedDoc);
    this.syncWithHealthRecord(existing.tenantId, existing.studentId, updatedDoc);

    DataStore.logAudit(
      existing.tenantId,
      currentUser?.id || 'user-admin',
      currentUser?.name || 'Administrador',
      'Edição de Documento Médico',
      'StudentMedicalDocument',
      id,
      `Atualização do documento "${updatedDoc.title}" (${getDocumentTypeLabel(updatedDoc.documentType)}).${newFile ? ' Arquivo foi substituído.' : ''}`
    );

    return updatedDoc;
  },

  /**
   * Exclui o documento médico com remoção segura do arquivo no Supabase Storage
   * e exclusão do registro no banco de dados.
   */
  async deleteDocument(
    id: string,
    tenantId: string,
    studentId: string,
    currentUser?: { id: string; name: string }
  ): Promise<void> {
    const all = DataStore.getAllMedicalDocuments();
    const existing = all.find((d) => d.id === id);

    if (existing) {
      // 1. Remover arquivo físico do Supabase Storage
      if (isSupabaseConfigured() && supabase && existing.storagePath) {
        try {
          await supabase.storage
            .from(MEDICAL_STORAGE_BUCKET)
            .remove([existing.storagePath]);
        } catch (storageErr) {
          console.warn('Aviso ao remover arquivo do Supabase Storage:', storageErr);
        }
      }

      // 2. Remover do banco Supabase
      if (isSupabaseConfigured() && supabase && isValidUUID(tenantId)) {
        try {
          await supabase
            .from('student_medical_documents')
            .delete()
            .eq('id', id)
            .eq('tenant_id', tenantId);
        } catch (dbErr) {
          console.warn('Aviso ao excluir student_medical_documents do banco:', dbErr);
        }
      }

      // 3. Remover do DataStore
      DataStore.deleteMedicalDocument(id);

      // 4. Atualizar HealthRecord
      const healthList = DataStore.getHealthRecords(tenantId);
      const studentHealth = healthList.find((h) => h.studentId === studentId);
      if (studentHealth && studentHealth.medicalDocs) {
        studentHealth.medicalDocs = studentHealth.medicalDocs.filter((d) => d.id !== id);
        DataStore.saveHealthRecords(healthList);
      }

      // 5. Auditoria
      DataStore.logAudit(
        tenantId,
        currentUser?.id || 'user-admin',
        currentUser?.name || 'Administrador',
        'Exclusão de Documento Médico',
        'StudentMedicalDocument',
        id,
        `Exclusão definitiva do documento "${existing.title}" (${existing.originalFileName}).`
      );
    }
  },

  /**
   * Sincroniza documento com o array medicalDocs de HealthRecord para manter
   * retrocompatibilidade com o portal do responsável e telas legadas.
   */
  syncWithHealthRecord(tenantId: string, studentId: string, doc: StudentMedicalDocument): void {
    const healthList = DataStore.getHealthRecords(tenantId);
    let studentHealth = healthList.find((h) => h.studentId === studentId);

    if (!studentHealth) {
      studentHealth = {
        id: `health-${studentId}`,
        tenantId,
        studentId,
        conditions: [],
        allergies: [],
        physicalRestrictions: [],
        injuryHistory: '',
        voluntaryMedications: '',
        emergencyContactNotes: '',
        medicalDocs: [],
      };
      healthList.push(studentHealth);
    }

    if (!studentHealth.medicalDocs) {
      studentHealth.medicalDocs = [];
    }

    const legacyIndex = studentHealth.medicalDocs.findIndex((d) => d.id === doc.id);
    const legacyItem = {
      id: doc.id,
      title: doc.title,
      docType: doc.documentType as any,
      uploadDate: doc.issueDate,
      expiresAt: doc.expiryDate,
      fileUrl: doc.fileUrl || doc.storagePath,
      storagePath: doc.storagePath,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
    };

    if (legacyIndex >= 0) {
      studentHealth.medicalDocs[legacyIndex] = legacyItem;
    } else {
      studentHealth.medicalDocs.unshift(legacyItem);
    }

    // Se for atestado médico com validade, atualizar medicalCertExpiryDate se for mais recente
    if (doc.documentType === 'medical_certificate' && doc.expiryDate) {
      if (!studentHealth.medicalCertExpiryDate || doc.expiryDate > studentHealth.medicalCertExpiryDate) {
        studentHealth.medicalCertExpiryDate = doc.expiryDate;
      }
    }

    DataStore.saveHealthRecords(healthList);
  },
};
