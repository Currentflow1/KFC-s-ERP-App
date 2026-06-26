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

export async function flushQueue() {
  const supabase = createClient();
  await _flushInventory(supabase);
  await _flushTxLogs(supabase);
}

// ── Known valid columns per inventory table ───────────────────────────────────
// Used to strip stale/unknown fields from queued payloads before flushing.
// If a payload contains a column removed by a migration (e.g. finished_product_id
// which never existed, or quantity_per_unit which was dropped), Supabase returns
// a constraint/column error and the row gets stuck in the queue forever.
// Keeping this list current after schema changes prevents that.
const INVENTORY_COLUMNS = {
  raw_materials_inventory:     ["id", "name", "beg_bal", "incoming_bal", "outgoing_bal", "current_bal", "actual_bal", "loss", "warehouse"],
  finished_products_inventory: ["id", "name", "beg_bal", "incoming_bal", "outgoing_bal", "current_bal", "actual_bal", "loss", "warehouse"],
};

// Error substrings that indicate a schema mismatch — the row can never succeed
// and should be skipped (marked synced) rather than blocking the queue.
const SCHEMA_ERROR_HINTS = [
  "violates not-null constraint",
  "column",
  "does not exist",
  "unknown",
  "invalid input",
];

function isSchemaError(msg) {
  const lower = (msg ?? "").toLowerCase();
  return SCHEMA_ERROR_HINTS.some((hint) => lower.includes(hint));
}

// Remove any keys from the payload that aren't in the allowed-column list.
// Falls back to returning the full payload if the table isn't in the map.
function stripUnknownColumns(tableName, payload) {
  const allowed = INVENTORY_COLUMNS[tableName];
  if (!allowed) return payload;
  return Object.fromEntries(
    Object.entries(payload).filter(([k]) => allowed.includes(k))
  );
}

async function _flushInventory(supabase) {
  let rows;
  try { rows = await db.pending_changes.where("synced").equals(0).sortBy("created_at"); }
  catch (e) { console.error("[sync] read pending_changes failed:", e); return; }

  for (const row of rows ?? []) {
    try {
      // Strip columns that no longer exist on the table — prevents stale
      // payloads from blocking the queue after schema migrations.
      const raw     = JSON.parse(row.payload);
      const payload = stripUnknownColumns(row.table_name, raw);

      const { error } = await supabase
        .from(row.table_name)
        .upsert(payload, { onConflict: "id" });

      if (error) {
        if (isSchemaError(error.message)) {
          // This row can never succeed — skip it so the queue can continue.
          console.warn(
            `[sync] skipping stale payload id=${row.id} table=${row.table_name}:`,
            error.message
          );
          await db.pending_changes.update(row.id, { synced: 1 });
        } else {
          // Transient error (network, RLS, etc.) — leave unsynced and retry later.
          console.error(`[sync] inventory flush id=${row.id}:`, error.message);
        }
        continue;
      }

      await db.pending_changes.update(row.id, { synced: 1 });
    } catch (e) {
      console.error(`[sync] inventory flush id=${row.id} unexpected:`, e);
    }
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

export async function pendingCount() {
  try {
    const [a, b] = await Promise.all([
      db.pending_changes.where("synced").equals(0).count(),
      db.pending_tx_logs.where("synced").equals(0).count(),
    ]);
    return a + b;
  } catch { return 0; }
}

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
// CACHE
// ─────────────────────────────────────────────────────────────────────────────

export async function setCache(key, value) {
  try { await db.cache.put({ key, value, updated_at: new Date().toISOString() }); }
  catch (e) { console.error(`[sync] setCache key=${key}:`, e); }
}

export async function getCache(key) {
  try { const row = await db.cache.get(key); return row ? row.value : null; }
  catch (e) { console.error(`[sync] getCache key=${key}:`, e); return null; }
}

export async function warmPermissionCache() {
  if (!online()) return;
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await setCache("userId", user.id);
    const [{ data: profile }, { data: monRows }, { data: repRows }, { data: supRows }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).single(),
      supabase.from("monitoring_employee").select("name"),
      supabase.from("representative_employee").select("name"),
      supabase.from("suppliers").select("contact_person"),
    ]);
    await setCache("role",                  profile?.role ?? "staff");
    await setCache("monitoringOptions",     (monRows ?? []).map((r) => r.name));
    await setCache("representativeOptions", (repRows ?? []).map((r) => r.name));
    await setCache("supplierOptions",       (supRows ?? []).map((r) => r.contact_person).filter((n) => n !== "N/A"));
  } catch (e) { console.error("[sync] warmPermissionCache failed:", e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────

export async function saveInventorySnapshot(tab, items) {
  try { await db.inventory_snapshot.put({ tab, items, updated_at: new Date().toISOString() }); }
  catch (e) { console.error(`[sync] saveInventorySnapshot tab=${tab}:`, e); }
}

export async function getInventorySnapshot(tab) {
  try { const row = await db.inventory_snapshot.get(tab); return row ? row.items : []; }
  catch (e) { console.error(`[sync] getInventorySnapshot tab=${tab}:`, e); return []; }
}

export async function patchInventorySnapshot(tab, itemId, patch) {
  try {
    const row     = await db.inventory_snapshot.get(tab);
    const items   = row ? row.items : [];
    const updated = items.map((it) => it.id === itemId ? { ...it, ...patch } : it);
    await db.inventory_snapshot.put({ tab, items: updated, updated_at: new Date().toISOString() });
    return updated;
  } catch (e) { console.error(`[sync] patchInventorySnapshot tab=${tab}:`, e); return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM-CHANGE UNDO STACK
// ─────────────────────────────────────────────────────────────────────────────

export async function pushItemChange(tab, beforeRows, since) {
  try {
    await db.item_change_history.add({
      tab,
      rows:       beforeRows,
      since:      since ?? new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  } catch (e) { console.error(`[sync] pushItemChange tab=${tab}:`, e); }
}

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