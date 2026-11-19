/* RFC 6238 standard vectors + parser tests. Run: node --test tests/*.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const TOTP = require('../totp.js');
const OTPAUTH = require('../otpauth.js');

function base32Encode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = Buffer.from(text, 'ascii');
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(value >> bits) & 31];
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

const VECTORS = [
  { time: 59, sha1: '94287082', sha256: '46119246', sha512: '90693936' },
  { time: 1111111109, sha1: '07081804', sha256: '68084774', sha512: '25091201' },
  { time: 1111111111, sha1: '14050471', sha256: '67062674', sha512: '99943326' },
  { time: 1234567890, sha1: '89005924', sha256: '91819424', sha512: '93441116' },
  { time: 2000000000, sha1: '69279037', sha256: '90698825', sha512: '38618901' },
  { time: 20000000000, sha1: '65353130', sha256: '77737706', sha512: '47863826' }
];
const SECRETS = {
  SHA1: base32Encode('12345678901234567890'),
  SHA256: base32Encode('12345678901234567890123456789012'),
  SHA512: base32Encode('1234567890123456789012345678901234567890123456789012345678901234')
};

test('RFC 6238 standard vectors (8 digits, 30s period)', async () => {
  for (const vector of VECTORS) {
    for (const algorithm of Object.keys(SECRETS)) {
      const code = await TOTP.generate({
        secret: SECRETS[algorithm],
        algorithm,
        digits: 8,
        period: 30
      }, vector.time * 1000);
      assert.equal(code, vector[algorithm.toLowerCase()], `${algorithm} @ ${vector.time}`);
    }
  }
});

test('default 6-digit output is derived from 8-digit code', async () => {
  const account = { secret: SECRETS.SHA1, digits: 6, period: 30, algorithm: 'SHA1' };
  const code = await TOTP.generate(account, 59 * 1000);
  assert.equal(code, '287082');
  assert.equal(code.length, 6);
});

test('Base32 decoding handles padding, lowercase and spaces', () => {
  const withPadding = Array.from(TOTP.base32Decode(SECRETS.SHA256));
  const lowerSpaced = Array.from(TOTP.base32Decode(SECRETS.SHA256.toLowerCase().replace(/(.{4})/g, '$1 ').trim()));
  assert.deepEqual(lowerSpaced, withPadding);
  assert.throws(() => TOTP.base32Decode('ABC1'), /非法 Base32/);
});

test('remaining seconds stay within period', () => {
  for (const time of [0, 29, 30, 59, 60, 1111111109]) {
    const left = TOTP.remaining(30, time * 1000);
    assert.ok(left >= 1 && left <= 30, `time ${time} -> ${left}`);
  }
});

test('normalizeAccount fills defaults and rejects invalid keys', () => {
  const account = TOTP.normalizeAccount({ name: ' DOG ', secret: 'ljfd qucwgrcegnkz', digits: 9, period: 0 });
  assert.equal(account.name, 'DOG');
  assert.equal(account.secret, 'LJFDQUCWGRCEGNKZ');
  assert.equal(account.digits, 6);
  assert.equal(account.period, 30);
  assert.equal(account.algorithm, 'SHA1');
  assert.throws(() => TOTP.normalizeAccount({ secret: '!!!' }));
});

test('otpauth URI parsing', () => {
  const account = OTPAUTH.parseUri(
    'otpauth://totp/GitHub:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GitHub&algorithm=SHA256&digits=8&period=60'
  );
  assert.equal(account.name, 'alice');
  assert.equal(account.issuer, 'GitHub');
  assert.equal(account.algorithm, 'SHA256');
  assert.equal(account.digits, 8);
  assert.equal(account.period, 60);
  assert.equal(OTPAUTH.parseUri('otpauth://hotp/x?secret=ABC'), null);
  assert.equal(OTPAUTH.extractCandidate('前缀 otpauth://totp/x?secret=ABC 后缀'), 'otpauth://totp/x?secret=ABC');
});

test('.neustorage JSON import', () => {
  const json = JSON.stringify([
    { name: 'DOG', secret: 'LJFDQUCWGRCEGNKZ', digits: 6, period: 30, algorithm: 'SHA1' },
    { name: 'broken', secret: '???' }
  ]);
  const result = OTPAUTH.parseNeustorage(json);
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].name, 'DOG');
  assert.equal(result.errors.length, 1);
  assert.throws(() => OTPAUTH.parseNeustorage('not json'), /合法的 JSON/);
});

test('通用导入：单行 otpauth 凭证文本（其他工具导出）', () => {
  const exported = 'otpauth://totp/GitHub:kelisidina725?secret=47YINUZ5LJNF46O4&issuer=GitHub';
  const result = OTPAUTH.parseAny(exported);
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].name, 'kelisidina725');
  assert.equal(result.accounts[0].issuer, 'GitHub');
  assert.equal(result.accounts[0].secret, '47YINUZ5LJNF46O4');
  assert.equal(result.errors.length, 0);
});

test('通用导入：多行凭证与混杂文本', () => {
  const text = [
    '导出的凭证：',
    'otpauth://totp/GitHub:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GitHub',
    '',
    'otpauth://totp/GitLab:bob?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8&period=60&algorithm=SHA256',
    'otpauth://hotp/legacy?secret=ABC'
  ].join('\n');
  const result = OTPAUTH.parseAny(text);
  assert.equal(result.accounts.length, 2);
  assert.equal(result.accounts[1].digits, 8);
  assert.equal(result.accounts[1].period, 60);
  assert.equal(result.accounts[1].algorithm, 'SHA256');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /第 3 条/);
});

test('通用导入：JSON 凭证仍可解析，无效内容报错', () => {
  const json = JSON.stringify([{ name: 'DOG', secret: 'LJFDQUCWGRCEGNKZ' }]);
  assert.equal(OTPAUTH.parseAny(json).accounts.length, 1);
  assert.throws(() => OTPAUTH.parseAny('随便一段文字'), /未识别到/);
  assert.throws(() => OTPAUTH.parseAny('   '), /内容为空/);
});
