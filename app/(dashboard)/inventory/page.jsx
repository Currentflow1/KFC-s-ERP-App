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

  const [activeItem, setActiveItem] = useState(null);

  useEffect(() => {
    loadData();
  }, [tab, date]);

async function loadData() {
    setLoading(true);

    const isHistory = date !== "";

    // 1. STATIC BASE (ALWAYS FULL LIST)
    const staticTable =
      tab === "finished"
        ? "finished_products_static"
        : "raw_materials_static";

    const { data: staticItems } = await supabase
      .from(staticTable)
      .select("*");

    // 2. INVENTORY TABLE
    const inventoryTable = isHistory
      ? tab === "finished"
        ? "finished_products_inventory_history"
        : "raw_materials_inventory_history"
      : tab === "finished"
        ? "finished_products_inventory"
        : "raw_materials_inventory";

    let query = supabase.from(inventoryTable).select("*");

    if (isHistory) {
      query = query.eq("inventory_date", date);
    }

    const { data: inventoryItems } = await query;

    // 3. INDEX INVENTORY FOR FAST LOOKUP
    const map = {};
    (inventoryItems || []).forEach(i => {
      const key = isHistory ? i.inventory_id : i.id;
      map[key] = i;
    });

    // 4. MERGE (THIS IS THE KEY PART)
    const merged = (staticItems || []).map(s => {
      const inv = map[s.id];

      return {
        id: s.id,
        name: s.name,

        // static fields (always present)
        category_id: s.category_id,

        // inventory fields (fallback to 0)
        beg_bal: inv?.beg_bal ?? 0,
        incoming_bal: inv?.incoming_bal ?? 0,
        outgoing_bal: inv?.outgoing_bal ?? 0,
        current_bal: inv?.current_bal ?? 0,
        actual_bal: inv?.actual_bal ?? 0,
        loss: inv?.loss ?? 0,
      };
    });

    setItems(merged);
    setLoading(false);
  }

  async function closeDay() {
    if (!confirm("Archive today's data and roll balances forward to tomorrow? This cannot be undone.")) {
      return;
    }
    setClosing(true);
    const { error } = await supabase.rpc("close_inventory_day");
    setClosing(false);

    if (error) {
      alert("Failed to close day: " + error.message);
      return;
    }

    alert("Day closed. Snapshot saved and balances rolled forward.");
    loadData();
  }

  function printPage() {
    window.print();
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen">

      {/* HEADER */}
      <InventoryHeader
        onPrint={printPage}
        items={items}
        date={date}
      />

      {/* CONTROLS */}
      <div className="flex gap-2 mb-6">

        <button
          onClick={() => setTab("finished")}
          className={`px-4 py-2 border rounded ${
            tab === "finished" ? "bg-blue-600 text-white" : "bg-white"
          }`}
        >
          Finished
        </button>

        <button
          onClick={() => setTab("raw")}
          className={`px-4 py-2 border rounded ${
            tab === "raw" ? "bg-blue-600 text-white" : "bg-white"
          }`}
        >
          Raw
        </button>

        {/* 📅 CALENDAR */}
        <InventoryCalendar
          tab={tab}
          date={date}
          onSelectDate={setDate}
        />

        {date === "" && (
          <button
            onClick={closeDay}
            disabled={closing}
            className="border px-4 py-2 rounded bg-amber-500 text-white disabled:opacity-50"
          >
            {closing ? "Closing..." : "Close Day"}
          </button>
        )}
      </div>

      {/* TABLE */}
      <InventoryTable
        items={items}
        loading={loading}
        onSelect={setActiveItem}
      />

      {/* FLOATING PANEL */}
      {activeItem && (
        <ManipulatePanel
          item={activeItem}
          tab={tab}
          onClose={() => setActiveItem(null)}
          onUpdated={loadData}
        />
      )}
    </div>
  );
}