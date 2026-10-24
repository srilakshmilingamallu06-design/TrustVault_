const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { getDb, transaction } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Register a new user and create an organization
 * POST /api/auth/register
 */
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, organizationName } = req.body;

    // Strict validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters.' });
    }

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    if (!organizationName || typeof organizationName !== 'string' || organizationName.trim().length < 2) {
      return res.status(400).json({ error: 'Organization name must be at least 2 characters.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const cleanOrgName = organizationName.trim();

    const db = getDb();

    // Check duplicate email
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    // Hash password securely
    const passwordHash = await bcrypt.hash(password, 12);

    const orgId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();

    // Transactional creation of Organization, User, and Membership
    transaction((dbInstance) => {
      dbInstance.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)').run(orgId, cleanOrgName);
      dbInstance.prepare('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)').run(
        userId,
        cleanName,
        cleanEmail,
        passwordHash
      );
      dbInstance.prepare('INSERT INTO organization_memberships (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)').run(
        membershipId,
        orgId,
        userId,
        'admin'
      );
    });

    // Establish session
    req.session.userId = userId;
    req.session.organizationId = orgId;
    req.session.role = 'admin';
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');

    req.session.save((saveErr) => {
      if (saveErr) {
        return next(saveErr);
      }

      res.cookie('XSRF-TOKEN', req.session.csrfToken, {
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
      });

      // Log audit event
      logAudit({
        organizationId: orgId,
        actorId: userId,
        actorName: cleanName,
        action: 'user_registered',
        resourceType: 'user',
        resourceId: userId,
        outcome: 'success',
        ipAddress: req.ip,
        details: {
          email: cleanEmail,
          organizationName: cleanOrgName,
          role: 'admin'
        }
      });

      return res.status(201).json({
        success: true,
        user: {
          id: userId,
          name: cleanName,
          email: cleanEmail,
          role: 'admin',
          organizationId: orgId,
          organizationName: cleanOrgName
        },
        csrfToken: req.session.csrfToken
      });
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Sign in existing user
 * POST /api/auth/login
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const db = getDb();

    const user = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(cleanEmail);

    if (!user) {
      logAudit({
        organizationId: null,
        action: 'login_failed',
        outcome: 'failure',
        ipAddress: req.ip,
        details: { reason: 'User not found', attemptedEmail: cleanEmail }
      });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      const userMembership = db.prepare('SELECT organization_id FROM organization_memberships WHERE user_id = ? LIMIT 1').get(user.id);
      logAudit({
        organizationId: userMembership ? userMembership.organization_id : null,
        actorId: user.id,
        actorName: user.name,
        action: 'login_failed',
        outcome: 'failure',
        ipAddress: req.ip,
        details: { reason: 'Invalid password' }
      });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Retrieve organization membership
    const membership = db.prepare(`
      SELECT m.organization_id, m.role, o.name as organization_name
      FROM organization_memberships m
      JOIN organizations o ON m.organization_id = o.id
      WHERE m.user_id = ?
      LIMIT 1
    `).get(user.id);

    if (!membership) {
      return res.status(403).json({ error: 'User is not assigned to any active organization.' });
    }

    // Update last login timestamp
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);

    // Regenerate session to prevent session fixation attacks
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        return next(regenErr);
      }

      req.session.userId = user.id;
      req.session.organizationId = membership.organization_id;
      req.session.role = membership.role;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');

      req.session.save((saveErr) => {
        if (saveErr) {
          return next(saveErr);
        }

        res.cookie('XSRF-TOKEN', req.session.csrfToken, {
          httpOnly: false,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/'
        });

        logAudit({
          organizationId: membership.organization_id,
          actorId: user.id,
          actorName: user.name,
          action: 'login_success',
          outcome: 'success',
          ipAddress: req.ip,
          details: { role: membership.role }
        });

        return res.json({
          success: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: membership.role,
            organizationId: membership.organization_id,
            organizationName: membership.organization_name
          },
          csrfToken: req.session.csrfToken
        });
      });
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Sign out current user
 * POST /api/auth/logout
 */
router.post('/logout', (req, res, next) => {
  const user = req.user || (req.session && req.session.userId ? {
    id: req.session.userId,
    organizationId: req.session.organizationId
  } : null);

  if (user && user.organizationId) {
    logAudit({
      organizationId: user.organizationId,
      actorId: user.id,
      action: 'logout',
      outcome: 'success',
      ipAddress: req.ip
    });
  }

  req.session.destroy((err) => {
    if (err) {
      return next(err);
    }
    res.clearCookie('trustvault.sid');
    res.clearCookie('XSRF-TOKEN');
    res.json({ success: true, message: 'Logged out successfully.' });
  });
});

/**
 * Get current authenticated user session
 * GET /api/auth/me
 */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    authenticated: true,
    user: req.user,
    csrfToken: req.session.csrfToken
  });
});

/**
 * Get CSRF token
 * GET /api/auth/csrf-token
 */
router.get('/csrf-token', (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.json({ csrfToken: req.session.csrfToken });
});

module.exports = router;
