const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnvironment, CookieJar, createTestClient } = require('./helpers/testHelper');

describe('Document Sharing & Revocation Suite', () => {
  let env;
  let client;
  let app;

  const adminJar = new CookieJar();
  const viewerJar = new CookieJar();

  let adminUser;
  let viewerUser;
  let testDocId;

  before(async () => {
    env = setupTestEnvironment();
    const serverModule = require('../src/server');
    app = serverModule.app;
    client = createTestClient(app);
    await client.start();

    // 1. Register Admin
    const regRes = await client.request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Dr. Katherine Bell',
        email: 'katherine@defense.org',
        password: 'Password2026!',
        organizationName: 'Defense Science Org'
      }
    }, adminJar);
    const regData = await regRes.json();
    adminUser = regData.user;

    // 2. Admin adds Viewer colleague
    const addVwRes = await client.request('/api/members', {
      method: 'POST',
      body: {
        name: 'Researcher Leo',
        email: 'leo@defense.org',
        password: 'LeoPassword123!',
        role: 'viewer'
      }
    }, adminJar);
    const vwData = await addVwRes.json();
    viewerUser = vwData.member;

    // Log in Viewer
    await client.request('/api/auth/login', {
      method: 'POST',
      body: {
        email: 'leo@defense.org',
        password: 'LeoPassword123!'
      }
    }, viewerJar);

    // 3. Admin uploads document
    const boundary = '----BoundarySharingSpec';
    const body = 
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="title"\r\n\r\n` +
      `Classified Laser Specs\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="laser_spec.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `HIGHLY CLASSIFIED LASER DATA\r\n` +
      `--${boundary}--\r\n`;

    const uploadRes = await client.request('/api/documents/upload', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    }, adminJar);
    const uploadData = await uploadRes.json();
    testDocId = uploadData.document.id;
  });

  after(async () => {
    await client.stop();
    env.cleanup();
  });

  test('Viewer cannot access unshared document', async () => {
    const previewRes = await client.request(`/api/documents/${testDocId}/preview`, { method: 'GET' }, viewerJar);
    assert.equal(previewRes.status, 403);

    const downloadRes = await client.request(`/api/documents/${testDocId}/download`, { method: 'GET' }, viewerJar);
    assert.equal(downloadRes.status, 403);
  });

  test('Admin shares document with Viewer and Viewer gains access', async () => {
    const shareRes = await client.request(`/api/documents/${testDocId}/share`, {
      method: 'POST',
      body: {
        targetUserId: viewerUser.id,
        permission: 'view'
      }
    }, adminJar);

    assert.equal(shareRes.status, 200);
    const shareData = await shareRes.json();
    assert.equal(shareData.success, true);

    // Viewer can now preview
    const previewRes = await client.request(`/api/documents/${testDocId}/preview`, { method: 'GET' }, viewerJar);
    assert.equal(previewRes.status, 200);
    const text = await previewRes.text();
    assert.ok(text.includes('HIGHLY CLASSIFIED LASER DATA'));

    // Viewer can now download
    const downloadRes = await client.request(`/api/documents/${testDocId}/download`, { method: 'GET' }, viewerJar);
    assert.equal(downloadRes.status, 200);
  });

  test('Revoking share immediately removes access for the recipient', async () => {
    const revokeRes = await client.request(`/api/documents/${testDocId}/share/${viewerUser.id}`, {
      method: 'DELETE'
    }, adminJar);

    assert.equal(revokeRes.status, 200);

    // Immediate check: Viewer preview must be rejected
    const previewRes = await client.request(`/api/documents/${testDocId}/preview`, { method: 'GET' }, viewerJar);
    assert.equal(previewRes.status, 403);

    // Immediate check: Viewer download must be rejected
    const downloadRes = await client.request(`/api/documents/${testDocId}/download`, { method: 'GET' }, viewerJar);
    assert.equal(downloadRes.status, 403);
  });
});
