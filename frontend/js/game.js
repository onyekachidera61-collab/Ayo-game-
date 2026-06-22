/**
 * 9jaWin Ayo Game – Socket.IO Game Client
 * Handles real-time board updates, moves, chat, and timers.
 */

class AyoGameClient {
  constructor() {
    this.socket      = null;
    this.matchUuid   = null;
    this.gameState   = null;
    this.players     = [];
    this.mySeat      = null;
    this.validMoves  = [];
    this.timerInterval = null;
    this.secondsLeft   = 30;
  }

  init(matchUuid) {
    this.matchUuid = matchUuid;
    const token = AyoAPI.getToken();
    if (!token) {
      window.location.href = '/login.html';
      return;
    }

    this.socket = io({ auth: { token } });

    this.socket.on('connect', ()       => this.onConnect());
    this.socket.on('disconnect', ()    => this.onDisconnect());
    this.socket.on('connect_error', e  => this.onConnectError(e));
    this.socket.on('game:state',    d  => this.onGameState(d));
    this.socket.on('game:move',     d  => this.onMove(d));
    this.socket.on('game:over',     d  => this.onGameOver(d));
    this.socket.on('game:turn_timer', d => this.onTimer(d));
    this.socket.on('game:chat',     d  => this.onChat(d));
    this.socket.on('game:error',    d  => Toast.error(d.message));
    this.socket.on('game:player_joined',       d => this.onPlayerJoined(d));
    this.socket.on('game:player_disconnected', d => this.onPlayerDisconnected(d));
    this.socket.on('game:player_reconnected',  d => this.onPlayerReconnected(d));
  }

  onConnect() {
    console.log('Socket connected');
    this.socket.emit('game:join', { matchUuid: this.matchUuid });
    this.updateConnectionStatus('connected');
  }

  onDisconnect() {
    this.updateConnectionStatus('disconnected');
    Toast.warning('Connection lost. Reconnecting...');
  }

  onConnectError(err) {
    console.error('Socket error:', err);
    this.updateConnectionStatus('error');
    Toast.error('Connection failed: ' + err.message);
  }

  onGameState(data) {
    this.gameState  = data.state;
    this.players    = data.players;
    this.mySeat     = data.yourSeat;
    this.validMoves = data.validMoves || [];

    this.renderBoard();
    this.renderPlayers();
    this.updateValidMoves();
  }

  onMove(data) {
    this.gameState  = data.state;
    this.validMoves = data.validMoves || [];

    this.renderBoard(data.pitIndex);
    this.updateValidMoves();
    this.updatePlayerStrips();

    if (data.auto) {
      Toast.info(`⏱ Turn auto-skipped for ${data.seat === this.mySeat ? 'you' : 'opponent'}`);
    }
  }

  onGameOver(data) {
    this.clearTimer();
    this.validMoves = [];
    this.updateValidMoves();

    const myUser = AyoAPI.getUser();
    const iWon   = !data.isDraw && data.winnerUserId === myUser?.id;
    const isDraw = data.isDraw;

    this.showCelebration(iWon, isDraw, data);
  }

  onTimer({ secondsLeft }) {
    this.secondsLeft = secondsLeft;
    this.updateTimerUI(secondsLeft);
  }

  onChat(data) {
    this.appendChatMessage(data);
  }

  onPlayerJoined(data) {
    Toast.info(`${data.username} joined the match`);
    this.updatePlayerStrips();
  }

  onPlayerDisconnected(data) {
    Toast.warning(`${data.username} disconnected`);
    this.setPlayerOffline(data.seat);
  }

  onPlayerReconnected(data) {
    Toast.success(`${data.username} reconnected`);
    this.setPlayerOnline(data.seat);
  }

  // ── Rendering ─────────────────────────────────────────────────
  renderBoard(lastMovePit = null) {
    if (!this.gameState) return;

    const pits   = this.gameState.pits;
    const store  = this.gameState.store;
    const myTurn = this.gameState.currentTurn === this.mySeat;

    // Update pit cells
    for (let i = 0; i < 12; i++) {
      const el = document.getElementById(`pit-${i}`);
      if (!el) continue;
      el.className = 'pit';
      el.innerHTML = '';

      // Seed count
      const countEl = document.createElement('div');
      countEl.className = 'pit-count';
      countEl.textContent = pits[i];
      el.appendChild(countEl);

      // Visual seeds (up to 12 shown)
      const seedsEl = document.createElement('div');
      seedsEl.className = 'pit-seeds';
      const show = Math.min(pits[i], 12);
      for (let s = 0; s < show; s++) {
        const seed = document.createElement('div');
        seed.className = 'seed';
        seedsEl.appendChild(seed);
      }
      el.appendChild(seedsEl);

      if (lastMovePit === i) el.classList.add('last-moved');
    }

    // Stores
    const s0 = document.getElementById('store-p1');
    const s1 = document.getElementById('store-p2');
    if (s0) s0.textContent = store[0];
    if (s1) s1.textContent = store[1];

    // Turn indicator
    const turnEl = document.getElementById('turn-indicator');
    if (turnEl) {
      if (myTurn) {
        turnEl.textContent = '🟢 Your Turn';
        turnEl.style.color = 'var(--success)';
      } else {
        turnEl.textContent = "⏳ Opponent's Turn";
        turnEl.style.color = 'var(--text-muted)';
      }
    }
  }

