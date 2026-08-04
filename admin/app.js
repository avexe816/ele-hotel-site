// ELE HOTEL 管理画面 — app.js
// 素の JS（フレームワーク不使用）。状態はすべてメモリ内変数のみ。
// localStorage / sessionStorage / indexedDB は一切使用しない。

(function () {
  "use strict";

  // ============================================================ 定数・状態

  const AREA_LABEL = { tokyo: "東京", osaka: "大阪", nagoya: "名古屋", sendai: "仙台" };
  const STATUS_LABEL = { open: "公開中", soon: "開業予定" };

  const state = {
    me: null, // {ok,email,mode,configured,translator,repo}
    schema: null,
    original: null, // { "data/site.json": {...}, ... } 深いコピー
    draft: null, // 編集用の深いコピー
    images: [],
    head: null,
    i18nByJa: null, // Map ja文字列 -> i18n entry（entry.__key にキーを持たせる）
    i18nEdits: {}, // 訳文の手直し { キー: { 言語: 文字列 or null(再翻訳) } }
    currentLang: "ja", // 選択中の言語タブ (schema.langsのcode)
    currentPage: null, // { kind:"group", id } | { kind:"hotel", slug }
    status: { state: "idle", url: "", at: "", message: "" },
    statusTimer: null,
    loading: true,
    loadError: null,
    loginError: null,
    loggingIn: false,
    saving: false,
    toasts: [],
    modal: null, // "diff" | "conflict" | null
    unsavedWarned: false,
  };

  let toastSeq = 1;

  // ============================================================ ユーティリティ

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "html") el.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "checked" || k === "disabled" || k === "readOnly" || k === "value") {
          el[k] = v;
        } else {
          el.setAttribute(k, v);
        }
      }
    }
    (Array.isArray(children) ? children : children != null ? [children] : []).forEach((c) => {
      if (c == null) return;
      el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  function deepClone(obj) {
    return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
  }

  function getPath(obj, dotted) {
    return dotted.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
  }

  function setPath(obj, dotted, value) {
    const parts = dotted.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
  }

  async function api(path, opts) {
    const res = await fetch("/api/admin" + path, {
      credentials: "same-origin",
      headers: opts && opts.body ? { "content-type": "application/json" } : undefined,
      ...opts,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (res.status === 401) {
      state.me = { ok: true, email: null, mode: state.me ? state.me.mode : "password" };
      render();
      const err = new Error("unauthorized");
      err.status = 401;
      throw err;
    }
    return { status: res.status, data };
  }

  function pushToast(message, kind) {
    const id = toastSeq++;
    state.toasts.push({ id, message, kind: kind || "default" });
    render();
    setTimeout(() => {
      state.toasts = state.toasts.filter((t) => t.id !== id);
      render();
    }, 5000);
  }

  function autoGrow(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
  }

  // ============================================================ i18n 参照

  function buildI18nIndex() {
    const map = new Map();
    const dict = (state.draft && state.draft["data/i18n.json"]) || {};
    for (const [key, entry] of Object.entries(dict)) {
      if (entry && typeof entry.ja === "string" && !map.has(entry.ja)) {
        map.set(entry.ja, Object.assign({ __key: key }, entry));
      }
    }
    state.i18nByJa = map;
  }

  function lookupTranslation(jaText, langCode) {
    if (!state.i18nByJa) return "";
    const entry = state.i18nByJa.get(jaText);
    if (!entry) return "";
    return entry[langCode] || "";
  }

  // ============================================================ 訳文の編集

  // 訳文に手直しがあるか
  function hasI18nEdits() {
    return Object.keys(state.i18nEdits).length > 0;
  }

  function i18nEditValue(key, lang) {
    const row = state.i18nEdits[key];
    return row && lang in row ? row[lang] : undefined;
  }

  function setI18nEdit(key, lang, value) {
    const entry = (state.draft["data/i18n.json"] || {})[key];
    const base = entry ? entry[lang] || "" : "";
    if (value !== null && value === base) {
      // 元に戻したので手直し扱いをやめる
      if (state.i18nEdits[key]) {
        delete state.i18nEdits[key][lang];
        if (!Object.keys(state.i18nEdits[key]).length) delete state.i18nEdits[key];
      }
      return;
    }
    state.i18nEdits[key] = state.i18nEdits[key] || {};
    state.i18nEdits[key][lang] = value;
  }

  // 人の手が入っているか（= 自動翻訳で上書きしない）
  function isConfirmed(entry, lang) {
    if (!entry) return false;
    if (lang === "zh-Hant") return Boolean(entry.hant_manual);
    return Boolean(entry.locked);
  }

  /**
   * 日本語以外のタブで表示する訳文の入力欄。
   * 日本語がまだ無いとき／まだ翻訳されていないときは案内文を出す。
   */
  function renderTranslationField(jaText, kind) {
    const lang = state.currentLang;
    const ja = String(jaText == null ? "" : jaText).trim();
    if (!ja) return h("div", { class: "trans-note" }, "日本語がまだ入力されていません。");

    const entry = state.i18nByJa ? state.i18nByJa.get(ja) : null;
    if (!entry) {
      const hasJa = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(ja);
      return h("div", { class: "trans-note" }, [
        h("span", null, hasJa ? "この文はまだ翻訳ライブラリにありません。" : "英字・数字だけの文なので、翻訳せずそのまま表示されます。"),
        hasJa ? h("span", { class: "trans-note-sub" }, "「保存して公開」を押すと自動翻訳されます。") : null,
        h("div", { class: "trans-source" }, ja),
      ]);
    }

    const key = entry.__key;
    const edited = i18nEditValue(key, lang);
    const isReset = edited === null;
    const value = isReset ? "" : edited !== undefined ? edited : entry[lang] || "";
    const confirmed = isConfirmed(entry, lang) && !isReset;
    const changed = edited !== undefined;

    const onInput = (e) => {
      setI18nEdit(key, lang, e.target.value);
      if (e.target.tagName === "TEXTAREA") autoGrow(e.target);
      // 全画面を作り直すとカーソルが飛ぶので、印と保存バーだけその場で直す
      const wrap = e.target.closest(".trans-wrap");
      const marks = wrap && wrap.querySelector(".trans-marks");
      if (marks) {
        const already = marks.querySelector(".trans-badge--edit");
        const nowEdited = i18nEditValue(key, lang) !== undefined;
        if (nowEdited && !already) marks.appendChild(h("span", { class: "trans-badge trans-badge--edit" }, "手直しあり"));
        if (!nowEdited && already) already.remove();
      }
      updateSaveBar();
    };

    const control =
      kind === "textarea"
        ? h("textarea", { "data-autogrow": "1", value: value, onInput: onInput })
        : h("input", { type: "text", value: value, onInput: onInput });

    const marks = [];
    if (confirmed) marks.push(h("span", { class: "trans-badge trans-badge--ok" }, "人工確認済み"));
    else if (value) marks.push(h("span", { class: "trans-badge" }, "自動翻訳"));
    if (changed) marks.push(h("span", { class: "trans-badge trans-badge--edit" }, isReset ? "再翻訳します" : "手直しあり"));

    return h("div", { class: "trans-wrap" }, [
      control,
      h("div", { class: "trans-meta" }, [
        h("div", { class: "trans-marks" }, marks),
        h(
          "button",
          {
            class: "trans-retrans",
            type: "button",
            onClick: () => {
              setI18nEdit(key, lang, null);
              render();
            },
          },
          "日本語から再翻訳"
        ),
      ]),
      h("div", { class: "trans-source" }, ja),
    ]);
  }

  /** 箇条書きの各行を訳文入力欄にして並べる（行の増減は日本語タブで行う） */
  function renderTranslationList(arr) {
    if (!arr || !arr.length) return h("div", { class: "trans-note" }, "項目がありません。");
    return h(
      "div",
      { class: "trans-list" },
      arr.map((val, idx) =>
        h("div", { class: "trans-list-row" }, [
          h("span", { class: "trans-list-no" }, String(idx + 1)),
          renderTranslationField(typeof val === "string" ? val : "", "text"),
        ])
      )
    );
  }

  // ============================================================ 差分検出

  function isDirty(fileKey) {
    return JSON.stringify(state.original[fileKey]) !== JSON.stringify(state.draft[fileKey]);
  }

  function dirtyFiles() {
    return Object.keys(state.draft).filter((k) => k !== "data/i18n.json" && isDirty(k));
  }

  function countDirtyTotal() {
    let n = computeDiffList().length;
    for (const row of Object.values(state.i18nEdits)) n += Object.keys(row).length;
    return n;
  }

  // 入力のたびに全画面を作り直すとカーソルが飛ぶので、下の保存バーだけ差し替える
  function updateSaveBar() {
    const old = document.querySelector(".savebar");
    if (old && old.parentNode) old.parentNode.replaceChild(renderSaveBar(), old);
  }

  // ラベル解決
  function siteFieldLabel(pathKey) {
    const entry = state.schema.site[pathKey];
    return entry ? entry.label : pathKey;
  }
  // hotels.json のリーフパス（例: "tagline.ja", "rtypes.2.name.ja", "ota.0.url"）
  // を人間が読めるラベル（例: "キャッチコピー", "客室タイプ（カード） #3: 名称"）に変換する
  function hotelFieldLabel(pathKey) {
    const parts = pathKey.split(".");
    const head = parts[0];
    const meta = (state.schema.hotel || {})[head];
    if (!meta) return pathKey;
    // トップレベルの単純フィールド（例: "tagline.ja" → "キャッチコピー"）
    if (parts.length <= 2) {
      return meta.label || head;
    }
    // list-obj/gallery のサブフィールド（例: "rtypes.2.name.ja" → "客室タイプ（カード） #3: 名称"）
    const idx = parts[1];
    const subKey = parts[2];
    const itemLabels = meta.item || {};
    const subLabel = itemLabels[subKey] || subKey;
    const n = Number(idx);
    const numLabel = Number.isInteger(n) ? " #" + (n + 1) : "";
    return (meta.label || head) + numLabel + ": " + subLabel;
  }
  function groupNameById(id) {
    const g = state.schema.groups.find((g) => g.id === id);
    return g ? g.name : id;
  }

  function stringify(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }

  // 変更点の一覧を作る（表示名 / 変更前 / 変更後）
  function computeDiffList() {
    const out = [];
    // site.json
    const siteBefore = (state.original["data/site.json"] || {}).ja || {};
    const siteAfter = (state.draft["data/site.json"] || {}).ja || {};
    const allKeys = new Set([...Object.keys(state.schema.site || {})]);
    collectLeafPaths(siteBefore, "", allKeys);
    collectLeafPaths(siteAfter, "", allKeys);
    for (const key of allKeys) {
      const b = getPath(siteBefore, key);
      const a = getPath(siteAfter, key);
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        out.push({ label: "トップページ等: " + siteFieldLabel(key), before: stringify(b), after: stringify(a) });
      }
    }
    // grand.json
    const grandBefore = (state.original["data/grand.json"] || {}).ja || {};
    const grandAfter = (state.draft["data/grand.json"] || {}).ja || {};
    if (JSON.stringify(grandBefore) !== JSON.stringify(grandAfter)) {
      const gKeys = new Set();
      collectLeafPaths(grandBefore, "", gKeys);
      collectLeafPaths(grandAfter, "", gKeys);
      for (const key of gKeys) {
        const b = getPath(grandBefore, key);
        const a = getPath(grandAfter, key);
        if (JSON.stringify(b) !== JSON.stringify(a)) {
          out.push({ label: "ブランドページ: " + grandFieldLabel(key), before: stringify(b), after: stringify(a) });
        }
      }
    }
    // hotels.json
    const hBefore = state.original["data/hotels.json"] || [];
    const hAfter = state.draft["data/hotels.json"] || [];
    hAfter.forEach((hotel, idx) => {
      const before = hBefore[idx];
      if (!before) return;
      if (JSON.stringify(before) !== JSON.stringify(hotel)) {
        const keys = new Set();
        collectLeafPaths(before, "", keys);
        collectLeafPaths(hotel, "", keys);
        for (const key of keys) {
          const b = getPath(before, key);
          const a = getPath(hotel, key);
          if (JSON.stringify(b) !== JSON.stringify(a)) {
            out.push({
              label: (hotel.name && hotel.name.ja ? hotel.name.ja : hotel.slug) + ": " + hotelFieldLabel(key),
              before: stringify(b),
              after: stringify(a),
            });
          }
        }
      }
    });
    return out;
  }

  function collectLeafPaths(obj, prefix, into) {
    if (obj == null || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      into.add(prefix);
      return;
    }
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      into.add(prefix);
      return;
    }
    for (const k of keys) {
      const p = prefix ? prefix + "." + k : k;
      const v = obj[k];
      if (v != null && typeof v === "object" && !Array.isArray(v)) {
        collectLeafPaths(v, p, into);
      } else {
        into.add(p);
      }
    }
  }

  // ============================================================ 起動

  async function boot() {
    try {
      const meRes = await api("/me");
      state.me = meRes.data;
    } catch (e) {
      state.loadError = "サーバーに接続できませんでした。";
      state.loading = false;
      render();
      return;
    }

    if (!state.me || !state.me.email) {
      state.loading = false;
      render();
      return;
    }

    await loadBundleAndStatus();
  }

  async function loadBundleAndStatus() {
    state.loading = true;
    state.loadError = null;
    render();
    try {
      const bRes = await api("/bundle");
      if (bRes.status !== 200 || !bRes.data || !bRes.data.ok) {
        state.loadError = "データの読み込みに失敗しました。";
        state.loading = false;
        render();
        return;
      }
      state.head = bRes.data.head;
      state.images = bRes.data.images || [];
      state.schema = bRes.data.files["data/admin-schema.json"];
      const files = {};
      for (const k of ["data/site.json", "data/hotels.json", "data/grand.json", "data/i18n.json"]) {
        files[k] = bRes.data.files[k];
      }
      state.original = deepClone(files);
      state.draft = deepClone(files);
      buildI18nIndex();

      if (!state.currentPage && state.schema && state.schema.groups && state.schema.groups[0]) {
        state.currentPage = { kind: "group", id: state.schema.groups[0].id };
      }
      state.loading = false;
      render();
      pollStatusOnce();
    } catch (e) {
      state.loadError = "データの読み込み中にエラーが発生しました。";
      state.loading = false;
      render();
    }
  }

  async function pollStatusOnce() {
    try {
      const sRes = await api("/status");
      if (sRes.data && sRes.data.ok) {
        state.status = sRes.data;
        render();
      }
    } catch (e) {
      /* ignore */
    }
  }

  function startStatusPolling() {
    let elapsed = 0;
    const INTERVAL_MS = 2000; // ビルド中バッジを小敵みなく見せるため短い間隔でポーリング（最大12秒→上限は下の300秒で制限）
    if (state.statusTimer) clearInterval(state.statusTimer);
    state.statusTimer = setInterval(async () => {
      elapsed += INTERVAL_MS / 1000;
      try {
        const sRes = await api("/status");
        if (sRes.data && sRes.data.ok) {
          state.status = sRes.data;
          render();
          if (sRes.data.state === "ok" || sRes.data.state === "failed" || elapsed >= 300) {
            clearInterval(state.statusTimer);
            state.statusTimer = null;
            if (sRes.data.state === "ok") pushToast("公開が完了しました。", "ok");
            render();
          }
        }
      } catch (e) {
        /* ignore, keep polling within limit */
        if (elapsed >= 300) {
          clearInterval(state.statusTimer);
          state.statusTimer = null;
        }
      }
    }, INTERVAL_MS);
  }

  // ============================================================ ログイン

  async function handleLoginSubmit(email, password) {
    state.loginError = null;
    state.loggingIn = true;
    render();
    try {
      const res = await api("/login", { method: "POST", body: JSON.stringify({ email, password }) });
      if (res.data && res.data.ok) {
        state.me = { ...state.me, email: res.data.email };
        state.loggingIn = false;
        await loadBundleAndStatus();
      } else {
        state.loginError = res.status === 401 ? "メールアドレスまたはパスワードが正しくありません。" : "ログインできませんでした。";
        state.loggingIn = false;
        render();
      }
    } catch (e) {
      state.loginError = "サーバーに接続できませんでした。";
      state.loggingIn = false;
      render();
    }
  }

  async function handleLogout() {
    try {
      await api("/logout");
    } catch (e) {
      /* ignore */
    }
    state.me = { ...state.me, email: null };
    state.original = null;
    state.draft = null;
    render();
  }

  // ============================================================ 保存

  function buildSavePayload() {
    const files = {};
    for (const key of dirtyFiles()) {
      files[key] = state.draft[key];
    }
    return files;
  }

  async function doSave() {
    const files = buildSavePayload();
    const i18nEdits = state.i18nEdits;
    if (Object.keys(files).length === 0 && !hasI18nEdits()) return;
    state.saving = true;
    render();
    const pageLabel = currentGroupLabelForMessage();
    try {
      const res = await api("/save", {
        method: "POST",
        body: JSON.stringify({ head: state.head, message: `管理画面から更新（${pageLabel}）`, files, i18n: i18nEdits }),
      });
      if (res.status === 200 && res.data && res.data.ok) {
        state.head = res.data.sha;
        state.original = deepClone(state.draft);
        state.i18nEdits = {};
        state.saving = false;
        state.modal = null;
        const tr = res.data.translated;
        if (tr && tr.error) {
          pushToast("保存しました。ただし自動翻訳に失敗しました（" + tr.error + "）。", "error");
        } else if (tr && tr.added) {
          const n = Object.values(tr.langs || {}).reduce((a, b) => a + b, 0);
          pushToast("保存しました。" + n + "件を自動翻訳しました。公開まで少しお待ちください。", "ok");
        } else {
          pushToast("保存しました。公開まで少しお待ちください。", "ok");
        }
        render();
        // バンンチの公開状態をすぐに反映する（最初のポーリング tick の10秒待ちで未公開ガッチを見せないようにする）
        try {
          const immediateStatusRes = await api("/status");
          if (immediateStatusRes.data && immediateStatusRes.data.ok) {
            state.status = immediateStatusRes.data;
            render();
          }
        } catch (e) {
          /* 無視してポーリングに任せる */
        }
        startStatusPolling();
      } else if (res.status === 409) {
        state.saving = false;
        state.modal = "conflict";
        render();
      } else {
        state.saving = false;
        pushToast("保存に失敗しました。時間をおいて再度お試しください。", "error");
        render();
      }
    } catch (e) {
      state.saving = false;
      pushToast("サーバーに接続できませんでした。", "error");
      render();
    }
  }

  function currentGroupLabelForMessage() {
    if (state.currentPage && state.currentPage.kind === "group") {
      return groupNameById(state.currentPage.id);
    }
    if (state.currentPage && state.currentPage.kind === "hotel") {
      const hotel = (state.draft["data/hotels.json"] || []).find((x) => x.slug === state.currentPage.slug);
      return hotel && hotel.name && hotel.name.ja ? hotel.name.ja : "ホテル情報";
    }
    return "編集";
  }

  // ============================================================ beforeunload

  window.addEventListener("beforeunload", (e) => {
    if (state.draft && (dirtyFiles().length > 0 || hasI18nEdits())) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ============================================================ 描画：ルート

  function render() {
    const root = document.getElementById("app");
    root.innerHTML = "";

    if (state.loading) {
      root.appendChild(renderSkeleton());
      return;
    }
    if (state.loadError) {
      root.appendChild(renderFatalError(state.loadError));
      return;
    }
    if (!state.me || !state.me.email) {
      root.appendChild(renderLogin());
      return;
    }
    root.appendChild(renderShell());
    root.appendChild(renderToasts());
    if (state.modal === "diff") root.appendChild(renderDiffModal());
    if (state.modal === "conflict") root.appendChild(renderConflictModal());

    // textarea 自動高さ調整
    root.querySelectorAll("textarea[data-autogrow]").forEach((t) => autoGrow(t));

    populateImageDatalist();
  }

  function renderSkeleton() {
    return h("div", { class: "boot-skeleton" }, [
      h("div", { class: "boot-skeleton__bar" }),
      h("div", { class: "boot-skeleton__row" }, [
        h("div", { class: "boot-skeleton__side" }),
        h("div", { class: "boot-skeleton__main" }, [
          h("div", { class: "sk-line", style: "width:40%" }),
          h("div", { class: "sk-line", style: "width:70%" }),
          h("div", { class: "sk-block" }),
        ]),
      ]),
    ]);
  }

  function renderFatalError(message) {
    return h("div", { class: "login-screen" }, [
      h("div", { class: "login-card" }, [
        h("div", { class: "login-logo" }, "ELE HOTEL"),
        h("div", { class: "login-title" }, "管理画面"),
        h("div", { class: "error-state" }, message),
        h("div", { style: "margin-top:16px" }, [
          h("button", { class: "btn btn-primary", onClick: () => location.reload() }, "再読み込み"),
        ]),
      ]),
    ]);
  }

  // ============================================================ 描画：ログイン

  function renderLogin() {
    const mode = state.me ? state.me.mode : "password";

    if (mode === "access") {
      return h("div", { class: "login-screen" }, [
        h("div", { class: "login-card" }, [
          h("div", { class: "login-logo" }, "ELE HOTEL"),
          h("div", { class: "login-title" }, "管理画面"),
          h("div", { class: "login-note" }, "アクセス権がありません。管理者にお問い合わせください。"),
        ]),
      ]);
    }

    let emailVal = "";
    let pwVal = "";

    const emailInput = h("input", {
      type: "email",
      id: "loginEmail",
      placeholder: "yamada@ele-hotel.com",
      autocomplete: "username",
      required: true,
      value: emailVal,
      onInput: (e) => (emailVal = e.target.value),
    });
    const pwInput = h("input", {
      type: "password",
      id: "loginPw",
      placeholder: "パスワード",
      autocomplete: "current-password",
      required: true,
      value: pwVal,
      onInput: (e) => (pwVal = e.target.value),
    });

    const form = h(
      "form",
      {
        onSubmit: (e) => {
          e.preventDefault();
          if (state.loggingIn) return;
          if (!emailVal.trim() || !pwVal) {
            state.loginError = "メールアドレスとパスワードを入力してください。";
            render();
            return;
          }
          handleLoginSubmit(emailVal.trim(), pwVal);
        },
      },
      [
        h("div", { class: "login-field" }, [
          h("label", { for: "loginEmail" }, "メールアドレス"),
          emailInput,
          h("div", { class: "login-hint" }, "登録済みのアドレスのみログインできます。"),
        ]),
        h("div", { class: "login-field" }, [h("label", { for: "loginPw" }, "パスワード"), pwInput]),
        state.loginError ? h("div", { class: "login-error" }, state.loginError) : null,
        h(
          "button",
          { class: "btn btn-primary", type: "submit", style: "width:100%", disabled: state.loggingIn },
          state.loggingIn ? "ログイン中…" : "ログイン"
        ),
      ]
    );

    return h("div", { class: "login-screen" }, [
      h("div", { class: "login-card" }, [
        h("div", { class: "login-logo" }, "ELE HOTEL"),
        h("div", { class: "login-title" }, "管理画面にログイン"),
        form,
      ]),
    ]);
  }

  // ============================================================ 描画：全体シェル

  function renderShell() {
    return h("div", { class: "app" }, [renderHeader(), h("div", { class: "shell" }, [renderSidebar(), renderMain()]), renderSaveBar()]);
  }

  function renderHeader() {
    return h("header", { class: "hdr" }, [
      h("div", { class: "hdr-logo" }, ["ELE HOTEL ", h("b", null, "管理画面")]),
      renderStatusBadge(),
      h("div", { class: "hdr-spacer" }),
      h("div", { class: "hdr-user", title: state.me.email }, state.me.email),
      h("button", { class: "btn btn-ghost btn-sm", onClick: onLogoutClick }, "ログアウト"),
    ]);
  }

  function onLogoutClick() {
    if (dirtyFiles().length > 0) {
      if (!confirm("保存されていない変更があります。ログアウトしてもよろしいですか？")) return;
    }
    handleLogout();
  }

  function renderStatusBadge() {
    const st = state.status.state;
    if (st === "ok") {
      return h("span", { class: "badge badge-ok" }, [h("span", { class: "badge-dot" }), "公開済み"]);
    }
    if (st === "building") {
      return h("span", { class: "badge badge-building" }, [h("span", { class: "spin" }, "⟳"), "公開中…"]);
    }
    if (st === "failed") {
      return h("span", { class: "badge badge-failed" }, [
        h("span", { class: "badge-dot" }),
        "公開に失敗しました",
        state.status.url
          ? h("a", { href: state.status.url, target: "_blank", rel: "noopener", style: "color:inherit;text-decoration:underline;margin-left:4px" }, "詳細")
          : null,
      ]);
    }
    return h("span", { class: "badge badge-idle" }, [h("span", { class: "badge-dot" }), "未公開"]);
  }

  // ============================================================ 描画：サイドバー

  function renderSidebar() {
    const items = [];
    for (const group of state.schema.groups) {
      items.push(
        h(
          "button",
          {
            class: "side-item" + (isCurrentGroup(group.id) ? " active" : ""),
            onClick: () => {
              state.currentPage = { kind: "group", id: group.id };
              render();
            },
          },
          [group.name, groupHasChanges(group.id) ? h("span", { class: "side-dot" }) : null]
        )
      );
    }
    items.push(h("div", { class: "side-sep" }));
    items.push(h("div", { class: "side-group-title" }, "ホテル"));
    const hotels = state.draft["data/hotels.json"] || [];
    for (const hotel of hotels) {
      items.push(
        h(
          "button",
          {
            class: "side-item" + (isCurrentHotel(hotel.slug) ? " active" : ""),
            onClick: () => {
              state.currentPage = { kind: "hotel", slug: hotel.slug };
              render();
            },
          },
          [hotel.name && hotel.name.ja ? hotel.name.ja : hotel.slug, hotelHasChanges(hotel.slug) ? h("span", { class: "side-dot" }) : null]
        )
      );
    }
    return h("nav", { class: "side" }, items);
  }

  function isCurrentGroup(id) {
    return state.currentPage && state.currentPage.kind === "group" && state.currentPage.id === id;
  }
  function isCurrentHotel(slug) {
    return state.currentPage && state.currentPage.kind === "hotel" && state.currentPage.slug === slug;
  }

  function groupHasChanges(groupId) {
    const before = (state.original["data/site.json"] || {}).ja || {};
    const after = (state.draft["data/site.json"] || {}).ja || {};
    for (const [key, meta] of Object.entries(state.schema.site || {})) {
      if (meta.group !== groupId) continue;
      if (JSON.stringify(getPath(before, key)) !== JSON.stringify(getPath(after, key))) return true;
    }
    if (groupId === "brand") {
      if (JSON.stringify(state.original["data/grand.json"]) !== JSON.stringify(state.draft["data/grand.json"])) return true;
    }
    return false;
  }

  function hotelHasChanges(slug) {
    const before = (state.original["data/hotels.json"] || []).find((x) => x.slug === slug);
    const after = (state.draft["data/hotels.json"] || []).find((x) => x.slug === slug);
    return JSON.stringify(before) !== JSON.stringify(after);
  }

  // ============================================================ 描画：メインエリア

  function renderMain() {
    if (!state.currentPage) {
      return h("main", { class: "main" }, [h("div", { class: "main-inner" }, [h("div", { class: "empty-state" }, "編集する項目を左のメニューから選んでください。")])]);
    }
    if (state.currentPage.kind === "hotel") {
      return renderHotelPage();
    }
    return renderGroupPage();
  }

  function renderLangTabs() {
    const tabs = state.schema.langs.map((lang) =>
      h(
        "button",
        {
          class: "lang-tab" + (state.currentLang === lang.code ? " active" : ""),
          onClick: () => {
            state.currentLang = lang.code;
            render();
          },
        },
        lang.name
      )
    );
    const lang = state.currentLang;
    let banner = null;
    if (lang === "zh-Hant") {
      banner = h("div", { class: "lang-banner" }, [
        h("b", null, "繁体字は簡体字から自動変換されます。"),
        h("span", null, "文言そのものの追加・削除は日本語タブで行ってください。ここで直した文は「人工確認済み」になり、以後は自動で上書きされません。"),
      ]);
    } else if (lang !== "ja") {
      banner = h("div", { class: "lang-banner" }, [
        h("b", null, "訳文はここで直せます。"),
        h("span", null, "日本語を保存すると足りない訳は自動で作られます。ここで直した文は「人工確認済み」になり、以後は自動で上書きされません。文言そのものの追加・削除は日本語タブで行ってください。"),
      ]);
    }
    return h("div", null, [h("div", { class: "lang-tabs" }, tabs), banner]);
  }

  // ------------------------------------------------------------ グループページ（site.json / grand.json）

  function renderGroupPage() {
    const group = state.schema.groups.find((g) => g.id === state.currentPage.id);
    if (!group) {
      return h("main", { class: "main" }, [h("div", { class: "main-inner" }, [h("div", { class: "error-state" }, "グループが見つかりません。")])]);
    }

    const fields = [];
    const siteJa = (state.draft["data/site.json"] || {}).ja || {};
    const schemaKeys = Object.entries(state.schema.site || {}).filter(([, meta]) => meta.group === group.id);

    for (const [key, meta] of schemaKeys) {
      fields.push(renderSiteField(key, meta, siteJa));
    }

    // スキーマに無いキーの取りこぼし防止（「その他」扱い。ここでは各グループ内で直下漏れは対象外、topグループのみ全体走査）
    if (group.id === "top") {
      const known = new Set(Object.keys(state.schema.site || {}));
      const allPaths = new Set();
      collectLeafPaths(siteJa, "", allPaths);
      for (const p of allPaths) {
        if (!known.has(p) && !p.startsWith("privacy.") && !p.startsWith("contact_page.") && !p.startsWith("photo_labels.")) {
          fields.push(renderSiteField(p, { label: p, kind: guessKind(getPath(siteJa, p)) }, siteJa, true));
        }
      }
    }

    // ブランドページグループには grand.json のフィールドも表示
    let grandFields = [];
    if (group.id === "brand") {
      grandFields = renderGrandFields();
    }

    if (fields.length === 0 && grandFields.length === 0) {
      return h("main", { class: "main" }, [
        h("div", { class: "main-inner" }, [
          h("div", { class: "group-head" }, [h("h1", null, group.name), h("p", null, group.desc)]),
          renderLangTabs(),
          h("div", { class: "empty-state" }, "このグループに編集できる項目はまだありません。"),
        ]),
      ]);
    }

    return h("main", { class: "main" }, [
      h("div", { class: "main-inner" }, [h("div", { class: "group-head" }, [h("h1", null, group.name), h("p", null, group.desc)]), renderLangTabs(), ...fields, ...grandFields]),
    ]);
  }

  function guessKind(value) {
    if (Array.isArray(value)) {
      return value.length && typeof value[0] === "object" ? "list-obj" : "list-text";
    }
    if (typeof value === "string" && value.length > 60) return "textarea";
    return "text";
  }

  // grand.json は admin-schema.json の対象外のため、ラベルをここで定義する（computeDiffList でも共用）
  const GRAND_LABEL_MAP = {
    meta_title: "ページタイトル",
    meta_desc: "ページ説明文",
    eyebrow: "小見出し",
    slogan: "スローガン",
    title: "大見出し",
    lead: "リード文",
    concept_title: "コンセプト見出し",
    concept_paras: "コンセプト本文（段落）",
    pillars_title: "三つのお約束の見出し",
    rooms_title: "客室の見出し",
    rooms_lead: "客室のリード文",
    dining_title: "ダイニングの見出し",
    dining_lead: "ダイニングのリード文",
    wellness_title: "ウェルネスの見出し",
    service_title: "サービスの見出し",
    plan_title: "展開計画の見出し",
    plan_lead: "展開計画のリード文",
    contact_title: "お問い合わせ見出し",
    contact_lead: "お問い合わせリード文",
    back: "戻るリンク文言",
  };
  function grandFieldLabel(pathKey) {
    const head = pathKey.split(".")[0];
    return GRAND_LABEL_MAP[head] || pathKey;
  }
  function renderGrandFields() {
    const grandJa = (state.draft["data/grand.json"] || {}).ja || {};
    const out = [];
    const simpleKeys = Object.keys(grandJa).filter((k) => typeof grandJa[k] === "string" && GRAND_LABEL_MAP[k]);
    for (const key of simpleKeys) {
      const kind = grandJa[key].length > 60 ? "textarea" : "text";
      out.push(renderGrandField(key, GRAND_LABEL_MAP[key], kind, grandJa));
    }
    return out;
  }

  function renderGrandField(key, label, kind, grandJa) {
    const before = getPath((state.original["data/grand.json"] || {}).ja || {}, key);
    const after = getPath(grandJa, key);
    const dirty = JSON.stringify(before) !== JSON.stringify(after);
    const readOnly = state.currentLang !== "ja";

    const onChange = (val) => {
      setPath(state.draft["data/grand.json"].ja, key, val);
      render();
    };

    let control;
    if (readOnly) {
      // 日本語以外のタブ … 訳文をそのまま直せる
      control = renderTranslationField(getPath((state.draft["data/grand.json"] || {}).ja || {}, key), kind);
    } else if (kind === "textarea") {
      control = h("textarea", {
        "data-autogrow": "1",
        value: after || "",
        onInput: (e) => {
          onChange(e.target.value);
          autoGrow(e.target);
        },
      });
    } else {
      control = h("input", { type: "text", value: after || "", onInput: (e) => onChange(e.target.value) });
    }

    return h("div", { class: "field" }, [
      h("div", { class: "field-label-row" }, [h("span", { class: "field-label" }, label), dirty ? h("span", { class: "dirty-dot" }) : null]),
      control,
    ]);
  }

  function renderSiteField(key, meta, siteJa, isOther) {
    const before = getPath((state.original["data/site.json"] || {}).ja || {}, key);
    const after = getPath(siteJa, key);
    const dirty = JSON.stringify(before) !== JSON.stringify(after);
    const readOnly = state.currentLang !== "ja";

    const labelRow = h("div", { class: "field-label-row" }, [
      h("span", { class: "field-label" }, isOther ? "（未分類）" + meta.label : meta.label),
      dirty ? h("span", { class: "dirty-dot" }) : null,
    ]);

    const onChange = (val) => {
      setPath(state.draft["data/site.json"].ja, key, val);
      render();
    };

    let control;
    if (meta.kind === "list-text") {
      control = readOnly ? renderTranslationList(after || []) : renderListText(after || [], onChange, readOnly, key);
    } else if (meta.kind === "list-obj") {
      const itemLabels = (state.schema.itemLabels && state.schema.itemLabels[key]) || {};
      control = renderListObj(after || [], onChange, readOnly, itemLabels);
    } else if (readOnly) {
      control = renderTranslationField(getPath(siteJa, key), meta.kind === "textarea" ? "textarea" : "text");
    } else if (meta.kind === "textarea") {
      control = h("textarea", {
        "data-autogrow": "1",
        value: after || "",
        onInput: (e) => {
          onChange(e.target.value);
          autoGrow(e.target);
        },
      });
    } else {
      control = h("input", { type: "text", value: after || "", onInput: (e) => onChange(e.target.value) });
    }

    return h("div", { class: "field" }, [labelRow, control]);
  }

  function renderListText(arr, onChange, readOnly, keyForId) {
    const rows = arr.map((val, idx) => {
      const input = h("input", {
        type: "text",
        readOnly: readOnly,
        disabled: readOnly,
        value: val,
        onInput: (e) => {
          const copy = arr.slice();
          copy[idx] = e.target.value;
          onChange(copy);
        },
      });
      const controls = [
        h(
          "button",
          {
            class: "btn btn-icon btn-ghost",
            disabled: readOnly || idx === 0,
            title: "上へ",
            onClick: () => {
              const copy = arr.slice();
              [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
              onChange(copy);
            },
          },
          "↑"
        ),
        h(
          "button",
          {
            class: "btn btn-icon btn-ghost",
            disabled: readOnly || idx === arr.length - 1,
            title: "下へ",
            onClick: () => {
              const copy = arr.slice();
              [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
              onChange(copy);
            },
          },
          "↓"
        ),
        h(
          "button",
          {
            class: "btn btn-icon btn-ghost",
            disabled: readOnly,
            title: "削除",
            onClick: () => {
              const copy = arr.slice();
              copy.splice(idx, 1);
              onChange(copy);
            },
          },
          "×"
        ),
      ];
      return h("div", { class: "list-row" }, [input, h("div", { class: "list-row-controls" }, controls)]);
    });
    const addBtn = h(
      "button",
      {
        class: "btn btn-sm add-row-btn",
        disabled: readOnly,
        onClick: () => onChange(arr.concat([""])),
      },
      "＋ 追加"
    );
    return h("div", null, [h("div", { class: "list-rows" }, rows), addBtn]);
  }

  function renderListObj(arr, onChange, readOnly, itemLabels) {
    const cards = arr.map((item, idx) => {
      const fieldEls = Object.entries(itemLabels).length
        ? Object.entries(itemLabels).map(([subKey, subLabel]) => renderObjSubField(item, subKey, subLabel, idx, arr, onChange, readOnly))
        : Object.keys(item || {}).map((subKey) => renderObjSubField(item, subKey, subKey, idx, arr, onChange, readOnly));

      const controls = [
        h(
          "button",
          {
            class: "btn btn-icon btn-ghost",
            disabled: readOnly || idx === 0,
            title: "上へ",
            onClick: () => {
              const copy = arr.map((x) => x);
              [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
              onChange(copy);
            },
          },
          "↑"
        ),
        h(
          "button",
          {
            class: "btn btn-icon btn-ghost",
            disabled: readOnly || idx === arr.length - 1,
            title: "下へ",
            onClick: () => {
              const copy = arr.map((x) => x);
              [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
              onChange(copy);
            },
          },
          "↓"
        ),
        h(
          "button",
          {
            class: "btn btn-icon btn-ghost",
            disabled: readOnly,
            title: "削除",
            onClick: () => {
              const copy = arr.slice();
              copy.splice(idx, 1);
              onChange(copy);
            },
          },
          "×"
        ),
      ];

      return h("div", { class: "obj-card" }, [
        h("div", { class: "obj-card-head" }, [h("span", { class: "obj-card-title" }, `#${idx + 1}`), h("div", { class: "obj-card-controls" }, controls)]),
        ...fieldEls,
      ]);
    });

    const addBtn = h(
      "button",
      {
        class: "btn btn-sm add-card-btn",
        disabled: readOnly,
        onClick: () => {
          const template = arr.length ? deepClone(arr[0]) : {};
          for (const k of Object.keys(template)) {
            template[k] = typeof template[k] === "string" ? "" : Array.isArray(template[k]) ? [] : template[k];
          }
          onChange(arr.concat([template]));
        },
      },
      "＋ 追加"
    );

    return h("div", null, [h("div", { class: "obj-cards" }, cards), addBtn]);
  }

  function renderObjSubField(item, subKey, subLabel, idx, arr, onChange, readOnly) {
    const value = item ? item[subKey] : "";
    const isImgField = /画像ID/.test(subLabel);
    const update = (val) => {
      const copy = arr.map((x) => x);
      copy[idx] = { ...copy[idx], [subKey]: val };
      onChange(copy);
    };

    let control;
    if (Array.isArray(value)) {
      // 配列値のサブフィールド（例: privacy.sections[].items の箇条書き本文）を一行ごとの入力行で編集できるようにする
      control = h("div", { class: "obj-subarray" }, [renderListText(value, (newArr) => update(newArr), readOnly)]);
    } else if (isImgField) {
      const imgId = typeof value === "string" ? value : "";
      const known = state.images.includes(imgId);
      control = h("div", { class: "img-field-row" }, [
        h("input", {
          type: "text",
          list: "imglist",
          readOnly: readOnly,
          disabled: readOnly,
          value: imgId,
          onInput: (e) => update(e.target.value),
        }),
        known ? h("img", { class: "img-thumb", src: `/assets/img/${imgId}-sm.webp`, alt: "" }) : null,
      ]);
    } else if (typeof value === "string" && value.length > 40) {
      control = h("textarea", {
        "data-autogrow": "1",
        readOnly: readOnly,
        disabled: readOnly,
        value: value || "",
        onInput: (e) => {
          update(e.target.value);
          autoGrow(e.target);
        },
      });
    } else if (typeof value === "number") {
      control = h("input", {
        type: "number",
        readOnly: readOnly,
        disabled: readOnly,
        value: value,
        onInput: (e) => update(e.target.value === "" ? "" : Number(e.target.value)),
      });
    } else {
      control = h("input", {
        type: "text",
        readOnly: readOnly,
        disabled: readOnly,
        value: value || "",
        onInput: (e) => update(e.target.value),
      });
    }

    return h("div", { class: "obj-card-field" }, [h("label", null, subLabel), control]);
  }

  // ------------------------------------------------------------ ホテルページ

  function renderHotelPage() {
    const hotels = state.draft["data/hotels.json"] || [];
    const hotel = hotels.find((x) => x.slug === state.currentPage.slug);
    if (!hotel) {
      return h("main", { class: "main" }, [h("div", { class: "main-inner" }, [h("div", { class: "error-state" }, "ホテルが見つかりません。")])]);
    }
    const beforeHotel = (state.original["data/hotels.json"] || []).find((x) => x.slug === hotel.slug) || {};

    const fields = Object.entries(state.schema.hotel || {}).map(([key, meta]) => renderHotelField(hotel, beforeHotel, key, meta));

    return h("main", { class: "main" }, [
      h("div", { class: "main-inner" }, [
        h("div", { class: "group-head" }, [
          h("h1", null, hotel.name && hotel.name.ja ? hotel.name.ja : hotel.slug),
          h("p", null, `${AREA_LABEL[hotel.area] || hotel.area} ・ ${STATUS_LABEL[hotel.status] || hotel.status}`),
        ]),
        renderLangTabs(),
        ...fields,
      ]),
    ]);
  }

  function renderHotelField(hotel, beforeHotel, key, meta) {
    const readOnly = state.currentLang !== "ja" || meta.kind === "readonly";
    const isI18n = Boolean(meta.i18n);
    const rawValue = hotel[key];
    const jaValue = isI18n ? (rawValue && typeof rawValue === "object" ? rawValue.ja : rawValue) : rawValue;
    const beforeRaw = beforeHotel[key];
    const dirty = JSON.stringify(beforeRaw) !== JSON.stringify(rawValue);

    const labelRow = h("div", { class: "field-label-row" }, [h("span", { class: "field-label" }, meta.label), dirty ? h("span", { class: "dirty-dot" }) : null]);

    const update = (val) => {
      if (isI18n) {
        hotel[key] = { ...(hotel[key] || {}), ja: val };
      } else {
        hotel[key] = val;
      }
      render();
    };

    let control;

    if (meta.kind === "readonly") {
      control = h("div", { class: "readonly-value" }, String(jaValue == null ? "" : jaValue));
    } else if (meta.kind === "select") {
      const optLabelMap = key === "area" ? AREA_LABEL : key === "status" ? STATUS_LABEL : {};
      control = h(
        "select",
        {
          disabled: readOnly,
          onChange: (e) => update(e.target.value),
        },
        meta.options.map((opt) => h("option", { value: opt, selected: opt === rawValue }, optLabelMap[opt] || opt))
      );
    } else if (meta.kind === "number") {
      control = h("input", {
        type: "number",
        readOnly: readOnly,
        disabled: readOnly,
        value: rawValue,
        onInput: (e) => update(e.target.value === "" ? "" : Number(e.target.value)),
      });
    } else if (isI18n && state.currentLang !== "ja" && (meta.kind === "textarea" || meta.kind === "text" || !meta.kind)) {
      control = renderTranslationField(jaValue, meta.kind === "textarea" ? "textarea" : "text");
    } else if (meta.kind === "textarea") {
      control = h("textarea", {
        "data-autogrow": "1",
        readOnly: readOnly,
        disabled: readOnly,
        value: jaValue || "",
        onInput: (e) => {
          update(e.target.value);
          autoGrow(e.target);
        },
      });
    } else if (meta.kind === "list-text" || meta.kind === "facilities") {
      const arr = jaValue || [];
      control =
        isI18n && state.currentLang !== "ja"
          ? renderTranslationList(arr)
          : renderListText(arr, (newArr) => update(newArr), readOnly, key);
    } else if (meta.kind === "list-obj" || meta.kind === "gallery") {
      const arr = rawValue || [];
      const itemLabels = meta.item || {};
      control = renderHotelListObj(arr, (newArr) => {
        hotel[key] = newArr;
        render();
      }, readOnly, itemLabels);
    } else {
      const displayVal = jaValue;
      const isImgField = /画像ID/.test(meta.label);
      if (isImgField) {
        const imgId = typeof rawValue === "string" ? rawValue : "";
        const known = state.images.includes(imgId);
        control = h("div", { class: "img-field-row" }, [
          h("input", { type: "text", list: "imglist", readOnly: readOnly, disabled: readOnly, value: imgId, onInput: (e) => update(e.target.value) }),
          known ? h("img", { class: "img-thumb", src: `/assets/img/${imgId}-sm.webp`, alt: "" }) : null,
        ]);
      } else {
        control = h("input", {
          type: "text",
          readOnly: readOnly,
          disabled: readOnly,
          value: displayVal || "",
          onInput: (e) => update(e.target.value),
        });
      }
    }

    const helpText = null;

    return h("div", { class: "field" }, [labelRow, control, helpText]);
  }

  // hotels.json の list-obj（rtypes / ota / gallery）— サブフィールドが {ja} 形式のものと通常文字列のものが混在
  function renderHotelListObj(arr, onChange, readOnly, itemLabels) {
    const cards = arr.map((item, idx) => {
      const subEntries = Object.keys(itemLabels).length ? Object.entries(itemLabels) : Object.keys(item || {}).map((k) => [k, k]);
      const fieldEls = subEntries.map(([subKey, subLabel]) => {
        const raw = item ? item[subKey] : "";
        const isI18nSub = raw && typeof raw === "object" && !Array.isArray(raw) && "ja" in raw;
        const jaVal = isI18nSub ? raw.ja : raw;
        const isImgField = /画像ID/.test(subLabel);

        const update = (val) => {
          const copy = arr.map((x) => x);
          const newItem = { ...copy[idx] };
          if (isI18nSub) {
            newItem[subKey] = { ...(newItem[subKey] || {}), ja: val };
          } else if (typeof raw === "number") {
            newItem[subKey] = val === "" ? "" : Number(val);
          } else {
            newItem[subKey] = val;
          }
          copy[idx] = newItem;
          onChange(copy);
        };

        let control;
        if (Array.isArray(jaVal)) {
          // 配列値のサブフィールドを一行ごとの入力行で編集できるようにする（現在の hotels.json には例はないが安全対策）
          control = h("div", { class: "obj-subarray" }, [renderListText(jaVal, (newArr) => update(newArr), readOnly)]);
        } else if (isImgField) {
          const imgId = typeof jaVal === "string" ? jaVal : "";
          const known = state.images.includes(imgId);
          control = h("div", { class: "img-field-row" }, [
            h("input", { type: "text", list: "imglist", readOnly: readOnly, disabled: readOnly, value: imgId, onInput: (e) => update(e.target.value) }),
            known ? h("img", { class: "img-thumb", src: `/assets/img/${imgId}-sm.webp`, alt: "" }) : null,
          ]);
        } else if (typeof raw === "number") {
          control = h("input", { type: "number", readOnly: readOnly, disabled: readOnly, value: jaVal, onInput: (e) => update(e.target.value) });
        } else if (typeof jaVal === "string" && jaVal.length > 40) {
          control = h("textarea", {
            "data-autogrow": "1",
            readOnly: readOnly,
            disabled: readOnly,
            value: jaVal || "",
            onInput: (e) => {
              update(e.target.value);
              autoGrow(e.target);
            },
          });
        } else {
          control = h("input", { type: "text", readOnly: readOnly, disabled: readOnly, value: jaVal || "", onInput: (e) => update(e.target.value) });
        }

        return h("div", { class: "obj-card-field" }, [h("label", null, subLabel), control]);
      });

      const controls = [
        h(
          "button",
          {
            class: "btn btn-icon btn-ghost",
            disabled: readOnly || idx === 0,
            title: "上へ",
            onClick: () => {
              const copy = arr.map((x) => x);
              [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
              onChange(copy);
            },
          },
          "↑"
        ),
        h(
          "button",
          {
            class: "btn btn-icon btn-ghost",
            disabled: readOnly || idx === arr.length - 1,
            title: "下へ",
            onClick: () => {
              const copy = arr.map((x) => x);
              [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
              onChange(copy);
            },
          },
          "↓"
        ),
        h(
          "button",
          {
            class: "btn btn-icon btn-ghost",
            disabled: readOnly,
            title: "削除",
            onClick: () => {
              const copy = arr.slice();
              copy.splice(idx, 1);
              onChange(copy);
            },
          },
          "×"
        ),
      ];

      return h("div", { class: "obj-card" }, [
        h("div", { class: "obj-card-head" }, [h("span", { class: "obj-card-title" }, `#${idx + 1}`), h("div", { class: "obj-card-controls" }, controls)]),
        ...fieldEls,
      ]);
    });

    const addBtn = h(
      "button",
      {
        class: "btn btn-sm add-card-btn",
        disabled: readOnly,
        onClick: () => {
          const template = arr.length ? deepClone(arr[0]) : {};
          for (const k of Object.keys(template)) {
            if (typeof template[k] === "string") template[k] = "";
            else if (template[k] && typeof template[k] === "object" && "ja" in template[k]) template[k] = { ja: "" };
            else if (typeof template[k] === "number") template[k] = 0;
          }
          onChange(arr.concat([template]));
        },
      },
      "＋ 追加"
    );

    return h("div", null, [h("div", { class: "obj-cards" }, cards), addBtn]);
  }

  // ============================================================ 描画：下部バー

  function renderSaveBar() {
    const total = countDirtyTotal();
    return h("div", { class: "savebar" }, [
      h("span", { class: "savebar-status" + (total > 0 ? " has-changes" : "") }, total > 0 ? `未保存 ${total}件` : "未保存の変更はありません"),
      h("span", { class: "savebar-spacer" }),
      h(
        "button",
        {
          class: "btn",
          disabled: total === 0,
          onClick: () => {
            state.modal = "diff";
            render();
          },
        },
        "変更内容を確認"
      ),
      h(
        "button",
        {
          class: "btn btn-primary",
          disabled: total === 0 || state.saving,
          onClick: onSaveClick,
        },
        state.saving ? "保存中…" : "保存して公開"
      ),
    ]);
  }

  function onSaveClick() {
    const ok = confirm("サイトに反映します。約1分で公開されます。よろしいですか？");
    if (!ok) return;
    doSave();
  }

  // ============================================================ 描画：モーダル

  function renderDiffModal() {
    const list = computeDiffList();
    return h("div", { class: "modal-overlay", onClick: (e) => e.target === e.currentTarget && closeModal() }, [
      h("div", { class: "modal" }, [
        h("div", { class: "modal-head" }, [h("h2", null, "変更内容の確認"), h("button", { class: "btn btn-icon btn-ghost", onClick: closeModal }, "×")]),
        h(
          "div",
          { class: "modal-body" },
          list.length
            ? list.map((d) =>
                h("div", { class: "diff-item" }, [
                  h("div", { class: "diff-item-label" }, d.label),
                  h("div", { class: "diff-vals" }, [
                    h("div", null, [h("div", { class: "diff-arrow-label" }, "変更前"), h("div", { class: "diff-before" }, d.before || "（空）")]),
                    h("div", null, [h("div", { class: "diff-arrow-label" }, "変更後"), h("div", { class: "diff-after" }, d.after || "（空）")]),
                  ]),
                ])
              )
            : h("div", { class: "empty-state" }, "変更はありません。")
        ),
        h("div", { class: "modal-foot" }, [
          h("button", { class: "btn", onClick: closeModal }, "閉じる"),
          h(
            "button",
            {
              class: "btn btn-primary",
              disabled: list.length === 0 || state.saving,
              onClick: onSaveClick,
            },
            state.saving ? "保存中…" : "保存して公開"
          ),
        ]),
      ]),
    ]);
  }

  function renderConflictModal() {
    return h("div", { class: "modal-overlay" }, [
      h("div", { class: "modal", style: "max-width:420px" }, [
        h("div", { class: "modal-head" }, [h("h2", null, "保存できませんでした")]),
        h("div", { class: "modal-body" }, [h("p", { class: "modal-note" }, "ほかの方が先に保存しました。画面を再読み込みしてください。")]),
        h("div", { class: "modal-foot" }, [h("button", { class: "btn btn-primary", onClick: () => location.reload() }, "再読み込み")]),
      ]),
    ]);
  }

  function closeModal() {
    state.modal = null;
    render();
  }

  // ============================================================ 描画：トースト

  function renderToasts() {
    return h(
      "div",
      { class: "toast-wrap" },
      state.toasts.map((t) => h("div", { class: "toast" + (t.kind === "ok" ? " toast-ok" : t.kind === "error" ? " toast-error" : "") }, t.message))
    );
  }

  // ============================================================ 画像 datalist の反映

  function populateImageDatalist() {
    const dl = document.getElementById("imglist");
    if (!dl) return;
    dl.innerHTML = "";
    for (const id of state.images) {
      const opt = document.createElement("option");
      opt.value = id;
      dl.appendChild(opt);
    }
  }

  // ============================================================ 起動

  boot();
})();
