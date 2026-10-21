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
- **Limite de despesa**: o teto de **40%** é calculado sobre o **total de receitas da semana** (seg→dom), nunca por dia. Fechar dentro do limite (mesmo com saldo) libera o movimento; só exige justificativa quando as despesas passam de 40%.
- **Portal do membro (autocadastro)**: o fiel cria a própria conta em **"Sou membro — quero me cadastrar"** na tela de login, informando **nome completo, CPF, CEP, número da residência e celular** (mais e-mail e senha). Esses dados alimentam os demais módulos. Após o cadastro, o sistema confirma o celular por um **código de 6 dígitos**. O membro ganha um **código único (ADMxxxxxx)** e um QR code.
- **Senha do fiel**: é definida pelo próprio membro no autocadastro. Se perder, **somente o admin** redefine (`🔑` na lista de usuários), gerando uma **senha temporária** que o fiel troca no 1º acesso.
- **Agradecimento por WhatsApp**: ao registrar um recibo, se o contribuinte for identificado por **código de membro ou CPF**, o botão **"Agradecer por WhatsApp"** abre o `wa.me` com uma mensagem de agradecimento personalizada (sem custo de API). O coletor também pode buscar o membro por nome, código ou CPF.
- **Ditado de voz (coleta)**: o reconhecimento de fala usa **20 s de silêncio** antes de encerrar (configurável em `SpeechService.silenceMs`), com **limite de 3 min** por sessão e **religamento automático** quando o navegador (comum no Chrome do celular) encerra a escuta sozinho. Assim o coletor pode ditar os dados com calma, sem o ditado fechar no meio.
- **Uso offline (PWA)**: o app é instalável (manifest + service worker) e abre sem internet. Sem conexão, **recibos e despesas** são gravados numa **fila de sincronização** local e enviados automaticamente quando a internet volta (ou manualmente, tocando no indicador no topo). O badge no topo mostra o estado: `🟢 Online`, `⏳ N pendentes` ou `📴 Offline (N)`.
- **Dizimar/Ofertar de casa (portal do membro)**: o membro registra o próprio **dízimo** ou **oferta** pelo portal, direto de casa. O lançamento é **sempre PIX**, fica **vinculado ao código/CPF do membro** e **gera um recibo automaticamente** na congregação dele. O portal exibe a **chave PIX da congregação** e gera o **PIX copia-e-cola (BR Code) + QR Code** já com o valor digitado (ou sem valor, se não informado), para o membro pagar direto pelo app do banco.
- **Confirmação do PIX (conciliação)**: o lançamento do membro nasce com situação **"Pendente"** e **não entra nos totais** (painel, fechamento semanal, prestação e limite de 40%). O **tesoureiro da congregação, tesoureiro de setor ou a sede** confirma o recebimento na tela **Lançamentos** (botão **"Confirmar PIX"**) ou no detalhe do recibo; a partir daí o valor passa a contar em todos os módulos. A confirmação grava **quem confirmou e quando** (auditoria).
- **Chave PIX por congregação**: a sede e o tesoureiro de setor cadastram/editam a **chave PIX** (e o tipo) de cada congregação na tela **Cadastro de Congregações**. Sem chave, o portal do membro avisa que ela ainda não foi cadastrada (mas o lançamento já pode ser feito).
- **Destaque do dízimo/oferta de casa**: a prestação de contas e os relatórios (Excel/impressão) mostram, separadamente, o total de **"Dízimos e ofertas de casa (membros)"** da semana (com a divisão entre dízimos e ofertas), além da marcação de origem **Membro (casa)** / Coleta em cada lançamento.
- **Membros & Contatos (base consolidada)**: nova tela de gestão (menu **Gerenciar → Membros & Contatos**) que reúne **todos os membros e contatos**, tanto do **autocadastro completo** quanto dos **cadastros parciais feitos pelo coletor no balcão** (que agora são gravados no **banco**, visíveis para toda a liderança — não ficam mais presos no aparelho). A tela oferece **busca** (nome, código, CPF, celular), **filtros** (setor, congregação, cadastro completo/incompleto), **ordenação** (nome, maiores contribuintes, recentes), **resumo** (cadastrados, incompletos, contribuintes, total confirmado) e, por membro: **ficha com histórico de contribuições** (total, dízimos, ofertas, recibos), **edição de dados de contato**, **abertura do recibo** de qualquer contribuição e **mensagens de agradecimento/felicitação por WhatsApp** (texto editável). A lista pode ser **exportada em Excel**.
- **Cadastro no balcão sem login imediato**: o cadastro parcial do coletor cria um membro no banco com **código ADM** e **sem login ativo** (e-mail provisório, senha aleatória). O acesso do fiel é liberado quando ele concluir o **autocadastro** informando os dados que faltam. O coletor **cadastra**, mas **não navega** pela base completa (a listagem é da liderança).
- **Vínculo recibo ↔ membro**: cada recebimento passa a guardar também o **`personUserId`** (FK opcional), além do nome/código em texto. Isso permite **total exato por membro** na tela de Membros (recibos antigos continuam somando por código de membro).


