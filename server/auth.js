import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, run } from './db.js';
import { ALL_PERMISSIONS } from './permissions.js';

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

export async function createSession(res, userId, { remember = true } = {}) {
  const token = randomBytes(32).toString('hex');
  const ttl = remember ? SESSION_DAYS * 864e5 : SHORT_SESSION_MS;
  await run(
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

export async function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) await run('DELETE FROM sessions WHERE token = ?', token);
  res.clearCookie(COOKIE, { path: '/' });
}

/* ------------------------------------------------------------ perfil e direitos */

const USER_SELECT = `
  SELECT u.id, u.name, u.email, u.color, p.id AS profile_id,
         p.key AS profile_key, p.name AS profile_name, p.level, p.permissions
    FROM users u
    LEFT JOIN profiles p ON p.id = COALESCE(u.profile_id,
      (SELECT id FROM profiles WHERE key = CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'member' END))`;

/**
 * Formato de usuario que o app usa (sessao, login, /status). O Administrador
 * tem sempre todos os direitos - inclusive os que forem criados depois.
 * Sem perfil (so por inconsistencia) a pessoa nao tem direito nenhum.
 */
export function shapeUser(row) {
  const isAdmin = row.profile_key === 'admin';
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    color: row.color,
    profile_id: row.profile_id,
    profile_name: row.profile_name ?? 'Sem perfil',
    level: row.level ?? Number.MAX_SAFE_INTEGER,
    is_admin: isAdmin,
    // Compatibilidade: partes antigas do app ainda leem role.
    role: isAdmin ? 'admin' : 'member',
    permissions: isAdmin ? ALL_PERMISSIONS : (row.permissions ?? []),
  };
}

export async function loadUser(id) {
  const row = await get(`${USER_SELECT} WHERE u.id = ?`, id);
  return row ? shapeUser(row) : null;
}

export const can = (user, permission) => Boolean(user?.permissions?.includes(permission));

/**
 * Hierarquia: o Administrador esta acima de todos (inclusive de outros
 * administradores); os demais so "mandam" em quem tem nivel MAIOR que o seu
 * (nivel 1 manda no 2, nunca no 1 nem no 0).
 */
export const outranks = (user, level) => Boolean(user) && (user.is_admin || user.level < level);

/**
 * Popula req.user quando ha sessao valida. So consulta o banco para /api:
 * arquivos estaticos (CSS, JS) nao precisam saber quem esta logado.
 */
export async function attachUser(req, _res, next) {
  const token = parseCookies(req)[COOKIE];
  if (!token || !req.path.startsWith('/api/')) return next();
  try {
    const row = await get(
      `SELECT s.expires_at, s.user_id FROM sessions s WHERE s.token = ?`,
      token,
    );
    if (row && new Date(row.expires_at) > new Date()) {
      req.user = await loadUser(row.user_id);
      req.sessionToken = token;
    } else if (row) {
      await run('DELETE FROM sessions WHERE token = ?', token);
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  next();
}

/** Middleware: a rota exige o direito. Resposta 403 explica qual falta. */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
    if (!can(req.user, permission)) {
      return res.status(403).json({ error: 'Seu perfil não tem permissão para fazer isso.' });
    }
    next();
  };
}

/**
 * Mexer num item existente: quem criou sempre pode; os outros precisam do
 * direito "... de outras pessoas" daquele tipo (ex.: tarefas.excluir).
 */
export function canManage(user, record, permission) {
  if (!user) return false;
  return record?.created_by === user.id || can(user, permission);
}
