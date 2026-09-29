"use client";

import { useEffect, useState, useRef, Fragment } from "react";
import { createClient } from "@/lib/supabaseClient";
import { getCache, setCache } from "@/lib/sync";

// ─── helpers ──────────────────────────────────────────────────────────────────

function isoDate(d) { return d.toISOString().slice(0, 10); }

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

// A dropped connection surfaces from supabase-js as an error object whose
// message is "TypeError: Failed to fetch" (it does not throw).
function isNetworkError(msg) {
  return /failed to fetch|network|load failed/i.test(msg ?? "");
}

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
    days: days.size,
    incoming: rows.reduce((a, r) => a + Number(r.incoming_bal || 0), 0),
    outgoing: rows.reduce((a, r) => a + Number(r.outgoing_bal || 0), 0),
    loss: rows.reduce((a, r) => a + Number(r.loss || 0), 0),
  };
}

function fmt(n) { return Number(n ?? 0).toLocaleString(); }
function raw(n) { return Number(n ?? 0); }

// Renders the "Loss" cell.
// loss is a SIGNED value stored directly on the row (actual_bal - current_bal),
// written consistently by InventoryPage.js's loadData / prewarmOtherTab /
// undoItemChange / runFinalize. Same convention everywhere:
// loss < 0  -> deficit (actual < current) -> red, shown with its negative sign
// loss > 0  -> surplus (actual > current) -> green, prefixed with "+"
// loss = 0  -> dash
function renderLoss(lossVal, dimClass = "") {
  const n = raw(lossVal);
  if (n < 0) {
    return <span className={`text-red-500 font-medium ${dimClass}`}>{fmt(n)}</span>;
  }
  if (n > 0) {
    return <span className={`text-green-600 font-medium ${dimClass}`}>+{fmt(n)}</span>;
  }
  return <span className="text-gray-300">—</span>;
}

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
  const d = new Date(val);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── tab → table mapping (Raw / Finished / Packaging) ─────────────────────────

