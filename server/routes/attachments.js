import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { all, get, run } from '../db.js';
import { canManage, requireAuth } from '../auth.js';
import { MAX_FILE_BYTES, UPLOAD_DIR, isAllowedMime } from '../attachments.js';

export const attachmentsRouter = Router();
attachmentsRouter.use(requireAuth);

await mkdir(UPLOAD_DIR, { recursive: true });

const upload = multer({
  limits: { fileSize: MAX_FILE_BYTES, files: 10 },
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    // Nome aleatorio no disco: o nome original vira dado no banco, nunca caminho.
    // Isso evita path traversal e colisao entre arquivos de mesmo nome.
    filename: (_req, file, cb) => cb(null, randomUUID() + extname(file.originalname).slice(0, 10)),
  }),
  fileFilter: (_req, file, cb) => {
    if (!isAllowedMime(file.mimetype)) {
      return cb(new BadUpload(`Formato não aceito: ${file.mimetype}. Envie PDF, PNG, JPG ou WEBP.`));
    }
    return cb(null, true);
  },
});

class BadUpload extends Error {}

/** Multer devolve o nome do arquivo em latin1; o navegador manda UTF-8. */
const decodeName = (name) => Buffer.from(name, 'latin1').toString('utf8');

const shape = (a) => ({
  id: a.id,
  subject_id: a.subject_id,
  filename: a.filename,
  mime: a.mime,
  size: a.size,
  created_by: a.created_by,
  created_by_name: a.created_by_name,
  created_at: a.created_at,
});

attachmentsRouter.get('/subjects/:id/attachments', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Matéria inválida.' });
  res.json(all(`
    SELECT a.*, u.name AS created_by_name
      FROM attachments a LEFT JOIN users u ON u.id = a.created_by
     WHERE a.subject_id = ? ORDER BY a.created_at DESC`, id).map(shape));
});

attachmentsRouter.post('/subjects/:id/attachments', (req, res) => {
  const id = Number(req.params.id);
  if (!id || !get('SELECT id FROM subjects WHERE id = ?', id)) {
    return res.status(400).json({ error: 'Matéria inválida.' });
  }

  upload.array('files', 10)(req, res, async (err) => {
    if (err) {
      // Arquivos ja gravados antes do erro nao podem ficar orfaos no disco.
      await Promise.all((req.files || []).map((f) => unlink(f.path).catch(() => {})));
      if (err instanceof BadUpload) return res.status(415).json({ error: err.message });
      if (err.code === 'LIMIT_FILE_SIZE') {
        const mb = Math.round(MAX_FILE_BYTES / 1024 / 1024);
        return res.status(413).json({ error: `Arquivo grande demais. O limite é de ${mb}MB por arquivo.` });
      }
      return res.status(400).json({ error: 'Falha no envio do arquivo.' });
    }

    if (!req.files?.length) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const saved = req.files.map((f) => {
      const info = run(
        'INSERT INTO attachments (subject_id, filename, stored_as, mime, size, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        id, decodeName(f.originalname), f.filename, f.mimetype, f.size, req.user.id,
      );
      return get(`
        SELECT a.*, u.name AS created_by_name
          FROM attachments a LEFT JOIN users u ON u.id = a.created_by
         WHERE a.id = ?`, info.lastInsertRowid);
    });

    return res.status(201).json(saved.map(shape));
  });
});

/** Abre o arquivo no navegador (inline), util para conferir o que foi anexado. */
attachmentsRouter.get('/attachments/:id/file', (req, res) => {
  const a = get('SELECT * FROM attachments WHERE id = ?', Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Anexo não encontrado.' });
  res.type(a.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  return createReadStream(join(UPLOAD_DIR, a.stored_as)).pipe(res);
});

attachmentsRouter.delete('/attachments/:id', async (req, res) => {
  const a = get('SELECT * FROM attachments WHERE id = ?', Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Anexo não encontrado.' });
  if (!canManage(req.user, a)) {
    return res.status(403).json({ error: 'Somente quem enviou o arquivo ou um administrador pode removê-lo.' });
  }
  run('DELETE FROM attachments WHERE id = ?', a.id);
  await unlink(join(UPLOAD_DIR, a.stored_as)).catch(() => {});
  return res.json({ ok: true });
});
