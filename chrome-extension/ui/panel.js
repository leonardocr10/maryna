// Panel shown inside the NeuroLaudos IA page (extension iframe). Talks only to the extension's worker.
import {STORAGE_KEY, ITEM, MODES, STEP_LABEL, FINAL_ITEM, KIND} from '../modules/constants.js';
import {progress, summarize, skipReason} from '../modules/task-queue.js';

const tabId = Number(new URLSearchParams(location.search).get('tab'));
const $ = s => document.querySelector(s);
const body = $('#body');
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const ask = msg => chrome.runtime.sendMessage({...msg, tabId}).catch(e => ({ok: false, error: {message: String(e?.message || e)}}));

let run = null, settings = null, scan = null, scanErr = null, showDetails = false, timer = null, choice = null, busy = false, flash = null, pending = null;

/** In-panel confirmation (native dialogs are unreliable inside a frame of another site). */
function confirmBox(lines, ok, onOk) { pending = {lines, ok, onOk}; render(); }
function renderConfirm() {
  body.innerHTML = `<div class="alert warn" role="alertdialog" aria-labelledby="cf-t"><p id="cf-t"><b>${esc(pending.lines[0])}</b></p>${pending.lines.slice(1).map(l => `<small style="display:block;margin-top:4px">${esc(l)}</small>`).join('')}</div><div class="row"><span class="grow"></span><button class="btn" id="cf-no">Cancelar</button><button class="btn pri" id="cf-ok">${esc(pending.ok)}</button></div>`;
  $('#cf-no').onclick = () => { pending = null; render(); };
  $('#cf-ok').onclick = () => { const f = pending.onOk; pending = null; render(); f(); };
  $('#cf-ok').focus();
}

// ---------- frame size / close ----------
const post = m => parent.postMessage({nlx: m.nlx, ...m}, '*');
new ResizeObserver(() => post({nlx: 'height', h: Math.ceil(document.querySelector('.pn').getBoundingClientRect().height) + 2})).observe(document.body);
$('#close').onclick = () => post({nlx: 'close'});

// ---------- data ----------
async function load() {
  const r = await ask({type: 'run.get'});
  run = r.run || null; settings = r.settings || {};
  if (!mineActive()) await rescan();
  render();
}
async function rescan() {
  scanErr = null;
  const r = await ask({type: 'scan'});
  if (r?.ok) { scan = r; choice ||= defaults(); }
  else { scan = null; scanErr = r?.error || {message: errText(r?.code)}; }
}
function defaults() {
  const s = settings || {};
  return {mode: s.defaultMode || 'auto', existing: s.existing || 'skip', onError: s.onError || 'pause', sendImages: s.sendImages ?? true, sameChat: !!s.sameChat, selected: null};
}
const mineActive = () => run && run.nlTabId === tabId && (run.status === 'running' || run.status === 'paused');
const otherActive = () => run && run.nlTabId !== tabId && (run.status === 'running' || run.status === 'paused');
const errText = code => ({nl_not_logged: 'Entre no NeuroLaudos IA para usar o Modo automático.', nl_not_review: 'Abra a avaliação na tela Conferir seções.', nl_selector: 'A lista de seções não foi encontrada nesta tela.'}[code] || 'Não foi possível ler as seções desta tela.');

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch[STORAGE_KEY]) return;
  run = ch[STORAGE_KEY].newValue || null;
  render();
});

// ---------- views ----------
function render() {
  clearInterval(timer);
  if (pending) return renderConfirm();
  if (otherActive()) return renderOther();
  if (run && run.nlTabId === tabId && run.status !== 'stopped' && run.status !== 'idle') return renderRun();
  if (run && run.nlTabId === tabId && run.status === 'stopped') return renderRun();
  return renderSetup();
}

