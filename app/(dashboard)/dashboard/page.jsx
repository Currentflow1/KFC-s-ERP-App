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

    // STATIC (MASTER LIST)
    const staticTable =
      tab === "finished"
        ? "finished_products_static"
        : "raw_materials_static";

    const { data: staticItems } = await supabase
      .from(staticTable)
      .select("*");

    // INVENTORY TABLE
    const inventoryTable = isHistory
      ? tab === "finished"
        ? "finished_products_inventory_history"
        : "raw_materials_inventory_history"
      : tab === "finished"
        ? "finished_products_inventory"
        : "raw_materials_inventory";

    let query = supabase.from(inventoryTable).select("*");

    if (isHistory) {
      query = query.eq("inventory_date", date);
    }

    const { data: inventoryItems } = await query;

    const map = {};
    (inventoryItems || []).forEach(i => {
      const key = isHistory ? i.inventory_id : i.id;
      map[key] = i;
    });

    const merged = (staticItems || []).map(s => {
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

  // 📊 SUMMARY METRICS
  const summary = useMemo(() => {
    return {
      totalItems: items.length,
      stock: items.reduce((a, b) => a + Number(b.current_bal), 0),
      actual: items.reduce((a, b) => a + Number(b.actual_bal), 0),
      loss: items.reduce((a, b) => a + Number(b.loss), 0),
    };
  }, [items]);

  // 🚨 LOW STOCK / OUT OF STOCK
  const outOfStock = useMemo(
    () => items.filter(i => Number(i.current_bal) === 0),
    [items]
  );

  const lowStock = useMemo(
    () =>
      items.filter(
        i =>
          Number(i.current_bal) > 0 &&
          Number(i.current_bal) < LOW_STOCK_THRESHOLD
      ),
    [items]
  );

  const hasAlerts = outOfStock.length > 0 || lowStock.length > 0;

  return (
    <div className="p-8 bg-gray-50 min-h-screen">

      {/* HEADER */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">
            Inventory Summary Dashboard
          </h1>
          <p className="text-gray-500">
            {date ? `Snapshot: ${date}` : "Live Inventory View"}
          </p>
        </div>

        <button
          onClick={printPage}
          className="bg-black text-white px-4 py-2 rounded"
        >
          Print
        </button>
      </div>

      {/* CONTROLS */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab("finished")}
          className={`px-4 py-2 border rounded ${
            tab === "finished" ? "bg-blue-600 text-white" : "bg-white"
          }`}
        >
          Finished
        </button>

        <button
          onClick={() => setTab("raw")}
          className={`px-4 py-2 border rounded ${
            tab === "raw" ? "bg-blue-600 text-white" : "bg-white"
          }`}
        >
          Raw
        </button>

        <InventoryCalendar
          tab={tab}
          date={date}
          onSelectDate={setDate}
        />
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-blue-500 text-white p-4 rounded-xl">
          Total Items
          <div className="text-2xl font-bold">{summary.totalItems}</div>
        </div>

        <div className="bg-green-500 text-white p-4 rounded-xl">
          Stock
          <div className="text-2xl font-bold">{summary.stock}</div>
        </div>

        <div className="bg-yellow-500 text-white p-4 rounded-xl">
          Actual
          <div className="text-2xl font-bold">{summary.actual}</div>
        </div>

        <div className="bg-red-500 text-white p-4 rounded-xl">
          Loss
          <div className="text-2xl font-bold">{summary.loss}</div>
        </div>
      </div>

      {/* 🚨 LOW STOCK / OUT OF STOCK ALERTS */}
      {hasAlerts && (
        <div className="mb-6 grid grid-cols-2 gap-4">

          {/* OUT OF STOCK */}
          {outOfStock.length > 0 && (
            <div className="bg-white border border-red-300 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
                <h2 className="font-bold text-red-600">
                  Out of Stock
                  <span className="ml-2 text-sm font-normal text-red-400">
                    ({outOfStock.length} item{outOfStock.length !== 1 ? "s" : ""})
                  </span>
                </h2>
              </div>
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {outOfStock.map(i => (
                  <li
                    key={i.id}
                    className="flex justify-between items-center text-sm px-3 py-2 bg-red-50 rounded-lg"
                  >
                    <span className="text-gray-700 font-medium">{i.name}</span>
                    <span className="text-red-600 font-bold">0 units</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* LOW STOCK */}
          {lowStock.length > 0 && (
            <div className="bg-white border border-yellow-300 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" />
                <h2 className="font-bold text-yellow-600">
                  Low Stock
                  <span className="ml-2 text-sm font-normal text-yellow-400">
                    ({lowStock.length} item{lowStock.length !== 1 ? "s" : ""} below {LOW_STOCK_THRESHOLD} units)
                  </span>
                </h2>
              </div>
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {lowStock.map(i => (
                  <li
                    key={i.id}
                    className="flex justify-between items-center text-sm px-3 py-2 bg-yellow-50 rounded-lg"
                  >
                    <span className="text-gray-700 font-medium">{i.name}</span>
                    <span className="text-yellow-600 font-bold">
                      {i.current_bal} units
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>
      )}

      {/* CHARTS */}
      <div className="grid grid-cols-2 gap-4 mb-6">

        {/* STOCK CHART */}
        <div className="bg-white border p-4 rounded-xl">
          <h2 className="font-bold mb-2">Stock Levels</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={items}>
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="current_bal" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* LOSS CHART */}
        <div className="bg-white border p-4 rounded-xl">
          <h2 className="font-bold mb-2">Loss Overview</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={items}>
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="loss" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>

      </div>

      {/* TABLE SUMMARY */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left">Name</th>
              <th>Beg</th>
              <th>In</th>
              <th>Out</th>
              <th>Current</th>
              <th>Actual</th>
              <th>Loss</th>
            </tr>
          </thead>

          <tbody>
            {items.map(i => {
              const isOut = Number(i.current_bal) === 0;
              const isLow =
                Number(i.current_bal) > 0 &&
                Number(i.current_bal) < LOW_STOCK_THRESHOLD;

              return (
                <tr
                  key={i.id}
                  className={`border-t ${
                    isOut
                      ? "bg-red-50"
                      : isLow
                      ? "bg-yellow-50"
                      : ""
                  }`}
                >
                  <td className="p-3 flex items-center gap-2">
                    {isOut && (
                      <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                    )}
                    {isLow && (
                      <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" />
                    )}
                    {i.name}
                  </td>
                  <td className="text-center">{i.beg_bal}</td>
                  <td className="text-center text-green-600">{i.incoming_bal}</td>
                  <td className="text-center text-red-600">{i.outgoing_bal}</td>
                  <td className="text-center">{i.current_bal}</td>
                  <td className="text-center">{i.actual_bal}</td>
                  <td className="text-center text-red-500">{i.loss}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
