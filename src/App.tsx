import React, { useState, useEffect, useRef } from 'react';
import { DataStore } from './data/storage';
import {
  Tenant,
  Branch,
  User,
  Person,
  GuardianRelationship,
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
  SaaSPlanId,
  BeltRank,
  MartialArt,
  Tatami,
  PhysicalAssessment,
} from './types';

// Layouts
import { PublicNavbar } from './components/layout/PublicNavbar';
import { PublicFooter } from './components/layout/PublicFooter';
import { DashboardLayout, AdminViewTab } from './components/layout/DashboardLayout';
import { StudentLayout } from './components/layout/StudentLayout';

// Public Sections & Modals
import { HeroSection } from './components/public/HeroSection';
import { FeaturesSection } from './components/public/FeaturesSection';
import { PricingSection } from './components/public/PricingSection';
import { FAQSection } from './components/public/FAQSection';
import { RegisterModal } from './components/public/RegisterModal';
import { LoginModal } from './components/public/LoginModal';
import { LegalDocumentsModal } from './components/public/LegalDocumentsModal';

// Admin Views
import { OverviewDashboard } from './components/admin/OverviewDashboard';
import { StudentsView } from './components/admin/StudentsView';
import { GuardiansView } from './components/admin/GuardiansView';
import { StudentFormModal } from './components/admin/StudentFormModal';
import { ModalitiesView } from './components/admin/ModalitiesView';
import { ClassesView } from './components/admin/ClassesView';
import { AttendanceView } from './components/admin/AttendanceView';
import { TatamiOccupancyView } from './components/admin/TatamiOccupancyView';
import { AttendanceModal } from './components/admin/AttendanceModal';
import { FinancialView } from './components/admin/FinancialView';
import { DigitalLibraryView } from './components/admin/DigitalLibraryView';
import { BeltExamsView } from './components/admin/BeltExamsView';
import { CompetitionsView } from './components/admin/CompetitionsView';
import { BranchesView } from './components/admin/BranchesView';
import { TeamUsersView } from './components/admin/TeamUsersView';
import { ReportsView } from './components/admin/ReportsView';
import { SettingsView } from './components/admin/SettingsView';
import { PlanUpgradeModal } from './components/admin/PlanUpgradeModal';

// Portals
import { StudentDashboard } from './components/student-portal/StudentDashboard';
import { GuardianPortal } from './components/student-portal/GuardianPortal';
import { PlatformAdminView } from './components/superadmin/PlatformAdminView';
import { PlatformAdminAuthView } from './components/superadmin/PlatformAdminAuthView';

// Supabase Real-Time & Auth Services
import {
  supabase,
  authService,
  isSupabaseConfigured,
  UserMembership,
  mapSupabaseRowToTenant,
} from './services/supabase';
import { portalAccessService } from './services/portalAccessService';
import { formDraftStore } from './utils/formDraftStore';
import { studentService, CreateStudentPayload, UpdateStudentPayload, isValidUUID } from './services/studentService';
import { classService } from './services/classService';
import { attendanceService } from './services/attendanceService';
import { tatamiService } from './services/tatamiService';
import { financialService, getCurrentCompetence } from './services/financialService';
import { assessmentService } from './services/assessmentService';
import { saasPlatformService } from './services/saasPlatformService';
import { detectEnvironmentMode, isAuthorizedPlatformOwnerEmail, OFFICIAL_DOMAINS } from './utils/domainConfig';

