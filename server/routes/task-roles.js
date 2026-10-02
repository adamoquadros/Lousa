import { Router } from 'express';
import { all, get, run, tx } from '../db.js';
import { requireAuth, requirePermission } from '../auth.js';

const requireCargos = requirePermission('equipe.cargos');

/**
 * Funcoes que uma pessoa pode ter numa tarefa (Responsavel, Conferente, Quem
 * envia...). Qualquer membro cria uma nova direto no formulario da tarefa;
 * renomear e excluir afeta tarefas dos outros, entao fica com o admin.
 */
export const taskRolesRouter = Router();
taskRolesRouter.use(requireAuth);

const cleanName = (v) => (typeof v === 'string' ? v.trim().slice(0, 40) : '');

const withUsage = async (where = '', ...params) => all(`
  SELECT r.id, r.name,
         (SELECT COUNT(*) FROM task_assignees ta WHERE ta.role_id = r.id)
         + (SELECT COUNT(*) FROM task_everyone te WHERE te.role_id = r.id) AS uses
    FROM task_roles r ${where}
   ORDER BY r.id`, ...params);

taskRolesRouter.get('/', async (_req, res) => res.json(await withUsage()));

// Criar funcao faz parte de montar uma tarefa: basta poder editar tarefas.
taskRolesRouter.post('/', requirePermission('tarefas.editar'), async (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Informe o nome da função.' });
  const existing = await get('SELECT id FROM task_roles WHERE name = ?', name);
  // Criar uma que ja existe devolve a existente: no formulario, o efeito e o mesmo.
  if (existing) return res.json((await withUsage('WHERE r.id = ?', existing.id))[0]);
  const info = await run('INSERT INTO task_roles (name) VALUES (?) RETURNING id', name);
  res.status(201).json((await withUsage('WHERE r.id = ?', info.lastInsertRowid))[0]);
});

taskRolesRouter.patch('/:id', requireCargos, async (req, res) => {
  const id = Number(req.params.id);
  if (!await get('SELECT id FROM task_roles WHERE id = ?', id)) return res.status(404).json({ error: 'Função não encontrada.' });
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Informe o nome da função.' });
  if (await get('SELECT id FROM task_roles WHERE name = ? AND id <> ?', name, id)) {
    return res.status(409).json({ error: 'Já existe uma função com esse nome.' });
  }
  await run('UPDATE task_roles SET name = ? WHERE id = ?', name, id);
  res.json((await withUsage('WHERE r.id = ?', id))[0]);
});

/**
 * Quem tinha a funcao continua na tarefa, sem funcao. Se a pessoa ja estava
 * na mesma tarefa "sem funcao", a linha duplicada e removida antes (senao o
 * ON DELETE SET NULL bateria na regra de unicidade).
 */
taskRolesRouter.delete('/:id', requireCargos, async (req, res) => {
  const id = Number(req.params.id);
  const removed = await tx(async () => {
    await run(`
      DELETE FROM task_assignees a
       WHERE a.role_id = ?
         AND EXISTS (SELECT 1 FROM task_assignees b
                      WHERE b.task_id = a.task_id AND b.user_id = a.user_id AND b.role_id IS NULL)`, id);
    await run(`
      DELETE FROM task_everyone a
       WHERE a.role_id = ?
         AND EXISTS (SELECT 1 FROM task_everyone b WHERE b.task_id = a.task_id AND b.role_id IS NULL)`, id);
    return (await run('DELETE FROM task_roles WHERE id = ?', id)).changes;
  });
  if (!removed) return res.status(404).json({ error: 'Função não encontrada.' });
  res.json({ ok: true });
});
