import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import net from "node:net";
import { emailService } from "@/lib/email-core";

// ---------------------------------------------------------------------------
// SMTP TAŞIYICI SÖZLEŞMESİ — nodemailer major geçişinin (8.0.11 → 9.1.1)
// GERÇEK regresyon testi (2026-09-09).
//
// 🚨 NEDEN YENİ BİR TEST GEREKTİ: `viaSmtp` yolunun suit'te HİÇ testi yoktu.
// Mevcut e-posta testlerinin HEPSİ `EMAIL_HOST: ""` kuruyor, yani nodemailer
// hiç çağrılmıyordu. Bir major sürüm yükseltmesini "3840 test yeşil" diye
// doğrulanmış saymak, hiç koşulmamış bir dalı doğrulanmış saymak olurdu.
//
// nodemailer 9.0.0'ın TEK kırıcı değişikliği (CHANGELOG): uzak içerik çekerken
// (attachment href/path URL'leri, OAuth2 token ucu, HTTP/HTTPS proxy CONNECT)
// TLS sertifikası artık DOĞRULANIYOR. Bizim çağrımız bu üçünün hiçbirini
// kullanmıyor — ve aşağıdaki "ek dosya yok" pini bunu DAVRANIŞLA sabitliyor:
// gelecekte biri `attachments` eklerse bu test düşer ve o kırıcı değişiklik
// yeniden değerlendirilir.
//
// Test GERÇEK bir soket konuşur (127.0.0.1, ефemeral port): sahte bir transport
// değil, nodemailer'ın kendi SMTP istemcisi. Yani `createTransport` seçenek
// kümemizin ve `sendMail` alan kümemizin KURULU sürümde kabul edildiğini
// kanıtlar — mock'la kanıtlanamayacak tek şey budur.
// ---------------------------------------------------------------------------

interface Recorded {
  commands: string[];
  mailFrom: string | null;
  rcptTo: string[];
  data: string;
}

interface FakeSmtp {
  port: number;
  recorded: Recorded;
  close: () => Promise<void>;
}

