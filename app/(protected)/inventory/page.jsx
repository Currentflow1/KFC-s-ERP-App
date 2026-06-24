"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabaseClient";
import {
  saveInventorySnapshot,
  getInventorySnapshot,
  resetDailyIfNeeded,
  pushItemChange,
  peekItemChange,
  popItemChange,
  hasItemChangeHistory,
  clearItemChangeHistory,
  writeInventory,
  sanitizeInventoryRow,
  warmPermissionCache,
} from "@/lib/sync";
import InventoryHeader   from "./components/InventoryHeader";
import InventoryTable    from "./components/InventoryTable";
import ManipulatePanel   from "./components/ManipulationPanel";
import InventoryCalendar from "./components/InventoryCalendar";
import InventorySummary  from "./components/InventorySummary";

// ─── table name helpers ───────────────────────────────────────────────────────
function txTable(r)   { return r ? "raw_materials_transaction_log"      : "finished_products_transaction_log"; }
function invTable(r)  { return r ? "raw_materials_inventory"             : "finished_products_inventory"; }
function histTable(r) { return r ? "raw_materials_inventory_history"     : "finished_products_inventory_history"; }
function staticTbl(r) { return r ? "raw_materials_static"               : "finished_products_static"; }

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isOnline() { return typeof navigator === "undefined" ? true : navigator.onLine; }

