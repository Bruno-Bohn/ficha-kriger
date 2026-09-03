import crypto from 'node:crypto';

export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt:${salt.toString('hex')}:${key.toString('hex')}`);
    });
  });
}

export function verifyPassword(password, stored) {
  return new Promise(resolve => {
    const [algorithm, saltHex, keyHex] = String(stored || '').split(':');
    if (algorithm !== 'scrypt' || !saltHex || !keyHex) return resolve(false);
    const expected = Buffer.from(keyHex, 'hex');
    crypto.scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, (err, key) => {
      resolve(!err && key.length === expected.length && crypto.timingSafeEqual(key, expected));
    });
  });
}

export function signToken(user, secret, sessionHours = 24 * 7) {
  const exp = Date.now() + sessionHours * 3600_000;
  const payload = Buffer.from(JSON.stringify({ id: user.id, version: user.session_version, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return user.id && user.exp > Date.now() ? user : null;
  } catch { return null; }
}
