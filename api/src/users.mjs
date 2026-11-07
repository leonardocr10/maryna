// User accounts and roles: input checks and the rules that keep the clinic administrable.
// Routes live in server.mjs; everything here is pure, so it is tested without a server.

export const ROLES = ['admin', 'psychologist', 'assistant'];
export const ROLE_NAMES = {admin: 'Administrador', psychologist: 'Psicóloga(o)', assistant: 'Estagiária(o) / assistente'};
export const MIN_PASSWORD = 10;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const err = (status, message) => Object.assign(new Error(message), {status});

export const normEmail = v => String(v || '').trim().toLowerCase();
const normName = v => String(v || '').replace(/\s+/g, ' ').trim();

export function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw err(400, `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
  if (password.length > 200) throw err(400, 'Senha longa demais');
  return password;
}

/** New account: name, e-mail, role and the temporary password the admin hands over. */
export function newUserInput(body) {
  const name = normName(body?.name), email = normEmail(body?.email), role = String(body?.role || '');
  if (name.length < 2 || name.length > 120) throw err(400, 'Informe o nome (2 a 120 caracteres)');
  if (!EMAIL.test(email) || email.length > 200) throw err(400, 'E-mail inválido');
  if (!ROLES.includes(role)) throw err(400, 'Papel inválido');
  return {name, email, role, password: checkPassword(body?.password)};
}

/** Changes to an existing account; only the fields sent are changed. */
export function userChanges(body) {
  const out = {};
  if (body?.name !== undefined) { out.name = normName(body.name); if (out.name.length < 2 || out.name.length > 120) throw err(400, 'Informe o nome (2 a 120 caracteres)'); }
  if (body?.role !== undefined) { if (!ROLES.includes(body.role)) throw err(400, 'Papel inválido'); out.role = body.role; }
  if (body?.active !== undefined) { if (typeof body.active !== 'boolean') throw err(400, 'Valor inválido para ativo'); out.active = body.active; }
  if (!Object.keys(out).length) throw err(400, 'Nada para alterar');
  return out;
}

/**
 * Blocks changes that would lock the clinic out: an admin cannot demote or deactivate their own account,
 * and the last active administrator always stays an active administrator.
 * @param actorId who is making the change
 * @param target the account as it is now ({id, role, active})
 * @param changes result of userChanges
 * @param otherActiveAdmins active admins besides the target
 */
export function guardChange(actorId, target, changes, otherActiveAdmins) {
  const self = actorId === target.id;
  if (self && changes.role !== undefined && changes.role !== target.role) throw err(409, 'Você não pode mudar o seu próprio papel. Peça a outro administrador.');
  if (self && changes.active === false) throw err(409, 'Você não pode desativar a sua própria conta.');
  const staysAdmin = (changes.role ?? target.role) === 'admin' && (changes.active ?? !!target.active);
  if (target.role === 'admin' && target.active && !staysAdmin && otherActiveAdmins < 1) throw err(409, 'É preciso manter pelo menos um administrador ativo.');
}

/** What the account list shows (never the password hash). */
export const publicUser = u => ({id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active,
  must_change_password: !!u.must_change_password, mfa_enabled: !!u.totp_enabled_at, created_at: u.created_at, last_login_at: u.last_login_at || null});
