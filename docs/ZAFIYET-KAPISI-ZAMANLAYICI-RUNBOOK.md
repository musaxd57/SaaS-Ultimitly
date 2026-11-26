# Zafiyet kapısı — fail-closed durumu ve haftalık çalıştırma runbook'u

> **08-09 (2), P1 #4.** Kullanıcı direktifi: *"CI fail-closed düzeltmesi ile haftalık
> çalıştırmayı AYRI DURUMLAR olarak raporla; yalnız job düzeldi diye haftalık denetim
> canlı deme."* Bu belge o ayrımı yapar ve ölçüme dayanır.

---

## 1. İKİ AYRI DURUM

| Konu | Durum | Kanıt |
|---|---|---|
| **Job fail-closed mu?** | ✅ **EVET, düzeltildi** | `scripts/audit-check.mjs` altyapı dalı artık `exit 1`; 4 mutasyon iki yönde kırmızı; davranışsal test alt süreçte gerçek script'i koşuyor (`tests/unit/audit-gate-fail-closed.test.ts`) |
| **Haftalık denetim canlı mı?** | ❌ **HAYIR — KURULMADI** | `ci.yml` yalnız `push` (main + deploy dalı) ve `pull_request` ile tetikleniyor; `schedule:` YOK ve bu dala eklense **hiç çalışmaz** (↓§3) |

🚨 **Bu iki satır birbirinin yerine geçmez.** Kapı artık koşamadığında yeşil demiyor;
ama kapı yalnız **birisi push ettiğinde** koşuyor. Bir hafta push olmazsa o hafta
yeni yayımlanan bir danışma görülmez. Bugünkü push sıklığında (günde 5-10) pratik
boşluk küçük, ama bu bir *tesadüf*, bir *garanti* değil.

---

## 2. FAIL-CLOSED'DA TAM OLARAK NE DEĞİŞTİ

Üç kırmızı yapan durum var; üçüncüsü bu turda eklendi:

1. Baseline'da **olmayan** yeni danışma → kırmızı *(eskiden de)*
2. Baseline'da **süresi dolmuş** kabul → kırmızı *(eskiden de)*
3. **Denetim hiç koşamadı** → 🆕 **kırmızı** *(eskiden `exit 0` + uyarı)*

Üçüncüsünün gerekçesi: bir tedarik zinciri kapısı **koşmadığını "yeşil" diye
raporlarsa kapı değil tiyatrodur.** Aynı dosya 08-07 (5)'te tam bu sınıfta bir
arızayla düzeltilmişti (`npm audit` altyapı hatasında da geçerli JSON basıyor →
şekil doğrulaması eklendi) ama **fail-open dalı o zaman bırakılmıştı.**

**Flakiness dengesi fail-open'la değil YENİDEN DENEMEYLE kuruldu:**
`AUDIT_RETRIES` (varsayılan 3, artan bekleme). Gerçek bir registry titremesi
ikinci denemede geçer; gerçek bir arıza üçünde de geçmez ve görünür.

**Lockfile ayrı ve NET:** `npm audit` lockfile'dan çalışır. `package-lock.json`
yoksa kapı ayrı bir mesajla kırmızı olur — "registry yok" ile aynı kovaya
düşerse yanlış yerde saat harcanır. Bu soyut değil: **varsayılan dal `main`de
lockfile YOK** (↓ölçüm).

---

## 3. NEDEN `schedule:` BU DALA EKLENEMEZ — ÖLÇÜM

GitHub'da `schedule` ile tetiklenen bir iş akışı **varsayılan daldaki workflow
dosyasından** koşar. Bu depoda ölçülen durum:

| Ölçüm | Sonuç |
|---|---|
| Varsayılan dal | **`main`** (GitHub API: `default_branch: "main"`) |
| `main`'de `.github/workflows/ci.yml` | **YOK** |
| `main`'de `package-lock.json` | **YOK** |
| `main`'de `scripts/audit-check.mjs` | **YOK** |
| `main`'de `security/audit-baseline.json` | **YOK** |
| `main` son commit | `33f2925` — **2026-07-07**, bir `Revert` |
| Dallar arası fark | deploy dalı **1199** commit ileri; `main` kendi hattında 4 ileri (ıraksak) |

**Sonuç:** deploy dalına `schedule:` eklemek **hiçbir şey yapmaz** — GitHub o
dosyayı okumaz bile. `main`'e olduğu gibi kopyalamak da yetmez: orada ne
lockfile ne script ne baseline var, yani kapı çalışsa da hiçbir şey denetleyemez
(ve artık bunu *doğru şekilde* kırmızıyla söyler).

---

## 4. ÜÇ SEÇENEK — kanıtla

### ✅ Seçenek A (ÖNERİLEN): `main`'e TEK dosyalık zamanlı workflow, deploy dalını çeksin

`schedule` workflow **dosyasını** varsayılan daldan okur, ama o workflow
`actions/checkout` ile **istediği ref'i** çekebilir. Yani `main`'i güncel hâle
getirmeye gerek yok — tek bir dosya yeter.

