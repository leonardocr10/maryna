// Minimal MCP server over Streamable HTTP (JSON responses, no server-initiated stream): initialize, ping,
// tools/list and tools/call. Tool logic is injected, so this file has no database and no clinical data.
import {MCP_SERVER_INSTRUCTIONS} from './prompts.mjs';
import {SCOPES} from './oauth.mjs';

export const PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];
const oauth = scopes => [{type: 'oauth2', scopes}];
const code = {type: 'string', description: 'Código da tarefa mostrado no NeuroLaudos IA, no formato NL-XXXX-XXXX.'};

export const TOOLS = [
  {
    name: 'obter_anamnese_pendente',
    title: 'Obter anamnese pendente',
    description: 'Use quando a psicóloga informar um código NL-XXXX-XXXX de anamnese pendente. Retorna as anotações da anamnese (com nomes e datas trocados por marcadores), a instrução de redação e o formato esperado. Não use para outros pacientes nem sem código.',
    inputSchema: {type: 'object', properties: {codigo: code}, required: ['codigo'], additionalProperties: false},
    annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    securitySchemes: oauth([SCOPES.read]),
    _meta: {securitySchemes: oauth([SCOPES.read])},
    scope: SCOPES.read,
  },
  {
    name: 'salvar_rascunho_anamnese',
    title: 'Salvar rascunho da anamnese',
    description: 'Use depois de redigir a anamnese pedida por obter_anamnese_pendente, para salvar o texto final como RASCUNHO no NeuroLaudos IA. Não sobrescreve anamnese já existente sem a confirmação da psicóloga no sistema. Envie só o texto final, com os marcadores ([PACIENTE] etc.) iguais aos recebidos.',
    inputSchema: {
      type: 'object',
      properties: {
        codigo: code,
        texto: {type: 'string', description: 'Anamnese final em português: cada tópico com uma linha "## Título" e parágrafos separados por linha em branco.'},
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
    name: 'consultar_status_anamnese',
    title: 'Consultar status da anamnese',
    description: 'Use para saber em que situação está uma tarefa de anamnese: pendente, em processamento, rascunho recebido, revisado, erro ou expirada.',
    inputSchema: {type: 'object', properties: {codigo: code}, required: ['codigo'], additionalProperties: false},
    annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    securitySchemes: oauth([SCOPES.read]),
    _meta: {securitySchemes: oauth([SCOPES.read])},
    scope: SCOPES.read,
  },
];
const publicTool = ({scope, ...t}) => t;

/** A tool failure the model can read (the HTTP request itself succeeded). */
export class ToolError extends Error {}
const rpcError = (id, code, message) => ({jsonrpc: '2.0', id: id ?? null, error: {code, message}});
const textResult = (data, isError = false) => ({content: [{type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)}], ...(isError ? {isError: true} : {structuredContent: data})});

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
      const tool = TOOLS.find(t => t.name === params?.name);
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
