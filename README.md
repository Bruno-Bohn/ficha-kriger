# Ficha de Personagem — RPG

Versão web da ficha de personagem (PDF), com:

- **Tela de login com senha fixa** (sem usuário) — a senha fica na variável de ambiente `APP_PASSWORD`
- **Múltiplas fichas** salvas no banco (lista, criar, excluir)
- **Salvamento automático** enquanto você digita
- **Layout responsivo** — otimizado para celular (abas, 1 coluna) e desktop (grade)
- 4 abas espelhando as 4 páginas do PDF: **Ficha** (atributos, PV/PM, pontos de alma, defesas, testes contra a morte, ataques, perícias), **Inventário & Detalhes**, **Habilidades do Caminho**, **Magias**
- Totais de perícia calculados automaticamente (Ante. + Treino + Est/Atr) — pode desligar no topo da ficha

## Stack

| Camada   | Tecnologia                          |
| -------- | ----------------------------------- |
| Backend  | Node.js 20 + Express                |
| Banco    | PostgreSQL no [Neon](https://neon.tech) (dados da ficha em JSONB) |
| Hosting  | [Render](https://render.com) (web service) |
| Frontend | HTML/CSS/JS puro (sem framework)    |

## Rodando localmente

1. Instale o [Node.js 20+](https://nodejs.org)
2. Copie `.env.example` para `.env` e preencha (ou exporte as variáveis no terminal):
   - `DATABASE_URL` — connection string do Neon
   - `APP_PASSWORD` — a senha da tela de login
   - `SESSION_SECRET` — qualquer string longa aleatória
3. Instale e rode:

```powershell
npm install
# PowerShell: carregar variaveis e iniciar
$env:DATABASE_URL="postgresql://..."; $env:APP_PASSWORD="minha-senha"; $env:SESSION_SECRET="string-aleatoria-longa"; npm start
```

Abra http://localhost:3000

> O servidor cria a tabela `sheets` sozinho na primeira execução.

## Passo a passo do deploy

### 1. Banco — Neon

1. Crie uma conta em https://neon.tech (plano free serve)
2. Crie um projeto (região `sa-east-1 / São Paulo` se disponível, para menor latência)
3. No dashboard, copie a **Connection string** (algo como `postgresql://usuario:senha@ep-xxxx.aws.neon.tech/neondb?sslmode=require`)

### 2. Código — GitHub

O Render faz deploy a partir de um repositório Git:

```powershell
git init
git add .
git commit -m "Ficha RPG web"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/ficha-rpg.git
git push -u origin main
```

### 3. Hosting — Render

**Opção A (recomendada — usa o `render.yaml`):**
1. Em https://dashboard.render.com clique **New → Blueprint**
2. Conecte o repositório — o Render lê o `render.yaml` e cria o serviço
3. Quando pedir, preencha:
   - `DATABASE_URL` = connection string do Neon
   - `APP_PASSWORD` = a senha que você quer na tela de login
   - (`SESSION_SECRET` é gerado automaticamente)

**Opção B (manual):**
1. **New → Web Service**, conecte o repositório
2. Runtime **Node**, Build `npm ci`, Start `npm start`, plano **Free**
3. Em **Environment**, adicione `DATABASE_URL`, `APP_PASSWORD` e `SESSION_SECRET`

Pronto — o Render entrega uma URL `https://ficha-rpg-xxxx.onrender.com`.

> **Nota do plano free do Render:** o serviço "dorme" após ~15 min sem uso; o primeiro acesso depois disso demora ~30–60 s para acordar. Os dados ficam seguros no Neon.

## Segurança

- Senha comparada com `timingSafeEqual` + limite de 10 tentativas / 15 min por IP
- Sessão em cookie `httpOnly` assinado (HMAC), validade de 7 dias
- Toda a API de fichas exige sessão válida; a senha nunca vai para o frontend

## Estrutura

```
├── src/
│   ├── server.js    # Express: login, sessão, API de fichas, estáticos
│   └── db.js        # Pool do Postgres (Neon) + criação da tabela
├── public/
│   ├── index.html   # SPA: login, lista de fichas, ficha em 4 abas
│   ├── css/styles.css
│   └── js/app.js    # binding dos campos, autosave, abas, totais
├── render.yaml      # Blueprint do Render
└── .env.example
```
