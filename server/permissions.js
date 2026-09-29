/**
 * Catalogo de direitos. Cada perfil (tabela profiles) guarda a lista das
 * chaves que tem; o servidor confere a chave antes de cada acao e a tela usa
 * os rotulos para montar as caixas de marcar.
 *
 * Excluir/editar o que a propria pessoa criou e sempre permitido: os direitos
 * "... de outras pessoas" sao para mexer no que os outros criaram.
 */
export const PERMISSION_GROUPS = [
  {
    label: 'Semestres',
    items: [
      { key: 'semestres.criar', label: 'Criar semestres' },
      { key: 'semestres.editar', label: 'Editar e excluir semestres' },
    ],
  },
  {
    label: 'Matérias',
    items: [
      { key: 'materias.editar', label: 'Criar e editar matérias (inclusive imagens)' },
      { key: 'materias.excluir', label: 'Excluir matérias criadas por outras pessoas' },
    ],
  },
  {
    label: 'Tarefas',
    items: [
      { key: 'tarefas.editar', label: 'Criar e editar tarefas, prazos e responsáveis' },
      { key: 'tarefas.excluir', label: 'Excluir tarefas criadas por outras pessoas' },
    ],
  },
  {
    label: 'Resumos e material',
    items: [
      { key: 'resumos.editar', label: 'Criar resumos e anexar material' },
      { key: 'resumos.excluir', label: 'Editar e excluir resumos e anexos de outras pessoas' },
      { key: 'ia.gerar', label: 'Gerar resumos com IA' },
    ],
  },
  {
    label: 'Equipe',
    items: [
      { key: 'equipe.convidar', label: 'Convidar participantes' },
      { key: 'equipe.gerenciar', label: 'Criar, editar e remover contas' },
      { key: 'equipe.cargos', label: 'Gerenciar cargos e funções nas tarefas' },
      { key: 'perfis.gerenciar', label: 'Gerenciar perfis, direitos e hierarquia' },
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

/** O que o perfil Membro fazia antes de os perfis serem editaveis. */
export const MEMBER_DEFAULTS = [
  'semestres.criar', 'materias.editar', 'tarefas.editar', 'resumos.editar', 'ia.gerar',
];

/** Filtra para chaves conhecidas, sem repetir (o que vier de fora nao entra cru). */
export const cleanPermissions = (list) => [...new Set((Array.isArray(list) ? list : [])
  .filter((k) => ALL_PERMISSIONS.includes(k)))];
