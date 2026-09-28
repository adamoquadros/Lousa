import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, run } from './db.js';

const SESSION_DAYS = 30;
const COOKIE = 'faculdade_sid';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * "Manter conectado" desmarcado: o cookie some quando o navegador fecha e, por
 * garantia, a sessao expira no servidor em 12 horas.
 */
const SHORT_SESSION_MS = 12 * 36e5;

export function createSession(res, userId, { remember = true } = {}) {
  const token = randomBytes(32).toString('hex');
  const ttl = remember ? SESSION_DAYS * 864e5 : SHORT_SESSION_MS;
  run(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    token,
    userId,
    new Date(Date.now() + ttl).toISOString(),
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Sem maxAge = cookie de sessao do navegador.
    ...(remember ? { maxAge: ttl } : {}),
  });
  return token;
}

export function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Popula req.user quando ha sessao valida. Nunca bloqueia. */
export function attachUser(req, _res, next) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    const row = get(
      `SELECT u.id, u.name, u.email, u.role, u.color, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
      token,
    );
    if (row && new Date(row.expires_at) > new Date()) {
      req.user = { id: row.id, name: row.name, email: row.email, role: row.role, color: row.color };
      req.sessionToken = token;
    } else if (row) {
      run('DELETE FROM sessions WHERE token = ?', token);
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores podem fazer isso.' });
  next();
}

/**
 * Admin altera/remove qualquer coisa; membro so mexe no que ele mesmo criou.
 * (Criar e editar conteudo em geral e liberado para os dois perfis.)
 */
export function canManage(user, record) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return record?.created_by === user.id;
}
