# TASARIM 2026-11-25 — "Son bakım işi" notu (plan madde 9)

Kaynak: `docs/PLAN-2026-11-25-urun-fikirleri-iki-ajan.md` §9 · kurucunun onayladığı örnek:
"Bu dairede son bakım işi: 17 Mayıs — 'reset yapıldı' (Ahmet)".

## Bugün ne var (okuma, kodda doğrulandı)
- Görev türleri `lib/constants.ts` `TASK_TYPE`: cleaning · laundry · restock · checkin_prep · checkout_review · **maintenance**.
  Bakım = YALNIZ `maintenance` (misafir arıza bildiriminden açılan yapay zekâ görevi de bu türdür, `tasks/detect.ts`).
- Not / fotoğraf `TaskUpdate.note` / `photoUrl`; `PATCH /api/tasks/[id]` `{ status, note }` birlikte gelirse TEK işlemde TEK satır yazar
  (durum + not aynı satırda, kim = oturumdaki kişi). Not zorunlu değil.
- Pano (`components/tasks/task-board.tsx`) yalnız AYNI görevin son notunu gösterir. Yönetici "Tamamlandı"yı durum kutusundan, atanan
  kişi "Bitti" düğmesinden (onay sorusuyla) seçer. Not kutusu kartın "Not" açılırında.
- KVKK: saklama süpürgesi ve silme talebi görev notlarında misafir adını / iletişimini maskeler, notu SİLMEZ (`data-retention.ts`,
  `erasure.ts`). Görev silinirse notları da gider (kademe). Okunan not her zaman o anki (maskelenmiş) hâlidir.

## Ne ekleniyor
1. **Kapanışta not istemi (zorunlu değil, API değişmez):** bakım kartında not kutusunun yer tutucusu "Ne yapıldı? (isteğe bağlı)".
   Bakım görevi "Tamamlandı" / "Bitti" yapılırken kutuda kaydedilmemiş yazı varsa durumla AYNI istekte gider (tek satır: kim + ne zaman
   + not). Yazı yoksa istek eskisi gibi `{ status: "done" }`; ardından kart açılır ve "Görev tamamlandı. İsterseniz ne yapıldığını karta
   not olarak ekleyin." bilgisi çıkar. Engelleme yok, ek soru yok.
2. **Gösterim (tek yüzey — en az riskli):** görev panosunda AÇIK bir bakım görevinin kartında, aynı dairenin SON kapanmış bakım işi:
   - notlu: `Bu dairede son bakım işi: 17 Mayıs — 'reset yapıldı' (Ahmet)`
   - notsuz: `Bu dairede son bakım işi: 17 Mayıs (Ahmet)`
   - kapatan kişi bilinmiyorsa (silinmiş kullanıcı / eski kayıt) parantez yok; başka yılsa tarih yıllı ("17 Mayıs 2025").
   - hiç kapanmış bakım işi yoksa satır YOK.

## Kurallar
- "Kapanmış bakım işi" = aynı işletme + aynı daire + `type = maintenance` + `status = done`. Şu anki görev açık olduğu için zaten hariç.
- Kapanış anı = görevin en son `status = done` güncelleme satırı (kim = o satırın kişisi). Satır yoksa (eski / demo kayıt) görevin
  `updatedAt`'i, kişi yok. Tarih işletme saat diliminde.
- Not = kapanış satırının notu; boşsa o görevin en son serbest notu (durumsuz satır). "Yapılamıyor" gerekçesi (durumlu satır) "ne
  yapıldı" sayılmaz. Tek satıra indirilir, 80 karakterde kısaltılır.
- Toplu okuma: ekrandaki açık bakım görevlerinin daireleri için TEK sorgu (daire başına en yeni kayıt, `DISTINCT ON`); N+1 yok, sınırlı
  okuma + bellekte süzme yok. Okunamazsa pano yine açılır, satır çizilmez (raporlanır).
- **Yalnız yönetici görünümü.** Personel (temizlikçi / usta) satırı görmez, sorgu hiç koşmaz. Gerekçe: not serbest metin; ev sahibinin ya
  da başka bir personelin yazdığı not misafir adı / şikâyet ayrıntısı taşıyabilir ve personel o eski göreve atanmamış olabilir
  (`staff-view.ts` ilkesi: emin olunamayan metin personele gitmez). Dar taraf seçildi.

## Kapsam dışı (ikinci adım)
- Dikkat panelindeki tekrarlayan sorun satırı (`recurring_issue`, `modules/intelligence/incidents/attention.ts`) ve konuşma paneli —
  attention.ts başka bir işte değişiyor; çakışmamak için dokunulmadı. Okuma fonksiyonu (`lastClosedMaintenanceByProperty`) oraya da
  bağlanabilir.
- Sayım / cihaz eşleştirmesi ("3. kombi arızası") YOK — cihaz kaydı yok.

## Kurucuya sorular
- Usta / temizlikçi kendi bakım kartında bu satırı görsün mü? Örnek: usta "Klima" görevini açınca "Bu dairede son bakım işi: 17 Mayıs —
  'reset yapıldı' (Ahmet)" görür. Bugün görmez (not serbest metin, misafir bilgisi taşıyabilir).
- Satır tamamlanmış bakım kartlarında da görünsün mü (bugün yalnız açık kartta)?

## Test planı
- Entegrasyon (`tests/integration/last-maintenance.test.ts`): (a) notlu · (b) notsuz → tarih + kim · (c) hiç yok → satır yok ·
  (d) başka daire / başka işletme yok · (e) temizlik sayılmaz · (f) iki iş → en yenisi · "Yapılamıyor" gerekçesi not sayılmaz ·
  kapanış satırı notsuzsa serbest not · personelde satır yok. Tarihler bağıl (`Date.now()`tan gün farkı).
- Arayüz (`tests/ui/task-board-maintenance-note.test.tsx`): yer tutucu · yazılı not durumla tek istekte · notsuz "bitti" eskisi gibi
  `{ status: "done" }` · temizlikte not durumla gitmez · satır kartta görünür.
- API (g): notsuz `PATCH { status: "done" }` 200 — var olan `tasks-route` testleri + yeni tek test.
