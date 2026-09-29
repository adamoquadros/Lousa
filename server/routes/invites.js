import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { all, get, run, tx } from '../db.js';
import { createSession, hashPassword, loadUser, outranks, requirePermission } from '../auth.js';
import { grantableProfile, roleFor } from './users.js';

const requireInvite = requirePermission('equipe.convidar');
import { isMailEnabled, sendInviteEmail } from '../mailer.js';

/**
 * Convites por e-mail. O admin informa o endereco (e, se quiser, perfil e
 * cargo); a pessoa recebe um link de uso unico e cria a propria conta com
 * nome e senha. Rotas /token/* sao publicas: quem abre o link ainda nao tem conta.
 */
export const invitesRouter = Router();

const INVITE_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/** Base do link: APP_URL do .env ou, sem ela, o endereco que o admin esta usando. */
function baseUrl(req) {
  return (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).trim().replace(/\/+$/, '');
}

/** localhost so abre no computador que roda o app: o convidado nao chegaria. */
function isLocalOnly(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || hostname.startsWith('127.');
  } catch { return true; }
}

const SELECT = `
  SELECT i.id, i.email, i.role, i.position_id, p.name AS position_name,
         pr.id AS profile_id, pr.name AS profile_name, pr.key AS profile_key,
         COALESCE(pr.level, 2147483647) AS profile_level,
         u.name AS invited_by_name, i.created_at, i.expires_at, i.accepted_at
    FROM invites i
    LEFT JOIN positions p ON p.id = i.position_id
    LEFT JOIN profiles pr ON pr.id = COALESCE(i.profile_id,
      (SELECT id FROM profiles WHERE key = CASE WHEN i.role = 'admin' THEN 'admin' ELSE 'member' END))
    LEFT JOIN users u ON u.id = i.invited_by`;

const shape = (i) => ({ ...i, expired: new Date(i.expires_at) <= new Date() });

function settings(req) {
  const base = baseUrl(req);
  return { mail_enabled: isMailEnabled(), base_url: base, base_is_local: isLocalOnly(base) };
}

/** Grava um token novo no convite e tenta mandar o e-mail. Nunca lanca. */
async function deliver(req, inviteId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
  await run('UPDATE invites SET token_hash = ?, expires_at = ? WHERE id = ?', hashToken(token), expiresAt, inviteId);

  const invite = await get(`${SELECT} WHERE i.id = ?`, inviteId);
  const link = `${baseUrl(req)}/?convite=${token}`;
  const result = { invite: shape(invite), link, emailed: false, email_error: null, ...settings(req) };
  if (!result.mail_enabled) return result;

  try {
    await sendInviteEmail({
      to: invite.email,
      link,
      inviterName: req.user.name,
      positionName: invite.position_name,
      expiresAt,
    });
    result.emailed = true;
  } catch (err) {
    console.error('Falha ao enviar convite:', err);
    result.email_error = `O servidor de e-mail recusou o envio (${err.message}).`;
  }
  return result;
}

/* ------------------------------------------------------------ admin */

invitesRouter.get('/', requireInvite, async (req, res) => {
  res.json({
    ...settings(req),
    invites: (await all(`${SELECT} WHERE i.accepted_at IS NULL ORDER BY i.created_at DESC`)).map(shape),
  });
});

