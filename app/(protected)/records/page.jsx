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

function historyTable(tab) {
  return tab === "raw" ? "raw_materials_inventory_history" : "finished_products_inventory_history";
}
function txLogTable(tab) {
  return tab === "raw" ? "raw_materials_transaction_log" : "finished_products_transaction_log";
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
  const headers = ["Date","Product","Beg","Incoming","Outgoing","Current","Actual","Loss","Warehouse"];
  const data = rows.map((r) => [
    r.inventory_date, r.name,
    raw(r.beg_bal), raw(r.incoming_bal), raw(r.outgoing_bal),
    raw(r.current_bal), raw(r.actual_bal), raw(r.loss),
    r.warehouse ?? "",
  ]);
  downloadCSV(`inventory-history-${tab}-${todayLocal()}.csv`, headers, data);
}

function exportTxCSV(rows, tab) {
  const headers = [
    "Date","Product","Type","Source",
    "Incoming","Outgoing","Actual","Loss",
    "Monitoring","Representative","Staff",
    ...(tab === "raw" ? ["Supplier"] : []),
    "Warehouse",
  ];
  const data = rows.map((r) => [
    r.finalized_at
      ? new Date(r.finalized_at).toLocaleDateString()
      : new Date(r.created_at).toLocaleDateString(),
    r.product_name,
    r.transaction_type === "count_correction" ? "Count correction" : "Stock movement",
    r.transaction_source === "manipulated" ? "Manual" : r.finalized_at ? "Finalized" : "Pending",
    raw(r.incoming_bal), raw(r.outgoing_bal),
    r.actual_bal ?? "", raw(r.loss),
    r.monitoring_employee ?? "", r.representative_employee ?? "", r.staff_employee ?? "",
    ...(tab === "raw" ? [r.supplier_name ?? ""] : []),
    r.warehouse ?? "",
  ]);
  downloadCSV(`transaction-log-${tab}-${todayLocal()}.csv`, headers, data);
}

// ─── dot-matrix print ─────────────────────────────────────────────────────────
// Opens a new window with Courier New / monospace layout that mimics
// continuous-form dot-matrix output: no colours, hairline borders,
// compressed font, perforated-edge feel via a top dashed border.

function col(value, width, align = "left") {
  const s = String(value ?? "").slice(0, width);
  return align === "right"
    ? s.padStart(width)
    : s.padEnd(width);
}

