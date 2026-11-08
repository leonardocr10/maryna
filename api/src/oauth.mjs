// OAuth 2.1 authorization server + protected resource for the ChatGPT MCP plugin (MCP authorization spec, RFC 8414,
// RFC 9728, RFC 7591 dynamic client registration, RFC 9207 issuer in the response, PKCE S256 only).
// Pure helpers: the routes that use the database live in chatgpt-routes.mjs.
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

export const SCOPES = {read: 'anamnese.ler', write: 'anamnese.salvar'};
export const ALL_SCOPES = [SCOPES.read, SCOPES.write];
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 30 * 86400;
export const CODE_TTL_S = 300;
export const REQUEST_TTL_S = 600;

/** Opaque random token; only its SHA-256 is stored, so a copy of the database does not hold usable tokens. */
export const newSecret = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hashSecret = value => createHash('sha256').update(String(value)).digest('hex');

/** PKCE S256: BASE64URL(SHA256(verifier)) === challenge, in constant time. */
export function pkceOk(verifier, challenge) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || typeof challenge !== 'string') return false;
  const a = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Public base URL (https, no trailing slash) or null when it is missing or unsafe. */
export function publicBase(value) {
  try {
    const u = new URL(String(value || ''));
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    if (u.search || u.hash || u.username || u.password) return null;
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch { return null; }
}
export const mcpResource = base => base + '/api/mcp';
export const prmUrl = base => base + '/.well-known/oauth-protected-resource/api/mcp';

export function protectedResourceMetadata(base) {
  return {resource: mcpResource(base), authorization_servers: [base], scopes_supported: ALL_SCOPES, bearer_methods_supported: ['header'], resource_name: 'NeuroLaudos IA'};
}
export function authServerMetadata(base) {
  return {
    issuer: base,
    authorization_endpoint: base + '/api/oauth/authorize',
    token_endpoint: base + '/api/oauth/token',
    registration_endpoint: base + '/api/oauth/register',
    revocation_endpoint: base + '/api/oauth/revoke',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ALL_SCOPES,
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
  };
}
/** 401 challenge that lets ChatGPT find the metadata and (re)start the OAuth flow. */
export const challenge = (base, scope = SCOPES.read, error) => `Bearer resource_metadata="${prmUrl(base)}", scope="${scope}"${error ? `, error="${error}"` : ''}`;

/** Hosts allowed as redirect targets of registered clients (ChatGPT by default). */
export function redirectHosts(value) {
  return String(value || 'chatgpt.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
/** Only https redirect URIs on an allowed host, without fragment: a stolen code can only land at ChatGPT. */
export function validRedirect(uri, hosts) {
  try {
    const u = new URL(String(uri));
    return u.protocol === 'https:' && !u.hash && !u.username && !u.password && hosts.includes(u.hostname.toLowerCase());
  } catch { return false; }
}
/** Requested scopes limited to the known ones; none requested means both (the plugin needs to read and save). */
export function grantedScopes(scope) {
  const asked = String(scope || '').split(/\s+/).filter(Boolean);
  const known = asked.filter(s => ALL_SCOPES.includes(s));
  return (asked.length ? known : ALL_SCOPES).join(' ');
}
/** Redirect back to the client with the code (or error), always carrying state and iss (RFC 9207). */
export function redirectWith(uri, params, issuer) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries({...params, iss: issuer})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  return u.toString();
}
