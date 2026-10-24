const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getAuditLogs } = require('../services/auditService');

// Require authentication and Administrator role
router.use(requireAuth);
router.use(requireRole('admin'));

/**
 * Get organization audit logs with filtering and pagination
 * GET /api/audit
 */
router.get('/', (req, res, next) => {
  try {
    const { action, outcome, limit, offset } = req.query;

    const result = getAuditLogs(req.user.organizationId, {
      action,
      outcome,
      limit: limit ? Math.min(Number(limit), 200) : 50,
      offset: offset ? Number(offset) : 0
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
