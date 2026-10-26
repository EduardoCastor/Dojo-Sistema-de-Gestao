# Tatame Club — Configuração de Domínios Oficiais, Autenticação Global e Implantação

Este documento detalha as configurações externas obrigatórias para disponibilizar a plataforma **Tatame Club** em seus domínios oficiais, configurar o administrador global do SaaS (`beaverstraining@gmail.com`) com segurança e aplicar as migrations no Supabase.

---

## 1. Domínios Oficiais e Arquitetura de Ambientes

A aplicação opera com separação de contexto por hostname e rota:

- **Site Comercial Principal e Ambiente das Academias**: `https://tatameclub.com.br` (e `https://www.tatameclub.com.br`)
  - Exibe a apresentação comercial, planos com limites de alunos, usuários e unidades, cadastro de novas academias (10 dias de teste grátis) e login exclusivo da academia vinculada ao usuário autenticado.
  - **Não abre nenhum painel de demonstração compartilhado.**
- **Painel Administrativo Exclusivo do Proprietário SaaS**: `https://painel.tatameclub.com.br` (também acessível em homologação via `/painel` ou `?env=painel`)
  - Restrito exclusivamente ao proprietário da plataforma (`beaverstraining@gmail.com` com `is_platform_admin = true` / `role = 'superadmin'`).
  - Bloqueia qualquer usuário de academia (`owner`, `branch_manager`, `instructor`, `receptionist`, `financial`, `student`, `guardian`).

---

## 2. Configuração de DNS (Registro.br / Cloudflare / Provedor DNS)

Configure os seguintes apontamentos DNS na zona `tatameclub.com.br`:

| Tipo | Nome / Host | Destino / Valor | Proxy / TTL | Finalidade |
| :--- | :--- | :--- | :--- | :--- |
| `A` | `@` | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` *(se GitHub Pages)* ou IP do provedor (Vercel / Cloudflare Pages / Nginx) | Automático | Domínio raiz `tatameclub.com.br` |
| `CNAME` | `www` | `tatameclub.com.br` | Automático | Subdomínio `www.tatameclub.com.br` |
| `CNAME` | `painel` | `tatameclub.com.br` *(ou endpoint da hospedagem)* | Automático | Subdomínio exclusivo do painel global `painel.tatameclub.com.br` |

> **Observação para GitHub Pages vs. Cloudflare Pages / Vercel**:
> - O workflow `.github/workflows/deploy.yml` foi integralmente preservado para compilação e publicação contínua.
> - Como o GitHub Pages nativo vincula apenas um domínio customizado por repositório (`CNAME`), para responder simultaneamente a `tatameclub.com.br` e `painel.tatameclub.com.br` sobre o mesmo build SPA recomenda-se:
>   1. **Cloudflare Proxy (Orange Cloud)** na frente do GitHub Pages (com regra de Host header / Page Rule encaminhando `painel.tatameclub.com.br` para o artefato estático), **ou**
>   2. **Vercel / Cloudflare Pages** conectado ao mesmo repositório GitHub adicionando ambos os domínios (`tatameclub.com.br` e `painel.tatameclub.com.br`) ao projeto.

---

## 3. Certificados HTTPS (TLS/SSL)

1. Ative a emissão automática de certificado Let's Encrypt / Edge TLS para:
   - `tatameclub.com.br`
   - `www.tatameclub.com.br`
   - `painel.tatameclub.com.br`
2. Habilite o redirecionamento obrigatório **HTTP → HTTPS** (`Always Use HTTPS`).

---

## 4. Configuração do Supabase Auth (Redirect URLs e Site URL)

No painel do **Supabase** (`Authentication` → `URL Configuration`):

1. **Site URL**:
   ```text
   https://tatameclub.com.br
   ```
2. **Redirect URLs (adicione todas as URLs abaixo)**:
   ```text
   https://tatameclub.com.br/**
   https://www.tatameclub.com.br/**
   https://painel.tatameclub.com.br/**
   http://localhost:3000/**
   ```

---

## 5. Aplicação das Migrations no Supabase

Execute a nova migration versionada no SQL Editor do Supabase (ou via `supabase db push`):

- Arquivo: `supabase/migrations/25_tatame_club_multitenant_limits_and_team_management.sql`

Esta migration realiza de forma idempotente:
1. Adição da coluna `max_users` em `saas_plans` e dos limites customizados (`custom_max_users`, `custom_max_branches`, `custom_max_students`) em `saas_subscriptions`.
2. Criação da tabela `tenant_user_invitations` com RLS por tenant.
3. Criação da função `public.get_tenant_effective_limits(p_tenant_id)` que retorna os limites efetivos (considerando plano contratado ou override individual da licença).
4. Criação dos triggers transacionais com bloqueio `FOR UPDATE` (`trg_enforce_tenant_user_limit` e `trg_enforce_tenant_branch_limit`) impedindo que chamadas concorrentes ultrapassem o limite de usuários ativos/convidados ou o limite de unidades (onde a Unidade Matriz conta como a 1ª unidade).
5. Criação dos triggers de segurança (`trg_protect_platform_admin_flag` e `trg_protect_tenant_license_fields`) impedindo auto-promoção para `is_platform_admin` ou adulteração de plano/status pelo cliente.
6. Atualização de `public.register_academy_atomic` para provisionar a academia, a `Unidade Matriz` (1ª unidade) e a assinatura Trial de 10 dias completamente isoladas.
7. Criação das RPCs `public.admin_update_license_limits` e `public.bootstrap_platform_owner_by_email`.

---

## 6. Inicialização Segura do Proprietário Global (`beaverstraining@gmail.com`)

**Nenhuma senha foi fixada no código-fonte.** Para inicializar a conta do proprietário do SaaS em produção:

1. Acesse `https://painel.tatameclub.com.br` (ou `/?env=painel`).
2. Na tela de autenticação exclusiva do SaaS, selecione a aba **"1º Acesso (Criar Senha)"** (ou crie o usuário diretamente em `Authentication -> Users` no painel do Supabase com o e-mail `beaverstraining@gmail.com` e uma senha forte).
3. Ao autenticar com `beaverstraining@gmail.com`, a aplicação invoca `public.bootstrap_platform_owner_by_email()`, que verifica no servidor (`auth.jwt() ->> 'email'`) que o e-mail é estritamente `beaverstraining@gmail.com` e promove `profiles.is_platform_admin = true`, registrando o evento em `platform_audit_logs`.
