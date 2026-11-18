// ---------------------------------------------------------------------------
// UX / UI DENETİMİ İÇİN EKRAN GÖRÜNTÜLERİ (kurucu 11-12 gece: "ilk page'e, login pagelerine, hatta genel olarak bütün dosyalardaki UX / UI'a
// baksın — müşterilerin göreceği davranışlar, tipler, mesajlar dahil — telefon içinde test etsin").
//
// GitHub Actions'ta (`.github/workflows/claude-work.yml`), tohumlanmış veritabanı + üretim derlemesi ayaktayken koşar; ücretli çağrı YAPMAZ.
// Her sayfayı iki görünümde (masaüstü 1366 × 900 · telefon iPhone 13) dolaşır; görünüm yüksekliğinde parçalar hâlinde JPEG çeker (uzun
// tam sayfa görüntüsü küçültülünce okunmaz), sayfanın görünen metnini ve ÖLÇÜLEBİLİR işaretleri kaydeder: yatay taşma, 40 pikselden küçük
// dokunma hedefi, 12 pikselden küçük yazı, konsol hataları, HTTP durumu. Görüntüler `ux-shots/` altına (günlük arşivine GİRMEZ — boyut),
// döküm `claude-work-out/ux/manifest.json`a yazılır; `run.ts`in `ux_audit` işi bunları modele verir.
//
// Kapsam: tanıtım (baştan sona) + kimlik + yasal sayfalar · misafirin QR sohbetinin her durumu (ilk açılış, mesajdan sonra, İngilizce,
// başka cihaz, konaklama dışı, geçersiz bağlantı) · panelin bütün sayfaları (sahip) + ayarların beş sekmesi · temizlikçi görünümü · hiç
// verisi olmayan yeni işletme. Operatör (`/admin`) sayfaları müşteri yüzeyi değildir — kapsam dışı. Panel masaüstünde belge değil içerik
// kutusu kayar; parçalar o kutu kaydırılarak çekilir. Kapsam dışı kalan: açılır pencereler / onay kutuları ve tarayıcının kendi form uyarıları.
// Veriler tohum (kurgusal) veridir; betik YALNIZ bu geçici veritabanına yazar (QR için bir konaklama, boş bir işletme); gerçek müşteri /
// misafir verisi yoktur.
// ---------------------------------------------------------------------------
import { chromium, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createUserWithMembership } from "../../src/lib/membership/write";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:3100";
const ROOT = path.resolve(process.cwd());
const SHOTS = path.join(ROOT, "ux-shots");
const OUT = path.join(ROOT, "claude-work-out/ux");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

type ViewportName = "desktop" | "mobile";
type Group = "public" | "auth" | "app" | "guest" | "staff" | "empty";
interface PageRecord {
  id: string;
  label: string;
  group: Group;
  url: string;
  viewport: ViewportName;
  status: number | null;
  title: string;
  text: string;
  shots: string[];
  metrics: Record<string, number> | null;
  consoleErrors: string[];
  error?: string;
}
const records: PageRecord[] = [];
/** Gezinin atladığı bölümler (giriş yapılamadı, boş işletme kurulamadı…) — döküme yazılır, denetim raporu bunları adıyla söyler. */
const problems: string[] = [];

/** Parça sayısı tavanı: [masaüstü, telefon]. Uzun sayfalar (ayarlar, daire ayrıntısı) daha çok parça alır; tanıtım sayfası baştan sona. */
const SEGMENTS: Record<"default" | "long" | "full", [number, number]> = { default: [3, 4], long: [8, 12], full: [14, 26] };

interface VisitOpts {
  size?: "long" | "full";
  /** Parça tavanını ezer (ör. açık menü: tek görüntü). */
  maxSegments?: number;
  after?: (page: Page) => Promise<void>;
}

async function settle(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: 12_000 });
  } catch {
    /* uzun süren istek varsa olduğu kadarıyla devam */
  }
  await page.waitForTimeout(400);
}

