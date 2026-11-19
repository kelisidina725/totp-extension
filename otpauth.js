/* Parsers for otpauth:// URIs and legacy .neustorage JSON files. */
(function (root, factory) {
  const TOTP = (typeof module === 'object' && module.exports)
    ? require('./totp.js') : root.TOTP;
  const api = factory(TOTP);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OTPAUTH = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (TOTP) {
  'use strict';

  function parseUri(text) {
    const raw = String(text || '').trim();
    if (!/^otpauth:\/\//i.test(raw)) return null;
    const url = new URL(raw);
    const type = url.hostname.toLowerCase();
    if (type !== 'totp' && type !== 'hotp') return null;

    const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const slash = label.indexOf(':');
    const issuerFromLabel = slash > 0 ? label.slice(0, slash) : '';
    const name = slash > 0 ? label.slice(slash + 1) : label;
    const params = url.searchParams;
    const account = {
      name: name,
      issuer: params.get('issuer') || issuerFromLabel,
      secret: params.get('secret') || '',
      digits: Number(params.get('digits') || 6),
      period: Number(params.get('period') || 30),
      algorithm: (params.get('algorithm') || 'SHA1').toUpperCase()
    };
    if (type === 'hotp') return null;
    return TOTP.normalizeAccount(account);
  }

  function parseNeustorage(text) {
    let payload;
    try {
      payload = JSON.parse(String(text));
    } catch (error) {
      throw new Error('不是合法的 JSON 文件');
    }
    const list = Array.isArray(payload) ? payload : (Array.isArray(payload.accounts) ? payload.accounts : null);
    if (!list) throw new Error('文件中未找到账号列表');
    const accounts = [];
    const errors = [];
    list.forEach((item, index) => {
      try {
        accounts.push(TOTP.normalizeAccount(item));
      } catch (error) {
        errors.push(`第 ${index + 1} 条: ${error.message}`);
      }
    });
    if (!accounts.length) throw new Error('没有可导入的账号' + (errors.length ? '\n' + errors.join('\n') : ''));
    return { accounts, errors };
  }

  function extractCandidate(text) {
    const value = String(text || '').trim();
    if (/^otpauth:\/\//i.test(value)) return value;
    const match = value.match(/otpauth:\/\/[^\s"'<>]+/i);
    return match ? match[0] : null;
  }

  function parseAny(text) {
    const value = String(text || '').trim();
    if (!value) throw new Error('内容为空');
    if (value.startsWith('[') || value.startsWith('{')) {
      return parseNeustorage(value);
    }
    const candidates = [];
    value.split(/\r?\n/).forEach((line) => {
      const candidate = extractCandidate(line);
      if (candidate) candidates.push(candidate);
    });
    if (!candidates.length) throw new Error('未识别到 otpauth:// 凭证或 JSON 账号列表');

    const accounts = [];
    const errors = [];
    candidates.forEach((candidate, index) => {
      try {
        const account = parseUri(candidate);
        if (!account) throw new Error('不是 TOTP 凭证');
        accounts.push(account);
      } catch (error) {
        errors.push(`第 ${index + 1} 条: ${error.message}`);
      }
    });
    if (!accounts.length) throw new Error('没有可导入的账号\n' + errors.join('\n'));
    return { accounts, errors };
  }

  return { parseUri, parseNeustorage, parseAny, extractCandidate };
});
