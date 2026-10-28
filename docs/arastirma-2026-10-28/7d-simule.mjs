// 7-D gönderim zamanı — kural kolu (A) ve karma politikanın KOD katmanı (C) simülasyonu.
// Saf: veritabanı / ağ / model / vitest YOK. Girdi: senaryo JSON yolu (argüman). Çıktı: tablo + özet (stdout).
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(process.argv[2], "utf8"));
const STD_OUT = data.ortak.standartCikis; // "11:00"
const DEF_RES = data.ortak.varsayilanRezervasyon;

const day = (iso) => iso.slice(0, 10);
const hhmm = (iso) => iso.slice(11, 16);
const minutes = (iso) => Date.parse(iso + ":00Z") / 60000; // yerel duvar saati, tek dilim → fark doğru
const hoursBetween = (a, b) => (minutes(b) - minutes(a)) / 60;

function stage(res, iso) {
  const d = day(iso);
  if (d > res.cikis) return "post_stay";
  if (d === res.cikis) return "departure_today";
  if (d > res.giris) return "in_stay";
  if (d === res.giris) return "arrival_today";
  return "pre_arrival";
}

// Kapanış onayı (repo `isClosingAck` benzeri, sadeleştirilmiş): mesajın TAMAMI teşekkür / onay sözcüklerinden.
const ACK = /^(?:\s|[,.!🙏👍]|peki|tamam(?:dır)?|teşekkür(?:ler| ederim)?|çok|sağ ?ol(?:un)?|süper|harika|ok(?:ey)?|thanks?|thank you)+$/iu;
const isAck = (t) => ACK.test(t.toLocaleLowerCase("tr").trim());
// Dürtme: içerik taşımayan "cevap ver" mesajı.
const PING = /^(?:merhaba,?\s*)?(?:\?+|dönüş yapabilir misiniz\??|cevap\??|any update\??|hello\?+)$/iu;
const isPing = (t) => PING.test(t.toLocaleLowerCase("tr").trim());
// Vazgeçme ipucu (kısa mesajda).
const WITHDRAW = /(boşver|gerek kalmadı|gerek yok|hallettim|never mind|nevermind)/iu;
// Sözcük ağı (repo `classifyFallback` benzeri; yalnız simülasyon için çok dar).
const EMERGENCY = /(gaz kokusu|yangın|duman|su bastı|elektrik çarp)/iu;
const COMPLAINT = /(çalışmıyor|bozuk|rezalet|berbat|kirli|şikayet|şikâyet)/iu;
// Zamana bağlı soru ipucu.
const TIME_BOUND = /(bu akşam|bu gece|şimdi|şu an|bugün|yarın sabah|tonight|right now|today)/iu;
const NIGHT = (t) => t >= "23:00" || t < "08:00";

const timesIn = (t) => new Set(t.match(/\b\d{1,2}:\d{2}\b/g) ?? []);
const sharesValue = (a, b) => [...timesIn(a)].some((x) => timesIn(b).has(x));
const STOP = new Set(["için", "kadar", "mı", "mi", "var", "bir", "de", "da", "ve", "the", "does", "what", "time"]);
const stems = (t) =>
  new Set(
    t.toLocaleLowerCase("tr").replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)),
  );
const selfContained = (answer, question) => [...stems(answer)].some((s) => stems(question).has(s));
const TR_HINT = /[çğışöü]|\b(ve|kadar|açık|havuz|için)\b/iu;
const langOf = (t) => (TR_HINT.test(t) ? "tr" : "en");

const SEND = new Set(["gonder", "bu_arada_gonder"]);

// ── A: sabit kurallar (ilk tasarım önerisi §7-D: 24 saat + araya mesaj + konaklama) ──
function policyA(s) {
  const res = s.rezervasyon ?? DEF_RES;
  if (res.durum === "cancelled") return "gonderme";
  if (stage(res, s.onay.an) === "post_stay") return "gonderme";
  if (hoursBetween(s.soru.an, s.onay.an) > 24) return "duzenleyici";
  const after = s.araMesajlar;
  if (after.length === 0) return "gonder";
  if (after.some((m) => m.kimden === "ev_sahibi")) return "duzenleyici";
  const guest = after.filter((m) => m.kimden === "misafir");
  if (guest.every((m) => isAck(m.metin))) return "bu_arada_gonder";
  return "duzenleyici";
}

