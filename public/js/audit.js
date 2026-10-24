/**
 * TrustVault Audit Trail Client Script
 */
(function () {
  'use strict';

  let currentLogs = [];

  function formatDate(isoString) {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return isoString;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getActionBadge(action) {
    let colorClass = 'role-viewer';
    if (action.includes('login') || action.includes('register')) {
      colorClass = 'role-admin';
    } else if (action.includes('upload') || action.includes('download') || action.includes('preview')) {
      colorClass = 'role-editor';
    } else if (action.includes('delete') || action.includes('revoked')) {
      colorClass = 'role-danger';
    }
    return `<span class="role-badge ${colorClass}">${escapeHtml(action)}</span>`;
  }

  async function loadAuditLogs() {
    const tbody = document.getElementById('tbody-audit');
    const action = document.getElementById('filter-action')?.value || '';
    const outcome = document.getElementById('filter-outcome')?.value || '';

    let url = '/api/audit?limit=100';
    if (action) url += `&action=${encodeURIComponent(action)}`;
    if (outcome) url += `&outcome=${encodeURIComponent(outcome)}`;

    try {
      const res = await window.TrustVault.auth.apiFetch(url);
      if (!res.ok) {
        throw new Error('Failed to load audit records');
      }

      const data = await res.json();
      currentLogs = data.logs || [];
      renderAuditLogs(currentLogs);
    } catch (err) {
      console.error('[Audit Error]', err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--status-danger);">
              Failed to load audit records.
            </td>
          </tr>
        `;
      }
    }
  }

  function renderAuditLogs(logs) {
    const tbody = document.getElementById('tbody-audit');
    if (!tbody) return;

    if (logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7">
            <div class="empty-state">
              <div class="empty-icon">📜</div>
              <div class="empty-title">No audit records found</div>
              <p class="empty-desc">No events matched the selected filters.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    let html = '';
    for (const log of logs) {
      const outcomeBadge = log.outcome === 'success'
        ? '<span class="role-badge role-admin">SUCCESS</span>'
        : '<span class="role-badge role-danger">FAILURE</span>';

      html += `
        <tr>
          <td style="font-size: 0.82rem; font-family: monospace;">${formatDate(log.timestamp)}</td>
          <td>
            <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(log.actor_name || 'System / Unauth')}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(log.actor_id || '')}</div>
          </td>
          <td>${getActionBadge(log.action)}</td>
          <td style="text-transform: capitalize;">${escapeHtml(log.resource_type || '-')}</td>
          <td>${outcomeBadge}</td>
          <td style="font-family: monospace; font-size: 0.82rem;">${escapeHtml(log.ip_address || '-')}</td>
          <td style="text-align: right;">
            <button type="button" class="btn btn-ghost btn-sm btn-view-details" data-id="${escapeHtml(log.id)}">
              Inspect
            </button>
          </td>
        </tr>
      `;
    }

    tbody.innerHTML = html;

    // Attach inspect click handlers
    tbody.querySelectorAll('.btn-view-details').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        const log = currentLogs.find(l => l.id === id);
        if (log) {
          openDetailsModal(log);
        }
      };
    });
  }

  function openDetailsModal(log) {
    const modal = document.getElementById('modal-audit-details');
    const pre = document.getElementById('audit-details-json');
    if (pre) {
      pre.textContent = JSON.stringify(log, null, 2);
    }
    if (modal) modal.classList.add('active');
  }

  function closeDetailsModal() {
    const modal = document.getElementById('modal-audit-details');
    if (modal) modal.classList.remove('active');
  }

  window.TrustVault.onReady(() => {
    window.TrustVault.auth.init({
      requireAuth: true,
      onReady: (user) => {
        if (!user) return;

        if (user.role !== 'admin') {
          window.TrustVault.auth.showToast('Administrator privileges required to view audit trail.', 'error');
          setTimeout(() => window.location.replace('/dashboard.html'), 1500);
          return;
        }

        document.getElementById('filter-action')?.addEventListener('change', loadAuditLogs);
        document.getElementById('filter-outcome')?.addEventListener('change', loadAuditLogs);
        document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
          const fa = document.getElementById('filter-action');
          const fo = document.getElementById('filter-outcome');
          if (fa) fa.value = '';
          if (fo) fo.value = '';
          loadAuditLogs();
        });

        document.getElementById('btn-close-details')?.addEventListener('click', closeDetailsModal);
        document.getElementById('btn-dismiss-details')?.addEventListener('click', closeDetailsModal);

        loadAuditLogs();
      }
    });
  });
})();
