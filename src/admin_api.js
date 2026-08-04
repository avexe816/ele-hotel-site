// ============================================================================
// ELE HOTEL 管理画面 API
//   /api/admin/* を処理する。データの実体は GitHub リポジトリの data/*.json。
//   保存すると GitHub にコミット → GitHub Actions がビルド → Pages へ公開。
//
//   必要な環境変数:
//     GH_REPO             例: avexe816/ele-hotel-site
//     GH_TOKEN            GitHub の細粒度 PAT（Contents: 読み書き / Actions: 読み取り）
//     ADMIN_PASSWORD      パスワード方式のときのログインパスワード
//     ADMIN_SECRET        セッション署名用のランダム文字列
//   任意:
//     ACCESS_TEAM_DOMAIN  例: tej.cloudflareaccess.com（Cloudflare Access 方式）
//     ACCESS_AUD          Access アプリケーションの Audience タグ
//     DEEPL_KEY           DeepL API キー（自動翻訳）
// ============================================================================

const J = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const COOKIE = "__Host-elesid";
const SESSION_HOURS = 12;
const DATA_FILES = ["data/site.json", "data/hotels.json", "data/grand.json", "data/i18n.json", "data/admin-schema.json"];

// ---------------------------------------------------------------- utilities

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const unb64url = (s) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const b64utf8 = (str) => {
  const bytes = enc.encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const utf8b64 = (b64) => {
  const bin = atob(b64.replace(/\s/g, ""));
  return dec.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// -------------------------------------------------------------------- 認証

async function makeSession(env, email) {
  const payload = b64url(enc.encode(JSON.stringify({ email, exp: Date.now() + SESSION_HOURS * 3600e3 })));
  return `${payload}.${await hmac(env.ADMIN_SECRET, payload)}`;
}

async function readSession(env, request) {
  const raw = (request.headers.get("cookie") || "").match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!raw) return null;
  const [payload, sig] = raw[1].split(".");
  if (!payload || !sig) return null;
  if (!timingSafeEqual(sig, await hmac(env.ADMIN_SECRET, payload))) return null;
  try {
    const data = JSON.parse(dec.decode(unb64url(payload)));
    if (!data.exp || data.exp < Date.now()) return null;
    return data.email;
  } catch (_) {
    return null;
  }
}

// Cloudflare Access の JWT を検証してメールアドレスを取り出す
async function verifyAccess(env, request) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;

  let head, body;
  try {
    head = JSON.parse(dec.decode(unb64url(h)));
    body = JSON.parse(dec.decode(unb64url(p)));
  } catch (_) {
    return null;
  }
  if (body.exp * 1000 < Date.now()) return null;
  const auds = Array.isArray(body.aud) ? body.aud : [body.aud];
  if (!auds.includes(env.ACCESS_AUD)) return null;

  const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } });
  if (!res.ok) return null;
  const { keys } = await res.json();
  const jwk = keys.find((k) => k.kid === head.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64url(s), enc.encode(`${h}.${p}`));
  return ok ? body.email || null : null;
}

// 認証済みのメールアドレスを返す。未認証なら null。
async function whoami(env, request) {
  return (await verifyAccess(env, request)) || (await readSession(env, request));
}

// ------------------------------------------------------------------ GitHub

function gh(env, path, init = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "ele-hotel-admin",
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function ghJson(env, path, init) {
  const res = await gh(env, path, init);
  if (!res.ok) throw new Error(`GitHub ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const repo = (env) => env.GH_REPO || "avexe816/ele-hotel-site";

// 一度に必要なファイルをまとめて読む
async function loadBundle(env) {
  const ref = await ghJson(env, `/repos/${repo(env)}/git/ref/heads/main`);
  const head = ref.object.sha;
  const tree = await ghJson(env, `/repos/${repo(env)}/git/trees/${head}?recursive=1`);
  const byPath = Object.fromEntries(tree.tree.map((t) => [t.path, t]));

  const out = { head, files: {} };
  await Promise.all(
    DATA_FILES.map(async (p) => {
      const node = byPath[p];
      if (!node) return;
      const blob = await ghJson(env, `/repos/${repo(env)}/git/blobs/${node.sha}`);
      out.files[p] = JSON.parse(utf8b64(blob.content));
    })
  );
  // 画像一覧（管理画面の画像選択用）
  out.images = tree.tree
    .filter((t) => t.path.startsWith("assets/img/") && t.path.endsWith(".webp") && !t.path.endsWith("-sm.webp"))
    .map((t) => t.path.replace("assets/img/", "").replace(".webp", ""))
    .sort();
  return out;
}

// 複数ファイルを 1 コミットで保存する（Git Data API）
async function commitFiles(env, { files, message, author, expectHead }) {
  const R = repo(env);
  const ref = await ghJson(env, `/repos/${R}/git/ref/heads/main`);
  const head = ref.object.sha;
  if (expectHead && expectHead !== head) {
    const err = new Error("conflict");
    err.code = "conflict";
    throw err;
  }
  const base = await ghJson(env, `/repos/${R}/git/commits/${head}`);

  const blobs = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const blob = await ghJson(env, `/repos/${R}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: b64utf8(content), encoding: "base64" }),
      });
      return { path, mode: "100644", type: "blob", sha: blob.sha };
    })
  );

  const tree = await ghJson(env, `/repos/${R}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: base.tree.sha, tree: blobs }),
  });

  const commit = await ghJson(env, `/repos/${R}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: [head],
      author: { name: author.split("@")[0], email: author, date: new Date().toISOString() },
    }),
  });

  await ghJson(env, `/repos/${R}/git/refs/heads/main`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });
  return commit.sha;
}

