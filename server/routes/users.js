import { Router } from 'express';
import { all, get, run } from '../db.js';
import { hashPassword, outranks, requirePermission } from '../auth.js';

/**
 * Gestao de contas. Exige o direito equipe.gerenciar e respeita a hierarquia:
 * so se mexe em quem esta abaixo (outranks) e so se da perfil abaixo do seu.
 */
export const usersRouter = Router();

usersRouter.use(requirePermission('equipe.gerenciar'));

const SELECT = `
  SELECT u.id, u.name, u.email, u.color, u.created_at,
         u.position_id, p.name AS position_name,
         pr.id AS profile_id, pr.name AS profile_name, pr.key AS profile_key,
         COALESCE(pr.level, 2147483647) AS profile_level
    FROM users u
    LEFT JOIN positions p ON p.id = u.position_id
    LEFT JOIN profiles pr ON pr.id = COALESCE(u.profile_id,
      (SELECT id FROM profiles WHERE key = CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'member' END))`;

/** Cargo vindo do formulario: undefined = nao mexe, ''/null = sem cargo. */
async function parsePosition(raw) {
  if (raw === undefined) return { value: undefined };
  if (raw === null || raw === '') return { value: null };
  const id = Number(raw);
  if (!id || !await get('SELECT id FROM positions WHERE id = ?', id)) return { error: 'Cargo inválido.' };
  return { value: id };
}

/** Perfil que `user` pode conceder: existe e fica abaixo dele (Administrador: qualquer um). */
export async function grantableProfile(user, raw) {
  const profile = Number(raw) ? await get('SELECT * FROM profiles WHERE id = ?', Number(raw)) : null;
  if (!profile) return { error: 'Perfil inválido.' };
  if (!outranks(user, profile.level)) {
    return { error: 'Você só pode dar perfis que estão abaixo do seu na hierarquia.' };
  }
  return { profile };
}

/** role acompanha o perfil, para versoes antigas do app que so leem role. */
export const roleFor = (profile) => (profile?.key === 'admin' ? 'admin' : 'member');

const countAdmins = async () => (await get(`
  SELECT COUNT(*) AS n FROM users u JOIN profiles p ON p.id = u.profile_id WHERE p.key = 'admin'`)).n;

const LAST_ADMIN = 'É preciso manter ao menos uma pessoa com o perfil Administrador.';
const OUT_OF_REACH = 'Essa pessoa está no seu nível ou acima dele na hierarquia.';

usersRouter.get('/', async (req, res) => {
  const rows = await all(`
    SELECT x.*,
           (SELECT COUNT(*) FROM tasks t
             WHERE t.status <> 'concluida'
               AND (EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = x.id)
                    OR EXISTS (SELECT 1 FROM task_everyone te WHERE te.task_id = t.id))) AS open_tasks
      FROM (${SELECT}) x
     ORDER BY x.profile_level, lower(x.name)`);
  // A tela usa isto para mostrar (ou esconder) Editar/Remover em cada linha.
  res.json(rows.map((u) => ({ ...u, manageable: u.id !== req.user.id && outranks(req.user, u.profile_level) })));
});

usersRouter.post('/', async (req, res) => {
  const { name, email, password, color = '#6366f1' } = req.body ?? {};
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter ao menos 6 caracteres.' });
  const member = await get("SELECT id FROM profiles WHERE key = 'member'");
  const grant = await grantableProfile(req.user, req.body?.profile_id ?? member?.id);
  if (grant.error) return res.status(403).json({ error: grant.error });
  const position = await parsePosition(req.body?.position_id);
  if (position.error) return res.status(400).json({ error: position.error });
  if (await get('SELECT id FROM users WHERE email = ?', email.trim())) {
    return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
  }
  const info = await run(
    `INSERT INTO users (name, email, password_hash, role, profile_id, color, position_id)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    name.trim(), email.trim(), hashPassword(password), roleFor(grant.profile), grant.profile.id, color, position.value ?? null,
  );
  res.status(201).json(await get(`${SELECT} WHERE u.id = ?`, info.lastInsertRowid));
});

usersRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = await get(`${SELECT} WHERE u.id = ?`, id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const self = id === req.user.id;
  // Na propria conta vale editar dados, nunca o proprio perfil (senao
  // qualquer um com equipe.gerenciar se promoveria).
  if (!self && !outranks(req.user, user.profile_level)) return res.status(403).json({ error: OUT_OF_REACH });

  const { name, email, color, password } = req.body ?? {};
  let profile = null;
  if (req.body?.profile_id !== undefined && Number(req.body.profile_id) !== user.profile_id) {
    if (self) return res.status(403).json({ error: 'Você não pode mudar o seu próprio perfil.' });
    const grant = await grantableProfile(req.user, req.body.profile_id);
    if (grant.error) return res.status(403).json({ error: grant.error });
    if (user.profile_key === 'admin' && grant.profile.key !== 'admin' && await countAdmins() <= 1) {
      return res.status(400).json({ error: LAST_ADMIN });
    }
    profile = grant.profile;
  }
  if (email && email.trim() !== user.email) {
    if (await get('SELECT id FROM users WHERE email = ? AND id <> ?', email.trim(), id)) {
      return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
    }
  }
  if (password && password.length < 6) return res.status(400).json({ error: 'A senha precisa ter ao menos 6 caracteres.' });
  const position = await parsePosition(req.body?.position_id);
  if (position.error) return res.status(400).json({ error: position.error });

  const current = await get('SELECT password_hash FROM users WHERE id = ?', id);
  await run(
    `UPDATE users SET name = ?, email = ?, color = ?, password_hash = ?, position_id = ?,
                      profile_id = ?, role = ?
      WHERE id = ?`,
    name?.trim() || user.name,
    email?.trim() || user.email,
    color || user.color,
    password ? hashPassword(password) : current.password_hash,
    position.value === undefined ? user.position_id : position.value,
    profile ? profile.id : user.profile_id,
    profile ? roleFor(profile) : roleFor({ key: user.profile_key }),
    id,
  );
  res.json(await get(`${SELECT} WHERE u.id = ?`, id));
});

usersRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Você não pode remover a própria conta.' });
  const user = await get(`${SELECT} WHERE u.id = ?`, id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (!outranks(req.user, user.profile_level)) return res.status(403).json({ error: OUT_OF_REACH });
  if (user.profile_key === 'admin' && await countAdmins() <= 1) {
    return res.status(400).json({ error: LAST_ADMIN });
  }
  await run('DELETE FROM users WHERE id = ?', id);
  res.json({ ok: true });
});
