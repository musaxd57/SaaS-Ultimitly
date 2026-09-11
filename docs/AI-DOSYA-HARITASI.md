# AI DOSYA HARİTASI — "AI'ı geliştiren, yönlendiren ve ona bağlı" HER dosya

> Kurucu isteği (09-11). Bu belge **canlı koddan üretildi** (grep + import izleme), elle
> hatırlanarak değil. Her yol tıklanabilir bir dosya yoludur.
> ⚠️ Kod değiştikçe bayatlar — üreten komutlar en altta.

---

## 0. TEK BAKIŞTA AKIŞ

```
misafir mesajı
   │
   ├─► KELİME AĞI (LLM'siz)            src/lib/ai/fallback.ts
   │        └ şikâyet/risk/intent tespiti, Türkçe morfoloji, katlamalar
   │
   ├─► BİLGİ SEÇİMİ                    src/lib/ai/kb-fetch.ts → src/lib/ai/retrieval/*
   │        └ onay kapısı + hibrit retrieval (bayrak) + sır elemesi
   │
   ├─► İSTEM KURULUMU                  src/lib/ai/prompts.ts
   │
   ├─► MODEL ÇAĞRISI                   src/lib/ai/index.ts  (OpenAI)
   │        └ STRICT şema: riskLevel kapalı küme, confidence sonlu sayı
   │
   ├─► GÖNDERİM KAPISI (karar modele VERİLMEZ)
   │        ├ kanal   src/lib/automation.ts  passesAutoReplySafetyGate
   │        └ QR      src/lib/guest-chat-gate.ts         evaluateEscalation  (rota onu import eder)
   │             └ src/lib/ai/absence.ts  ("bilgim yok" misafire gitmez)
   │
   └─► KARAR GÜNLÜĞÜ                   src/lib/risk-events.ts  (RiskEvent)
            └ src/modules/intelligence/*  (Signal → PropertyMemory → öneriler)
```

---

## 1. ÇEKİRDEK — `src/lib/ai/`

