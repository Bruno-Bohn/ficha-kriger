import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, initDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
const SESSION_HOURS = 24 * 7; // sessao vale 7 dias
const COOKIE_NAME = 'ficha_session';

if (!APP_PASSWORD || !SESSION_SECRET) {
  console.error('ERRO: defina APP_PASSWORD e SESSION_SECRET nas variaveis de ambiente.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // Render fica atras de proxy
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

/* ---------------- Sessao (token HMAC assinado, sem estado no banco) ---------------- */

function signToken() {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  const payload = String(exp);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(payload) > Date.now();
}

function requireAuth(req, res, next) {
  if (verifyToken(req.cookies[COOKIE_NAME])) return next();
  res.status(401).json({ error: 'Não autenticado' });
}

/* ---------------- Limite de tentativas de login (forca bruta) ---------------- */

const attempts = new Map(); // ip -> { count, resetAt }
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;

function rateLimit(req, res, next) {
  const ip = req.ip || 'desconhecido';
  const now = Date.now();
  let entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    attempts.set(ip, entry);
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' });
  }
  entry.count++;
  next();
}

/* ---------------- Rotas de autenticacao ---------------- */

app.post('/api/login', rateLimit, (req, res) => {
  const given = String(req.body?.password ?? '');
  const a = Buffer.from(given);
  const b = Buffer.from(APP_PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Senha incorreta' });

  res.cookie(COOKIE_NAME, signToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: SESSION_HOURS * 3600_000,
  });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authenticated: verifyToken(req.cookies[COOKIE_NAME]) });
});

/* ---------------- Rotas das fichas (todas protegidas) ---------------- */

app.get('/api/sheets', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, updated_at FROM sheets ORDER BY updated_at DESC'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/sheets', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO sheets (name, data) VALUES ('Sem nome', '{}'::jsonb) RETURNING id, name, data`
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.get('/api/sheets/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, data, updated_at FROM sheets WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Ficha não encontrada' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// PUT normal + POST para o navigator.sendBeacon (salvar ao fechar a pagina)
async function updateSheet(req, res, next) {
  try {
    const data = req.body?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ error: 'Corpo inválido' });
    }
    const name = String(data['nome'] || 'Sem nome').slice(0, 120);
    const { rows } = await pool.query(
      `UPDATE sheets SET data = $1::jsonb, name = $2, updated_at = now()
       WHERE id = $3 RETURNING id, updated_at`,
      [JSON.stringify(data), name, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Ficha não encontrada' });
    res.json({ ok: true, updated_at: rows[0].updated_at });
  } catch (e) { next(e); }
}

app.put('/api/sheets/:id', requireAuth, updateSheet);
app.post('/api/sheets/:id', requireAuth, updateSheet);

app.delete('/api/sheets/:id', requireAuth, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM sheets WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Ficha não encontrada' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------------- Estaticos + erros ---------------- */

app.use(express.static(path.join(__dirname, '..', 'public')));

// UUID invalido no path do postgres cai aqui tambem
app.use((err, req, res, next) => {
  if (err?.code === '22P02') return res.status(404).json({ error: 'Ficha não encontrada' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Ficha RPG rodando em http://localhost:${PORT}`));
  })
  .catch((e) => {
    console.error('Falha ao inicializar o banco:', e);
    process.exit(1);
  });
