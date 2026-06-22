/**
 * 9jaWin Ayo Game – API Client
 * All REST API calls go through this module.
 */

const API_BASE = '/api';

const AyoAPI = {
  /** Get stored access token */
  getToken() {
    return localStorage.getItem('9jawin_token');
  },
  setToken(token) {
    localStorage.setItem('9jawin_token', token);
  },
  getRefreshToken() {
    return localStorage.getItem('9jawin_refresh');
  },
  setRefreshToken(token) {
    localStorage.setItem('9jawin_refresh', token);
  },
  clearAuth() {
    localStorage.removeItem('9jawin_token');
    localStorage.removeItem('9jawin_refresh');
    localStorage.removeItem('9jawin_user');
  },
  getUser() {
    try {
      return JSON.parse(localStorage.getItem('9jawin_user') || 'null');
    } catch { return null; }
  },
  setUser(user) {
    localStorage.setItem('9jawin_user', JSON.stringify(user));
  },

  /** Base fetch with auto token refresh */
  async fetch(path, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {}),
    };
    let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

    if (res.status === 401 && this.getRefreshToken()) {
      // Try to refresh
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.getRefreshToken() }),
      });
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        this.setToken(data.data.accessToken);
        headers.Authorization = 'Bearer ' + data.data.accessToken;
        res = await fetch(`${API_BASE}${path}`, { ...options, headers });
      } else {
        this.clearAuth();
        window.location.href = '/login.html';
        throw new Error('Session expired');
      }
    }
    return res;
  },

  async get(path) {
    const res = await this.fetch(path);
    return res.json();
  },

  async post(path, body) {
    const res = await this.fetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return res.json();
  },

  async patch(path, body) {
    const res = await this.fetch(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return res.json();
  },

  async delete(path) {
    const res = await this.fetch(path, { method: 'DELETE' });
    return res.json();
  },

  // ── Auth ──────────────────────────────────────────────────────
  async register(data) { return this.post('/auth/register', data); },
  async login(data)    { return this.post('/auth/login', data); },
  async logout()       {
    const res = await this.post('/auth/logout', { refreshToken: this.getRefreshToken() });
    this.clearAuth();
    return res;
  },

  // ── Users ─────────────────────────────────────────────────────
  async getMe()           { return this.get('/users/me'); },
  async updateMe(data)    { return this.patch('/users/me', data); },
  async getUser(username) { return this.get(`/users/${username}`); },
  async searchUsers(q)    { return this.get(`/users?q=${encodeURIComponent(q)}`); },
  async getUserHistory(userId) { return this.get(`/users/${userId}/history`); },

  // ── Wallet ────────────────────────────────────────────────────
  async getWallet()       { return this.get('/wallet'); },
  async getTransactions() { return this.get('/wallet/transactions'); },
  async deposit(data)     { return this.post('/wallet/deposit', data); },
  async withdraw(data)    { return this.post('/wallet/withdraw', data); },

  // ── Matches ───────────────────────────────────────────────────
  async getLobby()         { return this.get('/matches'); },
  async createMatch(data)  { return this.post('/matches', data); },
  async joinMatch(data)    { return this.post('/matches/join', data); },
  async getMatch(uuid)     { return this.get(`/matches/${uuid}`); },

  // ── Friends ───────────────────────────────────────────────────
  async getFriends()          { return this.get('/friends'); },
  async sendFriendRequest(username) { return this.post('/friends/request', { username }); },
  async acceptFriend(userId)  { return this.post('/friends/accept', { userId }); },
  async removeFriend(friendId){ return this.delete(`/friends/${friendId}`); },

  // ── Leaderboard ───────────────────────────────────────────────
  async getLeaderboard(period) { return this.get(`/leaderboard/${period}`); },
  async getMyRank(period)      { return this.get(`/leaderboard/me/rank?period=${period}`); },

  // ── Tournaments ───────────────────────────────────────────────
  async getTournaments()        { return this.get('/tournaments'); },
  async getTournament(uuid)     { return this.get(`/tournaments/${uuid}`); },
  async joinTournament(uuid)    { return this.post(`/tournaments/${uuid}/join`, {}); },
  async createTournament(data)  { return this.post('/tournaments', data); },

  // ── Admin ─────────────────────────────────────────────────────
  async adminDashboard()         { return this.get('/admin/dashboard'); },
  async adminUsers(page, search) { return this.get(`/admin/users?page=${page}&search=${encodeURIComponent(search||'')}`); },
  async adminBanUser(id, banned) { return this.patch(`/admin/users/${id}/ban`, { banned }); },
  async adminTransactions(type, status) { return this.get(`/admin/transactions?type=${type||''}&status=${status||''}`); },
  async adminApproveWithdrawal(uuid)    { return this.patch(`/admin/transactions/${uuid}/approve`, {}); },
  async adminRejectWithdrawal(uuid)     { return this.patch(`/admin/transactions/${uuid}/reject`, {}); },
  async adminMatches()           { return this.get('/admin/matches'); },
  async adminCreditWallet(data)  { return this.post('/admin/wallet/credit', data); },
};

// ── Toast Notifications ──────────────────────────────────────────
const Toast = {
  container: null,
  init() {
    if (!document.getElementById('toast-container')) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      document.body.appendChild(this.container);
    } else {
      this.container = document.getElementById('toast-container');
    }
  },
  show(message, type = 'info', duration = 3000) {
    if (!this.container) this.init();
    const toast = document.createElement('div');
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    this.container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'none';
      toast.style.opacity   = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },
  success(m) { this.show(m, 'success'); },
  error(m)   { this.show(m, 'error'); },
  info(m)    { this.show(m, 'info'); },
  warning(m) { this.show(m, 'warning'); },
};

// Initialize on load
Toast.init();

// ── Auth Guard ───────────────────────────────────────────────────
function requireAuth() {
  if (!AyoAPI.getToken()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

function requireGuest() {
  if (AyoAPI.getToken()) {
    window.location.href = '/lobby.html';
    return false;
  }
  return true;
}

// ── Format helpers ───────────────────────────────────────────────
function formatCurrency(amount) {
  return `₦${parseFloat(amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-NG', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Navbar mobile toggle ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.navbar-menu-toggle');
  const nav    = document.querySelector('.navbar-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => nav.classList.toggle('open'));
  }
});
