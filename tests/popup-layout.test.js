/* Static layout assertions for popup.css. Run: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "popup.css"), "utf8");

function rule(selector) {
  const at = css.indexOf(selector + " {");
  assert.notEqual(at, -1, "missing rule: " + selector);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

function bodyRule() {
  const at = css.indexOf("body {");
  assert.notEqual(at, -1, "missing body rule");
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("body is content-driven (no viewport height/overflow collapse)", () => {
  const r = bodyRule();
  assert.ok(!/height\s*:\s*100dvh/.test(r), "body must not pin height to viewport");
  assert.ok(!/max-height\s*:\s*600px/.test(r), "body must not cap height");
  assert.ok(!/overflow\s*:\s*hidden\s*;/.test(r), "body must not hide overflow");
  assert.match(r, /width\s*:\s*384px/);
  assert.match(r, /overflow-x\s*:\s*hidden/);
});

test(".app has no forced 100% height", () => {
  assert.ok(!/height\s*:\s*100%/.test(rule(".app")), ".app height:100% collapses popup content sizing");
});

test(".list scrolls internally with an explicit max-height", () => {
  const r = rule(".list");
  assert.match(r, /overflow-y\s*:\s*auto/);
  assert.match(r, /max-height\s*:\s*360px/);
  assert.match(r, /min-height\s*:\s*0/);
  assert.match(r, /overscroll-behavior\s*:\s*contain/);
});

test("footer and fixed chrome do not shrink", () => {
  for (const sel of [".header", ".search-wrap", ".footer"]) {
    assert.match(rule(sel), /flex-shrink\s*:\s*0/, sel + " must stay visible");
  }
});

test("drag and glass styles survive the layout fix", () => {
  for (const sel of [".card.dragging", ".card.drag-over", "body.is-sorting .card", ".grip", ".card:hover"]) {
    assert.ok(css.includes(sel), "missing style: " + sel);
  }
  assert.match(css, /backdrop-filter\s*:\s*blur\(24px\)/);
  assert.match(css, /prefers-reduced-motion/);
});
