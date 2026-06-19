"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabaseClient";
import TransactionCalendar from "./components/TransactionalCalendar";

const PRODUCT_TYPE = { RAW: "raw", FINISHED: "finished" };

// created_by — used to look up the responsible account's email via profiles
// finalized_at — drives the Status badge (Pending vs Finalized) per row
// transaction_source — distinguishes "ordered" (Order Table) from "manipulated" (ManipulatePanel)
const RAW_SELECT = "id, inventory_id, monitoring_employee, representative_employee, supplier_name, product_name, incoming_bal, outgoing_bal, created_at, created_by, finalized_at, transaction_source";
const FIN_SELECT = "id, inventory_id, monitoring_employee, representative_employee, product_name, incoming_bal, outgoing_bal, created_at, created_by, finalized_at, transaction_source";

function pad(n) { return n.toString().padStart(2, "0"); }
function toDateString(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export default function TransactionLogsTable() {
  const supabase = useMemo(() => createClient(), []);

  const [productType, setProductType] = useState(PRODUCT_TYPE.RAW);
  const [logs, setLogs]               = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [search, setSearch]           = useState("");
  const [selectedDate, setSelectedDate] = useState("");

  const isRaw = productType === PRODUCT_TYPE.RAW;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const table  = isRaw ? "raw_materials_transaction_log" : "finished_products_transaction_log";
    const select = isRaw ? RAW_SELECT : FIN_SELECT;
    try {
      const { data, error: fetchError } = await supabase
        .from(table)
        .select(select)
        .order("product_name", { ascending: true })
        .order("created_at",   { ascending: true });

      if (fetchError) throw fetchError;

      // ── Resolve responsible-account emails ────────────────────────────
      // created_by only stores a uuid (auth.users.id). Batch-fetch matching
      // profiles in one query and build a lookup map, rather than joining
      // per-row (profiles is a public table; auth.users is not queryable
      // from the client).
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

      const runningBalance = {};
      const enriched = (data ?? []).map((row) => {
        const product = row.product_name;
        const before  = runningBalance[product] ?? 0;
        const delta   = (row.incoming_bal ?? 0) - (row.outgoing_bal ?? 0);
        const after   = before + delta;
        runningBalance[product] = after;
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
  }, [fetchLogs]);

  function formatDateTime(isoString) {
    const date = new Date(isoString);
    return {
      date: date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }),
      time: date.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
  }

  function getStockType(row) {
    if ((row.incoming_bal ?? 0) > 0) return "incoming";
    if ((row.outgoing_bal ?? 0) > 0) return "outgoing";
    return "none";
  }

  const filteredLogs = logs.filter((r) => {
    // Date filter — rows are never deleted on Finalize (only flagged via
    // finalized_at), so filtering this same live table by date is enough
    // to browse history; no separate archive table needed.
    if (selectedDate) {
      const rowDate = toDateString(new Date(r.created_at));
      if (rowDate !== selectedDate) return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const { date, time } = formatDateTime(r.created_at);
    const stockType = getStockType(r);
    const qty = stockType === "incoming" ? r.incoming_bal : stockType === "outgoing" ? r.outgoing_bal : null;
    const source = r.transaction_source ?? "ordered";
    return [
      r.product_name,
      r.monitoring_employee,
      r.representative_employee,
      r.supplier_name ?? null,
      r.responsible_email ?? null,
      stockType,
      source,
      qty != null ? String(qty) : null,
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
            Full audit trail of every stock movement — pick a date on the calendar to jump to a finalized day.
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
              isRaw ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Raw Materials
          </button>
          <button
            onClick={() => setProductType(PRODUCT_TYPE.FINISHED)}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${
              !isRaw ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Finished Products
          </button>
        </div>

        <div className="w-px h-6 bg-gray-200 mx-0.5" />

        {/* Same calendar visual language as Inventory — dots mark finalized days */}
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
            placeholder="Search products, source…"
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

        <div className="overflow-x-auto">
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
            <table className="w-full text-sm min-w-[1450px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Source</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Product</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Qty Changed</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Balance Before</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Balance After</th>
                  {isRaw && <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Supplier</th>}
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Monitoring</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Representative</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Account Responsible</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Date & Time</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredLogs.map((row) => {
                  const stockType  = getStockType(row);
                  const { date, time } = formatDateTime(row.created_at);
                  const isIncoming = stockType === "incoming";
                  const isOutgoing = stockType === "outgoing";
                  const qty = isIncoming ? row.incoming_bal : isOutgoing ? row.outgoing_bal : null;
                  const isManipulated = (row.transaction_source ?? "ordered") === "manipulated";

                  return (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">

                      {/* Source — "Ordered" (normal Order Table flow) vs "Manipulated" (admin direct edit) */}
                      <td className="px-4 py-3">
                        {isManipulated ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200">
                            ⚙ Manipulated
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                            📋 Ordered
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {isIncoming && <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-green-50 text-green-700">↓ Incoming</span>}
                        {isOutgoing && <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-700">↑ Outgoing</span>}
                        {stockType === "none" && <span className="text-xs text-gray-400">—</span>}
                      </td>

                      <td className="px-4 py-3 font-medium text-gray-900">{row.product_name}</td>

                      <td className="px-4 py-3">
                        {qty != null ? (
                          <span className={`font-semibold ${isIncoming ? "text-green-600" : "text-red-600"}`}>
                            {isIncoming ? `+${qty}` : `-${qty}`}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded-md text-gray-600">
                          {row.balance_before}
                        </span>
                      </td>

                      <td className="px-4 py-3">
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
                      </td>

                      {isRaw && (
                        <td className="px-4 py-3 text-gray-600">
                          {row.supplier_name
                            ? row.supplier_name
                            : <span className="text-gray-300">—</span>}
                        </td>
                      )}

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                            {row.monitoring_employee?.[0]?.toUpperCase() ?? "?"}
                          </span>
                          <span className="text-gray-700">{row.monitoring_employee}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        {row.representative_employee
                          ? (
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">
                                {row.representative_employee[0].toUpperCase()}
                              </span>
                              <span className="text-gray-700">{row.representative_employee}</span>
                            </div>
                          )
                          : <span className="text-gray-300">—</span>
                        }
                      </td>

                      {/* Account Responsible — the logged-in user (auth.uid()) who created this row */}
                      <td className="px-4 py-3">
                        {row.responsible_email
                          ? <span className="text-xs text-gray-600 font-mono">{row.responsible_email}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-gray-700">{date}</span>
                          <span className="text-xs text-gray-400">{time}</span>
                        </div>
                      </td>

                      {/* Status — reflects finalized_at, set by InventoryPage's finalizeDay() */}
                      <td className="px-4 py-3">
                        {row.finalized_at ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-green-50 text-green-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Finalized
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            Pending
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