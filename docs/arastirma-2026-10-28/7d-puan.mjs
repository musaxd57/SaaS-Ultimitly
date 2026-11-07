// 7-D C″ puanlaması (kurucu 10-28 akşam: "93/93 yapmadan müşteri çekmem", "Luna'ya geçir"): KOD YALNIZ DURDURUR → kalan her gönderimi
// model onaylar (model kolunun §6.3 süzgeçli kararı, `7d-model-kolu.mjs` çıktısı). Saf: ağ / model / veritabanı YOK; model sonucu dosyadan.
// Kullanım: node docs/arastirma-2026-10-28/7d-puan.mjs <senaryo.json> <model-sonucu.json> [--yeni-kurallar]
// `--yeni-kurallar`: kör setin 4 + geliştirme setinin 1 yanlış gönderiminden türetilen yalnız-durduran kurallar (gece yarısını geçen göreli
// gün · rezervasyon dışı tarih · konuyu anmayan bağlaçlı metin · başka dairenin adı). ⚠️ Bu kurallar 93'lük seti GÖREREK yazıldı — o sette 0 çıkması kanıt değildir; kanıt ikinci kör settir.
import { readFileSync } from "node:fs";

const [, , setPath, modelPath, ...flags] = process.argv;
if (!setPath || !modelPath) throw new Error("kullanım: <senaryo.json> <model-sonucu.json> [--yeni-kurallar]");
const NEW_RULES = flags.includes("--yeni-kurallar") || flags.includes("--v2");
// --v2: ikinci kör setin sınıfları (göreli zamanın çözümle karşılaştırılması · kukla değer · başka kişiye hitap) + ürünün GERÇEK içerik
// kapıları (yer tutucu / şablon / platform dışı ödeme — `7d-urun-kapilari.json`, `npx tsx` ile üretilir). ⚠️ İkinci set de artık yandı.
const V2 = flags.includes("--v2");
const gatesPath = flags.find((f) => f.startsWith("--kapilar="))?.slice(10);
const productGates = gatesPath ? new Map(Object.entries(JSON.parse(readFileSync(gatesPath, "utf8")))) : new Map();
const data = JSON.parse(readFileSync(setPath, "utf8"));
const model = new Map(JSON.parse(readFileSync(modelPath, "utf8")).results.map((r) => [r.id, r]));
// --ikinci=<dosya>: ÇİFT ONAY — iki bağımsız model kontrolünün İKİSİ de "gönder" demeden gitmez; ayrışırsa temkinli olan kazanır
// (gönderme > düzenleyici > bağlaçla gönder > gönder). Maliyet onay başına ikiye katlanır (~0,0004 $).
const secondPath = flags.find((f) => f.startsWith("--ikinci="))?.slice(9);
const second = secondPath ? new Map(JSON.parse(readFileSync(secondPath, "utf8")).results.map((r) => [r.id, r])) : null;
const CAUTION = { hold: 3, open_editor: 2, send_with_anchor: 1, send: 0 };
const caution = (a, b) => (b === undefined ? a : (CAUTION[a] ?? 2) >= (CAUTION[b] ?? 2) ? a : b);
const STD_OUT = data.ortak.standartCikis;
const DEF_RES = data.ortak.varsayilanRezervasyon;
const OWN = (data.ortak.daire ?? "").match(/Lale\s*(\d+)/)?.[1] ?? null;

const day = (iso) => iso.slice(0, 10);
const hhmm = (iso) => iso.slice(11, 16);
function stage(res, iso) {
  const d = day(iso);
  if (d > res.cikis) return "post_stay";
  if (d === res.cikis) return "departure_today";
  if (d > res.giris) return "in_stay";
  if (d === res.giris) return "arrival_today";
  return "pre_arrival";
}
const EMERGENCY = /(gaz kokusu|yangın|duman|su bastı|elektrik çarp)/iu;
const COMPLAINT = /(çalışmıyor|bozuk|rezalet|berbat|kirli|şikayet|şikâyet)/iu;
const WITHDRAW = /(boşver|gerek kalmadı|gerek yok|hallettim|never mind|nevermind)/iu;
const timesIn = (t) => new Set(t.match(/\b\d{1,2}:\d{2}\b/g) ?? []);
const sharesValue = (a, b) => [...timesIn(a)].some((x) => timesIn(b).has(x));
const STOPW = new Set(["için", "kadar", "mı", "mi", "var", "bir", "de", "da", "ve", "the", "does", "what", "time"]);
const stems = (t) =>
  new Set(t.toLocaleLowerCase("tr").replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOPW.has(w)).map((w) => w.slice(0, 5)));
