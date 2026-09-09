import type { PropertyGraphInput } from "@/modules/intelligence/graph/property-graph";
import { seededRandom } from "./kb-retrieval-synthetic";

// ---------------------------------------------------------------------------
// SENTETİK MÜLK–MESAJ–GÖREV VERİSİ (RAG dilim 3, Codex turu 3) — deterministik.
//
// Amaç: host analizi için "basit graf sorguları" ile LightRAG/HippoRAG kıyasını
// GERÇEK misafir metni OLMADAN planlamak. Mesaj metinleri şablondan üretilir
// (anonim, tekdüze), sinyaller şablonun kategorisinden türetilir (deterministik
// sınıflandırma taklidi), görevler/hafıza kural tabanlı. ALTIN CEVAPLAR üretici
// durumundan hesaplanır (grafa ya da modele bakılmadan) — kıyas hakemi budur.
//
// Görev ↔ bildirim bağı (Codex 09-09 düzeltmesi): görev ya MESAJLA
// (`sourceMessageId` = sinyalin `sourceEntityId`si, GÖZLEMLENMİŞ) ya da
// KONAKLAMAYLA (aynı rezervasyon + aynı kategori, ÇIKARIM) bağlanır. Her
// kategoriye ayrıca bir ÇELDİRİCİ görev konur: aynı kategoride, pencere-içi
// bildirimi OLMAYAN bir konaklamanın tamamlanmış işi — bu KANIT DEĞİLDİR ve
// altın cevapta sayılmaz (eski "kategoride herhangi bir done görev" mantığının
// yanlış pozitifi tam buydu).
//
// LightRAG/HippoRAG deneyi ONAY ister (ücretli model çağrısı); onaylanınca
// aynı `messages[]` metinleri ve aynı `HOST_QUESTIONS` ona da verilir.
// ---------------------------------------------------------------------------

export type IssueCategory = "complaint" | "refund" | "early_departure" | "human_request";
export type IssueEvidence = "reported_only" | "task_open" | "task_done";
export type LinkMode = "observed" | "inferred";

export interface SynMessage {
  id: string;
  conversationId: string;
  reservationId: string | null;
  at: Date;
  /** Şablon metni (anonim). */
  text: string;
  /** Şablonun kategorisi — sinyal buradan üretilir (sınıflandırıcı taklidi). */
  category: IssueCategory | "general";
  /** Cihaz/konu etiketi (LightRAG'ın çıkarması beklenen "varlık"): klima, sıcak su, wifi… */
  entity: string | null;
}

export interface SyntheticProperty {
  input: PropertyGraphInput;
  messages: SynMessage[];
  /** Altın gerçekler — üretici durumundan. */
  truth: {
    /** Kategori → farklı konaklama sayısı (pencere içi). */
    staysByCategory: Map<string, Set<string>>;
    /** Kategori → bildirim sayısı (pencere içi). */
    reportsByCategory: Map<string, number>;
    /** Kategori → görev kanıt sınıfı — YALNIZ bildirime bağlı görevden; çeldirici sayılmaz. */
    taskEvidence: Map<string, IssueEvidence>;
    /** Kategori → bağlı görevin bağ türü (mesaj = observed, konaklama = inferred); bağlı görev yoksa kayıt yok. */
    linkMode: Map<string, LinkMode>;
    /** Bildirime BAĞLI görev sayısı (kategori başına en fazla 1). */
    linkedTasks: number;
    /** ÇELDİRİCİ görev sayısı (aynı kategori, bildirimsiz konaklamanın tamamlanmış işi) — kanıt DEĞİL. */
    decoyTasks: number;
    /** Varlık (cihaz) → bildirim sayısı — kapalı-küme kategorinin ÖTESİ (LightRAG'ın hedefi). */
    reportsByEntity: Map<string, number>;
    /** Konaklamaya YALNIZ konuşma üzerinden bağlanan sinyal sayısı. */
    conversationLinkedOnly: number;
  };
  now: Date;
  windowDays: number;
}

