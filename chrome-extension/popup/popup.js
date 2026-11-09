// Popup: run summary, NeuroLaudos IA addresses (optional permissions) and limits. Never shows clinical text.
import {MODES, DEFAULT_SETTINGS} from '../modules/constants.js';
import {progress} from '../modules/task-queue.js';

const $ = s => document.querySelector(s);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const say = t => { $('#msg').textContent = t; };
let settings = {...DEFAULT_SETTINGS};

async function load() {
  const r = await chrome.runtime.sendMessage({type: 'run.get'});
  settings = r.settings || settings;
  const run = r.run;
  const st = $('#status'), acts = $('#runacts');
  acts.innerHTML = '';
  if (!run) st.innerHTML = '<p class="muted">Nenhuma execução registrada.</p>';
  else {
    const p = progress(run.items);
    const label = {running: 'Em execução', paused: 'Pausada', done: 'Concluída', stopped: 'Parada'}[run.status] || run.status;
    st.innerHTML = `<div class="prog"><span>${esc(label)} · ${esc(MODES[run.mode] || run.mode)}</span><span>${p.done}/${p.total}</span></div><div class="bar"><i style="width:${p.pct}%"></i></div>${run.pause ? `<p class="note" style="margin-top:6px">${esc(run.pause.message)}</p>` : ''}`;
    const add = (txt, fn, cls = '') => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = txt; b.onclick = async () => { await fn(); load(); }; acts.appendChild(b); };
    add('Ir para a avaliação', () => chrome.runtime.sendMessage({type: 'run.focus', which: 'nl'}));
    if (run.status === 'running') add('Pausar', () => chrome.runtime.sendMessage({type: 'run.pause'}));
    if (run.status === 'paused') add('Continuar', () => chrome.runtime.sendMessage({type: 'run.resume', action: 'continue'}), 'pri');
    if (run.status === 'running' || run.status === 'paused') add('Parar', () => chrome.runtime.sendMessage({type: 'run.stop'}), 'dan');
    else add('Limpar dados', async () => { await chrome.runtime.sendMessage({type: 'run.clear'}); say('Dados temporários apagados.'); });
  }
  $('#cgmin').value = settings.chatgptMinutes; $('#cfs').value = settings.confirmSeconds; $('#retries').value = settings.retries; $('#bg').checked = settings.chatBackground !== false;
  const list = $('#origins');
  list.innerHTML = '';
  for (const o of settings.extraOrigins || []) {
    const ok = await chrome.permissions.contains({origins: [o + '/*']});
    const li = document.createElement('li');
    li.innerHTML = `<code>${esc(o)}</code><small>${ok ? 'permitido' : 'sem permissão'}</small><button class="btn" style="height:26px;padding:0 8px">Remover</button>`;
    li.querySelector('button').onclick = async () => {
      settings.extraOrigins = settings.extraOrigins.filter(x => x !== o);
      await chrome.runtime.sendMessage({type: 'settings.set', settings: {extraOrigins: settings.extraOrigins}});
      try { await chrome.permissions.remove({origins: [o + '/*']}); } catch {}
      load();
    };
    list.appendChild(li);
  }
}

/** The NeuroLaudos IA tab in front: one click enables the extension on its address (IP of the network, https...). */
async function siteCard() {
  const box = $('#site');
  let tab;
  try { [tab] = await chrome.tabs.query({active: true, currentWindow: true}); } catch {}
  let origin = null;
  try { origin = new URL(tab?.url || '').origin; } catch {}
  if (!origin || !/^https?:/.test(origin) || origin === 'https://chatgpt.com') return;
  const builtIn = ['http://localhost:9091', 'http://127.0.0.1:9091', 'https://66-94-100-166.sslip.io'].includes(origin);
  const on = builtIn || await chrome.permissions.contains({origins: [origin + '/*']});
  box.hidden = false;
  if (on) { box.innerHTML = `<p class="muted">Ativa neste site: <b>${esc(origin)}</b></p>`; return; }
  box.innerHTML = `<p style="margin:0 0 8px;font-size:13px">Esta aba (<b>${esc(origin)}</b>) é o NeuroLaudos IA? Ative a extensão neste endereço.</p><button class="btn pri" id="enable">Ativar neste site</button>`;
  $('#enable').onclick = async () => {
    // The request must run in the click; the worker finishes the setup even if this popup closes.
    const ok = await chrome.permissions.request({origins: [origin + '/*']});
    if (!ok) { say('Permissão não concedida. Nada foi alterado.'); return; }
    await chrome.runtime.sendMessage({type: 'origin.enable', origin});
    try { await chrome.tabs.reload(tab.id); } catch {}
    say('Ativada. A página foi recarregada: clique em Modo automático.');
    settings = (await chrome.runtime.sendMessage({type: 'settings.get'})).settings || settings;
    siteCard();
  };
}
siteCard();

$('#add').onclick = async () => {
  let origin;
  try { const u = new URL($('#origin').value.trim()); if (!/^https?:$/.test(u.protocol)) throw 0; origin = u.origin; } catch { say('Endereço inválido. Use algo como https://neurolaudos.exemplo.com.br'); return; }
  if (origin === 'https://chatgpt.com') { say('Esse é o endereço do ChatGPT, não do NeuroLaudos IA.'); return; }
  // The permission request must run in the click (user gesture).
  const granted = await chrome.permissions.request({origins: [origin + '/*']});
  if (!granted) { say('Permissão não concedida. Nada foi alterado.'); return; }
  const extra = [...new Set([...(settings.extraOrigins || []), origin])];
  await chrome.runtime.sendMessage({type: 'settings.set', settings: {extraOrigins: extra}});
  $('#origin').value = '';
  say('Endereço adicionado. Recarregue a aba do NeuroLaudos IA (F5).');
  load();
};

$('#save').onclick = async () => {
  const clamp = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), a), b) : d; };
  await chrome.runtime.sendMessage({type: 'settings.set', settings: {chatgptMinutes: clamp($('#cgmin').value, 3, 60, 15), confirmSeconds: clamp($('#cfs').value, 30, 900, 120), retries: clamp($('#retries').value, 0, 3, 1), chatBackground: $('#bg').checked}});
  say('Configurações salvas.');
  load();
};

load();
