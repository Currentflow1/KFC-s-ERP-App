"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabaseClient";

function isoDate(d) {
  return d.toISOString().slice(0, 10);
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

export default function InventorySummary({ tab }) {
  const supabase = createClient();

  const [weekly, setWeekly] = useState(null);
  const [monthly, setMonthly] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSummaries();
  }, [tab]);

  async function loadSummaries() {
    setLoading(true);

    const historyTable =
      tab === "finished"
        ? "finished_products_inventory_history"
        : "raw_materials_inventory_history";

    const today = isoDate(new Date());
    const weekStart = rangeStart(6);
    const monthStart = rangeStart(29);

    const { data } = await supabase
      .from(historyTable)
      .select("inventory_date, incoming_bal, outgoing_bal, loss")
      .gte("inventory_date", monthStart)
      .lte("inventory_date", today);

    const rows = data || [];
    const weekRows = rows.filter((r) => r.inventory_date >= weekStart);

    setWeekly(summarize(weekRows));
    setMonthly(summarize(rows));
    setLoading(false);
  }

  if (loading) return null;
  if (!weekly || !monthly || (weekly.days === 0 && monthly.days === 0)) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <div className="text-black bg-white border rounded-lg p-4">
        <h3 className="font-bold mb-2">
          Last 7 days {weekly.days > 0 ? `(${weekly.days} closed day${weekly.days === 1 ? "" : "s"})` : "(no data yet)"}
        </h3>
        <div className="flex gap-6 text-sm">
          <span className="text-green-600">In: {weekly.incoming}</span>
          <span className="text-red-600">Out: {weekly.outgoing}</span>
          <span className="text-orange-600">Loss: {weekly.loss}</span>
        </div>
      </div>

      <div className="text-black bg-white border rounded-lg p-4">
        <h3 className="font-bold mb-2">
          Last 30 days {monthly.days > 0 ? `(${monthly.days} closed day${monthly.days === 1 ? "" : "s"})` : "(no data yet)"}
        </h3>
        <div className="flex gap-6 text-sm">
          <span className="text-green-600">In: {monthly.incoming}</span>
          <span className="text-red-600">Out: {monthly.outgoing}</span>
          <span className="text-orange-600">Loss: {monthly.loss}</span>
        </div>
      </div>
    </div>
  );
}