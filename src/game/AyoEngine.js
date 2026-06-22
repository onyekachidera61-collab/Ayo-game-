/**
 * AyoEngine – Authentic Ayo Olopon (Nigerian Mancala) game logic
 *
 * Board layout (indices 0-11):
 *   Player 2 side:  pits[6..11]  (index 11 is to player-2's left)
 *   Player 1 side:  pits[0..5]   (index 0  is to player-1's left)
 *
 * Seeds are sown anti-clockwise: 0→1→2→3→4→5→11→10→9→8→7→6→0→...
 * (Player 1 sows right along their row then left along opponent's row)
 *
 * Capture rule (Ayo Olopon):
 *   After the last seed lands in a pit on the OPPONENT'S side and
 *   that pit now contains exactly 2 or 3 seeds → capture that pit
 *   AND continue capturing backwards as long as consecutive pits
 *   on the opponent's side also have 2 or 3 seeds.
 *
 * Grand slam rule:
 *   A move that would capture ALL of the opponent's seeds is illegal
 *   (opponent must keep at least one seed).  If no other move is
 *   available the grand slam IS allowed.
 *
 * End of game:
 *   - A player whose side has no seeds passes (cannot move).
 *   - If both sides are empty, or a player cannot move and the
 *     opponent has no move either, game ends.
 *   - Each player claims the seeds remaining on their own side.
 *   - Most seeds wins (24+ to win, 24/24 is a draw).
 */

const ANTI_CW_ORDER = [0, 1, 2, 3, 4, 5, 11, 10, 9, 8, 7, 6];

/** Total number of pits on the board */
const TOTAL_PITS      = 12;
/** Pits per player side */
const PITS_PER_PLAYER = 6;
/** Seeds per pit at game start */
const INITIAL_SEEDS   = 4;

class AyoEngine {
  /**
   * Create a fresh game state.
   * @returns {object} game state
   */
  static createGame() {
    return {
      pits: Array(TOTAL_PITS).fill(INITIAL_SEEDS),
      store: [0, 0],        // [player1_captured, player2_captured]
      currentTurn: 0,       // 0 = player1, 1 = player2
      moveCount: 0,
      lastMovePit: null,
      moveHistory: [],
      gameOver: false,
      winner: null,         // 0, 1, or 'draw'
    };
  }

