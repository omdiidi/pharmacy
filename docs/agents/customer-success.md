<!-- docs/agents/customer-success.md — combined triage + draft skills; classify messages, draft replies in Kaleem's tone. -->

# Customer Success

The Customer Success function is split into two skills (separate prompts, separate models) but it's one logical agent from Kaleem's perspective. **Triage** classifies inbound messages fast and routes; **Draft** produces a reply in Kaleem's tone for non-medical classifications.

## When it runs

- **Reactive only:** Triage fires on every Amazon/eBay buyer-message webhook (Phase 2). Triage in turn enqueues Draft for `shipping` / `refund` / `general` classifications. Medical questions go straight to Kaleem with no draft.

There is no scheduled sweep — customer messages are always reactive.

## Triage skill

### Inputs

```typescript
{
  message_id: string;
  customer_text: string;
  order_id?: string;
  pharmacy_id: string;
  customer_profile?: {
    past_order_count?: number;
    prior_message_count?: number;
  };
}
```

### Process

1. **Pull message context.** If `order_id` present, pull the linked `orders` row (status, ship date, product). Skim `customer_text` for obvious signals (refund, "where is my order," side effect, etc.).

2. **Classify** into one of:

| Class               | Definition |
|---------------------|------------|
| `medical_question`  | Asks about dosing, interactions, side effects, suitability, allergies |
| `shipping`          | Tracking / ETA / "where is my order" / address change |
| `refund`            | Refund request, return question, A-to-z claim threat |
| `general`           | Product question, listing question, follow-up thanks |
| `spam`              | Promotional outreach, off-topic, gibberish |

3. **Retrieve memory.**
   - `kind='semantic'` — classification rules / examples Kaleem has previously corrected.
   - `kind='episodic'` — prior misclassifications on similar wording.
   - `kind='preferences'` — standing rules ("always escalate anything mentioning kids").
   - **If empty:** proceed using only the rule definitions above.

4. **Apply policy filter.** If the message references a product on a Tier 0 block list (e.g., post-recall complaint), elevate to `medical_question` regardless of surface wording.

5. **Route.**
   - `medical_question` → insert briefing `type='customer_message'`, `source_agent='customer_success'`, `urgency=5`, `proposed_actions=[{ kind: 'kaleem_reply_personally' }]`. **Do NOT enqueue Customer Draft.**
   - `shipping` / `refund` / `general` → enqueue `pharm:customer-draft` job with payload + classification.
   - `spam` → archive (no briefing). Write `audit_log` noting the spam classification.

6. **Insert briefing + inbox_item** for non-spam classifications.

Triage does NOT send replies, NOT auto-refund, NOT draft replies. It classifies and routes.

### Triage outputs

```json
{
  "message_id": "uuid",
  "classification": "shipping",
  "action": "enqueued_draft",
  "briefing_id": "uuid",
  "memories_retrieved": []
}
```

`action`: `escalated_to_kaleem` | `enqueued_draft` | `archived_spam`.

Runs on `claude-haiku-4-5` with `thinking_budget: none` — meant to be cheap and fast.

## Draft skill

### Inputs

```typescript
{
  message_id: string;
  classification: 'shipping' | 'refund' | 'general';
  customer_text: string;
  order_context?: {
    order_id: string;
    tracking_number?: string;
    ship_date?: string;
    expected_delivery?: string;
    product_id: string;
  };
  pharmacy_id: string;
}
```

### Process

1. **Pull Kaleem's tone profile.** `memory` row with `kind='preferences'` — `tone` (terse vs detailed), greeting style, sign-off, common phrases. **If empty/missing tone:** fall back to neutral-professional default (warm, brief, signs off "— Kaleem").

2. **Look up similar past replies.** `search_memory` with `kind='episodic'`, `related_entity_type='customer_message'`, query = the customer message text. Identify 1-3 closest precedents. Use as voice anchors, not as templates to copy verbatim.

3. **Pull operational context.**
   - `shipping`: tracking number, carrier, last scan, expected delivery.
   - `refund`: order date, return window, refund policy from `policy_rules`.
   - `general`: product details from `products` + listing notes.

4. **Apply policy filter.**
   - **Refund:** confirm order is within return window and product isn't on a no-return list.
   - **Never make medical claims in the draft.** If the conversation drifts there, abort the draft and re-route as `medical_question` to Kaleem personally — insert a briefing flagging the drift.

5. **Draft the reply.** Match Kaleem's tone profile. Include operational facts. Brief if Kaleem is terse; expand only when context warrants. Don't promise things outside policy. End with Kaleem's standard sign-off.

6. **Self-review.** Does it answer the buyer's question? Does it stay inside policy? Does it sound like Kaleem? Confidence 0-1 based on tone match + completeness.

7. **Insert briefing.** `type='customer_message'`, `source_agent='customer_success'`. `proposed_actions=[{ kind: 'send_reply', message_id, text: <draft>, channel: 'amazon' | 'ebay' }]`. Rationale cites precedents used, operational facts pulled, policy filter outcome. `confidence` 0-1, `urgency` 2-3 (refund threats can bump to 4).

8. **Insert into `inbox_items`** with `state='pending'`.

Draft does NOT send. Kaleem clicks Approve, then the executor sends.

### Draft outputs

```json
{
  "message_id": "uuid",
  "draft": "Hey — your order shipped Monday via USPS, tracking 9400... should land Thursday. Let me know if it doesn't. — Kaleem",
  "briefing_id": "uuid",
  "confidence": 0.86,
  "memories_retrieved": []
}
```

Runs on `claude-sonnet-4-6` with `thinking_budget: medium` — needs to actually compose well in Kaleem's voice.

## Dependencies

| Source                       | Phase | Role |
|------------------------------|-------|------|
| Amazon/eBay message webhooks | Phase 2 | Trigger |
| `orders`                     | Phase 1 | Order context for shipping/refund replies |
| `policy_rules`               | Phase 1 | Refund window, no-return list |
| `memory`                     | Phase 1 | Tone profile, classification rules, prior reply precedents |
| Marketplace messaging APIs (executor) | Phase 2 | Send reply after Kaleem approves |

## Skill prompts

- Triage: [`minicrew-config/skills/customer-triage.md`](../../minicrew-config/skills/customer-triage.md)
- Draft: [`minicrew-config/skills/customer-draft.md`](../../minicrew-config/skills/customer-draft.md)

## See also

- [product-manager.md](../product-manager.md) — scenarios 5, 6, 17 cover customer flows.
- [integrations.md](../integrations.md) — SP-API + eBay messaging.
