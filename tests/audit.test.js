const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnvironment, CookieJar, createTestClient } = require('./helpers/testHelper');

describe('Audit Trail & Compliance Suite', () => {
  let env;
  let client;
  let app;

  const adminJar = new CookieJar();
  let adminUser;

  before(async () => {
    env = setupTestEnvironment();
    const serverModule = require('../src/server');
    app = serverModule.app;
    client = createTestClient(app);
    await client.start();

    // Register Org Admin
    const res = await client.request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Audit Officer',
        email: 'officer@compliance.org',
        password: 'Password123!',
        organizationName: 'Compliance Org'
      }
    }, adminJar);
    const data = await res.json();
    adminUser = data.user;
  });

  after(async () => {
    await client.stop();
    env.cleanup();
  });

  test('Registration and login events are correctly recorded in audit trail', async () => {
    const res = await client.request('/api/audit', { method: 'GET' }, adminJar);
    assert.equal(res.status, 200);
    const data = await res.json();

    const regEvent = data.logs.find(l => l.action === 'user_registered');
    assert.ok(regEvent, 'user_registered event must be recorded');
    assert.equal(regEvent.outcome, 'success');
  });

  test('Failed login attempts are recorded in audit trail', async () => {
    const badJar = new CookieJar();
    await client.request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'officer@compliance.org',
        password: 'WrongPassword999!'
      }
    }, badJar);

    // Fetch audit logs as Admin
    const res = await client.request('/api/audit?action=login_failed', { method: 'GET' }, adminJar);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.logs.length > 0, 'login_failed event must be logged');
    assert.equal(data.logs[0].outcome, 'failure');
  });

  test('Audit log records do not contain raw passwords or secrets in details', async () => {
    const res = await client.request('/api/audit', { method: 'GET' }, adminJar);
    const data = await res.json();

    for (const log of data.logs) {
      if (log.details) {
        assert.equal(log.details.password, undefined);
        assert.equal(log.details.passwordHash, undefined);
        assert.equal(log.details.password_hash, undefined);
      }
    }
  });

  test('No ordinary API routes exist to delete or alter audit logs', async () => {
    const delRes = await client.request('/api/audit', { method: 'DELETE' }, adminJar);
    assert.ok([404, 405].includes(delRes.status), 'Audit logs must not have a delete endpoint');

    const putRes = await client.request('/api/audit', { method: 'PUT', body: {} }, adminJar);
    assert.ok([404, 405].includes(putRes.status), 'Audit logs must not have an update endpoint');
  });
});
