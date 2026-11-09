// Errors of the automation, in Portuguese, with the step and a recovery hint. Never holds clinical text.
import {STEP_LABEL} from './constants.js';

export const ERRORS = {
  nl_not_logged: {msg: 'Você não está conectada ao NeuroLaudos IA nesta aba.', hint: 'Entre no NeuroLaudos IA, abra a avaliação e clique em Continuar.'},
  nl_not_review: {msg: 'A tela "Conferir seções" não está aberta.', hint: 'Abra a avaliação na etapa Conferir seções e clique em Continuar.'},
  nl_readonly: {msg: 'Esta avaliação está somente leitura (aprovada ou sem permissão de escrita).', hint: 'Nada a gerar. Abra outra avaliação.'},
  nl_selector: {msg: 'Um elemento essencial do NeuroLaudos IA não foi encontrado com segurança.', hint: 'A interface pode ter mudado. Veja Seletores no README e teste no modo Assistido.'},
  nl_section: {msg: 'A seção não abriu.', hint: 'Abra a seção manualmente e clique em Continuar.'},
  nl_modal: {msg: 'A janela ChatGPT da seção não abriu.', hint: 'Clique em ChatGPT na seção e depois em Continuar.'},
  nl_mcp_off: {msg: 'O método "ChatGPT — plugin (MCP)" está desligado neste NeuroLaudos IA.', hint: 'Ligue CHATGPT_MCP_ENABLED e PUBLIC_BASE_URL (veja docs/CHATGPT_INTEGRACAO.md).'},
  nl_prepare: {msg: 'Falha ao preparar a tarefa.', hint: 'Confira a mensagem do NeuroLaudos IA e tente de novo.'},
  nl_no_code: {msg: 'O código da tarefa não foi gerado.', hint: 'Tente de novo; se repetir, prepare a tarefa manualmente.'},
  nl_no_command: {msg: 'O comando da tarefa não foi encontrado.', hint: 'Use Copiar comando na janela da seção e cole no ChatGPT (modo assistido).'},
  nl_bad_command: {msg: 'O comando não confere com o código da tarefa.', hint: 'Feche a janela da seção e tente de novo.'},
  nl_expired: {msg: 'A tarefa expirou.', hint: 'Um código expirado nunca é reutilizado. Tente de novo para preparar outro.'},
  nl_changed: {msg: 'A avaliação aberta mudou durante a execução.', hint: 'Volte à avaliação da execução ou pare e comece de novo.'},
  nl_tab_closed: {msg: 'A aba do NeuroLaudos IA foi fechada.', hint: 'Abra a avaliação de novo e clique em Continuar.'},
  nl_not_received: {msg: 'O rascunho não chegou ao NeuroLaudos IA.', hint: 'Veja a conversa no ChatGPT. Se ele pediu algo, responda lá; depois clique em Continuar ou Tentar de novo.'},
  nl_task_failed: {msg: 'A tarefa terminou com erro ou foi descartada no NeuroLaudos IA.', hint: 'Tente de novo para preparar uma nova tarefa.'},
  cg_not_logged: {msg: 'Você não está conectada ao ChatGPT.', hint: 'Entre no ChatGPT na aba aberta pela extensão e clique em Continuar.'},
  cg_load: {msg: 'O ChatGPT não carregou.', hint: 'Confira a internet e a aba do ChatGPT; depois clique em Continuar.'},
  cg_composer: {msg: 'O campo de mensagem do ChatGPT não foi encontrado.', hint: 'A interface do ChatGPT pode ter mudado. Veja Seletores no README.'},
  cg_plugin_missing: {msg: 'O plugin NeuroLaudos IA não apareceu no seletor do ChatGPT.', hint: 'Conecte o plugin no ChatGPT (Configurações > Aplicativos) ou selecione-o à mão e clique em "Já selecionei o plugin".'},
  cg_plugin_select: {msg: 'Não foi possível confirmar que o plugin NeuroLaudos IA foi selecionado.', hint: 'Selecione o plugin à mão no ChatGPT (@ e NeuroLaudos IA) e clique em "Já selecionei o plugin".'},
  cg_insert: {msg: 'O comando não ficou no campo de mensagem.', hint: 'Cole o comando à mão (Copiar comando) e envie; depois clique em Continuar.'},
  cg_send: {msg: 'A mensagem não foi enviada.', hint: 'Envie à mão no ChatGPT e clique em Continuar.'},
  cg_diverge: {msg: 'O ChatGPT encontrou dados divergentes e não redigiu a seção.', hint: 'Ex.: idade, sexo ou pessoa diferentes entre a identificação e a anamnese. Veja o motivo em "Mostrar detalhes da tarefa" (janela da seção), corrija no NeuroLaudos IA e clique em Tentar de novo, ou Pular seção.'},
  cg_insufficient: {msg: 'O ChatGPT achou os dados insuficientes e não redigiu a seção.', hint: 'Veja o motivo em "Mostrar detalhes da tarefa" (janela da seção), corrija no NeuroLaudos IA e clique em Tentar de novo, ou Pular seção.'},
  cg_conflict: {msg: 'O ChatGPT viu uma instrução conflitante e não redigiu a seção.', hint: 'Veja o motivo em "Mostrar detalhes da tarefa" (janela da seção), corrija no NeuroLaudos IA e clique em Tentar de novo, ou Pular seção.'},
  cg_cannot: {msg: 'O ChatGPT informou que não pôde redigir a seção.', hint: 'Veja o motivo em "Mostrar detalhes da tarefa" (janela da seção), corrija no NeuroLaudos IA e clique em Tentar de novo, ou Pular seção.'},
  cg_no_save: {msg: 'O ChatGPT respondeu, mas não salvou o rascunho.', hint: 'Ele pode ter feito uma pergunta ou visto um problema nos dados (ex.: idade ou sexo diferentes entre identificação e anamnese). Leia a resposta no ChatGPT, corrija no NeuroLaudos IA se for o caso e clique em Tentar de novo, ou Pular seção.'},
  cg_incomplete: {msg: 'A resposta do ChatGPT não terminou no tempo limite.', hint: 'Veja a conversa; quando terminar, clique em Continuar.'},
  cg_rate_limit: {msg: 'O ChatGPT avisou que o limite de uso foi atingido.', hint: 'Espere o limite do seu plano liberar e clique em Continuar.'},
  cg_error: {msg: 'O ChatGPT mostrou uma mensagem de erro.', hint: 'Veja a conversa; tente de novo quando o ChatGPT voltar.'},
  cg_tab_closed: {msg: 'A aba do ChatGPT foi fechada.', hint: 'Clique em Continuar: a extensão abre outra.'},
  connection: {msg: 'Falha de comunicação com a página.', hint: 'Recarregue a página (F5) e clique em Continuar.'},
  interrupted: {msg: 'A execução foi interrompida (navegador ou extensão reiniciados).', hint: 'Confira o status e clique em Continuar; nada é reenviado sem conferência.'},
  busy: {msg: 'Já existe uma execução do Modo automático em andamento.', hint: 'Pare a outra execução antes de começar esta.'},
};

