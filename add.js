(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
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
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
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

  function addAccounts(incoming) {
    const added = [];
    const skipped = [];
    incoming.forEach((account) => {
      if (accounts.some((existing) => existing.secret === account.secret)) {
        skipped.push(account.name);
      } else {
        accounts.push(account);
        added.push(account.name);
      }
    });
    return { added, skipped };
  }

  function renderAccounts() {
    $('accountCount').textContent = String(accounts.length);
    const keyword = $('searchInput').value.trim().toLowerCase();
    visible = accounts
      .map((account, index) => ({ account, index }))
      .filter(({ account }) => !keyword || (account.name || '').toLowerCase().includes(keyword) || (account.issuer || '').toLowerCase().includes(keyword));

    const list = $('accountList');
    if (!accounts.length) {
      list.innerHTML = '<div class="preview">暂无账号</div>';
      return;
    }
    if (!visible.length) {
      list.innerHTML = '<div class="preview">没有匹配的账号</div>';
      return;
    }
    list.innerHTML = visible.map(({ account, index }) => {
      const initial = (account.name || '?').trim().charAt(0) || '?';
      return `<div class="account-row">
        <div class="avatar">${escapeHtml(initial)}</div>
        <div class="info">
          <div class="name">${escapeHtml(account.name)}</div>
          <div class="sub">${escapeHtml(account.algorithm)} · ${account.digits} 位 · ${account.period} 秒</div>
        </div>
        <span class="code" data-code="${index}">······</span>
        <span class="seconds" data-seconds="${index}"></span>
        <div class="ops">
          <button class="icon-btn copy-btn" data-copy="${index}" title="复制验证码">⧉</button>
          <button class="icon-btn rename-btn" data-rename="${index}" title="重命名">✎</button>
          <button class="icon-btn danger delete-btn" data-index="${index}" title="删除">×</button>
        </div>
      </div>`;
    }).join('');
    tick();
  }

  async function tick() {
    const now = Date.now();
    await Promise.all(visible.map(async ({ account, index }) => {
      try {
        const code = await TOTP.generate(account, now);
        const codeEl = document.querySelector(`[data-code="${index}"]`);
        if (codeEl) codeEl.textContent = splitCode(code);
        account._code = code;
      } catch (error) {
        const codeEl = document.querySelector(`[data-code="${index}"]`);
        if (codeEl) codeEl.textContent = '错误';
        account._code = null;
      }
      const secondsEl = document.querySelector(`[data-seconds="${index}"]`);
      if (secondsEl) secondsEl.textContent = TOTP.remaining(account.period, now) + 's';
    }));
  }

  function setPreview(id, message, type) {
    const el = $(id);
    el.textContent = message;
    el.className = 'preview' + (type ? ' ' + type : '');
  }

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.panel').forEach((p) => {
        p.classList.toggle('active', p.id === 'panel-' + tab.dataset.tab);
      });
    });
  });

  $('addBtn').addEventListener('click', () => {
    document.querySelector('.tab[data-tab="manual"]').click();
    $('manualForm').elements.name.focus();
  });

  $('toggleSecret').addEventListener('click', () => {
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
        secret,
        digits: form.elements.digits.value,
        period: form.elements.period.value,
        algorithm: form.elements.algorithm.value
      });
      const code = await TOTP.generate(account);
      setPreview('manualPreview', `当前验证码：${code}（剩余 ${TOTP.remaining(account.period)} 秒）`, 'ok');
    } catch (error) {
      setPreview('manualPreview', error.message, 'error');
    }
  }

  $('manualForm').addEventListener('input', refreshManualPreview);
  $('manualForm').addEventListener('submit', async (event) => {
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
      showToast(result.added.length ? `已添加「${account.name}」` : '该密钥已存在，已跳过');
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
      setPreview('scanPreview', `已识别：${pendingScan.name}（${pendingScan.algorithm} · ${pendingScan.digits} 位 · ${pendingScan.period} 秒）`, 'ok');
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

  // 主路径：复制截图后直接 Ctrl+V，无需任何额外权限
  document.addEventListener('paste', (event) => {
    const file = imageFromItems(event.clipboardData && event.clipboardData.items);
    if (!file) return;
    event.preventDefault();
    activateScanTab();
    setPreview('scanPreview', '已粘贴截图，正在识别…');
    decodeImageBlob(file).catch((error) => setPreview('scanPreview', `图片解析失败：${error.message}`, 'error'));
  });

  // 辅助：点击按钮主动读取剪贴板图片
  $('pasteBtn').addEventListener('click', async () => {
    setPreview('scanPreview', '正在读取剪贴板…');
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
        throw new Error('当前环境不支持读取剪贴板，请直接按 Ctrl+V 粘贴');
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = (item.types || []).find((t) => t.indexOf('image/') === 0);
        if (type) {
          const blob = await item.getType(type);
          setPreview('scanPreview', '已读取截图，正在识别…');
          await decodeImageBlob(blob);
          return;
        }
      }
      setPreview('scanPreview', '剪贴板中没有图片，请先复制二维码截图', 'error');
    } catch (error) {
      setPreview('scanPreview', `读取剪贴板失败：${error.message}`, 'error');
    }
  });

  $('imageInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      setPreview('scanPreview', '正在识别图片…');
      await decodeImageBlob(file);
    } catch (error) {
      setPreview('scanPreview', `图片解析失败：${error.message}`, 'error');
    }
    event.target.value = '';
  });

  $('confirmScan').addEventListener('click', async () => {
    if (!pendingScan) return;
    const result = addAccounts([pendingScan]);
    await save();
    renderAccounts();
    showToast(result.added.length ? `已添加「${pendingScan.name}」` : '该密钥已存在，已跳过');
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
      const warnings = result.errors.length ? `（跳过 ${result.errors.length} 条无效记录）` : '';
      setPreview('migratePreview', `解析成功：${result.accounts.length} 个账号${warnings}`, 'ok');
      $('confirmMigrate').disabled = false;
    } catch (error) {
      pendingMigrate = [];
      setPreview('migratePreview', error.message, 'error');
      $('confirmMigrate').disabled = true;
    }
  }

  $('migrateInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      $('migrateText').value = await file.text();
      parseMigrate();
    } catch (error) {
      setPreview('migratePreview', `读取文件失败：${error.message}`, 'error');
    }
    event.target.value = '';
  });

  $('migrateText').addEventListener('input', parseMigrate);

  $('confirmMigrate').addEventListener('click', async () => {
    if (!pendingMigrate.length) return;
    const result = addAccounts(pendingMigrate);
    await save();
    renderAccounts();
    showToast(`导入完成：新增 ${result.added.length}，跳过 ${result.skipped.length}`);
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

  $('importBtn').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const result = OTPAUTH.parseAny(await file.text());
      const added = addAccounts(result.accounts);
      await save();
      renderAccounts();
      showToast(`导入完成：新增 ${added.added.length}，跳过 ${added.skipped.length}`);
    } catch (error) {
      showToast(`导入失败：${error.message}`);
    }
    event.target.value = '';
  });

  $('accountList').addEventListener('click', async (event) => {
    const renameBtn = event.target.closest('button[data-rename]');
    if (renameBtn) {
      const index = Number(renameBtn.dataset.rename);
      const current = accounts[index].name;
      const next = window.prompt('输入新名称', current);
      if (next === null) return;
      const name = next.trim();
      if (!name) { showToast('名称不能为空'); return; }
      if (name === current) return;
      accounts[index].name = name;
      await save();
      renderAccounts();
      showToast(`已重命名为「${name}」`);
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
    if (!window.confirm(`确定删除「${accounts[index].name}」吗？`)) return;
    accounts.splice(index, 1);
    await save();
    renderAccounts();
    showToast('已删除');
  });

  $('searchInput').addEventListener('input', renderAccounts);

  load().then(() => {
    renderAccounts();
    refreshManualPreview();
  });
  setInterval(tick, 1000);
})();
