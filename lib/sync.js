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
// SYNC STATES
// ─────────────────────────────────────────────────────────────────────────────
// 0 = pending (not yet sent)
// 1 = synced (confirmed written to Supabase)
// 2 = failed (can never succeed — schema mismatch, missing FK, etc. — and
//     was skipped rather than retried). Kept distinct from 1 so a skipped
//     write is never confused with a successful one; surfaced via
//     failedCount()/getFailedChanges() instead of disappearing silently.
const SYNC_PENDING = 0;
const SYNC_SYNCED  = 1;
const SYNC_FAILED  = 2;

// ── FK field per tab / per inventory table — single source of truth ───────
// Previously this was hardcoded as a raw/finished binary (isRaw ? a : b),
// which silently broke the packaging tab everywhere it was used:
// pushItemChange logged "missing finished_product_id" for packaging rows,
// sanitizeInventoryRow dropped packaging_id entirely, and the flush/evict
// FK guards never recognized packaging_inventory at all.
const FK_FIELD_BY_TAB = {
  raw: "raw_material_id",
  finished: "finished_product_id",
  packaging: "packaging_id",
};
const FK_FIELD_BY_INV_TABLE = {
  raw_materials_inventory: "raw_material_id",
  finished_products_inventory: "finished_product_id",
  packaging_inventory: "packaging_id",
};

// ─────────────────────────────────────────────────────────────────────────────
// WRITE QUEUE
// ─────────────────────────────────────────────────────────────────────────────

export async function writeInventory(tableName, recordId, payload) {
  await db.pending_changes.add({
    table_name: tableName,
    record_id:  recordId,
    payload:    JSON.stringify(payload),
    synced:     SYNC_PENDING,
    created_at: new Date().toISOString(),
  });
  if (online()) { await flushQueue(); return true; }
  return false;
}

