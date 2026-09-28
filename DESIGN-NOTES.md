# Como o design system foi aplicado

Arquivos do sistema, mantidos na raiz e **não editados**:

| Arquivo | Papel |
| --- | --- |
| `DESIGN.md` | a referência de estilo (v0 by Vercel) |
| `variables.css` | os tokens em CSS — servidos ao navegador em `/css/variables.css` |
| `tokens.json` | os mesmos tokens em JSON, para ferramentas |
| `theme.css` | bloco `@theme` do Tailwind v4 — **não usado**, o app é CSS puro |

`public/css/styles.css` não redefine token nenhum: ele mapeia os tokens para os
papéis da interface (`--bg`, `--surface`, `--text`, `--cta-bg`…) e monta os
componentes a partir daí. Para trocar a identidade visual, basta trocar o
`variables.css`.

## O que foi aplicado

- **Cor** — paleta acromática: Canvas `#fafafa` no fundo, Paper White nas
  superfícies, Line `#eaeaea` nas divisórias, Ink `#171717` no texto e nos CTAs.
  Nenhuma cor saturada na interface.
- **Tipografia** — Geist em tudo (Geist Mono nas anotações técnicas: código da
  matéria, rótulos de tabela, horários). Escala e entrelinhas dos tokens, com o
  tracking negativo nos títulos de 24px+. Peso máximo 600 — `strong` e `b` foram
  redefinidos, porque o padrão do navegador é 700.
- **Formas** — 8px em botões, 12px em cards, inputs e modais, 9999px em pills.
  Nenhum outro raio.
- **Sombras** — `--shadow-subtle` nos cards (ela já traz o anel de 1px, então os
  cards não têm borda), `--shadow-xl` nos modais, nenhuma em botões e campos.
- **Hierarquia de ação** — sólido (primário), com borda (secundário), só texto
  (terciário).
- **Espaçamento e layout** — escala de spacing dos tokens, `--card-padding` nos
  cards, `--element-gap` entre etiquetas, conteúdo limitado a
  `--page-max-width` (1440px).
- Os ícones emoji do menu lateral saíram: o sistema é tipográfico e monocromático.

## A marca

O símbolo é um quadro de cantos arredondados (raio 5 de 24, na escala do sistema)
com o **"L" vazado em giz**. O vazado é um `fill-rule="evenodd"` num único
`<path>`: a superfície atrás aparece por dentro da letra, então a marca **se
inverte sozinha** entre os temas — quadro escuro com giz branco no tema claro,
quadro branco com letra escura no escuro. Uma cor só, um caminho só, legível a
26px na barra do topo.

O SVG está em `LOGO`, no topo de `public/js/app.js`, e é usado na barra e na tela
de entrada. O favicon é o mesmo desenho em duas cores fixas, embutido no
`index.html` (um ícone de aba não tem superfície atrás para vazar).

Logotipo = símbolo + "Lousa" em Geist 600 com tracking −0.4px.

## Movimento

Efeitos de hover, todos com a mesma linguagem: **o elemento sobe e acende na cor
do próprio conteúdo**.

| Onde | O que acontece |
| --- | --- |
| Cartão de matéria | sobe 6px, passa à frente dos vizinhos (`z-index`) e ganha anel + brilho na cor da matéria; a faixa do topo engrossa de 3 para 5px e acende junto |
| Linha de tarefa | mesma ideia em dose menor: sobe 3px e acende na cor da matéria |
| Cartão de resumo / bloco de aula | leve elevação e anel na cor da matéria do modal |
| "Nova matéria" | tracejado vira contínuo e acende em Ink |
| Item do menu lateral | inverte: fundo claro e texto escuro no tema escuro, fundo escuro e texto claro no tema claro |

O brilho sai sempre de `--card-color` / `--row-color`, que são a cor que a turma
escolheu para a matéria. Por isso o neon **não** quebra a regra acromática: é
cor de conteúdo, não de cromo. A intensidade muda por tema (`--glow-strength`:
30% no claro, 55% no escuro) porque fundo escuro precisa de mais brilho.

Quem tem "reduzir movimento" ligado no sistema recebe a interface sem transições
nem deslocamento — só os estados de cor.

## Três desvios deliberados

1. **Tema escuro.** O sistema documenta só o tema claro, que é o padrão do app.
   O tema escuro foi mantido (você o estava usando) como contraparte acromática
   dos mesmos papéis — nenhuma cor saturada nova, mesmos raios e tipografia.
   Se preferir só o tema claro, é remover o bloco `[data-theme="dark"]` e o
   botão de alternar.

2. **Uma cor semântica: `--alert`.** Prazo vencido ou de hoje é informação que
   precisa saltar. Urgência próxima (amanhã, dentro de 7 dias) usa contraste em
   vez de cor: chip preenchido em Ink. Tudo o mais é acromático.

3. **Cor das matérias.** Cada matéria tem a cor que a equipe escolhe, usada na
   faixa do cartão, no ponto ao lado do nome e na borda do bloco de aula. Isso
   segue a regra do sistema — "toda cor vem do conteúdo, não do cromo" — já que
   é dado do usuário, não decoração da interface. Vale o mesmo para as cores dos
   avatares.

## Fonte

A Geist é carregada do Google Fonts no `index.html`. Sem internet, o navegador
cai na pilha de fallback dos próprios tokens (system-ui / Segoe UI) e o layout
não muda — só o desenho das letras.
