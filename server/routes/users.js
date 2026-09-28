import { Router } from 'express';
import { all, get, run } from '../db.js';
import { hashPassword, requireAdmin } from '../auth.js';

export const usersRouter = Router();

usersRouter.use(requireAdmin);

const PUBLIC = `SELECT u.id, u.name, u.email, u.role, u.color, u.position_id, p.name AS position_name
                  FROM users u LEFT JOIN positions p ON p.id = u.position_id`;

/**
 * Cargo vindo do formulario: undefined = nao mexe, ''/null = sem cargo.
 * Devolve { error } quando o id nao existe.
 */
async function parsePosition(raw) {
  if (raw === undefined) return { value: undefined };
  if (raw === null || raw === '') return { value: null };
  const id = Number(raw);
  if (!id || !await get('SELECT id FROM positions WHERE id = ?', id)) return { error: 'Cargo inválido.' };
  return { value: id };
}

usersRouter.get('/', async (_req, res) => {
  res.json(await all(`
    SELECT u.id, u.name, u.email, u.role, u.color, u.created_at, u.position_id, p.name AS position_name,
           (SELECT COUNT(*) FROM task_assignees ta
              JOIN tasks t ON t.id = ta.task_id
             WHERE ta.user_id = u.id AND t.status <> 'concluida') AS open_tasks
      FROM users u LEFT JOIN positions p ON p.id = u.position_id
     ORDER BY u.role, lower(u.name)`));
});

usersRouter.post('/', async (req, res) => {
  const { name, email, password, role = 'member', color = '#6366f1' } = req.body ?? {};
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter ao menos 6 caracteres.' });
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
  const position = await parsePosition(req.body?.position_id);
  if (position.error) return res.status(400).json({ error: position.error });
  if (await get('SELECT id FROM users WHERE email = ?', email.trim())) {
    return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
  }
  const info = await run(
    'INSERT INTO users (name, email, password_hash, role, color, position_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    name.trim(), email.trim(), hashPassword(password), role, color, position.value ?? null,
  );
  res.status(201).json(await get(`${PUBLIC} WHERE u.id = ?`, info.lastInsertRowid));
});

usersRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = await get('SELECT * FROM users WHERE id = ?', id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const { name, email, role, color, password } = req.body ?? {};
  if (role && !['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
  if (role && role !== user.role && user.role === 'admin') {
    const admins = (await get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")).n;
    if (admins <= 1) return res.status(400).json({ error: 'É preciso manter ao menos um administrador.' });
  }
  if (email && email.trim() !== user.email) {
    if (await get('SELECT id FROM users WHERE email = ? AND id <> ?', email.trim(), id)) {
      return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
    }
  }
  if (password && password.length < 6) return res.status(400).json({ error: 'A senha precisa ter ao menos 6 caracteres.' });
  const position = await parsePosition(req.body?.position_id);
  if (position.error) return res.status(400).json({ error: position.error });

  await run(
    `UPDATE users SET name = ?, email = ?, role = ?, color = ?, password_hash = ?, position_id = ? WHERE id = ?`,
    name?.trim() || user.name,
    email?.trim() || user.email,
    role || user.role,
    color || user.color,
    password ? hashPassword(password) : user.password_hash,
    position.value === undefined ? user.position_id : position.value,
    id,
  );
  res.json(await get(`${PUBLIC} WHERE u.id = ?`, id));
});

usersRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Você não pode remover a própria conta.' });
  const user = await get('SELECT * FROM users WHERE id = ?', id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (user.role === 'admin' && (await get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")).n <= 1) {
    return res.status(400).json({ error: 'É preciso manter ao menos um administrador.' });
  }
  await run('DELETE FROM users WHERE id = ?', id);
  res.json({ ok: true });
});
