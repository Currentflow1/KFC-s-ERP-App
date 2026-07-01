"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabaseClient";
import InventoryCalendar from "@/app/(protected)/inventory/components/InventoryCalendar";

import {
  ComposedChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

// Fallback only — real threshold comes from each product's own
// low_stock_value (Products page). Mirrors the DB column default.
const DEFAULT_LOW_STOCK_VALUE = 10;

// Coerce any DB value to a finite number, falling back instead of ever
// producing NaN (which React refuses to render and blank/odd values from
// Supabase — null, "", non-numeric strings — would otherwise trigger).
function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

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
    tx: "finished_products_transaction_log",
    fk: "finished_product_id",
  },
  raw: {
    label: "Raw Materials",
    static: "raw_materials_static",
    inv: "raw_materials_inventory",
    hist: "raw_materials_inventory_history",
    wh: "raw_materials_warehouses",
    tx: "raw_materials_transaction_log",
    fk: "raw_material_id",
  },
  packaging: {
    label: "Packaging",
    static: "packaging_static",
    inv: "packaging_inventory",
    hist: "packaging_inventory_history",
    wh: "packaging_warehouses",
    tx: "packaging_transaction_log",
    fk: "packaging_id",
  },
};
const TAB_ORDER = ["finished", "raw", "packaging"];

function cfg(tab) { return TAB_CONFIG[tab] ?? TAB_CONFIG.finished; }

