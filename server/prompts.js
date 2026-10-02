/**
 * Monta o prompt de uma materia. Esta e a peca central do recurso de IA: o que
 * faz a resposta parecer "consciente da materia" nao e o modelo, e o contexto
 * que injetamos aqui (professor, ementa, provas marcadas, resumos existentes).
 *
 * Nao depende de nenhum provedor. O mesmo texto serve para copiar e colar, para
 * abrir no Claude, ChatGPT ou Gemini e para mandar pela API do Gemini.
 */
import { all, get } from './db.js';

/**
 * Tipos de resumo. A interface monta a lista suspensa com busca a partir daqui:
 *  group: titulo do bloco na lista;
 *  hint: descricao que aparece embaixo do nome (e entra na busca);
 *  keywords: termos que nao aparecem na tela, so ajudam a busca ("anki", "quiz").
 */
export const PRESETS = {
  prova: {
    group: 'Resumos',
    label: 'Resumo para prova',
    hint: 'Foco no que costuma cair na prova: conceitos, autores, pegadinhas e autoavaliação.',
    keywords: 'avaliação exame teste',
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
    group: 'Resumos',
    label: 'Resumo para estudos',
    hint: 'Explicação didática, do zero, com exemplos do dia a dia.',
    keywords: 'aprender entender explicação básico iniciante',
    instruction: [
      'Gere um RESUMO PARA ESTUDOS, para quem está aprendendo o conteúdo do zero.',
      'Explique cada ideia em linguagem simples antes de usar o termo técnico.',
      'Use exemplos concretos do dia a dia sempre que ajudar a fixar.',
      'Organize em seções com título, do mais básico ao mais avançado.',
      'Onde o material estiver incompleto ou confuso, diga isso explicitamente em vez de preencher com suposições.',
    ].join('\n'),
  },
  revisao: {
    group: 'Resumos',
    label: 'Revisão de véspera',
    hint: 'Uma página só com o essencial para revisar na véspera da prova.',
    keywords: 'rápida rápido cola esquema última hora resumão',
    instruction: [
      'Gere uma REVISÃO DE VÉSPERA: o essencial do conteúdo em no máximo uma página.',
      'Só tópicos curtos, agrupados por tema. Nada de explicação longa nem exemplo extenso.',
      'Destaque em **negrito** os termos que a pessoa precisa reconhecer de cara.',
      'Feche com uma lista "Não confunda" com os pares de conceitos mais fáceis de trocar.',
    ].join('\n'),
  },
  fichamento: {
    group: 'Resumos',
    label: 'Fichamento de texto',
    hint: 'Ficha de leitura de um texto ou artigo: tese, argumentos, citações e crítica.',
    keywords: 'artigo leitura livro capítulo autor resenha',
    instruction: [
      'Gere um FICHAMENTO de cada texto ou artigo do material, com:',
      '- referência (autor, título e ano, se aparecerem no material);',
      '- tese central em uma ou duas frases;',
      '- argumentos principais, na ordem em que o autor os apresenta;',
      '- conceitos que o autor define, com a definição dele;',
      '- até 5 citações curtas e marcantes, entre aspas, com a página;',
      '- uma apreciação crítica curta: limites, pontos fortes e diálogo com outros autores da matéria.',
    ].join('\n'),
  },
  glossario: {
    group: 'Resumos',
    label: 'Glossário',
    hint: 'Termos técnicos da matéria em ordem alfabética, com definição curta.',
    keywords: 'vocabulário termos definições dicionário conceitos',
    instruction: [
      'Gere um GLOSSÁRIO dos termos técnicos do material, em ordem alfabética.',
      'Formato de cada item: **Termo** — definição em uma ou duas frases.',
      'Quando o termo tiver um autor de referência no material, cite-o na definição.',
      'Quando dois termos forem fáceis de confundir, aponte a diferença no item de cada um.',
    ].join('\n'),
  },
  mapa: {
    group: 'Resumos',
    label: 'Mapa mental',
    hint: 'Conteúdo em árvore de tópicos, do tema central aos detalhes.',
    keywords: 'esquema estrutura diagrama hierarquia markmap xmind',
    instruction: [
      'Gere um MAPA MENTAL do conteúdo como lista Markdown aninhada.',
      'O primeiro nível é o tema central da matéria; os níveis abaixo vão do geral ao específico.',
      'Cada item tem no máximo 8 palavras. Use no máximo 4 níveis.',
      'Não escreva parágrafos: o resultado deve poder ser colado direto em ferramentas como Markmap ou Xmind.',
    ].join('\n'),
  },
  flashcards: {
    group: 'Exercícios',
    label: 'Flashcards',
    hint: 'Cartões de pergunta e resposta para memorizar e revisar para a prova.',
    keywords: 'anki memorização cartões repetição espaçada',
    instruction: [
      'Gere 30 FLASHCARDS a partir do material.',
      'Cada cartão em duas linhas, separado do próximo por uma linha em branco:',
      'P: pergunta curta e objetiva',
      'R: resposta em no máximo duas frases',
      'Um conceito por cartão. Varie o tipo: definição, exemplo, comparação, autor e ideia.',
    ].join('\n'),
  },
  multipla: {
    group: 'Exercícios',
    label: 'Questões de múltipla escolha',
    hint: 'Simulado no estilo de prova objetiva, com gabarito comentado.',
    keywords: 'questão pergunta simulado quiz teste objetiva alternativas enade concurso exercícios',
    instruction: [
      'Gere um SIMULADO com 10 questões de múltipla escolha, alternativas de (a) a (e).',
      'Misture níveis: 4 fáceis, 4 médias e 2 difíceis. Distratores plausíveis, sem alternativa absurda.',
      'Não coloque o gabarito junto das questões. No fim, numa seção "Gabarito comentado",',
      'dê a letra certa de cada questão e explique em uma ou duas frases por que ela está certa e as outras não.',
    ].join('\n'),
  },
  discursivas: {
    group: 'Exercícios',
    label: 'Questões discursivas',
    hint: 'Perguntas dissertativas como as de prova, com resposta modelo e critérios de correção.',
    keywords: 'questão pergunta dissertativa aberta escrita exercícios',
    instruction: [
      'Gere 5 QUESTÕES DISCURSIVAS no estilo de prova de faculdade, do mais simples ao mais exigente.',
      'Para cada questão, traga logo abaixo:',
      '- uma resposta modelo de um parágrafo;',
      '- os pontos que um professor esperaria ver na resposta, em tópicos.',
    ].join('\n'),
  },
  apresentacao: {
    group: 'Apresentar',
    label: 'Roteiro de apresentação',
    hint: 'Roteiro de fala com tempo estimado e perguntas prováveis da plateia.',
    keywords: 'seminário trabalho falar oral resumo',
    instruction: [
      'Gere um ROTEIRO DE APRESENTAÇÃO a partir do material.',
      'Estruture em blocos, cada um com: o que falar, o tempo estimado em minutos e um gancho de transição para o próximo.',
      'Escreva no tom de quem fala em público, não no tom de texto lido.',
      'Inclua no fim 5 perguntas que a plateia ou o professor provavelmente fará, com sugestão de resposta.',
      'Assuma 15 minutos de apresentação, salvo indicação contrária no material.',
    ].join('\n'),
  },
  slides: {
    group: 'Apresentar',
    label: 'Slides',
    hint: 'Slides em Markdown, uma ideia por slide, com notas do apresentador.',
    keywords: 'powerpoint apresentação seminário trabalho',
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
 * Quanto texto de material cabe num prompt. ~60 mil caracteres = umas 25-30
 * paginas de slides; cabe folgado nos chats (Claude, ChatGPT, Gemini) e no
 * modelo da geracao automatica.
 */
export const MAX_MATERIAL_CHARS = 60_000;
export const MAX_FOCUS_CHARS = 300;

/**
 * Material escolhido para a geracao.
 *  fileIds: ids marcados na tela; null = todos os anexos da materia.
 * Devolve os blocos de texto (dentro do orcamento) e o que ficou de fora.
 */
async function loadMaterial(subjectId, fileIds) {
  const rows = await all(`
    SELECT id, filename, mime, size, stored_as, extract_status, extracted_text
      FROM attachments
     WHERE subject_id = ? ${fileIds ? 'AND id = ANY(?::int[])' : ''}
     ORDER BY created_at`, ...(fileIds ? [subjectId, fileIds] : [subjectId]));

  const blocks = [];
  const included = [];
  const truncated = [];
  const unread = []; // escolhidos, mas sem texto (imagem sem IA, falha, sem texto)
  let budget = MAX_MATERIAL_CHARS;

  for (const row of rows) {
    const text = row.extract_status === 'ok' ? row.extracted_text : null;
    if (!text) { unread.push(row); continue; }
    if (budget <= 0) { truncated.push(row.filename); continue; }
    const piece = text.length > budget
      ? `${text.slice(0, budget)}\n[… o restante deste arquivo ficou de fora: o material passou do limite do prompt]`
      : text;
    if (text.length > budget) truncated.push(row.filename);
    budget -= piece.length;
    blocks.push(`### Arquivo: ${row.filename}\n${piece}`);
    included.push(row.filename);
  }
  return { blocks, included, truncated, unread };
}

/**
 * Prompt completo e o resumo do material usado.
 *  files: ids dos anexos marcados (null = todos); focus: texto livre opcional.
 *  attachedBinary: a chamada vai levar arquivos sem texto como anexo (geracao
 *  automatica) - entao o prompt avisa que ha material alem do texto.
 */
export async function buildPrompt(subjectId, preset, { files = null, focus = '', attachedBinary = false } = {}) {
  if (!isPreset(preset)) return null;
  const built = await buildContext(subjectId);
  if (!built) return null;

  const material = await loadMaterial(subjectId, files);
  const hasText = material.blocks.length > 0;
  const cleanFocus = String(focus || '').trim().slice(0, MAX_FOCUS_CHARS);

  let materialSection;
  if (hasText) {
    materialSection = [
      'Abaixo está o texto extraído do material da matéria (slides, PDFs, fotos do quadro).',
      'Baseie-se nele. Marcações como [p. 4] indicam a página ou o slide de origem.',
      ...(attachedBinary ? ['Há também arquivos anexados a esta mensagem: use-os junto com o texto.'] : []),
      '',
      material.blocks.join('\n\n'),
    ].join('\n');
  } else if (attachedBinary) {
    materialSection = 'O material da matéria (slides, PDFs, fotos do quadro) está anexado a esta mensagem. Baseie-se nele.';
  } else {
    materialSection = [
      'Não há material nesta chamada. Trabalhe com o contexto acima e,',
      'onde faltar conteúdo, aponte o que precisa ser preenchido em vez de inventar.',
    ].join(' ');
  }

  // Citar a fonte so faz sentido quando ha material para citar.
  const citation = hasText || attachedBinary ? [
    '',
    'FONTES',
    'Ao final de cada tópico, indique de onde veio entre parênteses, no formato (arquivo, p. N) — ex.: (Aula 3.pdf, p. 4).',
    'Se algo não estiver no material e vier do seu conhecimento, marque com (fora do material).',
  ] : [];

  const focusSection = cleanFocus ? [
    '',
    'FOCO',
    `Priorize: ${cleanFocus}`,
    'Trate o restante do material só como apoio.',
  ] : [];

  const prompt = [
    'Você é um assistente de estudos de uma turma de faculdade.',
    '',
    'CONTEXTO DA MATÉRIA',
    built.context,
    '',
    'MATERIAL',
    materialSection,
    ...focusSection,
    '',
    'TAREFA',
    PRESETS[preset].instruction,
    ...citation,
    '',
    'Escreva em português do Brasil, direto ao ponto, sem introdução nem despedida.',
    'Formate em Markdown.',
  ].join('\n');

  return {
    prompt,
    subject: built.subject,
    material: {
      included: material.included,
      truncated: material.truncated,
      unread: material.unread.map((r) => ({ id: r.id, filename: r.filename, status: r.extract_status })),
      unreadRows: material.unread, // so para a geracao automatica (manda como anexo)
      chars: material.blocks.reduce((sum, b) => sum + b.length, 0),
    },
  };
}

/** Titulo sugerido para o resumo gerado. */
export const presetTitle = (preset, subjectName) =>
  `${PRESETS[preset].label}: ${subjectName}`;
