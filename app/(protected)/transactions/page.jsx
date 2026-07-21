"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabaseClient";
import TransactionCalendar from "./components/TransactionalCalendar";

const PRODUCT_TYPE = { RAW: "raw", FINISHED: "finished", PACKAGING: "packaging" };

const RAW_SELECT = "id, inventory_id, monitoring_employee, representative_employee, staff_employee, supplier_name, product_name, warehouse, incoming_bal, outgoing_bal, actual_bal, loss, created_at, created_by, finalized_at, removed_at, removed_reason, transaction_source, transaction_type";
const FIN_SELECT = "id, inventory_id, monitoring_employee, representative_employee, staff_employee, product_name, warehouse, incoming_bal, outgoing_bal, actual_bal, loss, created_at, created_by, finalized_at, removed_at, removed_reason, transaction_source, transaction_type";

// packaging_transaction_log has the same columns as raw_materials_transaction_log
// (including supplier_name), so it reuses RAW_SELECT.
const TX_CONFIG = {
  raw: { table: "raw_materials_transaction_log", select: RAW_SELECT, hasSupplier: true, label: "Raw Materials", inv: "raw_materials_inventory", hist: "raw_materials_inventory_history" },
  finished: { table: "finished_products_transaction_log", select: FIN_SELECT, hasSupplier: false, label: "Finished Products", inv: "finished_products_inventory", hist: "finished_products_inventory_history" },
  packaging: { table: "packaging_transaction_log", select: RAW_SELECT, hasSupplier: true, label: "Packaging", inv: "packaging_inventory", hist: "packaging_inventory_history" },
};

