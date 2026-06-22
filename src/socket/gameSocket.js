/**
 * Socket.IO real-time game handler for 9jaWin Ayo game.
 *
 * Events emitted to clients:
 *   game:state       – full game state
 *   game:move        – move result + new state
 *   game:over        – game ended with winner info
 *   game:turn_timer  – countdown tick
 *   game:chat        – chat message
 *   game:player_joined – a player joined the room
 *   game:player_disconnected
 *   game:player_reconnected
 *   game:error       – error message
 *
 * Events received from clients:
 *   game:join        – join a match room
 *   game:move        – make a move (pitIndex)
 *   game:chat        – send chat message
 *   game:resign      – resign the match
 */

const jwt       = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db        = require('../config/database');
const AyoEngine = require('../game/AyoEngine');

const TURN_TIMER_SECONDS = parseInt(process.env.TURN_TIMER_SECONDS || '30');

// In-memory game timers: matchId -> { timer, secondsLeft }
const gameTimers = new Map();
// In-memory game states cache: matchId -> AyoEngine state
const gameStateCache = new Map();

function clearTimer(matchId) {
  const t = gameTimers.get(matchId);
  if (t) {
    clearInterval(t.interval);
    gameTimers.delete(matchId);
  }
}

function setupTimer(io, matchId, onExpire) {
  clearTimer(matchId);
  let secondsLeft = TURN_TIMER_SECONDS;

  const interval = setInterval(async () => {
    secondsLeft--;
    io.to(`match:${matchId}`).emit('game:turn_timer', { secondsLeft });
    if (secondsLeft <= 0) {
      clearTimer(matchId);
      await onExpire();
    }
  }, 1000);

  gameTimers.set(matchId, { interval, secondsLeft });
  return secondsLeft;
}

/**
 * Distribute match rewards in the DB.
 */
