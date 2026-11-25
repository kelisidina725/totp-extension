(function () {
  'use strict';
  const listEl = document.getElementById('list');
  const badgeEl = document.getElementById('countBadge');
  const searchEl = document.getElementById('searchInput');
  const toastEl = document.getElementById('toast');
  const RING = 37.7;
  const GRIP_SVG = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="3" r="1.3"/><circle cx="11" cy="3" r="1.3"/><circle cx="5" cy="8" r="1.3"/><circle cx="11" cy="8" r="1.3"/><circle cx="5" cy="13" r="1.3"/><circle cx="11" cy="13" r="1.3"/></svg>';

const PEN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';

  let accounts = [];
  let visible = [];
  let lastCodes = {};
  let timer = null;
  let toastTimer = null;

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1400);
  }

  let closing = false;
  function closePopupSoon() {
    if (closing) return;
    closing = true;
    setTimeout(function () { window.close(); }, 120);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function splitCode(code) {
    if (!/^\d+$/.test(code)) return code;
    const half = Math.ceil(code.length / 2);
    return code.slice(0, half) + ' ' + code.slice(half);
  }

  const store = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;

  function load() {
    return new Promise(function (resolve) {
      if (!store) {
        let data = [];
        try { data = JSON.parse(localStorage.getItem('accounts') || '[]'); } catch (e) { data = []; }
        accounts = Array.isArray(data) ? data : [];
        return resolve();
      }
      store.get({ accounts: [] }, function (data) {
        accounts = Array.isArray(data.accounts) ? data.accounts : [];
        resolve();
      });
    });
  }

  function save() {
    if (!store) {
      try { localStorage.setItem('accounts', JSON.stringify(accounts)); } catch (e) { /* ignore */ }
    } else {
      return new Promise(function (resolve) { store.set({ accounts }, resolve); }).then(function () { if (globalThis.FILE_BACKUP) FILE_BACKUP.write(accounts); });
    }
    if (globalThis.FILE_BACKUP) FILE_BACKUP.write(accounts);
    return Promise.resolve();
  }

  function render() {
    badgeEl.textContent = String(accounts.length);
    const keyword = searchEl.value.trim().toLowerCase();
    visible = accounts
      .map(function (account, index) { return { account: account, index: index }; })
      .filter(function (entry) {
        const a = entry.account;
        return !keyword || (a.name || '').toLowerCase().includes(keyword) || (a.issuer || '').toLowerCase().includes(keyword);
      });
    if (!accounts.length) {
      listEl.innerHTML = '<div class="empty"><strong>还没有账号</strong>点击右上角 ＋ 添加、扫码或用密钥库迁移</div>';
      return;
    }
    if (!visible.length) {
      listEl.innerHTML = '<div class="empty">没有匹配的账号</div>';
      return;
    }
    listEl.innerHTML = visible.map(function (entry, vi) {
      const account = entry.account;
      const index = entry.index;
      const code = lastCodes[index] || '······';
      const delay = Math.min(vi * 70, 350);
      return '<div class="card sortable-item" data-index="' + index + '" tabindex="0" style="animation-delay:' + delay + 'ms" title="点击复制验证码">' +
        '<span class="grip drag-handle" title="拖动排序" role="button" aria-label="拖动排序" tabindex="0">' + GRIP_SVG + '</span>' +
        '<div class="meta"><div class="name-row"><div class="name">' + escapeHtml(account.name || '未命名') + '</div>' +
        '<div class="row-actions"><button class="edit-btn" data-index="' + index + '" title="编辑账号">' + PEN_SVG + '</button>' +
        '<button class="delete-btn danger" data-index="' + index + '" title="删除">×</button></div></div>' +
        '<div class="sub">' + escapeHtml((account.algorithm || 'SHA1') + ' · ' + (account.digits || 6) + ' 位 · ' + (account.period || 30) + ' 秒') + '</div></div>' +
        '<div class="right"><div class="code">' + escapeHtml(splitCode(code)) + '</div>' +
        '<div class="timer"><svg class="ring" viewBox="0 0 16 16">' +
        '<circle class="track" cx="8" cy="8" r="6"></circle>' +
        '<circle class="progress" cx="8" cy="8" r="6" stroke-dasharray="' + RING + '" stroke-dashoffset="0"></circle>' +
        '</svg><span class="seconds">—</span></div></div></div>';
    }).join('');
    tick();
  }

  function handleReorder(visFrom, visTo) {
    if (!visible[visFrom] || !visible[visTo]) return;
    const from = visible[visFrom].index;
    const to = visible[visTo].index;
    const codes = accounts.map(function (_, i) { return lastCodes[i]; });
    const newCodes = DRAG_SORT.reorder(codes, from, to);
    accounts = DRAG_SORT.reorder(accounts, from, to);
    const rebuilt = {};
    newCodes.forEach(function (code, i) { if (code !== undefined) rebuilt[i] = code; });
    lastCodes = rebuilt;
    save().then(function () { render(); });
  }

  async function tick() {
    const now = Date.now();
    const cards = listEl.querySelectorAll('.card');
    await Promise.all(visible.map(async function (entry) {
      try {
        lastCodes[entry.index] = await TOTP.generate(entry.account, now);
      } catch (error) {
        lastCodes[entry.index] = '错误';
      }
    }));
    cards.forEach(function (card, i) {
      if (!visible[i]) return;
      const account = visible[i].account;
      const codeEl = card.querySelector('.code');
      const timerEl = card.querySelector('.timer');
      const ring = card.querySelector('.ring');
      const progress = card.querySelector('.progress');
      const secondsEl = card.querySelector('.seconds');
      const left = TOTP.remaining(account.period, now);
      const total = Number(account.period || 30);
      codeEl.textContent = splitCode(lastCodes[visible[i].index] || '······');
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
      closePopupSoon();
    } catch (error) {
      showToast('复制失败，请手动选择');
    }
  }

  function openManager() {
    chrome.runtime.openOptionsPage();
  }

  listEl.addEventListener('click', async function (event) {
    const renameBtn = event.target.closest('.edit-btn');
    if (renameBtn) {
      event.stopPropagation();
      const index = Number(renameBtn.dataset.index);
      const acc = accounts[index];
      const result = await UI_MODAL.editAccount(acc);
      if (!result) return;
      const secretChanged = result.secret !== acc.secret;
      acc.name = result.name;
      acc.issuer = result.issuer;
      acc.secret = result.secret;
      if (secretChanged) delete lastCodes[index];
      await save();
      render();
      showToast('已保存修改');
      return;
    }
    const deleteBtn = event.target.closest('.delete-btn');
    if (deleteBtn) {
      event.stopPropagation();
      const index = Number(deleteBtn.dataset.index);
      if (!await UI_MODAL.confirmAction('确定删除「' + accounts[index].name + '」吗？')) return;
      accounts.splice(index, 1);
      lastCodes = {};
      await save();
      render();
      return;
    }
    const card = event.target.closest('.card');
    if (card) await copyCode(Number(card.dataset.index));
  });

  listEl.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('.edit-btn') || event.target.closest('.delete-btn') || event.target.closest('.grip')) return;
    const card = event.target.closest('.card');
    if (!card) return;
    event.preventDefault();
    copyCode(Number(card.dataset.index));
  });

  searchEl.addEventListener('input', render);
  document.getElementById('settingsBtn').addEventListener('click', openManager);
  document.getElementById('manageBtn').addEventListener('click', openManager);

  load().then(function () {
    DRAG_SORT.attachSortable(listEl, {
      itemSelector: '.card',
      handleSelector: '.card',
      onReorder: handleReorder,
      enabled: function () { return visible.length > 1; }
    });
    render();
    timer = setInterval(tick, 1000);
  });

  window.addEventListener('unload', function () { clearInterval(timer); });
})();
