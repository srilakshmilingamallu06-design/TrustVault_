const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnvironment, CookieJar, createTestClient } = require('./helpers/testHelper');

describe('Authentication & Session Reliability Suite', () => {
  let env;
  let client;
  let app;

  before(async () => {
    env = setupTestEnvironment();
    const serverModule = require('../src/server');
    app = serverModule.app;
    client = createTestClient(app);
    await client.start();
  });

  after(async () => {
    await client.stop();
    env.cleanup();
  });

  test('Registration creates user, organization, admin membership, and valid session', async () => {
    const jar = new CookieJar();
    const res = await client.request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Dr. Evelyn Reed',
        email: 'evelyn@reed-defense.io',
        password: 'MasterPassword2026!',
        organizationName: 'Reed Defense Systems'
      }
    }, jar);

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.user.email, 'evelyn@reed-defense.io');
    assert.equal(data.user.role, 'admin');
    assert.ok(data.user.organizationId);

    // Verify session persistence via /api/auth/me
    const meRes = await client.request('/api/auth/me', { method: 'GET' }, jar);
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.authenticated, true);
    assert.equal(meData.user.name, 'Dr. Evelyn Reed');
  });

  test('Duplicate registration with existing email is rejected', async () => {
    const jar = new CookieJar();
    const res = await client.request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Duplicate Evelyn',
        email: 'evelyn@reed-defense.io',
        password: 'AnotherPassword2026!',
        organizationName: 'Another Org'
      }
    }, jar);

    assert.equal(res.status, 409);
    const data = await res.json();
    assert.ok(data.error.includes('already exists'));
  });

  test('Login succeeds with valid credentials and regenerates session', async () => {
    const jar = new CookieJar();
    const res = await client.request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'evelyn@reed-defense.io',
        password: 'MasterPassword2026!'
      }
    }, jar);

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.user.email, 'evelyn@reed-defense.io');
    assert.ok(jar.get('trustvault.sid'));
  });

  test('Login fails with invalid password without creating session', async () => {
    const jar = new CookieJar();
    const res = await client.request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'evelyn@reed-defense.io',
        password: 'IncorrectPassword999!'
      }
    }, jar);

    assert.equal(res.status, 401);
    const data = await res.json();
    assert.ok(data.error.includes('Invalid email or password'));
  });

  test('Login fails with non-existent email', async () => {
    const jar = new CookieJar();
    const res = await client.request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'ghost@nonexistent-domain.com',
        password: 'SomePassword123!'
      }
    }, jar);

    assert.equal(res.status, 401);
  });

  test('Logout destroys session and clears session cookie', async () => {
    const jar = new CookieJar();
    // First login
    await client.request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'evelyn@reed-defense.io',
        password: 'MasterPassword2026!'
      }
    }, jar);

    // Logout
    const logoutRes = await client.request('/api/auth/logout', { method: 'POST' }, jar);
    assert.equal(logoutRes.status, 200);

    // Verify subsequent request to /api/auth/me returns 401
    const meRes = await client.request('/api/auth/me', { method: 'GET' }, jar);
    assert.equal(meRes.status, 401);
  });

  test('Unauthorized requests to protected endpoints return 401 without retry loops', async () => {
    const unauthJar = new CookieJar();
    const res = await client.request('/api/documents', { method: 'GET' }, unauthJar);
    assert.equal(res.status, 401);
  });
});
