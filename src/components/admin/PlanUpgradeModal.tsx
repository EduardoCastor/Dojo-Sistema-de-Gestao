import React, { useState, useEffect } from 'react';
import {
  X,
  Crown,
  Check,
  ShieldCheck,
  Sparkles,
  Copy,
  Mail,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Clock,
  Building2,
} from 'lucide-react';
import { Tenant, SaaSPlanId, BillingCycle, SaaSCommercialPlan } from '../../types';
import {
  saasPlatformService,
  BILLING_CYCLE_OPTIONS,
  PlanSubscriptionRequestResult,
} from '../../services/saasPlatformService';
import { DataStore } from '../../data/storage';

interface PlanUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: Tenant;
  onConfirmUpgrade: (newPlanId: SaaSPlanId, requestResult?: PlanSubscriptionRequestResult) => void;
}

export const PlanUpgradeModal: React.FC<PlanUpgradeModalProps> = ({
  isOpen,
  onClose,
  tenant,
  onConfirmUpgrade,
}) => {
  const [plans, setPlans] = useState<SaaSCommercialPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<SaaSPlanId>(
    tenant.planId === 'trial' ? 'advanced' : tenant.planId
  );
  const [selectedCycle, setSelectedCycle] = useState<BillingCycle>('monthly');
  const [recipientEmail, setRecipientEmail] = useState<string>(tenant.email || '');
  const [submitting, setSubmitting] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [requestResult, setRequestResult] = useState<PlanSubscriptionRequestResult | null>(null);
  const [copiedPix, setCopiedPix] = useState(false);

  const pixConfig = saasPlatformService.getCentralizedPixConfig();

  useEffect(() => {
    if (isOpen) {
      const commercialPlans = DataStore.getCommercialPlans().filter(
        (p) => p.id !== 'trial' && p.active !== false
      );
      setPlans(commercialPlans);
      setRecipientEmail(tenant.email || '');
      setErrorMsg(null);

      // Load any existing pending subscription request so the user sees its current status
      const existingSub = DataStore.getSaaSSubscriptions(tenant.id)[0];
      if (existingSub?.requestedPlanId && existingSub.requestedPlanId !== 'trial') {
        setSelectedPlanId(existingSub.requestedPlanId as SaaSPlanId);
      } else if (tenant.planId !== 'trial') {
        setSelectedPlanId(tenant.planId);
      } else {
        setSelectedPlanId('advanced');
      }
      if (existingSub?.requestedBillingCycle) {
        setSelectedCycle(existingSub.requestedBillingCycle);
      }
    }
  }, [isOpen, tenant.id, tenant.email, tenant.planId]);

  if (!isOpen) return null;

  const selectedPlan =
    plans.find((p) => p.id === selectedPlanId) ||
    plans.find((p) => p.id === 'advanced') ||
    plans[0];

  const currentPricing = selectedPlan
    ? saasPlatformService.calculatePlanCyclePricing(selectedPlan, selectedCycle)
    : null;

  const handleRequestSubscription = async () => {
    if (!selectedPlan) return;
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const result = await saasPlatformService.requestPlanSubscriptionAndSendEmail({
        tenantId: tenant.id,
        planId: selectedPlan.id,
        billingCycle: selectedCycle,
        recipientEmail: recipientEmail.trim() || tenant.email,
        actorUserName: tenant.adminName || tenant.tradeName,
      });

      setRequestResult(result);
      onConfirmUpgrade(selectedPlan.id as SaaSPlanId, result);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível registrar a solicitação de plano.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendEmail = async () => {
    setErrorMsg(null);
    setResendingEmail(true);
    try {
      const emailDiag = await saasPlatformService.resendSubscriptionPaymentEmail({
        tenantId: tenant.id,
        recipientEmail: recipientEmail.trim() || tenant.email,
      });
      if (requestResult) {
        setRequestResult({
          ...requestResult,
          emailDispatch: emailDiag,
        });
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao reenviar o e-mail de instruções.');
    } finally {
      setResendingEmail(false);
    }
  };

  const handleCopyPixKey = () => {
    const keyToCopy = requestResult?.pixConfig.pixKey || pixConfig.pixKey;
    navigator.clipboard.writeText(keyToCopy);
    setCopiedPix(true);
    setTimeout(() => setCopiedPix(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">
                {requestResult
                  ? 'Solicitação Registrada — Instruções de Pagamento Pix'
                  : 'Contratar Plano Comercial • Tatame Club'}
              </h3>
              <p className="text-xs text-zinc-400">
                Academia: <strong className="text-zinc-200">{tenant.tradeName}</strong> •{' '}
                {pixConfig.beneficiaryName} (CNPJ: {pixConfig.beneficiaryCnpj})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {errorMsg && (
            <div className="p-4 rounded-xl bg-red-950/50 border border-red-500/40 text-red-200 text-xs flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-red-300">Atenção</p>
                <p className="mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          {!requestResult ? (
            <>
              {/* Billing Cycle Selector */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                      1. Escolha o Ciclo de Cobrança
                    </h4>
                    <p className="text-xs text-zinc-500">
                      Economize até 15% contratando ciclos mais longos via Pix.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {BILLING_CYCLE_OPTIONS.map((cycle) => {
                      const active = selectedCycle === cycle.id;
                      return (
                        <button
                          key={cycle.id}
                          type="button"
                          onClick={() => setSelectedCycle(cycle.id)}
                          className={`px-3 py-2 rounded-lg border text-xs font-bold transition-all flex flex-col items-center ${
                            active
                              ? 'bg-red-600/15 border-red-500 text-white shadow-sm'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                          }`}
                        >
                          <span>{cycle.label}</span>
                          {cycle.badge && (
                            <span className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                              {cycle.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Plan Cards */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
                  2. Selecione o Plano Comercial Desejado
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {plans.map((plan) => {
                    const isSelected = selectedPlanId === plan.id;
                    const isCurrentActive =
                      tenant.planId === plan.id && tenant.status === 'active';
                    const pricing = saasPlatformService.calculatePlanCyclePricing(
                      plan,
                      selectedCycle
                    );

                    return (
                      <div
                        key={plan.id}
                        onClick={() => setSelectedPlanId(plan.id as SaaSPlanId)}
                        className={`cursor-pointer rounded-2xl p-5 border-2 transition-all relative flex flex-col justify-between ${
                          isSelected
                            ? 'bg-red-600/10 border-red-600 shadow-lg shadow-red-600/10'
                            : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-red-400">
                              {plan.name}
                            </span>
                            {isCurrentActive && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/40">
                                Plano Atual
                              </span>
                            )}
                          </div>

                          <div className="flex items-baseline gap-1 my-2">
                            <span className="text-2xl font-black text-white">
                              R$ {pricing.effectiveMonthlyPrice.toFixed(2).replace('.', ',')}
                            </span>
                            <span className="text-xs text-zinc-400">/mês</span>
                          </div>
                          {selectedCycle !== 'monthly' && (
                            <p className="text-[11px] text-emerald-400 font-semibold mb-2">
                              Total no ciclo {pricing.billingCycleLabel}: R${' '}
                              {pricing.totalAmount.toFixed(2).replace('.', ',')}
                            </p>
                          )}

                          <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                            {plan.tagline || plan.description}
                          </p>

                          <div className="space-y-2 border-t border-zinc-800/80 pt-3 text-xs">
                            <div className="flex items-center gap-2 text-zinc-300">
                              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                              <span>
                                Até <strong>{plan.maxStudents} alunos</strong> ativos
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-zinc-300">
                              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                              <span>
                                Até{' '}
                                <strong>
                                  {plan.maxBranches}{' '}
                                  {plan.maxBranches === 1 ? 'unidade' : 'unidades (filiais)'}
                                </strong>
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-zinc-300">
                              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                              <span>
                                Até <strong>{plan.maxUsers} membros</strong> na equipe
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-zinc-300">
                              <Check
                                className={`w-4 h-4 shrink-0 ${
                                  plan.features.digitalLibrary
                                    ? 'text-emerald-400'
                                    : 'text-zinc-600'
                                }`}
                              />
                              <span
                                className={
                                  plan.features.digitalLibrary
                                    ? 'text-zinc-200'
                                    : 'text-zinc-500 line-through'
                                }
                              >
                                Biblioteca Digital de Vídeos
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-zinc-300">
                              <Check
                                className={`w-4 h-4 shrink-0 ${
                                  plan.features.competitions
                                    ? 'text-emerald-400'
                                    : 'text-zinc-600'
                                }`}
                              />
                              <span
                                className={
                                  plan.features.competitions
                                    ? 'text-zinc-200'
                                    : 'text-zinc-500 line-through'
                                }
                              >
                                Gestão de Competições e Exames
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-zinc-400">
                            Valor a pagar via Pix:
                          </span>
                          <span className="text-sm font-black text-white">
                            R$ {pricing.totalAmount.toFixed(2).replace('.', ',')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Administrative Email Confirmation */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-zinc-300">
                      3. E-mail Administrativo para Recebimento das Instruções Pix
                    </label>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Enviaremos automaticamente os dados da solicitação, a chave Pix e as orientações de comprovante.
                    </p>
                  </div>
                  <div className="w-full sm:w-80">
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="financeiro@suaacademia.com.br"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
                    />
                  </div>
                </div>

                {currentPricing && (
                  <div className="pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="text-zinc-400">
                      Resumo:{' '}
                      <strong className="text-white">{currentPricing.planName}</strong> • Ciclo{' '}
                      <strong className="text-white">{currentPricing.billingCycleLabel}</strong>
                    </div>
                    <div className="text-zinc-300">
                      Total a pagar via Pix:{' '}
                      <strong className="text-emerald-400 text-sm">
                        R$ {currentPricing.totalAmount.toFixed(2).replace('.', ',')}
                      </strong>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs text-zinc-400 leading-relaxed">
                  <strong className="text-zinc-200 block mb-0.5">
                    Importante sobre a liberação de acesso:
                  </strong>
                  Ao confirmar a solicitação, sua assinatura ficará registrada com status{' '}
                  <strong className="text-amber-300">Pagamento Pendente (pending_payment)</strong>.
                  O acesso comercial definitivo será liberado após a confirmação válida do pagamento Pix.
                  Todos os alunos, graduações e registros financeiros da sua academia permanecem 100% preservados.
                </div>
              </div>
            </>
          ) : (
            /* Confirmation & Pix Instructions Step */
            <div className="space-y-5">
              {/* 1. Database Registration Status */}
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs text-zinc-300 space-y-1 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-emerald-300 text-sm">
                      Solicitação de contratação registrada no banco de dados!
                    </p>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Status: Pagamento Pendente (pending_payment)
                    </span>
                  </div>
                  <p className="text-zinc-400">
                    Identificador da Solicitação:{' '}
                    <code className="text-white font-mono bg-zinc-900 px-1.5 py-0.5 rounded">
                      {requestResult.payment.referenceId || requestResult.payment.id}
                    </code>{' '}
                    • Assinatura:{' '}
                    <code className="text-zinc-300 font-mono">
                      {requestResult.subscription.id}
                    </code>
                  </p>
                </div>
              </div>

              {/* 2. Automatic Email Dispatch Status */}
              <div
                className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  requestResult.emailDispatch.emailSent
                    ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                    : 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <Mail
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      requestResult.emailDispatch.emailSent
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}
                  />
                  <div className="text-xs space-y-1">
                    <p className="font-bold text-sm">
                      {requestResult.emailDispatch.emailSent
                        ? `E-mail de instruções enviado para ${requestResult.emailDispatch.recipientEmail}`
                        : `Solicitação salva, mas o envio automático de e-mail requer atenção (${requestResult.emailDispatch.status})`}
                    </p>
                    <p className="text-zinc-300">
                      Assunto: <strong>{requestResult.emailDispatch.subject}</strong>
                    </p>
                    {!requestResult.emailDispatch.emailSent &&
                      requestResult.emailDispatch.errorMessage && (
                        <p className="text-amber-300/90 mt-1">
                          Diagnóstico: {requestResult.emailDispatch.errorMessage}
                        </p>
                      )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleResendEmail}
                  disabled={resendingEmail}
                  className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold flex items-center gap-2 shrink-0 self-start sm:self-center border border-zinc-700 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${resendingEmail ? 'animate-spin' : ''}`} />
                  {resendingEmail ? 'Reenviando...' : 'Reenviar E-mail'}
                </button>
              </div>

              {/* 3. Pix Payment Card */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-red-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                      Dados para Pagamento via Pix
                    </span>
                  </div>
                  <span className="text-xs text-zinc-400">
                    Favorecido:{' '}
                    <strong className="text-white">
                      {requestResult.pixConfig.beneficiaryName}
                    </strong>{' '}
                    (CNPJ: {requestResult.pixConfig.beneficiaryCnpj})
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-3">
                    <span className="text-zinc-500 block">Plano Contratado</span>
                    <strong className="text-white text-sm mt-0.5 block">
                      {requestResult.pricing.planName}
                    </strong>
                  </div>
                  <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-3">
                    <span className="text-zinc-500 block">Ciclo de Cobrança</span>
                    <strong className="text-white text-sm mt-0.5 block">
                      {requestResult.pricing.billingCycleLabel} ({requestResult.pricing.months}{' '}
                      {requestResult.pricing.months === 1 ? 'mês' : 'meses'})
                    </strong>
                  </div>
                  <div className="bg-zinc-900/90 border border-emerald-500/30 rounded-xl p-3">
                    <span className="text-zinc-400 block">Valor Total a Pagar</span>
                    <strong className="text-emerald-400 text-base font-black mt-0.5 block">
                      R$ {requestResult.pricing.totalAmount.toFixed(2).replace('.', ',')}
                    </strong>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-400 mb-1.5">
                    Chave Pix (CNPJ — somente números):
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 font-mono text-base font-bold text-white tracking-wider select-all">
                      {requestResult.pixConfig.pixKey}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyPixKey}
                      className="px-4 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-2 transition-colors shrink-0"
                    >
                      {copiedPix ? (
                        <>
                          <Check className="w-4 h-4" /> Copiada!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" /> Copiar Chave Pix
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {requestResult.pixConfig.isProvisional && (
                  <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200/90 text-[11px] flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>{requestResult.pixConfig.provisionalNotice}</span>
                  </div>
                )}

                <div className="border-t border-zinc-800 pt-3 text-xs text-zinc-300 space-y-1.5">
                  <p className="font-bold text-white">Instruções para conclusão e liberação:</p>
                  <ol className="list-decimal list-inside space-y-1 text-zinc-400">
                    <li>
                      No aplicativo do seu banco, acesse <strong>Pix &rarr; Pagar com Chave (CNPJ)</strong> e informe a chave{' '}
                      <strong className="text-zinc-200">{requestResult.pixConfig.pixKey}</strong>.
                    </li>
                    <li>
                      Transfira o valor de{' '}
                      <strong className="text-emerald-400">
                        R$ {requestResult.pricing.totalAmount.toFixed(2).replace('.', ',')}
                      </strong>{' '}
                      em favor de <strong>{requestResult.pixConfig.beneficiaryName}</strong>.
                    </li>
                    <li>
                      Envie o comprovante para{' '}
                      <strong className="text-zinc-200">{requestResult.pixConfig.receiptEmail}</strong>{' '}
                      informando o identificador{' '}
                      <code className="text-zinc-200">
                        {requestResult.payment.referenceId || requestResult.payment.id}
                      </code>{' '}
                      e o nome da academia (<strong>{tenant.tradeName}</strong>).
                    </li>
                    <li>
                      Assim que o pagamento for validado no painel global do Tatame Club, o status da sua licença passará para{' '}
                      <strong className="text-emerald-400">Ativa</strong> e o acesso será liberado imediatamente.
                    </li>
                  </ol>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between gap-3">
          {requestResult ? (
            <>
              <button
                type="button"
                onClick={() => setRequestResult(null)}
                className="px-4 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:text-white text-xs font-semibold transition-colors"
              >
                Alterar Plano ou Ciclo
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all"
              >
                Concluir e Aguardar Confirmação
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white text-xs font-semibold transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitting || !selectedPlan}
                onClick={handleRequestSubscription}
                className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-red-600/30 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                {submitting
                  ? 'Registrando Solicitação e Enviando E-mail...'
                  : `Solicitar ${selectedPlan?.name || 'Plano'} e Receber Chave Pix`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
