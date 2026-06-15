"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function NewInventoryPage() {
  const [type, setType] = useState("finished");
  const [items, setItems] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [qty, setQty] = useState("");

  useEffect(() => {
    loadItems();
  }, [type]);

  async function loadItems() {
    const table =
      type === "finished"
        ? "finished_products_static"
        : "raw_materials_static";

    const { data } = await supabase.from(table).select("*");
    setItems(data || []);
  }

  async function applyChange(item, qtyValue, mode) {
    const qtyNum = Number(qtyValue || 0);
    if (!qtyNum) {
      setQty("");
      setActiveItem(null);
      return;
    }

    const inventoryTable =
      type === "finished"
        ? "finished_products_inventory"
        : "raw_materials_inventory";

    const { data: existing, error: fetchError } = await supabase
      .from(inventoryTable)
      .select("*")
      .eq("id", item.id)
      .maybeSingle();

    if (fetchError) {
      alert("Failed to load current values: " + fetchError.message);
      return;
    }

    let beg = Number(existing?.beg_bal ?? 0);
    let incoming = Number(existing?.incoming_bal ?? 0);
    let outgoing = Number(existing?.outgoing_bal ?? 0);

    if (mode === "in") incoming += qtyNum;
    if (mode === "out") outgoing += qtyNum;

    const current = beg + incoming - outgoing;

    // Stock just moved, so the previously recorded actual count is no
    // longer verified — reset it to match the new calculated balance.
    // (A separate "Update Actual" action should be used to record a
    // real physical count and surface any loss.)
    const payload = {
      id: item.id,
      name: item.name,
      beg_bal: beg,
      incoming_bal: incoming,
      outgoing_bal: outgoing,
      current_bal: current,
      actual_bal: current,
      loss: 0,
    };

    const { error } = existing
      ? await supabase.from(inventoryTable).update(payload).eq("id", item.id)
      : await supabase.from(inventoryTable).insert([payload]);

    if (error) {
      alert("Save failed: " + error.message);
      return;
    }

    setQty("");
    setActiveItem(null);
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen">

      <h1 className="text-2xl font-bold mb-6">Inventory Workstation</h1>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setType("finished")} className="border px-4 py-2">
          Finished
        </button>
        <button onClick={() => setType("raw")} className="border px-4 py-2">
          Raw
        </button>
      </div>

      <table className="w-full bg-white border">
        <thead className="bg-gray-100">
          <tr>
            <th className="p-3 text-left">Name</th>
            <th className="p-3 text-right">Action</th>
          </tr>
        </thead>

        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t">
              <td className="p-3">{item.name}</td>

              <td className="p-3 text-right">
                <button
                  onClick={() => setActiveItem(item)}
                  className="bg-blue-600 text-white px-3 py-1 rounded"
                >
                  Manipulate
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {activeItem && (
        <div className="fixed bottom-6 right-6 bg-white border p-4 w-80 shadow-lg">

          <h2 className="font-bold mb-2">{activeItem.name}</h2>

          <input
            type="number"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="border p-2 w-full mb-2"
            placeholder="Quantity"
          />

          <div className="flex gap-2">
            <button
              onClick={() => applyChange(activeItem, qty, "in")}
              className="bg-green-600 text-white w-full"
            >
              IN
            </button>

            <button
              onClick={() => applyChange(activeItem, qty, "out")}
              className="bg-red-600 text-white w-full"
            >
              OUT
            </button>
          </div>

        </div>
      )}

    </div>
  );
}