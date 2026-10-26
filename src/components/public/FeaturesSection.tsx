import React from 'react';
import {
  Award,
  Calendar,
  Users,
  ShieldCheck,
  Video,
  FileCheck2,
  Trophy,
  Building2,
  Lock,
} from 'lucide-react';

export const FeaturesSection: React.FC = () => {
  const features = [
    {
      icon: Award,
      title: 'Sistema de Graduações & Faixas',
      description: 'Parametrize sequências de faixas, graus (dans) e pontas por arte marcial (Judô CBJ, BJJ CBJJ, Karatê CBK). Controle carência de meses, idade mínima e requisitos técnicos.',
      badge: 'Judô & BJJ',
    },
    {
      icon: Calendar,
      title: 'Validador Anti-Conflito de Turmas',
      description: 'O motor de agenda impede que um aluno seja matriculado em aulas simultâneas e previne sobrelotação do tatami respeitando a capacidade máxima configurada.',
      badge: 'Motor de Agenda',
    },
    {
      icon: Users,
      title: 'Ficha do Aluno com Distinção de Vínculos',
      description: 'Separe responsabilidade legal, responsabilidade financeira, contatos de emergência e autorização para retirada de menores. Um mesmo pai pode pagar por vários irmãos.',
      badge: 'LGPD & Menores',
    },
    {
      icon: ShieldCheck,
      title: 'Prontuário de Saúde & Atestados',
      description: 'Área restrita e auditada para atestados médicos, laudos, alergias, restrições ortopédicas e contatos de emergência. Dados sensíveis protegidos por controle estrito de papéis.',
      badge: 'Sigilo Médico',
    },
    {
      icon: FileCheck2,
      title: 'Exames de Faixa com Elegibilidade',
      description: 'O sistema calcula automaticamente quem cumpre a carência de tempo, a idade mínima e a frequência mínima (ex: 75%). Bancas avaliadoras, notas e emissão de certificados.',
      badge: 'Exames Oficiais',
    },
    {
      icon: Video,
      title: 'Biblioteca Digital de Artes Marciais',
      description: 'Disponibilize videoaulas de kata, demonstrações de técnicas (waza) e apostilas em PDF com controle de acesso por faixa do aluno ou turmas específicas.',
      badge: 'Didática & Vídeos',
    },
    {
      icon: Trophy,
      title: 'Gestão Básica de Competições',
      description: 'Inscreva atletas, valide categorias de idade e peso, monitore autorizações parentais e mantenha o quadro histórico de medalhas de ouro, prata e bronze.',
      badge: 'Alto Rendimento',
    },
    {
      icon: Building2,
      title: 'Multi-Filiais com Visão Consolidada',
      description: 'Gerencie matriz e filiais na mesma conta no plano Avançado, permitindo controle individual por gestor de unidade ou visão financeira unificada do proprietário.',
      badge: 'Multi-Unidades',
    },
    {
      icon: Lock,
      title: 'Isolamento Rigoroso Multi-Tenant',
      description: 'Cada academia opera em seu próprio espaço de dados estanque. Nenhuma academia pode consultar dados, alunos ou indicadores de outra.',
      badge: 'Segurança SaaS',
    },
  ];

  return (
    <section id="funcionalidades" className="py-20 border-b border-slate-800 bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mb-14">
          <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2">Funcionalidades Essenciais</div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight" style={{ textWrap: 'balance' }}>
            Construído para a rotina real de um dojo de artes marciais
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-400 leading-relaxed">
            Nada de sistemas genéricos de musculação adaptados à força. O Tatame Club entende de kumi-kata, faixas, graus, federações e a dinâmica pedagógica dos esportes de combate.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={i}
                className="group relative rounded-xl border border-slate-800/80 bg-slate-900/60 p-6 hover:border-slate-700 hover:bg-slate-900/90 transition-all duration-200"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 border border-slate-700 text-red-500 group-hover:bg-red-600/10 transition-colors">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-[11px] font-medium text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/50">
                    {f.badge}
                  </span>
                </div>

                <h3 className="text-base font-bold text-white mb-2 group-hover:text-red-400 transition-colors">
                  {f.title}
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {f.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
