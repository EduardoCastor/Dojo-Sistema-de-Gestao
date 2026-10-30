export type SaaSPlanId = 'trial' | 'basic' | 'advanced' | 'enterprise';

export type UserRole = 
  | 'superadmin' 
  | 'owner' 
  | 'branch_manager' 
  | 'secretary' 
  | 'financial' 
  | 'instructor' 
  | 'student' 
  | 'guardian';

export interface SaaSPlan {
  id: SaaSPlanId;
  name: string;
  tagline: string;
  pricePerMonth: number;
  trialDays: number;
  maxStudents: number;
  maxBranches: number;
  maxUsers: number;
  maxStorageGb: number;
  features: {
    digitalLibrary: boolean;
    beltExams: boolean;
    competitions: boolean;
    advancedReports: boolean;
    multiBranch: boolean;
    automatedNotifications: boolean;
  };
}

export type TenantStatus = 'trial' | 'active' | 'suspended' | 'canceled';

export interface Tenant {
  id: string;
  tradeName: string; // Nome Fantasia
  legalName: string; // Razão Social
  cnpjOrCpf: string;
  cnpj?: string;
  adminName: string;
  email: string;
  phone: string;
  whatsapp: string;
  website?: string;
  logoUrl?: string;
  address: {
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
    zip?: string;
  };
  planId: SaaSPlanId;
  status: TenantStatus;
  suspendedAt?: string;
  suspendedReason?: string;
  updatedAt?: string;
  trialStartedAt: string;
  trialExpiresAt: string;
  createdAt: string;
  retentionDays: number;
  settings: {
    defaultDueDay: number;
    penaltyRate: number; // Multa %
    dailyInterestRate: number; // Juros diários %
    familyDiscount2ndMember: number; // % desconto 2º membro
    multiArtDiscount: number; // % desconto 2ª modalidade
    customBrandColor?: string;
    allowMultipleCheckinsPerDay?: boolean;
    requireMedicalClearance?: boolean;
    autoBlockDelinquentAfterDays?: number;
    pixKey?: string;
    pixBeneficiaryName?: string;
    defaultLateFeePercent?: number;
  };
}

export interface Branch {
  id: string;
  tenantId: string;
  name: string;
  isHeadquarter: boolean;
  phone: string;
  email: string;
  address: string;
  managerName: string;
  active: boolean;
}

export type PortalAccessStatus = 'none' | 'invited' | 'active' | 'blocked' | 'revoked';

export type SecondaryRoleEntry =
  | UserRole
  | {
      role: UserRole;
      studentId?: string;
      guardianPersonId?: string;
    };

export interface User {
  id: string;
  tenantId: string; // 'platform' for superadmin
  branchId?: string;
  name: string;
  email: string;
  role: UserRole;
  secondaryRoles?: SecondaryRoleEntry[]; // Ex: ['guardian', 'student'] quando o responsável também é aluno
  avatarUrl?: string;
  phone?: string;
  active: boolean;
  studentId?: string; // If role is 'student' or also a student
  guardianPersonId?: string; // If role is 'guardian' or also a guardian
  invitedByUserId?: string;
  createdAt?: string;
}

export interface TenantUserInvitation {
  id: string;
  tenantId: string;
  branchId?: string;
  email: string;
  fullName: string;
  role: Exclude<UserRole, 'superadmin'>;
  phone?: string;
  status: 'invited' | 'accepted' | 'revoked' | 'expired';
  inviteCode?: string;
  targetStudentId?: string;
  targetGuardianPersonId?: string;
  invitedByUserId: string;
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
  lastEmailSentAt?: string;
  lastEmailStatus?: 'sent' | 'failed' | 'missing_config' | 'pending';
  lastEmailError?: string;
  acceptedAt?: string;
  acceptedByUserId?: string;
}

