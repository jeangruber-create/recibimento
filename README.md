# ADM Recebimentos — Assembleia de Deus Missões

Protótipo de gestão de recebimentos: papéis (sede / setor / congregação / coletor / membro),
painel do dia, fechamento semanal (seg–dom), despesas (limite de 40%), alertas e prestação de contas.

- Front-end: `index.html` (arquivo único) — fala com a API em `http://localhost:4000`.
- Backend: `backend/` — Node + Express + Prisma + PostgreSQL.

## 1. Subir o backend (API)

Pré-requisito: PostgreSQL rodando e o banco `adm_recebimentos` criado (a conexão está em `backend/.env`).

```powershell
cd "C:\Users\Jean Gruber\Documents\New OpenCode Project\backend"
npm install          # só na primeira vez
npm run prisma:generate
npm run migrate      # ou: npm run migrate:deploy
npm run seed         # cria usuários/setores/congregações padrão
npm start            # API em http://localhost:4000
```

Conferir: abra `http://localhost:4000/health` → deve retornar `{"ok":true,...}`.

## 2. Abrir o front-end

Com a API no ar, o jeito mais simples é abrir **`http://localhost:4000/`** — o próprio backend
serve o `index.html` (ver seção 5). Para desenvolver o front separado da API:

```powershell
cd "C:\Users\Jean Gruber\Documents\New OpenCode Project"
python -m http.server 8080
```

Depois abra `http://localhost:8080/index.html` (o front detecta a API em `http://localhost:4000`).

## 3. Logins (senha padrão `123456`)

| E-mail | Perfil | Escopo |
|---|---|---|
| admin@adm.org.br | Sede | tudo |
| setor@adm.org.br | Tesoureiro de setor | setor 8 |
| cong@adm.org.br | Tesoureiro de congregação | setor 8 / cong 45 |
| coletor@adm.org.br | Coletor | setor 8 / cong 45 |
| coletor2@adm.org.br | Coletor | setor 3 / cong 14 |
| membro@adm.org.br | Membro | preenche cadastro no 1º acesso |

## 4. Comportamento

- **Com a API no ar**: o servidor é a fonte da verdade (login, recibos, despesas, fechamento semanal, prestações, alertas, perfil, **usuários, setores e congregações**). O `localStorage` só faz cache de renderização.
- **Sem API** (aberto offline): o app roda em modo local (dados no navegador).
- **Sessão**: o login grava um cookie `adm_token` **httpOnly** (não acessível ao JavaScript); o `localStorage` guarda apenas os dados do usuário. O `init()` valida a sessão com `GET /api/auth/me` antes de restaurar a tela.
- **Fechamento semanal**: semana seg→dom; congregação fecha/justifica, setor reabre as do seu setor, sede valida.
- **Painel de Controle**: ordem dos cards — **indicadores no topo** (`Resumo do Dia` + `Resumo do Período`), depois **Filtros** e **Resultados da Consulta**. O **Resumo por Dia da Semana** (seg→dom da semana corrente, coletado por data) fica na **lateral (≥1024px)** e **logo abaixo (celular)**, para sede/setor/congregação.
- **Repasse**: valor previsto ou declarado **nunca é negativo** — com caixa deficitário na semana, declara-se `R$ 0,00` e a diferença exige justificativa no envio da prestação.

### 4.1 Matriz de permissões por perfil

| Competência | Coletor | Congregação | Setor | Sede |
|---|---|---|---|---|
| Ver recibos | só os que **ele** coletou (`createdById`) | congregação inteira | congregações do seu setor | todos |
| Ver despesas | não | congregação inteira | congregações do seu setor | todos |
| Lançar despesa | não | congregação inteira | congregações do seu setor | todos |
| Cadastrar usuários | — | coletor + membro da congregação | coletor + membro + setor do setor | todos |
| Cadastrar setores | — | — | — | sim |
| Cadastrar/editar congregações | — | — | só as do **seu setor** | todas |
| Excluir congregações | — | — | — | sim |
| Fechar semana (congregação) | — | a própria | — | qualquer uma |
| Justificar semana | — | a própria | — | — |
| Reabrir fechamento | — | a própria | congregações do seu setor | todas |
| Validar fechamento | — | — | — | sim |
| Prestação de contas | — | não vê | envia do setor | aprova/reabre |

