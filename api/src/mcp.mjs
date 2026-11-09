// Minimal MCP server over Streamable HTTP (JSON responses, no server-initiated stream): initialize, ping,
// tools/list and tools/call. Tool logic is injected, so this file has no database and no clinical data.
import {MCP_SERVER_INSTRUCTIONS} from './prompts.mjs';
import {SCOPES} from './oauth.mjs';

export const PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];
/** Key of a tool result holding images ([{mimeType, data}]): sent as MCP image content, not inside the JSON text. */
export const IMAGES = '__imagens';
const oauth = scopes => [{type: 'oauth2', scopes}];
/** Why ChatGPT could not write a section (informar_problema); the extension maps each one to a message. */
export const PROBLEM_REASONS = ['dados_divergentes', 'dados_insuficientes', 'instrucao_conflitante', 'outro'];
const code = {type: 'string', description: 'Código da tarefa mostrado no NeuroLaudos IA, no formato NL-XXXX-XXXX.'};

export const TOOLS = [
  {
    name: 'obter_tarefa_pendente',
    title: 'Obter tarefa pendente',
    description: 'Use quando a psicóloga informar um código NL-XXXX-XXXX de uma seção do laudo para redigir (anamnese, descrição da demanda, interpretações, conclusão ou recomendações). Retorna a instrução de redação, o formato e só os dados daquela seção (textos e tabelas, com nomes e datas trocados por marcadores) e, se ela pediu, as imagens da seção. Não use sem código.',
    inputSchema: {type: 'object', properties: {codigo: code}, required: ['codigo'], additionalProperties: false},
    annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    securitySchemes: oauth([SCOPES.read]),
    _meta: {securitySchemes: oauth([SCOPES.read])},
    scope: SCOPES.read,
  },
  {
    name: 'salvar_rascunho',
    title: 'Salvar rascunho da seção',
    description: 'Use depois de redigir o texto pedido por obter_tarefa_pendente, para salvá-lo como RASCUNHO da seção no NeuroLaudos IA. Não sobrescreve texto já existente sem a confirmação da psicóloga no sistema. Envie só o texto final, com os marcadores ([PACIENTE] etc.) iguais aos recebidos.',
    inputSchema: {
      type: 'object',
      properties: {
        codigo: code,
        texto: {type: 'string', description: 'Texto final da seção em português, no formato pedido pela tarefa (títulos com "## " quando houver tópicos; parágrafos separados por linha em branco).'},
        id_operacao: {type: 'string', description: 'Identificador único desta gravação (8 a 100 caracteres: letras, números, ponto, hífen, dois-pontos). Repetir o mesmo id não grava duas vezes.'},
      },
      required: ['codigo', 'texto', 'id_operacao'], additionalProperties: false,
    },
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    securitySchemes: oauth([SCOPES.write]),
    _meta: {securitySchemes: oauth([SCOPES.write])},
    scope: SCOPES.write,
  },
  {
    name: 'informar_problema',
    title: 'Informar problema na tarefa',
    description: 'Use em vez de salvar_rascunho só quando NÃO for possível redigir a seção com segurança: os dados parecem de outra pessoa (nome, idade ou sexo diferentes entre identificação e anamnese), faltam os dados da seção ou a instrução se contradiz. Não use por escolha clínica da psicóloga (instrumento, versão, norma ou faixa etária do teste, quantidade de testes): isso é decisão dela; redija com os dados como estão. Encerra a tarefa com erro e mostra o motivo à psicóloga no NeuroLaudos IA, que corrige e prepara uma nova tarefa. Não salva texto.',
    inputSchema: {
      type: 'object',
      properties: {
        codigo: code,
        motivo: {type: 'string', enum: PROBLEM_REASONS, description: 'dados_divergentes, dados_insuficientes, instrucao_conflitante ou outro.'},
        detalhe: {type: 'string', description: 'Explicação curta (até 500 caracteres) do que impede a redação, usando os marcadores ([PACIENTE] etc.) em vez de dados pessoais.'},
      },
      required: ['codigo', 'motivo', 'detalhe'], additionalProperties: false,
    },
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    securitySchemes: oauth([SCOPES.write]),
    _meta: {securitySchemes: oauth([SCOPES.write])},
    scope: SCOPES.write,
  },
  {
    name: 'consultar_status_tarefa',
    title: 'Consultar status da tarefa',
    description: 'Use para saber em que situação está uma tarefa: pendente, em processamento, rascunho recebido, revisado, erro ou expirada.',
    inputSchema: {type: 'object', properties: {codigo: code}, required: ['codigo'], additionalProperties: false},
    annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    securitySchemes: oauth([SCOPES.read]),
    _meta: {securitySchemes: oauth([SCOPES.read])},
    scope: SCOPES.read,
  },
];
/** Names of the first version (anamnesis only), still accepted so a plugin whose tool list was not refreshed keeps working. */
export const ALIASES = {obter_anamnese_pendente: 'obter_tarefa_pendente', salvar_rascunho_anamnese: 'salvar_rascunho', consultar_status_anamnese: 'consultar_status_tarefa'};
const publicTool = ({scope, ...t}) => t;

/** A tool failure the model can read (the HTTP request itself succeeded). */
export class ToolError extends Error {}
const rpcError = (id, code, message) => ({jsonrpc: '2.0', id: id ?? null, error: {code, message}});
function textResult(data, isError = false) {
  if (typeof data === 'string') return {content: [{type: 'text', text: data}], ...(isError ? {isError: true} : {})};
  const {[IMAGES]: images = [], ...rest} = data;
  return {content: [{type: 'text', text: JSON.stringify(rest, null, 2)}, ...images.map(i => ({type: 'image', data: i.data, mimeType: i.mimeType}))], structuredContent: rest};
}

/**
 * Handles one JSON-RPC message. Returns the response object, or null for notifications (HTTP 202).
 * ctx.scopes: scopes of the access token; callTool(name, args) -> structured result (throws ToolError for user errors).
 */
export async function handleMessage(msg, {scopes = [], callTool, version = '0.0.0'}) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid Request');
  const isNotification = !('id' in msg);
  if (isNotification) return null;
  const {id, method, params = {}} = msg;
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return {jsonrpc: '2.0', id, result: {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: {tools: {listChanged: false}},
        serverInfo: {name: 'neurolaudos-ia', title: 'NeuroLaudos IA', version},
        instructions: MCP_SERVER_INSTRUCTIONS,
      }};
    }
    case 'ping': return {jsonrpc: '2.0', id, result: {}};
    case 'tools/list': return {jsonrpc: '2.0', id, result: {tools: TOOLS.map(publicTool)}};
    case 'tools/call': {
      const name = ALIASES[params?.name] || params?.name;
      const tool = TOOLS.find(t => t.name === name);
      if (!tool) return rpcError(id, -32602, 'Ferramenta desconhecida');
      if (!scopes.includes(tool.scope)) return {jsonrpc: '2.0', id, result: textResult(`Permissão insuficiente: a conexão do ChatGPT não tem o escopo ${tool.scope}. Reconecte o plugin e autorize leitura e gravação.`, true)};
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      try { return {jsonrpc: '2.0', id, result: textResult(await callTool(tool.name, args))}; }
      catch (err) {
        if (err instanceof ToolError) return {jsonrpc: '2.0', id, result: textResult(err.message, true)};
        throw err;
      }
    }
    default: return rpcError(id, -32601, 'Method not found');
  }
}
