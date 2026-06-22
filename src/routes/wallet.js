const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db   = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// ── GET /api/wallet ─────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT balance, locked FROM wallets WHERE user_id=?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Wallet not found.' });
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/wallet/transactions ────────────────────────────────
router.get('/transactions', auth, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20')));
  const offset = (page - 1) * limit;

  try {
    const [rows] = await db.execute(
      `SELECT uuid, type, amount, balance_before, balance_after,
              reference, description, status, created_at
       FROM transactions
       WHERE user_id=?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );
    const [[{ total }]] = await db.execute(
      'SELECT COUNT(*) AS total FROM transactions WHERE user_id=?',
      [req.user.id]
    );
    return res.json({ success: true, data: { transactions: rows, total, page, limit } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/wallet/deposit ─────────────────────────────────────
// In production this would integrate with a payment gateway
router.post('/deposit', auth, [
  body('amount').isFloat({ min: 100 }),
  body('reference').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  const { amount, reference } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Prevent duplicate reference
    const [dup] = await conn.execute(
      "SELECT id FROM transactions WHERE reference=? AND type='deposit' LIMIT 1",
      [reference]
    );
    if (dup.length) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'Duplicate transaction reference.' });
    }

    const [[wallet]] = await conn.execute(
      'SELECT balance FROM wallets WHERE user_id=? FOR UPDATE',
      [req.user.id]
    );
    const newBalance = parseFloat(wallet.balance) + parseFloat(amount);

    await conn.execute(
      'UPDATE wallets SET balance=? WHERE user_id=?',
      [newBalance, req.user.id]
    );
    await conn.execute(
      `INSERT INTO transactions
         (uuid, user_id, type, amount, balance_before, balance_after, reference, description, status)
       VALUES (?, ?, 'deposit', ?, ?, ?, ?, 'Wallet deposit', 'completed')`,
      [uuidv4(), req.user.id, amount, wallet.balance, newBalance, reference]
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

// ── POST /api/wallet/withdraw ────────────────────────────────────
router.post('/withdraw', auth, [
  body('amount').isFloat({ min: 500 }),
  body('account_number').notEmpty(),
  body('bank_code').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  const { amount, account_number, bank_code } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[wallet]] = await conn.execute(
      'SELECT balance FROM wallets WHERE user_id=? FOR UPDATE',
      [req.user.id]
    );
    if (parseFloat(wallet.balance) < parseFloat(amount)) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient balance.' });
    }

    const newBalance = parseFloat(wallet.balance) - parseFloat(amount);
    await conn.execute(
      'UPDATE wallets SET balance=? WHERE user_id=?',
      [newBalance, req.user.id]
    );
    const txRef = `WD-${Date.now()}`;
    await conn.execute(
      `INSERT INTO transactions
         (uuid, user_id, type, amount, balance_before, balance_after, reference, description, status, metadata)
       VALUES (?, ?, 'withdrawal', ?, ?, ?, ?, 'Withdrawal request', 'pending', ?)`,
      [
        uuidv4(), req.user.id, amount, wallet.balance, newBalance, txRef,
        JSON.stringify({ account_number, bank_code }),
      ]
    );

    await conn.commit();
    return res.json({ success: true, message: 'Withdrawal request submitted.', data: { balance: newBalance } });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

module.exports = router;
