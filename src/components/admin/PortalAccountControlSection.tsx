import React, { useState, useEffect } from 'react';
import {
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Ban,
  RotateCcw,
  Copy,
  Check,
  Mail,
  Activity,
  UserCheck,
  Lock,
} from 'lucide-react';
import { portalAccessService, PortalAccountSummary } from '../../services/portalAccessService';
import { Student, Person } from '../../types';

interface PortalAccountControlSectionProps {
  tenantId: string;
  targetType: 'student' | 'guardian';
  student?: Student;
  person: Person;
  onUpdated?: () => void;
}

export const PortalAccountControlSection: React.FC<PortalAccountControlSectionProps> = ({
  tenantId,
  targetType,
  student,
  person,
  onUpdated,
}) => {
  const targetId = targetType === 'student' ? student?.id || person.id : person.id;
  const [summary, setSummary] = useState<PortalAccountSummary>(() =>
    portalAccessService.getPortalAccountStatus(tenantId, targetType, targetId)
  );
  const [inviteEmail, setInviteEmail] = useState(person.email || '');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    setSummary(portalAccessService.getPortalAccountStatus(tenantId, targetType, targetId));
    setInviteEmail(person.email || '');
    setFeedback(null);
  }, [tenantId, targetType, targetId, person.email, student?.portalAccessStatus, student?.allowAnthropometryView]);

  const handleAction = async (
    action:
      | 'create_invite'
      | 'resend_invite'
      | 'revoke_invite'
      | 'block'
      | 'revoke_access'
      | 'reactivate'
      | 'toggle_anthropometry',
    allowAnthropometry?: boolean
  ) => {
    setFeedback(null);
    setLoading(true);
    try {
      const res = await portalAccessService.manageAccountAccess({
        tenantId,
        targetType,
        targetId,
        action,
        email: inviteEmail.trim() || person.email,
        allowAnthropometry,
      });

      setSummary(portalAccessService.getPortalAccountStatus(tenantId, targetType, targetId));
      setFeedback({
        type: res.success ? 'success' : 'error',
        message: res.message,
      });
      if (res.success && onUpdated) {
        onUpdated();
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Não foi possível atualizar o acesso ao portal.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  const statusBadge = () => {
    switch (summary.status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950/70 text-emerald-400 border border-emerald-500/30">
            <UserCheck className="h-3 w-3" />
            Conta Ativa & Vinculada
          </span>
        );
      case 'invited':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950/70 text-amber-300 border border-amber-500/30">
            <KeyRound className="h-3 w-3" />
            Convite Pendente de Ativação
          </span>
        );
      case 'blocked':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-950/70 text-red-400 border border-red-500/30">
            <Ban className="h-3 w-3" />
            Acesso Bloqueado
          </span>
        );
      case 'revoked':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <Lock className="h-3 w-3" />
            Acesso Revogado
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            Sem Conta Vinculada
          </span>
        );
    }
  };

  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/70 space-y-3.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-red-600/15 border border-red-500/30 flex items-center justify-center text-red-400">
            <KeyRound className="h-4 w-4" />
          </div>
          <div>
            <h4 className="font-bold text-white uppercase tracking-wider text-xs">
              Acesso ao {targetType === 'student' ? 'Portal do Aluno' : 'Portal do Responsável'}
            </h4>
            <p className="text-[11px] text-slate-400">
              Gerencie convite, vínculo de conta (E-mail ou Google) e permissões de visualização.
            </p>
          </div>
        </div>
        {statusBadge()}
      </div>

      {feedback && (
        <div
          className={`p-2.5 rounded-lg border text-[11px] flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
              : 'bg-red-950/50 border-red-500/40 text-red-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-red-400 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Convite ativo / Código para ativação */}
      {summary.status === 'invited' && summary.inviteCode && (
        <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-300 block">
              Código de Convite Seguro (requer CPF {person.cpf || 'do titular'}):
            </span>
            <div className="flex items-center gap-2 mt-1">
              <code className="px-2.5 py-1 rounded bg-slate-900 border border-amber-500/40 text-amber-300 font-mono font-bold text-sm tracking-widest">
                {summary.inviteCode}
              </code>
              <button
                type="button"
                onClick={() => handleCopyCode(summary.inviteCode!)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] transition-colors cursor-pointer"
              >
                {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedCode ? 'Copiado!' : 'Copiar Código'}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => handleAction('resend_invite')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-200 font-semibold text-[11px] transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reenviar Convite</span>
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => handleAction('revoke_invite')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/60 border border-red-500/40 text-red-300 font-semibold text-[11px] transition-colors cursor-pointer"
            >
              <Ban className="h-3.5 w-3.5" />
              <span>Cancelar Convite</span>
            </button>
          </div>
        </div>
      )}

      {/* Formulário para emitir novo convite quando não há conta ativa */}
      {(summary.status === 'none' || summary.status === 'revoked') && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2.5">
          <div className="flex-1">
            <label className="block text-[11px] text-slate-400 mb-1">
              E-mail para convite de acesso ({targetType === 'student' ? 'Aluno' : 'Responsável'})
            </label>
            <div className="relative">
              <Mail className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@exemplo.com.br"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-8 pr-3 py-1.5 text-white text-xs focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => handleAction('create_invite')}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>Gerar Convite de Acesso</span>
          </button>
        </div>
      )}

      {/* Controles de conta ativa ou bloqueada */}
      {(summary.status === 'active' || summary.status === 'blocked') && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="text-[11px] text-slate-300">
            Conta vinculada:{' '}
            <strong className="text-white">{summary.linkedUserEmail || person.email || 'Usuário autenticado'}</strong>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {summary.status === 'active' ? (
              <>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleAction('block')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-950/60 hover:bg-amber-900/60 border border-amber-500/40 text-amber-300 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  <Ban className="h-3 w-3" />
                  <span>Bloquear Acesso</span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleAction('revoke_access')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-950/60 hover:bg-red-900/60 border border-red-500/40 text-red-300 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  <Lock className="h-3 w-3" />
                  <span>Revogar Vínculo</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={() => handleAction('reactivate')}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reativar Acesso</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Permissão opcional de visualização da evolução antropométrica pelo próprio aluno */}
      {targetType === 'student' && student && (
        <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-400 shrink-0" />
            <div>
              <span className="font-semibold text-slate-200 block text-[11px]">
                Visualização de Antropometria e Evolução de IMC no Portal do Aluno
              </span>
              <span className="text-[10px] text-slate-400">
                Quando habilitado, o aluno pode consultar seu histórico de peso, altura e IMC em sua própria conta.
              </span>
            </div>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={Boolean(summary.allowAnthropometryView)}
              disabled={loading}
              onChange={(e) => handleAction('toggle_anthropometry', e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-red-600 focus:ring-red-500"
            />
            <span className="text-[11px] font-semibold text-slate-300">
              {summary.allowAnthropometryView ? 'Liberado' : 'Restrito'}
            </span>
          </label>
        </div>
      )}
    </div>
  );
};
