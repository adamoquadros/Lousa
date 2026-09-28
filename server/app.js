/**
 * O app Express, sem abrir porta. Serve a dois donos:
 *  - server/index.js, que chama listen() para rodar no computador (npm start);
 *  - api/index.js, a funcao da Vercel, que entrega cada requisicao a ele.
 */
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachUser } from './auth.js';
import { DbNotConfigured, ensureSchema } from './db.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { apiRouter } from './routes/api.js';
import { aiRouter } from './routes/ai.js';
import { attachmentsRouter } from './routes/attachments.js';
import { subjectImagesRouter } from './routes/subject-images.js';
import { positionsRouter } from './routes/positions.js';
import { invitesRouter } from './routes/invites.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const app = express();

// Na Vercel o app fica atras de um proxy: sem isto req.protocol seria "http"
// e o link dos convites sairia sem o https.
app.set('trust proxy', true);

app.use(express.json({ limit: '2mb' }));

// As tabelas precisam existir antes da primeira consulta. Uma vez por processo.
app.use('/api', (_req, _res, next) => { ensureSchema().then(() => next(), next); });

app.use(attachUser);

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/positions', positionsRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/ai', aiRouter);
app.use('/api', attachmentsRouter);
app.use('/api', subjectImagesRouter);
app.use('/api', apiRouter);

app.use(express.static(join(root, 'public')));

// Os arquivos do design system ficam na raiz do projeto (DESIGN.md, tokens.json,
// theme.css, variables.css). Só o CSS de tokens precisa chegar ao navegador.
app.get('/css/variables.css', (_req, res) => res.sendFile(join(root, 'variables.css')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada.' });
  res.sendFile(join(root, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  if (err instanceof DbNotConfigured) return res.status(503).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Erro interno no servidor.' });
});

export default app;