function renderOther() {
  body.innerHTML = `<div class="alert warn"><p><b>Já existe uma execução em andamento</b> em outra aba${run.evaluationId ? ' (outra avaliação ou outra aba)' : ''}.</p><small>Só uma execução por vez. Volte à aba da execução ou pare-a para começar aqui.</small></div>
  <div class="row"><button class="btn" id="goto">Ir para a execução</button><button class="btn dan" id="stop">Parar a outra execução</button></div>`;
  $('#goto').onclick = () => ask({type: 'run.focus', which: 'nl'});
  $('#stop').onclick = async () => { await ask({type: 'run.stop'}); await rescan(); render(); };
}

function renderSetup() {
  $('#sub').textContent = 'Escolha as seções e como gerar os rascunhos com o ChatGPT e o plugin NeuroLaudos IA';
  if (scanErr || !scan) {
    body.innerHTML = `<div class="alert warn"><p>${esc(scanErr?.message || 'Lendo as seções…')}</p>${scanErr?.hint ? `<small>${esc(scanErr.hint)}</small>` : ''}</div><div class="row"><button class="btn" id="re">Ler de novo</button></div>`;
    $('#re').onclick = async () => { await rescan(); render(); };
    return;
  }
  const c = choice;
  const elig = scan.sections.filter(s => !skipReason(s, c.existing, null));
  if (!c.selected) c.selected = elig.map(s => s.key);
  const sm = summarize(scan.sections.map(s => ({...s, status: 'pending'})), scan);
  body.innerHTML = `
  ${flash ? `<div class="alert ${flash.kind}"><p>${esc(flash.message)}</p>${flash.hint ? `<small>${esc(flash.hint)}</small>` : ''}</div>` : ''}
  <div class="kv" aria-label="Resumo das seções">
    <div><b>${sm.total}</b><span>seções</span></div><div><b>${sm.eligible}</b><span>elegíveis</span></div>
    <div><b>${sm.fixed}</b><span>texto fixo (ignoradas)</span></div><div><b>${sm.withText}</b><span>já com texto</span></div>
  </div>
  ${scan.readOnly ? '<div class="alert warn"><p>Avaliação somente leitura: nada a gerar.</p></div>' : ''}
  ${scan.compat ? '<div class="alert warn"><p>Modo de compatibilidade</p><small>Esta versão do NeuroLaudos IA não publica os atributos data-nl-*. O tipo de cada seção é conferido ao abri-la.</small></div>' : ''}
  <fieldset><legend>Modo</legend>
    ${Object.entries(MODES).map(([k, v]) => `<label><input type="radio" name="mode" value="${k}" ${c.mode === k ? 'checked' : ''}> <span>${v}<small>${{auto: 'Percorre todas as seções escolhidas; para só em erro ou autorização.', assisted: 'Uma seção por vez: você confere e clica em Continuar.', simulation: 'Confere seletores e fluxo. Não prepara tarefa, não envia nada, não salva.'}[k]}</small></span></label>`).join('')}
  </fieldset>
  <fieldset><legend>Seções que já têm texto</legend>
    <label><input type="radio" name="existing" value="skip" ${c.existing === 'skip' ? 'checked' : ''}> <span>Não mexer (padrão)</span></label>
    <label><input type="radio" name="existing" value="draft" ${c.existing === 'draft' ? 'checked' : ''}> <span>Gerar rascunho mesmo assim<small>O texto atual não é substituído: o rascunho espera a sua confirmação na seção.</small></span></label>
  </fieldset>
  <fieldset><legend>Se uma seção falhar</legend>
    <label><input type="radio" name="onError" value="pause" ${c.onError === 'pause' ? 'checked' : ''}> <span>Pausar e perguntar (padrão)</span></label>
    <label><input type="radio" name="onError" value="next" ${c.onError === 'next' ? 'checked' : ''}> <span>Registrar o erro e seguir para a próxima</span></label>
  </fieldset>
  <label><input type="checkbox" id="same" ${c.sameChat ? 'checked' : ''}> <span>Usar uma única conversa do ChatGPT para todas as seções<small>O @NeuroLaudos IA vai só na primeira mensagem. Atenção: as seções anteriores ficam no histórico da conversa e o ChatGPT pode usá-las; desligado, cada seção abre conversa nova só com os próprios dados.</small></span></label>
  <label><input type="checkbox" id="imgs" ${c.sendImages ? 'checked' : ''}> <span>Enviar as imagens das seções (tabelas coladas como figura)<small>Imagens não têm nomes trocados por marcadores: confira se não mostram dados do paciente.</small></span></label>
  <fieldset><legend>Seções desta avaliação (na ordem do documento)</legend>
    <div class="secs">${scan.sections.map(s => { const why = skipReason(s, c.existing, null); return `<label class="${why ? 'off' : ''}"><input type="checkbox" data-k="${esc(s.key)}" ${why ? 'disabled' : c.selected.includes(s.key) ? 'checked' : ''}> <span>${esc(s.name)}${why ? `<small>${esc(why)}</small>` : ''}</span></label>`; }).join('')}</div>
  </fieldset>
  <p class="note">A extensão nunca aprova textos, nunca clica em "Aprovar todas" e nunca autoriza o plugin por você. O conteúdo do ChatGPT é rascunho para sua revisão.</p>
  <div class="acts"><span class="grow"></span><button class="btn" id="re">Ler de novo</button><button class="btn pri" id="start" ${scan.readOnly || busy ? 'disabled' : ''}>Iniciar</button></div>`;
  body.querySelectorAll('input[name="mode"]').forEach(i => i.onchange = () => { c.mode = i.value; });
  body.querySelectorAll('input[name="existing"]').forEach(i => i.onchange = () => { c.existing = i.value; c.selected = null; render(); });
  body.querySelectorAll('input[name="onError"]').forEach(i => i.onchange = () => { c.onError = i.value; });
  $('#imgs').onchange = e => { c.sendImages = e.target.checked; };
  $('#same').onchange = e => { c.sameChat = e.target.checked; };
  body.querySelectorAll('.secs input[data-k]').forEach(i => i.onchange = () => { const k = i.dataset.k; c.selected = i.checked ? [...new Set([...c.selected, k])] : c.selected.filter(x => x !== k); });
  $('#re').onclick = async () => { await rescan(); render(); };
  $('#start').onclick = start;
}

