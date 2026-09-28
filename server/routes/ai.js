import { Router } from 'express';
import { get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { AiError, describe, generate, isEnabled } from '../ai.js';
import { PRESETS, buildPrompt, isPreset, presetTitle } from '../prompts.js';
import { listForSubject, loadParts } from '../attachments.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

/** Estado da IA + lista de presets, para a interface se montar sozinha. */
aiRouter.get('/status', (_req, res) => {
  res.json({
    ...describe(),
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, hint: p.hint })),
  });
});

/**
 * Prompt pronto, sem chamar IA nenhuma. E o que alimenta o botao "Copiar" e o
 * "Abrir no Claude" - funciona sem chave e sem custo.
 */
aiRouter.get('/subjects/:id/prompt', async (req, res) => {
  const { id, preset } = readTarget(req, res);
  if (!id) return undefined;

  const attached = await listForSubject(id);
  const prompt = await buildPrompt(id, preset, { hasAttachments: attached.length > 0 });
  if (!prompt) return res.status(404).json({ error: 'Matéria não encontrada.' });

  return res.json({
    preset,
    label: PRESETS[preset].label,
    prompt,
    chars: prompt.length,
    claude_url: `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
  });
});

/**
 * Geracao automatica: monta o prompt, chama o provedor e grava o resultado
 * como um resumo da materia.
 */
aiRouter.post('/subjects/:id/generate', async (req, res, next) => {
  const { id, preset } = readTarget(req, res);
  if (!id) return undefined;

  if (!isEnabled()) {
    return res.status(503).json({ error: describe().reason });
  }

  const subject = await get('SELECT id, name FROM subjects WHERE id = ?', id);
  if (!subject) return res.status(404).json({ error: 'Matéria não encontrada.' });

  const { parts, included, skipped } = await loadParts(id);
  const prompt = await buildPrompt(id, preset, { hasAttachments: included.length > 0 });

  // Sem timeout, uma geracao travada seguraria a conexao ate o limite do proxy.
  // Com anexo a leitura e mais lenta, entao a folga e maior.
  const abort = AbortSignal.timeout(parts.length ? 240_000 : 120_000);

  try {
    const content = await generate(prompt, { signal: abort, parts });
    const info = await run(
      'INSERT INTO notes (subject_id, title, content, created_by) VALUES (?, ?, ?, ?) RETURNING id',
      id, presetTitle(preset, subject.name), content, req.user.id,
    );
    // skipped viaja junto para a interface avisar o que ficou de fora.
    return res.status(201).json({
      ...(await get('SELECT * FROM notes WHERE id = ?', info.lastInsertRowid)),
      used_attachments: included,
      skipped_attachments: skipped,
    });
  } catch (err) {
    if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return res.status(504).json({ error: 'A IA demorou demais para responder. Tente de novo.' });
    }
    return next(err);
  }
});

/** Valida :id e ?preset de uma vez; responde e devolve id nulo quando invalido. */
function readTarget(req, res) {
  const id = Number(req.params.id);
  const preset = String(req.query.preset || req.body?.preset || '');
  if (!id) {
    res.status(400).json({ error: 'Matéria inválida.' });
    return { id: null };
  }
  if (!isPreset(preset)) {
    res.status(400).json({ error: 'Escolha uma das opções de resumo.' });
    return { id: null };
  }
  return { id, preset };
}
