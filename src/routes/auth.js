const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db       = require('../config/database');
const auth     = require('../middleware/auth');
const { authLimiter, apiLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply strict rate limiting to all auth routes
router.use(authLimiter);

// ── helpers ────────────────────────────────────────────────────
function signAccess(user) {
  return jwt.sign(
    { id: user.id, uuid: user.uuid, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );
}
function signRefresh(user) {
  return jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
}

// ── POST /api/auth/register ─────────────────────────────────────
router.post('/register', [
  body('username').trim().isLength({ min: 3, max: 30 }).isAlphanumeric(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('display_name').optional().trim().isLength({ max: 100 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  const { username, email, password, display_name } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Check duplicates
    const [dup] = await conn.execute(
      'SELECT id FROM users WHERE email=? OR username=? LIMIT 1',
      [email, username]
    );
    if (dup.length) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'Email or username already taken.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const uid  = uuidv4();

    const [result] = await conn.execute(
      `INSERT INTO users (uuid, username, email, password, display_name)
       VALUES (?, ?, ?, ?, ?)`,
      [uid, username, email, hash, display_name || username]
    );
    const userId = result.insertId;

    // Create wallet & stats
    await conn.execute('INSERT INTO wallets (user_id) VALUES (?)', [userId]);
    await conn.execute('INSERT INTO user_stats (user_id) VALUES (?)', [userId]);

    await conn.commit();

    const user = { id: userId, uuid: uid, username, role: 'player' };
    const accessToken  = signAccess(user);
    const refreshToken = signRefresh(user);

    // Store refresh token
    const exp = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await db.execute(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [userId, refreshToken, exp]
    );

    return res.status(201).json({
      success: true,
      message: 'Registration successful.',
      data: { accessToken, refreshToken, user: { id: userId, uuid: uid, username, role: 'player' } },
    });
  } catch (err) {
    await conn.rollback();
    console.error('Register error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// ── POST /api/auth/login ────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  const { email, password } = req.body;
  try {
    const [rows] = await db.execute(
      'SELECT id, uuid, username, email, password, role, is_banned FROM users WHERE email=? LIMIT 1',
      [email]
    );
    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    const user = rows[0];

    if (user.is_banned) {
      return res.status(403).json({ success: false, message: 'Account is banned.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    // Update online status
    await db.execute('UPDATE users SET is_online=1, last_seen=NOW() WHERE id=?', [user.id]);

    const accessToken  = signAccess(user);
    const refreshToken = signRefresh(user);
    const exp = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await db.execute(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, refreshToken, exp]
    );

    return res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: { id: user.id, uuid: user.uuid, username: user.username, role: user.role },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/auth/refresh ──────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'Refresh token required.' });
  }
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const [rows] = await db.execute(
      'SELECT * FROM refresh_tokens WHERE token=? AND user_id=? AND expires_at > NOW()',
      [refreshToken, decoded.id]
    );
    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
    }

    const [users] = await db.execute(
      'SELECT id, uuid, username, role FROM users WHERE id=?',
      [decoded.id]
    );
    if (!users.length) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    const user = users[0];
    const newAccess = signAccess(user);
    return res.json({ success: true, data: { accessToken: newAccess } });
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid refresh token.' });
  }
});

// ── POST /api/auth/logout ───────────────────────────────────────
router.post('/logout', auth, async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await db.execute('DELETE FROM refresh_tokens WHERE token=?', [refreshToken]);
  }
  await db.execute('UPDATE users SET is_online=0, last_seen=NOW() WHERE id=?', [req.user.id]);
  return res.json({ success: true, message: 'Logged out.' });
});

module.exports = router;