async function start() {
  const c = choice;
  const n = c.selected.length;
  if (!n) { flash = {kind: 'warn', message: 'Escolha ao menos uma seção.'}; return render(); }
  const names = scan.sections.filter(s => c.selected.includes(s.key)).map(s => s.name).join(', ');
  const lines = c.mode === 'simulation'
    ? [`Simular ${n} ${n === 1 ? 'seção' : 'seções'}?`, 'Nada será preparado, enviado ou salvo.', names]
    : [`Gerar rascunhos de ${n} ${n === 1 ? 'seção' : 'seções'} com o ChatGPT (modo ${MODES[c.mode].toLowerCase()})?`, names, `Seções com texto: ${c.existing === 'skip' ? 'não mexer' : 'rascunho aguarda sua confirmação'} · Erro: ${c.onError === 'pause' ? 'pausar' : 'seguir'} · Imagens: ${c.sendImages ? 'enviar' : 'não enviar'} · Conversa: ${c.sameChat ? 'uma só' : 'nova por seção'}`, 'As autorizações do ChatGPT continuam com você.'];
  confirmBox(lines, 'Iniciar', () => go(c));
}
async function go(c) {
  busy = true; flash = null; render();
  const r = await ask({type: 'run.start', mode: c.mode, existing: c.existing, onError: c.onError, sendImages: c.sendImages, sameChat: c.sameChat, selected: c.selected});
  busy = false;
  if (!r?.ok) { flash = {kind: 'err', ...(r?.error || {message: 'Não foi possível iniciar.'})}; render(); }
}

const ICON = {
  pause: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
  doc: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};
const DOT = '<svg class="k" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><svg class="w" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M12 6v8M12 18.5v.5"/></svg><svg class="x" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

