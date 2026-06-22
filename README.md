# 🎮 9jaWin – Multiplayer Ayo Olopon Game

A complete production-ready multiplayer **Ayo Olopon (Nigerian Mancala)** game platform.

## ✨ Features

| Category | Features |
|----------|----------|
| 🎮 **Game Engine** | Authentic Nigerian Ayo Olopon rules · Anti-clockwise sowing · Capture mechanics · Grand slam prevention · Server-side validation |
| 👥 **Multiplayer** | Real-time Socket.IO · Live board sync · 30s turn timer · Auto-skip · Disconnect handling |
| 💰 **Wallet** | Deposits · Withdrawals · Match rewards (80% to winner) · Tournament prizes · Transaction history |
| 🏆 **Tournaments** | Admin-created · Entry fees · Prize pools (70% distributed) · Configurable winners |
| 🎯 **Game Modes** | Free matches · Money matches · Public/Private rooms · Room codes |
| 🤝 **Social** | Friend system · In-game chat · Online status · Match history |
| 📊 **Leaderboard** | Daily/Weekly/Monthly/All-time · Win rate · Earnings |
| 🔐 **Auth** | JWT + Refresh tokens · bcrypt · Avatar upload · User profiles |
| 🛡️ **Admin Panel** | Dashboard · User management · Withdrawal approvals · Wallet crediting |
| 🌐 **WordPress SSO** | Single sign-on · User sync · API authentication |
| 🐳 **Docker** | Dockerfile + docker-compose · MySQL 8 · Health checks |

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MySQL 8.0+

### Installation

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your DB credentials and JWT secrets

# Initialize database
npm run db:init

# Start server
npm start
```

Open **http://localhost:3000**

### Docker

```bash
cp .env.example .env
# Edit secrets in .env
docker-compose up -d
docker-compose exec app npm run db:init
```

## 🏗 Project Structure

```
├── server.js                   # Main Express + Socket.IO server
├── src/
│   ├── game/AyoEngine.js       # Ayo Olopon game logic
│   ├── socket/gameSocket.js    # Real-time game handler
│   ├── routes/                 # REST API routes
│   └── middleware/             # Auth middleware
├── database/
│   ├── schema.sql              # MySQL schema (13 tables)
│   └── init.js                 # DB initialization
└── frontend/
    ├── *.html                  # All pages
    ├── css/style.css           # Dark mode, wooden board theme
    └── js/                     # API client + game client
```

## 🎮 Ayo Olopon Rules

- **Board:** 12 pits (6 per player), 4 seeds each (48 total)
- **Movement:** Anti-clockwise sowing
- **Capture:** Last seed lands on opponent's side in pit with 2-3 seeds
- **Grand Slam:** Cannot capture all opponent seeds if alternatives exist
- **Win:** Player with most seeds when game ends wins (24+ to win)

## 🔌 Socket.IO Events

| Client → Server | Description |
|-----------------|-------------|
| `game:join` | Join match room |
| `game:move` | Make a move `{ pitIndex }` |
| `game:chat` | Send message |
| `game:resign` | Resign match |

| Server → Client | Description |
|-----------------|-------------|
| `game:state` | Full game state |
| `game:move` | Move result |
| `game:over` | Game ended |
| `game:turn_timer` | Timer countdown |
| `game:chat` | Chat message |

## 💰 Revenue Model

- **Money Match:** Winner gets 80%, platform keeps 20%
- **Tournament:** Platform keeps 30%, 70% distributed to winners
- **Draw:** Players each get 80% of entry fee back

## 🔐 Default Admin

After `npm run db:init`:
- **Email:** `admin@9jawin.com`  
- **Password:** `Admin@9jaWin2024!`
- **Panel:** http://localhost:3000/admin.html

> ⚠️ Change admin password immediately after first login!

## 🌐 WordPress SSO

Set `SSO_ENABLED=true` and `WP_SECRET_KEY` in `.env`.

POST to `/api/wp/sso` with:
```json
{
  "wp_token": "HMAC-SHA256(secret, 'userid:email')",
  "wp_user_id": 123,
  "email": "user@example.com",
  "username": "player1",
  "display_name": "Player One"
}
```

## 📄 License

MIT – Built with ❤️ for Nigerian gamers 🇳🇬
