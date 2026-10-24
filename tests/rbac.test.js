const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnvironment, CookieJar, createTestClient } = require('./helpers/testHelper');

describe('Organization & Role-Based Access Control Suite', () => {
  let env;
  let client;
  let app;

  const adminJar = new CookieJar();
  const editorJar = new CookieJar();
  const viewerJar = new CookieJar();

  let adminUser;
  let editorUser;
  let viewerUser;

  before(async () => {
    env = setupTestEnvironment();
    const serverModule = require('../src/server');
    app = serverModule.app;
    client = createTestClient(app);
    await client.start();

    // 1. Register Org Admin
    const regRes = await client.request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Admin Alpha',
        email: 'alpha@org-a.com',
        password: 'AdminPassword123!',
        organizationName: 'Organization Alpha'
      }
    }, adminJar);
    const regData = await regRes.json();
    adminUser = regData.user;

    // 2. Admin adds Editor
    const addEdRes = await client.request('/api/members', {
      method: 'POST',
      body: {
        name: 'Editor Beta',
        email: 'beta@org-a.com',
        password: 'EditorPassword123!',
        role: 'editor'
      }
    }, adminJar);
    const edData = await addEdRes.json();
    editorUser = edData.member;

    // Log in Editor
    await client.request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'beta@org-a.com',
        password: 'EditorPassword123!'
      }
    }, editorJar);

    // 3. Admin adds Viewer
    const addVwRes = await client.request('/api/members', {
      method: 'POST',
      body: {
        name: 'Viewer Gamma',
        email: 'gamma@org-a.com',
        password: 'ViewerPassword123!',
        role: 'viewer'
      }
    }, adminJar);
    const vwData = await addVwRes.json();
    viewerUser = vwData.member;

    // Log in Viewer
    await client.request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'gamma@org-a.com',
        password: 'ViewerPassword123!'
      }
    }, viewerJar);
  });

  after(async () => {
    await client.stop();
    env.cleanup();
  });

  test('Organization Admin has permission to view audit logs', async () => {
    const res = await client.request('/api/audit', { method: 'GET' }, adminJar);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.logs));
  });

  test('Editor is rejected with 403 when attempting to access audit logs', async () => {
    const res = await client.request('/api/audit', { method: 'GET' }, editorJar);
    assert.equal(res.status, 403);
  });

  test('Viewer is rejected with 403 when attempting to access audit logs', async () => {
    const res = await client.request('/api/audit', { method: 'GET' }, viewerJar);
    assert.equal(res.status, 403);
  });

  test('Editor cannot add new members (Admin only)', async () => {
    const res = await client.request('/api/members', {
      method: 'POST',
      body: {
        name: 'Rogue Member',
        email: 'rogue@org-a.com',
        password: 'Password123!',
        role: 'viewer'
      }
    }, editorJar);

    assert.equal(res.status, 403);
  });

  test('Viewer cannot upload documents (Admin or Editor only)', async () => {
    const boundary = '----BoundaryViewerTest';
    const body = 
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="title"\r\n\r\n` +
      `Viewer Attempt\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `data\r\n` +
      `--${boundary}--\r\n`;

    const res = await client.request('/api/documents/upload', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    }, viewerJar);

    assert.equal(res.status, 403);
  });

  test('Admin cannot demote the last administrator of the organization', async () => {
    const res = await client.request(`/api/members/${adminUser.id}/role`, {
      method: 'PATCH',
      body: { role: 'viewer' }
    }, adminJar);

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('last administrator'));
  });

  test('Strict Tenant Isolation: Org B cannot access Org A documents', async () => {
    // 1. Admin uploads document in Org A
    const boundary = '----BoundaryTenantA';
    const body = 
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="title"\r\n\r\n` +
      `Org A Secret Plan\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="plan.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `ORG A RESTRICTED DATA\r\n` +
      `--${boundary}--\r\n`;

    const uploadRes = await client.request('/api/documents/upload', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    }, adminJar);
    const uploadData = await uploadRes.json();
    const docId = uploadData.document.id;

    // 2. Register separate Organization B
    const orgBJar = new CookieJar();
    await client.request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Competitor Corp Admin',
        email: 'admin@competitor-b.com',
        password: 'CompetitorPassword123!',
        organizationName: 'Competitor B Corp'
      }
    }, orgBJar);

    // 3. Org B attempts to preview Org A document -> must return 404 or 403
    const previewRes = await client.request(`/api/documents/${docId}/preview`, { method: 'GET' }, orgBJar);
    assert.ok([403, 404].includes(previewRes.status), 'Cross-tenant access must be rejected');

    // 4. Org B attempts to download Org A document -> must return 404 or 403
    const downloadRes = await client.request(`/api/documents/${docId}/download`, { method: 'GET' }, orgBJar);
    assert.ok([403, 404].includes(downloadRes.status), 'Cross-tenant download must be rejected');
  });
});
