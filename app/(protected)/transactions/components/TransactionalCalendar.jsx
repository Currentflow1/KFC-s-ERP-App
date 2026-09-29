"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabaseClient";
import { getCache, setCache } from "@/lib/sync";

function pad(n) { return n.toString().padStart(2, "0"); }
function toDateString(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

const TX_TABLE_BY_TYPE = {
  raw:       "raw_materials_transaction_log",
  finished:  "finished_products_transaction_log",
  packaging: "packaging_transaction_log",
};

/**
 * Calendar for the Transaction Logs page.
 * Mirrors InventoryCalendar exactly: same markup, same open/close behavior,
 * same month-grid logic, same dot-indicator pattern — but fetches its
 * "has activity" dates from the transaction log table itself (grouped by
 * day) instead of an inventory_history table, since transaction logs
 * don't have daily snapshots — every row IS the activity.
 *
 * Offline: the list of activity dates is saved after each successful load
 * and reused when the browser is offline or a request fails.
 */
export default function TransactionCalendar({ productType, date, onSelectDate }) {
  const supabase = useMemo(() => createClient(), []);

  const [open, setOpen] = useState(false);
  const [availableDates, setAvailableDates] = useState(new Set());
  const containerRef = useRef(null);
  const [viewMonth, setViewMonth] = useState(() => {
    const base = date ? new Date(date + "T00:00:00") : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => { loadAvailableDates(); }, [productType]);

  // Reload when the connection comes back so the dots refresh.
  useEffect(() => {
    function handleOnline() { loadAvailableDates(); }
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productType]);

  // Close on outside click — matches InventoryCalendar behavior
  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function loadFromCache(cacheKey) {
    const cached = await getCache(cacheKey);
    if (Array.isArray(cached)) setAvailableDates(new Set(cached));
  }

  async function loadAvailableDates() {
    const table = TX_TABLE_BY_TYPE[productType] ?? TX_TABLE_BY_TYPE.raw;
    const cacheKey = `transactionCalendar:dates:${table}`;

    // Offline: use the last saved list and skip the request entirely.
    if (!isOnline()) {
      await loadFromCache(cacheKey);
      return;
    }

    // Paginate so we don't silently miss dates past Supabase's default
    // 1000-row cap when a table has more rows than that.
    const PAGE = 1000;
    let page = 0;
    const allDates = new Set();

    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select("created_at")
        .order("created_at", { ascending: false })
        .range(page * PAGE, (page + 1) * PAGE - 1);

      if (error) {
        // A dropped connection isn't a real failure: fall back to the saved
        // list instead of logging an error or wiping the dots.
        if (/failed to fetch|network|load failed/i.test(error.message ?? "")) {
          await loadFromCache(cacheKey);
        } else {
          console.error("[TransactionCalendar] loadAvailableDates error:", error.message);
        }
        return;
      }

      (data || []).forEach((r) => {
        if (r.created_at) allDates.add(toDateString(new Date(r.created_at)));
      });

      if (!data || data.length < PAGE) break;
      page++;
    }

    setAvailableDates(allDates);
    setCache(cacheKey, [...allDates]);
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
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-sm text-gray-700 hover:border-blue-400 transition-colors"
      >
        <span>📅</span>
        <span>{date ? date : "All dates"}</span>
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
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((w) => <div key={w}>{w}</div>)}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1 text-center text-sm">
            {cells.map((cellDate, idx) => {
              if (!cellDate) return <div key={idx} />;
              const dStr = toDateString(cellDate);
              const isSelected = date === dStr;
              const isToday = dStr === todayStr;
              const hasActivity = availableDates.has(dStr);
              return (
                <button
                  key={idx}
                  onClick={() => { onSelectDate(dStr); setOpen(false); }}
                  className={`relative py-1 rounded text-xs transition-colors ${isSelected
                      ? "bg-blue-600 text-white"
                      : isToday
                        ? "border border-blue-400 text-gray-900 font-semibold"
                        : hasActivity
                          ? "text-gray-800 hover:bg-blue-50"
                          : "text-gray-400 hover:bg-gray-50"
                    }`}
                >
                  {cellDate.getDate()}
                  {hasActivity && (
                    <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isSelected ? "bg-white" : "bg-blue-500"
                      }`} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex justify-between items-center mt-3 pt-2 border-t border-gray-100">
            <button
              onClick={() => { onSelectDate(""); setOpen(false); }}
              className="text-xs px-3 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              Show all
            </button>
            <span className="text-xs text-gray-400">dots = activity</span>
          </div>
        </div>
      )}
    </div>
  );
}