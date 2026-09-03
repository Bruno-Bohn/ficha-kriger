import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, initDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
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

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt:${salt.toString('hex')}:${key.toString('hex')}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise(resolve => {
    const [algorithm, saltHex, keyHex] = String(stored || '').split(':');
    if (algorithm !== 'scrypt' || !saltHex || !keyHex) return resolve(false);
    const expected = Buffer.from(keyHex, 'hex');
    crypto.scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, (err, key) => {
      resolve(!err && key.length === expected.length && crypto.timingSafeEqual(key, expected));
    });
  });
}

function signToken(user) {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  const payload = Buffer.from(JSON.stringify({ id: user.id, username: user.username, role: user.role, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return user.id && user.exp > Date.now() ? user : null;
  } catch { return null; }
}

async function requireAuth(req, res, next) {
  const user = verifyToken(req.cookies[COOKIE_NAME]);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const { rows } = await pool.query('SELECT id, username, role FROM users WHERE id = $1 AND active = true', [user.id]);
    if (!rows[0]) return res.status(401).json({ error: 'Conta desativada ou sessão inválida' });
    req.user = rows[0];
    next();
  } catch (e) { next(e); }
}

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  res.status(403).json({ error: 'Acesso exclusivo do administrador' });
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

app.post('/api/login', rateLimit, async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const { rows } = await pool.query(
      'SELECT id, username, password_hash, role, active FROM users WHERE lower(username) = lower($1)',
      [username]
    );
    const user = rows[0];
    const ok = user?.active && await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Usuário ou senha incorretos' });

    attempts.delete(req.ip || 'desconhecido');
    res.cookie(COOKIE_NAME, signToken(user), {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: SESSION_HOURS * 3600_000,
    });
    res.json({ ok: true, user: { username: user.username, role: user.role } });
  } catch (e) { next(e); }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/session', async (req, res, next) => {
  const user = verifyToken(req.cookies[COOKIE_NAME]);
  if (!user) return res.json({ authenticated: false, user: null });
  try {
    const { rows } = await pool.query('SELECT username, role FROM users WHERE id = $1 AND active = true', [user.id]);
    const current = rows[0];
    res.json({ authenticated: !!current, user: current || null });
  } catch (e) { next(e); }
});

/* ---------------- Administração de usuários ---------------- */

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, role, active, created_at,
              (SELECT count(*)::int FROM sheets WHERE owner_id = users.id) AS sheet_count
       FROM users ORDER BY role, lower(username)`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!/^[\p{L}\p{N}._-]{3,40}$/u.test(username)) {
      return res.status(400).json({ error: 'Use de 3 a 40 letras, números, ponto, hífen ou sublinhado no usuário' });
    }
    if (password.length < 8 || password.length > 200) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres' });
    }
    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2)
       RETURNING id, username, role, active, created_at`,
      [username, passwordHash]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Esse nome de usuário já existe' });
    next(e);
  }
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id && req.body?.active === false) {
      return res.status(400).json({ error: 'Você não pode desativar a própria conta' });
    }
    const updates = [];
    const values = [];
    if (typeof req.body?.active === 'boolean') {
      values.push(req.body.active); updates.push(`active = $${values.length}`);
    }
    if (req.body?.password !== undefined) {
      const password = String(req.body.password);
      if (password.length < 8 || password.length > 200) {
        return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres' });
      }
      values.push(await hashPassword(password)); updates.push(`password_hash = $${values.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nenhuma alteração informada' });
    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = now() WHERE id = $${values.length}
       RETURNING id, username, role, active, created_at`, values
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ---------------- Rotas das fichas (todas protegidas) ---------------- */

app.get('/api/sheets', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, updated_at FROM sheets WHERE owner_id = $1 ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/sheets', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO sheets (name, data, owner_id) VALUES ('Sem nome', '{}'::jsonb, $1) RETURNING id, name, data`,
      [req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.get('/api/sheets/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, data, updated_at FROM sheets WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.user.id]
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
       WHERE id = $3 AND owner_id = $4 RETURNING id, updated_at`,
      [JSON.stringify(data), name, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Ficha não encontrada' });
    res.json({ ok: true, updated_at: rows[0].updated_at });
  } catch (e) { next(e); }
}

app.put('/api/sheets/:id', requireAuth, updateSheet);
app.post('/api/sheets/:id', requireAuth, updateSheet);

app.delete('/api/sheets/:id', requireAuth, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM sheets WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
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

async function bootstrap() {
  await initDb();
  let { rows } = await pool.query('SELECT id FROM users WHERE lower(username) = lower($1)', [ADMIN_USERNAME]);
  let adminId = rows[0]?.id;
  if (!adminId) {
    const passwordHash = await hashPassword(APP_PASSWORD);
    ({ rows } = await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id`,
      [ADMIN_USERNAME, passwordHash]
    ));
    adminId = rows[0].id;
    console.log(`Administrador inicial criado: ${ADMIN_USERNAME}`);
  }
  await pool.query('UPDATE sheets SET owner_id = $1 WHERE owner_id IS NULL', [adminId]);
}

bootstrap()
  .then(() => {
    app.listen(PORT, () => console.log(`Ficha RPG rodando em http://localhost:${PORT}`));
  })
  .catch((e) => {
    console.error('Falha ao inicializar o banco:', e);
    process.exit(1);
  });
