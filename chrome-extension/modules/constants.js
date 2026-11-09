// Shared constants of the extension (service worker, panel, popup and tests).
// No clinical text is ever stored: only codes, section keys, names of sections and statuses.

export const STORAGE_KEY = 'nlauto.run';
export const SETTINGS_KEY = 'nlauto.settings';

/** Default NeuroLaudos IA addresses (iniciar.bat / ng serve). Others are added in the popup. */
export const DEFAULT_NL_ORIGINS = ['http://localhost:9091', 'http://127.0.0.1:9091', 'https://66-94-100-166.sslip.io'];
export const CHATGPT_URL = 'https://chatgpt.com/';
export const PLUGIN_NAME = 'NeuroLaudos IA';

/** Run modes. */
export const MODES = {
  auto: 'Automático',        // every eligible section, stops only on error or required human authorization
  assisted: 'Assistido',     // one section at a time; the psychologist checks it and clicks Continuar
};

/** Whole-run status. */
export const RUN = {idle: 'idle', running: 'running', paused: 'paused', stopped: 'stopped', done: 'done'};

/** Status of one section in the run (labels shown in the panel). */
export const ITEM = {
  pending: 'Pendente',
  preparing: 'Preparando tarefa',
  waiting_chatgpt: 'Aguardando ChatGPT',
  processing: 'Em processamento',
  waiting_auth: 'Aguardando autorização humana',
  confirming: 'Conferindo o rascunho',
  received: 'Rascunho recebido',
  needs_review: 'Revisão necessária',
  error: 'Erro',
  expired: 'Expirada',
  skipped: 'Ignorada',
};
/** Item statuses that end the section (the queue moves on). */
export const FINAL_ITEM = ['received', 'needs_review', 'skipped'];

/** Steps of one section, in order. `sent` is the only non-repeatable step: a message is never sent twice on its own. */
export const STEPS = ['navigate', 'open_modal', 'prepare', 'command', 'chatgpt_new', 'plugin', 'insert', 'send', 'wait_chatgpt', 'confirm', 'close'];
export const STEP_LABEL = {
  navigate: 'Abrir a seção', open_modal: 'Abrir a janela ChatGPT da seção', prepare: 'Preparar tarefa', command: 'Capturar o comando',
  chatgpt_new: 'Abrir conversa nova no ChatGPT', plugin: 'Selecionar o plugin NeuroLaudos IA', insert: 'Inserir o comando', send: 'Enviar a mensagem',
  wait_chatgpt: 'Aguardar a resposta do ChatGPT', confirm: 'Confirmar o rascunho no NeuroLaudos IA', close: 'Fechar a janela da seção',
};

/** Task statuses of the NeuroLaudos IA server (api/src/chatgpt.mjs TASK_STATUS). */
export const NL_TASK = {
  none: 'Sem tarefa', pending: 'Pendente', processing: 'Em processamento', draft_received: 'Rascunho recebido', reviewed: 'Revisado',
  error: 'Erro', expired: 'Expirada', discarded: 'Descartada',
};
export const NL_OPEN = ['pending', 'processing'];

/** Section kinds published by the app (data-nl-kind). Only 'ai' goes to ChatGPT. */
export const KIND = {ai: 'Gerada por ChatGPT', fixed: 'Texto fixo do arquivo', hand: 'Escrita pela psicóloga', missing: 'Falta no documento'};
/** Section states published by the app (data-nl-state). */
export const SECTION_STATE = {pend: 'Pendente', gen: 'Com rascunho', ap: 'Aprovada', file: 'Aprovado · do arquivo'};

export const DEFAULT_SETTINGS = {
  extraOrigins: [],            // other NeuroLaudos IA addresses (https://...), granted in the popup
  defaultMode: 'auto',
  existing: 'draft',           // sections that already have text: 'draft' (default; the draft waits for her confirmation) or 'skip'
  onError: 'pause',            // 'pause' (default) or 'next'
  sendImages: true,
  chatBackground: true,        // ChatGPT works in a background tab; it comes forward only for authorization or a problem
  sameChat: true,              // one ChatGPT conversation for every section (mention only in the first); off: a new conversation per section
  chatgptMinutes: 15,          // longest wait for one ChatGPT answer (authorization included)
  confirmSeconds: 120,         // longest wait for the draft to show up in NeuroLaudos IA after ChatGPT finished
  retries: 1,                  // automatic retries of a failed section before applying onError (never after a message was sent)
};

/** Hard limits per step (ms). Waits are state based; these only stop waits that never end. */
export const LIMITS = {
  contentReady: 20000, navigate: 15000, modal: 15000, prepare: 30000, command: 10000,
  chatgptLoad: 45000, pluginMenu: 8000, pluginChip: 6000, sendReady: 15000, sendAck: 20000,
  chunk: 40000,              // one waiting call to a content script (the worker loops over chunks)
};
