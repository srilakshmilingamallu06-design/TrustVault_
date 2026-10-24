const rateLimit = require('express-rate-limit');

const isTest = process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === 'true';

const noopMiddleware = (req, res, next) => next();

const authLimiter = isTest
  ? noopMiddleware
  : rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 30, // Limit each IP to 30 requests per windowMs
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'Too many authentication attempts from this IP. Please try again after 15 minutes.'
      }
    });

const apiLimiter = isTest
  ? noopMiddleware
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 500,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'Rate limit exceeded. Please slow down your requests.'
      }
    });

module.exports = {
  authLimiter,
  apiLimiter
};
