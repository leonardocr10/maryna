// Pieces of the anamnesis comparison (scripts/compare-anamnesis.mjs), kept apart so the tests can run them without the API.
// A = previous prompt and settings, B = new prompt with the low-cost settings, C = new prompt with medium reasoning.
import {ANAMNESIS, ANAMNESIS_V1, ANAMNESIS_SYSTEM, SYSTEM_INSTRUCTIONS, GENERATION, depthRule, generationParams} from '../src/prompts.mjs';
import {genderOf, genderRule} from '../src/gender.mjs';
import {metalanguageTerms} from '../src/wording.mjs';

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = t => (String(t || '').trim().match(/\S+/g) || []).length;

/** The three configurations; `extraModel` adds an optional D run (only when asked on the command line). */
export function configs(model, extraModel) {
  const oldDepth = ' Extensão de referência: cerca de 250 a 600 palavras, proporcional à quantidade e à complexidade dos dados; a qualidade e a precisão clínica têm prioridade sobre a contagem, mas não entregue um texto curto ou superficial quando houver dados para aprofundar.';
  const list = [
    {id: 'A', label: 'Configuração anterior', model, system: SYSTEM_INSTRUCTIONS, task: ANAMNESIS_V1 + oldDepth, sourceKey: 'anotacoes_anamnese', params: generationParams(model, 'interpretation', {reasoningEffort: GENERATION.reasoningEffort, maxOutputTokens: GENERATION.maxOutputTokensReasoning}), withScoresRule: true},
    {id: 'B', label: 'Prompt revisado, raciocínio low', model, system: ANAMNESIS_SYSTEM, task: ANAMNESIS + depthRule('anamnesis'), sourceKey: 'relato_da_entrevista', params: generationParams(model, 'anamnesis', {reasoningEffort: 'low'})},
    {id: 'C', label: 'Prompt revisado, raciocínio medium', model, system: ANAMNESIS_SYSTEM, task: ANAMNESIS + depthRule('anamnesis'), sourceKey: 'relato_da_entrevista', params: generationParams(model, 'anamnesis', {reasoningEffort: 'medium', maxOutputTokens: 16000})},
  ];
  if (extraModel) list.push({...list[1], id: 'D', label: 'Prompt revisado em ' + extraModel, model: extraModel, params: generationParams(extraModel, 'anamnesis')});
  return list;
}

/** Same request shape the server sends for the anamnesis. */
export function request(cfg, c) {
  const task = cfg.task + ' ' + genderRule(genderOf(c.sex));
  const data = {section: 'anamnesis', source: {[cfg.sourceKey]: c.notes}, additional_notes: '', ...(cfg.withScoresRule ? {instruction: 'Não altere escores nem classificações do arquivo base.'} : {})};
  return {model: cfg.model, store: false, instructions: cfg.system, input: [{role: 'user', content: 'Responda somente em JSON. ' + JSON.stringify({task, source_data: data})}], ...cfg.params};
}

/**
 * Objective checks of one text. Length is reported, never used as a score by itself.
 * facts: terms from the notes that should survive; invented: terms that are not in the notes and must not appear.
 */
export function score(c, text) {
  const t = fold(text);
  const kept = (c.facts || []).filter(f => t.includes(fold(f)));
  const invented = (c.invented || []).filter(f => t.includes(fold(f)));
  const topics = (String(text).match(/^#{1,3}\s+\S.*$/gm) || []).length;
  const paragraphs = String(text).split(/\n\s*\n/).filter(p => p.trim() && !/^#/.test(p.trim()));
  const sentences = String(text).replace(/^#.*$/gm, '').split(/(?<=[.!?])\s+/).filter(s => s.trim());
  const shortSentences = sentences.filter(s => words(s) < 8).length;
  return {
    words: words(text), topics, paragraphs: paragraphs.length,
    facts_kept: `${kept.length}/${(c.facts || []).length}`, facts_missing: (c.facts || []).filter(f => !kept.includes(f)),
    invented, metalanguage: metalanguageTerms(text),
    bullets: (String(text).match(/^\s*(?:[-*•]|\d+[.)])\s+/gm) || []).length,
    short_sentence_ratio: sentences.length ? Math.round(shortSentences / sentences.length * 100) : 0,
  };
}

/** USD per 1M tokens [input, cached, output]; OPENAI_PRICES (same JSON as the server) overrides. */
export function cost(model, usage) {
  let prices = {'gpt-6.1-terra': [1.00, 0.05, 5.00], 'gpt-6.1-sol': [2.00, 0.10, 10.00]};
  try { prices = {...prices, ...JSON.parse(process.env.OPENAI_PRICES || '{}')}; } catch {}
  const k = Object.keys(prices).sort((a, b) => b.length - a.length).find(k => String(model).startsWith(k));
  if (!k) return null;
  const [i, c, o] = prices[k], u = usage || {}, cached = u.input_tokens_details?.cached_tokens || 0;
  return (((u.input_tokens || 0) - cached) * i + cached * c + (u.output_tokens || 0) * o) / 1e6;
}
