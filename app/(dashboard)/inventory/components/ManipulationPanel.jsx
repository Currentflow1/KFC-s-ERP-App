"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function ManipulatePanel({ item, tab, onClose, onUpdated }) {
  const [qty, setQty] = useState("");
  const [actual, setActual] = useState("");
  const [saving, setSaving] = useState(false);

  const table =
    tab === "finished"
      ? "finished_products_inventory"
      : "raw_materials_inventory";

  async function fetchCurrent() {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("id", item.id)
      .maybeSingle();
    if (error) {
      alert("Failed to load current values: " + error.message);
      return null;
    }
    return data;
  }

  async function applyChange(mode) {
    const q = Number(qty || 0);
    if (!q) { setQty(""); return; }

    setSaving(true);

    // 1. Fetch the latest values first
    const data = await fetchCurrent();
    if (!data) { setSaving(false); return; }

    const beg      = Number(data.beg_bal      ?? 0);
    let incoming   = Number(data.incoming_bal  ?? 0);
    let outgoing   = Number(data.outgoing_bal  ?? 0);

    if (mode === "in")  incoming += q;
    if (mode === "out") outgoing += q;

    const current = beg + incoming - outgoing;

    // 2. Save to DB
    const { error } = await supabase.from(table).upsert({
      id: item.id,
      name: item.name,
      beg_bal: beg,
      incoming_bal: incoming,
      outgoing_bal: outgoing,
      current_bal: current,
      actual_bal: current,
      loss: 0,
    });

    if (error) {
      alert("Update failed: " + error.message);
      setSaving(false);
      return;
    }

    // 3. Only AFTER a successful save: snapshot + reload
    await onUpdated();

    setSaving(false);
    setQty("");
  }

  async function setActualValue() {
    if (actual === "") return;

    setSaving(true);

    // 1. Fetch latest values first
    const data = await fetchCurrent();
    if (!data) { setSaving(false); return; }

    const beg      = Number(data.beg_bal      ?? 0);
    const incoming = Number(data.incoming_bal  ?? 0);
    const outgoing = Number(data.outgoing_bal  ?? 0);
    const current  = Number(data.current_bal   ?? (beg + incoming - outgoing));
    const a        = Number(actual || 0);
    const loss     = Math.max(0, current - a);

    // 2. Save to DB
    const { error } = await supabase.from(table).upsert({
      id: item.id,
      name: item.name,
      beg_bal: beg,
      incoming_bal: incoming,
      outgoing_bal: outgoing,
      current_bal: current,
      actual_bal: a,
      loss,
    });

    if (error) {
      alert("Update failed: " + error.message);
      setSaving(false);
      return;
    }

    // 3. Only AFTER a successful save: snapshot + reload
    await onUpdated();

    setSaving(false);
    setActual("");
  }

  return (
    <div className="fixed bottom-6 right-6 bg-white border shadow-lg p-4 w-80 rounded-lg z-10">
      <h2 className="font-bold mb-3 text-base">{item.name}</h2>

      <input
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        placeholder="Quantity"
        type="number"
        className="border p-2 w-full mb-2 rounded"
      />
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => applyChange("in")}
          disabled={saving}
          className="bg-green-600 text-white w-full py-1.5 rounded disabled:opacity-50"
        >
          IN
        </button>
        <button
          onClick={() => applyChange("out")}
          disabled={saving}
          className="bg-red-600 text-white w-full py-1.5 rounded disabled:opacity-50"
        >
          OUT
        </button>
      </div>

      <input
        value={actual}
        onChange={(e) => setActual(e.target.value)}
        placeholder="Set actual"
        type="number"
        className="border p-2 w-full mb-2 rounded"
      />
      <button
        onClick={setActualValue}
        disabled={saving}
        className="bg-purple-600 text-white w-full py-1.5 rounded mb-3 disabled:opacity-50"
      >
        Update actual
      </button>

      <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
        Close
      </button>
    </div>
  );
}