O filtro é aplicado **tanto no front (`getScopedReceipts`, `getManageableCongregations`) quanto no backend (`receiptWhere`, `expenseScopeWhere`, `canManageSectorStructure`)** — defesa em profundidade.

## 5. Deploy (servidor único)

A API também serve o `index.html`, então basta publicar um único processo Node. O front aponta
para a própria origem (o backend injeta `window.ADM_API_BASE=""` no HTML).

- `FRONT_FILE` (opcional): caminho do `index.html` a servir. Padrão: `index.html` na raiz do repositório.
- `CORS_ORIGIN`: em produção, defina os domínios permitidos (ex.: `https://app.exemplo.com`). O cookie exige `credentials`, então não pode ficar `*`.
- `JWT_SECRET`: **obrigatório** trocar por um valor forte (o backend recusa subir em produção com o valor padrão).
- O `helmet` já vem com CSP ajustada para os scripts de CDN usados (SheetJS, qrcodejs, html5-qrcode).

A sessão usa cookie http-only (`adm_token`). Em produção o cookie sai com `SameSite=Strict; Secure`,
então a interface precisa ser servida pelo **mesmo domínio** da API (é o caso do servidor único abaixo).

```powershell
$env:NODE_ENV="production"
$env:JWT_SECRET="<segredo-forte>"
$env:CORS_ORIGIN="https://seu-dominio"
npm start        # serve a API e o index.html na mesma porta (http://localhost:4000/)
```

Se o `index.html` ficar em outro lugar, aponte: `$env:FRONT_FILE="C:\caminho\index.html"`.

Publique atrás de HTTPS (proxy reverso com `TRUST_PROXY=1`, ou a própria aplicação com TLS):
o cookie `Secure` e o `Strict-Transport-Security` do `helmet` só têm efeito sob HTTPS.

## 5.1. Testes automáticos (opcional)

Com o backend no ar, rode o teste de integração:

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
node "$env:TEMP\opencode\apitest.mjs" "index.html"   # 108/108
```

O teste reproduz o cookie http-only num jar próprio, então cobre o fluxo real de sessão. A suíte
inclui a verificação de escopo por perfil (coletor vê só o próprio; setor cria/edita congregações
do seu setor e não exclui; congregação vê exatamente a própria — `statCongs = 1`). No **painel de
controle**, coletor e congregação ficam **sem filtro de setor** e com a congregação travada na própria,
o card **"Resultados da Consulta" vem logo abaixo da busca** (`dashSearch` → `dashResults` →
`dashExpensesCard`), os **indicadores ficam no topo** (`dayCard` → `kpiCard` → `filtersCard` →
`resultsCard`), o card de **repasse** usa a **semana corrente** (`pendingClosureWeek()`), a mesma
semana 0 do Fechamento Semanal e da Prestação de Contas, e o **"Resumo por Dia da Semana"** renderiza
os **7 dias da semana corrente (seg–dom)** com o total de cada data. O resumo aparece na **coluna
lateral em telas ≥1024px** e **logo abaixo da consulta no celular** (media query
`max-width: 1023px` + `layoutDashboardSide()`), para **congregação, setor e sede** (coletor não vê).

Além disso há suítes de renderização em `%TEMP%` (rodar com a API no ar):

```powershell
$py = "C:\Users\Jean Gruber\AppData\Local\Programs\Python\Python314\python.exe"
foreach ($t in 'roletest','hometest','membertest','dashexptest','weeklytest2','workflowtest','prestacaotest') {
  & $py "$env:TEMP\$t.py"
}
```

Importante: para rodar os testes sem estourar o limite de login (20/15min), suba o backend com `NODE_ENV=test`:

```powershell
$env:NODE_ENV="test"; npm start
```

## 6. Publicar na web (Render + Neon, grátis e sem cartão)

A API entrega o `index.html` em `/` (seção 5), então **um único serviço publica o sistema inteiro**:
mesma origem, cookie `SameSite=Strict`, sem CORS entre domínios e **sem nenhum ajuste no HTML**.

| Onde | O quê | Preço |
|---|---|---|
| GitHub | código-fonte (já feito) | grátis |
| **Render** | web service Node servindo API + front | Free (sem cartão; dorme após 15 min) |
| **Neon** | PostgreSQL do sistema | Free (sem cartão; **não expira**) |

> Por que **não** usar o Postgres do Render: o banco grátis dele **expira em 30 dias** (mais 14 de
> carência) e **apaga todos os dados**. O do Neon é permanente.

### 6.1 Banco no Neon (1 minuto, sem cartão)

1. [neon.com](https://neon.com) → **Sign up** (dá para entrar com a conta GitHub) — **não pede cartão**.
2. Crie um projeto (padrão) e em **Connection Details** escolha **Direct** (não o *Pooled*):
   o build roda `prisma migrate deploy` e as migrações precisam de conexão direta.
3. Copie a string `postgresql://...` (já vem com `sslmode=require`).

