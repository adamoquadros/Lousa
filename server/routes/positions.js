import { Router } from 'express';
import { all, get, run } from '../db.js';
import { requireAdmin, requireAuth } from '../auth.js';

/**
 * Cargos da equipe (Lider, Revisor, Apresentador...). E so um rotulo: quem
 * pode o que continua definido pelo perfil (admin/membro) da conta.
 */
export const positionsRouter = Router();
positionsRouter.use(requireAuth);

const cleanName = (v) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');

const withCount = (where = '', ...params) => all(`
  SELECT p.id, p.name,
         (SELECT COUNT(*) FROM users u WHERE u.position_id = p.id) AS members
    FROM positions p ${where}
   ORDER BY p.name COLLATE NOCASE`, ...params);

positionsRouter.get('/', (_req, res) => res.json(withCount()));

positionsRouter.post('/', requireAdmin, (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Informe o nome do cargo.' });
  if (get('SELECT id FROM positions WHERE name = ?', name)) {
    return res.status(409).json({ error: 'Já existe um cargo com esse nome.' });
  }
  const info = run('INSERT INTO positions (name) VALUES (?)', name);
  res.status(201).json(withCount('WHERE p.id = ?', info.lastInsertRowid)[0]);
});

positionsRouter.patch('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!get('SELECT id FROM positions WHERE id = ?', id)) return res.status(404).json({ error: 'Cargo não encontrado.' });
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Informe o nome do cargo.' });
  if (get('SELECT id FROM positions WHERE name = ? AND id <> ?', name, id)) {
    return res.status(409).json({ error: 'Já existe um cargo com esse nome.' });
  }
  run('UPDATE positions SET name = ? WHERE id = ?', name, id);
  res.json(withCount('WHERE p.id = ?', id)[0]);
});

/** Quem tinha o cargo fica sem cargo (ON DELETE SET NULL); a conta nao muda. */
positionsRouter.delete('/:id', requireAdmin, (req, res) => {
  const r = run('DELETE FROM positions WHERE id = ?', Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Cargo não encontrado.' });
  res.json({ ok: true });
});
