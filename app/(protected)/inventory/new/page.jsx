"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabaseClient";

export default function NewInventoryPage() {
  const supabase = useMemo(() => createClient(), []);

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

    // The FK column that ties an inventory row back to its static product
    // record. Without this, the row is unrecognizable to sync.js's
    // _flushInventory guard, which treats it as a stale/corrupt payload
    // and silently discards (rather than retries) any future write to it.
    const fkField = type === "finished" ? "finished_product_id" : "raw_material_id";

    const { data: existing, error: fetchError } = await supabase
      .from(inventoryTable)
      .select("*")
      .eq("id", item.id)
      .maybeSingle();

    if (fetchError) {
      alert("Failed to load current values: " + fetchError.message);
      return;
    }

    let beg      = Number(existing?.beg_bal      ?? 0);
    let incoming = Number(existing?.incoming_bal ?? 0);
    let outgoing = Number(existing?.outgoing_bal ?? 0);

    if (mode === "in")  incoming += qtyNum;
    if (mode === "out") outgoing += qtyNum;

    const current = beg + incoming - outgoing;

    const payload = {
      id:           item.id,
      name:         item.name,
      // Preserve an existing warehouse if this item already has one;
      // otherwise fall back to whatever the static record carries.
      // Leaving this null is what causes the "select=warehouse" lookup
      // against the static table to blow up later (that table doesn't
      // have a warehouse column — it only lives on the inventory tables).
      warehouse:    existing?.warehouse ?? item.warehouse ?? null,
      beg_bal:      beg,
      incoming_bal: incoming,
      outgoing_bal: outgoing,
      current_bal:  current,
      actual_bal:   current,
      loss:         0,
      [fkField]:    item.id,
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
    <div className="p-8 bg-gray-50 min-h-screen text-gray-900">

      <h1 className="text-2xl font-bold mb-6 text-gray-900">Inventory Workstation</h1>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setType("finished")}
          className={`text-gray-900 border px-4 py-2 rounded-md transition-colors ${
            type === "finished" ? "bg-blue-50 border-blue-300" : "bg-white hover:bg-gray-50"
          }`}
        >
          Finished
        </button>
        <button
          onClick={() => setType("raw")}
          className={`text-gray-900 border px-4 py-2 rounded-md transition-colors ${
            type === "raw" ? "bg-blue-50 border-blue-300" : "bg-white hover:bg-gray-50"
          }`}
        >
          Raw
        </button>
      </div>

      <table className="w-full bg-white text-gray-900 border">
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
        <div className="fixed bottom-6 right-6 bg-white text-gray-900 border p-4 w-80 shadow-lg rounded-lg">

          <h2 className="font-bold mb-2 text-gray-900">{activeItem.name}</h2>

          <input
            type="number"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="border p-2 w-full mb-2 rounded text-gray-900"
            placeholder="Quantity"
          />

          <div className="flex gap-2">
            <button
              onClick={() => applyChange(activeItem, qty, "in")}
              className="bg-green-600 text-white w-full py-1.5 rounded"
            >
              IN
            </button>
            <button
              onClick={() => applyChange(activeItem, qty, "out")}
              className="bg-red-600 text-white w-full py-1.5 rounded"
            >
              OUT
            </button>
          </div>

        </div>
      )}

    </div>
  );
}