import { Router } from 'express';
import { TODAY, all, get, run, tx } from '../db.js';
import { canManage, requireAdmin, requireAuth } from '../auth.js';
import { removeStoredFiles, storedFilesOf } from '../attachments.js';

export const apiRouter = Router();
apiRouter.use(requireAuth);

const trim = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const notFound = (res, message = 'Registro não encontrado.') => res.status(404).json({ error: message });
const denied = (res) => res.status(403).json({ error: 'Somente quem criou o item ou um administrador pode removê-lo.' });

/* ------------------------------------------------------------------ semestres */

apiRouter.get('/semesters', async (_req, res) => {
  res.json(await all(`
    SELECT s.*, (SELECT COUNT(*) FROM subjects WHERE semester_id = s.id) AS subject_count
      FROM semesters s
     ORDER BY s.is_current DESC, s.name DESC`));
});

apiRouter.post('/semesters', async (req, res) => {
  const name = trim(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Informe o nome do semestre (ex.: 2026.1).' });
  if (await get('SELECT id FROM semesters WHERE name = ?', name)) {
    return res.status(409).json({ error: 'Já existe um semestre com esse nome.' });
  }
  const id = await tx(async () => {
    const r = await run(
      'INSERT INTO semesters (name, starts_on, ends_on, is_current) VALUES (?, ?, ?, ?) RETURNING id',
      name, trim(req.body?.starts_on), trim(req.body?.ends_on), req.body?.is_current ? 1 : 0,
    );
    if (req.body?.is_current) await run('UPDATE semesters SET is_current = 0 WHERE id <> ?', r.lastInsertRowid);
    return r.lastInsertRowid;
  });
  res.status(201).json(await get('SELECT * FROM semesters WHERE id = ?', id));
});

apiRouter.patch('/semesters/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const current = await get('SELECT * FROM semesters WHERE id = ?', id);
  if (!current) return notFound(res, 'Semestre não encontrado.');
  const name = trim(req.body?.name) ?? current.name;
  if (name !== current.name && await get('SELECT id FROM semesters WHERE name = ?', name)) {
    return res.status(409).json({ error: 'Já existe um semestre com esse nome.' });
  }
  const isCurrent = req.body?.is_current === undefined ? current.is_current : (req.body.is_current ? 1 : 0);
  await tx(async () => {
    await run(
      'UPDATE semesters SET name = ?, starts_on = ?, ends_on = ?, is_current = ? WHERE id = ?',
      name,
      req.body?.starts_on === undefined ? current.starts_on : trim(req.body.starts_on),
      req.body?.ends_on === undefined ? current.ends_on : trim(req.body.ends_on),
      isCurrent, id,
    );
    if (isCurrent) await run('UPDATE semesters SET is_current = 0 WHERE id <> ?', id);
  });
  res.json(await get('SELECT * FROM semesters WHERE id = ?', id));
});