### 6.2 Serviço no Render (Blueprint)

1. [render.new](https://render.new) → **Sign in with GitHub** → **New +** → **Blueprint** →
   conecte o repositório `jeangruber-create/adm-recebimentos` → **Apply**.
   O `render.yaml` cria só o serviço `adm-recebimentos-api` no plano **Free** (se pedir plano,
   escolha **Free** — o cartão não é necessário).
2. Na revisão do Blueprint, se ele pedir o valor de `DATABASE_URL`, cole a string do Neon ali mesmo.
   Se não pedir: entre no serviço → **Environment** → **Add Environment Variable** →
   `DATABASE_URL` = string do Neon → **Save** → **Manual Deploy → Clear build cache & deploy**
   (o primeiro build sem essa variável falha — é esperado).
3. Build: `npm install && npx prisma generate && npx prisma migrate deploy` (cria as tabelas no Neon).
4. Confira `https://adm-recebimentos-api.onrender.com/health` → `{"ok":true}` e abra a raiz
   (`https://adm-recebimentos-api.onrender.com/`) → tela de login.

Outras variáveis do blueprint: `NODE_ENV`, `JWT_SECRET` (gerado), `CORS_ORIGIN` e `TRUST_PROXY=1`.

### 6.3 Seed dos usuários (na sua máquina)

O plano **Free do Render não tem Shell**, então o seed roda **localmente**, apontando para o Neon:

```powershell
cd "C:\Users\Jean Gruber\Documents\New OpenCode Project\backend"
npm install                      # só na primeira vez
npm run prisma:generate
$env:DATABASE_URL = "<string do Neon>"
npm run seed                     # cria setores, congregações e usuários de teste
```

Login: `admin@adm.org.br` / `123456`.

### 6.4 Depois de publicar

- Troque as senhas dos usuários demo e cadastre os reais pelo painel da sede.
- **Render**: dorme após ~15 min sem tráfego (o primeiro acesso seguinte leva ~30 s);
  750 horas grátis por mês e 5 GB de banda. **Neon**: o compute dorme após 5 min ocioso e acorda
  sozinho na primeira conexão — os dados ficam guardados.
- `autoDeploy: true`: cada `git push` no GitHub já recompila e redesenha o serviço.
- A CSP do `helmet` libera os 3 CDN que o front usa (SheetJS, qrcodejs, html5-qrcode).

### 6.5 (Opcional) Front em hospedagem separada

Se um dia quiser um endereço próprio que não durma (GitHub Pages, Cloudflare Pages, Netlify...),
o suporte já está no código:

1. No topo do `<head>` do `index.html`:
   ```html
   <script>window.ADM_API_BASE = window.ADM_API_BASE ?? 'https://SEU-SUBDOMINIO.onrender.com';</script>
   ```
   O `??` preserva `""`, que o backend injeta quando ele também serve o front.
2. Na API: `CROSS_SITE=1` (o cookie passa a sair como `SameSite=None; Secure`) e `CORS_ORIGIN`
   com a origem exata do front (protocolo + domínio, sem `/` no final).

### 6.6 Se algo falhar

| Sintoma | Causa provável |
|---|---|
| Build falha em `prisma migrate deploy` | `DATABASE_URL` ausente ou errada (use a string **Direct** do Neon) |
| Erro `P1001`/timeout no log | string errada, ou compute do Neon dormindo (normal: reabra a página) |
| `Failed to fetch` ao logar | deploy ainda subindo, ou serviço parado no Render |
| Sai logado ao recarregar | `JWT_SECRET` foi regerado/removido nas env vars do Render |
| `429` no login | limite de tentativas (20/15 min por IP); reinicie o serviço no Render |
| Página sem dados | `npm run seed` não rodou (§6.3) |
