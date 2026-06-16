"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import InventoryCalendar from "../inventory/components/InventoryCalendar";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const LOW_STOCK_THRESHOLD = 100;

export default function InventoryPage() {
  const [tab, setTab] = useState("finished");
  const [items, setItems] = useState([]);
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [tab, date]);

  async function loadData() {
    setLoading(true);

    const isHistory = date !== "";

    const staticTable =
      tab === "finished" ? "finished_products_static" : "raw_materials_static";

    const { data: staticItems } = await supabase.from(staticTable).select("*");

    const inventoryTable = isHistory
      ? tab === "finished"
        ? "finished_products_inventory_history"
        : "raw_materials_inventory_history"
      : tab === "finished"
        ? "finished_products_inventory"
        : "raw_materials_inventory";

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
        id: s.id,
        name: s.name,
        category_id: s.category_id,
        beg_bal: inv?.beg_bal ?? 0,
        incoming_bal: inv?.incoming_bal ?? 0,
        outgoing_bal: inv?.outgoing_bal ?? 0,
        current_bal: inv?.current_bal ?? 0,
        actual_bal: inv?.actual_bal ?? 0,
        loss: inv?.loss ?? 0,
      };
    });

    setItems(merged);
    setLoading(false);
  }

  function printPage() {
    window.print();
  }

  const summary = useMemo(() => ({
    totalItems: items.length,
    stock: items.reduce((a, b) => a + Number(b.current_bal), 0),
    actual: items.reduce((a, b) => a + Number(b.actual_bal), 0),
    loss: items.reduce((a, b) => a + Number(b.loss), 0),
  }), [items]);

  const outOfStock = useMemo(
    () => items.filter((i) => Number(i.current_bal) === 0),
    [items]
  );

  const lowStock = useMemo(
    () => items.filter((i) => Number(i.current_bal) > 0 && Number(i.current_bal) < LOW_STOCK_THRESHOLD),
    [items]
  );

  const hasAlerts = outOfStock.length > 0 || lowStock.length > 0;

  return (
    <>
      {/* ── PRINT STYLES ── */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm 10mm;
          }

          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; inset: 0; }

          .no-print { display: none !important; }

          /* Dot-matrix feel */
          #print-area {
            font-family: 'Courier New', Courier, monospace !important;
            font-size: 11px !important;
            color: #000 !important;
            background: #fff !important;
          }

          #print-area h1 {
            font-size: 15px !important;
            font-weight: bold;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            border-bottom: 2px solid #000;
            padding-bottom: 4px;
            margin-bottom: 8px;
          }

          #print-area .print-subtitle {
            font-size: 10px;
            margin-bottom: 12px;
            border-bottom: 1px dashed #000;
            padding-bottom: 4px;
          }

          /* KPI row */
          #print-area .print-kpi-row {
            display: flex;
            gap: 16px;
            margin-bottom: 12px;
            border: 1px solid #000;
            padding: 6px 10px;
          }

          #print-area .print-kpi-row span {
            font-size: 10px;
            text-transform: uppercase;
          }

          #print-area .print-kpi-row strong {
            display: block;
            font-size: 13px;
          }

          /* Alerts */
          #print-area .print-alert-section {
            margin-bottom: 10px;
            border: 1px dashed #000;
            padding: 4px 8px;
          }

          #print-area .print-alert-title {
            font-weight: bold;
            font-size: 10px;
            text-transform: uppercase;
            margin-bottom: 4px;
          }

          #print-area .print-alert-item {
            font-size: 10px;
            display: flex;
            justify-content: space-between;
            border-bottom: 1px dotted #ccc;
            padding: 1px 0;
          }

          /* Table */
          #print-area table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
          }

          #print-area thead tr {
            border-top: 2px solid #000;
            border-bottom: 2px solid #000;
          }

          #print-area th {
            font-weight: bold;
            text-align: center;
            padding: 3px 4px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }

          #print-area th:first-child { text-align: left; }

          #print-area td {
            padding: 3px 4px;
            text-align: center;
            border-bottom: 1px dotted #aaa;
          }

          #print-area td:first-child { text-align: left; }

          #print-area tbody tr:last-child td { border-bottom: 2px solid #000; }

          #print-area .print-footer {
            margin-top: 10px;
            font-size: 9px;
            border-top: 1px dashed #000;
            padding-top: 4px;
            color: #555;
          }

          /* Charts hidden in print */
          #print-area .print-hide-chart { display: none !important; }
        }
      `}</style>

      <div id="print-area" className="p-8 bg-slate-50 min-h-screen">

        {/* ── HEADER ── */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              Inventory Summary Dashboard
            </h1>
            <p className="print-subtitle text-sm text-slate-500 mt-0.5">
              {date ? `Snapshot: ${date}` : "Live Inventory View"} &mdash;{" "}
              {tab === "finished" ? "Finished Products" : "Raw Materials"}
            </p>
          </div>

          <button
            onClick={printPage}
            className="no-print flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50 transition-colors"
          >
            🖨 Print
          </button>
        </div>

        {/* ── CONTROLS ── */}
        <div className="no-print flex gap-2 mb-6">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button
              onClick={() => setTab("finished")}
              className={`rounded-md px-5 py-2 text-sm font-semibold transition-all duration-200 ${
                tab === "finished"
                  ? "bg-blue-600 text-white shadow"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Finished Products
            </button>
            <button
              onClick={() => setTab("raw")}
              className={`rounded-md px-5 py-2 text-sm font-semibold transition-all duration-200 ${
                tab === "raw"
                  ? "bg-blue-600 text-white shadow"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Raw Materials
            </button>
          </div>

          <InventoryCalendar tab={tab} date={date} onSelectDate={setDate} />
        </div>

        {/* ── KPI CARDS ── */}
        <div className="print-kpi-row grid grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Items", value: summary.totalItems, color: "bg-blue-600" },
            { label: "Stock",       value: summary.stock,      color: "bg-green-600" },
            { label: "Actual",      value: summary.actual,     color: "bg-yellow-500" },
            { label: "Loss",        value: summary.loss,       color: "bg-rose-600" },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className={`${color} text-white rounded-xl p-4 shadow-sm`}
            >
              <span className="text-xs font-semibold uppercase tracking-widest opacity-80">
                {label}
              </span>
              <strong className="block text-3xl font-bold mt-1">{value}</strong>
            </div>
          ))}
        </div>

        {/* ── ALERTS ── */}
        {hasAlerts && (
          <div className="mb-6 grid grid-cols-2 gap-4">

            {outOfStock.length > 0 && (
              <div className="print-alert-section bg-white border border-red-200 rounded-xl p-4 shadow-sm">
                <div className="print-alert-title flex items-center gap-2 mb-3">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="font-bold text-red-600 text-sm">
                    Out of Stock
                    <span className="ml-2 text-xs font-normal text-red-400">
                      ({outOfStock.length} item{outOfStock.length !== 1 ? "s" : ""})
                    </span>
                  </span>
                </div>
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {outOfStock.map((i) => (
                    <li
                      key={i.id}
                      className="print-alert-item flex justify-between items-center text-sm px-3 py-2 bg-red-50 rounded-lg"
                    >
                      <span className="text-slate-700 font-medium">{i.name}</span>
                      <span className="text-red-600 font-bold">0 units</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {lowStock.length > 0 && (
              <div className="print-alert-section bg-white border border-yellow-200 rounded-xl p-4 shadow-sm">
                <div className="print-alert-title flex items-center gap-2 mb-3">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" />
                  <span className="font-bold text-yellow-600 text-sm">
                    Low Stock
                    <span className="ml-2 text-xs font-normal text-yellow-400">
                      ({lowStock.length} item{lowStock.length !== 1 ? "s" : ""} below {LOW_STOCK_THRESHOLD} units)
                    </span>
                  </span>
                </div>
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {lowStock.map((i) => (
                    <li
                      key={i.id}
                      className="print-alert-item flex justify-between items-center text-sm px-3 py-2 bg-yellow-50 rounded-lg"
                    >
                      <span className="text-slate-700 font-medium">{i.name}</span>
                      <span className="text-yellow-600 font-bold">{i.current_bal} units</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </div>
        )}

        {/* ── CHARTS ── */}
        <div className="print-hide-chart grid grid-cols-2 gap-4 mb-6">

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-3">
              Stock Levels
            </h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={items}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="current_bal" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-3">
              Loss Overview
            </h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={items}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="loss" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

        </div>

        {/* ── TABLE ── */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              {tab === "finished" ? "Finished Products" : "Raw Materials"} — Inventory Detail
            </span>
            {loading && (
              <span className="text-xs text-slate-400 animate-pulse">Loading...</span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 text-center">Beg</th>
                  <th className="px-4 py-3 text-center">Incoming</th>
                  <th className="px-4 py-3 text-center">Outgoing</th>
                  <th className="px-4 py-3 text-center">Current</th>
                  <th className="px-4 py-3 text-center">Actual</th>
                  <th className="px-4 py-3 text-center">Loss</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {items.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">
                      No inventory data found.
                    </td>
                  </tr>
                )}

                {items.map((i) => {
                  const isOut = Number(i.current_bal) === 0;
                  const isLow = Number(i.current_bal) > 0 && Number(i.current_bal) < LOW_STOCK_THRESHOLD;

                  return (
                    <tr
                      key={i.id}
                      className={`transition-colors hover:bg-slate-50 ${
                        isOut ? "bg-red-50" : isLow ? "bg-yellow-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3 flex items-center gap-2 font-medium text-slate-800">
                        {isOut && <span className="inline-block w-2 h-2 rounded-full bg-red-500 shrink-0" />}
                        {isLow && <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 shrink-0" />}
                        {i.name}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-600">{i.beg_bal}</td>
                      <td className="px-4 py-3 text-center font-semibold text-green-600">
                        {i.incoming_bal > 0 ? `+${i.incoming_bal}` : i.incoming_bal}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-rose-600">
                        {i.outgoing_bal > 0 ? `-${i.outgoing_bal}` : i.outgoing_bal}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          isOut
                            ? "bg-red-100 text-red-700"
                            : isLow
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-slate-100 text-slate-700"
                        }`}>
                          {i.current_bal}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-600">{i.actual_bal}</td>
                      <td className="px-4 py-3 text-center font-semibold text-rose-500">{i.loss}</td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Print-only totals footer */}
              {items.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-600">
                    <td className="px-4 py-2">Totals</td>
                    <td className="px-4 py-2 text-center">
                      {items.reduce((a, b) => a + Number(b.beg_bal), 0)}
                    </td>
                    <td className="px-4 py-2 text-center text-green-700">
                      +{items.reduce((a, b) => a + Number(b.incoming_bal), 0)}
                    </td>
                    <td className="px-4 py-2 text-center text-rose-700">
                      -{items.reduce((a, b) => a + Number(b.outgoing_bal), 0)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {summary.stock}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {summary.actual}
                    </td>
                    <td className="px-4 py-2 text-center text-rose-600">
                      {summary.loss}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Print footer */}
        <div className="print-footer hidden print:block mt-4 text-xs text-slate-400 border-t border-dashed border-slate-300 pt-3">
          <div className="flex justify-between">
            <span>Inventory System — {tab === "finished" ? "Finished Products" : "Raw Materials"}</span>
            <span>Printed: {new Date().toLocaleString()}</span>
          </div>
          {date && <span>Snapshot Date: {date}</span>}
        </div>

      </div>
    </>
  );
}