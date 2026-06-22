const jwt = require('jsonwebtoken');
const db  = require('../config/database');

/**
 * Middleware: verify JWT access token.
 * Attaches req.user = { id, uuid, username, role }
 */
async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided.' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Optionally verify user still exists and is not banned
    const [rows] = await db.execute(
      'SELECT id, uuid, username, role, is_banned FROM users WHERE id = ?',
      [decoded.id]
    );
    if (!rows.length || rows[0].is_banned) {
      return res.status(401).json({ success: false, message: 'User not found or banned.' });
    }

    req.user = {
      id:       rows[0].id,
      uuid:     rows[0].uuid,
      username: rows[0].username,
      role:     rows[0].role,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
}

module.exports = authMiddleware;