  /** Return the pit indices belonging to a player (0 or 1). */
  static playerPits(player) {
    return player === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11];
  }

  /** Return the opponent's pit indices. */
  static opponentPits(player) {
    return AyoEngine.playerPits(1 - player);
  }

  /** Seed count on a player's side. */
  static sideSeeds(pits, player) {
    return AyoEngine.playerPits(player).reduce((s, i) => s + pits[i], 0);
  }

  /**
   * Validate and execute a move.
   * @param {object} state  – current game state (will NOT be mutated)
   * @param {number} pitIdx – 0-indexed pit chosen by the current player
   * @returns {{ ok: boolean, state?: object, error?: string }}
   */
  static makeMove(state, pitIdx) {
    if (state.gameOver) {
      return { ok: false, error: 'Game is already over.' };
    }

    const player    = state.currentTurn;
    const myPits    = AyoEngine.playerPits(player);
    const oppPits   = AyoEngine.opponentPits(player);

    // Must pick from own side
    if (!myPits.includes(pitIdx)) {
      return { ok: false, error: 'You must pick a pit on your own side.' };
    }

    const seeds = state.pits[pitIdx];
    if (seeds === 0) {
      return { ok: false, error: 'Selected pit is empty.' };
    }

    // Grand slam pre-check: would this move capture all opponent seeds?
    const simulatedPits = [...state.pits];
    const captured = AyoEngine._sowAndCapture(simulatedPits, pitIdx, player);
    const oppSeedsAfter = oppPits.reduce((s, i) => s + simulatedPits[i], 0);

    if (oppSeedsAfter === 0) {
      // Grand slam — only allowed if every other move also results in grand slam
      const otherMoves = myPits.filter(p => p !== pitIdx && state.pits[p] > 0);
      const allGrandSlam = otherMoves.every(alt => {
        const tempPits = [...state.pits];
        AyoEngine._sowAndCapture(tempPits, alt, player);
        return oppPits.reduce((s, i) => s + tempPits[i], 0) === 0;
      });
      if (!allGrandSlam) {
        return { ok: false, error: 'Grand slam move is not allowed when alternatives exist.' };
      }
    }

    // Build new state (immutable)
    const newPits = simulatedPits;
    const newStore = [...state.store];
    newStore[player] += captured;

    const newState = {
      pits: newPits,
      store: newStore,
      currentTurn: 1 - player,
      moveCount: state.moveCount + 1,
      lastMovePit: pitIdx,
      moveHistory: [...state.moveHistory, { player, pit: pitIdx, captured, ts: Date.now() }],
      gameOver: false,
      winner: null,
    };

    // Check end of game
    AyoEngine._checkEndGame(newState);

    return { ok: true, state: newState };
  }

  /**
   * Sow seeds from pitIdx and execute captures.
   * Mutates the passed pits array.
   * Returns the number of seeds captured in this move.
   */
  static _sowAndCapture(pits, pitIdx, player) {
    let seeds = pits[pitIdx];
    pits[pitIdx] = 0;

    // Find starting position in the anti-clockwise traversal
    const startPos = ANTI_CW_ORDER.indexOf(pitIdx);
    let pos = startPos;
    let lastPit = pitIdx;

    while (seeds > 0) {
      pos = (pos + 1) % TOTAL_PITS;
      const pit = ANTI_CW_ORDER[pos];

      // Skip origin pit only if we complete a full lap (seeds > TOTAL_PITS - 1)
      if (pit === pitIdx && seeds <= TOTAL_PITS) {
        // Do not sow back into origin pit on the last lap
        // Actually in standard Ayo: origin pit IS skipped when sowing
        // (you never sow into the pit you picked up from)
        // Only skip it during the lap it was picked from; after a full
        // revolution it becomes available again.
        // We handle this by simply skipping ONLY the origin pit when
        // seeds remaining equals the lap size that would land on it.
        // Simplification: skip origin pit always if seeds > 0 and
        // we have not yet done a full revolution.
        if (seeds < TOTAL_PITS) {
          continue; // skip origin
        }
      }

      pits[pit]++;
      seeds--;
      lastPit = pit;
    }

    // Capture phase
    let captured = 0;
    const oppPits = AyoEngine.opponentPits(player);

    if (oppPits.includes(lastPit)) {
      let capPit = lastPit;
      while (oppPits.includes(capPit) && (pits[capPit] === 2 || pits[capPit] === 3)) {
        captured += pits[capPit];
        pits[capPit] = 0;
        // Move backwards in anti-clockwise direction (i.e. previous pit)
        const pos = ANTI_CW_ORDER.indexOf(capPit);
        capPit = ANTI_CW_ORDER[(pos - 1 + TOTAL_PITS) % TOTAL_PITS];
      }
    }

    return captured;
  }

  /**
   * After a move, check if the game is over and set winner.
   * Mutates newState.
   */
  static _checkEndGame(state) {
    const p1Seeds = AyoEngine.sideSeeds(state.pits, 0);
    const p2Seeds = AyoEngine.sideSeeds(state.pits, 1);

    // Current player has no seeds to sow → check if opponent can move
    const currentHasMove = AyoEngine.playerPits(state.currentTurn)
      .some(i => state.pits[i] > 0);
    const waitingHasMove = AyoEngine.playerPits(1 - state.currentTurn)
      .some(i => state.pits[i] > 0);

    if (!currentHasMove && !waitingHasMove) {
      // Both sides empty → collect remaining (should be 0 each already)
      state.store[0] += p1Seeds;
      state.store[1] += p2Seeds;
      state.pits = Array(12).fill(0);
      AyoEngine._declareWinner(state);
    } else if (!currentHasMove) {
      // Current player can't move → opponent collects own remaining seeds
      const opp = 1 - state.currentTurn;
      AyoEngine.playerPits(opp).forEach(i => {
        state.store[opp] += state.pits[i];
        state.pits[i] = 0;
      });
      // Current player also collects own seeds
      AyoEngine.playerPits(state.currentTurn).forEach(i => {
        state.store[state.currentTurn] += state.pits[i];
        state.pits[i] = 0;
      });
      AyoEngine._declareWinner(state);
    }
  }

  static _declareWinner(state) {
    state.gameOver = true;
    if (state.store[0] > state.store[1]) {
      state.winner = 0;
    } else if (state.store[1] > state.store[0]) {
      state.winner = 1;
    } else {
      state.winner = 'draw';
    }
  }

  /**
   * Return valid pit indices for the current player.
   */
  static validMoves(state) {
    if (state.gameOver) return [];
    const player = state.currentTurn;
    const myPits = AyoEngine.playerPits(player);
    const candidates = myPits.filter(i => state.pits[i] > 0);

    // Filter out grand slams if non-grand-slam moves exist
    const oppPits = AyoEngine.opponentPits(player);
    const nonGrandSlam = candidates.filter(pitIdx => {
      const tempPits = [...state.pits];
      AyoEngine._sowAndCapture(tempPits, pitIdx, player);
      return oppPits.reduce((s, i) => s + tempPits[i], 0) > 0;
    });

    return nonGrandSlam.length > 0 ? nonGrandSlam : candidates;
  }

  /**
   * Serialize state to a plain object safe for JSON/DB storage.
   */
  static serialize(state) {
    return {
      pits:        state.pits,
      store:       state.store,
      currentTurn: state.currentTurn,
      moveCount:   state.moveCount,
      lastMovePit: state.lastMovePit,
      moveHistory: state.moveHistory,
      gameOver:    state.gameOver,
      winner:      state.winner,
    };
  }

  /** Deserialize a stored state back to a usable object. */
  static deserialize(data) {
    return {
      pits:        data.pits,
      store:       data.store,
      currentTurn: data.currentTurn,
      moveCount:   data.moveCount,
      lastMovePit: data.lastMovePit,
      moveHistory: data.moveHistory || [],
      gameOver:    data.gameOver,
      winner:      data.winner,
    };
  }
}

module.exports = AyoEngine;
