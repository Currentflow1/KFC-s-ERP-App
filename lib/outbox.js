// lib/outbox.js
//
// One user action = one "op" = one row in the outbox.
//
// An op carries BOTH the inventory change(s) and the transaction-log row(s),
// and is sent to Postgres as a single function call (apply_inventory_op) that
// runs as ONE database transaction:
//   - everything in the op is applied, or
//   - nothing is (the server rejects it and rolls the whole thing back).
//
// The op stays on the device until the server has confirmed it, so nothing
// disappears while offline. Ops are sent strictly in the order they were made.

import { db } from "./db";
import { createClient } from "./supabaseClient";

export const OP_PENDING  = "pending";   // waiting to be sent (or retrying after a network error)
export const OP_SYNCED   = "synced";    // server confirmed the whole op was applied
export const OP_REJECTED = "rejected";  // server refused the whole op; NOTHING was applied

const TABLES_BY_TAB = {
  raw:       { inv: "raw_materials_inventory",     tx: "raw_materials_transaction_log" },
  finished:  { inv: "finished_products_inventory", tx: "finished_products_transaction_log" },
  packaging: { inv: "packaging_inventory",         tx: "packaging_transaction_log" },
};

function online() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for non-secure contexts (e.g. testing over http on a LAN).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ENQUEUE
// ─────────────────────────────────────────────────────────────────────────────
//
//   inventory : rows from sanitizeInventoryRow() (must include `version`)
//   txLogs    : full transaction-log rows to insert
//
// Returns { opId, status } where status is "synced" | "pending" | "rejected".
// Callers should NOT write the tx log separately anymore.

export async function enqueueOp({ tab, inventory = [], txLogs = [] }) {
  const tables = TABLES_BY_TAB[tab];
  if (!tables) throw new Error(`[outbox] unknown tab: ${tab}`);

  // A second offline edit to the same row is a continuation of this device's
  // own chain (the first op will have bumped the server version), so it must
  // not be version-checked against the server.
  const waiting = await db.outbox.where("status").anyOf(OP_PENDING, OP_REJECTED).toArray();
  const waitingIds = new Set(waiting.flatMap((op) => op.payload.inventory.map((r) => r.id)));

  const payload = {
    op_id:     newId(),
    inv_table: tables.inv,
    tx_table:  tables.tx,
    inventory: inventory.map((row) => {
      const { version, ...clean } = row;
      return { ...clean, expected_version: waitingIds.has(row.id) ? null : (version ?? null) };
    }),
    // Client-generated id => retrying the insert can never create a duplicate.
    tx_logs: txLogs.map((t) => ({ ...t, id: t.id ?? newId() })),
  };

  const id = await db.outbox.add({
    op_id:      payload.op_id,
    status:     OP_PENDING,
    payload,
    attempts:   0,
    last_error: null,
    created_at: new Date().toISOString(),
  });

  if (online()) await flushOutbox();

  const row = await db.outbox.get(id);
  return { opId: payload.op_id, status: row?.status ?? OP_PENDING };
}

// ─────────────────────────────────────────────────────────────────────────────
// FLUSH
// ─────────────────────────────────────────────────────────────────────────────

let inFlight = null;

// Only one flush runs at a time (per tab via the promise, across tabs via the
// Web Locks API). Without this, boot + "online" event + a save button can all
// flush at once and send the same op twice.
export function flushOutbox() {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.locks) {
        return await navigator.locks.request("outbox-flush", { ifAvailable: true }, async (lock) => {
          if (!lock) return { skipped: true }; // another tab is already flushing
          return _drain();
        });
      }
      return await _drain();
    } catch (e) {
      console.error("[outbox] flush failed:", e);
      return { halted: "error" };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

// Decide what a failed call means:
//   "transient" -> nobody answered / server was busy: keep the op, retry later
//   "auth"      -> session expired: refresh the token, then retry
//   "permanent" -> the server understood and REFUSED it (conflict, constraint,
//                  permission...): rolled back, will never succeed as-is
function classifyError(error, httpStatus) {
  const code = error?.code ?? "";

  // No SQLSTATE / PostgREST code means the request never got a real answer
  // (offline, timeout, gateway 502/503) -> safe to retry.
  if (!code) return "transient";

  if (httpStatus === 401 || code.startsWith("PGRST30")) return "auth";

  if (
    httpStatus === 429 || httpStatus >= 500 ||
    /^(08|40|53|57)/.test(code) ||   // connection, deadlock/serialization, resources, shutdown
    /^PGRST00/.test(code)            // PostgREST couldn't reach the database
  ) return "transient";

  return "permanent";
}

async function _drain() {
  const supabase = createClient();
  let refreshedOnce = false;

  while (true) {
    // Strict first-in-first-out.
    const pending = await db.outbox.where("status").equals(OP_PENDING).sortBy("id");
    const op = pending[0];
    if (!op) return { done: true };

    let result;
    try {
      result = await supabase.rpc("apply_inventory_op", { p_op: op.payload });
    } catch (e) {
      // fetch threw outright (offline, DNS, aborted) -> transient
      await db.outbox.update(op.id, {
        attempts:   (op.attempts ?? 0) + 1,
        last_error: String(e?.message ?? e),
      });
      return { halted: "network" };
    }

    const { error, status: httpStatus } = result;

    if (!error) {
      await db.outbox.update(op.id, {
        status:     OP_SYNCED,
        synced_at:  new Date().toISOString(),
        last_error: null,
      });
      continue;
    }

    const kind = classifyError(error, httpStatus);

    if (kind === "auth" && !refreshedOnce) {
      refreshedOnce = true;
      try {
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (!refreshError) continue; // retry the same op with the fresh token
      } catch { /* fall through and halt */ }
    }

    if (kind === "transient" || kind === "auth") {
      await db.outbox.update(op.id, {
        attempts:   (op.attempts ?? 0) + 1,
        last_error: error.message,
      });
      return { halted: kind === "auth" ? "auth" : "network" };
    }

    // Permanent: the server refused the whole op and rolled it back.
    // Halt the queue so later ops that depend on this one don't run on top of it.
    await db.outbox.update(op.id, {
      status:      OP_REJECTED,
      last_error:  error.message,
      rejected_at: new Date().toISOString(),
    });
    return { halted: "rejected" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS + RESOLVING REJECTED OPS
// ─────────────────────────────────────────────────────────────────────────────

export async function outboxPendingCount() {
  try { return await db.outbox.where("status").equals(OP_PENDING).count(); }
  catch { return 0; }
}

export async function getRejectedOps() {
  try { return await db.outbox.where("status").equals(OP_REJECTED).sortBy("id"); }
  catch { return []; }
}

// Try a rejected op again (e.g. after fixing the cause), then resume the queue.
export async function retryRejectedOp(id) {
  await db.outbox.update(id, { status: OP_PENDING, last_error: null });
  return flushOutbox();
}

// Give up on a rejected op. It was never applied on the server, so after
// discarding, reload the screen's data from the server so the UI matches.
export async function discardRejectedOp(id) {
  await db.outbox.delete(id);
  return flushOutbox(); // ops queued behind it can now continue
}

// Housekeeping: drop ops the server has already confirmed.
export async function clearSyncedOps() {
  try { await db.outbox.where("status").equals(OP_SYNCED).delete(); }
  catch (e) { console.error("[outbox] clearSyncedOps failed:", e); }
}