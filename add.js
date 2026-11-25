(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const GRIP_SVG = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="3" r="1.3"/><circle cx="11" cy="3" r="1.3"/><circle cx="5" cy="8" r="1.3"/><circle cx="11" cy="8" r="1.3"/><circle cx="5" cy="13" r="1.3"/><circle cx="11" cy="13" r="1.3"/></svg>';
const PEN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';

  let accounts = [];
  let visible = [];
  let pendingScan = null;
  let pendingMigrate = [];
  let toastTimer = null;

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2000);
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

  function addAccounts(incoming) {
    const added = [];
    const skipped = [];
    incoming.forEach(function (account) {
      if (accounts.some(function (existing) { return existing.secret === account.secret; })) {
        skipped.push(account.name);
      } else {
        accounts.push(account);
        added.push(account.name);
      }
    });
    return { added: added, skipped: skipped };
  }

  function renderAccounts() {
    $('accountCount').textContent = String(accounts.length);
    const keyword = $('searchInput').value.trim().toLowerCase();
    visible = accounts
      .map(function (account, index) { return { account: account, index: index }; })
      .filter(function (entry) {
        const a = entry.account;
        return !keyword || (a.name || '').toLowerCase().includes(keyword) || (a.issuer || '').toLowerCase().includes(keyword);
      });
    const list = $('accountList');
    if (!accounts.length) { list.innerHTML = '<div class="preview">暂无账号</div>'; return; }
    if (!visible.length) { list.innerHTML = '<div class="preview">没有匹配的账号</div>'; return; }
    list.innerHTML = visible.map(function (entry, vi) {
      const account = entry.account;
      const index = entry.index;
      const delay = Math.min(vi * 60, 360);
      return '<div class="account-row sortable-item" style="animation-delay:' + delay + 'ms">' +
        '<span class="grip drag-handle" title="拖动排序" role="button" aria-label="拖动排序" tabindex="0">' + GRIP_SVG + '</span>' +
        '<div class="info"><div class="name">' + escapeHtml(account.name || '未命名') + '</div>' +
        '<div class="sub">' + escapeHtml(account.algorithm || 'SHA1') + ' · ' + (account.digits || 6) + ' 位 · ' + (account.period || 30) + ' 秒</div></div>' +
        '<span class="code" data-code="' + index + '">······</span>' +
        '<span class="seconds" data-seconds="' + index + '"></span>' +
        '<div class="ops"><button class="icon-btn copy-btn" data-copy="' + index + '" title="复制验证码">⧉</button>' +
        '<button class="icon-btn rename-btn" data-rename="' + index + '" title="编辑账号">' + PEN_SVG + '</button>' +
        '<button class="icon-btn danger delete-btn" data-index="' + index + '" title="删除">×</button></div></div>';
    }).join('');
    tick();
  }

  function handleReorder(visFrom, visTo) {
    if (!visible[visFrom] || !visible[visTo]) return;
    const from = visible[visFrom].index;
    const to = visible[visTo].index;
    accounts = DRAG_SORT.reorder(accounts, from, to);
    save().then(function () { renderAccounts(); });
  }

  async function tick() {
    const now = Date.now();
    await Promise.all(visible.map(async function (entry) {
      try {
        const code = await TOTP.generate(entry.account, now);
        const codeEl = document.querySelector('[data-code="' + entry.index + '"]');
        if (codeEl) codeEl.textContent = splitCode(code);
        entry.account._code = code;
      } catch (error) {
        const codeEl = document.querySelector('[data-code="' + entry.index + '"]');
        if (codeEl) codeEl.textContent = '错误';
        entry.account._code = null;
      }
      const secondsEl = document.querySelector('[data-seconds="' + entry.index + '"]');
      if (secondsEl) secondsEl.textContent = TOTP.remaining(entry.account.period, now) + 's';
    }));
  }

  function setPreview(id, message, type) {
    const el = $(id);
    el.textContent = message;
    el.className = 'preview' + (type ? ' ' + type : '');
  }

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t === tab); });
      document.querySelectorAll('.panel').forEach(function (p) {
        p.classList.toggle('active', p.id === 'panel-' + tab.dataset.tab);
      });
    });
  });

  $('addBtn').addEventListener('click', function () {
    document.querySelector('.tab[data-tab="manual"]').click();
    $('manualForm').elements.name.focus();
  });

  $('toggleSecret').addEventListener('click', function () {
    const input = $('manualForm').elements.secret;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  async function refreshManualPreview() {
    const form = $('manualForm');
    const secret = form.elements.secret.value.trim();
    if (!secret) {
      setPreview('manualPreview', '填写密钥后可预览当前验证码');
      return;
    }
    try {
      const account = TOTP.normalizeAccount({
        name: form.elements.name.value || '预览',
        secret: secret,
        digits: form.elements.digits.value,
        period: form.elements.period.value,
        algorithm: form.elements.algorithm.value
      });
      const code = await TOTP.generate(account);
      setPreview('manualPreview', '当前验证码：' + code + '（剩余 ' + TOTP.remaining(account.period) + ' 秒）', 'ok');
    } catch (error) {
      setPreview('manualPreview', error.message, 'error');
    }
  }

  $('manualForm').addEventListener('input', refreshManualPreview);
  $('manualForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    const form = event.target;
    try {
      const account = TOTP.normalizeAccount({
        name: form.elements.name.value,
        secret: form.elements.secret.value,
        digits: form.elements.digits.value,
        period: form.elements.period.value,
        algorithm: form.elements.algorithm.value
      });
      const result = addAccounts([account]);
      await save();
      renderAccounts();
      showToast(result.added.length ? '已添加「' + account.name + '」' : '该密钥已存在，已跳过');
      form.reset();
      refreshManualPreview();
    } catch (error) {
      setPreview('manualPreview', error.message, 'error');
    }
  });

  function handleDecoded(text) {
    const candidate = OTPAUTH.extractCandidate(text);
    if (!candidate) {
      setPreview('scanPreview', '未识别到 otpauth:// 二维码', 'error');
      return;
    }
    try {
      pendingScan = OTPAUTH.parseUri(candidate);
      if (!pendingScan) throw new Error('不是 TOTP 凭证');
      setPreview('scanPreview', '已识别：' + pendingScan.name + '（' + pendingScan.algorithm + ' · ' + pendingScan.digits + ' 位 · ' + pendingScan.period + ' 秒）', 'ok');
      $('confirmScan').disabled = false;
    } catch (error) {
      setPreview('scanPreview', error.message, 'error');
    }
  }

  function decodeCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height);
    if (!result || !result.data) {
      setPreview('scanPreview', '未在图片中识别出二维码', 'error');
      return;
    }
    handleDecoded(result.data);
  }

  async function decodeImageBlob(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      decodeCanvas(canvas);
    } finally {
      bitmap.close();
    }
  }

  function activateScanTab() {
    const tab = document.querySelector('.tab[data-tab="scan"]');
    if (tab && !tab.classList.contains('active')) tab.click();
  }

  function imageFromItems(items) {
    if (!items) return null;
    for (const item of items) {
      if ((item.type || '').indexOf('image/') === 0) {
        const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
        if (file) return file;
      }
    }
    return null;
  }

  document.addEventListener('paste', function (event) {
    const file = imageFromItems(event.clipboardData && event.clipboardData.items);
    if (!file) return;
    event.preventDefault();
    activateScanTab();
    setPreview('scanPreview', '已粘贴截图，正在识别…');
    decodeImageBlob(file).catch(function (error) { setPreview('scanPreview', '图片解析失败：' + error.message, 'error'); });
  });

  $('pasteBtn').addEventListener('click', async function () {
    setPreview('scanPreview', '正在读取剪贴板…');
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
        throw new Error('当前环境不支持读取剪贴板，请直接按 Ctrl+V 粘贴');
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = (item.types || []).find(function (t) { return t.indexOf('image/') === 0; });
        if (type) {
          const blob = await item.getType(type);
          setPreview('scanPreview', '已读取截图，正在识别…');
          await decodeImageBlob(blob);
          return;
        }
      }
      setPreview('scanPreview', '剪贴板中没有图片，请先复制二维码截图', 'error');
    } catch (error) {
      setPreview('scanPreview', '读取失败：' + error.message, 'error');
    }
  });

  $('imageInput').addEventListener('change', async function (event) {
    const file = event.target.files[0];
    if (!file) return;
    activateScanTab();
    setPreview('scanPreview', '正在识别图片…');
    try {
      await decodeImageBlob(file);
    } catch (error) {
      setPreview('scanPreview', '图片解析失败：' + error.message, 'error');
    }
    event.target.value = '';
  });

  $('confirmScan').addEventListener('click', async function () {
    if (!pendingScan) return;
    const result = addAccounts([pendingScan]);
    await save();
    renderAccounts();
    showToast(result.added.length ? '已添加「' + pendingScan.name + '」' : '该密钥已存在，已跳过');
    pendingScan = null;
    $('confirmScan').disabled = true;
    setPreview('scanPreview', '识别后显示解析结果');
  });

  function parseMigrate() {
    const text = $('migrateText').value.trim();
    if (!text) {
      setPreview('migratePreview', '尚未解析');
      $('confirmMigrate').disabled = true;
      return;
    }
    try {
      const result = OTPAUTH.parseAny(text);
      pendingMigrate = result.accounts;
      const warnings = result.errors.length ? '（跳过 ' + result.errors.length + ' 条无效记录）' : '';
      setPreview('migratePreview', '解析成功：' + result.accounts.length + ' 个账号' + warnings, 'ok');
      $('confirmMigrate').disabled = false;
    } catch (error) {
      pendingMigrate = [];
      setPreview('migratePreview', error.message, 'error');
      $('confirmMigrate').disabled = true;
    }
  }

  $('migrateInput').addEventListener('change', async function (event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      $('migrateText').value = await file.text();
      parseMigrate();
    } catch (error) {
      setPreview('migratePreview', '读取文件失败：' + error.message, 'error');
    }
    event.target.value = '';
  });

  $('migrateText').addEventListener('input', parseMigrate);

  $('confirmMigrate').addEventListener('click', async function () {
    if (!pendingMigrate.length) return;
    const result = addAccounts(pendingMigrate);
    await save();
    renderAccounts();
    showToast('导入完成：新增 ' + result.added.length + '，跳过 ' + result.skipped.length);
    pendingMigrate = [];
    $('confirmMigrate').disabled = true;
  });

  function doExport() {
    const blob = new Blob([JSON.stringify(accounts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'totp-accounts-backup.json';
    link.click();
    URL.revokeObjectURL(url);
  }
  $('exportBtn').addEventListener('click', doExport);
  $('exportBtn2').addEventListener('click', doExport);

  $('importBtn').addEventListener('click', function () { $('importInput').click(); });
  $('importInput').addEventListener('change', async function (event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const result = OTPAUTH.parseAny(await file.text());
      const added = addAccounts(result.accounts);
      await save();
      renderAccounts();
      showToast('导入完成：新增 ' + added.added.length + '，跳过 ' + added.skipped.length);
    } catch (error) {
      showToast('导入失败：' + error.message);
    }
    event.target.value = '';
  });

  $('accountList').addEventListener('click', async function (event) {
    const renameBtn = event.target.closest('button[data-rename]');
    if (renameBtn) {
      const index = Number(renameBtn.dataset.rename);
      const acc = accounts[index];
      const result = await UI_MODAL.editAccount(acc);
      if (!result) return;
      const secretChanged = result.secret !== acc.secret;
      acc.name = result.name;
      acc.issuer = result.issuer;
      acc.secret = result.secret;
      if (secretChanged) acc._code = null;
      await save();
      renderAccounts();
      showToast('已保存修改');
      return;
    }
    const copyBtn = event.target.closest('button[data-copy]');
    if (copyBtn) {
      const index = Number(copyBtn.dataset.copy);
      const code = accounts[index]._code;
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        showToast('已复制 ' + code);
      } catch (error) {
        showToast('复制失败');
      }
      return;
    }
    const deleteBtn = event.target.closest('button[data-index]');
    if (!deleteBtn) return;
    const index = Number(deleteBtn.dataset.index);
    if (!await UI_MODAL.confirmAction('确定删除「' + accounts[index].name + '」吗？')) return;
    accounts.splice(index, 1);
    await save();
    renderAccounts();
    showToast('已删除');
  });

  $('searchInput').addEventListener('input', renderAccounts);

  function refreshBackupStatus() {
    if (!globalThis.FILE_BACKUP) return;
    const label = $('autoBackupStatus');
    const connectBtn = $('autoBackupConnect');
    const reconnectBtn = $('autoBackupReconnect');
    const disconnectBtn = $('autoBackupDisconnect');
    FILE_BACKUP.status().then(function (s) {
      const text = { unsupported: '浏览器不支持自动保存', disconnected: '未设置', connected: '已连接 · 自动保存中', 'needs-reconnect': '需重新连接' }[s] || s;
      label.textContent = text;
      label.className = "auto-backup-status " + (s === "connected" ? "connected" : (s === "needs-reconnect" ? "needs-reconnect" : ""));
      const supported = FILE_BACKUP.isSupported();
      connectBtn.hidden = !supported || s !== "disconnected";
      reconnectBtn.hidden = !supported || s !== "needs-reconnect";
      disconnectBtn.hidden = !supported || (s !== "connected" && s !== "needs-reconnect");
    });
  }

  $('autoBackupConnect').addEventListener('click', function () {
    if (!FILE_BACKUP) return;
    FILE_BACKUP.connect().then(function (r) {
      showToast(r === 'connected' ? '自动保存位置已设置' : (r === 'cancelled' ? '已取消' : '设置失败'));
      refreshBackupStatus();
      if (r === 'connected') FILE_BACKUP.write(accounts);
    });
  });
  $('autoBackupReconnect').addEventListener('click', function () {
    if (!FILE_BACKUP) return;
    FILE_BACKUP.reconnect().then(function (r) {
      showToast(r === 'connected' ? '已重新连接' : '重新连接失败');
      refreshBackupStatus();
      if (r === 'connected') FILE_BACKUP.write(accounts);
    });
  });
  $('autoBackupDisconnect').addEventListener('click', function () {
    if (!FILE_BACKUP) return;
    FILE_BACKUP.disconnect().then(function () {
      showToast('已断开自动保存');
      refreshBackupStatus();
    });
  });

  load().then(function () {
    DRAG_SORT.attachSortable($('accountList'), {
      itemSelector: '.account-row',
      handleSelector: '.account-row',
      onReorder: handleReorder,
      enabled: function () { return visible.length > 1; }
    });
    renderAccounts();
    refreshManualPreview();
    refreshBackupStatus();
  });
  setInterval(tick, 1000);
})();
