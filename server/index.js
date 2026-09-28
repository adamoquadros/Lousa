/** Roda a Lousa no computador: npm start (ou npm run dev). */
import app from './app.js';
import { dbConfigured, ensureSchema } from './db.js';

if (!dbConfigured) {
  console.error('\n  DATABASE_URL não definida. Copie o .env.example para .env e preencha a conexão do Postgres.\n');
  process.exit(1);
}

// Localmente vale falhar cedo: sem banco, o servidor nem abre a porta.
await ensureSchema();

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`\n  Lousa rodando em http://localhost:${port}\n`);
});
