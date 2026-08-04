#!/usr/bin/env python3
"""Deploy a static directory to Cloudflare Pages via Direct Upload API."""
import base64, json, mimetypes, os, subprocess, sys, time
from pathlib import Path
from blake3 import blake3

ACCOUNT = "0abcaf3ee0a5d1804975ce92d33255ca"
PROJECT = "ele-hotel"
ROOT = Path("/home/user/workspace/ele-hotel-wood16")
INCLUDE = ["index.html", "grand.html", "privacy.html", "contact.html",
           "hotels", "zh", "zh-hant", "en", "ko", "assets"]
# _worker.js is NOT a static asset -- it is uploaded as the Pages Function
# (advanced mode) via a dedicated multipart field, see step 6.
WORKER = ROOT / "_worker.js"
API = "https://api.cloudflare.com/client/v4"


def curl(method, url, *, jwt=None, data=None, form=None, out_json=True):
    cmd = ["curl", "-sS", "-X", method, url]
    if jwt:
        # bypass the injecting proxy: send the short-lived upload JWT ourselves
        cmd = ["curl", "-sS", "--noproxy", "*", "-X", method, url,
               "-H", f"Authorization: Bearer {jwt}"]
    if data is not None:
        cmd += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
    if form:
        for f in form:
            cmd += ["-F", f]
    env = dict(os.environ)
    r = subprocess.run(cmd, input=(data or "").encode() if data is not None else None,
                       capture_output=True, env=env)
    txt = r.stdout.decode(errors="replace")
    if not out_json:
        return txt
    try:
        return json.loads(txt)
    except Exception:
        return {"success": False, "raw": txt[:800], "stderr": r.stderr.decode()[:400]}


def collect():
    files = []
    for item in INCLUDE:
        p = ROOT / item
        if p.is_file():
            files.append(p)
        else:
            files += [f for f in p.rglob("*") if f.is_file()]
    out = []
    for f in files:
        rel = "/" + str(f.relative_to(ROOT)).replace(os.sep, "/")
        raw = f.read_bytes()
        b64 = base64.b64encode(raw).decode()
        ext = f.suffix.lstrip(".")
        h = blake3((b64 + ext).encode()).hexdigest()[:32]
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        out.append({"path": rel, "hash": h, "b64": b64, "ctype": ctype})
    return out


def main():
    # 1. ensure project exists
    got = curl("GET", f"{API}/accounts/{ACCOUNT}/pages/projects/{PROJECT}")
    if not got.get("success"):
        body = json.dumps({"name": PROJECT, "production_branch": "main"})
        made = curl("POST", f"{API}/accounts/{ACCOUNT}/pages/projects", data=body)
        print("create project:", made.get("success"), made.get("errors") or "")
        if not made.get("success"):
            print(json.dumps(made, ensure_ascii=False)[:600]); sys.exit(1)
    else:
        print("project already exists")

    # 2. upload token
    tok = curl("GET", f"{API}/accounts/{ACCOUNT}/pages/projects/{PROJECT}/upload-token")
    if not tok.get("success"):
        print("upload-token failed", json.dumps(tok, ensure_ascii=False)[:600]); sys.exit(1)
    jwt = tok["result"]["jwt"]

    files = collect()
    print(f"{len(files)} files, {sum(len(f['b64']) for f in files)//1024} KB base64")

    # 3. which hashes are missing
    hashes = [f["hash"] for f in files]
    chk = curl("POST", "https://api.cloudflare.com/client/v4/pages/assets/check-missing",
               jwt=jwt, data=json.dumps({"hashes": hashes}))
    missing = set(chk.get("result") or hashes)
    print("missing:", len(missing))

    # 4. upload in batches
    todo = [f for f in files if f["hash"] in missing]
    batch, size, sent = [], 0, 0
    def flush(batch):
        nonlocal sent
        if not batch:
            return
        payload = json.dumps([{ "key": f["hash"], "value": f["b64"],
                                "metadata": {"contentType": f["ctype"]},
                                "base64": True } for f in batch])
        for attempt in range(3):
            r = curl("POST", "https://api.cloudflare.com/client/v4/pages/assets/upload",
                     jwt=jwt, data=payload)
            if r.get("success"):
                sent += len(batch); print(f"  uploaded {sent}/{len(todo)}"); return
            time.sleep(2)
        print("UPLOAD FAILED", json.dumps(r, ensure_ascii=False)[:500]); sys.exit(1)

    for f in todo:
        if size + len(f["b64"]) > 12_000_000 or len(batch) >= 40:
            flush(batch); batch, size = [], 0
        batch.append(f); size += len(f["b64"])
    flush(batch)

    # 5. upsert hashes
    up = curl("POST", "https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes",
              jwt=jwt, data=json.dumps({"hashes": hashes}))
    print("upsert:", up.get("success"))

    # 6. create deployment with manifest
    manifest = {f["path"]: f["hash"] for f in files}
    mf = "/tmp/manifest.json"
    Path(mf).write_text(json.dumps(manifest))
    form = [f"manifest=<{mf}", "branch=main"]
    if WORKER.is_file():
        form.append(f"_worker.js=@{WORKER};type=application/javascript+module")
        print("attaching _worker.js as Pages Function")
    dep = curl("POST", f"{API}/accounts/{ACCOUNT}/pages/projects/{PROJECT}/deployments",
               form=form)
    print("deployment:", dep.get("success"))
    if dep.get("success"):
        r = dep["result"]
        print("URL:", r.get("url"))
        print("stage:", r.get("latest_stage", {}).get("name"), r.get("latest_stage", {}).get("status"))
    else:
        print(json.dumps(dep, ensure_ascii=False)[:800])


main()
