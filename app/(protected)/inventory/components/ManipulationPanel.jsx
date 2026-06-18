"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabaseClient";

export default function ManipulatePanel({ item, tab, onClose, onUpdated }) {
  const supabase = createClient();

  const [qty, setQty]       = useState("");
  const [actual, setActual] = useState("");
  const [saving, setSaving] = useState(false);

  const table =
    tab === "finished"
      ? "finished_products_inventory"
      : "raw_materials_inventory";

  const displayedCurrent = Number(item.current_bal ?? 0);
  const pendingIn        = Number(item._pendingIncoming ?? 0);
  const pendingOut       = Number(item._pendingOutgoing ?? 0);

  async function applyChange(mode) {
    const q = Number(qty || 0);
    if (!q) { setQty(""); return; }

    setSaving(true);
    await onUpdated(async () => {
      const { data, error: fetchError } = await supabase
        .from(table)
        .select("*")
        .eq("id", item.id)
        .maybeSingle();

      if (fetchError || !data) {
        alert("Failed to load current values: " + (fetchError?.message ?? "No data"));
        return;
      }

      const beg      = Number(data.beg_bal      ?? 0);
      let incoming   = Number(data.incoming_bal  ?? 0);
      let outgoing   = Number(data.outgoing_bal  ?? 0);

      if (mode === "in")  incoming += q;
      if (mode === "out") outgoing += q;

      const current_bal = beg + incoming - outgoing;

      const existing_actual = data.actual_bal != null ? Number(data.actual_bal) : null;
      const actual_bal      = existing_actual ?? current_bal;
      const loss            = existing_actual != null
        ? Math.max(0, current_bal - existing_actual)
        : 0;

      const { error } = await supabase.from(table).upsert({
        id:           item.id,
        name:         item.name,
        beg_bal:      beg,
        incoming_bal: incoming,
        outgoing_bal: outgoing,
        current_bal,
        actual_bal,
        loss,
      });

      if (error) alert("Update failed: " + error.message);
    });

    setSaving(false);
    setQty("");
  }

  async function setActualValue() {
    if (actual === "") return;

    setSaving(true);
    await onUpdated(async () => {
      const { data, error: fetchError } = await supabase
        .from(table)
        .select("*")
        .eq("id", item.id)
        .maybeSingle();

      if (fetchError || !data) {
        alert("Failed to load current values: " + (fetchError?.message ?? "No data"));
        return;
      }

      const a    = Number(actual);
      const loss = Math.max(0, displayedCurrent - a);

      const { error } = await supabase.from(table).upsert({
        id:           item.id,
        name:         item.name,
        beg_bal:      Number(data.beg_bal      ?? 0),
        incoming_bal: Number(data.incoming_bal  ?? 0),
        outgoing_bal: Number(data.outgoing_bal  ?? 0),
        current_bal:  Number(data.current_bal   ?? 0),
        actual_bal:   a,
        loss,
      });

      if (error) alert("Update failed: " + error.message);
    });

    setSaving(false);
    setActual("");
  }

  const lossPreview = actual !== ""
    ? Math.max(0, displayedCurrent - Number(actual))
    : null;

  return (
    <div className="fixed bottom-6 right-6 bg-white text-gray-900 border shadow-lg p-4 w-80 rounded-lg z-10">
      <div className="flex justify-between items-start mb-3">
        <h2 className="font-bold text-base">{item.name}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-center text-xs">
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-400 mb-0.5">Current</div>
          <div className="font-semibold text-gray-800">{displayedCurrent}</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-400 mb-0.5">Actual</div>
          <div className="font-semibold text-gray-800">{Number(item.actual_bal ?? 0)}</div>
        </div>
        <div className="bg-red-50 rounded p-2">
          <div className="text-red-400 mb-0.5">Loss</div>
          <div className="font-semibold text-red-600">{Number(item.loss ?? 0)}</div>
        </div>
      </div>

      {(pendingIn > 0 || pendingOut > 0) && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <div className="font-semibold mb-0.5">Pending orders (not yet closed)</div>
          {pendingIn  > 0 && <div>↓ Incoming: +{pendingIn}</div>}
          {pendingOut > 0 && <div>↑ Outgoing: −{pendingOut}</div>}
        </div>
      )}

      <input
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        placeholder="Quantity"
        type="number"
        min="0"
        className="border p-2 w-full mb-2 rounded text-sm text-gray-900"
      />
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => applyChange("in")}
          disabled={saving}
          className="bg-green-600 text-white w-full py-1.5 rounded text-sm disabled:opacity-50"
        >
          + IN
        </button>
        <button
          onClick={() => applyChange("out")}
          disabled={saving}
          className="bg-red-600 text-white w-full py-1.5 rounded text-sm disabled:opacity-50"
        >
          − OUT
        </button>
      </div>

      <input
        value={actual}
        onChange={(e) => setActual(e.target.value)}
        placeholder="Set actual count"
        type="number"
        min="0"
        className="border p-2 w-full mb-2 rounded text-sm text-gray-900"
      />
      {lossPreview !== null && (
        <p className={`text-xs mb-2 ${lossPreview > 0 ? "text-red-500" : "text-green-600"}`}>
          Loss preview: {lossPreview}{lossPreview === 0 ? " (no loss)" : ""}
        </p>
      )}
      <button
        onClick={setActualValue}
        disabled={saving}
        className="bg-purple-600 text-white w-full py-1.5 rounded text-sm disabled:opacity-50"
      >
        {saving ? "Saving…" : "Update actual"}
      </button>
    </div>
  );
}