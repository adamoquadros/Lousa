/**
 * Arquivos enviados (anexos e imagens das materias), guardados na tabela blobs
 * do Postgres. Na Vercel o disco e descartavel a cada requisicao, entao nada
 * de data/uploads: tudo que precisa durar fica no banco.
 *
 * O limite que importa e o da Vercel: o corpo de uma requisicao passa de
 * ~4,5MB e ela recusa antes de chegar ao app. Por isso 4MB por arquivo, e o
 * front envia um arquivo por requisicao.
 */
import { randomUUID } from 'node:crypto';
import { get, run } from './db.js';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

const EXT = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

/** Grava o conteudo e devolve a chave. A extensao vem do tipo, nunca do nome enviado. */
export async function putBlob(buffer, mime) {
  const key = randomUUID() + (EXT[mime] ?? '');
  await run('INSERT INTO blobs (key, mime, size, data) VALUES (?, ?, ?, ?)', key, mime, buffer.length, buffer);
  return key;
}

/** { mime, size, data: Buffer } ou undefined. */
export const getBlob = (key) => get('SELECT mime, size, data FROM blobs WHERE key = ?', key);

export async function deleteBlobs(keys) {
  const list = keys.filter(Boolean);
  if (list.length) await run('DELETE FROM blobs WHERE key = ANY(?::text[])', list);
}
