import { Router } from 'express';
import { get, run } from '../db.js';
import { requireAuth, requirePermission } from '../auth.js';
import { AiError, describe, generate, isEnabled } from '../ai.js';
import { MAX_FOCUS_CHARS, PRESETS, buildPrompt, isPreset, presetTitle } from '../prompts.js';
import { MAX_TOTAL_BYTES, kindOf } from '../attachments.js';
import { getBlob } from '../storage.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

/**
 * O link "Abrir no Claude" leva o prompt inteiro na URL; acima disso ele pode
 * nao abrir. Prompt maior: so pelo botao Copiar.
 */
const MAX_LINK_CHARS = 6_000;

/** Estado da IA + lista de presets, para a interface se montar sozinha. */
aiRouter.get('/status', (_req, res) => {
  res.json({
    ...describe(),
    max_focus_chars: MAX_FOCUS_CHARS,
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, hint: p.hint })),
  });
});

/**
 * Prompt pronto, sem chamar IA nenhuma. E o que alimenta o botao "Copiar" e o
 * "Abrir no Claude" - funciona sem chave e sem custo. Ja vem com o texto lido
 * dos anexos escolhidos.
 */
aiRouter.get('/subjects/:id/prompt', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return undefined;

  const built = await buildPrompt(target.id, target.preset, { files: target.files, focus: target.focus });
  if (!built) return res.status(404).json({ error: 'Matéria não encontrada.' });

  const { unreadRows, ...material } = built.material;
  return res.json({
    preset: target.preset,
    label: PRESETS[target.preset].label,
    prompt: built.prompt,
    chars: built.prompt.length,
    material,
    claude_url: built.prompt.length <= MAX_LINK_CHARS
      ? `https://claude.ai/new?q=${encodeURIComponent(built.prompt)}`
      : null,
  });
});

/**
 * Anexos sem texto lido (imagem sem transcricao, falha) viajam como arquivo
 * na geracao automatica - o modelo le direto. Respeita o teto de bytes da API.
 */
async function binaryParts(rows) {
  const parts = [];
  const skipped = [];
  let total = 0;
  for (const row of rows) {
    if (row.extract_status === 'empty') continue; // lido e sem texto: nada a mandar
    if (total + row.size > MAX_TOTAL_BYTES) { skipped.push({ filename: row.filename, reason: 'orcamento' }); continue; }
    const blob = await getBlob(row.stored_as);
    if (!blob) { skipped.push({ filename: row.filename, reason: 'ilegivel' }); continue; }
    parts.push({ type: kindOf(row.mime), data: blob.data.toString('base64'), mime_type: row.mime });
    total += row.size;
  }
  return { parts, skipped };
}

/**
 * Geracao automatica: monta o prompt, chama o provedor e grava o resultado
 * como um resumo da materia.
 */
aiRouter.post('/subjects/:id/generate', requirePermission('ia.gerar'), async (req, res, next) => {
  const target = readTarget(req, res);
  if (!target) return undefined;

  if (!isEnabled()) {
    return res.status(503).json({ error: describe().reason });
  }

  const subject = await get('SELECT id, name FROM subjects WHERE id = ?', target.id);
  if (!subject) return res.status(404).json({ error: 'Matéria não encontrada.' });

  // 1a passada so para saber quais escolhidos nao tem texto; eles vao como arquivo.
  const probe = await buildPrompt(target.id, target.preset, { files: target.files, focus: target.focus });
  const { parts, skipped } = await binaryParts(probe.material.unreadRows);
  const built = parts.length
    ? await buildPrompt(target.id, target.preset, { files: target.files, focus: target.focus, attachedBinary: true })
    : probe;

  // Sem timeout, uma geracao travada seguraria a conexao ate o limite do proxy.
  const abort = AbortSignal.timeout(parts.length ? 240_000 : 120_000);

  try {
    const content = await generate(built.prompt, { signal: abort, parts });
    const info = await run(
      'INSERT INTO notes (subject_id, title, content, created_by) VALUES (?, ?, ?, ?) RETURNING id',
      target.id, presetTitle(target.preset, subject.name), content, req.user.id,
    );
    // used/skipped viajam junto para a interface avisar o que entrou e o que nao.
    return res.status(201).json({
      ...(await get('SELECT * FROM notes WHERE id = ?', info.lastInsertRowid)),
      used_attachments: [...built.material.included, ...(parts.length ? probe.material.unreadRows
        .filter((r) => !skipped.some((s) => s.filename === r.filename) && r.extract_status !== 'empty')
        .map((r) => r.filename) : [])],
      skipped_attachments: [
        ...skipped,
        ...built.material.truncated.map((filename) => ({ filename, reason: 'cortado' })),
      ],
    });
  } catch (err) {
    if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return res.status(504).json({ error: 'A IA demorou demais para responder. Tente de novo.' });
    }
    return next(err);
  }
});

/**
 * Valida :id, preset, anexos escolhidos e foco (query no GET, corpo no POST).
 * files: "1,2,3" ou [1,2,3]; "none" = nenhum; ausente = todos.
 * Responde o erro e devolve null quando algo nao vale.
 */
function readTarget(req, res) {
  const src = req.method === 'GET' ? req.query : (req.body ?? {});
  const id = Number(req.params.id);
  const preset = String(src.preset || '');
  if (!id) {
    res.status(400).json({ error: 'Matéria inválida.' });
    return null;
  }
  if (!isPreset(preset)) {
    res.status(400).json({ error: 'Escolha uma das opções de resumo.' });
    return null;
  }
  let files = null;
  if (src.files === 'none') files = [];
  else if (src.files !== undefined && src.files !== '') {
    files = (Array.isArray(src.files) ? src.files : String(src.files).split(','))
      .map(Number).filter((n) => Number.isInteger(n) && n > 0);
  }
  return { id, preset, files, focus: String(src.focus || '').slice(0, MAX_FOCUS_CHARS) };
}
