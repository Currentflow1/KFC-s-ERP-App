"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

function pad(n) { return n.toString().padStart(2, "0"); }
function toDateString(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export default function InventoryCalendar({ tab, date, onSelectDate }) {
  const [open, setOpen] = useState(false);
  const [availableDates, setAvailableDates] = useState(new Set());
  const [viewMonth, setViewMonth] = useState(() => {
    const base = date ? new Date(date + "T00:00:00") : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => { loadAvailableDates(); }, [tab]);

  async function loadAvailableDates() {
    const table = tab === "finished" ? "finished_products_inventory_history" : "raw_materials_inventory_history";
    const { data } = await supabase.from(table).select("inventory_date");
    setAvailableDates(new Set((data || []).map((d) => d.inventory_date)));
  }

  function changeMonth(offset) {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  }

  function buildGrid() {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    return cells;
  }

  const todayStr = toDateString(new Date());
  const cells = buildGrid();

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="border px-4 py-2 rounded bg-white min-w-[150px] text-left">
        {date ? `📅 ${date}` : "📅 Today (live)"}
      </button>
      {open && (
        <div className="absolute z-10 mt-2 bg-white border rounded shadow-lg p-3 w-72">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => changeMonth(-1)} className="px-2 py-1 border rounded text-sm">‹</button>
            <span className="font-medium">{viewMonth.toLocaleString("default", { month: "long", year: "numeric" })}</span>
            <button onClick={() => changeMonth(1)} className="px-2 py-1 border rounded text-sm">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-1">
            {["Su","Mo","Tu","We","Th","Fr","Sa"].map((w) => <div key={w}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-sm">
            {cells.map((cellDate, idx) => {
              if (!cellDate) return <div key={idx} />;
              const dStr = toDateString(cellDate);
              const isSelected = date === dStr;
              const isToday = dStr === todayStr;
              return (
                <button key={idx} onClick={() => { onSelectDate(dStr); setOpen(false); }}
                  className={`relative py-1 rounded ${isSelected ? "bg-blue-600 text-white" : isToday ? "border border-blue-600" : "hover:bg-gray-100"}`}>
                  {cellDate.getDate()}
                  {availableDates.has(dStr) && (
                    <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isSelected ? "bg-white" : "bg-blue-600"}`} />
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex justify-between mt-3">
            <button onClick={() => { onSelectDate(""); setOpen(false); }} className="text-sm border px-3 py-1 rounded">Today (live)</button>
            <span className="text-xs text-gray-400 self-center">dots = stored snapshots</span>
          </div>
        </div>
      )}
    </div>
  );
}