const express = require('express');
const db   = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

function getPeriodKey(period) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const week = getWeek(now);
  switch (period) {
    case 'daily':   return `${y}-${m}-${d}`;
    case 'weekly':  return `${y}-W${String(week).padStart(2, '0')}`;
    case 'monthly': return `${y}-${m}`;
    default:        return 'all';
  }
}

function getWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// ── GET /api/leaderboard/:period ─────────────────────────────────
router.get('/:period', auth, async (req, res) => {
  const period = req.params.period;
  if (!['daily', 'weekly', 'monthly', 'all_time'].includes(period)) {
    return res.status(400).json({ success: false, message: 'Invalid period.' });
  }

  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50')));
  const offset = (page - 1) * limit;

  try {
    if (period === 'all_time') {
      // Real-time from stats
      const [rows] = await db.execute(
        `SELECT u.id, u.username, u.display_name, u.avatar,
                s.games_played, s.games_won, s.total_earnings,
                CASE WHEN s.games_played > 0
                     THEN ROUND(s.games_won / s.games_played * 100, 2)
                     ELSE 0 END AS win_rate,
                ROW_NUMBER() OVER (ORDER BY s.games_won DESC,
                  CASE WHEN s.games_played > 0
                       THEN s.games_won / s.games_played ELSE 0 END DESC,
                  s.total_earnings DESC) AS \`rank\`
         FROM user_stats s
         JOIN users u ON u.id = s.user_id
         WHERE s.games_played > 0
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      return res.json({ success: true, data: rows });
    }

    const periodKey = getPeriodKey(period);
    const [rows] = await db.execute(
      `SELECT u.id, u.username, u.display_name, u.avatar,
              l.games_played, l.games_won, l.win_rate, l.earnings, l.rank
       FROM leaderboards l
       JOIN users u ON u.id = l.user_id
       WHERE l.period=? AND l.period_key=?
       ORDER BY l.rank ASC
       LIMIT ? OFFSET ?`,
      [period, periodKey, limit, offset]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/leaderboard/me/rank ─────────────────────────────────
router.get('/me/rank', auth, async (req, res) => {
  const period = req.query.period || 'all_time';
  try {
    if (period === 'all_time') {
      const [[row]] = await db.execute(
        `SELECT COUNT(*) + 1 AS \`rank\`
         FROM user_stats s2
         WHERE s2.games_won > (SELECT games_won FROM user_stats WHERE user_id=?)
            OR (s2.games_won = (SELECT games_won FROM user_stats WHERE user_id=?)
                AND s2.user_id != ?)`,
        [req.user.id, req.user.id, req.user.id]
      );
      return res.json({ success: true, data: { rank: row.rank } });
    }
    const periodKey = getPeriodKey(period);
    const [[row]] = await db.execute(
      'SELECT `rank` FROM leaderboards WHERE user_id=? AND period=? AND period_key=?',
      [req.user.id, period, periodKey]
    );
    return res.json({ success: true, data: { rank: row ? row.rank : null } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