`main` dalına `.github/workflows/weekly-audit.yml`:

```yaml
name: Haftalik zafiyet denetimi
on:
  schedule:
    - cron: "0 6 * * 1"     # Pazartesi 06:00 UTC (TR 09:00)
  workflow_dispatch:         # elle de tetiklenebilsin
permissions:
  contents: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      # 🚨 KRİTİK: varsayilan dal DEGIL, deploy dali denetlenir.
      - uses: actions/checkout@v4
        with:
          ref: claude/great-edison-3zqpZ
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # `npm ci` gerekmez: audit yalniz package-lock.json'u okur.
      - run: node scripts/audit-check.mjs
```

**Maliyet:** `main`'e **bir** commit. Deploy akışına sıfır etki (`main` deploy
kaynağı değil — Railway `claude/great-edison-3zqpZ`'den deploy ediyor).
**Not:** ref sabit yazılı; deploy dalı adı değişirse bu dosya da güncellenmeli.

### ⚠️ Seçenek B: dış zamanlayıcı → `workflow_dispatch`

Dış bir cron (cron-job.org vb.) GitHub API'sine `workflow_dispatch` gönderir.
**Bedeli:** `actions:write` yetkili bir PAT üretilip dış serviste saklanır —
yani depo dışında yaşayan yeni bir kimlik bilgisi. Seçenek A aynı sonucu
**sıfır yeni sır** ile veriyor. Yalnız A mümkün değilse.

### ❌ Seçenek C: Railway cron — BU İŞ İÇİN UYGUN DEĞİL (ölçüldü)

Cazip görünüyor çünkü üretim imajı `package-lock.json` ve `scripts/` taşıyor
(`Dockerfile:84,101`). Ama:

- **`security/audit-baseline.json` imajda YOK** (`grep security Dockerfile` →
  yalnız `security.txt` yorumu). Script ilk satırda baseline'ı okur → çöker.
- İmaj `--omit=dev` kurulu; **dev zinciri raporu üretilemez.**
- Sonucu görünür kılmak için ayrı bir kanal (rota + `reportError`) gerekir;
  GitHub Actions bunu zaten anotasyonla veriyor.
- Kavramsal olarak yanlış yer: bu bir **kaynak/tedarik zinciri** kapısı, bir
  çalışma zamanı kontrolü değil.

**Yalnız** imaja `security/` eklenip ayrı bir bildirim kanalı kurulursa mümkün —
Seçenek A'ya göre net kayıp.

---

## 5. UYGULAMA ADIMLARI (Seçenek A)

1. `main` dalına yukarıdaki `weekly-audit.yml` dosyasını ekle (tek commit).
   ⚠️ **Ben bu dosyayı `main`'e ekleyemem** — talimat gereği yalnız
   `claude/great-edison-3zqpZ` dalına push ediyorum.
2. Actions sekmesinden **"Run workflow"** ile bir kez ELLE tetikle. İlk koşum
   yeşil değilse zamanlı koşum da olmayacaktır — bunu şimdi öğren.
3. Koşum çıktısında şu satırı doğrula:
   `Uretim bagimliliklari: N distinct danisma … Sonuc: yesil`
   Bu satır yoksa kapı **koşmamıştır** (fail-closed artık bunu kırmızıyla söyler).
4. Bir hafta sonra Actions'ta zamanlı koşumun gerçekten düştüğünü teyit et.
   ⚠️ GitHub zamanlı işleri **yoğunlukta geciktirir**; ±30 dk sapma normaldir.
5. ⚠️ **60 gün etkinlik olmazsa GitHub zamanlı iş akışlarını otomatik durdurur.**
   Bu depo aktif olduğu sürece sorun değil; uzun bir sessizlikten sonra kontrol et.

**Bu adımlar tamamlanana kadar haftalık denetim CANLI DEĞİLDİR** ve öyle
raporlanmamalıdır.

---

## 6. KALAN RİSK (dürüstçe)

- **Haftalık kapsama yok.** Kapı push'a bağlı. Push'suz bir hafta = denetimsiz
  bir hafta. Seçenek A uygulanana kadar bu böyle.
- **Fail-closed yeni bir kırılganlık ekler.** npm registry uzun süreli
  düşerse CI kırmızı olur ve deploy durur. Bilinçli takas: "kapı koşamadı"
  görünmesi, sessizce geçmesinden iyidir. Acil çıkış yolu: `AUDIT_RETRIES`
  artırmak ya da adımı bir kez atlamak — **`exit 0`'a geri dönmek DEĞİL.**
- **Kapsam hâlâ `--omit=dev`.** Dev zinciri yalnız sayı olarak raporlanır ve
  bloklamaz (gerekçe `security/audit-baseline.json` başında).
- **Baseline'daki 6 kabul kaydı hâlâ canlı** ve `expires` tarihleri geldiğinde
  kapı kırmızıya döner — bu tasarım gereği, arıza değil.
