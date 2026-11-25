/* Static assertions for copy-to-close behavior in popup.js. Run: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
const add = fs.readFileSync(path.join(__dirname, "..", "add.js"), "utf8");

function bodyOf(fnName) {
  const at = popup.indexOf("function " + fnName);
  assert.notEqual(at, -1, "missing function: " + fnName);
  const open = popup.indexOf("{", at);
  let depth = 0;
  let close = -1;
  for (let i = open; i < popup.length; i++) {
    if (popup[i] === "{") depth++;
    else if (popup[i] === "}") { depth--; if (depth === 0) { close = i; break; } }
  }
  assert.notEqual(close, -1, "unbalanced braces: " + fnName);
  return popup.slice(open + 1, close);
}

test("copyCode closes the popup only after a successful clipboard write", () => {
  const body = bodyOf("copyCode");
  const writeAt = body.indexOf("clipboard.writeText");
  assert.notEqual(writeAt, -1, "clipboard.writeText missing");
  const closeAt = body.indexOf("closePopupSoon()");
  assert.notEqual(closeAt, -1, "successful copy must schedule close");
  assert.ok(closeAt > writeAt, "close must come after clipboard write");
  const catchAt = body.indexOf("catch (");
  assert.notEqual(catchAt, -1, "catch branch missing");
  const catchBody = body.slice(catchAt);
  assert.ok(!catchBody.includes("window.close"), "failure must not close popup");
  assert.ok(!catchBody.includes("closePopupSoon"), "failure must not schedule close");
});

test("closePopupSoon delays close and guards against double scheduling", () => {
  const body = bodyOf("closePopupSoon");
  assert.match(body, /if \(closing\) return/);
  assert.match(body, /setTimeout\(function \(\) \{ window\.close\(\); \}, 120\)/);
});

test("invalid code returns before any close scheduling", () => {
  const body = bodyOf("copyCode");
  const tryAt = body.indexOf("try {");
  const closeAt = body.indexOf("closePopupSoon()");
  assert.notEqual(tryAt, -1);
  assert.ok(closeAt > tryAt, "only valid codes may schedule close");
  assert.match(body.slice(0, tryAt), /return;/);
});

test("options page copy never closes the tab", () => {
  assert.ok(!add.includes("window.close"), "add.js must not call window.close");
});

test("Enter/Space on a focused card copies through the same path", () => {
  const at = popup.indexOf("addEventListener('keydown'");
  assert.notEqual(at, -1, "keydown delegation missing");
  const kd = popup.slice(at);
  assert.match(kd, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(kd, /event\.target\.closest\('\.edit-btn'\)/);
  assert.match(kd, /event\.target\.closest\('\.delete-btn'\)/);
  assert.match(kd, /event\.target\.closest\('\.grip'\)/);
  assert.match(kd, /copyCode\(Number\(card\.dataset\.index\)\)/);
});
