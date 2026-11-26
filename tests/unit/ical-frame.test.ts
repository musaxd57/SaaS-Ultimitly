import { describe, it, expect } from "vitest";
import { isIcalendarFrame } from "@/lib/import/sync";

// U37 (Codex 10-07): "metinde BEGIN:VCALENDAR geçiyor" takvim kanıtı DEĞİL — JSON / HTML hata gövdesi 0 etkinlikle "ok" yazılıp
// müsaitlik motoru o kaynakla "boş" diyebiliyordu. İlk boş olmayan satır TAM `BEGIN:VCALENDAR` olmalı.
describe("U37 — iCalendar çerçevesi", () => {
  it.each([
    ['{"error":"unauthorized","expected":"BEGIN:VCALENDAR"}'],
    ["<html><body><pre>BEGIN:VCALENDAR</pre></body></html>"],
    ["<!DOCTYPE html>\nBEGIN:VCALENDAR\nEND:VCALENDAR"],
    ["Error: token expired. BEGIN:VCALENDAR"],
    [""],
  ])("takvim DEĞİL: %s", (body) => {
    expect(isIcalendarFrame(body)).toBe(false);
  });
  it.each([
    ["BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"],
    ["﻿BEGIN:VCALENDAR\nEND:VCALENDAR"],
    ["\n\n  BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR"],
    ["begin:vcalendar\nend:vcalendar"],
    ["BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1"], // yarım inmiş gerçek dosya: F16 "kısmi" okur, reddedilmez
  ])("KONTROL — takvim: %s", (body) => {
    expect(isIcalendarFrame(body)).toBe(true);
  });
});
