const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const { body, validationResult } = require('express-validator');
const db       = require('../config/database');
const auth     = require('../middleware/auth');

const { apiLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply standard API rate limiting
router.use(apiLimiter);

// Avatar upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_PATH || './uploads/avatars'),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar_${req.user.id}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880') },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  },
});

// ── GET /api/users/me ───────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.uuid, u.username, u.email, u.display_name, u.bio, u.avatar,
              u.role, u.is_online, u.last_seen, u.created_at,
              w.balance,
              s.games_played, s.games_won, s.games_lost, s.games_drawn,
              s.total_earnings, s.win_streak, s.best_streak
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       LEFT JOIN user_stats s ON s.user_id = u.id
       WHERE u.id = ?`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found.' });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── PATCH /api/users/me ─────────────────────────────────────────
router.patch('/me', auth, [
  body('display_name').optional().trim().isLength({ min: 1, max: 100 }),
  body('bio').optional().trim().isLength({ max: 500 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  const { display_name, bio } = req.body;
  const fields = [];
  const values = [];
  if (display_name !== undefined) { fields.push('display_name=?'); values.push(display_name); }
  if (bio          !== undefined) { fields.push('bio=?');          values.push(bio); }

  if (!fields.length) {
    return res.status(400).json({ success: false, message: 'No fields to update.' });
  }
  values.push(req.user.id);

  try {
    await db.execute(`UPDATE users SET ${fields.join(', ')} WHERE id=?`, values);
    return res.json({ success: true, message: 'Profile updated.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/users/me/avatar ───────────────────────────────────
router.post('/me/avatar', auth, upload.single('avatar'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }
  const avatarUrl = `/uploads/avatars/${req.file.filename}`;
  try {
    await db.execute('UPDATE users SET avatar=? WHERE id=?', [avatarUrl, req.user.id]);
    return res.json({ success: true, data: { avatar: avatarUrl } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/users/:username ────────────────────────────────────
router.get('/:username', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.uuid, u.username, u.display_name, u.bio, u.avatar, u.is_online, u.last_seen,
              s.games_played, s.games_won, s.games_lost, s.total_earnings
       FROM users u
       LEFT JOIN user_stats s ON s.user_id = u.id
       WHERE u.username = ?`,
      [req.params.username]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found.' });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/users/search?q= ────────────────────────────────────
router.get('/', auth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, data: [] });
  try {
    const [rows] = await db.execute(
      `SELECT id, uuid, username, display_name, avatar, is_online
       FROM users WHERE username LIKE ? OR display_name LIKE ? LIMIT 20`,
      [`%${q}%`, `%${q}%`]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/users/:userId/match-history ───────────────────────
router.get('/:userId/history', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT m.uuid, m.type, m.status, m.entry_fee, m.prize_pool, m.is_draw,
              m.started_at, m.completed_at,
              u_opp.username AS opponent_username,
              CASE WHEN m.winner_id = ? THEN 'win'
                   WHEN m.is_draw = 1    THEN 'draw'
                   ELSE 'loss' END AS result
       FROM matches m
       JOIN match_players mp ON mp.match_id = m.id AND mp.user_id = ?
       JOIN match_players mp2 ON mp2.match_id = m.id AND mp2.user_id != ?
       JOIN users u_opp ON u_opp.id = mp2.user_id
       WHERE m.status = 'completed'
       ORDER BY m.completed_at DESC
       LIMIT 50`,
      [req.user.id, req.params.userId, req.params.userId]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