// ── C: karma — 1) kesin kod kuralları 2) mevcut anlama kayıtları 3) kalan → yeni model kontrolü ──
// "Anlama kaydı" = mesaj gelirken ZATEN koşan anlama katmanının öğe kaydı (tür / vazgeçme / yerine geçme / cevaplandı / bekliyor).
// Simülasyonda bu kayıt senaryonun `tur` etiketinden okunur — gerçekte bir model çıktısıdır (kendi hata oranı var).
const RECORD_KINDS = new Set(["tekrar", "yeni_konu_cevaplandi", "yeni_konu_bekliyor", "vazgecti"]);
function policyC(s) {
  const res = s.rezervasyon ?? DEF_RES;
  const qStage = stage(res, s.soru.an);
  const aStage = stage(res, s.onay.an);
  const after = s.araMesajlar;
  const guest = after.filter((m) => m.kimden === "misafir");
  const outbound = after.filter((m) => m.kimden !== "misafir");
  const timeBound = TIME_BOUND.test(s.soru.metin);
  const lastGuestAt = [s.soru.an, ...guest.map((m) => m.an)].sort().at(-1);
  const idleMin = minutes(s.onay.an) - minutes(lastGuestAt);
  const timing = NIGHT(hhmm(s.onay.an)) && idleMin > 60 && !timeBound ? "sabah" : "simdi";
  const out = (karar, katman, neden) => ({ karar, katman, neden, timing });

  // 1) Kesin kod kuralları (sıra: en güvenli önce)
  if (res.durum === "cancelled") return out("gonderme", "kod", "iptal");
  if (aStage === "post_stay" && qStage !== "post_stay") return out("gonderme", "kod", "konaklama bitti");
  if (aStage === "departure_today" && hhmm(s.onay.an) >= STD_OUT && hhmm(s.soru.an) < STD_OUT)
    return out("gonderme", "kod", "çıkış saati geçti");
  if (guest.some((m) => EMERGENCY.test(m.metin))) return out("gonderme", "kod", "acil durum");
  if (outbound.some((m) => sharesValue(m.metin, s.onay.metin))) return out("gonderme", "kod", "aynı bilgi zaten gitti");
  if (s.bilgiTabaniDegisti?.celisiyor) return out("duzenleyici", "kod", "bilgi tabanıyla çelişki");
  if (langOf(s.onay.metin) !== (s.misafirDili ?? langOf(s.soru.metin))) return out("duzenleyici", "kod", "dil");
  if (guest.some((m) => COMPLAINT.test(m.metin) && !m.metin.includes("?"))) return out("duzenleyici", "kod", "şikâyet");
  if (guest.some((m) => WITHDRAW.test(m.metin) && m.metin.length <= 40)) return out("gonderme", "kod", "vazgeçme");

  // 2) Hızlı yollar (kod)
  if (after.length === 0) {
    if (timeBound && hoursBetween(s.soru.an, s.onay.an) > 1) return out(null, "model", "zamana bağlı soru, ihtiyaç anı geçmiş olabilir");
    return out("gonder", "kod", "soru hâlâ son mesaj");
  }
  if (outbound.some((m) => m.kimden === "ev_sahibi")) return out(null, "model", "ev sahibi arada yazdı (konu?)");
  const lastMsg = after.at(-1);
  if (guest.length > 0 && guest.every((m) => isAck(m.metin) || isPing(m.metin))) {
    if (lastMsg.kimden === "misafir" && isPing(lastMsg.metin)) return out("gonder", "kod", "dürtme");
  }
  if (guest.every((m) => isAck(m.metin))) {
    if (!selfContained(s.onay.metin, s.soru.metin)) return out(null, "model", "metin konuyu anmıyor");
    return out("bu_arada_gonder", "kod", "araya yalnız cevap / teşekkür girdi");
  }

  // 3) Mevcut anlama kayıtları
  const nonAck = guest.filter((m) => !isAck(m.metin));
  if (nonAck.every((m) => RECORD_KINDS.has(m.tur))) {
    if (nonAck.some((m) => m.tur === "vazgecti")) return out("gonderme", "kayit", "anlama katmanı: vazgeçti");
    if (nonAck.some((m) => m.tur === "yeni_konu_bekliyor")) return out("duzenleyici", "kayit", "cevapsız başka istek");
    if (lastMsg.kimden === "misafir" && lastMsg.tur === "tekrar" && nonAck.every((m) => m.tur === "tekrar"))
      return out("gonder", "kayit", "aynı soru yeniden (öğe yerine geçti)");
    if (nonAck.every((m) => m.tur === "yeni_konu_cevaplandi") && selfContained(s.onay.metin, s.soru.metin))
      return out("bu_arada_gonder", "kayit", "aradaki konular cevaplandı");
  }
  return out(null, "model", "belirsiz → bağlam kontrolü");
}

function grade(decision, s) {
  const exp = s.dogru.davranis;
  const ok = s.dogru.kabulEdilir ?? [];
  if (decision === null) return "MODEL";
  if (decision === exp) return "DOĞRU";
  if (ok.includes(decision)) return "KABUL";
  if (SEND.has(decision) && !SEND.has(exp)) return "KRİTİK (yanlış gönderim)";
  if (!SEND.has(decision) && SEND.has(exp)) return "SÜRTÜNME (gereksiz tutma)";
  if (SEND.has(decision) && SEND.has(exp)) return "ÜSLUP (bağlaç)";
  return "YUMUŞAK (düzenleyici↔gönderme)";
}

const rows = [];
const tally = { A: {}, C: {} };
const bump = (k, g) => (tally[k][g] = (tally[k][g] ?? 0) + 1);
let timingA = 0, timingC = 0, timingTotal = 0;
for (const s of data.senaryolar) {
  const a = policyA(s);
  const c = policyC(s);
  const gA = grade(a, s);
  const gC = grade(c.karar, s);
  bump("A", gA);
  bump("C", gC);
  if (c.katman !== "model") bump("C", `katman:${c.katman}`);
  timingTotal++;
  if ((s.dogru.zamanlama ?? "simdi") === "simdi") timingA++; // A'da gece kuralı yok: hep "şimdi"
  if ((s.dogru.zamanlama ?? "simdi") === c.timing || c.katman === "model") timingC++;
  rows.push({ id: s.id, dogru: s.dogru.davranis, A: a, gA, C: c.karar ?? "→model", katman: c.katman, gC, neden: c.neden, zaman: `${s.dogru.zamanlama}/${c.timing}` });
}

console.log("| # | doğru | A (sabit kural) | A notu | C kararı | C katmanı | C notu | C nedeni | zamanlama doğru/C |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.id} | ${r.dogru} | ${r.A} | ${r.gA} | ${r.C} | ${r.katman} | ${r.gC} | ${r.neden} | ${r.zaman} |`);
console.log("\nÖZET", JSON.stringify(tally, null, 1));
console.log(`zamanlama (şimdi / sabah) — A doğru: ${timingA}/${timingTotal}; C kod katmanı doğru (modele kalan sayılmaz): ${timingC}/${timingTotal}`);
