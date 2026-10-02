/**
 * Banco de dados: Postgres (Neon), configurado por DATABASE_URL no .env.
 *
 * As rotas continuam escrevendo SQL com `?` como placeholder; aqui ele vira
 * $1, $2... do Postgres. Todas as funcoes sao assincronas (o banco esta do
 * outro lado da rede) - quem chama precisa de await.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ALL_PERMISSIONS, MEMBER_DEFAULTS } from './permissions.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// O .env precisa estar carregado antes de abrir a conexao, e este modulo e
// importado antes do corpo do index.js rodar.
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const url = process.env.DATABASE_URL;

/** Sem conexao configurada o app sobe, mas toda rota de dados responde este erro. */
export class DbNotConfigured extends Error {
  constructor() {
    super('Banco de dados não configurado: defina DATABASE_URL (no .env ou nas variáveis de ambiente da Vercel).');
  }
}
export const dbConfigured = Boolean(url);

/*
 * Tipos devolvidos como texto/numero, do jeito que o front ja espera:
 *  - COUNT(*) vem como bigint (string) -> numero;
 *  - DATE vem como Date meia-noite local, o que desloca o dia -> 'YYYY-MM-DD';
 *  - TIMESTAMPTZ -> texto ISO (o JSON sairia igual, mas no servidor fica string).
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());

/**
 * Ajusta a URL copiada do painel do Neon para o driver do Node:
 *  - channel_binding e parametro do libpq; o driver nao o entende;
 *  - sslmode=require passa a verify-full (confere o certificado do servidor),
 *    que e o que o driver ja faz hoje - explicito, sem o aviso de seguranca.
 */
const connectionString = (url || '')
  .replace(/([?&])channel_binding=[^&]*&?/, '$1')
  .replace(/sslmode=(require|prefer|verify-ca)\b/, 'sslmode=verify-full')
  .replace(/[?&]$/, '');

export const pool = dbConfigured ? new pg.Pool({
  connectionString,
  max: Number(process.env.DB_POOL_MAX) || 5,
  idleTimeoutMillis: 30_000,
}) : null;

pool?.on('error', (err) => console.error('Conexão ociosa com o banco caiu:', err.message));

/** Dentro de tx(), as queries usam a conexao da transacao sem precisar passa-la. */
const txClient = new AsyncLocalStorage();

/** `?` -> `$n`, pulando o que estiver entre aspas simples. */
function toPg(sql) {
  let n = 0;
  let out = '';
  let quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    out += ch === '?' && !quoted ? `$${++n}` : ch;
  }
  return out;
}

async function query(sql, params) {
  if (!pool) throw new DbNotConfigured();
  return (txClient.getStore() ?? pool).query(toPg(sql), params);
}

/** Todas as linhas. */
export async function all(sql, ...params) {
  return (await query(sql, params)).rows;
}

/** Primeira linha (ou undefined). */
export async function get(sql, ...params) {
  return (await query(sql, params)).rows[0];
}

/**
 * INSERT/UPDATE/DELETE. `changes` = linhas afetadas; `lastInsertRowid` = id da
 * linha criada, quando o INSERT termina em RETURNING id.
 */
export async function run(sql, ...params) {
  const result = await query(sql, params);
  return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
}

