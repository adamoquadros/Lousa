import { Router } from 'express';
import { all, get, run } from '../db.js';
import { createSession, destroySession, hashPassword, loadUser, requireAuth, verifyPassword } from '../auth.js';

export const authRouter = Router();


async function countUsers() {
  return (await get('SELECT COUNT(*) AS n FROM users')).n;
}

/** O app ainda nao tem nenhuma conta? Entao a primeira criada vira admin. */
authRouter.get('/status', async (req, res) => {
  res.json({ needsSetup: (await countUsers()) === 0, user: req.user ?? null });
});

authRouter.post('/setup', async (req, res) => {
  if (await countUsers() > 0) return res.status(409).json({ error: 'O sistema já foi configurado.' });
  const { name, email, password } = req.body ?? {};
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter ao menos 6 caracteres.' });

  const info = await run(
    `INSERT INTO users (name, email, password_hash, role, profile_id)
     VALUES (?, ?, ?, ?, (SELECT id FROM profiles WHERE key = 'admin')) RETURNING id`,
    name.trim(),
    email.trim(),
    hashPassword(password),
    'admin',
  );
  const user = await get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);
  await createSession(res, user.id);
  res.status(201).json({ user: await loadUser(user.id) });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await get('SELECT * FROM users WHERE email = ?', String(email || '').trim());
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }
  await createSession(res, user.id, { remember: req.body?.remember !== false });
  res.json({ user: await loadUser(user.id) });
});

authRouter.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/** Cada pessoa edita o proprio nome, e-mail e cor. Perfil e cargo ficam com o admin. */
authRouter.patch('/me', requireAuth, async (req, res) => {
  const user = await get('SELECT * FROM users WHERE id = ?', req.user.id);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const color = typeof req.body?.color === 'string' ? req.body.color.trim() : '';
  if (!name || !email) return res.status(400).json({ error: 'Nome e e-mail são obrigatórios.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (await get('SELECT id FROM users WHERE email = ? AND id <> ?', email, user.id)) {
    return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
  }
  await run('UPDATE users SET name = ?, email = ?, color = ? WHERE id = ?', name, email, color || user.color, user.id);
  res.json({ user: await loadUser(user.id) });
});

authRouter.post('/password', requireAuth, async (req, res) => {
  const { current, next } = req.body ?? {};
  if (!next || next.length < 6) return res.status(400).json({ error: 'A nova senha precisa ter ao menos 6 caracteres.' });
  const user = await get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(String(current || ''), user.password_hash)) {
    return res.status(400).json({ error: 'Senha atual incorreta.' });
  }
  await run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
  res.json({ ok: true });
});

/** Qualquer pessoa logada precisa da lista da equipe para eleger responsaveis. */
authRouter.get('/team', requireAuth, async (_req, res) => {
  res.json(await all(`
    SELECT u.id, u.name, u.email, u.color, u.position_id, p.name AS position_name,
           pr.id AS profile_id, pr.name AS profile_name, pr.key AS profile_key, COALESCE(pr.level, 2147483647) AS profile_level
      FROM users u
      LEFT JOIN positions p ON p.id = u.position_id
      LEFT JOIN profiles pr ON pr.id = COALESCE(u.profile_id,
      (SELECT id FROM profiles WHERE key = CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'member' END))
     ORDER BY profile_level, lower(u.name)`));
});
