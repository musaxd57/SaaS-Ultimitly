import { prisma } from "@/lib/db";
import { jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { buildKbSuggestionsFromHistory } from "@/lib/kb-from-history";
import { buildKbSuggestionsFromTemplates } from "@/lib/kb-from-templates";
import { KB_APPROVAL_GATE_WHERE } from "@/lib/kb-review";
import { kbHistorySuggestionsEnabled, HISTORY_MESSAGE_CAP } from "@/lib/kb-suggestions-flag";

// ---------------------------------------------------------------------------
// KNOWLEDGE HUB BACAK B — OKUMA ROTASI (SALT OKUMA).
//
// Host'un GEÇMİŞTE KENDİ YAZDIĞI cevaplardan KB ÖNERİSİ üretir. Hiçbir şey
// YAZMAZ: öneriyi host görür, "Ekle" derse mevcut `POST /api/kb` yolundan gider
// ve orada `host_manual`/`approved` damgalanır (A1 onay sözleşmesi korunur).
//
// 🚨 `withManage`: öneri host'un KENDİ geçmiş yazışmalarını içerir. Personel
// (staff) rolü kendi görevlerini görür, org'un tüm konuşmalarını DEĞİL — bu
// yüzden yönetici kapısı, `withAuth` değil.
// ---------------------------------------------------------------------------

/** Kaç günlük geçmişe bakılır — eski cevap büyük ihtimalle bayat. */
const WINDOW_DAYS = 365;

export const GET = withManage(async (session, req) => {
  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId") ?? undefined;
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  // Mülk adları — host'a hangi daire olduğunu göstermek için. Şablon bacağı da
  // kullanır, yani bayraktan BAĞIMSIZ olarak gerekir.
  const names = await prisma.property.findMany({
    where: { organizationId: session.organizationId, ...(propertyId ? { id: propertyId } : {}) },
    select: { id: true, name: true },
  });
  const nameById = new Map(names.map((p) => [p.id, p.name]));

  // ── ŞABLON KAYNAĞI (kurucu kararı 09-11) ─────────────────────────────────
  // 🚨 `MessageTemplate` misafire AYNEN gider ve MODELDEN HİÇ GEÇMEZ. Host
  // "Wi-Fi bilgisi" şablonu yazdıysa bilgi sistemde VARDIR ama asistan onu
  // kullanamaz. Kurucu "AI'yı boş bilgiyle açtırma" kapısını REDDETTİ ve doğru
  // çözümü söyledi: bilgiyi host'un zaten yazdığı yerden BUL.
  const [templates, existingKb, org] = await Promise.all([
    prisma.messageTemplate.findMany({
      where: {
        organizationId: session.organizationId,
        isActive: true,
        // 🚨 Mülk filtresi AÇIK olmalı: org geneli şablonlar (propertyId null)
        // her zaman girer, mülke bağlı olanlar yalnız seçili mülk için. Eskiden
        // filtre yoktu ve doğruluk 60 satır ötedeki saf modülün kapsam
        // savunmasına bırakılmıştı — iki katman da ötekini birincil sanıyordu.
        ...(propertyId ? { OR: [{ propertyId }, { propertyId: null }] } : {}),
      },
      select: { id: true, propertyId: true, category: true, title: true, body: true, language: true, isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.knowledgeBaseItem.findMany({
      // 🚨 ONAY KAPISI BURADA DA GEÇERLİ: "bu kategori zaten dolu" hükmünü
      // yalnız ASİSTANIN OKUYABİLDİĞİ kalem verebilir. Onaysız bir taslak
      // kategoriyi dolu göstermemeli — asistan onu okuyamaz, yani kapatmak
      // istediğimiz boşluk sessizce açık kalırdı.
      where: { property: { organizationId: session.organizationId }, isActive: true, ...KB_APPROVAL_GATE_WHERE },
      select: { propertyId: true, category: true },
    }),
    prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { language: true },
    }),
  ]);
  const fromTemplates = buildKbSuggestionsFromTemplates(templates, existingKb, names, {
    preferredLanguage: org?.language ?? "tr",
  });

  // 🚨 BAYRAK KAPALIYSA MESAJ SORGUSU HİÇ KOŞMAZ. Erken çıkış BİLİNÇLİ: aşağıdaki
  // 3.000 satırlık tarama ve sınıflandırma turu YALNIZ geçmiş bacağı içindir.
  // `scanned: null` = ÖLÇÜLMEDİ (A2 deyimi) — `0` DEĞİL, çünkü "sıfır mesaj
  // tarandı" ile "tarama hiç yapılmadı" farklı iddialardır.
  if (!kbHistorySuggestionsEnabled()) {
    return jsonOk({ suggestions: [], fromTemplates, scanned: null, windowDays: WINDOW_DAYS, capped: false });
  }

  const rows = await prisma.message.findMany({
    where: {
      createdAt: { gte: since },
      conversation: {
        // 🚨 KİRACI KAPSAMI: konuşma → mülk → org. Doğrudan org kolonu YOK.
        property: { organizationId: session.organizationId, ...(propertyId ? { id: propertyId } : {}) },
      },
    },
    select: {
      id: true,
      conversationId: true,
      direction: true,
      authorType: true,
      senderName: true,
      body: true,
      createdAt: true,
      aiAssisted: true,
      systemEventType: true,
      conversation: {
        select: {
          status: true,
          propertyId: true,
          reservation: { select: { guestName: true } },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // 🚨 CAP + 1 (dış denetim 09-18, bulgu 9): `take: CAP` ile `rows.length`
    // asla CAP'i AŞAMAZ, yani eski `>= CAP` ifadesi fiilen `=== CAP` idi ve TAM
    // 3.000 satırı olup devamı OLMAYAN org "kesildi" görünüyordu. Bir fazla
    // satır isteyip işlememek belirsizliği kaldırır.
    take: HISTORY_MESSAGE_CAP + 1,
  });
  const capped = rows.length > HISTORY_MESSAGE_CAP;
  if (capped) rows.length = HISTORY_MESSAGE_CAP;

  const messages = rows
    .filter((m) => m.conversation?.propertyId)
    .map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      propertyId: m.conversation!.propertyId,
      direction: m.direction,
      authorType: m.authorType,
      senderName: m.senderName,
      body: m.body,
      createdAt: m.createdAt,
      aiAssisted: m.aiAssisted,
      systemEventType: m.systemEventType,
    }));

  // Konuşma durumu ve misafir adı, mesaj satırlarından tekilleştirilerek çıkarılır
  // (ayrı sorgu yok). Ad YALNIZ `{isim}` maskesi için kullanılır, çıktıya GİRMEZ.
  const convStatus = new Map<string, string | null>();
  const guestNames: Record<string, string | null> = {};
  for (const m of rows) {
    if (!m.conversation) continue;
    convStatus.set(m.conversationId, m.conversation.status ?? null);
    guestNames[m.conversationId] = m.conversation.reservation?.guestName ?? null;
  }

  const suggestions = buildKbSuggestionsFromHistory(
    messages,
    [...convStatus].map(([id, status]) => ({ id, status })),
    // 🚨 `existingKb` GEÇMİŞ BACAĞINA DA VERİLİR (bulgu 2): eskiden yalnız
    // şablon bacağına gidiyordu, yani host öneriyi ekleyip "Yeniden tara"
    // deyince aynı öneri geri geliyordu.
    { guestNamesByConversation: guestNames, existingKb },
  );

  return jsonOk({
    // 🚨 `sourceMessageIds` ve `lastAnsweredAt` GÖVDEYE KONMAZ (bulgu 10):
    // hiçbir yüzey okumuyordu, yani iç mesaj kimlikleri her taramada boşuna
    // tel üzerinden gidiyordu. Alanlar sunucuda DURUYOR (iz), yalnız
    // serileştirilmiyor. Spread yerine AÇIK ALAN LİSTESİ: yeni bir alan
    // eklendiğinde sessizce istemciye sızmasın.
    suggestions: suggestions.map((s) => ({
      propertyId: s.propertyId,
      propertyName: nameById.get(s.propertyId) ?? null,
      category: s.category,
      answer: s.answer,
      exampleQuestion: s.exampleQuestion,
      occurrences: s.occurrences,
      sensitiveClasses: s.sensitiveClasses,
    })),
    fromTemplates,
    scanned: messages.length,
    windowDays: WINDOW_DAYS,
    capped,
  });
});