const TEMPLATES: { category: IssueCategory | "general"; entity: string | null; text: string }[] = [
  { category: "complaint", entity: "klima", text: "Klima çalışmıyor, oda çok sıcak." },
  { category: "complaint", entity: "sicak_su", text: "Sıcak su gelmiyor, duş buz gibi." },
  { category: "complaint", entity: "wifi", text: "İnternet sürekli kopuyor." },
  { category: "complaint", entity: "gurultu", text: "Üst kattan gece boyunca gürültü geldi." },
  { category: "complaint", entity: "temizlik", text: "Daire temiz değildi, havlular kirliydi." },
  { category: "refund", entity: null, text: "Ücret iadesi talep ediyorum." },
  { category: "early_departure", entity: null, text: "Erken çıkmak istiyoruz, mümkün mü?" },
  { category: "human_request", entity: null, text: "Bir yetkiliyle görüşmek istiyorum." },
  { category: "general", entity: null, text: "Otopark var mı?" },
  { category: "general", entity: null, text: "Çıkış saati kaçta?" },
  { category: "general", entity: null, text: "Çöpü nereye bırakayım?" },
  { category: "general", entity: null, text: "Teşekkürler, her şey çok güzeldi." },
];

const CATEGORIES: readonly IssueCategory[] = ["complaint", "refund", "early_departure", "human_request"];
const DAY = 86_400_000;

interface Report {
  signalId: string;
  msgId: string;
  resId: string;
  category: IssueCategory;
  at: Date;
}

/**
 * Tek mülk: `stays` konaklama, konaklama başına 1–3 mesaj; her 4. konaklama
 * konuşması `reservationId` YOK (QR/legacy satırı — yalnız konuşma bağı);
 * her sinyal kaynak mesajını taşır (`sourceEntityId`). Görevler kural tabanlı
 * (bağlı görev + çeldirici). Pencere: son `windowDays`.
 */
