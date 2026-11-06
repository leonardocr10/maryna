// Manual quality check of the interpretation prompt with the synthetic WAIS-III example (no patient data).
// Usage: node --env-file=.env scripts/validate-interpretation.mjs [model ...]   (makes paid API calls)
import OpenAI from 'openai';
import {SYSTEM_INSTRUCTIONS, STYLE_EXAMPLE_NOTE, promptFor, instrumentGuides, depthRule, generationParams} from '../src/prompts.mjs';
import {CATEGORY_RULE, wordingProblems} from '../src/wording.mjs';
import {genderRule} from '../src/gender.mjs';

const rows = [['WAIS-III', 'SOMA DOS ESCORES T', 'QI', 'PERCENTIL', 'CLASSIFICAÇÃO'],
  ['Compreensão verbal', '24', '90', '25', 'Média'], ['Organização perceptual', '38', '115', '84', 'Média Superior'],
  ['Memória operacional', '22', '84', '14', 'Média Inferior'], ['Velocidade de processamento', '12', '79', '8', 'Limítrofe'],
  ['QIT', '112', '101', '53', 'Média']];
// PROFILE=b: a different synthetic profile, to check the style example is not copied.
if (process.env.PROFILE === 'b') rows.splice(1, 5, ['Compreensão verbal', '40', '118', '88', 'Média Superior'], ['Organização perceptual', '20', '82', '12', 'Média Inferior'],
  ['Memória operacional', '30', '104', '61', 'Média'], ['Velocidade de processamento', '27', '100', '50', 'Média'], ['QIT', '117', '102', '55', 'Média']);
const source = {trecho_da_secao: [{type: 'table', rows}, {type: 'p', text: 'Tabela 1. Resultados dos índices avaliados.'}]};
const g = instrumentGuides(JSON.stringify(source.trecho_da_secao));
const task = promptFor('inteligencia') + ' ' + g.text + depthRule('inteligencia', g.multi) + ' ' + genderRule('f') + ' ' + CATEGORY_RULE;
const client = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
for (const model of process.argv.slice(2).length ? process.argv.slice(2) : ['gpt-6.1-terra']) {
  const t = Date.now();
  const r = await client.responses.create({model, store: false, instructions: SYSTEM_INSTRUCTIONS,
    input: [{role: 'user', content: 'Responda somente em JSON. ' + JSON.stringify({task, source_data: {section: 'inteligencia', source: {...source, idade_em_anos: '34 anos'}, exemplo_aprovado_de_estilo: {aviso: STYLE_EXAMPLE_NOTE, textos: g.examples}}})}], ...generationParams(model)});
  const text = JSON.parse(r.output_text).text;
  console.log(`\n=== ${model} | ${text.split(/\s+/).length} palavras | ${Date.now() - t} ms | tokens in ${r.usage.input_tokens} out ${r.usage.output_tokens} | problemas: ${wordingProblems(text, {numbers: true}).join('; ') || 'nenhum'}\n${text}`);
}
