"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient"

export default function NewSupplier() {
  const router = useRouter();

  const [form, setForm] = useState({
    company_name: "",
    contact_person: "",
    contact_title: "",
    address: "",
    city: "",
    postal_code: "",
    country: "",
    phone_number: "",
    fax: "",
  });

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function submit() {
    await supabase.from("suppliers").insert([
      {
        ...form,
        postal_code: Number(form.postal_code),
      },
    ]);

    router.push("/suppliers");
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen flex justify-center">
      <div className="w-full max-w-3xl bg-white border rounded-xl shadow-sm p-6">
        <h1 className="text-xl font-bold mb-6">Create Supplier</h1>

        <div className="grid grid-cols-2 gap-4">
          {Object.entries(form).map(([key, value]) => (
            <div key={key} className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1 capitalize">
                {key.replace("_", " ")}
              </label>

              <input
                name={key}
                value={value}
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
            onClick={submit}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Save Supplier
          </button>
        </div>
      </div>
    </div>
  );
}