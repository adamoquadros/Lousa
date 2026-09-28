import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(process.env.DB_FILE || join(dataDir, 'app.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  color         TEXT    NOT NULL DEFAULT '#6366f1',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS semesters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  starts_on  TEXT,
  ends_on    TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subjects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT,
  professor   TEXT,
  email       TEXT,
  room        TEXT,
  color       TEXT NOT NULL DEFAULT '#6366f1',
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at  TEXT,
  ends_at    TEXT,
  room       TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id   INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  kind         TEXT NOT NULL DEFAULT 'tarefa' CHECK (kind IN ('tarefa','prova','trabalho','leitura','apresentacao')),
  status       TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','andamento','concluida')),
  priority     TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa','media','alta')),
  due_date     TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  filename   TEXT    NOT NULL,
  stored_as  TEXT    NOT NULL UNIQUE,
  mime       TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Convite para criar conta. Guarda so o hash do token: quem ler o banco nao
-- consegue usar um convite pendente.
CREATE TABLE IF NOT EXISTS invites (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT    NOT NULL COLLATE NOCASE,
  token_hash   TEXT    NOT NULL UNIQUE,
  role         TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  position_id  INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  invited_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT    NOT NULL,
  accepted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_subjects_semester ON subjects(semester_id);
CREATE INDEX IF NOT EXISTS idx_classes_subject   ON classes(subject_id);
CREATE INDEX IF NOT EXISTS idx_tasks_subject     ON tasks(subject_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due         ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_notes_subject     ON notes(subject_id);
CREATE INDEX IF NOT EXISTS idx_attach_subject    ON attachments(subject_id);
`);

/**
 * Colunas criadas depois da primeira versao. CREATE TABLE IF NOT EXISTS nao
 * altera tabela que ja existe, entao bancos antigos ganham a coluna aqui.
 */
function addColumn(table, column, ddl) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

addColumn('users', 'position_id', 'INTEGER REFERENCES positions(id) ON DELETE SET NULL');
// Nome do arquivo em data/uploads: capa do cartao e fundo atras do modal.
addColumn('subjects', 'cover_image', 'TEXT');
addColumn('subjects', 'backdrop_image', 'TEXT');

/** Roda uma query e devolve objetos simples (node:sqlite devolve null-prototype). */
export function all(sql, ...params) {
  return db.prepare(sql).all(...params).map((row) => ({ ...row }));
}

export function get(sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return row ? { ...row } : undefined;
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
