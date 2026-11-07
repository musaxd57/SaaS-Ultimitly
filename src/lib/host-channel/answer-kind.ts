// ---------------------------------------------------------------------------
// Ev sahibinin cevabının KESİN türleri — modelden ÖNCE kodla (tasarım §3.5). SAF. Yalnız açık biçimler; gerisi yazıcı modelin işidir.
//   · opt_out — mesajın TAMAMI "DUR" / "STOP" (bağlantı kapatılır, e-postaya dönülür)
//   · host_takes_over — "ben yazacağım / ben ararım / I'll handle it" (misafire bir şey gitmez, soru panelde ev sahibinde)
//   · unsupported — sesli / görsel mesaj (metin istenir)
// ---------------------------------------------------------------------------

export type CodeAnswerKind = "opt_out" | "host_takes_over" | "unsupported" | null;

// Yalnız iki sözcük, mesajın TAMAMI (tasarım §3.5 / §8). "iptal" / "durdur" kapsam DIŞI: "iptal edilsin mi?" sorusuna "İptal" diye cevap
// veren ev sahibinin bağlantısı sessizce kopardı.
const OPT_OUT = /^(?:dur|stop)[.!]?$/iu;
const TAKES_OVER =
  /^(?:tamam[, ]+)?(?:ben|bunu ben|onu ben)\s+(?:yazaca[ğg][ıi]m|yazar[ıi]m|arar[ıi]m|arayaca[ğg][ıi]m|hallederim|halledece[ğg]im|ilgilenirim|ilgilenece[ğg]im|cevaplar[ıi]m|cevaplayaca[ğg][ıi]m|d[öo]nerim)[.!]?$|^i(?:['’]ll| will)\s+(?:handle|reply|answer|call|take care of)\s*(?:it|this|them)?[.!]?$/iu;

export function codeAnswerKind(event: { kind: "text"; text: string } | { kind: "unsupported" } | { kind: "button"; buttonId: string }): CodeAnswerKind {
  if (event.kind === "unsupported") return "unsupported";
  if (event.kind === "button") return event.buttonId.endsWith(".self") ? "host_takes_over" : null;
  const t = event.text.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (OPT_OUT.test(t)) return "opt_out";
  if (TAKES_OVER.test(t)) return "host_takes_over";
  return null;
}
