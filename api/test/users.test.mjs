import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newUserInput, userChanges, guardChange, publicUser, checkPassword} from '../src/users.mjs';

const status = fn => { try { fn(); return 0; } catch (e) { return e.status; } };

test('new account: normalises e-mail and name, checks role and password', () => {
  assert.deepEqual(newUserInput({name: '  Ana   Sintética ', email: ' Ana@Exemplo.TEST ', role: 'assistant', password: '1234567890'}),
    {name: 'Ana Sintética', email: 'ana@exemplo.test', role: 'assistant', password: '1234567890'});
  assert.equal(status(() => newUserInput({name: 'A', email: 'a@b.co', role: 'admin', password: '1234567890'})), 400);
  assert.equal(status(() => newUserInput({name: 'Ana', email: 'sem-arroba', role: 'admin', password: '1234567890'})), 400);
  assert.equal(status(() => newUserInput({name: 'Ana', email: 'a@b.co', role: 'root', password: '1234567890'})), 400);
  assert.equal(status(() => newUserInput({name: 'Ana', email: 'a@b.co', role: 'admin', password: 'curta'})), 400);
  assert.equal(status(() => checkPassword(undefined)), 400);
});

test('changes: only the fields sent, each validated', () => {
  assert.deepEqual(userChanges({active: false}), {active: false});
  assert.deepEqual(userChanges({role: 'psychologist', name: ' Bia '}), {role: 'psychologist', name: 'Bia'});
  assert.equal(status(() => userChanges({})), 400);
  assert.equal(status(() => userChanges({active: 'no'})), 400);
  assert.equal(status(() => userChanges({role: 'dono'})), 400);
});

test('an admin cannot demote or deactivate their own account', () => {
  const me = {id: 'a', role: 'admin', active: 1};
  assert.equal(status(() => guardChange('a', me, {role: 'psychologist'}, 3)), 409);
  assert.equal(status(() => guardChange('a', me, {active: false}, 3)), 409);
  assert.equal(status(() => guardChange('a', me, {name: 'Novo nome', role: 'admin', active: true}, 0)), 0);
});

test('the last active admin stays an active admin', () => {
  const other = {id: 'b', role: 'admin', active: 1};
  assert.equal(status(() => guardChange('a', other, {active: false}, 0)), 409);
  assert.equal(status(() => guardChange('a', other, {role: 'assistant'}, 0)), 409);
  assert.equal(status(() => guardChange('a', other, {active: false}, 1)), 0);
  // demoting a non-admin or touching an inactive admin is never blocked by this rule
  assert.equal(status(() => guardChange('a', {id: 'c', role: 'assistant', active: 1}, {active: false}, 0)), 0);
  assert.equal(status(() => guardChange('a', {id: 'd', role: 'admin', active: 0}, {role: 'assistant'}, 0)), 0);
});

test('the public view never carries the password hash', () => {
  const u = publicUser({id: 'x', name: 'N', email: 'n@e.test', role: 'admin', active: 1, password_hash: 'segredo', token_version: 3, must_change_password: 1});
  assert.equal(u.password_hash, undefined);
  assert.equal(u.token_version, undefined);
  assert.equal(u.must_change_password, true);
});