/** Minimal ESMTP sunucusu. `rejectRecipient` ile RCPT TO'ya 550 döner. */
async function startFakeSmtp(opts: { rejectRecipient?: boolean } = {}): Promise<FakeSmtp> {
  const recorded: Recorded = { commands: [], mailFrom: null, rcptTo: [], data: "" };

  const server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    const say = (line: string) => socket.write(`${line}\r\n`);

    say("220 localhost ESMTP fake");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            say("250 2.0.0 Ok: queued");
          } else {
            // Nokta-doldurma (RFC 5321 §4.5.2) geri alınır.
            recorded.data += `${line.startsWith("..") ? line.slice(1) : line}\n`;
          }
          continue;
        }

        recorded.commands.push(line);
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          say("250-localhost");
          // STARTTLS BİLEREK İLAN EDİLMİYOR: testin konusu taşıyıcının kendi
          // TLS'i değil, seçenek/alan kümemizin kabulü.
          say("250-AUTH PLAIN LOGIN");
          say("250 SIZE 10485760");
        } else if (upper.startsWith("AUTH")) {
          say("235 2.7.0 Authentication successful");
        } else if (upper.startsWith("MAIL FROM")) {
          recorded.mailFrom = line.slice(line.indexOf(":") + 1).trim();
          say("250 2.1.0 Ok");
        } else if (upper.startsWith("RCPT TO")) {
          if (opts.rejectRecipient) {
            say("550 5.1.1 No such user here");
          } else {
            recorded.rcptTo.push(line.slice(line.indexOf(":") + 1).trim());
            say("250 2.1.5 Ok");
          }
        } else if (upper === "DATA") {
          inData = true;
          say("354 End data with <CR><LF>.<CR><LF>");
        } else if (upper === "QUIT") {
          say("221 2.0.0 Bye");
          socket.end();
        } else if (upper === "RSET") {
          say("250 2.0.0 Ok");
        } else {
          say("502 5.5.2 Not implemented");
        }
      }
    });
    socket.on("error", () => {
      /* istemci koparsa test bunu umursamaz */
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("port alınamadı");
  return {
    port: address.port,
    recorded,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Dinleyeni olmayan (bağlantıyı ANINDA reddeden) bir port bulur. */
async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  const address = s.address();
  if (address === null || typeof address === "string") throw new Error("port alınamadı");
  const port = address.port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

function useSmtp(port: number) {
  // 🚨 `RESEND_API_KEY` BOŞ olmalı: sendReporting önce Resend'e bakar
  // (email-core.ts:163). Dolu bırakmak testi sessizce HTTP yoluna kaydırırdı.
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("EMAIL_HOST", "127.0.0.1");
  vi.stubEnv("EMAIL_PORT", String(port));
  vi.stubEnv("EMAIL_USER", "smtp-user");
  vi.stubEnv("EMAIL_PASS", "smtp-pass");
  vi.stubEnv("EMAIL_FROM", "Lixus AI <noreply@lixusai.com>");
}

describe("SMTP taşıyıcı — kurulu nodemailer sürümüyle gerçek soket", () => {
  let smtp: FakeSmtp | null = null;

  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (smtp) {
      await smtp.close();
      smtp = null;
    }
  });

  it("teslim eder: seçenek kümemiz ve alan kümemiz KURULU sürümde kabul ediliyor", async () => {
    smtp = await startFakeSmtp();
    useSmtp(smtp.port);

    const res = await emailService.sendReporting(
      "host@example.com",
      "Test basligi",
      "<p>Merhaba <b>dunya</b></p>",
    );

    expect(res.ok, `SMTP teslimi basarisiz: ${res.error ?? ""}`).toBe(true);
    // Kimlik doğrulama GERÇEKTEN yapıldı (auth alanı taşıyıcıya ulaştı).
    expect(smtp.recorded.commands.some((c) => c.toUpperCase().startsWith("AUTH"))).toBe(true);
    // Zarf: gönderen ve alıcı bizim verdiğimiz adresler.
    expect(smtp.recorded.mailFrom).toBe("<noreply@lixusai.com>");
    expect(smtp.recorded.rcptTo).toEqual(["<host@example.com>"]);
  });

  it("HTML ve DÜZ METİN alternatifinin İKİSİ de gidiyor", async () => {
    smtp = await startFakeSmtp();
    useSmtp(smtp.port);

    const res = await emailService.sendReporting(
      "host@example.com",
      "Test basligi",
      "<p>Merhaba <b>dunya</b></p>",
    );
    expect(res.ok).toBe(true);

    const body = smtp.recorded.data;
    expect(body).toMatch(/Content-Type: multipart\/alternative/i);
    expect(body).toMatch(/Merhaba/);
    // `htmlToText` çıktısı: etiketler düşmüş düz metin de ayrı parça olarak var.
    expect(body).toMatch(/Content-Type: text\/plain/i);
    expect(body).toMatch(/Content-Type: text\/html/i);
  });

  it("EK DOSYA YOK — nodemailer 9'un kırıcı değişikliği bu yüzden bizi etkilemiyor", async () => {
    smtp = await startFakeSmtp();
    useSmtp(smtp.port);

    await emailService.sendReporting("host@example.com", "Test basligi", "<p>x</p>");

    // 🚨 9.0.0'ın TEK kırıcı değişikliği uzak içerik çekmeye (attachment
    // href/path, OAuth2 token ucu, proxy CONNECT) TLS doğrulaması getirmesiydi.
    // Ek dosya göndermediğimiz sürece o kod yolu hiç çalışmaz. Bu pin, birinin
    // ileride ek dosya eklemesi hâlinde kırılır ve kararı yeniden gerektirir.
    expect(smtp.recorded.data).not.toMatch(/Content-Disposition:\s*attachment/i);
    // Gövdede hiçbir uzak referans (http/https) çekilmiyor: içerik bizim
    // ürettiğimiz HTML'den ibaret.
    expect(smtp.recorded.commands.some((c) => c.toUpperCase().startsWith("MAIL FROM"))).toBe(true);
  });

  it("sunucu alıcıyı REDDEDERSE fırlatmaz, {ok:false} + hata metni döner", async () => {
    smtp = await startFakeSmtp({ rejectRecipient: true });
    useSmtp(smtp.port);

    const res = await emailService.sendReporting("yok@example.com", "Test", "<p>x</p>");

    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe("string");
    expect((res.error ?? "").length).toBeGreaterThan(0);
  });

  it("sunucuya ULAŞILAMAZSA fırlatmaz, {ok:false} döner", async () => {
    const port = await closedPort();
    useSmtp(port);

    const res = await emailService.sendReporting("host@example.com", "Test", "<p>x</p>");

    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe("string");
  });
});
