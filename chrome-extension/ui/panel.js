// Panel shown inside the NeuroLaudos IA page (extension iframe). Talks only to the extension's worker.
// Setup: wide centered window (fixed header and footer, content scrolls). Run: side panel, the page stays visible.
import {STORAGE_KEY, ITEM, MODES, FINAL_ITEM, KIND} from '../modules/constants.js';
import {summarize, skipReason} from '../modules/task-queue.js';

const tabId = Number(new URLSearchParams(location.search).get('tab'));
const $ = s => document.querySelector(s);
const body = $('#body'), ft = $('#ft');
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const ask = msg => chrome.runtime.sendMessage({...msg, tabId}).catch(e => ({ok: false, error: {message: String(e?.message || e)}}));

let review = null;   // draft under review in the panel: {key, name, loading, current, draft, taskId, error, busy}
let run = null, settings = null, scan = null, scanErr = null, showDetails = false, timer = null, choice = null, busy = false, flash = null, pending = null, layout = null;

// ---------- icons (Lucide style: 24 grid, 1.8 stroke) ----------
const P = {
  robot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9.5 16h5M2 12v3M22 12v3"/><circle cx="12" cy="3.5" r="1"/><circle cx="9" cy="12.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12.5" r="1.3" fill="currentColor" stroke="none"/>',
  files: '<path d="M15 2H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M15 2v5h5M4 7v13a2 2 0 0 0 2 2h10"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  fileText: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5M2 17l10 5 10-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  clipboardCheck: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  brain: '<path d="M12 5a3 3 0 1 0-6 .1 4 4 0 0 0-2.5 5.8 4 4 0 0 0 .6 6.6A4 4 0 1 0 12 18z"/><path d="M12 5a3 3 0 1 1 6 .1 4 4 0 0 1 2.5 5.8 4 4 0 0 1-.6 6.6A4 4 0 1 1 12 18z"/><path d="M12 5v13"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  flag: '<path d="M4 22V4c1-.7 2.3-1 4-1 3 0 5 2 8 2 1.4 0 2.6-.3 4-1v11c-1.4.7-2.6 1-4 1-3 0-5-2-8-2-1.7 0-3 .3-4 1"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  chevl: '<path d="m15 6-6 6 6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const FILLED = new Set(['play', 'pause', 'stop']);
const ic = (n, sz = 18, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" width="${sz}" height="${sz}" ${FILLED.has(n) ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${P[n]}</svg>`;
const SEC_ICON = [[/demanda|identifica/, 'fileText'], [/anamnese/, 'clipboard'], [/intelect|habilidade|cogni/, 'brain'], [/percep|visu/, 'eye'], [/memori|aprendiz/, 'layers'], [/atenc/, 'target'], [/execut/, 'gear'], [/comport|social|emoc/, 'users'], [/hipotese|diagnost/, 'pen'], [/conclus/, 'flag'], [/recomend|indica|encaminh/, 'clipboardCheck']];
const secIcon = name => { const n = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); return (SEC_ICON.find(([r]) => r.test(n)) || [0, 'file'])[1]; };

/** In-panel confirmation (native dialogs are unreliable inside a frame of another site). */
function confirmBox(lines, ok, onOk) { pending = {lines, ok, onOk}; render(); }
function renderConfirm() {
  body.innerHTML = `<div class="alert warn" role="alertdialog" aria-labelledby="cf-t"><p id="cf-t"><b>${esc(pending.lines[0])}</b></p>${pending.lines.slice(1).map(l => `<small style="display:block;margin-top:4px">${esc(l)}</small>`).join('')}</div>`;
  const btns = pending.buttons || [{label: pending.ok, cls: 'pri', icon: 'play', fn: pending.onOk}];
  ft.innerHTML = `<button class="btn" id="cf-no">Cancelar</button><span class="grow"></span>${btns.map((x, i) => `<button class="btn ${x.cls || ''}" data-cf="${i}">${x.icon ? ic(x.icon, 15) + ' ' : ''}${esc(x.label)}</button>`).join('')}`;
  $('#cf-no').onclick = () => { pending = null; render(); };
  ft.querySelectorAll('[data-cf]').forEach(el => el.onclick = () => { const fn = btns[+el.dataset.cf].fn; pending = null; render(); fn(); });
  ft.querySelector('[data-cf]:last-child').focus();
}

// ---------- frame size, layout and close ----------
const post = m => parent.postMessage(m, '*');
const fit = () => post({nlx: 'height', h: Math.ceil($('.hd').offsetHeight + body.offsetHeight + 28 + ft.offsetHeight) + 2});
new ResizeObserver(fit).observe(body);
new ResizeObserver(fit).observe(ft);
function setLayout(mode) {
  if (layout === mode) return;
  layout = mode;
  document.documentElement.dataset.layout = mode;
  post({nlx: 'layout', mode: 'modal', wide: mode === 'run'});
}
const close = () => post({nlx: 'close'});
$('#close').onclick = () => askClose();
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (pending) { pending = null; render(); } else askClose();
});

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
  if (r?.ok) { if (scan && scan.evaluationId !== r.evaluationId) choice = null; scan = r; choice ||= defaults(); }
  else { scan = null; scanErr = r?.error || {message: errText(r?.code)}; }
}
function defaults() {
  const s = settings || {}, l = s.last || {};
  return {mode: MODES[l.mode] ? l.mode : MODES[s.defaultMode] ? s.defaultMode : 'auto', existing: 'draft', onError: l.onError || s.onError || 'pause', sendImages: l.sendImages ?? s.sendImages ?? true, sameChat: l.sameChat ?? true, selected: null};
}
const mineActive = () => run && run.nlTabId === tabId && (run.status === 'running' || run.status === 'paused');
const otherActive = () => run && run.nlTabId !== tabId && (run.status === 'running' || run.status === 'paused');
// A finished or stopped run is shown only on its own evaluation; any other one opens on the setup screen.
// No scan yet (panel opened while the run was working) means it is still the run's own evaluation.
const mineShown = () => run && run.nlTabId === tabId && run.status !== 'idle' && (mineActive() || (scan ? scan.evaluationId === run.evaluationId : !scanErr));
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
  if (review) return renderReview();
  if (otherActive()) { setLayout('modal'); return renderOther(); }
  if (mineShown()) { setLayout('run'); return renderRun(); }
  setLayout('modal');
  return renderSetup();
}

