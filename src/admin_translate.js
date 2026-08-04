// ============================================================================
// 自動翻訳（Cloudflare Workers AI）
//
//   日本語だけを人が書き、ほかの 4 言語は保存時に自動生成する。
//   ・zh / en / ko … Workers AI の指示モデルで翻訳する
//   ・zh-Hant     … 空のまま保存し、GitHub Actions 側で tools/zh_hant.py が
//                   簡体字から変換して埋める（OpenCC + 用語表のほうが精度が高い）
//
//   env.AI（Workers AI バインディング）が必要。名前は必ず AI にする。
//   任意: env.AI_MODEL でモデルを差し替えられる。
// ============================================================================

const AI_MODEL_DEFAULT = "@cf/qwen/qwen3-30b-a3b-fp8";
const AI_MODEL_FALLBACK = "@cf/meta/m2m100-1.2b";

// 自動翻訳する言語。zh-Hant はビルド時に簡体字から変換するのでここには入れない。
const AUTO_LANGS = ["zh", "en", "ko"];

const LANG_INFO = {
  zh: { name: "簡体字中国語（中国大陸向け）", m2m: "chinese" },
  en: { name: "英語", m2m: "english" },
  ko: { name: "韓国語", m2m: "korean" },
};

// build.py / tools/i18n.py の JP_RE と同じ範囲
const JP_RE = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\u3000-\u303f\uff01-\uff60\u3005\u30fc]/;

const ALL_LANGS = ["zh", "zh-Hant", "en", "ko", "th"];

/** 翻訳が必要な文字列か（日本語の文字を含むか）。ブランド名や数字だけの行は対象外。 */
export function needsTranslation(s) {
  return typeof s === "string" && JP_RE.test(s);
}

