const express = require('express');
const { requireAdmin } = require('../middleware/adminAuth');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

const { apiLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply standard API rate limiting
router.use(apiLimiter);

// ── GET /api/admin/dashboard ─────────────────────────────────────
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const [[{ total_users }]] = await db.execute('SELECT COUNT(*) AS total_users FROM users');
    const [[{ active_games }]] = await db.execute(
      "SELECT COUNT(*) AS active_games FROM matches WHERE status='active'"
    );
    const [[{ total_revenue }]] = await db.execute(
      "SELECT COALESCE(SUM(platform_fee),0) AS total_revenue FROM matches WHERE status='completed'"
    );
    const [[{ total_tournaments }]] = await db.execute(
      'SELECT COUNT(*) AS total_tournaments FROM tournaments'
    );
    const [[wallet_stats]] = await db.execute(
      'SELECT COALESCE(SUM(balance),0) AS total_balance FROM wallets'
    );
    const [[{ pending_withdrawals }]] = await db.execute(
      "SELECT COUNT(*) AS pending_withdrawals FROM transactions WHERE type='withdrawal' AND status='pending'"
    );

    return res.json({
      success: true,
      data: {
        total_users,
        active_games,
        total_revenue,
        total_tournaments,
        total_balance: wallet_stats.total_balance,
        pending_withdrawals,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/admin/users ─────────────────────────────────────────
router.get('/users', requireAdmin, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20')));
  const offset = (page - 1) * limit;
  const search = req.query.search || '';

  try {
    const searchParam = `%${search}%`;
    const [rows] = await db.execute(
      `SELECT u.id, u.uuid, u.username, u.email, u.display_name, u.role,
              u.is_online, u.is_banned, u.created_at,
              w.balance, s.games_played, s.games_won
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id
       LEFT JOIN user_stats s ON s.user_id = u.id
       WHERE u.username LIKE ? OR u.email LIKE ?
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [searchParam, searchParam, limit, offset]
    );
    const [[{ total }]] = await db.execute(
      'SELECT COUNT(*) AS total FROM users WHERE username LIKE ? OR email LIKE ?',
      [searchParam, searchParam]
    );
    return res.json({ success: true, data: { users: rows, total, page, limit } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── PATCH /api/admin/users/:id/ban ──────────────────────────────
router.patch('/users/:id/ban', requireAdmin, async (req, res) => {
  const { banned } = req.body;
  try {
    await db.execute('UPDATE users SET is_banned=? WHERE id=?', [banned ? 1 : 0, req.params.id]);
    return res.json({ success: true, message: `User ${banned ? 'banned' : 'unbanned'}.` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── PATCH /api/admin/users/:id/role ─────────────────────────────
router.patch('/users/:id/role', requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!['player', 'admin'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role.' });
  }
  try {
    await db.execute('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
    return res.json({ success: true, message: 'Role updated.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/admin/transactions ──────────────────────────────────
router.get('/transactions', requireAdmin, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20')));
  const offset = (page - 1) * limit;
  const type   = req.query.type || '';
  const status = req.query.status || '';

  try {
    let where = '1=1';
    const params = [];
    if (type)   { where += ' AND t.type=?';   params.push(type); }
    if (status) { where += ' AND t.status=?'; params.push(status); }
    params.push(limit, offset);

    const [rows] = await db.execute(
      `SELECT t.uuid, t.type, t.amount, t.status, t.reference, t.description,
              t.created_at, u.username
       FROM transactions t JOIN users u ON u.id = t.user_id
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── PATCH /api/admin/transactions/:uuid/approve ──────────────────
router.patch('/transactions/:uuid/approve', requireAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[tx]] = await conn.execute(
      "SELECT * FROM transactions WHERE uuid=? AND type='withdrawal' AND status='pending' FOR UPDATE",
      [req.params.uuid]
    );
    if (!tx) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    await conn.execute(
      "UPDATE transactions SET status='completed' WHERE id=?", [tx.id]
    );
    await conn.commit();
    return res.json({ success: true, message: 'Withdrawal approved.' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// ── PATCH /api/admin/transactions/:uuid/reject ───────────────────
router.patch('/transactions/:uuid/reject', requireAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[tx]] = await conn.execute(
      "SELECT * FROM transactions WHERE uuid=? AND type='withdrawal' AND status='pending' FOR UPDATE",
      [req.params.uuid]
    );
    if (!tx) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    // Refund
    await conn.execute(
      'UPDATE wallets SET balance=balance+? WHERE user_id=?', [tx.amount, tx.user_id]
    );
    await conn.execute(
      "UPDATE transactions SET status='reversed' WHERE id=?", [tx.id]
    );
    await conn.execute(
      `INSERT INTO transactions
         (uuid, user_id, type, amount, balance_before, balance_after, reference, description, status)
       SELECT UUID(), user_id, 'refund', amount, balance_after, balance_after + amount, uuid, 'Withdrawal rejected - refunded', 'completed'
       FROM transactions WHERE id=?`,
      [tx.id]
    );

    await conn.commit();
    return res.json({ success: true, message: 'Withdrawal rejected and refunded.' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// ── GET /api/admin/matches ───────────────────────────────────────
router.get('/matches', requireAdmin, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20')));
  const offset = (page - 1) * limit;

  try {
    const [rows] = await db.execute(
      `SELECT m.uuid, m.room_code, m.type, m.status, m.entry_fee, m.prize_pool,
              m.started_at, m.completed_at, u.username AS created_by
       FROM matches m JOIN users u ON u.id = m.created_by
       ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/admin/wallet/credit ────────────────────────────────
router.post('/wallet/credit', requireAdmin, async (req, res) => {
  const { user_id, amount, reason } = req.body;
  if (!user_id || !amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ success: false, message: 'user_id and amount required.' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[wallet]] = await conn.execute(
      'SELECT balance FROM wallets WHERE user_id=? FOR UPDATE', [user_id]
    );
    if (!wallet) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Wallet not found.' });
    }
    const newBalance = parseFloat(wallet.balance) + parseFloat(amount);
    await conn.execute('UPDATE wallets SET balance=? WHERE user_id=?', [newBalance, user_id]);
    await conn.execute(
      `INSERT INTO transactions
         (uuid, user_id, type, amount, balance_before, balance_after, description, status)
       VALUES (?, ?, 'deposit', ?, ?, ?, ?, 'completed')`,
      [uuidv4(), user_id, amount, wallet.balance, newBalance, reason || 'Admin credit']
    );
    await conn.commit();
    return res.json({ success: true, data: { balance: newBalance } });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

module.exports = router;
