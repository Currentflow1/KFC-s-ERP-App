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
            {items.map(i => (
              <tr key={i.id} className="border-t">

                <td className="p-3">{i.name}</td>
                <td>{i.beg_bal}</td>
                <td className="text-green-600">{i.incoming_bal}</td>
                <td className="text-red-600">{i.outgoing_bal}</td>
                <td>{i.current_bal}</td>
                <td>{i.actual_bal}</td>
                <td className="text-red-500">{i.loss}</td>

              </tr>
            ))}
          </tbody>

        </table>

      </div>

    </div>
  );
}