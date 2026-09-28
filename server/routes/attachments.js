import { Router } from 'express';
import multer from 'multer';
import { all, get, run, tx } from '../db.js';
import { canManage, requireAuth } from '../auth.js';
import { MAX_FILE_BYTES, isAllowedMime } from '../attachments.js';
import { MAX_UPLOAD_MB, deleteBlobs, getBlob, putBlob } from '../storage.js';

export const attachmentsRouter = Router();
attachmentsRouter.use(requireAuth);

// Em memoria: o conteudo vai direto para o banco (tabela blobs), sem disco.
// Um arquivo por requisicao, por causa do limite de corpo da Vercel.
const upload = multer({
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  storage: multer.memoryStorage(),
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

const SELECT = `
  SELECT a.*, u.name AS created_by_name
    FROM attachments a LEFT JOIN users u ON u.id = a.created_by`;

attachmentsRouter.get('/subjects/:id/attachments', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Matéria inválida.' });
  res.json((await all(`${SELECT} WHERE a.subject_id = ? ORDER BY a.created_at DESC`, id)).map(shape));
});

attachmentsRouter.post('/subjects/:id/attachments', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!id || !await get('SELECT id FROM subjects WHERE id = ?', id)) {
    return res.status(400).json({ error: 'Matéria inválida.' });
  }

  upload.array('files', 1)(req, res, async (err) => {
    if (err) {
      if (err instanceof BadUpload) return res.status(415).json({ error: err.message });
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Arquivo grande demais. O limite é de ${MAX_UPLOAD_MB}MB por arquivo.` });
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Envie um arquivo por vez.' });
      }
      return res.status(400).json({ error: 'Falha no envio do arquivo.' });
    }

    const file = req.files?.[0];
    if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    try {
      // Conteudo e registro gravam juntos: nao sobra blob sem anexo nem o contrario.
      const attachmentId = await tx(async () => {
        const key = await putBlob(file.buffer, file.mimetype);
        const info = await run(
          'INSERT INTO attachments (subject_id, filename, stored_as, mime, size, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
          id, decodeName(file.originalname), key, file.mimetype, file.size, req.user.id,
        );
        return info.lastInsertRowid;
      });
      return res.status(201).json([shape(await get(`${SELECT} WHERE a.id = ?`, attachmentId))]);
    } catch (dbErr) {
      return next(dbErr);
    }
  });
});

/** Abre o arquivo no navegador (inline), util para conferir o que foi anexado. */
attachmentsRouter.get('/attachments/:id/file', async (req, res) => {
  const a = await get('SELECT * FROM attachments WHERE id = ?', Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Anexo não encontrado.' });
  const blob = await getBlob(a.stored_as);
  if (!blob) return res.status(404).json({ error: 'O conteúdo deste anexo não está mais disponível.' });
  res.type(a.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(blob.data);
});

attachmentsRouter.delete('/attachments/:id', async (req, res) => {
  const a = await get('SELECT * FROM attachments WHERE id = ?', Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Anexo não encontrado.' });
  if (!canManage(req.user, a)) {
    return res.status(403).json({ error: 'Somente quem enviou o arquivo ou um administrador pode removê-lo.' });
  }
  await tx(async () => {
    await run('DELETE FROM attachments WHERE id = ?', a.id);
    await deleteBlobs([a.stored_as]);
  });
  return res.json({ ok: true });
});
