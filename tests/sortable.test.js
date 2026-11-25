/* Tests for reorder() + attachSortable(). Run: node --test --test-isolation=none tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { reorder, attachSortable } = require("../drag-sort.js");

// ---------- pure reorder() ----------
test("reorder moves an item from head to tail", () => {
  const input = ["a", "b", "c", "d"];
  assert.deepEqual(reorder(input, 0, 3), ["b", "c", "d", "a"]);
  assert.deepEqual(input, ["a", "b", "c", "d"], "input is never mutated");
});
test("reorder moves an item from tail to head", () => {
  assert.deepEqual(reorder(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
});
test("reorder handles adjacent swaps in both directions", () => {
  assert.deepEqual(reorder([1, 2, 3], 0, 1), [2, 1, 3]);
  assert.deepEqual(reorder([1, 2, 3], 2, 1), [1, 3, 2]);
});
test("reorder ignores no-op, out-of-range and non-integer indices", () => {
  const input = [1, 2, 3];
  assert.deepEqual(reorder(input, 1, 1), input);
  assert.deepEqual(reorder(input, -1, 0), input);
  assert.deepEqual(reorder(input, 0, 9), input);
  assert.deepEqual(reorder(input, 0.5, 1), input);
  assert.notStrictEqual(reorder(input, 0, 1), input, "always returns a new array");
});
test("reorder keeps single-element arrays intact", () => {
  assert.deepEqual(reorder(["only"], 0, 0), ["only"]);
  assert.deepEqual(reorder([], 0, 0), []);
});

// ---------- minimal DOM / PointerEvent doubles ----------
function installDom() {
  const winL = {}, docL = {};
  function target(store) {
    return {
      addEventListener(t, f) { (store[t] || (store[t] = [])).push(f); },
      removeEventListener(t, f) { store[t] = (store[t] || []).filter(x => x !== f); },
      dispatch(t, e) { (store[t] || []).slice().forEach(f => f(e)); }
    };
  }
  globalThis.window = target(winL);
  globalThis.document = Object.assign(target(docL), { body: { classList: { toggle() {} } } });
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = fn => fn();
  return { win: target(winL), doc: target(docL) };
}

function row(id, top) {
  return {
    id, _top: top, _h: 44,
    get offsetTop() { return this._top; },
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); } },
    style: {},
    getBoundingClientRect() { return { top: this._top, height: this._h }; },
    closest(sel) { return sel === ".row" ? this : null; }
  };
}

function makeList(rows) {
  const children = [];
  const c = {
    children, _captures: 0,
    addEventListener(t, f) { if (t === "pointerdown") c._down = f; if (t === "keydown") c._key = f; },
    removeEventListener() {},
    setPointerCapture() { c._captures++; }, hasPointerCapture() { return false; }, releasePointerCapture() {},
    querySelectorAll(sel) { return sel === ".row" ? children.slice() : []; },
    contains(el) { return children.indexOf(el) >= 0; },
    appendChild(el) {
      const i = children.indexOf(el);
      if (i >= 0) children.splice(i, 1);
      children.push(el);
      children.forEach((x, idx) => { x._top = idx * 44; });
    }
  };
  rows.forEach(r => c.appendChild(r));
  return c;
}

function pointerDown(c, item, y) {
  c._down({
    pointerId: 1, button: 0, pointerType: "mouse", clientY: y, cancelable: true,
    target: { closest: sel => item.closest(sel) }, preventDefault() {}
  });
}
function pointer(type, y) {
  return { type, pointerId: 1, clientY: y, cancelable: true, preventDefault() {} };
}
const settle = () => new Promise(res => setTimeout(res, 260));

// ---------- attachSortable interaction ----------
test("attachSortable: dragging the card body from first to last fires onReorder(0,2)", async () => {
  const dom = installDom();
  const rows = [row("a", 0), row("b", 44), row("c", 88)];
  const list = makeList(rows);
  const calls = [];
  attachSortable(list, { itemSelector: ".row", onReorder: (f, t) => calls.push([f, t]) });
  pointerDown(list, rows[0], 22);
  dom.win.dispatch("pointermove", pointer("pointermove", 130));
  dom.win.dispatch("pointerup", pointer("pointerup", 130));
  assert.deepEqual(calls, [], "commit is deferred until the settle animation finishes");
  await settle();
  assert.deepEqual(calls, [[0, 2]]);
  assert.deepEqual(list.children.map(r => r.id), ["b", "c", "a"]);
});

test("attachSortable: plain click never captures the pointer so click-to-copy still works", () => {
  const dom = installDom();
  const rows = [row("a", 0), row("b", 44)];
  const list = makeList(rows);
  attachSortable(list, { itemSelector: ".row", onReorder() {} });
  pointerDown(list, rows[0], 22);
  dom.win.dispatch("pointermove", pointer("pointermove", 23));
  dom.win.dispatch("pointerup", pointer("pointerup", 23));
  assert.equal(list._captures, 0, "no pointer capture on a plain click");
});

test("attachSortable: sub-threshold movement does not reorder", () => {
  const dom = installDom();
  const rows = [row("a", 0), row("b", 44)];
  const list = makeList(rows);
  const calls = [];
  attachSortable(list, { itemSelector: ".row", onReorder: (f, t) => calls.push([f, t]) });
  pointerDown(list, rows[0], 22);
  dom.win.dispatch("pointermove", pointer("pointermove", 24));
  dom.win.dispatch("pointerup", pointer("pointerup", 24));
  assert.deepEqual(calls, []);
  assert.deepEqual(list.children.map(r => r.id), ["a", "b"]);
});

test("attachSortable: pointercancel restores order without commit", () => {
  const dom = installDom();
  const rows = [row("a", 0), row("b", 44), row("c", 88)];
  const list = makeList(rows);
  const calls = [];
  attachSortable(list, { itemSelector: ".row", onReorder: (f, t) => calls.push([f, t]) });
  pointerDown(list, rows[0], 22);
  dom.win.dispatch("pointermove", pointer("pointermove", 130));
  dom.win.dispatch("pointercancel", pointer("pointercancel", 130));
  assert.deepEqual(calls, []);
  assert.deepEqual(list.children.map(r => r.id), ["a", "b", "c"]);
});

test("attachSortable: Escape restores order without commit", () => {
  installDom();
  const rows = [row("a", 0), row("b", 44), row("c", 88)];
  const list = makeList(rows);
  const calls = [];
  attachSortable(list, { itemSelector: ".row", onReorder: (f, t) => calls.push([f, t]) });
  pointerDown(list, rows[0], 22);
  list._key({ key: "Escape", preventDefault() {} });
  assert.deepEqual(calls, []);
  assert.deepEqual(list.children.map(r => r.id), ["a", "b", "c"]);
});

test("attachSortable: Alt+ArrowDown keyboard fallback reorders", () => {
  installDom();
  const rows = [row("a", 0), row("b", 44), row("c", 88)];
  const list = makeList(rows);
  const calls = [];
  attachSortable(list, { itemSelector: ".row", onReorder: (f, t) => calls.push([f, t]) });
  list._key({ key: "ArrowDown", altKey: true, target: rows[0], preventDefault() {} });
  assert.deepEqual(calls, [[0, 1]]);
});

test("visible-to-full index mapping persists the correct global order", () => {
  const accounts = [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }];
  const visible = [accounts[1], accounts[3]];
  const fullFrom = accounts.indexOf(visible[0]); // 1 (B)
  const fullTo = accounts.indexOf(visible[1]);   // 3 (D)
  const result = reorder(accounts, fullFrom, fullTo);
  assert.deepEqual(result.map(a => a.name), ["A", "C", "D", "B"]);
  assert.deepEqual(accounts.map(a => a.name), ["A", "B", "C", "D"], "source unchanged");
});