import React, { useState, useEffect } from 'react';
import { X, Mail, Send, CheckCircle2, AlertCircle, Building2, UserCheck, Copy, Check } from 'lucide-react';
import { Invoice, Student, Person } from '../../types';
import { formatCurrencyBRL, formatDateBR } from '../../utils/formatters';

interface EmailReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  student: Student | null;
  studentPerson: Person | null;
  guardianPerson?: Person | null;
  tenantName: string;
  onSend: (data: {
    invoiceId: string;
    recipientEmail: string;
    recipientName: string;
    recipientType: 'student' | 'financial_guardian';
    subject: string;
    body: string;
  }) => Promise<void>;
}

export const EmailReminderModal: React.FC<EmailReminderModalProps> = ({
  isOpen,
  onClose,
  invoice,
  student,
  studentPerson,
  guardianPerson,
  tenantName,
  onSend,
}) => {
  const [recipientChoice, setRecipientChoice] = useState<'guardian' | 'student'>('guardian');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [copiedPix, setCopiedPix] = useState(false);

  useEffect(() => {
    if (!isOpen || !invoice || !studentPerson) return;

    // Prefer guardian if present and has email, else student
    const hasGuardianEmail = Boolean(guardianPerson?.email);
    const initialChoice = hasGuardianEmail ? 'guardian' : 'student';
    setRecipientChoice(initialChoice);

    const recipientName = initialChoice === 'guardian' && guardianPerson ? guardianPerson.fullName : studentPerson.fullName;
    const defaultSubject = `Lembrete de Cobrança · Mensalidade ${invoice.competence} - ${tenantName}`;

    const defaultBody = `Olá, ${recipientName}!

Informamos que a mensalidade referente à competência ${invoice.competence} do aluno(a) ${studentPerson.fullName} possui saldo pendente.

DETALHES DA COBRANÇA:
• Aluno(a): ${studentPerson.fullName} (Matrícula: ${student?.registrationNumber || 'N/A'})
• Competência: ${invoice.competence}
• Vencimento: ${formatDateBR(invoice.dueDate)}
• Valor Pendente: ${formatCurrencyBRL(invoice.balance)}

INSTRUÇÕES DE PAGAMENTO VIA PIX:
Você pode realizar o pagamento instantâneo utilizando a chave Copia e Cola informada na cobrança, ou diretamente na secretaria da academia.

Código PIX:
${invoice.pixCode || 'Consulte a secretaria para obter o QR Code atualizado.'}

Agradecemos a confiança e estamos à disposição para qualquer esclarecimento.

Atenciosamente,
Equipe Financeira · ${tenantName}`;

    setSubject(defaultSubject);
    setBody(defaultBody);
    setErrorMsg('');
    setSuccessMsg('');
    setIsSending(false);
  }, [isOpen, invoice, studentPerson, guardianPerson, tenantName]);

  if (!isOpen || !invoice || !studentPerson) return null;

  const currentEmail =
    recipientChoice === 'guardian' && guardianPerson?.email
      ? guardianPerson.email
      : studentPerson.email || '';

  const currentRecipientName =
    recipientChoice === 'guardian' && guardianPerson
      ? guardianPerson.fullName
      : studentPerson.fullName;

  const handleCopyPix = () => {
    if (!invoice.pixCode) return;
    navigator.clipboard.writeText(invoice.pixCode);
    setCopiedPix(true);
    setTimeout(() => setCopiedPix(false), 2000);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!currentEmail || !currentEmail.includes('@')) {
      setErrorMsg('O destinatário selecionado não possui um endereço de e-mail válido cadastrado.');
      return;
    }

    setIsSending(true);
    try {
      await onSend({
        invoiceId: invoice.id,
        recipientEmail: currentEmail,
        recipientName: currentRecipientName,
        recipientType: recipientChoice === 'guardian' ? 'financial_guardian' : 'student',
        subject: subject.trim(),
        body: body.trim(),
      });

      setSuccessMsg('Lembrete de cobrança registrado e encaminhado com sucesso!');
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível registrar o envio do e-mail. Tente novamente.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
        <button
          onClick={onClose}
          disabled={isSending}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Cabeçalho */}
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-500/30 text-red-400">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Enviar Notificação de Cobrança por E-mail</h3>
            <p className="text-xs text-slate-400">
              Revise o destinatário, o texto da notificação e as instruções de pagamento antes de confirmar.
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl border border-red-500/40 bg-red-950/40 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 rounded-xl border border-emerald-500/40 bg-emerald-950/40 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSend} className="space-y-4 text-xs">
          {/* Seletor de Destinatário */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1.5">Destinatário</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {guardianPerson && (
                <button
                  type="button"
                  onClick={() => setRecipientChoice('guardian')}
                  className={`p-3 rounded-xl border text-left flex items-start justify-between transition-all cursor-pointer ${
                    recipientChoice === 'guardian'
                      ? 'border-red-500 bg-red-950/30 text-white'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <span className="font-semibold text-xs block text-white">{guardianPerson.fullName}</span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      {guardianPerson.email || 'Sem e-mail cadastrado'}
                    </span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-950/60 text-blue-400 border border-blue-500/30">
                    Responsável
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setRecipientChoice('student')}
                className={`p-3 rounded-xl border text-left flex items-start justify-between transition-all cursor-pointer ${
                  recipientChoice === 'student'
                    ? 'border-red-500 bg-red-950/30 text-white'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div>
                  <span className="font-semibold text-xs block text-white">{studentPerson.fullName}</span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    {studentPerson.email || 'Sem e-mail cadastrado'}
                  </span>
                </div>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  Aluno
                </span>
              </button>
            </div>
          </div>

          {/* Assunto */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">Assunto do E-mail</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs"
            />
          </div>

          {/* Corpo do E-mail */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-slate-300 font-semibold">Mensagem / Corpo da Notificação</label>
              {invoice.pixCode && (
                <button
                  type="button"
                  onClick={handleCopyPix}
                  className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 cursor-pointer"
                >
                  {copiedPix ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>{copiedPix ? 'PIX copiado!' : 'Copiar Chave PIX'}</span>
                </button>
              )}
            </div>
            <textarea
              rows={9}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-white focus:outline-none focus:border-red-500 text-xs font-mono leading-relaxed"
            />
          </div>

          {/* Rodapé / Ações */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-800">
            <div className="text-[11px] text-slate-400">
              Enviando para: <strong className="text-white">{currentEmail || 'Não informado'}</strong>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSending}
                className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSending || !currentEmail}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-500 shadow transition-colors cursor-pointer disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                <span>{isSending ? 'Enviando...' : 'Confirmar Envio'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
