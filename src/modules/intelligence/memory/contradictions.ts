import "server-only";

import { prisma } from "@/lib/db";
import { aiReadableForConflicts, kbTimeConflicts } from "@/lib/kb-time-conflicts";
import { KB_CATEGORY } from "@/lib/constants";

// ---------------------------------------------------------------------------
// MÜLK HAFIZASI — OLASI ÇELİŞKİ UYARISI (değişmez 13; karar 26, kurucu 10-11: "1 ile 2 beraber; bilgi tabanı ve şikâyet iki kaynak
// birbiriyle çelişiyorsa uyarı gibi göster; bilerek olduğu işaretlenirse sorun yok").
//  (1) BİLGİ TABANI ↔ MİSAFİR: bilgi tabanında bir konuda kalem varken son 30 günde en az 3 AYRI misafir (konuşma) o BİLGİNİN yanlış /
//      olmadığını söyledi ("şifre yanlış", "otopark yok"). Arıza şikâyeti ("Wi-Fi çalışmıyor") SAYILMAZ (kurucu 10-11). Konu, anlama
//      katmanının konuşma öğesinden; "bilgi yanlış" kararı mesaj metninden (`statesInfoWrong`). Metin taşınmaz, yalnız sayılır.
//  (2) BİLGİ TABANI ↔ BİLGİ TABANI / MÜLK AYARI: uyuşmayan giriş / çıkış saatleri (`kb-time-conflicts.ts`, bilgi tabanı sayfasıyla aynı).
// Yalnız EV SAHİBİNE gösterilir; yapay zekâya GİTMEZ, cevapları değiştirmez. Ev sahibi "Bilerek böyle" derse ilgili hafıza kalemlerine
// `humanOverrideAt` yazılır ve uyarı kalkar; kalem sonradan değişirse (`observedAt` > işaret) uyarı yeniden değerlendirilir.
// LLM yok, deterministik; şema değişikliği yok (alanlar V1'de vardı).
// ---------------------------------------------------------------------------

export const CONTRADICTION_WINDOW_DAYS = 30;
export const CONTRADICTION_MIN_GUESTS = 3;

/**
 * Konuşma öğesi konusu (anlama niyeti) → bilgi tabanı kategorisi. Yalnız "bilgi yanlış" cümlesinin tanımlı olduğu konular (aşağıda);
 * giriş / çıkış SAATİ çelişkisi metinle değil (2) saat denetimiyle bulunur.
 */
export const ITEM_TOPIC_TO_KB: Readonly<Record<string, string>> = Object.freeze({
  wifi: "wifi",
  parking: "parking",
  cleaning_linen: "cleaning",
  trash: "trash",
  access_keys: "checkin",
  directions_transport: "location",
});

/**
 * 🚨 ÇELİŞKİ = misafir bilgi tabanındaki BİLGİNİN KENDİSİNİN yanlış ya da olmadığını söylüyor (kurucu 10-11: "Wi-Fi'nin çalışmamasının
 * sebebi şifre veya yanlış ağ olması değil"). İlk kural "Wi-Fi çalışmıyor" ARIZA şikâyetini de sayıyor ve ev sahibine "bilgi güncel mi?"
 * diyordu — yanlıştı. SAYILAN: şifre / kapı kodu kabul edilmiyor · "X diye bir ağ yok" / ağ adı yanlış · otopark / havlu / çöp konteyneri
 * yok · adres / konum yanlış. SAYILMAYAN: arıza / kesinti / yavaşlık ("Wi-Fi çalışmıyor", "internet yok", "Wi-Fi şifresi doğru ama
 * bağlanmıyor"), anlık durum ("otopark dolu", "otoparkta yer yok", "havlu kirli", "temiz havlu yok"), sorular ("şifre yanlış mı?"),
 * koşul ("yanlışsa"), misafirin kendi hatası ("şifreyi yanlış yazmışım", "I typed the wrong password"), olumsuzlama ("yanlış değil").
 * Yalnız Türkçe + İngilizce (öteki diller sayılmaz — temkinli: uyarı kaçabilir, yanlış uyarı üretmez). Metin Türkçe ASCII katlanır; kalıplar
 * cümle içinde, virgül / bağlaç / başka konu sözcüğü ("ama", "internet", "doğru") ARASINA girmeden, sınırlı mesafede (karesel iş yok).
 */
