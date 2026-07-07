# Lixus AI Agent System

This branch contains the first isolated implementation path for the Lixus AI
large agent system. It is intentionally additive and scoped to the
`codpexgreatwhale/08619` branch.

## Goal

Lixus is not a code assistant. It is a hospitality operations system for
Airbnb/Booking hosts. The agent system turns guest messages into operational
actions while keeping risky guest-facing decisions behind human approval.

## Core Flow

```text
Guest message
  -> context from reservation/property/rules
  -> message/task extraction agent
  -> risk gate
  -> suggested task
  -> approval queue for risky guest replies
  -> reports and audit logs
```

## Model Alias Strategy

Application code never calls a real provider directly. It calls stable LiteLLM
aliases:

| Alias | Purpose | Suggested provider |
| --- | --- | --- |
| `message_triage` | Language, sentiment, intent, risk | DeepInfra small/cheap model |
| `task_extractor` | Structured JSON task extraction | DeepInfra small/cheap model |
| `guest_reply_draft` | Guest-facing reply drafts | DeepInfra larger model |
| `risk_review` | Refund, legal, safety, angry complaint review | Premium fallback model |
| `report_writer` | Weekly/monthly operations insights | DeepInfra batch-friendly model |

The example LiteLLM config lives in `infra/litellm.config.example.yaml`.

## Guardrails

The current guardrails are code-level, not prompt-only:

- `HIGH` and `CRITICAL` risk always require human approval.
- Refund, payment, cancellation, legal, safety, health, and damage intents
  require human approval.
- Suggested tasks can be created only when the model says a task is required and
  confidence is at least `0.75`.
- Guest replies can be auto-sent only for low-risk, high-confidence messages.

## Persistence

`runGuestMessagePipeline(context, { persist: true })` can create:

- an `AgentRun` audit record,
- a `Task` with `SUGGESTED` status,
- an `ApprovalItem` for risky guest replies.

The demo UI does not persist by default. Production integrations should pass
real tenant/message IDs and then enable persistence.

## First Pages

- `/tasks`: analyze a guest message and inspect the task/risk decision.
- `/reports`: generate an operations insight from weekly metrics.