apiRouter.delete('/semesters/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const subjects = await all('SELECT id FROM subjects WHERE semester_id = ?', id);
  const files = await storedFilesOf(subjects.map((s) => s.id));
  const r = await run('DELETE FROM semesters WHERE id = ?', id);
  if (!r.changes) return notFound(res, 'Semestre não encontrado.');
  await removeStoredFiles(files);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------- materias */

function subjectPayload(body) {
  return {
    name: trim(body?.name),
    code: trim(body?.code),
    professor: trim(body?.professor),
    email: trim(body?.email),
    room: trim(body?.room),
    color: trim(body?.color) || '#6366f1',
    notes: trim(body?.notes),
  };
}

/** As aulas chegam junto da materia: [{ weekday, starts_at, ends_at, room }] */
async function replaceClasses(subjectId, classes) {
  await run('DELETE FROM classes WHERE subject_id = ?', subjectId);
  for (const c of classes ?? []) {
    const weekday = Number(c?.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    await run(
      'INSERT INTO classes (subject_id, weekday, starts_at, ends_at, room) VALUES (?, ?, ?, ?, ?)',
      subjectId, weekday, trim(c.starts_at), trim(c.ends_at), trim(c.room),
    );
  }
}

apiRouter.get('/subjects', async (req, res) => {
  const semesterId = Number(req.query.semester);
  if (!semesterId) return res.status(400).json({ error: 'Informe o semestre.' });
  const [subjects, classes] = await Promise.all([
    all(`
      SELECT s.*,
             (SELECT COUNT(*) FROM tasks t WHERE t.subject_id = s.id AND t.status <> 'concluida') AS open_tasks,
             (SELECT COUNT(*) FROM tasks t WHERE t.subject_id = s.id) AS total_tasks,
             (SELECT COUNT(*) FROM notes n WHERE n.subject_id = s.id) AS note_count,
             (SELECT MIN(t.due_date) FROM tasks t
               WHERE t.subject_id = s.id AND t.status <> 'concluida' AND t.due_date IS NOT NULL) AS next_due
        FROM subjects s
       WHERE s.semester_id = ?
       ORDER BY lower(s.name)`, semesterId),
    all(`
      SELECT c.* FROM classes c JOIN subjects s ON s.id = c.subject_id
       WHERE s.semester_id = ? ORDER BY c.weekday, c.starts_at`, semesterId),
  ]);
  for (const s of subjects) s.classes = classes.filter((c) => c.subject_id === s.id);
  res.json(subjects);
});

apiRouter.get('/subjects/:id', async (req, res) => {
  const id = Number(req.params.id);
  const subject = await get(`
    SELECT s.*, u.name AS created_by_name
      FROM subjects s LEFT JOIN users u ON u.id = s.created_by
     WHERE s.id = ?`, id);
  if (!subject) return notFound(res, 'Matéria não encontrada.');
  // A coluna notes guarda as observacoes da materia; os resumos vao em notes[]
  // logo abaixo, entao o texto precisa sair antes com um nome proprio.
  subject.observations = subject.notes;
  const [classes, tasks, notes] = await Promise.all([
    all('SELECT * FROM classes WHERE subject_id = ? ORDER BY weekday, starts_at', id),
    all(`
      SELECT t.*, u.name AS created_by_name
        FROM tasks t LEFT JOIN users u ON u.id = t.created_by
       WHERE t.subject_id = ?
       ORDER BY t.status = 'concluida', t.due_date IS NULL, t.due_date, t.id DESC`, id),
    all(`
      SELECT n.*, u.name AS created_by_name
        FROM notes n LEFT JOIN users u ON u.id = n.created_by
       WHERE n.subject_id = ? ORDER BY n.updated_at DESC`, id),
  ]);
  subject.classes = classes;
  subject.tasks = await withAssignees(tasks);
  subject.notes = notes;
  res.json(subject);
});

apiRouter.post('/subjects', async (req, res) => {
  const semesterId = Number(req.body?.semester_id);
  if (!semesterId || !await get('SELECT id FROM semesters WHERE id = ?', semesterId)) {
    return res.status(400).json({ error: 'Semestre inválido.' });
  }
  const data = subjectPayload(req.body);
  if (!data.name) return res.status(400).json({ error: 'Informe o nome da matéria.' });
  const id = await tx(async () => {
    const info = await run(
      `INSERT INTO subjects (semester_id, name, code, professor, email, room, color, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      semesterId, data.name, data.code, data.professor, data.email, data.room, data.color, data.notes, req.user.id,
    );
    await replaceClasses(info.lastInsertRowid, req.body?.classes);
    return info.lastInsertRowid;
  });
  res.status(201).json(await get('SELECT * FROM subjects WHERE id = ?', id));
});

apiRouter.patch('/subjects/:id', async (req, res) => {
  const id = Number(req.params.id);
  const current = await get('SELECT * FROM subjects WHERE id = ?', id);
  if (!current) return notFound(res, 'Matéria não encontrada.');
  const data = subjectPayload(req.body);
  await tx(async () => {
    await run(
      'UPDATE subjects SET name = ?, code = ?, professor = ?, email = ?, room = ?, color = ?, notes = ? WHERE id = ?',
      data.name ?? current.name, data.code, data.professor, data.email, data.room, data.color, data.notes, id,
    );
    if (Array.isArray(req.body?.classes)) await replaceClasses(id, req.body.classes);
  });
  res.json(await get('SELECT * FROM subjects WHERE id = ?', id));
});

apiRouter.delete('/subjects/:id', async (req, res) => {
  const subject = await get('SELECT * FROM subjects WHERE id = ?', Number(req.params.id));
  if (!subject) return notFound(res, 'Matéria não encontrada.');
  if (!canManage(req.user, subject)) return denied(res);
  const files = await storedFilesOf([subject.id]);
  await run('DELETE FROM subjects WHERE id = ?', subject.id);
  await removeStoredFiles(files);
  res.json({ ok: true });
});

/* -------------------------------------------------------------------- tarefas */

async function withAssignees(tasks) {
  if (!tasks.length) return tasks;
  const rows = await all(
    `SELECT ta.task_id, u.id, u.name, u.color
       FROM task_assignees ta JOIN users u ON u.id = ta.user_id
      WHERE ta.task_id = ANY(?::int[])`, tasks.map((t) => t.id));
  for (const t of tasks) {
    t.assignees = rows
      .filter((r) => r.task_id === t.id)
      .map((r) => ({ id: r.id, name: r.name, color: r.color }));
  }
  return tasks;
}

async function replaceAssignees(taskId, userIds) {
  await run('DELETE FROM task_assignees WHERE task_id = ?', taskId);
  const ids = [...new Set((userIds ?? []).map(Number).filter(Boolean))];
  if (!ids.length) return;
  // So entra quem existe: ids de contas removidas sao ignorados.
  await run(
    `INSERT INTO task_assignees (task_id, user_id)
     SELECT ?, id FROM users WHERE id = ANY(?::int[])
     ON CONFLICT DO NOTHING`, taskId, ids);
}

apiRouter.get('/tasks', async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.semester) { where.push('s.semester_id = ?'); params.push(Number(req.query.semester)); }
  if (req.query.subject) { where.push('t.subject_id = ?'); params.push(Number(req.query.subject)); }
  if (req.query.status) { where.push('t.status = ?'); params.push(String(req.query.status)); }
  if (req.query.assignee) {
    where.push('EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)');
    params.push(Number(req.query.assignee));
  }
  const tasks = await all(
    `SELECT t.*, s.name AS subject_name, s.color AS subject_color, s.semester_id, u.name AS created_by_name
       FROM tasks t
       JOIN subjects s ON s.id = t.subject_id
       LEFT JOIN users u ON u.id = t.created_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.status = 'concluida', t.due_date IS NULL, t.due_date, t.id DESC`, ...params);
  res.json(await withAssignees(tasks));
});

apiRouter.post('/tasks', async (req, res) => {
  const subjectId = Number(req.body?.subject_id);
  if (!subjectId || !await get('SELECT id FROM subjects WHERE id = ?', subjectId)) {
    return res.status(400).json({ error: 'Matéria inválida.' });
  }
  const title = trim(req.body?.title);
  if (!title) return res.status(400).json({ error: 'Informe o título da tarefa.' });
  const id = await tx(async () => {
    const info = await run(
      `INSERT INTO tasks (subject_id, title, description, kind, status, priority, due_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      subjectId, title, trim(req.body?.description),
      trim(req.body?.kind) || 'tarefa', trim(req.body?.status) || 'pendente',
      trim(req.body?.priority) || 'media', trim(req.body?.due_date), req.user.id,
    );
    await replaceAssignees(info.lastInsertRowid, req.body?.assignees);
    return info.lastInsertRowid;
  });
  res.status(201).json((await withAssignees([await get('SELECT * FROM tasks WHERE id = ?', id)]))[0]);
});

apiRouter.patch('/tasks/:id', async (req, res) => {
  const id = Number(req.params.id);
  const current = await get('SELECT * FROM tasks WHERE id = ?', id);
  if (!current) return notFound(res, 'Tarefa não encontrada.');
  const status = trim(req.body?.status) ?? current.status;
  const completedAt = status === 'concluida'
    ? (current.completed_at || new Date().toISOString())
    : null;
  await tx(async () => {
    await run(
      `UPDATE tasks SET title = ?, description = ?, kind = ?, status = ?, priority = ?, due_date = ?, completed_at = ?
        WHERE id = ?`,
      trim(req.body?.title) ?? current.title,
      req.body?.description === undefined ? current.description : trim(req.body.description),
      trim(req.body?.kind) ?? current.kind,
      status,
      trim(req.body?.priority) ?? current.priority,
      req.body?.due_date === undefined ? current.due_date : trim(req.body.due_date),
      completedAt, id,
    );
    if (Array.isArray(req.body?.assignees)) await replaceAssignees(id, req.body.assignees);
  });
  res.json((await withAssignees([await get('SELECT * FROM tasks WHERE id = ?', id)]))[0]);
});

apiRouter.delete('/tasks/:id', async (req, res) => {
  const task = await get('SELECT * FROM tasks WHERE id = ?', Number(req.params.id));
  if (!task) return notFound(res, 'Tarefa não encontrada.');
  if (!canManage(req.user, task)) return denied(res);
  await run('DELETE FROM tasks WHERE id = ?', task.id);
  res.json({ ok: true });
});

/* -------------------------------------------------------------------- resumos */

apiRouter.post('/notes', async (req, res) => {
  const subjectId = Number(req.body?.subject_id);
  if (!subjectId || !await get('SELECT id FROM subjects WHERE id = ?', subjectId)) {
    return res.status(400).json({ error: 'Matéria inválida.' });
  }
  const title = trim(req.body?.title);
  if (!title) return res.status(400).json({ error: 'Informe o título do resumo.' });
  const info = await run(
    'INSERT INTO notes (subject_id, title, content, created_by) VALUES (?, ?, ?, ?) RETURNING id',
    subjectId, title, req.body?.content ?? null, req.user.id,
  );
  res.status(201).json(await get('SELECT * FROM notes WHERE id = ?', info.lastInsertRowid));
});

apiRouter.patch('/notes/:id', async (req, res) => {
  const note = await get('SELECT * FROM notes WHERE id = ?', Number(req.params.id));
  if (!note) return notFound(res, 'Resumo não encontrado.');
  if (!canManage(req.user, note)) return denied(res);
  await run(
    'UPDATE notes SET title = ?, content = ?, updated_at = now() WHERE id = ?',
    trim(req.body?.title) ?? note.title,
    req.body?.content === undefined ? note.content : req.body.content,
    note.id,
  );
  res.json(await get('SELECT * FROM notes WHERE id = ?', note.id));
});

apiRouter.delete('/notes/:id', async (req, res) => {
  const note = await get('SELECT * FROM notes WHERE id = ?', Number(req.params.id));
  if (!note) return notFound(res, 'Resumo não encontrado.');
  if (!canManage(req.user, note)) return denied(res);
  await run('DELETE FROM notes WHERE id = ?', note.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------- panorama */

apiRouter.get('/overview', async (req, res) => {
  const semesterId = Number(req.query.semester);
  if (!semesterId) return res.status(400).json({ error: 'Informe o semestre.' });
  res.json(await get(`
    SELECT
      (SELECT COUNT(*) FROM subjects WHERE semester_id = ?) AS subjects,
      (SELECT COUNT(*) FROM tasks t JOIN subjects s ON s.id = t.subject_id
        WHERE s.semester_id = ? AND t.status <> 'concluida') AS open_tasks,
      (SELECT COUNT(*) FROM tasks t JOIN subjects s ON s.id = t.subject_id
        WHERE s.semester_id = ? AND t.status <> 'concluida'
          AND t.due_date IS NOT NULL AND t.due_date < ${TODAY}) AS late_tasks,
      (SELECT COUNT(*) FROM tasks t JOIN subjects s ON s.id = t.subject_id
        WHERE s.semester_id = ? AND t.status <> 'concluida'
          AND t.due_date BETWEEN ${TODAY} AND ${TODAY} + 7) AS week_tasks`,
    semesterId, semesterId, semesterId, semesterId));
});
