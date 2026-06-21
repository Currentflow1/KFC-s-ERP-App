import { db } from "./db";
import { createClient } from "./supabaseClient";

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function online() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE QUEUE
// ─────────────────────────────────────────────────────────────────────────────

// Queue an inventory upsert locally, then flush immediately if online.
// Returns true if the write reached Supabase in this call, false if queued.
export async function writeInventory(tableName, recordId, payload) {
  await db.pending_changes.add({
    table_name: tableName,
    record_id:  recordId,
    payload:    JSON.stringify(payload),
    synced:     0,
    created_at: new Date().toISOString(),
  });
  if (online()) { await flushQueue(); return true; }
  return false;
}

// Queue a transaction-log insert locally, then flush immediately if online.
// Used for offline +IN/-OUT / count-correction audit rows.
// Returns true if inserted immediately, false if queued.
export async function queueTxLog(tableName, payload) {
  await db.pending_tx_logs.add({
    table_name: tableName,
    payload:    JSON.stringify(payload),
    synced:     0,
    created_at: new Date().toISOString(),
  });
  if (online()) { await flushQueue(); return true; }
  return false;
}

// Flush all unsynced rows to Supabase.
// Inventory writes first, then tx logs — so FK references always resolve.
export async function flushQueue() {
  const supabase = createClient();
  await _flushInventory(supabase);
  await _flushTxLogs(supabase);
}

async function _flushInventory(supabase) {
  let rows;
  try { rows = await db.pending_changes.where("synced").equals(0).sortBy("created_at"); }
  catch (e) { console.error("[sync] read pending_changes failed:", e); return; }
  for (const row of rows ?? []) {
    try {
      const { error } = await supabase
        .from(row.table_name)
        .upsert(JSON.parse(row.payload), { onConflict: "id" });
      if (error) { console.error(`[sync] inventory flush id=${row.id}:`, error.message); continue; }
      await db.pending_changes.update(row.id, { synced: 1 });
    } catch (e) { console.error(`[sync] inventory flush id=${row.id} unexpected:`, e); }
  }
}

async function _flushTxLogs(supabase) {
  let rows;
  try { rows = await db.pending_tx_logs.where("synced").equals(0).sortBy("created_at"); }
  catch (e) { console.error("[sync] read pending_tx_logs failed:", e); return; }
  for (const row of rows ?? []) {
    try {
      const { error } = await supabase
        .from(row.table_name)
        .insert(JSON.parse(row.payload));
      if (error) { console.error(`[sync] tx log flush id=${row.id}:`, error.message); continue; }
      await db.pending_tx_logs.update(row.id, { synced: 1 });
    } catch (e) { console.error(`[sync] tx log flush id=${row.id} unexpected:`, e); }
  }
}

// Count of unsynced rows across both queues — used for the offline banner.
export async function pendingCount() {
  try {
    const [a, b] = await Promise.all([
      db.pending_changes.where("synced").equals(0).count(),
      db.pending_tx_logs.where("synced").equals(0).count(),
    ]);
    return a + b;
  } catch { return 0; }
}

