const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

/**
 * Health check endpoint
 * GET /api/health
 */
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('SELECT 1 as alive').get();

    res.json({
      status: 'ok',
      database: result && result.alive === 1 ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage()
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message
    });
  }
});

module.exports = router;
