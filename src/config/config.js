/**
 * Platform configuration loaded from environment variables.
 */
const config = {
  /** Platform fee percentage for money matches (default 20%) */
  moneyMatchFeePercent: parseFloat(process.env.MONEY_MATCH_FEE_PERCENT || '20') / 100,

  /** Platform fee percentage for tournaments (default 30%) */
  tournamentFeePercent: parseFloat(process.env.TOURNAMENT_FEE_PERCENT || '30') / 100,

  /** Turn timer in seconds (default 30) */
  turnTimerSeconds: parseInt(process.env.TURN_TIMER_SECONDS || '30'),

  /** JWT configuration */
  jwt: {
    secret:             process.env.JWT_SECRET,
    expiresIn:          process.env.JWT_EXPIRES_IN         || '1h',
    refreshSecret:      process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn:   process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
};

module.exports = config;
