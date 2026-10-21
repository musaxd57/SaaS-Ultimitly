# Claude çalışma paketi — 1. dalga (2026-10-21)

Kurucu 10-21: "100 dolarım bomboş duruyor — testler, öneriler, pazar analizi, geliştirmeler; Sonnet 5.5." Paket GitHub Actions'ta koştu
(`.github/workflows/claude-work.yml`, betik `scripts/claude-work/run.ts`, istek `evals/claude-work-request.json`). Model `claude-sonnet-5-5`.

**Harcama: $23,87** (tavan $60) · 82 çağrı · 85 web araması · ret 0 · hata 0 · ayrıntı `kullanim.json`.

| İş | Maliyet | Çıktı | Durum |
|---|---|---|---|
| Pazar araştırması (web aramalı, 7 konu + strateji notu) | $3,72 | `market/00-strateji-notu.md` + `01…07` | okunacak; sayılar rapor kaynaklarına dayanır, karar değildir |
| Kod incelemesi (src/lib + src/app/api, 3 mercek) | $16,52 | `code-review/bulgular.json` — 100 bulgu (P1 14, P2 86) | P1'ler kodla doğrulanıyor; doğrulanmamış bulgu düzeltme sebebi değildir |
| Senaryo üretimi (anlama ölçümü) | $2,12 | `evals/understanding-e2e-gen.json` — 286 senaryo, 480 istek, 7 dil, doğrulayıcıdan geçti | geliştirme seti; örneklem insan gözüyle denetlenecek |
| Müşteriye görünen metin denetimi | $1,48 | `ux-copy/bulgular.json` — 165 öneri | müşteriye giden metni değiştirir → kurucuya önce/sonra sorulur |

Kurallar: bulgular kodla doğrulanmadan uygulanmaz (CLAUDE.md "ajan önerisi karar değildir"); müşteriye giden cevabı ya da metni değiştiren her
öneri kurucuya önce/sonra örnekli sorulur.