export function makeSyntheticProperty(stays = 40, seed = 7, windowDays = 30): SyntheticProperty {
  const rnd = seededRandom(seed);
  const now = new Date(Date.UTC(2026, 8, 9, 12, 0, 0));
  const propertyId = "prop_syn";
  const reservations: PropertyGraphInput["reservations"][number][] = [];
  const conversations: PropertyGraphInput["conversations"][number][] = [];
  const signals: PropertyGraphInput["signals"][number][] = [];
  const tasks: PropertyGraphInput["tasks"][number][] = [];
  const messages: SynMessage[] = [];
  const staysByCategory = new Map<string, Set<string>>();
  const reportsByCategory = new Map<string, number>();
  const reportsByEntity = new Map<string, number>();
  const windowReports: Report[] = [];
  let conversationLinkedOnly = 0;
  const since = now.getTime() - windowDays * DAY;

  for (let i = 0; i < stays; i++) {
    // En az 3 gün geçmişte: mesajlar (varış + ≤2 gün + saat) `now`u AŞMAZ — graf
    // penceresi `now`dan sonrasını dışlar, altın da aynı kümeyi görmeli.
    const arrival = new Date(now.getTime() - (3 + Math.floor(rnd() * 117)) * DAY);
    const departure = new Date(arrival.getTime() + (2 + Math.floor(rnd() * 5)) * DAY);
    const resId = `res_${i}`;
    reservations.push({ id: resId, arrivalDate: arrival, departureDate: departure, status: departure < now ? "completed" : "confirmed" });
    const convId = `conv_${i}`;
    const convLinked = i % 4 !== 3; // her 4. konuşmanın mesaj/sinyal satırı reservationId taşımaz
    conversations.push({ id: convId, reservationId: resId, createdAt: arrival });
    const msgCount = 1 + Math.floor(rnd() * 3);
    for (let m = 0; m < msgCount; m++) {
      const t = TEMPLATES[Math.floor(rnd() * TEMPLATES.length)];
      const at = new Date(arrival.getTime() + Math.floor(rnd() * 2 * DAY) + m * 3_600_000);
      const msgId = `msg_${i}_${m}`;
      messages.push({ id: msgId, conversationId: convId, reservationId: convLinked ? resId : null, at, text: t.text, category: t.category, entity: t.entity });
      if (t.category !== "general") {
        const signalId = `sig_${i}_${m}`;
        signals.push({
          id: signalId,
          category: t.category,
          kind: "message.intent",
          occurredAt: at,
          // Sinyal, mesajın taşıdığı bağı taşır: bağsız konuşmada reservationId NULL.
          reservationId: convLinked ? resId : null,
          conversationId: convId,
          sourceEntityId: msgId,
        });
        if (at.getTime() >= since && at.getTime() <= now.getTime()) {
          reportsByCategory.set(t.category, (reportsByCategory.get(t.category) ?? 0) + 1);
          const set = staysByCategory.get(t.category) ?? new Set<string>();
          set.add(resId); // ALTIN: konuşma → konaklama bağı ÜRETİCİDE bilinir
          staysByCategory.set(t.category, set);
          if (!convLinked) conversationLinkedOnly += 1;
          if (t.entity) reportsByEntity.set(t.entity, (reportsByEntity.get(t.entity) ?? 0) + 1);
          windowReports.push({ signalId, msgId, resId, category: t.category, at });
        }
      }
    }
  }

  // GÖREVLER — üretici kuralı, kategori başına:
  //   · ~1/3 hiç bağlı görev yok (reported_only)
  //   · aksi hâlde TEK bağlı görev: mesajla (observed) ya da konaklamayla (inferred); done/todo
  //   · her kategoriye BİR çeldirici: bildirimsiz konaklamanın tamamlanmış işi (kanıt DEĞİL)
  const taskEvidence = new Map<string, IssueEvidence>();
  const linkMode = new Map<string, LinkMode>();
  let linkedTasks = 0;
  let decoyTasks = 0;
  let taskSeq = 0;
  for (const cat of CATEGORIES) {
    const reports = windowReports.filter((r) => r.category === cat);
    if (reports.length === 0) continue;
    const roll = rnd();
    if (roll < 0.34) taskEvidence.set(cat, "reported_only");
    else {
      const done = roll > 0.67;
      const target = reports[Math.floor(rnd() * reports.length)];
      const viaMessage = rnd() < 0.5;
      tasks.push({
        id: `task_${taskSeq++}`,
        category: cat,
        status: done ? "done" : "todo",
        createdAt: new Date(target.at.getTime() + 3_600_000),
        // Mesaj bağında görev satırı konaklama TAŞIMAZ (QR/legacy) — bağ yalnız mesajdan.
        reservationId: viaMessage ? null : target.resId,
        sourceMessageId: viaMessage ? target.msgId : null,
      });
      taskEvidence.set(cat, done ? "task_done" : "task_open");
      linkMode.set(cat, viaMessage ? "observed" : "inferred");
      linkedTasks += 1;
    }
    // ÇELDİRİCİ (Codex 09-09): aynı kategoride, pencere-içi bildirimi OLMAYAN
    // bir konaklamanın tamamlanmış görevi. Kanıt sınıfını DEĞİŞTİRMEMELİ.
    const reportStays = new Set(reports.map((r) => r.resId));
    const decoyStay = reservations.find((r) => !reportStays.has(r.id));
    if (decoyStay) {
      tasks.push({
        id: `task_${taskSeq++}`,
        category: cat,
        status: "done",
        createdAt: new Date(now.getTime() - 60 * DAY),
        reservationId: decoyStay.id,
        sourceMessageId: null,
      });
      decoyTasks += 1;
    }
  }
  const input: PropertyGraphInput = {
    propertyId,
    reservations,
    conversations,
    signals,
    tasks,
    memories: [],
    kbItems: [{ id: "kb_parking", category: "parking", updatedAt: new Date(now.getTime() - 40 * DAY), reviewState: "approved" }],
  };
  return {
    input,
    messages,
    truth: { staysByCategory, reportsByCategory, taskEvidence, linkMode, linkedTasks, decoyTasks, reportsByEntity, conversationLinkedOnly },
    now,
    windowDays,
  };
}

/** Host soruları — altın cevaplar `truth`tan; graf ve (onaylanırsa) LightRAG aynı soruları alır. */
export const HOST_QUESTIONS = [
  { id: "H1", text: "Son 30 günde hangi sorun kategorileri tekrar etti ve kaç FARKLI konaklamada?", needs: "kategori → farklı konaklama sayısı" },
  { id: "H2", text: "Tekrar eden sorunlardan hangileri için görev açılmadı, hangileri açık, hangileri tamamlandı?", needs: "kategori → kanıt sınıfı; YALNIZ bildirime bağlı görev sayılır, başka konaklamanın eski işi sayılmaz" },
  { id: "H3", text: "Konaklamaya yalnız konuşma üzerinden bağlanan bildirim kaç tane?", needs: "sinyal → konuşma → konaklama çözümü" },
  { id: "H4", text: "Hangi CİHAZ/konu (klima, sıcak su, wifi…) en çok bildirildi?", needs: "kapalı-küme kategorinin ÖTESİ — mesaj METNİNDEN varlık; basit graf CEVAPLAYAMAZ, LightRAG hedefi" },
] as const;
