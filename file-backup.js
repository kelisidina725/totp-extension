/* FILE_BACKUP — persist an accounts JSON backup into a user-chosen folder (File System Access API). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FILE_BACKUP = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DB_NAME = "totp-backup";
  const STORE = "handles";
  const KEY = "accountsDir";
  const FILE_NAME = "totp-accounts.json";
  const DEBOUNCE_MS = 400;
  let dirHandle = null;
  let timer = null;
  let pending = null;

  function isSupported() {
    return typeof indexedDB !== "undefined" && typeof globalThis.showDirectoryPicker === "function";
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbSet(handle) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(handle, KEY);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbDelete() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(KEY);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getHandle() {
    if (dirHandle) return Promise.resolve(dirHandle);
    if (!isSupported()) return Promise.resolve(null);
    return idbGet().then(function (h) { dirHandle = h; return h; }).catch(function () { return null; });
  }

  function perm(handle, mode) {
    if (typeof handle.queryPermission !== "function") return Promise.resolve("granted");
    return handle.queryPermission({ mode: mode }).catch(function () { return "prompt"; });
  }

  function status() {
    if (!isSupported()) return Promise.resolve("unsupported");
    return getHandle().then(function (h) {
      if (!h) return "disconnected";
      return perm(h, "readwrite").then(function (p) { return p === "granted" ? "connected" : "needs-reconnect"; });
    });
  }

  function connect() {
    if (!isSupported()) return Promise.resolve("unsupported");
    return globalThis.showDirectoryPicker({ mode: "readwrite" }).then(function (h) {
      dirHandle = h;
      return idbSet(h).then(function () { return "connected"; });
    }).catch(function (e) {
      if (e && e.name === "AbortError") return "cancelled";
      return "error";
    });
  }

  function reconnect() {
    return getHandle().then(function (h) {
      if (!h) return connect();
      if (typeof h.requestPermission !== "function") return Promise.resolve("connected");
      return h.requestPermission({ mode: "readwrite" }).then(function (p) {
        return p === "granted" ? "connected" : "denied";
      }).catch(function () { return "denied"; });
    });
  }

  function disconnect() {
    dirHandle = null;
    if (timer) { clearTimeout(timer); timer = null; }
    pending = null;
    if (!isSupported()) return Promise.resolve();
    return idbDelete().catch(function () {});
  }

  function doWrite(accounts) {
    return getHandle().then(function (h) {
      if (!h) return "disconnected";
      return perm(h, "readwrite").then(function (p) {
        if (p !== "granted") return "needs-reconnect";
        return h.getFileHandle(FILE_NAME, { create: true })
          .then(function (fh) { return fh.createWritable(); })
          .then(function (writable) {
            return writable.write(JSON.stringify(accounts, null, 2)).then(function () { return writable.close(); });
          })
          .then(function () { return "written"; })
          .catch(function () { return "error"; });
      });
    }).catch(function () { return "error"; });
  }

  // Debounced: coalesce rapid changes into a single full-snapshot write.
  function write(accounts) {
    pending = accounts;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      const snap = pending;
      pending = null;
      if (snap) doWrite(snap);
    }, DEBOUNCE_MS);
  }

  return {
    isSupported: isSupported,
    connect: connect,
    reconnect: reconnect,
    disconnect: disconnect,
    status: status,
    write: write,
    FILE_NAME: FILE_NAME
  };
});