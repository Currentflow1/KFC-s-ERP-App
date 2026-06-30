"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabaseClient";

// ─── helpers ──────────────────────────────────────────────────────────────────

function isoDate(d) { return d.toISOString().slice(0, 10); }

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeStart(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return isoDate(d);
}

function summarize(rows) {
  const days = new Set(rows.map((r) => r.inventory_date));
  return {
    days:     days.size,
    incoming: rows.reduce((a, r) => a + Number(r.incoming_bal || 0), 0),
    outgoing: rows.reduce((a, r) => a + Number(r.outgoing_bal || 0), 0),
    loss:     rows.reduce((a, r) => a + Number(r.loss         || 0), 0),
  };
}

function fmt(n) { return Number(n ?? 0).toLocaleString(); }
function raw(n) { return Number(n ?? 0); }

function fmtDateTime(val) {
  if (!val) return "—";
  const d = new Date(val);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true,
  });
}

function fmtDateTimeCSV(val) {
  if (!val) return "";
  const d   = new Date(val);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── tab → table mapping (Finished / Raw / Packaging) ─────────────────────────

function historyTable(tab) {
  if (tab === "raw")       return "raw_materials_inventory_history";
  if (tab === "packaging") return "packaging_inventory_history";
  return "finished_products_inventory_history";
}
function txLogTable(tab) {
  if (tab === "raw")       return "raw_materials_transaction_log";
  if (tab === "packaging") return "packaging_transaction_log";
  return "finished_products_transaction_log";
}
function whTable(tab) {
  if (tab === "raw")       return "raw_materials_warehouses";
  if (tab === "packaging") return "packaging_warehouses";
  return "finished_products_warehouses";
}
function whFkCol(tab) {
  if (tab === "raw")       return "raw_material_id";
  if (tab === "packaging") return "packaging_id";
  return "finished_product_id";
}
// Raw and Packaging both carry a supplier on incoming stock; Finished does not.
function hasSupplierCol(tab) {
  return tab === "raw" || tab === "packaging";
}

// ─── status helper (mirrors TransactionLogsTable) ─────────────────────────────
// Returns one of: "pending" | "finalized" | "deleted" | "undone_item" |
//                 "undone_session" | "undone" (legacy) | "reverted"

function getTxStatus(row) {
  if (row.removed_at) {
    if (row.removed_reason === "deleted")           return "deleted";
    if (row.removed_reason === "finalize_reverted") return "reverted";
    if (row.removed_reason === "undone_item")       return "undone_item";
    if (row.removed_reason === "undone_session")    return "undone_session";
    return "undone"; // legacy fallback for old rows written before the distinction
  }
  if (row.finalized_at) return "finalized";
  return "pending";
}

function isRemovedStatus(status) {
  return status === "deleted" || status === "undone_item" || status === "undone_session" || status === "undone" || status === "reverted";
}

function statusLabel(status) {
  switch (status) {
    case "finalized":     return "Finalized";
    case "pending":       return "Pending";
    case "deleted":       return "Deleted";
    case "undone_item":   return "Undo item";
    case "undone_session":return "Undo session";
    case "undone":        return "Undone";
    case "reverted":      return "Reopened";
    default:              return status;
  }
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function escapeCSV(v) {
  if (v == null) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(filename, headers, rows) {
  const lines = [
    headers.map(escapeCSV).join(","),
    ...rows.map((r) => r.map(escapeCSV).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportHistoryCSV(rows, tab) {
  const headers = [
    "Date", "Product",
    "Beg", "Incoming", "Outgoing", "Current", "Actual", "Loss",
    "Warehouse", "Recorded At",
  ];
  const data = rows.map((r) => [
    r.inventory_date, r.name,
    raw(r.beg_bal), raw(r.incoming_bal), raw(r.outgoing_bal),
    raw(r.current_bal), raw(r.actual_bal), raw(r.loss),
    r.warehouse ?? "",
    fmtDateTimeCSV(r.created_at),
  ]);
  downloadCSV(`inventory-history-${tab}-${todayLocal()}.csv`, headers, data);
}

function exportTxCSV(rows, tab) {
  const headers = [
    "Created At", "Finalized At",
    "Product", "Type", "Source", "Status",
    "Incoming", "Outgoing", "Actual", "Loss",
    "Monitoring", "Representative", "Staff",
    ...(hasSupplierCol(tab) ? ["Supplier"] : []),
    "Warehouse",
  ];
  const data = rows.map((r) => {
    const status = getTxStatus(r);
    return [
      fmtDateTimeCSV(r.created_at),
      fmtDateTimeCSV(r.finalized_at),
      r.product_name,
      r.transaction_type === "count_correction" ? "Count correction" : "Stock movement",
      r.transaction_source === "manipulated" ? "Manual" : "Ordered",
      statusLabel(status),
      raw(r.incoming_bal), raw(r.outgoing_bal),
      r.actual_bal ?? "", raw(r.loss),
      r.monitoring_employee ?? "", r.representative_employee ?? "", r.staff_employee ?? "",
      ...(hasSupplierCol(tab) ? [r.supplier_name ?? ""] : []),
      r.warehouse ?? "",
    ];
  });
  downloadCSV(`transaction-log-${tab}-${todayLocal()}.csv`, headers, data);
}

function exportAllCSV(histRows, txRows, tab) {
  const supplierCol = hasSupplierCol(tab);
  const headers = [
    "Section",
    "Date / Created At", "Finalized At", "Product",
    "Beg", "Current", "Actual",
    "Incoming", "Outgoing", "Loss",
    "Type", "Source", "Status",
    "Monitoring", "Representative", "Staff",
    ...(supplierCol ? ["Supplier"] : []),
    "Warehouse",
    "Recorded At",
  ];

  const histData = histRows.map((r) => [
    "Finalized History",
    r.inventory_date, "", r.name,
    raw(r.beg_bal), raw(r.current_bal), raw(r.actual_bal),
    raw(r.incoming_bal), raw(r.outgoing_bal), raw(r.loss),
    "", "", "",
    "", "", "",
    ...(supplierCol ? [""] : []),
    r.warehouse ?? "",
    fmtDateTimeCSV(r.created_at),
  ]);

  const sep = headers.map((_, i) => i === 0 ? "--- Transaction Log ---" : "");

  const txData = txRows.map((r) => {
    const status = getTxStatus(r);
    return [
      "Transaction Log",
      fmtDateTimeCSV(r.created_at),
      fmtDateTimeCSV(r.finalized_at),
      r.product_name,
      "", "", "",
      raw(r.incoming_bal), raw(r.outgoing_bal), raw(r.loss),
      r.transaction_type === "count_correction" ? "Count correction" : "Stock movement",
      r.transaction_source === "manipulated" ? "Manual" : "Ordered",
      statusLabel(status),
      r.monitoring_employee ?? "", r.representative_employee ?? "", r.staff_employee ?? "",
      ...(supplierCol ? [r.supplier_name ?? ""] : []),
      r.warehouse ?? "",
      "",
    ];
  });

  downloadCSV(`all-records-${tab}-${todayLocal()}.csv`, headers, [...histData, sep, ...txData]);
}

// ─── dot-matrix print ─────────────────────────────────────────────────────────

function col(value, width, align = "left") {
  const s = String(value ?? "").slice(0, width);
  return align === "right" ? s.padStart(width) : s.padEnd(width);
}

function buildDotMatrixHTML({ tab, dateFrom, dateTo, histRows, txRows, active, period, hasSupplier }) {
  const W       = 132;
  const divider = "-".repeat(W);
  const title   = `INVENTORY RECORDS — ${tab.toUpperCase()} MATERIALS`;
  const filter  = dateFrom || dateTo
    ? `Period: ${dateFrom || "start"} to ${dateTo || todayLocal()}`
    : `Printed: ${new Date().toLocaleString(undefined, {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
      })}`;

  const lines = [];
  lines.push(title.padStart(Math.floor((W + title.length) / 2)));
  lines.push(filter);
  lines.push("");

  if (active && active.days > 0) {
    const periodLabel = period === "weekly" ? "Last 7 days" : "Last 30 days";
    lines.push(`SUMMARY — ${periodLabel} (${active.days} closed day${active.days === 1 ? "" : "s"})`);
    lines.push(divider);
    lines.push(
      col("Incoming", 20) + col(String(active.incoming), 20, "right") +
      col("Outgoing", 20) + col(String(active.outgoing), 20, "right") +
      col("Loss",     20) + col(String(active.loss),     12, "right")
    );
    lines.push(divider);
    lines.push("");
  }

  // history
  lines.push("FINALIZED HISTORY");
  lines.push(divider);
  lines.push(
    col("Date",      12) + col("Product",    28) +
    col("Beg",        8, "right") + col("In",  8, "right") + col("Out",     8, "right") +
    col("Current",   10, "right") + col("Actual", 8, "right") + col("Loss", 8, "right") +
    col("Warehouse", 18) + col("Recorded At", 24)
  );
  lines.push(divider);
  if (histRows.length === 0) {
    lines.push("  (no records)");
  } else {
    histRows.forEach((r) => {
      lines.push(
        col(r.inventory_date,   12) + col(r.name,           28) +
        col(raw(r.beg_bal),      8, "right") + col(raw(r.incoming_bal), 8, "right") +
        col(raw(r.outgoing_bal), 8, "right") +
        col(raw(r.current_bal), 10, "right") + col(raw(r.actual_bal),   8, "right") +
        col(raw(r.loss),         8, "right") +
        col(r.warehouse ?? "",  18) +
        col(fmtDateTimeCSV(r.created_at), 24)
      );
    });
  }
  lines.push(divider);
  lines.push(`  Total records: ${histRows.length}`);
  lines.push("");

  // tx log
  lines.push("TRANSACTION LOG");
  lines.push(divider);
  const txHdr = [
    col("Created At",  22), col("Finalized At", 22), col("Product",  22),
    col("Type",        14), col("Source",       12), col("Status",   16),
    col("In",  8, "right"), col("Out", 8, "right"),
    col("Monitoring", 18), col("Rep.", 16),
    ...(hasSupplier ? [col("Supplier", 18)] : []),
    col("Warehouse", 14),
  ];
  lines.push(txHdr.join(""));
  lines.push(divider);
  if (txRows.length === 0) {
    lines.push("  (no transactions)");
  } else {
    txRows.forEach((r) => {
      const status = getTxStatus(r);
      const rowCols = [
        col(fmtDateTimeCSV(r.created_at),   22),
        col(fmtDateTimeCSV(r.finalized_at), 22),
        col(r.product_name ?? "",           22),
        col(r.transaction_type === "count_correction" ? "Count corr." : "Stock move", 14),
        col(r.transaction_source === "manipulated" ? "Manual" : "Ordered", 12),
        col(statusLabel(status), 16),
        col(raw(r.incoming_bal),  8, "right"),
        col(raw(r.outgoing_bal),  8, "right"),
        col(r.monitoring_employee ?? "",    18),
        col(r.representative_employee ?? "", 16),
        ...(hasSupplier ? [col(r.supplier_name ?? "", 18)] : []),
        col(r.warehouse ?? "", 14),
      ];
      lines.push(rowCols.join(""));
    });
  }
  lines.push(divider);
  lines.push(`  Total entries: ${txRows.length}`);
  lines.push("");
  lines.push("*** END OF REPORT ***".padStart(Math.floor((W + 21) / 2)));

  const preContent = lines.join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Records — ${tab} — ${todayLocal()}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Courier New", Courier, monospace;
    font-size: 9pt;
    line-height: 1.45;
    background: #fff;
    color: #000;
    padding: 12mm 10mm;
  }
  body::before {
    content: "";
    display: block;
    border-top: 2px dashed #bbb;
    margin-bottom: 6mm;
  }
  pre { white-space: pre; overflow-x: visible; }
  @media print {
    body { padding: 6mm 8mm; }
    body::before { border-top: 2px dashed #999; }
    @page { size: landscape; margin: 6mm; }
  }
</style>
</head>
<body>
<pre>${preContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
<script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`;
}

function openDotMatrixPrint(opts) {
  const html = buildDotMatrixHTML(opts);
  const win  = window.open("", "_blank", "width=1200,height=800");
  if (!win) { alert("Pop-up blocked — please allow pop-ups for this page."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, colorClass, sub }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>{fmt(value)}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function EmptyState({ message }) {
  return <div className="py-10 text-center text-sm text-gray-500">{message}</div>;
}

function Badge({ children, color = "gray" }) {
  const colors = {
    gray:   "bg-gray-100 text-gray-700",
    green:  "bg-green-50 text-green-700",
    red:    "bg-red-50 text-red-600",
    blue:   "bg-blue-50 text-blue-700",
    amber:  "bg-amber-50 text-amber-700",
    purple: "bg-purple-50 text-purple-700",
    slate:  "bg-slate-100 text-slate-700 border border-slate-200",
    orange: "bg-orange-50 text-orange-700 border border-orange-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

function IconButton({ onClick, title, children, disabled = false }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-colors bg-white border-gray-200 text-black hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function SectionHeader({ title, count, countLabel, open, onToggle, actions }) {
  return (
    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
      <button onClick={onToggle} className="flex items-center gap-2 text-left group">
        <span className={`text-black text-xs transition-transform duration-200 ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="text-sm font-semibold text-black group-hover:text-gray-900 transition-colors">{title}</span>
        {count > 0 && (
          <span className="text-xs text-gray-500">
            {count.toLocaleString()} {countLabel}{count === 1 ? "" : "s"}
          </span>
        )}
      </button>
      {actions && open && (
        <div className="flex items-center gap-1.5">{actions}</div>
      )}
    </div>
  );
}

// Status badge — mirrors the 6-state badge system in TransactionLogsTable
function TxStatusBadge({ row }) {
  const status = getTxStatus(row);
  const ts = row.removed_at ? fmtDateTime(row.removed_at) : null;

  if (status === "finalized") {
    return (
      <Badge color="green">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
        Finalized
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge color="amber">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
        Pending
      </Badge>
    );
  }
  if (status === "deleted") {
    return (
      <span title={ts ? `Deleted ${ts}` : undefined}>
        <Badge color="red">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
          Deleted
        </Badge>
      </span>
    );
  }
  if (status === "undone_item" || status === "undone") {
    return (
      <span title={ts ? `Undo item ${ts}` : undefined}>
        <Badge color="gray">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
          ↩ Undo item
        </Badge>
      </span>
    );
  }
  if (status === "undone_session") {
    return (
      <span title={ts ? `Undo session ${ts}` : undefined}>
        <Badge color="slate">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
          ↩ Undo session
        </Badge>
      </span>
    );
  }
  if (status === "reverted") {
    return (
      <span title={ts ? `Finalize undone ${ts} — reopened as a new pending order` : undefined}>
        <Badge color="orange">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
          ↺ Reopened
        </Badge>
      </span>
    );
  }
  return <Badge color="gray">{status}</Badge>;
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function RecordsPage() {
  const supabase = createClient();

  const [tab,    setTab]    = useState("finished");
  const [period, setPeriod] = useState("weekly");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");

  const [weekly,      setWeekly]      = useState(null);
  const [monthly,     setMonthly]     = useState(null);
  const [summaryLoad, setSummaryLoad] = useState(true);

  const [histRows, setHistRows] = useState([]);
  const [histLoad, setHistLoad] = useState(false);
  const [histOpen, setHistOpen] = useState(true);

  const [txRows, setTxRows] = useState([]);
  const [txLoad, setTxLoad] = useState(false);
  const [txOpen, setTxOpen] = useState(true);

  const [histWarehouseMap, setHistWarehouseMap] = useState({});
  const [txWarehouseMap,   setTxWarehouseMap]   = useState({});

  const [histPage, setHistPage] = useState(1);
  const [txPage,   setTxPage]   = useState(1);
  const PAGE = 20;

  const tabRef = useRef("finished");
  tabRef.current = tab;

  // ── warehouse maps ────────────────────────────────────────────────────────

  async function loadWarehouseMaps(whichTab) {
    const fkCol = whFkCol(whichTab);
    const { data } = await supabase
      .from(whTable(whichTab))
      .select(`${fkCol}, warehouse`);
    const map = {};
    (data || []).forEach((row) => {
      const id = row[fkCol];
      if (!map[id]) map[id] = [];
      map[id].push(row.warehouse);
    });
    const strMap = {};
    Object.entries(map).forEach(([id, arr]) => { strMap[id] = arr.join(", "); });
    setHistWarehouseMap(strMap);
    setTxWarehouseMap(strMap);
  }

  // ── data loaders ──────────────────────────────────────────────────────────

  async function loadSummary(whichTab) {
    setSummaryLoad(true);
    const today      = todayLocal();
    const weekStart  = rangeStart(6);
    const monthStart = rangeStart(29);
    const { data } = await supabase
      .from(historyTable(whichTab))
      .select("inventory_date, incoming_bal, outgoing_bal, loss")
      .gte("inventory_date", monthStart)
      .lte("inventory_date", today);
    const rows     = data || [];
    const weekRows = rows.filter((r) => r.inventory_date >= weekStart);
    setWeekly(summarize(weekRows));
    setMonthly(summarize(rows));
    setSummaryLoad(false);
  }

  async function loadHistory(whichTab, from, to) {
    setHistLoad(true); setHistPage(1);
    let q = supabase.from(historyTable(whichTab)).select("*")
      .order("inventory_date", { ascending: false })
      .order("name",           { ascending: true });
    if (from) q = q.gte("inventory_date", from);
    if (to)   q = q.lte("inventory_date", to);
    const { data } = await q;
    setHistRows(data || []);
    setHistLoad(false);
  }

  async function loadTxLog(whichTab, from, to) {
    setTxLoad(true); setTxPage(1);
    // NOTE: removed_at filter intentionally omitted — we want ALL rows including
    // deleted / undone / reverted so the status badges are visible in the log.
    let q = supabase.from(txLogTable(whichTab)).select("*")
      .order("created_at", { ascending: false });
    if (from) q = q.gte("created_at", from);
    if (to)   q = q.lte("created_at", to + "T23:59:59.999Z");
    const { data } = await q;
    setTxRows(data || []);
    setTxLoad(false);
  }

  useEffect(() => {
    loadWarehouseMaps(tab);
    loadSummary(tab);
    loadHistory(tab, dateFrom, dateTo);
    loadTxLog(tab, dateFrom, dateTo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function applyDateFilter() {
    loadHistory(tab, dateFrom, dateTo);
    loadTxLog(tab, dateFrom, dateTo);
  }

  function clearDateFilter() {
    setDateFrom(""); setDateTo("");
    loadHistory(tab, "", "");
    loadTxLog(tab, "", "");
  }

  function resolveHistWarehouse(row) {
    if (row.warehouse) return row.warehouse;
    return histWarehouseMap[row.inventory_id] ?? "—";
  }

  function resolveTxWarehouse(row) {
    if (row.warehouse) return row.warehouse;
    return txWarehouseMap[row.inventory_id] ?? "—";
  }

  // ── enriched rows ─────────────────────────────────────────────────────────

  const enrichedHistRows = histRows.map((r) => ({
    ...r,
    _warehouse: resolveHistWarehouse(r),
  }));

  const enrichedTxRows = txRows.map((r) => ({
    ...r,
    _warehouse: resolveTxWarehouse(r),
  }));

  // ── print / export helpers ────────────────────────────────────────────────

  const printOpts = () => ({
    tab, dateFrom, dateTo,
    histRows: enrichedHistRows.map((r) => ({ ...r, warehouse: r._warehouse })),
    txRows:   enrichedTxRows.map((r)  => ({ ...r, warehouse: r._warehouse })),
    active: period === "weekly" ? weekly : monthly,
    period,
    hasSupplier: hasSupplierCol(tab),
  });

  // ── derived ───────────────────────────────────────────────────────────────

  const active  = period === "weekly" ? weekly : monthly;
  const hasSum  = active && active.days > 0;
  const showSum = !summaryLoad && weekly && monthly && (weekly.days > 0 || monthly.days > 0);

  const histSlice = enrichedHistRows.slice((histPage - 1) * PAGE, histPage * PAGE);
  const histPages = Math.ceil(enrichedHistRows.length / PAGE);
  const txSlice   = enrichedTxRows.slice((txPage - 1) * PAGE, txPage * PAGE);
  const txPages   = Math.ceil(enrichedTxRows.length / PAGE);

  // ── tx table headers ──────────────────────────────────────────────────────

  const txHeaders = [
    "Created At", "Finalized At",
    "Product", "Type", "Source", "Status",
    "In", "Out", "Actual", "Loss",
    "Monitoring", "Representative", "Staff",
    ...(hasSupplierCol(tab) ? ["Supplier"] : []),
    "Warehouse",
  ];

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">

      {/* Page header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Records</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Finalized history, transaction log, and inventory summaries
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => exportAllCSV(
              enrichedHistRows.map((r) => ({ ...r, warehouse: r._warehouse })),
              enrichedTxRows.map((r)  => ({ ...r, warehouse: r._warehouse })),
              tab
            )}
            disabled={histRows.length === 0 && txRows.length === 0}
            title="Download all records as CSV"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-black text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ⬇ CSV All
          </button>
          <button
            onClick={() => openDotMatrixPrint(printOpts())}
            title="Print full report (dot matrix)"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-black text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            🖨️ Print All
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
          <button onClick={() => setTab("finished")}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "finished" ? "bg-blue-600 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
            Finished
          </button>
          <button onClick={() => setTab("raw")}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${tab === "raw" ? "bg-blue-600 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
            Raw
          </button>
          <button onClick={() => setTab("packaging")}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${tab === "packaging" ? "bg-blue-600 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
            Packaging
          </button>
        </div>

        <div className="w-px h-6 bg-gray-200 mx-0.5" />

        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-black font-semibold">From</label>
          <input type="date" value={dateFrom} max={dateTo || todayLocal()}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <label className="text-xs text-black font-semibold">To</label>
          <input type="date" value={dateTo} min={dateFrom || undefined} max={todayLocal()}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={applyDateFilter}
            className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors">
            Apply
          </button>
          {(dateFrom || dateTo) && (
            <button onClick={clearDateFilter}
              className="px-3 py-1.5 rounded-md bg-white border border-gray-200 text-black hover:bg-gray-50 text-sm transition-colors">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      {showSum && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-black uppercase tracking-wide">Summary</h2>
              {active && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {period === "weekly" ? "Last 7 days" : "Last 30 days"}
                  {active.days > 0
                    ? ` — ${active.days} closed day${active.days === 1 ? "" : "s"}`
                    : " — no data yet"}
                </p>
              )}
            </div>
            <div className="flex rounded-md border border-gray-200 overflow-hidden">
              <button onClick={() => setPeriod("weekly")}
                className={`px-3 py-1 text-xs font-medium transition-colors ${period === "weekly" ? "bg-blue-600 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
                Weekly
              </button>
              <button onClick={() => setPeriod("monthly")}
                className={`px-3 py-1 text-xs font-medium border-l border-gray-200 transition-colors ${period === "monthly" ? "bg-blue-600 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
                Monthly
              </button>
            </div>
          </div>
          {hasSum ? (
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Incoming" value={active.incoming} colorClass="text-green-600" sub={`across ${active.days} day${active.days === 1 ? "" : "s"}`} />
              <StatCard label="Outgoing" value={active.outgoing} colorClass="text-red-500"   sub={`across ${active.days} day${active.days === 1 ? "" : "s"}`} />
              <StatCard label="Loss"     value={active.loss}     colorClass="text-orange-500" sub={`across ${active.days} day${active.days === 1 ? "" : "s"}`} />
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg px-5 py-4 shadow-sm">
              <p className="text-sm text-gray-500">No finalized days in this period yet.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Finalized History ── */}
      <div className="mb-5">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <SectionHeader
            title="Finalized History"
            count={enrichedHistRows.length}
            countLabel="record"
            open={histOpen}
            onToggle={() => setHistOpen((v) => !v)}
            actions={enrichedHistRows.length > 0 ? (
              <>
                <IconButton
                  onClick={() => exportHistoryCSV(
                    enrichedHistRows.map((r) => ({ ...r, warehouse: r._warehouse })), tab
                  )}
                  title="Export history as CSV"
                >
                  ⬇ CSV
                </IconButton>
                <IconButton
                  onClick={() => openDotMatrixPrint({ ...printOpts(), txRows: [] })}
                  title="Print history (dot matrix)"
                >
                  🖨️ Print
                </IconButton>
              </>
            ) : null}
          />

          {histOpen && (
            histLoad ? (
              <div className="py-10 text-center text-sm text-gray-500 animate-pulse">Loading…</div>
            ) : enrichedHistRows.length === 0 ? (
              <EmptyState message="No finalized history found. Finalize a day in Inventory to see records here." />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        {["Date", "Product", "Beg", "Incoming", "Outgoing", "Current", "Actual", "Loss", "Warehouse", "Recorded At"].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {histSlice.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-2.5 text-black whitespace-nowrap">{row.inventory_date}</td>
                          <td className="px-4 py-2.5 font-medium text-black">{row.name}</td>
                          <td className="px-4 py-2.5 text-black">{fmt(row.beg_bal)}</td>
                          <td className="px-4 py-2.5 text-green-600 font-medium">{fmt(row.incoming_bal)}</td>
                          <td className="px-4 py-2.5 text-red-500 font-medium">{fmt(row.outgoing_bal)}</td>
                          <td className="px-4 py-2.5 text-black font-semibold">{fmt(row.current_bal)}</td>
                          <td className="px-4 py-2.5 text-black">{fmt(row.actual_bal)}</td>
                          <td className="px-4 py-2.5">
                            {Number(row.loss) > 0
                              ? <span className="text-orange-500 font-medium">{fmt(row.loss)}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-black whitespace-nowrap">{row._warehouse}</td>
                          <td className="px-4 py-2.5 text-black whitespace-nowrap text-xs">{fmtDateTime(row.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {histPages > 1 && (
                  <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-black">
                    <span>Page {histPage} of {histPages}</span>
                    <div className="flex gap-1">
                      <button onClick={() => setHistPage((p) => Math.max(1, p - 1))} disabled={histPage === 1}
                        className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">←</button>
                      <button onClick={() => setHistPage((p) => Math.min(histPages, p + 1))} disabled={histPage === histPages}
                        className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">→</button>
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>

      {/* ── Transaction Log ── */}
      <div>
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <SectionHeader
            title="Transaction Log"
            count={enrichedTxRows.length}
            countLabel="entr"
            open={txOpen}
            onToggle={() => setTxOpen((v) => !v)}
            actions={enrichedTxRows.length > 0 ? (
              <>
                <IconButton
                  onClick={() => exportTxCSV(
                    enrichedTxRows.map((r) => ({ ...r, warehouse: r._warehouse })), tab
                  )}
                  title="Export transaction log as CSV"
                >
                  ⬇ CSV
                </IconButton>
                <IconButton
                  onClick={() => openDotMatrixPrint({ ...printOpts(), histRows: [], active: null })}
                  title="Print transaction log (dot matrix)"
                >
                  🖨️ Print
                </IconButton>
              </>
            ) : null}
          />

          {txOpen && (
            txLoad ? (
              <div className="py-10 text-center text-sm text-gray-500 animate-pulse">Loading…</div>
            ) : enrichedTxRows.length === 0 ? (
              <EmptyState message="No transactions found for this period." />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        {txHeaders.map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {txSlice.map((row) => {
                        const status      = getTxStatus(row);
                        const removed     = isRemovedStatus(status);
                        const isManip     = row.transaction_source === "manipulated";
                        const isCorr      = row.transaction_type   === "count_correction";
                        const dimClass    = removed ? "opacity-50 line-through" : "";
                        const rowBg       =
                          status === "deleted"       ? "bg-red-50/40 border-l-4 border-red-300" :
                          status === "undone_item"   ? "bg-gray-50/70 border-l-4 border-slate-300" :
                          status === "undone_session"? "bg-gray-50/70 border-l-4 border-slate-300" :
                          status === "undone"        ? "bg-gray-50/70 border-l-4 border-slate-300" :
                          status === "reverted"      ? "bg-orange-50/40 border-l-4 border-orange-300" :
                          isCorr                     ? "bg-purple-50/30" : "";

                        return (
                          <tr key={row.id} className={`hover:bg-gray-50 transition-colors ${rowBg}`}>
                            <td className={`px-4 py-2.5 text-black whitespace-nowrap text-xs ${dimClass}`}>
                              {fmtDateTime(row.created_at)}
                            </td>
                            <td className={`px-4 py-2.5 text-black whitespace-nowrap text-xs ${dimClass}`}>
                              {fmtDateTime(row.finalized_at)}
                            </td>
                            <td className={`px-4 py-2.5 font-medium text-black ${dimClass}`}>
                              {row.product_name}
                            </td>

                            {/* Type */}
                            <td className="px-4 py-2.5">
                              <span className={dimClass}>
                                {isCorr
                                  ? <Badge color="purple">🔢 Count correction</Badge>
                                  : <Badge color="blue">Stock movement</Badge>}
                              </span>
                            </td>

                            {/* Source */}
                            <td className="px-4 py-2.5">
                              <span className={dimClass}>
                                {isManip
                                  ? <Badge color="amber">⚙ Manual</Badge>
                                  : <Badge color="gray">📋 Ordered</Badge>}
                              </span>
                            </td>

                            {/* Status — 6-state badge */}
                            <td className="px-4 py-2.5">
                              <TxStatusBadge row={row} />
                            </td>

                            <td className={`px-4 py-2.5 text-green-600 font-medium ${dimClass}`}>
                              {Number(row.incoming_bal) > 0 ? fmt(row.incoming_bal) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className={`px-4 py-2.5 text-red-500 font-medium ${dimClass}`}>
                              {Number(row.outgoing_bal) > 0 ? fmt(row.outgoing_bal) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className={`px-4 py-2.5 text-black ${dimClass}`}>
                              {row.actual_bal != null ? fmt(row.actual_bal) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-2.5">
                              {Number(row.loss) > 0
                                ? <span className={`text-orange-500 font-medium ${dimClass}`}>{fmt(row.loss)}</span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                            <td className={`px-4 py-2.5 text-black ${dimClass}`}>{row.monitoring_employee ?? "—"}</td>
                            <td className={`px-4 py-2.5 text-black ${dimClass}`}>{row.representative_employee ?? "—"}</td>
                            <td className={`px-4 py-2.5 text-black ${dimClass}`}>{row.staff_employee ?? "—"}</td>
                            {hasSupplierCol(tab) && (
                              <td className={`px-4 py-2.5 text-black ${dimClass}`}>{row.supplier_name ?? "—"}</td>
                            )}
                            <td className={`px-4 py-2.5 text-black whitespace-nowrap ${dimClass}`}>{row._warehouse}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {txPages > 1 && (
                  <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-black">
                    <span>Page {txPage} of {txPages}</span>
                    <div className="flex gap-1">
                      <button onClick={() => setTxPage((p) => Math.max(1, p - 1))} disabled={txPage === 1}
                        className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">←</button>
                      <button onClick={() => setTxPage((p) => Math.min(txPages, p + 1))} disabled={txPage === txPages}
                        className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">→</button>
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}