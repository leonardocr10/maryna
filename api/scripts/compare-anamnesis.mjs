// Anamnesis comparison: A (previous prompt/settings) x B (new prompt, reasoning low) x C (new prompt, reasoning medium),
// same synthetic notes (scripts/anamnesis-cases.mjs), same model. Report in api/validacao/ (outside Git).
//
// Default is a SIMULATION (no API call, no cost): shows each request and its size.
// Paid run, limited:   node --env-file=.env scripts/compare-anamnesis.mjs --pagar [modelo] [--casos=1]
//   3 calls per case (A, B, C); at most 3 cases per run.
// Optional extra model (never automatic): add --modelo-extra=<modelo> to run a D column with the new prompt.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import OpenAI from 'openai';
import {ANAMNESIS_CASES} from './anamnesis-cases.mjs';
import {configs, request, score, cost} from './anamnesis-compare-lib.mjs';

const args = process.argv.slice(2);
const paid = args.includes('--pagar');
const model = args.find(a => !a.startsWith('--')) || 'gpt-6.1-terra';
const extra = (args.find(a => a.startsWith('--modelo-extra=')) || '').split('=')[1] || '';
const howMany = Math.min(3, Math.max(1, Number((args.find(a => a.startsWith('--casos=')) || '').split('=')[1]) || 1));
const cases = ANAMNESIS_CASES.slice(0, howMany);
if (paid && !process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY ausente no api/.env.'); process.exit(1); }
const client = paid ? new OpenAI({apiKey: process.env.OPENAI_API_KEY}) : null;

const lines = [`# Comparação da anamnese — ${new Date().toLocaleString('pt-BR')}`, '', `Modelo: ${model}${extra ? ' (+ ' + extra + ' em D)' : ''} · ${paid ? 'chamadas reais' : 'simulação, sem chamada'} · ${cases.length} caso(s) sintético(s)`, ''];
const totals = {};
for (const c of cases) {
  lines.push(`## Caso ${c.id}`, '');
  for (const cfg of configs(model, extra)) {
    const req = request(cfg, c);
    const head = `${cfg.id} — ${cfg.label} (esforço ${req.reasoning?.effort || '—'}, verbosidade ${req.text?.verbosity || '—'}, limite ${req.max_output_tokens})`;
    if (!paid) { lines.push(`### ${head}`, '', `Pedido: ${req.instructions.length + req.input[0].content.length} caracteres.`, ''); console.log(head + ': simulado'); continue; }
    const t0 = Date.now();
    try {
      const r = await client.responses.create(req, {timeout: 180000, maxRetries: 0});
      const ms = Date.now() - t0, u = r.usage || {};
      const text = r.status === 'incomplete' ? '' : (JSON.parse(String(r.output_text || '').replace(/^```(?:json)?\s*|\s*```$/g, '')).text || '');
      const s = score(c, text), usd = cost(cfg.model, u);
      const t = totals[cfg.id] ||= {usd: 0, ms: 0, n: 0, input: 0, output: 0, reasoning: 0};
      Object.assign(t, {usd: t.usd + (usd || 0), ms: t.ms + ms, n: t.n + 1, input: t.input + (u.input_tokens || 0), output: t.output + (u.output_tokens || 0), reasoning: t.reasoning + (u.output_tokens_details?.reasoning_tokens || 0)});
      const row = `${s.words} palavras · ${s.topics} tópicos · ${s.paragraphs} parágrafos · fatos mantidos ${s.facts_kept} · frases curtas ${s.short_sentence_ratio}% · inventado: ${s.invented.join(', ') || 'nada'} · metalinguagem: ${s.metalanguage.join(', ') || 'nenhuma'} · marcadores: ${s.bullets}`;
      const tok = `tokens: ${u.input_tokens || 0} entrada (${u.input_tokens_details?.cached_tokens || 0} em cache), ${u.output_tokens || 0} saída (${u.output_tokens_details?.reasoning_tokens || 0} raciocínio) · ${(ms / 1000).toFixed(1)} s · US$ ${usd == null ? '?' : usd.toFixed(4)}${r.status === 'incomplete' ? ' · CORTADA' : ''}`;
      console.log(`${cfg.id}: ${row} | ${tok}`);
      lines.push(`### ${head}`, '', row, '', tok, '', s.facts_missing.length ? 'Fatos ausentes: ' + s.facts_missing.join(', ') : 'Todos os fatos de controle presentes.', '', '> ' + text.replace(/\n/g, '\n> '), '');
    } catch (e) { console.log(`${cfg.id}: erro ${e.status || ''} ${e.message || e}`); lines.push(`### ${head}`, '', 'Erro: ' + (e.message || e), ''); }
  }
}
if (paid) {
  lines.push('## Resumo por configuração', '', '| Config | Chamadas | Entrada | Saída | Raciocínio | Tempo médio | Custo médio (US$) |', '|---|---|---|---|---|---|---|');
  for (const [id, t] of Object.entries(totals)) lines.push(`| ${id} | ${t.n} | ${t.input} | ${t.output} | ${t.reasoning} | ${(t.ms / t.n / 1000).toFixed(1)} s | ${(t.usd / t.n).toFixed(4)} |`);
  lines.push('', 'Leia os textos: fidelidade, naturalidade e desenvolvimento valem mais que o número de palavras.');
}
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'validacao');
fs.mkdirSync(dir, {recursive: true});
const out = path.join(dir, `anamnese-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`);
fs.writeFileSync(out, lines.join('\n'));
console.log((paid ? 'Comparação' : 'Simulação') + ' concluída. Relatório: ' + out);