const W = "(?<![\\p{L}\\p{N}])"; // sözcük başı
const E = "(?![\\p{L}\\p{N}])"; // sözcük sonu
/** Özne ile fiil arasına girerse fiili başka şeye bağlayan sözcükler (bağlaç, "sorun", "doğru", bağlantı / internet). */
const BLOCK = `${W}(?:ama|fakat|ancak|lakin|ve|ile|but|and|however|though|yet|sorun|problem|sikinti|dogru|correct|right|internet|baglan|connect|sinyal|signal|wifi|wi[ -]?fi|wlan|modem)`;
const GAP = `(?:(?!${BLOCK})[^.!?;,\\n]){0,24}?`;
/** Misafirin KENDİ hatası (birinci kişi: "yazmışım / girdim / kullandık"); "yanlış yazılmış / vermişsiniz" ev sahibinin hatasıdır, sayılır. */
const SELF = "(?:yaz|gir|tusla|kullan)(?:d[iu]m|d[iu]k|mis(?:im|iz))";
/** Fiilden sonra: soru eki ("yok mu"), olumsuzlama ("yanlış değil"), kendi hatası ("yanlış yazmışım"). */
const TAIL = `${E}(?!\\s+(?:m[iu]\\p{L}{0,4}${E}|degil|${SELF}${E}))`;
const fwd = (subject: string, verb: string) => new RegExp(`${W}(?:${subject})${E}${GAP}${W}(?:${verb})${TAIL}`, "u");
/** Sıfat / "there is no" + özne (bitişik; araya yalnız tanımlık). Kendi hatası ("wrong password girdim", "typed the wrong password") hariç. */
const rev = (adj: string, subject: string) =>
  new RegExp(
    `(?<!(?:typed|entered|used|put|tried|input|enter|type|use)\\s+(?:the\\s+|a\\s+|an\\s+)?)${W}(?:${adj})\\s+(?:the\\s+|a\\s+|an\\s+|any\\s+|bir\\s+)?(?:${subject})${E}(?!\\s+${SELF}${E})`,
    "u",
  );

const WRONG_TR = "yanlis(?:ti|mis|tir)?|hatali(?:ydi|ymis|dir)?|gecersiz(?:di|mis|dir)?|degis(?:mis|tirilmis|ti|tirmissiniz)";
const WRONG_EN = "wrong|incorrect|invalid|outdated|changed|not correct|not right|isn'?t correct|isn'?t right";
const REJECTED = "kabul (?:etmiyor|etmedi|edilmiyor|edilmedi)|not accepted|isn'?t accepted|wasn'?t accepted|rejected|doesn'?t accept|didn'?t accept";
const NOT_WORK = "calismiyor(?:du)?|calismadi|olmuyor(?:du)?|olmadi|tutmuyor|tutmadi|acmiyor|acmadi|doesn'?t work|does not work|didn'?t work|did not work|isn'?t working|not working";
const MISSING_TR = "yok(?:tu|mus|tur)?|bulunmuyor(?:du)?|bulamad(?:ik|im)|bulunamad(?:i)|mevcut degil(?:di)?|eksik(?:ti)?|konulmamis|konmamis|verilmemis";
const MISSING_EN = "missing|not there|wasn'?t there|weren'?t there|isn'?t there|aren'?t there|doesn'?t exist|does not exist|don'?t exist";
const NO_EN = "there(?:'s| is| was| are| were) no|no|(?:can'?t|cannot|couldn'?t|could not) find";

const PASSWORD =
  "(?<!(?:kapi|kilit|giris|bina|daire|kutu|kasa|door|lock|gate|box)\\s+)(?:sifre(?:si|niz|siniz|yi|sini)?|parola(?:si|yi|sini)?|password|(?:wifi|wi[ -]?fi|internet|modem)\\s+kodu)";
