/**
 * Monta o prompt de uma materia. Esta e a peca central do recurso de IA: o que
 * faz a resposta parecer "consciente da materia" nao e o modelo, e o contexto
 * que injetamos aqui (professor, ementa, provas marcadas, resumos existentes).
 *
 * Nao depende de nenhum provedor. O mesmo texto serve para copiar e colar, para
 * abrir no claude.ai ou para mandar pela API do Gemini.
 */
import { all, get } from './db.js';


export const PRESETS = {
  prova: {
    label: 'Resumo para prova',
    hint: 'Foco no que costuma cair: conceitos, autores e autoavaliação.',
    instruction: [
      'Gere um RESUMO PARA PROVA. Priorize o que tem cara de questão:',
      '- conceitos-chave, cada um com uma definição curta e precisa;',
      '- autores e o que cada um defende, quando o material citar;',
      '- distinções e comparações que costumam ser cobradas;',
      '- pegadinhas e confusões comuns entre conceitos parecidos.',
      'Termine com 10 perguntas de autoavaliação, cada uma com a resposta logo abaixo.',
    ].join('\n'),
  },
  estudos: {
    label: 'Resumo para estudos',
    hint: 'Explicação didática, do zero, com exemplos.',
    instruction: [
      'Gere um RESUMO PARA ESTUDOS, para quem está aprendendo o conteúdo do zero.',
      'Explique cada ideia em linguagem simples antes de usar o termo técnico.',
      'Use exemplos concretos do dia a dia sempre que ajudar a fixar.',
      'Organize em seções com título, do mais básico ao mais avançado.',
      'Onde o material estiver incompleto ou confuso, diga isso explicitamente em vez de preencher com suposições.',
    ].join('\n'),
  },
  apresentacao: {
    label: 'Resumo para apresentação',
    hint: 'Roteiro de fala com tempo estimado.',
    instruction: [
      'Gere um ROTEIRO DE APRESENTAÇÃO a partir do material.',
      'Estruture em blocos, cada um com: o que falar, o tempo estimado em minutos e um gancho de transição para o próximo.',
      'Escreva no tom de quem fala em público, não no tom de texto lido.',
      'Inclua no fim 5 perguntas que a plateia ou o professor provavelmente fará, com sugestão de resposta.',
      'Assuma 15 minutos de apresentação, salvo indicação contrária no material.',
    ].join('\n'),
  },
  slides: {
    label: 'Slides',
    hint: 'Markdown de slides, uma ideia por slide.',
    instruction: [
      'Gere SLIDES em Markdown. Separe cada slide com uma linha contendo apenas ---',
      'Regras: um slide, uma ideia. Título curto. No máximo 5 tópicos por slide,',
      'cada tópico com no máximo 12 palavras. Nada de parágrafo dentro de slide.',
      'Comece com um slide de capa e termine com um de conclusão.',
      'Depois de cada slide, inclua uma linha "Notas:" com o que falar naquele slide.',
    ].join('\n'),
  },
};

export const isPreset = (name) => Object.hasOwn(PRESETS, name);

const line = (label, value) => (value ? `${label}: ${value}\n` : '');

/**
 * Bloco de contexto da materia, sem a instrucao do preset.
 *
 * So entra o que muda o CONTEUDO do resumo: nome da materia, ementa e
 * observacoes, avaliacoes em aberto e o que a turma ja resumiu. Dados de
 * logistica (professor, sala, dias de aula, codigo, datas) ficam de fora:
 * nao ajudam a explicar a materia e so ocupam espaco no prompt.
 */
export async function buildContext(subjectId) {
  const subject = await get('SELECT id, name, notes FROM subjects WHERE id = ?', subjectId);
  if (!subject) return null;

  // Avaliacoes e tarefas em aberto: dizem o que a turma precisa dominar.
  const tasks = await all(`
    SELECT title, kind, status, due_date, description
      FROM tasks
     WHERE subject_id = ? AND status <> 'concluida'
     ORDER BY due_date IS NULL, due_date
     LIMIT 10`, subjectId);
  const notes = await all(
    'SELECT title FROM notes WHERE subject_id = ? ORDER BY updated_at DESC LIMIT 15',
    subjectId,
  );

  let out = '';
  out += line('Matéria', subject.name);

  if (subject.notes) {
    out += `\nEmenta e observações da turma:\n${subject.notes}\n`;
  }

  if (tasks.length) {
    out += '\nAvaliações e tarefas em aberto:\n';
    for (const t of tasks) {
      const desc = t.description ? ` (${t.description})` : '';
      out += `- [${t.kind}] ${t.title}${desc}\n`;
    }
  }

  if (notes.length) {
    out += '\nResumos que a turma já tem nesta matéria (não repita o que já está coberto):\n';
    for (const n of notes) out += `- ${n.title}\n`;
  }

  return { subject, context: out.trimEnd() };
}

/**
 * Prompt completo pronto para enviar. `hasAttachments` muda a frase sobre o
 * material: sem anexo o modelo precisa saber que so tem o contexto acima.
 */
export async function buildPrompt(subjectId, preset, { hasAttachments = false } = {}) {
  if (!isPreset(preset)) return null;
  const built = await buildContext(subjectId);
  if (!built) return null;

  const material = hasAttachments
    ? 'Vou anexar o material da matéria (slides, PDFs, fotos do quadro). Baseie-se nele.'
    : [
        'Não há material anexado nesta chamada. Trabalhe com o contexto acima e,',
        'onde faltar conteúdo, aponte o que precisa ser preenchido em vez de inventar.',
      ].join(' ');

  return [
    'Você é um assistente de estudos de uma turma de faculdade.',
    '',
    'CONTEXTO DA MATÉRIA',
    built.context,
    '',
    'MATERIAL',
    material,
    '',
    'TAREFA',
    PRESETS[preset].instruction,
    '',
    'Escreva em português do Brasil, direto ao ponto, sem introdução nem despedida.',
    'Formate em Markdown.',
  ].join('\n');
}

/** Titulo sugerido para o resumo gerado. */
export const presetTitle = (preset, subjectName) =>
  `${PRESETS[preset].label}: ${subjectName}`;
