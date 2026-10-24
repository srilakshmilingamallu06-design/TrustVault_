const crypto = require('node:crypto');
const { getDb } = require('../database');

/**
 * Record a compliant audit trail log entry
 */
function logAudit({
  organizationId = null,
  actorId = null,
  actorName = null,
  action,
  resourceType = null,
  resourceId = null,
  outcome = 'success',
  ipAddress = null,
  details = null
}) {
  try {
    const db = getDb();
    const id = crypto.randomUUID();

    // Sanitize details to never log credentials or secrets
    let safeDetails = null;
    if (details && typeof details === 'object') {
      const copy = { ...details };
      delete copy.password;
      delete copy.passwordHash;
      delete copy.password_hash;
      delete copy.secret;
      delete copy.token;
      safeDetails = JSON.stringify(copy);
    } else if (typeof details === 'string') {
      safeDetails = details;
    }

    db.prepare(`
      INSERT INTO audit_logs (
        id, organization_id, actor_id, actor_name, action,
        resource_type, resource_id, outcome, ip_address, details_json, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      organizationId,
      actorId,
      actorName,
      action,
      resourceType,
      resourceId,
      outcome,
      ipAddress,
      safeDetails
    );

    return id;
  } catch (err) {
    console.error('[AuditService] Failed to record audit log:', err);
    return null;
  }
}

/**
 * Retrieve audit logs for an organization with optional pagination and filters
 */
function getAuditLogs(organizationId, options = {}) {
  const db = getDb();
  const { action, outcome, limit = 50, offset = 0 } = options;

  let query = 'SELECT * FROM audit_logs WHERE organization_id = ?';
  const params = [organizationId];

  if (action) {
    query += ' AND action = ?';
    params.push(action);
  }

  if (outcome) {
    query += ' AND outcome = ?';
    params.push(outcome);
  }

  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const logs = db.prepare(query).all(...params);

  // Parse details_json for client consumption
  const parsed = logs.map(log => ({
    ...log,
    details: log.details_json ? JSON.parse(log.details_json) : null
  }));

  let countQuery = 'SELECT COUNT(*) as total FROM audit_logs WHERE organization_id = ?';
  const countParams = [organizationId];
  if (action) {
    countQuery += ' AND action = ?';
    countParams.push(action);
  }
  if (outcome) {
    countQuery += ' AND outcome = ?';
    countParams.push(outcome);
  }
  const countRow = db.prepare(countQuery).get(...countParams);

  return {
    logs: parsed,
    total: countRow ? countRow.total : 0,
    limit: Number(limit),
    offset: Number(offset)
  };
}

module.exports = {
  logAudit,
  getAuditLogs
};
