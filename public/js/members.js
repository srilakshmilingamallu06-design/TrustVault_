/**
 * TrustVault Members & Identity Access Management Script
 */
(function () {
  'use strict';

  function formatDate(isoString) {
    if (!isoString) return 'Never';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
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

  async function loadMembers() {
    const tbody = document.getElementById('tbody-members');
    try {
      const res = await window.TrustVault.auth.apiFetch('/api/members');
      if (!res.ok) {
        throw new Error('Failed to load organization members');
      }

      const data = await res.json();
      const members = data.members || [];
      renderMembers(members);
    } catch (err) {
      console.error('[Members Error]', err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 2.5rem; color: var(--status-danger);">
              Failed to load member records.
            </td>
          </tr>
        `;
      }
    }
  }

  function renderMembers(members) {
    const tbody = document.getElementById('tbody-members');
    if (!tbody) return;

    if (members.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6">
            <div class="empty-state">
              <div class="empty-icon">👥</div>
              <div class="empty-title">No members enrolled</div>
              <p class="empty-desc">Click 'Add Colleague' to enroll team members.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    const currentUserId = window.TrustVault.auth.user?.id;

    let html = '';
    for (const m of members) {
      const isSelf = m.id === currentUserId;
      let badgeClass = 'role-viewer';
      if (m.role === 'admin') badgeClass = 'role-admin';
      else if (m.role === 'editor') badgeClass = 'role-editor';

      html += `
        <tr>
          <td>
            <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(m.name)}</div>
            ${isSelf ? '<span style="font-size: 0.72rem; color: var(--accent-primary);">(You)</span>' : ''}
          </td>
          <td>${escapeHtml(m.email)}</td>
          <td>
            <span class="role-badge ${badgeClass}">${m.role.toUpperCase()}</span>
          </td>
          <td>${formatDate(m.created_at)}</td>
          <td>${formatDate(m.last_login_at)}</td>
          <td style="text-align: right;">
            ${isSelf ? `
              <span style="color: var(--text-muted); font-size: 0.8rem; font-style: italic;">Current session</span>
            ` : `
              <div style="display: inline-flex; gap: 0.5rem; align-items: center; justify-content: flex-end;">
                <select class="form-control select-role-change" data-id="${escapeHtml(m.id)}" style="width: auto; padding: 0.35rem 0.65rem; font-size: 0.8rem;">
                  <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
                  <option value="editor" ${m.role === 'editor' ? 'selected' : ''}>Editor</option>
                  <option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>Viewer</option>
                </select>
                <button type="button" class="btn btn-danger btn-sm btn-remove-member" data-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}">
                  Remove
                </button>
              </div>
            `}
          </td>
        </tr>
      `;
    }

    tbody.innerHTML = html;
    attachListeners();
  }

  function attachListeners() {
    // Role change dropdowns
    document.querySelectorAll('.select-role-change').forEach(select => {
      select.onchange = async () => {
        const targetUserId = select.getAttribute('data-id');
        const newRole = select.value;

        try {
          const res = await window.TrustVault.auth.apiFetch(`/api/members/${targetUserId}/role`, {
            method: 'PATCH',
            body: { role: newRole }
          });

          const data = await res.json();
          if (res.ok) {
            window.TrustVault.auth.showToast(data.message || 'Role updated.', 'success');
            loadMembers();
          } else {
            window.TrustVault.auth.showToast(data.error || 'Failed to update role.', 'error');
            loadMembers();
          }
        } catch (err) {
          window.TrustVault.auth.showToast('Network error while updating role.', 'error');
          loadMembers();
        }
      };
    });

    // Remove member buttons
    document.querySelectorAll('.btn-remove-member').forEach(btn => {
      btn.onclick = async () => {
        const targetUserId = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');

        if (!confirm(`Are you sure you want to remove ${name} from your organization?`)) {
          return;
        }

        try {
          const res = await window.TrustVault.auth.apiFetch(`/api/members/${targetUserId}`, {
            method: 'DELETE'
          });

          const data = await res.json();
          if (res.ok) {
            window.TrustVault.auth.showToast(data.message || 'Member removed.', 'success');
            loadMembers();
          } else {
            window.TrustVault.auth.showToast(data.error || 'Failed to remove member.', 'error');
          }
        } catch (err) {
          window.TrustVault.auth.showToast('Network error while removing member.', 'error');
        }
      };
    });
  }

  function setupAddMemberModal() {
    const openBtn = document.getElementById('btn-open-add-member');
    const modal = document.getElementById('modal-add-member');
    const closeBtn = document.getElementById('btn-close-add-member');
    const cancelBtn = document.getElementById('btn-cancel-add-member');
    const form = document.getElementById('form-add-member');
    const submitBtn = document.getElementById('btn-submit-add-member');
    const alertBox = document.getElementById('add-member-alert');

    if (!openBtn || !modal) return;

    const closeModal = () => {
      modal.classList.remove('active');
      if (form) form.reset();
      if (alertBox) alertBox.style.display = 'none';
    };

    openBtn.onclick = () => {
      if (form) form.reset();
      if (alertBox) alertBox.style.display = 'none';
      modal.classList.add('active');
      document.getElementById('input-member-name')?.focus();
    };

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();

        const name = document.getElementById('input-member-name')?.value.trim();
        const email = document.getElementById('input-member-email')?.value.trim();
        const password = document.getElementById('input-member-password')?.value;
        const role = document.getElementById('select-member-role')?.value || 'viewer';

        if (!name || !email || !password) {
          if (alertBox) {
            alertBox.textContent = 'Please fill out all required fields.';
            alertBox.style.display = 'block';
          }
          return;
        }

        if (password.length < 8) {
          if (alertBox) {
            alertBox.textContent = 'Password must be at least 8 characters long.';
            alertBox.style.display = 'block';
          }
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px;"></span> Enrolling...';
        }

        try {
          const res = await window.TrustVault.auth.apiFetch('/api/members', {
            method: 'POST',
            body: { name, email, password, role }
          });

          const data = await res.json();
          if (res.ok) {
            window.TrustVault.auth.showToast(data.message || 'Member added successfully!', 'success');
            closeModal();
            loadMembers();
          } else {
            if (alertBox) {
              alertBox.textContent = data.error || 'Failed to add member.';
              alertBox.style.display = 'block';
            }
          }
        } catch (err) {
          if (alertBox) {
            alertBox.textContent = 'Network or server error.';
            alertBox.style.display = 'block';
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Add Member';
          }
        }
      };
    }
  }

  window.TrustVault.onReady(() => {
    window.TrustVault.auth.init({
      requireAuth: true,
      onReady: (user) => {
        if (!user) return;

        if (user.role !== 'admin') {
          window.TrustVault.auth.showToast('Administrator privileges required to view members.', 'error');
          setTimeout(() => window.location.replace('/dashboard.html'), 1500);
          return;
        }

        setupAddMemberModal();
        loadMembers();
      }
    });
  });
})();
