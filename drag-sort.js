/* Shared list-reordering engine: pure reorder() + attachSortable() via Pointer Events. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DRAG_SORT = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Pure: returns a new array, never mutates the input.
  function reorder(items, from, to) {
    const result = Array.prototype.slice.call(items);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return result;
    if (from < 0 || from >= result.length || to < 0 || to >= result.length || from === to) return result;
    const moved = result.splice(from, 1)[0];
    result.splice(to, 0, moved);
    return result;
  }

  function reducedMotion() {
    try {
      return !!(globalThis.matchMedia && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { return false; }
  }

  function setSortingClass(on) {
    try { if (document.body && document.body.classList) document.body.classList.toggle("is-sorting", on); } catch (e) {}
  }

  function attachSortable(container, options) {
    if (!container) return;
    const config = options || {};
    const itemSelector = config.itemSelector || ".sortable-item";
    const handleSelector = config.handleSelector || itemSelector;
    const onReorder = typeof config.onReorder === "function" ? config.onReorder : function () {};
    const enabled = typeof config.enabled === "function" ? config.enabled : function () { return true; };
    const THRESHOLD = 4;
    const raf = globalThis.requestAnimationFrame || function (fn) { fn(); };
    let drag = null;
    let lastDragEnd = 0;
    let settling = false;

    // Swallow only the synthesized click that follows a real drag.
    try {
      document.addEventListener("click", function (e) {
        if (Date.now() - lastDragEnd < 320) { e.preventDefault(); e.stopPropagation(); }
      }, true);
    } catch (e) {}

    function items() { return Array.prototype.slice.call(container.querySelectorAll(itemSelector)); }

    function clearStyles() {
      items().forEach(function (el) {
        el.classList.remove("dragging", "drag-over");
        el.style.transform = "";
        el.style.transition = "";
        el.style.transitionDelay = "";
        el.style.willChange = "";
      });
    }

    function restoreOrder(order) {
      if (order) order.forEach(function (el) { container.appendChild(el); });
    }

    // Layout viewport-top of an element, immune to any CSS transform (offsetTop is layout-based).
    function layoutTop(el) {
      const base = drag && drag.layoutBase && drag.layoutBase.get(el);
      if (!base) return el.getBoundingClientRect().top;
      const off = el.offsetTop;
      if (typeof base.offset === "number" && typeof off === "number" && isFinite(base.offset) && isFinite(off)) {
        return base.top + (off - base.offset);
      }
      return base.top;
    }

    function posMap(list) {
      const m = new Map();
      list.forEach(function (el) { m.set(el, layoutTop(el)); });
      return m;
    }

    // FLIP: neighbors glide from their old slot to the new one with a wave delay.
    function animateNeighbors(firstTops, movedItem) {
      if (reducedMotion()) return;
      let rank = 0;
      items().forEach(function (el) {
        if (el === movedItem) return;
        const first = firstTops.get(el);
        if (first === undefined) return;
        const delta = first - layoutTop(el);
        if (Math.abs(delta) < 0.5) return;
        const delay = Math.min(60, rank * 30);
        rank++;
        el.style.transition = "none";
        el.style.transitionDelay = "0ms";
        el.style.transform = "translate3d(0," + delta + "px,0)";
        void el.offsetWidth;
        raf(function () {
          el.style.transition = "transform .28s var(--ease) " + delay + "ms";
          el.style.transform = "";
        });
      });
    }

    function removeListeners(state) {
      if (!state) return;
      window.removeEventListener("pointermove", state.onMove);
      window.removeEventListener("pointerup", state.onUp);
      window.removeEventListener("pointercancel", state.onCancel);
    }

    function onMove(event) {
      if (!drag || (drag.pointerId !== null && event.pointerId !== drag.pointerId)) return;
      const dy = event.clientY - drag.startClientY;
      if (!drag.active) {
        if (Math.abs(dy) < THRESHOLD) return;
        drag.active = true;
        drag.item.classList.add("dragging");
        drag.item.style.transition = "none";
        drag.item.style.willChange = "transform";
        setSortingClass(true);
        // Capture the pointer only once a real drag begins so plain clicks still reach the card.
        try { if (container.setPointerCapture) container.setPointerCapture(drag.pointerId); } catch (e) {}
      }
      if (event.cancelable) event.preventDefault();
      const item = drag.item;
      const targetVisualTop = event.clientY - drag.grabOffset;
      const dragCenter = targetVisualTop + drag.itemHeight / 2;
      const all = items();
      const currentIndex = all.indexOf(item);
      const others = all.filter(function (el) { return el !== item; });
      let newIndex = 0;
      for (let i = 0; i < others.length; i++) {
        const other = others[i];
        if (dragCenter > layoutTop(other) + drag.heights.get(other) / 2) newIndex++;
        else break;
      }
      if (newIndex !== currentIndex && currentIndex >= 0) {
        const firstTops = posMap(all);
        reorder(all, currentIndex, newIndex).forEach(function (el) { container.appendChild(el); });
        animateNeighbors(firstTops, item);
        const slot = items().filter(function (el) { return el !== item; })[newIndex];
        if (slot) slot.classList.add("drag-over");
      }
      drag.translateY = targetVisualTop - layoutTop(item);
      const tilt = Math.max(-0.8, Math.min(0.8, dy / 70));
      item.style.transform = "translate3d(0," + drag.translateY + "px,0) scale(1.025) rotate(" + tilt + "deg)";
    }

    function finish(event, commit) {
      if (!drag) return;
      if (event && drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
      const state = drag;
      drag = null; // re-entrancy guard
      removeListeners(state);
      try { if (container.hasPointerCapture && container.hasPointerCapture(state.pointerId)) container.releasePointerCapture(state.pointerId); } catch (e) {}
      const finalIndex = items().indexOf(state.item);
      const wasActive = state.active;
      const shouldCommit = commit && wasActive && finalIndex >= 0 && finalIndex !== state.fromIndex;
      if (!commit) restoreOrder(state.originalOrder);
      setSortingClass(false);
      if (wasActive) {
        lastDragEnd = Date.now();
        settling = true;
        const el = state.item;
        el.classList.remove("dragging");
        el.style.transition = reducedMotion() ? "none" : "transform .22s var(--ease), box-shadow .22s var(--ease)";
        el.style.transform = "translate3d(0,0,0) scale(1)";
        el.style.willChange = "";
        setTimeout(function () {
          clearStyles();
          settling = false;
          if (shouldCommit) onReorder(state.fromIndex, finalIndex);
        }, reducedMotion() ? 0 : 220);
      } else {
        clearStyles();
        settling = false;
        if (shouldCommit) onReorder(state.fromIndex, finalIndex);
      }
    }

    container.addEventListener("pointerdown", function (event) {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      if (drag || settling || !enabled()) return;
      const handle = event.target.closest(handleSelector);
      if (!handle) return;
      const item = handle.closest(itemSelector);
      if (!item || !container.contains(item)) return;
      const all = items();
      if (all.length < 2) return;
      const layoutBase = new Map();
      const heights = new Map();
      all.forEach(function (el) {
        const r = el.getBoundingClientRect();
        layoutBase.set(el, { top: r.top, offset: el.offsetTop });
        heights.set(el, r.height);
      });
      drag = {
        pointerId: event.pointerId,
        item: item,
        startClientY: event.clientY,
        grabOffset: event.clientY - item.getBoundingClientRect().top,
        translateY: 0,
        fromIndex: all.indexOf(item),
        originalOrder: all,
        layoutBase: layoutBase,
        heights: heights,
        itemHeight: heights.get(item),
        active: false,
        onMove: null, onUp: null, onCancel: null
      };
      const s = drag;
      s.onMove = function (e) { onMove(e); };
      s.onUp = function (e) { finish(e, true); };
      s.onCancel = function (e) { finish(e, false); };
      window.addEventListener("pointermove", s.onMove, { passive: false });
      window.addEventListener("pointerup", s.onUp);
      window.addEventListener("pointercancel", s.onCancel);
      // Deliberately NO setPointerCapture here: plain clicks must still reach the card.
    });

    container.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && drag) { event.preventDefault(); finish(null, false); return; }
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      if (drag || settling || !enabled()) return;
      const item = event.target.closest(itemSelector);
      if (!item || !container.contains(item)) return;
      const all = items();
      const from = all.indexOf(item);
      const to = from + (event.key === "ArrowUp" ? -1 : 1);
      if (from < 0 || to < 0 || to >= all.length) return;
      event.preventDefault();
      onReorder(from, to);
    });
  }

  return { reorder: reorder, attachSortable: attachSortable };
});