function pad(n) { return n.toString().padStart(2, "0"); }
function toDateString(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayLocal() { return toDateString(new Date()); }
function fmtDateTimeCSV(val) {
  if (!val) return "";
  const d = new Date(val);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ─── 6-state status system (mirrors records/page.js) ───────────────────────
// pending | finalized | deleted | undone_item | undone_session | reverted
// (legacy "undone" rows fall back to "undone_item" styling)
function getTxStatus(row) {
  if (row.removed_at) {
    if (row.removed_reason === "deleted") return "deleted";
    if (row.removed_reason === "finalize_reverted") return "reverted";
    if (row.removed_reason === "undone_item") return "undone_item";
    if (row.removed_reason === "undone_session") return "undone_session";
    return "undone_item"; // legacy fallback
  }
  if (row.finalized_at) return "finalized";
  return "pending";
}
function isRemovedStatus(status) {
  return status === "deleted" || status === "undone_item" || status === "undone_session" || status === "reverted";
}
function statusLabel(status) {
  switch (status) {
    case "finalized": return "Finalized";
    case "pending": return "Pending";
    case "deleted": return "Deleted";
    case "undone_item": return "Undo item";
    case "undone_session": return "Undo session";
    case "reverted": return "Reopened";
    default: return status;
  }
}

// ─── CSV export ──────────────────────────────────────────────────────────────
function escapeCSV(v) {
  if (v == null) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCSV(filename, headers, rows) {
  const lines = [headers.map(escapeCSV).join(","), ...rows.map((r) => r.map(escapeCSV).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function exportTxCSV(rows, productType, hasSupplier) {
  const headers = [
    "Created At", "Finalized At", "Product", "Warehouse",
    "Type", "Source", "Status",
    "Incoming", "Outgoing",
    "Balance Before", "Balance After",
    "Actual", "S/O",
    "Monitoring", "Representative", "Staff",
    ...(hasSupplier ? ["Supplier"] : []),
    "Account Responsible",
  ];
  const data = rows.map((r) => {
    const status = getTxStatus(r);
    return [
      fmtDateTimeCSV(r.created_at),
      fmtDateTimeCSV(r.finalized_at),
      r.product_name,
      r.warehouse ?? "",
      r.transaction_type === "count_correction" ? "Count correction" : "Stock movement",
      r.transaction_source === "manipulated" ? "Manual" : "Ordered",
      statusLabel(status),
      r.incoming_bal ?? "", r.outgoing_bal ?? "",
      r.balance_before, r.balance_after,
      r.actual_bal ?? "", r.loss ?? "",
      r.monitoring_employee ?? "", r.representative_employee ?? "", r.staff_employee ?? "",
      ...(hasSupplier ? [r.supplier_name ?? ""] : []),
      r.responsible_email ?? "",
    ];
  });
  downloadCSV(`transaction-log-${productType}-${todayLocal()}.csv`, headers, data);
}

// ─── dot-matrix print ─────────────────────────────────────────────────────────
function col(value, width, align = "left") {
  const s = String(value ?? "").slice(0, width);
  return align === "right" ? s.padStart(width) : s.padEnd(width);
}
function buildDotMatrixHTML({ productType, dateFrom, dateTo, selectedDate, rows, hasSupplier }) {
  const W = 150;
  const divider = "-".repeat(W);
  const title = `TRANSACTION LOG — ${productType.toUpperCase()}`;
  const filter = dateFrom || dateTo
    ? `Period: ${dateFrom || "start"} to ${dateTo || todayLocal()}`
    : selectedDate
      ? `Date: ${selectedDate}`
      : `Printed: ${new Date().toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}`;

  const lines = [];
  lines.push(title.padStart(Math.floor((W + title.length) / 2)));
  lines.push(filter);
  lines.push("");
  lines.push(divider);
  lines.push(
    col("Created At", 20) + col("Product", 22) + col("Warehouse", 14) +
    col("Type", 14) + col("Source", 12) + col("Status", 16) +
    col("In", 7, "right") + col("Out", 7, "right") +
    col("Bal.Before", 10, "right") + col("Bal.After", 10, "right") +
    col("Actual", 8, "right") + col("S/O", 8, "right") +
    (hasSupplier ? col("Supplier", 14) : "")
  );
  lines.push(divider);
  if (rows.length === 0) {
    lines.push("  (no transactions)");
  } else {
    rows.forEach((r) => {
      const status = getTxStatus(r);
      lines.push(
        col(fmtDateTimeCSV(r.created_at), 20) + col(r.product_name ?? "", 22) + col(r.warehouse ?? "", 14) +
        col(r.transaction_type === "count_correction" ? "Count corr." : "Stock move", 14) +
        col(r.transaction_source === "manipulated" ? "Manual" : "Ordered", 12) +
        col(statusLabel(status), 16) +
        col(r.incoming_bal ?? "", 7, "right") + col(r.outgoing_bal ?? "", 7, "right") +
        col(r.balance_before, 10, "right") + col(r.balance_after, 10, "right") +
        col(r.actual_bal ?? "", 8, "right") + col(r.loss ?? "", 8, "right") +
        (hasSupplier ? col(r.supplier_name ?? "", 14) : "")
      );
    });
  }
  lines.push(divider);
  lines.push(`  Total entries: ${rows.length}`);
  lines.push("");
  lines.push("*** END OF REPORT ***".padStart(Math.floor((W + 21) / 2)));

  const preContent = lines.join("\n");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Transaction Log — ${productType} — ${todayLocal()}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:"Courier New",Courier,monospace; font-size:8.5pt; line-height:1.45; background:#fff; color:#000; padding:12mm 10mm; }
  body::before { content:""; display:block; border-top:2px dashed #bbb; margin-bottom:6mm; }
  pre { white-space:pre; overflow-x:visible; }
  @media print { body { padding:6mm 8mm; } body::before { border-top:2px dashed #999; } @page { size:landscape; margin:6mm; } }
</style></head>
<body><pre>${preContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`;
}
function openDotMatrixPrint(opts) {
  const html = buildDotMatrixHTML(opts);
  const win = window.open("", "_blank", "width=1200,height=800");
  if (!win) { alert("Pop-up blocked — please allow pop-ups for this page."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
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

export default function TransactionLogsTable() {
  const supabase = useMemo(() => createClient(), []);

  const [productType, setProductType] = useState(PRODUCT_TYPE.RAW);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // ── pagination ────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const PAGE = 20;

  // ── Top scrollbar sync ───────────────────────────────────────────────────
  const topScrollRef = useRef(null);
  const tableScrollRef = useRef(null);
  const [tableWidth, setTableWidth] = useState(0);
  const syncingRef = useRef(false);

  function handleTopScroll() {
    if (syncingRef.current) { syncingRef.current = false; return; }
    if (!topScrollRef.current || !tableScrollRef.current) return;
    syncingRef.current = true;
    tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
  }
  function handleTableScroll() {
    if (syncingRef.current) { syncingRef.current = false; return; }
    if (!topScrollRef.current || !tableScrollRef.current) return;
    syncingRef.current = true;
    topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
  }
  useEffect(() => {
    function measure() {
      if (tableScrollRef.current) setTableWidth(tableScrollRef.current.scrollWidth);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  const cfg = TX_CONFIG[productType] ?? TX_CONFIG.finished;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { table, select, inv, hist } = TX_CONFIG[productType] ?? TX_CONFIG.finished;
    try {
      // Supabase caps unpaginated selects at 1000 rows. This query orders
      // ascending (oldest first) because the running-balance calculation
      // below needs to walk forward in time — but that meant once a table
      // passed 1000 rows, everything AFTER the 1000th-oldest row (i.e. the
      // newest entries) was silently dropped. That's why this table froze
      // on an old date while Records (which orders descending, so its cap
      // eats old rows instead of new ones) kept showing today's data.
      // Fix: page through the full table, same pattern TransactionCalendar
      // already uses for its date-dot lookups.
      const PAGE_SIZE = 1000;
      let from = 0;
      let data = [];
      while (true) {
        const { data: pageData, error: fetchError } = await supabase
          .from(table)
          .select(select)
          .order("created_at", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (fetchError) throw fetchError;
        data = data.concat(pageData || []);
        if (!pageData || pageData.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      const responsibleIds = [...new Set((data ?? []).map((r) => r.created_by).filter(Boolean))];
      let emailById = {};
      if (responsibleIds.length > 0) {
        const { data: profileRows, error: profileError } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", responsibleIds);
        if (profileError) throw profileError;
        emailById = Object.fromEntries((profileRows ?? []).map((p) => [p.id, p.email]));
      }

      // Same re-anchoring logic as before: liveBegById / histBegByKey keep
      // balance_before/balance_after identical to what Inventory shows.
      const [{ data: invRows }, { data: histRows }] = await Promise.all([
        supabase.from(inv).select("id, beg_bal"),
        supabase.from(hist).select("inventory_id, inventory_date, beg_bal"),
      ]);
      const liveBegById = Object.fromEntries((invRows ?? []).map((r) => [r.id, Number(r.beg_bal ?? 0)]));
      const histBegByKey = {};
      (histRows ?? []).forEach((r) => {
        histBegByKey[`${r.inventory_id}_${r.inventory_date}`] = Number(r.beg_bal ?? 0);
      });

      const periodState = {}; // inventory_id -> { period, balance }
      const enriched = (data ?? []).map((row) => {
        const invId = row.inventory_id;
        const isRemoved = !!row.removed_at;

        const finalizedDate = row.finalized_at ? toDateString(new Date(row.finalized_at)) : null;
        const isClosedPeriod = finalizedDate != null && histBegByKey[`${invId}_${finalizedDate}`] !== undefined;
        const period = isClosedPeriod ? finalizedDate : "PENDING";

        let state = periodState[invId];
        if (!state || state.period !== period) {
          const anchor =
            period === "PENDING"
              ? (liveBegById[invId] ?? 0)
              : (histBegByKey[`${invId}_${period}`] ?? liveBegById[invId] ?? 0);
          state = { period, balance: anchor };
        }

        const before = state.balance;

        if (isRemoved) {
          periodState[invId] = state;
          return {
            ...row,
            balance_before: before,
            balance_after: before,
            responsible_email: row.created_by ? (emailById[row.created_by] ?? "Unknown account") : null,
          };
        }

        const delta = (row.incoming_bal ?? 0) - (row.outgoing_bal ?? 0);
        const after = before + delta;
        periodState[invId] = { period, balance: after };

        return {
          ...row,
          balance_before: before,
          balance_after: after,
          responsible_email: row.created_by ? (emailById[row.created_by] ?? "Unknown account") : null,
        };
      });

      setLogs(enriched.reverse());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [productType, supabase]);

  useEffect(() => {
    fetchLogs();
    setSearch("");
    setSelectedDate("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }, [fetchLogs]);

  useEffect(() => {
    const { table } = TX_CONFIG[productType] ?? TX_CONFIG.finished;
    const sub = supabase
      .channel(`tx-log-live-${table}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => {
        fetchLogs();
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productType]);

  function formatDateTime(isoString) {
    const date = new Date(isoString);
    return {
      date: date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }),
      time: date.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
  }

  function getStockType(row) {
    if ((row.transaction_type ?? "stock_movement") === "count_correction") return "none";
    if ((row.incoming_bal ?? 0) > 0) return "incoming";
    if ((row.outgoing_bal ?? 0) > 0) return "outgoing";
    return "none";
  }

  function deletedReasonLabel(reason) {
    switch (reason) {
      case "undone_item": return "Deleted (undo item)";
      case "undone_session": return "Deleted (undo session)";
      case "undone": return "Deleted (undo)";
      case "finalize_reverted": return "Reopened";
      default: return "Deleted";
    }
  }

  // ── Date filtering ────────────────────────────────────────────────────────
  const hasRange = !!(dateFrom || dateTo);

  function applyDateRange() { setSelectedDate(""); setPage(1); }
  function clearDateRange() { setDateFrom(""); setDateTo(""); setPage(1); }
  function handleSelectCalendarDate(d) { setDateFrom(""); setDateTo(""); setSelectedDate(d); setPage(1); }

  const filteredLogs = logs.filter((r) => {
    const rowDate = toDateString(new Date(r.created_at));
    if (hasRange) {
      if (dateFrom && rowDate < dateFrom) return false;
      if (dateTo && rowDate > dateTo) return false;
    } else if (selectedDate) {
      if (rowDate !== selectedDate) return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const { date, time } = formatDateTime(r.created_at);
    const stockType = getStockType(r);
    const qty = stockType === "incoming" ? r.incoming_bal : stockType === "outgoing" ? r.outgoing_bal : null;
    const source = r.transaction_source ?? "ordered";
    const txType = r.transaction_type ?? "stock_movement";
    const status = getTxStatus(r);
    const isManipulated = source === "manipulated";
    return [
      r.product_name,
      r.warehouse ?? null,
      r.monitoring_employee,
      r.representative_employee,
      r.staff_employee ?? null,
      r.supplier_name ?? null,
      r.responsible_email ?? null,
      stockType,
      source,
      txType,
      statusLabel(status),
      qty != null ? String(qty) : null,
      isManipulated && r.actual_bal != null ? String(r.actual_bal) : null,
      isManipulated && r.loss != null ? String(r.loss) : null,
      String(r.balance_before),
      String(r.balance_after),
      date,
      time,
    ]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(q));
  });

  // ── pagination slice ─────────────────────────────────────────────────────
  useEffect(() => { setPage(1); }, [search, selectedDate, dateFrom, dateTo, productType]);
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE));
  const pageSlice = filteredLogs.slice((page - 1) * PAGE, page * PAGE);

  const printOpts = () => ({
    productType, dateFrom, dateTo, selectedDate,
    rows: filteredLogs,
    hasSupplier: cfg.hasSupplier,
  });

  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">

      <div className="mb-5 flex justify-between items-start">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Transaction Logs</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Full audit trail of every stock movement and count correction — pick a date on the calendar to jump to a finalized day, or use From/To for a range.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <IconButton
            onClick={() => exportTxCSV(filteredLogs, productType, cfg.hasSupplier)}
            title="Export transaction log as CSV"
            disabled={filteredLogs.length === 0}
          >
            ⬇ CSV
          </IconButton>
          <IconButton
            onClick={() => openDotMatrixPrint(printOpts())}
            title="Print transaction log (dot matrix)"
            disabled={filteredLogs.length === 0}
          >
            🖨️ Print
          </IconButton>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="px-4 py-1.5 rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            <span className={loading ? "inline-block animate-spin mr-1" : "mr-1"}>↻</span>
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
          <button
            onClick={() => setProductType(PRODUCT_TYPE.RAW)}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${productType === PRODUCT_TYPE.RAW ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            Raw Materials
          </button>
          <button
            onClick={() => setProductType(PRODUCT_TYPE.FINISHED)}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${productType === PRODUCT_TYPE.FINISHED ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            Finished Products
          </button>
          <button
            onClick={() => setProductType(PRODUCT_TYPE.PACKAGING)}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${productType === PRODUCT_TYPE.PACKAGING ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            Packaging
          </button>
        </div>

        <div className="w-px h-6 bg-gray-200 mx-0.5" />

        <TransactionCalendar
          productType={productType}
          date={selectedDate}
          onSelectDate={handleSelectCalendarDate}
        />

        <div className="w-px h-6 bg-gray-200 mx-0.5" />

        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-gray-600 font-semibold">From</label>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <label className="text-xs text-gray-600 font-semibold">To</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={applyDateRange}
            className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            Apply
          </button>
          {hasRange && (
            <button
              onClick={clearDateRange}
              className="px-3 py-1.5 rounded-md bg-white border border-gray-200 text-black hover:bg-gray-50 text-sm transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {hasRange ? (
          <span className="text-xs text-blue-600 font-medium bg-blue-50 border border-blue-200 px-2 py-1 rounded-md">
            Showing: {dateFrom || "start"} to {dateTo || "today"}
          </span>
        ) : selectedDate && (
          <span className="text-xs text-blue-600 font-medium bg-blue-50 border border-blue-200 px-2 py-1 rounded-md">
            Showing: {selectedDate}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">

        <div className="flex items-center gap-3 p-3 border-b border-gray-200 bg-gray-50">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products, source, type, status…"
            className="text-black w-full max-w-xs border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear
            </button>
          )}
          {!loading && (
            <span className="ml-auto text-xs text-gray-400 shrink-0">
              {filteredLogs.length} {filteredLogs.length === 1 ? "entry" : "entries"}
            </span>
          )}
        </div>

        {!loading && filteredLogs.length > 0 && (
          <div
            ref={topScrollRef}
            onScroll={handleTopScroll}
            className="overflow-x-auto overflow-y-hidden border-b border-gray-200"
            style={{ height: 14 }}
          >
            <div style={{ width: tableWidth, height: 1 }} />
          </div>
        )}

        <div
          ref={tableScrollRef}
          onScroll={handleTableScroll}
          className="overflow-x-auto"
        >
          {loading ? (
            <div className="px-4 py-4 text-sm text-gray-400">Loading…</div>
          ) : filteredLogs.length === 0 ? (
            <div className="px-4 py-8 text-sm text-gray-400 text-center">
              {logs.length === 0
                ? "No transaction logs yet. Orders placed in the Order Table will appear here."
                : hasRange
                  ? `No transactions between ${dateFrom || "start"} and ${dateTo || "today"}.`
                  : selectedDate
                    ? `No transactions on ${selectedDate}.`
                    : "No results for that search."}
            </div>
          ) : (
            <table className="w-full text-sm min-w-[1900px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Source</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Warehouse</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Product</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Qty Changed</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Balance Before</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Balance After</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actual Count</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">S/O</th>
                  {cfg.hasSupplier && <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Supplier</th>}
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Monitoring</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Representative</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Staff</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Account Responsible</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Date & Time</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageSlice.map((row) => {
                  const stockType = getStockType(row);
                  const { date, time } = formatDateTime(row.created_at);
                  const isIncoming = stockType === "incoming";
                  const isOutgoing = stockType === "outgoing";
                  const isCorrection = (row.transaction_type ?? "stock_movement") === "count_correction";
                  const isManipulated = (row.transaction_source ?? "ordered") === "manipulated";
                  const qty = isIncoming ? row.incoming_bal : isOutgoing ? row.outgoing_bal : null;
                  const status = getTxStatus(row);
                  const isRemoved = isRemovedStatus(status);

                  const rowBg =
                    status === "deleted" ? "bg-red-50/40 border-l-4 border-red-300" :
                      status === "undone_item" ? "bg-gray-50/70 border-l-4 border-slate-300" :
                        status === "undone_session" ? "bg-gray-50/70 border-l-4 border-slate-300" :
                          status === "reverted" ? "bg-orange-50/40 border-l-4 border-orange-300" :
                            isCorrection ? "bg-purple-50/30" : "";

                  return (
                    <tr key={row.id} className={`hover:bg-gray-50 transition-colors ${rowBg}`}>

                      {/* Source */}
                      <td className="px-4 py-3">
                        <span className={isRemoved ? "opacity-50" : ""}>
                          {isManipulated ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200">
                              ⚙ Manipulated
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                              📋 Ordered
                            </span>
                          )}
                        </span>
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3">
                        <span className={isRemoved ? "opacity-50" : ""}>
                          {isCorrection ? (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 border border-purple-200">
                              🔢 Count Correction
                            </span>
                          ) : isIncoming ? (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-green-50 text-green-700">↓ Incoming</span>
                          ) : isOutgoing ? (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-700">↑ Outgoing</span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </span>
                      </td>

                      {/* Warehouse */}
                      <td className={`px-4 py-3 text-gray-600 ${isRemoved ? "opacity-50 line-through" : ""}`}>
                        {row.warehouse ?? <span className="text-gray-300">—</span>}
                      </td>

                      <td className={`px-4 py-3 font-medium text-gray-900 ${isRemoved ? "line-through opacity-50" : ""}`}>
                        {row.product_name}
                      </td>

                      {/* Qty changed */}
                      <td className="px-4 py-3">
                        {!isCorrection && qty != null ? (
                          <span className={`font-semibold ${isRemoved ? "opacity-50 line-through" : isIncoming ? "text-green-600" : "text-red-600"}`}>
                            {isIncoming ? `+${qty}` : `-${qty}`}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>

                      {/* Balance before */}
                      <td className="px-4 py-3">
                        <span className={`font-mono text-xs bg-gray-100 px-2 py-0.5 rounded-md text-gray-600 ${isRemoved ? "opacity-50 line-through" : ""}`}>
                          {row.balance_before}
                        </span>
                      </td>

                      {/* Balance after */}
                      <td className="px-4 py-3">
                        {isCorrection || isRemoved ? (
                          <span className="text-gray-300 text-xs">
                            {isRemoved ? "— (not applied)" : "—"}
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded-md ${isIncoming ? "bg-green-50 text-green-700" : isOutgoing ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                              {row.balance_after}
                            </span>
                            {row.balance_after <= 0 && (
                              <span className="text-xs font-semibold text-red-500">⚠ Empty</span>
                            )}
                            {row.balance_after > 0 && row.balance_after < 100 && (
                              <span className="text-xs font-semibold text-orange-500">⚠ Low</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Actual count */}
                      <td className="px-4 py-3">
                        {isManipulated && row.actual_bal != null ? (
                          <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 ${isRemoved ? "opacity-50 line-through" : ""}`}>
                            {row.actual_bal}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>

                      {/* S/O — signed convention (< 0 red, > 0 green, 0 gray) */}
                      <td className="px-4 py-3">
                        {isManipulated && row.loss != null ? (
                          row.loss < 0 ? (
                            <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-600 ${isRemoved ? "opacity-50 line-through" : ""}`}>
                              {row.loss}
                            </span>
                          ) : row.loss > 0 ? (
                            <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-green-50 text-green-600 ${isRemoved ? "opacity-50 line-through" : ""}`}>
                              +{row.loss}
                            </span>
                          ) : (
                            <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-gray-50 text-gray-600 ${isRemoved ? "opacity-50 line-through" : ""}`}>
                              0
                            </span>
                          )
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>

                      {cfg.hasSupplier && (
                        <td className={`px-4 py-3 text-gray-600 ${isRemoved ? "opacity-50 line-through" : ""}`}>
                          {row.supplier_name ?? <span className="text-gray-300">—</span>}
                        </td>
                      )}

                      {/* Monitoring */}
                      <td className="px-4 py-3">
                        <div className={`flex items-center gap-1.5 ${isRemoved ? "opacity-50 line-through" : ""}`}>
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                            {row.monitoring_employee?.[0]?.toUpperCase() ?? "?"}
                          </span>
                          <span className="text-gray-700">{row.monitoring_employee}</span>
                        </div>
                      </td>

                      {/* Representative */}
                      <td className="px-4 py-3">
                        {row.representative_employee ? (
                          <div className={`flex items-center gap-1.5 ${isRemoved ? "opacity-50 line-through" : ""}`}>
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">
                              {row.representative_employee[0].toUpperCase()}
                            </span>
                            <span className="text-gray-700">{row.representative_employee}</span>
                          </div>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>

                      {/* Staff */}
                      <td className="px-4 py-3">
                        {row.staff_employee ? (
                          <div className={`flex items-center gap-1.5 ${isRemoved ? "opacity-50 line-through" : ""}`}>
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-700">
                              {row.staff_employee[0].toUpperCase()}
                            </span>
                            <span className="text-gray-700">{row.staff_employee}</span>
                          </div>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>

                      {/* Account responsible */}
                      <td className="px-4 py-3">
                        {row.responsible_email
                          ? <span className={`text-xs text-gray-600 font-mono ${isRemoved ? "opacity-50 line-through" : ""}`}>{row.responsible_email}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>

                      {/* Date & time */}
                      <td className="px-4 py-3">
                        <div className={`flex flex-col ${isRemoved ? "opacity-50" : ""}`}>
                          <span className="text-xs font-semibold text-gray-700">{date}</span>
                          <span className="text-xs text-gray-400">{time}</span>
                        </div>
                      </td>

                      {/* Status — 6-state badge (matches records/page.js) */}
                      <td className="px-4 py-3">
                        {status === "finalized" && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-green-50 text-green-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Finalized
                          </span>
                        )}
                        {status === "pending" && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Pending
                          </span>
                        )}
                        {status === "deleted" && (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-700"
                            title={row.removed_at ? `${deletedReasonLabel(row.removed_reason)} ${formatDateTime(row.removed_at).date} ${formatDateTime(row.removed_at).time}` : undefined}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Deleted
                          </span>
                        )}
                        {status === "undone_item" && (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-700"
                            title={row.removed_at ? `Undo item ${formatDateTime(row.removed_at).date} ${formatDateTime(row.removed_at).time}` : undefined}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400" /> ↩ Undo item
                          </span>
                        )}
                        {status === "undone_session" && (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200"
                            title={row.removed_at ? `Undo session ${formatDateTime(row.removed_at).date} ${formatDateTime(row.removed_at).time}` : undefined}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> ↩ Undo session
                          </span>
                        )}
                        {status === "reverted" && (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200"
                            title={row.removed_at ? `Finalize undone ${formatDateTime(row.removed_at).date} ${formatDateTime(row.removed_at).time} — reopened as a new pending order` : undefined}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> ↺ Reopened
                          </span>
                        )}
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!loading && filteredLogs.length > 0 && totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-black">
            <span>Page {page} of {totalPages} · {filteredLogs.length} total</span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ←
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}