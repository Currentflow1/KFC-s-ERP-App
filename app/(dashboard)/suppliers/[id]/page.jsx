"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function EditSupplier({ params }) {
  const router = useRouter();

  // ✅ FIX: unwrap the Promise
  const { id } = use(params);

  const [form, setForm] = useState(null);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .eq("id", id)
        .single();

      if (!error) setForm(data);
    }

    load();
  }, [id]);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function update() {
    await supabase
      .from("suppliers")
      .update({
        ...form,
        postal_code: Number(form.postal_code),
      })
      .eq("id", id);

    router.push("/suppliers");
  }

  if (!form) {
    return (
      <div className="p-8 bg-gray-50 min-h-screen text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen flex justify-center">
      <div className="w-full max-w-3xl bg-white border rounded-xl shadow-sm p-6">
        <h1 className="text-xl font-bold mb-6">Edit Supplier</h1>

        <div className="grid grid-cols-2 gap-4">
          {Object.keys(form)
            .filter((k) => k !== "id" && k !== "created_at")
            .map((key) => (
              <div key={key} className="flex flex-col">
                <label className="text-xs text-gray-500 mb-1 capitalize">
                  {key.replace("_", " ")}
                </label>

                <input
                  name={key}
                  value={form[key] || ""}
                  onChange={handleChange}
                  className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
        </div>

        <div className="flex justify-end mt-6 space-x-3">
          <button
            onClick={() => router.push("/suppliers")}
            className="px-4 py-2 border rounded-lg"
          >
            Cancel
          </button>

          <button
            onClick={update}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Update Supplier
          </button>
        </div>
      </div>
    </div>
  );
}