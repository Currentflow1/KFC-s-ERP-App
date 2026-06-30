"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabaseClient";
import InventoryCalendar from "@/app/(protected)/inventory/components/InventoryCalendar";

import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

const LOW_STOCK_THRESHOLD = 100;

// ─── Tab config ───────────────────────────────────────────────────────────
// Single source of truth for which tables/labels each tab uses, mirroring
// the pattern in InventoryPage / TransactionLogsTable so all three tabs
// (finished, raw, packaging) stay in sync going forward.
const TAB_CONFIG = {
  finished: {
    label: "Finished Products",
    static: "finished_products_static",
    inv: "finished_products_inventory",
    hist: "finished_products_inventory_history",
    wh: "finished_products_warehouses",
  },
  raw: {
    label: "Raw Materials",
    static: "raw_materials_static",
    inv: "raw_materials_inventory",
    hist: "raw_materials_inventory_history",
    wh: "raw_materials_warehouses",
  },
  packaging: {
    label: "Packaging",
    static: "packaging_static",
    inv: "packaging_inventory",
    hist: "packaging_inventory_history",
    wh: "packaging_warehouses",
  },
};
const TAB_ORDER = ["finished", "raw", "packaging"];

function cfg(tab) { return TAB_CONFIG[tab] ?? TAB_CONFIG.finished; }

