// SP-API webhook ingest. HMAC-verified via SP_API_WEBHOOK_SECRET. Accepts the
// SP-API NotificationEnvelope JSON shape directly — agnostic to whether the
// upstream relay is SQS, EventBridge, or a curl test. Dispatches by
// NotificationType to the right agent runner.
//
// Auth: HMAC-SHA256 hex digest of the raw request body, header
// `x-pharm1-signature`. Constant-time comparison via timingSafeEqual.
//
// Phase 3 hardening adds:
//   - Replay-window check using NotificationMetadata.PublishTime (5 min skew).
//     No custom `x-pharm1-timestamp` header — clock comes from envelope body.
//   - NotificationId dedupe via webhook_dedupe table (24h TTL purge daily).
//   - 5xx returned on agent error so SP-API retries (at-least-once semantics).

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { runRepricer } from '@/lib/agents/repricer';
import { runAccountHealth } from '@/lib/agents/account-health';
import { runCustomerSuccess } from '@/lib/agents/customer-success';
import { runFulfillmentOps } from '@/lib/agents/fulfillment-ops';
import { captureRouteFatal } from '@/lib/observability';
import type { NotificationEnvelope } from '@/lib/sp-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyHmac(rawBody: string, signature: string | null): boolean {
  if (!signature || !process.env.SP_API_WEBHOOK_SECRET) return false;
  // Hex regex check before Buffer.from — any non-hex input would otherwise
  // throw or silently coerce inside timingSafeEqual.
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', process.env.SP_API_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig = req.headers.get('x-pharm1-signature');
  if (!verifyHmac(rawBody, sig)) {
    return NextResponse.json({ error: 'invalid-signature' }, { status: 401 });
  }

  let env: NotificationEnvelope;
  try {
    env = JSON.parse(rawBody) as NotificationEnvelope;
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  // Replay defense via NotificationMetadata.PublishTime (no custom header).
  const publishTime = env.NotificationMetadata?.PublishTime;
  const ts = publishTime ? Date.parse(publishTime) : NaN;
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60_000) {
    return NextResponse.json(
      { error: 'envelope-publish-time-out-of-window' },
      { status: 401 },
    );
  }

  // NotificationId dedupe.
  const notificationId = env.NotificationMetadata?.NotificationId;
  if (!notificationId) {
    return NextResponse.json({ error: 'missing-notification-id' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error: dedupeErr } = await supabase
    .from('webhook_dedupe')
    .insert({ notification_id: notificationId, notification_type: env.NotificationType });

  if (dedupeErr?.code === '23505') {
    // Already processed — ack 200 so SP-API stops retrying this NotificationId.
    return NextResponse.json({ ok: true, deduped: true });
  }
  if (dedupeErr) {
    captureRouteFatal(dedupeErr, 'sp-api-webhook', { notification_id: notificationId });
    return NextResponse.json({ error: 'dedupe-failed' }, { status: 500 });
  }

  // Dispatch — return 5xx on error so SP-API retries.
  try {
    switch (env.NotificationType) {
      case 'ANY_OFFER_CHANGED':
      case 'LISTINGS_ITEM_MFN_QUANTITY_CHANGE':
        await runRepricer(supabase, { trigger: 'event', event: env });
        break;
      case 'ACCOUNT_STATUS_CHANGED':
      case 'LISTINGS_ITEM_ISSUES_CHANGE':
      case 'LISTINGS_ITEM_STATUS_CHANGE':
        await runAccountHealth(supabase, { trigger: 'event', event: env });
        break;
      case 'ORDER_CHANGE':
      case 'ORDER_STATUS_CHANGE':
        await runFulfillmentOps(supabase, { trigger: 'webhook', event: env });
        break;
      case 'CUSTOMER_MESSAGE_RECEIVED': {
        // Our own convention; not a canonical SP-API NotificationType. Wave 3
        // wires real Buyer-Seller Messaging API polling to this same shape.
        const event = {
          Payload: env.Payload as {
            CustomerMessageReceivedNotification?: {
              Message?: {
                customer_message_id: string;
                amazon_order_id?: string | null;
                customer_text: string;
                channel: 'amazon' | 'ebay';
              };
            };
          },
        };
        await runCustomerSuccess(supabase, { trigger: 'webhook', event });
        break;
      }
      default:
        // Unknown NotificationType: log + 200 OK so SP-API doesn't retry-storm us.
        console.warn('[sp-api-webhook] unrouted NotificationType:', env.NotificationType);
    }
  } catch (err) {
    captureRouteFatal(err, 'sp-api-webhook', { notification_id: notificationId });
    return NextResponse.json(
      {
        error: 'handler-failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, notification_id: notificationId });
}
