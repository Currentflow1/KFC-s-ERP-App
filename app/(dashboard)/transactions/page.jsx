"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function TransactionLogsTable() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchLogs = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch oldest-first per product so we can compute running balance correctly
      const { data, error: fetchError } = await supabase
        .from("raw_materials_transaction_log")
        .select(
          "id, inventory_id, monitoring_employee, representative_employee, supplier_name, product_name, incoming_bal, outgoing_bal, created_at"
        )
        .order("product_name", { ascending: true })
        .order("created_at", { ascending: true });

      if (fetchError) throw fetchError;

      // Compute before/after balance per product using a running total map
      const runningBalance = {}; // { product_name: currentBalance }
      const enriched = (data ?? []).map((row) => {
        const product = row.product_name;
        const before = runningBalance[product] ?? 0;
        const delta = (row.incoming_bal ?? 0) - (row.outgoing_bal ?? 0);
        const after = before + delta;
        runningBalance[product] = after;
        return { ...row, balance_before: before, balance_after: after };
      });

      // Reverse to show newest first for display
      setLogs(enriched.reverse());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const formatDateTime = (isoString) => {
    const date = new Date(isoString);
    return {
      date: date.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      time: date.toLocaleTimeString("en-PH", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    };
  };

  const getStockType = (row) => {
    if ((row.incoming_bal ?? 0) > 0) return "incoming";
    if ((row.outgoing_bal ?? 0) > 0) return "outgoing";
    return "none";
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-slate-800">Transaction Logs</h1>
            <p className="text-sm text-slate-500">
              Full audit trail of every stock movement, including who made the change and inventory balance shifts.
            </p>
          </div>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-60 transition-colors"
          >
            <span className={loading ? "animate-spin inline-block" : ""}>↻</span>
            Refresh
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              Raw Materials — Audit Trail
            </span>
            {!loading && (
              <span className="text-xs text-slate-400">
                {logs.length} {logs.length === 1 ? "entry" : "entries"}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 text-sm text-slate-400">
              Loading logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-sm text-slate-400">
              <span className="text-3xl">📋</span>
              No transaction logs yet. Orders placed in the Order Table will appear here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 whitespace-nowrap">Type</th>
                    <th className="px-4 py-3 whitespace-nowrap">Product</th>
                    <th className="px-4 py-3 whitespace-nowrap">Qty Changed</th>
                    <th className="px-4 py-3 whitespace-nowrap">Balance Before</th>
                    <th className="px-4 py-3 whitespace-nowrap">Balance After</th>
                    <th className="px-4 py-3 whitespace-nowrap">Supplier</th>
                    <th className="px-4 py-3 whitespace-nowrap">Monitoring</th>
                    <th className="px-4 py-3 whitespace-nowrap">Representative</th>
                    <th className="px-4 py-3 whitespace-nowrap">Date & Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((row) => {
                    const stockType = getStockType(row);
                    const { date, time } = formatDateTime(row.created_at);
                    const isIncoming = stockType === "incoming";
                    const isOutgoing = stockType === "outgoing";
                    const qty = isIncoming
                      ? row.incoming_bal
                      : isOutgoing
                      ? row.outgoing_bal
                      : null;

                    return (
                      <tr key={row.id} className="transition-colors hover:bg-slate-50">

                        {/* Type badge */}
                        <td className="px-4 py-3">
                          {isIncoming && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                              ↓ Incoming
                            </span>
                          )}
                          {isOutgoing && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                              ↑ Outgoing
                            </span>
                          )}
                          {stockType === "none" && (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
                              —
                            </span>
                          )}
                        </td>

                        {/* Product */}
                        <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                          {row.product_name}
                        </td>

                        {/* Qty Changed */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {qty != null ? (
                            <span
                              className={`font-semibold ${
                                isIncoming ? "text-blue-700" : "text-rose-700"
                              }`}
                            >
                              {isIncoming ? `+${qty}` : `-${qty}`}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        {/* Balance Before */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                            {row.balance_before}
                          </span>
                        </td>

                        {/* Balance After */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`rounded px-2 py-0.5 font-mono text-xs font-semibold ${
                                isIncoming
                                  ? "bg-blue-50 text-blue-700"
                                  : isOutgoing
                                  ? "bg-rose-50 text-rose-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {row.balance_after}
                            </span>
                            {/* Low stock warning */}
                            {row.balance_after <= 0 && (
                              <span className="text-xs font-semibold text-red-500">
                                ⚠ Empty
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Supplier */}
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          {row.supplier_name ?? (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        {/* Monitoring employee */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                              {row.monitoring_employee?.[0]?.toUpperCase() ?? "?"}
                            </span>
                            <span className="text-slate-700">{row.monitoring_employee}</span>
                          </div>
                        </td>

                        {/* Representative employee */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">
                              {row.representative_employee?.[0]?.toUpperCase() ?? "?"}
                            </span>
                            <span className="text-slate-700">{row.representative_employee}</span>
                          </div>
                        </td>

                        {/* Date & Time */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold text-slate-700">{date}</span>
                            <span className="text-xs text-slate-400">{time}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-violet-200" />
            Monitoring employee
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-amber-200" />
            Representative employee
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono bg-slate-100 px-1 rounded text-slate-600">n</span>
            Balance before transaction
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono bg-blue-50 px-1 rounded text-blue-700">n</span>
            Balance after (incoming)
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono bg-rose-50 px-1 rounded text-rose-700">n</span>
            Balance after (outgoing)
          </div>
        </div>
      </div>
    </div>
  );
}