invitesRouter.post('/', requireInvite, async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (await get('SELECT id FROM users WHERE email = ?', email)) {
    return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
  }
  // Sem perfil escolhido, entra como Membro - desde que quem convida esteja acima dele.
  const member = await get("SELECT id FROM profiles WHERE key = 'member'");
  const grant = await grantableProfile(req.user, req.body?.profile_id || member?.id);
  if (grant.error) return res.status(403).json({ error: grant.error });
  const rawPosition = req.body?.position_id;
  const positionId = rawPosition === null || rawPosition === undefined || rawPosition === '' ? null : Number(rawPosition);
  if (positionId !== null && !await get('SELECT id FROM positions WHERE id = ?', positionId)) {
    return res.status(400).json({ error: 'Cargo inválido.' });
  }

  // Um convite pendente por e-mail: convidar de novo substitui o anterior
  // (e invalida o link antigo).
  const id = await tx(async () => {
    await run('DELETE FROM invites WHERE email = ? AND accepted_at IS NULL', email);
    const info = await run(
      `INSERT INTO invites (email, token_hash, role, profile_id, position_id, invited_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, now()) RETURNING id`,
      email, `pendente-${randomBytes(8).toString('hex')}`, roleFor(grant.profile), grant.profile.id, positionId, req.user.id,
    );
    return info.lastInsertRowid;
  });

  res.status(201).json(await deliver(req, id));
});

/** Gera um link novo (o antigo deixa de valer) e reenvia. */
/** Convite para um perfil no nivel de quem pede (ou acima) nao e dele para mexer. */
const OUT_OF_REACH = 'Esse convite é para um perfil no seu nível ou acima dele na hierarquia.';

invitesRouter.post('/:id/resend', requireInvite, async (req, res) => {
  const invite = await get(`${SELECT} WHERE i.id = ? AND i.accepted_at IS NULL`, Number(req.params.id));
  if (!invite) return res.status(404).json({ error: 'Convite não encontrado.' });
  if (!outranks(req.user, invite.profile_level)) return res.status(403).json({ error: OUT_OF_REACH });
  res.json(await deliver(req, invite.id));
});

invitesRouter.delete('/:id', requireInvite, async (req, res) => {
  const invite = await get(`${SELECT} WHERE i.id = ? AND i.accepted_at IS NULL`, Number(req.params.id));
  if (invite && !outranks(req.user, invite.profile_level)) return res.status(403).json({ error: OUT_OF_REACH });
  const r = await run('DELETE FROM invites WHERE id = ? AND accepted_at IS NULL', Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Convite não encontrado.' });
  res.json({ ok: true });
});

/* ------------------------------------------------------------ publico (quem recebeu) */

async function findValid(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const invite = await get(`${SELECT} WHERE i.token_hash = ?`, hashToken(token));
  if (!invite || invite.accepted_at || new Date(invite.expires_at) <= new Date()) return null;
  return invite;
}

const INVALID = 'Este convite não vale mais: já foi usado, expirou ou foi cancelado. Peça um novo a quem convidou você.';

invitesRouter.get('/token/:token', async (req, res) => {
  const invite = await findValid(req.params.token);
  if (!invite) return res.status(404).json({ error: INVALID });
  res.json({
    email: invite.email,
    invited_by_name: invite.invited_by_name,
    position_name: invite.position_name,
    profile_name: invite.profile_name,
    expires_at: invite.expires_at,
  });
});

invitesRouter.post('/token/:token/accept', async (req, res) => {
  const invite = await findValid(req.params.token);
  if (!invite) return res.status(404).json({ error: INVALID });
  const name = String(req.body?.name ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!name) return res.status(400).json({ error: 'Informe seu nome.' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter ao menos 6 caracteres.' });
  if (await get('SELECT id FROM users WHERE email = ?', invite.email)) {
    return res.status(409).json({ error: 'Já existe uma conta com esse e-mail. Entre com a sua senha.' });
  }

  const userId = await tx(async () => {
    // O WHERE accepted_at IS NULL impede que dois cliques rapidos criem duas contas.
    const claimed = await run('UPDATE invites SET accepted_at = now() WHERE id = ? AND accepted_at IS NULL', invite.id);
    if (!claimed.changes) return null;
    const info = await run(
      'INSERT INTO users (name, email, password_hash, role, profile_id, position_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      name, invite.email, hashPassword(password), roleFor({ key: invite.profile_key }), invite.profile_id, invite.position_id,
    );
    return info.lastInsertRowid;
  });
  if (!userId) return res.status(404).json({ error: INVALID });

  await createSession(res, userId);
  res.status(201).json({ user: await loadUser(userId) });
});