function renderOther() {
  body.innerHTML = `<div class="alert warn"><p><b>Já existe uma execução em andamento</b> em outra aba${run.evaluationId ? ' (outra avaliação ou outra aba)' : ''}.</p><small>Só uma execução por vez. Volte à aba da execução ou pare-a para começar aqui.</small></div>`;
  ft.innerHTML = `<button class="btn" id="cancel">Fechar</button><span class="grow"></span><button class="btn dan" id="stop">Parar a outra execução</button><button class="btn pri" id="goto">Ir para a execução</button>`;
  $('#cancel').onclick = close;
  $('#goto').onclick = () => ask({type: 'run.focus', which: 'nl'});
  $('#stop').onclick = async () => { await ask({type: 'run.stop'}); await rescan(); render(); };
}

const MODE_INFO = {
  auto: {icon: 'robot', desc: 'Percorre todas as seções selecionadas, com mínima intervenção.', badge: 'Recomendado', start: 'Iniciar modo automático'},
  assisted: {icon: 'hand', desc: 'Uma seção por vez. Você confere o resultado e clica em Continuar.', start: 'Iniciar modo assistido'},
};
const TIP_SAME = 'O @NeuroLaudos IA vai só na primeira mensagem. As seções anteriores ficam no histórico da conversa e o ChatGPT pode usá-las. Desligado, cada seção abre conversa nova só com os próprios dados.';
const TIP_IMGS = 'Tabelas coladas como figura. Imagens não têm nomes trocados por marcadores: confira se não mostram dados do paciente.';

/** Status pill and one-line description of a section on the setup screen. */
function secState(s, c, why) {
  if (s.kind === 'fixed') return {pill: 'Texto fixo', tone: 'mute', desc: 'Ignorada (texto fixo do arquivo)'};
  if (s.kind === 'hand') return {pill: 'Psicóloga', tone: 'mute', desc: 'Escrita só pela psicóloga'};
  if (s.kind === 'missing') return {pill: 'Ausente', tone: 'mute', desc: 'Falta no documento'};
  if (s.state === 'ap' || s.state === 'file') return {pill: 'Aprovada', tone: 'ok', desc: 'Já aprovada'};
  if (why) return {pill: s.state === 'gen' ? 'Já com texto' : 'Ignorada', tone: 'mute', desc: why};
  const on = c.selected.includes(s.key);
  if (s.state === 'gen') return {pill: 'Já com texto', tone: 'warn', desc: on ? 'Rascunho aguardará sua confirmação' : 'Não selecionada'};
  return {pill: 'Elegível', tone: 'ok', desc: on ? 'Selecionada para gerar rascunho' : 'Não selecionada'};
}