/** Açık sayfayı kaydeder: işaretler + metin + görünüm yüksekliğinde parçalar. */
async function capture(page: Page, viewport: ViewportName, id: string, label: string, group: Group, status: number | null, consoleErrors: string[], opts: VisitOpts): Promise<void> {
  const rec: PageRecord = { id, label, group, url: page.url().replace(BASE, ""), viewport, status, title: "", text: "", shots: [], metrics: null, consoleErrors: consoleErrors.slice(0, 8) };
  try {
    rec.title = await page.title();
    rec.metrics = await page.evaluate(() => {
      const de = document.documentElement;
      const targets = Array.from(document.querySelectorAll<HTMLElement>('a, button, input, select, textarea, [role="button"], [role="tab"], [role="link"]'));
      let interactive = 0;
      let smallTargets = 0;
      for (const el of targets) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        interactive += 1;
        if (r.width < 40 || r.height < 40) smallTargets += 1;
      }
      let tinyText = 0;
      const seen = new Set<Element>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        if (!parent || seen.has(parent) || !(walker.currentNode.textContent ?? "").trim()) continue;
        seen.add(parent);
        const r = parent.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (Number.parseFloat(getComputedStyle(parent).fontSize) < 12) tinyText += 1;
      }
      // Görünümden taşan en geniş öğe (yatay kaydırma sebebi).
      let widest = 0;
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > widest) widest = r.right;
      }
      // Panel masaüstünde belge kaymaz (kabuk sabit, içerik kendi kutusunda kayar) → kayan en büyük kutu bulunur ve işaretlenir.
      let scroller: HTMLElement | null = null;
      if (de.scrollHeight - de.clientHeight <= 40) {
        let bestArea = 0;
        for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
          if (el.scrollHeight - el.clientHeight <= 40 || !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
          const r = el.getBoundingClientRect();
          if (r.width * r.height > bestArea) {
            bestArea = r.width * r.height;
            scroller = el;
          }
        }
        if (scroller) scroller.setAttribute("data-ux-scroller", "1");
      }
      return {
        viewportWidth: de.clientWidth,
        viewportHeight: de.clientHeight,
        pageHeight: scroller ? scroller.scrollHeight : de.scrollHeight,
        scrollStep: scroller ? scroller.clientHeight : de.clientHeight,
        innerScroll: scroller ? 1 : 0,
        horizontalOverflowPx: Math.max(0, de.scrollWidth - de.clientWidth),
        widestElementRightPx: Math.round(widest),
        interactive,
        smallTargets,
        tinyText,
      };
    });
    rec.text = (await page.evaluate(() => document.body.innerText)).replace(/\n{3,}/g, "\n\n").slice(0, 6_000);
    const step = rec.metrics.scrollStep || 800;
    const cap = opts.maxSegments ?? SEGMENTS[opts.size ?? "default"][viewport === "desktop" ? 0 : 1];
    const total = Math.max(1, Math.ceil(rec.metrics.pageHeight / step));
    const segments = Math.min(cap, total);
    rec.metrics.screensTotal = total;
    rec.metrics.screensCaptured = segments;
    for (let i = 0; i < segments; i++) {
      await page.evaluate((y) => {
        const inner = document.querySelector<HTMLElement>("[data-ux-scroller]");
        if (inner) inner.scrollTop = y;
        else window.scrollTo(0, y);
      }, i * step);
      await page.waitForTimeout(250);
      const file = `${id}-${viewport}-${i + 1}.jpg`;
      await page.screenshot({ path: path.join(SHOTS, file), type: "jpeg", quality: 70 });
      rec.shots.push(file);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  } catch (err) {
    rec.error = err instanceof Error ? err.message.slice(0, 300) : String(err);
  }
  records.push(rec);
  console.log(`[shots] ${viewport} ${id} ${rec.shots.length} parça${rec.error ? ` HATA: ${rec.error}` : ""}`);
}

