"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";

export default function EditCategory({ params }) {
  const router = useRouter();
  const { id } = use(params);

  const [form, setForm] = useState(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("categories")
        .select("*")
        .eq("id", id)
        .single();

      setForm(data);
    }

    load();
  }, [id]);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function update() {
    const supabase = createClient();
    await supabase
      .from("categories")
      .update(form)
      .eq("id", id);

    router.push("/categories");
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
      <div className="w-full max-w-2xl bg-white border rounded-xl shadow-sm p-6">
        <h1 className="text-black text-xl font-bold mb-6">Edit Category</h1>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-500">Name</label>
            <input
              name="name"
              value={form.name || ""}
              onChange={handleChange}
              className="text-black w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500">Description</label>
            <textarea
              name="description"
              value={form.description || ""}
              onChange={handleChange}
              className="text-black w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex justify-end mt-6 space-x-3">
          <button
            onClick={() => router.push("/categories")}
            className="px-4 py-2 border rounded-lg"
          >
            Cancel
          </button>

          <button
            onClick={update}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Update
          </button>
        </div>
      </div>
    </div>
  );
}