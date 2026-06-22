const express = require('express');
const db   = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// ── POST /api/friends/request ────────────────────────────────────
router.post('/request', auth, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ success: false, message: 'Username required.' });

  try {
    const [[target]] = await db.execute(
      'SELECT id FROM users WHERE username=? LIMIT 1', [username]
    );
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });
    if (target.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot add yourself.' });
    }

    // Check existing
    const [existing] = await db.execute(
      'SELECT * FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?) LIMIT 1',
      [req.user.id, target.id, target.id, req.user.id]
    );
    if (existing.length) {
      return res.status(409).json({ success: false, message: 'Friend request already exists.' });
    }

    await db.execute(
      "INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, 'pending')",
      [req.user.id, target.id]
    );
    return res.status(201).json({ success: true, message: 'Friend request sent.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── POST /api/friends/accept ─────────────────────────────────────
router.post('/accept', auth, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ success: false, message: 'userId required.' });

  try {
    const [result] = await db.execute(
      "UPDATE friendships SET status='accepted' WHERE user_id=? AND friend_id=? AND status='pending'",
      [userId, req.user.id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: 'Friend request not found.' });
    }
    return res.json({ success: true, message: 'Friend request accepted.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── DELETE /api/friends/:friendId ────────────────────────────────
router.delete('/:friendId', auth, async (req, res) => {
  const friendId = parseInt(req.params.friendId);
  try {
    await db.execute(
      'DELETE FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)',
      [req.user.id, friendId, friendId, req.user.id]
    );
    return res.json({ success: true, message: 'Friend removed.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/friends ─────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT
         CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END AS friend_id,
         u.username, u.display_name, u.avatar, u.is_online,
         f.status,
         f.user_id = ? AS is_sender
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
       WHERE (f.user_id=? OR f.friend_id=?) AND f.status != 'blocked'
       ORDER BY u.username`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
