-- ============================================================================
-- Migration 21: Módulo de Saúde & Atestados — Gestão de Documentos Médicos
-- TatameHub: Armazenamento Seguro, Metadados e Isolamento Multi-Tenant
-- ============================================================================

-- 1. CRIAÇÃO DA TABELA DEDICADA DE DOCUMENTOS MÉDICOS
CREATE TABLE IF NOT EXISTS public.student_medical_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  document_type text NOT NULL CHECK (
    document_type IN (
      'medical_report',        -- Laudo Médico
      'medical_certificate',   -- Atestado Médico
      'exam',                  -- Exame Médico
      'declaration',           -- Declaração Médica
      'authorization',         -- Autorização Médica
      'other'                  -- Outro Documento de Saúde
    )
  ),
  title text NOT NULL,
  issue_date date NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  expiry_date date,
  notes text,
  storage_path text NOT NULL,
  original_file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_user_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_student_medical_docs_student 
    FOREIGN KEY (tenant_id, student_id)
    REFERENCES public.students(tenant_id, id) ON DELETE CASCADE
);

-- 2. ÍNDICES DE BUSCA E PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_student_med_docs_tenant_student_issue
  ON public.student_medical_documents (tenant_id, student_id, issue_date DESC);

CREATE INDEX IF NOT EXISTS idx_student_med_docs_tenant_expiry
  ON public.student_medical_documents (tenant_id, expiry_date);

-- 3. HABILITAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.student_medical_documents ENABLE ROW LEVEL SECURITY;

-- 3.1 POLÍTICA DE LEITURA (SELECT)
-- Apenas usuários autenticados com papéis autorizados na respectiva academia
DROP POLICY IF EXISTS "student_medical_docs_select" ON public.student_medical_documents;
CREATE POLICY "student_medical_docs_select"
ON public.student_medical_documents
FOR SELECT
TO authenticated
USING (
  public.has_tenant_role(
    tenant_id,
    'owner',
    'branch_manager',
    'secretary',
    'instructor',
    'financial'
  )
  OR public.is_guardian_of_student(student_id)
);

-- 3.2 POLÍTICA DE INSERÇÃO (INSERT)
-- Apenas proprietários, gerentes, secretários e instrutores da academia
DROP POLICY IF EXISTS "student_medical_docs_insert" ON public.student_medical_documents;
CREATE POLICY "student_medical_docs_insert"
ON public.student_medical_documents
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_tenant_role(
    tenant_id,
    'owner',
    'branch_manager',
    'secretary',
    'instructor'
  )
);

-- 3.3 POLÍTICA DE ATUALIZAÇÃO (UPDATE)
DROP POLICY IF EXISTS "student_medical_docs_update" ON public.student_medical_documents;
CREATE POLICY "student_medical_docs_update"
ON public.student_medical_documents
FOR UPDATE
TO authenticated
USING (
  public.has_tenant_role(
    tenant_id,
    'owner',
    'branch_manager',
    'secretary',
    'instructor'
  )
)
WITH CHECK (
  public.has_tenant_role(
    tenant_id,
    'owner',
    'branch_manager',
    'secretary',
    'instructor'
  )
);

-- 3.4 POLÍTICA DE EXCLUSÃO (DELETE)
-- Apenas proprietários e gerentes de filial para proteção de dados sensíveis
DROP POLICY IF EXISTS "student_medical_docs_delete" ON public.student_medical_documents;
CREATE POLICY "student_medical_docs_delete"
ON public.student_medical_documents
FOR DELETE
TO authenticated
USING (
  public.has_tenant_role(
    tenant_id,
    'owner',
    'branch_manager'
  )
);

-- 4. CONFIGURAÇÃO DO BUCKET PRIVADO NO SUPABASE STORAGE
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medical-documents',
  'medical-documents',
  false,
  10485760, -- Limite estrito de 10 MB por arquivo
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png'];

-- 4.1 Regras de Storage para o bucket medical-documents
DROP POLICY IF EXISTS "medical_docs_storage_select" ON storage.objects;
CREATE POLICY "medical_docs_storage_select" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'medical-documents'
  AND (
    public.has_tenant_role((storage.foldername(name))[1]::uuid, 'owner', 'branch_manager', 'secretary', 'instructor', 'financial')
    OR public.is_guardian_of_student((storage.foldername(name))[2]::uuid)
  )
);

DROP POLICY IF EXISTS "medical_docs_storage_insert" ON storage.objects;
CREATE POLICY "medical_docs_storage_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'medical-documents'
  AND (
    public.has_tenant_role((storage.foldername(name))[1]::uuid, 'owner', 'branch_manager', 'secretary', 'instructor')
  )
);

DROP POLICY IF EXISTS "medical_docs_storage_delete" ON storage.objects;
CREATE POLICY "medical_docs_storage_delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'medical-documents'
  AND (
    public.has_tenant_role((storage.foldername(name))[1]::uuid, 'owner', 'branch_manager')
  )
);
