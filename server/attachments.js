/**
 * Regras dos anexos: o que aceita, quanto cabe e como o arquivo vira parte da
 * chamada ao modelo.
 *
 * O limite que manda aqui nao e o do disco, e o da API: a requisicao inteira
 * (texto + bytes embutidos) precisa caber em 20MB. Como base64 infla os bytes
 * em cerca de 1/3, o orcamento em disco fica bem abaixo disso.
 */
import { readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { all } from './db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const UPLOAD_DIR = join(root, 'data', 'uploads');

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
 * Arquivos em disco de um conjunto de materias (anexos + imagens). O DELETE em
 * cascata limpa as linhas do banco, mas os arquivos ficariam orfaos em
 * data/uploads — por isso a lista e coletada ANTES de apagar.
 */
export function storedFilesOf(subjectIds) {
  if (!subjectIds.length) return [];
  const marks = subjectIds.map(() => '?').join(',');
  return [
    ...all(`SELECT stored_as AS f FROM attachments WHERE subject_id IN (${marks})`, ...subjectIds),
    ...all(`SELECT cover_image AS f FROM subjects WHERE id IN (${marks}) AND cover_image IS NOT NULL`, ...subjectIds),
    ...all(`SELECT backdrop_image AS f FROM subjects WHERE id IN (${marks}) AND backdrop_image IS NOT NULL`, ...subjectIds),
  ].map((r) => r.f);
}

export const removeStoredFiles = (names) =>
  Promise.all(names.map((name) => unlink(join(UPLOAD_DIR, name)).catch(() => {})));

export const listForSubject = (subjectId) =>
  all('SELECT * FROM attachments WHERE subject_id = ? ORDER BY created_at', subjectId);

export const humanSize = (bytes) => (bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
  : `${Math.max(1, Math.round(bytes / 1024))}KB`);

/**
 * Le os anexos da materia e devolve as partes prontas para a API, respeitando o
 * orcamento. Devolve tambem o que ficou de fora, para a interface poder avisar
 * em vez de silenciosamente ignorar arquivo.
 */
export async function loadParts(subjectId) {
  const rows = listForSubject(subjectId);
  const parts = [];
  const included = [];
  const skipped = [];
  let total = 0;

  for (const row of rows) {
    if (total + row.size > MAX_TOTAL_BYTES) {
      skipped.push({ filename: row.filename, reason: 'orcamento' });
      continue;
    }
    try {
      const data = await readFile(join(UPLOAD_DIR, row.stored_as));
      parts.push({ type: kindOf(row.mime), data: data.toString('base64'), mime_type: row.mime });
      included.push(row.filename);
      total += row.size;
    } catch {
      // Arquivo sumiu do disco mas o registro ficou: avisa em vez de quebrar.
      skipped.push({ filename: row.filename, reason: 'ilegivel' });
    }
  }

  return { parts, included, skipped, bytes: total };
}
