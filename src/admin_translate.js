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

// 固有名詞の対訳表。地名・駅名はモデルが誤読しやすいので必ず渡す。
// 「日本語 | 簡体字 | English | 한국어」の順。
const GLOSSARY = [
  // ホテル名（人が確認済みの表記。ここは絶対に変えない）
  ["ELE Hotel 銀座イースト", "ELE Hotel 银座东", "ELE Hotel Ginza East", "ELE Hotel 긴자 이스트"],
  ["ELE Hotel 東上野", "ELE Hotel 东上野", "ELE Hotel Higashiueno", "ELE Hotel 히가시우에노"],
  ["ELE Hotel 東日本橋", "ELE Hotel 东日本桥", "ELE Hotel Higashi-Nihonbashi", "ELE Hotel 히가시니혼바시"],
  ["ELE Hotel Cabin 新宿歌舞伎町", "ELE Hotel Cabin 新宿歌舞伎町", "ELE Cabin Shinjuku Kabukicho", "ELE Hotel Cabin 신주쿠 가부키초"],
  ["ELE Hotel 名古屋栄駅前", "ELE Hotel 名古屋荣站前", "ELE Hotel Nagoya Sakae Station", "ELE Hotel 나고야 사카에역 앞"],
  ["ELE Hotel 樟葉", "ELE Hotel 樟叶", "ELE Hotel Kuzuha", "ELE Hotel 구즈하"],
  ["ELE Hotel 仙台東口", "ELE Hotel 仙台东口", "ELE Hotel Sendai Higashiguchi", "ELE Hotel 센다이 히가시구치"],
  // 地名・駅名
  ["銀座イースト", "银座东", "Ginza East", "긴자 이스트"],
  ["銀座", "银座", "Ginza", "긴자"],
  ["東上野", "东上野", "Higashi-Ueno", "히가시우에노"],
  ["上野", "上野", "Ueno", "우에노"],
  ["東日本橋", "东日本桥", "Higashi-Nihombashi", "히가시니혼바시"],
  ["日本橋", "日本桥", "Nihombashi", "니혼바시"],
  ["新宿歌舞伎町", "新宿歌舞伎町", "Shinjuku Kabukicho", "신주쿠 가부키초"],
  ["新宿", "新宿", "Shinjuku", "신주쿠"],
  ["名古屋栄駅前", "名古屋荣站前", "Nagoya Sakae-ekimae", "나고야 사카에역 앞"],
  ["名古屋", "名古屋", "Nagoya", "나고야"],
  ["樟葉", "樟叶", "Kuzuha", "구즈하"],
  ["仙台東口", "仙台东口", "Sendai Higashiguchi", "센다이 히가시구치"],
  ["仙台", "仙台", "Sendai", "센다이"],
  ["東京駅", "东京站", "Tokyo Station", "도쿄역"],
  ["東京", "东京", "Tokyo", "도쿄"],
  ["大阪", "大阪", "Osaka", "오사카"],
  ["築地", "筑地", "Tsukiji", "쓰키지"],
  ["新富", "新富", "Shintomi", "신토미"],
  ["浅草", "浅草", "Asakusa", "아사쿠사"],
  ["秋葉原", "秋叶原", "Akihabara", "아키하바라"],
  ["京橋", "京桥", "Kyobashi", "교바시"],
  ["八丁堀", "八丁堀", "Hatchobori", "핫초보리"],
  ["株式会社TEJ", "TEJ株式会社", "TEJ Co., Ltd.", "TEJ 주식회사"],
];

const GLOSSARY_COL = { zh: 1, en: 2, ko: 3 };

/** 原文に出てくる固有名詞だけを対訳表として抜き出す（プロンプトを短く保つため） */
function glossaryFor(lang, texts) {
  const joined = texts.join("\n");
  const col = GLOSSARY_COL[lang];
  const used = [];
  for (const row of [...GLOSSARY].sort((a, b) => b[0].length - a[0].length)) {
    if (!joined.includes(row[0])) continue;
    // すでに採用した長い語に含まれている短い語は出さない（銀座イースト があれば 銀座 は不要）
    if (used.some((u) => u[0].includes(row[0]))) continue;
    used.push(row);
  }
  if (!used.length) return [];
  return [
    "MANDATORY GLOSSARY — these proper nouns must appear exactly as given, no other spelling is acceptable:",
    ...used.map((row) => `- 「${row[0]}」 -> ${row[col]}`),
    "",
  ];
}