// ─────────────────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const supabase = createClient();

  const [tab,  setTab]  = useState("finished");
  const [date, setDate] = useState("");

  const [items,            setItems]            = useState([]);
  const [loading,          setLoading]          = useState(false);
  const [finalizing,       setFinalizing]       = useState(false);
  const [alreadyFinalized, setAlreadyFinalized] = useState(false);
  const [undoing,          setUndoing]          = useState(null);
  const [canUndoItem,      setCanUndoItem]      = useState(false);
  const [canUndoSession,   setCanUndoSession]   = useState(false);
  const [canUndoCloseDay,  setCanUndoCloseDay]  = useState(false);
  const [activeItem,       setActiveItem]       = useState(null);
  const [booted,           setBooted]           = useState(false);
  const [usingOffline,     setUsingOffline]     = useState(false);
  const [manipulationError, setManipulationError] = useState(null);

  // Refs so async functions always read the latest tab/date without closures
  const tabRef  = useRef("finished");
  const dateRef = useRef("");
  tabRef.current  = tab;
  dateRef.current = date;

  function isRawNow() { return tabRef.current === "raw"; }
  function dateNow()  { return dateRef.current; }

  // ─── checkFinalizedFor ─────────────────────────────────────────────────────

  async function checkFinalizedFor(whichTab) {
    if (!isOnline()) return;
    const isRaw = whichTab === "raw";
    const { data, error } = await supabase
      .from(histTable(isRaw)).select("id")
      .eq("inventory_date", todayLocal()).limit(1);
    if (error) { console.error("checkFinalizedFor:", error.message); return; }
    setAlreadyFinalized(!!(data && data.length > 0));
  }

  // ─── checkUndoAvailability ────────────────────────────────────────────────

  async function checkUndoAvailability(whichTab) {
    const t      = whichTab ?? tabRef.current;
    const hasLocal = await hasItemChangeHistory(t);
    if (!isOnline()) { setCanUndoItem(hasLocal); return; }
    const [a, b, c] = await Promise.all([
      supabase.from("undo_log").select("id").eq("tab", t).eq("undo_type", "item_change").order("created_at", { ascending: false }).limit(1),
      supabase.from("undo_log").select("id").eq("tab", t).eq("undo_type", "session")    .order("created_at", { ascending: false }).limit(1),
      supabase.from("undo_log").select("id").eq("tab", t).eq("undo_type", "close_day")  .order("created_at", { ascending: false }).limit(1),
    ]);
    setCanUndoItem    (hasLocal || (a.data || []).length > 0);
    setCanUndoSession ((b.data || []).length > 0);
    setCanUndoCloseDay((c.data || []).length > 0);
  }

  // ─── loadData ─────────────────────────────────────────────────────────────

  async function loadData(whichTab, whichDate) {
    const isRaw      = (whichTab  ?? tabRef.current) === "raw";
    const chosenDate = whichDate  ?? dateRef.current;
    const isHistory  = chosenDate !== "";
    const snapKey    = isRaw ? "raw" : "finished";

    if (!isOnline()) {
      if (isHistory) { setItems([]); setUsingOffline(true); return; }
      setItems(await getInventorySnapshot(snapKey));
      setUsingOffline(true);
      return;
    }

    setLoading(true);
    try {
      const { data: statics } = await supabase.from(staticTbl(isRaw)).select("*");

      let query = supabase.from(isHistory ? histTable(isRaw) : invTable(isRaw)).select("*");
      if (isHistory) query = query.eq("inventory_date", chosenDate);
      const { data: invRows } = await query;

      const invMap = {};
      (invRows || []).forEach((i) => { invMap[isHistory ? i.inventory_id : i.id] = i; });

      const txTotals = {};
      if (!isHistory) {
        const { data: txRows } = await supabase
          .from(txTable(isRaw))
          .select("inventory_id, incoming_bal, outgoing_bal")
          .is("finalized_at", null)
          .is("removed_at", null);
        (txRows || []).forEach(({ inventory_id, incoming_bal, outgoing_bal }) => {
          if (!txTotals[inventory_id]) txTotals[inventory_id] = { incoming: 0, outgoing: 0 };
          txTotals[inventory_id].incoming += Number(incoming_bal ?? 0);
          txTotals[inventory_id].outgoing += Number(outgoing_bal ?? 0);
        });
      }

      const merged = (statics || []).map((s) => {
        const inv = invMap[s.id];
        const tx  = txTotals[s.id] ?? { incoming: 0, outgoing: 0 };
        const beg_bal      = Number(inv?.beg_bal      ?? 0);
        const actual_bal   = Number(inv?.actual_bal   ?? 0);
        const loss         = Number(inv?.loss         ?? 0);
        const incoming_bal = Number(inv?.incoming_bal ?? 0) + tx.incoming;
        const outgoing_bal = Number(inv?.outgoing_bal ?? 0) + tx.outgoing;
        const current_bal  = beg_bal + incoming_bal - outgoing_bal;
        return { id: s.id, name: s.name, category_id: s.category_id, warehouse: s.warehouse,
          beg_bal, incoming_bal, outgoing_bal, current_bal, actual_bal, loss,
          _pendingIncoming: tx.incoming, _pendingOutgoing: tx.outgoing };
      });

      setItems(merged);
      setUsingOffline(false);
      if (!isHistory) await saveInventorySnapshot(snapKey, merged);
    } catch (e) {
      console.error("[InventoryPage] loadData fallback:", e);
      if (!isHistory) { setItems(await getInventorySnapshot(snapKey)); setUsingOffline(true); }
    } finally { setLoading(false); }
  }

  // ─── snapshots ────────────────────────────────────────────────────────────
  // item_change and session snapshots now also record a `since` timestamp
  // (ISO string, taken right before the snapshot is saved) so undo knows
  // the exact cutoff for "transaction log rows created during this change /
  // session" — used to delete the matching tx rows on undo.

  async function saveSnapshot(undoType, whichTab) {
    const isRaw = (whichTab ?? tabRef.current) === "raw";
    const t     = whichTab ?? tabRef.current;
    const since = new Date().toISOString();

    if (undoType === "item_change") {
      let before;
      if (isOnline()) {
        const { data } = await supabase.from(invTable(isRaw)).select("*");
        before = data || [];
      } else {
        before = await getInventorySnapshot(isRaw ? "raw" : "finished");
      }
      // Local stack entry carries `since` so undoItemChange can delete the
      // exact tx row(s) created after this point for this item.
      await pushItemChange(t, before, since);
      if (isOnline()) {
        await supabase.from("undo_log").insert({
          undo_type: undoType, tab: t,
          snapshot: { inventory: before, since },
        });
      }
      return since;
    }

    // session — online only. Snapshot stores `since` so undoSession can
    // delete every pending tx row (any source) created at/after this point.
    if (!isOnline()) return since;
    const { data } = await supabase.from(invTable(isRaw)).select("*");
    await supabase.from("undo_log").insert({
      undo_type: undoType, tab: t,
      snapshot: { inventory: data || [], since },
    });
    return since;
  }

  async function saveCloseDaySnapshot(isRaw, whichTab, finalizedTxIds, historyDate) {
    const { data } = await supabase.from(invTable(isRaw)).select("*");
    await supabase.from("undo_log").insert({
      undo_type: "close_day", tab: whichTab,
      snapshot: { inventory: data || [], finalizedTxIds, historyDate },
    });
  }

  // Soft-removes pending tx rows for this tab created at/after `since`,
  // marking them removed_reason: 'undone' instead of hard-deleting — the
  // row stays visible in Transaction Logs with an "Undone" status badge.
  // Used by both undoItemChange (fallback path) and undoSession.
  // Only touches rows that are still pending (finalized_at IS NULL AND
  // removed_at IS NULL) — a row already finalized or already removed must
  // never be re-marked, since its effect is either already committed or
  // already accounted for.
  async function deletePendingTxSince(isRaw, since, inventoryId) {
    let query = supabase
      .from(txTable(isRaw))
      .update({ removed_at: new Date().toISOString(), removed_reason: "undone" })
      .is("finalized_at", null)
      .is("removed_at", null)
      .gte("created_at", since);
    if (inventoryId) query = query.eq("inventory_id", inventoryId);
    const { error } = await query;
    if (error) throw error;
  }

  async function restoreSnapshot(undoType, whichTab) {
    const t     = whichTab ?? tabRef.current;
    const isRaw = t === "raw";
    const { data: logs } = await supabase
      .from("undo_log").select("*")
      .eq("tab", t).eq("undo_type", undoType)
      .order("created_at", { ascending: false }).limit(1);
    if (!logs || logs.length === 0) { alert("No undo snapshot found."); return false; }
    const log = logs[0];
    const rows = Array.isArray(log.snapshot) ? log.snapshot : (log.snapshot?.inventory ?? []);
    if (rows.length > 0) {
      const { error } = await supabase.from(invTable(isRaw)).upsert(rows, { onConflict: "id" });
      if (error) { alert("Restore failed: " + error.message); return false; }
    }
    await supabase.from("undo_log").delete().eq("id", log.id);
    return { ok: true, snapshot: log.snapshot };
  }

  // ─── boot ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const t = "finished";
    async function boot() {
      await resetDailyIfNeeded();
      await saveSnapshot("session", t);

      // Finalize is no longer triggered on page load — a 23:59 (Asia/Manila)
      // pg_cron job (auto_finalize_inventory_day) is now the sole trigger,
      // so the day stays open and editable until then regardless of when
      // anyone opens the app. Manual "Finalize day" button still works.

      await Promise.all([
        loadData(t, ""),
        checkUndoAvailability(t),
        checkFinalizedFor(t),
        warmPermissionCache(),
      ]);
      setBooted(true);
      if (isOnline()) prewarmOtherTab("raw");
    }
    boot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function prewarmOtherTab(whichTab) {
    const isRaw = whichTab === "raw";
    try {
      const [{ data: statics }, { data: invRows }, { data: txRows }] = await Promise.all([
        supabase.from(staticTbl(isRaw)).select("*"),
        supabase.from(invTable(isRaw)).select("*"),
        supabase.from(txTable(isRaw)).select("inventory_id, incoming_bal, outgoing_bal").is("finalized_at", null).is("removed_at", null),
      ]);
      const invMap   = {};
      (invRows  || []).forEach((i) => { invMap[i.id] = i; });
      const txTotals = {};
      (txRows   || []).forEach(({ inventory_id, incoming_bal, outgoing_bal }) => {
        if (!txTotals[inventory_id]) txTotals[inventory_id] = { incoming: 0, outgoing: 0 };
        txTotals[inventory_id].incoming += Number(incoming_bal ?? 0);
        txTotals[inventory_id].outgoing += Number(outgoing_bal ?? 0);
      });
      const merged = (statics || []).map((s) => {
        const inv = invMap[s.id];
        const tx  = txTotals[s.id] ?? { incoming: 0, outgoing: 0 };
        const beg_bal      = Number(inv?.beg_bal      ?? 0);
        const actual_bal   = Number(inv?.actual_bal   ?? 0);
        const loss         = Number(inv?.loss         ?? 0);
        const incoming_bal = Number(inv?.incoming_bal ?? 0) + tx.incoming;
        const outgoing_bal = Number(inv?.outgoing_bal ?? 0) + tx.outgoing;
        const current_bal  = beg_bal + incoming_bal - outgoing_bal;
        return { id: s.id, name: s.name, category_id: s.category_id, warehouse: s.warehouse,
          beg_bal, incoming_bal, outgoing_bal, current_bal, actual_bal, loss,
          _pendingIncoming: tx.incoming, _pendingOutgoing: tx.outgoing };
      });
      await saveInventorySnapshot(whichTab, merged);
    } catch (e) { console.error("[InventoryPage] prewarmOtherTab failed:", e); }
  }

  // ─── tab / date changes ───────────────────────────────────────────────────

  useEffect(() => {
    if (!booted) return;
    const t = tab, d = date;
    loadData(t, d);
    checkUndoAvailability(t);
    checkFinalizedFor(t);
    setManipulationError(null); // Clear error when tab/date changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, date, booted]);

  // ─── realtime ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const rawSub = supabase.channel("raw-tx-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "raw_materials_transaction_log" },
        () => { if (isRawNow() && dateNow() === "") loadData("raw", ""); })
      .subscribe();
    const finSub = supabase.channel("fin-tx-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "finished_products_transaction_log" },
        () => { if (!isRawNow() && dateNow() === "") loadData("finished", ""); })
      .subscribe();
    return () => { supabase.removeChannel(rawSub); supabase.removeChannel(finSub); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── back online ──────────────────────────────────────────────────────────

  useEffect(() => {
    function handleOnline() {
      const t = tabRef.current, d = dateRef.current;
      resetDailyIfNeeded().then(() => {
        loadData(t, d);
        checkUndoAvailability(t);
        checkFinalizedFor(t);
        warmPermissionCache();
      });
    }
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  // ─── undo item ────────────────────────────────────────────────────────────
  // Reverts the inventory balance change AND deletes the specific tx log
  // row(s) that this manipulation created (only if still pending — a
  // finalized row is untouchable since it's already baked into committed
  // history).
  //
  // Primary path: local stack (peekItemChange) — works online + offline.
  //   The stack entry now carries `since` + the item's inventory_id, so we
  //   can delete exactly the tx row(s) for that item created at/after that
  //   timestamp, scoped to this tab's tx table.
  // Fallback path: undo_log (online only) — same idea, using txInsertedId
  //   directly if present, otherwise falling back to the `since` cutoff.

  async function undoItemChange() {
    if (!confirm("Undo the last item change? This will also remove the related pending order/transaction.")) return;
    const t = tabRef.current, isRaw = t === "raw";
    setUndoing("item");

    const entry = await peekItemChange(t);

    if (entry) {
      try {
        for (const row of entry.rows) {
          await writeInventory(invTable(isRaw), row.id, sanitizeInventoryRow(row));
        }

        const snapKey     = isRaw ? "raw" : "finished";
        const cached      = await getInventorySnapshot(snapKey);
        const revertedIds = new Set(entry.rows.map((r) => r.id));
        const merged      = cached.map((item) => {
          if (!revertedIds.has(item.id)) return item;
          const s          = sanitizeInventoryRow(entry.rows.find((r) => r.id === item.id));
          const pendingIn  = Number(item._pendingIncoming ?? 0);
          const pendingOut = Number(item._pendingOutgoing ?? 0);
          const incoming_bal = s.incoming_bal + pendingIn;
          const outgoing_bal = s.outgoing_bal + pendingOut;
          const current_bal  = s.beg_bal + incoming_bal - outgoing_bal;
          return { ...item, beg_bal: s.beg_bal, incoming_bal, outgoing_bal, current_bal,
            actual_bal: s.actual_bal, loss: s.loss, _pendingIncoming: pendingIn, _pendingOutgoing: pendingOut };
        });
        await saveInventorySnapshot(snapKey, merged);
        setItems(merged);

        // Delete the tx row(s) created by this specific manipulation —
        // only if online (tx log lives in Supabase, not local storage).
        // Scoped to: this tab's tx table, the reverted item(s)' inventory_id,
        // created at/after entry.since, and still pending.
        if (isOnline() && entry.since) {
          for (const itemId of revertedIds) {
            try {
              await deletePendingTxSince(isRaw, entry.since, itemId);
            } catch (e) {
              console.error("[undoItemChange] failed to delete tx row for", itemId, e.message);
            }
          }
        }

        await popItemChange(t, entry.id);

        if (isOnline()) {
          const { data: lg } = await supabase.from("undo_log").select("id")
            .eq("tab", t).eq("undo_type", "item_change")
            .order("created_at", { ascending: false }).limit(1);
          if (lg?.length) await supabase.from("undo_log").delete().eq("id", lg[0].id);
        }
      } catch (e) { alert("Undo failed: " + e.message); }

      setUndoing(null);
      await checkUndoAvailability(t);
      if (isOnline()) { await checkFinalizedFor(t); await loadData(t, dateRef.current); }
      return;
    }

    // ── fallback: undo_log ────────────────────────────────────────────────
    if (!isOnline()) { alert("No undo snapshot found."); setUndoing(null); return; }

    const { data: logs } = await supabase.from("undo_log").select("*")
      .eq("tab", t).eq("undo_type", "item_change")
      .order("created_at", { ascending: false }).limit(1);
    if (!logs?.length) { alert("No undo snapshot found."); setUndoing(null); return; }

    const log  = logs[0];
    const rows = Array.isArray(log.snapshot) ? log.snapshot : (log.snapshot?.inventory ?? []);
    if (rows.length) {
      const { error } = await supabase.from(invTable(isRaw)).upsert(rows, { onConflict: "id" });
      if (error) { alert("Restore failed: " + error.message); setUndoing(null); return; }
    }

    // Prefer the exact inserted tx row id if we have it (most precise).
    // Otherwise fall back to soft-removing any pending tx row created
    // at/after the snapshot's `since` timestamp.
    const txId = log.snapshot?.txInsertedId;
    const since = log.snapshot?.since;
    if (txId) {
      await supabase.from(txTable(isRaw))
        .update({ removed_at: new Date().toISOString(), removed_reason: "undone" })
        .eq("id", txId)
        .is("finalized_at", null)
        .is("removed_at", null);
    } else if (since) {
      try { await deletePendingTxSince(isRaw, since); }
      catch (e) { console.error("[undoItemChange fallback] tx delete failed:", e.message); }
    }

    await supabase.from("undo_log").delete().eq("id", log.id);

    setUndoing(null);
    await loadData(t, dateRef.current);
    await checkUndoAvailability(t);
    await checkFinalizedFor(t);
  }

  // ─── undo session ─────────────────────────────────────────────────────────
  // Reverts inventory to the session-start snapshot AND deletes every
  // pending tx row (any transaction_source — ordered or manipulated) for
  // this tab created at/after the session snapshot's `since` timestamp.
  // Finalized rows are never touched.

  async function undoSession() {
    if (!confirm("Undo all changes made this session? This will also remove every pending order/transaction created this session.")) return;
    const t = tabRef.current, isRaw = t === "raw";
    setUndoing("session");

    const result = await restoreSnapshot("session", t);
    if (!result?.ok) { setUndoing(null); return; }

    const since = result.snapshot?.since;
    if (since) {
      try {
        await deletePendingTxSince(isRaw, since); // no inventoryId filter — whole tab
      } catch (e) {
        alert("Inventory restored but failed to remove this session's pending orders: " + e.message);
      }
    }

    await clearItemChangeHistory(t);
    await loadData(t, dateRef.current);
    await checkUndoAvailability(t);
    await checkFinalizedFor(t);
  }

  // ─── undo close day ───────────────────────────────────────────────────────

  async function undoCloseDay() {
    if (!confirm("Undo the last Finalize? Balances will be restored and today's orders will become pending again.")) return;
    const t = tabRef.current, isRaw = t === "raw";
    setUndoing("close_day");

    const result = await restoreSnapshot("close_day", t);
    if (!result?.ok) { setUndoing(null); return; }

    const { finalizedTxIds = [], historyDate } = result.snapshot ?? {};
    const dateToDelete = historyDate || todayLocal();

    if (finalizedTxIds.length) {
      const { error } = await supabase.from(txTable(isRaw))
        .update({ finalized_at: null }).in("id", finalizedTxIds);
      if (error) { alert("Inventory restored but failed to un-finalize orders: " + error.message); setUndoing(null); return; }
    }

    const { error: hErr } = await supabase.from(histTable(isRaw))
      .delete().eq("inventory_date", dateToDelete);
    if (hErr) alert("Undo completed but failed to clear history: " + hErr.message);

    setUndoing(null);
    await clearItemChangeHistory(t);
    await Promise.all([
      loadData(t, ""),
      checkUndoAvailability(t),
      checkFinalizedFor(t),
    ]);
    if (dateRef.current !== "") setDate("");
  }

  // ─── finalize day ─────────────────────────────────────────────────────────

  // ─── runFinalize ──────────────────────────────────────────────────────────
  // Core finalize logic, used by both the manual button (silent=false, shows
  // confirms and alerts) and the auto-finalize on boot (silent=true, runs
  // without any user prompts).
  //
  // Roll-forward rule: next day's beg_bal = today's actual_bal.
  // This reflects the physically counted balance, not the computed one —
  // if someone counted 80 units but current said 90, the next day starts at 80.

  async function runFinalize(isRaw, t, { silent = false } = {}) {
    if (!isOnline()) {
      if (!silent) alert("Finalize requires an internet connection.");
      return false;
    }
    const today = todayLocal();

    // Skip if already finalized today
    const { data: existing } = await supabase.from(histTable(isRaw)).select("id")
      .eq("inventory_date", today).limit(1);
    if (existing?.length) {
      if (!silent) { alert("Today has already been finalized."); setAlreadyFinalized(true); }
      else setAlreadyFinalized(true);
      return false;
    }

    // Confirm prompt — skipped in silent/auto mode
    if (!silent) {
      const { data: pending } = await supabase.from(txTable(isRaw))
        .select("id").is("finalized_at", null).is("removed_at", null).limit(1);
      const confirmed = (pending?.length)
        ? confirm("Finalize today's data and roll balances forward?")
        : confirm("⚠️ No pending orders found for today.\n\nFinalizing now will roll the balance forward with no new movement.\n\nContinue anyway?");
      if (!confirmed) return false;
    }

    try {
      // CRITICAL: exclude removed rows — deleted/undone orders must never
      // be folded into committed balances.
      const { data: txRows, error: e1 } = await supabase
        .from(txTable(isRaw))
        .select("id, inventory_id, incoming_bal, outgoing_bal")
        .is("finalized_at", null)
        .is("removed_at", null);
      if (e1) throw e1;

      const { data: allInv, error: e2 } = await supabase.from(invTable(isRaw)).select("*");
      if (e2) throw e2;

      const finalizedTxIds = (txRows || []).map((r) => r.id);
      await saveCloseDaySnapshot(isRaw, t, finalizedTxIds, today);

      // Sum pending tx per inventory_id
      const totals = {};
      (txRows || []).forEach(({ inventory_id, incoming_bal, outgoing_bal }) => {
        if (!totals[inventory_id]) totals[inventory_id] = { incoming: 0, outgoing: 0 };
        totals[inventory_id].incoming += Number(incoming_bal ?? 0);
        totals[inventory_id].outgoing += Number(outgoing_bal ?? 0);
      });

      // Compute today's final values for every inventory row
      const finalRows = (allInv || []).map((row) => {
        const tt = totals[row.id];
        if (!tt) return row;
        const incoming_bal = Number(row.incoming_bal ?? 0) + tt.incoming;
        const outgoing_bal = Number(row.outgoing_bal ?? 0) + tt.outgoing;
        const current_bal  = Number(row.beg_bal      ?? 0) + incoming_bal - outgoing_bal;
        const actual_bal   = Number(row.actual_bal   ?? current_bal);
        const loss         = Math.max(0, current_bal - actual_bal);
        return { ...row, incoming_bal, outgoing_bal, current_bal, actual_bal, loss };
      });

      // Write today's final values to the live inventory table
      const { error: e3 } = await supabase.from(invTable(isRaw)).upsert(finalRows, { onConflict: "id" });
      if (e3) throw e3;

      // Snapshot today into history — upsert so a partial or repeated
      // finalize (e.g. auto-finalize finding a row already written by a
      // manual finalize earlier today) updates in place instead of throwing
      // a duplicate-key error on the unique (inventory_id, inventory_date) constraint.
      const histRows = finalRows.map((row) => ({
        inventory_id: row.id, inventory_date: today, name: row.name,
        beg_bal: row.beg_bal, incoming_bal: row.incoming_bal, outgoing_bal: row.outgoing_bal,
        current_bal: row.current_bal, actual_bal: row.actual_bal, loss: row.loss,
      }));
      const { error: e4 } = await supabase.from(histTable(isRaw))
        .upsert(histRows, { onConflict: "inventory_id, inventory_date" });
      if (e4) throw e4;

      // Mark tx rows as finalized so they stop appearing as pending
      if (finalizedTxIds.length) {
        const { error: e5 } = await supabase.from(txTable(isRaw))
          .update({ finalized_at: new Date().toISOString() }).in("id", finalizedTxIds);
        if (e5) throw e5;
      }

      // Roll forward: next day starts with beg_bal = today's actual_bal
      // (the physically counted amount, not the computed current_bal).
      // incoming/outgoing reset to 0 — new day, clean movement slate.
      const rolled = finalRows.map((row) => ({
        id:           row.id,
        name:         row.name,
        beg_bal:      row.actual_bal,   // ← actual count, not computed current
        incoming_bal: 0,
        outgoing_bal: 0,
        current_bal:  row.actual_bal,   // current = beg until new orders arrive
        actual_bal:   row.actual_bal,
        loss:         row.loss,
      }));
      const { error: e6 } = await supabase.from(invTable(isRaw)).upsert(rolled, { onConflict: "id" });
      if (e6) throw e6;

      setAlreadyFinalized(true);
      return true;
    } catch (e) {
      if (!silent) alert("Failed to finalize: " + e.message);
      else console.error("[runFinalize] auto-finalize failed:", e.message);
      return false;
    }
  }

  // ─── Manual finalize button ───────────────────────────────────────────────

  async function finalizeDay() {
    const t = tabRef.current, isRaw = t === "raw";
    setFinalizing(true);
    const ok = await runFinalize(isRaw, t, { silent: false });
    setFinalizing(false);
    if (ok) {
      await checkFinalizedFor(t);
      await loadData(t, "");
      await checkUndoAvailability(t);
      alert("Finalized. Balances rolled forward. Tomorrow's beginning balance = today's actual count.");
    } else {
      await checkFinalizedFor(t);
    }
  }

  // ─── manipulation ─────────────────────────────────────────────────────────
  // updateFn returns the tx log row id (or null if offline/failed).

  function requestManipulationUpdate(updateFn) {
    // ─── FINALIZATION SAFETY CHECK ───
    if (alreadyFinalized) {
      setManipulationError("⚠️ Today is finalized. You cannot edit inventory balances. Please undo the finalize or wait until tomorrow.");
      return;
    }

    const t = tabRef.current;
    (async () => {
      const since = await saveSnapshot("item_change", t);
      const insertedTxId = await updateFn();

      // Attach insertedTxId AND since to the undo_log row so the fallback
      // undo path can use the exact id (preferred) or the cutoff (backup).
      if (isOnline()) {
        const { data: lg } = await supabase.from("undo_log").select("id, snapshot")
          .eq("tab", t).eq("undo_type", "item_change")
          .order("created_at", { ascending: false }).limit(1);
        if (lg?.length) {
          const prevSnapshot = lg[0].snapshot;
          const inventoryPart = Array.isArray(prevSnapshot) ? prevSnapshot : prevSnapshot?.inventory;
          await supabase.from("undo_log")
            .update({ snapshot: { inventory: inventoryPart, since, txInsertedId: insertedTxId ?? null } })
            .eq("id", lg[0].id);
        }
      }

      // Also attach `since` + txInsertedId to the local stack entry so the
      // primary undo path (peekItemChange) has what it needs even offline.
      // pushItemChange already stored `since`; nothing further needed there
      // since undoItemChange deletes by item_id + since, not by exact txId,
      // for the local-stack path.

      if (insertedTxId !== null && isOnline()) {
        await loadData(t, dateRef.current);
      }

      await checkUndoAvailability(t);
    })();
  }

  // ─── Handle item selection with finalization check ──────────────────────

  function handleSelectItem(item) {
    if (alreadyFinalized && date === "") {
      setManipulationError("🔒 Today is finalized. You cannot edit inventory balances. Please undo the finalize or wait until tomorrow.");
      return;
    }
    setManipulationError(null);
    setActiveItem(item);
  }

  const applyLocalPatch = useCallback((itemId, patch) => {
    setItems((prev) => prev.map((it) => it.id === itemId ? { ...it, ...patch } : it));
  }, []);

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">

      <div className="mb-5">
        <InventoryHeader items={items} date={date} />
      </div>

      {usingOffline && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          Showing locally saved data — you're offline. Changes will sync when wifi returns.
        </div>
      )}

      {/* ─── FINALIZATION LOCK BANNER ─── */}
      {alreadyFinalized && date === "" && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="text-lg">🔒</span>
            <div>
              <p className="font-semibold">Today is finalized — Inventory is locked</p>
              <p className="text-xs mt-1 text-red-700">
                You cannot edit inventory balances for today. Go to the Undo section below to <strong>↩ Finalize</strong> if you need to make changes, or wait until tomorrow.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── MANIPULATION ERROR MESSAGE ─── */}
      {manipulationError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {manipulationError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">

        <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
          <button onClick={() => setTab("finished")}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "finished" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            Finished
          </button>
          <button onClick={() => setTab("raw")}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${tab === "raw" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            Raw
          </button>
        </div>

        <InventoryCalendar tab={tab} date={date} onSelectDate={setDate} />

        {date === "" && (
          alreadyFinalized ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-50 text-green-700 border border-green-200 text-sm font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              Finalized today
            </span>
          ) : (
            <button onClick={finalizeDay} disabled={finalizing}
              className="px-4 py-1.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
              {finalizing ? "Finalizing…" : "Finalize day"}
            </button>
          )
        )}

        <div className="w-px h-6 bg-gray-200 mx-0.5" />

        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400 mr-1 font-medium uppercase tracking-wide">Undo</span>

          <button onClick={undoItemChange} disabled={!canUndoItem || undoing === "item"}
            title="Undo last item change and remove its pending transaction"
            className="px-3 py-1.5 rounded-md text-sm text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {undoing === "item" ? "…" : "↩ Item"}
          </button>

          <button onClick={undoSession} disabled={!canUndoSession || undoing === "session"}
            title="Undo all changes this session and remove this session's pending transactions"
            className="px-3 py-1.5 rounded-md text-sm text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {undoing === "session" ? "…" : "↩ Session"}
          </button>

          <button onClick={undoCloseDay} disabled={!canUndoCloseDay || undoing === "close_day"}
            title="Undo last finalize"
            className="px-3 py-1.5 rounded-md text-sm text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {undoing === "close_day" ? "…" : "↩ Finalize"}
          </button>
        </div>
      </div>

      <div className="mb-4">
        <InventorySummary tab={tab} />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <InventoryTable 
          items={items} 
          loading={loading} 
          onSelect={handleSelectItem}
          isFinalized={alreadyFinalized && date === ""}
        />
      </div>

      {activeItem && (
        <ManipulatePanel
          item={activeItem}
          tab={tab}
          onClose={() => setActiveItem(null)}
          onUpdated={(fn) => requestManipulationUpdate(fn)}
          onLocalPatch={applyLocalPatch}
          isFinalized={alreadyFinalized && date === ""}
        />
      )}
    </div>
  );
}