function renderSetup() {
  $('#sub').textContent = 'Gere rascunhos das seções com o ChatGPT e o plugin NeuroLaudos IA';
  if (scanErr || !scan) {
    body.innerHTML = `<div class="alert warn"><p>${esc(scanErr?.message || 'Lendo as seções…')}</p>${scanErr?.hint ? `<small>${esc(scanErr.hint)}</small>` : ''}</div>`;
    ft.innerHTML = `<button class="btn" id="cancel">Cancelar</button><span class="grow"></span><button class="btn pri" id="re">${ic('refresh', 16)} Ler de novo</button>`;
    $('#cancel').onclick = close;
    $('#re').onclick = async () => { await rescan(); render(); };
    return;
  }
  const c = choice;
  const elig = scan.sections.filter(s => !skipReason(s, c.existing, null));
  // Descrição da demanda comes from the file and the anamnesis: off by default, marked only when she wants it.
  if (!c.selected) c.selected = elig.filter(s => !OFF_BY_DEFAULT(s)).map(s => s.key);
  const sm = summarize(scan.sections.map(s => ({...s, status: 'pending'})), scan);
  const stat = (icon, n, label, tone) => `<div class="stat ${tone}"><span class="si">${ic(icon, 20)}</span><div><b>${n}</b><span>${label}</span></div></div>`;
  const radio = (name, v, cur, title, desc) => `<label class="opt ${cur === v ? 'sel' : ''}"><input type="radio" name="${name}" value="${v}" ${cur === v ? 'checked' : ''}><span><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</span></label>`;
  const sw = (id, on, icon, title, desc, tip) => `<div class="setrow"><span class="ri">${ic(icon, 18)}</span><label for="${id}" class="rt" title="${esc(tip)}"><b>${title}</b><small>${desc}</small></label><span class="sw"><input type="checkbox" role="switch" id="${id}" ${on ? 'checked' : ''} aria-describedby="${id}-d"><i aria-hidden="true"></i></span><span class="sr" id="${id}-d">${esc(tip)}</span></div>`;
  body.innerHTML = `
  ${flash ? `<div class="alert ${flash.kind}"><p>${esc(flash.message)}</p>${flash.hint ? `<small>${esc(flash.hint)}</small>` : ''}</div>` : ''}
  ${scan.readOnly ? '<div class="alert warn"><p>Avaliação somente leitura: nada a gerar.</p></div>' : ''}
  ${scan.compat ? '<div class="alert warn"><p>Modo de compatibilidade: o tipo de cada seção é conferido ao abri-la.</p></div>' : ''}
  <div class="stats" aria-label="Resumo das seções">
    ${stat('files', sm.total, 'Seções', '')}${stat('zap', sm.eligible, 'Elegíveis', 'g')}${stat('file', sm.fixed, 'Texto fixo <em>(ignoradas)</em>', 'm')}${stat('checkCircle', sm.withText, 'Já com texto', 'g')}
  </div>
  <section class="card">
    <h2>${ic('play', 15, 'hi')} Modo de execução <span class="tip" title="Nos dois modos as autorizações do ChatGPT continuam com você e nada é aprovado sozinho.">${ic('info', 15)}</span></h2>
    <div class="modes" role="radiogroup" aria-label="Modo de execução">
      ${Object.entries(MODES).map(([k, v]) => `<label class="mode ${c.mode === k ? 'sel' : ''}"><input type="radio" name="mode" value="${k}" ${c.mode === k ? 'checked' : ''}><span class="mi">${ic(MODE_INFO[k].icon, 22)}</span><span class="mt"><b>${v}</b><small>${MODE_INFO[k].desc}</small>${MODE_INFO[k].badge ? `<em class="badge">${MODE_INFO[k].badge}</em>` : ''}</span></label>`).join('')}
    </div>
  </section>
  <div class="cols">
    <section class="card"><h2>${ic('layers', 17, 'hi')} Seções que já têm texto</h2>
      <div class="opts" role="radiogroup" aria-label="Seções que já têm texto">${radio('existing', 'skip', c.existing, 'Não mexer')}${radio('existing', 'draft', c.existing, 'Gerar rascunho mesmo assim (padrão)', 'O texto atual é preservado; o rascunho aguarda sua confirmação para substituir.')}</div>
    </section>
    <section class="card"><h2>${ic('alert', 17, 'hi')} Se uma seção falhar</h2>
      <div class="opts" role="radiogroup" aria-label="Se uma seção falhar">${radio('onError', 'pause', c.onError, 'Pausar e perguntar (padrão)')}${radio('onError', 'next', c.onError, 'Registrar o erro e seguir para a próxima')}</div>
    </section>
  </div>
  <section class="card">
    <h2>${ic('gear', 17, 'hi')} Configurações adicionais</h2>
    ${sw('same', c.sameChat, 'message', 'Usar uma única conversa do ChatGPT para todas as seções', 'O plugin é selecionado na primeira mensagem; as próximas seções usam a mesma conversa.', TIP_SAME)}
    ${sw('imgs', c.sendImages, 'image', 'Enviar as imagens das seções', 'Tabelas coladas como figura. Confira se não mostram dados do paciente.', TIP_IMGS)}
  </section>
  ${conclCard(c)}
  <section class="card">
    <div class="lh"><h2>${ic('list', 17, 'hi')} Seções desta avaliação <small>na ordem do documento</small></h2><span class="grow"></span>
      <button class="lnk" id="all" type="button"></button>
      <span class="pill mute">${sm.total} ${sm.total === 1 ? 'seção' : 'seções'}</span>
      <button class="ic sm" id="re" type="button" title="Ler as seções de novo" aria-label="Ler as seções de novo">${ic('refresh', 16)}</button>
    </div>
    <div class="slist">${scan.sections.map(s => { const why = skipReason(s, c.existing, null); const st = secState(s, c, why); return `<label class="srow ${why ? 'off' : ''}" data-row="${esc(s.key)}"><input type="checkbox" data-k="${esc(s.key)}" ${why ? 'disabled' : c.selected.includes(s.key) ? 'checked' : ''}><span class="sic">${ic(secIcon(s.name), 17)}</span><span class="sn"><b>${esc(s.name)}</b><small>${esc(st.desc)}</small></span><span class="pill ${st.tone}">${esc(st.pill)}</span></label>`; }).join('')}</div>
  </section>
  <p class="note">A extensão nunca aprova textos, nunca clica em "Aprovar todas" e nunca autoriza o plugin por você. O conteúdo do ChatGPT é rascunho para sua revisão.</p>`;
  ft.innerHTML = `<button class="btn" id="cancel" type="button">Cancelar</button><span class="grow"></span><span class="cnt" id="cnt"></span><button class="btn pri" id="start" type="button"></button>`;
  const boxes = [...body.querySelectorAll('.slist input[data-k]:not(:disabled)')];
  const upd = () => {
    const k = c.selected.length, b = $('#start');
    b.innerHTML = `${ic('play', 15)} ${MODE_INFO[c.mode].start}`;
    b.disabled = scan.readOnly || busy || !k;
    $('#cnt').textContent = `${k} de ${elig.length} ${elig.length === 1 ? 'seção selecionada' : 'seções selecionadas'}`;
    const all = boxes.length && k === boxes.length;
    $('#all').textContent = all ? 'Desmarcar todas' : 'Selecionar todas as elegíveis';
    $('#all').hidden = !boxes.length;
    for (const s of scan.sections) {
      const row = body.querySelector(`[data-row="${CSS.escape(s.key)}"] small`);
      if (row) row.textContent = secState(s, c, skipReason(s, c.existing, null)).desc;
    }
  };
  upd();
  const radioSel = name => body.querySelectorAll(`input[name="${name}"]`).forEach(i => i.closest('label').classList.toggle('sel', i.checked));
  body.querySelectorAll('input[name="mode"]').forEach(i => i.onchange = () => { c.mode = i.value; radioSel('mode'); upd(); });
  body.querySelectorAll('input[name="existing"]').forEach(i => i.onchange = () => { c.existing = i.value; c.selected = null; render(); });
  body.querySelectorAll('input[name="onError"]').forEach(i => i.onchange = () => { c.onError = i.value; radioSel('onError'); });
  $('#imgs').onchange = e => { c.sendImages = e.target.checked; };
  $('#same').onchange = e => { c.sameChat = e.target.checked; };
  boxes.forEach(i => i.onchange = () => { const k = i.dataset.k; c.selected = i.checked ? [...new Set([...c.selected, k])] : c.selected.filter(x => x !== k); if (k === CONCL) render(); else upd(); });
  $('#all').onclick = () => { const on = c.selected.length !== boxes.length; boxes.forEach(i => { i.checked = on; }); c.selected = on ? boxes.map(i => i.dataset.k) : []; render(); };
  $('#re').onclick = async () => { await rescan(); render(); };
  $('#cancel').onclick = close;
  $('#start').onclick = start;
  const ta = $('#concl');
  if (ta) ta.oninput = () => { c.conclusion = ta.value; const w = $('#concl-warn'); if (w) w.hidden = !unfinished(ta.value); };
  $('#concl-reset') && ($('#concl-reset').onclick = () => { c.conclusion = c.conclusionOrig; render(); });
  if (c.selected.includes(CONCL) && c.conclusion === undefined && !c.conclLoading) loadConclusion(c);
}

