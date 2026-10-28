import React, { useState, useEffect, useRef } from 'react';
import {
  Save,
  Sparkles,
  Check,
  Upload,
  Image,
  Trash2,
  Building2,
  AlertCircle,
  Loader2,
  MapPin,
  Globe,
  ShieldCheck,
} from 'lucide-react';
import { Tenant, SaaSPlan } from '../../types';
import { CepInput } from '../common/CepInput';

interface SettingsViewProps {
  tenant: Tenant;
  plans: SaaSPlan[];
  onSaveTenant: (updatedTenant: Tenant) => Promise<void> | void;
  onUpgradePlan: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  tenant,
  plans,
  onSaveTenant,
  onUpgradePlan,
}) => {
  const [tradeName, setTradeName] = useState(tenant.tradeName || '');
  const [legalName, setLegalName] = useState(tenant.legalName || '');
  const [cnpj, setCnpj] = useState(tenant.cnpjOrCpf || '');
  const [adminName, setAdminName] = useState(tenant.adminName || '');
  const [email, setEmail] = useState(tenant.email || '');
  const [phone, setPhone] = useState(tenant.phone || '');
  const [whatsapp, setWhatsapp] = useState(tenant.whatsapp || '');
  const [website, setWebsite] = useState(tenant.website || '');
  const [logoUrl, setLogoUrl] = useState(tenant.logoUrl || '');
  const [retentionDays, setRetentionDays] = useState<number>(tenant.retentionDays ?? 1825);

  // Address fields
  const [street, setStreet] = useState(tenant.address?.street || '');
  const [number, setNumber] = useState(tenant.address?.number || '');
  const [neighborhood, setNeighborhood] = useState(tenant.address?.neighborhood || '');
  const [city, setCity] = useState(tenant.address?.city || '');
  const [state, setState] = useState(tenant.address?.state || 'SP');
  const [zipCode, setZipCode] = useState(tenant.address?.zipCode || '');

  // Financial & Commercial settings
  const [dueDay, setDueDay] = useState(tenant.settings?.defaultDueDay ?? 10);
  const [familyDiscount, setFamilyDiscount] = useState(tenant.settings?.familyDiscount2ndMember ?? 15);
  const [multiArtDiscount, setMultiArtDiscount] = useState(tenant.settings?.multiArtDiscount ?? 20);
  const [penaltyRate, setPenaltyRate] = useState(tenant.settings?.penaltyRate ?? 2);
  const [dailyInterestRate, setDailyInterestRate] = useState(tenant.settings?.dailyInterestRate ?? 0.033);

  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const numberInputRef = useRef<HTMLInputElement>(null);

  // Sync local form state when the tenant prop updates from Supabase fetch
  useEffect(() => {
    setTradeName(tenant.tradeName || '');
    setLegalName(tenant.legalName || '');
    setCnpj(tenant.cnpjOrCpf || '');
    setAdminName(tenant.adminName || '');
    setEmail(tenant.email || '');
    setPhone(tenant.phone || '');
    setWhatsapp(tenant.whatsapp || '');
    setWebsite(tenant.website || '');
    setLogoUrl(tenant.logoUrl || '');
    setRetentionDays(tenant.retentionDays ?? 1825);
    setStreet(tenant.address?.street || '');
    setNumber(tenant.address?.number || '');
    setNeighborhood(tenant.address?.neighborhood || '');
    setCity(tenant.address?.city || '');
    setState(tenant.address?.state || 'SP');
    setZipCode(tenant.address?.zipCode || '');
    setDueDay(tenant.settings?.defaultDueDay ?? 10);
    setFamilyDiscount(tenant.settings?.familyDiscount2ndMember ?? 15);
    setMultiArtDiscount(tenant.settings?.multiArtDiscount ?? 20);
    setPenaltyRate(tenant.settings?.penaltyRate ?? 2);
    setDailyInterestRate(tenant.settings?.dailyInterestRate ?? 0.033);
  }, [tenant]);

  const currentPlan = plans.find((p) => p.id === tenant?.planId) || plans[0];

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setSaveError('A imagem da logomarca deve ter no máximo 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoUrl(reader.result as string);
      setSaveError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSavedSuccess(false);

    if (!tradeName.trim()) {
      setSaveError('O Nome Fantasia do Dojo é obrigatório.');
      return;
    }

    const updated: Tenant = {
      ...tenant,
      tradeName: tradeName.trim(),
      legalName: legalName.trim() || tradeName.trim(),
      cnpjOrCpf: cnpj.trim(),
      adminName: adminName.trim() || tenant.adminName,
      email: email.trim(),
      phone: phone.trim(),
      whatsapp: whatsapp.trim() || phone.trim(),
      website: website.trim() || undefined,
      logoUrl: logoUrl || undefined,
      retentionDays: Number(retentionDays) || 1825,
      address: {
        street: street.trim(),
        number: number.trim(),
        neighborhood: neighborhood.trim(),
        city: city.trim(),
        state: state.trim(),
        zipCode: zipCode.trim(),
      },
      settings: {
        ...(tenant.settings || {}),
        defaultDueDay: Math.min(28, Math.max(1, Number(dueDay) || 10)),
        familyDiscount2ndMember: Math.min(100, Math.max(0, Number(familyDiscount) || 0)),
        multiArtDiscount: Math.min(100, Math.max(0, Number(multiArtDiscount) || 0)),
        penaltyRate: Math.min(20, Math.max(0, Number(penaltyRate) || 0)),
        dailyInterestRate: Math.max(0, Number(dailyInterestRate) || 0.033),
      },
    };

    setIsSaving(true);
    try {
      await onSaveTenant(updated);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 4000);
    } catch (err: any) {
      console.error('Erro ao salvar configurações do Dojo:', err);
      setSaveError(
        err?.message ||
          'Não foi possível salvar as configurações no banco de dados. Seus dados preenchidos foram mantidos para nova tentativa.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Configurações & Parâmetros do Dojo</h2>
        <p className="text-xs text-slate-400">
          Personalize os dados institucionais, endereço oficial, regras comerciais de desconto, vencimento e retenção LGPD.
        </p>
      </div>

      {/* Plan Status Banner */}
      <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-white">Plano Contratado: {currentPlan.name}</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
              {tenant.status === 'trial' ? 'Em Período de Teste' : 'Assinatura Ativa'}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Limite: até {currentPlan.maxStudents} alunos e {currentPlan.maxBranches} filiais.
          </p>
        </div>

        <button
          type="button"
          onClick={onUpgradePlan}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-xs shadow transition-colors cursor-pointer"
        >
          <Sparkles className="h-4 w-4" />
          <span>Trocar ou Contratar Plano</span>
        </button>
      </div>

      {saveError && (
        <div className="p-3.5 rounded-lg bg-red-950/70 border border-red-500/50 text-red-200 text-xs flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
          <div>
            <p className="font-semibold text-red-300">Falha ao gravar configurações:</p>
            <p>{saveError}</p>
          </div>
        </div>
      )}

      {savedSuccess && (
        <div className="p-3.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>Configurações do Dojo gravadas e confirmadas com sucesso!</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6 text-xs">
        {/* 1. Dados Institucionais */}
        <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-4">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            1. Dados Cadastrais & Impressão de Recibos
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Nome Fantasia *</label>
              <input
                type="text"
                required
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Razão Social</label>
              <input
                type="text"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Responsável / Sensei Titular</label>
              <input
                type="text"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="Nome do responsável pela academia"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Website ou Instagram Oficial</label>
              <div className="relative">
                <Globe className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://instagram.com/seudojo"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-8 pr-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Logomarca da Academia */}
          <div className="p-3.5 rounded-xl border border-slate-700/80 bg-slate-950/60 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-slate-200 font-semibold text-xs flex items-center gap-1.5">
                <Image className="h-4 w-4 text-red-400" />
                <span>Logomarca Oficial do Dojo (aparece no cabeçalho dos relatórios)</span>
              </label>
              <span className="text-[10px] text-slate-400">PNG, JPG, SVG ou WebP</span>
            </div>

            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-xl border-2 border-dashed border-slate-700 bg-slate-900 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="h-full w-full object-contain p-1" />
                ) : (
                  <Building2 className="h-7 w-7 text-slate-600" />
                )}
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-medium text-slate-200 hover:text-white transition-colors shadow-sm">
                    <Upload className="h-3.5 w-3.5 text-red-400" />
                    <span>Upload de Logo</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={handleLogoFileChange}
                      className="hidden"
                    />
                  </label>

                  {logoUrl && (
                    <button
                      type="button"
                      onClick={() => setLogoUrl('')}
                      className="p-1.5 rounded-lg border border-red-900/40 bg-red-950/40 text-red-400 hover:text-red-300 hover:bg-red-900/40 transition-colors"
                      title="Remover logotipo"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={logoUrl.startsWith('data:') ? '' : logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="Ou insira a URL da logomarca (https://...)"
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-slate-300 font-medium mb-1">CNPJ ou CPF</label>
              <input
                type="text"
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">E-mail de Contato</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Telefone Principal</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">WhatsApp Oficial</label>
              <input
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="(11) 99999-9999"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* 2. Endereço da Sede */}
        <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-4">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-red-400" />
            <span>2. Endereço Oficial da Academia</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <CepInput
                value={zipCode}
                onChange={setZipCode}
                onAddressResolved={(addr) => {
                  if (addr.logradouro) setStreet(addr.logradouro);
                  if (addr.bairro) setNeighborhood(addr.bairro);
                  if (addr.localidade) setCity(addr.localidade);
                  if (addr.uf) setState(addr.uf.toUpperCase());
                }}
                nextInputRef={numberInputRef}
                label="CEP"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-slate-300 font-medium mb-1">Logradouro (Rua / Av.)</label>
              <input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="Rua / Avenida"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-medium mb-1">Número</label>
              <input
                ref={numberInputRef}
                type="text"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="123"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Bairro</label>
              <input
                type="text"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-medium mb-1">Cidade</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-medium mb-1">UF</label>
              <input
                type="text"
                maxLength={2}
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase())}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* 3. Políticas de Mensalidades, Descontos e LGPD */}
        <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 space-y-4">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            3. Regras Comerciais, Descontos Familiares & Retenção LGPD
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Dia Padrão de Vencimento</label>
              <input
                type="number"
                min="1"
                max="28"
                value={dueDay}
                onChange={(e) => setDueDay(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Todo dia {dueDay} do mês</span>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Desconto Familiar (2º)</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={familyDiscount}
                  onChange={(e) => setFamilyDiscount(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
                <span className="absolute right-3 top-2 text-slate-400">%</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">Para irmãos matriculados</span>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Desconto 2ª Modalidade</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={multiArtDiscount}
                  onChange={(e) => setMultiArtDiscount(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
                <span className="absolute right-3 top-2 text-slate-400">%</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">Ex: Judô + Jiu-Jitsu</span>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Multa por Atraso</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.5"
                  value={penaltyRate}
                  onChange={(e) => setPenaltyRate(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
                <span className="absolute right-3 top-2 text-slate-400">%</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">Conforme limites legais CDC</span>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Juros ao Dia (%)</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.001"
                  value={dailyInterestRate}
                  onChange={(e) => setDailyInterestRate(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
                <span className="absolute right-3 top-2 text-slate-400">%</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">Padrão: 0.033% / dia</span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-slate-300">
              <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
              <div>
                <span className="font-semibold">Prazo de Retenção de Cadastros Inativos (LGPD):</span>
                <p className="text-[10px] text-slate-400">
                  Período padrão de guarda para histórico contratual e obrigações legais (em dias).
                </p>
              </div>
            </div>
            <div className="w-full sm:w-40">
              <input
                type="number"
                min="365"
                max="3650"
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-white focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-semibold text-xs shadow transition-colors cursor-pointer"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Gravando no banco de dados...</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                <span>Salvar Configurações</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
