"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabaseClient";
import TransactionCalendar from "./components/TransactionalCalendar";

const PRODUCT_TYPE = { RAW: "raw", FINISHED: "finished", PACKAGING: "packaging" };

const RAW_SELECT = "id, inventory_id, monitoring_employee, representative_employee, staff_employee, supplier_name, product_name, warehouse, incoming_bal, outgoing_bal, actual_bal, loss, created_at, created_by, finalized_at, removed_at, removed_reason, transaction_source, transaction_type";
const FIN_SELECT = "id, inventory_id, monitoring_employee, representative_employee, staff_employee, product_name, warehouse, incoming_bal, outgoing_bal, actual_bal, loss, created_at, created_by, finalized_at, removed_at, removed_reason, transaction_source, transaction_type";

// packaging_transaction_log has the same columns as raw_materials_transaction_log
// (including supplier_name), so it reuses RAW_SELECT.
// `inv` / `hist` point to the same inventory tables InventoryPage.js reads,
// so this table can anchor its running balance to InventoryPage's real
// checkpoints instead of drifting from a from-scratch sum.
const TX_CONFIG = {
  raw:       { table: "raw_materials_transaction_log",     select: RAW_SELECT, hasSupplier: true,  label: "Raw Materials",     inv: "raw_materials_inventory",     hist: "raw_materials_inventory_history" },
  finished:  { table: "finished_products_transaction_log", select: FIN_SELECT, hasSupplier: false, label: "Finished Products", inv: "finished_products_inventory", hist: "finished_products_inventory_history" },
  packaging: { table: "packaging_transaction_log",         select: RAW_SELECT, hasSupplier: true,  label: "Packaging",         inv: "packaging_inventory",         hist: "packaging_inventory_history" },
};

