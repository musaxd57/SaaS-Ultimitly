# CI 1793 kırmızısı — süre pinleri ve "sınırın altında, ya da doğrusal" kuralı (2026-11-12)

> Kısa cevap: kırmızı bir **kod gerilemesi değildi**. Depo private olunca CI küçük (yavaş) makinede koşmaya başladı; doğrusal ama pahalı
> işleri "1,5 saniyenin altında" diye ölçen pinler sınıra dayandı. Sınır büyütülmedi, girdi küçültülmedi; pinlere "makine mi yavaş, iş mi
> karesel" ayrımını yapan bir hakem eklendi. Yardımcı: `tests/helpers/linear-cost.ts`.

## 1. Ne oldu

- CI 1793 (`ca8e5a60`) tek testle kırmızı: `tests/unit/host-contact-cost.test.ts` "v3: Rusça başvurma + 50.000 virgüllü kuyruk" **1.617 ms**
  (sınır 1.500). Bir önceki koşu 1791 (`124f9d8d`) yeşildi.
- İki commit arasında süre aynı (ayrı çalışma ağaçlarında ölçüldü). İş doğrusal: 4.000 → 32.000 yan cümlede 54 → 401 ms (ürün kipinde).
  Vitest altında aynı iş 945–1.113 ms; CI'daki küçük makine ~1,5 kat yavaş.
- Yavaş makine benzetimi (işlemciyi dolduran 6–8 boş döngü + bütün süre kolu, tek sıra): **sekiz dosyada on iki pin** kırmızı — yani CI'da
  görülen tek hata sıradaki on birinin habercisiydi.

## 2. Neden "yeniden tetikle" ya da "sınırı büyüt" değil