export interface LegalAcceptanceRecord {
  id: string;
  userId: string;
  tenantId?: string;
  email?: string;
  termsVersion: string;
  privacyVersion: string;
  acceptanceContext:
    | 'academy_registration'
    | 'user_signup'
    | 'account_signup'
    | 'portal_activation'
    | 'terms_update'
    | 'test_verification';
  acceptedTerms: boolean;
  acknowledgedPrivacy: boolean;
  specificConsents?: Record<string, boolean>;
  acceptedAt: string;
}

export interface Person {
  id: string;
  tenantId: string;
  fullName: string;
  socialName?: string;
  cpf: string;
  birthDate: string; // YYYY-MM-DD
  gender: 'male' | 'female' | 'other';
  phone: string;
  email: string;
  photoUrl?: string;
  userId?: string;
  portalAccessStatus?: PortalAccessStatus;
  address: {
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  };
  createdAt: string;
}

export interface GuardianRelationship {
  id: string;
  tenantId: string;
  studentId: string;
  guardianPersonId: string;
  relationshipLabel: string; // Pai, Mãe, Tio, Avô, etc.
  isLegalGuardian: boolean;
  isFinancialGuardian: boolean;
  isEmergencyContact: boolean;
  isPickupAuthorized: boolean;
  notes?: string;
}

