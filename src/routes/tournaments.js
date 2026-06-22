const config = require('../config/config');
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db   = require('../config/database');
const auth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');

const { apiLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply standard API rate limiting
router.use(apiLimiter);

// ── GET /api/tournaments ─────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT t.uuid, t.name, t.description, t.entry_fee, t.prize_pool,
              t.max_players, t.num_winners, t.status, t.start_date, t.end_date,
              t.registration_end, t.winner_distribution,
              COUNT(tp.id) AS registered_players
       FROM tournaments t
       LEFT JOIN tournament_players tp ON tp.tournament_id = t.id
       GROUP BY t.id
       ORDER BY t.start_date ASC`
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/tournaments/:uuid ───────────────────────────────────
router.get('/:uuid', auth, async (req, res) => {
  try {
    const [[t]] = await db.execute(
      `SELECT t.*, COUNT(tp.id) AS registered_players
       FROM tournaments t
       LEFT JOIN tournament_players tp ON tp.tournament_id = t.id
       WHERE t.uuid=? GROUP BY t.id`,
      [req.params.uuid]
    );
    if (!t) return res.status(404).json({ success: false, message: 'Tournament not found.' });

    const [players] = await db.execute(
      `SELECT u.username, u.display_name, u.avatar, tp.status, tp.placement, tp.prize_received
       FROM tournament_players tp JOIN users u ON u.id = tp.user_id
       WHERE tp.tournament_id = ?
       ORDER BY tp.placement ASC, tp.joined_at ASC`,
      [t.id]
    );
    return res.json({ success: true, data: { ...t, players } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/tournaments/:uuid/join ────────────────────────────
router.post('/:uuid/join', auth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[t]] = await conn.execute(
      "SELECT * FROM tournaments WHERE uuid=? AND status='registration' FOR UPDATE",
      [req.params.uuid]
    );
    if (!t) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Tournament not open for registration.' });
    }

    // Already registered?
    const [already] = await conn.execute(
      'SELECT id FROM tournament_players WHERE tournament_id=? AND user_id=?',
      [t.id, req.user.id]
    );
    if (already.length) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'Already registered.' });
    }

    // Check capacity
    const [[{ cnt }]] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM tournament_players WHERE tournament_id=?', [t.id]
    );
    if (cnt >= t.max_players) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'Tournament is full.' });
    }

    // Deduct entry fee
    if (parseFloat(t.entry_fee) > 0) {
      const [[wallet]] = await conn.execute(
        'SELECT balance FROM wallets WHERE user_id=? FOR UPDATE', [req.user.id]
      );
      if (parseFloat(wallet.balance) < parseFloat(t.entry_fee)) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'Insufficient balance.' });
      }
      const newBalance = parseFloat(wallet.balance) - parseFloat(t.entry_fee);
      await conn.execute('UPDATE wallets SET balance=? WHERE user_id=?', [newBalance, req.user.id]);
      await conn.execute(
        'UPDATE tournaments SET prize_pool=prize_pool+? WHERE id=?',
        [t.entry_fee * (1 - config.tournamentFeePercent), t.id]
      );
      await conn.execute(
        `INSERT INTO transactions
           (uuid, user_id, type, amount, balance_before, balance_after, description)
         VALUES (?, ?, 'tournament_entry', ?, ?, ?, ?)`,
        [uuidv4(), req.user.id, t.entry_fee, wallet.balance, newBalance,
         `Tournament entry: ${t.name}`]
      );
    }

    await conn.execute(
      'INSERT INTO tournament_players (tournament_id, user_id) VALUES (?, ?)',
      [t.id, req.user.id]
    );

    await conn.commit();
    return res.json({ success: true, message: 'Joined tournament successfully.' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// ── POST /api/tournaments (admin only) ──────────────────────────
router.post('/', requireAdmin, [
  body('name').trim().isLength({ min: 3 }),
  body('entry_fee').isFloat({ min: 0 }),
  body('max_players').isInt({ min: 4 }),
  body('num_winners').isInt({ min: 1 }),
  body('start_date').isISO8601(),
  body('end_date').isISO8601(),
  body('registration_end').isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  const { name, description, entry_fee, max_players, num_winners,
          start_date, end_date, registration_end, winner_distribution } = req.body;
  try {
    const [result] = await db.execute(
      `INSERT INTO tournaments
         (uuid, name, description, entry_fee, max_players, num_winners,
          status, start_date, end_date, registration_end, winner_distribution, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'upcoming', ?, ?, ?, ?, ?)`,
      [uuidv4(), name, description || null, entry_fee, max_players, num_winners,
       start_date, end_date, registration_end,
       winner_distribution ? JSON.stringify(winner_distribution) : null,
       req.user.id]
    );
    return res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