`.github/workflows/ci.yml`: "Test atlama, yeniden deneme, continue-on-error, gevşetilmiş sınır YOK". Yeniden tetiklemek yazı-tura olurdu
(aynı vaka yerelde bile sınırın %63–74'ünde). Girdiyi küçültmek hafif karesel artışı gizler.

## 3. Kural (üç bölge; karar ilk — soğuk — ölçümle)

| İlk ölçüm | Hüküm |
|---|---|
| sınırın altında | **yeşil** — bugünkü pinle birebir; başka hiçbir şey ölçülmez |
| sınırın 4 katı ve üstü | **kırmızı** — hangi makinede olursa olsun |
| arada | **hakem**: aynı girdi ailesinin 1/16 boyutu aynı süreçte ölçülür. Süre 40 kattan az büyüdüyse (doğrusal ≈ 16, karesel ≈ 256) yeşil |

Hakem bölgesi bir ölçüm tekrarıdır (tam girdi dört kez daha koşar) — bunu saklamıyoruz. Ama hüküm "sonraki koşu sınırın altında mı" ile
değil yalnız büyüme oranıyla verilir: ısınınca hızlanan ama karesel kalan iş kırmızıdır (testi var).

## 4. Hakemin ölçümü nasıl bu hâle geldi (üç yanlış, bir doğru — hepsi ölçüldü)

| Protokol | Doğrusal işte oran | Sorun |
|---|---|---|
| A: soğuk tam ÷ ısınmış küçük | 15–54 | ilk koşunun bir kerelik payı oranı şişiriyor → hakem kendisi titrek |
| B: küçük ×5, sonra tek tam | 30–45 (bazı ailelerde) | aşağıdaki önbellek etkisi |
| C: küçük ×5 ortanca, tam ×2 en küçük (art arda) | 2–28 | **kör**: aynı girdi art arda koşunca ürün kodundaki tek girişli içerik önbelleklerine (`fallback.ts` `foldedCacheKey`, `relation.ts` `lastTopicsInput`) isabet ediyor (aynı tam girdi 905 → 363 → 347 ms; araya başka girdi girince 834 ms). Hakem önbellekli işi görmez — Opus incelemesi yakaladı |
| **D: dönüşümlü (küçük / tam / küçük / tam …), iki tarafta ortanca** | üçer örnekle ağır 20 ailede 3–31, ortanca 15 (yüksüz / 6 / 10 yiyici) | her koşu gerçek iş; kabul edildi (son hâli beşer örnek, sınır 40 — §8) |

## 5. Neler çevrildi

- `host-contact-cost` (37 aile) · `hazard-figurative-cost` (4) · `classifier-cost` (30) · `claim-support-cost` (11) ·
  `whitespace-run-cost` (6) · en kötü kalıp kipi sondası `regex-worst-mode-probe` (28 ölçüm; sonuçlar satır satır, alt süreç zaman aşımı
  90 → 240 sn).
- **İki paket pin bölündü**: `task-detect` (12 girdi, "toplam 4 sn") ve `fix-support-gate` (6 girdi, "toplam 4 sn") artık girdi başına
  ayrı ölçülür (1,5 sn). Toplam süre tek girdideki karesel payı seyreltiyordu (Opus: tek birimde geri gelen eski hata toplamda oranı 46'da
  bırakırdı — yeşil).
- `password-legacy-timing`: iki yolun süre oranı artık dönüşümlü üç ölçümün ortancalarıyla (bant aynı: 0,7–1,5).
- Her çevrilen girdinin tam boyutu eskisiyle **bayt bayt aynı** (uzunluk + özet karşılaştırması; karşılaştırma bir yazım hatasını —
  birleşik "á" yerine birleştirici işaretli "á" — yakaladı).
- Bölümleme (`tests/test-partition.mjs`): yardımcıyı içe aktaran dosya süre kolunda sayılır (saati kendisi okumaz).

## 6. Pin nerede gevşedi (dürüst hesap)

- Sınırın altında kalan her şey: değişmedi.
- Sınır ile 4 katı arasında: karesel payı doğrusal payının ~1,8 katını geçmeyen artış "doğrusal" sayılır. Pahalı ailede (doğrusal payı
  ~1 sn) bu, eskiden 1,5 sn'de kırmızı olan bir gerilemenin ~2,8 sn'ye kadar yeşil kalabilmesi demektir. Bedel budur; karşılığında CI
  makine hızından bağımsız. Daha dar bir sınır doğrusal işin ölçüm gürültüsüne (12–24 kat) girer.
- Yalnız bir girdinin ilk koşusunda görülen ve tavanın altında kalan yavaşlık (kalıbın yorumlayıcıda koşması): görülmez; o sınıfın bir
  kısmını `regex-worst-mode-cost` iki kötü kalıp kipinde ölçer.
- Çok girişli bir içerik önbelleği eklenirse dönüşüm onu atlatmaz (yardımcının başlığında yazılı).

## 7. Kanıt

- Yük altında bütün süre kolu (88 dosya / 3.920 test): 8 yiyicide (≈ 2,5 kat yavaş) **yeşil**; değişiklikten önce aynı düzeyde 4, daha
  hafifinde 7 + 3 pin kırmızıydı.
- Mutasyon: §8.
- İnceleme: Haiku (dar) + Opus (sert). Opus'un dört P1'i (paket seyreltmesi, önbellek körlüğü, alt süreç zaman aşımı, belgelenmiş eski
  hatanın akıbeti) işlendi; "en küçük / ortanca asimetrisi" ve "gerçek saat testleri titrek" bulguları da.

## 8. Mutasyon sonuçları (`scripts/mutation-run.mjs`, M0 yeşil)

28 mutant: yardımcının 23 kenarı (bölge sınırları, tavan, ortanca, dönüşüm sırası, örnek sayısı, ölçekli aile …) + bölümleme kuralı (1) +
ürün koduna eklenen, **sonucu değiştirmeyen ama yavaşlatan** dört mutant (`host-contact-filler.ts`).

| Mutant | Ne | Eski pin (`ca8e5a60`) | Yeni kural |
|---|---|---|---|
| H1–H23, P1 | yardımcı + bölümleme | — | **24 / 24 öldü** |
| Q1 | ağır karesel: her yan cümlede dedektör baş kısmın tamamına yeniden koşar (eski "20 bin karakterde 21 sn" hatasının biçimi) | öldü | **öldü** |
| Q4 | belgelenmiş eski hata (COST-3): önceki cümlenin okuması önbelleksiz | öldü | **öldü** |
| Q2 | hafif karesel: karesel pay doğrusal payın ~3 katı (soğuk 2.194 ms, büyüme ≈ 53–56 kat) | öldü | **6 koşunun 5'inde öldü** (kaçan koşu oturum sürecinin yeniden başladığı ana denk geldi) |
| Q3 | daha hafif: karesel pay doğrusalın ~0,8 katı, toplam 1,5 sn'nin altında | **yaşadı** | yaşadı |

- İlk denenen hâl (üçer örnek, sınır 48) Q2'yi tam koşuda **kaçırmıştı**; sınır 40 ve beşer örnek bunun için.
- Q3'ü eski mutlak pin de görmüyordu — bu değişikliğin getirdiği bir kayıp değil; iki pinin de çözünürlüğünün altında.
- Dürüst özet: belgelenmiş karesel hatalar ve ağır karesel gerileme eskisi gibi yakalanıyor; "karesel pay ≈ doğrusal payın 2–3 katı"
  bandında eski pin (hızlı makinede) kesindi, yeni kural olasılıklı (ölçüm gürültüsü). Bunun karşılığı: CI makine hızından bağımsız.

## 8b. Yük altında son durum

`node scripts/timing-under-load.mjs 8` (8 işlemci yiyici ≈ 2,5 kat yavaş): 88 dosya / 3.923 test — tek kırmızı, bu değişikliğin
eklediği üç ölçüm çiftinin `password-legacy-timing` testini 5 sn'lik varsayılan zaman aşımına taşımasıydı (oran değil süre); açık zaman
aşımı (30 sn) eklendi, yük altında yeniden koşuldu: yeşil.

## 9. Sonraya bırakılanlar (Opus önerileri — yapılmadı, kayıt)

- Düzenli ifadeleri statik olarak tarayan ayrı bir kapı (süre ölçümüne dayanmayan birincil savunma).
- Duvar saati yerine sürecin işlemci süresi (paylaşımlı çalıştırıcıda başka süreçlerin çaldığı zamanı dışarıda bırakır).
- Hakemi yalnız sınır aşılınca değil her koşuda çalıştırmak (titreklik yerelde de görünür; bedeli süre).
