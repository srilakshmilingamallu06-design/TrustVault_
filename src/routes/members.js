const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { getDb, transaction } = require('../database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = new Set(['admin', 'editor', 'viewer']);

router.use(requireAuth);

/**
 * List all members of the active organization
 * GET /api/members
 */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const members = db.prepare(`
      SELECT 
        u.id,
        u.name,
        u.email,
        m.role,
        m.created_at,
        u.last_login_at
      FROM organization_memberships m
      JOIN users u ON m.user_id = u.id
      WHERE m.organization_id = ?
      ORDER BY 
        CASE m.role 
          WHEN 'admin' THEN 1 
          WHEN 'editor' THEN 2 
          WHEN 'viewer' THEN 3 
          ELSE 4 
        END,
        u.name ASC
    `).all(req.user.organizationId);

    res.json({ members });
  } catch (err) {
    next(err);
  }
});

/**
 * Add a new member to the organization
 * POST /api/members
 */
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, email, password, role = 'viewer' } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters.' });
    }

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    if (!VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'Role must be admin, editor, or viewer.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const db = getDb();

    // Check if user is already a member of this organization
    const existingMembership = db.prepare(`
      SELECT m.id 
      FROM organization_memberships m
      JOIN users u ON m.user_id = u.id
      WHERE m.organization_id = ? AND u.email = ?
    `).get(req.user.organizationId, cleanEmail);

    if (existingMembership) {
      return res.status(409).json({ error: 'A member with this email already exists in this organization.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    let userId;
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);

    if (existingUser) {
      userId = existingUser.id;
    } else {
      userId = crypto.randomUUID();
      db.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)').run(
        userId,
        cleanName,
        cleanEmail,
        passwordHash
      );
    }

    const membershipId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO organization_memberships (id, organization_id, user_id, role)
      VALUES (?, ?, ?, ?)
    `).run(membershipId, req.user.organizationId, userId, role);

    logAudit({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'member_added',
      resourceType: 'user',
      resourceId: userId,
      outcome: 'success',
      ipAddress: req.ip,
      details: { name: cleanName, email: cleanEmail, role }
    });

    res.status(201).json({
      message: `Member ${cleanName} added successfully with role: ${role}.`,
      member: {
        id: userId,
        name: cleanName,
        email: cleanEmail,
        role
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Update member role
 * PATCH /api/members/:id/role
 */
router.patch('/:id/role', requireRole('admin'), (req, res, next) => {
  try {
    const targetUserId = req.params.id;
    const { role } = req.body;

    if (!VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'Role must be admin, editor, or viewer.' });
    }

    const db = getDb();
    const membership = db.prepare(`
      SELECT m.id, m.role, u.name, u.email
      FROM organization_memberships m
      JOIN users u ON m.user_id = u.id
      WHERE m.organization_id = ? AND m.user_id = ?
    `).get(req.user.organizationId, targetUserId);

    if (!membership) {
      return res.status(404).json({ error: 'Member not found in this organization.' });
    }

    // Guard: Prevent demoting the last admin in the organization
    if (membership.role === 'admin' && role !== 'admin') {
      const adminCount = db.prepare(`
        SELECT COUNT(*) as count 
        FROM organization_memberships 
        WHERE organization_id = ? AND role = 'admin'
      `).get(req.user.organizationId);

      if (adminCount.count <= 1) {
        return res.status(400).json({
          error: 'Cannot demote the last administrator of the organization.'
        });
      }
    }

    db.prepare(`
      UPDATE organization_memberships 
      SET role = ? 
      WHERE organization_id = ? AND user_id = ?
    `).run(role, req.user.organizationId, targetUserId);

    logAudit({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'role_updated',
      resourceType: 'membership',
      resourceId: targetUserId,
      outcome: 'success',
      ipAddress: req.ip,
      details: {
        targetName: membership.name,
        previousRole: membership.role,
        newRole: role
      }
    });

    res.json({
      success: true,
      message: `Role for ${membership.name} updated to ${role}.`
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Remove member from organization
 * DELETE /api/members/:id
 */
router.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const targetUserId = req.params.id;

    if (targetUserId === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove yourself from the organization.' });
    }

    const db = getDb();
    const membership = db.prepare(`
      SELECT m.id, m.role, u.name
      FROM organization_memberships m
      JOIN users u ON m.user_id = u.id
      WHERE m.organization_id = ? AND m.user_id = ?
    `).get(req.user.organizationId, targetUserId);

    if (!membership) {
      return res.status(404).json({ error: 'Member not found in this organization.' });
    }

    if (membership.role === 'admin') {
      const adminCount = db.prepare(`
        SELECT COUNT(*) as count 
        FROM organization_memberships 
        WHERE organization_id = ? AND role = 'admin'
      `).get(req.user.organizationId);

      if (adminCount.count <= 1) {
        return res.status(400).json({
          error: 'Cannot remove the last administrator of the organization.'
        });
      }
    }

    // Delete membership and clean up document shares
    transaction((dbInstance) => {
      dbInstance.prepare(`
        DELETE FROM document_shares 
        WHERE user_id = ? AND document_id IN (SELECT id FROM documents WHERE organization_id = ?)
      `).run(targetUserId, req.user.organizationId);

      dbInstance.prepare(`
        DELETE FROM organization_memberships 
        WHERE organization_id = ? AND user_id = ?
      `).run(req.user.organizationId, targetUserId);
    });

    logAudit({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      actorName: req.user.name,
      action: 'member_removed',
      resourceType: 'user',
      resourceId: targetUserId,
      outcome: 'success',
      ipAddress: req.ip,
      details: { memberName: membership.name }
    });

    res.json({
      success: true,
      message: `Member ${membership.name} has been removed from the organization.`
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
