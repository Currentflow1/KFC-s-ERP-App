"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

const PRODUCT_TYPE = { RAW: "raw", FINISHED: "finished" };

const RAW_SELECT    = "id, inventory_id, monitoring_employee, representative_employee, supplier_name, product_name, incoming_bal, outgoing_bal, created_at";
const FIN_SELECT    = "id, inventory_id, monitoring_employee, representative_employee, product_name, incoming_bal, outgoing_bal, created_at";

export default function TransactionLogsTable() {
  const [productType, setProductType] = useState(PRODUCT_TYPE.RAW);
  const [logs, setLogs]               = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [search, setSearch]           = useState("");

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

      const runningBalance = {};
      const enriched = (data ?? []).map((row) => {
        const product = row.product_name;
        const before  = runningBalance[product] ?? 0;
        const delta   = (row.incoming_bal ?? 0) - (row.outgoing_bal ?? 0);
        const after   = before + delta;
        runningBalance[product] = after;
        return { ...row, balance_before: before, balance_after: after };
      });

      setLogs(enriched.reverse());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [productType]);

  useEffect(() => {
    fetchLogs();
    setSearch("");
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
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const { date, time } = formatDateTime(r.created_at);
    const stockType = getStockType(r);
    const qty = stockType === "incoming" ? r.incoming_bal : stockType === "outgoing" ? r.outgoing_bal : null;
    return [
      r.product_name,
      r.monitoring_employee,
      r.representative_employee,
      r.supplier_name ?? null,
      stockType,
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
    <div className="p-8 bg-gray-50 min-h-screen">

      {/* HEADER */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Transaction Logs</h1>
          <p className="text-sm text-gray-500">Full audit trail of every stock movement</p>
        </div>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="border px-4 py-2 rounded bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50 text-sm font-semibold"
        >
          <span className={loading ? "inline-block animate-spin mr-1" : "mr-1"}>↻</span>
          Refresh
        </button>
      </div>

      {/* PRODUCT TYPE TABS */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <button
          onClick={() => setProductType(PRODUCT_TYPE.RAW)}
          className={`px-4 py-2 border rounded text-sm font-medium ${
            isRaw ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-700"
          }`}
        >
          Raw Materials
        </button>
        <button
          onClick={() => setProductType(PRODUCT_TYPE.FINISHED)}
          className={`px-4 py-2 border rounded text-sm font-medium ${
            !isRaw ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-700"
          }`}
        >
          Finished Products
        </button>
      </div>

      {/* ERROR */}
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* TABLE */}
      <div className="bg-white border rounded-lg overflow-x-auto">

        <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="border px-3 py-2 rounded w-full max-w-xs"
          />
          {!loading && (
            <span className="text-xs text-gray-400 ml-3 whitespace-nowrap">
              {filteredLogs.length} {filteredLogs.length === 1 ? "entry" : "entries"}
            </span>
          )}
        </div>

        {loading ? (
          <div className="p-6 text-gray-500">Loading...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-6 text-gray-500">
            {logs.length === 0
              ? "No transaction logs yet. Orders placed in the Order Table will appear here."
              : "No results for that search."}
          </div>
        ) : (
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Product</th>
                <th className="p-3 text-left">Qty Changed</th>
                <th className="p-3 text-left">Balance Before</th>
                <th className="p-3 text-left">Balance After</th>
                {isRaw && <th className="p-3 text-left">Supplier</th>}
                <th className="p-3 text-left">Monitoring</th>
                <th className="p-3 text-left">Representative</th>
                <th className="p-3 text-left">Date & Time</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((row) => {
                const stockType  = getStockType(row);
                const { date, time } = formatDateTime(row.created_at);
                const isIncoming = stockType === "incoming";
                const isOutgoing = stockType === "outgoing";
                const qty = isIncoming ? row.incoming_bal : isOutgoing ? row.outgoing_bal : null;

                return (
                  <tr key={row.id} className="border-t hover:bg-gray-50">

                    {/* Type */}
                    <td className="p-3">
                      {isIncoming && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">↓ Incoming</span>}
                      {isOutgoing && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700">↑ Outgoing</span>}
                      {stockType === "none" && <span className="text-xs text-gray-400">—</span>}
                    </td>

                    {/* Product */}
                    <td className="p-3 font-medium">{row.product_name}</td>

                    {/* Qty Changed */}
                    <td className="p-3">
                      {qty != null ? (
                        <span className={`font-semibold ${isIncoming ? "text-green-600" : "text-red-600"}`}>
                          {isIncoming ? `+${qty}` : `-${qty}`}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Balance Before */}
                    <td className="p-3">
                      <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                        {row.balance_before}
                      </span>
                    </td>

                    {/* Balance After */}
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded ${
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

                    {/* Supplier — raw only, null-safe */}
                    {isRaw && (
                      <td className="p-3 text-gray-600">
                        {row.supplier_name
                          ? row.supplier_name
                          : <span className="text-gray-300">—</span>}
                      </td>
                    )}

                    {/* Monitoring */}
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                          {row.monitoring_employee?.[0]?.toUpperCase() ?? "?"}
                        </span>
                        <span className="text-gray-700">{row.monitoring_employee}</span>
                      </div>
                    </td>

                    {/* Representative — null for incoming orders */}
                    <td className="p-3">
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

                    {/* Date & Time */}
                    <td className="p-3">
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-gray-700">{date}</span>
                        <span className="text-xs text-gray-400">{time}</span>
                      </div>
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}