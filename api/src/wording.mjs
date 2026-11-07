// Wording rules for AI-written report text: no normative categories and, in interpretations, no numeric results.

// "ensino superior", "membros inferiores" etc. are ordinary words, not performance categories.
const NOT_A_CATEGORY = '(?<!ensino\\s)(?<!curso\\s)(?<!n[ií]vel\\s)(?<!educa[cç][aã]o\\s)(?<!forma[cç][aã]o\\s)(?<!membros\\s)(?<!membro\\s)';
const PERFORMANCE = '(?:desempenho|resultados?|rendimento|pontua[cç][aã]o|pontua[cç][oõ]es|escores?|n[ií]vel|n[ií]veis|funcionamento|capacidade)';
const CATEGORY_RE = new RegExp([
  `\\b${NOT_A_CATEGORY}(?:muito\\s+)?(?:inferior|inferiores|superior|superiores)\\b`,
  '\\b(?:na\\s+|da\\s+|pela\\s+)?m[eé]dia\\b',
  '\\b(?:lim[ií]trofes?|deficit[aá]ri[oa]s?|rebaixad[oa]s?)\\b',
  '\\b(?:abaixo|acima|dentro)\\s+d[oa]\\s+(?:esperad[oa]|m[eé]dia|norma|padr[aã]o)\\b',
  '\\besperad[oa]\\s+para\\s+a\\s+(?:idade|faixa)\\b',
  '\\bfaixa\\s+(?:et[aá]ria\\s+)?\\p{L}+',
  '\\bpercentis?\\b|\\bpercentil\\b',
  `\\b${PERFORMANCE}\\s+(?:muito\\s+)?(?:baix[oa]s?|alt[oa]s?|elevad[oa]s?|frac[oa]s?)\\b`,
  `\\b(?:baix[oa]s?|alt[oa]s?|elevad[oa]s?|frac[oa]s?)\\s+${PERFORMANCE}\\b`,
].join('|'), 'giu');

// Digits that are results; names such as WISC-IV, DIVA-5, "Teste dos 5 Dígitos", ages and [PESSOA_1] are fine.
const NUMBER_RE = /(?<![\w\-\/])\d+(?:[.,]\d+)?(?![\w\-ºª°]|\s*(?:d[ií]gitos|anos?|meses|m[eê]s)\b)/gi;

/** Rule appended to the prompt of every section except the anamnesis, which must stay faithful to the report. */
export const CATEGORY_RULE = 'PROIBIDO usar categorias de desempenho no texto, mesmo como palavra solta: "inferior", "superior", "muito inferior", "média", "na média", "limítrofe", "deficitário", "rebaixado", "baixo", "alto", "elevado", "fraco", "faixa", "abaixo/acima/dentro do esperado". Em vez de classificar, descreva o que a pessoa consegue fazer e onde tem dificuldade, e compare os domínios entre si (ex.: "demonstrou dificuldade para reter informações verbais ao longo das tentativas", "recursos preservados para...", "maior facilidade em..."). Expressões que não são categoria, como "ensino superior", são permitidas.';

/** Same intent when the psychologist wrote the instruction: what she asks for comes first. */
export const CATEGORY_RULE_SOFT = 'Classificações, categorias e pontuações: se a psicóloga pedir, cite-as exatamente como constam nas tabelas, sem omitir nenhuma; se ela não tratar disso, descreva o que a pessoa consegue fazer e onde tem dificuldade, sem usar categorias como "inferior", "superior" ou "média".';

// Transcription/meta wording ("a anotação registra", "consta o registro"): the text should narrate, not describe the notes.
const META_RE = /\b(?:a|as|nas?|segundo\s+as?|conforme\s+as?)\s+anota[cç](?:[aã]o|[oõ]es)\b|\bconsta(?:m)?\s+(?:o\s+|um\s+)?registros?\b|\bconsta(?:m)?\s+que\b|\bh[aá]\s+registros?\s+de\b|\bo\s+texto\s+(?:apresenta|informa|registra)\b|\bas\s+informa[cç][oõ]es\s+dispon[ií]veis\s+(?:indicam|apontam|sugerem)\b|\bfoi\s+registrad[oa]\s+que\b/giu;
export const metalanguageTerms = text => unique(String(text || '').match(META_RE));

const unique = list => [...new Set((list || []).map(x => x.replace(/\s+/g, ' ').trim().toLowerCase()))];
export const categoryTerms = text => unique(String(text || '').match(CATEGORY_RE));
export const numberTerms = text => unique(String(text || '').match(NUMBER_RE));

/** What the section must not contain. Anamnesis: nothing checked. Interpretations: categories and numbers. Others: categories. */
export function wordingProblems(text, {categories = true, numbers = false} = {}) {
  const out = [];
  const n = numbers ? numberTerms(text) : [], c = categories ? categoryTerms(text) : [];
  if (n.length) out.push('números (' + n.slice(0, 8).join(', ') + ')');
  if (c.length) out.push('categorias de desempenho (' + c.slice(0, 8).join(', ') + ')');
  return out;
}

// A psychologist's instruction only lifts the no-numbers/no-categories rule when it asks for them in so many words
// ("cite os escores", "incluir classificação"); "sem classificação" or an instruction that does not mention them keeps it.
const SCORE_WORDS = String.raw`(?:classifica[cç][aãoõ]\p{L}*|escores?|percentis?|percentil|pontua[cç][aãoõ]\p{L}*|n[uú]meros?|valores?|QIs?|resultados num[eé]ricos)`;
const ASK_VERBS = String.raw`(?:com|incluir|inclua|incluindo|citar|cite|citando|colocar|coloque|mostrar|mostre|informar|informe|apresentar|apresente|mencionar|mencione|manter|mantenha)`;
const ASK_RE = new RegExp(String.raw`(?<!(?:^|\s)(?:sem|n[aã]o)\s(?:\p{L}+\s){0,2})(?<!\p{L})${ASK_VERBS}\s+(?:\p{L}+\s+){0,2}?${SCORE_WORDS}`, 'iu');
export const asksForScores = text => ASK_RE.test(String(text || '').normalize('NFC'));
