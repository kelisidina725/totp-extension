(function () {
  'use strict';

  const listEl = document.getElementById('list');
  const badgeEl = document.getElementById('countBadge');
  const searchEl = document.getElementById('searchInput');
  const toastEl = document.getElementById('toast');
  const RING = 37.7;

  let accounts = [];
  let visible = [];
  let lastCodes = {};
  let timer = null;
  let toastTimer = null;

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function splitCode(code) {
    if (!/^\d+$/.test(code)) return code;
    const half = Math.ceil(code.length / 2);
    return code.slice(0, half) + ' ' + code.slice(half);
  }

  const store = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;

  function load() {
    return new Promise((resolve) => {
      if (!store) {
        let data = [];
        try { data = JSON.parse(localStorage.getItem('accounts') || '[]'); } catch (e) { data = []; }
        accounts = Array.isArray(data) ? data : [];
        return resolve();
      }
      store.get({ accounts: [] }, (data) => {
        accounts = Array.isArray(data.accounts) ? data.accounts : [];
        resolve();
      });
    });
  }

  function save() {
    if (!store) {
      try { localStorage.setItem('accounts', JSON.stringify(accounts)); } catch (e) { /* ignore */ }
      return Promise.resolve();
    }
    return new Promise((resolve) => store.set({ accounts }, resolve));
  }

  function render() {
    badgeEl.textContent = String(accounts.length);
    const keyword = searchEl.value.trim().toLowerCase();
    visible = accounts
      .map((account, index) => ({ account, index }))
      .filter(({ account }) => !keyword || (account.name || '').toLowerCase().includes(keyword) || (account.issuer || '').toLowerCase().includes(keyword));

    if (!accounts.length) {
      listEl.innerHTML = '<div class="empty"><strong>还没有账号</strong>点击右上角 ＋ 添加、扫码或用密钥库迁移</div>';
      return;
    }
    if (!visible.length) {
      listEl.innerHTML = '<div class="empty">没有匹配的账号</div>';
      return;
    }
    listEl.innerHTML = visible.map(({ account, index }) => {
      const code = lastCodes[index] || '······';
      const initial = (account.name || '?').trim().charAt(0) || '?';
      return `<div class="card" data-index="${index}" title="点击复制验证码">
        <div class="avatar">${escapeHtml(initial)}</div>
        <div class="meta">
          <div class="name-row">
            <div class="name">${escapeHtml(account.name || '未命名')}</div>
            <div class="row-actions">
              <button class="rename-btn" data-index="${index}" title="重命名">改</button>
              <button class="delete-btn danger" data-index="${index}" title="删除">×</button>
            </div>
          </div>
          <div class="sub">${escapeHtml((account.algorithm || 'SHA1') + ' · ' + (account.digits || 6) + ' 位 · ' + (account.period || 30) + ' 秒')}</div>
        </div>
        <div class="right">
          <div class="code">${escapeHtml(splitCode(code))}</div>
          <div class="timer">
            <svg class="ring" viewBox="0 0 16 16">
              <circle class="track" cx="8" cy="8" r="6"></circle>
              <circle class="progress" cx="8" cy="8" r="6" stroke-dasharray="${RING}" stroke-dashoffset="0"></circle>
            </svg>
            <span class="seconds">—</span>
          </div>
        </div>
      </div>`;
    }).join('');
    tick();
  }

  async function tick() {
    const now = Date.now();
    const cards = listEl.querySelectorAll('.card');
    await Promise.all(visible.map(async ({ account, index }) => {
      try {
        lastCodes[index] = await TOTP.generate(account, now);
      } catch (error) {
        lastCodes[index] = '错误';
      }
    }));
    cards.forEach((card, i) => {
      const { account, index } = visible[i];
      const codeEl = card.querySelector('.code');
      const timerEl = card.querySelector('.timer');
      const ring = card.querySelector('.ring');
      const progress = card.querySelector('.progress');
      const secondsEl = card.querySelector('.seconds');
      const left = TOTP.remaining(account.period, now);
      const total = Number(account.period || 30);
      codeEl.textContent = splitCode(lastCodes[index] || '······');
      secondsEl.textContent = left + 's';
      const expiring = left <= 5;
      codeEl.classList.toggle('expiring', expiring);
      timerEl.classList.toggle('expiring', expiring);
      ring.classList.toggle('expiring', expiring);
      progress.setAttribute('stroke-dashoffset', String(RING * (1 - left / total)));
    });
  }

  async function copyCode(index) {
    const code = lastCodes[index];
    if (!code || code === '错误' || code.includes('·')) return;
    try {
      await navigator.clipboard.writeText(code);
      showToast('已复制 ' + code);
    } catch (error) {
      showToast('复制失败，请手动选择');
    }
  }

  function openManager() {
    chrome.runtime.openOptionsPage();
  }

  listEl.addEventListener('click', async (event) => {
    const renameBtn = event.target.closest('.rename-btn');
    if (renameBtn) {
      event.stopPropagation();
      const index = Number(renameBtn.dataset.index);
      const current = accounts[index].name;
      const next = window.prompt('输入新名称', current);
      if (next === null) return;
      const name = next.trim();
      if (!name) { showToast('名称不能为空'); return; }
      if (name === current) return;
      accounts[index].name = name;
      await save();
      render();
      showToast('已重命名');
      return;
    }
    const deleteBtn = event.target.closest('.delete-btn');
    if (deleteBtn) {
      event.stopPropagation();
      const index = Number(deleteBtn.dataset.index);
      if (!window.confirm(`确定删除「${accounts[index].name}」吗？`)) return;
      accounts.splice(index, 1);
      lastCodes = {};
      await save();
      render();
      return;
    }
    const card = event.target.closest('.card');
    if (card) await copyCode(Number(card.dataset.index));
  });

  searchEl.addEventListener('input', render);
  document.getElementById('settingsBtn').addEventListener('click', openManager);
  document.getElementById('manageBtn').addEventListener('click', openManager);

  load().then(() => {
    render();
    timer = setInterval(tick, 1000);
  });

  window.addEventListener('unload', () => clearInterval(timer));
})();
