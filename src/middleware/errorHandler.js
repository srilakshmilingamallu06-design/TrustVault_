const multer = require('multer');

function notFoundHandler(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  }
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>404 - Not Found | TrustVault</title>
        <link rel="stylesheet" href="/css/style.css">
      </head>
      <body style="display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;">
        <div class="panel" style="max-width:480px;padding:2.5rem;">
          <h1 style="font-size:2rem;margin-bottom:1rem;color:var(--status-danger);">Page Not Found</h1>
          <p style="color:var(--text-secondary);margin-bottom:1.5rem;">The requested URL could not be found on this server.</p>
          <a href="/" class="btn btn-primary">Return to Overview</a>
        </div>
      </body>
    </html>
  `);
}

function errorHandler(err, req, res, next) {
  console.error('[TrustVault Error Handler]', err);

  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds maximum allowed limit of 20MB.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }

  const statusCode = err.status || err.statusCode || 500;
  const message = statusCode === 500 && process.env.NODE_ENV === 'production'
    ? 'An internal server error occurred. Please try again later.'
    : err.message || 'An unexpected error occurred.';

  res.status(statusCode).json({ error: message });
}

module.exports = {
  notFoundHandler,
  errorHandler
};