function historyTable(tab) {
  if (tab === "raw") return "raw_materials_inventory_history";
  if (tab === "packaging") return "packaging_inventory_history";
  return "finished_products_inventory_history";
}
function txLogTable(tab) {
  if (tab === "raw") return "raw_materials_transaction_log";
  if (tab === "packaging") return "packaging_transaction_log";
  return "finished_products_transaction_log";
}
// The *live inventory* table — this is what inventory_id on history/tx-log
// rows actually points to (see the *_inventory_id_fkey constraints in the
// schema). Each row here has exactly one `warehouse`, so this is the
// correct source for resolving a history/tx row's warehouse when the row
// itself doesn't carry its own `warehouse` value.
function invTable(tab) {
  if (tab === "raw") return "raw_materials_inventory";
  if (tab === "packaging") return "packaging_inventory";
  return "finished_products_inventory";
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
    if (row.removed_reason === "deleted") return "deleted";
    if (row.removed_reason === "finalize_reverted") return "reverted";
    if (row.removed_reason === "undone_item") return "undone_item";
    if (row.removed_reason === "undone_session") return "undone_session";
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
    case "finalized": return "Finalized";
    case "pending": return "Pending";
    case "deleted": return "Deleted";
    case "undone_item": return "Undo item";
    case "undone_session": return "Undo session";
    case "undone": return "Undone";
    case "reverted": return "Reopened";
    default: return status;
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportHistoryCSV(rows, tab) {
  const headers = [
    "Date", "Product",
    "Beg", "Incoming", "Outgoing", "Current", "Actual", "S/O",
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

function exportMonthlySummaryCSV(rows, tab, monthLabel) {
  const headers = ["Product", "Beg Bal", "Incoming", "Outgoing", "Current Bal", "Actual Bal", "S/O"];
  const data = rows.map((p) => [
    p.name,
    raw(p.beg_bal), raw(p.incoming), raw(p.outgoing),
    raw(p.current_bal), raw(p.actual_bal), raw(p.loss),
  ]);
  downloadCSV(`monthly-summary-${tab}-${todayLocal()}.csv`, headers, data);
}


function exportTxCSV(rows, tab) {
  const headers = [
    "Created At", "Finalized At",
    "Product", "Type", "Source", "Status",
    "Incoming", "Outgoing", "Actual", "S/O",
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
    "Incoming", "Outgoing", "S/O",
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
  const W = 132;
  const divider = "-".repeat(W);
  const title = `INVENTORY RECORDS — ${tab.toUpperCase()} MATERIALS`;
  const filter = dateFrom || dateTo
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
      col("S/O", 20) + col(String(active.loss), 12, "right")
    );
    lines.push(divider);
    lines.push("");
  }

  // history
  lines.push("FINALIZED HISTORY");
  lines.push(divider);
  lines.push(
    col("Date", 12) + col("Product", 28) +
    col("Beg", 8, "right") + col("In", 8, "right") + col("Out", 8, "right") +
    col("Current", 10, "right") + col("Actual", 8, "right") + col("S/O", 8, "right") +
    col("", 3) + col("Warehouse", 18) + col("Recorded At", 24)
  );
  lines.push(divider);
  if (histRows.length === 0) {
    lines.push("  (no records)");
  } else {
    histRows.forEach((r) => {
      lines.push(
        col(r.inventory_date, 12) + col(r.name, 28) +
        col(raw(r.beg_bal), 8, "right") + col(raw(r.incoming_bal), 8, "right") +
        col(raw(r.outgoing_bal), 8, "right") +
        col(raw(r.current_bal), 10, "right") + col(raw(r.actual_bal), 8, "right") +
        col(raw(r.loss), 8, "right") +
        col("", 3) + col(r.warehouse ?? "", 18) +
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
    col("Created At", 22), col("Finalized At", 22), col("Product", 22),
    col("Type", 14), col("Source", 12), col("Status", 16),
    col("In", 8, "right"), col("Out", 8, "right"),
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
        col(fmtDateTimeCSV(r.created_at), 22),
        col(fmtDateTimeCSV(r.finalized_at), 22),
        col(r.product_name ?? "", 22),
        col(r.transaction_type === "count_correction" ? "Count corr." : "Stock move", 14),
        col(r.transaction_source === "manipulated" ? "Manual" : "Ordered", 12),
        col(statusLabel(status), 16),
        col(raw(r.incoming_bal), 8, "right"),
        col(raw(r.outgoing_bal), 8, "right"),
        col(r.monitoring_employee ?? "", 18),
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

function buildMonthlySummaryHTML({ tab, monthLabel, rows }) {
  const W = 110;
  const divider = "-".repeat(W);
  const title = `MONTHLY SUMMARY — ${tab.toUpperCase()} MATERIALS`;

  const lines = [];
  lines.push(title.padStart(Math.floor((W + title.length) / 2)));
  lines.push(monthLabel || "");
  lines.push("");
  lines.push(
    col("Product", 30) +
    col("Beg", 12, "right") + col("Incoming", 12, "right") + col("Outgoing", 12, "right") +
    col("Current", 12, "right") + col("Actual", 12, "right") + col("S/O", 10, "right")
  );
  lines.push(divider);
  if (rows.length === 0) {
    lines.push("  (no records)");
  } else {
    rows.forEach((p) => {
      lines.push(
        col(p.name, 30) +
        col(raw(p.beg_bal), 12, "right") + col(raw(p.incoming), 12, "right") + col(raw(p.outgoing), 12, "right") +
        col(raw(p.current_bal), 12, "right") + col(raw(p.actual_bal), 12, "right") + col(raw(p.loss), 10, "right")
      );
    });
  }
  lines.push(divider);
  lines.push(`  Total products: ${rows.length}`);
  lines.push("");
  lines.push("*** END OF REPORT ***".padStart(Math.floor((W + 21) / 2)));

  const preContent = lines.join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Monthly Summary — ${tab} — ${todayLocal()}</title>
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

function openMonthlySummaryPrint(opts) {
  const html = buildMonthlySummaryHTML(opts);
  const win = window.open("", "_blank", "width=1200,height=800");
  if (!win) { alert("Pop-up blocked — please allow pop-ups for this page."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function openDotMatrixPrint(opts) {
  const html = buildDotMatrixHTML(opts);
  const win = window.open("", "_blank", "width=1200,height=800");
  if (!win) { alert("Pop-up blocked — please allow pop-ups for this page."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, colorClass, sub }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 mb-0.5">{label}</p>
      <p className={`text-base font-bold ${colorClass}`}>{fmt(value)}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function EmptyState({ message }) {
  return <div className="py-10 text-center text-sm text-gray-500">{message}</div>;
}

function Badge({ children, color = "gray" }) {
  const colors = {
    gray: "bg-gray-100 text-gray-700",
    green: "bg-green-50 text-green-700",
    red: "bg-red-50 text-red-600",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    purple: "bg-purple-50 text-purple-700",
    slate: "bg-slate-100 text-slate-700 border border-slate-200",
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

const CATEGORIES = ["raw", "finished", "packaging"];
const CATEGORY_LABELS = { raw: "Raw", finished: "Finished", packaging: "Packaging" };

export default function RecordsPage() {
  const supabase = createClient();

  // Raw is now the default landing tab (was "finished").
  const [tab, setTab] = useState("raw");
  const [period, setPeriod] = useState("weekly");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Offline: data comes from the last saved copy instead of the server.
  const [offline, setOffline] = useState(false);
  const wasOffline = useRef(false);

  // Monthly per-product summary table for the currently selected tab.
  // Each row = one product: beg_bal is its balance on the 1st of the
  // month, incoming/outgoing are summed across every finalized day this
  // month, current_bal/actual_bal are taken from the most recent finalized
  // day, and S/O (loss) is computed last as actual - current.
  const [monthlyRows, setMonthlyRows] = useState([]);
  const [summaryLoad, setSummaryLoad] = useState(true);
  const [summaryMonthLabel, setSummaryMonthLabel] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [summaryMonthValue, setSummaryMonthValue] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [summaryWeek, setSummaryWeek] = useState(0); // 0 = whole month, 1-5 = that week

  const [histRows, setHistRows] = useState([]);
  const [histLoad, setHistLoad] = useState(false);
  const [histOpen, setHistOpen] = useState(true);

  const [txRows, setTxRows] = useState([]);
  const [txLoad, setTxLoad] = useState(false);
  const [txOpen, setTxOpen] = useState(true);

  // Single map: inventory_id -> warehouse. Built straight off the live
  // inventory table (raw_materials_inventory / finished_products_inventory /
  // packaging_inventory), since that's exactly what inventory_id on both
  // the *_inventory_history and *_transaction_log tables points to (see the
  // *_inventory_id_fkey constraints). Used only as a fallback for rows that
  // don't already carry their own `warehouse` value directly.
  const [inventoryWarehouseMap, setInventoryWarehouseMap] = useState({});

  const [histPage, setHistPage] = useState(1);
  const [txPage, setTxPage] = useState(1);
  const [summaryPage, setSummaryPage] = useState(1);
  const PAGE = 20;

  // ── Pivot (per-product transaction history inside Monthly Summary) ──
  const [pivotOpen, setPivotOpen] = useState(() => new Set()); // product ids that are expanded
  const [pivotRows, setPivotRows] = useState([]);              // tx log rows for the current range
  const [pivotLoad, setPivotLoad] = useState(false);
  const pivotRequestId = useRef(0);
  const prevTabRef = useRef("raw");

  const tabRef = useRef("raw");
  tabRef.current = tab;

  // Guards against race conditions: loadMonthlyProductSummary can get
  // called multiple times in quick succession (mount, tab change, and the
  // focus/visibilitychange refetch), and network responses can resolve
  // out of order — an older, slower request can land AFTER a newer one and
  // silently overwrite it with stale data. This ref tracks which call is
  // the most recent one, so only its response is allowed to update state.
  const summaryRequestId = useRef(0);

  // ── offline detection ─────────────────────────────────────────────────────

  useEffect(() => {
    setOffline(!isOnline());
    function handleOffline() { setOffline(true); }
    function handleOnline()  { setOffline(false); }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  // Refresh everything from the server once the connection returns.
  useEffect(() => {
    if (offline) { wasOffline.current = true; return; }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    loadWarehouseMap(tabRef.current);
    loadMonthlyProductSummary(tabRef.current, summaryMonthValue, summaryWeek);
    loadHistory(tabRef.current, dateFrom, dateTo);
    loadTxLog(tabRef.current, dateFrom, dateTo);
    if (pivotOpen.size > 0) loadPivotTx(tabRef.current, summaryMonthValue, summaryWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  // ── warehouse map ─────────────────────────────────────────────────────────

  async function loadWarehouseMap(whichTab) {
    const cacheKey = `records:whmap:${whichTab}`;

    if (!isOnline()) {
      setInventoryWarehouseMap((await getCache(cacheKey)) ?? {});
      return;
    }

    const { data, error } = await supabase
      .from(invTable(whichTab))
      .select("id, warehouse");
    if (error) {
      if (isNetworkError(error.message)) {
        setInventoryWarehouseMap((await getCache(cacheKey)) ?? {});
      } else {
        console.error("[loadWarehouseMap] error:", error.message);
        setInventoryWarehouseMap({});
      }
      return;
    }
    const map = {};
    (data || []).forEach((row) => {
      if (row.warehouse) map[row.id] = row.warehouse;
    });
    setInventoryWarehouseMap(map);
    setCache(cacheKey, map);
  }

  // ── data loaders ──────────────────────────────────────────────────────────

  // Given "YYYY-MM" and a week number (0 = whole month, 1-5 = that week),
  // returns { rangeFrom, rangeTo, label } as YYYY-MM-DD strings clipped to
  // the actual number of days in that month. Week boundaries are simple
  // fixed 7-day chunks: days 1-7, 8-14, 15-21, 22-28, 29-end.
  function getMonthWeekRange(monthValue, week) {
    const [yearStr, monStr] = (monthValue || "").split("-");
    const year = Number(yearStr);
    const month = Number(monStr); // 1-12
    const daysInMonth = new Date(year, month, 0).getDate();
    const pad = (n) => String(n).padStart(2, "0");
    const dateStr = (day) => `${year}-${pad(month)}-${pad(day)}`;

    if (!week || week === 0) {
      return {
        rangeFrom: dateStr(1),
        rangeTo: dateStr(daysInMonth),
        label: new Date(year, month - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" }),
      };
    }

    const startDay = (week - 1) * 7 + 1;
    const endDay = Math.min(startDay + 6, daysInMonth);
    return {
      rangeFrom: dateStr(Math.min(startDay, daysInMonth)),
      rangeTo: dateStr(endDay),
      label: `Week ${week} of ${new Date(year, month - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" })} (${dateStr(startDay)} to ${dateStr(endDay)})`,
    };
  }

  // A product can exist in multiple warehouses (see raw_materials_warehouses
  // etc. in the schema), which means the history table can have MULTIPLE
  // rows for the same product on the same date — one per warehouse. Summing
  // those into a single per-(product, date) total avoids picking an
  // arbitrary single warehouse's row when we need "this product's balance
  // on this date" as a whole.
  function aggregateByProductDate(rows) {
    const byKey = new Map(); // key = normalizedName|date
    rows.forEach((r) => {
      const normalizedName = (r.name ?? "").trim().toLowerCase();
      const dateKey = `${normalizedName}|${r.inventory_date}`;
      if (!byKey.has(dateKey)) {
        byKey.set(dateKey, {
          name: r.name,
          normalizedName,
          inventory_date: r.inventory_date,
          beg_bal: 0,
          incoming_bal: 0,
          outgoing_bal: 0,
          current_bal: 0,
          actual_bal: 0,
        });
      }
      const acc = byKey.get(dateKey);
      acc.beg_bal += Number(r.beg_bal ?? 0);
      acc.incoming_bal += Number(r.incoming_bal ?? 0);
      acc.outgoing_bal += Number(r.outgoing_bal ?? 0);
      acc.current_bal += Number(r.current_bal ?? 0);
      acc.actual_bal += Number(r.actual_bal ?? 0);
    });
    return Array.from(byKey.values()).sort((a, b) =>
      a.inventory_date < b.inventory_date ? -1 : a.inventory_date > b.inventory_date ? 1 : 0
    );
  }

  // Builds one row per product for the given tab, scoped to the selected
  // month + week (or the whole month if week = 0):
  //  - beg_bal    -> the PREVIOUS finalized day's actual_bal, summed across
  //                  every warehouse (the last physically counted total
  //                  before this range starts). Falls back to the summed
  //                  stored beg_bal only if there's no earlier history at all.
  //  - incoming   -> sum of incoming_bal across every finalized day AND every
  //                  warehouse in range
  //  - outgoing   -> sum of outgoing_bal across every finalized day AND every
  //                  warehouse in range
  //  - current_bal / actual_bal -> summed across every warehouse on the LAST
  //                  date in range
  //  - loss (S/O) -> computed last, as actual_bal - current_bal (signed:
  //                  negative = shortage, positive = surplus)
  // Fetches ALL rows matching a query, looping in fixed-size pages until a
  // page comes back short (i.e. we've hit the true end of the data).
  // Needed because Supabase/PostgREST can enforce a server-side max-rows
  // cap (configured per-project) that silently truncates results even when
  // .range() is asked for more — a single .range(0, 9999) call is NOT
  // guaranteed to return everything. This loop keeps requesting subsequent
  // pages until nothing more comes back, so large history tables (many
  // products × many warehouses × many days) never get silently cut off.
  //
  // OFFLINE: every complete result is saved under `cacheKey`. When the
  // browser is offline (or a request fails with a network error) the saved
  // copy is returned instead, so the page keeps showing the last data it
  // loaded. Partial results from a failed load are never saved.
  async function fetchAllRows(buildQuery, cacheKey) {
    if (!isOnline()) {
      return (cacheKey && (await getCache(cacheKey))) || [];
    }

    const PAGE_SIZE = 500;
    let offset = 0;
    let all = [];
    while (true) {
      const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        if (isNetworkError(error.message)) {
          // Connection dropped: fall back to the saved copy, no console error.
          return (cacheKey && (await getCache(cacheKey))) || [];
        }
        console.error("[fetchAllRows] error:", error.message);
        return all; // real query error: keep previous behaviour (partial, not cached)
      }
      const page = data || [];
      all = all.concat(page);
      if (page.length < PAGE_SIZE) break; // short page = no more data left
      offset += PAGE_SIZE;
    }

    if (cacheKey) setCache(cacheKey, all);
    return all;
  }

  async function loadMonthlyProductSummary(whichTab, monthValue, week) {
    // Claim this call as the latest — any earlier in-flight call that
    // resolves after this one will see its own id no longer matches and
    // will skip updating state (see the check right before setMonthlyRows).
    const requestId = ++summaryRequestId.current;

    setSummaryLoad(true); setSummaryPage(1);

    const { rangeFrom, rangeTo, label } = getMonthWeekRange(monthValue, week);
    setSummaryMonthLabel(label);

    // Look up each product's actual_bal (summed across warehouses) from the
    // LAST finalized date BEFORE this range starts. This becomes the
    // range's beg_bal below.
    const priorData = await fetchAllRows(() =>
      supabase
        .from(historyTable(whichTab))
        .select("name, inventory_date, actual_bal")
        .lt("inventory_date", rangeFrom)
        .order("inventory_date", { ascending: true }),
      `records:prior:${whichTab}:${rangeFrom}`
    );

    const priorAggregated = aggregateByProductDate(priorData || []);
    const priorActualByName = new Map();
    const priorDateByName = new Map();
    priorAggregated.forEach((r) => {
      // Ascending order — last write per key wins, so this ends up being
      // the most recent date BEFORE the range, per product, with all its
      // warehouses already summed together.
      priorActualByName.set(r.normalizedName, r.actual_bal);
      priorDateByName.set(r.normalizedName, r.inventory_date);
    });

    const data = await fetchAllRows(() =>
      supabase
        .from(historyTable(whichTab))
        .select("inventory_id, name, inventory_date, beg_bal, incoming_bal, outgoing_bal, current_bal, actual_bal")
        .gte("inventory_date", rangeFrom)
        .lte("inventory_date", rangeTo)
        .order("inventory_date", { ascending: true }),
      `records:month:${whichTab}:${rangeFrom}:${rangeTo}`
    );

    const aggregatedRows = aggregateByProductDate(data || []);
    const byProduct = new Map();

    aggregatedRows.forEach((r) => {
      const key = r.normalizedName;
      if (!byProduct.has(key)) {
        const priorActual = priorActualByName.get(key);
        const priorDate = priorDateByName.get(key);
        byProduct.set(key, {
          id: key,
          name: r.name,
          beg_bal: priorActual !== undefined ? priorActual : r.beg_bal,
          beg_bal_source: priorActual !== undefined ? priorDate : "no prior data — used stored beg_bal",
          incoming: 0,
          outgoing: 0,
          current_bal: r.current_bal,
          actual_bal: r.actual_bal,
        });
      }
      const acc = byProduct.get(key);
      acc.incoming += r.incoming_bal;
      acc.outgoing += r.outgoing_bal;
      // Aggregated rows are in ascending date order, so the LAST time we
      // see this product, its current_bal/actual_bal/name are from the
      // LAST date in range (already summed across warehouses) — keep
      // overwriting so it ends up "latest".
      acc.name = r.name;
      acc.current_bal = r.current_bal;
      acc.actual_bal = r.actual_bal;
    });

    const result = Array.from(byProduct.values())
      .map((p) => ({ ...p, loss: p.actual_bal - p.current_bal })) // S/O computed last
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }));

    // Stale-response guard: if a newer call has been kicked off since this
    // one started, discard this result instead of overwriting the newer
    // (correct) state with old data.
    if (requestId !== summaryRequestId.current) return;

    setMonthlyRows(result);
    setSummaryLoad(false);
  }

  async function loadHistory(whichTab, from, to) {
    setHistLoad(true); setHistPage(1);
    const data = await fetchAllRows(() => {
      let q = supabase.from(historyTable(whichTab)).select("*")
        .order("inventory_date", { ascending: false })
        .order("name", { ascending: true });
      if (from) q = q.gte("inventory_date", from);
      if (to) q = q.lte("inventory_date", to);
      return q;
    }, `records:hist:${whichTab}:${from || ""}:${to || ""}`);
    setHistRows(data || []);
    setHistLoad(false);
  }

  async function loadTxLog(whichTab, from, to) {
    setTxLoad(true); setTxPage(1);
    // NOTE: removed_at filter intentionally omitted — we want ALL rows including
    // deleted / undone / reverted so the status badges are visible in the log.
    const data = await fetchAllRows(() => {
      let q = supabase.from(txLogTable(whichTab)).select("*")
        .order("created_at", { ascending: false });
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to + "T23:59:59.999Z");
      return q;
    }, `records:tx:${whichTab}:${from || ""}:${to || ""}`);
    setTxRows(data || []);
    setTxLoad(false);
  }

  // Loads the transaction log for the Monthly Summary's current range
  // (month + week). Filtered per product on the client so expanding
  // several products doesn't fire several queries.
  async function loadPivotTx(whichTab, monthValue, week) {
    const requestId = ++pivotRequestId.current;
    setPivotLoad(true);

    const { rangeFrom, rangeTo } = getMonthWeekRange(monthValue, week);
    const fromISO = new Date(`${rangeFrom}T00:00:00`).toISOString();
    const toISO = new Date(`${rangeTo}T23:59:59.999`).toISOString();

    const data = await fetchAllRows(() =>
      supabase
        .from(txLogTable(whichTab))
        .select("*")
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("created_at", { ascending: true }),
      `records:pivot:${whichTab}:${rangeFrom}:${rangeTo}`
    );

    if (requestId !== pivotRequestId.current) return; // stale response
    setPivotRows(data || []);
    setPivotLoad(false);
  }

  function togglePivot(id) {
    const next = new Set(pivotOpen);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      if (pivotOpen.size === 0) loadPivotTx(tab, summaryMonthValue, summaryWeek);
    }
    setPivotOpen(next);
  }

  // Pivot follows the Monthly Summary's Month / Week filter.
  // Tab change closes all pivots; month/week change reloads the open ones.
  useEffect(() => {
    const tabChanged = prevTabRef.current !== tab;
    prevTabRef.current = tab;

    if (tabChanged) {
      pivotRequestId.current++;
      setPivotOpen(new Set());
      setPivotRows([]);
      setPivotLoad(false);
      return;
    }
    if (pivotOpen.size > 0) loadPivotTx(tab, summaryMonthValue, summaryWeek);
    else setPivotRows([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, summaryMonthValue, summaryWeek]);

  // History, tx log, and warehouse map depend on the selected tab + the
  // History/Tx Log date filter (dateFrom/dateTo).
  useEffect(() => {
    loadWarehouseMap(tab);
    loadHistory(tab, dateFrom, dateTo);
    loadTxLog(tab, dateFrom, dateTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Monthly summary has its OWN filter (month + week-of-month), independent
  // of the History/Tx Log date range above — reload whenever the tab, the
  // selected month, or the selected week changes.
  useEffect(() => {
    loadMonthlyProductSummary(tab, summaryMonthValue, summaryWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, summaryMonthValue, summaryWeek]);

  // Records is a separate route from Inventory — if a finalize happens
  // there while this page is already open/backgrounded, our React state
  // has no way to know about it. Refetch everything whenever this tab
  // regains browser focus, so switching back after finalizing elsewhere
  // shows current data without needing a manual reload.
  useEffect(() => {
    function handleFocus() {
      loadMonthlyProductSummary(tabRef.current, summaryMonthValue, summaryWeek);
      loadHistory(tabRef.current, dateFrom, dateTo);
      loadTxLog(tabRef.current, dateFrom, dateTo);
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") handleFocus();
    }
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, summaryMonthValue, summaryWeek]);

  function applyDateFilter() {
    loadHistory(tab, dateFrom, dateTo);
    loadTxLog(tab, dateFrom, dateTo);
  }

  function clearDateFilter() {
    setDateFrom(""); setDateTo("");
    loadHistory(tab, "", "");
    loadTxLog(tab, "", "");
  }

  function resolveWarehouse(row) {
    if (row.warehouse) return row.warehouse;
    return inventoryWarehouseMap[row.inventory_id] ?? "—";
  }

  // ── enriched rows ─────────────────────────────────────────────────────────

  const enrichedHistRows = histRows.map((r) => ({
    ...r,
    _warehouse: resolveWarehouse(r),
  }));

  const enrichedTxRows = txRows.map((r) => ({
    ...r,
    _warehouse: resolveWarehouse(r),
  }));

  // ── print / export helpers ────────────────────────────────────────────────

  const printOpts = () => ({
    tab, dateFrom, dateTo,
    histRows: enrichedHistRows.map((r) => ({ ...r, warehouse: r._warehouse })),
    txRows: enrichedTxRows.map((r) => ({ ...r, warehouse: r._warehouse })),
    active: null,
    period,
    hasSupplier: hasSupplierCol(tab),
  });

  // ── derived ───────────────────────────────────────────────────────────────

  const histSlice = enrichedHistRows.slice((histPage - 1) * PAGE, histPage * PAGE);
  const histPages = Math.ceil(enrichedHistRows.length / PAGE);
  const txSlice = enrichedTxRows.slice((txPage - 1) * PAGE, txPage * PAGE);
  const txPages = Math.ceil(enrichedTxRows.length / PAGE);
  const summarySlice = monthlyRows.slice((summaryPage - 1) * PAGE, summaryPage * PAGE);
  const summaryPages = Math.ceil(monthlyRows.length / PAGE);

  // ── tx table headers ──────────────────────────────────────────────────────

  const txHeaders = [
    "Created At", "Finalized At",
    "Product", "Type", "Source", "Status",
    "In", "Out", "Actual", "S/O",
    "Monitoring", "Representative", "Staff",
    ...(hasSupplierCol(tab) ? ["Supplier"] : []),
    "Warehouse",
  ];

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">

      {offline && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <span className="font-semibold">You're offline.</span> Showing the last saved records. Anything not opened before while online won't appear until you reconnect.
        </div>
      )}

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
              enrichedTxRows.map((r) => ({ ...r, warehouse: r._warehouse })),
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
          <button onClick={() => setTab("raw")}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "raw" ? "bg-blue-600 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
            Raw
          </button>
          <button onClick={() => setTab("finished")}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${tab === "finished" ? "bg-blue-600 text-white" : "bg-white text-black hover:bg-gray-50"}`}>
            Finished
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

      {/* Monthly per-product summary — one row per product for the selected
          tab, with its OWN Month + Week-of-month filter (independent of the
          History/Tx Log date range below). Beg Bal = first day of the
          selected range, Current/Actual Bal = last day of the range. */}
      <div className="mb-5">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <SectionHeader
            title={`Monthly Summary — ${CATEGORY_LABELS[tab]}`}
            count={monthlyRows.length}
            countLabel="product"
            open={summaryOpen}
            onToggle={() => setSummaryOpen((v) => !v)}
            actions={monthlyRows.length > 0 ? (
              <>
                <IconButton
                  onClick={() => exportMonthlySummaryCSV(monthlyRows, tab, summaryMonthLabel)}
                  title="Export monthly summary as CSV"
                >
                  ⬇ CSV
                </IconButton>
                <IconButton
                  onClick={() => openMonthlySummaryPrint({ tab, monthLabel: summaryMonthLabel, rows: monthlyRows })}
                  title="Print monthly summary (dot matrix)"
                >
                  🖨️ Print
                </IconButton>
              </>
            ) : null}
          />

          {summaryOpen && (
            <>
              <div className="px-4 pt-3 flex flex-wrap items-center gap-2">
                <label className="text-xs text-black font-semibold">Month</label>
                <input
                  type="month"
                  value={summaryMonthValue}
                  onChange={(e) => setSummaryMonthValue(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <label className="text-xs text-black font-semibold ml-2">Week</label>
                <select
                  value={summaryWeek}
                  onChange={(e) => setSummaryWeek(Number(e.target.value))}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={0}>Whole month</option>
                  <option value={1}>Week 1</option>
                  <option value={2}>Week 2</option>
                  <option value={3}>Week 3</option>
                  <option value={4}>Week 4</option>
                  <option value={5}>Week 5</option>
                </select>
              </div>

              <p className="px-4 pt-2 text-xs text-gray-500">
                {summaryMonthLabel} — beginning balance, totals, and closing balances per product
              </p>

              {summaryLoad ? (
                <div className="py-10 text-center text-sm text-gray-500 animate-pulse">Loading…</div>
              ) : monthlyRows.length === 0 ? (
                <EmptyState message="No finalized days in this range yet for this category." />
              ) : (
                <>
                  <div className="overflow-x-auto mt-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          {["Product", "Beg Bal", "Incoming", "Outgoing", "Current Bal", "Actual Bal", "S/O", "Pivot"].map((h) => (
                            <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {summarySlice.map((p) => {
                          const isOpen = pivotOpen.has(p.id);
                          const productTx = isOpen
                            ? pivotRows.filter((r) => (r.product_name ?? "").trim().toLowerCase() === p.id)
                            : [];

                          return (
                            <Fragment key={p.id}>
                              <tr className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-2.5 font-medium text-black">{p.name}</td>
                                <td className="px-4 py-2.5 text-black">{fmt(p.beg_bal)}</td>
                                <td className="px-4 py-2.5 text-green-600 font-medium">{fmt(p.incoming)}</td>
                                <td className="px-4 py-2.5 text-red-500 font-medium">{fmt(p.outgoing)}</td>
                                <td className="px-4 py-2.5 text-black font-semibold">{fmt(p.current_bal)}</td>
                                <td className="px-4 py-2.5 text-black">{fmt(p.actual_bal)}</td>
                                <td className="px-4 py-2.5">{renderLoss(p.loss)}</td>
                                <td className="px-4 py-2.5">
                                  <label className="inline-flex items-center gap-1.5 text-xs text-black cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={isOpen}
                                      onChange={() => togglePivot(p.id)}
                                      className="h-3.5 w-3.5 accent-blue-600"
                                    />
                                    Pivot
                                  </label>
                                </td>
                              </tr>

                              {isOpen && (
                                <tr className="bg-gray-50/60">
                                  <td colSpan={8} className="px-4 py-3">
                                    <p className="text-xs text-gray-500 mb-2">
                                      Transaction history — <span className="font-medium text-black">{p.name}</span> · {summaryMonthLabel}
                                      {!pivotLoad && ` · ${productTx.length} entr${productTx.length === 1 ? "y" : "ies"}`}
                                    </p>

                                    {pivotLoad ? (
                                      <div className="py-4 text-center text-xs text-gray-500 animate-pulse">Loading…</div>
                                    ) : productTx.length === 0 ? (
                                      <div className="py-4 text-center text-xs text-gray-500">
                                        No transactions for this product in this range.
                                      </div>
                                    ) : (
                                      <div className="overflow-x-auto max-h-80 overflow-y-auto border border-gray-200 rounded bg-white">
                                        <table className="w-full text-xs">
                                          <thead className="sticky top-0">
                                            <tr className="border-b border-gray-100 bg-gray-50">
                                              {[
                                                "Created At", "Finalized At", "Type", "Source", "Status",
                                                "In", "Out", "Actual", "S/O",
                                                "Monitoring", "Representative", "Staff",
                                                ...(hasSupplierCol(tab) ? ["Supplier"] : []),
                                                "Warehouse",
                                              ].map((h) => (
                                                <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-gray-50">
                                            {productTx.map((row) => {
                                              const status = getTxStatus(row);
                                              const removed = isRemovedStatus(status);
                                              const isManip = row.transaction_source === "manipulated";
                                              const isCorr = row.transaction_type === "count_correction";
                                              const dimClass = removed ? "opacity-50 line-through" : "";
                                              return (
                                                <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                                                  <td className={`px-3 py-2 text-black whitespace-nowrap ${dimClass}`}>{fmtDateTime(row.created_at)}</td>
                                                  <td className={`px-3 py-2 text-black whitespace-nowrap ${dimClass}`}>{fmtDateTime(row.finalized_at)}</td>
                                                  <td className="px-3 py-2">
                                                    <span className={dimClass}>
                                                      {isCorr ? <Badge color="purple">🔢 Count correction</Badge> : <Badge color="blue">Stock movement</Badge>}
                                                    </span>
                                                  </td>
                                                  <td className="px-3 py-2">
                                                    <span className={dimClass}>
                                                      {isManip ? <Badge color="amber">⚙ Manual</Badge> : <Badge color="gray">📋 Ordered</Badge>}
                                                    </span>
                                                  </td>
                                                  <td className="px-3 py-2"><TxStatusBadge row={row} /></td>
                                                  <td className={`px-3 py-2 text-green-600 font-medium ${dimClass}`}>
                                                    {Number(row.incoming_bal) > 0 ? fmt(row.incoming_bal) : <span className="text-gray-300">—</span>}
                                                  </td>
                                                  <td className={`px-3 py-2 text-red-500 font-medium ${dimClass}`}>
                                                    {Number(row.outgoing_bal) > 0 ? fmt(row.outgoing_bal) : <span className="text-gray-300">—</span>}
                                                  </td>
                                                  <td className={`px-3 py-2 text-black ${dimClass}`}>
                                                    {row.actual_bal != null ? fmt(row.actual_bal) : <span className="text-gray-300">—</span>}
                                                  </td>
                                                  <td className="px-3 py-2">{renderLoss(row.loss, dimClass)}</td>
                                                  <td className={`px-3 py-2 text-black ${dimClass}`}>{row.monitoring_employee ?? "—"}</td>
                                                  <td className={`px-3 py-2 text-black ${dimClass}`}>{row.representative_employee ?? "—"}</td>
                                                  <td className={`px-3 py-2 text-black ${dimClass}`}>{row.staff_employee ?? "—"}</td>
                                                  {hasSupplierCol(tab) && (
                                                    <td className={`px-3 py-2 text-black ${dimClass}`}>{row.supplier_name ?? "—"}</td>
                                                  )}
                                                  <td className={`px-3 py-2 text-black whitespace-nowrap ${dimClass}`}>
                                                    {resolveWarehouse(row)}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {summaryPages > 1 && (
                    <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-black">
                      <span>Page {summaryPage} of {summaryPages}</span>
                      <div className="flex gap-1">
                        <button onClick={() => setSummaryPage((p) => Math.max(1, p - 1))} disabled={summaryPage === 1}
                          className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">←</button>
                        <button onClick={() => setSummaryPage((p) => Math.min(summaryPages, p + 1))} disabled={summaryPage === summaryPages}
                          className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">→</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

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
                        {["Date", "Product", "Beg", "Incoming", "Outgoing", "Current", "Actual", "S/O", "Warehouse", "Recorded At"].map((h) => (
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
                            {/*
                              Now trusts the stored `row.loss` column directly
                              instead of recomputing actual_bal - current_bal
                              here. This is safe because InventoryPage.js's
                              runFinalize now writes loss using the exact same
                              signed convention (actual - current) that
                              renderLoss expects, so the stored value and the
                              on-the-fly recompute are guaranteed to agree.
                            */}
                            {renderLoss(row.loss)}
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
                        const status = getTxStatus(row);
                        const removed = isRemovedStatus(status);
                        const isManip = row.transaction_source === "manipulated";
                        const isCorr = row.transaction_type === "count_correction";
                        const dimClass = removed ? "opacity-50 line-through" : "";
                        const rowBg =
                          status === "deleted" ? "bg-red-50/40 border-l-4 border-red-300" :
                            status === "undone_item" ? "bg-gray-50/70 border-l-4 border-slate-300" :
                              status === "undone_session" ? "bg-gray-50/70 border-l-4 border-slate-300" :
                                status === "undone" ? "bg-gray-50/70 border-l-4 border-slate-300" :
                                  status === "reverted" ? "bg-orange-50/40 border-l-4 border-orange-300" :
                                    isCorr ? "bg-purple-50/30" : "";

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
                              {/*
                                Same signed convention as the Finalized History
                                column above and as TransactionLogsTable.js —
                                row.loss < 0 -> shortage (red), > 0 -> surplus
                                (green), 0 -> dash.
                              */}
                              {renderLoss(row.loss, dimClass)}
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