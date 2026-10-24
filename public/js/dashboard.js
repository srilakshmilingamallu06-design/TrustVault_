/**
 * TrustVault Dashboard Management Script
 */
(function () {
  'use strict';

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(isoString) {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  }

  function getActionBadge(action) {
    let colorClass = 'role-viewer';
    let label = action.replace('_', ' ');

    if (action.includes('login') || action.includes('register')) {
      colorClass = 'role-admin';
    } else if (action.includes('upload') || action.includes('share')) {
      colorClass = 'role-editor';
    } else if (action.includes('delete') || action.includes('revoked')) {
      colorClass = 'role-danger';
    }

    return `<span class="role-badge ${colorClass}">${label}</span>`;
  }

  async function loadDashboardData() {
    try {
      const res = await window.TrustVault.auth.apiFetch('/api/dashboard/stats');
      if (!res.ok) {
        throw new Error('Failed to load dashboard metrics');
      }

      const data = await res.json();
      const metrics = data.metrics || {};

      // Populate metrics
      const statDocs = document.getElementById('stat-docs');
      const statMembers = document.getElementById('stat-members');
      const statStorage = document.getElementById('stat-storage');
      const statShared = document.getElementById('stat-shared');

      if (statDocs) statDocs.textContent = metrics.accessibleCount ?? 0;
      if (statMembers) statMembers.textContent = metrics.totalMembersCount ?? 0;
      if (statStorage) statStorage.textContent = formatBytes(metrics.totalStorageBytes ?? 0);
      if (statShared) statShared.textContent = metrics.sharedWithMeCount ?? 0;

      // Render Recent Documents
      renderRecentDocuments(data.recentDocuments || []);

      // Render Recent Activity
      renderRecentActivity(data.recentActivity || []);
    } catch (err) {
      console.error('[Dashboard Error]', err);
      window.TrustVault.auth.showToast('Could not load dashboard metrics.', 'error');
    }
  }

  function renderRecentDocuments(docs) {
    const container = document.getElementById('recent-docs-container');
    if (!container) return;

    if (docs.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 2rem 1rem;">
          <div class="empty-icon">📄</div>
          <div class="empty-title">No documents yet</div>
          <p class="empty-desc">Upload files to begin secure organization sharing.</p>
          <a href="/documents.html" class="btn btn-primary btn-sm">Deposit First Document</a>
        </div>
      `;
      return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 0.75rem;">';
    for (const doc of docs) {
      html += `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);">
          <div class="doc-name-cell" style="overflow: hidden;">
            <div class="doc-icon">📄</div>
            <div class="doc-meta" style="min-width: 0;">
              <span class="doc-title" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(doc.title)}</span>
              <span class="doc-filename">${escapeHtml(doc.original_name)} &bull; ${formatBytes(doc.file_size)}</span>
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
            <a href="/api/documents/${doc.id}/download" class="btn btn-secondary btn-sm" download>Download</a>
          </div>
        </div>
      `;
    }
    html += '</div>';
    container.innerHTML = html;
  }

  function renderRecentActivity(activities) {
    const container = document.getElementById('recent-activity-container');
    if (!container) return;

    if (activities.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 2rem 1rem;">
          <div class="empty-icon">📜</div>
          <div class="empty-title">No activity recorded</div>
          <p class="empty-desc">Audited events will appear here in real time.</p>
        </div>
      `;
      return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 0.75rem;">';
    for (const item of activities) {
      html += `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: 0.85rem;">
          <div>
            <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.2rem;">
              ${escapeHtml(item.actor_name || 'System')} &bull; ${escapeHtml(item.action.replace('_', ' '))}
            </div>
            <div style="color: var(--text-muted); font-size: 0.78rem;">
              ${formatDate(item.timestamp)}
            </div>
          </div>
          <div>
            <span class="role-badge ${item.outcome === 'success' ? 'role-admin' : 'role-viewer'}">
              ${escapeHtml(item.outcome.toUpperCase())}
            </span>
          </div>
        </div>
      `;
    }
    html += '</div>';
    container.innerHTML = html;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setupQuickUpload() {
    const dropzone = document.getElementById('quick-dropzone');
    const fileInput = document.getElementById('quick-file-input');
    const metaContainer = document.getElementById('quick-upload-meta');
    const titleInput = document.getElementById('quick-doc-title');
    const dropzoneText = document.getElementById('quick-dropzone-text');
    const form = document.getElementById('form-quick-upload');
    const submitBtn = document.getElementById('btn-submit-quick-upload');

    let selectedFile = null;

    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(name => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        selectedFile = e.dataTransfer.files[0];
        handleFileSelected(selectedFile);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        selectedFile = fileInput.files[0];
        handleFileSelected(selectedFile);
      }
    });

    function handleFileSelected(file) {
      if (dropzoneText) {
        dropzoneText.textContent = `Selected: ${file.name} (${formatBytes(file.size)})`;
      }
      if (metaContainer) metaContainer.style.display = 'block';
      if (titleInput && !titleInput.value) {
        // Strip extension for clean default title
        titleInput.value = file.name.replace(/\.[^/.]+$/, '');
      }
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!selectedFile) {
          window.TrustVault.auth.showToast('Please select a file to upload.', 'error');
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px;"></span> Uploading...';
        }

        const formData = new FormData();
        formData.append('file', selectedFile);
        if (titleInput && titleInput.value.trim()) {
          formData.append('title', titleInput.value.trim());
        }

        try {
          const res = await window.TrustVault.auth.apiFetch('/api/documents/upload', {
            method: 'POST',
            body: formData
          });

          const data = await res.json();
          if (res.ok) {
            window.TrustVault.auth.showToast('Document uploaded successfully!', 'success');
            selectedFile = null;
            form.reset();
            if (dropzoneText) dropzoneText.textContent = 'Click or drag & drop files here to upload';
            if (metaContainer) metaContainer.style.display = 'none';
            // Refresh stats and lists immediately
            loadDashboardData();
          } else {
            window.TrustVault.auth.showToast(data.error || 'Upload failed.', 'error');
          }
        } catch (err) {
          window.TrustVault.auth.showToast('Network error during upload.', 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Upload to Secure Storage';
          }
        }
      });
    }
  }

  window.TrustVault.onReady(() => {
    window.TrustVault.auth.init({
      requireAuth: true,
      onReady: (user) => {
        if (!user) return;

        const welcomeEl = document.getElementById('dashboard-welcome');
        if (welcomeEl) {
          welcomeEl.textContent = `Welcome, ${user.name}`;
        }

        const viewAllAudit = document.getElementById('btn-view-all-audit');
        if (viewAllAudit && user.role === 'admin') {
          viewAllAudit.style.display = 'inline-flex';
        }

        const quickUploadSection = document.getElementById('section-quick-upload');
        if (quickUploadSection && (user.role === 'admin' || user.role === 'editor')) {
          quickUploadSection.style.display = 'block';
          setupQuickUpload();
        }

        loadDashboardData();
      }
    });
  });
})();