/** tools/i18n.py の key_of と完全に同じ値を返す（sha1 の先頭 16 桁）。 */
export async function keyOf(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** データツリーの中の日本語文字列をすべて集める。 */
export function collectStrings(node, out = new Set()) {
  if (typeof node === "string") {
    if (needsTranslation(node)) out.add(node);
  } else if (Array.isArray(node)) {
    for (const v of node) collectStrings(v, out);
  } else if (node && typeof node === "object") {
    for (const v of Object.values(node)) collectStrings(v, out);
  }
  return out;
}

// -------------------------------------------------------------- モデル呼び出し

const stripThink = (s) => String(s).replace(/<think>[\s\S]*?<\/think>/g, "").trim();

function buildPrompt(lang, texts) {
  const list = texts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, "\\n")}`).join("\n");
  return [
    `あなたはホテル公式サイトの翻訳者です。次の日本語を${LANG_INFO[lang].name}に訳してください。`,
    "",
    "守ること:",
    "・宿泊施設の公式サイトの文言として自然で簡潔に訳す。説明・注釈・言い換えを足さない。",
    "・「ELE HOTEL」「ELE Hotel」「GRAND ELE HOTEL」などのブランド名、駅名のローマ字、数字、記号はそのまま残す。",
    "・原文の \\n は訳文でも \\n のまま同じ位置に残す。",
    "・訳文だけを出力する。前置き・解説・番号以外の記号を付けない。",
    "",
    `出力形式: 各行を「番号. 訳文」の形で ${texts.length} 行だけ返す。行を増やしたり減らしたりしない。`,
    "",
    "原文:",
    list,
  ].join("\n");
}

function parseNumbered(raw, count) {
  const lines = stripThink(raw).split("\n");
  const out = new Array(count).fill(null);
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s*[.．、:：]\s*(.+)$/);
    if (!m) continue;
    const i = parseInt(m[1], 10) - 1;
    if (i >= 0 && i < count && out[i] === null) out[i] = m[2].trim().replace(/\\n/g, "\n");
  }
  return out;
}

/** 指示モデルでまとめて訳す。1件でも取れなければ null を返す。 */
async function runInstruct(env, lang, texts) {
  const model = env.AI_MODEL || AI_MODEL_DEFAULT;
  const res = await env.AI.run(model, {
    messages: [
      { role: "system", content: "You are a professional Japanese-to-multilingual translator for hotel websites. Answer with translations only. /no_think" },
      { role: "user", content: buildPrompt(lang, texts) },
    ],
    max_tokens: Math.min(4000, 300 + texts.join("").length * 3),
    temperature: 0.2,
  });
  const raw = res.response || res.result?.response || "";
  const parsed = parseNumbered(raw, texts.length);
  return parsed.some((v) => v === null) ? null : parsed;
}

/** 旧来の翻訳専用モデル。指示モデルが失敗したときの保険。1 文ずつ処理する。 */
async function runM2M(env, lang, texts) {
  const out = [];
  for (const text of texts) {
    try {
      const res = await env.AI.run(AI_MODEL_FALLBACK, {
        text,
        source_lang: "japanese",
        target_lang: LANG_INFO[lang].m2m,
      });
      out.push((res.translated_text || "").trim() || null);
    } catch (_) {
      out.push(null);
    }
  }
  return out;
}

/**
 * 日本語の配列を 1 言語ぶん訳す。
 * まとめ訳しが崩れたら 8 件ずつに分け、それでも駄目なら翻訳専用モデルに落とす。
 */
async function translateInto(env, lang, texts) {
  try {
    const whole = await runInstruct(env, lang, texts);
    if (whole) return whole;
  } catch (err) {
    console.log(`translate ${lang} instruct failed:`, String(err).slice(0, 200));
  }
  const out = [];
  for (let i = 0; i < texts.length; i += 8) {
    const chunk = texts.slice(i, i + 8);
    let got = null;
    try {
      got = await runInstruct(env, lang, chunk);
    } catch (_) {}
    out.push(...(got || (await runM2M(env, lang, chunk))));
  }
  return out;
}

// ------------------------------------------------------------------- 本体

/**
 * データツリーを見て、翻訳記憶（i18n.json）に足りない訳を自動で埋める。
 *
 * @param env       Worker の環境
 * @param mem       i18n.json の中身（この関数が直接書き換える）
 * @param trees     翻訳対象のデータツリーの配列（site.json / hotels.json / grand.json）
 * @param limit     1回で訳す最大件数
 * @returns {{added:number, langs:object, pending:number, skippedLocked:number}}
 */
export async function fillTranslations(env, mem, trees, limit = 80) {
  if (!env.AI) throw new Error("no_ai_binding");

  // 日本語 → キー の対応表をつくる
  const strings = new Set();
  for (const t of trees) collectStrings(t, strings);

  const jobs = [];       // 訳が足りない項目
  let skippedLocked = 0;

  for (const ja of strings) {
    const key = await keyOf(ja);
    const entry = mem[key];
    if (entry && entry.locked) {
      // 人が確認済みの文言。足りない言語だけは補う。
      const holes = AUTO_LANGS.filter((l) => !entry[l]);
      if (!holes.length) {
        skippedLocked++;
        continue;
      }
      jobs.push({ ja, key, langs: holes });
      continue;
    }
    const holes = AUTO_LANGS.filter((l) => !(entry && entry[l]));
    if (holes.length) jobs.push({ ja, key, langs: holes });
  }

  const pending = Math.max(0, jobs.length - limit);
  const batch = jobs.slice(0, limit);
  if (!batch.length) return { added: 0, langs: {}, pending: 0, skippedLocked };

  // 言語ごとにまとめて投げる
  const perLang = {};
  for (const lang of AUTO_LANGS) {
    const items = batch.filter((j) => j.langs.includes(lang));
    if (items.length) perLang[lang] = { items, results: await translateInto(env, lang, items.map((j) => j.ja)) };
  }

  // 記憶に書き戻す
  const counts = {};
  for (const [lang, { items, results }] of Object.entries(perLang)) {
    counts[lang] = 0;
    items.forEach((job, i) => {
      const text = results[i];
      if (!text) return;
      const entry = (mem[job.key] = mem[job.key] || { ja: job.ja, locked: false });
      entry.ja = job.ja;
      for (const l of ALL_LANGS) if (!(l in entry)) entry[l] = "";
      if (!("locked" in entry)) entry.locked = false;
      entry[lang] = text;
      counts[lang]++;
    });
  }

  return { added: batch.length, langs: counts, pending, skippedLocked };
}

/** tools/i18n.py の save_memory と同じ並び順（ja の辞書順）で書き出す。 */
export function sortMemory(mem) {
  // Python 側は文字コード順（sorted）なので、JS も同じ比較にする
  const keys = Object.keys(mem).sort((a, b) => {
    const x = String(mem[a].ja), y = String(mem[b].ja);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const out = {};
  for (const k of keys) out[k] = mem[k];
  return out;
}
