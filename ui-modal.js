(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UI_MODAL = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  // Open a self-contained glass modal. inner(modalEl, finish) builds content;
  // finish(value) closes and resolves the promise. Escape / backdrop => null/false.
  function open(inner) {
    return new Promise(function (resolve) {
      const backdrop = el("div", "modal-backdrop");
      const modal = el("div", "modal");
      backdrop.appendChild(modal);
      let done = false;
      function finish(value) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        resolve(value);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); finish(null); }
      }
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) finish(null);
      });
      document.addEventListener("keydown", onKey);
      inner(modal, finish);
      document.body.appendChild(backdrop);
    });
  }

  function field(labelText, value, type) {
    const wrap = el("label", "field");
    wrap.appendChild(el("span", "field-label", labelText));
    const input = document.createElement("input");
    input.type = type || "text";
    input.className = "field-input";
    input.value = value === undefined || value === null ? "" : String(value);
    input.autocomplete = "off";
    input.spellcheck = false;
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  // Resolve to {name, issuer, secret} or null when cancelled.
  function editAccount(account) {
    const acc = account || {};
    return open(function (modal, finish) {
      modal.appendChild(el("h2", "modal-title", "编辑账号"));
      const nameF = field("名称", acc.name || "");
      const issuerF = field("发行方（可选）", acc.issuer || "");
      const secretF = field("密钥", acc.secret || "", "text");
      modal.appendChild(nameF.wrap);
      modal.appendChild(issuerF.wrap);
      modal.appendChild(secretF.wrap);
      const err = el("p", "modal-error");
      modal.appendChild(err);
      const actions = el("div", "modal-actions");
      const cancel = el("button", "btn btn-ghost", "取消");
      cancel.type = "button";
      const save = el("button", "btn btn-primary", "保存");
      save.type = "button";
      actions.appendChild(cancel);
      actions.appendChild(save);
      modal.appendChild(actions);
      cancel.addEventListener("click", function () { finish(null); });
      save.addEventListener("click", function () {
        const name = nameF.input.value.trim();
        const issuer = issuerF.input.value.trim();
        const secret = secretF.input.value.replace(/\s+/g, "");
        if (!name) { err.textContent = "名称不能为空"; return; }
        if (!secret) { err.textContent = "密钥不能为空"; return; }
        if (typeof TOTP !== "undefined" && TOTP && typeof TOTP.normalizeAccount === "function") {
          try { TOTP.normalizeAccount({ name: name, issuer: issuer, secret: secret }); }
          catch (ex) { err.textContent = "密钥格式不正确"; return; }
        }
        finish({ name: name, issuer: issuer, secret: secret });
      });
      setTimeout(function () { try { nameF.input.focus(); nameF.input.select(); } catch (e) {} }, 0);
    });
  }

  // Resolve to true (confirm) / false (cancel).
  function confirmAction(message) {
    return open(function (modal, finish) {
      modal.appendChild(el("h2", "modal-title", "请确认"));
      modal.appendChild(el("p", "modal-message", message || "确定继续吗？"));
      const actions = el("div", "modal-actions");
      const cancel = el("button", "btn btn-ghost", "取消");
      cancel.type = "button";
      const ok = el("button", "btn btn-danger", "删除");
      ok.type = "button";
      actions.appendChild(cancel);
      actions.appendChild(ok);
      modal.appendChild(actions);
      cancel.addEventListener("click", function () { finish(false); });
      ok.addEventListener("click", function () { finish(true); });
      setTimeout(function () { try { cancel.focus(); } catch (e) {} }, 0);
    });
  }

  return { editAccount: editAccount, confirmAction: confirmAction };
});