// 公開状況（GitHub Actions の実行状態）
async function buildStatus(env) {
  const runs = await ghJson(env, `/repos/${repo(env)}/actions/runs?per_page=3`);
  const r = runs.workflow_runs && runs.workflow_runs[0];
  if (!r) return { state: "idle" };
  const state =
    r.status !== "completed" ? "building" : r.conclusion === "success" ? "ok" : "failed";
  return { state, url: r.html_url, at: r.updated_at, message: (r.display_title || "").slice(0, 120) };
}

// ---------------------------------------------------------------- 自動翻訳

const DEEPL_TARGET = { zh: "ZH-HANS", "zh-Hant": "ZH-HANT", en: "EN-US", ko: "KO" };

async function translate(env, texts, langs) {
  if (!env.DEEPL_KEY) throw new Error("no_translator");
  const host = env.DEEPL_KEY.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
  const out = {};
  for (const lang of langs) {
    const res = await fetch(`https://${host}/v2/translate`, {
      method: "POST",
      headers: { authorization: `DeepL-Auth-Key ${env.DEEPL_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ text: texts, source_lang: "JA", target_lang: DEEPL_TARGET[lang], preserve_formatting: true }),
    });
    if (!res.ok) throw new Error(`DeepL ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    out[lang] = data.translations.map((t) => t.text);
  }
  return out;
}

// -------------------------------------------------------------------- ルート

async function handleAdmin(request, env, url) {
  const path = url.pathname.replace(/^\/api\/admin/, "") || "/";
  const usingAccess = Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);

  // --- ログイン（パスワード方式のみ）
  if (path === "/login" && request.method === "POST") {
    if (usingAccess) return J({ ok: false, error: "use_access" }, 400);
    if (!env.ADMIN_PASSWORD || !env.ADMIN_SECRET) return J({ ok: false, error: "not_configured" }, 503);
    let body = {};
    try {
      body = await request.json();
    } catch (_) {}
    const pw = String(body.password || "");
    if (pw.length > 200 || !timingSafeEqual(pw.padEnd(200, "\0"), String(env.ADMIN_PASSWORD).padEnd(200, "\0"))) {
      await new Promise((r) => setTimeout(r, 700));
      return J({ ok: false, error: "bad_password" }, 401);
    }
    const email = String(body.email || "").slice(0, 120) || "admin@ele-hotel.com";
    const token = await makeSession(env, email);
    return new Response(JSON.stringify({ ok: true, email }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `${COOKIE}=${token}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}`,
      },
    });
  }

  if (path === "/logout") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `${COOKIE}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      },
    });
  }

  const email = await whoami(env, request);

  if (path === "/me") {
    return J({
      ok: true,
      email,
      mode: usingAccess ? "access" : "password",
      configured: Boolean(env.GH_TOKEN),
      translator: Boolean(env.DEEPL_KEY),
      repo: repo(env),
    });
  }

  if (!email) return J({ ok: false, error: "unauthorized" }, 401);
  if (!env.GH_TOKEN) return J({ ok: false, error: "no_github_token" }, 503);

  try {
    // --- 全データ読み込み
    if (path === "/bundle") {
      const b = await loadBundle(env);
      return J({ ok: true, head: b.head, files: b.files, images: b.images });
    }

    // --- 公開状況
    if (path === "/status") return J({ ok: true, ...(await buildStatus(env)) });

    // --- 保存
    if (path === "/save" && request.method === "POST") {
      const body = await request.json();
      const files = {};
      for (const [p, val] of Object.entries(body.files || {})) {
        if (!DATA_FILES.includes(p)) return J({ ok: false, error: "bad_path", path: p }, 400);
        files[p] = JSON.stringify(val, null, 2) + "\n";
      }
      if (!Object.keys(files).length) return J({ ok: false, error: "no_files" }, 400);
      const sha = await commitFiles(env, {
        files,
        message: String(body.message || "管理画面から更新").slice(0, 200),
        author: email,
        expectHead: body.head,
      });
      return J({ ok: true, sha });
    }

    // --- 自動翻訳
    if (path === "/translate" && request.method === "POST") {
      const body = await request.json();
      const texts = (body.texts || []).slice(0, 50).map((t) => String(t).slice(0, 4000));
      const langs = (body.langs || ["zh", "zh-Hant", "en", "ko"]).filter((l) => DEEPL_TARGET[l]);
      if (!texts.length) return J({ ok: false, error: "no_texts" }, 400);
      return J({ ok: true, results: await translate(env, texts, langs) });
    }
  } catch (err) {
    if (err.code === "conflict")
      return J({ ok: false, error: "conflict", hint: "ほかの人が先に保存しました。画面を再読み込みしてください。" }, 409);
    console.log("admin error:", String(err));
    return J({ ok: false, error: "server_error", detail: String(err).slice(0, 300) }, 500);
  }

  return J({ ok: false, error: "not_found" }, 404);
}
