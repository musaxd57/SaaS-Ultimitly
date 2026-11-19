import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";

export const GET = withManage(async (session, req) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;

  const conversations = await prisma.conversation.findMany({
    where: {
      property: { organizationId: session.organizationId },
      channel: { not: "chat" }, // QR guest chats live in their own "Misafir Sohbetleri" tab
      ...(status ? { status } : {}),
    },
    include: {
      property: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 500, // bound the payload — full thread rows, no pagination yet
  });
  return jsonOk(conversations);
});

/**
 * 🚨 ELLE KONUŞMA AÇMA KALDIRILDI (kurucu 11-18 akşam, tasarım `docs/TASARIM-2026-11-18-gercek-konusma-ve-ic-not.md` §1 / D2): "Lixus misafir
 * konuşması uydurmaz. Konuşma ya kanaldan gelir ya QR'dan." Bu uç eskiden ev sahibinin seçtiği kanal etiketiyle ("Airbnb" dahil) bir konuşma
 * + misafirden gelmiş gibi bir mesaj yazıyordu; kanal kimliği yazılmadığı için konuşmanın gideceği yer yoktu. Formu ve girişi kaldırıldı.
 * İstek sessizce yok sayılmaz: eski sekmeden gelen istek açık bir ret alır (405 + `Allow: GET`) ve HİÇBİR şey yazılmaz. Rol kapısı
 * (`withManage`) yerinde kalır — personel / oturumsuz istek eskisi gibi 403 / 401 alır, bürünme yazma reddi de aynı.
 * İleti kurucudan AYNEN (11-19, İK-1): eski sekmedeki form ret yanıtının `error` alanını gösterir; eski formun "Konuşma oluşturulamadı"
 * metni neden başarısız olduğunu söylemiyordu.
 */
const CREATE_REMOVED_MESSAGE = "Bu ekrandan artık konuşma oluşturulamıyor.";

export const POST = withManage(async () =>
  NextResponse.json({ error: CREATE_REMOVED_MESSAGE }, { status: 405, headers: { Allow: "GET" } }),
);
