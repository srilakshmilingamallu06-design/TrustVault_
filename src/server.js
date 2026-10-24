require('dotenv').config();
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { initDatabase, closeDatabase } = require('./database');
const SqliteSessionStore = require('./services/sessionStore');
const { securityHeaders } = require('./middleware/security');
const { csrfProtection } = require('./middleware/csrf');
const { attachUser } = require('./middleware/auth');
const { authLimiter, apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Route modules
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');
const memberRoutes = require('./routes/members');
const auditRoutes = require('./routes/audit');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

// Initialize database schema
initDatabase();

// Trust reverse proxy (crucial for Render and production HTTPS cookie handling)
app.set('trust proxy', 1);

// Security headers
app.use(securityHeaders);

// Body parsers
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Session management
const sessionStore = new SqliteSessionStore({
  cleanupIntervalMs: 15 * 60 * 1000,
  disableCleanup: process.env.NODE_ENV === 'test'
});

app.use(
  session({
    name: 'trustvault.sid',
    secret: process.env.SESSION_SECRET || 'trustvault_dev_insecure_fallback_secret_must_change_in_prod',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Resolve and attach authenticated user to request
app.use(attachUser);

// CSRF protection for state-changing requests
app.use(csrfProtection);

// Serve static frontend assets from public/ directory
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, {
  extensions: ['html'],
  index: 'index.html'
}));

// API Rate limiters
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/', apiLimiter);

// Mount API routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Friendly URL fallbacks to HTML pages
app.get('/login', (req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(publicDir, 'register.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(publicDir, 'register.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
app.get('/documents', (req, res) => res.sendFile(path.join(publicDir, 'documents.html')));
app.get('/members', (req, res) => res.sendFile(path.join(publicDir, 'members.html')));
app.get('/audit', (req, res) => res.sendFile(path.join(publicDir, 'audit.html')));

// 404 and Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// Server startup
let server = null;
const PORT = process.env.PORT || 3000;

function startServer(port = PORT) {
  return new Promise((resolve) => {
    server = app.listen(port, () => {
      console.log(`[TrustVault] Server running on http://localhost:${port} in ${process.env.NODE_ENV || 'development'} mode.`);
      resolve(server);
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    sessionStore.close();
    if (server) {
      server.close(() => {
        closeDatabase();
        resolve();
      });
    } else {
      closeDatabase();
      resolve();
    }
  });
}

if (require.main === module) {
  startServer();

  // Graceful shutdown handlers
  const shutdown = () => {
    console.log('\n[TrustVault] Shutting down gracefully...');
    stopServer().then(() => {
      console.log('[TrustVault] Stopped.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = {
  app,
  startServer,
  stopServer
};