const NETWORK_NAME = "(?:ag|wifi|wi[ -]?fi|network|wlan)\\s+(?:adi|ismi|name)|ssid";
const DOOR_CODE = "(?<!(?:wifi|wi[ -]?fi|internet|ag|modem|wlan)\\s+)(?:kod(?:u|lar|lari|unuz)?|kapi sifresi|giris sifresi|code|pin|door code|lock code|access code)";
const PARKING = "otopark(?:i|imiz|iniz)?|parking(?: lot| garage| space)?|car park|garage";
const LINEN = "havlu(?:lar)?|nevresim(?:ler)?|carsaf(?:lar)?|towels?|sheets|bed linen|linens?";
const BINS = "(?:cop )?konteyner(?:i|ler|leri)?|cop kutusu|cop kovasi|cop alani|trash (?:bin|can|area)s?|garbage (?:bin|can|area)s?|bins?|dumpster";
const PLACE = "adres(?:iniz|i)?|konum(?:unuz|u)?|address|location|map pin";

const INFO_WRONG: Readonly<Record<string, readonly RegExp[]>> = {
  // Şifre kabul edilmiyor · "X diye bir ağ yok" · ağ adı yanlış. Çıplak "Wi-Fi / internet çalışmıyor / yok" ARIZADIR, öznesi şifre / ağ adı değil.
  wifi: [
    fwd(PASSWORD, `${WRONG_TR}|${WRONG_EN}|${REJECTED}|${NOT_WORK}`),
    rev("yanlis|hatali|gecersiz|wrong|incorrect|invalid", PASSWORD),
    fwd(NETWORK_NAME, `${WRONG_TR}|${WRONG_EN}|${MISSING_TR}|gorunmuyor|cikmiyor`),
    new RegExp(`${W}(?:diye|adli|adinda|isimli|isminde|boyle|bu isimde|bu adda)\\s+bir\\s+ag(?:i)?${E}${GAP}${W}(?:${MISSING_TR}|gorunmuyor|gorunmedi|cikmiyor|cikmadi)${TAIL}`, "u"),
    new RegExp(`${W}(?:no such network|no network (?:called|named)|network (?:called|named)[^.!?;,\\n]{1,40}?(?:not showing|isn'?t showing|doesn'?t show|does not show|not visible|not there|isn'?t there|doesn'?t exist|does not exist|not found|can'?t be found))${E}`, "u"),
  ],
  checkin: [fwd(DOOR_CODE, `${WRONG_TR}|${WRONG_EN}|${REJECTED}|${NOT_WORK}`), rev("yanlis|hatali|gecersiz|wrong|incorrect|invalid", DOOR_CODE)],
  // "Otopark dolu" / "otoparkta yer yok" anlık durumdur, sayılmaz (özne "otoparkta" değil "otopark").
  parking: [fwd(PARKING, `${MISSING_TR}|${MISSING_EN}`), rev(NO_EN, PARKING)],
  // "Ekstra / fazla / temiz havlu yok" bilgi çelişkisi değildir (önünde niteleyici varsa sayılmaz).
  cleaning: [
    fwd(`(?<!(?:fazla|fazladan|ekstra|extra|yedek|more|additional|yeterli|enough|temiz|clean|baska|yeni|new|spare)\\s+)(?:${LINEN})`, `${MISSING_TR}|${MISSING_EN}`),
    rev(NO_EN, LINEN),
  ],
  trash: [fwd(BINS, `${MISSING_TR}|${MISSING_EN}`), rev(NO_EN, BINS)],
  // Adres / konum YANLIŞ (bulamamak misafirin kaybolması olabilir → sayılmaz; "konum çalışmıyor" telefonun GPS'i).
  location: [fwd(PLACE, `${WRONG_TR}|${WRONG_EN}|tutmuyor|tutmadi`), rev("yanlis|hatali|wrong|incorrect", PLACE)],
};