const dotClass = (it, current) => it.status === 'received' || it.status === 'simulated' ? 'ok' : it.status === 'needs_review' ? 'warn' : it.status === 'error' || it.status === 'expired' ? 'err' : it.status === 'skipped' ? 'skip' : current && run.status === 'running' ? 'run' : '';
const elapsed = iso => { const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso || Date.now())) / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
/** What the current section is doing, in the words of the panel. */
function liveLabel(it) {
  if (run.status === 'paused') return 'Pausada';
  if (it.status === 'waiting_auth') return 'Aguardando sua autorização no ChatGPT';
  if (it.status === 'confirming' || it.step === 'confirm') return 'Conferindo o rascunho…';
  if (it.status === 'processing' || it.step === 'wait_chatgpt') return 'ChatGPT redigindo…';
  if (['chatgpt_new', 'plugin', 'insert', 'send'].includes(it.step)) return 'Enviando para o ChatGPT…';
  if (run.mode === 'simulation') return 'Conferindo seletores…';
  return 'Preparando tarefa…';
}
/** "8 de 16 seções": every section of the evaluation; ignored ones (fixed text, approved...) count as done. */
function overall(items) {
  const done = items.filter(i => FINAL_ITEM.includes(i.status) || i.status === 'error' || i.status === 'expired').length;
  return {done, total: items.length, pct: items.length ? Math.round(done * 100 / items.length) : 0};
}

