const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupTestEnvironment, CookieJar, createTestClient } = require('./helpers/testHelper');

describe('Document Lifecycle & Storage Suite', () => {
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
    const regRes = await client.request('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Chief Scientist',
        email: 'scientist@vault.org',
        password: 'Password2026!',
        organizationName: 'Vault Research Inc'
      }
    }, adminJar);
    const data = await regRes.json();
    adminUser = data.user;
  });

  after(async () => {
    await client.stop();
    env.cleanup();
  });

  test('Upload accepts valid supported file and records metadata in database', async () => {
    const boundary = '----WebKitFormBoundaryTest123456';
    const content = 'CONFIDENTIAL RESEARCH DATA SPECIFICATION v1.0\nAuthorized personnel only.';
    const body = 
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="title"\r\n\r\n` +
      `Research Architecture\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="spec.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--\r\n`;

    const res = await client.request('/api/documents/upload', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    }, adminJar);

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.document);
    assert.equal(data.document.title, 'Research Architecture');
    assert.equal(data.document.original_name, 'spec.txt');

    // Verify stored file is in private storage, NOT public
    const dbDoc = env.db.prepare('SELECT storage_path FROM documents WHERE id = ?').get(data.document.id);
    assert.ok(dbDoc.storage_path);
    const storedFilePath = path.join(env.storageDir, dbDoc.storage_path);
    assert.ok(fs.existsSync(storedFilePath), 'Stored file must exist in private storageDir');

    // Confirm stored file is NOT inside public directory
    const publicPath = path.join(__dirname, '..', '..', 'public', dbDoc.storage_path);
    assert.equal(fs.existsSync(publicPath), false, 'Private file must not be accessible via static public directory');
  });

  test('Upload rejects unsupported file extension (.exe)', async () => {
    const boundary = '----WebKitFormBoundaryTest999';
    const body = 
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="malicious.exe"\r\n` +
      `Content-Type: application/x-msdownload\r\n\r\n` +
      `MZ999fakeexecutablebinary\r\n` +
      `--${boundary}--\r\n`;

    const res = await client.request('/api/documents/upload', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    }, adminJar);

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('restricted'));
  });

  test('Document preview streams file with inline disposition and correct content type', async () => {
    // List documents to get ID
    const listRes = await client.request('/api/documents', { method: 'GET' }, adminJar);
    const listData = await listRes.json();
    const doc = listData.documents[0];

    const previewRes = await client.request(`/api/documents/${doc.id}/preview`, { method: 'GET' }, adminJar);
    assert.equal(previewRes.status, 200);
    assert.ok(previewRes.headers.get('content-type').includes('text/plain'));
    assert.ok(previewRes.headers.get('content-disposition').includes('inline'));

    const text = await previewRes.text();
    assert.ok(text.includes('CONFIDENTIAL RESEARCH DATA'));
  });

  test('Document download streams file with attachment disposition', async () => {
    const listRes = await client.request('/api/documents', { method: 'GET' }, adminJar);
    const listData = await listRes.json();
    const doc = listData.documents[0];

    const downloadRes = await client.request(`/api/documents/${doc.id}/download`, { method: 'GET' }, adminJar);
    assert.equal(downloadRes.status, 200);
    assert.ok(downloadRes.headers.get('content-disposition').includes('attachment'));
    assert.ok(downloadRes.headers.get('content-disposition').includes('spec.txt'));
  });

  test('Document deletion removes database record and deletes physical file from storage', async () => {
    const listRes = await client.request('/api/documents', { method: 'GET' }, adminJar);
    const listData = await listRes.json();
    const doc = listData.documents[0];

    const dbDocBefore = env.db.prepare('SELECT storage_path FROM documents WHERE id = ?').get(doc.id);
    const storedFilePath = path.join(env.storageDir, dbDocBefore.storage_path);
    assert.ok(fs.existsSync(storedFilePath), 'File should exist prior to deletion');

    // Delete document
    const delRes = await client.request(`/api/documents/${doc.id}`, { method: 'DELETE' }, adminJar);
    assert.equal(delRes.status, 200);

    // Verify database record removed
    const dbDocAfter = env.db.prepare('SELECT id FROM documents WHERE id = ?').get(doc.id);
    assert.equal(dbDocAfter, undefined);

    // Verify physical file deleted from storage
    assert.equal(fs.existsSync(storedFilePath), false, 'Physical file must be deleted upon document removal');
  });
});
