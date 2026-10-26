import React, { useState } from 'react';
import {
  Download,
  Printer,
  Users,
  DollarSign,
  CheckCircle2,
  TrendingUp,
  Building2,
  Image,
  Upload,
  Trash2,
  Calendar,
  FileSpreadsheet,
  Check,
  FileText,
} from 'lucide-react';
import { Tenant, Student, Person, Invoice, AttendanceRecord, BeltRank } from '../../types';
import {
  formatDateBR,
  formatDateTimeBR,
  formatCurrencyBRL,
  calculateAge,
  formatCPF,
  formatCNPJ,
  formatPhoneBR,
} from '../../utils/formatters';

interface ReportsViewProps {
  tenant: Tenant;
  students: Student[];
  persons: Person[];
  invoices: Invoice[];
  attendances: AttendanceRecord[];
  belts: BeltRank[];
  onUpdateTenantLogo?: (newLogoUrl: string) => void;
}

type ReportTab = 'students' | 'financial' | 'attendance' | 'belts';

export const ReportsView: React.FC<ReportsViewProps> = ({
  tenant,
  students,
  persons,
  invoices,
  attendances,
  belts,
  onUpdateTenantLogo,
}) => {
  const [activeReportTab, setActiveReportTab] = useState<ReportTab>('students');
  const [isChangingLogo, setIsChangingLogo] = useState(false);
  const [tempLogoUrl, setTempLogoUrl] = useState(tenant.logoUrl || '');

  // Helper de download CSV
  const downloadCSV = (filename: string, csvContent: string) => {
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportStudentsCSV = () => {
    let csv = 'Matricula;Nome Completo;CPF;Idade;Data Nascimento;Faixa Atual;Mensalidade (BRL);Situacao\n';
    students.forEach((s) => {
      const person = persons.find((p) => p.id === s.personId);
      const age = person ? calculateAge(person.birthDate) : 0;
      const belt = s.currentGraduations?.[0]?.beltName || 'Iniciante';
      csv += `"${s.registrationNumber || ''}";"${person?.fullName || ''}";"${person?.cpf || ''}";"${age}";"${formatDateBR(person?.birthDate)}";"${belt}";"${s.monthlyFee}";"${s.status === 'active' ? 'Ativo' : 'Inativo'}"\n`;
    });
    downloadCSV(`relatorio_alunos_${new Date().toISOString().split('T')[0]}.csv`, csv);
  };

  const exportFinancialCSV = () => {
    let csv = 'ID Cobranca;Aluno;Competencia;Data Vencimento;Valor Final (BRL);Valor Pago (BRL);Saldo Devedor;Situacao;Meio Pagamento\n';
    invoices.forEach((inv) => {
      const student = students.find((s) => s.id === inv.studentId);
      const person = student ? persons.find((p) => p.id === student.personId) : null;
      csv += `"${inv.id}";"${person?.fullName || ''}";"${inv.competence}";"${formatDateBR(inv.dueDate)}";"${inv.finalAmount}";"${inv.paidAmount}";"${inv.balance}";"${inv.status}";"${inv.paymentMethod || '-'}"\n`;
    });
    downloadCSV(`relatorio_financeiro_${new Date().toISOString().split('T')[0]}.csv`, csv);
  };

  const exportAttendanceCSV = () => {
    let csv = 'Data;Aluno;Matricula;Status Frequencia;Professor Responsavel;Observacoes\n';
    attendances.forEach((att) => {
      const student = students.find((s) => s.id === att.studentId);
      const person = student ? persons.find((p) => p.id === student.personId) : null;
      const statusLabel = att.status === 'present' ? 'Presente' : att.status === 'excused' ? 'Justificada' : 'Falta';
      csv += `"${formatDateBR(att.date)}";"${person?.fullName || ''}";"${student?.registrationNumber || ''}";"${statusLabel}";"${att.recordedByUserName || ''}";"${att.notes || ''}"\n`;
    });
    downloadCSV(`relatorio_frequencia_${new Date().toISOString().split('T')[0]}.csv`, csv);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('A imagem deve ter no máximo 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      setTempLogoUrl(res);
      if (onUpdateTenantLogo) {
        onUpdateTenantLogo(res);
      }
      setIsChangingLogo(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveLogoUrl = () => {
    if (onUpdateTenantLogo) {
      onUpdateTenantLogo(tempLogoUrl);
    }
    setIsChangingLogo(false);
  };

  const handleRemoveLogo = () => {
    setTempLogoUrl('');
    if (onUpdateTenantLogo) {
      onUpdateTenantLogo('');
    }
    setIsChangingLogo(false);
  };

  // Contagem de faixas
  const beltCounts: Record<string, number> = {};
  students.forEach((s) => {
    const beltName = s.currentGraduations?.[0]?.beltName || 'Faixa Branca';
    beltCounts[beltName] = (beltCounts[beltName] || 0) + 1;
  });

  const activeLogo = tenant.logoUrl || tempLogoUrl;

  return (
    <div className="space-y-6">
      {/* Printable CSS styles */}
      <style>{`
        @media print {
          body {
            background-color: #ffffff !important;
            color: #000000 !important;
          }
          aside, nav, header, button, .no-print {
            display: none !important;
          }
          .printable-report-container {
            border: none !important;
            box-shadow: none !important;
            background: #ffffff !important;
            color: #000000 !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .printable-header {
            border-bottom: 2px solid #000000 !important;
            padding-bottom: 12px !important;
            margin-bottom: 16px !important;
          }
          .printable-text-black {
            color: #000000 !important;
          }
          .printable-text-gray {
            color: #4b5563 !important;
          }
          .printable-table th {
            background-color: #f3f4f6 !important;
            color: #111827 !important;
            border: 1px solid #d1d5db !important;
          }
          .printable-table td {
            border: 1px solid #e5e7eb !important;
            color: #111827 !important;
          }
        }
      `}</style>

      {/* Top Header Actions (No Print) */}
      <div className="no-print flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Relatórios Oficiais & Fichas Técnicas</h2>
          <p className="text-xs text-slate-400">
            Cabeçalho institucional com logomarca personalizada da academia, visualização formatada e exportação.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsChangingLogo(!isChangingLogo)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <Image className="h-3.5 w-3.5 text-red-400" />
            <span>{activeLogo ? 'Alterar Logomarca' : 'Adicionar Logomarca'}</span>
          </button>

          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition-colors shadow cursor-pointer"
          >
            <Printer className="h-4 w-4" />
            <span>Imprimir / Salvar PDF</span>
          </button>
        </div>
      </div>

      {/* Modal / Card para Alterar Logomarca (No Print) */}
      {isChangingLogo && (
        <div className="no-print p-4 rounded-xl border border-red-500/30 bg-slate-900/95 space-y-3 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Image className="h-4 w-4 text-red-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Configurar Logomarca dos Relatórios
              </h3>
            </div>
            <button
              onClick={() => setIsChangingLogo(false)}
              className="text-slate-400 hover:text-white text-xs cursor-pointer"
            >
              Fechar
            </button>
          </div>

          <p className="text-xs text-slate-400">
            A imagem selecionada será exibida no cabeçalho superior de todos os relatórios gerenciais e impressões oficiais.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 pt-1">
            <div className="h-16 w-16 rounded-xl border-2 border-dashed border-slate-700 bg-slate-950 flex items-center justify-center overflow-hidden shrink-0">
              {tempLogoUrl ? (
                <img src={tempLogoUrl} alt="Logo" className="h-full w-full object-contain p-1" />
              ) : (
                <Building2 className="h-6 w-6 text-slate-600" />
              )}
            </div>

            <div className="flex-1 w-full space-y-2">
              <div className="flex items-center gap-2">
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-medium text-slate-200 hover:text-white transition-colors">
                  <Upload className="h-3.5 w-3.5 text-red-400" />
                  <span>Upload de Arquivo</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                </label>

                {tempLogoUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="p-1.5 rounded-lg border border-red-900/40 bg-red-950/40 text-red-400 hover:text-red-300 hover:bg-red-900/40 transition-colors"
                    title="Remover logotipo"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={tempLogoUrl.startsWith('data:') ? '' : tempLogoUrl}
                  onChange={(e) => setTempLogoUrl(e.target.value)}
                  placeholder="Ou cole o link direto da imagem (https://...)"
                  className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
                <button
                  onClick={handleSaveLogoUrl}
                  className="px-3 py-1 rounded-md bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition-colors cursor-pointer"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CABEÇALHO OFICIAL DO RELATÓRIO COM A LOGO DA ACADEMIA */}
      <div className="printable-report-container p-6 rounded-2xl border border-slate-800 bg-slate-900/80 shadow-xl space-y-6">
        <div className="printable-header flex flex-col md:flex-row items-center justify-between gap-6 pb-6 border-b border-slate-800/80">
          {/* Logo da Academia à esquerda */}
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 md:h-24 md:w-24 rounded-2xl border-2 border-slate-700/80 bg-slate-950/90 flex items-center justify-center overflow-hidden shrink-0 shadow-lg p-1.5">
              {activeLogo ? (
                <img
                  src={activeLogo}
                  alt={tenant.tradeName}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-center p-1">
                  <div className="h-10 w-10 rounded-xl bg-red-600/20 text-red-500 flex items-center justify-center font-bold text-lg mb-1">
                    TH
                  </div>
                  <span className="text-[9px] text-slate-500 uppercase tracking-tighter">Sem Logo</span>
                </div>
              )}
            </div>

            {/* Dados Institucionais da Academia */}
            <div className="space-y-0.5 text-center md:text-left">
              <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-950/50 text-red-400 border border-red-800/30 mb-1">
                Relatório Institucional Oficial
              </div>
              <h1 className="text-xl md:text-2xl font-extrabold text-white printable-text-black tracking-tight">
                {tenant.tradeName}
              </h1>
              {tenant.legalName && tenant.legalName !== tenant.tradeName && (
                <div className="text-xs text-slate-300 printable-text-gray font-medium">
                  {tenant.legalName}
                </div>
              )}
              <div className="text-[11px] text-slate-400 printable-text-gray flex flex-wrap items-center justify-center md:justify-start gap-x-3 gap-y-0.5 pt-0.5">
                <span>CNPJ/CPF: <strong className="text-slate-200 printable-text-black font-mono">{formatCNPJ(tenant.cnpjOrCpf)}</strong></span>
                {tenant.phone && <span>Tel: {formatPhoneBR(tenant.phone)}</span>}
                {tenant.address?.city && <span>{tenant.address.city} / {tenant.address.state}</span>}
              </div>
            </div>
          </div>

          {/* Metadados do Documento à direita */}
          <div className="text-center md:text-right space-y-1 text-xs text-slate-400 printable-text-gray shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-800 w-full md:w-auto">
            <div>
              <span className="text-slate-500">Documento: </span>
              <span className="font-semibold text-white printable-text-black font-mono">
                REL-{Date.now().toString().slice(-6)}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Emissão: </span>
              <span className="text-slate-200 printable-text-black font-mono">
                {formatDateTimeBR(new Date().toISOString())}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Responsável: </span>
              <span className="text-slate-200 printable-text-black font-semibold">
                {tenant.adminName || 'Sensei Titular'}
              </span>
            </div>
            <div className="text-[10px] text-emerald-400 printable-text-gray">
              ✓ Autenticidade Registrada Tatame Club
            </div>
          </div>
        </div>

        {/* Abas de Seleção de Relatório (No Print) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-800">
          <div className="flex items-center gap-1.5 p-1 bg-slate-950/80 border border-slate-800 rounded-xl text-xs">
            <button
              onClick={() => setActiveReportTab('students')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                activeReportTab === 'students'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Relação de Alunos ({students.length})</span>
            </button>
            <button
              onClick={() => setActiveReportTab('financial')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                activeReportTab === 'financial'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <DollarSign className="h-3.5 w-3.5" />
              <span>Livro Financeiro ({invoices.length})</span>
            </button>
            <button
              onClick={() => setActiveReportTab('attendance')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                activeReportTab === 'attendance'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Frequência no Tatame ({attendances.length})</span>
            </button>
            <button
              onClick={() => setActiveReportTab('belts')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                activeReportTab === 'belts'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              <span>Estatísticas de Faixas</span>
            </button>
          </div>

          {/* Botão de Exportação CSV correspondente */}
          <div>
            {activeReportTab === 'students' && (
              <button
                onClick={exportStudentsCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-200 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-red-400" />
                <span>Exportar Alunos (CSV)</span>
              </button>
            )}
            {activeReportTab === 'financial' && (
              <button
                onClick={exportFinancialCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-200 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-emerald-400" />
                <span>Exportar Financeiro (CSV)</span>
              </button>
            )}
            {activeReportTab === 'attendance' && (
              <button
                onClick={exportAttendanceCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-200 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-blue-400" />
                <span>Exportar Frequência (CSV)</span>
              </button>
            )}
          </div>
        </div>

        {/* CONTEÚDO DO RELATÓRIO SELECIONADO */}
        {activeReportTab === 'students' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white printable-text-black uppercase tracking-wider flex items-center gap-2">
                <Users className="h-4 w-4 text-red-500" />
                <span>Relação Geral de Alunos Matriculados</span>
              </h3>
              <span className="text-xs text-slate-400 printable-text-gray font-mono">
                Total: {students.length} aluno(s)
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
              <table className="w-full text-left text-xs printable-table">
                <thead className="bg-slate-950 text-slate-400 font-semibold uppercase text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Matrícula</th>
                    <th className="py-2.5 px-3">Nome do Aluno</th>
                    <th className="py-2.5 px-3">CPF</th>
                    <th className="py-2.5 px-3">Idade</th>
                    <th className="py-2.5 px-3">Graduação</th>
                    <th className="py-2.5 px-3">Mensalidade</th>
                    <th className="py-2.5 px-3">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {students.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">
                        Nenhum aluno cadastrado no momento.
                      </td>
                    </tr>
                  ) : (
                    students.map((s) => {
                      const person = persons.find((p) => p.id === s.personId);
                      const age = person ? calculateAge(person.birthDate) : 0;
                      const belt = s.currentGraduations?.[0];
                      return (
                        <tr key={s.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-mono text-slate-400 printable-text-gray font-semibold">
                            {s.registrationNumber || '-'}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-white printable-text-black">
                            {person?.fullName || 'Aluno'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-300 printable-text-gray">
                            {formatCPF(person?.cpf)}
                          </td>
                          <td className="py-2.5 px-3 text-slate-300 printable-text-gray">
                            {age} anos
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-medium text-slate-200 printable-text-black">
                              {belt?.beltName || 'Iniciante'}
                            </span>
                            <span className="text-[10px] text-slate-400 block printable-text-gray">
                              {belt?.martialArtName || 'Judô'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-200 printable-text-black font-semibold">
                            {formatCurrencyBRL(s.monthlyFee || 0)}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                                s.status === 'active'
                                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-red-950/60 text-red-400 border border-red-500/30'
                              }`}
                            >
                              {s.status === 'active' ? 'Ativo' : 'Inativo'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeReportTab === 'financial' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white printable-text-black uppercase tracking-wider flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-400" />
                <span>Livro de Cobranças & Mensalidades</span>
              </h3>
              <span className="text-xs text-slate-400 printable-text-gray font-mono">
                Total: {invoices.length} título(s)
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
              <table className="w-full text-left text-xs printable-table">
                <thead className="bg-slate-950 text-slate-400 font-semibold uppercase text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Cód. Título</th>
                    <th className="py-2.5 px-3">Aluno</th>
                    <th className="py-2.5 px-3">Competência</th>
                    <th className="py-2.5 px-3">Vencimento</th>
                    <th className="py-2.5 px-3">Valor</th>
                    <th className="py-2.5 px-3">Valor Pago</th>
                    <th className="py-2.5 px-3">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">
                        Nenhum registro financeiro emitido.
                      </td>
                    </tr>
                  ) : (
                    invoices.map((inv) => {
                      const student = students.find((s) => s.id === inv.studentId);
                      const person = student ? persons.find((p) => p.id === student.personId) : null;
                      return (
                        <tr key={inv.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-mono text-slate-400 printable-text-gray">
                            {inv.id}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-white printable-text-black">
                            {person?.fullName || 'Aluno'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-300 printable-text-gray">
                            {inv.competence}
                          </td>
                          <td className="py-2.5 px-3 text-slate-300 printable-text-gray">
                            {formatDateBR(inv.dueDate)}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-semibold text-slate-200 printable-text-black">
                            {formatCurrencyBRL(inv.finalAmount)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-emerald-400 printable-text-black">
                            {formatCurrencyBRL(inv.paidAmount)}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                                inv.status === 'paid'
                                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                                  : inv.status === 'overdue'
                                  ? 'bg-red-950/60 text-red-400 border border-red-500/30'
                                  : 'bg-amber-950/60 text-amber-400 border border-amber-500/30'
                              }`}
                            >
                              {inv.status === 'paid'
                                ? 'Pago'
                                : inv.status === 'overdue'
                                ? 'Vencido'
                                : 'Pendente'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeReportTab === 'attendance' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white printable-text-black uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-blue-400" />
                <span>Histórico de Frequência & Chamadas no Tatame</span>
              </h3>
              <span className="text-xs text-slate-400 printable-text-gray font-mono">
                Total: {attendances.length} registro(s)
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
              <table className="w-full text-left text-xs printable-table">
                <thead className="bg-slate-950 text-slate-400 font-semibold uppercase text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Data</th>
                    <th className="py-2.5 px-3">Aluno</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Responsável Chamada</th>
                    <th className="py-2.5 px-3">Observações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {attendances.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-500">
                        Nenhuma chamada registrada no sistema.
                      </td>
                    </tr>
                  ) : (
                    attendances.map((att) => {
                      const student = students.find((s) => s.id === att.studentId);
                      const person = student ? persons.find((p) => p.id === student.personId) : null;
                      return (
                        <tr key={att.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-mono text-slate-300 printable-text-gray">
                            {formatDateBR(att.date)}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-white printable-text-black">
                            {person?.fullName || 'Aluno'}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                                att.status === 'present'
                                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                                  : att.status === 'excused'
                                  ? 'bg-amber-950/60 text-amber-400 border border-amber-500/30'
                                  : 'bg-red-950/60 text-red-400 border border-red-500/30'
                              }`}
                            >
                              {att.status === 'present'
                                ? 'Presente'
                                : att.status === 'excused'
                                ? 'Justificada'
                                : 'Falta'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-300 printable-text-gray">
                            {att.recordedByUserName || 'Sensei'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 printable-text-gray italic">
                            {att.notes || '-'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeReportTab === 'belts' && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-white printable-text-black uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-red-500" />
              <span>Distribuição Técnica de Praticantes por Graduação</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(beltCounts).map(([beltName, count]) => {
                const percentage = students.length > 0 ? Math.round((count / students.length) * 100) : 0;
                return (
                  <div key={beltName} className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white printable-text-black font-bold">{beltName}</span>
                      <span className="text-slate-400 printable-text-gray font-mono">
                        {count} aluno(s) ({percentage}%)
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-red-600 rounded-full"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Rodapé institucional para impressões */}
        <div className="pt-6 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 printable-text-gray gap-2">
          <div>
            Documento emitido digitalmente pela plataforma <strong>Tatame Club</strong> em{' '}
            {formatDateBR(new Date().toISOString())}.
          </div>
          <div className="font-mono">
            Assinatura do Responsável Técnico: _________________________
          </div>
        </div>
      </div>
    </div>
  );
};