const CONCL = 'conclusao';
const OFF_BY_DEFAULT = s => s.key === 'demanda' || /descri[cç][aã]o da demanda/i.test(s.name || '');
/** The default instruction ends open ("...apresenta características "): she completes it before the run. */
const unfinished = t => /caracter[ií]sticas\s*\.?\s*$/i.test(String(t || '').trim()) || !String(t || '').trim();
async function loadConclusion(c) {
  c.conclLoading = true;
  const r = await ask({type: 'instruction.get', key: CONCL, evaluationId: scan?.evaluationId});
  c.conclLoading = false;
  if (r?.ok && typeof r.text === 'string') { c.conclusion = c.conclusionOrig = r.text; c.conclEditable = !!r.editable; } else { c.conclusion = null; }
  if (!run || run.nlTabId !== tabId) render();
}
/** Conclusão instruction, editable before the run (saved in the evaluation, used when its task is prepared). */
function conclCard(c) {
  if (!c.selected.includes(CONCL)) return '';
  if (c.conclusion === undefined || c.conclLoading) return `<section class="card"><h2>${ic('flag', 17, 'hi')} Instrução da Conclusão</h2><p class="muted">Carregando a instrução…</p></section>`;
  if (c.conclusion === null) return `<section class="card"><h2>${ic('flag', 17, 'hi')} Instrução da Conclusão</h2><p class="muted">Não foi possível ler a instrução. Ela pode ser editada na própria seção Conclusão.</p></section>`;
  return `<section class="card concl">
    <div class="lh"><h2>${ic('flag', 17, 'hi')} Instrução da Conclusão <small>vai para o ChatGPT junto com os textos das seções</small></h2><span class="grow"></span>${c.conclusion !== c.conclusionOrig ? '<button class="lnk" id="concl-reset" type="button">Desfazer alterações</button>' : ''}</div>
    <textarea id="concl" class="ta" rows="4" maxlength="6000" ${c.conclEditable ? '' : 'disabled'} aria-label="Instrução da Conclusão" placeholder="Ex.: Integrar atenção e funções executivas com as queixas escolares; relatar no final que apresenta características de…">${esc(c.conclusion)}</textarea>
    <p class="hint warn" id="concl-warn" ${unfinished(c.conclusion) ? '' : 'hidden'}>Complete a instrução: ela termina em "características" e espera o que você quer relatar.</p>
  </section>`;
}