// ── Diverging-chart helper ────────────────────────────────────────────────
// variance = actual_bal - current_bal. Negative = shrinkage/loss (red),
// positive = surplus/overage (green), zero = matched (neutral gray).
function varianceColor(variance) {
  if (variance < 0) return "#DC2626";
  if (variance > 0) return "#16A34A";
  return "#9CA3AF";
}

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

  const tabRef = useRef(tab);
  const dateRef = useRef(date);
  tabRef.current = tab;
  dateRef.current = date;

  useEffect(() => {
    loadAvailableWarehouses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, date]);

  useEffect(() => {
    setWarehouseFilter([]);
  }, [tab, date]);

  // ── Realtime ──────────────────────────────────────────────────────────────
  // Keep the dashboard live: pending orders (tx table), finalize/undo
  // (inv table), and newly finalized history (hist table) all push updates
  // here instead of requiring a manual refresh or tab switch to see them.
  useEffect(() => {
    const tabCfg = cfg(tab);

    const txChannel = supabase
      .channel(`dashboard-${tab}-tx`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: tabCfg.tx },
        () => { if (tabRef.current === tab) loadData(); }
      )
      .subscribe();

    const invChannel = supabase
      .channel(`dashboard-${tab}-inv`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: tabCfg.inv },
        () => { if (tabRef.current === tab) loadData(); }
      )
      .subscribe();

    const histChannel = supabase
      .channel(`dashboard-${tab}-hist`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: tabCfg.hist },
        () => { if (tabRef.current === tab) loadData(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(txChannel);
      supabase.removeChannel(invChannel);
      supabase.removeChannel(histChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
  //
  // IMPORTANT: inventory rows are NOT keyed by the static product's id.
  // Each inventory row (one per product per warehouse) has its own id and
  // points back to the product via a foreign key (raw_material_id /
  // finished_product_id / packaging_id). The previous version of this page
  // tried to look up `map[staticItem.id]` using a map keyed by the
  // inventory row's own id — those are two different UUIDs, so the lookup
  // essentially never matched. It's worse for history rows specifically,
  // since the history table doesn't store the foreign key at all, so no
  // date ever had a chance of matching. Below we join correctly in both
  // directions instead of guessing at shared ids.
  async function loadData() {
    setLoading(true);
    const isHistory = date !== "";
    const tabCfg = cfg(tab);

    try {
      const { data: staticItems } = await supabase
        .from(tabCfg.static)
        .select("id, name, category_name, low_stock_value, discontinued");
      const staticById = new Map((staticItems || []).map((s) => [s.id, s]));

      if (isHistory) {
        // History rows carry their own name/warehouse/balances as a
        // point-in-time snapshot, but not the fk back to the product.
        // Recover it via inventory_id → the live inventory row's fk
        // (the inventory row's id is stable across days; only its
        // balances get rolled forward on finalize).
        const [{ data: histRows }, { data: liveInvRows }] = await Promise.all([
          supabase.from(tabCfg.hist).select("*").eq("inventory_date", date),
          supabase.from(tabCfg.inv).select(`id, ${tabCfg.fk}`),
        ]);
        const fkByInventoryId = new Map(
          (liveInvRows || []).map((r) => [r.id, r[tabCfg.fk]])
        );

        const merged = (histRows || []).map((row) => {
          const fk = fkByInventoryId.get(row.inventory_id) ?? null;
          const s = fk != null ? staticById.get(fk) : null;
          const current_bal = toNum(row.current_bal);
          const actual_bal = toNum(row.actual_bal);
          return {
            id: row.inventory_id,
            name: row.name,
            category_id: s?.category_name ?? null,
            warehouse: row.warehouse ?? null,
            beg_bal: toNum(row.beg_bal),
            incoming_bal: toNum(row.incoming_bal),
            outgoing_bal: toNum(row.outgoing_bal),
            current_bal,
            actual_bal,
            // Signed variance: negative = shortage, positive = surplus.
            variance: actual_bal - current_bal,
            low_stock_value: toNum(s?.low_stock_value, DEFAULT_LOW_STOCK_VALUE),
            _discontinued: !!s?.discontinued,
          };
        });

        setItems(merged);
        return;
      }

      // Live view — same shape as the Inventory tab: base inventory row
      // plus any not-yet-finalized pending tx folded in, so the dashboard
      // always matches what's currently shown there in real time.
      const [{ data: invRows }, { data: txRows }] = await Promise.all([
        supabase.from(tabCfg.inv).select("*"),
        supabase
          .from(tabCfg.tx)
          .select("inventory_id, incoming_bal, outgoing_bal")
          .is("finalized_at", null)
          .is("removed_at", null),
      ]);

      const txTotals = {};
      (txRows || []).forEach(({ inventory_id, incoming_bal, outgoing_bal }) => {
        if (!txTotals[inventory_id]) txTotals[inventory_id] = { incoming: 0, outgoing: 0 };
        txTotals[inventory_id].incoming += toNum(incoming_bal);
        txTotals[inventory_id].outgoing += toNum(outgoing_bal);
      });

      const merged = (invRows || []).map((row) => {
        const tx = txTotals[row.id] ?? { incoming: 0, outgoing: 0 };
        const beg_bal = toNum(row.beg_bal);
        const incoming_bal = toNum(row.incoming_bal) + tx.incoming;
        const outgoing_bal = toNum(row.outgoing_bal) + tx.outgoing;
        const current_bal = beg_bal + incoming_bal - outgoing_bal;
        const actual_bal = toNum(row.actual_bal);
        // Signed variance: negative = shortage, positive = surplus.
        const variance = actual_bal - current_bal;

        const fk = row[tabCfg.fk];
        const s = fk != null ? staticById.get(fk) : null;

        return {
          id: row.id,
          name: row.name,
          category_id: s?.category_name ?? null,
          warehouse: row.warehouse ?? null,
          beg_bal,
          incoming_bal,
          outgoing_bal,
          current_bal,
          actual_bal,
          variance,
          low_stock_value: toNum(s?.low_stock_value, DEFAULT_LOW_STOCK_VALUE),
          _discontinued: !!s?.discontinued,
        };
      });

      setItems(merged);
    } catch (e) {
      console.error("[Dashboard] loadData failed:", e);
      setItems([]);
    } finally {
      setLoading(false);
    }
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
    loss:   filteredItems.reduce((a, b) => a + Math.max(0, -Number(b.variance)), 0),
  }), [filteredItems]);

  const outOfStock = useMemo(
    () => filteredItems.filter((i) => Number(i.current_bal) === 0),
    [filteredItems]
  );

  // Low stock now references each product's own low_stock_value (set on
  // the Products page) instead of one hardcoded number for every item.
  const lowStock = useMemo(
    () => filteredItems.filter((i) => {
      const threshold = Number(i.low_stock_value ?? DEFAULT_LOW_STOCK_VALUE);
      return Number(i.current_bal) > 0 && Number(i.current_bal) < threshold;
    }),
    [filteredItems]
  );

  const priorityList = useMemo(() => {
    const low = [...lowStock].sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ ...i, severity: "low" }));
    const out = [...outOfStock].sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ ...i, severity: "out" }));
    return [...low, ...out];
  }, [outOfStock, lowStock]);

  const hasAlerts = priorityList.length > 0;

  const chartData = useMemo(
    () => filteredItems.map((i) => ({
      name: i.name,
      variance: Number.isFinite(i.variance) ? Number(i.variance) : 0,
    })),
    [filteredItems]
  );

  // Symmetric axis ceiling so shortage (left) and surplus (right) bars
  // both have equal room to diverge from the zero center line.
  const chartMax = useMemo(() => {
    const maxAbs = chartData.reduce((m, d) => Math.max(m, Math.abs(d.variance)), 0);
    return Math.max(5, Math.ceil(maxAbs * 1.15));
  }, [chartData]);

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

          {!date && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
              Live
            </span>
          )}
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
                    {i.severity === "out"
                      ? "0 units — out"
                      : `${i.current_bal} units — low (< ${Number(i.low_stock_value ?? DEFAULT_LOW_STOCK_VALUE)})`}
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
                Actual vs. current variance by item
              </h2>
            </span>
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
              {!chartCollapsed && (
                <>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-red-600" /> shortage</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-green-600" /> surplus</span>
                </>
              )}
              <span className="text-gray-300">{chartCollapsed ? "Show" : "Hide"}</span>
            </div>
          </button>
          {!chartCollapsed && (
            <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 32)}>
              <ComposedChart data={chartData} layout="vertical" margin={{ left: 10, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[-chartMax, chartMax]}
                  tick={{ fontSize: 11, fill: "#9CA3AF" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#000000" }}
                  axisLine={{ stroke: "#E5E7EB" }}
                  tickLine={false}
                  width={120}
                />
                <ReferenceLine x={0} stroke="#D1D5DB" />
                <Tooltip
                  cursor={{ fill: "#F9FAFB" }}
                  contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #E5E7EB" }}
                  formatter={(value) => [value > 0 ? `+${value}` : value, "Variance"]}
                />
                <Bar
                  dataKey="variance"
                  name="Variance"
                  radius={[3, 3, 3, 3]}
                  barSize={14}
                  isAnimationActive={false}
                >
                  {chartData.map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={varianceColor(entry.variance)} />
                  ))}
                </Bar>
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
                  <th className="px-4 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Variance</th>
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
                  const threshold = Number(i.low_stock_value ?? DEFAULT_LOW_STOCK_VALUE);
                  const isOut = Number(i.current_bal) === 0;
                  const isLow = Number(i.current_bal) > 0 && Number(i.current_bal) < threshold;
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
                        <span
                          className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold ${
                            isOut ? "bg-red-100 text-red-700" : isLow ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"
                          }`}
                          title={isLow ? `Below low stock threshold (${threshold})` : undefined}
                        >
                          {i.current_bal}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">{i.actual_bal}</td>
                      <td className="px-4 py-3 text-center">
                        {(() => {
                          const v = Number.isFinite(i.variance) ? i.variance : 0;
                          return (
                            <span
                              className={`font-semibold ${
                                v < 0 ? "text-red-500" : v > 0 ? "text-green-600" : "text-gray-400"
                              }`}
                            >
                              {v > 0 ? `+${v}` : v}
                            </span>
                          );
                        })()}
                      </td>
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