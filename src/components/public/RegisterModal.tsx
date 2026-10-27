import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Building2,
  User,
  Mail,
  Phone,
  MapPin,
  CheckCircle,
  Clock,
  AlertCircle,
  Upload,
  Image,
  Trash2,
  Save,
  RotateCcw,
} from 'lucide-react';
import { Tenant, Branch, User as UserType } from '../../types';
import { supabase, authService, isSupabaseConfigured, UserMembership } from '../../services/supabase';
import { formDraftStore } from '../../utils/formDraftStore';

interface RegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newTenant: Tenant, newBranch: Branch, newUser: UserType) => void;
  onRegisterAtomicSuccess?: (rpcResult: any, memberships: UserMembership[]) => void;
  onOpenLogin?: () => void;
  onOpenTerms?: () => void;
  onOpenPrivacy?: () => void;
}

interface SupabaseErrorDetail {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

interface RegisterAcademyDraft {
  tradeName: string;
  legalName: string;
  cnpjOrCpf: string;
  adminName: string;
  email: string;
  phone: string;
  whatsapp: string;
  logoUrl: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  acceptedLegal: boolean;
}

const DRAFT_FORM_KEY = 'register_academy_modal';

export const RegisterModal: React.FC<RegisterModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onRegisterAtomicSuccess,
  onOpenLogin,
  onOpenTerms,
  onOpenPrivacy,
}) => {
  const [tradeName, setTradeName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [cnpjOrCpf, setCnpjOrCpf] = useState('');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('São Paulo');
  const [state, setState] = useState('SP');
  const [zipCode, setZipCode] = useState('');
  const [acceptedLegal, setAcceptedLegal] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailedError, setDetailedError] = useState<SupabaseErrorDetail | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [currentSessionUser, setCurrentSessionUser] = useState<any>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);

  const wasOpenRef = useRef(false);
  const supabaseActive = isSupabaseConfigured();

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('A imagem da logomarca deve ter no máximo 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      setLogoUrl(res);
    };
    reader.readAsDataURL(file);
  };

  // Inicializa apenas na transição fechado -> aberto para nunca perder estado ao alternar abas
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      setError(null);
      setDetailedError(null);
      setSuccessMessage(null);

      const restoreDraftForUser = (userId: string) => {
        const loaded = formDraftStore.loadDraft<RegisterAcademyDraft>({
          tenantId: 'public',
          userId,
          formKey: DRAFT_FORM_KEY,
        });
        if (loaded && loaded.data) {
          const d = loaded.data;
          setTradeName(d.tradeName || '');
          setLegalName(d.legalName || '');
          setCnpjOrCpf(d.cnpjOrCpf || '');
          setAdminName(d.adminName || '');
          setEmail(d.email || '');
          setPhone(d.phone || '');
          setWhatsapp(d.whatsapp || '');
          setLogoUrl(d.logoUrl || '');
          setStreet(d.street || '');
          setNumber(d.number || '');
          setNeighborhood(d.neighborhood || '');
          setCity(d.city || 'São Paulo');
          setState(d.state || 'SP');
          setZipCode(d.zipCode || '');
          setAcceptedLegal(Boolean(d.acceptedLegal));
          setDraftSavedAt(loaded.savedAt);
          setRestoredFromDraft(true);
          return true;
        }
        return false;
      };

      if (supabaseActive && supabase) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session?.user) {
            setCurrentSessionUser(session.user);
            const restored = restoreDraftForUser(session.user.id);
            if (!restored) {
              if (session.user.email) setEmail((prev) => prev || session.user.email || '');
              if (session.user.user_metadata?.full_name) {
                setAdminName((prev) => prev || session.user.user_metadata.full_name || '');
              }
            }
          } else {
            setCurrentSessionUser(null);
            restoreDraftForUser('anonymous');
          }
        });
      } else {
        restoreDraftForUser('anonymous');
      }
    } else if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
    }
  }, [isOpen, supabaseActive]);

  // Auto-save do rascunho temporário
  useEffect(() => {
    if (!isOpen) return;
    const hasContent =
      tradeName.trim() ||
      legalName.trim() ||
      cnpjOrCpf.trim() ||
      adminName.trim() ||
      phone.trim() ||
      street.trim();
    if (!hasContent) return;

    const timer = setTimeout(() => {
      const userId = currentSessionUser?.id || 'anonymous';
      const result = formDraftStore.saveDraft<RegisterAcademyDraft>(
        { tenantId: 'public', userId, formKey: DRAFT_FORM_KEY },
        {
          tradeName,
          legalName,
          cnpjOrCpf,
          adminName,
          email,
          phone,
          whatsapp,
          logoUrl: logoUrl.length < 150000 ? logoUrl : '',
          street,
          number,
          neighborhood,
          city,
          state,
          zipCode,
          acceptedLegal,
        }
      );
      if (result.saved) {
        setDraftSavedAt(result.savedAt);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [
    isOpen,
    currentSessionUser,
    tradeName,
    legalName,
    cnpjOrCpf,
    adminName,
    email,
    phone,
    whatsapp,
    logoUrl,
    street,
    number,
    neighborhood,
    city,
    state,
    zipCode,
    acceptedLegal,
  ]);

  const handleClearDraftAndCancel = () => {
    const userId = currentSessionUser?.id || 'anonymous';
    formDraftStore.clearDraft({ tenantId: 'public', userId, formKey: DRAFT_FORM_KEY });
    setTradeName('');
    setLegalName('');
    setCnpjOrCpf('');
    setAdminName('');
    setPhone('');
    setWhatsapp('');
    setLogoUrl('');
    setStreet('');
    setNumber('');
    setNeighborhood('');
    setAcceptedLegal(false);
    setRestoredFromDraft(false);
    setDraftSavedAt(null);
    onClose();
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDetailedError(null);
    setSuccessMessage(null);

    if (!tradeName.trim()) {
      setError('O Nome Fantasia da academia é obrigatório.');
      return;
    }
    if (!cnpjOrCpf.trim()) {
      setError('O CPF ou CNPJ é obrigatório.');
      return;
    }
    if (!adminName.trim()) {
      setError('O Nome do Responsável / Sensei é obrigatório.');
      return;
    }
    if (!acceptedLegal) {
      setError('Você precisa ler e concordar com os Termos de Uso e a Política de Privacidade (LGPD) para criar a conta da academia.');
      return;
    }

    const userIdForDraft = currentSessionUser?.id || 'anonymous';

    if (supabaseActive && supabase) {
      setLoading(true);

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          throw sessionError;
        }

        const session = sessionData.session;
        if (!session?.user) {
          setError(
            'Acesso restrito: faça login na plataforma antes de registrar uma nova academia.'
          );
          setDetailedError({
            message: 'Nenhuma sessão de usuário ativa encontrada.',
            code: 'AUTH_REQUIRED',
            hint: 'Acesse sua conta para continuar o cadastro.',
          });
          setLoading(false);
          return;
        }

        const addressJson = {
          street: street.trim() || 'Rua Principal',
          number: number.trim() || 'S/N',
          neighborhood: neighborhood.trim() || 'Centro',
          city: city.trim() || 'São Paulo',
          state: state.trim() || 'SP',
          zipCode: zipCode.trim() || '01000-000',
        };

        const { data, error: rpcError } = await supabase.rpc('register_academy_atomic', {
          p_trade_name: tradeName.trim(),
          p_legal_name: legalName.trim() || tradeName.trim(),
          p_cnpj_or_cpf: cnpjOrCpf.trim(),
          p_admin_name: adminName.trim(),
          p_phone: phone.trim() || '',
          p_whatsapp: whatsapp.trim() || phone.trim() || '',
          p_address: addressJson,
        });

        if (rpcError) {
          console.error('Erro ao cadastrar academia:', rpcError);
          setDetailedError({
            message: rpcError.message || 'Falha ao cadastrar academia.',
            code: rpcError.code,
            details: rpcError.details,
            hint: rpcError.hint,
          });
          setError(rpcError.message || 'Não foi possível cadastrar a academia. Tente novamente.');
          setLoading(false);
          return;
        }

        if (!data || data.success !== true) {
          console.error('Retorno inesperado:', data);
          setDetailedError({
            message: 'A operação não pôde ser confirmada pelo servidor.',
            details: typeof data === 'object' ? JSON.stringify(data) : String(data),
          });
          setError('Não foi possível confirmar o cadastro da academia. Tente novamente.');
          setLoading(false);
          return;
        }

        // Registra o aceite contratual dos Termos de Uso e Política de Privacidade
        await authService.recordLegalAcceptance({
          userId: session.user.id,
          tenantId: data.tenant_id,
          context: 'academy_registration',
        });

        const memberships = await authService.loadUserMemberships(session.user.id);

        if (logoUrl && data?.tenant_id) {
          try {
            await supabase.from('tenants').update({ logo_url: logoUrl }).eq('id', data.tenant_id);
            if (memberships.length > 0 && memberships[0].tenant) {
              memberships[0].tenant.logo_url = logoUrl;
            }
          } catch (logoErr) {
            console.warn('Não foi possível persistir logo_url imediatamente:', logoErr);
          }
        }

        // Limpa o rascunho após sucesso confirmado
        formDraftStore.clearDraft({ tenantId: 'public', userId: session.user.id, formKey: DRAFT_FORM_KEY });
        formDraftStore.clearDraft({ tenantId: 'public', userId: 'anonymous', formKey: DRAFT_FORM_KEY });

        setSuccessMessage('Academia e filial matriz cadastradas com sucesso!');
        setLoading(false);

        setTimeout(() => {
          if (onRegisterAtomicSuccess) {
            onRegisterAtomicSuccess(data, memberships);
          } else {
            onClose();
          }
        }, 600);
      } catch (err: any) {
        console.error('Exceção capturada no cadastro de academia:', err);
        setDetailedError({
          message: err.message || 'Erro inesperado ao registrar academia.',
          code: err.code || 'UNKNOWN_ERROR',
          details: err.details || null,
          hint: err.hint || null,
        });
        setError(err.message || 'Não foi possível concluir o cadastro. Verifique sua conexão e tente novamente.');
        setLoading(false);
      }
      return;
    }

    const { tenant: newTenant, branch: newBranch, ownerUser: newUser } =
      await import('../../services/saasPlatformService').then((m) =>
        m.saasPlatformService.registerAcademyIsolated({
          tradeName: tradeName.trim(),
          legalName: (legalName || tradeName).trim(),
          cnpjOrCpf: cnpjOrCpf.trim(),
          adminName: adminName.trim(),
          email: (email || 'contato@dojo.com.br').trim().toLowerCase(),
          phone: phone || '(11) 98888-0000',
          whatsapp: whatsapp || phone || '(11) 98888-0000',
          logoUrl: logoUrl || undefined,
          address: {
            street: street || 'Rua Principal',
            number: number || '100',
            neighborhood: neighborhood || 'Centro',
            city: city || 'São Paulo',
            state: state || 'SP',
            zipCode: zipCode || '01000-000',
          },
        })
      );

    await authService.recordLegalAcceptance({
      userId: newUser.id,
      tenantId: newTenant.id,
      context: 'academy_registration',
    });

    formDraftStore.clearDraft({ tenantId: 'public', userId: userIdForDraft, formKey: DRAFT_FORM_KEY });
    onSuccess(newTenant, newBranch, newUser);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200 my-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center justify-between gap-2 mb-2 pr-8">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600/20 text-red-500">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Cadastre sua Academia</h3>
              <p className="text-xs text-slate-400">Ativação imediata do Plano Teste Gratuito de 10 dias.</p>
            </div>
          </div>

          {draftSavedAt && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 bg-emerald-950/50 border border-emerald-500/30 px-2 py-1 rounded">
              <Save className="h-3 w-3" />
              <span>{restoredFromDraft ? 'Rascunho restaurado' : 'Rascunho salvo'}</span>
            </div>
          )}
        </div>

        {/* Indicador de autenticação de dados */}
        {supabaseActive && currentSessionUser && (
          <div className="my-3 p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-300">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                Conectado como: <strong>{currentSessionUser.email}</strong>
              </span>
            </div>
            <span className="text-[10px] bg-emerald-900/60 px-2 py-0.5 rounded text-emerald-200 font-mono">
              auth.uid() ativo
            </span>
          </div>
        )}

        {/* Alerta caso o usuário não esteja logado */}
        {supabaseActive && !currentSessionUser && (
          <div className="my-3 p-3 rounded-lg bg-amber-950/50 border border-amber-600/40 text-xs text-amber-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>Você precisa estar autenticado para criar sua academia.</span>
            </div>
            {onOpenLogin && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenLogin();
                }}
                className="ml-2 px-2.5 py-1 rounded bg-amber-600 text-white font-semibold hover:bg-amber-500 transition-colors cursor-pointer text-[11px]"
              >
                Fazer Login
              </button>
            )}
          </div>
        )}

        <div className="my-3 p-3 rounded-lg bg-amber-950/40 border border-amber-600/30 flex items-center gap-2 text-xs text-amber-300">
          <Clock className="h-4 w-4 shrink-0 text-amber-400" />
          <span>Acesso completo ao plano Avançado por 10 dias corridos sem cobrança.</span>
        </div>

        {/* Erro simples */}
        {error && !detailedError && (
          <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-500/50 text-xs text-red-200 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Erro detalhado do Supabase */}
        {detailedError && (
          <div className="mb-4 p-3 rounded-lg bg-red-950/70 border border-red-500/70 text-xs text-red-200 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              <span>Não foi possível concluir o cadastro da academia:</span>
            </div>
            {detailedError.message && (
              <div>
                <span className="font-semibold text-slate-300">Mensagem: </span>
                <span className="text-white">{detailedError.message}</span>
              </div>
            )}
            {detailedError.code && (
              <div>
                <span className="font-semibold text-slate-300">Código de referência: </span>
                <code className="bg-slate-900 px-1.5 py-0.5 rounded text-amber-300 font-mono text-[11px]">
                  {detailedError.code}
                </code>
              </div>
            )}
            {detailedError.details && (
              <div>
                <span className="font-semibold text-slate-300">Informação complementar: </span>
                <span className="text-slate-300">{detailedError.details}</span>
              </div>
            )}
            {detailedError.hint && (
              <div>
                <span className="font-semibold text-slate-300">Orientação: </span>
                <span className="text-emerald-300">{detailedError.hint}</span>
              </div>
            )}
          </div>
        )}

        {/* Mensagem de sucesso */}
        {successMessage && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-950/60 border border-emerald-500/60 text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Nome Fantasia da Academia <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                required
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                placeholder="Ex: Associação de Judô Bushido"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Logomarca da Academia */}
          <div className="p-3 rounded-xl border border-slate-700/80 bg-slate-900/60 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-slate-200 font-semibold text-xs flex items-center gap-1.5">
                <Image className="h-4 w-4 text-red-400" />
                <span>Logomarca da Academia (Opcional)</span>
              </label>
              <span className="text-[10px] text-slate-400">Exibida no cabeçalho dos relatórios</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-14 w-14 rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/80 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                {logoUrl ? (
                  <img src={logoUrl} alt="Prévia da Logomarca" className="h-full w-full object-contain p-1" />
                ) : (
                  <Building2 className="h-6 w-6 text-slate-600" />
                )}
              </div>

              <div className="flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-medium text-slate-200 hover:text-white transition-colors shadow-sm">
                    <Upload className="h-3.5 w-3.5 text-red-400" />
                    <span>Selecionar Imagem</span>
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
                  placeholder="Ou informe a URL da logomarca (https://...)"
                  className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Razão Social (Opcional)</label>
              <input
                type="text"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Bushido Artes Marciais Ltda"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                CNPJ ou CPF <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={cnpjOrCpf}
                onChange={(e) => setCnpjOrCpf(e.target.value)}
                placeholder="00.000.000/0001-00"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Nome do Responsável / Sensei <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  required
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="Sensei Carlos Eduardo"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                E-mail Administrativo <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="contato@bushidojudo.com.br"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Telefone Principal</label>
              <div className="relative">
                <Phone className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(11) 98765-4321"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">WhatsApp de Atendimento</label>
              <div className="relative">
                <Phone className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="(11) 98765-4321"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Endereço compatível com objeto jsonb */}
          <div className="pt-1">
            <label className="block text-slate-400 font-medium mb-1.5 text-[11px]">
              Endereço da Unidade Matriz
            </label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="col-span-2">
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="Logradouro (ex: Rua das Flores)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none text-xs"
                />
              </div>
              <div>
                <input
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="Número"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  placeholder="Bairro"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none text-xs"
                />
              </div>
              <div>
                <div className="relative">
                  <MapPin className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Cidade"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-8 pr-2 py-1.5 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none text-xs"
                  />
                </div>
              </div>
              <div>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-white focus:border-red-500 focus:outline-none text-xs"
                >
                  <option value="SP">SP</option>
                  <option value="RJ">RJ</option>
                  <option value="MG">MG</option>
                  <option value="PR">PR</option>
                  <option value="RS">RS</option>
                  <option value="BA">BA</option>
                  <option value="DF">DF</option>
                  <option value="SC">SC</option>
                  <option value="GO">GO</option>
                  <option value="PE">PE</option>
                  <option value="CE">CE</option>
                </select>
              </div>
            </div>
          </div>

          {/* Aceite contratual dos Termos de Uso e Política de Privacidade */}
          <div className="p-3 rounded-xl border border-slate-700/80 bg-slate-950/60 space-y-2">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedLegal}
                onChange={(e) => setAcceptedLegal(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-red-600 focus:ring-red-500"
              />
              <span className="text-[11px] text-slate-300 leading-relaxed">
                Declaro que li e concordo com os{' '}
                <button
                  type="button"
                  onClick={onOpenTerms}
                  className="text-red-400 hover:text-red-300 font-semibold underline underline-offset-2"
                >
                  Termos de Uso
                </button>{' '}
                e com a{' '}
                <button
                  type="button"
                  onClick={onOpenPrivacy}
                  className="text-red-400 hover:text-red-300 font-semibold underline underline-offset-2"
                >
                  Política de Privacidade (LGPD)
                </button>{' '}
                do Tatame Club (Beaver Soluções em Tecnologia — CNPJ 28.410.730/0001-80).
              </span>
            </label>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-red-600 py-3 text-sm font-semibold text-white hover:bg-red-500 active:bg-red-700 transition-colors shadow-lg shadow-red-900/30 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <span>Registrando academia...</span>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4" />
                  <span>Ativar Avaliação de 10 Dias</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
              <span>Criação atômica da academia, filial matriz e perfil gestor.</span>
              {draftSavedAt && (
                <button
                  type="button"
                  onClick={handleClearDraftAndCancel}
                  className="inline-flex items-center gap-1 text-slate-400 hover:text-red-400 transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Descartar rascunho</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