// ---------- review of a draft that waits for her confirmation ----------
const paras = t => String(t || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => p.startsWith('## ') ? `<h4>${esc(p.slice(3))}</h4>` : `<p>${esc(p)}</p>`).join('') || '<p class="muted">(sem texto)</p>';
async function openReview(key, name) {
  review = {key, name, loading: true}; render();
  const r = await ask({type: 'review.get', key});
  if (!review || review.key !== key) return;
  review = r?.ok ? {key, name: r.name || name, current: r.current, draft: r.draft, taskId: r.taskId, editable: r.editable} : {key, name, error: r?.reason === 'done' ? 'Este rascunho já foi resolvido na seção.' : 'Não foi possível abrir o rascunho. Abra a seção no NeuroLaudos IA.'};
  render();
}
function renderReview() {
  const v = review;
  $('#sub').textContent = 'Revisão do rascunho: ' + v.name;
  body.innerHTML = v.loading ? '<p class="muted">Abrindo o rascunho…</p>' : v.error ? `<div class="alert warn"><p>${esc(v.error)}</p></div>` : `
  <div class="alert warn"><p><b>${esc(v.name)}: a seção já tinha texto.</b></p><small>Aprovar troca o texto atual pelo rascunho do ChatGPT (o atual fica nas versões da seção). Reprovar mantém o texto atual e descarta o rascunho. A aprovação final da seção continua no NeuroLaudos IA.</small></div>
  <div class="revcols">
    <section class="card"><h2>${ic('fileText', 16, 'hi')} Texto atual</h2><div class="revtext">${paras(v.current)}</div></section>
    <section class="card draft"><h2>${ic('robot', 16, 'hi')} Rascunho do ChatGPT</h2><div class="revtext">${paras(v.draft)}</div></section>
  </div>`;
  ft.innerHTML = `<button class="btn" id="rv-back" type="button">${ic('chevl', 14)} Voltar</button><span class="grow"></span>${v.loading || v.error ? '' : `<button class="btn dan" id="rv-no" type="button" ${v.busy || !v.editable ? 'disabled' : ''}>${ic('stop', 13)} Reprovar (manter o atual)</button><button class="btn pri" id="rv-ok" type="button" ${v.busy || !v.editable ? 'disabled' : ''}>${ic('checkCircle', 15)} Aprovar rascunho</button>`}`;
  $('#rv-back').onclick = () => { review = null; render(); };
  const act = async action => {
    v.busy = true; render();
    const r = await ask({type: 'review.act', key: v.key, taskId: v.taskId, action});
    if (r?.ok) { review = null; flash = null; } else { v.busy = false; v.error = null; }
    render();
    if (!r?.ok) body.insertAdjacentHTML('afterbegin', '<div class="alert err"><p>Não foi possível concluir. Tente de novo ou resolva na seção.</p></div>');
  };
  $('#rv-ok') && ($('#rv-ok').onclick = () => act('apply'));
  $('#rv-no') && ($('#rv-no').onclick = () => act('discard'));
}

async function start() {
  const c = choice;
  const n = c.selected.length;
  if (!n) { flash = {kind: 'warn', message: 'Escolha ao menos uma seção.'}; return render(); }
  const names = scan.sections.filter(s => c.selected.includes(s.key)).map(s => s.name).join(', ');
  if (c.selected.includes(CONCL) && typeof c.conclusion === 'string' && unfinished(c.conclusion)) {
    flash = {kind: 'warn', message: 'Complete a instrução da Conclusão antes de iniciar.', hint: 'Ela termina em "características" e espera o que você quer relatar. Se não quiser gerar a Conclusão agora, desmarque a seção.'};
    render(); $('#concl')?.focus(); return;
  }
  const lines = [`Gerar rascunhos de ${n} ${n === 1 ? 'seção' : 'seções'} com o ChatGPT (modo ${MODES[c.mode].toLowerCase()})?`, names, `Seções com texto: ${c.existing === 'skip' ? 'não mexer' : 'rascunho aguarda sua confirmação'} · Erro: ${c.onError === 'pause' ? 'pausar' : 'seguir'} · Imagens: ${c.sendImages ? 'enviar' : 'não enviar'} · Conversa: ${c.sameChat ? 'uma só' : 'nova por seção'}`, 'As autorizações do ChatGPT continuam com você.'];
  confirmBox(lines, 'Iniciar', () => go(c));
}
async function go(c) {
  busy = true; flash = null; render();
  if (c.selected.includes(CONCL) && typeof c.conclusion === 'string' && c.conclusion !== c.conclusionOrig) {
    const w = await ask({type: 'instruction.set', key: CONCL, text: c.conclusion, evaluationId: scan?.evaluationId});
    if (!w?.ok) { busy = false; flash = {kind: 'err', message: 'A instrução da Conclusão não foi salva.', hint: 'Nada foi iniciado. Confira a conexão com o NeuroLaudos IA e tente de novo.'}; return render(); }
    c.conclusionOrig = c.conclusion;
  }
  ask({type: 'settings.set', settings: {last: {mode: c.mode, onError: c.onError, sendImages: c.sendImages, sameChat: c.sameChat}}});
  const r = await ask({type: 'run.start', mode: c.mode, existing: c.existing, onError: c.onError, sendImages: c.sendImages, sameChat: c.sameChat, selected: c.selected});
  busy = false;
  if (!r?.ok) { flash = {kind: 'err', ...(r?.error || {message: 'Não foi possível iniciar.'})}; render(); }
}

