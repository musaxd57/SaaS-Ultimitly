# ONAY PAKETİ — E2: embedding vektör tablosu (migration 56)

**Durum:** ⛔ UYGULANMADI. Bu belge KURUCUNUN KARARINI bekler.
**Neden ayrı onay:** migration içeriyor → bağlayıcı kural gereği **taze `pg_dump` +
açık "push et"** şart (migration 55'te yapılan usulün aynısı).

---

## 0. "Neden hâlâ para ödeyip koşmadık?" — dürüst cevap

Sebep **para değil**. Ölçülen maliyet kurucu org'un **TÜM** bilgi tabanı için
**0,18 sent** (tek sefer), en ağır müşteri 3 sent. Sorgu tarafı mesaj başına
67 token = sohbet isteminin **%0,37**'si.

Sebep şu: vektörleri **bir yere yazmak** gerekiyor ve o tablo bir migration.
Bu repoda migration = taze yedek + açık onay. E1 (sağlayıcı) ve sertleştirme
(önbellek/tekrar-deneme/in-place) migration'sız yapıldı ve CANLI; tıkanan tek
halka bu tablo.

⚠️ Bellek içi LRU önbellek E2'nin YERİNE GEÇMEZ: süreç yeniden başlayınca boşalır
ve Railway'de deploy başına en az bir kez boşalır. "Aynı KB parçasını iki kez
ödememe" garantisi ancak KALICI saklamayla olur.

---

## 1. Ne eklenecek (tek tablo, additive)

```prisma
model KbChunkEmbedding {
  id             String   @id @default(cuid())
  organizationId String                  // kiracı kapsamı (her yeni yolda davranışsal test)
  kbItemId       String                  // kaynak kalem
  chunkIndex     Int                     // parçalayıcının verdiği sıra
  contentHash    String                  // 🚨 BAYATLAMA KAPISI (↓ §2)
  model          String                  // "text-embedding-3-small"
  dims           Int                     // 1536
  vector         Bytes                   // Float32Array ham baytları (1536×4 = 6.144 B)
  createdAt      DateTime @default(now())

  @@unique([kbItemId, chunkIndex, model])
  @@index([organizationId, kbItemId])
}
```

**Neden `Bytes`, `pgvector` DEĞİL:** aday kümesi ≤300 parça ve brute-force kosinüs
**1,37 ms** ölçüldü. pgvector Railway'de prod DB **taşıma** projesi ister
(eklenti kurulumu + plan değişikliği) — ölçülmüş bir ihtiyaç olmadan alınacak
risk değil. Ölçek büyürse geçiş yolu açık kalır (vektörler zaten saklı).

**Şema kuralına uygunluk (bağlayıcı liste):** yeni TABLO güvenli; dolu tabloya
`@unique` / required-no-default / drop **YOK**. Boot'ta patlama riski yok.

---

## 2. 🚨 BAYATLAMA — bu tasarımın en kritik yeri

`contentHash` = parçanın METNİNİN SHA-256'sı.

- Host bir KB kalemini düzenlerse **hash değişir** → eski satır artık eşleşmez →
  yeniden gömülür. **Eski vektörün yeni metne dönme ihtimali YAPISAL OLARAK YOK.**
- `updatedAt` ile anahtarlamak YETMEZDİ: iki farklı içerik aynı damgayı alabilir
  (retrieval önbelleğinde bu ders 09-09'da zaten ödendi — oradaki anahtar da
  `max(updatedAt)` değil **küme parmak izi**).
- `model` anahtara dâhil: model değişirse eski vektörler sessizce karışmaz.

## 3. KVKK — yeni veri sınıfı AÇILMIYOR

Kurucu 09-12'de haklıydı ve kodda doğrulandı: misafirin mesajı (`prompts.ts`
istem gövdesi) ve KB içeriği (`packKnowledgeBase`) **ZATEN** `api.openai.com`a
gidiyor. Embedding yeni bir VERİ SINIFI da yeni bir SAĞLAYICI da eklemiyor.

Tek gerçek yenilik: **vektörler bizim DB'mizde duruyor**. Bunlar zaten
sakladığımız metinden türeyen değerlerdir. Yine de üç kural yazılı olsun:

1. **Yalnız ONAYLI KB parçaları gömülür** (`KB_APPROVAL_GATE_WHERE` — taslak
   metin vektöre girmez; A1 sözleşmesinin aynısı).
2. **Misafir mesajı SAKLANMAZ** — sorgu vektörü anlıktır, DB'ye yazılmaz.
3. **Mülk/kalem silinince vektör de silinir** (FK cascade ya da aynı TX'te
   temizlik; erasure/retention süpürgeleriyle parite testi ŞART).

## 4. Rollout (ölçüm olmadan genişletme YOK)

| Adım | Ne | Kapı |
|---|---|---|
| E2 | Tablo + migration 56 | **taze `pg_dump` + açık onay** |
| E3 | Yazma yolu: KB kaydedilince parçaları göm | bayrak kapalı; tek test mülkü |
| E4 | ÖLÇÜM: `ru`/`ar`/`de` sorgularında isabet gerçekten artıyor mu | rapor `docs/olcum/` |
| E5 | Sorgu tarafını seçiciye bağla | **ayrı onay**; E0 zaten hazır (RRF + eşik) |

🚨 **E5'ten önce E4 şart.** Bugünkü en güçlü gerekçe ölçülmüş bir BOŞLUK
(Rusça/Arapça'da sözcüksel eşleşme **yapısal olarak yok**), ama "boşluk var"
ile "embedding onu kapatıyor" AYRI iddialardır. İkincisi ölçülmeden açılmaz.

## 5. Geri alma

- E2 tek başına **davranış değiştirmez** (tablo boş, okuyan yok).
- E5 bayrağı kapatmak seçiciyi eski hâline döndürür (`select.ts` `semantic`
  verilmediğinde bugünkü davranış, test-pinli).
- Tablo `DROP` edilebilir; hiçbir çekirdek yol ona bağlı değil.

---

## KURUCUNUN VERECEĞİ KARAR

1. **Taze `pg_dump` al** (migration 55'teki gibi SHA256 ile).
2. "E2'yi push et" de.

Onay gelmeden bu belgedeki hiçbir şey uygulanmaz.
