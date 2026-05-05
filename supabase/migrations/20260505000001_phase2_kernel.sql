begin;

-- ─── audit_log: actor_kind discriminated union for system actions ───
alter table audit_log
  add column if not exists actor_kind text not null default 'human'
    check (actor_kind in ('human', 'system'));
alter table audit_log
  add column if not exists actor_label text;  -- e.g. 'account_health' for actor_kind='system'

-- ─── briefings.auto_executed: digest filter for system-actioned items ─
alter table briefings
  add column if not exists auto_executed boolean not null default false;

-- ─── audit_log undo-active partial index (cleanup helper) ───────────
create index if not exists audit_log_undo_active_idx
  on audit_log(undo_window_expires_at)
  where undone_at is null and undo_window_expires_at is not null;

-- ─── approve_audit_atomic: wraps post-executor audit insert + state-finalize ─
-- Caller: kernel.approveOne already did the atomic state-flip claim
-- (update inbox_items set state='acted' where state='pending'). This RPC
-- runs AFTER executor.forward succeeded, and atomically:
--   1. INSERTs the audit_log row
--   2. (if executor returned a pending_*_id) UPDATEs the back-link
-- Both writes commit together.
create or replace function approve_audit_atomic(
  p_inbox_item_id uuid,
  p_pharmacy_id uuid,
  p_actor text,
  p_actor_kind text,
  p_actor_label text,
  p_action text,
  p_params jsonb,
  p_result jsonb,
  p_undo_window_min int default 30,
  p_pending_table text default null,
  p_pending_id uuid default null
) returns table (
  audit_log_id uuid,
  undo_window_expires_at timestamptz
) language plpgsql as $$
declare
  v_audit audit_log%rowtype;
begin
  -- Defense-in-depth allowlist: pickPendingTable in TS only emits these 5,
  -- but a future caller / direct SQL invocation could pass arbitrary text.
  if p_pending_table is not null and p_pending_table not in (
    'pending_listings','pending_pricing_changes','pending_customer_messages',
    'pending_health_actions','pending_purchase_orders'
  ) then
    raise exception 'invalid pending_table: %', p_pending_table;
  end if;

  insert into audit_log (
    pharmacy_id, actor, actor_kind, actor_label, action,
    target_entity_type, target_entity_id, params, result,
    undo_window_expires_at
  ) values (
    p_pharmacy_id, p_actor, p_actor_kind, p_actor_label, p_action,
    'inbox_items', p_inbox_item_id, p_params, p_result,
    now() + make_interval(mins => p_undo_window_min)
  )
  returning * into v_audit;

  -- Optional back-link if executor returned a pending_*_id.
  if p_pending_table is not null and p_pending_id is not null then
    execute format(
      'update %I set audit_log_id = $1 where id = $2',
      p_pending_table
    ) using v_audit.id, p_pending_id;
  end if;

  return query select v_audit.id, v_audit.undo_window_expires_at;
end;
$$;

-- ─── reject_action_atomic: state-flip + audit insert in one tx ─────
create or replace function reject_action_atomic(
  p_inbox_item_id uuid,
  p_pharmacy_id uuid,
  p_actor text,
  p_actor_kind text,
  p_actor_label text,
  p_dismissed_reason text
) returns table (
  audit_log_id uuid
) language plpgsql as $$
declare
  v_flipped inbox_items%rowtype;
  v_audit audit_log%rowtype;
begin
  update inbox_items
    set state = 'dismissed', dismissed_reason = p_dismissed_reason
    where id = p_inbox_item_id
      and pharmacy_id = p_pharmacy_id
      and state in ('pending', 'seen')
    returning * into v_flipped;

  if not found then
    raise exception 'STALE_OR_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into audit_log (
    pharmacy_id, actor, actor_kind, actor_label, action,
    target_entity_type, target_entity_id, params, result
  ) values (
    p_pharmacy_id, p_actor, p_actor_kind, p_actor_label,
    'reject_briefing', 'inbox_items', p_inbox_item_id,
    jsonb_build_object('reason', p_dismissed_reason),
    jsonb_build_object('rejected', true)
  )
  returning * into v_audit;

  return query select v_audit.id;
end;
$$;

commit;
