"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabaseClient";
import InventoryHeader from "./components/InventoryHeader";
import InventoryTable from "./components/InventoryTable";
import ManipulatePanel from "./components/ManipulationPanel";
import InventoryCalendar from "./components/InventoryCalendar";
import InventorySummary from "./components/InventorySummary";

function txTable(isRaw)   { return isRaw ? "raw_materials_transaction_log"      : "finished_products_transaction_log"; }
function invTable(isRaw)  { return isRaw ? "raw_materials_inventory"             : "finished_products_inventory"; }
function histTable(isRaw) { return isRaw ? "raw_materials_inventory_history"     : "finished_products_inventory_history"; }
function staticTbl(isRaw) { return isRaw ? "raw_materials_static"               : "finished_products_static"; }

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function InventoryPage() {
  const supabase = createClient();

  const [tab,  setTab]  = useState("finished");
  const [date, setDate] = useState("");

  const [items,             setItems]             = useState([]);
  const [loading,           setLoading]           = useState(false);
  const [finalizing,        setFinalizing]        = useState(false);
  const [alreadyFinalized,  setAlreadyFinalized]  = useState(false);
  const [undoing,           setUndoing]           = useState(null);
  const [canUndoItem,       setCanUndoItem]       = useState(false);
  const [canUndoSession,    setCanUndoSession]    = useState(false);
  const [canUndoCloseDay,   setCanUndoCloseDay]   = useState(false);
  const [activeItem,        setActiveItem]        = useState(null);
  const [booted,            setBooted]            = useState(false);

  // ── Refs: always hold the latest committed value ──────────────────────────
  // Never read tab/date from closure — always read from ref.
  const tabRef  = useRef("finished");
  const dateRef = useRef("");

  // Keep refs in sync — these run synchronously before the next render paint
  tabRef.current  = tab;
  dateRef.current = date;

  // ── Core helpers (always read from ref, never closure) ────────────────────

  function isRawNow()  { return tabRef.current === "raw"; }
  function dateNow()   { return dateRef.current; }

  // ── checkFinalizedFor — always pass tab explicitly, never rely on ref/state
  // This is the single source of truth for the finalize button.

  async function checkFinalizedFor(whichTab) {
    const isRaw = whichTab === "raw";
    const today = todayLocal();
    const { data, error } = await supabase
      .from(histTable(isRaw))
      .select("id")
      .eq("inventory_date", today)
      .limit(1);
    if (error) {
      console.error("checkFinalizedFor error:", error.message);
      return;
    }
    setAlreadyFinalized(!!(data && data.length > 0));
  }

  // ── Undo availability ─────────────────────────────────────────────────────

  async function checkUndoAvailability(whichTab) {
    const t = whichTab ?? tabRef.current;
    const [itemRes, sessionRes, closeDayRes] = await Promise.all([
      supabase.from("undo_log").select("id").eq("tab", t).eq("undo_type", "item_change").order("created_at", { ascending: false }).limit(1),
      supabase.from("undo_log").select("id").eq("tab", t).eq("undo_type", "session")    .order("created_at", { ascending: false }).limit(1),
      supabase.from("undo_log").select("id").eq("tab", t).eq("undo_type", "close_day")  .order("created_at", { ascending: false }).limit(1),
    ]);
    setCanUndoItem    ((itemRes.data     || []).length > 0);
    setCanUndoSession ((sessionRes.data  || []).length > 0);
    setCanUndoCloseDay((closeDayRes.data || []).length > 0);
  }

  // ── Load data — always pass tab/date explicitly so there's no stale closure

  async function loadData(whichTab, whichDate) {
    const isRaw     = (whichTab  ?? tabRef.current)  === "raw";
    const chosenDate = whichDate ?? dateRef.current;
    const isHistory  = chosenDate !== "";

    setLoading(true);

    const { data: staticItems } = await supabase.from(staticTbl(isRaw)).select("*");

    let query = supabase.from(isHistory ? histTable(isRaw) : invTable(isRaw)).select("*");
    if (isHistory) query = query.eq("inventory_date", chosenDate);
    const { data: inventoryItems } = await query;

    const invMap = {};
    (inventoryItems || []).forEach((i) => {
      invMap[isHistory ? i.inventory_id : i.id] = i;
    });

    const txTotals = {};
    if (!isHistory) {
      const { data: txRows } = await supabase
        .from(txTable(isRaw))
        .select("inventory_id, incoming_bal, outgoing_bal")
        .is("finalized_at", null);
      (txRows || []).forEach(({ inventory_id, incoming_bal, outgoing_bal }) => {
        if (!txTotals[inventory_id]) txTotals[inventory_id] = { incoming: 0, outgoing: 0 };
        txTotals[inventory_id].incoming += Number(incoming_bal ?? 0);
        txTotals[inventory_id].outgoing += Number(outgoing_bal ?? 0);
      });
    }

    const merged = (staticItems || []).map((s) => {
      const inv = invMap[s.id];
      const tx  = txTotals[s.id] ?? { incoming: 0, outgoing: 0 };

      const beg_bal      = Number(inv?.beg_bal      ?? 0);
      const actual_bal   = Number(inv?.actual_bal   ?? 0);
      const loss         = Number(inv?.loss         ?? 0);
      const incoming_bal = Number(inv?.incoming_bal ?? 0) + tx.incoming;
      const outgoing_bal = Number(inv?.outgoing_bal ?? 0) + tx.outgoing;
      const current_bal  = beg_bal + incoming_bal - outgoing_bal;

      return {
        id: s.id, name: s.name, category_id: s.category_id,
        beg_bal, incoming_bal, outgoing_bal, current_bal, actual_bal, loss,
        _pendingIncoming: tx.incoming,
        _pendingOutgoing: tx.outgoing,
      };
    });

    setItems(merged);
    setLoading(false);
  }

  // ── Snapshots ─────────────────────────────────────────────────────────────

  async function saveSnapshot(undoType, whichTab) {
    const isRaw = (whichTab ?? tabRef.current) === "raw";
    const t     = whichTab ?? tabRef.current;
    const { data: currentRows } = await supabase.from(invTable(isRaw)).select("*");
    await supabase.from("undo_log").insert({
      undo_type: undoType,
      tab: t,
      snapshot: currentRows || [],
    });
  }

  async function saveCloseDaySnapshot(isRaw, whichTab, finalizedTxIds, historyDate) {
    const { data: currentRows } = await supabase.from(invTable(isRaw)).select("*");
    await supabase.from("undo_log").insert({
      undo_type: "close_day",
      tab: whichTab,
      snapshot: {
        inventory: currentRows || [],
        finalizedTxIds,
        historyDate,
      },
    });
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

    // Snapshot shapes by undo_type:
    //  - close_day:    { inventory, finalizedTxIds, historyDate }
    //  - item_change:  { inventory, txInsertedId } (new) — or a flat array
    //                  (snapshots saved before this tx-tracking was added)
    //  - session:      flat array (boot-time snapshot, never tx-tracked)
    const inventoryRows = Array.isArray(log.snapshot)
      ? log.snapshot
      : (log.snapshot?.inventory ?? []);

    if (inventoryRows.length > 0) {
      const { error } = await supabase
        .from(invTable(isRaw))
        .upsert(inventoryRows, { onConflict: "id" });
      if (error) { alert("Restore failed: " + error.message); return false; }
    }

    // If this item_change undo created a transaction log row as a side
    // effect (a manual +IN/-OUT adjustment from ManipulatePanel), remove it
    // too — otherwise it lingers as a ghost entry in Transaction Logs after
    // the balance change it represents has been reverted.
    const txInsertedId = undoType === "item_change" ? log.snapshot?.txInsertedId : null;
    if (txInsertedId) {
      const { error: txDeleteError } = await supabase
        .from(txTable(isRaw))
        .delete()
        .eq("id", txInsertedId);
      if (txDeleteError) {
        alert("Inventory restored, but failed to remove the related transaction log entry: " + txDeleteError.message);
      }
    }

    // Delete log AFTER reading everything needed
    await supabase.from("undo_log").delete().eq("id", log.id);

    return { ok: true, snapshot: log.snapshot };
  }

  // ── Boot — runs exactly once ───────────────────────────────────────────────
  // We capture the initial tab value in a local variable so nothing depends
  // on ref or state timing.

  useEffect(() => {
    const initialTab = "finished"; // matches useState default
    async function boot() {
      await saveSnapshot("session", initialTab);
      await Promise.all([
        loadData(initialTab, ""),
        checkUndoAvailability(initialTab),
        checkFinalizedFor(initialTab),
      ]);
      setBooted(true);
    }
    boot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── React to tab / date changes (skip the very first render = boot) ────────

  useEffect(() => {
    if (!booted) return;
    // Capture current values into locals — they are the new committed values
    // because React batches state updates and this effect fires after commit.
    const t = tab;
    const d = date;
    loadData(t, d);
    checkUndoAvailability(t);
    checkFinalizedFor(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, date, booted]);

  // ── Realtime subscriptions ────────────────────────────────────────────────

  useEffect(() => {
    const rawSub = supabase
      .channel("raw-tx-live")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "raw_materials_transaction_log" },
        () => { if (isRawNow() && dateNow() === "") loadData("raw", ""); }
      ).subscribe();

    const finSub = supabase
      .channel("fin-tx-live")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "finished_products_transaction_log" },
        () => { if (!isRawNow() && dateNow() === "") loadData("finished", ""); }
      ).subscribe();

    return () => {
      supabase.removeChannel(rawSub);
      supabase.removeChannel(finSub);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Undo actions ──────────────────────────────────────────────────────────

  async function undoItemChange() {
    if (!confirm("Undo the last item change?")) return;
    const t = tabRef.current;
    setUndoing("item");
    const result = await restoreSnapshot("item_change", t);
    setUndoing(null);
    if (!result?.ok) return;
    await loadData(t, dateRef.current);
    await checkUndoAvailability(t);
    await checkFinalizedFor(t);
  }

  async function undoSession() {
    if (!confirm("Undo all changes made this session?")) return;
    const t = tabRef.current;
    setUndoing("session");
    const result = await restoreSnapshot("session", t);
    setUndoing(null);
    if (!result?.ok) return;
    await loadData(t, dateRef.current);
    await checkUndoAvailability(t);
    await checkFinalizedFor(t);
  }

  async function undoCloseDay() {
    if (!confirm("Undo the last Finalize? Balances will be restored and today's orders will become pending again.")) return;

    // Capture tab NOW before any async — so all operations below use same tab
    const t     = tabRef.current;
    const isRaw = t === "raw";

    setUndoing("close_day");

    const result = await restoreSnapshot("close_day", t);
    if (!result?.ok) { setUndoing(null); return; }

    const { finalizedTxIds = [], historyDate } = result.snapshot ?? {};
    const dateToDelete = historyDate || todayLocal();

    // Un-mark tx rows → pending again
    if (finalizedTxIds.length > 0) {
      const { error: unfinalizeError } = await supabase
        .from(txTable(isRaw))
        .update({ finalized_at: null })
        .in("id", finalizedTxIds);
      if (unfinalizeError) {
        alert("Inventory restored but failed to un-finalize orders: " + unfinalizeError.message);
        setUndoing(null);
        return;
      }
    }

    // Delete the history rows for that exact date
    const { error: histError } = await supabase
      .from(histTable(isRaw))
      .delete()
      .eq("inventory_date", dateToDelete);
    if (histError) {
      alert("Undo completed but failed to clear history: " + histError.message);
    }

    setUndoing(null);

    // Reload everything — INCLUDING checkFinalizedFor with explicit tab
    // Now that history rows are deleted, this will correctly return false
    await Promise.all([
      loadData(t, ""),
      checkUndoAvailability(t),
      checkFinalizedFor(t),       // ← always re-query after delete, don't shortcut
    ]);

    // Reset date to live view if user was on a history snapshot
    if (dateRef.current !== "") setDate("");
  }

  // ── Finalize day ──────────────────────────────────────────────────────────

  async function finalizeDay() {
    const t     = tabRef.current;
    const isRaw = t === "raw";
    const today = todayLocal();

    // Guard: already finalized?
    const { data: existingHistory } = await supabase
      .from(histTable(isRaw))
      .select("id")
      .eq("inventory_date", today)
      .limit(1);
    if (existingHistory && existingHistory.length > 0) {
      alert("Today has already been finalized.");
      setAlreadyFinalized(true);
      return;
    }

    const { data: pendingRows, error: checkError } = await supabase
      .from(txTable(isRaw)).select("id").is("finalized_at", null).limit(1);
    if (checkError) { alert("Could not check pending orders: " + checkError.message); return; }

    const hasPending = pendingRows && pendingRows.length > 0;
    const confirmed  = hasPending
      ? confirm("Finalize today's data and roll balances forward?")
      : confirm(
          "⚠️ No pending orders found for today.\n\n" +
          "Finalizing now will roll the balance forward with no new movement.\n\n" +
          "Continue anyway?"
        );
    if (!confirmed) return;

    setFinalizing(true);

    try {
      // 1. Fetch all pending tx rows
      const { data: txRows, error: txFetchError } = await supabase
        .from(txTable(isRaw))
        .select("id, inventory_id, incoming_bal, outgoing_bal")
        .is("finalized_at", null);
      if (txFetchError) throw txFetchError;

      const finalizedTxIds = (txRows || []).map((r) => r.id);

      // 2. Fetch full inventory BEFORE mutations
      const { data: allInvRows, error: allInvError } = await supabase
        .from(invTable(isRaw)).select("*");
      if (allInvError) throw allInvError;

      // 3. Save close_day snapshot BEFORE any writes
      await saveCloseDaySnapshot(isRaw, t, finalizedTxIds, today);

      // 4. Compute updated balances
      const totals = {};
      (txRows || []).forEach(({ inventory_id, incoming_bal, outgoing_bal }) => {
        if (!totals[inventory_id]) totals[inventory_id] = { incoming: 0, outgoing: 0 };
        totals[inventory_id].incoming += Number(incoming_bal ?? 0);
        totals[inventory_id].outgoing += Number(outgoing_bal ?? 0);
      });

      const finalInvRows = (allInvRows || []).map((row) => {
        const t = totals[row.id];
        if (!t) return row;
        const incoming_bal = Number(row.incoming_bal ?? 0) + t.incoming;
        const outgoing_bal = Number(row.outgoing_bal ?? 0) + t.outgoing;
        const current_bal  = Number(row.beg_bal      ?? 0) + incoming_bal - outgoing_bal;
        const actual_bal   = Number(row.actual_bal   ?? current_bal);
        const loss         = Math.max(0, current_bal - actual_bal);
        return { ...row, incoming_bal, outgoing_bal, current_bal, actual_bal, loss };
      });

      // 5. Write updated balances
      if (finalInvRows.length > 0) {
        const { error: upsertError } = await supabase
          .from(invTable(isRaw)).upsert(finalInvRows, { onConflict: "id" });
        if (upsertError) throw upsertError;
      }

      // 6. Write history rows — INSERT only, never upsert
      //    If this throws (duplicate), the finalize is rejected cleanly
      const historyRows = finalInvRows.map((row) => ({
        inventory_id:   row.id,
        inventory_date: today,
        name:           row.name,
        beg_bal:        row.beg_bal,
        incoming_bal:   row.incoming_bal,
        outgoing_bal:   row.outgoing_bal,
        current_bal:    row.current_bal,
        actual_bal:     row.actual_bal,
        loss:           row.loss,
      }));
      const { error: histError } = await supabase
        .from(histTable(isRaw))
        .insert(historyRows);
      if (histError) throw histError;

      // 7. Mark tx rows as finalized
      if (finalizedTxIds.length > 0) {
        const { error: markError } = await supabase
          .from(txTable(isRaw))
          .update({ finalized_at: new Date().toISOString() })
          .in("id", finalizedTxIds);
        if (markError) throw markError;
      }

      // 8. Roll beg_bal forward for next day
      const rolledRows = finalInvRows.map((row) => ({
        id:           row.id,
        name:         row.name,
        beg_bal:      row.current_bal,
        incoming_bal: 0,
        outgoing_bal: 0,
        current_bal:  row.current_bal,
        actual_bal:   row.actual_bal,
        loss:         row.loss,
      }));
      const { error: rollError } = await supabase
        .from(invTable(isRaw)).upsert(rolledRows, { onConflict: "id" });
      if (rollError) throw rollError;

      // 9. Re-query to confirm — never trust optimistic state
      await checkFinalizedFor(t);
      await loadData(t, "");
      await checkUndoAvailability(t);

      alert("Finalized. Balances rolled forward and history saved.");
    } catch (e) {
      alert("Failed to finalize: " + e.message);
      // Re-check in case partial writes occurred
      await checkFinalizedFor(t);
    } finally {
      setFinalizing(false);
    }
  }

  // ── Manipulation ──────────────────────────────────────────────────────────
  // updateFn (from ManipulatePanel) may return the id of a transaction log
  // row it inserted as a side effect (e.g. a manual +IN/-OUT adjustment).
  // When present, we attach it to the item_change undo entry we just saved,
  // so "Undo Item" can delete that tx row too — not just revert balances.

  function requestManipulationUpdate(updateFn) {
    const t = tabRef.current;
    (async () => {
      await saveSnapshot("item_change", t);
      const insertedTxId = await updateFn();

      if (insertedTxId) {
        const { data: latestLog } = await supabase
          .from("undo_log")
          .select("id, snapshot")
          .eq("tab", t).eq("undo_type", "item_change")
          .order("created_at", { ascending: false })
          .limit(1);

        if (latestLog && latestLog.length > 0) {
          const log = latestLog[0];
          await supabase
            .from("undo_log")
            .update({ snapshot: { inventory: log.snapshot, txInsertedId: insertedTxId } })
            .eq("id", log.id);
        }
      }

      await loadData(t, dateRef.current);
      await checkUndoAvailability(t);
    })();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">

      <div className="mb-5">
        <InventoryHeader items={items} date={date} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">

        <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
          <button
            onClick={() => setTab("finished")}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === "finished" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Finished
          </button>
          <button
            onClick={() => setTab("raw")}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${
              tab === "raw" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
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
            <button
              onClick={finalizeDay}
              disabled={finalizing}
              className="px-4 py-1.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {finalizing ? "Finalizing…" : "Finalize day"}
            </button>
          )
        )}

        <div className="w-px h-6 bg-gray-200 mx-0.5" />

        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400 mr-1 font-medium uppercase tracking-wide">Undo</span>

          <button
            onClick={undoItemChange}
            disabled={!canUndoItem || undoing === "item"}
            title="Undo last item change"
            className="px-3 py-1.5 rounded-md text-sm text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {undoing === "item" ? "…" : "↩ Item"}
          </button>

          <button
            onClick={undoSession}
            disabled={!canUndoSession || undoing === "session"}
            title="Undo all changes this session"
            className="px-3 py-1.5 rounded-md text-sm text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {undoing === "session" ? "…" : "↩ Session"}
          </button>

          <button
            onClick={undoCloseDay}
            disabled={!canUndoCloseDay || undoing === "close_day"}
            title="Undo last finalize"
            className="px-3 py-1.5 rounded-md text-sm text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {undoing === "close_day" ? "…" : "↩ Finalize"}
          </button>
        </div>
      </div>

      <div className="mb-4">
        <InventorySummary tab={tab} />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <InventoryTable items={items} loading={loading} onSelect={setActiveItem} />
      </div>

      {activeItem && (
        <ManipulatePanel
          item={activeItem}
          tab={tab}
          onClose={() => setActiveItem(null)}
          onUpdated={(updateFn) => requestManipulationUpdate(updateFn)}
        />
      )}
    </div>
  );
}