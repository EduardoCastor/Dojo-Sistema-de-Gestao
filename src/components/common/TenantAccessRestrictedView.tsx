import React, { useState } from 'react';
import {
  ShieldAlert,
  Clock,
  Lock,
  Copy,
  CheckCircle2,
  QrCode,
  Phone,
  LogOut,
  Database,
  RefreshCw,
  Crown,
  Mail,
  AlertTriangle,
} from 'lucide-react';
import {
  Tenant,
  TenantAccessEvaluation,
  SaaSSubscription,
  SaaSCommercialPlan,
  SaaSPayment,
} from '../../types';
import { saasPlatformService } from '../../services/saasPlatformService';
import { DataStore } from '../../data/storage';

interface TenantAccessRestrictedViewProps {
  tenant: Tenant;
  evaluation: TenantAccessEvaluation;
  subscription?: SaaSSubscription | null;
  plan?: SaaSCommercialPlan | null;
  onLogout: () => void;
  onRefreshStatus?: () => void | Promise<void>;
  onOpenUpgradeModal?: () => void;
}

export const TenantAccessRestrictedView: React.FC<TenantAccessRestrictedViewProps> = ({
  tenant,
  evaluation,
  subscription,
  plan,
  onLogout,
  onRefreshStatus,
  onOpenUpgradeModal,
}) => {
  const [copiedPix, setCopiedPix] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const pixConfig = saasPlatformService.getCentralizedPixConfig();
  const payments: SaaSPayment[] = DataStore.getSaaSPayments(tenant.id);
  const pendingPayment = payments.find(
    (p) => p.status === 'pending' || p.status === 'under_review'
  );

  const handleCopyPix = () => {
    navigator.clipboard.writeText(pixConfig.pixKey);
    setCopiedPix(true);
    setTimeout(() => setCopiedPix(false), 3000);
  };

  const handleVerifyRegularization = async () => {
    if (!onRefreshStatus) return;
    setRefreshing(true);
    try {
      await onRefreshStatus();
    } finally {
      setRefreshing(false);
    }
  };

  const handleResendEmail = async () => {
    setResendingEmail(true);
    setEmailFeedback(null);
    try {
      const diag = await saasPlatformService.resendSubscriptionPaymentEmail({
        tenantId: tenant.id,
        recipientEmail: tenant.email,
      });
      if (diag.emailSent) {
        setEmailFeedback({
          type: 'success',
          text: `E-mail de instruções Pix enviado com sucesso para ${diag.recipientEmail}.`,
        });
      } else {
        setEmailFeedback({
          type: 'warning',
          text:
            diag.errorMessage ||
            'Não foi possível disparar o e-mail automático no momento. Utilize a chave Pix exibida abaixo.',
        });
      }
      if (onRefreshStatus) {
        await onRefreshStatus();
      }
    } catch (err: any) {
      setEmailFeedback({
        type: 'error',
        text: err?.message || 'Erro ao tentar reenviar o e-mail.',
      });
    } finally {
      setResendingEmail(false);
    }
  };

  const getHeaderStyle = () => {
    switch (evaluation.accessState) {
      case 'trial_expired':
        return {
          badge: 'Período de Degustação Encerrado',
          title: 'Contrate um plano comercial para continuar gerenciando sua academia',
          icon: Clock,
          color: 'text-amber-400',
          border: 'border-amber-500/30',
          bg: 'bg-amber-950/30',
        };
      case 'pending_payment':
      case 'waiting_payment':
      case 'payment_under_review':
        return {
          badge:
            evaluation.accessState === 'payment_under_review'
              ? 'Comprovante em Análise'
              : 'Pagamento Pix Pendente',
          title: 'Sua solicitação de plano foi registrada e aguarda confirmação do Pix',
          icon: QrCode,
          color: 'text-amber-400',
          border: 'border-amber-500/30',
          bg: 'bg-amber-950/30',
        };
      case 'rejected':
        return {
          badge: 'Pagamento Não Validado',
          title: 'Não foi possível validar o pagamento informado',
          icon: AlertTriangle,
          color: 'text-red-400',
          border: 'border-red-500/30',
          bg: 'bg-red-950/30',
        };
      case 'blocked_past_due':
        return {
          badge: 'Mensalidade Pendente',
          title: 'Regularize sua assinatura para reativar o painel operacional',
          icon: ShieldAlert,
          color: 'text-red-400',
          border: 'border-red-500/30',
          bg: 'bg-red-950/30',
        };
      case 'blocked_suspended':
        return {
          badge: 'Acesso Suspenso Administrativamente',
          title: 'Conta da academia temporariamente suspensa',
          icon: Lock,
          color: 'text-orange-400',
          border: 'border-orange-500/30',
          bg: 'bg-orange-950/30',
        };
      default:
        return {
          badge: 'Assinatura Restrita',
          title: 'Renove sua assinatura no Tatame Club',
          icon: Lock,
          color: 'text-zinc-400',
          border: 'border-zinc-700',
          bg: 'bg-zinc-900',
        };
    }
  };

  const style = getHeaderStyle();
  const Icon = style.icon;
  const displayAmount = Number(
    pendingPayment?.amount ?? subscription?.requestedAmount ?? subscription?.amount ?? plan?.price ?? 149
  );
  const displayPlanName =
    pendingPayment?.planName || subscription?.planName || plan?.name || 'Plano Comercial';
  const displayCycle =
    pendingPayment?.billingCycle || subscription?.requestedBillingCycle || subscription?.billingCycle || 'monthly';
  const cycleLabelMap: Record<string, string> = {
    monthly: 'Mensal',
    quarterly: 'Trimestral',
    semiannual: 'Semestral',
    annual: 'Anual',
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
      <div className="max-w-3xl w-full bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Top Banner */}
        <div className={`p-6 sm:p-8 border-b ${style.border} ${style.bg}`}>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <span
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-zinc-950/80 border ${style.border} ${style.color}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {style.badge}
            </span>
            <span className="text-xs text-zinc-400 font-medium">
              Academia: <strong className="text-zinc-200">{tenant.tradeName}</strong>
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white mb-2">{style.title}</h1>
          <p className="text-sm text-zinc-300 leading-relaxed">{evaluation.message}</p>
        </div>

        {/* Preservation Guarantee */}
        <div className="px-6 sm:px-8 py-4 bg-emerald-950/20 border-b border-emerald-500/20 flex items-center gap-3">
          <Database className="w-5 h-5 text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-200">
            <strong>Garantia de Preservação de Dados:</strong> Todos os cadastros de alunos, histórico de faixas, presenças, documentos médicos e lançamentos financeiros de{' '}
            <strong>{tenant.tradeName}</strong> estão 100% seguros e preservados no banco de dados.
          </p>
        </div>

        {/* Main Content */}
        <div className="p-6 sm:p-8 space-y-6">
          {emailFeedback && (
            <div
              className={`p-4 rounded-xl border text-xs flex items-start gap-2.5 ${
                emailFeedback.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : emailFeedback.type === 'warning'
                  ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                  : 'bg-red-950/40 border-red-500/40 text-red-200'
              }`}
            >
              <Mail className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{emailFeedback.text}</span>
            </div>
          )}

          {evaluation.accessState !== 'blocked_suspended' ? (
            <div className="space-y-5">
              {/* Step 1: Select or Change Commercial Plan */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="text-xs text-zinc-400 uppercase font-bold tracking-wider block">
                    {subscription?.status === 'pending_payment' || pendingPayment
                      ? 'Solicitação de Assinatura Registrada'
                      : '1. Escolha seu Plano Comercial'}
                  </span>
                  <h3 className="text-lg font-bold text-white mt-0.5">
                    {displayPlanName} ({cycleLabelMap[displayCycle] || displayCycle})
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    {subscription?.status === 'pending_payment' || pendingPayment ? (
                      <>
                        Identificador:{' '}
                        <code className="text-zinc-200 font-mono bg-zinc-900 px-1.5 py-0.5 rounded">
                          {pendingPayment?.referenceId || pendingPayment?.id || subscription?.id}
                        </code>{' '}
                        • Status:{' '}
                        <strong className="text-amber-400">
                          Pagamento Pendente (pending_payment)
                        </strong>
                      </>
                    ) : (
                      'Selecione o plano ideal (Básico, Avançado ou Enterprise) e o ciclo de cobrança para gerar sua solicitação e receber as instruções por e-mail.'
                    )}
                  </p>
                </div>

                <div className="flex flex-col sm:items-end gap-2 shrink-0">
                  <div className="text-left sm:text-right">
                    <span className="text-xs text-zinc-500 block">Valor Total do Ciclo</span>
                    <span className="text-2xl font-black text-emerald-400">
                      R$ {displayAmount.toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                  {onOpenUpgradeModal && (
                    <button
                      type="button"
                      onClick={onOpenUpgradeModal}
                      className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-red-600/20 transition-all"
                    >
                      <Crown className="w-4 h-4" />
                      {subscription?.status === 'pending_payment' || pendingPayment
                        ? 'Alterar Plano / Ver Detalhes'
                        : 'Selecionar Plano Comercial'}
                    </button>
                  )}
                </div>
              </div>

              {/* Step 2: Pix Payment Instructions */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                    <QrCode className="w-4 h-4" />
                    <span>Instruções de Pagamento via Pix ({pixConfig.productName})</span>
                  </div>
                  <span className="text-xs text-zinc-400">
                    Favorecido:{' '}
                    <strong className="text-zinc-200">{pixConfig.beneficiaryName}</strong> (CNPJ:{' '}
                    {pixConfig.beneficiaryCnpj})
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                    Chave Pix Oficial (CNPJ somente números):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={pixConfig.pixKey}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3.5 py-2.5 text-sm text-white font-mono font-bold tracking-wider select-all focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCopyPix}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors"
                    >
                      {copiedPix ? (
                        <>
                          <CheckCircle2 className="w-4 h-4" /> Copiada!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" /> Copiar Chave Pix
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {pixConfig.isProvisional && (
                  <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/30 text-amber-200/90 text-[11px] flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>{pixConfig.provisionalNotice}</span>
                  </div>
                )}

                <div className="text-xs text-zinc-400 space-y-1.5 border-t border-zinc-800/80 pt-3">
                  <p className="text-zinc-200 font-semibold">
                    Como liberar o acesso da sua academia:
                  </p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>
                      Clique em <strong>Selecionar Plano Comercial</strong> acima para registrar sua escolha e receber o e-mail automático em{' '}
                      <strong className="text-zinc-200">{tenant.email}</strong>.
                    </li>
                    <li>
                      Realize o pagamento Pix para a chave CNPJ{' '}
                      <strong className="text-zinc-200">{pixConfig.pixKey}</strong> ({pixConfig.beneficiaryName}).
                    </li>
                    <li>
                      Envie o comprovante para{' '}
                      <strong className="text-zinc-200">{pixConfig.receiptEmail}</strong>. O acesso será liberado imediatamente após a confirmação válida do pagamento.
                    </li>
                  </ol>
                </div>

                {(subscription?.status === 'pending_payment' || pendingPayment) && (
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80">
                    <span className="text-xs text-zinc-400">
                      Status do último envio de e-mail:{' '}
                      <strong
                        className={
                          subscription?.lastEmailStatus === 'sent'
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }
                      >
                        {subscription?.lastEmailStatus === 'sent'
                          ? 'Enviado com sucesso'
                          : subscription?.lastEmailStatus === 'missing_config'
                          ? 'Pendente de configuração do servidor de e-mail'
                          : subscription?.lastEmailStatus === 'failed'
                          ? 'Falha no envio'
                          : 'Aguardando disparo'}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={handleResendEmail}
                      disabled={resendingEmail}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 border border-zinc-700 transition-colors disabled:opacity-50"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      {resendingEmail ? 'Reenviando...' : 'Reenviar E-mail de Instruções Pix'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-white">Motivo da Suspensão Administrativa:</h3>
              <p className="text-xs text-zinc-300 bg-zinc-900 p-3.5 rounded-lg border border-zinc-800">
                {subscription?.suspendedReason ||
                  tenant.suspendedReason ||
                  'Suspensão temporária aplicada pelo operador da plataforma Tatame Club.'}
              </p>
              <p className="text-xs text-zinc-400">
                Entre em contato com o suporte administrativo da plataforma Tatame Club ({pixConfig.beneficiaryName}) para regularizar sua conta e restabelecer o acesso imediatamente.
              </p>
            </div>
          )}

          {/* Actions Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-zinc-800">
            <div className="flex items-center gap-4 text-xs text-zinc-400">
              <span className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-red-500" />
                Suporte Financeiro: {pixConfig.receiptEmail}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {onRefreshStatus && (
                <button
                  type="button"
                  disabled={refreshing}
                  onClick={handleVerifyRegularization}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  {refreshing ? 'Consultando Banco...' : 'Verificar Regularização'}
                </button>
              )}
              <button
                type="button"
                onClick={onLogout}
                className="px-4 py-2 bg-red-950/50 hover:bg-red-900/60 text-red-300 border border-red-800/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sair da Conta
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
