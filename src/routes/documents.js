const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getDb } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');
const {
  validateUpload,
  saveFile,
  getFilePath,
  deleteFile,
  MAX_FILE_SIZE_BYTES
} = require('../services/storageService');

// Multer memory storage to allow validation before disk commit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

// All document routes require authentication
router.use(requireAuth);

/**
 * List documents accessible to the active user
 * GET /api/documents
 */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const { role, organizationId, id: userId } = req.user;

    let query = `
      SELECT 
        d.id,
        d.title,
        d.original_name,
        d.file_size,
        d.mime_type,
        d.uploader_id,
        d.created_at,
        d.updated_at,
        u.name as uploader_name,
        (SELECT COUNT(*) FROM document_shares WHERE document_id = d.id) as share_count,
        CASE
          WHEN d.uploader_id = ? THEN 'owner'
          WHEN ? = 'admin' THEN 'admin'
          WHEN ds.permission IS NOT NULL THEN ds.permission
          WHEN ? = 'editor' THEN 'edit'
          ELSE 'view'
        END as user_permission
      FROM documents d
      JOIN users u ON d.uploader_id = u.id
      LEFT JOIN document_shares ds ON d.id = ds.document_id AND ds.user_id = ?
      WHERE d.organization_id = ?
    `;

    const params = [userId, role, role, userId, organizationId];

    // Viewers can only see documents they uploaded or that have been shared with them
    if (role === 'viewer') {
      query += ` AND (d.uploader_id = ? OR ds.id IS NOT NULL)`;
      params.push(userId);
    }

    query += ` ORDER BY d.created_at DESC`;

    const documents = db.prepare(query).all(...params);
    res.json({ documents });
  } catch (err) {
    next(err);
  }
});

/**
 * Upload a new document
 * POST /api/documents/upload
 */