| Dosya | İşi |
|---|---|
| [`src/lib/ai/index.ts`](../src/lib/ai/index.ts) | **Model çağrısının kendisi.** `suggestReply` / `classifyMessage`; OpenAI'yi DOĞRUDAN çağırır; STRICT şema doğrulaması (F01); `usedSources` beyan↔doğrulanan ayrımı (A2) |
| [`src/lib/ai/prompts.ts`](../src/lib/ai/prompts.ts) | **TEK İSTEM KAYNAĞI.** Sistem istemi, KURAL-1..5, üslup, `packKnowledgeBase`, `conversationState`, yer tutucu notu. Dört AI yüzeyi de buradan besleniyor |
| [`src/lib/ai/fallback.ts`](../src/lib/ai/fallback.ts) | **LLM'siz deterministik beyin** (133 KB). Kelime ağları, `classifyFallback`, `detectRiskType`, `detectPromptInjection`, Türkçe morfoloji (`BREAKDOWN_DEVICES`, `reportSubjectSlot`, çekim kapısı), üç katlama (`foldTurkishLower/LowerTr/Ascii`) |
| [`src/lib/ai/absence.ts`](../src/lib/ai/absence.ts) | 🆕 **"bilgim yok" misafire GİTMEZ** (kurucu kuralı 09-11). Nesne+olumsuzlama dilbilgisi; iki yüzeyin ortak yüklemi |
| [`src/lib/ai/types.ts`](../src/lib/ai/types.ts) | `SuggestReplyInput/Result`, `PropertyContext` (modele giden mülk alanları: **yalnız 5**) |
| [`src/lib/ai/kb-fetch.ts`](../src/lib/ai/kb-fetch.ts) | Bilgi tabanı çekimi + **onay allowlist'i** (`legacy`+`approved`) + sürüm/tazelik sayaçları |
| [`src/lib/ai/grounding.ts`](../src/lib/ai/grounding.ts) | Temellendirme SINIFLANDIRMASI (A2 okuma tarafı) — `absent`/`ungrounded`/`awaiting_approval`/`capacity`/`fabricated_citation`; hiçbiri `decisive` |
| [`src/lib/ai/triage.ts`](../src/lib/ai/triage.ts) | Gelen mesaj triyajı (m48; ikinci model çağrısı YOK) |
| [`src/lib/ai/translate.ts`](../src/lib/ai/translate.ts) | Çeviri (OpenAI'yi doğrudan çağıran ikinci yer) |
| [`src/lib/ai/stated-time.ts`](../src/lib/ai/stated-time.ts) | Cevapta beyan edilen saat tespiti (P4-b çelişki kontrolü) |
| [`src/lib/ai/limits.ts`](../src/lib/ai/limits.ts) | `KB_ITEM_CAP` 30 · `KB_RETRIEVAL_FETCH_CAP` 200 · karakter bütçeleri |
| [`src/lib/ai/daily-budget.ts`](../src/lib/ai/daily-budget.ts) | Günlük AI kotası (oto-yanıt da sayar) |
| [`src/lib/ai/model-family.ts`](../src/lib/ai/model-family.ts) | Model ailesi/parametre uyumluluğu |
| [`src/lib/ai/openai-compat.ts`](../src/lib/ai/openai-compat.ts) | OpenAI istek uyum katmanı (⚠️ TEK KAYNAK DEĞİL) |

## 2. RETRIEVAL / RAG — `src/lib/ai/retrieval/` (LLM'siz, DB'siz, saf)

> Bayrak `KB_RETRIEVAL_MODE=hybrid` **VARSAYILAN KAPALI**. Tasarım:
> [`docs/RAG-GRAPHRAG-TASARIM-2026-09-09.md`](RAG-GRAPHRAG-TASARIM-2026-09-09.md)

| Dosya | İşi |
|---|---|
| [`select.ts`](../src/lib/ai/retrieval/select.ts) | **TEK BOĞAZ** `selectKbForPrompt` — dört yüzey buradan geçer |
| [`bm25.ts`](../src/lib/ai/retrieval/bm25.ts) | Türkçe-öncelikli BM25 + kök sökücü + zayıf terim ağırlığı |
| [`text.ts`](../src/lib/ai/retrieval/text.ts) | Kök sökme, ünsüz yumuşaması, tamlayan freni, normalleştirme |
| [`lexicon.ts`](../src/lib/ai/retrieval/lexicon.ts) | ~45 dar kavram sözlüğü (`terms` genişletir, `detectOnly` yalnız tespit) |
| [`sources.ts`](../src/lib/ai/retrieval/sources.ts) | Aday kaynakları: BM25 + karakter 3-gram (`ngram:"auto"`) |
| [`fusion.ts`](../src/lib/ai/retrieval/fusion.ts) | CombSUM (varsayılan) / RRF birleşimi |
| [`rerank.ts`](../src/lib/ai/retrieval/rerank.ts) | Yeniden sıralama, sürüm kuralı (`supersededById`), **alan bazlı çelişki koruma** |
| [`chunker.ts`](../src/lib/ai/retrieval/chunker.ts) | Cümle sınırlı parçalama (600/900; metin DEĞİŞMEZ) |
| [`index-cache.ts`](../src/lib/ai/retrieval/index-cache.ts) | Küme parmak izi önbelleği (id+updatedAt+özet) |
| [`semantic.ts`](../src/lib/ai/retrieval/semantic.ts) | 🚨 **YALNIZ SÖZLEŞME + NO-OP** — üretimde embedding YOK (pin) |
| [`flag.ts`](../src/lib/ai/retrieval/flag.ts) | Bayrak okuma |

## 3. GÖNDERİM KAPILARI (ürünün kalbi — karar modele verilmez)

| Dosya | İşi |
|---|---|
| [`src/lib/automation.ts`](../src/lib/automation.ts) | **`passesAutoReplySafetyGate`** + oto-yanıt göndericisi + eskalasyon + `refreshStyleProfile` (host üslubu öğrenme) |
| [`src/lib/guest-chat-gate.ts`](../src/lib/guest-chat-gate.ts) | **QR `evaluateEscalation`** — on iki kapalı-küme gerekçe + `absence_admission` + dar bant. 09-11'de rotadan BİREBİR taşındı (rota import eder); gerekçe: eval kapıyı ancak çağırabilirse ölçebilir + rotadan değer export'u `next build`i kırar. |
| [`src/lib/guest-chat.ts`](../src/lib/guest-chat.ts) | QR bağlamı, `buildGuestChatContextWindow`, `withoutSecretKbItems` (sır kapısı), `escalationReply()` |
| [`src/lib/risk-events.ts`](../src/lib/risk-events.ts) | `RiskEvent` kapalı gerekçe kümesi = AI kapısının KARAR GÜNLÜĞÜ |
| [`src/lib/kb-review.ts`](../src/lib/kb-review.ts) | KB onay sözleşmesi (A1) — `AI_READABLE_REVIEW_STATES` allowlist |
| [`src/lib/kb-placeholders.ts`](../src/lib/kb-placeholders.ts) | `{isim}`/`{daire}` ikamesi TEK KAYNAK; QR'da gerçek ad KULLANILMAZ |
| [`src/lib/shadow-ai.ts`](../src/lib/shadow-ai.ts) | Gölge pilot (`gpt-5.6-luna` Lale'de) — **yalnız GÜVENLİK sınıflandırmasını** kıyaslar |
| [`src/lib/quality-audit.ts`](../src/lib/quality-audit.ts) | Kalite denetçisi + soru↔cevap eşleştirmesi (`lte` + `id` kopma noktası) |
| [`src/lib/message-author.ts`](../src/lib/message-author.ts) | `authorType` / `GuestOps AI` sihirli string sınıflandırması |

## 4. AI YÜZEYLERİ (dördü de aynı istemi ve aynı kapıyı kullanır)

| Yüzey | Rota |
|---|---|
| Oto-yanıt (Airbnb/Booking) | [`src/lib/automation.ts`](../src/lib/automation.ts) |
| Inbox "AI öner" | [`src/app/api/conversations/[id]/ai-suggest/route.ts`](../src/app/api/conversations/%5Bid%5D/ai-suggest/route.ts) |
| Ayarlar "AI'yı test et" | [`src/app/api/ai/test/route.ts`](../src/app/api/ai/test/route.ts) · UI [`src/components/settings/ai-test-card.tsx`](../src/components/settings/ai-test-card.tsx) |
| Landing canlı demo | [`src/app/api/demo/ai/route.ts`](../src/app/api/demo/ai/route.ts) · UI [`src/components/marketing/landing-demo.tsx`](../src/components/marketing/landing-demo.tsx) |
| QR misafir sohbeti (halka açık) | [`src/app/api/chat/[token]/route.ts`](../src/app/api/chat/%5Btoken%5D/route.ts) |
| Çeviri | [`src/app/api/conversations/[id]/translate-message/route.ts`](../src/app/api/conversations/%5Bid%5D/translate-message/route.ts) |
| Hazırlık özeti | [`src/app/api/hazirlik/summary/route.ts`](../src/app/api/hazirlik/summary/route.ts) |
| Oto-yanıt testi (operatör) | [`src/app/api/hospitable/auto-reply-test/route.ts`](../src/app/api/hospitable/auto-reply-test/route.ts) |

## 5. BİLGİ TABANI (AI'ın yakıtı)

| Dosya | İşi |
|---|---|
| [`src/app/api/kb/route.ts`](../src/app/api/kb/route.ts) · [`[id]/route.ts`](../src/app/api/kb/%5Bid%5D/route.ts) · [`[id]/copy/route.ts`](../src/app/api/kb/%5Bid%5D/copy/route.ts) | KB yazma yolu; onay `host_manual`/`approved` AÇIKÇA yazılır |
| [`src/lib/kb-extract.ts`](../src/lib/kb-extract.ts) | Metinden LLM'siz çıkarım (A5) — **tarayıcıda** koşar |
| [`src/components/knowledge/kb-manager.tsx`](../src/components/knowledge/kb-manager.tsx) · [`kb-import-text.tsx`](../src/components/knowledge/kb-import-text.tsx) | KB arayüzü + "Metinden içe aktar" önizlemesi |

## 6. INTELLIGENCE (ayrı bounded context — PMS ona bağımlı değil)

| Dosya | İşi |
|---|---|
| [`src/modules/intelligence/consumer.ts`](../src/modules/intelligence/consumer.ts) | `IngestEvent` tüketicisi (idempotent, sırasız güvenli) |
| [`signals/derive.ts`](../src/modules/intelligence/signals/derive.ts) | Deterministik sinyal türetme (kelime ağını kullanır) |
| [`memory/bootstrap.ts`](../src/modules/intelligence/memory/bootstrap.ts) · [`patterns.ts`](../src/modules/intelligence/memory/patterns.ts) · [`read.ts`](../src/modules/intelligence/memory/read.ts) | `PropertyMemory` — KB'den + sinyal örüntüsünden |
| [`recommendations/kb-gaps.ts`](../src/modules/intelligence/recommendations/kb-gaps.ts) | Eksik bilgi analizi (A3) — üç sınıf, BİLDİRİM YOK |
| [`incidents/attention.ts`](../src/modules/intelligence/incidents/attention.ts) | V2.1 "Dikkat Gerektirenler" (salt-okuma) |
| [`graph/property-graph.ts`](../src/modules/intelligence/graph/property-graph.ts) | Host graf katmanı (saf, DB'siz, misafir yoluna TAŞINMAZ) |
| [`retention.ts`](../src/modules/intelligence/retention.ts) · [`labels.ts`](../src/modules/intelligence/labels.ts) · [`index.ts`](../src/modules/intelligence/index.ts) | KVKK purge · etiketler · dışa açılan yüzey |

## 7. EVAL (AI'ı ÖLÇEN katman) — `npm run eval`

| Dosya | İşi |
|---|---|
| [`evals/qr-kb-coverage.json`](../evals/qr-kb-coverage.json) | 8 senaryoluk QR kapsam dataset'i (sürümlü, anonim, `changed` alanı zorunlu) |
| [`evals/kb-retrieval-paired.json`](../evals/kb-retrieval-paired.json) | R1–R8 eşleştirilmiş legacy↔hibrit dataset'i |
| [`tests/eval/qr-kb-real-model.eval.test.ts`](../tests/eval/qr-kb-real-model.eval.test.ts) | Gerçek model koşusu + rapor üretimi |
| [`tests/eval/kb-retrieval-paired.eval.test.ts`](../tests/eval/kb-retrieval-paired.eval.test.ts) | Aynı KB iki modda; "gold istemde mi" KODDAN ölçülür |
| [`tests/eval/sidecar.ts`](../tests/eval/sidecar.ts) | Her koşunun yanına makine-okunur JSON (model kıyası için) |
| [`scripts/eval-compare-models.mjs`](../scripts/eval-compare-models.mjs) | `gpt-5.1` vs `gpt-5.6-luna` yan yana (AYRI SÜREÇ; ücretli kapı) |
| [`vitest.eval.config.ts`](../vitest.eval.config.ts) | 🚨 AYRI CONFIG ŞART — normal config anahtarı ZORLA boşaltır |
| [`docs/EVAL-CALISTIRMA.md`](EVAL-CALISTIRMA.md) | Çalıştırma talimatı (`RUN_REAL_EVAL=1` + gerçek anahtar) |

## 8. TESTLER (AI davranışını PİNLEYENLER)

**Birim** — `tests/unit/`:
[`golden-scenarios.test.ts`](../tests/unit/golden-scenarios.test.ts) (~105 senaryo, prompt/kelime ağı değişince koşar) ·
[`ai-prompts.test.ts`](../tests/unit/ai-prompts.test.ts) · [`ai-output-schema.test.ts`](../tests/unit/ai-output-schema.test.ts) ·
[`ai-fallback.test.ts`](../tests/unit/ai-fallback.test.ts) · [`ai-evidence.test.ts`](../tests/unit/ai-evidence.test.ts) ·
[`ai-kb-omission.test.ts`](../tests/unit/ai-kb-omission.test.ts) · [`ai-multi-question.test.ts`](../tests/unit/ai-multi-question.test.ts) ·
[`ai-openai-failure.test.ts`](../tests/unit/ai-openai-failure.test.ts) · [`ai-cost-guards.test.ts`](../tests/unit/ai-cost-guards.test.ts) ·
[`ai-triage-contract.test.ts`](../tests/unit/ai-triage-contract.test.ts) · [`openai-request-contract.test.ts`](../tests/unit/openai-request-contract.test.ts) ·
[`absence-never-sent.test.ts`](../tests/unit/absence-never-sent.test.ts) 🆕 · [`absence-detector.test.ts`](../tests/unit/absence-detector.test.ts) ·
[`complaint-negative-verbs.test.ts`](../tests/unit/complaint-negative-verbs.test.ts) · [`language-parity.test.ts`](../tests/unit/language-parity.test.ts) ·
[`secret-detection-golden.test.ts`](../tests/unit/secret-detection-golden.test.ts) · [`claim-detectors.test.ts`](../tests/unit/claim-detectors.test.ts) ·
[`prompt-honest-commitments.test.ts`](../tests/unit/prompt-honest-commitments.test.ts) · [`guest-text-quality.test.ts`](../tests/unit/guest-text-quality.test.ts) ·
[`qr-escalation-claim.test.ts`](../tests/unit/qr-escalation-claim.test.ts) · [`kb-review-contract.test.ts`](../tests/unit/kb-review-contract.test.ts) ·
[`kb-extract.test.ts`](../tests/unit/kb-extract.test.ts) · [`kb-placeholders.test.ts`](../tests/unit/kb-placeholders.test.ts) ·
[`translate.test.ts`](../tests/unit/translate.test.ts)
**Retrieval:** [`kb-retrieval-select.test.ts`](../tests/unit/kb-retrieval-select.test.ts) · [`-scale`](../tests/unit/kb-retrieval-scale.test.ts) ·
[`-morphology`](../tests/unit/kb-retrieval-morphology.test.ts) · [`-baseline`](../tests/unit/kb-retrieval-baseline.test.ts) ·
[`-chunker`](../tests/unit/kb-retrieval-chunker.test.ts) · [`-text`](../tests/unit/kb-retrieval-text.test.ts) ·
[`-evidence-prompt`](../tests/unit/kb-retrieval-evidence-prompt.test.ts)

**Entegrasyon** — `tests/integration/`:
[`qr-draft-vs-delivered.test.ts`](../tests/integration/qr-draft-vs-delivered.test.ts) (🚨 taslak ≠ teslim edilen) ·
[`qr-quality-eval.test.ts`](../tests/integration/qr-quality-eval.test.ts) · [`qr-informational-answer.test.ts`](../tests/integration/qr-informational-answer.test.ts) ·
[`qr-context-window.test.ts`](../tests/integration/qr-context-window.test.ts) · [`qr-conversation-context.test.ts`](../tests/integration/qr-conversation-context.test.ts) ·
[`qr-greeting-repeat.test.ts`](../tests/integration/qr-greeting-repeat.test.ts) · [`qr-grounding-record.test.ts`](../tests/integration/qr-grounding-record.test.ts) ·
[`qr-escalation-traceability.test.ts`](../tests/integration/qr-escalation-traceability.test.ts) · [`qr-kb-placeholder-parity.test.ts`](../tests/integration/qr-kb-placeholder-parity.test.ts) ·
[`auto-reply-channel.test.ts`](../tests/integration/auto-reply-channel.test.ts) · [`ai-output-schema-autosend.test.ts`](../tests/integration/ai-output-schema-autosend.test.ts) ·
[`ai-source-audit.test.ts`](../tests/integration/ai-source-audit.test.ts) · [`ai-test-autosend.test.ts`](../tests/integration/ai-test-autosend.test.ts) ·
[`demo-ai-route.test.ts`](../tests/integration/demo-ai-route.test.ts) · [`grounding-traceability.test.ts`](../tests/integration/grounding-traceability.test.ts) ·
[`grounding-evidence.test.ts`](../tests/integration/grounding-evidence.test.ts) · [`kb-retrieval-qr-route.test.ts`](../tests/integration/kb-retrieval-qr-route.test.ts) ·
[`kb-retrieval-auto-reply.test.ts`](../tests/integration/kb-retrieval-auto-reply.test.ts) · [`kb-retrieval-secret-scope.test.ts`](../tests/integration/kb-retrieval-secret-scope.test.ts) ·
[`kb-gaps.test.ts`](../tests/integration/kb-gaps.test.ts) · [`kb-coverage-before-after.test.ts`](../tests/integration/kb-coverage-before-after.test.ts) ·
[`shadow-ai.test.ts`](../tests/integration/shadow-ai.test.ts) · [`quality-audit-pairing.test.ts`](../tests/integration/quality-audit-pairing.test.ts) ·
[`escalation-model-path-claim.test.ts`](../tests/integration/escalation-model-path-claim.test.ts) · [`ai-budget-order.test.ts`](../tests/integration/ai-budget-order.test.ts)

**Yardımcılar** — [`tests/helpers/absence-detector.ts`](../tests/helpers/absence-detector.ts) (ürünün yeniden-dışa-aktarımı) ·
[`claim-detectors.ts`](../tests/helpers/claim-detectors.ts) · [`kb-retrieval-scenarios.ts`](../tests/helpers/kb-retrieval-scenarios.ts) ·
[`graph-synthetic.ts`](../tests/helpers/graph-synthetic.ts)

## 9. BELGELER (AI'ı YÖNLENDİREN kararlar)

| Belge | Ne söyler |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | **Proje hafızası** — kurallar + güncel durum; her oturumda okunur |
| [`docs/KURUCU-TALIMATI-2026-09-07-urun-vizyonu-ve-degismezler.md`](KURUCU-TALIMATI-2026-09-07-urun-vizyonu-ve-degismezler.md) | Ürün vizyonu + 20 teknik değişmez (çelişkide BU kazanır) |
| [`docs/TEST-EVIDENCE-CONTRACT.md`](TEST-EVIDENCE-CONTRACT.md) | **BAĞLAYICI** kanıt sözleşmesi (kırmızı-önce + mutasyon + kapılar) |
| [`docs/KURAL-2026-09-11-bilgim-yok-misafire-gitmez.md`](KURAL-2026-09-11-bilgim-yok-misafire-gitmez.md) | 🆕 Kurucu kuralı + ölçüm |
| [`docs/RAG-GRAPHRAG-TASARIM-2026-09-09.md`](RAG-GRAPHRAG-TASARIM-2026-09-09.md) | Retrieval tasarımı + onay tablosu |
| [`docs/TASARIM-2026-09-11-knowledge-hub-ve-kurumsal-hafiza.md`](TASARIM-2026-09-11-knowledge-hub-ve-kurumsal-hafiza.md) | 🆕 Knowledge Hub (ilan/geçmiş cevap/PDF) + org düzeyi KB |
| [`docs/DEGERLENDIRME-2026-09-11-gecmis-cevap-yeniden-kullanimi.md`](DEGERLENDIRME-2026-09-11-gecmis-cevap-yeniden-kullanimi.md) | Geçmiş host cevaplarını yeniden kullanma |
| [`docs/DEGERLENDIRME-2026-09-08-bilgi-tabani-doldurma-ve-retrieval.md`](DEGERLENDIRME-2026-09-08-bilgi-tabani-doldurma-ve-retrieval.md) | KB doldurma ↔ retrieval ayrımı |
| [`docs/EVAL-BULGULARI-2026-09-09-kok-neden-ve-duzeltme-plani.md`](EVAL-BULGULARI-2026-09-09-kok-neden-ve-duzeltme-plani.md) | Gerçek koşu bulguları + P1–P5 |
| [`docs/ACIK-2026-09-08-qr-cevap-kalitesi.md`](ACIK-2026-09-08-qr-cevap-kalitesi.md) | QR cevap kalitesi açık işleri |
| [`docs/ACIK-2026-09-08-turkce-sikayet-siniflandirma-eksigi.md`](ACIK-2026-09-08-turkce-sikayet-siniflandirma-eksigi.md) | Türkçe şikâyet sınıflandırma (8 inceleme turu) |
| [`docs/V1-PROPERTY-MEMORY-DESIGN.md`](V1-PROPERTY-MEMORY-DESIGN.md) | Property Memory + Signals tasarımı |
| **Onay bekleyenler** | [`ONAY-yer-tutucu-cikti-vetosu-2026-09-09.md`](ONAY-yer-tutucu-cikti-vetosu-2026-09-09.md) · [`ONAY-qr-mulk-kimlik-alanlari-sir-taramasi-2026-09-11.md`](ONAY-qr-mulk-kimlik-alanlari-sir-taramasi-2026-09-11.md) · [`ONAY-acil-asci-carpismasi-2026-09-10.md`](ONAY-acil-asci-carpismasi-2026-09-10.md) |
| **Ölçümler** | [`docs/olcum/`](olcum/) — retrieval ölçek/kaçak raporları, graf baseline, KB önce/sonra |

## 10. AI'I YÖNLENDİREN ENV DEĞİŞKENLERİ

| Env | Anlamı |
|---|---|
| `OPENAI_MODEL` | Üretim modeli (`gpt-5.1`). 🚨 Değiştirmek gönderim hot-path'i rekalibrasyonudur |
| `OPENAI_API_KEY` | Model anahtarı; **normal test suite'inde ZORLA boşaltılır** |
| `KB_RETRIEVAL_MODE` | `hybrid` = yeni retrieval. **VARSAYILAN KAPALI** |
| `QR_INFORMATIONAL_BAND_ENABLED` | QR dar bant. **VARSAYILAN KAPALI** |
| `SHADOW_AI_ENABLED` · `SHADOW_AI_MODEL` · `SHADOW_AI_ORG_IDS` | Gölge pilot (luna, yalnız güvenlik sınıflandırması) |
| `AUTO_REPLY_ENABLED` · `GUEST_CHAT_ENABLED` · `LANDING_DEMO_ENABLED` | Yüzey açma/kapama |
| `RUN_REAL_EVAL` · `EVAL_COMPARE_YES` | Ücretli eval kapıları |

---

## Bu listeyi YENİDEN ÜRETME

```bash
find src/lib/ai src/modules/intelligence -type f | sort
grep -rln "suggestReply\|classifyMessage" src/app src/lib
grep -rln "openai\|OPENAI\|from \"@/lib/ai" src --include=*.ts --include=*.tsx
ls tests/unit tests/integration | grep -iE "ai|kb|qr|golden|absence|grounding|retrieval"
```