const TR_ASCII: Record<string, string> = { ı: "i", ş: "s", ğ: "g", ç: "c", ö: "o", ü: "u" };
const foldTr = (t: string) =>
  t.toLocaleLowerCase("tr").replace(/[ışğçöü]/g, (c) => TR_ASCII[c] ?? c).normalize("NFD").replace(/\p{M}/gu, "").replace(/[’‘ʼ`´]/g, "'");

/** Misafir bu mesajda bu kategorinin bilgisinin YANLIŞ / OLMADIĞINI söylüyor mu (soru cümleleri sayılmaz). */
export function statesInfoWrong(body: string, kbCategory: string): boolean {
  const rules = INFO_WRONG[kbCategory];
  if (!rules || typeof body !== "string" || !body.trim() || body.length > 8_000) return false;
  const clauses = foldTr(body).match(/[^.!?;\n]+[.!?;\n]*/g) ?? [];
  return clauses.some((c) => !/\?\s*$/.test(c) && rules.some((re) => re.test(c)));
}

export interface ConversationItemLite {
  conversationId: string;
  messageId: string;
  kind: string;
  createdAt: Date;
}

/**
 * Misafir mesajında konu öğesi + metin o konunun bilgisinin yanlış / olmadığını söylüyor → (konuşma, bilgi tabanı kategorisi) çiftleri.
 * Metni olmayan mesaj sayılmaz. Şikâyet öğesi ŞART DEĞİL ("Wi-Fi şifresi yanlış" anlama katmanında yalnız wifi olabilir) — karar metinde.
 */
export function infoWrongReports(
  items: readonly ConversationItemLite[],
  bodies: ReadonlyMap<string, string>,
): { conversationId: string; kbCategory: string; at: Date }[] {
  const out: { conversationId: string; kbCategory: string; at: Date }[] = [];
  const seen = new Set<string>();
  for (const i of items) {
    const kb = ITEM_TOPIC_TO_KB[i.kind];
    if (!kb) continue;
    const key = `${i.messageId}:${kb}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!statesInfoWrong(bodies.get(i.messageId) ?? "", kb)) continue;
    out.push({ conversationId: i.conversationId, kbCategory: kb, at: i.createdAt });
  }
  return out;
}

export interface TimeRowLite {
  text: string;
  itemIds: readonly string[];
  /** Mülk ayarı ↔ bilgi tabanı satırı: işaret, mülk ayarı SONRADAN değişirse geçersiz (Haiku 4. tur). */
  againstPropertyUpdatedAt?: Date | null;
}

export interface FactLite {
  id: string;
  category: string;
  /** Kaynak bilgi tabanı kaleminin kimliği (`sourceRef`). */
  kbItemId: string;
  observedAt: Date;
  humanOverrideAt: Date | null;
}

export interface ContradictionWarning {
  kind: "kb_vs_complaints" | "kb_vs_kb";
  /** İlgili bilgi tabanı hafıza kalemleri ("Bilerek böyle" bunlara yazılır). */
  memoryIds: string[];
  text: string;
}

const acknowledged = (facts: readonly FactLite[], alsoAfter: Date | null = null) =>
  facts.length > 0 &&
  facts.every(
    (f) =>
      f.humanOverrideAt !== null &&
      f.humanOverrideAt.getTime() >= f.observedAt.getTime() &&
      (alsoAfter === null || f.humanOverrideAt.getTime() >= alsoAfter.getTime()),
  );