export class AutoError extends Error {
  constructor(code, step, detail) {
    const e = ERRORS[code] || {msg: 'Erro inesperado.', hint: 'Clique em Continuar ou Parar.'};
    super(e.msg);
    this.code = code; this.step = step || null; this.hint = e.hint; this.detail = detail ? String(detail).slice(0, 200) : null;
  }
}

/** Object stored with the item and shown in the panel. `detail` never carries page text, only technical reasons. */
export function describe(err, step) {
  if (err instanceof AutoError) return {code: err.code, message: err.message, hint: err.hint, step: err.step || step || null, stepLabel: STEP_LABEL[err.step || step] || null, detail: err.detail};
  const raw = String(err?.message || err || '');
  const code = /Could not establish connection|Receiving end does not exist|message port closed|No tab with id/i.test(raw) ? 'connection' : 'unexpected';
  const e = ERRORS[code] || {msg: 'Erro inesperado.', hint: 'Clique em Continuar ou Parar.'};
  return {code, message: e.msg, hint: e.hint, step: step || null, stepLabel: STEP_LABEL[step] || null, detail: raw.slice(0, 200)};
}

/** Errors after which a retry needs the person (never automatic). */
export const NEEDS_PERSON = ['nl_not_logged', 'cg_not_logged', 'cg_plugin_missing', 'cg_plugin_select', 'cg_rate_limit', 'nl_mcp_off', 'nl_readonly', 'nl_changed', 'nl_selector', 'nl_not_received', 'cg_no_save', 'cg_diverge', 'cg_insufficient', 'cg_conflict', 'cg_cannot', 'cg_incomplete', 'busy'];
