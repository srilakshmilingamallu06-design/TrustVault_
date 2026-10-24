const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');

// Ensure test environment variables
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test_secret_for_automated_testing_purposes_only';
process.env.DISABLE_RATE_LIMIT = 'true';

const { initDatabase, closeDatabase, getDb } = require('../../src/database');

/**
 * Create a fresh isolated test environment with custom temp database and storage
 */
function setupTestEnvironment() {
  const testId = crypto.randomUUID();
  const tempDir = path.join(__dirname, '..', 'temp', testId);
  const dataDir = path.join(tempDir, 'data');
  const storageDir = path.join(tempDir, 'storage');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_DIR = storageDir;

  const dbPath = path.join(dataDir, 'test.db');
  closeDatabase();
  const db = initDatabase(dbPath);

  return {
    testId,
    tempDir,
    dataDir,
    storageDir,
    dbPath,
    db,
    cleanup() {
      closeDatabase();
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (err) {
        // Windows file locks may occasionally delay deletion
      }
    }
  };
}

/**
 * Cookie Jar for maintaining sessions across test requests
 */
class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  setFromHeaders(headers) {
    let setCookieHeaders = [];
    if (typeof headers.getSetCookie === 'function') {
      setCookieHeaders = headers.getSetCookie();
    } else {
      const single = headers.get ? headers.get('set-cookie') : headers['set-cookie'];
      if (single) {
        setCookieHeaders = Array.isArray(single) ? single : [single];
      }
    }

    for (const raw of setCookieHeaders) {
      const parts = raw.split(';')[0].split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim();
        this.cookies.set(key, val);
      }
    }
  }

  getCookieHeader() {
    const pairs = [];
    for (const [k, v] of this.cookies.entries()) {
      pairs.push(`${k}=${v}`);
    }
    return pairs.join('; ');
  }

  get(name) {
    return this.cookies.get(name);
  }

  clear() {
    this.cookies.clear();
  }
}

/**
 * Create an HTTP test client bound to an ephemeral port
 */
function createTestClient(app) {
  let server = null;
  let baseUrl = '';

  const start = () => {
    return new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve(baseUrl);
      });
    });
  };

  const stop = () => {
    return new Promise((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
  };

  const request = async (urlPath, options = {}, jar = null) => {
    const fullUrl = `${baseUrl}${urlPath}`;
    const headers = { ...(options.headers || {}) };

    if (jar) {
      const cookieHeader = jar.getCookieHeader();
      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }
      const xsrf = jar.get('XSRF-TOKEN');
      if (xsrf && !headers['x-csrf-token'] && ['POST', 'PUT', 'DELETE', 'PATCH'].includes((options.method || 'GET').toUpperCase())) {
        headers['x-csrf-token'] = xsrf;
      }
    }

    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof Buffer) && !(typeof body.pipe === 'function') && !headers['Content-Type']?.includes('multipart')) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    const response = await fetch(fullUrl, {
      method: options.method || 'GET',
      headers,
      body,
      redirect: 'manual'
    });

    if (jar) {
      jar.setFromHeaders(response.headers);
    }

    return response;
  };

  return {
    start,
    stop,
    request,
    getBaseUrl: () => baseUrl
  };
}

module.exports = {
  setupTestEnvironment,
  CookieJar,
  createTestClient
};