const DOT = '<svg class="k" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><svg class="w" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M12 6v8M12 18.5v.5"/></svg><svg class="x" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

const dotClass = (it, current) => it.status === 'received' ? 'ok' : it.status === 'needs_review' ? 'warn' : it.status === 'error' || it.status === 'expired' ? 'err' : it.status === 'skipped' ? 'skip' : current && run.status === 'running' ? 'run' : '';
const elapsed = iso => { const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso || Date.now())) / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const STEPS4 = ['Tarefa preparada', 'Comando enviado ao ChatGPT', 'ChatGPT escrevendo o texto', 'Texto salvo no NeuroLaudos IA'];
/** Which of the four plain steps the section is on. */
function phase(it) {
  if (it.status === 'waiting_auth') return 2;
  if (it.status === 'confirming' || it.step === 'confirm' || it.step === 'close') return 3;
  if (it.status === 'processing' || it.step === 'wait_chatgpt') return 2;
  if (['chatgpt_new', 'plugin', 'insert', 'send'].includes(it.step)) return 1;
  return 0;
}
/** Big message of the current section, from the real state of the run. */
function liveMessage(it) {
  if (run.status === 'paused') return {t: 'Execução pausada', s: 'Veja o motivo abaixo e escolha como seguir.', tone: 'warn'};
  if (it.status === 'waiting_auth') return {t: 'Aguardando sua autorização no ChatGPT', s: 'Confira e confirme o salvamento no ChatGPT; depois a execução continua sozinha.', tone: 'warn'};
  const ph = phase(it);
  if (ph === 3) return {t: 'Aguardando salvamento no NeuroLaudos IA', s: 'O ChatGPT terminou; conferindo se o rascunho chegou na seção.'};
  if (ph === 2) return {t: `O ChatGPT está escrevendo ${it.name}`, s: 'Pode levar alguns minutos. Você pode continuar usando o computador.'};
  if (ph === 1) return {t: 'Enviando o comando ao ChatGPT', s: 'Abrindo a conversa e selecionando o plugin NeuroLaudos IA.'};
  return {t: 'Preparando a tarefa', s: `Lendo os dados de ${it.name} no NeuroLaudos IA.`};
}
/** "5 de 16 seções": every section of the evaluation; ignored ones (fixed text, approved...) count as done.
 *  A section counts only when it reached a final state (draft received, review, ignored) or failed: never just for being sent. */
function overall(items) {
  const done = items.filter(i => FINAL_ITEM.includes(i.status) || i.status === 'error' || i.status === 'expired').length;
  return {done, total: items.length, pct: items.length ? Math.round(done * 100 / items.length) : 0};
}

/** Closing while the run works: hide and keep going, pause, or stop (never stops silently). */
function askClose() {
  if (!(run && run.nlTabId === tabId && (run.status === 'running' || run.status === 'paused'))) return close();
  pending = {lines: ['A automação continua em andamento.', 'Ocultar esta janela não para nada: a execução segue e você pode reabri-la pelo botão Modo automático.'], buttons: [
    {label: 'Parar', cls: 'dan', icon: 'stop', fn: () => confirmBox(['Parar a execução?', 'Os rascunhos já recebidos ficam no NeuroLaudos IA; nada é apagado.'], 'Parar', () => ask({type: 'run.stop'}))},
    ...(run.status === 'running' ? [{label: 'Pausar', icon: 'pause', fn: () => ask({type: 'run.pause'})}] : []),
    {label: 'Ocultar e continuar', cls: 'pri', fn: close},
  ]};
  render();
}

