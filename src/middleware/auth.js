const { getDb } = require('../database');

/**
 * Middleware to load active user profile from session
 */
function attachUser(req, res, next) {
  if (!req.session || !req.session.userId || !req.session.organizationId) {
    req.user = null;
    return next();
  }

  try {
    const db = getDb();
    const userWithOrg = db.prepare(`
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        m.role, 
        m.organization_id as organizationId, 
        o.name as organizationName
      FROM users u
      JOIN organization_memberships m ON u.id = m.user_id
      JOIN organizations o ON m.organization_id = o.id
      WHERE u.id = ? AND m.organization_id = ?
    `).get(req.session.userId, req.session.organizationId);

    if (!userWithOrg) {
      // User or organization deleted or membership revoked
      req.session.userId = null;
      req.session.organizationId = null;
      req.session.role = null;
      req.user = null;
    } else {
      req.user = userWithOrg;
    }
  } catch (err) {
    console.error('[Auth Middleware] Error attaching user:', err);
    req.user = null;
  }

  next();
}

/**
 * Require valid authenticated user session
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required. Please sign in.'
    });
  }
  next();
}

/**
 * Require specific role(s) (e.g. ['admin'], ['admin', 'editor'])
 */
function requireRole(...allowedRoles) {
  const flattened = allowedRoles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required. Please sign in.'
      });
    }

    if (!flattened.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Action requires one of the following roles: ${flattened.join(', ')}.`
      });
    }

    next();
  };
}

module.exports = {
  attachUser,
  requireAuth,
  requireRole
};