function pad(n) { return n.toString().padStart(2, "0"); }
function toDateString(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export default function TransactionLogsTable() {
  const supabase = useMemo(() => createClient(), []);

  const [productType, setProductType]   = useState(PRODUCT_TYPE.RAW);
  const [logs, setLogs]                 = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [search, setSearch]             = useState("");
  const [selectedDate, setSelectedDate] = useState("");

  // ── Top scrollbar sync ───────────────────────────────────────────────────
  const topScrollRef   = useRef(null);
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
      if (tableScrollRef.current) {
        setTableWidth(tableScrollRef.current.scrollWidth);
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  const cfg = TX_CONFIG[productType] ?? TX_CONFIG.finished;
  const isRaw = productType === PRODUCT_TYPE.RAW; // kept for raw-specific copy only (none currently)

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { table, select, inv, hist } = TX_CONFIG[productType] ?? TX_CONFIG.finished;
    try {
      const { data, error: fetchError } = await supabase
        .from(table)
        .select(select)
        .order("created_at", { ascending: true });

      if (fetchError) throw fetchError;

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

      // Pull the checkpoints InventoryPage.js actually trusts:
      // - liveBegById: the current beg_bal on the live inventory row
      //   (this is what "today"/pending balances are anchored to)
      // - histBegByKey: the beg_bal stored per inventory_id + inventory_date
      //   in the *_inventory_history table (what a finalized day started at)
      // A pure running sum from zero never reflects the fact that Finalize
      // resets beg_bal to actual_bal, so any day with a count-correction
      // loss/gain permanently desyncs a from-scratch total from Inventory's
      // number. Re-anchoring here keeps the two views identical.
      const [{ data: invRows }, { data: histRows }] = await Promise.all([
        supabase.from(inv).select("id, beg_bal"),
        supabase.from(hist).select("inventory_id, inventory_date, beg_bal"),
      ]);
      const liveBegById = Object.fromEntries(
        (invRows ?? []).map((r) => [r.id, Number(r.beg_bal ?? 0)])
      );
      const histBegByKey = {};
      (histRows ?? []).forEach((r) => {
        histBegByKey[`${r.inventory_id}_${r.inventory_date}`] = Number(r.beg_bal ?? 0);
      });

      // Running balance is now tracked per inventory_id (a specific
      // product+warehouse row) instead of per product_name, so two
      // warehouses holding the same product no longer share one total.
      // `period` is either a finalized calendar date, or "PENDING" for
      // rows not yet rolled forward — all still-pending rows for a given
      // inventory_id share one live period regardless of which calendar
      // day they were created on, matching how Inventory computes
      // current_bal (beg_bal + all unfinalized tx, unconditionally).
      const periodState = {}; // inventory_id -> { period, balance }
      const enriched = (data ?? []).map((row) => {
        const invId     = row.inventory_id;
        const isRemoved = !!row.removed_at;

        // A row's finalized_at alone does NOT mean it belongs to a *closed*
        // historical day. Manipulations (stock movements + count
        // corrections from ManipulatePanel) get finalized_at stamped at
        // insert time — see buildTxPayload's `finalized_at: new Date()...`
        // — well before that calendar day is ever actually rolled forward
        // via "Finalize day". Ordered transactions, meanwhile, stay
        // finalized_at: null (period "PENDING") until Finalize runs.
        //
        // The only thing that genuinely closes a day is runFinalize()
        // writing a row into *_inventory_history for that date. So we only
        // trust finalized_at as marking a real closed period when a
        // matching history row actually exists for it; otherwise the row
        // is still part of today's open book and belongs in the same
        // running-balance thread as PENDING rows — matching how
        // InventoryPage.js's current_bal combines the committed columns
        // (which manipulations write straight into) with all unfinalized
        // pending tx as ONE number. Without this, a manipulation
        // interleaved with pending orders on the same still-open day
        // silently forks off its own disconnected period, anchors back to
        // liveBegById, and the log's balance_after drifts from what
        // Inventory actually displays.
        const finalizedDate  = row.finalized_at ? toDateString(new Date(row.finalized_at)) : null;
        const isClosedPeriod = finalizedDate != null && histBegByKey[`${invId}_${finalizedDate}`] !== undefined;
        const period          = isClosedPeriod ? finalizedDate : "PENDING";

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
            balance_before:    before,
            balance_after:     before,
            responsible_email: row.created_by ? (emailById[row.created_by] ?? "Unknown account") : null,
          };
        }

        const delta = (row.incoming_bal ?? 0) - (row.outgoing_bal ?? 0);
        const after = before + delta;
        periodState[invId] = { period, balance: after };

        return {
          ...row,
          balance_before:    before,
          balance_after:     after,
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

  // ── Status helper ─────────────────────────────────────────────────────────
  // Priority: removed (deleted/finalize_reverted) > finalized > pending.
  // 'deleted', 'undone_item', 'undone_session', and legacy 'undone' all
  // surface as "deleted" — see the removed_reason note up top.
  function getStatus(row) {
    if (row.removed_at) {
      if (row.removed_reason === "finalize_reverted") return "reverted";
      return "deleted";
    }
    if (row.finalized_at) return "finalized";
    return "pending";
  }

  function deletedReasonLabel(reason) {
    switch (reason) {
      case "undone_item":    return "Deleted (undo item)";
      case "undone_session": return "Deleted (undo session)";
      case "undone":          return "Deleted (undo)";
      default:                return "Deleted";
    }
  }

  const filteredLogs = logs.filter((r) => {
    if (selectedDate) {
      const rowDate = toDateString(new Date(r.created_at));
      if (rowDate !== selectedDate) return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const { date, time } = formatDateTime(r.created_at);
    const stockType     = getStockType(r);
    const qty           = stockType === "incoming" ? r.incoming_bal : stockType === "outgoing" ? r.outgoing_bal : null;
    const source        = r.transaction_source ?? "ordered";
    const txType        = r.transaction_type   ?? "stock_movement";
    const status         = getStatus(r);
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
      status,
      qty != null ? String(qty) : null,
      isManipulated && r.actual_bal != null ? String(r.actual_bal) : null,
      isManipulated && r.loss      != null ? String(r.loss)       : null,
      String(r.balance_before),
      String(r.balance_after),
      date,
      time,
    ]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(q));
  });

  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">

      <div className="mb-5 flex justify-between items-start">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Transaction Logs</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Full audit trail of every stock movement and count correction — pick a date on the calendar to jump to a finalized day.
          </p>
        </div>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="px-4 py-1.5 rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium transition-colors"
        >
          <span className={loading ? "inline-block animate-spin mr-1" : "mr-1"}>↻</span>
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
          <button
            onClick={() => setProductType(PRODUCT_TYPE.RAW)}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              productType === PRODUCT_TYPE.RAW ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Raw Materials
          </button>
          <button
            onClick={() => setProductType(PRODUCT_TYPE.FINISHED)}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${
              productType === PRODUCT_TYPE.FINISHED ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Finished Products
          </button>
          <button
            onClick={() => setProductType(PRODUCT_TYPE.PACKAGING)}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${
              productType === PRODUCT_TYPE.PACKAGING ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Packaging
          </button>
        </div>

        <div className="w-px h-6 bg-gray-200 mx-0.5" />

        <TransactionCalendar
          productType={productType}
          date={selectedDate}
          onSelectDate={setSelectedDate}
        />

        {selectedDate && (
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
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Loss</th>
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
                {filteredLogs.map((row) => {
                  const stockType      = getStockType(row);
                  const { date, time } = formatDateTime(row.created_at);
                  const isIncoming     = stockType === "incoming";
                  const isOutgoing     = stockType === "outgoing";
                  const isCorrection   = (row.transaction_type ?? "stock_movement") === "count_correction";
                  const isManipulated  = (row.transaction_source ?? "ordered") === "manipulated";
                  const qty            = isIncoming ? row.incoming_bal : isOutgoing ? row.outgoing_bal : null;
                  const status         = getStatus(row);
                  const isRemoved      = status === "deleted" || status === "reverted";

                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-gray-50 transition-colors ${
                        isCorrection
                          ? "bg-purple-50/30"
                          : status === "deleted"
                            ? "bg-red-50/40 border-l-4 border-red-300"
                            : status === "reverted"
                              ? "bg-orange-50/40 border-l-4 border-orange-300"
                              : ""
                      }`}
                    >

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
                            <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded-md ${
                              isIncoming ? "bg-green-50 text-green-700"
                              : isOutgoing ? "bg-red-50 text-red-700"
                              : "bg-gray-100 text-gray-600"
                            }`}>
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

                      {/* Loss */}
                      <td className="px-4 py-3">
                        {isManipulated && row.loss != null ? (
                          row.loss > 0 ? (
                            <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-600 ${isRemoved ? "opacity-50 line-through" : ""}`}>
                              -{row.loss}
                            </span>
                          ) : (
                            <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-green-50 text-green-600 ${isRemoved ? "opacity-50 line-through" : ""}`}>
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

                      {/* Status — 4 states: pending / finalized / deleted / reverted */}
                      <td className="px-4 py-3">
                        {status === "finalized" && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-green-50 text-green-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Finalized
                          </span>
                        )}
                        {status === "pending" && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            Pending
                          </span>
                        )}
                        {status === "deleted" && (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-700"
                            title={
                              row.removed_at
                                ? `${deletedReasonLabel(row.removed_reason)} ${formatDateTime(row.removed_at).date} ${formatDateTime(row.removed_at).time}`
                                : undefined
                            }
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                            Deleted
                          </span>
                        )}
                        {status === "reverted" && (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200"
                            title={row.removed_at ? `Finalize undone ${formatDateTime(row.removed_at).date} ${formatDateTime(row.removed_at).time} — reopened as a new pending order` : undefined}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                            ↺ Reopened
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
      </div>
    </div>
  );
}