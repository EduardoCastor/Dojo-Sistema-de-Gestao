import {
  Tenant,
  Branch,
  User,
  Person,
  GuardianRelationship,
  PhysicalAssessment,
  HealthRecord,
  StudentMedicalDocument,
  StudentGraduation,
  MartialArt,
  BeltRank,
  Student,
  ClassGroup,
  Enrollment,
  AttendanceRecord,
  Invoice,
  DigitalLibraryItem,
  BeltExamEvent,
  BeltExamRegistration,
  Competition,
  CompetitionAthlete,
  AuditLog,
  SaaSPlan,
  Tatami,
  MembershipPlan,
  FinancialTransaction,
  PaymentReminder,
  SaaSCommercialPlan,
  SaaSSubscription,
  SaaSPayment,
  PlatformAuditLog,
} from '../types';

import {
  INITIAL_SAAS_PLANS,
  INITIAL_TENANTS,
  INITIAL_BRANCHES,
  INITIAL_USERS,
  INITIAL_PERSONS,
  INITIAL_GUARDIAN_RELATIONSHIPS,
  INITIAL_STUDENTS,
  INITIAL_PHYSICAL_ASSESSMENTS,
  INITIAL_HEALTH_RECORDS,
  INITIAL_MEDICAL_DOCUMENTS,
  INITIAL_STUDENT_GRADUATIONS,
  INITIAL_CLASSES,
  INITIAL_ENROLLMENTS,
  INITIAL_ATTENDANCES,
  INITIAL_INVOICES,
  INITIAL_LIBRARY_ITEMS,
  INITIAL_BELT_EXAMS,
  INITIAL_EXAM_REGISTRATIONS,
  INITIAL_COMPETITIONS,
  INITIAL_COMPETITION_ATHLETES,
  INITIAL_AUDIT_LOGS,
  INITIAL_BELT_RANKS,
  INITIAL_MARTIAL_ARTS,
  INITIAL_TATAMIS,
  INITIAL_MEMBERSHIP_PLANS,
  INITIAL_FINANCIAL_TRANSACTIONS,
  INITIAL_PAYMENT_REMINDERS,
  INITIAL_COMMERCIAL_PLANS,
  INITIAL_SAAS_SUBSCRIPTIONS,
  INITIAL_SAAS_PAYMENTS,
  INITIAL_PLATFORM_AUDIT_LOGS,
} from './initialData';

const STORAGE_PREFIX = 'tatamehub_';
const memoryStorage = new Map<string, string>();

function load<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage !== 'undefined') {
      const item = localStorage.getItem(STORAGE_PREFIX + key);
      return item ? JSON.parse(item) : fallback;
    }
    const item = memoryStorage.get(STORAGE_PREFIX + key);
    return item ? JSON.parse(item) : fallback;
  } catch (err) {
    return fallback;
  }
}

