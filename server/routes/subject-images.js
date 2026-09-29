import { Router } from 'express';
import multer from 'multer';
import { get, run, tx } from '../db.js';
import { requireAuth, requirePermission } from '../auth.js';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, deleteBlobs, getBlob, putBlob } from '../storage.js';

/**
 * Imagens decorativas da materia, uma por "slot":
 *   cover    -> fundo do cartao na tela inicial (o modal fechado)
 *   backdrop -> fundo da area atras do modal aberto
 * Editar materia e liberado para qualquer membro, entao as imagens tambem sao.
 */
export const subjectImagesRouter = Router();
subjectImagesRouter.use(requireAuth);

const SLOTS = { cover: 'cover_image', backdrop: 'backdrop_image' };

// So formatos que o navegador desenha como fundo (HEIC fica de fora).
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

class BadImage extends Error {}

const upload = multer({
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => (IMAGE_TYPES.has(file.mimetype)
    ? cb(null, true)
    : cb(new BadImage('Envie uma imagem PNG, JPG ou WEBP.'))),
});

/** Resolve slot + materia; responde o erro e devolve null se algo nao bate. */
async function target(req, res) {
  const column = SLOTS[req.params.slot];
  if (!column) {
    res.status(404).json({ error: 'Tipo de imagem inválido.' });
    return null;
  }
  const subject = await get('SELECT * FROM subjects WHERE id = ?', Number(req.params.id));
  if (!subject) {
    res.status(404).json({ error: 'Matéria não encontrada.' });
    return null;
  }
  return { column, subject };
}

subjectImagesRouter.get('/subjects/:id/images/:slot', async (req, res) => {
  const t = await target(req, res);
  if (!t) return;
  const key = t.subject[t.column];
  const blob = key && await getBlob(key);
  if (!blob) return res.status(404).json({ error: 'Imagem não encontrada.' });
  // A URL do cliente leva ?v=<chave>: trocar a imagem muda a URL, entao o
  // cache pode ser longo sem servir versao velha.
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(blob.mime);
  return res.send(blob.data);
});

subjectImagesRouter.put('/subjects/:id/images/:slot', requirePermission('materias.editar'), async (req, res, next) => {
  const t = await target(req, res);
  if (!t) return;

  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof BadImage) return res.status(415).json({ error: err.message });
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Imagem grande demais. O limite é de ${MAX_UPLOAD_MB}MB.` });
      }
      return res.status(400).json({ error: 'Falha no envio da imagem.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });

    try {
      // Imagem nova entra e a antiga sai juntas.
      const key = await tx(async () => {
        const newKey = await putBlob(req.file.buffer, req.file.mimetype);
        await run(`UPDATE subjects SET ${t.column} = ? WHERE id = ?`, newKey, t.subject.id);
        await deleteBlobs([t.subject[t.column]]);
        return newKey;
      });
      return res.json({ [t.column]: key });
    } catch (dbErr) {
      return next(dbErr);
    }
  });
});

subjectImagesRouter.delete('/subjects/:id/images/:slot', requirePermission('materias.editar'), async (req, res) => {
  const t = await target(req, res);
  if (!t) return;
  await tx(async () => {
    await run(`UPDATE subjects SET ${t.column} = NULL WHERE id = ?`, t.subject.id);
    await deleteBlobs([t.subject[t.column]]);
  });
  return res.json({ ok: true });
});
