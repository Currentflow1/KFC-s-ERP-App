"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabaseClient";

function pad(n) { return n.toString().padStart(2, "0"); }
function toDateString(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export default function InventoryCalendar({ tab, date, onSelectDate }) {
  const supabase = useMemo(() => createClient(), []);

  const [open, setOpen] = useState(false);
  const [availableDates, setAvailableDates] = useState(new Set());
  const containerRef = useRef(null);
  const [viewMonth, setViewMonth] = useState(() => {
    const base = date ? new Date(date + "T00:00:00") : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => { loadAvailableDates(); }, [tab]);

  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function loadAvailableDates() {
    const table = tab === "finished"
      ? "finished_products_inventory_history"
      : "raw_materials_inventory_history";

    // Fetch all pages so we never miss dates when there are many products.
    // Each date appears once per inventory row, so we paginate until exhausted.
    const PAGE = 1000;
    let page = 0;
    const allDates = new Set();

    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select("inventory_date")
        .order("inventory_date", { ascending: false })
        .range(page * PAGE, (page + 1) * PAGE - 1);

      if (error) {
        console.error("[InventoryCalendar] loadAvailableDates error:", error.message);
        break;
      }

      (data || []).forEach((r) => { if (r.inventory_date) allDates.add(r.inventory_date); });

      // If fewer rows than a full page came back, we've reached the end
      if (!data || data.length < PAGE) break;
      page++;
    }

    setAvailableDates(allDates);

    // If there are dates but no month is showing any dots, jump the calendar
    // to the most recent month that has data so the user sees something immediately.
    if (allDates.size > 0 && !date) {
      const sorted = [...allDates].sort().reverse();
      const latest = sorted[0];
      const latestDate = new Date(latest + "T00:00:00");
      setViewMonth(new Date(latestDate.getFullYear(), latestDate.getMonth(), 1));
    }
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

  // Check whether the current view month has any available dates,
  // to show a hint when the user navigates to an empty month.
  const currentMonthHasDates = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = String(viewMonth.getMonth() + 1).padStart(2, "0");
    const prefix = `${year}-${month}`;
    return [...availableDates].some((d) => d.startsWith(prefix));
  }, [availableDates, viewMonth]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-sm text-gray-700 hover:border-blue-400 transition-colors"
      >
        <span>📅</span>
        <span>{date ? date : "Today (live)"}</span>
        {date && (
          <span
            onClick={(e) => { e.stopPropagation(); onSelectDate(""); }}
            className="ml-1 text-gray-400 hover:text-gray-600 text-xs"
          >✕</span>
        )}
        <span className="text-gray-400 text-xs ml-1">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-72">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => changeMonth(-1)} className="px-2 py-1 rounded border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">‹</button>
            <span className="text-sm font-semibold text-gray-800">
              {viewMonth.toLocaleString("default", { month: "long", year: "numeric" })}
            </span>
            <button onClick={() => changeMonth(1)} className="px-2 py-1 rounded border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">›</button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-400 mb-1">
            {["Su","Mo","Tu","We","Th","Fr","Sa"].map((w) => <div key={w}>{w}</div>)}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1 text-center text-sm">
            {cells.map((cellDate, idx) => {
              if (!cellDate) return <div key={idx} />;
              const dStr = toDateString(cellDate);
              const isSelected = date === dStr;
              const isToday = dStr === todayStr;
              const hasSnapshot = availableDates.has(dStr);
              return (
                <button
                  key={idx}
                  onClick={() => { onSelectDate(dStr); setOpen(false); }}
                  className={`relative py-1 rounded text-xs transition-colors ${
                    isSelected
                      ? "bg-blue-600 text-white"
                      : isToday
                        ? "border border-blue-400 text-gray-900 font-semibold"
                        : hasSnapshot
                          ? "text-gray-800 hover:bg-blue-50"
                          : "text-gray-400 hover:bg-gray-50"
                  }`}
                >
                  {cellDate.getDate()}
                  {hasSnapshot && (
                    <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                      isSelected ? "bg-white" : "bg-blue-500"
                    }`} />
                  )}
                </button>
              );
            })}
          </div>

          {/* No-data hint for current month */}
          {!currentMonthHasDates && availableDates.size > 0 && (
            <p className="text-xs text-center text-gray-400 mt-2">
              No snapshots this month — try another month.
            </p>
          )}

          {/* Footer */}
          <div className="flex justify-between items-center mt-3 pt-2 border-t border-gray-100">
            <button
              onClick={() => { onSelectDate(""); setOpen(false); }}
              className="text-xs px-3 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              Today (live)
            </button>
            <span className="text-xs text-gray-400">dots = stored snapshots</span>
          </div>
        </div>
      )}
    </div>
  );
}