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
function parsePosition(raw) {
  if (raw === undefined) return { value: undefined };
  if (raw === null || raw === '') return { value: null };
  const id = Number(raw);
  if (!id || !get('SELECT id FROM positions WHERE id = ?', id)) return { error: 'Cargo inválido.' };
  return { value: id };
}

usersRouter.get('/', (_req, res) => {
  res.json(all(`
    SELECT u.id, u.name, u.email, u.role, u.color, u.created_at, u.position_id, p.name AS position_name,
           (SELECT COUNT(*) FROM task_assignees ta
              JOIN tasks t ON t.id = ta.task_id
             WHERE ta.user_id = u.id AND t.status <> 'concluida') AS open_tasks
      FROM users u LEFT JOIN positions p ON p.id = u.position_id
     ORDER BY u.role, u.name COLLATE NOCASE`));
});

usersRouter.post('/', (req, res) => {
  const { name, email, password, role = 'member', color = '#6366f1' } = req.body ?? {};
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter ao menos 6 caracteres.' });
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
  const position = parsePosition(req.body?.position_id);
  if (position.error) return res.status(400).json({ error: position.error });
  if (get('SELECT id FROM users WHERE email = ?', email.trim())) {
    return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
  }
  const info = run(
    'INSERT INTO users (name, email, password_hash, role, color, position_id) VALUES (?, ?, ?, ?, ?, ?)',
    name.trim(), email.trim(), hashPassword(password), role, color, position.value ?? null,
  );
  res.status(201).json(get(`${PUBLIC} WHERE u.id = ?`, info.lastInsertRowid));
});

usersRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = get('SELECT * FROM users WHERE id = ?', id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const { name, email, role, color, password } = req.body ?? {};
  if (role && !['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
  if (role && role !== user.role && user.role === 'admin') {
    const admins = get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").n;
    if (admins <= 1) return res.status(400).json({ error: 'É preciso manter ao menos um administrador.' });
  }
  if (email && email.trim() !== user.email) {
    if (get('SELECT id FROM users WHERE email = ? AND id <> ?', email.trim(), id)) {
      return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
    }
  }
  if (password && password.length < 6) return res.status(400).json({ error: 'A senha precisa ter ao menos 6 caracteres.' });
  const position = parsePosition(req.body?.position_id);
  if (position.error) return res.status(400).json({ error: position.error });

  run(
    `UPDATE users SET name = ?, email = ?, role = ?, color = ?, password_hash = ?, position_id = ? WHERE id = ?`,
    name?.trim() || user.name,
    email?.trim() || user.email,
    role || user.role,
    color || user.color,
    password ? hashPassword(password) : user.password_hash,
    position.value === undefined ? user.position_id : position.value,
    id,
  );
  res.json(get(`${PUBLIC} WHERE u.id = ?`, id));
});

usersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Você não pode remover a própria conta.' });
  const user = get('SELECT * FROM users WHERE id = ?', id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (user.role === 'admin' && get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").n <= 1) {
    return res.status(400).json({ error: 'É preciso manter ao menos um administrador.' });
  }
  run('DELETE FROM users WHERE id = ?', id);
  res.json({ ok: true });
});
