/**
 * Copia os dados do banco antigo (SQLite, data/app.db) para o Postgres do
 * DATABASE_URL. Roda uma vez so:
 *
 *   npm run migrate:sqlite
 *
 * - O SQLite e aberto somente para leitura: nada muda nele.
 * - Os ids sao preservados, entao as ligacoes (tarefa -> materia -> semestre)
 *   continuam valendo. Depois os contadores de id sao acertados.
 * - Tudo acontece numa transacao: se algo falhar, o Postgres fica como estava.
 * - Recusa rodar se o Postgres ja tiver contas, para nao duplicar dados.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, migrate, pool, run, tx } from '../server/db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] || join(root, 'data', 'app.db');

// Ordem importa: quem e referenciado entra antes de quem referencia.
const TABLES = [
  'positions', 'users', 'semesters', 'subjects', 'classes', 'tasks',
  'task_assignees', 'notes', 'attachments', 'invites', 'sessions',
];

/** SQLite guardava "2026-09-28 17:00:00" em UTC, sem fuso: vira ISO com Z. */
/** Tipo pelo nome do arquivo (o nome em disco sempre termina na extensao certa). */
const MIME_BY_EXT = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif',
};

const fixTimestamp = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)
  ? `${v.replace(' ', 'T')}Z`
  : v);

async function main() {
  if (!existsSync(source)) throw new Error(`Banco SQLite nao encontrado em ${source}`);
  const lite = new DatabaseSync(source, { readOnly: true });

  await migrate();
  const { n } = await get('SELECT COUNT(*) AS n FROM users');
  if (n > 0) {
    throw new Error(`O Postgres ja tem ${n} conta(s). A migracao so roda num banco vazio, para nao duplicar dados.`);
  }

  const liteTables = new Set(lite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));
  const report = [];

  await tx(async () => {
    for (const table of TABLES) {
      if (!liteTables.has(table)) { report.push([table, 'nao existia no SQLite']); continue; }

      // So as colunas que existem nos dois lados (o SQLite antigo pode nao ter as novas).
      const pgCols = new Map((await all(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = ?`, table,
      )).map((c) => [c.column_name, c.data_type]));
      const liteCols = lite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      const cols = liteCols.filter((c) => pgCols.has(c));

      let rows = lite.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all();
      // Sessao vencida nao vale a pena copiar.
      if (table === 'sessions') rows = rows.filter((r) => new Date(fixTimestamp(r.expires_at)) > new Date());

      for (const row of rows) {
        const values = cols.map((c) => {
          const v = row[c];
          const type = pgCols.get(c);
          if (v === '' && (type === 'date' || type.startsWith('timestamp'))) return null;
          return type.startsWith('timestamp') ? fixTimestamp(v) : v;
        });
        // run() usa a conexao da transacao; pool.query escaparia dela.
        await run(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          ...values,
        ).catch((err) => { throw new Error(`${table}: ${err.message}`); });
      }

      // Proximo id novo continua depois do maior id copiado.
      if (pgCols.has('id') && table !== 'sessions') {
        await all(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`);
      }
      report.push([table, `${rows.length} linha(s)`]);
    }

    // Arquivos (anexos e imagens) moravam em data/uploads; no Postgres ficam em
    // blobs, com a mesma chave que as linhas acima ja apontam.
    const keys = (await all(`
      SELECT stored_as AS k FROM attachments
      UNION SELECT cover_image FROM subjects WHERE cover_image IS NOT NULL
      UNION SELECT backdrop_image FROM subjects WHERE backdrop_image IS NOT NULL`)).map((r) => r.k);
    let copied = 0;
    const missing = [];
    for (const key of keys) {
      const file = join(root, 'data', 'uploads', key);
      if (!existsSync(file)) { missing.push(key); continue; }
      const data = readFileSync(file);
      const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
      await run('INSERT INTO blobs (key, mime, size, data) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO NOTHING',
        key, MIME_BY_EXT[ext] || 'application/octet-stream', data.length, data);
      copied += 1;
    }
    report.push(['arquivos', `${copied} copiado(s)${missing.length ? `, ${missing.length} sem arquivo em data/uploads` : ''}`]);
  });

  lite.close();
  console.log('\nMigracao concluida:\n');
  for (const [table, info] of report) console.log(`  ${table.padEnd(16)} ${info}`);
  console.log('\nO arquivo data/app.db nao foi alterado. Guarde-o como copia de seguranca.\n');
}

main()
  .catch((err) => { console.error(`\nMigracao cancelada: ${err.message}\n`); process.exitCode = 1; })
  .finally(() => pool.end());
