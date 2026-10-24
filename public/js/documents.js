/**
 * TrustVault Document Repository Manager
 */
(function () {
  'use strict';

  let allDocuments = [];
  let currentDocForShare = null;
  let currentDocForDelete = null;
  let orgMembers = [];

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
        year: 'numeric'
      });
    } catch {
      return isoString;
    }
  }

  function getFileIcon(mimeType, filename) {
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('image')) return '🖼';
    if (mimeType.includes('text') || mimeType.includes('markdown')) return '📝';
    if (mimeType.includes('json') || mimeType.includes('xml')) return '⚙';
    if (mimeType.includes('word') || filename.endsWith('.doc') || filename.endsWith('.docx')) return '📘';
    return '📄';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadDocuments() {
    const tbody = document.getElementById('tbody-documents');
    try {
      const res = await window.TrustVault.auth.apiFetch('/api/documents');
      if (!res.ok) {
        throw new Error('Failed to retrieve documents');
      }

      const data = await res.json();
      allDocuments = data.documents || [];
      renderDocuments();
    } catch (err) {
      console.error('[Documents] Load error:', err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 2.5rem; color: var(--status-danger);">
              Failed to load document records. Please refresh the page.
            </td>
          </tr>
        `;
      }
    }
  }

  function renderDocuments() {
    const tbody = document.getElementById('tbody-documents');
    if (!tbody) return;

    const searchTerm = (document.getElementById('input-search')?.value || '').toLowerCase().trim();
    const sortOrder = document.getElementById('select-sort')?.value || 'newest';

    let filtered = allDocuments.filter(d => {
      const titleMatch = (d.title || '').toLowerCase().includes(searchTerm);
      const nameMatch = (d.original_name || '').toLowerCase().includes(searchTerm);
      const uploaderMatch = (d.uploader_name || '').toLowerCase().includes(searchTerm);
      return titleMatch || nameMatch || uploaderMatch;
    });

    // Sorting
    filtered.sort((a, b) => {
      if (sortOrder === 'newest') return new Date(b.created_at) - new Date(a.created_at);
      if (sortOrder === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
      if (sortOrder === 'title-asc') return (a.title || '').localeCompare(b.title || '');
      if (sortOrder === 'size-desc') return (b.file_size || 0) - (a.file_size || 0);
      return 0;
    });

    if (filtered.length === 0) {
      const isViewer = window.TrustVault.auth.user?.role === 'viewer';
      tbody.innerHTML = `
        <tr>
          <td colspan="6">
            <div class="empty-state">
              <div class="empty-icon">📂</div>
              <div class="empty-title">${searchTerm ? 'No matching documents' : 'Repository is empty'}</div>
              <p class="empty-desc">
                ${searchTerm ? 'Try adjusting your search query.' : (isViewer ? 'No documents have been shared with your account yet.' : 'Upload your first sensitive document to begin secure sharing.')}
              </p>
              ${(!searchTerm && !isViewer) ? '<button type="button" class="btn btn-primary btn-sm" onclick="document.getElementById(\'btn-open-upload\').click()">+ Upload Document</button>' : ''}
            </div>
          </td>
        </tr>
      `;
      return;
    }

    const currentUserId = window.TrustVault.auth.user?.id;
    const currentUserRole = window.TrustVault.auth.user?.role;
    const isAdmin = currentUserRole === 'admin';

    let html = '';
    for (const doc of filtered) {
      const isOwner = doc.uploader_id === currentUserId;
      const canManage = isAdmin || isOwner;
      const icon = getFileIcon(doc.mime_type, doc.original_name);

      let accessBadge = '<span class="role-badge role-viewer">Private</span>';
      if (doc.share_count > 0) {
        accessBadge = `<span class="role-badge role-editor">Shared (${doc.share_count})</span>`;
      }

      html += `
        <tr data-doc-id="${escapeHtml(doc.id)}">
          <td>
            <div class="doc-name-cell">
              <div class="doc-icon">${icon}</div>
              <div class="doc-meta">
                <span class="doc-title">${escapeHtml(doc.title)}</span>
                <span class="doc-filename">${escapeHtml(doc.original_name)}</span>
              </div>
            </div>
          </td>
          <td>${formatBytes(doc.file_size)}</td>
          <td>
            <div style="font-weight: 500; color: var(--text-primary);">${escapeHtml(doc.uploader_name)}</div>
            ${isOwner ? '<span style="font-size: 0.72rem; color: var(--accent-primary);">(You)</span>' : ''}
          </td>
          <td>${formatDate(doc.created_at)}</td>
          <td>${accessBadge}</td>
          <td style="text-align: right;">
            <div style="display: inline-flex; gap: 0.4rem; justify-content: flex-end;">
              <button type="button" class="btn btn-secondary btn-sm btn-preview" data-id="${escapeHtml(doc.id)}" title="Preview Document">
                Preview
              </button>
              <a href="/api/documents/${escapeHtml(doc.id)}/download" class="btn btn-secondary btn-sm" download title="Download file">
                Download
              </a>
              ${canManage ? `
                <button type="button" class="btn btn-secondary btn-sm btn-share" data-id="${escapeHtml(doc.id)}" data-title="${escapeHtml(doc.title)}" title="Share Document">
                  Share
                </button>
                <button type="button" class="btn btn-danger btn-sm btn-delete" data-id="${escapeHtml(doc.id)}" data-title="${escapeHtml(doc.title)}" title="Delete Document">
                  Delete
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }

    tbody.innerHTML = html;
    attachActionListeners();
  }

  function attachActionListeners() {
    // Preview Buttons
    document.querySelectorAll('.btn-preview').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        openPreview(id);
      };
    });

    // Share Buttons
    document.querySelectorAll('.btn-share').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        const title = btn.getAttribute('data-title');
        openShareModal(id, title);
      };
    });

    // Delete Buttons
    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        const title = btn.getAttribute('data-title');
        openDeleteModal(id, title);
      };
    });
  }

  // --- PREVIEW MODAL ---
  async function openPreview(docId) {
    const modal = document.getElementById('modal-preview');
    const content = document.getElementById('preview-content');
    const titleEl = document.getElementById('modal-preview-title');
    const subtitleEl = document.getElementById('modal-preview-subtitle');
    const downloadBtn = document.getElementById('btn-preview-download');

    const doc = allDocuments.find(d => d.id === docId);
    if (!doc) return;

    if (titleEl) titleEl.textContent = doc.title;
    if (subtitleEl) subtitleEl.textContent = `${doc.original_name} (${formatBytes(doc.file_size)})`;
    if (downloadBtn) {
      downloadBtn.href = `/api/documents/${doc.id}/download`;
    }

    if (content) {
      content.innerHTML = '<span class="spinner"></span> Loading secure stream...';
    }
    if (modal) modal.classList.add('active');

    const previewUrl = `/api/documents/${doc.id}/preview`;

    if (doc.mime_type.includes('pdf')) {
      content.innerHTML = `<iframe src="${previewUrl}" title="${escapeHtml(doc.title)}"></iframe>`;
    } else if (doc.mime_type.includes('image')) {
      content.innerHTML = `<img src="${previewUrl}" alt="${escapeHtml(doc.title)}">`;
    } else if (doc.mime_type.includes('text') || doc.mime_type.includes('json') || doc.mime_type.includes('xml')) {
      try {
        const res = await window.TrustVault.auth.apiFetch(previewUrl);
        const text = await res.text();
        content.innerHTML = `<pre><code>${escapeHtml(text)}</code></pre>`;
      } catch (err) {
        content.innerHTML = `<div style="color: var(--status-danger);">Failed to load document text preview.</div>`;
      }
    } else {
      content.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
          <div style="font-size: 2.5rem; margin-bottom: 1rem;">📄</div>
          <div style="font-weight: 600; margin-bottom: 0.5rem;">Preview not supported for this file format</div>
          <p style="color: var(--text-secondary); margin-bottom: 1.25rem;">Download the original file to view on your system.</p>
          <a href="/api/documents/${doc.id}/download" class="btn btn-primary btn-sm" download>Download ${escapeHtml(doc.original_name)}</a>
        </div>
      `;
    }
  }

  function closePreview() {
    const modal = document.getElementById('modal-preview');
    if (modal) modal.classList.remove('active');
    const content = document.getElementById('preview-content');
    if (content) content.innerHTML = '';
  }

  // --- SHARE MODAL ---
  async function openShareModal(docId, docTitle) {
    currentDocForShare = docId;
    const modal = document.getElementById('modal-share');
    const titleEl = document.getElementById('modal-share-doc-name');
    if (titleEl) titleEl.textContent = docTitle;

    if (modal) modal.classList.add('active');

    await loadOrgMembers();
    await loadCurrentShares(docId);
  }

  function closeShareModal() {
    const modal = document.getElementById('modal-share');
    if (modal) modal.classList.remove('active');
    currentDocForShare = null;
  }

  async function loadOrgMembers() {
    const select = document.getElementById('select-share-member');
    if (!select) return;

    try {
      const res = await window.TrustVault.auth.apiFetch('/api/members');
      if (res.ok) {
        const data = await res.json();
        orgMembers = data.members || [];
        const currentUserId = window.TrustVault.auth.user?.id;
        const eligible = orgMembers.filter(m => m.id !== currentUserId);

        let options = '<option value="">Choose an organization colleague...</option>';
        for (const m of eligible) {
          options += `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)} (${escapeHtml(m.email)} - ${m.role})</option>`;
        }
        select.innerHTML = options;
      }
    } catch (err) {
      console.error('[Share] Members load error:', err);
    }
  }

  async function loadCurrentShares(docId) {
    const container = document.getElementById('shares-list-container');
    if (!container) return;

    container.innerHTML = '<div style="text-align: center; padding: 1.5rem; color: var(--text-muted);"><span class="spinner"></span> Loading shares...</div>';

    try {
      const res = await window.TrustVault.auth.apiFetch(`/api/documents/${docId}/shares`);
      if (res.ok) {
        const data = await res.json();
        const shares = data.shares || [];

        if (shares.length === 0) {
          container.innerHTML = `
            <div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.85rem;">
              This document is currently private. No members have delegated access.
            </div>
          `;
          return;
        }

        let html = '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
        for (const s of shares) {
          html += `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.65rem 0.85rem; background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: 0.85rem;">
              <div>
                <span style="font-weight: 600; color: var(--text-primary);">${escapeHtml(s.user_name)}</span>
                <span style="color: var(--text-muted); font-size: 0.78rem;">(${escapeHtml(s.user_email)})</span>
                <div style="margin-top: 0.2rem;">
                  <span class="role-badge ${s.permission === 'edit' ? 'role-editor' : 'role-viewer'}">${s.permission.toUpperCase()}</span>
                </div>
              </div>
              <button type="button" class="btn btn-danger btn-sm btn-revoke" data-user-id="${escapeHtml(s.user_id)}">
                Revoke
              </button>
            </div>
          `;
        }
        html += '</div>';
        container.innerHTML = html;

        // Attach revoke listeners
        container.querySelectorAll('.btn-revoke').forEach(btn => {
          btn.onclick = async () => {
            const targetUserId = btn.getAttribute('data-user-id');
            await handleRevokeShare(docId, targetUserId);
          };
        });
      }
    } catch (err) {
      container.innerHTML = `<div style="color: var(--status-danger); text-align: center; padding: 1rem;">Failed to load shares.</div>`;
    }
  }

  async function handleAddShare(e) {
    e.preventDefault();
    if (!currentDocForShare) return;

    const memberSelect = document.getElementById('select-share-member');
    const permSelect = document.getElementById('select-share-perm');
    const targetUserId = memberSelect ? memberSelect.value : '';
    const permission = permSelect ? permSelect.value : 'view';
    const submitBtn = document.getElementById('btn-submit-share');

    if (!targetUserId) {
      window.TrustVault.auth.showToast('Please select a member to share with.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px;"></span> Granting...';
    }

    try {
      const res = await window.TrustVault.auth.apiFetch(`/api/documents/${currentDocForShare}/share`, {
        method: 'POST',
        body: { targetUserId, permission }
      });

      const data = await res.json();
      if (res.ok) {
        window.TrustVault.auth.showToast('Document shared successfully!', 'success');
        if (memberSelect) memberSelect.value = '';
        await loadCurrentShares(currentDocForShare);
        await loadDocuments(); // Update share count badge
      } else {
        window.TrustVault.auth.showToast(data.error || 'Failed to share document.', 'error');
      }
    } catch (err) {
      window.TrustVault.auth.showToast('Network error while sharing document.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Grant Access';
      }
    }
  }

  async function handleRevokeShare(docId, targetUserId) {
    try {
      const res = await window.TrustVault.auth.apiFetch(`/api/documents/${docId}/share/${targetUserId}`, {
        method: 'DELETE'
      });

      const data = await res.json();
      if (res.ok) {
        window.TrustVault.auth.showToast('Access revoked successfully.', 'success');
        await loadCurrentShares(docId);
        await loadDocuments();
      } else {
        window.TrustVault.auth.showToast(data.error || 'Failed to revoke access.', 'error');
      }
    } catch (err) {
      window.TrustVault.auth.showToast('Network error while revoking share.', 'error');
    }
  }

  // --- DELETE MODAL ---
  function openDeleteModal(docId, docTitle) {
    currentDocForDelete = docId;
    const modal = document.getElementById('modal-delete');
    const nameEl = document.getElementById('delete-doc-name');
    if (nameEl) nameEl.textContent = docTitle;
    if (modal) modal.classList.add('active');
  }

  function closeDeleteModal() {
    const modal = document.getElementById('modal-delete');
    if (modal) modal.classList.remove('active');
    currentDocForDelete = null;
  }

  async function handleConfirmDelete() {
    if (!currentDocForDelete) return;

    const btn = document.getElementById('btn-confirm-delete');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px;"></span> Deleting...';
    }

    try {
      const res = await window.TrustVault.auth.apiFetch(`/api/documents/${currentDocForDelete}`, {
        method: 'DELETE'
      });

      const data = await res.json();
      if (res.ok) {
        window.TrustVault.auth.showToast('Document deleted permanently.', 'success');
        closeDeleteModal();
        await loadDocuments();
      } else {
        window.TrustVault.auth.showToast(data.error || 'Failed to delete document.', 'error');
      }
    } catch (err) {
      window.TrustVault.auth.showToast('Network error during deletion.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Delete Permanently';
      }
    }
  }

  // --- UPLOAD MODAL ---
  function setupUploadModal() {
    const openBtn = document.getElementById('btn-open-upload');
    const modal = document.getElementById('modal-upload');
    const closeBtn = document.getElementById('btn-close-upload');
    const cancelBtn = document.getElementById('btn-cancel-upload');
    const dropzone = document.getElementById('modal-dropzone');
    const fileInput = document.getElementById('modal-file-input');
    const dropzoneText = document.getElementById('modal-dropzone-text');
    const form = document.getElementById('form-upload-document');
    const submitBtn = document.getElementById('btn-submit-upload');
    const titleInput = document.getElementById('input-doc-title');
    const alertBox = document.getElementById('upload-alert');

    let selectedFile = null;

    if (openBtn) {
      openBtn.onclick = () => {
        selectedFile = null;
        if (form) form.reset();
        if (dropzoneText) dropzoneText.textContent = 'Click or drag & drop file here';
        if (alertBox) alertBox.style.display = 'none';
        if (modal) modal.classList.add('active');
      };
    }

    const closeUpload = () => {
      if (modal) modal.classList.remove('active');
      selectedFile = null;
    };

    if (closeBtn) closeBtn.onclick = closeUpload;
    if (cancelBtn) cancelBtn.onclick = closeUpload;

    if (dropzone && fileInput) {
      dropzone.onclick = () => fileInput.click();

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
          handleFile(selectedFile);
        }
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
          selectedFile = fileInput.files[0];
          handleFile(selectedFile);
        }
      });

      function handleFile(file) {
        if (dropzoneText) {
          dropzoneText.textContent = `Selected: ${file.name} (${formatBytes(file.size)})`;
        }
        if (titleInput && !titleInput.value) {
          titleInput.value = file.name.replace(/\.[^/.]+$/, '');
        }
        if (alertBox) alertBox.style.display = 'none';
      }
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!selectedFile) {
          if (alertBox) {
            alertBox.textContent = 'Please choose a file to upload.';
            alertBox.style.display = 'block';
          }
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
            closeUpload();
            await loadDocuments();
          } else {
            if (alertBox) {
              alertBox.textContent = data.error || 'Upload failed.';
              alertBox.style.display = 'block';
            }
          }
        } catch (err) {
          if (alertBox) {
            alertBox.textContent = 'Network or server error during upload.';
            alertBox.style.display = 'block';
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Upload Document';
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

        // Show Upload button for Admin and Editor
        const uploadBtn = document.getElementById('btn-open-upload');
        if (uploadBtn && (user.role === 'admin' || user.role === 'editor')) {
          uploadBtn.style.display = 'inline-flex';
          setupUploadModal();
        }

        // Preview dismiss
        document.getElementById('btn-close-preview')?.addEventListener('click', closePreview);
        document.getElementById('btn-dismiss-preview')?.addEventListener('click', closePreview);

        // Share dismiss and submit
        document.getElementById('btn-close-share')?.addEventListener('click', closeShareModal);
        document.getElementById('btn-dismiss-share')?.addEventListener('click', closeShareModal);
        document.getElementById('form-add-share')?.addEventListener('submit', handleAddShare);

        // Delete dismiss and confirm
        document.getElementById('btn-close-delete')?.addEventListener('click', closeDeleteModal);
        document.getElementById('btn-cancel-delete')?.addEventListener('click', closeDeleteModal);
        document.getElementById('btn-confirm-delete')?.addEventListener('click', handleConfirmDelete);

        // Search and Sort
        document.getElementById('input-search')?.addEventListener('input', renderDocuments);
        document.getElementById('select-sort')?.addEventListener('change', renderDocuments);

        loadDocuments();
      }
    });
  });
})();
