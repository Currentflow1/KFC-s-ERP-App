"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function EditInventoryPage({ params }) {
  const router = useRouter();
  const { id } = params;

  const [item, setItem] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase
      .from("finished_products_inventory")
      .select("*")
      .eq("id", id)
      .single();

    setItem(data);
  }

  function update(field, value) {
    setItem((prev) => ({
      ...prev,
      [field]: Number(value),
    }));
  }

  function calcCurrent(data = item) {
    return (
      Number(data?.beg_bal || 0) +
      Number(data?.incoming_bal || 0) -
      Number(data?.outgoing_bal || 0)
    );
  }

  async function save() {
    const supabase = createClient();
    const current = calcCurrent();

    const actual = Number(item.actual_bal || current);

    const updated = {
      ...item,
      current_bal: current,
      actual_bal: actual,
      loss: Math.max(0, current - actual),
    };

    const { error } = await supabase
      .from("finished_products_inventory")
      .update(updated)
      .eq("id", id);

    if (error) {
      console.error(error);
      return alert("Update failed");
    }

    router.push("/inventory");
  }

  if (!item) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <h1 className="text-2xl font-bold mb-6">Edit Inventory</h1>
      <div className="mb-4 font-semibold">{item.name}</div>
      <input
        value={item.beg_bal || 0}
        onChange={(e) => update("beg_bal", e.target.value)}
        className="border p-2 w-full mb-2"
      />
      <input
        value={item.incoming_bal || 0}
        onChange={(e) => update("incoming_bal", e.target.value)}
        className="border p-2 w-full mb-2"
      />
      <input
        value={item.outgoing_bal || 0}
        onChange={(e) => update("outgoing_bal", e.target.value)}
        className="border p-2 w-full mb-2"
      />
      <input
        value={item.actual_bal || 0}
        onChange={(e) => update("actual_bal", e.target.value)}
        className="border p-2 w-full mb-4"
        placeholder="Actual"
      />
      <div className="mb-4">
        Current: <b>{calcCurrent()}</b>
      </div>
      <button
        onClick={save}
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        Save
      </button>
    </div>
  );
}