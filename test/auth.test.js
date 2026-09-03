import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../src/auth.js';

test('senha válida confere e senha incorreta é rejeitada', async () => {
  const hash = await hashPassword('senha-segura');
  assert.equal(await verifyPassword('senha-segura', hash), true);
  assert.equal(await verifyPassword('senha-errada', hash), false);
});

test('token válido preserva usuário e versão da sessão', () => {
  const token = signToken({ id: 'usuario-1', session_version: 3 }, 'segredo-de-teste');
  const payload = verifyToken(token, 'segredo-de-teste');
  assert.equal(payload.id, 'usuario-1');
  assert.equal(payload.version, 3);
});

test('token adulterado ou assinado com outro segredo é rejeitado', () => {
  const token = signToken({ id: 'usuario-1', session_version: 1 }, 'segredo-correto');
  assert.equal(verifyToken(`${token}x`, 'segredo-correto'), null);
  assert.equal(verifyToken(token, 'outro-segredo'), null);
});

test('token expirado é rejeitado', () => {
  const token = signToken({ id: 'usuario-1', session_version: 1 }, 'segredo-de-teste', -1);
  assert.equal(verifyToken(token, 'segredo-de-teste'), null);
});