// ── Warehouse dropdown (multi-select with checkboxes) ────────────────────────
function WarehouseMultiSelect({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggle(w) {
    onChange(selected.includes(w) ? selected.filter((x) => x !== w) : [...selected, w]);
  }

  const label = selected.length === 0
    ? "All warehouses"
    : selected.length === 1
      ? `Warehouse: ${selected[0]}`
      : `${selected.length} warehouses`;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        disabled={options.length === 0}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
          selected.length > 0
            ? "bg-blue-50 text-blue-700 border-blue-300"
            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        📦 {label}
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && options.length > 0 && (
        <div className="absolute z-50 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
          <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-gray-100">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Warehouses</span>
            {selected.length > 0 && (
              <button onClick={() => onChange([])} className="text-xs text-blue-600 hover:underline">Clear</button>
            )}
          </div>
          <ul className="max-h-56 overflow-y-auto">
            {options.map((w) => {
              const checked = selected.includes(w);
              return (
                <li key={w}>
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(w)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {w}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function InventoryPage() {
  const supabase = useMemo(() => createClient(), []);

  const [tab, setTab]                     = useState("finished");
  const [items, setItems]                 = useState([]);
  const [date, setDate]                   = useState("");
  const [loading, setLoading]             = useState(false);
  const [printedAt, setPrintedAt]         = useState(null);
  const [chartCollapsed, setChartCollapsed] = useState(false);

  // Warehouse filter and available warehouses
  const [warehouseFilter, setWarehouseFilter] = useState([]);
  const [availableWarehouses, setAvailableWarehouses] = useState([]);

  useEffect(() => {
    loadAvailableWarehouses();
  }, [tab]);

  useEffect(() => {
    loadData();
  }, [tab, date]);

  useEffect(() => {
    setWarehouseFilter([]);
  }, [tab, date]);

  // ── Load available warehouses from warehouse junction tables ────────────────
  async function loadAvailableWarehouses() {
    const table = cfg(tab).wh;

    try {
      const { data, error } = await supabase
        .from(table)
        .select("warehouse")
        .order("warehouse", { ascending: true });

      if (error) throw error;

      const uniqueWarehouses = Array.from(
        new Set((data || []).map((row) => row.warehouse).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

      setAvailableWarehouses(uniqueWarehouses);
    } catch (e) {
      console.error("[loadAvailableWarehouses] error:", e);
      setAvailableWarehouses([]);
    }
  }

  // ── Load inventory data ───────────────────────────────────────────────────
  async function loadData() {
    setLoading(true);

    const isHistory = date !== "";
    const tabCfg = cfg(tab);

    const { data: staticItems } = await supabase
      .from(tabCfg.static)
      .select("id, name, category_name");

    const inventoryTable = isHistory ? tabCfg.hist : tabCfg.inv;

    let query = supabase.from(inventoryTable).select("*");
    if (isHistory) query = query.eq("inventory_date", date);
    const { data: inventoryItems } = await query;

    const map = {};
    (inventoryItems || []).forEach((i) => {
      const key = isHistory ? i.inventory_id : i.id;
      map[key] = i;
    });

    const merged = (staticItems || []).map((s) => {
      const inv = map[s.id];
      return {
        id:           s.id,
        name:         s.name,
        category_id:  s.category_name,
        warehouse:    inv?.warehouse ?? null,
        beg_bal:      inv?.beg_bal      ?? 0,
        incoming_bal: inv?.incoming_bal ?? 0,
        outgoing_bal: inv?.outgoing_bal ?? 0,
        current_bal:  inv?.current_bal  ?? 0,
        actual_bal:   inv?.actual_bal   ?? 0,
        loss:         inv?.loss         ?? 0,
      };
    });

    setItems(merged);
    setLoading(false);
  }

  function printPage() {
    setPrintedAt(new Date().toLocaleString());
    requestAnimationFrame(() => window.print());
  }

  // Filter items by warehouse
  const filteredItems = useMemo(() => {
    if (warehouseFilter.length === 0) {
      // No filter = show all items
      return [...items].sort((a, b) => a.name.localeCompare(b.name));
    }
    // Show only items where warehouse is in the selected warehouses
    const list = items.filter((it) => warehouseFilter.includes(it.warehouse));
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [items, warehouseFilter]);

  const summary = useMemo(() => ({
    totalItems: filteredItems.length,
    stock:  filteredItems.reduce((a, b) => a + Number(b.current_bal), 0),
    actual: filteredItems.reduce((a, b) => a + Number(b.actual_bal),  0),
    loss:   filteredItems.reduce((a, b) => a + Number(b.loss),        0),
  }), [filteredItems]);

  const outOfStock = useMemo(
    () => filteredItems.filter((i) => Number(i.current_bal) === 0),
    [filteredItems]
  );

  const lowStock = useMemo(
    () => filteredItems.filter((i) => Number(i.current_bal) > 0 && Number(i.current_bal) < LOW_STOCK_THRESHOLD),
    [filteredItems]
  );

  const priorityList = useMemo(() => {
    const out = [...outOfStock].sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ ...i, severity: "out" }));
    const low = [...lowStock].sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ ...i, severity: "low" }));
    return [...out, ...low];
  }, [outOfStock, lowStock]);

  const hasAlerts = priorityList.length > 0;

  const chartData = useMemo(
    () => filteredItems.map((i) => ({
      name:  i.name,
      stock: Number(i.current_bal),
      loss:  Number(i.loss),
    })),
    [filteredItems]
  );

  // Subtitle / footer label for active warehouse filter
  const warehouseLabel = warehouseFilter.length === 0
    ? null
    : warehouseFilter.length === 1
      ? warehouseFilter[0]
      : `${warehouseFilter.length} warehouses`;

  const tabLabel = cfg(tab).label;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm 10mm; }
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; inset: 0; }
          .no-print { display: none !important; }
          #print-area { font-family: 'Courier New', Courier, monospace !important; font-size: 11px !important; color: #000 !important; background: #fff !important; }
          #print-area h1 { font-size: 15px !important; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 8px; }
          #print-area .print-subtitle { font-size: 10px; margin-bottom: 12px; border-bottom: 1px dashed #000; padding-bottom: 4px; }
          #print-area .print-kpi-row { display: flex; gap: 16px; margin-bottom: 12px; border: 1px solid #000; padding: 6px 10px; }
          #print-area .print-kpi-row span { font-size: 10px; text-transform: uppercase; }
          #print-area .print-kpi-row strong { display: block; font-size: 13px; }
          #print-area .print-alert-section { margin-bottom: 10px; border: 1px dashed #000; padding: 4px 8px; }
          #print-area .print-alert-title { font-weight: bold; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; }
          #print-area .print-alert-item { font-size: 10px; display: flex; justify-content: space-between; border-bottom: 1px dotted #ccc; padding: 1px 0; }
          #print-area table { width: 100%; border-collapse: collapse; font-size: 10px; }
          #print-area thead tr { border-top: 2px solid #000; border-bottom: 2px solid #000; }
          #print-area th { font-weight: bold; text-align: center; padding: 3px 4px; text-transform: uppercase; letter-spacing: 0.04em; }
          #print-area th:first-child { text-align: left; }
          #print-area td { padding: 3px 4px; text-align: center; border-bottom: 1px dotted #aaa; }
          #print-area td:first-child { text-align: left; }
          #print-area tbody tr:last-child td { border-bottom: 2px solid #000; }
          #print-area .print-footer { margin-top: 10px; font-size: 9px; border-top: 1px dashed #000; padding-top: 4px; color: #555; }
          #print-area .print-hide-chart { display: none !important; }
        }
      `}</style>

      <div id="print-area" className="px-6 py-5 bg-gray-50 min-h-screen">

        {/* Header */}
        <div className="flex justify-between items-start mb-5">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Inventory Summary</h1>
            <p className="print-subtitle text-sm text-gray-500 mt-0.5">
              {date ? `Snapshot: ${date}` : "Live Inventory View"} &mdash; {tabLabel}
              {warehouseLabel && ` — 📦 ${warehouseLabel}`}
            </p>
          </div>
          <button
            onClick={printPage}
            className="px-4 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-md transition-colors"
          >
            🖨 Print
          </button>
        </div>

        {/* Toolbar */}
        <div className="no-print flex flex-wrap items-center gap-2 mb-5 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
            {TAB_ORDER.map((t, idx) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${idx > 0 ? "border-l border-gray-200" : ""} ${
                  tab === t ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {cfg(t).label}
              </button>
            ))}
          </div>

          <InventoryCalendar tab={tab} date={date} onSelectDate={setDate} />

          {/* Warehouse filter */}
          <WarehouseMultiSelect
            options={availableWarehouses}
            selected={warehouseFilter}
            onChange={setWarehouseFilter}
          />
        </div>

        {/* KPI cards */}
        <div className="print-kpi-row grid grid-cols-4 gap-3 mb-5">
          {[
            { label: "Items tracked", value: summary.totalItems, color: "bg-blue-600" },
            { label: "Current stock", value: summary.stock,      color: "bg-green-600" },
            { label: "Actual count",  value: summary.actual,     color: "bg-amber-500" },
            { label: "Total loss",    value: summary.loss,       color: "bg-red-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className={`${color} text-white rounded-lg p-4 shadow-sm`}>
              <span className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</span>
              <strong className="block text-2xl font-bold mt-1">{value.toLocaleString()}</strong>
            </div>
          ))}
        </div>

        {/* Alerts */}
        {hasAlerts && (
          <div className="print-alert-section mb-5 bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <div className="print-alert-title flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-red-50">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-900">Needs attention</span>
              </div>
              <span className="text-xs text-gray-400">{outOfStock.length} out · {lowStock.length} low</span>
            </div>
            <ul className="max-h-56 overflow-y-auto divide-y divide-gray-100">
              {priorityList.map((i) => (
                <li key={i.id} className="print-alert-item flex items-center justify-between px-4 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{i.name}</span>
                    {i.warehouse && (
                      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        📦 {i.warehouse}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${
                    i.severity === "out" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                  }`}>
                    {i.severity === "out" ? "0 units — out" : `${i.current_bal} units — low`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Chart — horizontal bar (collapsible) */}
        <div className="print-hide-chart mb-5 bg-white border border-gray-200 rounded-lg shadow-sm p-4">
          <button
            type="button"
            onClick={() => setChartCollapsed((p) => !p)}
            className="w-full flex items-center justify-between mb-3 group"
            aria-expanded={!chartCollapsed}
          >
            <span className="flex items-center gap-2">
              <span
                className={`text-gray-400 text-[10px] transition-transform duration-150 ${
                  chartCollapsed ? "-rotate-90" : ""
                }`}
              >
                ▼
              </span>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 group-hover:text-gray-700">
                Stock vs. loss by item
              </h2>
            </span>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              {!chartCollapsed && (
                <>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-green-600" /> stock</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-red-600" /> loss</span>
                </>
              )}
              <span className="text-gray-300">{chartCollapsed ? "Show" : "Hide"}</span>
            </div>
          </button>
          {!chartCollapsed && (
            <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 32)}>
              <ComposedChart data={chartData} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#9CA3AF" }}
                  axisLine={{ stroke: "#E5E7EB" }}
                  tickLine={false}
                  width={120}
                />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #E5E7EB" }} />
                <Bar dataKey="stock" fill="#16A34A" radius={[0, 3, 3, 0]} />
                <Bar dataKey="loss"  fill="#DC2626" radius={[0, 3, 3, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Detail table */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-gray-50">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {tabLabel} — detail
              {warehouseLabel && ` · ${warehouseLabel}`}
            </span>
            {loading && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Warehouse</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Beg</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Incoming</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Outgoing</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Current</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Actual</th>
                  <th className="px-4 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Loss</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">
                      No inventory data found.
                    </td>
                  </tr>
                )}
                {filteredItems.map((i) => {
                  const isOut = Number(i.current_bal) === 0;
                  const isLow = Number(i.current_bal) > 0 && Number(i.current_bal) < LOW_STOCK_THRESHOLD;
                  return (
                    <tr key={i.id} className={`transition-colors hover:bg-gray-50 ${isOut ? "bg-red-50/60" : isLow ? "bg-amber-50/60" : ""}`}>
                      <td className="px-4 py-3 flex items-center gap-2 font-medium text-gray-900">
                        {isOut && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
                        {isLow && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                        {i.name}
                      </td>
                      <td className="px-4 py-3">
                        {i.warehouse ? (
                          <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded inline-block">
                            {i.warehouse}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">{i.beg_bal}</td>
                      <td className="px-4 py-3 text-center font-semibold text-green-600">
                        {i.incoming_bal > 0 ? `+${i.incoming_bal}` : i.incoming_bal}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-red-600">
                        {i.outgoing_bal > 0 ? `-${i.outgoing_bal}` : i.outgoing_bal}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold ${
                          isOut ? "bg-red-100 text-red-700" : isLow ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"
                        }`}>
                          {i.current_bal}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">{i.actual_bal}</td>
                      <td className="px-4 py-3 text-center font-semibold text-red-500">{i.loss}</td>
                    </tr>
                  );
                })}
              </tbody>
              {filteredItems.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
                    <td className="px-4 py-2.5">Totals</td>
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5 text-center">{filteredItems.reduce((a, b) => a + Number(b.beg_bal), 0)}</td>
                    <td className="px-4 py-2.5 text-center text-green-700">+{filteredItems.reduce((a, b) => a + Number(b.incoming_bal), 0)}</td>
                    <td className="px-4 py-2.5 text-center text-red-700">-{filteredItems.reduce((a, b) => a + Number(b.outgoing_bal), 0)}</td>
                    <td className="px-4 py-2.5 text-center">{summary.stock}</td>
                    <td className="px-4 py-2.5 text-center">{summary.actual}</td>
                    <td className="px-4 py-2.5 text-center text-red-600">{summary.loss}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Print footer */}
        <div className="print-footer hidden print:block mt-4 text-xs text-gray-400 border-t border-dashed border-gray-300 pt-3">
          <div className="flex justify-between">
            <span>
              Inventory System — {tabLabel}
              {warehouseLabel && ` — Warehouse: ${warehouseLabel}`}
            </span>
            <span>Printed: {printedAt}</span>
          </div>
          {date && <span>Snapshot Date: {date}</span>}
        </div>

      </div>
    </>
  );
}