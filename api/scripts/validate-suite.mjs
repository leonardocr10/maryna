// AI validation suite: runs every synthetic case (validation-cases.mjs) with the same prompts the server uses and checks
// the result: no numbers or performance categories, right gender, length in the reference range, required terms present,
// forbidden terms (diagnoses not in the data) absent. Run after changing prompts, guides or the model.
// Usage:  node --env-file=.env scripts/validate-suite.mjs [modelo] [--dry]      (without --dry it makes PAID API calls)
// The report goes to api/validacao/ (outside Git). Exit code 1 when a case fails.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import OpenAI from 'openai';
import {SYSTEM_INSTRUCTIONS, STYLE_EXAMPLE_NOTE, DEPTH, promptFor, instrumentGuides, depthRule, generationParams, examplesFor} from '../src/prompts.mjs';
import {CATEGORY_RULE, wordingProblems} from '../src/wording.mjs';
import {genderOf, genderRule, genderProblems} from '../src/gender.mjs';
import {CASES} from './validation-cases.mjs';

const args = process.argv.slice(2), dry = args.includes('--dry');
const model = args.find(a => !a.startsWith('--')) || process.env.OPENAI_MODEL || 'gpt-4.1';
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = t => (String(t || '').trim().match(/\S+/g) || []).length;

function request(c) {
  const g = instrumentGuides(JSON.stringify(c.source));
  const task = promptFor(c.section) + (g.text ? ' ' + g.text : '') + depthRule(c.section, g.multi) + ' ' + genderRule(genderOf(c.sex)) + ' ' + CATEGORY_RULE;
  const examples = examplesFor(c.section, g.examples);
  const data = {section: c.section, source: {trecho_da_secao: c.source, idade_em_anos: c.age}, additional_notes: '', instruction: 'Não altere escores nem classificações do arquivo base.', ...(examples.length ? {exemplo_aprovado_de_estilo: {aviso: STYLE_EXAMPLE_NOTE, textos: examples}} : {})};
  return {task, data, multi: g.multi};
}
function check(c, text, multi) {
  const problems = [];
  const w = wordingProblems(text, {categories: true, numbers: true}); if (w.length) problems.push('contém ' + w.join(' e '));
  const gp = genderProblems(genderOf(c.sex), text); if (gp.length) problems.push('gênero errado: ' + gp.join(', '));
  const [min, max] = multi ? DEPTH.multidimensional : DEPTH.interpretation, n = words(text);
  if (n < min * 0.7 || n > max * 1.3) problems.push(`${n} palavras (referência ${min}–${max})`);
  for (const t of c.mustMention || []) if (!fold(text).includes(fold(t))) problems.push(`não menciona "${t}"`);
  for (const t of c.mustNotMention || []) if (fold(text).includes(fold(t))) problems.push(`menciona "${t}" (não está nos dados)`);
  return {words: n, problems};
}

const client = dry ? null : new OpenAI({apiKey: process.env.OPENAI_API_KEY});
if (!dry && !process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY ausente no api/.env (ou use --dry).'); process.exit(1); }
const lines = [`# Validação da IA — ${new Date().toLocaleString('pt-BR')}`, '', `Modelo: ${dry ? '(simulação, sem chamada)' : model} · ${CASES.length} casos sintéticos`, ''];
let failed = 0, tokensIn = 0, tokensOut = 0;
for (const c of CASES) {
  const {task, data, multi} = request(c);
  if (dry) { lines.push(`## ${c.id} (${c.section})`, `Pedido montado: ${task.length + JSON.stringify(data).length} caracteres.`, ''); continue; }
  const t0 = Date.now();
  let text = '', result;
  try {
    const r = await client.responses.create({model, store: false, instructions: SYSTEM_INSTRUCTIONS, input: [{role: 'user', content: 'Responda somente em JSON. ' + JSON.stringify({task, source_data: data})}], ...generationParams(model)}, {timeout: 180000});
    tokensIn += r.usage?.input_tokens || 0; tokensOut += r.usage?.output_tokens || 0;
    text = JSON.parse(String(r.output_text || '').replace(/^```(?:json)?\s*|\s*```$/g, '')).text || '';
    result = check(c, text, multi);
  } catch (e) { result = {words: 0, problems: ['erro: ' + (e.message || e)]}; }
  if (result.problems.length) failed++;
  console.log(`${result.problems.length ? '✗' : '✓'} ${c.id}: ${result.words} palavras, ${((Date.now() - t0) / 1000).toFixed(1)} s${result.problems.length ? ' — ' + result.problems.join('; ') : ''}`);
  lines.push(`## ${result.problems.length ? '✗' : '✓'} ${c.id} (${c.section})`, '', result.problems.length ? '**Problemas:** ' + result.problems.join('; ') : 'Sem problemas.', '', '> ' + text.replace(/\n+/g, '\n> '), '');
}
if (!dry) lines.push(`Total: ${CASES.length - failed} de ${CASES.length} casos ok · tokens ${tokensIn} de entrada, ${tokensOut} de saída.`);
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'validacao');
fs.mkdirSync(dir, {recursive: true});
const out = path.join(dir, `relatorio-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`);
fs.writeFileSync(out, lines.join('\n'));
console.log(`${dry ? 'Simulação' : 'Validação'} concluída. Relatório: ${out}`);
process.exit(failed ? 1 : 0);
