import React, { useState } from 'react';
import { X, ShieldCheck, FileText, AlertTriangle, CheckCircle2, Scale, Lock } from 'lucide-react';

export const LEGAL_DOCUMENT_VERSIONS = {
  termsVersion: '1.0.0-2026',
  privacyVersion: '1.0.0-2026',
  terms_of_use: '1.0.0-2026',
  privacy_policy: '1.0.0-2026',
  effectiveDate: '27/10/2026',
  developerCompany: 'Beaver Soluções em Tecnologia',
  developerCnpj: '28.410.730/0001-80',
};

interface LegalDocumentsModalProps {
  isOpen: boolean;
  initialTab?: 'terms' | 'privacy';
  onClose: () => void;
  onAcceptBoth?: () => void;
}

export const LegalDocumentsModal: React.FC<LegalDocumentsModalProps> = ({
  isOpen,
  initialTab = 'terms',
  onClose,
  onAcceptBoth,
}) => {
  const [activeTab, setActiveTab] = useState<'terms' | 'privacy'>(initialTab);

  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const currentYear = new Date().getFullYear();

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-zinc-950/85 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-600/15 border border-red-500/30 flex items-center justify-center text-red-500">
              {activeTab === 'terms' ? <Scale className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white uppercase tracking-wider">
                {activeTab === 'terms'
                  ? 'Termos e Condições Gerais de Uso — Tatame Club'
                  : 'Política de Privacidade e Proteção de Dados (LGPD)'}
              </h2>
              <p className="text-xs text-zinc-400">
                Beaver Soluções em Tecnologia — CNPJ 28.410.730/0001-80 • Versão{' '}
                {activeTab === 'terms'
                  ? LEGAL_DOCUMENT_VERSIONS.terms_of_use
                  : LEGAL_DOCUMENT_VERSIONS.privacy_policy}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 bg-zinc-950/30 px-6 pt-3 gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('terms')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
              activeTab === 'terms'
                ? 'border-red-600 text-red-500 bg-red-600/5'
                : 'border-transparent text-zinc-400 hover:text-white'
            }`}
          >
            <FileText className="w-4 h-4" />
            Termos de Uso
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('privacy')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
              activeTab === 'privacy'
                ? 'border-red-600 text-red-500 bg-red-600/5'
                : 'border-transparent text-zinc-400 hover:text-white'
            }`}
          >
            <Lock className="w-4 h-4" />
            Política de Privacidade (LGPD)
          </button>
        </div>

        {/* Legal Notice Banner */}
        <div className="px-6 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-300">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Nota Técnica e Jurídica:</span> Este documento foi elaborado em conformidade com o Marco Civil da Internet (Lei nº 12.965/2014), Código Civil e Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 — LGPD). Recomenda-se revisão jurídica final antes da publicação definitiva em produção, especialmente nos campos destacados com{' '}
            <code className="px-1 py-0.5 rounded bg-amber-500/20 text-amber-200 font-mono">
              [VALIDAR ANTES DA PUBLICAÇÃO]
            </code>{' '}
            (e-mail oficial do Encarregado/DPO, endereço da sede e foro de eleição).
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 text-sm text-zinc-300 leading-relaxed">
          {activeTab === 'terms' ? (
            <div className="space-y-5">
              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  1. Identificação da Plataforma e da Empresa Responsável
                </h3>
                <p>
                  A plataforma <strong>Tatame Club</strong> é um sistema de software como serviço (<em>Software as a Service — SaaS</em>) voltado à gestão operacional, técnica, pedagógica e financeira de academias, dojos, clubes e centros de treinamento de artes marciais, desenvolvido e mantido por <strong>Beaver Soluções em Tecnologia</strong>, inscrita no CNPJ sob o nº <strong>28.410.730/0001-80</strong>.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  2. Objeto da Plataforma
                </h3>
                <p>
                  Estes Termos de Uso regulam o acesso e a utilização da plataforma Tatame Club por todas as categorias de usuários, compreendendo módulos de administração de academias (multi-tenant), controle de matrículas, turmas, ocupação de tatames, chamadas e presença, histórico de graduações e faixas, acompanhamento antropométrico, gestão de documentos médicos, controle financeiro informativo e biblioteca digital de vídeos técnicos.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  3. Perfis de Usuário e Escopo de Acesso
                </h3>
                <ul className="list-disc pl-5 space-y-1 text-zinc-300">
                  <li>
                    <strong>Administrador da Plataforma (SuperAdmin):</strong> representante autorizado da Beaver Soluções em Tecnologia responsável pela governança técnica do SaaS, gestão de planos de assinatura das academias e suporte operacional.
                  </li>
                  <li>
                    <strong>Proprietário / Administrador da Academia (Admin):</strong> gestor responsável pela conta da academia contratante (Tenant), configuração do dojo, planos, equipe, matrículas e concessão de acessos.
                  </li>
                  <li>
                    <strong>Instrutor / Professor e Recepção:</strong> membros da equipe da academia com permissões específicas de operação de turmas, chamada, avaliações físicas, graduações e atendimento.
                  </li>
                  <li>
                    <strong>Aluno:</strong> praticante matriculado na academia, com acesso estrito aos seus próprios dados cadastrais, histórico de presença, evolução de faixa, biblioteca digital da sua modalidade/graduação e, quando autorizado pela academia, sua evolução antropométrica.
                  </li>
                  <li>
                    <strong>Responsável Legal / Financeiro:</strong> pai, mãe, tutor ou responsável financeiro vinculado a um ou mais alunos, com acesso estrito à presença, situação cadastral essencial e demonstrativo financeiro dos alunos sob sua responsabilidade.
                  </li>
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  4. Regras de Cadastro, Verificação e Autenticação
                </h3>
                <p>
                  O acesso à plataforma ocorre mediante credenciais individuais (e-mail e senha) ou provedor de autenticação federada (Google OAuth), sempre vinculado a um registro válido e autorizado pela respectiva academia. O vínculo de contas de Alunos e Responsáveis exige validação de convite institucional ou confirmação cadastral verificada, sendo vedada a criação de perfis com informações falsas ou de terceiros sem representação legal.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  5. Responsabilidade pela Guarda e Uso das Credenciais
                </h3>
                <p>
                  As credenciais de acesso são pessoais e intransferíveis. O usuário compromete-se a manter o sigilo de sua senha e a desconectar sua conta ao utilizar dispositivos compartilhados, comunicando imediatamente à administração da academia ou ao suporte do Tatame Club qualquer suspeita de acesso não autorizado.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  6. Responsabilidades da Academia Contratante (Tenant)
                </h3>
                <p>
                  A academia contratante é a única responsável pela veracidade, licitude e atualização dos dados de alunos, responsáveis e membros da equipe que inserir na plataforma, bem como pela coleta de consentimentos específicos de responsáveis legais de menores de idade, conferência de atestados médicos de aptidão física, definição de valores de mensalidades, emissão de cobranças e cumprimento das normas desportivas e fiscais aplicáveis.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  7. Responsabilidades de Alunos, Responsáveis e Equipe
                </h3>
                <p>
                  Os alunos, responsáveis e colaboradores comprometem-se a utilizar a plataforma de boa-fé, fornecendo informações cadastrais e documentos médicos fidedignos, respeitando a privacidade dos demais integrantes da academia e abstendo-se de compartilhar conteúdos restritos da biblioteca digital com terceiros não autorizados.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  8. Uso Adequado e Condutas Proibidas
                </h3>
                <p>
                  É expressamente proibido: (a) tentar acessar dados de outras academias (tenants) ou de outros alunos sem autorização; (b) realizar engenharia reversa, varredura automatizada (<em>scraping</em>) ou testes de intrusão não autorizados; (c) inserir arquivos maliciosos no repositório de documentos médicos; (d) utilizar a plataforma para fins ilícitos, difamatórios ou discriminatórios.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  9. Propriedade Intelectual
                </h3>
                <p>
                  Todo o código-fonte, arquitetura de banco de dados, interfaces visuais, logotipos, marcas e documentação técnica do <strong>Tatame Club</strong> são de titularidade exclusiva de <strong>Beaver Soluções em Tecnologia (CNPJ 28.410.730/0001-80)</strong>. Os conteúdos pedagógicos, vídeos e marcas próprias inseridos por cada academia permanecem sob titularidade da respectiva academia ou de seus licenciantes.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  10. Disponibilidade, Manutenção e Evolução do Sistema
                </h3>
                <p>
                  A Beaver Soluções em Tecnologia emprega boas práticas de engenharia e infraestrutura em nuvem para manter o sistema disponível, podendo realizar manutenções programadas ou emergenciais de segurança, além de atualizar funcionalidades para aprimoramento contínuo do serviço.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  11. Limitações de Responsabilidade
                </h3>
                <p>
                  O Tatame Club é uma ferramenta tecnológica de apoio à gestão. A Beaver Soluções em Tecnologia não responde por: (a) acidentes, lesões ou intercorrências médicas ocorridas durante treinos, exames de faixa ou competições presenciais; (b) inadimplência de alunos perante a academia; (c) avaliações físicas ou decisões técnicas de graduação tomadas pelos instrutores da academia; (d) indisponibilidades decorrentes de falhas de conexão do usuário ou de serviços de terceiros fora de seu controle direto.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  12. Regras sobre Conteúdos, Anexos e Links Externos
                </h3>
                <p>
                  Documentos anexados (como atestados e laudos médicos) são armazenados em ambiente privado com controle de acesso por academia. Vídeos da Biblioteca Digital podem utilizar links incorporados do YouTube ou plataformas externas, sujeitando-se adicionalmente aos termos de serviço do respectivo provedor de vídeo.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  13. Suspensão, Bloqueio e Cancelamento de Acesso
                </h3>
                <p>
                  O acesso de qualquer usuário poderá ser suspenso, bloqueado ou revogado pela administração da academia (no caso de alunos, responsáveis e equipe vinculados ao dojo) ou pela administração da plataforma em caso de violação destes Termos, encerramento do vínculo contratual ou determinação legal.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  14. Alterações dos Termos de Uso
                </h3>
                <p>
                  Estes Termos poderão ser atualizados periodicamente para refletir melhorias funcionais ou alterações legislativas. Sempre que houver mudança relevante, a nova versão será disponibilizada na plataforma com indicação da data de vigência e código de versão.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  15. Legislação Aplicável, Foro e Canal de Contato
                </h3>
                <p>
                  Estes Termos são regidos pelas leis da República Federativa do Brasil. Para dirimir eventuais controvérsias oriundas deste instrumento, fica eleito o foro da Comarca de{' '}
                  <span className="text-amber-300 font-mono">[VALIDAR ANTES DA PUBLICAÇÃO: Cidade/UF da sede da Beaver Soluções em Tecnologia]</span>, ressalvadas as disposições legais de proteção ao consumidor quando aplicáveis.
                </p>
                <p>
                  <strong>Canal oficial de contato e suporte:</strong>{' '}
                  <span className="text-amber-300 font-mono">[VALIDAR ANTES DA PUBLICAÇÃO: contato@tatameclub.com.br / dpo@beavertecnologia.com.br]</span>.
                </p>
              </section>
            </div>
          ) : (
            <div className="space-y-5">
              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  1. Identificação dos Agentes de Tratamento (Controladora e Operadora)
                </h3>
                <p>
                  Para os fins da Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 — LGPD):
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    <strong>Em relação aos dados cadastrais, pedagógicos, financeiros e de saúde dos alunos e responsáveis vinculados a uma academia:</strong> a <strong>Academia Contratante (Tenant)</strong> atua como <strong>Controladora</strong> dos dados pessoais, cabendo a ela as decisões sobre o tratamento, matrícula e relacionamento com o aluno; a <strong>Beaver Soluções em Tecnologia (CNPJ 28.410.730/0001-80)</strong>, provedora do sistema <strong>Tatame Club</strong>, atua como <strong>Operadora</strong>, realizando o tratamento em nome e conforme as configurações da academia dentro dos limites técnicos e de segurança da plataforma.
                  </li>
                  <li>
                    <strong>Em relação aos dados de cadastro comercial dos gestores de academias contratantes, registros de auditoria de segurança da plataforma e aceite contratual do SaaS:</strong> a <strong>Beaver Soluções em Tecnologia</strong> atua como <strong>Controladora</strong>.
                  </li>
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  2. Categorias de Dados Pessoais Tratados
                </h3>
                <p>
                  De acordo com as funcionalidades efetivamente existentes no Tatame Club, podem ser tratados:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Dados de Identificação e Contato:</strong> nome completo, CPF, data de nascimento, telefone/WhatsApp, e-mail e endereço residencial (CEP, logradouro, número, complemento, bairro, cidade e UF).</li>
                  <li><strong>Dados de Vínculo Familiar:</strong> relação de parentesco ou responsabilidade legal/financeira entre o Responsável e o Aluno.</li>
                  <li><strong>Dados Esportivos e Pedagógicos:</strong> modalidade praticada, faixa/graduação atual, graus, histórico de promoções, turmas matriculadas e registros de frequência/presença no tatame.</li>
                  <li><strong>Dados Financeiros:</strong> plano contratado, histórico de mensalidades/faturas, datas de vencimento, status de pagamento e registros de notificações de cobrança.</li>
                  <li><strong>Dados de Saúde e Antropometria (Dados Pessoais Sensíveis — Art. 5º, II, da LGPD):</strong> peso, altura, índice de massa corporal (IMC), classificação antropométrica, tipo sanguíneo, alergias, condições médicas pré-existentes, contato de emergência e documentos médicos anexados (atestados, laudos e termos).</li>
                  <li><strong>Dados Técnicos de Autenticação e Segurança:</strong> identificador de usuário, método de login (e-mail/senha ou Google OAuth), registros de data/hora de acesso e aceite dos documentos legais.</li>
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  3. Origem dos Dados Pessoais
                </h3>
                <p>
                  Os dados podem ser coletados: (a) diretamente junto ao titular ou seu responsável legal no momento do autocadastro ou ativação de convite; (b) mediante inserção pela administração, recepção ou instrutores da academia no ato da matrícula, chamada ou avaliação física; (c) via provedor de autenticação Google OAuth (nome, e-mail verificado e identificador de conta), quando o titular optar por entrar com o Google.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  4. Finalidades do Tratamento
                </h3>
                <p>
                  Os dados pessoais são tratados estritamente para: viabilizar a gestão de matrículas e turmas; controlar a presença e ocupação segura dos tatames; registrar a progressão técnica e histórico de faixas; acompanhar a aptidão física e evolução antropométrica dos praticantes; gerir cobranças de mensalidades e comunicados financeiros aos responsáveis; disponibilizar conteúdo técnico da Biblioteca Digital compatível com a modalidade e faixa do aluno; e assegurar o controle de acesso multi-tenant e a prevenção à fraude.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  5. Bases Legais Aplicáveis (Arts. 7º e 11 da LGPD)
                </h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Execução de contrato ou procedimentos preliminares (Art. 7º, V):</strong> para gestão cadastral, pedagógica, de frequência e financeira decorrente da matrícula junto à academia.</li>
                  <li><strong>Cumprimento de obrigação legal ou regulatória (Art. 7º, II):</strong> para guarda de registros fiscais, cadastrais e exigências de aptidão para prática desportiva.</li>
                  <li><strong>Exercício regular de direitos (Art. 7º, VI):</strong> para comprovação de aceites, histórico de matrículas e adimplemento.</li>
                  <li><strong>Legítimo interesse (Art. 7º, IX):</strong> para segurança da informação, prevenção a acessos indevidos e melhoria técnica da plataforma.</li>
                  <li><strong>Consentimento específico e proteção da vida/incolumidade física (Art. 11, I e II, "e"):</strong> para dados sensíveis de saúde, alergias, tipo sanguíneo, atestados médicos e avaliações antropométricas indispensáveis à segurança do aluno durante a prática marcial.</li>
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  6. Tratamento de Dados de Crianças e Adolescentes (Art. 14 da LGPD)
                </h3>
                <p>
                  O tratamento de dados pessoais de crianças e adolescentes matriculados nas academias é realizado sempre em seu melhor interesse, mediante vínculo obrigatório a um <strong>Responsável Legal</strong> devidamente identificado (nome e CPF validados). Os dados de menores permanecem restritos ao ambiente isolado da respectiva academia e ao portal do seu responsável legal e do próprio aluno, quando autorizado.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  7. Tratamento de Dados Sensíveis de Saúde, Documentos Médicos e Antropometria
                </h3>
                <p>
                  Os dados de peso, altura, IMC, alergias e documentos médicos anexados possuem camada reforçada de controle de acesso: apenas a equipe autorizada da própria academia pode gerenciá-los, e os arquivos de atestados/laudos ficam armazenados em bucket privado com políticas de segurança em nível de linha (<em>Row-Level Security — RLS</em>). A visualização da evolução antropométrica pelo próprio aluno no Portal do Aluno depende de habilitação expressa pela academia.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  8. Compartilhamento de Dados e Operadores Tecnológicos
                </h3>
                <p>
                  O Tatame Club não comercializa dados pessoais. O compartilhamento ocorre exclusivamente com provedores de infraestrutura estritamente necessários à operação do sistema:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Supabase Inc.:</strong> banco de dados PostgreSQL, autenticação e armazenamento seguro de arquivos com isolamento por academia.</li>
                  <li><strong>Google Cloud / Google Identity Services:</strong> quando utilizado o login federado via Google OAuth.</li>
                  <li><strong>YouTube (Google LLC):</strong> para reprodução incorporada dos vídeos de estudo cadastrados na Biblioteca Digital.</li>
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  9. Armazenamento e Transferência Internacional de Dados
                </h3>
                <p>
                  A infraestrutura em nuvem utilizada pelo sistema (Supabase / AWS) pode processar e armazenar dados em servidores localizados no exterior, observando padrões internacionais de criptografia, controle de acesso e cláusulas de proteção compatíveis com o Art. 33 da LGPD.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  10. Medidas Técnicas e Administrativas de Segurança
                </h3>
                <p>
                  Adotamos criptografia em trânsito (HTTPS/TLS) e em repouso, isolamento lógico multi-tenant por meio de políticas de segurança em nível de linha (PostgreSQL RLS), controle de acesso baseado em papéis (RBAC), validação de convites por código e CPF, e descarte automático de rascunhos temporários de formulários no navegador sem armazenamento de senhas ou tokens sensíveis.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  11. Retenção e Descarte de Dados
                </h3>
                <p>
                  Os dados permanecem armazenados durante a vigência do vínculo do aluno com a academia e do contrato da academia com o Tatame Club, respeitando o prazo de retenção configurado pela academia (padrão configurável no painel do Dojo) e os prazos legais de guarda para cumprimento de obrigações fiscais, regulatórias ou exercício regular de direitos em processo judicial ou administrativo (Art. 16 da LGPD).
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  12. Direitos dos Titulares (Art. 18 da LGPD)
                </h3>
                <p>
                  O titular dos dados ou seu responsável legal pode solicitar, a qualquer momento: confirmação da existência de tratamento; acesso aos dados; correção de dados incompletos, inexatos ou desatualizados (inclusive diretamente pelo Portal do Aluno quanto aos dados de contato e endereço); anonimização, bloqueio ou eliminação de dados desnecessários; informação sobre compartilhamentos; e revogação do consentimento, quando aplicável.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  13. Como Exercer Direitos e Canal de Atendimento de Privacidade
                </h3>
                <p>
                  Solicitações relativas a dados específicos de matrícula, frequência, mensalidades ou atestados médicos devem ser direcionadas prioritariamente à <strong>Administração da respectiva Academia (Controladora)</strong>. Solicitações relacionadas à infraestrutura da plataforma Tatame Club podem ser encaminhadas ao Encarregado pelo Tratamento de Dados Pessoais (DPO) da <strong>Beaver Soluções em Tecnologia</strong> pelo canal:{' '}
                  <span className="text-amber-300 font-mono">[VALIDAR ANTES DA PUBLICAÇÃO: privacidade@tatameclub.com.br]</span>.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  14. Uso de Cookies, Sessão e Armazenamento Local
                </h3>
                <p>
                  O sistema utiliza tokens de sessão estritamente necessários para manter o usuário autenticado com segurança e armazenamento local temporário (<em>localStorage</em>) exclusivamente para preferências de interface e preservação temporária de rascunhos de formulários em preenchimento (com expiração automática e sem armazenamento de senhas), evitando perda acidental de dados ao alternar abas do navegador.
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-base font-bold text-white uppercase tracking-wide">
                  15. Atualizações desta Política de Privacidade
                </h3>
                <p>
                  Esta Política poderá ser atualizada para refletir melhorias de segurança, novos recursos ou exigências da Autoridade Nacional de Proteção de Dados (ANPD). A versão vigente estará sempre identificada no rodapé da plataforma e nas telas de acesso.
                </p>
              </section>
            </div>
          )}

          {/* Copyright Footer inside Document */}
          <div className="pt-4 border-t border-zinc-800 text-xs text-zinc-400">
            © {currentYear} Tatame Club. Sistema desenvolvido e mantido por Beaver Soluções em Tecnologia — CNPJ 28.410.730/0001-80. Todos os direitos reservados.
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-950/60 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-zinc-400">
            Versão do documento: <span className="text-zinc-200 font-mono">{LEGAL_DOCUMENT_VERSIONS.terms_of_use}</span>
          </div>
          <div className="flex items-center gap-3">
            {onAcceptBoth && (
              <button
                type="button"
                onClick={() => {
                  onAcceptBoth();
                  onClose();
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                Li e concordo com os Termos e a Política
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold uppercase tracking-wider transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