  renderPlayers() {
    if (!this.players.length) return;
    this.players.forEach(p => {
      const strip = document.getElementById(`player-strip-${p.seat}`);
      if (!strip) return;
      const nameEl = strip.querySelector('.player-name');
      const avEl   = strip.querySelector('.player-avatar');
      if (nameEl) nameEl.textContent = p.display_name || p.username;
      if (avEl) {
        if (p.avatar) {
          avEl.innerHTML = `<img src="${p.avatar}" alt="">`;
        } else {
          avEl.textContent = (p.username || '?')[0].toUpperCase();
        }
      }
    });
  }

  updatePlayerStrips() {
    if (!this.gameState) return;
    document.querySelectorAll('.player-strip').forEach(el => {
      const seat = parseInt(el.dataset.seat || '0');
      el.classList.toggle('active', this.gameState.currentTurn === seat);
      const capEl = el.querySelector('.player-captured');
      if (capEl) capEl.textContent = `Seeds: ${this.gameState.store[seat]}`;
    });
  }

  updateValidMoves() {
    // Clear all valid classes first
    for (let i = 0; i < 12; i++) {
      const el = document.getElementById(`pit-${i}`);
      if (el) {
        el.classList.remove('valid');
        el.onclick = null;
      }
    }

    if (this.mySeat === null || !this.gameState) return;
    const isMyTurn = this.gameState.currentTurn === this.mySeat;
    if (!isMyTurn || this.gameState.gameOver) return;

    this.validMoves.forEach(pitIdx => {
      const el = document.getElementById(`pit-${pitIdx}`);
      if (el) {
        el.classList.add('valid');
        el.onclick = () => this.makeMove(pitIdx);
      }
    });
  }

  makeMove(pitIndex) {
    if (!this.socket) return;
    this.socket.emit('game:move', { pitIndex });
  }

  resign() {
    if (!this.socket) return;
    if (!confirm('Are you sure you want to resign?')) return;
    this.socket.emit('game:resign');
  }

  sendChat(message) {
    if (!message.trim() || !this.socket) return;
    this.socket.emit('game:chat', { message });
  }

  // ── Timer ─────────────────────────────────────────────────────
  updateTimerUI(seconds) {
    const progress = document.getElementById('timer-progress');
    const count    = document.getElementById('timer-count');
    if (!progress || !count) return;

    const pct = (seconds / 30) * 100;
    progress.style.width = pct + '%';
    count.textContent = seconds + 's';

    progress.className = 'timer-progress';
    if (seconds <= 5)       progress.classList.add('danger');
    else if (seconds <= 10) progress.classList.add('warning');
  }

  clearTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // ── Chat ──────────────────────────────────────────────────────
  appendChatMessage({ username, message, ts }) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const myUser = AyoAPI.getUser();
    const isOwn  = username === myUser?.username;

    const div = document.createElement('div');
    div.className = `chat-msg${isOwn ? ' own' : ''}`;
    div.innerHTML = `<span class="chat-user">${username}:</span> ${escapeHtml(message)}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  // ── Celebration ───────────────────────────────────────────────
  showCelebration(iWon, isDraw, data) {
    // Remove existing overlay
    const existing = document.getElementById('celebration-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id        = 'celebration-overlay';
    overlay.className = 'celebration-overlay';

    let title, subtitle;
    if (isDraw) {
      title    = '🤝 Draw!';
      subtitle = 'It\'s a tie! Good game!';
    } else if (iWon) {
      title    = '🏆 You Win!';
      subtitle = `Seeds: ${data.store ? data.store[this.mySeat] : '?'} | Well played! 🎉`;
      this.launchConfetti();
    } else {
      title    = '😔 You Lost';
      subtitle = 'Better luck next time!';
    }

    overlay.innerHTML = `
      <div class="celebration-card">
        <div class="celebration-title">${title}</div>
        <p style="margin:1rem 0;color:var(--text-muted)">${subtitle}</p>
        <div style="display:flex;gap:1rem;justify-content:center;margin-top:1.5rem">
          <a href="/lobby.html" class="btn btn-primary">Play Again</a>
          <a href="/lobby.html" class="btn btn-ghost">Lobby</a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove();
    });
  }

  launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = Array.from({ length: 120 }, () => ({
      x:  Math.random() * canvas.width,
      y:  Math.random() * canvas.height - canvas.height,
      r:  Math.random() * 8 + 3,
      d:  Math.random() * 5 + 2,
      color: ['#f0a500','#e94560','#2ecc71','#3498db','#9b59b6'][Math.floor(Math.random()*5)],
      tilt: Math.floor(Math.random()*10) - 10,
    }));

    let angle = 0;
    let frame = 0;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      angle += 0.01;
      pieces.forEach(p => {
        ctx.beginPath();
        ctx.lineWidth = p.r / 2;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r / 3, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r);
        ctx.stroke();
        p.y += p.d;
        p.x += Math.sin(angle + p.r) * 2;
        if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
      });
      if (++frame < 200) requestAnimationFrame(draw);
      else canvas.remove();
    }
    requestAnimationFrame(draw);
  }

  // ── Helpers ───────────────────────────────────────────────────
  updateConnectionStatus(status) {
    const el = document.getElementById('connection-status');
    if (!el) return;
    const map = {
      connected:    { text: '● Connected',    color: 'var(--success)' },
      disconnected: { text: '● Disconnected', color: 'var(--danger)' },
      error:        { text: '● Error',        color: 'var(--danger)' },
    };
    const s = map[status] || map.error;
    el.textContent = s.text;
    el.style.color = s.color;
  }

  setPlayerOffline(seat) {
    const strip = document.getElementById(`player-strip-${seat}`);
    if (strip) strip.style.opacity = '0.5';
  }
  setPlayerOnline(seat) {
    const strip = document.getElementById(`player-strip-${seat}`);
    if (strip) strip.style.opacity = '1';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// Global instance
window.gameClient = new AyoGameClient();
