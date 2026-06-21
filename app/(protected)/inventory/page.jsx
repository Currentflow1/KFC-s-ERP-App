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

  const tabRef  = useRef("finished");
  const dateRef = useRef("");
  tabRef.current  = tab;
  dateRef.current = date;

  function isRawNow() { return tabRef.current === "raw"; }
  function dateNow()  { return dateRef.current; }

  async function checkFinalizedFor(whichTab) {
    if (!isOnline()) return;
    const isRaw = whichTab === "raw";
    const { data, error } = await supabase
      .from(histTable(isRaw)).select("id")
      .eq("inventory_date", todayLocal()).limit(1);
    if (error) { console.error("checkFinalizedFor:", error.message); return; }
    setAlreadyFinalized(!!(data && data.length > 0));
  }

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
        return { id: s.id, name: s.name, category_id: s.category_id,
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
      await pushItemChange(t, before, since);
      if (isOnline()) {
        await supabase.from("undo_log").insert({
          undo_type: undoType, tab: t,
          snapshot: { inventory: before, since },
        });
      }
      return since;
    }

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

  // Soft-removes tx rows created at/after `since`, marking removed_reason:
  // 'undone' instead of hard-deleting.
  //
  // IMPORTANT — finalized_at means two DIFFERENT things depending on
  // transaction_source:
  //   - "ordered" rows:     finalized_at is NULL until a real Finalize Day
  //                         rollover commits them. Once set, genuinely
  //                         locked-in history — never touch.
  //   - "manipulated" rows: finalized_at is set IMMEDIATELY at creation by
  //                         ManipulatePanel's buildTxPayload. It does NOT
  //                         mean "went through Finalize Day". These rows
  //                         must remain undoable even though finalized_at
  //                         is non-null, otherwise "Undo Item" silently
  //                         matches zero rows for every manipulation.
  //
  // So: only require finalized_at IS NULL for "ordered" rows; skip that
  // check for "manipulated" rows. removed_at IS NULL is still required
  // for both — an already-undone/deleted row is never re-marked.
  async function deletePendingTxSince(isRaw, since, inventoryId) {
    let orderedQuery = supabase
      .from(txTable(isRaw))
      .update({ removed_at: new Date().toISOString(), removed_reason: "undone" })
      .eq("transaction_source", "ordered")
      .is("finalized_at", null)
      .is("removed_at", null)
      .gte("created_at", since);
    if (inventoryId) orderedQuery = orderedQuery.eq("inventory_id", inventoryId);

    let manipulatedQuery = supabase
      .from(txTable(isRaw))
      .update({ removed_at: new Date().toISOString(), removed_reason: "undone" })
      .eq("transaction_source", "manipulated")
      .is("removed_at", null)
      .gte("created_at", since);
    if (inventoryId) manipulatedQuery = manipulatedQuery.eq("inventory_id", inventoryId);

    const [orderedRes, manipulatedRes] = await Promise.all([orderedQuery, manipulatedQuery]);
    if (orderedRes.error)     throw orderedRes.error;
    if (manipulatedRes.error) throw manipulatedRes.error;
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

  useEffect(() => {
    const t = "finished";
    async function boot() {
      await resetDailyIfNeeded();
      await saveSnapshot("session", t);
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
        return { id: s.id, name: s.name, category_id: s.category_id,
          beg_bal, incoming_bal, outgoing_bal, current_bal, actual_bal, loss,
          _pendingIncoming: tx.incoming, _pendingOutgoing: tx.outgoing };
      });
      await saveInventorySnapshot(whichTab, merged);
    } catch (e) { console.error("[InventoryPage] prewarmOtherTab failed:", e); }
  }

  useEffect(() => {
    if (!booted) return;
    const t = tab, d = date;
    loadData(t, d);
    checkUndoAvailability(t);
    checkFinalizedFor(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, date, booted]);

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

    const txId = log.snapshot?.txInsertedId;
    const since = log.snapshot?.since;
    if (txId) {
      await supabase.from(txTable(isRaw))
        .update({ removed_at: new Date().toISOString(), removed_reason: "undone" })
        .eq("id", txId)
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

  async function undoSession() {
    if (!confirm("Undo all changes made this session? This will also remove every pending order/transaction created this session.")) return;
    const t = tabRef.current, isRaw = t === "raw";
    setUndoing("session");

    const result = await restoreSnapshot("session", t);
    if (!result?.ok) { setUndoing(null); return; }

    const since = result.snapshot?.since;
    if (since) {
      try {
        await deletePendingTxSince(isRaw, since);
      } catch (e) {
        alert("Inventory restored but failed to remove this session's pending orders: " + e.message);
      }
    }

    await clearItemChangeHistory(t);
    await loadData(t, dateRef.current);
    await checkUndoAvailability(t);
    await checkFinalizedFor(t);
  }

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

  async function finalizeDay() {
    if (!isOnline()) { alert("Finalize requires an internet connection."); return; }
    const t = tabRef.current, isRaw = t === "raw", today = todayLocal();

    const { data: existing } = await supabase.from(histTable(isRaw)).select("id")
      .eq("inventory_date", today).limit(1);
    if (existing?.length) { alert("Today has already been finalized."); setAlreadyFinalized(true); return; }

    const { data: pending, error: pErr } = await supabase.from(txTable(isRaw))
      .select("id").is("finalized_at", null).is("removed_at", null).limit(1);
    if (pErr) { alert("Could not check pending orders: " + pErr.message); return; }

    const confirmed = (pending?.length)
      ? confirm("Finalize today's data and roll balances forward?")
      : confirm("⚠️ No pending orders found for today.\n\nFinalizing now will roll the balance forward with no new movement.\n\nContinue anyway?");
    if (!confirmed) return;

    setFinalizing(true);
    try {
      const { data: txRows,   error: e1 } = await supabase.from(txTable(isRaw)).select("id, inventory_id, incoming_bal, outgoing_bal").is("finalized_at", null).is("removed_at", null);
      if (e1) throw e1;
      const { data: allInv,   error: e2 } = await supabase.from(invTable(isRaw)).select("*");
      if (e2) throw e2;

      const finalizedTxIds = (txRows || []).map((r) => r.id);
      await saveCloseDaySnapshot(isRaw, t, finalizedTxIds, today);

      const totals = {};
      (txRows || []).forEach(({ inventory_id, incoming_bal, outgoing_bal }) => {
        if (!totals[inventory_id]) totals[inventory_id] = { incoming: 0, outgoing: 0 };
        totals[inventory_id].incoming += Number(incoming_bal ?? 0);
        totals[inventory_id].outgoing += Number(outgoing_bal ?? 0);
      });

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

      const { error: e3 } = await supabase.from(invTable(isRaw)).upsert(finalRows, { onConflict: "id" });
      if (e3) throw e3;

      const histRows = finalRows.map((row) => ({
        inventory_id: row.id, inventory_date: today, name: row.name,
        beg_bal: row.beg_bal, incoming_bal: row.incoming_bal, outgoing_bal: row.outgoing_bal,
        current_bal: row.current_bal, actual_bal: row.actual_bal, loss: row.loss,
      }));
      const { error: e4 } = await supabase.from(histTable(isRaw)).insert(histRows);
      if (e4) throw e4;

      if (finalizedTxIds.length) {
        const { error: e5 } = await supabase.from(txTable(isRaw))
          .update({ finalized_at: new Date().toISOString() }).in("id", finalizedTxIds);
        if (e5) throw e5;
      }

      const rolled = finalRows.map((row) => ({
        id: row.id, name: row.name, beg_bal: row.current_bal,
        incoming_bal: 0, outgoing_bal: 0, current_bal: row.current_bal,
        actual_bal: row.actual_bal, loss: row.loss,
      }));
      const { error: e6 } = await supabase.from(invTable(isRaw)).upsert(rolled, { onConflict: "id" });
      if (e6) throw e6;

      await checkFinalizedFor(t);
      await loadData(t, "");
      await checkUndoAvailability(t);
      alert("Finalized. Balances rolled forward and history saved.");
    } catch (e) {
      alert("Failed to finalize: " + e.message);
      await checkFinalizedFor(t);
    } finally { setFinalizing(false); }
  }

  function requestManipulationUpdate(updateFn) {
    const t = tabRef.current;
    (async () => {
      const since = await saveSnapshot("item_change", t);
      const insertedTxId = await updateFn();

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

      if (insertedTxId !== null && isOnline()) {
        await loadData(t, dateRef.current);
      }

      await checkUndoAvailability(t);
    })();
  }

  const applyLocalPatch = useCallback((itemId, patch) => {
    setItems((prev) => prev.map((it) => it.id === itemId ? { ...it, ...patch } : it));
  }, []);

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
        <InventoryTable items={items} loading={loading} onSelect={setActiveItem} />
      </div>

      {activeItem && (
        <ManipulatePanel
          item={activeItem}
          tab={tab}
          onClose={() => setActiveItem(null)}
          onUpdated={(fn) => requestManipulationUpdate(fn)}
          onLocalPatch={applyLocalPatch}
        />
      )}
    </div>
  );
}