/** Transacao: tudo dentro de fn grava junto ou nada grava. */
export async function tx(fn) {
  if (txClient.getStore()) return fn(); // ja esta dentro de uma transacao
  if (!pool) throw new DbNotConfigured();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txClient.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ schema */

// Idempotente: roda a cada inicio e so cria o que falta.
const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS positions (
  id         SERIAL PRIMARY KEY,
  name       CITEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT    NOT NULL,
  email         CITEXT  NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  color         TEXT    NOT NULL DEFAULT '#6366f1',
  position_id   INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS semesters (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  starts_on  DATE,
  ends_on    DATE,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subjects (
  id             SERIAL PRIMARY KEY,
  semester_id    INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  code           TEXT,
  professor      TEXT,
  email          TEXT,
  room           TEXT,
  color          TEXT NOT NULL DEFAULT '#6366f1',
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  cover_image    TEXT,
  backdrop_image TEXT
);

CREATE TABLE IF NOT EXISTS classes (
  id         SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at  TEXT,
  ends_at    TEXT,
  room       TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id           SERIAL PRIMARY KEY,
  subject_id   INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  kind         TEXT NOT NULL DEFAULT 'tarefa' CHECK (kind IN ('tarefa','prova','trabalho','leitura','apresentacao')),
  status       TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','andamento','concluida')),
  priority     TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa','media','alta')),
  due_date     DATE,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id         SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attachments (
  id         SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  filename   TEXT    NOT NULL,
  stored_as  TEXT    NOT NULL UNIQUE,
  mime       TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Convite para criar conta. Guarda so o hash do token: quem ler o banco nao
-- consegue usar um convite pendente.
CREATE TABLE IF NOT EXISTS invites (
  id           SERIAL PRIMARY KEY,
  email        CITEXT  NOT NULL,
  token_hash   TEXT    NOT NULL UNIQUE,
  role         TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  position_id  INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  invited_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ
);

-- Texto lido de cada anexo (ver server/extract.js), para entrar no prompt.
-- extract_status: ok | empty (sem texto) | needs_ai (imagem sem chave de IA)
--                 | failed | NULL (ainda nao lido: anexos antigos)
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS extracted_text TEXT;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS extract_status TEXT;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS extract_method TEXT;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS extract_error  TEXT;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS extract_pages  INTEGER;

-- Perfis de acesso: nome, nivel na hierarquia (0 = topo) e direitos.
-- key marca os dois perfis do sistema: 'admin' (tem tudo, nao pode ser
-- apagado nem rebaixado) e 'member' (padrao de quem entra, editavel).
CREATE TABLE IF NOT EXISTS profiles (
  id          SERIAL PRIMARY KEY,
  key         TEXT UNIQUE,
  name        CITEXT  NOT NULL UNIQUE,
  level       INTEGER NOT NULL CHECK (level >= 0),
  permissions TEXT[]  NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- users.role continua existindo (admin/member) e e mantido em sincronia,
-- para versoes antigas do app que ainda leem so ele.
ALTER TABLE users   ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL;

-- Funcoes numa tarefa (Responsavel, Conferente, Quem envia...). Diferente
-- dos cargos (positions), que sao da pessoa na equipe: a funcao e da pessoa
-- naquela tarefa. As padrao entram so quando a tabela nasce (ver migrate).
CREATE TABLE IF NOT EXISTS task_roles (
  id         SERIAL PRIMARY KEY,
  name       CITEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- task_assignees ganha a funcao. A mesma pessoa pode ter mais de uma funcao
-- na tarefa, entao a chave deixa de ser (tarefa, pessoa) e vira
-- (tarefa, pessoa, funcao) - com "sem funcao" contando como um valor so.
-- Compativel com o codigo antigo: quem nao conhece role_id grava NULL.
ALTER TABLE task_assignees ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES task_roles(id) ON DELETE SET NULL;
ALTER TABLE task_assignees DROP CONSTRAINT IF EXISTS task_assignees_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_assignees ON task_assignees (task_id, user_id, role_id) NULLS NOT DISTINCT;

-- "Todos" numa tarefa: a equipe inteira, com uma funcao (ou sem). Guarda so a
-- regra; a lista de pessoas e montada na leitura, entao quem entrar na turma
-- depois tambem fica incluido.
CREATE TABLE IF NOT EXISTS task_everyone (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  role_id INTEGER REFERENCES task_roles(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_everyone ON task_everyone (task_id, role_id) NULLS NOT DISTINCT;

-- Conteudo dos anexos e das imagens das materias. Fica no banco (e nao em
-- disco) porque na Vercel cada requisicao roda numa maquina descartavel.
-- attachments.stored_as e subjects.cover_image/backdrop_image apontam para key.
CREATE TABLE IF NOT EXISTS blobs (
  key        TEXT PRIMARY KEY,
  mime       TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  data       BYTEA   NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subjects_semester ON subjects(semester_id);
CREATE INDEX IF NOT EXISTS idx_classes_subject   ON classes(subject_id);
CREATE INDEX IF NOT EXISTS idx_tasks_subject     ON tasks(subject_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due         ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_notes_subject     ON notes(subject_id);
CREATE INDEX IF NOT EXISTS idx_attach_subject    ON attachments(subject_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user     ON sessions(user_id);
`;

/** Cria as tabelas que faltarem. */
export const DEFAULT_TASK_ROLES = ['Responsável', 'Conferente', 'Quem envia'];

export async function migrate() {
  if (!pool) throw new DbNotConfigured();
  const { rows } = await pool.query("SELECT to_regclass('task_roles') IS NULL AS fresh");
  await pool.query(SCHEMA);
  // Perfis do sistema (idempotente) e encaixe de quem ainda nao tem perfil -
  // contas antigas ou criadas por uma versao que so conhece role.
  await pool.query(
    `INSERT INTO profiles (key, name, level, permissions)
     VALUES ('admin', 'Administrador', 0, $1), ('member', 'Membro', 10, $2)
     ON CONFLICT DO NOTHING`,
    [ALL_PERMISSIONS, MEMBER_DEFAULTS],
  );
  for (const table of ['users', 'invites']) {
    await pool.query(`
      UPDATE ${table} SET profile_id = (SELECT id FROM profiles
        WHERE key = CASE WHEN ${table}.role = 'admin' THEN 'admin' ELSE 'member' END)
       WHERE profile_id IS NULL`);
  }

  // Funcoes padrao so na criacao da tabela: se a turma apagar uma, ela nao volta.
  if (rows[0].fresh) {
    await pool.query(
      'INSERT INTO task_roles (name) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING',
      [DEFAULT_TASK_ROLES],
    );
  }
}

/**
 * Garante o schema uma vez por processo. Na Vercel cada "partida a frio" e um
 * processo novo, entao isso roda na primeira requisicao de cada um - e nao a
 * cada requisicao. Se falhar, a proxima requisicao tenta de novo.
 */
let ready = null;
export function ensureSchema() {
  ready ??= migrate().catch((err) => { ready = null; throw err; });
  return ready;
}

/**
 * "Hoje" no fuso da turma. CURRENT_DATE usaria o fuso do servidor do banco
 * (UTC), e a partir das 21h o prazo de amanha ja contaria como de hoje.
 */
export const TODAY = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
