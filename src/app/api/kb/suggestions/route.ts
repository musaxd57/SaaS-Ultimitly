import { prisma } from "@/lib/db";
import { jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { buildKbSuggestionsFromHistory } from "@/lib/kb-from-history";
import { buildKbSuggestionsFromTemplates } from "@/lib/kb-from-templates";
import { KB_APPROVAL_GATE_WHERE } from "@/lib/kb-review";

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
/**
 * 🚨 SORGU TAVANI. Prod'da ~17.000 mesaj var; tavansız `findMany` bir panel
 * isteğini dakikalara çıkarır. En yeniden geriye doğru okunur, yani tavan
 * "en taze N mesaj" demektir — öneri zaten TAZELİK üzerine kurulu.
 */
const MESSAGE_CAP = 3_000;

export const GET = withManage(async (session, req) => {
  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId") ?? undefined;
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

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
    take: MESSAGE_CAP,
  });

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
    { guestNamesByConversation: guestNames },
  );

  // Mülk adları — host'a hangi daire olduğunu göstermek için.
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

  return jsonOk({
    suggestions: suggestions.map((s) => ({
      ...s,
      propertyName: nameById.get(s.propertyId) ?? null,
      // 🚨 `sourceMessageIds` İZDİR, misafire ya da modele DÖNMEZ — yalnız
      // host'un "bu nereden geldi" sorusunu yanıtlar. PII taşımaz.
    })),
    fromTemplates,
    scanned: messages.length,
    windowDays: WINDOW_DAYS,
    capped: rows.length >= MESSAGE_CAP,
  });
});
