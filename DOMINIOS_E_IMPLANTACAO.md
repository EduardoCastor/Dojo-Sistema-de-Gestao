# Tatame Club — Configuração de Domínios Oficiais, Autenticação Global e Implantação

Este documento detalha as configurações externas obrigatórias para disponibilizar a plataforma **Tatame Club** em seus domínios oficiais, configurar o administrador global do SaaS (`admin@tatameclub.com.br`) com segurança e aplicar as migrations no Supabase.

---

## 1. Domínios Oficiais e Arquitetura de Ambientes

A aplicação opera com separação de contexto por hostname e rota:

- **Site Comercial Principal e Ambiente das Academias**: `https://tatameclub.com.br` (e `https://www.tatameclub.com.br`)
  - Exibe a apresentação comercial, planos com limites de alunos, usuários e unidades, cadastro de novas academias (10 dias de teste grátis) e login exclusivo da academia vinculada ao usuário autenticado.
  - **Não abre nenhum painel de demonstração compartilhado.**
- **Painel Administrativo Exclusivo do Proprietário SaaS**: `https://painel.tatameclub.com.br` (também acessível em homologação via `/painel` ou `?env=painel`)
  - Restrito exclusivamente ao proprietário da plataforma (`admin@tatameclub.com.br` com `is_platform_admin = true` na tabela `public.profiles` e ativo em `public.platform_authorized_owners`).
  - Bloqueia qualquer usuário de academia (`owner`, `branch_manager`, `instructor`, `secretary`, `financial`, `student`, `guardian`), mesmo que conheça a URL direta.

---

## 2. Configuração de DNS (Registro.br / Cloudflare / Provedor DNS)

Configure os seguintes apontamentos DNS na zona `tatameclub.com.br`:

| Tipo | Nome / Host | Destino / Valor | Proxy / TTL | Finalidade |
| :--- | :--- | :--- | :--- | :--- |
| `A` | `@` | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` *(se GitHub Pages)* ou IP do provedor (Vercel / Cloudflare Pages / Nginx) | Automático | Domínio raiz `tatameclub.com.br` |
| `CNAME` | `www` | `tatameclub.com.br` | Automático | Subdomínio `www.tatameclub.com.br` |
| `CNAME` | `painel` | `tatameclub.com.br` *(ou endpoint da hospedagem)* | Automático | Subdomínio exclusivo do painel global `painel.tatameclub.com.br` |

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

## 5. Aplicação das Migrations 25 e 26 no Supabase

Execute no **SQL Editor** do Supabase (ou via `supabase db push`):

1. `supabase/migrations/25_tatame_club_multitenant_limits_and_team_management.sql` *(caso ainda não tenha sido aplicada)*
2. `supabase/migrations/26_fix_platform_owner_identity_and_secure_bootstrap.sql` *(obrigatória para migrar a autorização global para `admin@tatameclub.com.br`, criar a tabela `platform_authorized_owners` e as RPCs `get_platform_bootstrap_status` e `verify_platform_admin_access`)*

### Como verificar no SQL Editor se as Migrations 25 e 26 estão ativas:
```sql
SELECT public.get_platform_bootstrap_status();
```
O retorno esperado é um JSON com `"migration_25_applied": true`, `"migration_26_applied": true` e `"authorized_owner_email": "admin@tatameclub.com.br"`.

---

## 6. Inicialização Segura da Senha do Proprietário (`admin@tatameclub.com.br`)

**Nenhuma senha é armazenada no código-fonte, em migrations ou em variáveis públicas.** Existem duas formas seguras de inicializar o acesso de `admin@tatameclub.com.br`:

### Procedimento A — Via E-mail Oficial `admin@tatameclub.com.br` + SQL Editor
1. Acesse `https://painel.tatameclub.com.br` na aba **"1º Acesso"** (método *Confirmação por E-mail*) ou crie o usuário em `Authentication -> Users -> Add User` no Supabase Dashboard com o e-mail `admin@tatameclub.com.br`.
2. Confirme o link enviado para a caixa de entrada de `admin@tatameclub.com.br` (ou defina a senha pelo link de **"Recuperar Senha"**).
3. No **SQL Editor** do Supabase, execute uma única vez para vincular o privilégio global no banco:
   ```sql
   SELECT public.bootstrap_platform_owner_by_email('admin@tatameclub.com.br');
   ```

### Procedimento B — Via Edge Function Protegida (`platform-owner-bootstrap`) com Token Único
1. Publique a Edge Function `supabase/functions/platform-owner-bootstrap/index.ts` e configure o segredo `PLATFORM_BOOTSTRAP_SECRET` em `Edge Functions -> Secrets` no Supabase.
2. Em `https://painel.tatameclub.com.br`, selecione **"1º Acesso"** → **"Token Administrativo"**, informe o `PLATFORM_BOOTSTRAP_SECRET` e escolha sua senha forte.

---

## 7. Aplicação da Migration 30 (Solicitação de Planos, Pix e Assinaturas SaaS)

Para que o botão **"Solicitar Plano e Receber Chave Pix"** registre com sucesso as assinaturas no banco de dados e notifique o schema cache do PostgREST sem o erro `PGRST202`:

1. No **SQL Editor** do Supabase (`https://supabase.com/dashboard/project/knmzzndugadmklzzgtaa/sql/new`):
2. Abra e execute integralmente o arquivo `supabase/migrations/30_fix_saas_pix_subscription_and_rpcs.sql`.
3. Ele criará/atualizará:
   - As colunas de planos, faturas e auditoria de e-mails (`saas_subscription_email_logs`).
   - As constraints de status para `pending_payment` e `under_review`.
   - A RPC `public.request_saas_plan_subscription(...)` com `SECURITY DEFINER` e permissão para `authenticated`.
   - O comando `NOTIFY pgrst, 'reload schema';` para atualizar instantaneamente o cache de RPCs do Supabase.


---

## 8. Aplicação da Migration 32 (Ativação Manual de Licenças SaaS e Controles Administrativos)

Para corrigir o erro `Could not find the function public.admin_manual_activate_subscription(p_extend_days, p_reason, p_tenant_id) in the schema cache`:

1. No **SQL Editor** do Supabase (`https://supabase.com/dashboard/project/knmzzndugadmklzzgtaa/sql/new`):
2. Execute integralmente o arquivo `supabase/migrations/32_fix_admin_manual_activate_subscription_and_tenant_controls.sql`.
3. A migration aplica com segurança:
   - A RPC `public.admin_manual_activate_subscription(p_tenant_id uuid, p_reason text, p_extend_days integer DEFAULT 30)` corrigindo referências a `trade_name`, chaves UUID e colunas de `platform_audit_logs`.
   - Preservação da regra de vigência (se ativa, estende a partir de `current_period_end`; se vencida, inicia de `now()`).
   - Proteção estrita das tabelas financeiras (não altera `saas_payments` nem mensalidades).
   - As RPCs administrativas complementares `public.admin_suspend_tenant` e `public.admin_reactivate_tenant`.
   - Concessão de permissões de execução para `authenticated` e emissão do sinal `NOTIFY pgrst, 'reload schema';` para recarga imediata do cache do PostgREST.
