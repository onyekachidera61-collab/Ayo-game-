const rateLimit = require('express-rate-limit');

/** Standard API rate limiter – configurable via env vars */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000)),
  max:      parseInt(process.env.RATE_LIMIT_MAX       || '200'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

/** Strict auth rate limiter – configurable via env vars */
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS  || String(15 * 60 * 1000)),
  max:      parseInt(process.env.AUTH_RATE_LIMIT_MAX   || '20'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many auth attempts. Please try again later.' },
});

module.exports = { apiLimiter, authLimiter };
