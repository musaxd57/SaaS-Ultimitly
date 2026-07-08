# Claude icin kisa not

Bu branch Codex tarafindan Lixus AI icin hazirlanan ilk buyuk agent sistemi denemesidir.
Lixus bir kod asistani degil; Airbnb/Booking tarzi konaklama operasyonlarini yoneten bir urun.
Bu nedenle amac misafir mesajini anlayip operasyonel aksiyona cevirmek, riskli seyleri ise insan onayina birakmaktir.

## Branch ve kapsam

- Calisilan branch: `codpexgreatwhale/08619`
- Main yanlislikla kirlenmisti, sonra revert edildi. Bu isler main'de degil, bu branch'te durmali.
- Bu branch simdilik izole bir foundation/demo katmani gibi dusunulmeli.

## Neler eklendi

- Next.js + TypeScript + Prisma tabanli agent sistemi iskeleti
- LiteLLM/DeepInfra gibi model provider'lara uygun model alias katmani
- Misafir mesaj analizi:
  - niyet
  - risk seviyesi
  - task gerekiyor mu
  - cevap taslagi
  - insan onayi gerekiyor mu
- Guardrail katmani:
  - `HIGH` ve `CRITICAL` risk insan onayina gider
  - refund/payment/cancellation/legal/safety gibi konular otomatik yapilmaz
- Operation plan agent:
  - mesajdan tool plan cikarir
  - task onerisi
  - approval item
  - guest reply draft
  - operation alert
  - report signal
- Operation execution agent:
  - `dry_run`: DB'ye yazmadan ne olacagini gosterir
  - `persist`: bagli olan ic kayitlari olusturur
  - her adimi `AgentToolRun` ile loglar
- Tasks sayfasinda demo panel:
  - plan olustur
  - dry-run/persist sec
  - sonucu ekranda goster
- Reports sayfasinda operasyon raporu demo akisi

## Cok onemli sinir

Guest-facing send henuz bagli degil.

Yani sistem su an musterilere/konuklara gercek mesaj gondermemeli. `draft_guest_reply` sadece taslak uretir ve `ApprovalItem` olarak insan onayina alinir. Inbox connector ve approval state machine tam kurulmadan otomatik misafir mesaji gondermeyi aktif etme.

Bu bilincli bir karar: Lixus'ta misafire mesaj atmak riskli bir production aksiyonudur.

## Neden boyle yapildi

Direkt "chatbot cevap versin" mantigi Lixus icin zayif kalir. Daha dogru mimari:

1. Mesaji anla.
2. Risk kapisindan gecir.
3. Gerekirse task olustur.
4. Riskli cevaplari onaya al.
5. Her agent kararini logla.
6. Raporlara sinyal olarak ekle.

Boylece sistem hem operasyonel olur hem de kontrolsuz AI davranisi azaltir.

## Claude incelerken bakilacak ana dosyalar

- `src/lib/ai/agent-orchestrator.ts`
- `src/lib/ai/guardrails.ts`
- `src/lib/agents/message-pipeline.ts`
- `src/lib/agents/operation-plan.ts`
- `src/lib/agents/operation-executor.ts`
- `src/app/api/agents/operation-plan/route.ts`
- `src/app/api/agents/execute-operation-plan/route.ts`
- `src/app/tasks/operation-plan-panel.tsx`
- `prisma/schema.prisma`
- `docs/AGENT_SYSTEM.md`

## Gecerli test durumu

Son kontrolde bunlar gecmisti:

- `npm run typecheck`
- `npm test`
- `npm run build`

Claude devam edecekse once bu komutlari tekrar calistirsin, sonra gercek Lixus kodundaki inbox/task/report modellerine baglamayi dusunsun.
