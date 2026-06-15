import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function ManipulatePanel({ item, tab, onClose, onUpdated }) {
  const [qty, setQty] = useState("");
  const [actual, setActual] = useState("");

  const table =
    tab === "finished"
      ? "finished_products_inventory"
      : "raw_materials_inventory";

  async function applyChange(mode) {
    const q = Number(qty || 0);
    if (!q) {
      onClose && setQty("");
      return;
    }

    const { data, error: fetchError } = await supabase
      .from(table)
      .select("*")
      .eq("id", item.id)
      .maybeSingle();

    if (fetchError) {
      alert("Failed to load current values: " + fetchError.message);
      return;
    }

    let beg = Number(data?.beg_bal ?? item.beg_bal ?? 0);
    let incoming = Number(data?.incoming_bal ?? item.incoming_bal ?? 0);
    let outgoing = Number(data?.outgoing_bal ?? item.outgoing_bal ?? 0);

    if (mode === "in") incoming += q;
    if (mode === "out") outgoing += q;

    const current = beg + incoming - outgoing;

    const { error } = await supabase
      .from(table)
      .upsert({
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
      return;
    }

    setQty("");
    onUpdated();
  }

  async function setActualValue() {
    if (actual === "") return;

    const { data, error: fetchError } = await supabase
      .from(table)
      .select("*")
      .eq("id", item.id)
      .maybeSingle();

    if (fetchError) {
      alert("Failed to load current values: " + fetchError.message);
      return;
    }

    const beg = Number(data?.beg_bal ?? item.beg_bal ?? 0);
    const incoming = Number(data?.incoming_bal ?? item.incoming_bal ?? 0);
    const outgoing = Number(data?.outgoing_bal ?? item.outgoing_bal ?? 0);
    const current = Number(data?.current_bal ?? item.current_bal ?? (beg + incoming - outgoing));

    const a = Number(actual || 0);
    const loss = Math.max(0, current - a);

    const { error } = await supabase
      .from(table)
      .upsert({
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
      return;
    }

    setActual("");
    onUpdated();
  }

  return (
    <div className="fixed bottom-6 right-6 bg-white border shadow-lg p-4 w-80">

      <h2 className="font-bold mb-2">{item.name}</h2>

      {/* STOCK CONTROL */}
      <input
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        placeholder="Quantity"
        className="border p-2 w-full mb-2"
      />

      <div className="flex gap-2 mb-3">
        <button onClick={() => applyChange("in")} className="bg-green-600 text-white w-full">
          IN
        </button>
        <button onClick={() => applyChange("out")} className="bg-red-600 text-white w-full">
          OUT
        </button>
      </div>

      {/* ACTUAL CONTROL */}
      <input
        value={actual}
        onChange={(e) => setActual(e.target.value)}
        placeholder="Set Actual"
        className="border p-2 w-full mb-2"
      />

      <button
        onClick={setActualValue}
        className="bg-purple-600 text-white w-full py-1 rounded"
      >
        Update Actual
      </button>

      <button
        onClick={onClose}
        className="mt-2 text-sm text-gray-500"
      >
        Close
      </button>

    </div>
  );
}