function buildDotMatrixHTML({ tab, dateFrom, dateTo, histRows, txRows, active, period, isRaw }) {
  const W = 132; // classic dot-matrix line width
  const divider = "-".repeat(W);
  const title   = `INVENTORY RECORDS — ${tab.toUpperCase()} MATERIALS`;
  const filter  = dateFrom || dateTo
    ? `Period: ${dateFrom || "start"} to ${dateTo || todayLocal()}`
    : `Printed: ${new Date().toLocaleString()}`;

  const lines = [];

  // ── header ────────────────────────────────────────────────────────
  lines.push(title.padStart(Math.floor((W + title.length) / 2)));
  lines.push(filter);
  lines.push("");

  // ── summary ───────────────────────────────────────────────────────
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

  // ── finalized history ─────────────────────────────────────────────
  lines.push("FINALIZED HISTORY");
  lines.push(divider);
  lines.push(
    col("Date",      12) + col("Product",   28) +
    col("Beg",        8, "right") + col("In",  8, "right") + col("Out",     8, "right") +
    col("Current",   10, "right") + col("Actual", 8, "right") + col("Loss", 8, "right") +
    col("Warehouse", 20)
  );
  lines.push(divider);
  if (histRows.length === 0) {
    lines.push("  (no records)");
  } else {
    histRows.forEach((r) => {
      lines.push(
        col(r.inventory_date,        12) + col(r.name,           28) +
        col(raw(r.beg_bal),           8, "right") + col(raw(r.incoming_bal), 8, "right") +
        col(raw(r.outgoing_bal),      8, "right") +
        col(raw(r.current_bal),      10, "right") + col(raw(r.actual_bal),   8, "right") +
        col(raw(r.loss),              8, "right") +
        col(r.warehouse ?? "",       20)
      );
    });
  }
  lines.push(divider);
  lines.push(`  Total records: ${histRows.length}`);
  lines.push("");

  // ── tx log ────────────────────────────────────────────────────────
  lines.push("TRANSACTION LOG");
  lines.push(divider);
  const txHeaderCols = [
    col("Date",      12), col("Product",  24), col("Type",    18), col("Source",  12),
    col("In",         8, "right"), col("Out", 8, "right"),
    col("Monitoring", 18), col("Rep.", 16),
    ...(isRaw ? [col("Supplier", 18)] : []),
    col("Warehouse", 14),
  ];
  lines.push(txHeaderCols.join(""));
  lines.push(divider);
  if (txRows.length === 0) {
    lines.push("  (no transactions)");
  } else {
    txRows.forEach((r) => {
      const dateStr = r.finalized_at
        ? new Date(r.finalized_at).toLocaleDateString()
        : new Date(r.created_at).toLocaleDateString();
      const typStr = r.transaction_type === "count_correction" ? "Count corr." : "Stock move";
      const srcStr = r.transaction_source === "manipulated" ? "Manual"
        : r.finalized_at ? "Finalized" : "Pending";
      const rowCols = [
        col(dateStr,                    12), col(r.product_name ?? "",  24),
        col(typStr,                     18), col(srcStr,                12),
        col(raw(r.incoming_bal),         8, "right"), col(raw(r.outgoing_bal), 8, "right"),
        col(r.monitoring_employee ?? "", 18), col(r.representative_employee ?? "", 16),
        ...(isRaw ? [col(r.supplier_name ?? "", 18)] : []),
        col(r.warehouse ?? "",          14),
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
  /* Perforated-edge feel at top */
  body::before {
    content: "";
    display: block;
    border-top: 2px dashed #bbb;
    margin-bottom: 6mm;
  }
  pre {
    white-space: pre;
    overflow-x: visible;
  }
  @media print {
    body { padding: 6mm 8mm; }
    body::before { border-top: 2px dashed #999; }
    @page { size: landscape; margin: 6mm; }
  }
</style>
</head>
<body>
<pre>${preContent.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre>
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
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>{fmt(value)}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function EmptyState({ message }) {
  return <div className="py-10 text-center text-sm text-gray-400">{message}</div>;
}

function Badge({ children, color = "gray" }) {
  const colors = {
    gray:   "bg-gray-100 text-gray-600",
    green:  "bg-green-50 text-green-700",
    red:    "bg-red-50 text-red-600",
    blue:   "bg-blue-50 text-blue-700",
    amber:  "bg-amber-50 text-amber-700",
    purple: "bg-purple-50 text-purple-700",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

function IconButton({ onClick, title, children, variant = "default" }) {
  const base = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-colors";
  const variants = {
    default: "bg-white border-gray-200 text-gray-600 hover:bg-gray-50",
    print:   "bg-white border-gray-200 text-gray-600 hover:bg-gray-50",
  };
  return (
    <button onClick={onClick} title={title} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  );
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

  const [txRows, setTxRows] = useState([]);
  const [txLoad, setTxLoad] = useState(false);

  const [histPage, setHistPage] = useState(1);
  const [txPage,   setTxPage]   = useState(1);
  const PAGE = 20;

  const tabRef = useRef("finished");
  tabRef.current = tab;

  // ── data loaders ────────────────────────────────────────────────────────────

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
    let q = supabase.from(txLogTable(whichTab)).select("*")
      .is("removed_at", null)
      .order("created_at", { ascending: false });
    if (from) q = q.gte("created_at", from);
    if (to)   q = q.lte("created_at", to + "T23:59:59.999Z");
    const { data } = await q;
    setTxRows(data || []);
    setTxLoad(false);
  }

  useEffect(() => {
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

  // ── print helpers ────────────────────────────────────────────────────────────

  const printOpts = () => ({
    tab, dateFrom, dateTo,
    histRows, txRows,
    active: period === "weekly" ? weekly : monthly,
    period,
    isRaw: tab === "raw",
  });

  // ── derived ──────────────────────────────────────────────────────────────────

  const active  = period === "weekly" ? weekly : monthly;
  const hasSum  = active && active.days > 0;
  const showSum = !summaryLoad && weekly && monthly && (weekly.days > 0 || monthly.days > 0);

  const histSlice = histRows.slice((histPage - 1) * PAGE, histPage * PAGE);
  const histPages = Math.ceil(histRows.length / PAGE);
  const txSlice   = txRows.slice((txPage - 1) * PAGE, txPage * PAGE);
  const txPages   = Math.ceil(txRows.length / PAGE);

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">

      {/* Page header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Records</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Finalized history, transaction log, and inventory summaries
          </p>
        </div>
        {/* Global print-all button */}
        <button
          onClick={() => openDotMatrixPrint(printOpts())}
          title="Print full report (dot matrix)"
          className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          🖨️ Print All
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">

        {/* Tab toggle */}
        <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
          <button onClick={() => setTab("finished")}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === "finished" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            Finished
          </button>
          <button onClick={() => setTab("raw")}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${tab === "raw" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            Raw
          </button>
        </div>

        <div className="w-px h-6 bg-gray-200 mx-0.5" />

        {/* Date range */}
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-gray-400 font-medium">From</label>
          <input type="date" value={dateFrom} max={dateTo || todayLocal()}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <label className="text-xs text-gray-400 font-medium">To</label>
          <input type="date" value={dateTo} min={dateFrom || undefined} max={todayLocal()}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={applyDateFilter}
            className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors">
            Apply
          </button>
          {(dateFrom || dateTo) && (
            <button onClick={clearDateFilter}
              className="px-3 py-1.5 rounded-md bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 text-sm transition-colors">
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
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Summary</h2>
              {active && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {period === "weekly" ? "Last 7 days" : "Last 30 days"}
                  {active.days > 0
                    ? ` — ${active.days} closed day${active.days === 1 ? "" : "s"}`
                    : " — no data yet"}
                </p>
              )}
            </div>
            <div className="flex rounded-md border border-gray-200 overflow-hidden">
              <button onClick={() => setPeriod("weekly")}
                className={`px-3 py-1 text-xs font-medium transition-colors ${period === "weekly" ? "bg-blue-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                Weekly
              </button>
              <button onClick={() => setPeriod("monthly")}
                className={`px-3 py-1 text-xs font-medium border-l border-gray-200 transition-colors ${period === "monthly" ? "bg-blue-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
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
              <p className="text-sm text-gray-400">No finalized days in this period yet.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Finalized History ── */}
      <div className="mb-5">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Finalized History</h2>
              {histRows.length > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">{histRows.length.toLocaleString()} record{histRows.length === 1 ? "" : "s"}</p>
              )}
            </div>
            {/* Per-section actions */}
            {histRows.length > 0 && (
              <div className="flex items-center gap-1.5">
                <IconButton
                  onClick={() => exportHistoryCSV(histRows, tab)}
                  title="Export history as CSV"
                >
                  ⬇ CSV
                </IconButton>
                <IconButton
                  onClick={() => {
                    const opts = printOpts();
                    openDotMatrixPrint({ ...opts, txRows: [] });
                  }}
                  title="Print history (dot matrix)"
                >
                  🖨️ Print
                </IconButton>
              </div>
            )}
          </div>

          {histLoad ? (
            <div className="py-10 text-center text-sm text-gray-400 animate-pulse">Loading…</div>
          ) : histRows.length === 0 ? (
            <EmptyState message="No finalized history found. Finalize a day in Inventory to see records here." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      {["Date","Product","Beg","Incoming","Outgoing","Current","Actual","Loss","Warehouse"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {histSlice.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{row.inventory_date}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-800">{row.name}</td>
                        <td className="px-4 py-2.5 text-gray-600">{fmt(row.beg_bal)}</td>
                        <td className="px-4 py-2.5 text-green-600 font-medium">{fmt(row.incoming_bal)}</td>
                        <td className="px-4 py-2.5 text-red-500 font-medium">{fmt(row.outgoing_bal)}</td>
                        <td className="px-4 py-2.5 text-gray-800 font-semibold">{fmt(row.current_bal)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{fmt(row.actual_bal)}</td>
                        <td className="px-4 py-2.5">
                          {Number(row.loss) > 0
                            ? <span className="text-orange-500 font-medium">{fmt(row.loss)}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-400">{row.warehouse ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {histPages > 1 && (
                <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
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
          )}
        </div>
      </div>

      {/* ── Transaction Log ── */}
      <div>
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Transaction Log</h2>
              {txRows.length > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">{txRows.length.toLocaleString()} entr{txRows.length === 1 ? "y" : "ies"}</p>
              )}
            </div>
            {/* Per-section actions */}
            {txRows.length > 0 && (
              <div className="flex items-center gap-1.5">
                <IconButton
                  onClick={() => exportTxCSV(txRows, tab)}
                  title="Export transaction log as CSV"
                >
                  ⬇ CSV
                </IconButton>
                <IconButton
                  onClick={() => {
                    const opts = printOpts();
                    openDotMatrixPrint({ ...opts, histRows: [], active: null });
                  }}
                  title="Print transaction log (dot matrix)"
                >
                  🖨️ Print
                </IconButton>
              </div>
            )}
          </div>

          {txLoad ? (
            <div className="py-10 text-center text-sm text-gray-400 animate-pulse">Loading…</div>
          ) : txRows.length === 0 ? (
            <EmptyState message="No transactions found for this period." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      {["Date","Product","Type","Source","In","Out","Actual","Loss","Monitoring","Representative","Staff",...(tab === "raw" ? ["Supplier"] : []),"Warehouse"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {txSlice.map((row) => {
                      const isManipulated = row.transaction_source === "manipulated";
                      const isCorrection  = row.transaction_type   === "count_correction";
                      return (
                        <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                            {row.finalized_at
                              ? new Date(row.finalized_at).toLocaleDateString()
                              : new Date(row.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-gray-800">{row.product_name}</td>
                          <td className="px-4 py-2.5">
                            {isCorrection ? <Badge color="purple">Count correction</Badge> : <Badge color="blue">Stock movement</Badge>}
                          </td>
                          <td className="px-4 py-2.5">
                            {isManipulated ? <Badge color="amber">Manual</Badge>
                              : row.finalized_at ? <Badge color="green">Finalized</Badge>
                              : <Badge color="gray">Pending</Badge>}
                          </td>
                          <td className="px-4 py-2.5 text-green-600 font-medium">
                            {Number(row.incoming_bal) > 0 ? fmt(row.incoming_bal) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-red-500 font-medium">
                            {Number(row.outgoing_bal) > 0 ? fmt(row.outgoing_bal) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">
                            {row.actual_bal != null ? fmt(row.actual_bal) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            {Number(row.loss) > 0
                              ? <span className="text-orange-500 font-medium">{fmt(row.loss)}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">{row.monitoring_employee ?? "—"}</td>
                          <td className="px-4 py-2.5 text-gray-600">{row.representative_employee ?? "—"}</td>
                          <td className="px-4 py-2.5 text-gray-600">{row.staff_employee ?? "—"}</td>
                          {tab === "raw" && (
                            <td className="px-4 py-2.5 text-gray-600">{row.supplier_name ?? "—"}</td>
                          )}
                          <td className="px-4 py-2.5 text-gray-400">{row.warehouse ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {txPages > 1 && (
                <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
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
          )}
        </div>
      </div>
    </div>
  );
}