import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { UPLOAD_DIR, removeStoredFiles } from '../attachments.js';

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
// A extensao sai do tipo, nunca do nome enviado.
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

class BadImage extends Error {}

const upload = multer({
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, randomUUID() + EXT[file.mimetype]),
  }),
  fileFilter: (_req, file, cb) => (EXT[file.mimetype]
    ? cb(null, true)
    : cb(new BadImage('Envie uma imagem PNG, JPG ou WEBP.'))),
});

/** Resolve slot + materia; responde o erro e devolve null se algo nao bate. */
function target(req, res) {
  const column = SLOTS[req.params.slot];
  if (!column) {
    res.status(404).json({ error: 'Tipo de imagem inválido.' });
    return null;
  }
  const subject = get('SELECT * FROM subjects WHERE id = ?', Number(req.params.id));
  if (!subject) {
    res.status(404).json({ error: 'Matéria não encontrada.' });
    return null;
  }
  return { column, subject };
}

subjectImagesRouter.get('/subjects/:id/images/:slot', (req, res) => {
  const t = target(req, res);
  if (!t) return;
  const file = t.subject[t.column];
  if (!file) return res.status(404).json({ error: 'Imagem não encontrada.' });
  // A URL do cliente leva ?v=<arquivo>: trocar a imagem muda a URL, entao o
  // cache pode ser longo sem servir versao velha.
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.sendFile(join(UPLOAD_DIR, file), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Imagem não encontrada.' });
  });
});

subjectImagesRouter.put('/subjects/:id/images/:slot', (req, res) => {
  const t = target(req, res);
  if (!t) return;

  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (req.file) await removeStoredFiles([req.file.filename]);
      if (err instanceof BadImage) return res.status(415).json({ error: err.message });
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Imagem grande demais. O limite é de ${MAX_IMAGE_BYTES / 1024 / 1024}MB.` });
      }
      return res.status(400).json({ error: 'Falha no envio da imagem.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });

    run(`UPDATE subjects SET ${t.column} = ? WHERE id = ?`, req.file.filename, t.subject.id);
    const previous = t.subject[t.column];
    if (previous) await removeStoredFiles([previous]);
    return res.json({ [t.column]: req.file.filename });
  });
});

subjectImagesRouter.delete('/subjects/:id/images/:slot', async (req, res) => {
  const t = target(req, res);
  if (!t) return;
  const previous = t.subject[t.column];
  run(`UPDATE subjects SET ${t.column} = NULL WHERE id = ?`, t.subject.id);
  if (previous) await removeStoredFiles([previous]);
  return res.json({ ok: true });
});