export interface PhysicalAssessment {
  id: string;
  tenantId: string;
  studentId: string;
  date: string; // YYYY-MM-DD
  weightKg: number;
  heightCm: number;
  bmi: number;
  evaluatorName: string;
  ageYearsAtMeasurement?: number;
  ageMonthsAtMeasurement?: number;
  classification?: string;
  referenceStandard?: string;
  recordedByUserId?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type MedicalDocumentType =
  | 'medical_report'        // Laudo Médico
  | 'medical_certificate'   // Atestado Médico
  | 'exam'                  // Exame Médico
  | 'declaration'           // Declaração Médica
  | 'authorization'         // Autorização Médica
  | 'other';                // Outro Documento de Saúde

export type MedicalDocumentStatus = 'valid' | 'expiring_soon' | 'expired' | 'no_expiry';

export interface StudentMedicalDocument {
  id: string;
  tenantId: string;
  studentId: string;
  documentType: MedicalDocumentType;
  title: string;
  issueDate: string; // YYYY-MM-DD (informada pelo usuário)
  uploadedAt: string; // ISO timestamp (gerada automaticamente)
  expiryDate?: string; // YYYY-MM-DD (quando aplicável)
  notes?: string;
  storagePath: string; // Caminho no bucket privado (tenant_id/student_id/filename)
  originalFileName: string;
  mimeType: string;
  fileSize: number; // bytes
  createdByUserId?: string;
  createdByUserName?: string;
  fileUrl?: string; // URL assinada de curta duração ou data-URI local
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateMedicalDocumentPayload {
  tenantId: string;
  studentId: string;
  documentType: MedicalDocumentType;
  title: string;
  issueDate: string; // YYYY-MM-DD
  expiryDate?: string; // YYYY-MM-DD
  notes?: string;
  storagePath?: string;
  originalFileName?: string;
  mimeType?: string;
  fileSize?: number;
  createdByUserId?: string;
  createdByUserName?: string;
  fileDataUri?: string; // Cache data-URI para fallback offline
}

export interface UpdateMedicalDocumentPayload {
  documentType?: MedicalDocumentType;
  title?: string;
  issueDate?: string;
  expiryDate?: string | null;
  notes?: string | null;
  storagePath?: string;
  originalFileName?: string;
  mimeType?: string;
  fileSize?: number;
  fileDataUri?: string;
}

export interface HealthRecord {
  id: string;
  tenantId: string;
  studentId: string;
  conditions: string[];
  allergies: string[];
  physicalRestrictions: string[];
  injuryHistory: string;
  voluntaryMedications: string;
  emergencyContactNotes: string;
  medicalCertExpiryDate?: string;
  medicalDocs: {
    id: string;
    title: string;
    docType: 'medical_certificate' | 'exam' | 'declaration' | 'authorization' | 'medical_report' | 'other';
    uploadDate: string;
    expiresAt?: string;
    fileUrl: string;
    storagePath?: string;
    mimeType?: string;
    fileSize?: number;
  }[];
}

export interface MartialArt {
  id: string;
  tenantId: string;
  name: string; // Judô, Jiu-Jitsu Brasileiro, Karatê Shotokan, etc.
  origin: string; // Japão, Brasil, etc.
  description: string;
  governingFederation?: string; // CBJ / IJF, CBJJ / IBJJF, etc.
  status: 'active' | 'inactive';
}

export interface BeltRank {
  id: string;
  tenantId: string;
  martialArtId: string;
  name: string; // ex: Faixa Branca, Faixa Cinza, Faixa Azul, Faixa Amarela...
  rankType: 'faixa' | 'grau' | 'dan' | 'corda';
  orderIndex: number;
  colorHex: string;
  stripeColorHex?: string;
  minAgeYears: number;
  minPracticeMonths: number;
  technicalRequirements: string;
  requiresExam: boolean;
}

export interface StudentGraduation {
  id: string;
  tenantId: string;
  studentId: string;
  martialArtId: string;
  martialArtName?: string;
  beltRankId: string;
  beltRankName?: string;
  newBeltName?: string;
  beltColorHex?: string;
  graduatedAt: string; // YYYY-MM-DD
  graduationDate?: string;
  examinerName: string;
  evaluatorName?: string;
  branchName?: string;
  certificateCode?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  hasInconsistency?: boolean;
  inconsistencyMessage?: string;
}

export type GraduationEvent = StudentGraduation;

export interface RecordGraduationPayload {
  tenantId: string;
  studentId: string;
  martialArtId: string;
  beltRankId: string;
  graduatedAt: string; // YYYY-MM-DD
  examinerName?: string;
  branchName?: string;
  certificateCode?: string;
  notes?: string;
}

export interface UpdateGraduationPayload {
  id: string;
  tenantId: string;
  studentId: string;
  martialArtId: string;
  beltRankId: string;
  graduatedAt: string; // YYYY-MM-DD
  examinerName?: string;
  branchName?: string;
  certificateCode?: string;
  notes?: string;
}

export interface GraduationHistory {
  id: string;
  tenantId: string;
  studentId: string;
  martialArtId: string;
  previousBeltName?: string;
  newBeltName: string;
  newBeltId: string;
  date: string; // DD/MM/AAAA or YYYY-MM-DD
  examinerSenseiName: string;
  certificateCode?: string;
  notes?: string;
}

export interface Student {
  id: string;
  tenantId: string;
  branchId: string;
  personId: string;
  registrationNumber: string; // Matrícula única
  enrollmentDate: string;
  status: 'active' | 'inactive' | 'suspended' | 'dropped';
  currentGraduations: {
    martialArtId: string;
    martialArtName: string;
    beltId: string;
    beltName: string;
    beltColorHex: string;
    graduatedAt: string;
  }[];
  monthlyFee: number;
  planId?: string;
  notes?: string;
  userId?: string;
  portalAccessStatus?: PortalAccessStatus;
  allowAnthropometryView?: boolean;
  address?: {
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  };
}

export interface ClassSchedule {
  id: string;
  tenantId: string;
  classGroupId: string;
  dayOfWeek: number; // 0: Dom, 1: Seg, 2: Ter, 3: Qua, 4: Qui, 5: Sex, 6: Sáb
  startTime: string; // "18:00"
  endTime: string; // "19:15"
  tatamiRoom: string;
  instructorUserId?: string;
  instructorName?: string;
  active: boolean;
  notes?: string;
  createdAt?: string;
}

export interface ClassGroup {
  id: string;
  tenantId: string;
  branchId: string;
  martialArtId: string;
  name: string;
  headInstructorId?: string;
  headInstructorName: string;
  daysOfWeek: number[]; // 1: Seg, 2: Ter, 3: Qua, 4: Qui, 5: Sex, 6: Sab, 0: Dom
  startTime: string; // "18:00"
  endTime: string; // "19:15"
  maxCapacity: number;
  minAge: number;
  maxAge?: number;
  allowedBeltRanks?: string[];
  tatamiRoom: string;
  active: boolean;
  notes?: string;
  schedules?: ClassSchedule[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Tatami {
  id: string;
  tenantId: string;
  branchId?: string;
  name: string; // Ex: "Tatami Principal", "Tatami 1", "Espaço Infantil"
  dimensions?: string; // Ex: "12x12m (144m²)"
  maxCapacity: number; // Lotação máxima do tatami
  colorHex?: string; // Cor de identificação visual na grade
  description?: string;
  active: boolean; // Se false: desativação lógica preservando histórico
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTatamiPayload {
  tenantId: string;
  branchId?: string;
  name: string;
  dimensions?: string;
  maxCapacity: number;
  colorHex?: string;
  description?: string;
  active?: boolean;
}

export interface UpdateTatamiPayload {
  name?: string;
  branchId?: string;
  dimensions?: string;
  maxCapacity?: number;
  colorHex?: string;
  description?: string;
  active?: boolean;
}

export interface Enrollment {
  id: string;
  tenantId: string;
  branchId: string;
  studentId: string;
  classGroupId: string;
  classId?: string;
  enrolledAt: string;
  status: 'active' | 'paused' | 'canceled';
}

export interface ClassSession {
  id: string;
  tenantId: string;
  classGroupId: string;
  sessionDate: string; // YYYY-MM-DD
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  instructorUserId?: string;
  instructorName?: string;
  status: 'open' | 'completed' | 'canceled';
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  // Métricas agregadas
  presentCount?: number;
  absentCount?: number;
  lateCount?: number;
  excusedCount?: number;
  totalStudents?: number;
}

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  classGroupId: string;
  classId?: string;
  sessionId?: string;
  studentId: string;
  date: string; // YYYY-MM-DD
  status: 'present' | 'absent' | 'late' | 'excused';
  notes?: string;
  justification?: string;
  recordedByUserName: string;
  recordedByUserId?: string;
  recordedAt: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  branchId: string;
  studentId: string;
  financialGuardianId?: string;
  planId?: string;
  classGroupId?: string;
  competence: string; // "10/2026"
  issueDate: string;
  dueDate: string;
  originalAmount: number;
  discountAmount: number;
  discountDescription?: string;
  penaltyAndInterestAmount: number;
  finalAmount: number;
  paidAmount: number;
  balance: number;
  status: 'pending' | 'overdue' | 'paid' | 'partially_paid' | 'canceled';
  paymentDate?: string;
  paidDate?: string;
  paymentMethod?: 'pix' | 'boleto' | 'credit_card' | 'cash';
  pixCode?: string;
  receiptNumber?: string;
  notes?: string;
  auditTrail: {
    date: string;
    action: string;
    userName: string;
  }[];
}

export interface MembershipPlan {
  id: string;
  tenantId: string;
  branchId?: string;
  name: string;
  amount: number;
  frequency: 'monthly' | 'quarterly' | 'semiannual' | 'annual';
  dueDay: number; // 1 to 31
  discountPercentage?: number;
  discountDescription?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateMembershipPlanPayload {
  tenantId: string;
  branchId?: string;
  name: string;
  amount: number;
  frequency?: 'monthly' | 'quarterly' | 'semiannual' | 'annual';
  dueDay: number;
  discountPercentage?: number;
  discountDescription?: string;
  active?: boolean;
}

export interface FinancialTransaction {
  id: string;
  tenantId: string;
  branchId?: string;
  type: 'income' | 'expense';
  category: 'competition' | 'merchandise' | 'exam' | 'event' | 'administrative' | 'facilities' | 'payroll' | 'other';
  description: string;
  amount: number;
  paidAmount?: number;
  balance?: number;
  competence: string; // "10/2026"
  dueDate?: string;
  paymentDate?: string;
  status: 'pending' | 'partially_paid' | 'completed' | 'canceled';
  studentId?: string;
  guardianPersonId?: string;
  classGroupId?: string;
  quantity?: number;
  unitPrice?: number;
  paymentMethod?: 'pix' | 'boleto' | 'credit_card' | 'cash' | 'transfer';
  receiptNumber?: string;
  notes?: string;
  createdByUserId?: string;
  createdByUserName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTransactionPayload {
  tenantId: string;
  branchId?: string;
  type: 'income' | 'expense';
  category: FinancialTransaction['category'];
  description: string;
  amount: number;
  paidAmount?: number;
  balance?: number;
  competence: string;
  dueDate?: string;
  paymentDate?: string;
  status?: 'pending' | 'completed' | 'canceled';
  studentId?: string;
  guardianPersonId?: string;
  classGroupId?: string;
  quantity?: number;
  unitPrice?: number;
  paymentMethod?: FinancialTransaction['paymentMethod'];
  notes?: string;
  createdByUserId?: string;
  createdByUserName?: string;
}

export interface PaymentReminder {
  id: string;
  tenantId: string;
  invoiceId: string;
  recipientEmail: string;
  recipientName: string;
  recipientType: 'student' | 'financial_guardian';
  subject: string;
  bodySnippet: string;
  sentAt: string;
  status: 'sent' | 'failed' | 'preview';
  providerResponse?: string;
  sentByUserId?: string;
}

export interface SendReminderPayload {
  tenantId: string;
  invoiceId: string;
  recipientEmail: string;
  recipientName: string;
  recipientType: 'student' | 'financial_guardian';
  subject: string;
  body: string;
  sentByUserId?: string;
}

export interface DigitalLibraryItem {
  id: string;
  tenantId: string;
  title: string;
  category: 'kata' | 'waza_techniques' | 'physical_prep' | 'rules_referee' | 'philosophy_history' | 'general';
  mediaType: 'video' | 'pdf' | 'document' | 'link';
  mediaUrl: string;
  youtubeVideoId?: string;
  thumbnailUrl?: string;
  description: string;
  martialArtId?: string;
  martialArtName?: string;
  targetBeltNames?: string[];
  targetBeltIds?: string[];
  allBelts?: boolean;
  authorInstructor: string;
  publishedDate: string;
  accessScope: 'public' | 'tenant_all' | 'restricted_belt';
  viewCount: number;
  displayOrder?: number;
  status?: 'published' | 'draft' | 'archived';
  createdByUserId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SaveVideoPayload {
  id?: string;
  tenantId: string;
  martialArtId: string;
  title: string;
  description?: string;
  youtubeUrl: string;
  youtubeVideoId: string;
  thumbnailUrl: string;
  category: 'kata' | 'waza_techniques' | 'physical_prep' | 'rules_referee' | 'philosophy_history' | 'general';
  authorInstructor?: string;
  displayOrder?: number;
  status: 'published' | 'draft' | 'archived';
  allBelts: boolean;
  targetBeltIds: string[];
}


export interface BeltExamEvent {
  id: string;
  tenantId: string;
  branchId: string;
  martialArtId: string;
  martialArtName: string;
  title: string;
  examDate: string;
  location: string;
  chiefExaminerName: string;
  targetRanks: string[];
  examFee: number;
  status: 'open' | 'evaluating' | 'completed' | 'canceled';
  candidatesCount: number;
}

export interface BeltExamRegistration {
  id: string;
  tenantId: string;
  examId: string;
  studentId: string;
  studentName: string;
  currentBelt: string;
  targetBelt: string;
  targetBeltId: string;
  feeStatus: 'pending' | 'paid' | 'exempt';
  resultStatus: 'pending' | 'approved' | 'not_approved';
  score?: number;
  examinerNotes?: string;
}

export interface Competition {
  id: string;
  tenantId: string;
  martialArtId: string;
  title: string;
  organizer: string;
  location: string;
  eventDate: string;
  registrationDeadline: string;
  status: 'open' | 'ongoing' | 'finished';
  rulesUrl?: string;
}

export interface CompetitionAthlete {
  id: string;
  tenantId: string;
  competitionId: string;
  studentId: string;
  studentName: string;
  category: string;
  weightCategory: string;
  docsValidated: boolean;
  status: 'registered' | 'confirmed' | 'disqualified';
  placement?: 'gold' | 'silver' | 'bronze' | 'participant' | 'none';
  notes?: string;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  timestamp: string;
  details: string;
}

// ============================================================================
// MÓDULO CENTRAL DO PROPRIETÁRIO DO SAAS (SUPERADMIN & ASSINATURAS RECORRENTES)
// ============================================================================

export type BillingCycle = 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export type SaaSSubscriptionStatus =
  | 'trial'               // Em período de degustação gratuita
  | 'pending_payment'     // Contratação solicitada, aguardando confirmação de pagamento Pix
  | 'waiting_payment'     // Aguardando confirmação do primeiro pagamento ou renovação
  | 'payment_under_review'// Comprovante enviado e em análise administrativa
  | 'active'              // Assinatura regular e em dia
  | 'past_due'            // Pagamento atrasado (dentro ou fora do período de tolerância)
  | 'suspended'           // Suspensa administrativamente pelo operador da plataforma
  | 'canceled'            // Cancelada pelo cliente ou por rescisão contratual
  | 'expired'             // Período de teste ou vigência expirado sem renovação
  | 'rejected';           // Pagamento rejeitado ou inválido

export interface SaaSCommercialPlan {
  id: string; // ex: 'basic', 'advanced', 'enterprise', 'trial'
  name: string;
  description: string;
  tagline?: string;
  price: number; // Preço base do ciclo mensal em BRL
  annualPrice?: number;
  currency: 'BRL';
  billingCycle: BillingCycle;
  cycleMultiplier?: number; // Ex: 1 para mensal, 3 para trimestral, 12 para anual
  trialDays: number;
  maxStudents: number;
  maxBranches: number;
  maxUsers: number;
  maxClasses?: number;
  maxStorageGb: number;
  features: {
    digitalLibrary: boolean;
    beltExams: boolean;
    competitions: boolean;
    advancedReports: boolean;
    multiBranch: boolean;
    customBranding: boolean;
    automatedNotifications: boolean;
  };
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaaSSubscription {
  id: string;
  tenantId: string;
  tenantName?: string;
  planId: string;
  planName: string;
  requestedPlanId?: string;
  requestedBillingCycle?: BillingCycle;
  requestedAmount?: number;
  paymentRequestedAt?: string;
  lastEmailSentAt?: string;
  lastEmailStatus?: 'sent' | 'failed' | 'missing_config' | 'pending';
  lastEmailError?: string;
  lastPaymentConfirmedAt?: string;
  lastPaymentConfirmedBy?: string;
  status: SaaSSubscriptionStatus;
  billingCycle: BillingCycle;
  amount: number;
  startedAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextDueDate: string;
  trialExpiresAt?: string;
  gracePeriodDays: number; // Dias de tolerância antes de bloqueio por atraso (default: 5 dias)
  customMaxUsers?: number;
  customMaxBranches?: number;
  customMaxStudents?: number;
  gatewayCustomerId?: string;
  gatewaySubscriptionId?: string;
  cancelReason?: string;
  canceledAt?: string;
  suspendedReason?: string;
  suspendedAt?: string;
  lastPaymentId?: string;
  notes?: string;
  manualActivation?: {
    activatedByUserId: string;
    activatedByUserName: string;
    reason: string;
    activatedAt: string;
    extendedDays: number;
  };
  createdAt: string;
  updatedAt: string;
}

export type SaaSPaymentStatus =
  | 'pending'
  | 'under_review'
  | 'paid'
  | 'failed'
  | 'rejected'
  | 'canceled'
  | 'refunded';
export type SaaSPaymentMethod = 'pix' | 'credit_card' | 'boleto' | 'manual';

export interface SaaSPayment {
  id: string;
  subscriptionId: string;
  tenantId: string;
  tenantName?: string;
  planId?: string;
  planName?: string;
  billingCycle?: BillingCycle;
  amount: number;
  currency: 'BRL';
  dueDate: string;
  paidAt?: string;
  status: SaaSPaymentStatus;
  paymentMethod: SaaSPaymentMethod;
  payerEmail?: string;
  pixKey?: string;
  pixKeyProvisional?: boolean;
  referenceId?: string;
  confirmedByUserId?: string;
  confirmedByUserName?: string;
  confirmationNotes?: string;
  gatewayChargeId?: string;
  gatewayPaymentId?: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  invoiceUrl?: string;
  pixQrCode?: string;
  pixCopyPaste?: string;
  barcode?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaaSSubscriptionEmailLog {
  id: string;
  tenantId: string;
  subscriptionId?: string;
  paymentId?: string;
  recipientEmail: string;
  subject: string;
  planId: string;
  planName: string;
  billingCycle: BillingCycle;
  amount: number;
  pixKeyUsed: string;
  isProvisionalPixKey: boolean;
  status: 'sent' | 'failed' | 'missing_config';
  provider: string;
  providerMessageId?: string;
  errorMessage?: string;
  triggeredByUserId?: string;
  createdAt: string;
}

export interface SaaSPaymentWebhookEvent {
  id: string;
  eventId: string; // Chave de idempotência do provedor
  gatewayName: 'asaas' | 'mercadopago' | 'stripe';
  eventType: string; // Ex: 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'PAYMENT_REFUNDED'
  processedAt: string;
  payload: any;
  status: 'processed' | 'ignored' | 'failed';
  errorDetails?: string;
}

export interface PlatformAuditLog {
  id: string;
  actorUserId: string;
  actorUserName: string;
  action:
    | 'create_plan'
    | 'update_plan'
    | 'change_plan_status'
    | 'suspend_tenant'
    | 'reactivate_tenant'
    | 'cancel_subscription'
    | 'manual_activate_subscription'
    | 'change_subscription_plan'
    | 'change_tenant_plan'
    | 'request_subscription_plan'
    | 'confirm_saas_payment'
    | 'reject_saas_payment'
    | 'send_payment_email'
    | 'process_payment_webhook'
    | 'refund_payment'
    | 'register_tenant'
    | 'update_license_limits'
    | 'bootstrap_platform_owner';
  entityType: 'tenant' | 'plan' | 'subscription' | 'payment' | 'gateway' | 'user';
  entityId: string;
  tenantId?: string;
  tenantName?: string;
  reason?: string;
  details: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface TenantAccessEvaluation {
  isAllowed: boolean;
  accessState:
    | 'active'
    | 'trial'
    | 'trial_expired'
    | 'pending_payment'
    | 'waiting_payment'
    | 'payment_under_review'
    | 'rejected'
    | 'grace_period'
    | 'blocked_past_due'
    | 'blocked_suspended'
    | 'blocked_canceled';
  message: string;
  daysRemaining?: number;
  graceDaysLeft?: number;
  allowedModules: {
    digitalLibrary: boolean;
    beltExams: boolean;
    competitions: boolean;
    advancedReports: boolean;
    multiBranch: boolean;
    customBranding: boolean;
  };
  limits: {
    maxStudents: number;
    currentStudents: number;
    isStudentsLimitReached: boolean;
    maxBranches: number;
    currentBranches: number;
    isBranchesLimitReached: boolean;
    maxUsers: number;
    currentUsers: number;
    isUsersLimitReached: boolean;
  };
}