router.post('/upload', requireRole('admin', 'editor'), upload.single('file'), (req, res, next) => {
  try {
    const file = req.file;
    const { title } = req.body;

    const validation = validateUpload(file);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const docTitle = title && typeof title === 'string' && title.trim()
      ? title.trim()
      : file.originalname;

    const storagePath = saveFile(file.buffer, file.originalname);
    const docId = crypto.randomUUID();
    const db = getDb();

    db.prepare(`
      INSERT INTO documents (
        id, organization_id, uploader_id, title, original_name,
        file_size, mime_type, storage_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      docId,
      req.user.organizationId,
      req.user.id,
      docTitle,
      file.originalname,
      file.size,
      file.mimetype,
      storagePath
    );

    // Audit trail log
    logAudit({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'document_uploaded',
      resourceType: 'document',
      resourceId: docId,
      outcome: 'success',
      ipAddress: req.ip,
      details: {
        title: docTitle,
        originalName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype
      }
    });

    const createdDoc = db.prepare(`
      SELECT 
        d.id, d.title, d.original_name, d.file_size, d.mime_type,
        d.uploader_id, d.created_at, u.name as uploader_name
      FROM documents d
      JOIN users u ON d.uploader_id = u.id
      WHERE d.id = ?
    `).get(docId);

    return res.status(201).json({
      message: 'Document uploaded successfully.',
      document: createdDoc
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Preview document securely
 * GET /api/documents/:id/preview
 */
router.get('/:id/preview', (req, res, next) => {
  try {
    const docId = req.params.id;
    const db = getDb();

    const doc = db.prepare(`
      SELECT d.*, ds.permission as share_permission
      FROM documents d
      LEFT JOIN document_shares ds ON d.id = ds.document_id AND ds.user_id = ?
      WHERE d.id = ? AND d.organization_id = ?
    `).get(req.user.id, docId, req.user.organizationId);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found or access denied.' });
    }

    // Role and permission check
    const isUploader = doc.uploader_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    const isEditor = req.user.role === 'editor';
    const hasShare = !!doc.share_permission;

    if (!isAdmin && !isEditor && !isUploader && !hasShare) {
      return res.status(403).json({ error: 'You do not have permission to preview this document.' });
    }

    const filePath = getFilePath(doc.storage_path);
    if (!filePath) {
      return res.status(404).json({ error: 'Stored document file was not found on disk.' });
    }

    logAudit({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'document_previewed',
      resourceType: 'document',
      resourceId: doc.id,
      outcome: 'success',
      ipAddress: req.ip,
      details: { title: doc.title, mimeType: doc.mime_type }
    });

    // Clean safe filename for content headers
    const safeName = encodeURIComponent(doc.original_name);
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * Download document with original filename
 * GET /api/documents/:id/download
 */
router.get('/:id/download', (req, res, next) => {
  try {
    const docId = req.params.id;
    const db = getDb();

    const doc = db.prepare(`
      SELECT d.*, ds.permission as share_permission
      FROM documents d
      LEFT JOIN document_shares ds ON d.id = ds.document_id AND ds.user_id = ?
      WHERE d.id = ? AND d.organization_id = ?
    `).get(req.user.id, docId, req.user.organizationId);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found or access denied.' });
    }

    const isUploader = doc.uploader_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    const isEditor = req.user.role === 'editor';
    const hasShare = !!doc.share_permission;

    if (!isAdmin && !isEditor && !isUploader && !hasShare) {
      return res.status(403).json({ error: 'You do not have permission to download this document.' });
    }

    const filePath = getFilePath(doc.storage_path);
    if (!filePath) {
      return res.status(404).json({ error: 'Stored document file was not found on disk.' });
    }

    logAudit({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'document_downloaded',
      resourceType: 'document',
      resourceId: doc.id,
      outcome: 'success',
      ipAddress: req.ip,
      details: { title: doc.title, originalName: doc.original_name }
    });

    const safeName = doc.original_name.replace(/["\r\n\\]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', doc.file_size);

    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * Share document with an organization member
 * POST /api/documents/:id/share
 */
router.post('/:id/share', requireRole('admin', 'editor'), (req, res, next) => {
  try {
    const docId = req.params.id;
    const { targetUserId, permission = 'view' } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ error: 'targetUserId is required.' });
    }

    if (!['view', 'edit'].includes(permission)) {
      return res.status(400).json({ error: 'Permission must be either "view" or "edit".' });
    }

    const db = getDb();
    const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND organization_id = ?').get(docId, req.user.organizationId);

    if (!doc) {
      return res.status(404).json({ error: 'Document not found in your organization.' });
    }

    // Check if requester has authority to share
    const isUploader = doc.uploader_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && !isUploader) {
      return res.status(403).json({ error: 'Only the uploader or an admin can manage sharing for this document.' });
    }

    if (targetUserId === doc.uploader_id) {
      return res.status(400).json({ error: 'Cannot share document with the uploader.' });
    }

    // Verify recipient belongs to the SAME organization (strict multi-tenant isolation)
    const targetMember = db.prepare(`
      SELECT u.id, u.name, u.email
      FROM users u
      JOIN organization_memberships m ON u.id = m.user_id
      WHERE m.organization_id = ? AND u.id = ?
    `).get(req.user.organizationId, targetUserId);

    if (!targetMember) {
      return res.status(400).json({ error: 'Target user does not belong to your organization.' });
    }

    const shareId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO document_shares (id, document_id, user_id, permission, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(document_id, user_id) DO UPDATE SET permission = excluded.permission
    `).run(shareId, docId, targetUserId, permission);

    logAudit({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'document_shared',
      resourceType: 'document',
      resourceId: docId,
      outcome: 'success',
      ipAddress: req.ip,
      details: {
        documentTitle: doc.title,
        targetUserId,
        targetUserName: targetMember.name,
        permission
      }
    });

    res.json({
      success: true,
      message: `Document successfully shared with ${targetMember.name}.`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * List active shares for a document
 * GET /api/documents/:id/shares
 */
router.get('/:id/shares', (req, res, next) => {
  try {
    const docId = req.params.id;
    const db = getDb();

    const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND organization_id = ?').get(docId, req.user.organizationId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const shares = db.prepare(`
      SELECT 
        s.id,
        s.document_id,
        s.user_id,
        s.permission,
        s.created_at,
        u.name as user_name,
        u.email as user_email,
        m.role as user_role
      FROM document_shares s
      JOIN users u ON s.user_id = u.id
      JOIN organization_memberships m ON u.id = m.user_id AND m.organization_id = ?
      WHERE s.document_id = ?
      ORDER BY s.created_at DESC
    `).all(req.user.organizationId, docId);

    res.json({ shares });
  } catch (err) {
    next(err);
  }
});

/**
 * Revoke document share from a member
 * DELETE /api/documents/:id/share/:targetUserId
 */
router.delete('/:id/share/:targetUserId', requireRole('admin', 'editor'), (req, res, next) => {
  try {
    const docId = req.params.id;
    const targetUserId = req.params.targetUserId;
    const db = getDb();

    const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND organization_id = ?').get(docId, req.user.organizationId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const isUploader = doc.uploader_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && !isUploader) {
      return res.status(403).json({ error: 'Only the uploader or an admin can revoke shares.' });
    }

    const targetUser = db.prepare('SELECT name FROM users WHERE id = ?').get(targetUserId);

    db.prepare('DELETE FROM document_shares WHERE document_id = ? AND user_id = ?').run(docId, targetUserId);

    logAudit({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'share_revoked',
      resourceType: 'document',
      resourceId: docId,
      outcome: 'success',
      ipAddress: req.ip,
      details: {
        documentTitle: doc.title,
        targetUserId,
        targetUserName: targetUser ? targetUser.name : 'Unknown'
      }
    });

    res.json({
      success: true,
      message: 'Access has been revoked. The user can no longer preview, download, or access this document.'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Delete a document and its stored file safely
 * DELETE /api/documents/:id
 */
router.delete('/:id', (req, res, next) => {
  try {
    const docId = req.params.id;
    const db = getDb();

    const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND organization_id = ?').get(docId, req.user.organizationId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const isUploader = doc.uploader_id === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin && !isUploader) {
      return res.status(403).json({ error: 'You do not have permission to delete this document.' });
    }

    // Delete stored file from disk
    deleteFile(doc.storage_path);

    // Delete database records (shares cascade delete)
    db.prepare('DELETE FROM documents WHERE id = ?').run(docId);

    logAudit({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'document_deleted',
      resourceType: 'document',
      resourceId: docId,
      outcome: 'success',
      ipAddress: req.ip,
      details: {
        title: doc.title,
        originalName: doc.original_name,
        fileSize: doc.file_size
      }
    });

    res.json({
      success: true,
      message: 'Document deleted successfully.'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