const LANG_INFO = {
  zh: { label: "Simplified Chinese (as used in mainland China)", m2m: "chinese" },
  en: { label: "English", m2m: "english" },
  ko: { label: "Korean", m2m: "korean" },
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

// ------------------------------------------------------------ 訳文の検品
//
//  モデルが日本語をそのまま返してくることがあるため、必ず機械的に検品する。
//  ・かな（ー と ・ は中国語でも使うので除外）が残っていたら中国語として失敗
//  ・ハングルが無ければ韓国語として失敗
//  ・英語に漢字・かな・ハングルが混ざっていたら失敗
//  ・原文と同一なら失敗

const HAS_KANA = /[\u3040-\u309f\u30a1-\u30fa\u30fd\u30fe]/;
const HAS_HANGUL = /[\uac00-\ud7af]/;
const HAS_CJK = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/;

function looksValid(lang, src, out) {
  if (!out || !out.trim()) return false;
  if (out.trim() === src.trim()) return false;
  if (lang === "zh") return !HAS_KANA.test(out);
  if (lang === "ko") return HAS_HANGUL.test(out);
  if (lang === "en") return !HAS_CJK.test(out);
  return true;
}

// -------------------------------------------------------------- モデル呼び出し

const stripThink = (s) => String(s).replace(/<think>[\s\S]*?<\/think>/g, "").trim();

// 指示は英語で書く。日本語で書くと、モデルが原文をそのまま返す事故が起きやすい。
const RULES = (label) => [
  `Translate the Japanese lines below into ${label}.`,
  "",
  "Rules:",
  `- The output MUST be written entirely in ${label}. Never copy or leave the Japanese text.`,
  "- These lines are from a hotel's official website. Keep the wording concise and natural for a hotel website.",
  "- Do NOT add, remove, guess or invent any information. Translate only what is written.",
  "- Vague quantities stay vague: 「数分」 means \"a few minutes\", not a specific number.",
  "- Keep Latin brand names exactly as written: ELE HOTEL, ELE Hotel, GRAND ELE HOTEL, Apart, Onsen, Cabin.",
  "- Keep all numbers, times, prices and symbols exactly as in the source.",
  "- Keep \\n where it appears, at the same position.",
  "- Output the translation only. No preamble, no notes, no explanation, no romanisation.",
];

function buildPrompt(lang, texts) {
  return [
    ...glossaryFor(lang, texts),
    ...RULES(LANG_INFO[lang].label),
    `- Output exactly ${texts.length} line(s), each formatted as "<number>. <translation>".`,
    "",
    "Japanese:",
    texts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, "\\n")}`).join("\n"),
  ].join("\n");
}

function buildSinglePrompt(lang, text) {
  return [...glossaryFor(lang, [text]), ...RULES(LANG_INFO[lang].label), "", "Japanese:", text.replace(/\n/g, "\\n")].join("\n");
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

async function ask(env, prompt, maxTokens) {
  const res = await env.AI.run(env.AI_MODEL || AI_MODEL_DEFAULT, {
    messages: [
      { role: "system", content: "You are a professional translator for hotel websites. Reply with the translation only. /no_think" },
      { role: "user", content: prompt },
    ],
    max_tokens: maxTokens,
    temperature: 0.2,
  });
  return res.response || (res.result && res.result.response) || "";
}

/** まとめ訳し。検品を通らなかったところは null で返す。 */
async function runBatch(env, lang, texts) {
  try {
    const raw = await ask(env, buildPrompt(lang, texts), Math.min(4000, 300 + texts.join("").length * 3));
    const parsed = parseNumbered(raw, texts.length);
    return parsed.map((v, i) => (looksValid(lang, texts[i], v) ? v : null));
  } catch (err) {
    console.log(`translate ${lang} batch failed:`, String(err).slice(0, 200));
    return texts.map(() => null);
  }
}

/** 1文ずつ訳す。まとめ訳しで失敗したものだけに使う。 */
async function runSingle(env, lang, text) {
  try {
    const raw = stripThink(await ask(env, buildSinglePrompt(lang, text), Math.min(1500, 200 + text.length * 4)));
    // 番号付きで返ってくることもあるので落とす
    const cleaned = raw.replace(/^\s*\d+\s*[.．、:：]\s*/, "").trim().replace(/\\n/g, "\n");
    if (looksValid(lang, text, cleaned)) return cleaned;
  } catch (err) {
    console.log(`translate ${lang} single failed:`, String(err).slice(0, 160));
  }
  return null;
}

/** 旧来の翻訳専用モデル。指示モデルが何度やっても駄目なときの最後の保険。 */
async function runM2M(env, lang, text) {
  try {
    const res = await env.AI.run(AI_MODEL_FALLBACK, {
      text,
      source_lang: "japanese",
      target_lang: LANG_INFO[lang].m2m,
    });
    const out = (res.translated_text || "").trim();
    return looksValid(lang, text, out) ? out : null;
  } catch (_) {
    return null;
  }
}

/**
 * 日本語の配列を 1 言語ぶん訳す。
 * まとめ訳し → 残りを1文ずつ → それでも駄目なら翻訳専用モデル、の3段構え。
 * 最後まで検品を通らなかったものは null のまま返し、書き込まない（誤訳を残さない）。
 */
async function translateInto(env, lang, texts) {
  const out = new Array(texts.length).fill(null);

  for (let i = 0; i < texts.length; i += 12) {
    const idx = [];
    for (let j = i; j < Math.min(i + 12, texts.length); j++) idx.push(j);
    const got = await runBatch(env, lang, idx.map((j) => texts[j]));
    idx.forEach((j, k) => (out[j] = got[k]));
  }

  for (let j = 0; j < texts.length; j++) {
    if (out[j] === null) out[j] = await runSingle(env, lang, texts[j]);
    if (out[j] === null) out[j] = await runM2M(env, lang, texts[j]);
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
  const failed = {};
  for (const [lang, { items, results }] of Object.entries(perLang)) {
    counts[lang] = 0;
    failed[lang] = 0;
    items.forEach((job, i) => {
      const text = results[i];
      if (!text) {
        failed[lang]++;
        return;
      }
      const entry = (mem[job.key] = mem[job.key] || { ja: job.ja, locked: false });
      entry.ja = job.ja;
      for (const l of ALL_LANGS) if (!(l in entry)) entry[l] = "";
      if (!("locked" in entry)) entry.locked = false;
      entry[lang] = text;
      counts[lang]++;
    });
  }

  const failTotal = Object.values(failed).reduce((a, b) => a + b, 0);
  return { added: batch.length, langs: counts, failed: failTotal, pending, skippedLocked };
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