// Delete already-synced rows — housekeeping, called by resetDailyIfNeeded.
export async function clearSynced() {
  try {
    await Promise.all([
      db.pending_changes.where("synced").equals(1).delete(),
      db.pending_tx_logs.where("synced").equals(1).delete(),
    ]);
  } catch (e) { console.error("[sync] clearSynced failed:", e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// DAILY RESET
// ─────────────────────────────────────────────────────────────────────────────

// Runs once per calendar day (tracked in meta store).
// Clears the inventory mirror and synced queue rows so Dexie stays
// a same-day safety net, not a permanent second database.
// Never runs offline — no point blanking the mirror if we can't refill it.
// Never touches UNSYNCED rows — those must survive until flushed.
// Never touches the cache store — role/userId/monitoringOptions are
// not day-scoped and wiping them would break offline ManipulatePanel.
export async function resetDailyIfNeeded() {
  if (!online()) return;
  const today = todayLocal();
  try {
    const row = await db.meta.get("last_reset_date");
    if (row?.value === today) return;
    await db.inventory_snapshot.clear();
    await clearSynced();
    await db.item_change_history.clear();
    await db.meta.put({ key: "last_reset_date", value: today });
    console.info("[sync] daily reset complete for", today);
  } catch (e) { console.error("[sync] daily reset failed:", e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE (role / userId / monitoringOptions)
// ─────────────────────────────────────────────────────────────────────────────

export async function setCache(key, value) {
  try { await db.cache.put({ key, value, updated_at: new Date().toISOString() }); }
  catch (e) { console.error(`[sync] setCache key=${key}:`, e); }
}

export async function getCache(key) {
  try { const row = await db.cache.get(key); return row ? row.value : null; }
  catch (e) { console.error(`[sync] getCache key=${key}:`, e); return null; }
}

// Pre-warm the cache during boot so ManipulatePanel can open offline
// even before it has ever been clicked while online.
export async function warmPermissionCache() {
  if (!online()) return;
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await setCache("userId", user.id);
    const [{ data: profile }, { data: monRows }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).single(),
      supabase.from("monitoring_employee").select("name"),
    ]);
    await setCache("role",              profile?.role ?? "staff");
    await setCache("monitoringOptions", (monRows ?? []).map((r) => r.name));
  } catch (e) { console.error("[sync] warmPermissionCache failed:", e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────

// Full local mirror of the merged inventory list, keyed by "finished" or "raw".
// Written after every successful online loadData(); read when offline.
export async function saveInventorySnapshot(tab, items) {
  try { await db.inventory_snapshot.put({ tab, items, updated_at: new Date().toISOString() }); }
  catch (e) { console.error(`[sync] saveInventorySnapshot tab=${tab}:`, e); }
}

export async function getInventorySnapshot(tab) {
  try { const row = await db.inventory_snapshot.get(tab); return row ? row.items : []; }
  catch (e) { console.error(`[sync] getInventorySnapshot tab=${tab}:`, e); return []; }
}

// Patch a single item in the snapshot — called after an offline write so the
// UI reflects the change without a loadData() round-trip.
export async function patchInventorySnapshot(tab, itemId, patch) {
  try {
    const row   = await db.inventory_snapshot.get(tab);
    const items = row ? row.items : [];
    const updated = items.map((it) => it.id === itemId ? { ...it, ...patch } : it);
    await db.inventory_snapshot.put({ tab, items: updated, updated_at: new Date().toISOString() });
    return updated;
  } catch (e) { console.error(`[sync] patchInventorySnapshot tab=${tab}:`, e); return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM-CHANGE UNDO STACK
// ─────────────────────────────────────────────────────────────────────────────

// Local-only stack of "before" states. Never pushed to Supabase.
// Every item edit pushes one entry; "Undo Item" pops the most recent.
// Stack is cleared by: daily reset, undoSession, undoCloseDay.
//
// `since` is the ISO timestamp captured right before the snapshot was
// taken (see InventoryPage's saveSnapshot) — undoItemChange uses it to
// find and soft-remove the exact tx log row(s) this edit created. Without
// it being stored here, undoItemChange has no way to know which tx rows
// belong to this specific edit, and silently skips removing them — which
// is why "Undo Item" was reverting balances but never marking the related
// transaction as "Undone" in Transaction Logs.

export async function pushItemChange(tab, beforeRows, since) {
  try {
    await db.item_change_history.add({
      tab,
      rows: beforeRows,
      since: since ?? new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  }
  catch (e) { console.error(`[sync] pushItemChange tab=${tab}:`, e); }
}

// Returns most recent entry WITHOUT removing it. Caller pops after success.
export async function peekItemChange(tab) {
  try {
    const rows = await db.item_change_history.where("tab").equals(tab).sortBy("created_at");
    return rows.length > 0 ? rows[rows.length - 1] : null;
  } catch (e) { console.error(`[sync] peekItemChange tab=${tab}:`, e); return null; }
}

export async function popItemChange(tab, entryId) {
  try { await db.item_change_history.delete(entryId); }
  catch (e) { console.error(`[sync] popItemChange id=${entryId}:`, e); }
}

export async function hasItemChangeHistory(tab) {
  try { return (await db.item_change_history.where("tab").equals(tab).count()) > 0; }
  catch (e) { console.error(`[sync] hasItemChangeHistory tab=${tab}:`, e); return false; }
}

export async function clearItemChangeHistory(tab) {
  try { await db.item_change_history.where("tab").equals(tab).delete(); }
  catch (e) { console.error(`[sync] clearItemChangeHistory tab=${tab}:`, e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// SANITIZE
// ─────────────────────────────────────────────────────────────────────────────

// Strip display-only fields (_pendingIncoming/_pendingOutgoing/category_id)
// and un-fold merged incoming/outgoing back to their raw DB values before
// writing to Supabase or pushing to the undo stack.
// Safe to call on already-clean rows — the subtraction is a no-op when
// pending fields are absent.
export function sanitizeInventoryRow(row) {
  const rawIncoming = Number(row.incoming_bal ?? 0) - Number(row._pendingIncoming ?? 0);
  const rawOutgoing = Number(row.outgoing_bal ?? 0) - Number(row._pendingOutgoing ?? 0);
  const beg_bal     = Number(row.beg_bal    ?? 0);
  const actual_bal  = Number(row.actual_bal ?? 0);
  const loss        = Number(row.loss       ?? 0);
  return {
    id:           row.id,
    name:         row.name,
    beg_bal,
    incoming_bal: rawIncoming,
    outgoing_bal: rawOutgoing,
    current_bal:  beg_bal + rawIncoming - rawOutgoing,
    actual_bal,
    loss,
  };
}

// Re-sanitize any unsynced pending_changes whose payloads were queued before
// sanitizeInventoryRow existed (they may contain _pendingIncoming etc. which
// Supabase rejects). Safe to call on clean rows — rewrites them identically.
export async function sanitizePendingChanges() {
  let rows;
  try { rows = await db.pending_changes.where("synced").equals(0).toArray(); }
  catch (e) { console.error("[sync] sanitizePendingChanges read failed:", e); return; }
  for (const row of rows ?? []) {
    try {
      const payload = JSON.parse(row.payload);
      if ("_pendingIncoming" in payload || "_pendingOutgoing" in payload || "category_id" in payload) {
        await db.pending_changes.update(row.id, { payload: JSON.stringify(sanitizeInventoryRow(payload)) });
      }
    } catch (e) { console.error(`[sync] sanitize pending_changes id=${row.id}:`, e); }
  }
}