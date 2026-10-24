const crypto = require('node:crypto');

const EXEMPT_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout'
]);

/**
 * CSRF Protection Middleware
 */
function csrfProtection(req, res, next) {
  // Ensure session has a csrf token
  if (req.session) {
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }

    // Set readable cookie for the frontend to read CSRF token
    res.cookie('XSRF-TOKEN', req.session.csrfToken, {
      httpOnly: false, // Accessible by frontend JS on the same origin
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    });
  }

  // Safe HTTP methods do not change state
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // Exempt specific public setup endpoints
  if (EXEMPT_PATHS.has(req.path)) {
    return next();
  }

  // Exempt test runner if disabled explicitly for unit/integration tests
  if (process.env.NODE_ENV === 'test' && req.headers['x-test-bypass-csrf'] === 'true') {
    return next();
  }

  const clientToken = req.headers['x-csrf-token'] || (req.body && req.body._csrf);
  const sessionToken = req.session ? req.session.csrfToken : null;

  if (!clientToken || !sessionToken || clientToken !== sessionToken) {
    return res.status(403).json({
      error: 'Invalid or missing CSRF token. Please refresh the page and try again.'
    });
  }

  next();
}

module.exports = {
  csrfProtection
};
