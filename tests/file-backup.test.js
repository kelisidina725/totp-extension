/* Tests for file-backup.js: static wiring + functional write with stubs. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
function read(f) { return fs.readFileSync(path.join(ROOT, f), "utf8"); }

test("file-backup.js exports API and fixed relative filename", () => {
  const FB = require("../file-backup.js");
  ["isSupported", "connect", "reconnect", "disconnect", "status", "write"].forEach(function (k) {
    assert.equal(typeof FB[k], "function", k + " must be a function");
  });
  assert.equal(FB.FILE_NAME, "totp-accounts.json");
});

test("no hardcoded absolute user path", () => {
  const src = read("file-backup.js");
  assert.equal(src.indexOf("C:\\Users") === -1, true, "no hardcoded C:\\Users");
  assert.equal(src.indexOf("totp-accounts.json") !== -1, true);
});

test("write() debounces, checks permission, writes full JSON snapshot", async () => {
  const written = [];
  let closed = 0;
  const fakeFileHandle = { createWritable: async function () {
    return { write: async function (text) { written.push(text); }, close: async function () { closed++; } };
  } };
  const fakeDir = {
    queryPermission: async function () { return "granted"; },
    requestPermission: async function () { return "granted"; },
    getFileHandle: async function (name, opts) {
      assert.equal(name, "totp-accounts.json");
      assert.deepEqual(opts, { create: true });
      return fakeFileHandle;
    }
  };
  function req(result) {
    const r = {};
    setTimeout(function () { r.result = result; if (r.onsuccess) r.onsuccess(); }, 0);
    return r;
  }
  globalThis.indexedDB = { open: function () {
    const r = {};
    setTimeout(function () {
      r.result = {
        objectStoreNames: { contains: function () { return true; } },
        transaction: function () {
          return { objectStore: function () { return { get: function () { return req(fakeDir); } }; } };
        }
      };
      if (r.onsuccess) r.onsuccess();
    }, 0);
    return r;
  } };
  globalThis.showDirectoryPicker = function () { return Promise.resolve(fakeDir); };
  delete require.cache[require.resolve("../file-backup.js")];
  const FB = require("../file-backup.js");
  FB.write([{ name: "A", secret: "S1" }, { name: "B", secret: "S2" }]);
  FB.write([{ name: "A", secret: "S1" }]);
  await new Promise(function (r) { setTimeout(r, 600); });
  assert.equal(written.length, 1, "only the last snapshot should be written once");
  assert.equal(closed, 1);
  assert.equal(JSON.parse(written[0])[0].name, "A");
  delete globalThis.indexedDB;
  delete globalThis.showDirectoryPicker;
});

test("add.js and popup.js call FILE_BACKUP.write after storage save", () => {
  assert.equal(/FILE_BACKUP\.write\(accounts\)/.test(read("add.js")), true);
  assert.equal(/FILE_BACKUP\.write\(accounts\)/.test(read("popup.js")), true);
});

test("both HTML pages load file-backup.js before the page script", () => {
  assert.equal(/file-backup\.js[\s\S]*popup\.js/.test(read("popup.html")), true);
  assert.equal(/file-backup\.js[\s\S]*add\.js/.test(read("add.html")), true);
});

test("add page exposes auto-backup controls and wiring", () => {
  const ah = read("add.html");
  ["autoBackupStatus", "autoBackupConnect", "autoBackupReconnect", "autoBackupDisconnect"].forEach(function (id) {
    assert.equal(ah.indexOf(id) !== -1, true, id + " exists");
  });
  const aj = read("add.js");
  ["refreshBackupStatus", "FILE_BACKUP.connect", "FILE_BACKUP.reconnect", "FILE_BACKUP.disconnect"].forEach(function (s) {
    assert.equal(aj.indexOf(s) !== -1, true, s + " wired");
  });
});