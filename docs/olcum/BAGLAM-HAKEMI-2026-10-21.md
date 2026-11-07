# Bağlam hakemi — "bilgim yok" kararı kelimeyle mi, bağlamla mı? (gerçek model, 2026-10-21)

Kurucu (10-21): *"kelime bazlı yapma kodları — bağlam / anlam / amaç bazlı yapamıyor muyuz, öyle daha iyi olmuyor mu? Testlerle kontrol
et, gerçek sorularla."*

**Veri:** önceki gerçek-model ölçümlerinden (`docs/olcum/*.json`, kör / mühürlü setler hariç) çıkarılan **6.149 benzersiz misafir mesajı +
yapay zekâ taslağı** çifti. Kelime kuralı (`admitsMissingKnowledge`, W4 düzeltmesinden sonra) hepsinde koştu → **69 tutma**. Hakem
(`src/lib/ai/semantic/absence-judge.ts`, gpt-5.1, şema zorlamalı) bu 69'un hepsinde + rastgele **500** tutulmayan cevapta koştu.
Doğru cevap (etiket): her cevap misafirin mesajıyla birlikte **elle okundu** (Claude). Yan dosya `BAGLAM-HAKEMI-2026-10-21.json`.
Maliyet ≈ $0,6 · hakem düşen 0/569 · gecikme p50 1,6 sn / p95 2,9 sn.

## 1. Kelime kuralının tuttukları (69)

| | sayı |
|---|---|
| gerçekten "bilgim yok" (doğru tutma) | 51 |
| aslında bilgisizlik DEĞİL (yanlış tutma) | 17 |
| sınırda (fiyat sorusunu geçiştirme) | 1 |
| **hakem doğru bıraktı** (yanlış tutmalardan) | **16 / 17** |
| **hakem yanlış bıraktı** (gerçek itiraflardan) | **0 / 51** |
| hakemle ayrıştığımız tek satır | "Fiyatlar döneme göre değiştiği için net gecelik ücret paylaşamıyorum" — hakem "itiraf" dedi (tutucu yön, zararsız) |

Yanlış tutma örnekleri (bugün ev sahibine düşüyor, hakemle giderdi):
- "The house rules require prior host approval for visitors not listed on the reservation…" (ev kuralı; "not listed" kelimesi)
- "For security, the safe is not available for guest use." (olgu; "is not available")
- "Geç çıkış konusunda yeni bir bilgi yok. … bu konu ev sahibinizin kararıdır" (durum cevabı; "bilgi yok")
- "Anahtar kutusunun kodu varış günü gönderilen mesajdaki gibidir; kayıtlarımda bir değişiklik görünmüyor." (cevap)
- "Les règles prévoient que les visiteurs … ne peuvent venir qu'avec l'accord préalable de l'hôte" (Fransızca ev kuralı)

## 2. Kelime kuralının KAÇIRDIKLARI (500 rastgele tutulmayan cevap)

Hakem 27'sine "itiraf" dedi; elle okununca:

| | sayı | örnek |
|---|---|---|
| açık itiraf, kelime kuralı kaçırmış (misafire GİDEBİLİYORDU) | **8** | "The checkout time records are inconsistent." · "No tengo en mis notas instrucciones específicas para ese proyector" · Arapça "…سجلات الشقة المتاحة لي…" · "Müsaitlik durumunu doğrudan göremiyorum" · "I can't confirm whether someone is coming" |
| "bunu ev sahibiniz söyleyebilir" geçiştirmesi (örtük bilgisizlik) | 15 | "havuz var mı" → "Havuz bilgisi için ev sahibiniz size kesin bilgi verebilir." |
| sınırda (fiyat / iade kararını ev sahibine bırakma) | 2 | "Die Kostenfrage ist Sache Ihres Gastgebers." |
| hakem hatası | 2 | yalnız "mesajınız kaydedildi" diyen cevap; bir soruyu atlayan cevap |

Oran: 8 / 500 = %1,6 açık itiraf kelime kuralından kaçıyor (6.080 tutulmayan cevaba yayınca ≈ 100 cevap). Geçiştirmeler bugün kural
dışında (CLAUDE.md: "belirsizlik ve savuşturma BİLİNÇLİ dışarıda") — ama kurucunun 10-17 M1 sözü ("bilgi veremem cümlesi tabii ki
tutulsun, sussa daha iyi") bu sınıfı da kapsıyor olabilir → **kurucu kararı**.

## 3. Sonuç ve kodda ne var

- **Kelime kuralı tek başına yanlış:** tuttuklarının %25'i itiraf değil, kaçırdığı itiraflar da var.
- **Bağlam hakemi kelime kuralının adayını doğru ayırıyor** (16/17 doğru bırakma, 0/51 yanlış bırakma).
- Kodda (varsayılan KAPALI, Railway açılınca kurucu + ilk denemeler):
  - `AI_ABSENCE_JUDGE_ENABLED=1` → kelime kuralının adayını hakem okur; itiraf değilse cevap gider; hakem düşerse bugünkü kural (tutar).
  - `AI_ABSENCE_JUDGE_STRICT=1` (yalnız yukarıdakiyle) → kapıdan geçen her aday cevabı da okur, kaçan itirafı ve geçiştirmeyi tutar.
  - Hüküm yalnız okuduğu metne uygulanır (koddan kurulan metin yerine geçerse eski hüküm taşınmaz). Kanal + QR aynı kural.
- Testler: `tests/unit/absence-judge.test.ts` (karar tablosu, çağrı sözleşmesi) · `tests/integration/absence-judge-wiring.test.ts`
  (kanal + QR gerçek akış; bağlantı geri alınınca 4 test kırmızı).

## 4. Öteki kelime kuralları (Haiku envanteri, 45 kural)

Misafir mesajı tarafındaki kuralların çoğunun (acil, şikâyet, iade, insan talebi, müsaitlik) **model karşılığı zaten var ve birlikte
çalışıyor** (anlama katmanı + bekçi); bu kurallar yalnız TUTMAYI artırır, model bağlamla geri çekebilir (örn. "acil değil"). Model
karşılığı OLMAYANLAR cevap tarafında: "mesajınız kaydedildi" bildirimi, acil numara yönlendirmesi, güvence cümlesi, ödeme yöntemi,
kapı kodu, kaynaksız somut iddia. Sıradaki aday — aynı yöntemle (gerçek cevaplarda kelime vs hakem ölçümü, sonra karar).
