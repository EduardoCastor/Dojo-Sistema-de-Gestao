import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  UserCheck,
  Phone,
  Mail,
  MapPin,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Check,
  User,
  Save,
} from 'lucide-react';
import { Person } from '../../types';
import { studentService } from '../../services/studentService';
import { cleanCPF, formatCPF, validateCPF, formatPhoneBR } from '../../utils/cpfValidator';
import { formDraftStore } from '../../utils/formDraftStore';

interface GuardianFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  guardianToEdit?: Person | null;
  onSuccess: (savedPerson: Person) => void;
}

export const GuardianFormModal: React.FC<GuardianFormModalProps> = ({
  isOpen,
  onClose,
  tenantId,
  guardianToEdit,
  onSuccess,
}) => {
  const isEditing = Boolean(guardianToEdit);
  const draftFormKey = guardianToEdit?.id ? `guardian_form:${guardianToEdit.id}` : 'guardian_form:new';
  const initializedKeyRef = useRef<string | null>(null);

  // Campos do Formulário
  const [fullName, setFullName] = useState('');
  const [socialName, setSocialName] = useState('');
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('1985-05-20');
  const [gender, setGender] = useState<'male' | 'female' | 'other'>('other');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // Endereço
  const [zipCode, setZipCode] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('São Paulo');
  const [state, setState] = useState('SP');

  // Estados de Validação e Submissão
  const [cpfStatus, setCpfStatus] = useState<{
    isValid: boolean;
    error?: string;
    isDuplicate?: boolean;
    duplicateMsg?: string;
  } | null>(null);
  const [isCheckingCpf, setIsCheckingCpf] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      initializedKeyRef.current = null;
      return;
    }

    const sessionKey = `${tenantId}:${guardianToEdit?.id || 'new'}`;
    if (initializedKeyRef.current === sessionKey) {
      return;
    }
    initializedKeyRef.current = sessionKey;

    setError('');
    setSuccessMsg('');
    setIsSubmitting(false);

    const savedDraft = formDraftStore.loadDraft<Record<string, any>>({
      tenantId,
      userId: 'admin',
      formKey: draftFormKey,
    });

    if (savedDraft && savedDraft.data) {
      const d = savedDraft.data;
      setFullName(d.fullName || '');
      setSocialName(d.socialName || '');
      setCpf(d.cpf || '');
      setBirthDate(d.birthDate || '1985-05-20');
      setGender(d.gender || 'other');
      setPhone(d.phone || '');
      setEmail(d.email || '');
      setZipCode(d.zipCode || '');
      setStreet(d.street || '');
      setNumber(d.number || '');
      setComplement(d.complement || '');
      setNeighborhood(d.neighborhood || '');
      setCity(d.city || 'São Paulo');
      setState(d.state || 'SP');
      setDraftSavedAt(savedDraft.savedAt);
      return;
    }

    if (guardianToEdit) {
      setFullName(guardianToEdit.fullName || '');
      setSocialName(guardianToEdit.socialName || '');
      const rawCpf = guardianToEdit.cpf || '';
      setCpf(rawCpf ? formatCPF(rawCpf) : '');
      setBirthDate(guardianToEdit.birthDate || '1985-05-20');
      setGender(guardianToEdit.gender || 'other');
      setPhone(guardianToEdit.phone ? formatPhoneBR(guardianToEdit.phone) : '');
      setEmail(guardianToEdit.email || '');

      const addr = guardianToEdit.address || {};
      setZipCode(addr.zipCode || '');
      setStreet(addr.street || '');
      setNumber(addr.number || '');
      setComplement((addr as any).complement || '');
      setNeighborhood(addr.neighborhood || '');
      setCity(addr.city || 'São Paulo');
      setState(addr.state || 'SP');
      setCpfStatus(rawCpf ? { isValid: true } : null);
    } else {
      setFullName('');
      setSocialName('');
      setCpf('');
      setBirthDate('1985-05-20');
      setGender('other');
      setPhone('');
      setEmail('');
      setZipCode('');
      setStreet('');
      setNumber('');
      setComplement('');
      setNeighborhood('');
      setCity('São Paulo');
      setState('SP');
      setCpfStatus(null);
    }
  }, [isOpen, guardianToEdit, tenantId, draftFormKey]);

  useEffect(() => {
    if (!isOpen) return;
    if (!fullName && !cpf && !phone && !email) return;

    const timer = setTimeout(() => {
      const res = formDraftStore.saveDraft({
        tenantId,
        userId: 'admin',
        formKey: draftFormKey,
        data: {
          fullName,
          socialName,
          cpf,
          birthDate,
          gender,
          phone,
          email,
          zipCode,
          street,
          number,
          complement,
          neighborhood,
          city,
          state,
        },
      });
      if (res.saved) {
        setDraftSavedAt(res.savedAt);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [
    isOpen,
    tenantId,
    draftFormKey,
    fullName,
    socialName,
    cpf,
    birthDate,
    gender,
    phone,
    email,
    zipCode,
    street,
    number,
    complement,
    neighborhood,
    city,
    state,
  ]);

  if (!isOpen) return null;

  // Validação em tempo real do CPF
  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const clean = cleanCPF(raw);
    const masked = formatCPF(clean);
    setCpf(masked);

    if (!clean) {
      setCpfStatus(null);
      return;
    }

    if (clean.length < 11) {
      setCpfStatus({
        isValid: false,
        error: `Digite os 11 dígitos (${clean.length}/11)`,
      });
      return;
    }

    // 1. Validação matemática
    const val = validateCPF(clean);
    if (!val.isValid) {
      setCpfStatus({ isValid: false, error: val.error });
      return;
    }

    // 2. Validação de duplicidade na academia ativa
    setIsCheckingCpf(true);
    studentService
      .checkCpfDuplicity(tenantId, clean, guardianToEdit?.id)
      .then((dupl) => {
        setIsCheckingCpf(false);
        if (dupl.isDuplicate) {
          setCpfStatus({
            isValid: false,
            isDuplicate: true,
            error: dupl.message || 'Este CPF já está cadastrado nesta academia.',
          });
        } else {
          setCpfStatus({ isValid: true });
        }
      })
      .catch(() => {
        setIsCheckingCpf(false);
        setCpfStatus({ isValid: true });
      });
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    setPhone(formatPhoneBR(raw));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!fullName.trim()) {
      setError('O nome completo do responsável é obrigatório.');
      return;
    }

    const cleanCpfValue = cleanCPF(cpf);
    if (cleanCpfValue) {
      const val = validateCPF(cleanCpfValue);
      if (!val.isValid) {
        setError(`CPF inválido: ${val.error}`);
        return;
      }
      if (cpfStatus && !cpfStatus.isValid) {
        setError(cpfStatus.error || 'Por favor, corrija o CPF antes de continuar.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const addressPayload = {
        street: street.trim(),
        number: number.trim(),
        complement: complement.trim(),
        neighborhood: neighborhood.trim(),
        city: city.trim() || 'São Paulo',
        state: state.trim() || 'SP',
        zipCode: zipCode.trim(),
      };

      let resultPerson: Person;

      if (isEditing && guardianToEdit) {
        // Atualização idempotente pelo ID real da pessoa
        resultPerson = await studentService.updatePerson(tenantId, guardianToEdit.id, {
          fullName: fullName.trim(),
          cpf: cleanCpfValue || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          address: addressPayload,
        });
      } else {
        // Cadastro novo e independente de responsável
        resultPerson = await studentService.createGuardian(tenantId, {
          fullName: fullName.trim(),
          socialName: socialName.trim() || undefined,
          cpf: cleanCpfValue || undefined,
          birthDate,
          gender,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          address: addressPayload,
        });
      }

      formDraftStore.clearDraft({ tenantId, userId: 'admin', formKey: draftFormKey });

      setSuccessMsg(
        isEditing
          ? 'Dados do responsável atualizados com sucesso!'
          : 'Responsável cadastrado com sucesso!'
      );

      setTimeout(() => {
        onSuccess(resultPerson);
        onClose();
      }, 700);
    } catch (err: any) {
      setError(err?.message || 'Falha ao salvar dados do responsável.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl text-slate-100 max-h-[92vh] overflow-y-auto">
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-800 pr-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600/20 text-red-400 border border-red-500/30">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {isEditing ? 'Editar Dados do Responsável' : 'Cadastrar Novo Responsável'}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {isEditing
                  ? 'Atualize os dados cadastrais e de contato desta pessoa na academia.'
                  : 'Cadastre a pessoa física do responsável para posterior vínculo com alunos.'}
              </p>
            </div>
          </div>

          {draftSavedAt && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-1 rounded-lg shrink-0">
              <Save className="h-3 w-3" />
              <span>Rascunho salvo</span>
            </div>
          )}
        </div>

        {/* Feedback Messages */}
        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-950/60 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          {/* GRUPO 1: IDENTIFICAÇÃO */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
            <div className="font-semibold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-1.5">
              <User className="h-4 w-4 text-red-400" />
              <span>1. Identificação do Responsável</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-slate-300 font-medium mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ex: Carlos Eduardo de Oliveira"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  CPF (com ou sem máscara)
                  {isCheckingCpf && <Loader2 className="inline ml-1 h-3 w-3 animate-spin text-red-400" />}
                </label>
                <input
                  type="text"
                  value={cpf}
                  onChange={handleCpfChange}
                  placeholder="000.000.000-00"
                  maxLength={14}
                  className={`w-full rounded-lg border bg-slate-800 px-3 py-2 text-white placeholder-slate-500 font-mono focus:outline-none ${
                    cpfStatus === null
                      ? 'border-slate-700 focus:border-red-500'
                      : cpfStatus.isValid
                      ? 'border-emerald-500/60'
                      : 'border-red-500/60'
                  }`}
                />
                {cpfStatus && (
                  <div className="mt-1">
                    {cpfStatus.isValid ? (
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-sans">
                        <CheckCircle2 className="h-3 w-3" />
                        CPF matematicamente válido e liberado
                      </span>
                    ) : (
                      <span className="text-[10px] text-red-400 flex items-center gap-1 font-sans">
                        <AlertTriangle className="h-3 w-3" />
                        {cpfStatus.error}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  <span>Data de Nascimento</span>
                </label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Gênero</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                >
                  <option value="male">Masculino</option>
                  <option value="female">Feminino</option>
                  <option value="other">Outro / Prefere não declarar</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Nome Social (Opcional)</label>
                <input
                  type="text"
                  value={socialName}
                  onChange={(e) => setSocialName(e.target.value)}
                  placeholder="Se aplicável"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* GRUPO 2: CONTATO */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
            <div className="font-semibold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Phone className="h-4 w-4 text-red-400" />
              <span>2. Informações de Contato</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Telefone / WhatsApp</label>
                <input
                  type="text"
                  value={phone}
                  onChange={handlePhoneChange}
                  placeholder="(11) 98765-4321"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1 flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  <span>E-mail</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="responsavel@tatameclub.com.br"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* GRUPO 3: ENDEREÇO */}
          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
            <div className="font-semibold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-red-400" />
              <span>3. Endereço Residencial</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">CEP</label>
                <input
                  type="text"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  placeholder="01000-000"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none font-mono"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-slate-300 font-medium mb-1">Rua / Logradouro</label>
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="Ex: Rua das Palmeiras"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Número</label>
                <input
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="123"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Complemento</label>
                <input
                  type="text"
                  value={complement}
                  onChange={(e) => setComplement(e.target.value)}
                  placeholder="Apto 42"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Bairro</label>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  placeholder="Centro"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-slate-300 font-medium mb-1">Cidade</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Estado / UF</label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  maxLength={2}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:border-red-500 focus:outline-none uppercase font-mono"
                />
              </div>
            </div>
          </div>

          {/* Botões de Ação */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (cpfStatus !== null && !cpfStatus.isValid)}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-500 transition-colors shadow cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Salvando informações...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>{isEditing ? 'Salvar Alterações' : 'Cadastrar Responsável'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
