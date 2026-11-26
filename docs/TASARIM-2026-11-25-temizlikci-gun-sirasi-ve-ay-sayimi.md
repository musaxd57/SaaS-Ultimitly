# TASARIM 2026-11-25 — Temizlikçi gün sırası + ay sayımı (plan madde 10)

Kaynak: `docs/PLAN-2026-11-25-urun-fikirleri-iki-ajan.md` §10 (kurucu onayı 11-25: "3'ünü de ekle"). Veritabanı değişikliği YOK, yeni anahtar
YOK, misafire giden hiçbir şey değişmez, model çağrısı YOK.

## Bugün ne var (okuma, kodda doğrulandı)
- "Girişler" (`app/(app)/arrivals`, yalnız yönetici) her gelen konaklamanın hazırlığını gösterir; giriş saati = onaylı erken giriş kararı
  (`DecisionRequest` `early_checkin`, karar verilmiş durum + `decidedTime`) yoksa dairenin `checkInTime`'ı. Aynı gün birden çok temizlikte
  hangi daireden başlanacağı yazmıyor.
- "Erken giriş istendi" YAPILI tutuluyor: `DecisionRequest` `kind=early_checkin`, `status=pending` (misafirin istediği saat `requestedTime`,
  varsa). Kelime listesi gerekmiyor. (Karar motoru anahtarı kapalıyken bu satır yazılmaz → ölçüt o hesapta etkisiz kalır, sıra yine saatle.)
- Raporlarda görev sayımı yalnız işletme kapsamında (`getMonthlyReport` `updatedAt` ile; `getHostPerformanceScore`). Temizlikçi başına sayım YOK.
- "Bitti" yalnız `PATCH /api/tasks/[id]` ile yazılır ve AYNI işlemde `TaskUpdate{status:"done", userId: işaretleyen}` kaydı düşer (C-17).

## Ne ekleniyor
**(A) Gün sırası — yalnız Girişler sayfasında, ayrı küçük kart.** En az riskli yüzey: yalnız yönetici görür (temizlikçi görünümüne /
görev panosuna dokunulmaz → misafir adı sızma yolu açılmaz), sayfa zaten salt okuma. Kart Girişler'in üç günlük penceresini izler.
- Kapsam: türü `cleaning`, durumu "bitti" OLMAYAN, vadesi o gün olan görevler (tek tarih kuralı `taskDueDayRangeWhere` / `calendarDateOf`).
- Grup: (gün, atanan kişi). Atanmamış işler kendi grubunda ("Atanmamış"). Grupta TEK iş varsa grup gösterilmez (gürültü).
- Sıra kuralı (saf, `lib/tasks/day-order.ts`): ① aynı gün girişi olan ve erken giriş isteği (bekleyen) ya da onayı olan daireler ②
  aynı gün girişi olan öteki daireler ③ o gün girişi olmayan (yalnız çıkış) daireler. Grup içinde giriş saati erken olan önce (onaylı erken
  saat > istenen saat > dairenin giriş saati; saati bilinmeyen grubun sonunda); eşitlikte daire adı, sonra görev kimliği (kararlı).
- Hiçbir görevin saati / ataması / durumu değişmez; kartta "öneri" yazar.

ÖNCE: Girişler'de Lale 3 (15:00 giriş), Lale 5 (erken giriş istendi), Lale 7 (bugün giriş yok) satırları; sırayı ev sahibi kurar.
SONRA (kart): "Temizlik sırası önerisi · Bugün · … · Ayşe: 1. Lale 5 — giriş 12:00 · erken giriş istendi  2. Lale 3 — giriş 15:00
3. Lale 7 — o gün giriş yok".

**(B) Ay sayımı — Raporlar sayfasında tam genişlik küçük kart "Temizlikler (bu ay)".** Satır: "Ayşe — 23 temizlik".
- Sayılan: türü `cleaning`, ŞU AN durumu "bitti" VE bu ay (işletme saat diliminde, `getMonthlyReport` ile aynı ay penceresi) yazılmış bir
  "bitti" kaydı (`TaskUpdate.status="done"`) olan görev; görev başına bir (aynı ay içinde geri alınıp yeniden bitirilen bir kez sayılır).
- "Kim yaptı" = görevin ATANAN kişisi (`Task.assignedToId`). Gerekçe: personel yalnız kendisine atalı görevi "bitti" yapabilir (rota yazma
  anında koşullu); yönetici temizlikçi adına "bitti" işaretlediğinde işi yapan yine atanan kişidir — işaretleyeni saymak sayımı yöneticiye
  yazardı. `updatedAt` kullanılmaz (sonradan bir not / saklama temizliği görevi yanlış aya taşır).
- Atanmamış bitmiş temizlik: ayrı satır "Kimseye atanmamış — 4" (gizlemek toplamı eksik gösterirdi). Silinen kullanıcının ataması
  veritabanında boşalır (SetNull) → bu satıra düşer. Ekipten çıkarılan kişinin kullanıcı satırı durur → adıyla görünür (Girişler'deki ad
  deseni `assignedTo.name`).
- Para / ücret alanı YOK (plan: ikinci adım). Tek gruplu sorgu (`task.groupBy` by `assignedToId`) + ad için tek sorgu.
- Rol: Raporlar sayfası `requireManagerSession` → temizlikçi `/tasks`a yönlenir; yeni API rotası açılmadı.

## Sınırlar / bilerek yapılmayanlar
- Temizlikçinin kendi gün görünümü (görev panosu) bu turda yok — pano kartı başka işin alanı; görünürse `staff-view.ts` kuralıyla ayrıca.
- `checkin_prep` ("giriş hazırlığı") türü ne sıraya ne sayıma girer — yalnız `cleaning`.
- Doğrudan "bitti" durumunda AÇILAN görev (kaydı yok) sayılmaz: "bitti işareti" kaydı olmayan iş kanıtsızdır.
- Geçmiş aylar gösterilmez (yalnız bu ay).

## Kurucuya sorular
1. Sıra: "erken giriş istenen önce" — istek, saatten ÖNCE mi gelsin (bugünkü seçim: evet; 15:00 girişli ama erken istenen daire, 13:00
   girişli normal dairenin önüne geçer), yoksa yalnız eşit saatte mi öne alsın?
2. Atanmamış temizliklerin sırası da gösterilsin mi (bugün: evet, "Atanmamış" başlığıyla), yoksa yalnız kişiler mi?
3. Sayımda "kim yaptı": atanan kişi (seçim) mi, "bitti"yi işaretleyen kişi mi?
4. Ay sayımında "giriş hazırlığı" görevleri de temizlik sayılsın mı?

## Test planı
- Birim (`tests/unit/cleaning-day-order.test.ts`): saat sırası · erken giriş önce · yalnız çıkış sonda · saatsiz sonda · eşitlikte kararlı
  (girdi sırası değişse de aynı çıktı) · tek işli grup gösterilmez · farklı gün / kişi ayrı grup.
- Entegrasyon (`tests/integration/cleaning-day-order-load.test.ts`): gerçek PG; onaylı / bekleyen erken giriş okunur; "bitti" görev girmez;
  başka işletmenin görevi sızmaz; Girişler sayfası kartı çizer / tek işte çizmez.
- Entegrasyon (`tests/integration/cleaner-month-count.test.ts`): iki temizlikçi farklı sayı · "bitti" olmayan sayılmaz · önceki ayın
  "bitti"si sayılmaz (sınır işletme diliminde) · temizlik dışı tür sayılmaz · atanmamış ayrı · başka işletme sızmaz · Raporlar sayfası
  satırı çizer · temizlikçi rolü sayfayı açamaz.
