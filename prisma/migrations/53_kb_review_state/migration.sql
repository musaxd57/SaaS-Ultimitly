-- Migration 53 — bilgi tabanı ONAY SÖZLEŞMESİ (A1, 09-08).
--
-- Neden: metinden çıkarılacak TASLAK öneriler (A5) aynı tabloda yaşayacak.
-- Bugün bir kalemin modele gidip gitmeyeceğini tek bir bayrak (`isActive`)
-- belirliyor ve taslağı onunla ayırmak mümkün değil: host bir taslağı "aktif"
-- görmek istemez, ama "pasif" de host'un kapattığı kalem demektir. Onay durumu
-- bu yüzden AYRI bir kapalı küme olarak taşınıyor.
--
-- 🚨 ESKİ SATIRLAR "HOST ONAYLADI" DİYE DAMGALANMAZ (kurucu, 09-08).
-- Bu sözleşmeden önce yazılmış satırların gerçekte host'un mu yazdığı,
-- kopyalamayla mı geldiği, hiç gözden geçirilip geçirilmediği HİÇBİR YERDE
-- tutulmuyordu — böyle bir alan yoktu. Onlara `host_manual` + `approved`
-- yazmak, veriye sonradan sahte bir gerçek eklemek olurdu (V0.4'te "çıkarım
-- backfill'i YOK" kararının aynısı). Kolonlar bu yüzden `DEFAULT 'legacy'` ile
-- eklenir ve varsayılan ÖYLE KALIR: "kaynağını beyan etmeyen satır legacy'dir".
-- Geçmiş satırlar da, yarın kaynağını yazmayı unutan bir kod yolu da
-- "bilmiyoruz" der; hiçbiri sahte onay üretmez. `approved` bir varsayılan
-- DEĞİL, açıkça yazılan bir eylemdir (`src/app/api/kb/route.ts`).
--
-- DAVRANIŞ BİREBİR KORUNUR: AI erişim filtresi bir ALLOWLIST'tir ve `legacy`
-- onun İÇİNDEDİR (`src/lib/kb-review.ts`). Yani bugün modele giden her satır
-- gitmeye devam eder; kapanan tek şey `draft`tır ve bu migration hiçbir satırı
-- `draft` yapmaz. `approvedAt` mevcut satırlarda NULL kalır — onay zamanı
-- uydurulmaz.
--
-- GÜVENLİK/İŞLETİM: dolu tabloya eklenen kolonların hepsi ya NULL kabul eder ya
-- da sabit varsayılanlıdır (PG 11+ tablo yeniden yazılmaz); UNIQUE/FK/index YOK.
-- `supersededById` bilinçli olarak FK DEĞİL: KB silme HARD DELETE'tir, FK
-- silmeyi kilitlerdi (V0.4 provenance kolonlarıyla aynı gerekçe).
-- GERİ ALMA: beş kolon da DROP edilebilir; okuma yolları kolonsuz eski hâlle
-- aynı sonucu verir (allowlist yalnız `legacy`+`approved` içerdiği için).

-- AlterTable
ALTER TABLE "KnowledgeBaseItem" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "reviewState" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "sourceRef" TEXT,
ADD COLUMN     "supersededById" TEXT;
