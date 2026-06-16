"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

const STOCK_TYPE = { INCOMING: "incoming", OUTGOING: "outgoing" };

const emptyIncoming = {
  monitoring_employee: "",
  representative_employee: "",
  supplier_name: "",
  product_name: "",
  incoming_bal: "",
};

const emptyOutgoing = {
  monitoring_employee: "",
  representative_employee: "",
  product_name: "",
  outgoing_bal: "",
};

// ── Sub-components ────────────────────────────────────────────────────────────

const FormSelect = ({ label, field, options, formData, setFormData }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
      {label}
    </label>
    <select
      className="rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      value={formData[field]}
      onChange={(e) => setFormData((prev) => ({ ...prev, [field]: e.target.value }))}
    >
      <option value="">Select {label}...</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

const FormNumber = ({ label, field, formData, setFormData }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
      {label}
    </label>
    <input
      type="number"
      min="0"
      placeholder="Amount"
      className="rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      value={formData[field]}
      onChange={(e) => setFormData((prev) => ({ ...prev, [field]: e.target.value }))}
    />
  </div>
);

const EditSelect = ({ field, options, value, onChange }) => (
  <select
    className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
    value={value}
    onChange={(e) => onChange(field, e.target.value)}
  >
    <option value="">Select...</option>
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);

const EditNumber = ({ field, value, onChange }) => (
  <input
    type="number"
    min="0"
    className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
    value={value}
    onChange={(e) => onChange(field, e.target.value)}
  />
);

// ── Main Component ────────────────────────────────────────────────────────────

export default function OrderTable() {
  const [stockType, setStockType] = useState(STOCK_TYPE.INCOMING);
  const [rows, setRows] = useState([]);
  const [formData, setFormData] = useState(emptyIncoming);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [search, setSearch] = useState("");

  const [monitoringOptions, setMonitoringOptions] = useState([]);
  const [representativeOptions, setRepresentativeOptions] = useState([]);
  const [supplierOptions, setSupplierOptions] = useState([]);
  const [productOptions, setProductOptions] = useState([]);

  useEffect(() => {
    const fetchOptions = async () => {
      const [mon, rep, sup, prod] = await Promise.all([
        supabase.from("monitoring_employee").select("name"),
        supabase.from("representative_employee").select("name"),
        supabase.from("suppliers").select("contact_person"),
        supabase.from("raw_materials_inventory").select("name"),
      ]);
      setMonitoringOptions(mon.data?.map((r) => r.name) ?? []);
      setRepresentativeOptions(rep.data?.map((r) => r.name) ?? []);
      // Exclude the N/A placeholder from the supplier dropdown
      setSupplierOptions(
        (sup.data?.map((r) => r.contact_person) ?? []).filter((n) => n !== "N/A")
      );
      setProductOptions(prod.data?.map((r) => r.name) ?? []);
    };
    fetchOptions();
    fetchRows();
  }, []);

  async function fetchRows() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from("raw_materials_transaction_log")
        .select("*")
        .order("created_at", { ascending: false });
      if (fetchError) throw fetchError;
      setRows(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleStockTypeSwitch(type) {
    setStockType(type);
    setFormData(type === STOCK_TYPE.INCOMING ? emptyIncoming : emptyOutgoing);
    setEditingId(null);
    setEditData({});
    setError(null);
    setSuccessMsg(null);
    setSearch("");
  }

  function showSuccess(msg) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  async function getInventoryId(productName) {
    const { data } = await supabase
      .from("raw_materials_inventory")
      .select("id")
      .eq("name", productName)
      .single();
    return data?.id ?? null;
  }

  async function handleAdd() {
    setError(null);

    // Basic validation
    const isIncoming = stockType === STOCK_TYPE.INCOMING;
    const qty = Number(isIncoming ? formData.incoming_bal : formData.outgoing_bal);
    if (!formData.monitoring_employee) { setError("Please select a monitoring employee."); return; }
    if (!formData.representative_employee) { setError("Please select a representative employee."); return; }
    if (isIncoming && !formData.supplier_name) { setError("Please select a supplier."); return; }
    if (!formData.product_name) { setError("Please select a product."); return; }
    if (!qty || qty <= 0) { setError("Please enter a valid quantity."); return; }

    setSaving(true);
    try {
      const inventory_id = await getInventoryId(formData.product_name);
      if (!inventory_id) throw new Error("Could not resolve inventory ID for product.");

      const payload = isIncoming
        ? {
            inventory_id,
            monitoring_employee: formData.monitoring_employee,
            representative_employee: formData.representative_employee,
            supplier_name: formData.supplier_name,
            product_name: formData.product_name,
            incoming_bal: qty,
            outgoing_bal: 0,
          }
        : {
            inventory_id,
            monitoring_employee: formData.monitoring_employee,
            representative_employee: formData.representative_employee,
            supplier_name: "N/A",
            product_name: formData.product_name,
            incoming_bal: 0,
            outgoing_bal: qty,
          };

      const { error: insertError } = await supabase
        .from("raw_materials_transaction_log")
        .insert([payload]);
      if (insertError) throw insertError;

      setFormData(isIncoming ? emptyIncoming : emptyOutgoing);
      await fetchRows();
      showSuccess("Order added. It will be applied to inventory on Close Day.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleEditStart(row) {
    setEditingId(row.id);
    setEditData({ ...row });
  }

  async function handleEditSave(id) {
    setError(null);
    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from("raw_materials_transaction_log")
        .update({
          monitoring_employee: editData.monitoring_employee,
          representative_employee: editData.representative_employee,
          supplier_name: editData.supplier_name || "N/A",
          product_name: editData.product_name,
          incoming_bal: Number(editData.incoming_bal),
          outgoing_bal: Number(editData.outgoing_bal),
        })
        .eq("id", id);
      if (updateError) throw updateError;
      setEditingId(null);
      await fetchRows();
      showSuccess("Order updated.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this order entry?")) return;
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from("raw_materials_transaction_log")
        .delete()
        .eq("id", id);
      if (deleteError) throw deleteError;
      await fetchRows();
      showSuccess("Order deleted.");
    } catch (e) {
      setError(e.message);
    }
  }

  function handleEditChange(field, value) {
    setEditData((prev) => ({ ...prev, [field]: value }));
  }

  const isIncoming = stockType === STOCK_TYPE.INCOMING;

  const filteredRows = rows
    .filter((r) => (isIncoming ? (r.incoming_bal ?? 0) > 0 : (r.outgoing_bal ?? 0) > 0))
    .filter((r) => r.product_name?.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="p-8 bg-gray-50 min-h-screen">

      {/* HEADER — matches InventoryHeader style */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Order Table</h1>
          <p className="text-sm text-gray-500">
            Raw material orders — applied to inventory on Close Day
          </p>
        </div>
      </div>

      {/* CONTROLS — matches InventoryPage tab row */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <button
          onClick={() => handleStockTypeSwitch(STOCK_TYPE.INCOMING)}
          className={`px-4 py-2 border rounded ${
            isIncoming ? "bg-blue-600 text-white" : "bg-white"
          }`}
        >
          ↓ Incoming
        </button>
        <button
          onClick={() => handleStockTypeSwitch(STOCK_TYPE.OUTGOING)}
          className={`px-4 py-2 border rounded ${
            !isIncoming ? "bg-blue-600 text-white" : "bg-white"
          }`}
        >
          ↑ Outgoing
        </button>
      </div>

      {/* ALERTS */}
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="mb-4 rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {successMsg}
        </div>
      )}

      {/* ADD FORM — matches bg-white border card pattern */}
      <div className="bg-white border rounded-lg p-5 mb-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-black mb-4">
          {isIncoming ? "Add Incoming Order" : "Add Outgoing Order"}
        </h2>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <FormSelect label="Monitoring" field="monitoring_employee" options={monitoringOptions} formData={formData} setFormData={setFormData} />
          <FormSelect label="Representative" field="representative_employee" options={representativeOptions} formData={formData} setFormData={setFormData} />
          {isIncoming && (
            <FormSelect label="Supplier" field="supplier_name" options={supplierOptions} formData={formData} setFormData={setFormData} />
          )}
          <FormSelect label="Product" field="product_name" options={productOptions} formData={formData} setFormData={setFormData} />
          {isIncoming
            ? <FormNumber label="Incoming Qty" field="incoming_bal" formData={formData} setFormData={setFormData} />
            : <FormNumber label="Outgoing Qty" field="outgoing_bal" formData={formData} setFormData={setFormData} />
          }
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleAdd}
            disabled={saving}
            className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-60 hover:bg-blue-700 text-sm font-semibold"
          >
            {saving ? "Saving..." : "Add Order"}
          </button>
        </div>
      </div>

      {/* TABLE — matches InventoryTable wrapper */}
      <div className="bg-white border rounded-lg overflow-x-auto">

        {/* SEARCH — matches InventoryTable search bar */}
        <div className="p-3 border-b bg-gray-50">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="border px-3 py-2 rounded w-full max-w-xs"
          />
        </div>

        {loading ? (
          <div className="p-6 text-gray-500">Loading...</div>
        ) : filteredRows.length === 0 ? (
          <div className="p-6 text-gray-500">
            No {stockType} orders found.
          </div>
        ) : (
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 text-left">Monitoring</th>
                <th className="p-3 text-left">Representative</th>
                {isIncoming && <th className="p-3 text-left">Supplier</th>}
                <th className="p-3 text-left">Product</th>
                <th className="p-3 text-left">{isIncoming ? "Incoming Qty" : "Outgoing Qty"}</th>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isEditing = editingId === row.id;
                return (
                  <tr key={row.id} className="border-t hover:bg-gray-50">
                    <td className="p-3">
                      {isEditing
                        ? <EditSelect field="monitoring_employee" options={monitoringOptions} value={editData.monitoring_employee} onChange={handleEditChange} />
                        : row.monitoring_employee}
                    </td>
                    <td className="p-3">
                      {isEditing
                        ? <EditSelect field="representative_employee" options={representativeOptions} value={editData.representative_employee} onChange={handleEditChange} />
                        : row.representative_employee}
                    </td>
                    {isIncoming && (
                      <td className="p-3">
                        {isEditing
                          ? <EditSelect field="supplier_name" options={supplierOptions} value={editData.supplier_name} onChange={handleEditChange} />
                          : row.supplier_name}
                      </td>
                    )}
                    <td className="p-3 font-medium">
                      {isEditing
                        ? <EditSelect field="product_name" options={productOptions} value={editData.product_name} onChange={handleEditChange} />
                        : row.product_name}
                    </td>
                    <td className="p-3">
                      {isEditing
                        ? <EditNumber
                            field={isIncoming ? "incoming_bal" : "outgoing_bal"}
                            value={isIncoming ? editData.incoming_bal : editData.outgoing_bal}
                            onChange={handleEditChange}
                          />
                        : (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            isIncoming ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                          }`}>
                            {isIncoming ? row.incoming_bal : row.outgoing_bal}
                          </span>
                        )}
                    </td>
                    <td className="p-3 text-xs text-gray-400">
                      {new Date(row.created_at).toLocaleDateString("en-PH", {
                        year: "numeric", month: "short", day: "numeric",
                      })}
                    </td>
                    <td className="p-3">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <button onClick={() => handleEditSave(row.id)} disabled={saving} className="bg-green-600 text-white px-3 py-1 rounded text-xs disabled:opacity-60">Save</button>
                          <button onClick={() => setEditingId(null)} className="bg-gray-100 text-gray-700 px-3 py-1 rounded text-xs">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button onClick={() => handleEditStart(row)} className="bg-blue-600 text-white px-3 py-1 rounded text-xs">Edit</button>
                          <button onClick={() => handleDelete(row.id)} className="bg-red-50 text-red-600 px-3 py-1 rounded text-xs border border-red-200">Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}