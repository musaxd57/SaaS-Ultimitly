#!/usr/bin/env python3
"""Kurucu inceleme seti: docs/olcum/*.json ölçüm yan dosyalarından (misafir mesajı → yapay zekâ cevabı) çiftlerini çıkarır.

Kaynaklar YALNIZ sentetik / anonim açık setler (evals/*.json kökü). evals/sealed, evals/private ve rag-scale/holdout OKUNMAZ.
Çıktı: argv[1] (varsayılan review-set.json). Kullanım: python3 scripts/review/build-review-set.py out.json
"""
import glob, hashlib, json, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else "review-set.json"
TRAILER = re.compile(r"\s*\((?:Bu yanıt|This (?:reply|response)|Diese Antwort|Cette réponse|Esta respuesta|Этот ответ|تم)[^)]*\)\s*$")

# id -> [(datasetFile, scenario)]
datasets = {}
for f in sorted(glob.glob(os.path.join(ROOT, "evals", "*.json"))):
    try:
        d = json.load(open(f, encoding="utf8"))
    except Exception:
        continue
    sc = d.get("scenarios") if isinstance(d, dict) else None
    if not isinstance(sc, list):
        continue
    datasets[os.path.basename(f)] = {s.get("id"): s for s in sc if isinstance(s, dict) and s.get("id")}

def pick_dataset(ids):
    best = None
    for name, idx in datasets.items():
        hit = sum(1 for i in ids if i in idx)
        if hit == len(ids) and (best is None or len(idx) < len(datasets[best])):
            best = name
    return best

def msg_of(s):
    return s.get("message") or s.get("guestRequest") or s.get("text") or ""

items = {}
for f in sorted(glob.glob(os.path.join(ROOT, "docs", "olcum", "*.json"))):
    try:
        d = json.load(open(f, encoding="utf8"))
    except Exception:
        continue
    if not isinstance(d, dict):
        continue
    suite, rows, meta = d.get("suite"), d.get("rows") or [], d.get("meta") or {}
    rt = d.get("runtime") or {}
    report = os.path.basename(f).replace(".json", ".md")
    date = (re.search(r"(20\d\d-\d\d-\d\d)", report) or [None, None])[1]
    model = meta.get("model") or meta.get("servedModel") or (rt.get("reply") or {}).get("model") if isinstance(rt.get("reply"), dict) else meta.get("model")
    if suite in ("qr-kb-coverage", "kb-retrieval-paired"):
        for r in rows:
            q, rep = r.get("question"), r.get("reply")
            if q and rep:
                if True:
                    key = hashlib.sha1((q + "\x00" + rep).encode()).hexdigest()[:16]
                    items.setdefault(key, {"id": key, "suite": suite, "scenario": r.get("id"), "message": q, "reply": rep,
                                           "delivered": None, "cls": r.get("mode") or "", "lang": None, "model": model, "date": date, "report": report, "seen": 0})
                    items[key]["seen"] += 1
        continue
    if suite not in ("live-pipeline", "model-reply-compare", "qr-live-pipeline", "decision-text"):
        continue
    ids = [r.get("id") for r in rows if r.get("id")]
    ds = pick_dataset(ids) if ids else None
    if not ds:
        continue
    idx = datasets[ds]
    for r in rows:
        s = idx.get(r.get("id"))
        if not s:
            continue
        if suite == "live-pipeline":
            rep = r.get("sentText") or r.get("draft"); delivered = bool(r.get("sent"))
        elif suite == "qr-live-pipeline":
            rep = r.get("shownText") or r.get("draft"); delivered = bool(r.get("delivered"))
        elif suite == "model-reply-compare":
            rep = r.get("reply"); delivered = bool(r.get("auto")); model = r.get("served") or model
        else:
            if r.get("source") != "ai":
                continue
            rep = r.get("text"); delivered = None
        if not rep or not msg_of(s):
            continue
        rep_clean = TRAILER.sub("", rep).strip()
        key = hashlib.sha1((msg_of(s) + "\x00" + rep_clean).encode()).hexdigest()[:16]
        it = items.get(key)
        if it is None:
            it = items[key] = {"id": key, "suite": suite, "scenario": s.get("id"), "dataset": ds, "message": msg_of(s),
                               "history": [{"d": h.get("direction") or h.get("role"), "t": h.get("body") or h.get("text")} for h in (s.get("history") or []) if isinstance(h, dict)][:8],
                               "reply": rep_clean, "delivered": delivered, "cls": s.get("class") or s.get("kind") or r.get("cls") or "",
                               "lang": r.get("lang") or s.get("lang"), "model": model, "date": date, "report": report, "seen": 0,
                               "skipped": r.get("skippedReason") or r.get("riskReason")}
        it["seen"] += 1
        if date and (it["date"] or "") < date:
            it.update(date=date, report=report, model=model, delivered=delivered)

out = sorted(items.values(), key=lambda x: (x["date"] or "", x["suite"], x["scenario"] or ""), reverse=True)
json.dump({"generated": max((i["date"] or "") for i in out), "count": len(out), "items": out}, open(OUT, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
print(len(out), "çift →", OUT, f"{os.path.getsize(OUT)/1e6:.1f} MB")
