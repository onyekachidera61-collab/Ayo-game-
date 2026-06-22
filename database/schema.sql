-- =============================================================
-- 9jaWin Ayo Game - Complete MySQL Database Schema
-- =============================================================

CREATE DATABASE IF NOT EXISTS `9jawin_ayo`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `9jawin_ayo`;

-- ---------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid        VARCHAR(36)  NOT NULL UNIQUE,
  username    VARCHAR(50)  NOT NULL UNIQUE,
  email       VARCHAR(255) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) DEFAULT NULL,
  bio         TEXT         DEFAULT NULL,
  avatar      VARCHAR(500) DEFAULT NULL,
  role        ENUM('player','admin') NOT NULL DEFAULT 'player',
  is_online   TINYINT(1)   NOT NULL DEFAULT 0,
  is_banned   TINYINT(1)   NOT NULL DEFAULT 0,
  last_seen   DATETIME     DEFAULT NULL,
  wp_user_id  INT UNSIGNED DEFAULT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email      (email),
  INDEX idx_username   (username),
  INDEX idx_role       (role),
  INDEX idx_is_online  (is_online),
  INDEX idx_wp_user_id (wp_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- REFRESH TOKENS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  token      VARCHAR(512) NOT NULL UNIQUE,
  expires_at DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_token   (token(255)),
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- WALLETS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL UNIQUE,
  balance    DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  locked     DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- TRANSACTIONS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid        VARCHAR(36)  NOT NULL UNIQUE,
  user_id     INT UNSIGNED NOT NULL,
  type        ENUM('deposit','withdrawal','match_entry','match_reward','tournament_entry','tournament_reward','refund') NOT NULL,
  amount      DECIMAL(15,2) NOT NULL,
  balance_before DECIMAL(15,2) NOT NULL,
  balance_after  DECIMAL(15,2) NOT NULL,
  reference   VARCHAR(255) DEFAULT NULL,
  description TEXT         DEFAULT NULL,
  status      ENUM('pending','completed','failed','reversed') NOT NULL DEFAULT 'completed',
  metadata    JSON         DEFAULT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id   (user_id),
  INDEX idx_type      (type),
  INDEX idx_status    (status),
  INDEX idx_created   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- MATCHES
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid           VARCHAR(36)  NOT NULL UNIQUE,
  room_code      VARCHAR(10)  NOT NULL UNIQUE,
  type           ENUM('free','money','tournament') NOT NULL DEFAULT 'free',
  visibility     ENUM('public','private') NOT NULL DEFAULT 'public',
  status         ENUM('waiting','active','completed','cancelled','abandoned') NOT NULL DEFAULT 'waiting',
  entry_fee      DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  prize_pool     DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  platform_fee   DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  winner_id      INT UNSIGNED DEFAULT NULL,
  is_draw        TINYINT(1)   NOT NULL DEFAULT 0,
  tournament_id  INT UNSIGNED DEFAULT NULL,
  created_by     INT UNSIGNED NOT NULL,
  started_at     DATETIME     DEFAULT NULL,
  completed_at   DATETIME     DEFAULT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (winner_id)  REFERENCES users(id),
  INDEX idx_status      (status),
  INDEX idx_type        (type),
  INDEX idx_room_code   (room_code),
  INDEX idx_tournament  (tournament_id),
  INDEX idx_created_by  (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- MATCH PLAYERS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_players (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_id   INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  seat       TINYINT UNSIGNED NOT NULL COMMENT '0=player1, 1=player2',
  score      INT UNSIGNED NOT NULL DEFAULT 0,
  seeds_captured INT UNSIGNED NOT NULL DEFAULT 0,
  joined_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_match_seat (match_id, seat),
  UNIQUE KEY uq_match_user (match_id, user_id),
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id),
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- AYO GAMES (detailed game state)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ayo_games (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_id        INT UNSIGNED NOT NULL UNIQUE,
  board_state     JSON NOT NULL COMMENT '12-element array of pit counts',
  store_p1        INT UNSIGNED NOT NULL DEFAULT 0,
  store_p2        INT UNSIGNED NOT NULL DEFAULT 0,
  current_turn    TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=player1, 1=player2',
  move_count      INT UNSIGNED NOT NULL DEFAULT 0,
  last_move_pit   TINYINT DEFAULT NULL,
  last_move_time  DATETIME DEFAULT NULL,
  move_history    JSON NOT NULL DEFAULT (JSON_ARRAY()),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- USER STATISTICS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_stats (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        INT UNSIGNED NOT NULL UNIQUE,
  games_played   INT UNSIGNED NOT NULL DEFAULT 0,
  games_won      INT UNSIGNED NOT NULL DEFAULT 0,
  games_lost     INT UNSIGNED NOT NULL DEFAULT 0,
  games_drawn    INT UNSIGNED NOT NULL DEFAULT 0,
  total_earnings DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  win_streak     INT UNSIGNED NOT NULL DEFAULT 0,
  best_streak    INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- TOURNAMENTS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournaments (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid             VARCHAR(36)   NOT NULL UNIQUE,
  name             VARCHAR(255)  NOT NULL,
  description      TEXT          DEFAULT NULL,
  entry_fee        DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  prize_pool       DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  platform_fee     DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  max_players      INT UNSIGNED  NOT NULL DEFAULT 16,
  num_winners      INT UNSIGNED  NOT NULL DEFAULT 3,
  status           ENUM('upcoming','registration','active','completed','cancelled') NOT NULL DEFAULT 'upcoming',
  start_date       DATETIME      NOT NULL,
  end_date         DATETIME      NOT NULL,
  registration_end DATETIME      NOT NULL,
  winner_distribution JSON       DEFAULT NULL,
  created_by       INT UNSIGNED  NOT NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_status     (status),
  INDEX idx_start_date (start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- TOURNAMENT PLAYERS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournament_players (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tournament_id  INT UNSIGNED NOT NULL,
  user_id        INT UNSIGNED NOT NULL,
  status         ENUM('registered','active','eliminated','winner') NOT NULL DEFAULT 'registered',
  placement      INT UNSIGNED DEFAULT NULL,
  prize_received DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  joined_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tournament_user (tournament_id, user_id),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)       REFERENCES users(id),
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- REWARDS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewards (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid          VARCHAR(36)   NOT NULL UNIQUE,
  user_id       INT UNSIGNED  NOT NULL,
  match_id      INT UNSIGNED  DEFAULT NULL,
  tournament_id INT UNSIGNED  DEFAULT NULL,
  type          ENUM('match_win','tournament_placement') NOT NULL,
  amount        DECIMAL(15,2) NOT NULL,
  status        ENUM('pending','distributed','failed') NOT NULL DEFAULT 'pending',
  distributed_at DATETIME DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)       REFERENCES users(id),
  FOREIGN KEY (match_id)      REFERENCES matches(id),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
  INDEX idx_user_id (user_id),
  INDEX idx_status  (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  type       VARCHAR(50)  NOT NULL,
  title      VARCHAR(255) NOT NULL,
  message    TEXT         NOT NULL,
  data       JSON         DEFAULT NULL,
  is_read    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_is_read (is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- FRIENDSHIPS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friendships (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  friend_id  INT UNSIGNED NOT NULL,
  status     ENUM('pending','accepted','blocked') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_friendship (user_id, friend_id),
  FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_friend_id (friend_id),
  INDEX idx_status    (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- MESSAGES (in-game chat)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_id   INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  content    TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id),
  INDEX idx_match_id (match_id),
  INDEX idx_created  (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- LEADERBOARDS (cached / periodic snapshots)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leaderboards (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  period       ENUM('daily','weekly','monthly','all_time') NOT NULL,
  period_key   VARCHAR(20)  NOT NULL COMMENT 'e.g. 2024-01-15, 2024-W03, 2024-01',
  games_played INT UNSIGNED NOT NULL DEFAULT 0,
  games_won    INT UNSIGNED NOT NULL DEFAULT 0,
  win_rate     DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  earnings     DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  rank         INT UNSIGNED DEFAULT NULL,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_leaderboard (user_id, period, period_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_period     (period, period_key),
  INDEX idx_rank       (period, period_key, rank)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------
-- SEED DEFAULT ADMIN (password: Admin@9jaWin2024!)
-- ---------------------------------------------------------------
INSERT INTO users (uuid, username, email, password, display_name, role)
VALUES (
  UUID(),
  'admin',
  'admin@9jawin.com',
  '$2a$12$LqOIGjq/ZoNMoaSZaF0Zv.q6Fq5rVKjIJxFAIOH2B3wA0bHkJ3VQC',
  '9jaWin Admin',
  'admin'
) ON DUPLICATE KEY UPDATE role='admin';

-- Create wallet for admin
INSERT INTO wallets (user_id, balance)
SELECT id, 0.00 FROM users WHERE email='admin@9jawin.com'
ON DUPLICATE KEY UPDATE balance=balance;

-- Create stats for admin
INSERT INTO user_stats (user_id)
SELECT id FROM users WHERE email='admin@9jawin.com'
ON DUPLICATE KEY UPDATE games_played=games_played;