### 4.1 Matriz de permissões por perfil

| Competência | Coletor | Congregação | Setor | Sede |
|---|---|---|---|---|
| Ver recibos | só os que **ele** coletou (`createdById`) | congregação inteira | congregações do seu setor | todos |
| Ver despesas | não | congregação inteira | congregações do seu setor | todos |
| Lançar despesa | não | congregação inteira | congregações do seu setor | todos |
| Cadastrar usuários | — | coletor + membro da congregação | coletor + membro + setor do setor | todos |
| Membros & Contatos (listar/editar/exportar) | — | membros da própria congregação | membros do seu setor | todos |
| Cadastrar membro no balcão (dados parciais) | sim (na própria congregação) | sim | sim | sim |
| Cadastrar setores | — | — | — | sim |
| Cadastrar/editar congregações | — | — | só as do **seu setor** | todas |
| Chave PIX da congregação | — | — | só as do **seu setor** | todas |
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
- **QR Code offline**: a lib `qrcodejs` é servida localmente em `/vendor/qrcode.min.js` (com fallback para o CDN). Assim o QR do membro e o PIX copia-e-cola continuam funcionando mesmo sem acesso ao CDN (rede móvel restrita/offline). Os 3 CDN continuam liberados na CSP.

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
node "$env:TEMP\opencode\apitest.mjs" "index.html"   # 133/133
```

Testes do modo offline/PWA (não precisam da API para o `offlinetest`):

```powershell
node "$env:TEMP\offlinetest.mjs" "index.html"        # 10/10  (fila offline: add/remove/badge/id local)
node "$env:TEMP\draintest.mjs"  "index.html"         # 7/7    (drena a fila para o servidor e troca o id)
node "$env:TEMP\givetest.mjs"   "index.html"         # 21/21  (dizimar/ofertar: PIX, BR Code, pendente/confirmado, offline)
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

#### Banco já provisionado (esta máquina)

`npm i -g neon@latest` + `neon login` + `neon init` + `neon deploy` foram executados aqui:
projeto **`noisy-block-71166023`** ("recebimento", org `org-billowing-mouse-49680305`, região
`aws-sa-east-1`, branch **`production`**). Vínculo em `.neon`, política em `neon.ts`, skill do
agente em `.agents/skills/neon`.

> `neon deploy` grava `.env.local` na raiz a cada execução — **cuidado**: ele reescreve as
> variáveis do Neon e apaga customizações feitas ali. `neon env pull` faz o mesmo. O `backend/.env`
> (que aponta para o Neon) é um arquivo separado e não é afetado.

#### Criar do zero (nova máquina/conta)

