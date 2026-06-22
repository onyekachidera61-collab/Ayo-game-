const authMiddleware = require('./auth');

/**
 * Middleware: require admin role.
 * Must be used AFTER authMiddleware.
 */
function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  next();
}

/** Combined: authenticate then require admin. */
const requireAdmin = [authMiddleware, adminMiddleware];

module.exports = { adminMiddleware, requireAdmin };