const selfContained = (answer, question) => [...stems(answer)].some((x) => stems(question).has(x));
const TR_HINT = /[çğışöü]|\b(ve|kadar|açık|havuz|için)\b/iu;
const langOf = (t) => (TR_HINT.test(t) ? "tr" : "en");

// ── Yeni yalnız-durduran kurallar ──
const RELATIVE_DAY = /(?<![\p{L}])(yarın\p{L}{0,3}|yarin|bugün\p{L}{0,3}|bugun|bu akşam|bu aksam|bu gece|tomorrow|today|tonight|morgen|heute|demain|aujourd'hui|mañana|hoy|завтра|сегодня)(?![\p{L}])/iu;
const TOMORROW = /(?<![\p{L}])(yarın\p{L}{0,3}|yarin|tomorrow|morgen|demain|mañana|завтра)(?![\p{L}])/iu;
const MONTHS = { ocak: 1, şubat: 2, mart: 3, nisan: 4, mayıs: 5, haziran: 6, temmuz: 7, ağustos: 8, eylül: 9, ekim: 10, kasım: 11, aralık: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
function datesIn(text, year) {
  const out = [];
  const re = /(\d{1,2})\s*[–-]?\s*(\d{1,2})?\s+([\p{L}]+)/gu;
  for (const m of text.toLocaleLowerCase("tr").matchAll(re)) {
    const month = MONTHS[m[3].replace(/['’].*$/, "").replace(/(?:da|de|ta|te|ında|inde|unda|ünde)$/u, "")] ?? MONTHS[m[3]];
    if (!month) continue;
    for (const d of [m[1], m[2]].filter(Boolean)) out.push(`${year}-${String(month).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`);
  }
  return out;
}
// Göreli zaman ifadesi → takvim günü (yerel). Aynı ifade soru anında ve onay anında FARKLI güne çözülüyorsa misafir metni yanlış güne
// okur (gece yarısı "yarın"ı, bir hafta sonra onaylanan "gelecek hafta"). Yalnız bilinen kalıplar; çözülemeyen ifade kural dışı.
const DOW_TR = { pazar: 0, pazartesi: 1, salı: 2, çarşamba: 3, perşembe: 4, cuma: 5, cumartesi: 6 };
const DOW_EN = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dow = (d) => new Date(d + "T12:00:00Z").getUTCDay();
function resolveRelative(expr, d) {
  const e = expr.toLocaleLowerCase("tr");
  if (/^(yarın|yarin|tomorrow|morgen|demain|mañana|завтра)/.test(e)) return addDays(d, 1);
  if (/^(bugün|bugun|today|heute|aujourd'hui|hoy|сегодня|bu akşam|bu aksam|bu gece|tonight)/.test(e)) return d;
  if (/^(bu hafta ?sonu|hafta ?sonu|this weekend)/.test(e)) { const k = dow(d); return k === 0 ? addDays(d, -1) : addDays(d, (6 - k + 7) % 7); }
  if (/^(gelecek hafta|haftaya|önümüzdeki hafta|next week)/.test(e)) { const k = (dow(d) + 6) % 7; return addDays(d, 7 - k); }
  const m = /^(?:bu |this )?(pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.exec(e);
  if (m) { const want = DOW_TR[m[1]] ?? DOW_EN[m[1]]; return addDays(d, (want - dow(d) + 7) % 7); }
  return null;
}
const RELATIVE_EXPR = /(?<![\p{L}])(yarın|yarin|tomorrow|morgen|demain|mañana|завтра|bugün|bugun|today|heute|aujourd'hui|hoy|сегодня|bu akşam|bu aksam|bu gece|tonight|bu hafta ?sonu|hafta ?sonu|this weekend|gelecek hafta|haftaya|önümüzdeki hafta|next week|(?:bu |this )(?:pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar|monday|tuesday|wednesday|thursday|friday|saturday|sunday))(?![\p{L}])/giu;
const PLACEHOLDER_X = /(?<![\p{L}\p{N}])(?:x{3,}|_{3,}|\?{3,})(?![\p{L}\p{N}])/iu;
const GREETING = /^(?:[Mm]erhaba|[Ss]elam|[Ss]ayın|[Ii]yi günler|[Hh]i|[Hh]ello|[Dd]ear|[Hh]allo|[Hh]ola|[Bb]onjour)\s+([\p{Lu}][\p{Ll}]+)/u;
const SELF_NAME = /(?:\b[Bb]en\s+|[Tt]his is\s+|I'?m\s+|[Mm]y name is\s+|[Ii]ch bin\s+)([\p{Lu}][\p{Ll}]+)/u;
const fold = (t) => t.toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");

function newRuleStop(s, res) {
  if (V2) {
    // N1 (v2): metindeki göreli zaman ifadesi soru anında ve onay anında farklı güne çözülüyor.
    // Yalnız ONAY metni: soruda "yarın" geçip onayın saat / tarih verdiği cevap kaymaz (soruya da uygulanınca 7 doğru gönderim tutuluyordu).
    for (const text of [s.onay.metin]) {
      for (const m of text.matchAll(RELATIVE_EXPR)) {
        const a = resolveRelative(m[1], day(s.soru.an));
        const b = resolveRelative(m[1], day(s.onay.an));
        if (a && b && a !== b) return `göreli zaman "${m[1]}" kaydı (${a} → ${b})`;
      }
    }
    // N5: kukla değer (XXXX, ___, ???) — gerçek veri yerine.
    if (PLACEHOLDER_X.test(s.onay.metin)) return "kukla değer (XXXX)";
    // N6: hitap edilen ad misafirin kendi adı değil (ürün misafir adını bilir; simülasyonda misafirin kendini tanıttığı ad).
    const greeted = GREETING.exec(s.onay.metin)?.[1];
    const own = SELF_NAME.exec(s.soru.metin)?.[1] ?? s.misafirAdi ?? null;
    if (greeted && own && !fold(greeted).startsWith(fold(own).slice(0, 3)) && !fold(own).startsWith(fold(greeted).slice(0, 3))) return `başka kişiye hitap (${greeted} ≠ ${own})`;
  }
  // N1a: ONAY metninde göreli gün + soru ile onay farklı takvim gününde → düzenleyici (ev sahibi sorunun "yarın"ını kastediyor; misafir
  //      onayın gününe göre okur, gün kayar). Yalnız onay metni: soruda "yarın" geçip onayda saat / tarih veren cevap kaymaz (ilk sürüm 6 doğru
  //      gönderimi tutuyordu).
  if (day(s.soru.an) !== day(s.onay.an) && RELATIVE_DAY.test(s.onay.metin)) return "onayda göreli gün, gün değişti";
  // N1b: soru 00:00–04:59 arasında ve "yarın" diyor → hangi gün olduğu belirsiz (ürünün tarih okuma kuralıyla aynı: gece yarısı "yarın"ı).
  if (hhmm(s.soru.an) < "05:00" && TOMORROW.test(s.soru.metin)) return "gece yarısından sonra 'yarın' (belirsiz gün)";
  // N2: onayda ya da soruda geçen tarih güncel rezervasyonun DIŞINDA → düzenleyici (rezervasyon değişmiş / başka tarih).
  if (res.durum !== "cancelled") {
    const year = res.giris.slice(0, 4);
    const outside = [...datesIn(s.onay.metin, year), ...datesIn(s.soru.metin, year)].filter((d) => d < res.giris || d > res.cikis);
    if (outside.length > 0) return `rezervasyon dışı tarih ${outside[0]}`;
  }
  // N4: araya mesaj girdiyse ve onay metni sorunun konusunu hiç anmıyorsa ("22:00'ye kadar açık.") → düzenleyici: köprüyle gitse de
  //     misafir neyin cevabı olduğunu anlamaz (geliştirme S35: model "kendi başına anlaşılır" dedi). `7d-simule.mjs` selfContained ile aynı.
  if (s.araMesajlar.some((m) => m.an <= s.onay.an) && !selfContained(s.onay.metin, s.soru.metin)) return "metin konuyu anmıyor";
  // N3: onayda işletmenin BAŞKA bir dairesinin adı → düzenleyici.
  //     Ürün işletmenin daire adlarını bilir (`ortak.digerDaireler`); yoksa "Lale N" kalıbı.
  const others = data.ortak.digerDaireler ?? [];
  const lower = s.onay.metin.toLocaleLowerCase("tr");
  for (const name of others) if (lower.includes(name.toLocaleLowerCase("tr"))) return `başka daire (${name})`;
  if (OWN && others.length === 0) for (const m of s.onay.metin.matchAll(/Lale\s*(\d+)/g)) if (m[1] !== OWN) return `başka daire (Lale ${m[1]})`;
  return null;
}

// ── Bugünkü yalnız-durduran kod kuralları (`7d-simule.mjs` C kolu 1. adım) ──
function codeStop(s) {
  const res = s.rezervasyon ?? DEF_RES;
  const after = s.araMesajlar.filter((m) => m.an <= s.onay.an);
  const guest = after.filter((m) => m.kimden === "misafir");
  const outbound = after.filter((m) => m.kimden !== "misafir");
  const qStage = stage(res, s.soru.an);
  const aStage = stage(res, s.onay.an);
  if (res.durum === "cancelled") return ["gonderme", "iptal"];
  if (aStage === "post_stay" && qStage !== "post_stay") return ["gonderme", "konaklama bitti"];
  if (aStage === "departure_today" && hhmm(s.onay.an) >= STD_OUT && hhmm(s.soru.an) < STD_OUT) return ["gonderme", "çıkış saati geçti"];
  if (guest.some((m) => EMERGENCY.test(m.metin))) return ["gonderme", "acil"];
  if (outbound.some((m) => sharesValue(m.metin, s.onay.metin))) return ["gonderme", "aynı bilgi gitti"];
  if (s.bilgiTabaniDegisti?.celisiyor) return ["duzenleyici", "bilgi tabanı çelişkisi"];
  if (langOf(s.onay.metin) !== (s.misafirDili ?? langOf(s.soru.metin))) return ["duzenleyici", "dil"];
  if (guest.some((m) => COMPLAINT.test(m.metin) && !m.metin.includes("?"))) return ["duzenleyici", "şikâyet"];
  if (guest.some((m) => WITHDRAW.test(m.metin) && m.metin.length <= 40)) return ["gonderme", "vazgeçme"];
  if (V2 && productGates.get(s.id)?.length) return ["duzenleyici", `ürün kapısı: ${productGates.get(s.id).join(", ")}`];
  if (NEW_RULES) {
    const why = newRuleStop(s, res);
    if (why) return ["duzenleyici", why];
  }
  return null;
}

const MODEL_TO_TR = { send: "gonder", send_with_anchor: "bu_arada_gonder", open_editor: "duzenleyici", hold: "gonderme" };
const SEND = new Set(["gonder", "bu_arada_gonder"]);
function grade(decision, s) {
  const exp = s.dogru.davranis;
  const ok = s.dogru.kabulEdilir ?? [];
  if (decision === exp || ok.includes(decision)) return "doğru";
  if (SEND.has(decision) && !SEND.has(exp)) return "YANLIŞ GÖNDERİM";
  if (!SEND.has(decision) && SEND.has(exp)) return "gereksiz tutma";
  if (SEND.has(decision) && SEND.has(exp)) return "bağlaç farkı";
  return "düzenleyici↔gönderme";
}

const tally = {};
const wrong = [];
for (const s of data.senaryolar) {
  const stop = codeStop(s);
  const m = model.get(s.id);
  const finalAction = second ? caution(m?.final ?? "open_editor", second.get(s.id)?.final ?? "open_editor") : m?.final;
  const decision = stop ? stop[0] : MODEL_TO_TR[finalAction] ?? "duzenleyici";
  const g = grade(decision, s);
  tally[g] = (tally[g] ?? 0) + 1;
  if (g === "YANLIŞ GÖNDERİM" || g === "gereksiz tutma") wrong.push(`${s.id} ${g}: karar ${decision}${stop ? ` (kod: ${stop[1]})` : ` (model: ${m?.raw?.reason ?? m?.filter ?? "?"})`} · doğru ${s.dogru.davranis} — ${s.baslik}`);
}
console.log(`C″ ${second ? "[ÇİFT ONAY] " : ""}${V2 ? "+ v2 kuralları + ürün kapıları" : NEW_RULES ? "+ üç yeni kural" : "(bugünkü kod kuralları)"} · ${data.senaryolar.length} senaryo · model ${JSON.parse(readFileSync(modelPath, "utf8")).model}`);
console.log(JSON.stringify(tally));
for (const w of wrong) console.log(" -", w);
