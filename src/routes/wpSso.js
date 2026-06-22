/**
 * WordPress SSO integration endpoint.
 * Validates a WordPress user token and issues a 9jaWin JWT.
 */
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db       = require('../config/database');

const router = express.Router();

router.post('/', async (req, res) => {
  if (process.env.SSO_ENABLED !== 'true') {
    return res.status(404).json({ success: false, message: 'SSO not enabled.' });
  }

  const { wp_token, wp_user_id, email, username, display_name } = req.body;

  // Verify the WordPress secret handshake
  const expected = require('crypto')
    .createHmac('sha256', process.env.WP_SECRET_KEY || '')
    .update(`${wp_user_id}:${email}`)
    .digest('hex');

  if (wp_token !== expected) {
    return res.status(401).json({ success: false, message: 'Invalid SSO token.' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    let [users] = await conn.execute(
      'SELECT * FROM users WHERE wp_user_id=? OR email=? LIMIT 1',
      [wp_user_id, email]
    );

    let user;
    if (!users.length) {
      // Create new user
      const safeUsername = (username || `wp_${wp_user_id}`).replace(/[^a-zA-Z0-9_]/g, '');
      const [check] = await conn.execute(
        'SELECT id FROM users WHERE username=?', [safeUsername]
      );
      const finalUsername = check.length ? `${safeUsername}_${wp_user_id}` : safeUsername;
      const randomPass = await bcrypt.hash(uuidv4(), 10);

      const [result] = await conn.execute(
        `INSERT INTO users (uuid, username, email, password, display_name, wp_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), finalUsername, email, randomPass, display_name || finalUsername, wp_user_id]
      );
      await conn.execute('INSERT INTO wallets (user_id) VALUES (?)', [result.insertId]);
      await conn.execute('INSERT INTO user_stats (user_id) VALUES (?)', [result.insertId]);

      const [newUsers] = await conn.execute('SELECT * FROM users WHERE id=?', [result.insertId]);
      user = newUsers[0];
    } else {
      user = users[0];
      // Sync display name if changed
      if (display_name && display_name !== user.display_name) {
        await conn.execute('UPDATE users SET display_name=?, wp_user_id=? WHERE id=?',
          [display_name, wp_user_id, user.id]);
      }
    }

    await conn.execute('UPDATE users SET is_online=1, last_seen=NOW() WHERE id=?', [user.id]);
    await conn.commit();

    const accessToken  = jwt.sign(
      { id: user.id, uuid: user.uuid, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );
    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );
    const exp = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await db.execute(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, refreshToken, exp]
    );

    return res.json({
      success: true,
      data: {
        accessToken, refreshToken,
        user: { id: user.id, uuid: user.uuid, username: user.username, role: user.role },
      },
    });
  } catch (err) {
    await conn.rollback();
    console.error('WP SSO error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

module.exports = router;
