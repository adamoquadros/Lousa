import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachUser } from './auth.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { apiRouter } from './routes/api.js';
import { aiRouter } from './routes/ai.js';
import { attachmentsRouter } from './routes/attachments.js';
import { subjectImagesRouter } from './routes/subject-images.js';
import { positionsRouter } from './routes/positions.js';
import { invitesRouter } from './routes/invites.js';
import './db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Chaves de IA vivem no .env (fora do git). Sem o arquivo o app roda igual,
// so sem a geracao automatica.
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const app = express();

app.use(express.json({ limit: '2mb' }));
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
  console.error(err);
  res.status(500).json({ error: 'Erro interno no servidor.' });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`\n  Lousa rodando em http://localhost:${port}\n`);
});
