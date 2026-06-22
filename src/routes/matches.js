const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db         = require('../config/database');
const auth       = require('../middleware/auth');
const AyoEngine  = require('../game/AyoEngine');

const { apiLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply standard API rate limiting
router.use(apiLimiter);

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── GET /api/matches  (public lobby) ────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT m.uuid, m.room_code, m.type, m.visibility, m.status, m.entry_fee,
              u.username AS created_by,
              COUNT(mp.id) AS player_count
       FROM matches m
       JOIN users u ON u.id = m.created_by
       LEFT JOIN match_players mp ON mp.match_id = m.id
       WHERE m.status = 'waiting' AND m.visibility = 'public' AND m.tournament_id IS NULL
       GROUP BY m.id
       ORDER BY m.created_at DESC
       LIMIT 50`
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/matches ────────────────────────────────────────────
router.post('/', auth, [
  body('type').isIn(['free', 'money']),
  body('visibility').optional().isIn(['public', 'private']),
  body('entry_fee').optional().isFloat({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  const { type, visibility = 'public', entry_fee = 0 } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let roomCode;
    let attempts = 0;
    do {
      roomCode = generateRoomCode();
      const [dup] = await conn.execute(
        "SELECT id FROM matches WHERE room_code=? AND status IN ('waiting','active') LIMIT 1",
        [roomCode]
      );
      if (!dup.length) break;
    } while (++attempts < 10);

    // Deduct entry fee for money matches
    let prizePool = 0;
    let platformFee = 0;
    if (type === 'money' && parseFloat(entry_fee) > 0) {
      const [[wallet]] = await conn.execute(
        'SELECT balance FROM wallets WHERE user_id=? FOR UPDATE',
        [req.user.id]
      );
      if (parseFloat(wallet.balance) < parseFloat(entry_fee)) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'Insufficient balance.' });
      }
      const newBalance = parseFloat(wallet.balance) - parseFloat(entry_fee);
      await conn.execute('UPDATE wallets SET balance=? WHERE user_id=?', [newBalance, req.user.id]);
      prizePool = parseFloat(entry_fee);

      await conn.execute(
        `INSERT INTO transactions
           (uuid, user_id, type, amount, balance_before, balance_after, description)
         VALUES (?, ?, 'match_entry', ?, ?, ?, 'Match entry fee')`,
        [uuidv4(), req.user.id, entry_fee, wallet.balance, newBalance]
      );
    }

    const matchUuid = uuidv4();
    const feePercent = parseFloat(process.env.MONEY_MATCH_FEE_PERCENT || '20') / 100;
    platformFee = prizePool * feePercent;

    const [result] = await conn.execute(
      `INSERT INTO matches (uuid, room_code, type, visibility, entry_fee, prize_pool, platform_fee, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [matchUuid, roomCode, type, visibility, entry_fee, prizePool, platformFee, req.user.id]
    );
    const matchId = result.insertId;

    await conn.execute(
      'INSERT INTO match_players (match_id, user_id, seat) VALUES (?, ?, 0)',
      [matchId, req.user.id]
    );

    await conn.commit();
    return res.status(201).json({
      success: true,
      data: { uuid: matchUuid, room_code: roomCode, type, visibility, entry_fee, prize_pool: prizePool },
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// ── POST /api/matches/join ───────────────────────────────────────
router.post('/join', auth, [
  body('room_code').notEmpty().isLength({ max: 10 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  const { room_code } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[match]] = await conn.execute(
      "SELECT * FROM matches WHERE room_code=? AND status='waiting' FOR UPDATE",
      [room_code]
    );
    if (!match) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Room not found or no longer open.' });
    }

    // Already in this match?
    const [already] = await conn.execute(
      'SELECT id FROM match_players WHERE match_id=? AND user_id=?',
      [match.id, req.user.id]
    );
    if (already.length) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'You are already in this match.' });
    }

    // Check seats
    const [players] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM match_players WHERE match_id=?',
      [match.id]
    );
    if (players[0].cnt >= 2) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'Room is full.' });
    }

    // Deduct entry fee
    if (match.type === 'money' && parseFloat(match.entry_fee) > 0) {
      const [[wallet]] = await conn.execute(
        'SELECT balance FROM wallets WHERE user_id=? FOR UPDATE',
        [req.user.id]
      );
      if (parseFloat(wallet.balance) < parseFloat(match.entry_fee)) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'Insufficient balance.' });
      }
      const newBalance = parseFloat(wallet.balance) - parseFloat(match.entry_fee);
      await conn.execute('UPDATE wallets SET balance=? WHERE user_id=?', [newBalance, req.user.id]);
      await conn.execute(
        'UPDATE matches SET prize_pool=prize_pool+? WHERE id=?',
        [match.entry_fee, match.id]
      );
      await conn.execute(
        `INSERT INTO transactions
           (uuid, user_id, type, amount, balance_before, balance_after, description)
         VALUES (?, ?, 'match_entry', ?, ?, ?, 'Match entry fee')`,
        [uuidv4(), req.user.id, match.entry_fee, wallet.balance, newBalance]
      );
    }

    // Add player 2
    await conn.execute(
      'INSERT INTO match_players (match_id, user_id, seat) VALUES (?, ?, 1)',
      [match.id, req.user.id]
    );

    // Initialize game and start match
    const gameState = AyoEngine.createGame();
    await conn.execute(
      `INSERT INTO ayo_games (match_id, board_state, store_p1, store_p2, current_turn, move_history)
       VALUES (?, ?, 0, 0, 0, '[]')`,
      [match.id, JSON.stringify(gameState.pits)]
    );
    await conn.execute(
      "UPDATE matches SET status='active', started_at=NOW() WHERE id=?",
      [match.id]
    );

    await conn.commit();
    return res.json({
      success: true,
      data: { uuid: match.uuid, room_code: match.room_code, match_id: match.id },
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// ── GET /api/matches/:uuid ──────────────────────────────────────
router.get('/:uuid', auth, async (req, res) => {
  try {
    const [[match]] = await db.execute(
      `SELECT m.*, ag.board_state, ag.store_p1, ag.store_p2,
              ag.current_turn AS game_turn, ag.move_count, ag.last_move_pit
       FROM matches m
       LEFT JOIN ayo_games ag ON ag.match_id = m.id
       WHERE m.uuid=?`,
      [req.params.uuid]
    );
    if (!match) return res.status(404).json({ success: false, message: 'Match not found.' });

    const [players] = await db.execute(
      `SELECT mp.seat, u.id, u.username, u.display_name, u.avatar, mp.seeds_captured
       FROM match_players mp JOIN users u ON u.id = mp.user_id
       WHERE mp.match_id=? ORDER BY mp.seat`,
      [match.id]
    );
    return res.json({ success: true, data: { ...match, players } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
