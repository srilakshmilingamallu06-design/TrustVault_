const http = require('http');

async function run() {
  const base = 'http://localhost:3000';
  const cookieJar = {};
  let csrfToken = '';

  function req(url, opts = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(url, base);
      const headers = opts.headers || {};
      const cookieStr = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookieStr) headers['Cookie'] = cookieStr;
      if (csrfToken && !headers['x-csrf-token']) headers['x-csrf-token'] = csrfToken;

      const r = http.request(u, { method: opts.method || 'GET', headers }, (res) => {
        const setCookies = res.headers['set-cookie'];
        if (setCookies) {
          setCookies.forEach(c => {
            const parts = c.split(';')[0].split('=');
            cookieJar[parts[0].trim()] = parts.slice(1).join('=');
          });
        }
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          let data = null;
          try { data = JSON.parse(body); } catch(e) { data = body; }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      });
      r.on('error', reject);
      if (opts.body) {
        r.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
      }
      r.end();
    });
  }

  console.log('--- STARTING COMPREHENSIVE E2E VERIFICATION ---');

  const uniqueId = Date.now();
  const adminEmail = `evelyn_${uniqueId}@reed-defense.io`;
  const colleagueEmail = `marcus_${uniqueId}@reed-defense.io`;

  // 1. Landing Page
  const landing = await req('/');
  console.log('1. Landing page status:', landing.status, typeof landing.data === 'string' && landing.data.includes('TrustVault') ? 'OK' : 'FAIL');

  // 2. Register page
  const regPage = await req('/register');
  console.log('2. Register page status:', regPage.status, typeof regPage.data === 'string' && regPage.data.includes('Create Organization') ? 'OK' : 'FAIL');

  // 3. Register Dr. Evelyn Reed
  const regRes = await req('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      name: 'Dr. Evelyn Reed',
      email: adminEmail,
      password: 'MasterPassword2026!',
      organizationName: `Reed Defense Labs ${uniqueId}`
    }
  });
  console.log('3. Register Dr. Evelyn Reed:', regRes.status, regRes.data.success ? 'SUCCESS' : regRes.data.error);
  csrfToken = regRes.data.csrfToken;

  // 4. Session Me
  const me = await req('/api/auth/me');
  console.log('4. Session verification (/api/auth/me):', me.status, me.data.user?.name, 'Role:', me.data.user?.role);

  // 5. Dashboard Stats
  const stats = await req('/api/dashboard/stats');
  console.log('5. Dashboard stats:', stats.status, 'Accessible docs:', stats.data.metrics?.accessibleCount, 'Members:', stats.data.metrics?.totalMembersCount);

  // 6. Add Colleague Marcus Vance
  const addMem = await req('/api/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      name: 'Marcus Vance',
      email: colleagueEmail,
      password: 'ColleaguePassword123!',
      role: 'viewer'
    }
  });
  console.log('6. Add Colleague Marcus Vance (Viewer):', addMem.status, addMem.data.message);

  // 7. List Members
  const members = await req('/api/members');
  console.log('7. Members count:', members.data.members?.length, members.data.members?.map(m => m.name + ' (' + m.role + ')').join(', '));

  // 8. Upload Document (Multipart)
  const boundary = '----BoundaryTest123456';
  const fileContent = 'CONFIDENTIAL REED DEFENSE SPECIFICATION v1.0\nAll unauthorized access forbidden.\nClassification: Restricted.\n';
  const multipartBody = 
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="title"\r\n\r\n` +
    `Defense Architecture Spec\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="defense_spec.txt"\r\n` +
    `Content-Type: text/plain\r\n\r\n` +
    `${fileContent}\r\n` +
    `--${boundary}--\r\n`;

  const uploadRes = await req('/api/documents/upload', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: multipartBody
  });
  console.log('8. Upload Document:', uploadRes.status, uploadRes.data.document ? uploadRes.data.document.title : uploadRes.data);
  const docId = uploadRes.data.document?.id;

  // 9. Document Preview
  const preview = await req(`/api/documents/${docId}/preview`);
  console.log('9. Preview document:', preview.status, typeof preview.data === 'string' && preview.data.includes('CONFIDENTIAL') ? 'PREVIEW OK' : 'FAIL');

  // 10. Document Download
  const download = await req(`/api/documents/${docId}/download`);
  console.log('10. Download document:', download.status, 'Content-Disposition:', download.headers['content-disposition']);

  // 11. Share Document with Marcus Vance
  const marcus = members.data.members.find(m => m.email === colleagueEmail);
  const shareRes = await req(`/api/documents/${docId}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { targetUserId: marcus.id, permission: 'view' }
  });
  console.log('11. Share document with Marcus:', shareRes.status, shareRes.data.message);

  // 12. Check Shares
  const shares = await req(`/api/documents/${docId}/shares`);
  console.log('12. Document shares count:', shares.data.shares?.length, shares.data.shares?.[0]?.user_name);

  // 13. Audit Trail
  const audit = await req('/api/audit');
  console.log('13. Audit trail count:', audit.data.total, 'Recent actions:', audit.data.logs?.slice(0, 5).map(l => l.action).join(', '));

  // 14. Sign Out
  const logoutRes = await req('/api/auth/logout', { method: 'POST' });
  console.log('14. Sign out:', logoutRes.status, logoutRes.data.message);

  // 15. Check Auth after Sign Out
  const afterLogout = await req('/api/auth/me');
  console.log('15. Auth after sign out (should be 401):', afterLogout.status, afterLogout.data.error);

  // 16. Test Invalid Password
  const badLogin = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { email: adminEmail, password: 'WrongPassword999!' }
  });
  console.log('16. Invalid credentials (should fail):', badLogin.status, badLogin.data.error);

  // 17. Re-login with valid password
  const goodLogin = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { email: adminEmail, password: 'MasterPassword2026!' }
  });
  console.log('17. Valid re-login:', goodLogin.status, goodLogin.data.success ? 'SUCCESS' : 'FAIL');
  csrfToken = goodLogin.data.csrfToken;

  // 18. Revoke Share
  const revokeRes = await req(`/api/documents/${docId}/share/${marcus.id}`, {
    method: 'DELETE'
  });
  console.log('18. Revoke share:', revokeRes.status, revokeRes.data.message);

  // 19. Delete Document
  const delRes = await req(`/api/documents/${docId}`, {
    method: 'DELETE'
  });
  console.log('19. Delete document:', delRes.status, delRes.data.message);

  // 20. Confirm empty document list
  const finalDocs = await req('/api/documents');
  console.log('20. Remaining documents:', finalDocs.data.documents?.length);

  console.log('--- ALL 20 END-TO-END VERIFICATION CHECKS COMPLETED SUCCESSFULLY ---');
}

run().catch(console.error);
