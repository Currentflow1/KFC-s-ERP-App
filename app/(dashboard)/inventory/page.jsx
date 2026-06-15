"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import InventoryHeader from "./components/InventoryHeader";
import InventoryTable from "./components/InventoryTable";
import ManipulatePanel from "./components/ManipulationPanel";
import InventoryCalendar from "./components/InventoryCalendar";

export default function InventoryPage() {
  const [tab, setTab] = useState("finished");
  const [items, setItems] = useState([]);
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [undoing, setUndoing] = useState(null);
  const [canUndoItem, setCanUndoItem] = useState(false);
  const [canUndoSession, setCanUndoSession] = useState(false);
  const [canUndoCloseDay, setCanUndoCloseDay] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    saveSnapshot("session").then(() => {
      loadData();
      checkUndoAvailability();
    });
  }, []);

  useEffect(() => {
    if (!mounted) { setMounted(true); return; }
    loadData();
    checkUndoAvailability();
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

  async function loadData() {
    setLoading(true);
    const isHistory = date !== "";
    const staticTable = tab === "finished" ? "finished_products_static" : "raw_materials_static";
    const { data: staticItems } = await supabase.from(staticTable).select("*");
    const inventoryTable = isHistory
      ? tab === "finished" ? "finished_products_inventory_history" : "raw_materials_inventory_history"
      : tab === "finished" ? "finished_products_inventory" : "raw_materials_inventory";
    let query = supabase.from(inventoryTable).select("*");
    if (isHistory) query = query.eq("inventory_date", date);
    const { data: inventoryItems } = await query;
    const map = {};
    (inventoryItems || []).forEach((i) => { map[isHistory ? i.inventory_id : i.id] = i; });
    const merged = (staticItems || []).map((s) => {
      const inv = map[s.id];
      return {
        id: s.id, name: s.name, category_id: s.category_id,
        beg_bal: inv?.beg_bal ?? 0, incoming_bal: inv?.incoming_bal ?? 0,
        outgoing_bal: inv?.outgoing_bal ?? 0, current_bal: inv?.current_bal ?? 0,
        actual_bal: inv?.actual_bal ?? 0, loss: inv?.loss ?? 0,
      };
    });
    setItems(merged);
    setLoading(false);
  }

  async function saveSnapshot(undoType) {
    const inventoryTable = tab === "finished" ? "finished_products_inventory" : "raw_materials_inventory";
    const { data: currentRows } = await supabase.from(inventoryTable).select("*");
    await supabase.from("undo_log").insert({ undo_type: undoType, tab, snapshot: currentRows || [] });
  }

  async function restoreSnapshot(undoType) {
    const { data: logs } = await supabase
      .from("undo_log").select("*").eq("tab", tab).eq("undo_type", undoType)
      .order("created_at", { ascending: false }).limit(1);
    if (!logs || logs.length === 0) { alert("No undo snapshot found."); return false; }
    const log = logs[0];
    const inventoryTable = tab === "finished" ? "finished_products_inventory" : "raw_materials_inventory";
    if (log.snapshot && log.snapshot.length > 0) {
      const { error } = await supabase.from(inventoryTable).upsert(log.snapshot, { onConflict: "id" });
      if (error) { alert("Restore failed: " + error.message); return false; }
    }
    await supabase.from("undo_log").delete().eq("id", log.id);
    return true;
  }

  async function undoItemChange() {
    if (!confirm("Undo the last item change?")) return;
    setUndoing("item");
    const ok = await restoreSnapshot("item_change");
    setUndoing(null);
    if (ok) { loadData(); checkUndoAvailability(); }
  }

  async function undoSession() {
    if (!confirm("Undo all changes made this session?")) return;
    setUndoing("session");
    const ok = await restoreSnapshot("session");
    setUndoing(null);
    if (ok) { loadData(); checkUndoAvailability(); }
  }

  async function undoCloseDay() {
    if (!confirm("Undo the last Close Day?")) return;
    setUndoing("close_day");
    const ok = await restoreSnapshot("close_day");
    setUndoing(null);
    if (ok) { loadData(); checkUndoAvailability(); }
  }

  async function closeDay() {
    if (!confirm("Archive today's data and roll balances forward?")) return;
    await saveSnapshot("close_day");
    setClosing(true);
    const { error } = await supabase.rpc("close_inventory_day");
    setClosing(false);
    if (error) { alert("Failed to close day: " + error.message); return; }
    alert("Day closed. Snapshot saved and balances rolled forward.");
    loadData();
    checkUndoAvailability();
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <InventoryHeader onPrint={() => window.print()} items={items} date={date} />

      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <button onClick={() => setTab("finished")} className={`px-4 py-2 border rounded ${tab === "finished" ? "bg-blue-600 text-white" : "bg-white"}`}>Finished</button>
        <button onClick={() => setTab("raw")} className={`px-4 py-2 border rounded ${tab === "raw" ? "bg-blue-600 text-white" : "bg-white"}`}>Raw</button>
        <InventoryCalendar tab={tab} date={date} onSelectDate={setDate} />

        {date === "" && (
          <>
            <button onClick={closeDay} disabled={closing} className="border px-4 py-2 rounded bg-amber-500 text-white disabled:opacity-50">
              {closing ? "Closing..." : "Close day"}
            </button>
            <div className="w-px h-8 bg-gray-200 mx-1" />
            <button onClick={undoItemChange} disabled={!canUndoItem || undoing === "item"} title="Revert the last single item edit" className="border px-4 py-2 rounded bg-white text-gray-700 disabled:opacity-40 hover:bg-gray-100">
              ↩ {undoing === "item" ? "Undoing..." : "Undo item"}
            </button>
            <button onClick={undoSession} disabled={!canUndoSession || undoing === "session"} title="Revert all changes this session" className="border px-4 py-2 rounded bg-white text-gray-700 disabled:opacity-40 hover:bg-gray-100">
              ↩↩ {undoing === "session" ? "Undoing..." : "Undo session"}
            </button>
            <button onClick={undoCloseDay} disabled={!canUndoCloseDay || undoing === "close_day"} title="Revert the last Close Day" className="border px-4 py-2 rounded bg-red-100 text-red-700 border-red-300 disabled:opacity-40 hover:bg-red-200">
              ↩ {undoing === "close_day" ? "Undoing..." : "Undo close day"}
            </button>
          </>
        )}
      </div>

      <InventoryTable items={items} loading={loading} onSelect={setActiveItem} />

      {activeItem && (
        <ManipulatePanel
          item={activeItem}
          tab={tab}
          onClose={() => setActiveItem(null)}
          onUpdated={async () => {
            await saveSnapshot("item_change");
            loadData();
            checkUndoAvailability();
          }}
        />
      )}
    </div>
  );
}