export default function App() {
  const initialEnvMode = detectEnvironmentMode();

  // App view navigation: main site starts in 'public' (never opens unauthenticated demo dashboard);
  // painel.tatameclub.com.br (or /painel) starts directly in 'superadmin' gated by PlatformAdminAuthView.
  const [currentView, setCurrentView] = useState<'public' | 'admin' | 'student_portal' | 'guardian_portal' | 'superadmin'>(
    initialEnvMode === 'saas_admin_panel' ? 'superadmin' : 'public'
  );
  const [adminTab, setAdminTab] = useState<AdminViewTab>('overview');

  // Modals state
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isLegalModalOpen, setIsLegalModalOpen] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<'terms' | 'privacy'>('terms');
  const openLegalModal = (tab: 'terms' | 'privacy') => {
    setLegalModalTab(tab);
    setIsLegalModalOpen(true);
  };
  const [isNewStudentOpen, setIsNewStudentOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [isUpgradePlanOpen, setIsUpgradePlanOpen] = useState(false);
  const [selectedClassForAttendance, setSelectedClassForAttendance] = useState<ClassGroup | null>(null);
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);

  // Active Session context (unauthenticated by default on public site)
  const [currentTenantId, setCurrentTenantId] = useState<string>('tenant-kodokan');
  const [currentBranchId, setCurrentBranchId] = useState<string>('branch-matriz');
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const activeSessionUserIdRef = useRef<string>('');
  const currentViewRef = useRef(currentView);
  currentViewRef.current = currentView;

  // Data Store States
  const [plans, setPlans] = useState<SaaSPlan[]>(() => DataStore.getPlans());
  const [tenants, setTenants] = useState<Tenant[]>(() => DataStore.getTenants());
  const [branches, setBranches] = useState<Branch[]>(() => DataStore.getBranches());
  const [users, setUsers] = useState<User[]>(() => DataStore.getUsers());
  const [persons, setPersons] = useState<Person[]>(() => DataStore.getPersons(currentTenantId));
  const [guardians, setGuardians] = useState<GuardianRelationship[]>(() => DataStore.getGuardianRelationships(currentTenantId));
  const [students, setStudents] = useState<Student[]>(() => DataStore.getStudents(currentTenantId));
  const [physicalAssessments, setPhysicalAssessments] = useState(() => DataStore.getPhysicalAssessments(currentTenantId));
  const [healthRecords, setHealthRecords] = useState(() => DataStore.getHealthRecords(currentTenantId));
  const [martialArts, setMartialArts] = useState(() => DataStore.getMartialArts(currentTenantId));
  const [beltRanks, setBeltRanks] = useState(() => DataStore.getBeltRanks(currentTenantId));
  const [tatamis, setTatamis] = useState<Tatami[]>(() => DataStore.getTatamis(currentTenantId));
  const [classes, setClasses] = useState<ClassGroup[]>(() => DataStore.getClasses(currentTenantId));
  const [enrollments, setEnrollments] = useState<Enrollment[]>(() => DataStore.getEnrollments(currentTenantId));
  const [attendances, setAttendances] = useState<AttendanceRecord[]>(() => DataStore.getAttendances(currentTenantId));
  const [invoices, setInvoices] = useState<Invoice[]>(() => DataStore.getInvoices(currentTenantId));
  const [libraryItems, setLibraryItems] = useState<DigitalLibraryItem[]>(() => DataStore.getLibraryItems(currentTenantId));
  const [beltExams, setBeltExams] = useState<BeltExamEvent[]>(() => DataStore.getBeltExams(currentTenantId));
  const [examRegistrations, setExamRegistrations] = useState<BeltExamRegistration[]>(() => DataStore.getExamRegistrations(currentTenantId));
  const [competitions, setCompetitions] = useState<Competition[]>(() => DataStore.getCompetitions(currentTenantId));
  const [competitionAthletes, setCompetitionAthletes] = useState<CompetitionAthlete[]>(() => DataStore.getCompetitionAthletes(currentTenantId));
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => DataStore.getAuditLogs(currentTenantId));

  const [isLoadingStudents, setIsLoadingStudents] = useState(false);

  // Sync data when currentTenantId changes
  useEffect(() => {
    setPersons(DataStore.getPersons(currentTenantId));
    setGuardians(DataStore.getGuardianRelationships(currentTenantId));
    setStudents(DataStore.getStudents(currentTenantId));
    setPhysicalAssessments(DataStore.getPhysicalAssessments(currentTenantId));
    setHealthRecords(DataStore.getHealthRecords(currentTenantId));
    setMartialArts(DataStore.getMartialArts(currentTenantId));
    setBeltRanks(DataStore.getBeltRanks(currentTenantId));
    setTatamis(DataStore.getTatamis(currentTenantId));
    setClasses(DataStore.getClasses(currentTenantId));
    setEnrollments(DataStore.getEnrollments(currentTenantId));
    setAttendances(DataStore.getAttendances(currentTenantId));
    setInvoices(DataStore.getInvoices(currentTenantId));
    setLibraryItems(DataStore.getLibraryItems(currentTenantId));
    setBeltExams(DataStore.getBeltExams(currentTenantId));
    setExamRegistrations(DataStore.getExamRegistrations(currentTenantId));
    setCompetitions(DataStore.getCompetitions(currentTenantId));
    setCompetitionAthletes(DataStore.getCompetitionAthletes(currentTenantId));
    setAuditLogs(DataStore.getAuditLogs(currentTenantId));
  }, [currentTenantId]);

  // Abertura automática da modal de login/convite ao receber link direto (?invite=CODIGO) ou retorno de OAuth com convite pendente
  useEffect(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlInvite = urlParams.get('invite');
      const pendingRaw = localStorage.getItem('tatame_pending_invite');
      if (urlInvite || pendingRaw) {
        setIsLoginOpen(true);
      }
    } catch {
      // ignore
    }
  }, []);

  // Carregar alunos em tempo real do banco de dados quando conectado e autenticado
  useEffect(() => {
    let isMounted = true;

    async function loadSupabaseStudents() {
      if (!isSupabaseConfigured() || !supabase || !isValidUUID(currentTenantId)) {
        return;
      }

      setIsLoadingStudents(true);
      try {
        const result = await studentService.fetchStudentsWithDetails(currentTenantId);
        if (result && isMounted) {
          setStudents(result.students);
          setPersons((prev) => {
            const nonStudentPersons = prev.filter(
              (p) => !result.persons.some((rp) => rp.id === p.id)
            );
            return [...result.persons, ...nonStudentPersons];
          });
          setGuardians(result.guardians);
        }

        // Sincronizar modalidades e graduações reais da academia ativa
        try {
          const [realArts, realBelts] = await Promise.all([
            studentService.fetchMartialArts(currentTenantId, true),
            studentService.fetchBeltRanks(currentTenantId),
          ]);
          if (isMounted) {
            if (realArts && realArts.length > 0) setMartialArts(realArts);
            if (realBelts && realBelts.length > 0) setBeltRanks(realBelts);
          }
        } catch (mErr) {
          console.warn('Aviso ao sincronizar modalidades/faixas do Supabase:', mErr);
        }

        // Sincronizar turmas, horários, frequência e tatamis reais da academia ativa
        try {
          const [loadedClasses, loadedEnrollments, loadedAttendances, loadedTatamis] = await Promise.all([
            classService.fetchClasses(currentTenantId),
            classService.fetchEnrollments(currentTenantId),
            attendanceService.fetchAttendances(currentTenantId),
            tatamiService.fetchTatamis(currentTenantId),
          ]);
          if (isMounted) {
            if (loadedClasses && loadedClasses.length > 0) setClasses(loadedClasses);
            if (loadedEnrollments) setEnrollments(loadedEnrollments);
            if (loadedAttendances && loadedAttendances.length > 0) setAttendances(loadedAttendances);
            if (loadedTatamis && loadedTatamis.length > 0) setTatamis(loadedTatamis);
          }
        } catch (cErr) {
          console.warn('Aviso ao sincronizar turmas/matrículas/frequência/tatamis do Supabase:', cErr);
        }

        // Sincronizar avaliações antropométricas reais da academia ativa
        try {
          const loadedAssessments = await assessmentService.fetchAssessments(currentTenantId);
          if (isMounted && loadedAssessments && loadedAssessments.length > 0) {
            setPhysicalAssessments(loadedAssessments);
            DataStore.savePhysicalAssessments(loadedAssessments);
          }
        } catch (aErr) {
          console.warn('Aviso ao sincronizar avaliações do Supabase:', aErr);
        }

        // Sincronizar mensalidades e cobranças reais da academia ativa
        try {
          const loadedInvoices = await financialService.fetchInvoices(currentTenantId);
          if (isMounted && loadedInvoices && loadedInvoices.length > 0) {
            setInvoices(loadedInvoices);
            DataStore.saveInvoices(loadedInvoices);
          }
        } catch (fErr) {
          console.warn('Aviso ao sincronizar dados financeiros do Supabase:', fErr);
        }
      } catch (err) {
        console.warn('Erro ao sincronizar alunos do banco:', err);
      } finally {
        if (isMounted) {
          setIsLoadingStudents(false);
        }
      }
    }

    loadSupabaseStudents();

    return () => {
      isMounted = false;
    };
  }, [currentTenantId]);

  const handleRefreshStudents = async () => {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(currentTenantId)) {
      return;
    }
    setIsLoadingStudents(true);
    try {
      const [result, loadedClasses, loadedEnrollments, loadedAssessments] = await Promise.all([
        studentService.fetchStudentsWithDetails(currentTenantId),
        classService.fetchClasses(currentTenantId),
        classService.fetchEnrollments(currentTenantId),
        assessmentService.fetchAssessments(currentTenantId),
      ]);
      if (result) {
        setStudents(result.students);
        DataStore.saveStudents(result.students);
        setPersons((prev) => {
          const nonStudentPersons = prev.filter(
            (p) => !result.persons.some((rp) => rp.id === p.id)
          );
          const next = [...result.persons, ...nonStudentPersons];
          DataStore.savePersons(next);
          return next;
        });
        setGuardians(result.guardians);
        DataStore.saveGuardianRelationships(result.guardians);
      }
      if (loadedClasses && loadedClasses.length > 0) setClasses(loadedClasses);
      if (loadedEnrollments) setEnrollments(loadedEnrollments);
      if (loadedAssessments && loadedAssessments.length > 0) {
        setPhysicalAssessments(loadedAssessments);
        DataStore.savePhysicalAssessments(loadedAssessments);
      }
    } catch (err) {
      console.warn('Erro ao atualizar dados do banco:', err);
    } finally {
      setIsLoadingStudents(false);
    }
  };

  const handleRefreshClasses = async () => {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(currentTenantId)) {
      return;
    }
    try {
      const [loadedClasses, loadedEnrollments] = await Promise.all([
        classService.fetchClasses(currentTenantId),
        classService.fetchEnrollments(currentTenantId),
      ]);
      if (loadedClasses) setClasses(loadedClasses);
      if (loadedEnrollments) setEnrollments(loadedEnrollments);
    } catch (err) {
      console.warn('Erro ao atualizar turmas/matrículas do Supabase:', err);
    }
  };

  const fallbackTenant: Tenant = {
    id: currentTenantId || 'tenant-kodokan',
    tradeName: 'Tatame Club Dojo',
    legalName: 'Tatame Club Dojo Ltda',
    cnpjOrCpf: '00.000.000/0001-00',
    adminName: 'Sensei Administrador',
    email: 'contato@tatameclub.com.br',
    phone: '(11) 98888-0000',
    whatsapp: '(11) 98888-0000',
    address: {
      street: 'Rua Principal',
      number: '100',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01000-000',
    },
    planId: 'trial',
    status: 'trial',
    trialStartedAt: new Date().toISOString(),
    trialExpiresAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    retentionDays: 60,
    settings: {
      defaultDueDay: 10,
      penaltyRate: 2,
      dailyInterestRate: 0.033,
      familyDiscount2ndMember: 15,
      multiArtDiscount: 20,
      customBrandColor: '#dc2626',
    },
  };

  const activeTenant: Tenant = tenants.find(t => t.id === currentTenantId) || tenants[0] || fallbackTenant;
  const tenantBranches = branches.filter(b => b.tenantId === currentTenantId);
  const authenticatedUserRecord = currentUserId ? users.find(u => u.id === currentUserId) || null : null;
  const currentUser: User = authenticatedUserRecord || {
    id: '',
    tenantId: currentTenantId,
    name: 'Visitante',
    email: '',
    role: 'student',
    phone: '',
    active: false,
  };

  // Supabase Auth Session listener
  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) return;

    const handleSessionUser = async (sessionUser: any) => {
      const userEmail = (sessionUser.email || '').trim().toLowerCase();
      if (isAuthorizedPlatformOwnerEmail(userEmail)) {
        const verification = await saasPlatformService.verifyPlatformAdminAuthorization({
          id: sessionUser.id,
          email: userEmail,
          name: sessionUser.user_metadata?.full_name,
        });
        if (verification.authorized && verification.user) {
          activeSessionUserIdRef.current = verification.user.id;
          setUsers(DataStore.getUsers());
          setCurrentUserId(verification.user.id);
          if (detectEnvironmentMode() === 'saas_admin_panel' && currentViewRef.current === 'public') {
            setCurrentView('superadmin');
          }
          return;
        }
      }

      const memberships = await authService.loadUserMemberships(sessionUser.id);
      if (memberships.length > 0) {
        const isAlreadyActiveSameUser =
          activeSessionUserIdRef.current === sessionUser.id && currentViewRef.current !== 'public';
        applyMembershipContext(sessionUser, memberships, {
          preserveNavigation: isAlreadyActiveSameUser,
        });
        try {
          localStorage.removeItem('tatame_pending_invite');
        } catch {
          // ignore
        }
      } else {
        // Usuário autenticado pelo Google/Supabase mas ainda sem membership vinculado
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const urlInvite = urlParams.get('invite');
          const pendingRaw = localStorage.getItem('tatame_pending_invite');
          if (urlInvite || pendingRaw) {
            setIsLoginOpen(true);
          }
        } catch {
          // ignore
        }
      }
    };

    // Limpar rascunhos temporários expirados (>12h) ao iniciar
    formDraftStore.purgeExpiredDrafts();

    // Aguardar e verificar sessão existente ao carregar o aplicativo (com suporte a hash OAuth)
    authService.getOrWaitForSession().then(async (session) => {
      if (session?.user) {
        await handleSessionUser(session.user);
      }
    });

    // Escutar eventos de login/logout em tempo real sem resetar a tela ao alternar abas (visibilitychange)
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        // Se a aba apenas recuperou o foco e o mesmo usuário já está autenticado em uma tela interna,
        // preserva integralmente a navegação, aba administrativa e formulários abertos.
        if (
          activeSessionUserIdRef.current === session.user.id &&
          currentViewRef.current !== 'public'
        ) {
          return;
        }
        await handleSessionUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        activeSessionUserIdRef.current = '';
        setCurrentUserId('');
        setCurrentView(detectEnvironmentMode() === 'saas_admin_panel' ? 'superadmin' : 'public');
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // Sincronizar configurações da academia ativa diretamente do Supabase quando aplicável
  useEffect(() => {
    let isMounted = true;
    if (!isSupabaseConfigured() || !isValidUUID(currentTenantId)) return;

    authService.fetchTenantSettings(currentTenantId).then((freshTenant) => {
      if (!isMounted || !freshTenant) return;
      setTenants((prev) => {
        const exists = prev.some((t) => t.id === freshTenant.id);
        const next = exists
          ? prev.map((t) => (t.id === freshTenant.id ? { ...t, ...freshTenant } : t))
          : [freshTenant, ...prev];
        DataStore.saveTenants(next);
        return next;
      });
    });

    return () => {
      isMounted = false;
    };
  }, [currentTenantId]);

  const applyMembershipContext = (
    user: any,
    memberships: UserMembership[],
    options?: { preserveNavigation?: boolean }
  ) => {
    // Quando a conta tem acesso ao portal e também vínculos antigos de equipe,
    // prioriza o destino de portal para não encaminhar o aluno ao painel administrativo.
    const rolePriority: Record<UserMembership['role'], number> = {
      student: 0,
      guardian: 1,
      owner: 2,
      branch_manager: 3,
      secretary: 4,
      financial: 5,
      instructor: 6,
    };
    const orderedMemberships = [...memberships].sort(
      (a, b) => rolePriority[a.role] - rolePriority[b.role]
    );
    const primary = orderedMemberships[0];
    if (!primary) return;

    activeSessionUserIdRef.current = user.id;

    const tenantData = primary.tenant;
    if (tenantData) {
      const loadedTenant = mapSupabaseRowToTenant({
        ...tenantData,
        id: primary.tenant_id,
        admin_name: tenantData.admin_name || user.user_metadata?.full_name || 'Administrador',
        email: tenantData.email || user.email || '',
      });

      setTenants((prev) => {
        const exists = prev.some((t) => t.id === primary.tenant_id);
        const next = exists
          ? prev.map((t) => (t.id === primary.tenant_id ? { ...t, ...loadedTenant } : t))
          : [loadedTenant, ...prev];
        DataStore.saveTenants(next);
        return next;
      });
    }

    const branchData = primary.branch;
    if (branchData) {
      setBranches((prev) => {
        if (!prev.some((b) => b.id === primary.branch_id)) {
          const loadedBranch: Branch = {
            id: primary.branch_id || 'branch-matriz',
            tenantId: primary.tenant_id,
            name: branchData.name || 'Unidade Matriz',
            isHeadquarter: branchData.is_headquarter ?? true,
            phone: '',
            email: user.email || '',
            address: '',
            managerName: user.user_metadata?.full_name || 'Gestor',
            active: true,
          };
          return [loadedBranch, ...prev];
        }
        return prev;
      });
    }

    const sameTenantMemberships = orderedMemberships.filter((m) => m.tenant_id === primary.tenant_id);
    const secondaryRoles = sameTenantMemberships.slice(1).map((m) => ({
      role: m.role,
      studentId: m.student_id || undefined,
      guardianPersonId: m.guardian_person_id || undefined,
    }));

    const studentMembership = sameTenantMemberships.find((m) => m.role === 'student' || m.student_id);
    const guardianMembership = sameTenantMemberships.find(
      (m) => m.role === 'guardian' || m.guardian_person_id
    );

    const authenticatedUser: User = {
      id: user.id,
      tenantId: primary.tenant_id,
      branchId: primary.branch_id || undefined,
      name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuário Autenticado',
      email: user.email || '',
      role: primary.role,
      phone: user.user_metadata?.phone || '',
      active: true,
      studentId: primary.student_id || studentMembership?.student_id || undefined,
      guardianPersonId:
        primary.guardian_person_id || guardianMembership?.guardian_person_id || undefined,
      secondaryRoles: secondaryRoles.length > 0 ? secondaryRoles : undefined,
    };

    setUsers((prev) => {
      const filtered = prev.filter((u) => u.id !== user.id);
      const next = [authenticatedUser, ...filtered];
      DataStore.saveUsers(next);
      return next;
    });

    setCurrentTenantId(primary.tenant_id);
    if (primary.branch_id) setCurrentBranchId(primary.branch_id);
    setCurrentUserId(user.id);

    if (options?.preserveNavigation) {
      return;
    }

    if (detectEnvironmentMode() === 'saas_admin_panel') {
      setCurrentView('superadmin');
      return;
    }

    if (primary.role === 'student') {
      setCurrentView('student_portal');
    } else if (primary.role === 'guardian') {
      setCurrentView('guardian_portal');
    } else {
      setCurrentView('admin');
      setAdminTab('overview');
    }
  };

  const handleAuthSuccess = (user: any, memberships: UserMembership[]) => {
    if (memberships && memberships.length > 0) {
      applyMembershipContext(user, memberships);
    } else {
      setIsRegisterOpen(true);
    }
  };

  const handleLogout = async () => {
    if (isSupabaseConfigured()) {
      await authService.signOut();
    }
    activeSessionUserIdRef.current = '';
    setCurrentUserId('');
    setCurrentView(detectEnvironmentMode() === 'saas_admin_panel' ? 'superadmin' : 'public');
  };

  // Handlers for User Switching & Login
  const handleSelectUser = (user: User) => {
    setCurrentUserId(user.id);
    setIsLoginOpen(false);

    if (user.role === 'superadmin') {
      setCurrentView('superadmin');
    } else if (user.role === 'student') {
      setCurrentTenantId(user.tenantId);
      setCurrentView('student_portal');
    } else if (user.role === 'guardian') {
      setCurrentTenantId(user.tenantId);
      setCurrentView('guardian_portal');
    } else {
      // Owner, Branch Manager, Secretary, Financial, Instructor
      setCurrentTenantId(user.tenantId);
      if (user.branchId) setCurrentBranchId(user.branchId);
      setCurrentView('admin');
      setAdminTab('overview');
    }
  };


  // Handlers for Registration via Supabase register_academy_atomic
  const handleRegisterAtomicSuccess = async (rpcResult: any, memberships: UserMembership[]) => {
    setIsRegisterOpen(false);

    const session = await authService.getSession();
    const user = session?.user || currentUser;

    if (memberships && memberships.length > 0) {
      applyMembershipContext(user, memberships);
    } else {
      if (session?.user) {
        const freshMemberships = await authService.loadUserMemberships(session.user.id);
        if (freshMemberships.length > 0) {
          applyMembershipContext(session.user, freshMemberships);
          return;
        }
      }
      if (rpcResult?.tenant_id) {
        setCurrentTenantId(rpcResult.tenant_id);
        if (rpcResult.branch_id) setCurrentBranchId(rpcResult.branch_id);
        setCurrentView('admin');
        setAdminTab('overview');
      }
    }
  };

  // Handlers for Registration (Provisionamento isolado de nova academia)
  const handleRegisterSuccess = (newTenant: Tenant, newBranch: Branch, newUser: User) => {
    setTenants(DataStore.getTenants());
    setBranches(DataStore.getBranches());
    setUsers(DataStore.getUsers());

    setCurrentTenantId(newTenant.id);
    setCurrentBranchId(newBranch.id);
    setCurrentUserId(newUser.id);
    setIsRegisterOpen(false);
    setCurrentView('admin');
    setAdminTab('overview');
  };

  // Handlers for Student Creation
  const handleSaveStudent = async (
    newStudent: Student,
    newPerson: Person,
    guardianPerson?: Person,
    relationship?: GuardianRelationship,
    payloadDetails?: CreateStudentPayload
  ) => {
    // 1. Prioridade para persistência real no Supabase
    if (isSupabaseConfigured() && supabase && isValidUUID(currentTenantId) && payloadDetails) {
      try {
        const result = await studentService.createStudent(payloadDetails);

        setStudents((prev) => [result.student, ...prev]);
        setPersons((prev) => {
          const toAdd = result.guardianPerson ? [result.person, result.guardianPerson] : [result.person];
          const filtered = prev.filter(
            (p) => p.id !== result.person.id && (!result.guardianPerson || p.id !== result.guardianPerson.id)
          );
          const next = [...toAdd, ...filtered];
          DataStore.savePersons(next);
          return next;
        });
        if (result.relationship) {
          setGuardians((prev) => {
            const next = [result.relationship!, ...prev];
            DataStore.saveGuardianRelationships(next);
            return next;
          });
        }

        // Cache local
        DataStore.saveStudents([result.student, ...students]);

        DataStore.logAudit(
          currentTenantId,
          currentUser.id,
          currentUser.name,
          'Matrícula de Aluno',
          'Student',
          result.student.id,
          `Matrícula do aluno(a) ${result.person.fullName} confirmada.`
        );

        await handleRefreshStudents();
        setIsNewStudentOpen(false);
        return;
      } catch (err: any) {
        console.error('Falha na persistência no Supabase:', err);
        throw err;
      }
    }

    // 2. Fallback localStorage (modo demonstração local)
    const updatedStudents = [...students, newStudent];
    const personsMap = new Map(persons.map((p) => [p.id, p]));
    personsMap.set(newPerson.id, newPerson);
    if (guardianPerson) {
      personsMap.set(guardianPerson.id, guardianPerson);
    }
    const updatedPersons = Array.from(personsMap.values());
    const updatedGuardians = relationship ? [...guardians, relationship] : guardians;

    // Generate initial invoice for this student
    const membershipPlans = DataStore.getMembershipPlans(currentTenantId);
    const selectedPlanForNew = newStudent.planId
      ? membershipPlans.find((p) => p.id === newStudent.planId)
      : null;
    let originalAmount = newStudent.monthlyFee;
    let discountAmount = 0;
    let discountDesc: string | undefined = undefined;
    if (selectedPlanForNew) {
      originalAmount = selectedPlanForNew.amount;
      if (selectedPlanForNew.discountPercentage && selectedPlanForNew.discountPercentage > 0) {
        discountAmount = Math.round((originalAmount * (selectedPlanForNew.discountPercentage / 100)) * 100) / 100;
        discountDesc = selectedPlanForNew.discountDescription || `${selectedPlanForNew.discountPercentage}% desconto do plano`;
      }
    }

    const newInvoice: Invoice = {
      id: `inv-${Date.now()}`,
      tenantId: currentTenantId,
      branchId: currentBranchId,
      studentId: newStudent.id,
      financialGuardianId: guardianPerson?.id,
      planId: newStudent.planId,
      competence: getCurrentCompetence(),
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(Math.min(28, Math.max(1, selectedPlanForNew?.dueDay || activeTenant.settings.defaultDueDay || 10))).padStart(2, '0')}`,
      originalAmount: originalAmount,
      discountAmount: discountAmount,
      discountDescription: discountDesc,
      penaltyAndInterestAmount: 0,
      finalAmount: newStudent.monthlyFee,
      paidAmount: 0,
      balance: newStudent.monthlyFee,
      status: 'pending',
      pixCode: `00020126580014br.gov.bcb.pix0136${Date.now()}5204000053039865406${newStudent.monthlyFee}.005802BR5925${activeTenant.tradeName.substring(0, 25).toUpperCase()}6009SAO PAULO62070503***6304${Math.floor(1000 + Math.random() * 9000)}`,
      auditTrail: [
        {
          date: new Date().toISOString(),
          action: 'Emissão inicial com matrícula',
          userName: currentUser.name,
        },
      ],
    };

    const updatedInvoices = [newInvoice, ...invoices];

    DataStore.saveStudents(updatedStudents);
    DataStore.savePersons(updatedPersons);
    DataStore.saveGuardianRelationships(updatedGuardians);
    DataStore.saveInvoices(updatedInvoices);

    setStudents(updatedStudents);
    setPersons(updatedPersons);
    setGuardians(updatedGuardians);
    setInvoices(updatedInvoices);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Matrícula de Aluno',
      'Student',
      newStudent.id,
      `Matriculado o aluno ${newPerson.fullName} com mensalidade ${newStudent.monthlyFee} BRL.`
    );

    setIsNewStudentOpen(false);
  };

  const handleOpenCreateStudent = () => {
    // Validação estrita dos limites efetivos da licença (plano ou limite customizado)
    const effectiveLimits = saasPlatformService.getEffectiveLimits(activeTenant.id);
    const maxStudents = effectiveLimits.maxStudents;

    if (students.length >= maxStudents && currentUser.role !== 'superadmin') {
      alert(`Limite de alunos cadastrados atingido para sua licença (${students.length}/${maxStudents} alunos). Faça upgrade do seu plano para continuar matriculando.`);
      setIsUpgradePlanOpen(true);
      return;
    }

    setEditingStudent(null);
    setIsNewStudentOpen(true);
  };

  const handleOpenEditStudent = (student: Student) => {
    setEditingStudent(student);
    setIsNewStudentOpen(true);
  };

  // Handlers for Student Update
  const handleUpdateStudent = async (
    updatedStudent: Student,
    updatedPerson: Person,
    guardianPerson?: Person,
    relationship?: GuardianRelationship,
    payloadDetails?: UpdateStudentPayload
  ) => {
    // 1. Prioridade para persistência real no Supabase
    const activeTenantId = payloadDetails?.tenantId || currentTenantId;
    if (isSupabaseConfigured() && supabase && isValidUUID(activeTenantId) && payloadDetails) {
      try {
        const result = await studentService.updateStudent(payloadDetails);

        setStudents((prev) => prev.map((s) => (s.id === result.student.id ? result.student : s)));
        setPersons((prev) => {
          const map = new Map(prev.map((p) => [p.id, p]));
          map.set(result.person.id, result.person);
          if (result.guardianPerson) {
            map.set(result.guardianPerson.id, result.guardianPerson);
          }
          const next = Array.from(map.values());
          DataStore.savePersons(next);
          return next;
        });

        if (result.relationship) {
          setGuardians((prev) => {
            const filtered = prev.filter(
              (g) => g.id !== result.relationship!.id && g.studentId !== result.student.id
            );
            const nextList = [result.relationship!, ...filtered];
            DataStore.saveGuardianRelationships(nextList);
            return nextList;
          });
        } else if (payloadDetails?.hasGuardian === false) {
          setGuardians((prev) => {
            const nextList = prev.filter((g) => g.studentId !== result.student.id);
            DataStore.saveGuardianRelationships(nextList);
            return nextList;
          });
        }

        // Cache local
        DataStore.saveStudents(students.map((s) => (s.id === result.student.id ? result.student : s)));

        // Se houve alteração de plano, sincronizar faturas futuras e proteger histórico
        const oldPlanId = editingStudent?.planId || null;
        const newPlanId = payloadDetails.planId || null;
        const isPlanChanged = oldPlanId !== newPlanId;

        if (isPlanChanged) {
          try {
            const planRes = await financialService.updateStudentPlanAndFutureInvoices({
              studentId: result.student.id,
              newPlanId: newPlanId,
              tenantId: activeTenantId,
              effectiveCompetence: payloadDetails.effectiveCompetence,
              newMonthlyFee: payloadDetails.monthlyFee,
              currentUserName: currentUser.name,
            });
            if (planRes?.updatedInvoices) {
              setInvoices(planRes.updatedInvoices);
            }
          } catch (planErr) {
            console.error('Falha ao atualizar mensalidades futuras no Supabase:', planErr);
            throw planErr;
          }
        }

        await handleRefreshStudents();
        setIsNewStudentOpen(false);
        setEditingStudent(null);
        return;
      } catch (err: any) {
        console.error('Falha ao atualizar aluno no Supabase:', err);
        throw err;
      }
    }

    // 2. Fallback localStorage (modo demonstração local)
    const oldPlanId = editingStudent?.planId || null;
    const newPlanId = payloadDetails?.planId || null;
    const isPlanChanged = oldPlanId !== newPlanId;

    // Se houve alteração de plano no modo local, sincronizar faturas futuras e proteger histórico
    if (isPlanChanged && payloadDetails) {
      try {
        const planRes = await financialService.updateStudentPlanAndFutureInvoices({
          studentId: updatedStudent.id,
          newPlanId: newPlanId,
          tenantId: currentTenantId,
          effectiveCompetence: payloadDetails.effectiveCompetence,
          newMonthlyFee: payloadDetails.monthlyFee,
          currentUserName: currentUser.name,
        });
        if (planRes?.updatedInvoices) {
          setInvoices(planRes.updatedInvoices);
        }
      } catch (planErr) {
        console.error('Falha ao atualizar mensalidades futuras locais:', planErr);
        throw planErr;
      }
    }

    const updatedStudentsList = students.map((s) => (s.id === updatedStudent.id ? updatedStudent : s));
    const updatedPersonsList = persons.map((p) => {
      if (p.id === updatedPerson.id) return updatedPerson;
      if (guardianPerson && p.id === guardianPerson.id) return guardianPerson;
      return p;
    });
    if (guardianPerson && !updatedPersonsList.some((p) => p.id === guardianPerson.id)) {
      updatedPersonsList.push(guardianPerson);
    }
    const updatedGuardiansList = relationship
      ? [relationship, ...guardians.filter((g) => g.studentId !== updatedStudent.id)]
      : payloadDetails?.hasGuardian === false
      ? guardians.filter((g) => g.studentId !== updatedStudent.id)
      : guardians;

    DataStore.saveStudents(updatedStudentsList);
    DataStore.savePersons(updatedPersonsList);
    DataStore.saveGuardianRelationships(updatedGuardiansList);

    setStudents(updatedStudentsList);
    setPersons(updatedPersonsList);
    setGuardians(updatedGuardiansList);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Edição de Aluno',
      'Student',
      updatedStudent.id,
      `Dados do aluno ${updatedPerson.fullName} atualizados com sucesso.`
    );

    setIsNewStudentOpen(false);
    setEditingStudent(null);
  };

  const handleUpdatePerson = (updatedPerson: Person) => {
    setPersons((prev) => {
      const next = prev.map((p) => (p.id === updatedPerson.id ? updatedPerson : p));
      DataStore.savePersons(next);
      return next;
    });
  };

  const handleSaveAssessment = (saved: PhysicalAssessment) => {
    setPhysicalAssessments((prev) => {
      const exists = prev.some((a) => a.id === saved.id);
      const next = exists
        ? prev.map((a) => (a.id === saved.id ? saved : a))
        : [saved, ...prev];
      DataStore.savePhysicalAssessments(next);
      return next;
    });
  };

  const handleDeleteAssessment = (id: string) => {
    setPhysicalAssessments((prev) => {
      const next = prev.filter((a) => a.id !== id);
      DataStore.savePhysicalAssessments(next);
      return next;
    });
  };

  const handleResetAcademyData = async () => {
    try {
      setIsLoadingStudents(true);
      await studentService.resetAcademyData(currentTenantId);
      await handleRefreshStudents();
      setPersons(DataStore.getPersons(currentTenantId));
      setStudents(DataStore.getStudents(currentTenantId));
      setGuardians(DataStore.getGuardianRelationships(currentTenantId));
    } catch (err: any) {
      console.error('Erro ao reiniciar dados do dojo:', err);
    } finally {
      setIsLoadingStudents(false);
    }
  };

  // Handlers for Attendance
  const handleRefreshAttendance = async () => {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(currentTenantId)) {
      setAttendances(DataStore.getAttendances(currentTenantId));
      return;
    }
    try {
      const fresh = await attendanceService.fetchAttendances(currentTenantId);
      if (fresh) {
        setAttendances(fresh);
      }
    } catch (err) {
      console.warn('Erro ao atualizar chamadas:', err);
    }
  };

  const handleRefreshTatamis = async () => {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(currentTenantId)) {
      setTatamis(DataStore.getTatamis(currentTenantId));
      return;
    }
    try {
      const fresh = await tatamiService.fetchTatamis(currentTenantId);
      if (fresh && fresh.length > 0) {
        setTatamis(fresh);
      }
    } catch (err) {
      console.warn('Erro ao atualizar tatamis:', err);
    }
  };

  const handleSaveAttendance = async (records: AttendanceRecord[]) => {
    if (selectedClassForAttendance && isSupabaseConfigured() && supabase && isValidUUID(currentTenantId)) {
      try {
        await attendanceService.saveAttendance({
          tenantId: currentTenantId,
          classGroupId: selectedClassForAttendance.id,
          date: records[0]?.date || new Date().toISOString().split('T')[0],
          startTime: selectedClassForAttendance.startTime,
          endTime: selectedClassForAttendance.endTime,
          instructorName: selectedClassForAttendance.headInstructorName,
          sessionStatus: 'completed',
          records: records.map((r) => ({
            studentId: r.studentId,
            status: r.status,
            notes: r.notes,
          })),
          currentUser,
        });
      } catch (err) {
        console.warn('Aviso: falha ao salvar chamada no Supabase via modal (salvando localmente):', err);
      }
    }

    const updated = [...records, ...attendances.filter(a => !(a.classGroupId === selectedClassForAttendance?.id && a.date === records[0]?.date))];
    DataStore.saveAttendances(updated);
    setAttendances(updated);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Registro de Chamada',
      'AttendanceRecord',
      selectedClassForAttendance?.id || 'class',
      `Chamada realizada para a turma ${selectedClassForAttendance?.name} (${records.length} alunos verificados).`
    );
  };

  // Handlers for Invoice settlement
  const handleSettleInvoice = (updatedInvoice: Invoice) => {
    setInvoices((prev) => {
      const next = prev.some((inv) => inv.id === updatedInvoice.id)
        ? prev.map((inv) => (inv.id === updatedInvoice.id ? updatedInvoice : inv))
        : [updatedInvoice, ...prev];
      DataStore.saveInvoices(next);
      return next;
    });

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Baixa Financeira',
      'Invoice',
      updatedInvoice.id,
      `Baixa registrada no valor recebido de ${updatedInvoice.paidAmount} BRL (Saldo restante: ${updatedInvoice.balance} BRL).`
    );
  };

  const handleRefreshFinancial = async () => {
    if (!isSupabaseConfigured() || !supabase || !isValidUUID(currentTenantId)) {
      setInvoices(DataStore.getInvoices(currentTenantId));
      return;
    }
    try {
      const fresh = await financialService.fetchInvoices(currentTenantId);
      if (fresh) {
        setInvoices(fresh);
        DataStore.saveInvoices(fresh);
      }
    } catch (err) {
      console.warn('Erro ao atualizar mensalidades:', err);
    }
  };

  // Handlers for Martial Arts
  const handleAddMartialArt = (art: MartialArt) => {
    const updated = [...martialArts, art];
    DataStore.saveMartialArts(updated);
    setMartialArts(updated);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Criação de Modalidade',
      'MartialArt',
      art.id,
      `Nova modalidade ${art.name} cadastrada.`
    );
  };

  const handleUpdateMartialArt = (art: MartialArt) => {
    const updated = martialArts.map((m) => (m.id === art.id ? art : m));
    DataStore.saveMartialArts(updated);
    setMartialArts(updated);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Edição de Modalidade',
      'MartialArt',
      art.id,
      `Modalidade ${art.name} atualizada.`
    );
  };

  const handleToggleMartialArtStatus = (art: MartialArt) => {
    const updated = martialArts.map((m) => (m.id === art.id ? art : m));
    DataStore.saveMartialArts(updated);
    setMartialArts(updated);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Alteração de Status',
      'MartialArt',
      art.id,
      `Modalidade ${art.name} alterada para status ${art.status}.`
    );
  };

  const handleDeleteMartialArt = (id: string) => {
    const artToDelete = martialArts.find((m) => m.id === id);
    const updatedArts = martialArts.filter((m) => m.id !== id);
    const updatedBelts = beltRanks.filter((b) => b.martialArtId !== id);

    DataStore.saveMartialArts(updatedArts);
    DataStore.saveBeltRanks(updatedBelts);
    setMartialArts(updatedArts);
    setBeltRanks(updatedBelts);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Exclusão de Modalidade',
      'MartialArt',
      id,
      `Modalidade ${artToDelete?.name || id} removida com suas faixas.`
    );
  };

  // Handlers for Belt Rank addition, edit, delete, reorder
  const handleAddBeltRank = (rank: BeltRank) => {
    const updated = [...beltRanks, rank];
    DataStore.saveBeltRanks(updated);
    setBeltRanks(updated);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Criação de Faixa',
      'BeltRank',
      rank.id,
      `Nova graduação ${rank.name} cadastrada.`
    );
  };

  const handleUpdateBeltRank = (rank: BeltRank) => {
    const updated = beltRanks.map((b) => (b.id === rank.id ? rank : b));
    DataStore.saveBeltRanks(updated);
    setBeltRanks(updated);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Edição de Faixa',
      'BeltRank',
      rank.id,
      `Graduação ${rank.name} atualizada.`
    );
  };

  const handleDeleteBeltRank = (id: string) => {
    const beltToDelete = beltRanks.find((b) => b.id === id);
    const updated = beltRanks.filter((b) => b.id !== id);
    DataStore.saveBeltRanks(updated);
    setBeltRanks(updated);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Exclusão de Faixa',
      'BeltRank',
      id,
      `Graduação ${beltToDelete?.name || id} removida.`
    );
  };

  const handleReorderBeltRanks = (artId: string, orderedRanks: BeltRank[]) => {
    const otherBelts = beltRanks.filter((b) => b.martialArtId !== artId);
    const updated = [...otherBelts, ...orderedRanks];
    DataStore.saveBeltRanks(updated);
    setBeltRanks(updated);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Reordenação de Faixas',
      'BeltRank',
      artId,
      `Sequência de graduações reordenada para modalidade.`
    );
  };

  const handleRefreshModalities = async () => {
    try {
      const [realArts, realBelts] = await Promise.all([
        studentService.fetchMartialArts(currentTenantId, true),
        studentService.fetchBeltRanks(currentTenantId),
      ]);
      if (realArts && realArts.length > 0) setMartialArts(realArts);
      if (realBelts && realBelts.length > 0) setBeltRanks(realBelts);
    } catch (err) {
      console.warn('Erro ao recarregar modalidades/faixas:', err);
    }
  };

  // Handlers for Classes
  const handleAddClass = (newClass: ClassGroup) => {
    setClasses((prev) => {
      const exists = prev.some((c) => c.id === newClass.id);
      const updated = exists ? prev.map((c) => (c.id === newClass.id ? newClass : c)) : [newClass, ...prev];
      DataStore.saveClasses(updated);
      return updated;
    });

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Criação/Edição de Turma',
      'ClassGroup',
      newClass.id,
      `Turma ${newClass.name} salva no ${newClass.tatamiRoom}.`
    );
  };

  // Handlers for Library Items
  const handleAddLibraryItem = (newItem: DigitalLibraryItem) => {
    const updated = [newItem, ...libraryItems];
    DataStore.saveLibraryItems(updated);
    setLibraryItems(updated);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Publicação Técnica',
      'DigitalLibraryItem',
      newItem.id,
      `Publicado material: ${newItem.title}.`
    );
  };

  // Handlers for Exam Creation and Approval
  const handleAddExam = (newExam: BeltExamEvent) => {
    const updated = [newExam, ...beltExams];
    DataStore.saveBeltExams(updated);
    setBeltExams(updated);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Agendamento de Exame',
      'BeltExamEvent',
      newExam.id,
      `Exame marcado para ${newExam.examDate}.`
    );
  };

  const handleApproveCandidate = (regId: string, score: number, notes: string) => {
    const reg = examRegistrations.find(r => r.id === regId);
    if (!reg) return;

    const updatedRegs = examRegistrations.map((r) =>
      r.id === regId ? { ...r, resultStatus: 'approved' as const, score, examinerNotes: notes } : r
    );
    DataStore.saveExamRegistrations(updatedRegs);
    setExamRegistrations(updatedRegs);

    // Promote student rank
    const updatedStudents = students.map((s) => {
      if (s.id === reg.studentId) {
        return {
          ...s,
          currentGraduations: [
            {
              martialArtId: 'art-judo',
              martialArtName: 'Judô',
              beltId: reg.targetBeltId,
              beltName: reg.targetBelt,
              beltColorHex: '#f97316', // Orange
              graduatedAt: new Date().toISOString().split('T')[0],
            },
            ...s.currentGraduations,
          ],
        };
      }
      return s;
    });

    DataStore.saveStudents(updatedStudents);
    setStudents(updatedStudents);

    DataStore.logAudit(
      currentTenantId,
      currentUser.id,
      currentUser.name,
      'Graduação Aprovada',
      'Student',
      reg.studentId,
      `Aluno ${reg.studentName} aprovado pela banca com nota ${score} e promovido a ${reg.targetBelt}.`
    );
  };

  // Handlers for Competitions
  const handleAddCompetition = (comp: Competition) => {
    const updated = [comp, ...competitions];
    DataStore.saveCompetitions(updated);
    setCompetitions(updated);
  };

  // Handlers for Branches
  const handleAddBranch = (branch: Branch) => {
    const updated = [...branches, branch];
    DataStore.saveBranches(updated);
    setBranches(updated);
  };

  // Handlers for Tenant settings (Persists to Supabase and local cache)
  const handleSaveTenant = async (updatedTenant: Tenant) => {
    const savedTenant = await authService.saveTenantSettings(updatedTenant);
    setTenants((prev) => {
      const updatedTenants = prev.map((t) => (t.id === savedTenant.id ? savedTenant : t));
      DataStore.saveTenants(updatedTenants);
      return updatedTenants;
    });
  };

  // Handlers for Plan Upgrade
  const handleConfirmUpgrade = (newPlanId: SaaSPlanId) => {
    const updatedTenant: Tenant = {
      ...activeTenant,
      planId: newPlanId,
      status: 'active',
    };
    handleSaveTenant(updatedTenant);
  };

  // Handlers for Superadmin updates
  const handleUpdatePlans = (updatedPlans: SaaSPlan[]) => {
    DataStore.savePlans(updatedPlans);
    setPlans(updatedPlans);
  };

  const handleUpdateTenantStatus = (tenantId: string, status: Tenant['status']) => {
    const updated = tenants.map(t => (t.id === tenantId ? { ...t, status } : t));
    DataStore.saveTenants(updated);
    setTenants(updated);
  };

  const handleOpenTerms = () => {
    setLegalModalTab('terms');
    setIsLegalModalOpen(true);
  };

  const handleOpenPrivacy = () => {
    setLegalModalTab('privacy');
    setIsLegalModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-red-600 selection:text-white">
      {/* VIEW 1: PUBLIC COMMERCIAL LANDING PAGE */}
      {currentView === 'public' && (
        <>
          <PublicNavbar
            onOpenRegister={() => setIsRegisterOpen(true)}
            onOpenLogin={() => setIsLoginOpen(true)}
          />
          <main>
            <HeroSection
              onOpenRegister={() => setIsRegisterOpen(true)}
              onOpenLogin={() => setIsLoginOpen(true)}
            />
            <FeaturesSection />
            <PricingSection
              plans={plans}
              onSelectPlan={(planId) => {
                if (planId === 'trial') {
                  setIsRegisterOpen(true);
                } else {
                  setIsRegisterOpen(true);
                }
              }}
            />
            <FAQSection />
          </main>
          <PublicFooter
            onOpenTerms={handleOpenTerms}
            onOpenPrivacy={handleOpenPrivacy}
            onOpenSaaSPanel={() => {
              try {
                const basePath = window.location.pathname || '/';
                window.history.pushState({}, '', `${basePath}?env=painel`);
              } catch {
                // ignore history errors in sandboxed iframes
              }
              setCurrentView('superadmin');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </>
      )}

      {/* VIEW 2: TENANT ACADEMY ADMIN CONSOLE */}
      {currentView === 'admin' && (
        <DashboardLayout
          currentUser={currentUser}
          tenant={activeTenant}
          branches={tenantBranches}
          currentBranchId={currentBranchId}
          onSelectBranch={setCurrentBranchId}
          activeTab={adminTab}
          onSelectTab={setAdminTab}
          onSwitchPersona={() => setIsLoginOpen(true)}
          onLogout={handleLogout}
          onUpgradePlan={() => setIsUpgradePlanOpen(true)}
          onNavigateToSuperAdmin={() => setCurrentView('superadmin')}
        >
          {adminTab === 'overview' && (
            <OverviewDashboard
              tenant={activeTenant}
              students={students}
              classes={classes}
              invoices={invoices}
              exams={beltExams}
              auditLogs={auditLogs}
              onNavigateTab={setAdminTab}
              onOpenNewStudent={handleOpenCreateStudent}
            />
          )}

          {adminTab === 'students' && (
            <StudentsView
              students={students}
              persons={persons}
              guardians={guardians}
              assessments={physicalAssessments}
              healthRecords={healthRecords}
              belts={beltRanks}
              martialArts={martialArts}
              classes={classes}
              enrollments={enrollments}
              isLoading={isLoadingStudents}
              tenantId={currentTenantId}
              currentUser={currentUser}
              onOpenCreateStudent={handleOpenCreateStudent}
              onEditStudent={handleOpenEditStudent}
              onUpdatePerson={handleUpdatePerson}
              onResetData={handleResetAcademyData}
              onSaveAssessment={handleSaveAssessment}
              onDeleteAssessment={handleDeleteAssessment}
            />
          )}

          {adminTab === 'guardians' && (
            <GuardiansView
              tenantId={currentTenantId}
              guardians={guardians}
              persons={persons}
              students={students}
              isLoading={isLoadingStudents}
              error={null}
              onRefreshData={handleRefreshStudents}
              onOpenStudentDetail={(student) => {
                handleOpenEditStudent(student);
              }}
              onUpdatePerson={handleUpdatePerson}
              onResetData={handleResetAcademyData}
            />
          )}

          {adminTab === 'modalities' && (
            <ModalitiesView
              tenantId={currentTenantId}
              currentUser={currentUser}
              martialArts={martialArts}
              beltRanks={beltRanks}
              onAddBeltRank={handleAddBeltRank}
              onUpdateBeltRank={handleUpdateBeltRank}
              onDeleteBeltRank={handleDeleteBeltRank}
              onReorderBeltRanks={handleReorderBeltRanks}
              onAddMartialArt={handleAddMartialArt}
              onUpdateMartialArt={handleUpdateMartialArt}
              onToggleMartialArtStatus={handleToggleMartialArtStatus}
              onDeleteMartialArt={handleDeleteMartialArt}
              onRefresh={handleRefreshModalities}
            />
          )}

          {adminTab === 'classes' && (
            <ClassesView
              classes={classes}
              enrollments={enrollments}
              martialArts={martialArts}
              beltRanks={beltRanks}
              students={students}
              persons={persons}
              branches={branches}
              instructors={users.filter(u => u.role === 'instructor' || u.role === 'owner')}
              tenantId={currentTenantId}
              tenantName={activeTenant.tradeName}
              tatamis={tatamis}
              onOpenAttendance={(cls) => {
                setSelectedClassForAttendance(cls);
                setIsAttendanceModalOpen(true);
              }}
              onAddClass={handleAddClass}
              onRefreshData={handleRefreshClasses}
              onNavigateToOccupancy={() => setAdminTab('tatami_occupancy')}
            />
          )}

          {adminTab === 'attendance' && (
            <AttendanceView
              classes={classes}
              enrollments={enrollments}
              students={students}
              persons={persons}
              martialArts={martialArts}
              beltRanks={beltRanks}
              branches={branches}
              currentUser={currentUser}
              tenantId={currentTenantId}
              tenantName={activeTenant.tradeName}
              initialClassGroup={selectedClassForAttendance}
              onRefreshData={handleRefreshAttendance}
              onNavigateToClasses={() => setAdminTab('classes')}
            />
          )}

          {adminTab === 'tatami_occupancy' && (
            <TatamiOccupancyView
              classes={classes}
              martialArts={martialArts}
              instructors={users.filter(u => u.role === 'instructor' || u.role === 'owner')}
              branches={tenantBranches}
              currentBranchId={currentBranchId}
              tenantName={activeTenant.tradeName}
              tenantId={currentTenantId}
              tatamis={tatamis}
              onRefreshTatamis={handleRefreshTatamis}
              onOpenAttendance={(cls) => {
                setSelectedClassForAttendance(cls);
                setIsAttendanceModalOpen(true);
              }}
              onNavigateToClasses={() => setAdminTab('classes')}
            />
          )}

          {adminTab === 'financial' && (
            <FinancialView
              tenant={activeTenant}
              invoices={invoices}
              students={students}
              persons={persons}
              classes={classes}
              branches={tenantBranches}
              currentBranchId={currentBranchId}
              currentUser={currentUser}
              onRefreshData={handleRefreshFinancial}
              onSettleInvoice={handleSettleInvoice}
            />
          )}

          {adminTab === 'library' && (
            <DigitalLibraryView
              libraryItems={libraryItems}
              beltRanks={beltRanks}
              martialArts={martialArts}
              tenantId={currentTenantId}
              onAddLibraryItem={handleAddLibraryItem}
              onRefresh={() => {
                setLibraryItems(DataStore.getLibraryItems(currentTenantId));
              }}
            />
          )}

          {adminTab === 'exams' && (
            <BeltExamsView
              tenant={activeTenant}
              exams={beltExams}
              registrations={examRegistrations}
              students={students}
              persons={persons}
              beltRanks={beltRanks}
              onAddExam={handleAddExam}
              onApproveCandidate={handleApproveCandidate}
            />
          )}

          {adminTab === 'competitions' && (
            <CompetitionsView
              competitions={competitions}
              athletes={competitionAthletes}
              students={students}
              persons={persons}
              onAddCompetition={handleAddCompetition}
              onAddAthlete={() => {}}
            />
          )}

          {adminTab === 'branches' && (
            <BranchesView
              branches={tenantBranches}
              tenant={activeTenant}
              plans={plans}
              onAddBranch={handleAddBranch}
              onUpgradePlan={() => setIsUpgradePlanOpen(true)}
            />
          )}

          {adminTab === 'team_users' && (
            <TeamUsersView
              tenant={activeTenant}
              currentUser={currentUser}
              branches={tenantBranches}
              selectedBranchId={currentBranchId}
              onOpenPlanUpgrade={() => setIsUpgradePlanOpen(true)}
              onUserUpdated={() => setUsers(DataStore.getUsers())}
            />
          )}

          {adminTab === 'reports' && (
            <ReportsView
              tenant={activeTenant}
              students={students}
              persons={persons}
              invoices={invoices}
              attendances={attendances}
              belts={beltRanks}
              onUpdateTenantLogo={(newLogoUrl) => {
                const updated = { ...activeTenant, logoUrl: newLogoUrl };
                handleSaveTenant(updated);
              }}
            />
          )}

          {adminTab === 'settings' && (
            <SettingsView
              tenant={activeTenant}
              plans={plans}
              onSaveTenant={handleSaveTenant}
              onUpgradePlan={() => setIsUpgradePlanOpen(true)}
            />
          )}
        </DashboardLayout>
      )}

      {/* VIEW 3: STUDENT PORTAL */}
      {currentView === 'student_portal' && (
        <StudentLayout
          currentUser={{ ...currentUser, role: 'student' }}
          tenant={activeTenant}
          canSwitchPortalRole={(() => {
            const ctx = portalAccessService.resolveAuthorizedPortalContext({
              user: currentUser,
              tenantId: activeTenant.id,
              students,
              persons,
              guardians,
            });
            return ctx.hasDualPortalRole;
          })()}
          onSwitchPersona={() => {
            const ctx = portalAccessService.resolveAuthorizedPortalContext({
              user: currentUser,
              tenantId: activeTenant.id,
              students,
              persons,
              guardians,
            });
            if (ctx.hasDualPortalRole) {
              setCurrentView('guardian_portal');
            } else {
              setIsLoginOpen(true);
            }
          }}
          onLogout={handleLogout}
          onOpenTerms={() => openLegalModal('terms')}
          onOpenPrivacy={() => openLegalModal('privacy')}
        >
          {(() => {
            const ctx = portalAccessService.resolveAuthorizedPortalContext({
              user: currentUser,
              tenantId: activeTenant.id,
              students,
              persons,
              guardians,
            });
            const currentStudent =
              ctx.studentRecord ||
              students.find((s) => s.id === currentUser.studentId && s.tenantId === activeTenant.id) ||
              students.find((s) => s.userId === currentUser.id && s.tenantId === activeTenant.id) ||
              null;
            const currentPerson =
              ctx.studentPerson ||
              (currentStudent ? persons.find((p) => p.id === currentStudent.personId) || null : null) ||
              persons.find((p) => p.userId === currentUser.id && p.tenantId === activeTenant.id) ||
              null;
            return (
              <StudentDashboard
                student={currentStudent}
                person={currentPerson}
                classes={classes}
                invoices={invoices}
                attendances={attendances}
                libraryItems={libraryItems}
                enrollments={enrollments}
                assessments={physicalAssessments}
                onOpenLibraryItem={() => {}}
                onPersonUpdated={(updatedPerson) => {
                  setPersons((prev) =>
                    prev.map((p) => (p.id === updatedPerson.id ? updatedPerson : p))
                  );
                }}
              />
            );
          })()}
        </StudentLayout>
      )}

      {/* VIEW 4: GUARDIAN PORTAL */}
      {currentView === 'guardian_portal' && (
        <StudentLayout
          currentUser={{ ...currentUser, role: 'guardian' }}
          tenant={activeTenant}
          canSwitchPortalRole={(() => {
            const ctx = portalAccessService.resolveAuthorizedPortalContext({
              user: currentUser,
              tenantId: activeTenant.id,
              students,
              persons,
              guardians,
            });
            return ctx.hasDualPortalRole;
          })()}
          onSwitchPersona={() => {
            const ctx = portalAccessService.resolveAuthorizedPortalContext({
              user: currentUser,
              tenantId: activeTenant.id,
              students,
              persons,
              guardians,
            });
            if (ctx.hasDualPortalRole) {
              setCurrentView('student_portal');
            } else {
              setIsLoginOpen(true);
            }
          }}
          onLogout={handleLogout}
          onOpenTerms={() => openLegalModal('terms')}
          onOpenPrivacy={() => openLegalModal('privacy')}
        >
          {(() => {
            const ctx = portalAccessService.resolveAuthorizedPortalContext({
              user: currentUser,
              tenantId: activeTenant.id,
              students,
              persons,
              guardians,
            });
            const guardianPerson =
              ctx.guardianPerson ||
              persons.find((p) => p.id === currentUser.guardianPersonId && p.tenantId === activeTenant.id) ||
              persons.find((p) => p.userId === currentUser.id && p.tenantId === activeTenant.id) ||
              null;
            return (
              <GuardianPortal
                guardianPerson={guardianPerson}
                relationships={guardians}
                students={students}
                persons={persons}
                invoices={invoices}
                classes={classes}
                attendances={attendances}
                healthRecords={healthRecords}
              />
            );
          })()}
        </StudentLayout>
      )}

      {/* VIEW 5: CENTRAL SAAS SUPERADMIN CONSOLE (PAINEL.TATAMECLUB.COM.BR) */}
      {currentView === 'superadmin' && (
        (!authenticatedUserRecord ||
          currentUser.role !== 'superadmin' ||
          !isAuthorizedPlatformOwnerEmail(currentUser.email)) ? (
          <PlatformAdminAuthView
            currentUser={authenticatedUserRecord}
            onAuthenticatedSuperAdmin={(superAdminUser) => {
              setUsers(DataStore.getUsers());
              setCurrentUserId(superAdminUser.id);
              setCurrentView('superadmin');
            }}
            onReturnToMainSite={() => {
              try {
                const cleanPath = (window.location.pathname || '/').replace(/\/painel\/?$/i, '/') || '/';
                window.history.pushState({}, '', cleanPath);
              } catch {
                // ignore history errors in sandboxed iframes
              }
              setCurrentView(authenticatedUserRecord ? 'admin' : 'public');
            }}
          />
        ) : (
          <div className="min-h-screen p-4 sm:p-6 lg:p-8 bg-slate-950">
            <div className="max-w-7xl mx-auto flex items-center justify-between pb-6 border-b border-slate-800 mb-6">
              <div className="flex items-center gap-2.5">
                <span className="font-bold text-lg text-white">Tatame Club · SaaS Control</span>
                <span className="text-xs bg-amber-500 text-slate-950 px-2.5 py-0.5 rounded font-bold">
                  {OFFICIAL_DOMAINS.saasAdminHost}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 hidden sm:inline">
                  Autenticado como: <strong className="text-amber-400">{currentUser.email}</strong>
                </span>
                <button
                  onClick={handleLogout}
                  className="px-3.5 py-1.5 rounded-lg bg-red-600 text-xs font-semibold text-white hover:bg-red-500 cursor-pointer"
                >
                  Encerrar Sessão Global
                </button>
              </div>
            </div>

            <PlatformAdminView
              tenants={tenants}
              plans={plans}
              currentUser={currentUser}
              onUpdatePlans={handleUpdatePlans}
              onUpdateTenantStatus={handleUpdateTenantStatus}
              onSwitchTenant={(tId) => {
                setCurrentTenantId(tId);
                const tBranches = branches.filter(b => b.tenantId === tId);
                if (tBranches[0]) setCurrentBranchId(tBranches[0].id);
                setCurrentView('admin');
                setAdminTab('overview');
              }}
            />
          </div>
        )
      )}

      {/* GLOBAL MODALS */}
      <RegisterModal
        isOpen={isRegisterOpen}
        onClose={() => setIsRegisterOpen(false)}
        onSuccess={handleRegisterSuccess}
        onRegisterAtomicSuccess={handleRegisterAtomicSuccess}
        onOpenLogin={() => {
          setIsRegisterOpen(false);
          setIsLoginOpen(true);
        }}
        onOpenTerms={() => openLegalModal('terms')}
        onOpenPrivacy={() => openLegalModal('privacy')}
      />

      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        users={users}
        onSelectUser={handleSelectUser}
        onAuthSuccess={handleAuthSuccess}
        onOpenRegister={() => {
          setIsLoginOpen(false);
          setIsRegisterOpen(true);
        }}
        onOpenTerms={() => openLegalModal('terms')}
        onOpenPrivacy={() => openLegalModal('privacy')}
      />

      <LegalDocumentsModal
        isOpen={isLegalModalOpen}
        initialTab={legalModalTab}
        onClose={() => setIsLegalModalOpen(false)}
      />

      <StudentFormModal
        isOpen={isNewStudentOpen}
        onClose={() => {
          setIsNewStudentOpen(false);
          setEditingStudent(null);
        }}
        tenantId={currentTenantId}
        branchId={editingStudent?.branchId || currentBranchId}
        belts={beltRanks}
        martialArts={martialArts}
        studentToEdit={editingStudent}
        personToEdit={editingStudent ? persons.find((p) => p.id === editingStudent.personId) : null}
        guardianRelToEdit={
          editingStudent ? guardians.find((g) => g.studentId === editingStudent.id) : null
        }
        guardianPersonToEdit={
          editingStudent
            ? (() => {
                const rel = guardians.find((g) => g.studentId === editingStudent.id);
                return rel ? persons.find((p) => p.id === rel.guardianPersonId) : null;
              })()
            : null
        }
        allGuardians={guardians}
        allPersons={persons}
        invoices={invoices}
        onNavigateToFinancialPlans={() => {
          setIsNewStudentOpen(false);
          setEditingStudent(null);
          setCurrentView('admin');
          setAdminTab('financial');
        }}
        onSave={handleSaveStudent}
        onUpdate={handleUpdateStudent}
      />

      {isAttendanceModalOpen && selectedClassForAttendance && (
        <AttendanceModal
          isOpen={isAttendanceModalOpen}
          onClose={() => {
            setIsAttendanceModalOpen(false);
          }}
          classGroup={selectedClassForAttendance}
          students={students}
          persons={persons}
          enrollments={enrollments}
          currentUser={currentUser}
          tenantId={currentTenantId}
          onSaved={handleRefreshAttendance}
          onNavigateToFullControl={() => {
            setIsAttendanceModalOpen(false);
            setAdminTab('attendance');
          }}
        />
      )}

      {isUpgradePlanOpen && (
        <PlanUpgradeModal
          isOpen={isUpgradePlanOpen}
          onClose={() => setIsUpgradePlanOpen(false)}
          tenant={activeTenant}
          onConfirmUpgrade={handleConfirmUpgrade}
        />
      )}
    </div>
  );
}
