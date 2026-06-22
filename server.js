/**
 * 9jaWin Multiplayer Ayo Game – Main Server
 */
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const path       = require('path');
const cors       = require('cors');
const helmet     = require('helmet');
const { Server } = require('socket.io');

const { registerSocketHandlers } = require('./src/socket/gameSocket');
const { apiLimiter }             = require('./src/middleware/rateLimiter');

// ── Routes ────────────────────────────────────────────────────────
const authRoutes        = require('./src/routes/auth');
const userRoutes        = require('./src/routes/users');
const walletRoutes      = require('./src/routes/wallet');
const matchRoutes       = require('./src/routes/matches');
const friendRoutes      = require('./src/routes/friends');
const leaderboardRoutes = require('./src/routes/leaderboard');
const tournamentRoutes  = require('./src/routes/tournaments');
const adminRoutes       = require('./src/routes/admin');

const app    = express();
const server = http.createServer(app);

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000').split(',').map(o => o.trim());

// ── Socket.IO ────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Socket CORS not allowed for: ' + origin));
      }
    },
    methods:     ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout:  60000,
  pingInterval: 25000,
});

registerSocketHandlers(io);

// ── Security / Middleware ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'cdn.socket.io'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc:    ["'self'", 'fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'wss:', 'ws:'],
    },
  },
}));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed for origin: ' + origin));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files (rate-limited in each router; static assets served directly)
app.use(express.static(path.join(__dirname, 'frontend')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API Routes ───────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/users',       userRoutes);
app.use('/api/wallet',      walletRoutes);
app.use('/api/matches',     matchRoutes);
app.use('/api/friends',     friendRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/admin',       adminRoutes);

// WordPress SSO endpoint
app.post('/api/wp/sso', require('./src/routes/wpSso'));

// ── Health check ─────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', ts: new Date().toISOString() });
});

// ── SPA fallback (rate-limited to prevent path traversal abuse) ───
app.get('*', apiLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

// ── Start ─────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000');
server.listen(PORT, () => {
  console.log(`🎮 9jaWin Ayo Game server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});