function renderRun() {
  const p = overall(run.items);
  const sm = summarize(run.items, null);
  const it = run.items[run.current];
  const work = run.items.filter(i => i.status !== 'skipped' || i.reason === 'Pulada por você' || i.reviewed);
  const skipped = run.items.filter(i => i.status === 'skipped' && i.reason !== 'Pulada por você');
  const active = run.status === 'running' || run.status === 'paused';
  const pause = run.status === 'paused' ? run.pause : null;
  $('#sub').textContent = run.status === 'done' ? 'Rascunhos gerados com o ChatGPT' : run.status === 'stopped' ? 'Execução parada; os rascunhos recebidos ficam no NeuroLaudos IA' : `Gerando rascunhos com o ChatGPT · modo ${(MODES[run.mode] || '').toLowerCase()}`;
  const status = i => i === it && active ? (run.status === 'paused' ? 'Pausada' : 'Em andamento') : i.status === 'pending' ? 'Aguardando' : ITEM[i.status] || i.status;
  // Sections a stopped or finished run can still do (error, expired, not reached, skipped by the person)
  const remaining = active ? 0 : run.items.filter(i => !FINAL_ITEM.includes(i.status) || (i.status === 'skipped' && i.reason === 'Pulada por você')).length;
  const extra = [sm.errors ? `${sm.errors} com erro` : '', sm.review ? `${sm.review} para revisão` : ''].filter(Boolean).join(' · ');
  let left;
  if (it && active) {
    const ph = phase(it), m = liveMessage(it), auth = it.status === 'waiting_auth', paused = run.status === 'paused';
    left = `<div class="cur ${m.tone || ''}"><span class="ci">${ic(secIcon(it.name), 22)}</span><div class="grow"><small>Seção atual</small><b>${esc(it.name)}</b>${it.code ? `<span class="code" title="Código da tarefa">${esc(it.code)}</span>` : ''}</div><span class="timer" title="Tempo nesta seção">${ic('clock', 15)}<span id="tm">${elapsed(it.startedAt || it.updatedAt)}</span></span></div>
    <div class="live ${m.tone || ''} ${paused ? 'still' : ''}" role="status" aria-live="polite">
      <div class="orb" aria-hidden="true">${ic(paused ? 'pause' : 'robot', 30)}</div>
      <b>${esc(m.t)}</b><p>${esc(m.s)}</p>
      <ol class="steps4">${STEPS4.map((t, i) => `<li class="${i < ph ? 'done' : i === ph ? (paused ? 'stop' : 'now') : ''}"><i aria-hidden="true"></i><span>${i === 2 && auth ? 'Aguardando sua autorização' : t}</span></li>`).join('')}</ol>
    </div>
    ${pause ? `<div class="alert ${pause.code === 'assisted' || pause.code === 'user' ? 'warn' : 'err'}" role="alert"><p><b>${esc(pause.section ? pause.section + ': ' : '')}${esc(pause.message)}</b></p>${pause.stepLabel ? `<small>Etapa: ${esc(pause.stepLabel)}. </small>` : ''}<small>${esc(pause.hint || '')}</small></div>` : ''}
    <div class="live-acts">
      ${pause ? (pause.actions || []).filter(a => a !== 'continue').map(a => `<button class="btn sm" data-act="${a}">${{retry: 'Tentar de novo', skip: 'Pular seção', plugin_done: 'Já selecionei o plugin'}[a]}</button>`).join('') : ''}
      ${run.chatTabId ? `<button class="btn sm ${auth ? 'pri' : ''}" id="tochat">${ic('external', 15)} Ver no ChatGPT</button>` : ''}
      <button class="lnk" id="showmodal" type="button">Mostrar detalhes da tarefa</button>
    </div>`;
  } else if (run.status === 'done' || run.status === 'stopped') {
    const done = run.status === 'done';
    left = `<div class="live ${done ? 'ok' : 'warn'} still"><div class="orb" aria-hidden="true">${ic(done ? 'checkCircle' : 'stop', 30)}</div>
      <b>${done ? 'Execução concluída' : 'Execução parada'}</b>
      <p>${sm.done} ${sm.done === 1 ? 'rascunho recebido' : 'rascunhos recebidos'}${sm.review ? ` · ${sm.review} para revisão` : ''}${sm.errors ? ` · ${sm.errors} com erro` : ''}. ${remaining ? `Faltam ${remaining} ${remaining === 1 ? 'seção' : 'seções'}: use "Continuar de onde parou" para gerar só essas.` : 'Revise e aprove cada seção no NeuroLaudos IA.'}</p></div>`;
  } else left = '<p class="muted">Preparando…</p>';
  body.innerHTML = `
  <div class="progrow">
    <b>Progresso da avaliação</b>
    <div class="bar" role="progressbar" aria-label="Progresso da avaliação" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}"><i style="width:${p.pct}%"></i></div>
    <span>${p.done} de ${p.total} seções — ${p.pct}%${extra ? `<small>${esc(extra)}</small>` : ''}</span>
  </div>
  <div class="runcols">
    <section class="card now-col">${left}</section>
    <section class="card queue-col">
      <h2>${ic('layers', 17, 'hi')} Fila da automação<span class="grow"></span><span class="pill mute">${work.length} ${work.length === 1 ? 'seção' : 'seções'}</span></h2>
      <ol class="list" aria-label="Fila da automação">${work.map(i => { const cur = i === it && active; return `<li class="${cur ? 'on' : ''}" ${cur ? 'aria-current="step"' : ''}><span class="dot ${dotClass(i, cur)}" aria-hidden="true">${DOT}</span><span class="grow"><span class="nm">${esc(i.name)}</span> <span class="st">${esc(status(i))}</span></span>${i.status === 'needs_review' ? `<button class="btn sm rev" type="button" data-rev="${esc(i.key)}" title="Ver o texto atual e o rascunho do ChatGPT">${ic('eye', 14)} Revisar</button>` : ''}</li>${showDetails && (i.reason || i.error || i.checks || i.code) ? `<ul class="checks">${i.code ? `<li>Tarefa ${esc(i.code)}</li>` : ''}${i.reason ? `<li>${esc(i.reason)}</li>` : ''}${i.error ? `<li class="no">${esc(i.error.message)}${i.error.stepLabel ? ' (' + esc(i.error.stepLabel) + ')' : ''}${i.error.detail ? ' — ' + esc(i.error.detail) : ''}</li>` : ''}${(i.checks || []).map(c => `<li class="${c.ok ? 'yes' : 'no'}">${c.ok ? '✓' : '✗'} ${esc(c.name)}${c.detail ? ' — ' + esc(c.detail) : ''}</li>`).join('')}</ul>` : ''}`; }).join('')}</ol>
    </section>
  </div>
  ${skipped.length && showDetails ? `<details open class="card"><summary>${skipped.length} ${skipped.length === 1 ? 'seção ignorada' : 'seções ignoradas'}</summary><ul class="checks" style="margin-left:0">${skipped.map(i => `<li>${esc(i.name)} — ${esc(i.reason || KIND[i.kind] || '')}</li>`).join('')}</ul></details>` : ''}
  ${showDetails ? `<div class="card"><div class="row"><b style="font-size:12.5px">Registro</b><span class="grow"></span><button class="btn sm" id="copylog" type="button">Copiar registro</button></div><ul class="log">${(run.log || []).slice().reverse().map(l => `<li>${esc(new Date(l.t).toLocaleTimeString('pt-BR'))} ${esc(l.msg)}</li>`).join('')}</ul></div>` : ''}`;
  ft.innerHTML = `
    ${active ? '' : '<button class="btn" id="clear">Limpar dados</button>'}
    <span class="grow"></span>
    ${run.status === 'running' ? `<button class="btn" id="pause">${ic('pause', 15)} Pausar</button>` : ''}
    ${run.status === 'paused' ? `<button class="btn pri" data-act="continue">${ic('play', 15)} ${pause?.code === 'assisted' ? 'Próxima seção' : 'Continuar'}</button>` : ''}
    ${active ? `<button class="btn" id="stop">${ic('stop', 14)} Parar</button>` : `${remaining ? `<button class="btn pri" id="cont">${ic('play', 15)} Continuar de onde parou (${remaining})</button><button class="btn" id="new">Nova execução</button>` : '<button class="btn pri" id="new">Nova execução</button>'}`}
    <button class="btn out" id="det">${ic('fileText', 17)} ${showDetails ? 'Ocultar detalhes' : 'Ver detalhes'}</button>`;
  $('#pause') && ($('#pause').onclick = () => ask({type: 'run.pause'}));
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => ask({type: 'run.resume', action: b.dataset.act}));
  $('#stop') && ($('#stop').onclick = () => confirmBox(['Parar a execução?', 'Os rascunhos já recebidos ficam no NeuroLaudos IA; nada é apagado.'], 'Parar', () => ask({type: 'run.stop'})));
  $('#cont') && ($('#cont').onclick = () => ask({type: 'run.continue'}));
  body.querySelectorAll('[data-rev]').forEach(b => b.onclick = () => openReview(b.dataset.rev, run.items.find(i => i.key === b.dataset.rev)?.name || ''));
  $('#new') && ($('#new').onclick = async () => { await ask({type: 'run.clear'}); run = null; choice = null; await rescan(); render(); });
  $('#clear') && ($('#clear').onclick = async () => { await ask({type: 'run.clear'}); run = null; await rescan(); render(); });
  $('#det').onclick = () => { showDetails = !showDetails; render(); };
  $('#copylog') && ($('#copylog').onclick = async e => { const txt = (run.log || []).map(l => new Date(l.t).toLocaleTimeString('pt-BR') + ' ' + l.msg).join('\n'); try { await navigator.clipboard.writeText(txt); e.target.textContent = 'Copiado'; } catch { e.target.textContent = 'Não foi possível copiar'; } });
  $('#tochat') && ($('#tochat').onclick = () => ask({type: 'run.focus', which: 'chat'}));
  // The section's own window (code, command): this window steps aside and the run keeps going.
  $('#showmodal') && ($('#showmodal').onclick = () => { post({nlx: 'showModal', on: true}); close(); });
  if (it && active) timer = setInterval(() => { const t = $('#tm'); if (t) t.textContent = elapsed(it.startedAt || it.updatedAt); }, 1000);
}

load();