function renderRun() {
  const p = overall(run.items);
  const sm = summarize(run.items, null);
  const it = run.items[run.current];
  const work = run.items.filter(i => i.status !== 'skipped' || i.reason === 'Pulada por você');
  const skipped = run.items.filter(i => i.status === 'skipped' && i.reason !== 'Pulada por você');
  const active = run.status === 'running' || run.status === 'paused';
  const pause = run.status === 'paused' ? run.pause : null;
  $('#sub').textContent = run.status === 'done' ? (run.mode === 'simulation' ? 'Simulação concluída: nada foi enviado nem salvo' : 'Rascunhos gerados com o ChatGPT e o plugin NeuroLaudos IA') : run.status === 'stopped' ? 'Execução parada; os rascunhos recebidos ficam no NeuroLaudos IA' : run.mode === 'simulation' ? 'Simulação: conferindo a tela e o ChatGPT, sem enviar nada' : 'Gerando rascunhos das seções com o ChatGPT e o plugin NeuroLaudos IA';
  const status = i => i === it && active ? liveLabel(i) : i.status === 'pending' ? 'Aguardando' : ITEM[i.status] || i.status;
  body.innerHTML = `
  <div class="box">
    <div class="prog"><span>Progresso da avaliação</span><span>${p.done} de ${p.total} seções (${p.pct}%)</span></div>
    <div class="bar" role="progressbar" aria-label="Progresso da avaliação" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}"><i style="width:${p.pct}%"></i></div>
  </div>
  ${it && active ? `<div class="cur"><span class="ci" aria-hidden="true">${ICON.gear}</span><div class="grow"><small>Seção atual</small><b>${esc(it.name)}</b>${it.code ? `<span class="code" title="Código da tarefa">${esc(it.code)}</span>` : ''}</div><span class="timer" title="Tempo nesta seção">${ICON.clock}<span id="tm">${elapsed(it.startedAt || it.updatedAt)}</span></span></div>` : ''}
  ${pause ? `<div class="alert ${pause.code === 'assisted' || pause.code === 'user' ? 'warn' : 'err'}" role="alert"><p><b>${esc(pause.section ? pause.section + ': ' : '')}${esc(pause.message)}</b></p>${pause.stepLabel ? `<small>Etapa: ${esc(pause.stepLabel)}. </small>` : ''}<small>${esc(pause.hint || '')}</small></div>` : ''}
  ${run.status === 'done' ? `<div class="alert ok"><p><b>${run.mode === 'simulation' ? 'Simulação concluída.' : 'Execução concluída.'}</b></p><small>${run.mode === 'simulation' ? 'Veja em Ver detalhes o resultado de cada verificação.' : `${sm.done} recebidos · ${sm.review} para revisão · ${sm.errors} com erro. Revise e aprove cada seção no NeuroLaudos IA.`}</small></div>` : ''}
  <ol class="list" aria-label="Seções">${work.map(i => { const cur = i === it && active; return `<li class="${cur ? 'on' : ''}" ${cur ? 'aria-current="step"' : ''}><span class="dot ${dotClass(i, cur)}" aria-hidden="true">${DOT}</span><span><span class="nm">${esc(i.name)}</span> <span class="st">${esc(status(i))}</span></span></li>${showDetails && (i.reason || i.error || i.checks || i.code) ? `<ul class="checks">${i.code ? `<li>Tarefa ${esc(i.code)}</li>` : ''}${i.reason ? `<li>${esc(i.reason)}</li>` : ''}${i.error ? `<li class="no">${esc(i.error.message)}${i.error.stepLabel ? ' (' + esc(i.error.stepLabel) + ')' : ''}${i.error.detail ? ' — ' + esc(i.error.detail) : ''}</li>` : ''}${(i.checks || []).map(c => `<li class="${c.ok ? 'yes' : 'no'}">${c.ok ? '✓' : '✗'} ${esc(c.name)}${c.detail ? ' — ' + esc(c.detail) : ''}</li>`).join('')}</ul>` : ''}`; }).join('')}</ol>
  ${skipped.length && showDetails ? `<details open><summary>${skipped.length} ${skipped.length === 1 ? 'seção ignorada' : 'seções ignoradas'}</summary><ul class="checks" style="margin-left:0">${skipped.map(i => `<li>${esc(i.name)} — ${esc(i.reason || KIND[i.kind] || '')}</li>`).join('')}</ul></details>` : ''}
  ${showDetails ? `<div class="box"><b style="font-size:12.5px">Registro</b><ul class="log">${(run.log || []).slice().reverse().map(l => `<li>${esc(new Date(l.t).toLocaleTimeString('pt-BR'))} ${esc(l.msg)}</li>`).join('')}</ul></div>` : ''}
  ${run.status === 'paused' && (pause?.actions || []).some(a => a !== 'continue') ? `<div class="row">${pause.actions.filter(a => a !== 'continue').map(a => `<button class="btn sm" data-act="${a}">${{retry: 'Tentar de novo', skip: 'Pular seção', plugin_done: 'Já selecionei o plugin'}[a]}</button>`).join('')}${run.chatTabId ? '<button class="btn sm" id="tochat">Ir para o ChatGPT</button>' : ''}</div>` : ''}
  <div class="acts">
    ${run.status === 'running' ? `<button class="btn" id="pause">${ICON.pause} Pausar</button>` : ''}
    ${run.status === 'paused' ? `<button class="btn pri" data-act="continue">${ICON.play} ${pause?.code === 'assisted' ? 'Próxima seção' : 'Continuar'}</button>` : ''}
    ${active ? `<button class="btn" id="stop">${ICON.stop} Parar</button>` : '<button class="btn pri" id="new">Nova execução</button><button class="btn" id="clear">Limpar dados</button>'}
    <span class="grow"></span>
    <button class="btn out" id="det">${ICON.doc} ${showDetails ? 'Ocultar detalhes' : 'Ver detalhes'}</button>
  </div>`;
  $('#pause') && ($('#pause').onclick = () => ask({type: 'run.pause'}));
  body.querySelectorAll('[data-act]').forEach(b => b.onclick = () => ask({type: 'run.resume', action: b.dataset.act}));
  $('#stop') && ($('#stop').onclick = () => confirmBox(['Parar a execução?', 'Os rascunhos já recebidos ficam no NeuroLaudos IA; nada é apagado.'], 'Parar', () => ask({type: 'run.stop'})));
  $('#new') && ($('#new').onclick = async () => { await ask({type: 'run.clear'}); run = null; choice = null; await rescan(); render(); });
  $('#clear') && ($('#clear').onclick = async () => { await ask({type: 'run.clear'}); run = null; await rescan(); render(); });
  $('#det').onclick = () => { showDetails = !showDetails; render(); };
  $('#tochat') && ($('#tochat').onclick = () => ask({type: 'run.focus', which: 'chat'}));
  if (it && active) timer = setInterval(() => { const t = $('#tm'); if (t) t.textContent = elapsed(it.startedAt || it.updatedAt); }, 1000);
}

load();