async function distributeMatchReward(matchId, winnerId, isDraw) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[match]] = await conn.execute(
      'SELECT * FROM matches WHERE id=? FOR UPDATE', [matchId]
    );
    if (!match || match.status !== 'active') {
      await conn.rollback();
      return;
    }

    const prizePool  = parseFloat(match.prize_pool);
    const feePercent = parseFloat(process.env.MONEY_MATCH_FEE_PERCENT || '20') / 100;

    if (prizePool > 0 && !isDraw) {
      const winnerAmount = prizePool * (1 - feePercent);
      const [[wallet]] = await conn.execute(
        'SELECT balance FROM wallets WHERE user_id=? FOR UPDATE', [winnerId]
      );
      const newBalance = parseFloat(wallet.balance) + winnerAmount;
      await conn.execute(
        'UPDATE wallets SET balance=? WHERE user_id=?', [newBalance, winnerId]
      );
      await conn.execute(
        `INSERT INTO transactions
           (uuid, user_id, type, amount, balance_before, balance_after, description, status)
         VALUES (?, ?, 'match_reward', ?, ?, ?, 'Match winnings', 'completed')`,
        [uuidv4(), winnerId, winnerAmount, wallet.balance, newBalance]
      );
      await conn.execute(
        `INSERT INTO rewards (uuid, user_id, match_id, type, amount, status, distributed_at)
         VALUES (?, ?, ?, 'match_win', ?, 'distributed', NOW())`,
        [uuidv4(), winnerId, matchId, winnerAmount]
      );
    } else if (prizePool > 0 && isDraw) {
      // Split pot (minus platform fee) equally between both players
      const [players] = await conn.execute(
        'SELECT user_id FROM match_players WHERE match_id=?', [matchId]
      );
      const shareAmount = (prizePool * (1 - feePercent)) / players.length;
      for (const p of players) {
        const [[wallet]] = await conn.execute(
          'SELECT balance FROM wallets WHERE user_id=? FOR UPDATE', [p.user_id]
        );
        const newBalance = parseFloat(wallet.balance) + shareAmount;
        await conn.execute(
          'UPDATE wallets SET balance=? WHERE user_id=?', [newBalance, p.user_id]
        );
        await conn.execute(
          `INSERT INTO transactions
             (uuid, user_id, type, amount, balance_before, balance_after, description, status)
           VALUES (?, ?, 'match_reward', ?, ?, ?, 'Match draw refund', 'completed')`,
          [uuidv4(), p.user_id, shareAmount, wallet.balance, newBalance]
        );
      }
    }

    await conn.execute(
      `UPDATE matches SET status='completed', winner_id=?, is_draw=?, completed_at=NOW() WHERE id=?`,
      [isDraw ? null : winnerId, isDraw ? 1 : 0, matchId]
    );

    // Update user stats
    const [players] = await conn.execute(
      'SELECT user_id FROM match_players WHERE match_id=?', [matchId]
    );
    for (const p of players) {
      if (isDraw) {
        await conn.execute(
          'UPDATE user_stats SET games_played=games_played+1, games_drawn=games_drawn+1 WHERE user_id=?',
          [p.user_id]
        );
      } else if (p.user_id === winnerId) {
        await conn.execute(
          `UPDATE user_stats
           SET games_played=games_played+1, games_won=games_won+1,
               win_streak=win_streak+1,
               best_streak=GREATEST(best_streak, win_streak+1),
               total_earnings=total_earnings+?
           WHERE user_id=?`,
          [prizePool * (1 - feePercent), p.user_id]
        );
      } else {
        await conn.execute(
          'UPDATE user_stats SET games_played=games_played+1, games_lost=games_lost+1, win_streak=0 WHERE user_id=?',
          [p.user_id]
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error('distributeMatchReward error:', err);
  } finally {
    conn.release();
  }
}

/**
 * Authenticate socket using JWT in handshake auth.
 */
function authenticateSocket(socket) {
  const token = socket.handshake.auth?.token;
  if (!token) throw new Error('No token');
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return decoded;
}

/**
 * Register all Socket.IO game event handlers.
 */
function registerSocketHandlers(io) {
  io.use((socket, next) => {
    try {
      const user = authenticateSocket(socket);
      socket.user = user;
      next();
    } catch {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.user.username} (${socket.id})`);

    // Mark user online
    db.execute('UPDATE users SET is_online=1, last_seen=NOW() WHERE id=?', [socket.user.id])
      .catch(console.error);

    // ── game:join ────────────────────────────────────────────────
    socket.on('game:join', async ({ matchUuid }) => {
      try {
        const [[match]] = await db.execute(
          `SELECT m.*, mp.seat
           FROM matches m
           JOIN match_players mp ON mp.match_id = m.id AND mp.user_id = ?
           WHERE m.uuid = ?`,
          [socket.user.id, matchUuid]
        );
        if (!match) {
          socket.emit('game:error', { message: 'Match not found or you are not a participant.' });
          return;
        }

        const roomName = `match:${match.id}`;
        socket.join(roomName);
        socket.currentMatchId = match.id;
        socket.currentSeat    = match.seat;

        // Load or cache game state
        let state = gameStateCache.get(match.id);
        if (!state) {
          const [[ag]] = await db.execute(
            'SELECT * FROM ayo_games WHERE match_id=?', [match.id]
          );
          if (ag) {
            state = AyoEngine.deserialize({
              pits:        JSON.parse(ag.board_state),
              store:       [ag.store_p1, ag.store_p2],
              currentTurn: ag.current_turn,
              moveCount:   ag.move_count,
              lastMovePit: ag.last_move_pit,
              moveHistory: JSON.parse(ag.move_history || '[]'),
              gameOver:    match.status === 'completed',
              winner:      null,
            });
            gameStateCache.set(match.id, state);
          }
        }

        // Get players
        const [players] = await db.execute(
          `SELECT mp.seat, u.id, u.username, u.display_name, u.avatar
           FROM match_players mp JOIN users u ON u.id = mp.user_id
           WHERE mp.match_id=? ORDER BY mp.seat`,
          [match.id]
        );

        socket.emit('game:state', {
          state: state ? AyoEngine.serialize(state) : null,
          match: { uuid: match.uuid, room_code: match.room_code, type: match.type, status: match.status },
          players,
          yourSeat: match.seat,
          validMoves: state && !state.gameOver && state.currentTurn === match.seat
            ? AyoEngine.validMoves(state) : [],
        });

        io.to(roomName).emit('game:player_joined', {
          userId: socket.user.id,
          username: socket.user.username,
          seat: match.seat,
        });

        // Start timer if match is active and no timer running
        if (match.status === 'active' && state && !state.gameOver && !gameTimers.has(match.id)) {
          setupTimer(io, match.id, () => handleTurnTimeout(io, match.id));
        }
      } catch (err) {
        console.error('game:join error:', err);
        socket.emit('game:error', { message: 'Failed to join match.' });
      }
    });

    // ── game:move ────────────────────────────────────────────────
    socket.on('game:move', async ({ pitIndex }) => {
      const matchId = socket.currentMatchId;
      const seat    = socket.currentSeat;
      if (!matchId) {
        socket.emit('game:error', { message: 'Not in a match.' });
        return;
      }

      try {
        const state = gameStateCache.get(matchId);
        if (!state) {
          socket.emit('game:error', { message: 'Game state not found.' });
          return;
        }
        if (state.gameOver) {
          socket.emit('game:error', { message: 'Game is already over.' });
          return;
        }
        if (state.currentTurn !== seat) {
          socket.emit('game:error', { message: 'Not your turn.' });
          return;
        }

        const result = AyoEngine.makeMove(state, pitIndex);
        if (!result.ok) {
          socket.emit('game:error', { message: result.error });
          return;
        }

        const newState = result.state;
        gameStateCache.set(matchId, newState);

        // Persist to DB
        await db.execute(
          `UPDATE ayo_games
           SET board_state=?, store_p1=?, store_p2=?, current_turn=?,
               move_count=?, last_move_pit=?, last_move_time=NOW(), move_history=?
           WHERE match_id=?`,
          [
            JSON.stringify(newState.pits),
            newState.store[0], newState.store[1],
            newState.currentTurn, newState.moveCount,
            newState.lastMovePit,
            JSON.stringify(newState.moveHistory),
            matchId,
          ]
        );

        clearTimer(matchId);

        const serialized = AyoEngine.serialize(newState);

        // Broadcast move
        io.to(`match:${matchId}`).emit('game:move', {
          player:  socket.user.username,
          seat,
          pitIndex,
          state:   serialized,
          validMoves: !newState.gameOver
            ? AyoEngine.validMoves(newState)
            : [],
        });

        if (newState.gameOver) {
          // Determine winner user_id
          let winnerUserId = null;
          let isDraw       = false;
          if (newState.winner === 'draw') {
            isDraw = true;
          } else {
            // winner is seat 0 or seat 1
            const [[winnerRow]] = await db.execute(
              'SELECT user_id FROM match_players WHERE match_id=? AND seat=?',
              [matchId, newState.winner]
            );
            winnerUserId = winnerRow?.user_id || null;
          }

          await distributeMatchReward(matchId, winnerUserId, isDraw);
          gameStateCache.delete(matchId);

          io.to(`match:${matchId}`).emit('game:over', {
            winner:      newState.winner,
            store:       newState.store,
            isDraw,
            winnerUserId,
          });
        } else {
          // Start next turn timer
          setupTimer(io, matchId, () => handleTurnTimeout(io, matchId));
        }
      } catch (err) {
        console.error('game:move error:', err);
        socket.emit('game:error', { message: 'Move failed. Please try again.' });
      }
    });

    // ── game:resign ──────────────────────────────────────────────
    socket.on('game:resign', async () => {
      const matchId = socket.currentMatchId;
      const seat    = socket.currentSeat;
      if (!matchId) return;

      try {
        const [[match]] = await db.execute(
          "SELECT * FROM matches WHERE id=? AND status='active'", [matchId]
        );
        if (!match) return;

        const [[winner]] = await db.execute(
          'SELECT user_id FROM match_players WHERE match_id=? AND seat=?',
          [matchId, 1 - seat]
        );
        const winnerUserId = winner?.user_id;

        clearTimer(matchId);
        gameStateCache.delete(matchId);

        await distributeMatchReward(matchId, winnerUserId, false);

        io.to(`match:${matchId}`).emit('game:over', {
          winner:      1 - seat,
          isDraw:      false,
          winnerUserId,
          reason:      'resign',
          resignedSeat: seat,
        });
      } catch (err) {
        console.error('game:resign error:', err);
      }
    });

    // ── game:chat ────────────────────────────────────────────────
    socket.on('game:chat', async ({ message }) => {
      const matchId = socket.currentMatchId;
      if (!matchId) return;
      if (!message || typeof message !== 'string') return;

      const sanitized = message.substring(0, 200).trim();
      if (!sanitized) return;

      try {
        await db.execute(
          'INSERT INTO messages (match_id, user_id, content) VALUES (?, ?, ?)',
          [matchId, socket.user.id, sanitized]
        );
        io.to(`match:${matchId}`).emit('game:chat', {
          userId:   socket.user.id,
          username: socket.user.username,
          message:  sanitized,
          ts:       Date.now(),
        });
      } catch (err) {
        console.error('game:chat error:', err);
      }
    });

    // ── disconnect ───────────────────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.user.username}`);
      db.execute('UPDATE users SET is_online=0, last_seen=NOW() WHERE id=?', [socket.user.id])
        .catch(console.error);

      if (socket.currentMatchId) {
        io.to(`match:${socket.currentMatchId}`).emit('game:player_disconnected', {
          userId:   socket.user.id,
          username: socket.user.username,
          seat:     socket.currentSeat,
        });
      }
    });
  });
}