function save<T>(key: string, value: T): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      return;
    }
    memoryStorage.set(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch (err) {
    // In-memory fallback
    try {
      memoryStorage.set(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }
}

export class DataStore {
  static getPlans(): SaaSPlan[] {
    return load('plans', INITIAL_SAAS_PLANS);
  }

  static savePlans(plans: SaaSPlan[]): void {
    save('plans', plans);
  }

  static getTenants(): Tenant[] {
    return load('tenants', INITIAL_TENANTS);
  }

  static saveTenants(tenants: Tenant[]): void {
    save('tenants', tenants);
  }

  static getBranches(tenantId?: string): Branch[] {
    const all = load('branches', INITIAL_BRANCHES);
    return tenantId ? all.filter(b => b.tenantId === tenantId) : all;
  }

  static saveBranches(branches: Branch[]): void {
    save('branches', branches);
  }

  static getUsers(tenantId?: string): User[] {
    const all = load('users', INITIAL_USERS);
    return tenantId && tenantId !== 'platform' ? all.filter(u => u.tenantId === tenantId || u.tenantId === 'platform') : all;
  }

  static saveUsers(users: User[]): void {
    save('users', users);
  }

  static getPersons(tenantId: string): Person[] {
    const all = load('persons', INITIAL_PERSONS);
    return all.filter(p => p.tenantId === tenantId);
  }

  static savePersons(persons: Person[]): void {
    save('persons', persons);
  }

  static getGuardianRelationships(tenantId: string): GuardianRelationship[] {
    const all = load('guardians', INITIAL_GUARDIAN_RELATIONSHIPS);
    return all.filter(g => g.tenantId === tenantId);
  }

  static saveGuardianRelationships(rels: GuardianRelationship[]): void {
    save('guardians', rels);
  }

  static getStudents(tenantId: string): Student[] {
    const all = load('students', INITIAL_STUDENTS);
    return all.filter(s => s.tenantId === tenantId);
  }

  static saveStudents(students: Student[]): void {
    const all = load('students', INITIAL_STUDENTS);
    const updatedTenantIds = new Set(students.map(s => s.tenantId));
    const others = all.filter(s => !updatedTenantIds.has(s.tenantId));
    save('students', [...students, ...others]);
  }

  static getPhysicalAssessments(tenantId: string): PhysicalAssessment[] {
    const all = load('physical_assessments', INITIAL_PHYSICAL_ASSESSMENTS);
    return all.filter(a => a.tenantId === tenantId);
  }

  static getAllPhysicalAssessments(): PhysicalAssessment[] {
    return load('physical_assessments', INITIAL_PHYSICAL_ASSESSMENTS);
  }

  static savePhysicalAssessments(assessments: PhysicalAssessment[]): void {
    const all = load('physical_assessments', INITIAL_PHYSICAL_ASSESSMENTS);
    const updatedTenantIds = new Set(assessments.map(a => a.tenantId));
    const others = all.filter(a => !updatedTenantIds.has(a.tenantId));
    save('physical_assessments', [...assessments, ...others]);
  }

  static getHealthRecords(tenantId: string): HealthRecord[] {
    const all = load('health_records', INITIAL_HEALTH_RECORDS);
    return all.filter(h => h.tenantId === tenantId);
  }

  static saveHealthRecords(records: HealthRecord[]): void {
    save('health_records', records);
  }

  static getMedicalDocuments(tenantId: string, studentId?: string): StudentMedicalDocument[] {
    const all = load<StudentMedicalDocument[]>('student_medical_documents', INITIAL_MEDICAL_DOCUMENTS);
    return all.filter((doc) => {
      const matchTenant = doc.tenantId === tenantId;
      return studentId ? matchTenant && doc.studentId === studentId : matchTenant;
    });
  }

  static getAllMedicalDocuments(): StudentMedicalDocument[] {
    return load<StudentMedicalDocument[]>('student_medical_documents', INITIAL_MEDICAL_DOCUMENTS);
  }

  static saveMedicalDocuments(docs: StudentMedicalDocument[]): void {
    save('student_medical_documents', docs);
  }

  static saveMedicalDocument(doc: StudentMedicalDocument): void {
    const all = this.getAllMedicalDocuments();
    const existingIndex = all.findIndex((d) => d.id === doc.id);
    if (existingIndex >= 0) {
      all[existingIndex] = doc;
    } else {
      all.unshift(doc);
    }
    save('student_medical_documents', all);
  }

  static deleteMedicalDocument(docId: string): void {
    const all = this.getAllMedicalDocuments();
    save('student_medical_documents', all.filter((d) => d.id !== docId));
  }

  static getGraduations(tenantId: string, studentId?: string): StudentGraduation[] {
    const all = load<StudentGraduation[]>('student_graduations', INITIAL_STUDENT_GRADUATIONS);
    return all.filter((grad) => {
      const matchTenant = grad.tenantId === tenantId;
      return studentId ? matchTenant && grad.studentId === studentId : matchTenant;
    });
  }

  static getAllGraduations(): StudentGraduation[] {
    return load<StudentGraduation[]>('student_graduations', INITIAL_STUDENT_GRADUATIONS);
  }

  static saveGraduations(graduations: StudentGraduation[]): void {
    save('student_graduations', graduations);
  }

  static saveGraduation(grad: StudentGraduation): void {
    const all = this.getAllGraduations();
    const existingIndex = all.findIndex((g) => g.id === grad.id);
    if (existingIndex >= 0) {
      all[existingIndex] = grad;
    } else {
      all.unshift(grad);
    }
    save('student_graduations', all);
  }

  static deleteGraduation(gradId: string): void {
    const all = this.getAllGraduations();
    save('student_graduations', all.filter((g) => g.id !== gradId));
  }

  static getMartialArts(tenantId: string): MartialArt[] {
    const all = load('martial_arts', INITIAL_MARTIAL_ARTS);
    const filtered = all.filter(m => m.tenantId === tenantId);
    return filtered.length > 0 ? filtered : all.filter(m => m.tenantId === 'tenant-kodokan');
  }

  static saveMartialArts(arts: MartialArt[]): void {
    save('martial_arts', arts);
  }

  static getBeltRanks(tenantId: string): BeltRank[] {
    const all = load('belt_ranks', INITIAL_BELT_RANKS);
    const filtered = all.filter(b => b.tenantId === tenantId);
    return filtered.length > 0 ? filtered : all.filter(b => b.tenantId === 'tenant-kodokan');
  }

  static saveBeltRanks(ranks: BeltRank[]): void {
    save('belt_ranks', ranks);
  }

  static getTatamis(tenantId: string): Tatami[] {
    const all = load('tatamis', INITIAL_TATAMIS);
    const filtered = all.filter(t => t.tenantId === tenantId);
    return filtered.length > 0 ? filtered : all.filter(t => t.tenantId === 'tenant-kodokan');
  }

  static saveTatamis(tatamis: Tatami[]): void {
    save('tatamis', tatamis);
  }

  static getClasses(tenantId: string): ClassGroup[] {
    const all = load('classes', INITIAL_CLASSES);
    return all.filter(c => c.tenantId === tenantId);
  }

  static saveClasses(classes: ClassGroup[]): void {
    save('classes', classes);
  }

  static getEnrollments(tenantId: string): Enrollment[] {
    const all = load('enrollments', INITIAL_ENROLLMENTS);
    return all.filter(e => e.tenantId === tenantId);
  }

  static saveEnrollments(enrollments: Enrollment[]): void {
    save('enrollments', enrollments);
  }

  static getAttendances(tenantId: string): AttendanceRecord[] {
    const all = load('attendances', INITIAL_ATTENDANCES);
    return all.filter(a => a.tenantId === tenantId);
  }

  static saveAttendances(attendances: AttendanceRecord[]): void {
    save('attendances', attendances);
  }

  static getInvoices(tenantId: string): Invoice[] {
    const all = load('invoices', INITIAL_INVOICES);
    return all.filter(i => i.tenantId === tenantId);
  }

  static saveInvoices(invoices: Invoice[]): void {
    const all = load('invoices', INITIAL_INVOICES);
    const updatedTenantIds = new Set(invoices.map(i => i.tenantId));
    const others = all.filter(i => !updatedTenantIds.has(i.tenantId));
    save('invoices', [...invoices, ...others]);
  }

  static getMembershipPlans(tenantId: string): MembershipPlan[] {
    const all = load('membership_plans', INITIAL_MEMBERSHIP_PLANS);
    return all.filter(p => p.tenantId === tenantId);
  }

  static saveMembershipPlans(plans: MembershipPlan[]): void {
    save('membership_plans', plans);
  }

  static getFinancialTransactions(tenantId: string): FinancialTransaction[] {
    const all = load('financial_transactions', INITIAL_FINANCIAL_TRANSACTIONS);
    return all.filter(t => t.tenantId === tenantId);
  }

  static saveFinancialTransactions(txs: FinancialTransaction[]): void {
    save('financial_transactions', txs);
  }

  static getPaymentReminders(tenantId: string): PaymentReminder[] {
    const all = load('payment_reminders', INITIAL_PAYMENT_REMINDERS);
    return all.filter(r => r.tenantId === tenantId);
  }

  static savePaymentReminders(reminders: PaymentReminder[]): void {
    save('payment_reminders', reminders);
  }

  static getLibraryItems(tenantId: string): DigitalLibraryItem[] {
    const all = load('library_items', INITIAL_LIBRARY_ITEMS);
    return all.filter(l => l.tenantId === tenantId);
  }

  static saveLibraryItems(items: DigitalLibraryItem[]): void {
    const all = load('library_items', INITIAL_LIBRARY_ITEMS);
    const updatedTenantIds = new Set(items.map(i => i.tenantId));
    const others = all.filter(i => !updatedTenantIds.has(i.tenantId));
    save('library_items', [...items, ...others]);
  }

  static getBeltExams(tenantId: string): BeltExamEvent[] {
    const all = load('belt_exams', INITIAL_BELT_EXAMS);
    return all.filter(e => e.tenantId === tenantId);
  }

  static saveBeltExams(exams: BeltExamEvent[]): void {
    save('belt_exams', exams);
  }

  static getExamRegistrations(tenantId: string): BeltExamRegistration[] {
    const all = load('exam_registrations', INITIAL_EXAM_REGISTRATIONS);
    return all.filter(r => r.tenantId === tenantId);
  }

  static saveExamRegistrations(regs: BeltExamRegistration[]): void {
    save('exam_registrations', regs);
  }

  static getCompetitions(tenantId: string): Competition[] {
    const all = load('competitions', INITIAL_COMPETITIONS);
    return all.filter(c => c.tenantId === tenantId);
  }

  static saveCompetitions(comps: Competition[]): void {
    save('competitions', comps);
  }

  static getCompetitionAthletes(tenantId: string): CompetitionAthlete[] {
    const all = load('competition_athletes', INITIAL_COMPETITION_ATHLETES);
    return all.filter(a => a.tenantId === tenantId);
  }

  static saveCompetitionAthletes(athletes: CompetitionAthlete[]): void {
    save('competition_athletes', athletes);
  }

  static getAuditLogs(tenantId: string): AuditLog[] {
    const all = load('audit_logs', INITIAL_AUDIT_LOGS);
    return all.filter(l => l.tenantId === tenantId);
  }

  static logAudit(
    tenantId: string,
    userId: string,
    userName: string,
    action: string,
    entity: string,
    entityId: string,
    details: string
  ): void {
    const all = load('audit_logs', INITIAL_AUDIT_LOGS);
    const newLog: AuditLog = {
      id: `log-${Date.now()}`,
      tenantId,
      userId,
      userName,
      action,
      entity,
      entityId,
      timestamp: new Date().toISOString(),
      details,
    };
    save('audit_logs', [newLog, ...all]);
  }

  // ==========================================================================
  // MÉTODOS DO PROPRIETÁRIO DO SAAS (SUPERADMIN CONSOLE)
  // ==========================================================================

  static getCommercialPlans(): SaaSCommercialPlan[] {
    return load('commercial_plans', INITIAL_COMMERCIAL_PLANS);
  }

  static saveCommercialPlans(plans: SaaSCommercialPlan[]): void {
    save('commercial_plans', plans);
  }

  static getSaaSSubscriptions(tenantId?: string): SaaSSubscription[] {
    const all = load('saas_subscriptions', INITIAL_SAAS_SUBSCRIPTIONS);
    return tenantId ? all.filter(s => s.tenantId === tenantId) : all;
  }

  static saveSaaSSubscriptions(subs: SaaSSubscription[]): void {
    save('saas_subscriptions', subs);
  }

  static saveSaaSSubscription(sub: SaaSSubscription): void {
    const all = load('saas_subscriptions', INITIAL_SAAS_SUBSCRIPTIONS);
    const index = all.findIndex(s => s.id === sub.id || s.tenantId === sub.tenantId);
    if (index >= 0) {
      all[index] = sub;
      save('saas_subscriptions', [...all]);
    } else {
      save('saas_subscriptions', [sub, ...all]);
    }
  }

  static getSaaSPayments(tenantId?: string): SaaSPayment[] {
    const all = load('saas_payments', INITIAL_SAAS_PAYMENTS);
    return tenantId ? all.filter(p => p.tenantId === tenantId) : all;
  }

  static saveSaaSPayments(payments: SaaSPayment[]): void {
    save('saas_payments', payments);
  }

  static saveSaaSPayment(payment: SaaSPayment): void {
    const all = load('saas_payments', INITIAL_SAAS_PAYMENTS);
    const index = all.findIndex(p => p.id === payment.id);
    if (index >= 0) {
      all[index] = payment;
      save('saas_payments', [...all]);
    } else {
      save('saas_payments', [payment, ...all]);
    }
  }

  static getPlatformAuditLogs(): PlatformAuditLog[] {
    return load('platform_audit_logs', INITIAL_PLATFORM_AUDIT_LOGS);
  }

  static logPlatformAudit(
    actorUserId: string,
    actorUserName: string,
    action: PlatformAuditLog['action'],
    entityType: PlatformAuditLog['entityType'],
    entityId: string,
    details: string,
    options?: {
      tenantId?: string;
      tenantName?: string;
      reason?: string;
      metadata?: Record<string, any>;
    }
  ): PlatformAuditLog {
    const all = load('platform_audit_logs', INITIAL_PLATFORM_AUDIT_LOGS);
    const newLog: PlatformAuditLog = {
      id: `plog-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      actorUserId,
      actorUserName,
      action,
      entityType,
      entityId,
      tenantId: options?.tenantId,
      tenantName: options?.tenantName,
      reason: options?.reason,
      details,
      metadata: options?.metadata,
      timestamp: new Date().toISOString(),
    };
    save('platform_audit_logs', [newLog, ...all]);
    return newLog;
  }

  static resetToSeed(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    memoryStorage.clear();
  }
}

