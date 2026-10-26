import React, { useState, useMemo } from 'react';
import { Building2, Plus, MapPin, Phone, Mail, User, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Branch, Tenant, SaaSPlan } from '../../types';
import { saasPlatformService } from '../../services/saasPlatformService';

interface BranchesViewProps {
  branches: Branch[];
  tenant: Tenant;
  plans: SaaSPlan[];
  onAddBranch: (branch: Branch) => void;
  onUpgradePlan: () => void;
}

export const BranchesView: React.FC<BranchesViewProps> = ({
  branches,
  tenant,
  plans,
  onAddBranch,
  onUpgradePlan,
}) => {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [managerName, setManagerName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentPlan = plans.find((p) => p.id === tenant.planId) || plans[0];
  const limits = useMemo(() => saasPlatformService.getEffectiveLimits(tenant.id), [tenant.id, branches]);
  const maxBranchesAllowed = limits.maxBranches;
  const canAddBranch = branches.length < maxBranchesAllowed;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!name.trim()) return;

    try {
      const ownerActor = {
        id: 'actor-owner',
        tenantId: tenant.id,
        name: tenant.adminName || 'Proprietário',
        email: tenant.email,
        role: 'owner' as const,
        phone: tenant.phone || '',
        active: true,
      };
      const createdBranch = await saasPlatformService.createBranchWithLimitCheck(
        {
          tenantId: tenant.id,
          name: name.trim(),
          phone: phone || '(11) 3456-0000',
          email: email || `filial@${tenant.id}.com.br`,
          address: address || 'Endereço da Unidade',
          managerName: managerName || 'Gestor Responsável',
        },
        ownerActor
      );

      onAddBranch(createdBranch);
      setIsAddOpen(false);
      setName('');
      setAddress('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Limite de unidades atingido.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Filiais & Unidades da Academia</h2>
          <p className="text-xs text-slate-400">
            Gerencie a Unidade Matriz (1ª unidade) e filiais vinculadas à assinatura do plano {currentPlan.name}.
          </p>
        </div>

        {canAddBranch ? (
          <button
            onClick={() => {
              setErrorMsg(null);
              setIsAddOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition-colors shadow cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Cadastrar Nova Filial</span>
          </button>
        ) : (
          <button
            onClick={onUpgradePlan}
            className="flex items-center gap-2 rounded-lg border border-amber-600 bg-amber-950/60 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-900/60 transition-colors cursor-pointer"
          >
            <span>Limite de Unidades Atingido ({branches.length}/{maxBranchesAllowed}) · Fazer Upgrade</span>
          </button>
        )}
      </div>

      {/* Plan limits badge */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-300">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>
            Utilizando <strong>{branches.length}</strong> de <strong>{maxBranchesAllowed}</strong> unidade(s) contratada(s){' '}
            <span className="text-slate-400">(Unidade Matriz contabilizada como 1ª unidade)</span>
          </span>
          {limits.hasCustomLimits && (
            <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-semibold">
              Limite Personalizado
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-400">Isolamento de turmas, tatamis e equipe por unidade</span>
      </div>

      {!canAddBranch && (
        <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 flex items-center justify-between gap-3 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>
              Sua licença permite até <strong>{maxBranchesAllowed} unidade(s)</strong> (incluindo a Matriz). Para abrir
              novas filiais, solicite ampliação da licença ou faça upgrade de plano.
            </span>
          </div>
        </div>
      )}

      {/* Branches Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {branches.map((b) => (
          <div
            key={b.id}
            className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-red-500 border border-slate-700">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{b.name}</h3>
                    <div className="text-[11px] text-slate-400">
                      {b.isHeadquarter || b.isHeadquarters ? 'Unidade Matriz (1ª Unidade)' : 'Filial Regional'}
                    </div>
                  </div>
                </div>

                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                  {b.active !== false ? 'Operação Ativa' : 'Inativa'}
                </span>
              </div>

              <div className="space-y-2 text-xs text-slate-400 mt-4">
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  <span>{b.address}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  <span>{b.phone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  <span>{b.email}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-300 pt-1">
                  <User className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  <span>Gestor(a): {b.managerName}</span>
                </div>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
              <span>ID: {b.id}</span>
              <span className="text-emerald-400 font-medium">Turmas e alunos associados</span>
            </div>
          </div>
        ))}
      </div>

      {/* Add Branch Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-200">
            <h3 className="text-base font-bold text-white mb-3">Cadastrar Nova Unidade / Filial</h3>

            {errorMsg && (
              <div className="mb-3 p-3 rounded-lg bg-red-950/60 border border-red-500/40 text-xs text-red-300">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Nome da Filial *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Filial Alphaville"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Endereço Completo</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Av. das Nações, 500"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Telefone</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(11) 3456-9900"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">E-mail</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="filial@academia.com.br"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Nome do Gestor da Unidade</label>
                <input
                  type="text"
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                  placeholder="Sensei ou Administrador local"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-red-600 font-semibold text-white hover:bg-red-500"
                >
                  Salvar Filial
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
