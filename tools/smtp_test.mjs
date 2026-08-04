// Local protocol test for the _worker.js SMTP client.
// Spins up a fake SMTP server, shims cloudflare:sockets, and checks the dialogue.
import net from "node:net";
import fs from "node:fs";
import { Duplex } from "node:stream";

const PORT = 2599;
const log = [];
let received = "";

const server = net.createServer((sock) => {
  let inData = false;
  let data = "";
  let authStep = 0;
  sock.write("220 fake.smtp ESMTP ready\r\n");
  sock.on("data", (chunk) => {
    const s = chunk.toString("utf8");
    if (inData) {
      data += s;
      if (data.includes("\r\n.\r\n")) {
        received = data.slice(0, data.indexOf("\r\n.\r\n"));
        inData = false;
        log.push("DATA-END");
        sock.write("250 2.0.0 Ok: queued as FAKE123\r\n");
      }
      return;
    }
    for (const line of s.split("\r\n").filter(Boolean)) {
      log.push(line.startsWith("AUTH") || /^[A-Za-z0-9+/=]{8,}$/.test(line) ? line.split(" ")[0] || "B64" : line);
      const u = line.toUpperCase();
      if (u.startsWith("EHLO")) sock.write("250-fake.smtp\r\n250-SIZE 20480000\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n");
      else if (u === "AUTH LOGIN") { authStep = 1; sock.write("334 VXNlcm5hbWU6\r\n"); }
      else if (u.startsWith("MAIL FROM")) sock.write("250 2.1.0 Ok\r\n");
      else if (u.startsWith("RCPT TO")) sock.write("250 2.1.5 Ok\r\n");
      else if (u === "DATA") { inData = true; sock.write("354 End data with <CR><LF>.<CR><LF>\r\n"); }
      else if (u === "QUIT") { sock.write("221 2.0.0 Bye\r\n"); sock.end(); }
      else if (authStep === 1) { authStep = 2; sock.write("334 UGFzc3dvcmQ6\r\n"); }
      else if (authStep === 2) {
        authStep = 3;
        const pw = Buffer.from(line, "base64").toString("utf8");
        sock.write(pw === "secret-pass" ? "235 2.7.0 Authentication successful\r\n" : "535 bad credentials\r\n");
      } else sock.write("500 unknown\r\n");
    }
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// ---- shim cloudflare:sockets -------------------------------------------------
fs.writeFileSync(
  "/tmp/cf_sockets_shim.mjs",
  `import net from "node:net";
import { Duplex } from "node:stream";
export function connect({ hostname, port }) {
  const sock = net.connect(port, hostname);
  const web = Duplex.toWeb(sock);
  return {
    readable: web.readable,
    writable: web.writable,
    close: async () => sock.destroy(),
    startTls: () => { throw new Error("startTls not supported in this shim"); },
  };
}
`
);

let src = fs.readFileSync("/home/user/workspace/ele-hotel-wood16/_worker.js", "utf8");
src = src.replace('from "cloudflare:sockets"', 'from "/tmp/cf_sockets_shim.mjs"');
fs.writeFileSync("/tmp/worker_under_test.mjs", src);
const worker = (await import("/tmp/worker_under_test.mjs")).default;

const env = {
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String(PORT),
  SMTP_USER: "noreply@ele-hotel.com",
  SMTP_PASS: "secret-pass",
  CONTACT_TO: "info@ele-hotel.com",
  ASSETS: { fetch: async () => new Response("static", { status: 200 }) },
};

const payload = {
  kind: "法人・団体でのご利用",
  name: "山田 太郎",
  company: "テスト株式会社",
  email: "taro@example.com",
  tel: "03-1234-5678",
  reply: "メール",
  message: "テスト送信です。\n改行と「引用符」、ドットで始まる行:\n.hidden\n以上。",
  lang: "ja",
  page: "お問い合わせ",
};

const res = await worker.fetch(
  new Request("https://www.ele-hotel.com/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }),
  env
);
console.log("HTTP", res.status, await res.text());
console.log("\n--- server saw ---");
console.log(log.join(" | "));
console.log("\n--- headers ---");
console.log(received.split("\r\n\r\n")[0]);
const dot = received.includes("\r\n..hidden");
console.log("\ndot-stuffing applied:", dot);
const b64parts = received.split(/--ele\w+/).filter((p) => p.includes("base64"));
console.log("mime parts:", b64parts.length);
for (const p of b64parts) {
  const body = p.split("\r\n\r\n")[1] || "";
  const txt = Buffer.from(body.replace(/[\r\n]/g, ""), "base64").toString("utf8");
  console.log("  part:", p.match(/text\/\w+/)[0], "->", JSON.stringify(txt.slice(0, 70)));
}
const subj = /Subject: (.*)/.exec(received)[1];
console.log("subject decoded:", Buffer.from(subj.replace(/=\?UTF-8\?B\?|\?=/g, ""), "base64").toString("utf8"));

// validation paths
for (const [label, body] of [
  ["missing name", { ...payload, name: "" }],
  ["bad email", { ...payload, email: "nope" }],
  ["honeypot", { ...payload, _gotcha: "bot" }],
]) {
  const r = await worker.fetch(
    new Request("https://x/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    env
  );
  console.log(label, "->", r.status, await r.text());
}
const st = await worker.fetch(new Request("https://x/contact.html"), env);
console.log("static passthrough ->", st.status, await st.text());
server.close();
process.exit(0);