```powershell
npm i -g neon@latest
neon login                       # abre o navegador (60 s para autorizar)
neon init -y --org-id <org> --project-id <projeto> `
           --branch production --services postgres
neon deploy                      # aplica a política e grava .env.local na raiz
```

O `.env.local` (**não vai para o Git**) traz `DATABASE_URL` (pooler), `DATABASE_URL_UNPOOLED`
(direta) e `NEON_BRANCH`. O `backend/.env` recebe as duas renomeadas: `DATABASE_URL` = pooler
(tráfego da aplicação, conforme a skill do Neon) e `DIRECT_URL` = direta — o `schema.prisma`
declara `directUrl = env("DIRECT_URL")`, então `prisma migrate deploy` usa a conexão direta
(obrigatório: migrações não passam pelo pgbouncer).

### 6.2 Serviço no Render (Blueprint)

1. [render.new](https://render.new) → **Sign in with GitHub** → **New +** → **Blueprint** →
   conecte o repositório `jeangruber-create/adm-recebimentos` → **Apply**.
   O `render.yaml` cria só o serviço `adm-recebimentos-api` no plano **Free** (se pedir plano,
   escolha **Free** — o cartão não é necessário).
2. Na revisão do Blueprint, se ele pedir as variáveis, cole ali mesmo (veja o `.env.local`).
   Se não pedir: entre no serviço → **Environment** → **Add Environment Variable** e crie as duas:
   `DATABASE_URL` (pooler) e `DIRECT_URL` (direta) → **Save** →
   **Manual Deploy → Clear build cache & deploy**
   (o primeiro build sem elas falha — é esperado).
3. Build: `npm install && npx prisma generate && npx prisma migrate deploy` (cria as tabelas no Neon).
4. Confira `https://adm-recebimentos-api.onrender.com/health` → `{"ok":true}` e abra a raiz
   (`https://adm-recebimentos-api.onrender.com/`) → tela de login.

Outras variáveis do blueprint: `NODE_ENV`, `JWT_SECRET` (gerado), `CORS_ORIGIN` e `TRUST_PROXY=1`.

### 6.3 Seed dos usuários (na sua máquina)

O plano **Free do Render não tem Shell**, então o seed roda **localmente** (usa o `backend/.env`
gravado no passo 6.1):

```powershell
npm run build             # prisma generate (raiz -> backend)
npm run migrate:deploy    # aplica as 3 migrações no Neon
npm run seed              # cria 20 setores, 120 congregações e 6 usuários
```

Login: `admin@adm.org.br` / `123456`.

### 6.4 Depois de publicar

- Troque as senhas dos usuários demo e cadastre os reais pelo painel da sede.
- **Render**: dorme após ~15 min sem tráfego (o primeiro acesso seguinte leva ~30 s);
  750 horas grátis por mês e 5 GB de banda. **Neon**: o compute dorme após 5 min ocioso e acorda
  sozinho na primeira conexão — os dados ficam guardados.
- `autoDeploy: true`: cada `git push` no GitHub já recompila e redesenha o serviço.
- A CSP do `helmet` libera os 3 CDN que o front usa (SheetJS, qrcodejs, html5-qrcode); o `qrcodejs` também é servido localmente (`/vendor/qrcode.min.js`) para funcionar offline.

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
| Build falha em `prisma migrate deploy` | `DIRECT_URL`/`DATABASE_URL` ausentes ou erradas (veja `.env.local`) |
| Erro `P1001`/timeout no log | string errada, ou compute do Neon dormindo (normal: reabra a página) |
| `Failed to fetch` ao logar | deploy ainda subindo, ou serviço parado no Render |
| Sai logado ao recarregar | `JWT_SECRET` foi regerado/removido nas env vars do Render |
| `429` no login | limite de tentativas (20/15 min por IP); reinicie o serviço no Render |
| Página sem dados | `npm run seed` não rodou (§6.3) |