/** Saf karar: olası çelişkiler (ev sahibinin "bilerek" işaretlediği ve sonra değişmeyenler hariç). */
export function detectContradictions(input: {
  facts: readonly FactLite[];
  topics: readonly { conversationId: string; kbCategory: string; at: Date }[];
  timeRows: readonly TimeRowLite[];
  now: Date;
}): ContradictionWarning[] {
  const out: ContradictionWarning[] = [];
  const since = input.now.getTime() - CONTRADICTION_WINDOW_DAYS * 86_400_000;
  const guestsByCategory = new Map<string, Set<string>>();
  for (const t of input.topics) {
    if (t.at.getTime() < since || t.at.getTime() > input.now.getTime()) continue;
    const set = guestsByCategory.get(t.kbCategory) ?? new Set<string>();
    set.add(t.conversationId);
    guestsByCategory.set(t.kbCategory, set);
  }
  for (const [category, guests] of [...guestsByCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (guests.size < CONTRADICTION_MIN_GUESTS) continue;
    const facts = input.facts.filter((f) => f.category === category);
    if (facts.length === 0 || acknowledged(facts)) continue;
    out.push({
      kind: "kb_vs_complaints",
      memoryIds: facts.map((f) => f.id),
      text: `Son ${CONTRADICTION_WINDOW_DAYS} günde ${guests.size} misafir bilgi tabanındaki "${KB_CATEGORY.label(category)}" bilgisinin yanlış olduğunu bildirdi. Kontrol edin.`,
    });
  }
  for (const row of input.timeRows) {
    const facts = input.facts.filter((f) => row.itemIds.includes(f.kbItemId));
    if (facts.length === 0 || acknowledged(facts, row.againstPropertyUpdatedAt ?? null)) continue;
    out.push({ kind: "kb_vs_kb", memoryIds: facts.map((f) => f.id), text: row.text });
  }
  return out;
}

/** Mülk sayfası için: kiracı + mülk kapsamlı olası çelişkiler. Okunamazsa çağıran boş liste gösterir. */
export async function getMemoryContradictions(organizationId: string, propertyId: string, now: Date = new Date()): Promise<ContradictionWarning[]> {
  const since = new Date(now.getTime() - CONTRADICTION_WINDOW_DAYS * 86_400_000);
  const [property, facts, items, kbItems] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId, organizationId }, select: { checkInTime: true, checkOutTime: true, updatedAt: true } }),
    prisma.propertyMemory.findMany({
      where: { organizationId, propertyId, status: "active", kind: "fact", source: "kb_item" },
      select: { id: true, category: true, sourceRef: true, observedAt: true, humanOverrideAt: true },
    }),
    prisma.conversationItem.findMany({
      where: {
        organizationId,
        createdAt: { gte: since, lte: now },
        kind: { in: Object.keys(ITEM_TOPIC_TO_KB) },
        conversation: { propertyId },
      },
      select: { conversationId: true, messageId: true, kind: true, createdAt: true },
      // En yeniden (Haiku 4. tur: sırasız tavan, sayfa açılışları arasında farklı sonuç verebiliyordu); `id` eşitlik bozucu.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2_000,
    }),
    prisma.knowledgeBaseItem.findMany({
      where: { propertyId, property: { organizationId } },
      select: { id: true, title: true, category: true, content: true, isActive: true, reviewState: true, updatedAt: true, supersededById: true },
    }),
  ]);
  if (!property) return [];
  const timeRows: TimeRowLite[] = kbTimeConflicts(property, aiReadableForConflicts(kbItems)).map((r) => ({
    text: r.text,
    itemIds: r.sides.map((s) => s.itemId),
    againstPropertyUpdatedAt: r.kind === "property" ? property.updatedAt : null,
  }));
  // Karar METİNDE: yalnız konu öğesi olan mesajların metni okunur; kiracı + mülk kapsamlı.
  const candidateMessageIds = [...new Set(items.map((i) => i.messageId))].slice(0, 500);
  const messages = candidateMessageIds.length
    ? await prisma.message.findMany({
        where: { id: { in: candidateMessageIds }, conversation: { propertyId, property: { organizationId } } },
        select: { id: true, body: true },
      })
    : [];
  const bodies = new Map(messages.map((m) => [m.id, m.body ?? ""]));
  return detectContradictions({
    facts: facts.map((f) => ({ id: f.id, category: f.category, kbItemId: f.sourceRef, observedAt: f.observedAt, humanOverrideAt: f.humanOverrideAt })),
    topics: infoWrongReports(items, bodies),
    timeRows,
    now,
  });
}

/** "Bilerek böyle": yalnız bu mülkün bilgi tabanı hafıza kalemlerine işaret (başka kiracı / mülk / kaynak sessizce atlanır). */
export async function acknowledgeContradiction(
  organizationId: string,
  propertyId: string,
  memoryIds: readonly string[],
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const res = await prisma.propertyMemory.updateMany({
    where: { id: { in: [...memoryIds] }, organizationId, propertyId, source: "kb_item", kind: "fact" },
    data: { humanOverrideAt: now, humanOverrideUserId: userId },
  });
  return res.count;
}
