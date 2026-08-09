// ELE HOTEL 管理画面 — app.js
// 素の JS（フレームワーク不使用）。状態はすべてメモリ内変数のみ。
// localStorage / sessionStorage / indexedDB は一切使用しない。

(function () {
  "use strict";

  // ============================================================ 定数・状態

  // エリアは site.json の ja.areas が正（管理画面「トップページ」の「エリア（絞り込みボタン）」で追加・編集できる）
  const AREA_LABEL_FALLBACK = { tokyo: "東京", osaka: "大阪", nagoya: "名古屋", sendai: "仙台", onsen: "温泉" };

  function areaDefs() {
    const ja = (state.draft && state.draft["data/site.json"] ? state.draft["data/site.json"].ja : null) || {};
    const list = Array.isArray(ja.areas) ? ja.areas : [];
    const out = [];
    for (const a of list) {
      if (!a || typeof a !== "object") continue;
      const key = String(a.key || "").trim();
      if (!key) continue;
      out.push({ key: key, label: String(a.label || "").trim() || key });
    }
    if (out.length) return out;
    return Object.keys(AREA_LABEL_FALLBACK).map((k) => ({ key: k, label: AREA_LABEL_FALLBACK[k] }));
  }

  function areaLabelMap() {
    const m = {};
    for (const a of areaDefs()) m[a.key] = a.label;
    return m;
  }

  function areaLabel(key) {
    return areaLabelMap()[key] || AREA_LABEL_FALLBACK[key] || key;
  }
  const STATUS_LABEL = { open: "公開中", soon: "開業予定" };
  const BRAND_LABEL = { hotel: "ELE Hotel（ホテル）", apart: "ELE Apartment（アパートメント）", onsen: "ELE Onsen（温泉）", grand: "GRAND ELE Hotel" };

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
    picker: null, // 画像を選ぶダイアログ { value, filter, onPick }
    upload: { queue: [], problems: {}, busy: false, dragging: false, filter: "", justUploaded: [], seq: 1 },
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
  const BOOKING_SUB_LABEL = {
    engine: "予約フォームの表示",
    id: "施設ID",
    host: "サーバー名",
    max_guests: "人数の上限",
    max_nights: "泊数の上限",
    max_rooms: "部屋数の上限",
    action: "検索用URL（旧設定）",
    top: "トップURL（旧設定）",
  };

  function hotelFieldLabel(pathKey) {
    const parts = pathKey.split(".");
    const head = parts[0];
    const meta = (state.schema.hotel || {})[head];
    if (!meta) return pathKey;
    if (head === "booking" && parts[1]) {
      return "予約プロ設定: " + (BOOKING_SUB_LABEL[parts[1]] || parts[1]);
    }
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
  function pageFieldLabel(pathKey) {
    const parts = pathKey.split(".");
    const meta = (state.schema.page || {})[parts[0]];
    if (!meta) return pathKey;
    if (parts.length <= 2) return meta.label || parts[0];
    const n = Number(parts[1]);
    const sub = (meta.item || {})[parts[2]] || parts[2];
    return (meta.label || parts[0]) + (Number.isInteger(n) ? " #" + (n + 1) : "") + ": " + sub;
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
    // 追加・削除・並べ替えがあってもズレないように、URL用の名前（slug）で突き合わせる
    const nameOf = (x) => (x && x.name && x.name.ja ? x.name.ja : (x || {}).slug || "");
    const beforeSlugs = hBefore.map((x) => x.slug);
    const afterSlugs = hAfter.map((x) => x.slug);
    for (const hotel of hAfter) {
      if (!beforeSlugs.includes(hotel.slug)) {
        out.push({ label: "ホテルを追加", before: "（なし）", after: `${nameOf(hotel)}（/hotels/${hotel.slug}）` });
      }
    }
    for (const old of hBefore) {
      if (!afterSlugs.includes(old.slug)) {
        out.push({ label: "ホテルを削除", before: `${nameOf(old)}（/hotels/${old.slug}）`, after: "（なし）" });
      }
    }
    const commonBefore = beforeSlugs.filter((x) => afterSlugs.includes(x));
    const commonAfter = afterSlugs.filter((x) => beforeSlugs.includes(x));
    if (JSON.stringify(commonBefore) !== JSON.stringify(commonAfter)) {
      const label = (slugs) => slugs.map((sl) => nameOf(hAfter.find((x) => x.slug === sl) || hBefore.find((x) => x.slug === sl))).join(" → ");
      out.push({ label: "ホテルの並び順", before: label(commonBefore), after: label(commonAfter) });
    }
    // pages.json
    const pBefore = state.original["data/pages.json"] || [];
    const pAfter = state.draft["data/pages.json"] || [];
    const pbSlugs = pBefore.map((x) => x.slug);
    const paSlugs = pAfter.map((x) => x.slug);
    for (const pg of pAfter) {
      if (!pbSlugs.includes(pg.slug)) out.push({ label: "ページを追加", before: "（なし）", after: `${pageTitleOf(pg)}（/pages/${pg.slug}）` });
    }
    for (const old of pBefore) {
      if (!paSlugs.includes(old.slug)) out.push({ label: "ページを削除", before: `${pageTitleOf(old)}（/pages/${old.slug}）`, after: "（なし）" });
    }
    const pcB = pbSlugs.filter((x) => paSlugs.includes(x));
    const pcA = paSlugs.filter((x) => pbSlugs.includes(x));
    if (JSON.stringify(pcB) !== JSON.stringify(pcA)) {
      const lab = (sl) => sl.map((x) => pageTitleOf(pAfter.find((y) => y.slug === x) || pBefore.find((y) => y.slug === x))).join(" → ");
      out.push({ label: "ページの並び順", before: lab(pcB), after: lab(pcA) });
    }
    pAfter.forEach((pg) => {
      const before = pBefore.find((x) => x.slug === pg.slug);
      if (!before || JSON.stringify(before) === JSON.stringify(pg)) return;
      const keys = new Set();
      collectLeafPaths(before, "", keys);
      collectLeafPaths(pg, "", keys);
      for (const key of keys) {
        const b = getPath(before, key);
        const a = getPath(pg, key);
        if (JSON.stringify(b) !== JSON.stringify(a)) {
          out.push({ label: pageTitleOf(pg) + ": " + pageFieldLabel(key), before: stringify(b), after: stringify(a) });
        }
      }
    });
    hAfter.forEach((hotel) => {
      const before = hBefore.find((x) => x.slug === hotel.slug);
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
      for (const k of ["data/site.json", "data/hotels.json", "data/grand.json", "data/pages.json", "data/i18n.json"]) {
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

  // 再描画で「スクロール位置が先頭に戻る」「入力中のカーソルが外れる」のを防ぐ。
  // 描画前に位置と入力状態を控え、描画後に同じ場所へ戻す。
  function captureUiState(root) {
    const snap = {
      win: window.scrollY || 0,
      panes: [],
      path: null,
      selStart: null,
      selEnd: null,
    };
    root.querySelectorAll(".main, .side, .modal-body").forEach((el, i) => {
      snap.panes.push({ i: i, cls: el.className, top: el.scrollTop });
    });
    const a = document.activeElement;
    if (a && a !== document.body && root.contains(a)) {
      const path = [];
      let cur = a;
      while (cur && cur !== root) {
        const par = cur.parentNode;
        if (!par) return snap;
        path.unshift([].indexOf.call(par.childNodes, cur));
        cur = par;
      }
      snap.path = path;
      try {
        if (typeof a.selectionStart === "number") {
          snap.selStart = a.selectionStart;
          snap.selEnd = a.selectionEnd;
        }
      } catch (e) {}
    }
    return snap;
  }

  function restoreUiState(root, snap) {
    if (!snap) return;
    const panes = root.querySelectorAll(".main, .side, .modal-body");
    snap.panes.forEach((p) => {
      const el = panes[p.i];
      if (el && el.className === p.cls) el.scrollTop = p.top;
    });
    if (window.scrollY !== snap.win) window.scrollTo(0, snap.win);
    if (!snap.path) return;
    let cur = root;
    for (const idx of snap.path) {
      cur = cur.childNodes[idx];
      if (!cur) return;
    }
    if (cur === document.activeElement) return;
    if (typeof cur.focus !== "function") return;
    try {
      cur.focus({ preventScroll: true });
      if (snap.selStart !== null && typeof cur.setSelectionRange === "function") {
        cur.setSelectionRange(snap.selStart, snap.selEnd);
      }
    } catch (e) {}
  }

  // 日本語・中国語などのIME入力中は再描画しない（変換が途中で消える不具合の対策）
  let imeComposing = false;
  let renderQueued = false;
  document.addEventListener(
    "compositionstart",
    () => {
      imeComposing = true;
    },
    true,
  );
  document.addEventListener(
    "compositionend",
    () => {
      imeComposing = false;
      // 確定直後の input イベントを先に処理させてから描画する
      setTimeout(() => {
        if (renderQueued) {
          renderQueued = false;
          render();
        }
      }, 0);
    },
    true,
  );

  function render() {
    if (imeComposing) {
      renderQueued = true;
      return;
    }
    const root = document.getElementById("app");
    const snap = captureUiState(root);
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
    if (state.picker) root.appendChild(renderImagePicker());
    if (state.deleteHotel) root.appendChild(renderDeleteHotelModal());
    if (state.deletePage) root.appendChild(renderDeletePageModal());

    // textarea 自動高さ調整
    root.querySelectorAll("textarea[data-autogrow]").forEach((t) => autoGrow(t));

    populateImageDatalist();
    restoreUiState(root, snap);
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
      placeholder: "staff@example.com",
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
    items.push(
      h(
        "button",
        {
          class: "side-item" + (state.currentPage && state.currentPage.kind === "images" ? " active" : ""),
          onClick: () => {
            state.currentPage = { kind: "images" };
            render();
          },
        },
        ["画像", state.upload.queue.length ? h("span", { class: "side-dot" }) : null]
      )
    );
    items.push(h("div", { class: "side-sep" }));
    items.push(h("div", { class: "side-group-title" }, "ホテル"));
    items.push(
      h(
        "button",
        {
          class: "side-item side-item--sub" + (state.currentPage && state.currentPage.kind === "hotelsManage" ? " active" : ""),
          onClick: () => {
            state.currentPage = { kind: "hotelsManage" };
            render();
          },
        },
        ["追加・並び替え・削除"]
      )
    );
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
    items.push(h("div", { class: "side-sep" }));
    items.push(h("div", { class: "side-group-title" }, "ページ"));
    items.push(
      h(
        "button",
        {
          class: "side-item side-item--sub" + (state.currentPage && state.currentPage.kind === "pagesManage" ? " active" : ""),
          onClick: () => {
            state.currentPage = { kind: "pagesManage" };
            render();
          },
        },
        ["追加・並び替え・削除"]
      )
    );
    for (const pg of state.draft["data/pages.json"] || []) {
      items.push(
        h(
          "button",
          {
            class: "side-item" + (state.currentPage && state.currentPage.kind === "page" && state.currentPage.slug === pg.slug ? " active" : ""),
            onClick: () => {
              state.currentPage = { kind: "page", slug: pg.slug };
              render();
            },
          },
          [pageTitleOf(pg), pageHasChanges(pg.slug) ? h("span", { class: "side-dot" }) : null]
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

  function pageTitleOf(pg) {
    if (!pg) return "";
    const t = pg.title;
    if (t && typeof t === "object") return t.ja || pg.slug;
    return t || pg.slug;
  }

  function pageHasChanges(slug) {
    const before = (state.original["data/pages.json"] || []).find((x) => x.slug === slug);
    const after = (state.draft["data/pages.json"] || []).find((x) => x.slug === slug);
    return JSON.stringify(before) !== JSON.stringify(after);
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
    if (state.currentPage.kind === "images") {
      return renderImagesPage();
    }
    if (state.currentPage.kind === "hotelsManage") {
      return renderHotelsManagePage();
    }
    if (state.currentPage.kind === "hotel") {
      return renderHotelPage();
    }
    if (state.currentPage.kind === "pagesManage") {
      return renderPagesManagePage();
    }
    if (state.currentPage.kind === "page") {
      return renderCustomPage();
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

    // GRAND ELE ページのグループでは grand.json を表示する
    let grandFields = [];
    if (group.id === "grandpage") {
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
  // ---------------------------------------------------------------- GRAND ELE ページ（grand.json）
  // 項目の一覧・並び順・見出しは data/admin-schema.json の "grand" が正。
  function grandFieldLabel(pathKey) {
    const parts = pathKey.split(".");
    const head = parts[0];
    const meta = (state.schema.grand || {})[head];
    if (!meta) return pathKey;
    if (parts.length <= 1) return meta.label || head;
    const idx = Number(parts[1]);
    const subKey = parts[2];
    const numLabel = Number.isInteger(idx) ? " #" + (idx + 1) : "";
    if (!subKey) return (meta.label || head) + numLabel;
    const itemLabels = (state.schema.itemLabels && state.schema.itemLabels["grand:" + head]) || {};
    return (meta.label || head) + numLabel + ": " + (itemLabels[subKey] || subKey);
  }

  function renderGrandFields() {
    const grandJa = (state.draft["data/grand.json"] || {}).ja || {};
    const schemaGrand = state.schema.grand || {};
    const out = [];
    for (const [key, meta] of Object.entries(schemaGrand)) {
      out.push(renderGrandField(key, meta, grandJa));
    }
    // スキーマに載っていない項目の取りこぼし防止
    for (const key of Object.keys(grandJa)) {
      if (!schemaGrand[key]) {
        out.push(renderGrandField(key, { label: "（未分類）" + key, kind: guessKind(grandJa[key]) }, grandJa));
      }
    }
    return out;
  }

  function renderGrandField(key, meta, grandJa) {
    const before = getPath((state.original["data/grand.json"] || {}).ja || {}, key);
    const after = getPath(grandJa, key);
    const dirty = JSON.stringify(before) !== JSON.stringify(after);
    const readOnly = state.currentLang !== "ja";

    const onChange = (val) => {
      setPath(state.draft["data/grand.json"].ja, key, val);
      render();
    };

    let control;
    if (meta.kind === "list-text") {
      control = readOnly ? renderTranslationList(after || []) : renderListText(after || [], onChange, readOnly, "grand:" + key);
    } else if (meta.kind === "list-obj") {
      const itemLabels = (state.schema.itemLabels && state.schema.itemLabels["grand:" + key]) || {};
      control = renderListObj(after || [], onChange, readOnly, itemLabels);
    } else if (readOnly) {
      control = renderTranslationField(after, meta.kind === "textarea" ? "textarea" : "text");
    } else if (/画像ID/.test(meta.label || "")) {
      control = renderImageField(after, onChange, readOnly);
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

    return h("div", { class: "field" }, [
      h("div", { class: "field-label-row" }, [h("span", { class: "field-label" }, meta.label), dirty ? h("span", { class: "dirty-dot" }) : null]),
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
        h("div", { class: "obj-card-head" }, [
          h("span", { class: "obj-card-title" }, `#${idx + 1}`),
          // 訳文タブでは並べ替え・削除を出さない（増減は日本語タブで行う）
          readOnly ? null : h("div", { class: "obj-card-controls" }, controls),
        ]),
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
      control = renderImageField(value, update, readOnly);
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
          h("p", null, `${areaLabel(hotel.area)} ・ ${STATUS_LABEL[hotel.status] || hotel.status}`),
        ]),
        renderLangTabs(),
        ...fields,
      ]),
    ]);
  }

  // ---------------------------------------------------------------- 予約エンジン（予約プロ）
  // build.py の booking_config() と同じ計算をブラウザ側でも行い、入力しながら URL を確認できるようにする。
  const YOYAKUPRO_HOST = "www7.489pro.com";

  function yoyakuproUrls(bk) {
    if (!bk || !String(bk.engine || "").trim()) return null;
    const action = String(bk.action || "").trim();
    const top = String(bk.top || "").trim();
    if (action && top) return { action: action, top: top };
    const raw = String(bk.id || "").trim();
    if (!raw) return null;
    let host = String(bk.host || "").trim();
    let fid = raw;
    if (/^https?:/i.test(raw)) {
      const m = raw.match(/[?&]id=(\d+)/);
      if (!m) return null;
      fid = m[1];
      const hm = raw.match(/^https?:\/\/([^/]+)/);
      if (hm && !host) host = hm[1];
    } else if (!/^\d{4,12}$/.test(raw)) {
      return null;
    }
    const baseUrl = "https://" + (host || YOYAKUPRO_HOST) + "/asp/489/menu.asp?id=" + fid;
    return { action: baseUrl + "&ty=ser", top: baseUrl };
  }

  function renderBookingField(hotel, readOnly) {
    const bk = hotel.booking && typeof hotel.booking === "object" ? hotel.booking : {};
    const engine = String(bk.engine || "");

    const patch = (kv) => {
      hotel.booking = { ...(hotel.booking && typeof hotel.booking === "object" ? hotel.booking : {}), ...kv };
      render();
    };

    const engineSel = h(
      "select",
      {
        disabled: readOnly,
        onChange: (e) => {
          const v = e.target.value;
          if (!v) {
            hotel.booking = { ...(hotel.booking || {}), engine: "" };
          } else {
            const next = {
              engine: v,
              id: String(bk.id || ""),
              max_guests: Number(bk.max_guests) || 5,
              max_nights: Number(bk.max_nights) || 5,
              max_rooms: Number(bk.max_rooms) || 5,
            };
            if (String(bk.host || "").trim()) next.host = String(bk.host).trim();
            hotel.booking = next;
          }
          render();
        },
      },
      [
        h("option", { value: "", selected: engine !== "yoyakupro" }, "使わない（予約サイトリンクのみ表示）"),
        h("option", { value: "yoyakupro", selected: engine === "yoyakupro" }, "予約プロを使う（ページ内に予約フォームを表示）"),
      ]
    );

    const rows = [
      h("div", { class: "obj-card-field" }, [h("span", { class: "field-label" }, "予約フォームの表示"), engineSel]),
    ];

    if (engine === "yoyakupro") {
      const legacy = Boolean(String(bk.action || "").trim() && String(bk.top || "").trim());
      const idInput = h("input", {
        type: "text",
        readOnly: readOnly,
        disabled: readOnly,
        placeholder: "27000054　または　https://www7.489pro.com/asp/489/menu.asp?id=27000054",
        value: String(bk.id || ""),
        onInput: (e) => patch({ id: e.target.value }),
      });
      rows.push(
        h("div", { class: "obj-card-field" }, [
          h("span", { class: "field-label" }, "施設ID または 予約プロの URL"),
          idInput,
          h(
            "p",
            { class: "field-help" },
            "予約プロと契約すると発行される数字の施設IDを入れてください。管理画面の URL をまるごと貼り付けても構いません（IDを自動で読み取ります）。"
          ),
        ])
      );

      const urls = yoyakuproUrls(hotel.booking);
      if (legacy) {
        rows.push(
          h("p", { class: "field-help" }, "※ 旧設定（URL直接指定）が残っています。施設IDを入れて保存すると自動生成に切り替わります。")
        );
      }
      rows.push(
        h("div", { class: "obj-card-field" }, [
          h("span", { class: "field-label" }, "確認：実際に使われる予約先"),
          urls
            ? h("div", { class: "hm-url-preview" }, [
                h("div", null, "検索ボタン → " + urls.action),
                h("div", null, "「予約サイトを開く」→ " + urls.top),
              ])
            : h("div", { class: "hm-url-preview" }, "施設IDがまだ読み取れません。数字のIDか、id=… を含む URL を入れてください。（このままだと予約フォームは表示されません）"),
        ])
      );

      const num = (k, label) =>
        h("div", { class: "obj-card-field" }, [
          h("span", { class: "field-label" }, label),
          h("input", {
            type: "number",
            min: "1",
            max: "30",
            readOnly: readOnly,
            disabled: readOnly,
            value: Number(bk[k]) || 5,
            onInput: (e) => patch({ [k]: e.target.value === "" ? 5 : Math.max(1, Math.min(30, Number(e.target.value))) }),
          }),
        ]);
      rows.push(num("max_guests", "選べる人数の上限（名）"));
      rows.push(num("max_nights", "選べる泊数の上限（泊）"));
      rows.push(num("max_rooms", "選べる部屋数の上限（室）"));
    } else {
      rows.push(
        h(
          "p",
          { class: "field-help" },
          "「使わない」のときは、下の「予約サイトリンク」に登録した外部サイト（楽天トラベル・じゃらん等）だけが表示されます。"
        )
      );
    }

    return h("div", { class: "obj-card" }, [h("div", { class: "obj-card-head" }, [h("span", { class: "obj-card-title" }, "予約プロ設定")]), ...rows]);
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

    if (meta.kind === "booking") {
      control = renderBookingField(hotel, readOnly);
    } else if (meta.kind === "readonly") {
      control = h("div", { class: "readonly-value" }, String(jaValue == null ? "" : jaValue));
    } else if (meta.kind === "select") {
      const optLabelMap = key === "area" ? areaLabelMap() : key === "status" ? STATUS_LABEL : key === "brand" ? BRAND_LABEL : {};
      control = h(
        "select",
        {
          disabled: readOnly,
          onChange: (e) => update(e.target.value),
        },
        (key === "area" ? areaDefs().map((a) => a.key) : meta.options).map((opt) =>
          h("option", { value: opt, selected: opt === rawValue }, optLabelMap[opt] || opt)
        )
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
        control = renderImageField(rawValue, update, readOnly);
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

  /** ギャラリーのキャプションは決まった種類から選ぶ（site.json の photo_labels が正） */
  function photoLabelMap() {
    const site = state.draft["data/site.json"] || {};
    const ja = site.ja || {};
    return ja.photo_labels && typeof ja.photo_labels === "object" ? ja.photo_labels : {};
  }

  function renderCaptionSelect(value, update, readOnly) {
    const map = photoLabelMap();
    const code = typeof value === "string" ? value : "";
    const codes = Object.keys(map);
    const opts = [h("option", { value: "" }, "（なし）")];
    for (const c of codes) opts.push(h("option", { value: c }, `${map[c]}（${c}）`));
    // 一覧に無い値が入っていても失わないように、その値も選択肢として残す
    if (code && !codes.includes(code)) opts.push(h("option", { value: code }, `${code}（一覧にない値）`));
    const sel = h("select", { disabled: readOnly, onChange: (e) => update(e.target.value) }, opts);
    sel.value = code;
    return sel;
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
        const isCaptionField = subKey === "label" && /キャプション/.test(subLabel);

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
        if (readOnly && isI18nSub && typeof jaVal === "string") {
          // 日本語以外のタブ: 訳文をここで直せるようにする（客室タイプの名称・仕様など）
          control = renderTranslationField(jaVal, jaVal.length > 40 ? "textarea" : "text");
        } else if (isCaptionField) {
          control = renderCaptionSelect(jaVal, update, readOnly);
        } else if (Array.isArray(jaVal)) {
          // 配列値のサブフィールドを一行ごとの入力行で編集できるようにする（現在の hotels.json には例はないが安全対策）
          control = h("div", { class: "obj-subarray" }, [renderListText(jaVal, (newArr) => update(newArr), readOnly)]);
        } else if (isImgField) {
          control = renderImageField(jaVal, update, readOnly);
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
        h("div", { class: "obj-card-head" }, [
          h("span", { class: "obj-card-title" }, `#${idx + 1}`),
          // 訳文タブでは並べ替え・削除を出さない（増減は日本語タブで行う）
          readOnly ? null : h("div", { class: "obj-card-controls" }, controls),
        ]),
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

    return h("div", null, [
      h("div", { class: "obj-cards" }, cards),
      readOnly ? h("div", { class: "trans-note" }, "項目の追加・削除・並べ替えは日本語タブで行ってください。") : addBtn,
    ]);
  }

  // ============================================================ 追加ページ（自由に作れるページ）

  const PAGE_SECTION_TEMPLATE = () => ({ h: { ja: "" }, body: { ja: "" } });

  function blankPage(slug, title) {
    return {
      slug: slug,
      title: { ja: title || "" },
      eyebrow: "",
      lead: { ja: "" },
      sections: [PAGE_SECTION_TEMPLATE()],
      meta_title: { ja: "" },
      meta_desc: { ja: "" },
    };
  }

  function newPageSlugError(slug) {
    const pages = state.draft["data/pages.json"] || [];
    const hotels = state.draft["data/hotels.json"] || [];
    if (!slug) return "URL用の名前を入れてください。";
    if (!SLUG_OK.test(slug)) return "半角小文字・数字・ハイフンのみ、3文字以上で入れてください（例: recruit）。";
    if (pages.some((x) => x.slug === slug)) return "同じURL用の名前のページがすでにあります。";
    if (hotels.some((x) => x.slug === slug)) return "同じ名前のホテルがあります。別の名前にしてください。";
    return "";
  }

  function renderCustomPage() {
    const pages = state.draft["data/pages.json"] || [];
    const pg = pages.find((x) => x.slug === state.currentPage.slug);
    if (!pg) {
      return h("main", { class: "main" }, [h("div", { class: "main-inner" }, [h("div", { class: "error-state" }, "ページが見つかりません。")])]);
    }
    const before = (state.original["data/pages.json"] || []).find((x) => x.slug === pg.slug) || {};
    const fields = Object.entries(state.schema.page || {}).map(([key, meta]) => renderHotelField(pg, before, key, meta));
    return h("main", { class: "main" }, [
      h("div", { class: "main-inner" }, [
        h("div", { class: "group-head" }, [
          h("h1", null, pageTitleOf(pg)),
          h("p", null, `公開URL: /pages/${pg.slug}.html（5言語ぶん自動で作られます）`),
        ]),
        h(
          "p",
          { class: "hm-lead" },
          "メニューに出したいときは、左メニューの「メニュー（ヘッダー・フッター）」で リンク先に /pages/" + pg.slug + " と入れてください。"
        ),
        renderLangTabs(),
        ...fields,
      ]),
    ]);
  }

  function renderPagesManagePage() {
    const pages = state.draft["data/pages.json"] || [];
    const before = state.original["data/pages.json"] || [];
    const orderChanged = JSON.stringify(before.map((x) => x.slug)) !== JSON.stringify(pages.map((x) => x.slug));
    const np = state.newPage || { slug: "", title: "" };
    state.newPage = np;
    const slugErr = np.slug || np.title ? newPageSlugError(np.slug) : "";

    const move = (idx, delta) => {
      const copy = pages.slice();
      [copy[idx + delta], copy[idx]] = [copy[idx], copy[idx + delta]];
      state.draft["data/pages.json"] = copy;
      render();
    };

    const rows = pages.map((pg, idx) =>
      h("div", { class: "hm-row" }, [
        h("span", { class: "hm-no" }, String(idx + 1)),
        h("div", { class: "hm-body" }, [
          h("div", { class: "hm-name" }, pageTitleOf(pg)),
          h("div", { class: "hm-meta" }, `/pages/${pg.slug}.html`),
        ]),
        h("div", { class: "hm-ctrl" }, [
          h("button", { class: "btn btn-sm btn-ghost", onClick: () => ((state.currentPage = { kind: "page", slug: pg.slug }), (state.currentLang = "ja"), render()) }, "編集"),
          h("button", { class: "btn btn-icon btn-ghost", title: "上へ", disabled: idx === 0, onClick: () => move(idx, -1) }, "↑"),
          h("button", { class: "btn btn-icon btn-ghost", title: "下へ", disabled: idx === pages.length - 1, onClick: () => move(idx, 1) }, "↓"),
          h(
            "button",
            {
              class: "btn btn-sm btn-danger-ghost",
              title: "削除",
              onClick: () => {
                state.deletePage = { slug: pg.slug, name: pageTitleOf(pg), confirm: "" };
                render();
              },
            },
            "削除"
          ),
        ]),
      ])
    );

    const addForm = h("div", { class: "hm-add" }, [
      h("h2", null, "ページを追加"),
      h("p", { class: "hm-add-note" }, "追加したあと、内容を入力して保存して公開すると、5言語ぶんのページが自動で作られます。メニューに出すかどうかは別に設定できます。"),
      h("div", { class: "hm-add-grid" }, [
        h("label", null, [
          h("span", { class: "field-label" }, "ページタイトル（日本語）"),
          h("input", {
            type: "text",
            value: np.title,
            placeholder: "採用情報",
            onInput: (e) => {
              np.title = e.target.value;
            },
          }),
        ]),
        h("label", null, [
          h("span", { class: "field-label" }, "URL用の名前（半角英数字）"),
          h("input", {
            type: "text",
            value: np.slug,
            placeholder: "recruit",
            onInput: (e) => {
              np.slug = e.target.value.trim().toLowerCase();
              const box = document.getElementById("pmSlugMsg");
              const btn = document.getElementById("pmAddBtn");
              const msg = newPageSlugError(np.slug);
              if (box) {
                box.textContent = msg;
                box.hidden = !msg;
              }
              if (btn) btn.disabled = Boolean(msg);
            },
          }),
          h("span", { class: "hm-url-preview" }, `公開URL: /pages/${np.slug || "○○○"}.html`),
        ]),
      ]),
      h("div", { class: "up-err", id: "pmSlugMsg", hidden: !slugErr }, slugErr),
      h(
        "button",
        {
          class: "btn btn-primary",
          id: "pmAddBtn",
          disabled: Boolean(newPageSlugError(np.slug)),
          onClick: () => {
            if (newPageSlugError(np.slug)) return;
            const fresh = blankPage(np.slug, np.title);
            state.draft["data/pages.json"] = pages.concat([fresh]);
            state.newPage = { slug: "", title: "" };
            state.currentPage = { kind: "page", slug: fresh.slug };
            state.currentLang = "ja";
            pushToast(`「${np.title || np.slug}」を追加しました。内容を入力して保存してください。`, "ok");
            render();
          },
        },
        "このページを追加"
      ),
    ]);

    return h("main", { class: "main" }, [
      h("div", { class: "main-inner" }, [
        h("div", { class: "group-head" }, [
          h("h1", null, "ページの追加・並び替え・削除"),
          h("p", null, `全 ${pages.length} 件${orderChanged ? "（並び順が未保存です）" : ""}`),
        ]),
        h("p", { class: "hm-lead" }, "会社案内・採用情報・利用規約など、自由なページを作れます。作ったページは自動で5言語に翻訳されます。"),
        pages.length ? h("div", { class: "hm-list" }, rows) : h("div", { class: "empty-state" }, "まだページがありません。下から追加してください。"),
        addForm,
      ]),
    ]);
  }

  function renderDeletePageModal() {
    const d = state.deletePage;
    if (!d) return null;
    const pages = state.draft["data/pages.json"] || [];
    const ok = d.confirm.trim() === d.slug;
    return h("div", { class: "modal-overlay", onClick: (e) => e.target.classList.contains("modal-overlay") && ((state.deletePage = null), render()) }, [
      h("div", { class: "modal" }, [
        h("div", { class: "modal-head" }, [
          h("h2", null, "ページを削除"),
          h("button", { class: "btn btn-icon btn-ghost", onClick: () => ((state.deletePage = null), render()) }, "×"),
        ]),
        h("div", { class: "modal-body" }, [
          h("p", null, `「${d.name}」を削除します。保存して公開すると、5言語のページ（/pages/${d.slug}.html など）が消えます。`),
          h("p", { class: "up-warn" }, "メニューにこのページへのリンクを入れている場合は、メニュー側も消してください。あとで元に戻すことはできません。"),
          h("p", null, ["確認のため ", h("code", null, d.slug), " と入力してください。"]),
          h("input", {
            type: "text",
            value: d.confirm,
            placeholder: d.slug,
            onInput: (e) => {
              d.confirm = e.target.value;
              const btn = document.getElementById("pmDelBtn");
              if (btn) btn.disabled = e.target.value.trim() !== d.slug;
            },
          }),
        ]),
        h("div", { class: "modal-foot" }, [
          h("button", { class: "btn btn-ghost", onClick: () => ((state.deletePage = null), render()) }, "やめる"),
          h(
            "button",
            {
              class: "btn btn-danger",
              id: "pmDelBtn",
              disabled: !ok,
              onClick: () => {
                state.draft["data/pages.json"] = pages.filter((x) => x.slug !== d.slug);
                if (state.currentPage && state.currentPage.kind === "page" && state.currentPage.slug === d.slug) {
                  state.currentPage = { kind: "pagesManage" };
                }
                state.deletePage = null;
                pushToast(`「${d.name}」を削除しました。保存して公開すると反映されます。`, "ok");
                render();
              },
            },
            "削除する"
          ),
        ]),
      ]),
    ]);
  }

  // ============================================================ ホテルの追加・並び替え・削除

  const SLUG_OK = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

  /** 既存ホテルの形をそのまま借りて、文字と項目を空にした「白紙のホテル」を作る */
  function blankHotelFrom(src) {
    const emptyOut = (v) => {
      if (Array.isArray(v)) return [];
      if (v && typeof v === "object") {
        const out = {};
        for (const k of Object.keys(v)) out[k] = emptyOut(v[k]);
        return out;
      }
      if (typeof v === "number") return 0;
      return "";
    };
    const t = emptyOut(deepClone(src || {}));
    // 言語別の項目は日本語だけ残す（他言語は保存時に自動翻訳される）
    for (const k of Object.keys(t)) {
      const orig = src ? src[k] : null;
      if (orig && typeof orig === "object" && !Array.isArray(orig) && "ja" in orig) {
        t[k] = Array.isArray(orig.ja) ? { ja: [] } : { ja: "" };
      }
    }
    return t;
  }

  function newHotelSlugError(slug) {
    const hotels = state.draft["data/hotels.json"] || [];
    if (!slug) return "URL用の名前を入れてください。";
    if (!SLUG_OK.test(slug)) return "半角小文字・数字・ハイフンのみ、3文字以上で入れてください（例: shibuya-east）。";
    if (hotels.some((x) => x.slug === slug)) return "同じURL用の名前のホテルがすでにあります。";
    return "";
  }

  function renderHotelsManagePage() {
    const hotels = state.draft["data/hotels.json"] || [];
    const before = state.original["data/hotels.json"] || [];
    const orderChanged = JSON.stringify(before.map((x) => x.slug)) !== JSON.stringify(hotels.map((x) => x.slug));
    const nh = state.newHotel || { slug: "", name: "", area: "tokyo", brand: (hotels[0] || {}).brand || "hotel" };
    state.newHotel = nh;
    const slugErr = nh.slug || nh.name ? newHotelSlugError(nh.slug) : "";

    const move = (idx, delta) => {
      const copy = hotels.slice();
      [copy[idx + delta], copy[idx]] = [copy[idx], copy[idx + delta]];
      state.draft["data/hotels.json"] = copy;
      render();
    };

    const rows = hotels.map((hotel, idx) =>
      h("div", { class: "hm-row" }, [
        h("span", { class: "hm-no" }, String(idx + 1)),
        h("div", { class: "hm-body" }, [
          h("div", { class: "hm-name" }, (hotel.name && hotel.name.ja) || hotel.slug),
          h("div", { class: "hm-meta" }, `${areaLabel(hotel.area)} ・ ${STATUS_LABEL[hotel.status] || hotel.status} ・ /hotels/${hotel.slug}`),
        ]),
        h("div", { class: "hm-ctrl" }, [
          h("button", { class: "btn btn-icon btn-ghost", title: "上へ", disabled: idx === 0, onClick: () => move(idx, -1) }, "↑"),
          h("button", { class: "btn btn-icon btn-ghost", title: "下へ", disabled: idx === hotels.length - 1, onClick: () => move(idx, 1) }, "↓"),
          h(
            "button",
            {
              class: "btn btn-sm btn-danger-ghost",
              title: "削除",
              onClick: () => {
                state.deleteHotel = { slug: hotel.slug, name: (hotel.name && hotel.name.ja) || hotel.slug, confirm: "" };
                render();
              },
            },
            "削除"
          ),
        ]),
      ])
    );

    const addForm = h("div", { class: "hm-add" }, [
      h("h2", null, "ホテルを追加"),
      h("p", { class: "hm-add-note" }, "追加したあと、左のメニューからそのホテルを選んで内容を入力してください。保存して公開すると5言語のページが自動で作られます。"),
      h("div", { class: "hm-add-grid" }, [
        h("label", null, [
          h("span", { class: "field-label" }, "ホテル名（日本語）"),
          h("input", {
            type: "text",
            value: nh.name,
            placeholder: "ELE Hotel 渋谷イースト",
            onInput: (e) => {
              nh.name = e.target.value;
            },
          }),
        ]),
        h("label", null, [
          h("span", { class: "field-label" }, "URL用の名前（半角英数字）"),
          h("input", {
            type: "text",
            value: nh.slug,
            placeholder: "shibuya-east",
            onInput: (e) => {
              nh.slug = e.target.value.trim().toLowerCase();
              const box = document.getElementById("hmSlugMsg");
              const btn = document.getElementById("hmAddBtn");
              const msg = newHotelSlugError(nh.slug);
              if (box) {
                box.textContent = msg;
                box.hidden = !msg;
              }
              if (btn) btn.disabled = Boolean(msg);
            },
          }),
          h("span", { class: "hm-url-preview" }, `公開URL: /hotels/${nh.slug || "○○○"}.html`),
        ]),
        h("label", null, [
          h("span", { class: "field-label" }, "エリア"),
          (() => {
            const sel = h(
              "select",
              { onChange: (e) => (nh.area = e.target.value) },
              areaDefs().map((a) => h("option", { value: a.key }, a.label))
            );
            sel.value = nh.area;
            return sel;
          })(),
        ]),
      ]),
      h("div", { class: "up-err", id: "hmSlugMsg", hidden: !slugErr }, slugErr),
      h(
        "button",
        {
          class: "btn btn-primary",
          id: "hmAddBtn",
          disabled: Boolean(newHotelSlugError(nh.slug)),
          onClick: () => {
            const msg = newHotelSlugError(nh.slug);
            if (msg) return;
            const copy = hotels.slice();
            const fresh = blankHotelFrom(copy[0]);
            fresh.slug = nh.slug;
            fresh.area = nh.area;
            fresh.status = "soon";
            fresh.brand = nh.brand || "hotel";
            if (fresh.name && typeof fresh.name === "object") fresh.name.ja = nh.name || "";
            else fresh.name = { ja: nh.name || "" };
            copy.push(fresh);
            state.draft["data/hotels.json"] = copy;
            state.newHotel = { slug: "", name: "", area: "tokyo", brand: nh.brand };
            state.currentPage = { kind: "hotel", slug: fresh.slug };
            state.currentLang = "ja";
            pushToast(`「${nh.name || nh.slug}」を追加しました。内容を入力して保存してください。`, "ok");
            render();
          },
        },
        "このホテルを追加"
      ),
    ]);

    return h("main", { class: "main" }, [
      h("div", { class: "main-inner" }, [
        h("div", { class: "group-head" }, [
          h("h1", null, "ホテルの追加・並び替え・削除"),
          h("p", null, `全 ${hotels.length} 件${orderChanged ? "（並び順が未保存です）" : ""}`),
        ]),
        h("p", { class: "hm-lead" }, "この並び順が、トップページのホテル一覧とメニューの順番になります。"),
        h("div", { class: "hm-list" }, rows),
        addForm,
      ]),
    ]);
  }

  /** 削除は取り返しがつかないので、名前を打ち込ませてから確定する */
  function renderDeleteHotelModal() {
    const d = state.deleteHotel;
    if (!d) return null;
    const hotels = state.draft["data/hotels.json"] || [];
    const ok = d.confirm.trim() === d.slug;
    return h("div", { class: "modal-overlay", onClick: (e) => e.target.classList.contains("modal-overlay") && (state.deleteHotel = null, render()) }, [
      h("div", { class: "modal" }, [
        h("div", { class: "modal-head" }, [
          h("h2", null, "ホテルを削除"),
          h("button", { class: "btn btn-icon btn-ghost", onClick: () => ((state.deleteHotel = null), render()) }, "×"),
        ]),
        h("div", { class: "modal-body" }, [
          h("p", null, `「${d.name}」を削除します。保存して公開すると、5言語のページ（/hotels/${d.slug}.html など）が消え、トップページの一覧からも外れます。`),
          h("p", { class: "up-warn" }, "写真そのものは残ります。あとで元に戻すことはできません。"),
          h("p", null, ["確認のため ", h("code", null, d.slug), " と入力してください。"]),
          h("input", {
            type: "text",
            value: d.confirm,
            placeholder: d.slug,
            onInput: (e) => {
              d.confirm = e.target.value;
              const btn = document.getElementById("hmDelBtn");
              if (btn) btn.disabled = e.target.value.trim() !== d.slug;
            },
          }),
        ]),
        h("div", { class: "modal-foot" }, [
          h("button", { class: "btn btn-ghost", onClick: () => ((state.deleteHotel = null), render()) }, "やめる"),
          h(
            "button",
            {
              class: "btn btn-danger",
              id: "hmDelBtn",
              disabled: !ok,
              onClick: () => {
                state.draft["data/hotels.json"] = hotels.filter((x) => x.slug !== d.slug);
                if (state.currentPage && state.currentPage.kind === "hotel" && state.currentPage.slug === d.slug) {
                  state.currentPage = { kind: "hotelsManage" };
                }
                state.deleteHotel = null;
                pushToast(`「${d.name}」を削除しました。保存して公開すると反映されます。`, "ok");
                render();
              },
            },
            "削除する"
          ),
        ]),
      ]),
    ]);
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


  // ============================================================ 画像：変換とアップロード
  //
  //  ブラウザの中で webp に変換してから送る。サーバーに画像処理を置かないので速く、
  //  tools/import_image.py と同じ規格（長辺 1800 / 900、品質 80 / 76）で作る。

  const IMG_VARIANTS = [
    { suffix: "", maxSide: 1800, quality: 0.8, key: "full" },
    { suffix: "-sm", maxSide: 900, quality: 0.76, key: "sm" },
  ];
  const IMG_NAME_OK = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

  /** ファイル名から画像IDの候補を作る（例: "銀座 Room 01.JPG" → "ginza-room-01"） */
  function suggestImageName(fileName) {
    let base = String(fileName).replace(/\.[^.]+$/, "");
    base = base
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/-sm$/, "-sm2")
      .slice(0, 60);
    return IMG_NAME_OK.test(base) ? base : "";
  }

  function uniqueImageName(base, taken) {
    if (!base) return "";
    if (!taken.has(base)) return base;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}-${i}`.slice(0, 60);
      if (!taken.has(candidate)) return candidate;
    }
    return "";
  }

  const blobToB64 = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(blob);
    });

  function canvasToWebp(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob && blob.type === "image/webp" ? resolve(blob) : reject(new Error("webp_unsupported"))),
        "image/webp",
        quality
      );
    });
  }

  /** 1枚を 2 サイズの webp に変換して base64 で返す */
  async function convertImage(file) {
    // 写真の向き（EXIF）を反映させる
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const out = { width: bitmap.width, height: bitmap.height, originalBytes: file.size };
    try {
      for (const v of IMG_VARIANTS) {
        const scale = Math.min(1, v.maxSide / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h2 = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h2;
        const ctx = canvas.getContext("2d");
        // 透過画像が黒くならないように白で埋めてから描く（既存の写真は全て不透過）
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h2);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, w, h2);
        const blob = await canvasToWebp(canvas, v.quality);
        out[v.key] = await blobToB64(blob);
        out[v.key + "Bytes"] = blob.size;
        if (v.key === "sm") out.previewUrl = URL.createObjectURL(blob);
      }
    } finally {
      if (bitmap.close) bitmap.close();
    }
    return out;
  }

  const fmtKB = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.round(n / 1024) + " KB");

  /** 選ばれたファイルを待ち行列に入れて順番に変換する */
  async function addFilesToQueue(fileList) {
    const files = [...fileList].filter((f) => /^image\//.test(f.type));
    const skipped = [...fileList].length - files.length;
    if (skipped > 0) pushToast(`画像でないファイル ${skipped} 件は除きました。`, "error");
    if (!files.length) return;

    const taken = new Set([...state.images, ...state.upload.queue.map((q) => q.name)]);
    for (const file of files) {
      const base = uniqueImageName(suggestImageName(file.name), taken);
      const entry = {
        id: `u${state.upload.seq++}`,
        fileName: file.name,
        name: base,
        nameEdited: false,
        status: "converting",
        error: null,
      };
      if (base) taken.add(base);
      state.upload.queue.push(entry);
      render();

      try {
        const conv = await convertImage(file);
        Object.assign(entry, conv, { status: "ready" });
      } catch (e) {
        entry.status = "error";
        entry.error =
          String(e).indexOf("webp_unsupported") >= 0
            ? "このブラウザは webp 変換に対応していません。Chrome / Edge / Safari の最新版をお使いください。"
            : "画像を読み込めませんでした。ファイルが壊れていないかご確認ください。";
      }
      render();
    }
  }

  function removeFromQueue(id) {
    const i = state.upload.queue.findIndex((q) => q.id === id);
    if (i < 0) return;
    const entry = state.upload.queue[i];
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    state.upload.queue.splice(i, 1);
    render();
  }

  function clearQueue() {
    for (const q of state.upload.queue) if (q.previewUrl) URL.revokeObjectURL(q.previewUrl);
    state.upload.queue = [];
  }

  /** 画像IDの重複・書式をまとめて検査する */
  function validateQueue() {
    const problems = [];
    const seen = new Map();
    for (const q of state.upload.queue) {
      if (q.status === "error") continue;
      if (!q.name) {
        problems.push({ id: q.id, message: "画像IDを入力してください。" });
        continue;
      }
      if (!IMG_NAME_OK.test(q.name)) {
        problems.push({ id: q.id, message: "半角小文字・数字・ハイフンのみ、2〜60文字で入力してください。" });
        continue;
      }
      if (q.name.endsWith("-sm")) {
        problems.push({ id: q.id, message: "末尾の -sm は自動で作られるため使えません。" });
        continue;
      }
      if (seen.has(q.name)) {
        problems.push({ id: q.id, message: "同じ画像IDが重複しています。" });
        continue;
      }
      seen.set(q.name, true);
    }
    return problems;
  }

  /** 入力中でもエラー表示だけを更新する（再描画せずカーソルを保つ） */
  function refreshQueueProblems() {
    const problems = validateQueue();
    const next = {};
    for (const p of problems) next[p.id] = p.message;
    state.upload.problems = next;
    const root = document.getElementById("upList");
    if (!root) return;
    for (const entry of state.upload.queue) {
      const row = root.querySelector(`[data-up="${entry.id}"]`);
      if (!row) continue;
      const msg = next[entry.id] || "";
      let box = row.querySelector(".up-err");
      if (msg) {
        if (!box) {
          box = document.createElement("div");
          box.className = "up-err";
          const meta = row.querySelector(".up-meta");
          const body = row.querySelector(".up-body");
          if (meta) body.insertBefore(box, meta);
          else if (body) body.appendChild(box);
        }
        box.textContent = msg;
      } else if (box) {
        box.remove();
      }
      row.classList.toggle("up-row-err", Boolean(msg) || entry.status === "error");
      const warn = row.querySelector(".up-warn");
      const dup = entry.name && state.images.includes(entry.name);
      if (warn) warn.hidden = !dup;
    }
    const btn = document.getElementById("upSubmit");
    if (btn) btn.disabled = state.upload.busy || problems.length > 0 || !state.upload.queue.some((q) => q.status === "ready");
  }

  function overwriteNames() {
    return state.upload.queue.filter((q) => q.status !== "error" && q.name && state.images.includes(q.name)).map((q) => q.name);
  }

  async function submitUpload() {
    if (state.upload.busy) return;
    const problems = validateQueue();
    state.upload.problems = {};
    for (const p of problems) state.upload.problems[p.id] = p.message;
    if (problems.length) {
      render();
      pushToast("画像IDをご確認ください。", "error");
      return;
    }
    const ready = state.upload.queue.filter((q) => q.status === "ready");
    if (!ready.length) {
      pushToast("アップロードできる画像がありません。", "error");
      return;
    }
    const dupes = overwriteNames();
    if (dupes.length && !confirm(`次の画像を上書きします。よろしいですか？\n\n${dupes.join("\n")}`)) return;

    state.upload.busy = true;
    render();
    try {
      const res = await api("/upload", {
        method: "POST",
        body: JSON.stringify({ items: ready.map((q) => ({ name: q.name, full: q.full, sm: q.sm })) }),
      });
      if (!res.data || !res.data.ok) {
        const d = res.data || {};
        pushToast(d.hint || (d.error === "conflict" ? "ほかの方が先に保存しました。画面を再読み込みしてください。" : "アップロードできませんでした。"), "error");
        state.upload.busy = false;
        render();
        return;
      }
      const names = res.data.names || [];
      // 画像一覧に反映（再読み込みしなくても選べるようにする）
      const merged = new Set([...state.images, ...names]);
      state.images = [...merged].sort();
      populateImageDatalist();
      clearQueue();
      state.upload.busy = false;
      state.upload.justUploaded = names;
      pushToast(`${names.length}枚をアップロードしました。約1分で公開されます。`, "ok");
      render();
      startStatusPolling();
    } catch (e) {
      state.upload.busy = false;
      pushToast("サーバーに接続できませんでした。", "error");
      render();
    }
  }

  // ------------------------------------------------------------ 画像ページ

  function renderImagesPage() {
    const q = state.upload;
    const fileInput = h("input", {
      type: "file",
      accept: "image/*",
      multiple: true,
      id: "imgFile",
      style: "display:none",
      onChange: (e) => {
        addFilesToQueue(e.target.files);
        e.target.value = "";
      },
    });

    const dropZone = h(
      "div",
      {
        class: "drop" + (q.dragging ? " drop-on" : ""),
        onDragOver: (e) => {
          e.preventDefault();
          if (!q.dragging) {
            q.dragging = true;
            render();
          }
        },
        onDragLeave: () => {
          q.dragging = false;
          render();
        },
        onDrop: (e) => {
          e.preventDefault();
          q.dragging = false;
          addFilesToQueue(e.dataTransfer.files);
        },
        onClick: () => document.getElementById("imgFile").click(),
      },
      [
        h("div", { class: "drop-icon" }, "＋"),
        h("div", { class: "drop-title" }, "ここに写真をドラッグ、またはクリックして選択"),
        h("div", { class: "drop-note" }, "JPEG / PNG / HEIC などをそのまま入れてください。webp への変換と縮小はこの画面で自動的に行います。"),
      ]
    );

    const rows = q.queue.map((entry) =>
      h("div", { class: "up-row" + (entry.status === "error" || q.problems[entry.id] ? " up-row-err" : ""), "data-up": entry.id }, [
        entry.previewUrl
          ? h("img", { class: "up-thumb", src: entry.previewUrl, alt: "" })
          : h("div", { class: "up-thumb up-thumb-empty" }, entry.status === "converting" ? h("span", { class: "spin" }, "⟳") : "—"),
        h("div", { class: "up-body" }, [
          h("div", { class: "up-file" }, entry.fileName),
          entry.status === "error"
            ? h("div", { class: "up-err" }, entry.error)
            : h("div", { class: "up-name" }, [
                h("label", null, "画像ID"),
                h("input", {
                  type: "text",
                  value: entry.name,
                  placeholder: "ginza-room-01",
                  spellcheck: false,
                  onInput: (e) => {
                    entry.name = e.target.value.trim().toLowerCase();
                    entry.nameEdited = true;
                    refreshQueueProblems();
                  },
                  onChange: () => {
                    refreshQueueProblems();
                    render();
                  },
                }),
              ]),
          q.problems[entry.id] ? h("div", { class: "up-err" }, q.problems[entry.id]) : null,
          entry.status === "ready"
            ? h("div", { class: "up-meta" }, [
                `${entry.width}×${entry.height}px`,
                h("span", { class: "up-sep" }, "・"),
                `元 ${fmtKB(entry.originalBytes)} → ${fmtKB(entry.fullBytes)} + ${fmtKB(entry.smBytes)}`,
                h("span", { class: "up-warn", hidden: !(entry.name && state.images.includes(entry.name)) }, "既存の画像を上書きします"),
              ])
            : null,
        ]),
        h("button", { class: "btn btn-ghost btn-sm", onClick: () => removeFromQueue(entry.id) }, "取り消す"),
      ])
    );

    const readyCount = q.queue.filter((x) => x.status === "ready").length;

    const panel = q.queue.length
      ? h("div", { class: "card" }, [
          h("div", { class: "card-head" }, [h("h3", null, `アップロードする画像（${readyCount}枚）`)]),
          h("div", { class: "up-list", id: "upList" }, rows),
          h("div", { class: "up-foot" }, [
            h(
              "button",
              { class: "btn btn-primary", id: "upSubmit", disabled: q.busy || !readyCount || Object.keys(q.problems).length > 0, onClick: submitUpload },
              q.busy ? "アップロード中…" : `${readyCount}枚をアップロードして公開`
            ),
            h(
              "button",
              {
                class: "btn btn-ghost",
                disabled: q.busy,
                onClick: () => {
                  clearQueue();
                  render();
                },
              },
              "すべて取り消す"
            ),
          ]),
        ])
      : null;

    const gallery = h("div", { class: "card" }, [
      h("div", { class: "card-head" }, [
        h("h3", null, `登録済みの画像（${state.images.length}枚）`),
        h("input", {
          type: "search",
          class: "img-search",
          placeholder: "画像IDで絞り込む",
          value: q.filter,
          onInput: (e) => {
            q.filter = e.target.value.trim().toLowerCase();
            render();
          },
        }),
      ]),
      h(
        "div",
        { class: "img-grid" },
        state.images
          .filter((id) => !q.filter || id.includes(q.filter))
          .map((id) =>
            h("div", { class: "img-cell" + (q.justUploaded.includes(id) ? " img-cell-new" : "") }, [
              h("img", { src: `/assets/img/${id}-sm.webp`, alt: id, loading: "lazy" }),
              h("div", { class: "img-cell-id", title: id }, id),
              h(
                "button",
                {
                  class: "btn btn-ghost btn-sm",
                  onClick: () => {
                    copyText(id);
                    pushToast(`画像ID「${id}」をコピーしました。`, "ok");
                  },
                },
                "IDをコピー"
              ),
            ])
          )
      ),
    ]);

    return h("main", { class: "main" }, [
      h("div", { class: "main-inner" }, [
        h("div", { class: "group-head" }, [
          h("h1", null, "画像"),
          h("p", null, "写真を追加すると、パソコン用（長辺1800px）と スマートフォン用（長辺900px）の2種類が自動で作られます。追加した画像は各ページの「画像ID」欄で選べます。"),
        ]),
        fileInput,
        dropZone,
        panel,
        gallery,
      ]),
    ]);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (_) {}
    document.body.removeChild(ta);
  }

  // ------------------------------------------------------------ 画像を選ぶダイアログ

  function openImagePicker(currentValue, onPick) {
    state.picker = { value: currentValue || "", filter: "", onPick };
    render();
  }

  function renderImagePicker() {
    const p = state.picker;
    const list = state.images.filter((id) => !p.filter || id.includes(p.filter));
    return h("div", { class: "modal-overlay", onClick: (e) => e.target === e.currentTarget && closePicker() }, [
      h("div", { class: "modal modal-wide" }, [
        h("div", { class: "modal-head" }, [
          h("h2", null, "画像を選ぶ"),
          h("input", {
            type: "search",
            class: "img-search",
            placeholder: "画像IDで絞り込む",
            value: p.filter,
            onInput: (e) => {
              p.filter = e.target.value.trim().toLowerCase();
              render();
            },
          }),
        ]),
        h("div", { class: "modal-body" }, [
          list.length
            ? h(
                "div",
                { class: "img-grid img-grid-pick" },
                list.map((id) =>
                  h(
                    "button",
                    {
                      class: "img-cell img-pick" + (p.value === id ? " img-pick-on" : ""),
                      onClick: () => {
                        p.onPick(id);
                        closePicker();
                      },
                    },
                    [h("img", { src: `/assets/img/${id}-sm.webp`, alt: id, loading: "lazy" }), h("div", { class: "img-cell-id", title: id }, id)]
                  )
                )
              )
            : h("div", { class: "empty-state" }, "該当する画像がありません。"),
        ]),
        h("div", { class: "modal-foot" }, [
          h(
            "button",
            {
              class: "btn btn-ghost",
              onClick: () => {
                p.onPick("");
                closePicker();
              },
            },
            "画像を外す"
          ),
          h(
            "button",
            {
              class: "btn btn-ghost",
              onClick: () => {
                closePicker();
                state.currentPage = { kind: "images" };
                render();
              },
            },
            "新しい写真を追加…"
          ),
          h("button", { class: "btn btn-primary", onClick: closePicker }, "閉じる"),
        ]),
      ]),
    ]);
  }

  function closePicker() {
    state.picker = null;
    render();
  }

  /** 画像ID 欄の共通部品（入力＋サムネイル＋「画像を選ぶ」） */
  function renderImageField(value, onChange, readOnly) {
    const imgId = typeof value === "string" ? value : "";
    const known = state.images.includes(imgId);
    return h("div", { class: "img-field-row" }, [
      h("input", {
        type: "text",
        list: "imglist",
        readOnly: readOnly,
        disabled: readOnly,
        spellcheck: false,
        value: imgId,
        onInput: (e) => onChange(e.target.value.trim()),
      }),
      readOnly ? null : h("button", { class: "btn btn-ghost btn-sm", onClick: () => openImagePicker(imgId, onChange) }, "画像を選ぶ"),
      known
        ? h("img", { class: "img-thumb", src: `/assets/img/${imgId}-sm.webp`, alt: "" })
        : imgId
        ? h("span", { class: "img-missing", title: "まだアップロードされていません" }, "未登録")
        : null,
    ]);
  }

  // ============================================================ 起動

  boot();
})();
