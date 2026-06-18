"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import InventoryHeader from "./components/InventoryHeader";
import InventoryTable from "./components/InventoryTable";
import ManipulatePanel from "./components/ManipulationPanel";
import InventoryCalendar from "./components/InventoryCalendar";
import InventorySummary from "./components/InventorySummary";

function txTable(isRaw) {
  return isRaw ? "raw_materials_transaction_log" : "finished_products_transaction_log";
}
function inventoryTable(isRaw) {
  return isRaw ? "raw_materials_inventory" : "finished_products_inventory";
}
function historyTable(isRaw) {
  return isRaw ? "raw_materials_inventory_history" : "finished_products_inventory_history";
}
function staticTable(isRaw) {
  return isRaw ? "raw_materials_static" : "finished_products_static";
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function InventoryPage() {
  const supabase = createClient();

  const [tab, setTab]                           = useState("finished");
  const [items, setItems]                       = useState([]);
  const [date, setDate]                         = useState("");
  const [loading, setLoading]                   = useState(false);
  const [finalizing, setFinalizing]             = useState(false);
  const [alreadyFinalized, setAlreadyFinalized] = useState(false);
  const [undoing, setUndoing]                   = useState(null);
  const [canUndoItem, setCanUndoItem]           = useState(false);
  const [canUndoSession, setCanUndoSession]     = useState(false);
  const [canUndoCloseDay, setCanUndoCloseDay]   = useState(false);
  const [activeItem, setActiveItem]             = useState(null);
  const [mounted, setMounted]                   = useState(false);

  const isRaw = tab === "raw";

  async function checkFinalized() {
    const today = todayISO();
    const { data } = await supabase
      .from(historyTable(isRaw))
      .select("id")
      .eq("inventory_date", today)
      .limit(1);
    setAlreadyFinalized(!!(data && data.length > 0));
  }

  useEffect(() => {
    saveSnapshot("session").then(() => {
      loadData();
      checkUndoAvailability();
      checkFinalized();
    });
  }, []);

  useEffect(() => {
    if (!mounted) { setMounted(true); return; }
    loadData();
    checkUndoAvailability();
    checkFinalized();
  }, [tab, date]);

  async function checkUndoAvailability() {
    const { data } = await supabase
      .from("undo_log")
      .select("id, undo_type")
      .eq("tab", tab)
      .order("created_at", { ascending: false })
      .limit(20);
    const logs = data || [];
    setCanUndoItem(logs.some((l) => l.undo_type === "item_change"));
    setCanUndoSession(logs.some((l) => l.undo_type === "session"));
    setCanUndoCloseDay(logs.some((l) => l.undo_type === "close_day"));
  }

  async function saveSnapshot(undoType) {
    const table = inventoryTable(isRaw);
    const { data: currentRows } = await supabase.from(table).select("*");
    await supabase
      .from("undo_log")
      .insert({ undo_type: undoType, tab, snapshot: currentRows || [] });
  }

  async function restoreSnapshot(undoType) {
    const { data: logs } = await supabase
      .from("undo_log")
      .select("*")
      .eq("tab", tab)
      .eq("undo_type", undoType)
      .order("created_at", { ascending: false })
      .limit(1);
    if (!logs || logs.length === 0) { alert("No undo snapshot found."); return false; }
    const log = logs[0];
    const table = inventoryTable(isRaw);
    if (log.snapshot && log.snapshot.length > 0) {
      const { error } = await supabase
        .from(table)
        .upsert(log.snapshot, { onConflict: "id" });
      if (error) { alert("Restore failed: " + error.message); return false; }
    }
    await supabase.from("undo_log").delete().eq("id", log.id);
    return true;
  }

  function afterUndo() {
    if (date !== "") setDate("");
    else { loadData(); checkUndoAvailability(); checkFinalized(); }
  }

  async function undoItemChange() {
    if (!confirm("Undo the last item change?")) return;
    setUndoing("item");
    const ok = await restoreSnapshot("item_change");
    setUndoing(null);
    if (ok) afterUndo();
  }

  async function undoSession() {
    if (!confirm("Undo all changes made this session?")) return;
    setUndoing("session");
    const ok = await restoreSnapshot("session");
    setUndoing(null);
    if (ok) afterUndo();
  }

  async function undoCloseDay() {
    if (!confirm("Undo the last Finalize? This will delete today's history snapshot and restore previous balances.")) return;
    setUndoing("close_day");

    const ok = await restoreSnapshot("close_day");
    if (!ok) { setUndoing(null); return; }

    const today = todayISO();
    const { error: e1 } = await supabase
      .from("finished_products_inventory_history")
      .delete()
      .eq("inventory_date", today);
    const { error: e2 } = await supabase
      .from("raw_materials_inventory_history")
      .delete()
      .eq("inventory_date", today);

    if (e1 || e2) {
      alert("Inventory restored but failed to clear history: " + (e1?.message || e2?.message));
    }

    setUndoing(null);
    afterUndo();
  }

  async function loadData() {
    setLoading(true);

    const isHistory = date !== "";

    const { data: staticItems, error } = await supabase
      .from(staticTable(isRaw))
      .select("*");

    if (error) console.error("staticItems error:", error);

    const invTable = isHistory ? historyTable(isRaw) : inventoryTable(isRaw);
    let query = supabase.from(invTable).select("*");
    if (isHistory) query = query.eq("inventory_date", date);
    const { data: inventoryItems } = await query;

    const invMap = {};
    (inventoryItems || []).forEach((i) => {
      invMap[isHistory ? i.inventory_id : i.id] = i;
    });

    const txTotals = {};
    if (!isHistory) {
      const { data: txRows } = await supabase
        .from(txTable(isRaw))
        .select("inventory_id, incoming_bal, outgoing_bal");

      (txRows || []).forEach(({ inventory_id, incoming_bal, outgoing_bal }) => {
        if (!txTotals[inventory_id])
          txTotals[inventory_id] = { incoming: 0, outgoing: 0 };
        txTotals[inventory_id].incoming += Number(incoming_bal ?? 0);
        txTotals[inventory_id].outgoing += Number(outgoing_bal ?? 0);
      });
    }

    const merged = (staticItems || []).map((s) => {
      const inv = invMap[s.id];
      const tx  = txTotals[s.id] ?? { incoming: 0, outgoing: 0 };

      const beg_bal    = Number(inv?.beg_bal    ?? 0);
      const actual_bal = Number(inv?.actual_bal ?? 0);
      const loss       = Number(inv?.loss       ?? 0);

      const incoming_bal = Number(inv?.incoming_bal ?? 0) + tx.incoming;
      const outgoing_bal = Number(inv?.outgoing_bal ?? 0) + tx.outgoing;
      const current_bal  = beg_bal + incoming_bal - outgoing_bal;

      return {
        id: s.id,
        name: s.name,
        category_id: s.category_id,
        beg_bal,
        incoming_bal,
        outgoing_bal,
        current_bal,
        actual_bal,
        loss,
        _pendingIncoming: tx.incoming,
        _pendingOutgoing: tx.outgoing,
      };
    });

    setItems(merged);
    setLoading(false);
  }

  async function finalizeDay() {
    const tx  = txTable(isRaw);
    const inv = inventoryTable(isRaw);

    const { data: pendingRows, error: checkError } = await supabase
      .from(tx).select("id").limit(1);
    if (checkError) { alert("Could not check pending orders: " + checkError.message); return; }

    const hasPending = pendingRows && pendingRows.length > 0;
    const confirmed = hasPending
      ? confirm("Finalize today's data and roll balances forward?")
      : confirm(
          "⚠️ No pending orders found for today.\n\n" +
          "Finalizing now will roll the balance forward with no new movement.\n\n" +
          "Continue anyway?"
        );
    if (!confirmed) return;

    await saveSnapshot("close_day");
    setFinalizing(true);

    try {
      const { data: txRows, error: txFetchError } = await supabase
        .from(tx)
        .select("id, inventory_id, incoming_bal, outgoing_bal");
      if (txFetchError) throw txFetchError;

      if (txRows && txRows.length > 0) {
        const totals = {};
        txRows.forEach(({ id, inventory_id, incoming_bal, outgoing_bal }) => {
          if (!totals[inventory_id])
            totals[inventory_id] = { incoming: 0, outgoing: 0, ids: [] };
          totals[inventory_id].incoming += Number(incoming_bal ?? 0);
          totals[inventory_id].outgoing += Number(outgoing_bal ?? 0);
          totals[inventory_id].ids.push(id);
        });

        const { data: currentRows, error: fetchError } = await supabase
          .from(inv)
          .select("id, name, beg_bal, incoming_bal, outgoing_bal, actual_bal, loss")
          .in("id", Object.keys(totals));
        if (fetchError) throw fetchError;

        const updates = (currentRows || []).map((row) => {
          const t = totals[row.id];
          const incoming_bal = Number(row.incoming_bal ?? 0) + t.incoming;
          const outgoing_bal = Number(row.outgoing_bal ?? 0) + t.outgoing;
          const current_bal  = Number(row.beg_bal      ?? 0) + incoming_bal - outgoing_bal;
          const actual_bal   = Number(row.actual_bal ?? current_bal);
          const loss         = Math.max(0, current_bal - actual_bal);
          return { id: row.id, name: row.name, incoming_bal, outgoing_bal, current_bal, actual_bal, loss };
        });

        const { error: deleteError } = await supabase
          .from(tx).delete().in("id", txRows.map((r) => r.id));
        if (deleteError) throw deleteError;

        const { error: upsertError } = await supabase
          .from(inv).upsert(updates, { onConflict: "id" });
        if (upsertError) throw upsertError;
      }

      const { error: rpcError } = await supabase.rpc("close_inventory_day");
      if (rpcError) throw rpcError;

      alert("Finalized. Balances rolled forward and history saved.");
      setAlreadyFinalized(true);
      loadData();
      checkUndoAvailability();
    } catch (e) {
      alert("Failed to finalize: " + e.message);
    } finally {
      setFinalizing(false);
    }
  }

  function requestManipulationUpdate(updateFn) {
    (async () => {
      await saveSnapshot("item_change");
      await updateFn();
      loadData();
      checkUndoAvailability();
    })();
  }

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
              tab === "finished"
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Finished
          </button>
          <button
            onClick={() => setTab("raw")}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${
              tab === "raw"
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
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