/**
 * Handle turn timeout: auto-skip turn or end game.
 */
async function handleTurnTimeout(io, matchId) {
  const state = gameStateCache.get(matchId);
  if (!state || state.gameOver) return;

  const currentSeat = state.currentTurn;

  // Try to find any valid move; if none, end game
  const valid = AyoEngine.validMoves(state);
  if (!valid.length) {
    // No moves → end game
    const finalState = { ...state };
    AyoEngine._checkEndGame(finalState);
    gameStateCache.set(matchId, finalState);

    let winnerUserId = null;
    let isDraw       = false;
    if (finalState.winner === 'draw') {
      isDraw = true;
    } else if (finalState.winner !== null) {
      const [[winnerRow]] = await db.execute(
        'SELECT user_id FROM match_players WHERE match_id=? AND seat=?',
        [matchId, finalState.winner]
      );
      winnerUserId = winnerRow?.user_id;
    }
    await distributeMatchReward(matchId, winnerUserId, isDraw);
    gameStateCache.delete(matchId);
    io.to(`match:${matchId}`).emit('game:over', { winner: finalState.winner, isDraw, winnerUserId, reason: 'no_moves' });
    return;
  }

  // Auto-play the first valid move
  const autoMove = valid[0];
  const result   = AyoEngine.makeMove(state, autoMove);
  if (!result.ok) return;

  const newState = result.state;
  gameStateCache.set(matchId, newState);

  await db.execute(
    `UPDATE ayo_games
     SET board_state=?, store_p1=?, store_p2=?, current_turn=?,
         move_count=?, last_move_pit=?, last_move_time=NOW(), move_history=?
     WHERE match_id=?`,
    [
      JSON.stringify(newState.pits),
      newState.store[0], newState.store[1],
      newState.currentTurn, newState.moveCount,
      newState.lastMovePit,
      JSON.stringify(newState.moveHistory),
      matchId,
    ]
  );

  io.to(`match:${matchId}`).emit('game:move', {
    auto: true,
    seat: currentSeat,
    pitIndex: autoMove,
    state: AyoEngine.serialize(newState),
    validMoves: !newState.gameOver ? AyoEngine.validMoves(newState) : [],
    reason: 'timeout',
  });

  if (newState.gameOver) {
    let winnerUserId = null;
    let isDraw       = false;
    if (newState.winner === 'draw') {
      isDraw = true;
    } else if (newState.winner !== null) {
      const [[winnerRow]] = await db.execute(
        'SELECT user_id FROM match_players WHERE match_id=? AND seat=?',
        [matchId, newState.winner]
      );
      winnerUserId = winnerRow?.user_id;
    }
    await distributeMatchReward(matchId, winnerUserId, isDraw);
    gameStateCache.delete(matchId);
    io.to(`match:${matchId}`).emit('game:over', { winner: newState.winner, isDraw, winnerUserId });
  } else {
    setupTimer(io, matchId, () => handleTurnTimeout(io, matchId));
  }
}

module.exports = { registerSocketHandlers };
