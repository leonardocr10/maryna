// Ditado por voz: configuration and the request that opens a Realtime transcription session.
// The browser streams the microphone straight to OpenAI over WebRTC with a short-lived client secret minted here, so
// the standard API key never leaves the server and neither audio nor transcript passes through (or is logged by) this API.
import {createHash} from 'node:crypto';
import {DICTATION_PROMPT, DICTATION_KEYWORDS} from './prompts.mjs';

export const DICTATION_DEFAULT_MODEL = 'gpt-live-transcribe';
const DELAYS = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const int = (v, def, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== '' && v != null ? Math.min(max, Math.max(min, n)) : def; };

/** Settings read from api/.env. Dictation is off unless every privacy gate is on (AGENTS.md rule 6). */
export function dictationConfig(env = process.env) {
  const model = String(env.DICTATION_MODEL || DICTATION_DEFAULT_MODEL).trim();
  const delay = DELAYS.includes(env.DICTATION_DELAY) ? env.DICTATION_DELAY : 'low';
  const extra = String(env.DICTATION_KEYWORDS || '').split(/[;,\n]/).map(s => s.trim()).filter(Boolean);
  const blockers = [];
  if (!env.OPENAI_API_KEY) blockers.push('Chave OPENAI_API_KEY não configurada no servidor.');
  if (env.AI_ENABLED !== 'true' || env.ALLOW_EXTERNAL_AI !== 'true') blockers.push('Envio externo desligado (AI_ENABLED e ALLOW_EXTERNAL_AI).');
  if (env.DICTATION_ENABLED !== 'true') blockers.push('Ditado por voz desligado (DICTATION_ENABLED=true no api/.env, após autorização da psicóloga).');
  if (!/^[a-zA-Z0-9._-]{2,100}$/.test(model)) blockers.push('DICTATION_MODEL inválido.');
  return {
    enabled: blockers.length === 0, blockers, model, delay,
    keywords: cleanKeywords([...DICTATION_KEYWORDS, ...extra]),
    maxSeconds: int(env.DICTATION_MAX_SECONDS, 900, 30, 3600),
    dailyLimit: int(env.DICTATION_DAILY_LIMIT, 80, 1, 10000),
  };
}

/** Keywords must be single-line and free of < and > (the API rejects the session otherwise). */
export function cleanKeywords(list) {
  const out = [];
  for (const k of list) { const v = String(k).replace(/[<>\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); if (v && !out.includes(v)) out.push(v); }
  return out.slice(0, 100);
}

/** Body of POST /v1/realtime/client_secrets for a transcription-only session (no spoken answer, no generation). */
export function clientSecretRequest(cfg) {
  return {
    // The secret only has to last until the browser finishes the WebRTC handshake.
    expires_after: {anchor: 'created_at', seconds: 60},
    session: {
      type: 'transcription',
      audio: {input: {
        noise_reduction: {type: 'near_field'},
        transcription: {model: cfg.model, languages: ['pt'], prompt: DICTATION_PROMPT, keywords: cfg.keywords, delay: cfg.delay},
        // gpt-live-transcribe has no server VAD: the browser commits each turn after a pause.
        turn_detection: null,
      }},
    },
  };
}

/** Stable, non-identifying value for OpenAI-Safety-Identifier. */
export const safetyId = userId => createHash('sha256').update('neurolaudos:' + String(userId)).digest('hex').slice(0, 32);

/** Turns an OpenAI HTTP failure into a message for the psychologist, without echoing request content. */
export function dictationError(status, body) {
  const msg = String(body?.error?.message || '');
  if (status === 401) return 'A chave da API OpenAI foi recusada. Confira OPENAI_API_KEY no api/.env.';
  if (status === 404 || /model/i.test(msg) && /not (found|exist)|does not have access/i.test(msg)) return 'O modelo de transcrição configurado não está disponível nesta conta da API OpenAI.';
  if (status === 429) return /quota|billing|credit/i.test(msg) ? 'Sem crédito na conta da API OpenAI para o ditado.' : 'Muitas sessões de ditado em sequência. Aguarde um pouco.';
  if (status >= 500) return 'O serviço de transcrição da OpenAI está indisponível agora. Tente de novo em instantes.';
  return 'Não foi possível abrir a sessão de ditado (' + status + ').';
}
