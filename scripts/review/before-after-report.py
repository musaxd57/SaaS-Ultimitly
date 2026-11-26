#!/usr/bin/env python3
"""Eski / yeni canlı hat koşusunu senaryo senaryo karşılaştırır (kurucu 10-22: "eski yeni mesajı göster ... onu bu karara iten şeyin
ne olduğunu hangi dosya olduğunu").

Girdi: canlı hat ölçerinin (`tests/eval/live-pipeline.eval.test.ts`) iki yan dosyası (aynı veri seti, iki kod / bayrak kolu) + veri seti.
Çıktı: Markdown — özet sayılar, en sık sorulan sorularda eski / yeni cevap, kararı değişen her senaryo için sebep kodu ve o kodun TANIMLANDIĞI
dosya (kaynakta aranır, elle eşleme yok). Ücretsiz: yalnız var olan çıktıları okur.

Kullanım: before-after-report.py ESKI.json YENI.json VERI_SETI.json [--repo KÖK] > rapor.md
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

APOLOGY = re.compile(
    r"(?<![^\W\d_])(?:özür|üzgün|üzüldü|kusura bakma|sorry|apolog|regret|entschuldig|bedauer|désolé|lo siento|lamentamos|извин|сожале)",
    re.IGNORECASE,
)
FOOTER = re.compile(r"\n*\(Bu yanıt otomatik asistan tarafından hazırlandı\.\)\s*$|\n*\(This reply was prepared by an automated assistant\.\)\s*$")


def load(p: str) -> dict:
    return json.loads(Path(p).read_text(encoding="utf-8"))


def text_of(row: dict) -> str:
    t = row.get("sentText") or row.get("draft") or ""
    return FOOTER.sub("", t).strip()


def reason_of(row: dict) -> str:
    if row.get("sent"):
        return "gönderildi"
    for k in ("gateDetail", "skippedReason", "riskReason"):
        v = row.get(k)
        if v and v not in ("gate_passed",):
            return str(v)
    return "tutuldu"


_file_cache: dict[str, str] = {}


def defining_file(code: str, repo: Path) -> str:
    """Sebep kodunun kaynakta GEÇTİĞİ ilk dosya (`"kod"` dizesi) — tanım yeri için en iyi tahmin; bulunamazsa boş."""
    if code in _file_cache:
        return _file_cache[code]
    base = code.split(":")[0].split(" ")[0]
    found = ""
    if re.fullmatch(r"[a-z][a-z0-9_]{2,}", base):
        try:
            out = subprocess.run(
                ["git", "-C", str(repo), "grep", "-l", f'"{base}"', "--", "src/lib"],
                capture_output=True,
                text=True,
                check=False,
            ).stdout.split()
            # Tanım yeri genelde kapı / sınıflandırıcı dosyasıdır; test ve tip dosyaları elenir.
            out = [f for f in out if not f.endswith(".d.ts")]
            found = out[0] if out else ""
            if len(out) > 1:
                found = f"{out[0]} (+{len(out) - 1})"
        except OSError:
            found = ""
    _file_cache[code] = found
    return found


def short(t: str, n: int = 260) -> str:
    t = re.sub(r"\s+", " ", t).strip().replace("|", "/")
    return t if len(t) <= n else t[: n - 1] + "…"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("old")
    ap.add_argument("new")
    ap.add_argument("dataset")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--title", default="Eski / yeni cevap")
    a = ap.parse_args()
    repo = Path(a.repo)
    old, new, data = load(a.old), load(a.new), load(a.dataset)
    msgs = {s["id"]: s for s in data["scenarios"]}
    o = {r["id"]: r for r in old["rows"]}
    n = {r["id"]: r for r in new["rows"]}
    ids = [s["id"] for s in data["scenarios"] if s["id"] in o and s["id"] in n]

    both_ok = [i for i in ids if o[i].get("ok") and n[i].get("ok")]
    flips_hold = [i for i in both_ok if o[i].get("sent") and not n[i].get("sent")]
    flips_send = [i for i in both_ok if not o[i].get("sent") and n[i].get("sent")]
    same_dec = [i for i in both_ok if bool(o[i].get("sent")) == bool(n[i].get("sent"))]
    complaint_like = [i for i in both_ok if msgs[i]["class"] == "complaint" or (msgs[i]["class"] == "multi_turn" and msgs[i]["expect"]["autoSend"] == "no")]
    leaks = lambda rows: [i for i in both_ok if msgs[i]["expect"]["autoSend"] == "no" and rows[i].get("sent")]
    faq = [i for i in both_ok if msgs[i]["class"] in ("grounded", "multi_turn") and msgs[i]["expect"]["autoSend"] == "yes"]
    facts = lambda rows: sum(1 for i in faq if rows[i].get("factsSent") is True)
    with_facts = [i for i in faq if o[i].get("factsSent") is not None or n[i].get("factsSent") is not None]

    def pct(k: int, d: int) -> str:
        return "—" if d == 0 else f"{k}/{d} (%{round(100 * k / d)})"

    out: list[str] = []
    out.append(f"# {a.title}")
    out.append("")
    out.append(
        f"Eski: commit `{old.get('meta', {}).get('commit', '?')}` · Yeni: commit `{new.get('meta', {}).get('commit', '?')}` · iki kolda da düşmeyen senaryo {len(both_ok)}/{len(ids)}"
    )
    out.append("")
    out.append("| ölçü | eski | yeni |")
    out.append("|---|---|---|")
    out.append(f"| misafire giden (toplam) | {sum(1 for i in both_ok if o[i].get('sent'))} | {sum(1 for i in both_ok if n[i].get('sent'))} |")
    out.append(f"| 🚨 gitmemesi gerekirken giden | {len(leaks(o))} | {len(leaks(n))} |")
    out.append(f"| sık soru: misafire giden | {pct(sum(1 for i in faq if o[i].get('sent')), len(faq))} | {pct(sum(1 for i in faq if n[i].get('sent')), len(faq))} |")
    out.append(f"| sık soru: doğru olgu giden cevapta | {pct(facts(o), len(with_facts))} | {pct(facts(n), len(with_facts))} |")
    out.append(
        f"| şikâyet taslağında özür / üzüntü cümlesi | {pct(sum(1 for i in complaint_like if APOLOGY.search(text_of(o[i]))), len(complaint_like))} | {pct(sum(1 for i in complaint_like if APOLOGY.search(text_of(n[i]))), len(complaint_like))} |"
    )
    out.append(f"| karar aynı / gönderilirken artık tutulan / tutulurken artık giden | {len(same_dec)} / {len(flips_hold)} / {len(flips_send)} | |")
    out.append("")

    def block(title: str, sel: list[str]) -> None:
        if not sel:
            return
        out.append(f"## {title}")
        out.append("")
        for i in sel:
            s = msgs[i]
            ro, rn = reason_of(o[i]), reason_of(n[i])
            fo, fn = defining_file(ro, repo), defining_file(rn, repo)
            out.append(f"### `{i}` ({s['class']}, {s['lang']})")
            out.append(f"- **Misafir:** {short(s['message'], 400)}")
            out.append(f"- **ESKİ** — {'✅ gitti' if o[i].get('sent') else '⏸ tutuldu'} · sebep `{ro}`{f' · `{fo}`' if fo and not o[i].get('sent') else ''}")
            out.append(f"  > {short(text_of(o[i]), 500) or '(taslak yok)'}")
            out.append(f"- **YENİ** — {'✅ gitti' if n[i].get('sent') else '⏸ tutuldu'} · sebep `{rn}`{f' · `{fn}`' if fn and not n[i].get('sent') else ''}")
            out.append(f"  > {short(text_of(n[i]), 500) or '(taslak yok)'}")
            out.append("")

    block("Kararı değişen: eskiden gidiyordu, artık tutuluyor", flips_hold)
    block("Kararı değişen: eskiden tutuluyordu, artık gidiyor", flips_send)
    apology_changed = [i for i in complaint_like if bool(APOLOGY.search(text_of(o[i]))) != bool(APOLOGY.search(text_of(n[i])))]
    block("Şikâyet taslağı: özür / üzüntü cümlesi değişti", apology_changed)

    out.append("## En sık sorulan sorular — eski / yeni cevap yan yana")
    out.append("")
    out.append("| soru | eski cevap | yeni cevap | karar |")
    out.append("|---|---|---|---|")
    for i in faq:
        dec = ("✅→✅" if o[i].get("sent") else "⏸→✅") if n[i].get("sent") else ("✅→⏸" if o[i].get("sent") else "⏸→⏸")
        out.append(f"| {short(msgs[i]['message'], 90)} | {short(text_of(o[i]), 180)} | {short(text_of(n[i]), 180)} | {dec} |")
    out.append("")
    print("\n".join(out))


if __name__ == "__main__":
    main()