export async function queueTxLog(tableName, payload) {
  await db.pending_tx_logs.add({
    table_name: tableName,
    payload:    JSON.stringify(payload),
    synced:     SYNC_PENDING,
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
// If a payload contains a column removed by a migration, Supabase returns
// a constraint/column error and the row gets stuck in the queue forever.
// Keeping this list current after schema changes prevents that.
const INVENTORY_COLUMNS = {
  raw_materials_inventory: [
    "id", "name", "beg_bal", "incoming_bal", "outgoing_bal",
    "current_bal", "actual_bal", "loss", "warehouse",
    "raw_material_id",
  ],
  finished_products_inventory: [
    "id", "name", "beg_bal", "incoming_bal", "outgoing_bal",
    "current_bal", "actual_bal", "loss", "warehouse",
    "finished_product_id",
  ],
  packaging_inventory: [
    "id", "name", "beg_bal", "incoming_bal", "outgoing_bal",
    "current_bal", "actual_bal", "loss", "warehouse",
    "packaging_id",
  ],
};

// Error substrings that indicate a schema mismatch — the row can never succeed
// and should be skipped (marked failed) rather than blocking the queue.
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

// Mark a pending_changes row as permanently failed instead of pretending it
// synced. Records the reason so it can be inspected/audited later via
// getFailedChanges() rather than only ever appearing in a console log.
async function markFailed(rowId, tableName, reason) {
  console.warn(`[sync] skipping stale payload id=${rowId} table=${tableName}: ${reason}`);
  await db.pending_changes.update(rowId, {
    synced:      SYNC_FAILED,
    fail_reason: reason,
    failed_at:   new Date().toISOString(),
  });
}

async function _flushInventory(supabase) {
  let rows;
  try {
    rows = await db.pending_changes.where("synced").equals(SYNC_PENDING).sortBy("created_at");
  } catch (e) {
    console.error("[sync] read pending_changes failed:", e);
    return;
  }

  for (const row of rows ?? []) {
    try {
      const raw     = JSON.parse(row.payload);
      const payload = stripUnknownColumns(row.table_name, raw);

      // Guard: ensure required FK is present before attempting upsert.
      // Missing FKs are the #1 cause of 400s from the inventory write queue.
      // Driven by FK_FIELD_BY_INV_TABLE so raw / finished / packaging all
      // get the same protection instead of only the first two tabs.
      const fkField = FK_FIELD_BY_INV_TABLE[row.table_name];
      if (fkField && !payload[fkField]) {
        await markFailed(row.id, row.table_name, `missing ${fkField}`);
        continue;
      }

      const { error } = await supabase
        .from(row.table_name)
        .upsert(payload, { onConflict: "id" });

      if (error) {
        if (isSchemaError(error.message)) {
          // This row can never succeed — skip it so the queue can continue.
          await markFailed(row.id, row.table_name, error.message);
        } else {
          // Transient error (network, RLS, etc.) — leave unsynced and retry later.
          console.error(`[sync] inventory flush id=${row.id}:`, error.message);
        }
        continue;
      }

      await db.pending_changes.update(row.id, { synced: SYNC_SYNCED });
    } catch (e) {
      console.error(`[sync] inventory flush id=${row.id} unexpected:`, e);
    }
  }
}

async function _flushTxLogs(supabase) {
  let rows;
  try {
    rows = await db.pending_tx_logs.where("synced").equals(SYNC_PENDING).sortBy("created_at");
  } catch (e) {
    console.error("[sync] read pending_tx_logs failed:", e);
    return;
  }
  for (const row of rows ?? []) {
    try {
      const { error } = await supabase
        .from(row.table_name)
        .insert(JSON.parse(row.payload));
      if (error) { console.error(`[sync] tx log flush id=${row.id}:`, error.message); continue; }
      await db.pending_tx_logs.update(row.id, { synced: SYNC_SYNCED });
    } catch (e) {
      console.error(`[sync] tx log flush id=${row.id} unexpected:`, e);
    }
  }
}

export async function pendingCount() {
  try {
    const [a, b] = await Promise.all([
      db.pending_changes.where("synced").equals(SYNC_PENDING).count(),
      db.pending_tx_logs.where("synced").equals(SYNC_PENDING).count(),
    ]);
    return a + b;
  } catch { return 0; }
}

// Count of changes that were permanently skipped rather than synced.
// A non-zero count here means real edits never reached Supabase — surface
// this somewhere visible (a banner, a badge) rather than letting it sit
// silently in IndexedDB.
export async function failedCount() {
  try { return await db.pending_changes.where("synced").equals(SYNC_FAILED).count(); }
  catch { return 0; }
}

// Returns the full list of permanently-failed pending_changes rows, parsed,
// for inspection/debugging/manual reconciliation.
export async function getFailedChanges() {
  try {
    const rows = await db.pending_changes.where("synced").equals(SYNC_FAILED).sortBy("created_at");
    return (rows ?? []).map((row) => ({
      id:          row.id,
      table_name:  row.table_name,
      record_id:   row.record_id,
      payload:     JSON.parse(row.payload),
      fail_reason: row.fail_reason ?? null,
      failed_at:   row.failed_at   ?? null,
      created_at:  row.created_at,
    }));
  } catch (e) { console.error("[sync] getFailedChanges failed:", e); return []; }
}

// Explicitly purge failed rows once you've manually reconciled them.
// Deliberately separate from clearSynced() so failures aren't dropped
// by accident during routine cleanup.
export async function clearFailed() {
  try { await db.pending_changes.where("synced").equals(SYNC_FAILED).delete(); }
  catch (e) { console.error("[sync] clearFailed failed:", e); }
}

export async function clearSynced() {
  try {
    await Promise.all([
      db.pending_changes.where("synced").equals(SYNC_SYNCED).delete(),
      db.pending_tx_logs.where("synced").equals(SYNC_SYNCED).delete(),
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
  // Driven by FK_FIELD_BY_TAB instead of a raw/finished isRaw boolean, so
  // packaging gets checked against packaging_id instead of incorrectly
  // falling into the finished_product_id branch.
  const fkField = FK_FIELD_BY_TAB[tab] ?? "finished_product_id";

  // Warn loudly if any snapshot row is missing its FK. Catching this at
  // push time is far easier than debugging a 400 during undo later.
  const missing = beforeRows.filter((r) => !r[fkField]);
  if (missing.length > 0) {
    console.warn(
      `[sync] pushItemChange: ${missing.length} row(s) missing ${fkField}:`,
      missing.map((r) => ({ id: r.id, name: r.name }))
    );
  }

  try {
    const entryId = await db.item_change_history.add({
      tab,
      rows:       beforeRows,
      since:      since ?? new Date().toISOString(),
      txIds:      [],
      created_at: new Date().toISOString(),
    });
    return entryId;
  } catch (e) { console.error(`[sync] pushItemChange tab=${tab}:`, e); return null; }
}

// Record the exact transaction-log row id created by a manipulation, tied
// to the item-change entry it belongs to. Undo then deletes by this exact
// id instead of a created_at >= since time-range match — the time-range
// match is vulnerable to client/server clock skew (client-generated
// `since` can land after the server-assigned `created_at` of the row that
// was just inserted), which silently produces a 0-row UPDATE and leaves
// the transaction log showing "Finalized" even after a successful undo.
export async function attachTxIdToItemChange(tab, entryId, txId) {
  if (!entryId || !txId) return;
  try {
    const entry = await db.item_change_history.get(entryId);
    if (!entry) return;
    const txIds = Array.isArray(entry.txIds) ? entry.txIds : [];
    txIds.push(txId);
    await db.item_change_history.update(entryId, { txIds });
  } catch (e) { console.error(`[sync] attachTxIdToItemChange id=${entryId}:`, e); }
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
    warehouse:    row.warehouse ?? null,
    beg_bal,
    incoming_bal: rawIncoming,
    outgoing_bal: rawOutgoing,
    current_bal:  beg_bal + rawIncoming - rawOutgoing,
    actual_bal,
    loss,
    // Always emit all three FK columns unconditionally so the upsert never
    // violates a NOT NULL constraint. packaging_id was previously missing
    // here entirely, which silently broke undo for the packaging tab —
    // the row would go out with no FK at all. If a value is genuinely
    // absent it will now surface as a Supabase error (caught by
    // markFailed) rather than silently writing a broken row.
    raw_material_id:     row.raw_material_id     ?? null,
    finished_product_id: row.finished_product_id ?? null,
    packaging_id:        row.packaging_id        ?? null,
  };
}

export async function sanitizePendingChanges() {
  let rows;
  try {
    rows = await db.pending_changes.where("synced").equals(SYNC_PENDING).toArray();
  } catch (e) { console.error("[sync] sanitizePendingChanges read failed:", e); return; }

  for (const row of rows ?? []) {
    try {
      const payload = JSON.parse(row.payload);
      if (
        "_pendingIncoming" in payload ||
        "_pendingOutgoing" in payload ||
        "category_id"      in payload
      ) {
        await db.pending_changes.update(row.id, {
          payload: JSON.stringify(sanitizeInventoryRow(payload)),
        });
      }
    } catch (e) { console.error(`[sync] sanitize pending_changes id=${row.id}:`, e); }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME STALE-DATA CLEANUP
// ─────────────────────────────────────────────────────────────────────────────
// Call once on boot (inside resetDailyIfNeeded or your boot() function) to
// evict any IndexedDB entries written before the FK fix landed.
// After the first run it becomes a no-op because all new entries carry the FK.

export async function evictStaleQueueEntries() {
  try {
    const rows = await db.pending_changes
      .where("synced")
      .equals(SYNC_PENDING)
      .toArray();

    for (const row of rows ?? []) {
      try {
        const payload = JSON.parse(row.payload);
        // Driven by FK_FIELD_BY_INV_TABLE so packaging_inventory entries
        // get the same eviction protection raw/finished already had.
        const fkField = FK_FIELD_BY_INV_TABLE[row.table_name];
        if (fkField && !payload[fkField]) {
          await markFailed(row.id, row.table_name, `evicted on boot — missing ${fkField}`);
        }
      } catch (e) {
        console.error(`[sync] evictStaleQueueEntries id=${row.id}:`, e);
      }
    }

    // Also clear any item_change_history snapshots written before the fix.
    // Those snapshot rows may be missing the FK too (especially packaging
    // rows, which never had packaging_id captured before this fix), so
    // undoing them would produce a 400 or a silently no-op tx-log update.
    // Clearing forces a fresh snapshot on the next change.
    await db.item_change_history.clear();

    console.info("[sync] evictStaleQueueEntries complete");
  } catch (e) {
    console.error("[sync] evictStaleQueueEntries failed:", e);
  }
}