/** Bir adrese gider ve kaydeder. */
async function visit(ctx: BrowserContext, viewport: ViewportName, id: string, label: string, group: Group, url: string, opts: VisitOpts = {}): Promise<void> {
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
  let status: number | null = null;
  try {
    const res = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    status = res?.status() ?? null;
    await settle(page);
    if (opts.after) await opts.after(page);
  } catch (err) {
    consoleErrors.push(`goto: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
  }
  await capture(page, viewport, id, label, group, status, consoleErrors, opts);
  await page.close();
}

async function login(ctx: BrowserContext, email: string): Promise<boolean> {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.fill("#email", email);
    await page.fill("#password", "demo1234");
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45_000 });
    await settle(page);
    return true;
  } catch (err) {
    console.error(`[shots] giriş başarısız (${email}): ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    problems.push(`giriş yapılamadı (${email}) — bu hesabın sayfaları çekilmedi`);
    return false;
  } finally {
    await page.close();
  }
}

function newContext(browser: Browser, viewport: ViewportName, locale = "tr-TR"): Promise<BrowserContext> {
  return viewport === "desktop"
    ? browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1, locale })
    : browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2, locale });
}

function daysFromNow(days: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function sendGuestMessage(page: Page, text: string): Promise<void> {
  const box = page.locator("textarea").first();
  if (!(await box.count())) return;
  await box.fill(text);
  await box.press("Enter").catch(() => undefined);
  await page.waitForTimeout(8_000);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  // ── Hazırlık (yalnız bu geçici veritabanı) ──
  const properties = await prisma.property.findMany({ orderBy: { createdAt: "asc" }, take: 2 });
  const property = properties[0] ?? null;
  const conversation = await prisma.conversation.findFirst({ orderBy: { updatedAt: "desc" } });
  // Misafir QR sohbeti: sohbet yalnız süren bir konaklamada açılır. Tohumun konaklamaları günün saatine göre açık / kapalı olabilir →
  // ikinci dairede dün başlayıp iki gün sonra biten kurgusal bir konaklama yaratılır; sohbet o dairede açılır.
  const guestProperty = properties[1] ?? property;
  let chatToken: string | null = null;
  let stayId: string | null = null;
  if (guestProperty) {
    chatToken = `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
    await prisma.property.update({ where: { id: guestProperty.id }, data: { chatToken, chatEnabled: true } });
    const stay = await prisma.reservation.create({
      data: { propertyId: guestProperty.id, guestName: "Deniz Kaya", arrivalDate: daysFromNow(-1, 12), departureDate: daysFromNow(2, 12), channel: "airbnb", status: "confirmed" },
    });
    stayId = stay.id;
  }
  const releaseDevice = async (): Promise<void> => {
    // Sohbet konaklama boyunca ilk açan cihaza bağlanır; her görünüm kendi "ilk açılış"ını görsün diye bağ sıfırlanır.
    if (stayId) await prisma.reservation.update({ where: { id: stayId }, data: { chatBoundHash: null, chatBoundAt: null } });
  };
  // Hiç verisi olmayan yeni işletme (ilk kez giren ev sahibinin gördüğü boş durumlar).
  const emptyEmail = "yeni@example.com";
  let emptyReady = false;
  try {
    const passwordHash = await bcrypt.hash("demo1234", 10);
    if (await prisma.user.findUnique({ where: { email: emptyEmail }, select: { id: true } })) throw new Error("zaten var");
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: "Yeni İşletme", timezone: "Europe/Istanbul" } });
      await createUserWithMembership(tx, { organizationId: org.id, name: "Yeni Ev Sahibi", email: emptyEmail, passwordHash, role: "owner", emailVerifiedAt: new Date() }, "seed");
    });
    emptyReady = true;
  } catch (err) {
    // Aynı veritabanında ikinci koşu: işletme önceki koşudan duruyor.
    if (err instanceof Error && err.message === "zaten var") emptyReady = true;
    else {
      console.error(`[shots] boş işletme kurulamadı: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
      problems.push("boş işletme kurulamadı — ilk kez giren ev sahibinin boş durumları çekilmedi");
    }
  }
  if (!chatToken) problems.push("tohumda daire yok — misafir QR sohbeti çekilmedi");

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });

  for (const vp of ["desktop", "mobile"] as const) {
    const ctx = await newContext(browser, vp);
    // ── Halka açık + kimlik sayfaları (oturumsuz) ──
    await visit(ctx, vp, "landing", "İlk sayfa (tanıtım)", "public", "/", { size: "full" });
    await visit(ctx, vp, "login", "Giriş", "auth", "/login");
    await visit(ctx, vp, "login-hata", "Giriş — yanlış şifre sonrası", "auth", "/login", {
      after: async (page) => {
        await page.fill("#email", "demo@guestops.ai");
        await page.fill("#password", "yanlis-sifre-123");
        await page.click('button[type="submit"]');
        await page.waitForTimeout(2_500);
      },
    });
    await visit(ctx, vp, "register", "Kayıt", "auth", "/register");
    await visit(ctx, vp, "register-eksik", "Kayıt — eksik / hatalı alanlarla gönderme denemesi", "auth", "/register", {
      after: async (page) => {
        const email = page.locator('input[type="email"]').first();
        if (await email.count()) await email.fill("gecersiz-eposta");
        const pass = page.locator('input[type="password"]').first();
        if (await pass.count()) await pass.fill("123");
        const submit = page.locator('button[type="submit"]').first();
        if (await submit.count()) await submit.click({ timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(1_500);
      },
    });
    await visit(ctx, vp, "sifremi-unuttum", "Şifremi unuttum", "auth", "/sifremi-unuttum");
    await visit(ctx, vp, "sifremi-unuttum-gonderildi", "Şifremi unuttum — gönderdikten sonra", "auth", "/sifremi-unuttum", {
      after: async (page) => {
        const email = page.locator('input[type="email"]').first();
        if (await email.count()) await email.fill("kimse@example.com");
        const submit = page.locator('button[type="submit"]').first();
        if (await submit.count()) await submit.click({ timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(2_500);
      },
    });
    await visit(ctx, vp, "e-posta-dogrula", "E-posta doğrulama — bağlantı geçersiz / eksik", "auth", "/e-posta-dogrula");
    await visit(ctx, vp, "uyari-adresi-dogrula", "Uyarı adresi doğrulama — bağlantı geçersiz / eksik", "auth", "/uyari-adresi-dogrula");
    for (const [slug, label] of [
      ["gizlilik", "Gizlilik"],
      ["kosullar", "Kullanım koşulları"],
      ["guvenlik", "Güvenlik"],
      ["entegrasyonlar", "Entegrasyonlar"],
      ["mesafeli-satis", "Mesafeli satış sözleşmesi"],
      ["on-bilgilendirme", "Ön bilgilendirme"],
    ] as const) {
      await visit(ctx, vp, `yasal-${slug}`, `Yasal — ${label}`, "public", `/${slug}`);
    }
    await visit(ctx, vp, "bulunamadi", "Olmayan adres (404)", "public", "/boyle-bir-sayfa-yok");

    // ── Misafirin gördüğü QR sohbeti (Türkçe) ──
    if (chatToken) {
      await releaseDevice();
      await visit(ctx, vp, "misafir-sohbet", "Misafir QR sohbeti — ilk açılış (süren konaklama)", "guest", `/c/${chatToken}`);
      await visit(ctx, vp, "misafir-sohbet-mesaj", "Misafir QR sohbeti — mesaj yazdıktan sonra (bu ortamda cevap modeli bağlı DEĞİL: misafirin model yokken gördüğü durum)", "guest", `/c/${chatToken}`, {
        after: (page) => sendGuestMessage(page, "Merhaba, Wi-Fi şifresi nedir?"),
      });
    }

    // ── Panel: sahip ──
    if (await login(ctx, "demo@guestops.ai")) {
      const qrConversation = await prisma.conversation.findFirst({ where: { channel: "chat" }, orderBy: { updatedAt: "desc" }, select: { id: true } }).catch(() => null);
      const appPages: [string, string, string, boolean?][] = [
        ["dashboard", "Pano", "/dashboard"],
        ["inbox", "Gelen kutusu", "/inbox"],
        ...(conversation ? ([["inbox-konusma", "Konuşma ayrıntısı (yapay zekâ önerisi + cevap kutusu)", `/inbox/${conversation.id}`, true]] as [string, string, string, boolean?][]) : []),
        ["guest-chats", "QR misafir sohbetleri (liste)", "/guest-chats"],
        ...(qrConversation
          ? ([
              ["guest-chats-ayrinti", "QR misafir sohbeti — panelden okuma / cevap", `/guest-chats/${qrConversation.id}`],
              ["guest-chats-misafir-ekrani", "QR misafir sohbeti — misafir ekranı önizlemesi", `/guest-chats/${qrConversation.id}/misafir-ekrani`],
            ] as [string, string, string, boolean?][])
          : []),
        ["arrivals", "Girişler", "/arrivals"],
        ["hazirlik", "Hazırlık", "/hazirlik"],
        ["calendar", "Takvim", "/calendar"],
        ["cancellations", "İptaller", "/cancellations"],
        ["tasks", "Görevler", "/tasks"],
        ["tasks-yeni", "Yeni görev", "/tasks/new"],
        ["properties", "Daireler", "/properties"],
        ...(property ? ([["properties-ayrinti", "Daire ayrıntısı", `/properties/${property.id}`, true]] as [string, string, string, boolean?][]) : []),
        ["properties-yeni", "Yeni daire", "/properties/new"],
        ["knowledge", "Bilgi tabanı", "/knowledge", true],
        ["templates", "Şablonlar", "/templates"],
        ["reports", "Raporlar", "/reports"],
        ["sent", "Gönderilenler", "/sent"],
        ["sent-kuyruk", "Gönderim kuyruğu", "/sent/queue"],
        ["settings-ai", "Ayarlar — AI ve Otomasyon", "/settings?tab=ai-otomasyon", true],
        ["settings-baglantilar", "Ayarlar — Bağlantılar", "/settings?tab=baglantilar", true],
        ["settings-genel", "Ayarlar — Genel", "/settings?tab=genel", true],
        [
          "settings-faturalandirma",
          "Abonelik / ödeme (Ayarlar — Faturalandırma). Bu ortamda ödeme sağlayıcısı GERÇEK OLMAYAN anahtarla kurulu: 'ödeme ekranı yüklenemedi' benzeri uyarı ortam kaynaklıdır; plan sunumu, fiyatlar, onay kutusu ve metinler gerçektir",
          "/settings?tab=faturalandirma",
          true,
        ],
        ["settings-hesap", "Ayarlar — Hesap ve Güvenlik", "/settings?tab=hesap-guvenlik", true],
        ["panel-bulunamadi", "Panelde olmayan adres", "/inbox/boyle-bir-konusma-yok"],
      ];
      for (const [id, label, url, long] of appPages) await visit(ctx, vp, id, label, "app", url, long ? { size: "long" } : {});

      // Telefonda gezinme menüsü.
      if (vp === "mobile") {
        await visit(ctx, vp, "dashboard-menu", "Pano — gezinme menüsü açık (telefon)", "app", "/dashboard", {
          maxSegments: 1,
          after: async (page) => {
            const toggle = page.locator('button[aria-label="Menüyü aç"]').first();
            if (await toggle.count()) {
              await toggle.click({ timeout: 4_000 }).catch(() => undefined);
              await page.waitForTimeout(600);
            }
          },
        });
      }
    }
    await ctx.close();

    // ── Temizlikçi (ekip üyesi) görünümü: girişten sonra görevler sayfasına iner; öteki panel adresleri de oraya yönlenir ──
    const staffCtx = await newContext(browser, vp);
    if (await login(staffCtx, "ayse@guestops.ai")) {
      await visit(staffCtx, vp, "ekip-gorevler", "Temizlikçi — girişten sonra açılan sayfa (görevler)", "staff", "/tasks", { size: "long" });
      if (vp === "mobile") {
        await visit(staffCtx, vp, "ekip-menu", "Temizlikçi — gezinme menüsü açık (telefon)", "staff", "/tasks", {
          maxSegments: 1,
          after: async (page) => {
            const toggle = page.locator('button[aria-label="Menüyü aç"]').first();
            if (await toggle.count()) {
              await toggle.click({ timeout: 4_000 }).catch(() => undefined);
              await page.waitForTimeout(600);
            }
          },
        });
      }
    }
    await staffCtx.close();

    // ── Hiç verisi olmayan yeni işletme ──
    if (emptyReady) {
      const emptyCtx = await newContext(browser, vp);
      if (await login(emptyCtx, emptyEmail)) {
        for (const [id, label, url] of [
          ["bos-pano", "Yeni işletme — pano (hiç veri yok)", "/dashboard"],
          ["bos-gelen-kutusu", "Yeni işletme — gelen kutusu (boş)", "/inbox"],
          ["bos-daireler", "Yeni işletme — daireler (boş)", "/properties"],
          ["bos-bilgi-tabani", "Yeni işletme — bilgi tabanı (boş)", "/knowledge"],
          ["bos-gorevler", "Yeni işletme — görevler (boş)", "/tasks"],
          ["bos-takvim", "Yeni işletme — takvim (boş)", "/calendar"],
          ["bos-girisler", "Yeni işletme — girişler (boş)", "/arrivals"],
          ["bos-abonelik", "Yeni işletme — abonelik / ödeme (deneme süresindeki hesap; ödeme sağlayıcısı gerçek olmayan anahtarla)", "/billing"],
        ] as const) {
          await visit(emptyCtx, vp, id, label, "empty", url);
        }
      }
      await emptyCtx.close();
    }
  }

  // ── Misafir QR sohbetinin öteki durumları (yalnız telefon — misafir telefondadır) ──
  if (chatToken) {
    await releaseDevice();
    const en = await newContext(browser, "mobile", "en-US");
    await visit(en, "mobile", "misafir-sohbet-en", "Misafir QR sohbeti — tarayıcı dili İngilizce, ilk açılış", "guest", `/c/${chatToken}`);
    await visit(en, "mobile", "misafir-sohbet-en-mesaj", "Misafir QR sohbeti — İngilizce mesajdan sonra (cevap modeli bağlı DEĞİL)", "guest", `/c/${chatToken}`, {
      after: (page) => sendGuestMessage(page, "Hi, what time is check-out?"),
    });
    await en.close();
    // Bağ İngilizce cihazda kaldı → yeni bir cihaz "başka cihazda açık" ekranını görür.
    const other = await newContext(browser, "mobile");
    await visit(other, "mobile", "misafir-sohbet-baska-cihaz", "Misafir QR sohbeti — sohbet başka bir cihaza bağlıyken açan ikinci cihaz", "guest", `/c/${chatToken}`);
    await visit(other, "mobile", "misafir-sohbet-gecersiz", "Misafir QR sohbeti — geçersiz / kapatılmış bağlantı", "guest", `/c/${randomUUID().replace(/-/g, "")}`);
    // Konaklama bitmiş: aynı bağlantı, süren konaklama yok.
    if (stayId) await prisma.reservation.update({ where: { id: stayId }, data: { arrivalDate: daysFromNow(-10, 12), departureDate: daysFromNow(-7, 12), chatBoundHash: null, chatBoundAt: null } });
    await visit(other, "mobile", "misafir-sohbet-konaklama-disi", "Misafir QR sohbeti — süren konaklama yokken (çıkıştan sonra / girişten önce)", "guest", `/c/${chatToken}`);
    await other.close();
  }

  await browser.close();
  await prisma.$disconnect();
  writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ base: BASE, shotsDir: "ux-shots", pages: records, problems }, null, 2), "utf8");
  console.log(`[shots] ${records.length} kayıt, ${records.reduce((n, r) => n + r.shots.length, 0)} görüntü${problems.length ? ` · atlanan: ${problems.join(" · ")}` : ""}`);
}

main().catch((err) => {
  console.error(`[shots] düştü: ${err instanceof Error ? err.stack : err}`);
  writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ base: BASE, shotsDir: "ux-shots", pages: records, problems, crashed: String(err).slice(0, 500) }, null, 2), "utf8");
  process.exitCode = 1;
});
