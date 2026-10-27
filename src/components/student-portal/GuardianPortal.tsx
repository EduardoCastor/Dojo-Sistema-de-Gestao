import React, { useState } from 'react';
import {
  Users,
  Calendar,
  CheckCircle2,
  DollarSign,
  ShieldCheck,
  Copy,
  Check,
  Clock,
  AlertCircle,
} from 'lucide-react';
import {
  Student,
  Person,
  GuardianRelationship,
  Invoice,
  ClassGroup,
  AttendanceRecord,
  HealthRecord,
} from '../../types';
import { formatCurrencyBRL, formatDateBR, calculateAge } from '../../utils/formatters';

interface GuardianPortalProps {
  guardianPerson: Person | null;
  relationships: GuardianRelationship[];
  students: Student[];
  persons: Person[];
  invoices: Invoice[];
  classes: ClassGroup[];
  attendances: AttendanceRecord[];
  healthRecords: HealthRecord[];
}

export const GuardianPortal: React.FC<GuardianPortalProps> = ({
  guardianPerson,
  relationships,
  students,
  persons,
  invoices,
  classes,
  attendances,
  healthRecords,
}) => {
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [copiedPixId, setCopiedPixId] = useState<string | null>(null);

  if (!guardianPerson) {
    return (
      <div className="p-8 text-center text-slate-400 bg-slate-900/50 rounded-2xl border border-slate-800 my-8 max-w-2xl mx-auto space-y-2">
        <AlertCircle className="h-8 w-8 text-red-400 mx-auto" />
        <p className="text-sm font-semibold text-white">Portal do Responsável</p>
        <p className="text-xs text-slate-400">
          Nenhum cadastro de responsável legal autorizado está vinculado a esta conta no momento. Solicite seu código de convite junto à secretaria da academia.
        </p>
      </div>
    );
  }

  // Strictly find dependents linked to this guardian in the same tenant
  const myRelationships = relationships.filter(
    (r) =>
      r.guardianPersonId === guardianPerson.id &&
      r.tenantId === guardianPerson.tenantId
  );
  const dependentStudentIds = myRelationships.map((r) => r.studentId);

  const myStudents = students.filter(
    (s) => dependentStudentIds.includes(s.id) && s.tenantId === guardianPerson.tenantId
  );

  const activeStudent =
    myStudents.find((s) => s.id === selectedStudentId) || myStudents[0] || null;
  const activePerson = activeStudent
    ? persons.find((p) => p.id === activeStudent.personId)
    : undefined;
  const activeRel = activeStudent
    ? myRelationships.find((r) => r.studentId === activeStudent.id)
    : undefined;
  const activeAge = activePerson ? calculateAge(activePerson.birthDate) : 0;
  const activeBelt = activeStudent?.currentGraduations?.[0];
  const activeHealth = activeStudent
    ? healthRecords.find((h) => h.studentId === activeStudent.id)
    : undefined;

  // Attendance records strictly for the selected linked student
  const activeStudentAttendances = activeStudent
    ? attendances
        .filter(
          (a) =>
            a.studentId === activeStudent.id &&
            a.tenantId === guardianPerson.tenantId
        )
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];
  const presentCount = activeStudentAttendances.filter(
    (a) => a.status === 'present' || a.status === 'excused'
  ).length;
  const attendanceRate =
    activeStudentAttendances.length > 0
      ? Math.round((presentCount / activeStudentAttendances.length) * 100)
      : 100;

  // Consolidated Invoices strictly for this guardian's linked students
  const familyInvoices = invoices
    .filter(
      (i) =>
        i.tenantId === guardianPerson.tenantId &&
        (i.financialGuardianId === guardianPerson.id ||
          dependentStudentIds.includes(i.studentId))
    )
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));

  const handleCopyPix = (invoiceId: string, code?: string) => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopiedPixId(invoiceId);
    setTimeout(() => setCopiedPixId(null), 2000);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Guardian Header */}
      <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-red-400 uppercase bg-red-950/60 px-2 py-0.5 rounded border border-red-500/30">
              Portal da Família & Responsáveis
            </span>
            <span className="text-xs text-slate-400">
              {myStudents.length} {myStudents.length === 1 ? 'aluno vinculado' : 'alunos vinculados'}
            </span>
          </div>
          <h2 className="text-xl font-bold text-white">{guardianPerson.fullName}</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Acompanhamento de presença, situação cadastral e mensalidades dos alunos sob sua responsabilidade.
          </p>
        </div>

        {/* Dependent Switcher Tabs */}
        {myStudents.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-xl bg-slate-950 border border-slate-800">
            {myStudents.map((dep) => {
              const p = persons.find((item) => item.id === dep.personId);
              const isSelected = dep.id === activeStudent?.id;
              return (
                <button
                  key={dep.id}
                  onClick={() => setSelectedStudentId(dep.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-red-600 text-white shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  <Users className="h-3.5 w-3.5" />
                  <span>{p?.fullName.split(' ')[0] || 'Dependente'}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {myStudents.length === 0 ? (
        <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/60 text-center text-xs text-slate-400">
          Nenhum aluno vinculado ao seu cadastro de responsável nesta academia.
        </div>
      ) : (
        activeStudent &&
        activePerson && (
          <>
            {/* Active Dependent Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Card 1: Belt & Progress */}
              <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-slate-400 uppercase">
                      Aluno: {activePerson.fullName}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Mat: {activeStudent.registrationNumber}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 my-2">
                    <span
                      className="h-5 w-5 rounded-full border border-slate-500 shadow-sm"
                      style={{ backgroundColor: activeBelt?.beltColorHex || '#fff' }}
                    />
                    <div>
                      <div className="text-base font-bold text-white">
                        {activeBelt?.beltName || 'Faixa Branca'}
                      </div>
                      <div className="text-xs text-slate-400">
                        {activeBelt?.martialArtName || 'Modalidade'}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800 space-y-1">
                    <div>
                      Idade Atual: <strong className="text-white">{activeAge} anos</strong>
                    </div>
                    <div>Graduado em: {formatDateBR(activeBelt?.graduatedAt)}</div>
                    <div>
                      Vínculo:{' '}
                      <strong className="text-slate-200">
                        {activeRel?.relationshipLabel || 'Responsável'}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px] text-emerald-400 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>Assiduidade: {attendanceRate}%</span>
                  </span>
                  <span className="font-mono text-slate-300">{presentCount} presenças</span>
                </div>
              </div>

              {/* Card 2: Medical & Authorization */}
              <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-slate-400 uppercase">
                      Atestados & Saúde
                    </span>
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  </div>

                  {activeHealth ? (
                    <div className="space-y-2 text-xs">
                      <div className="text-slate-300">
                        Atestado Médico: <strong className="text-emerald-400">Registrado</strong>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Vencimento: {formatDateBR(activeHealth.medicalCertExpiryDate)}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Alergias: {activeHealth.allergies.join(', ') || 'Nenhuma informada.'}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Medicamentos: {activeHealth.voluntaryMedications || 'Nenhum.'}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">
                      Nenhum prontuário médico complementar registrado.
                    </div>
                  )}
                </div>

                <div className="mt-4 text-[10px] text-slate-400">
                  Autorização de retirada:{' '}
                  <strong className="text-slate-200">
                    {activeRel?.isPickupAuthorized ? 'Autorizado para este responsável' : 'Consultar secretaria'}
                  </strong>
                </div>
              </div>

              {/* Card 3: Monthly Fee */}
              <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-slate-400 uppercase">
                      Condição Financeira
                    </span>
                    <DollarSign className="h-4 w-4 text-emerald-400" />
                  </div>

                  <div className="text-2xl font-bold text-white font-mono">
                    {formatCurrencyBRL(activeStudent.monthlyFee)}
                    <span className="text-xs text-slate-400 font-sans font-normal ml-1">/mês</span>
                  </div>

                  <div className="mt-2 text-[11px] text-slate-400">
                    Situação da matrícula:{' '}
                    <strong className="text-emerald-400">
                      {activeStudent.status === 'active' ? 'Ativa' : activeStudent.status}
                    </strong>
                  </div>
                </div>

                <div className="mt-4 text-[10px] text-slate-500">
                  Responsável vinculado: {guardianPerson.fullName} (CPF {guardianPerson.cpf}).
                </div>
              </div>
            </div>

            {/* Selected Dependent's Attendance History */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-red-500" />
                  <span>Frequência e Presença de {activePerson.fullName}</span>
                </h3>
                <span className="text-xs text-slate-400 font-mono">
                  {activeStudentAttendances.length} registros
                </span>
              </div>

              {activeStudentAttendances.length === 0 ? (
                <div className="text-xs text-slate-500 py-3">
                  Nenhuma presença registrada para este aluno até o momento.
                </div>
              ) : (
                <div className="divide-y divide-slate-800 text-xs">
                  {activeStudentAttendances.slice(0, 8).map((att) => {
                    const cls = classes.find((c) => c.id === att.classId);
                    return (
                      <div
                        key={att.id}
                        className="py-2.5 flex items-center justify-between gap-3"
                      >
                        <div>
                          <div className="font-semibold text-white">
                            {cls?.name || 'Treino Regular'}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
                            <Clock className="h-3 w-3 text-slate-500" />
                            <span>Data: {formatDateBR(att.date)}</span>
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            att.status === 'present'
                              ? 'bg-emerald-950/60 text-emerald-400 border-emerald-500/30'
                              : att.status === 'late'
                              ? 'bg-amber-950/60 text-amber-300 border-amber-500/30'
                              : att.status === 'excused'
                              ? 'bg-blue-950/60 text-blue-300 border-blue-500/30'
                              : 'bg-red-950/60 text-red-400 border-red-500/30'
                          }`}
                        >
                          {att.status === 'present'
                            ? 'Presente'
                            : att.status === 'late'
                            ? 'Atraso'
                            : att.status === 'excused'
                            ? 'Justificado'
                            : 'Ausente'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )
      )}

      {/* Unified Invoices Table for the Linked Students */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-emerald-400" />
          <span>Demonstrativo Financeiro e Mensalidades dos Alunos Vinculados</span>
        </h3>

        {familyInvoices.length === 0 ? (
          <div className="text-xs text-slate-500 py-4">
            Nenhuma mensalidade ou cobrança registrada para os alunos sob sua responsabilidade.
          </div>
        ) : (
          <div className="divide-y divide-slate-800 text-xs">
            {familyInvoices.map((inv) => {
              const student = students.find((s) => s.id === inv.studentId);
              const p = student ? persons.find((item) => item.id === student.personId) : null;
              const isPaid = inv.status === 'paid';
              const isOverdue = inv.status === 'overdue';

              return (
                <div
                  key={inv.id}
                  className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-bold text-white">
                      {p?.fullName || 'Aluno'} · Mensalidade {inv.competence}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Vencimento: {formatDateBR(inv.dueDate)}
                      {inv.paidDate ? ` · Pago em: ${formatDateBR(inv.paidDate)}` : ''}
                      {inv.discountAmount > 0 && inv.discountDescription
                        ? ` · (${inv.discountDescription})`
                        : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-mono font-bold text-white">
                        {formatCurrencyBRL(inv.finalAmount)}
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                          isPaid
                            ? 'bg-emerald-950/60 text-emerald-400 border-emerald-500/30'
                            : isOverdue
                            ? 'bg-red-950/60 text-red-400 border-red-500/30'
                            : 'bg-amber-950/60 text-amber-400 border-amber-500/30'
                        }`}
                      >
                        {isPaid
                          ? 'Pago'
                          : isOverdue
                          ? 'Em Atraso'
                          : 'Em Aberto'}
                      </span>
                    </div>

                    {!isPaid && inv.pixCode && (
                      <button
                        onClick={() => handleCopyPix(inv.id, inv.pixCode)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow transition-colors cursor-pointer"
                      >
                        {copiedPixId === inv.id ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span>{copiedPixId === inv.id ? 'Copiado!' : 'Copiar PIX'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
