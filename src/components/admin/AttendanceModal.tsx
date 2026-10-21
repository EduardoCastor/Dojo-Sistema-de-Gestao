import React, { useState } from 'react';
import { X, Check, CheckCircle2, XCircle, AlertCircle, Calendar, Clock } from 'lucide-react';
import { ClassGroup, Student, Person, Enrollment, AttendanceRecord, User } from '../../types';

interface AttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  classGroup: ClassGroup;
  students: Student[];
  persons: Person[];
  enrollments: Enrollment[];
  currentUser: User;
  onSaveAttendance: (records: AttendanceRecord[]) => void;
}

export const AttendanceModal: React.FC<AttendanceModalProps> = ({
  isOpen,
  onClose,
  classGroup,
  students,
  persons,
  enrollments,
  currentUser,
  onSaveAttendance,
}) => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Find enrolled students for this class
  const enrolledStudentIds = enrollments
    .filter(e => e.classGroupId === classGroup.id && e.status === 'active')
    .map(e => e.studentId);

  const classStudents = students.filter(s => enrolledStudentIds.includes(s.id));

  // Attendance state map
  const [statusMap, setStatusMap] = useState<Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; notes?: string }>>(() => {
    const initial: Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; notes?: string }> = {};
    classStudents.forEach(s => {
      initial[s.id] = { status: 'present' };
    });
    return initial;
  });

  if (!isOpen) return null;

  const handleStatusChange = (studentId: string, status: 'present' | 'absent' | 'late' | 'excused') => {
    setStatusMap(prev => ({
      ...prev,
      [studentId]: { ...prev[studentId], status },
    }));
  };

  const handleNotesChange = (studentId: string, notes: string) => {
    setStatusMap(prev => ({
      ...prev,
      [studentId]: { ...prev[studentId], notes },
    }));
  };

  const markAll = (status: 'present' | 'absent') => {
    const updated: Record<string, { status: 'present' | 'absent' | 'late' | 'excused'; notes?: string }> = {};
    classStudents.forEach(s => {
      updated[s.id] = { status };
    });
    setStatusMap(updated);
  };

  const handleSave = () => {
    const records: AttendanceRecord[] = classStudents.map(s => {
      const current = statusMap[s.id] || { status: 'present' };
      return {
        id: `att-${Date.now()}-${s.id}`,
        tenantId: classGroup.tenantId,
        classGroupId: classGroup.id,
        studentId: s.id,
        date: selectedDate,
        status: current.status,
        notes: current.notes,
        recordedByUserName: currentUser.name,
        recordedAt: new Date().toISOString(),
      };
    });

    onSaveAttendance(records);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-white">Chamada de Frequência · {classGroup.name}</h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {classGroup.startTime} às {classGroup.endTime} · {classGroup.tatamiRoom} · Prof. {classGroup.headInstructorName}
          </p>
        </div>

        {/* Date and bulk actions bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl border border-slate-800 bg-slate-950/60 mb-4 text-xs">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-red-500 shrink-0" />
            <span className="font-semibold text-slate-300">Data do Treino:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-white focus:border-red-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => markAll('present')}
              className="px-2.5 py-1 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-900/40 text-[11px] font-semibold cursor-pointer"
            >
              Todos Presentes
            </button>
            <button
              onClick={() => markAll('absent')}
              className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold cursor-pointer"
            >
              Limpar Seleção
            </button>
          </div>
        </div>

        {/* Students Roll Call List */}
        <div className="space-y-2 mb-6">
          {classStudents.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              Nenhum aluno matriculado nesta turma ainda.
            </div>
          ) : (
            classStudents.map((s) => {
              const person = persons.find(p => p.id === s.personId);
              const currentStatus = statusMap[s.id]?.status || 'present';
              const currentNotes = statusMap[s.id]?.notes || '';
              const belt = s.currentGraduations?.[0];

              return (
                <div
                  key={s.id}
                  className="p-3 rounded-xl border border-slate-800 bg-slate-950/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-slate-500 shrink-0"
                      style={{ backgroundColor: belt?.beltColorHex || '#fff' }}
                      title={belt?.beltName}
                    ></span>
                    <div>
                      <div className="text-xs font-bold text-white">{person?.fullName || 'Aluno'}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {s.registrationNumber} · {belt?.beltName}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 w-full sm:w-auto">
                    {/* Status Toggle Buttons */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStatusChange(s.id, 'present')}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                          currentStatus === 'present'
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Presente</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStatusChange(s.id, 'absent')}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                          currentStatus === 'absent'
                            ? 'bg-red-600 text-white shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <XCircle className="h-3 w-3" />
                        <span>Falta</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStatusChange(s.id, 'late')}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                          currentStatus === 'late'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        <span>Atraso</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStatusChange(s.id, 'excused')}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                          currentStatus === 'excused'
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <AlertCircle className="h-3 w-3" />
                        <span>Justificada</span>
                      </button>
                    </div>

                    {currentStatus === 'excused' && (
                      <input
                        type="text"
                        placeholder="Motivo da justificativa..."
                        value={currentNotes}
                        onChange={(e) => handleNotesChange(s.id, e.target.value)}
                        className="w-full sm:w-44 text-[11px] rounded border border-slate-700 bg-slate-800 px-2 py-1 text-white placeholder-slate-500 focus:outline-none"
                      />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-red-600 text-xs font-semibold text-white hover:bg-red-500 shadow"
          >
            <Check className="h-4 w-4" />
            <span>Salvar Chamada ({classStudents.length} alunos)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
