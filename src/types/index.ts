export type SaaSPlanId = 'trial' | 'basic' | 'advanced';

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

export interface Tenant {
  id: string;
  tradeName: string; // Nome Fantasia
  legalName: string; // Razão Social
  cnpjOrCpf: string;
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
  };
  planId: SaaSPlanId;
  status: 'trial' | 'active' | 'suspended' | 'canceled';
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

export interface User {
  id: string;
  tenantId: string; // 'platform' for superadmin
  branchId?: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  phone?: string;
  active: boolean;
  studentId?: string; // If role is 'student'
  guardianPersonId?: string; // If role is 'guardian'
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
  address: {
    street: string;
    number: string;
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
  date: string;
  weightKg: number;
  heightCm: number;
  bmi: number;
  evaluatorName: string;
  notes?: string;
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
    docType: 'medical_certificate' | 'exam' | 'declaration' | 'authorization';
    uploadDate: string;
    expiresAt?: string;
    fileUrl: string;
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
  notes?: string;
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

export interface Enrollment {
  id: string;
  tenantId: string;
  branchId: string;
  studentId: string;
  classGroupId: string;
  enrolledAt: string;
  status: 'active' | 'paused' | 'canceled';
}

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  classGroupId: string;
  studentId: string;
  date: string; // YYYY-MM-DD
  status: 'present' | 'absent' | 'excused';
  notes?: string;
  recordedByUserName: string;
  recordedAt: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  branchId: string;
  studentId: string;
  financialGuardianId?: string;
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
  paymentMethod?: 'pix' | 'boleto' | 'credit_card' | 'cash';
  pixCode?: string;
  receiptNumber?: string;
  auditTrail: {
    date: string;
    action: string;
    userName: string;
  }[];
}

export interface DigitalLibraryItem {
  id: string;
  tenantId: string;
  title: string;
  category: 'kata' | 'waza_techniques' | 'physical_prep' | 'rules_referee' | 'philosophy_history';
  mediaType: 'video' | 'pdf' | 'document' | 'link';
  mediaUrl: string;
  thumbnailUrl?: string;
  description: string;
  martialArtId?: string;
  martialArtName?: string;
  targetBeltNames?: string[];
  authorInstructor: string;
  publishedDate: string;
  accessScope: 'public' | 'tenant_all' | 'restricted_belt';
  viewCount: number;
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
