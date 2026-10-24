const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

/**
 * Get dashboard metrics and recent activity
 * GET /api/dashboard/stats
 */
router.get('/stats', (req, res, next) => {
  try {
    const db = getDb();
    const { id: userId, organizationId, role } = req.user;

    // Accessible documents count
    let docCountQuery = `
      SELECT COUNT(DISTINCT d.id) as count
      FROM documents d
      LEFT JOIN document_shares ds ON d.id = ds.document_id AND ds.user_id = ?
      WHERE d.organization_id = ?
    `;
    const docCountParams = [userId, organizationId];
    if (role === 'viewer') {
      docCountQuery += ` AND (d.uploader_id = ? OR ds.id IS NOT NULL)`;
      docCountParams.push(userId);
    }
    const docCountRow = db.prepare(docCountQuery).get(...docCountParams);

    // Total members count
    const memberCountRow = db.prepare(`
      SELECT COUNT(*) as count FROM organization_memberships WHERE organization_id = ?
    `).get(organizationId);

    // Storage bytes total for organization
    const storageRow = db.prepare(`
      SELECT COALESCE(SUM(file_size), 0) as totalBytes FROM documents WHERE organization_id = ?
    `).get(organizationId);

    // My uploads count
    const myUploadsRow = db.prepare(`
      SELECT COUNT(*) as count FROM documents WHERE organization_id = ? AND uploader_id = ?
    `).get(organizationId, userId);

    // Documents shared with me count
    const sharedWithMeRow = db.prepare(`
      SELECT COUNT(*) as count 
      FROM document_shares ds 
      JOIN documents d ON ds.document_id = d.id 
      WHERE ds.user_id = ? AND d.organization_id = ?
    `).get(userId, organizationId);

    // Recent documents (up to 5)
    let recentDocsQuery = `
      SELECT 
        d.id, d.title, d.original_name, d.file_size, d.mime_type, 
        d.created_at, u.name as uploader_name
      FROM documents d
      JOIN users u ON d.uploader_id = u.id
      LEFT JOIN document_shares ds ON d.id = ds.document_id AND ds.user_id = ?
      WHERE d.organization_id = ?
    `;
    const recentDocsParams = [userId, organizationId];
    if (role === 'viewer') {
      recentDocsQuery += ` AND (d.uploader_id = ? OR ds.id IS NOT NULL)`;
      recentDocsParams.push(userId);
    }
    recentDocsQuery += ` ORDER BY d.created_at DESC LIMIT 5`;
    const recentDocuments = db.prepare(recentDocsQuery).all(...recentDocsParams);

    // Recent activity stream (up to 6)
    let activityQuery = `
      SELECT id, action, actor_name, resource_type, timestamp, outcome, details_json
      FROM audit_logs
      WHERE organization_id = ?
    `;
    const activityParams = [organizationId];

    // Non-admins only see non-administrative actions or actions involving themselves
    if (role !== 'admin') {
      activityQuery += ` AND (actor_id = ? OR action LIKE 'document_%')`;
      activityParams.push(userId);
    }

    activityQuery += ` ORDER BY timestamp DESC LIMIT 6`;
    const rawActivity = db.prepare(activityQuery).all(...activityParams);
    const recentActivity = rawActivity.map(a => ({
      ...a,
      details: a.details_json ? JSON.parse(a.details_json) : null
    }));

    res.json({
      metrics: {
        accessibleCount: docCountRow ? docCountRow.count : 0,
        totalMembersCount: memberCountRow ? memberCountRow.count : 0,
        totalStorageBytes: storageRow ? storageRow.totalBytes : 0,
        myUploadsCount: myUploadsRow ? myUploadsRow.count : 0,
        sharedWithMeCount: sharedWithMeRow ? sharedWithMeRow.count : 0
      },
      recentDocuments,
      recentActivity
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
