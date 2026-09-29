/**
 * Regras dos anexos: o que aceita, quanto cabe e como o arquivo vira parte da
 * chamada ao modelo.
 *
 * O limite que manda aqui nao e o do disco, e o da API: a requisicao inteira
 * (texto + bytes embutidos) precisa caber em 20MB. Como base64 infla os bytes
 * em cerca de 1/3, o orcamento em disco fica bem abaixo disso.
 */
import { all } from './db.js';
import { MAX_UPLOAD_BYTES, deleteBlobs } from './storage.js';

export const MAX_FILE_BYTES = MAX_UPLOAD_BYTES;

/**
 * Teto de bytes crus somados por geracao. 12MB viram ~16MB em base64, deixando
 * folga para o texto do prompt dentro dos 20MB que a API aceita.
 */
export const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

const MIME_KIND = {
  'application/pdf': 'document',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
};

export const isAllowedMime = (mime) => Object.hasOwn(MIME_KIND, mime);
export const kindOf = (mime) => MIME_KIND[mime];

/**
 * Chaves dos arquivos (anexos + imagens) de um conjunto de materias. O DELETE
 * em cascata limpa as linhas das materias, mas nao a tabela blobs - por isso
 * a lista e coletada ANTES de apagar.
 */
export async function storedFilesOf(subjectIds) {
  if (!subjectIds.length) return [];
  const rows = await all(`
    SELECT stored_as AS f FROM attachments WHERE subject_id = ANY(?::int[])
    UNION ALL
    SELECT cover_image FROM subjects WHERE id = ANY(?::int[]) AND cover_image IS NOT NULL
    UNION ALL
    SELECT backdrop_image FROM subjects WHERE id = ANY(?::int[]) AND backdrop_image IS NOT NULL`,
  subjectIds, subjectIds, subjectIds);
  return rows.map((r) => r.f);
}

export const removeStoredFiles = (keys) => deleteBlobs(keys);

export const humanSize = (bytes) => (bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
  : `${Math.max(1, Math.round(bytes / 1024))}KB`);
