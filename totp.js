/* TOTP core: RFC 6238 / RFC 4226. Pure functions, usable in browser and Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TOTP = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const HASH_ALGORITHMS = {
    SHA1: 'SHA-1',
    SHA256: 'SHA-256',
    SHA512: 'SHA-512'
  };

  function base32Decode(input) {
    if (typeof input !== 'string') throw new Error('密钥必须是字符串');
    const cleaned = input.toUpperCase().replace(/[\s=-]/g, '');
    if (!cleaned) throw new Error('密钥为空');
    let buffer = 0;
    let bitsLeft = 0;
    const bytes = [];
    for (const char of cleaned) {
      const value = BASE32_ALPHABET.indexOf(char);
      if (value === -1) throw new Error(`密钥包含非法 Base32 字符: ${char}`);
      buffer = (buffer << 5) | value;
      bitsLeft += 5;
      if (bitsLeft >= 8) {
        bitsLeft -= 8;
        bytes.push((buffer >> bitsLeft) & 0xff);
      }
    }
    return new Uint8Array(bytes);
  }

  function getCrypto() {
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) return globalThis.crypto;
    throw new Error('当前环境不支持 Web Crypto API');
  }

  function counterBytes(counter) {
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, Math.floor(counter / 0x100000000), false);
    view.setUint32(4, counter >>> 0, false);
    return bytes;
  }

  function hmacSign(keyBytes, messageBytes, algorithm) {
    const hash = HASH_ALGORITHMS[algorithm] || 'SHA-1';
    return getCrypto().subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash }, false, ['sign']
    ).then((key) => getCrypto().subtle.sign('HMAC', key, messageBytes));
  }

  async function generate(account, timestamp) {
    const secret = account && account.secret;
    const algorithm = (account.algorithm || 'SHA1').toUpperCase();
    const digits = Number(account.digits || 6);
    const period = Number(account.period || 30);
    if (!HASH_ALGORITHMS[algorithm]) throw new Error(`不支持的算法: ${algorithm}`);
    if (!Number.isInteger(digits) || digits < 6 || digits > 9) throw new Error('位数须为 6-9');
    if (!Number.isInteger(period) || period < 1) throw new Error('周期须为正整数');

    const counter = Math.floor((timestamp === undefined ? Date.now() : timestamp) / 1000 / period);
    const signature = new Uint8Array(await hmacSign(base32Decode(secret), counterBytes(counter), algorithm));
    const offset = signature[signature.length - 1] & 0x0f;
    const binary = ((signature[offset] & 0x7f) << 24)
      | (signature[offset + 1] << 16)
      | (signature[offset + 2] << 8)
      | signature[offset + 3];
    const code = (binary >>> 0) % Math.pow(10, digits);
    return String(code).padStart(digits, '0');
  }

  function remaining(period, timestamp) {
    const p = Number(period || 30);
    const seconds = Math.floor((timestamp === undefined ? Date.now() : timestamp) / 1000);
    return p - (seconds % p);
  }

  function normalizeAccount(raw) {
    const account = {
      name: String(raw.name || raw.label || '未命名').trim(),
      issuer: String(raw.issuer || '').trim(),
      secret: String(raw.secret || '').replace(/[\s-]/g, '').toUpperCase(),
      digits: Number(raw.digits || 6),
      period: Number(raw.period || 30),
      algorithm: (raw.algorithm || 'SHA1').toUpperCase()
    };
    if (!account.name) account.name = '未命名';
    if (!account.secret) throw new Error('缺少密钥');
    base32Decode(account.secret);
    if (!HASH_ALGORITHMS[account.algorithm]) throw new Error(`不支持的算法: ${account.algorithm}`);
    if (![6, 7, 8].includes(account.digits)) account.digits = 6;
    if (!Number.isInteger(account.period) || account.period < 1) account.period = 30;
    return account;
  }

  return { base32Decode, generate, remaining, normalizeAccount, HASH_ALGORITHMS };
});
