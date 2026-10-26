import React from 'react';
import {
  ShieldAlert,
  Clock,
  AlertTriangle,
  CreditCard,
  QrCode,
  Copy,
  CheckCircle2,
  Phone,
  Mail,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { Tenant, SaaSCommercialPlan, SaaSSubscription } from '../../types';
import { formatCurrencyBRL } from '../../utils/formatters';

interface TenantAccessRestrictedViewProps {
  tenant: Tenant;
  accessState: 'blocked_suspended' | 'trial_expired' | 'blocked_past_due' | 'waiting_payment';
  message: string;
  subscription?: SaaSSubscription | null;
  plans: SaaSCommercialPlan[];
  onOpenUpgradeModal?: () => void;
  onContactSupport?: () => void;
  onRefreshStatus?: () => void;
}

export const TenantAccessRestrictedView: React.FC<TenantAccessRestrictedViewProps> = ({
  tenant,
  accessState,
  message,
  subscription,
  plans,
  onOpenUpgradeModal,
  onContactSupport,
  onRefreshStatus,
}) => {
  const [copiedPix, setCopiedPix] = React.useState(false);

  const mockPixPayload =
    '00020126580014br.gov.bcb.pix0136tatameclub-mensalidade-saas5204000053039865406' +
    (subscription?.amount || 149.0).toFixed(2) +
    '5802BR5910TatameClub6009Sao Paulo62070503***6304A1B2';

  const handleCopyPix = () => {
    navigator.clipboard?.writeText(mockPixPayload);
    setCopiedPix(true);
    setTimeout(() => setCopiedPix(false), 2500);
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 text-center space-y-6 shadow-2xl">
        {/* State Icon */}
        {accessState === 'blocked_suspended' && (
          <div className="h-16 w-16 mx-auto rounded-2xl bg-rose-950/80 border border-rose-500/40 flex items-center justify-center text-rose-400">
            <ShieldAlert className="h-8 w-8" />
          </div>
        )}

        {accessState === 'trial_expired' && (
          <div className="h-16 w-16 mx-auto rounded-2xl bg-amber-950/80 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Clock className="h-8 w-8" />
          </div>
        )}

        {accessState === 'blocked_past_due' && (
          <div className="h-16 w-16 mx-auto rounded-2xl bg-orange-950/80 border border-orange-500/40 flex items-center justify-center text-orange-400">
            <AlertTriangle className="h-8 w-8" />
          </div>
        )}

        {accessState === 'waiting_payment' && (
          <div className="h-16 w-16 mx-auto rounded-2xl bg-blue-950/80 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <CreditCard className="h-8 w-8" />
          </div>
        )}

        {/* Title & Description */}
        <div className="space-y-2">
          <div className="text-xs uppercase font-bold tracking-wider text-slate-400">
            {tenant.tradeName}
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {accessState === 'blocked_suspended' && 'Acesso Suspenso Administrativamente'}
            {accessState === 'trial_expired' && 'Período de Degustação Encerrado'}
            {accessState === 'blocked_past_due' && 'Regularização de Mensalidade Necessária'}
            {accessState === 'waiting_payment' && 'Aguardando Confirmação do Pagamento'}
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed max-w-md mx-auto">
            {message}
          </p>
        </div>

        {/* Guarantees Box */}
        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-left text-xs space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            <span>Seus dados e históricos continuam 100% seguros</span>
          </div>
          <p className="text-[11px] text-slate-400">
            Nenhum dado cadastral de aluno, graduação, faixa ou frequência é apagado. A suspensão restringe temporariamente a operação do painel até a regularização.
          </p>
        </div>

        {/* Action Panel based on state */}
        {accessState === 'trial_expired' && (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
              {plans
                .filter(p => p.price > 0 && p.active)
                .slice(0, 2)
                .map(plan => (
                  <div key={plan.id} className="p-3.5 rounded-xl border border-slate-800 bg-slate-950 text-xs space-y-1">
                    <div className="font-bold text-white">{plan.name}</div>
                    <div className="font-mono text-emerald-400 font-bold">{formatCurrencyBRL(plan.price)}/mês</div>
                    <div className="text-[10px] text-slate-400">Até {plan.maxStudents} alunos cadastrados</div>
                  </div>
                ))}
            </div>

            <button
              onClick={onOpenUpgradeModal}
              className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Sparkles className="h-4 w-4" />
              <span>Escolher Plano e Continuar Usando</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {accessState === 'blocked_past_due' && (
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 text-left text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">Pagamento Instantâneo via PIX:</span>
              <span className="font-mono font-bold text-emerald-400">
                {formatCurrencyBRL(subscription?.amount || 149.0)}
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300 break-all select-all flex items-center justify-between gap-2">
              <span className="truncate">{mockPixPayload}</span>
              <button
                onClick={handleCopyPix}
                className="shrink-0 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                {copiedPix ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span>{copiedPix ? 'Copiado!' : 'Copiar'}</span>
              </button>
            </div>

            <p className="text-[10px] text-slate-500">
              A baixa é processada automaticamente via webhook em poucos segundos após a confirmação bancária.
            </p>
          </div>
        )}

        {/* Support & Actions Footer */}
        <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-slate-500" />
              <span>suporte@tatameclub.com.br</span>
            </span>
          </div>

          {onRefreshStatus && (
            <button
              onClick={onRefreshStatus}
              className="px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              Verificar Regularização
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
