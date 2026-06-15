"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

const STOCK_TYPE = {
  INCOMING: "incoming",
  OUTGOING: "outgoing",
};

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

// ─── Sub-components defined OUTSIDE OrderTable to prevent remounting on render ───

const FormSelect = ({ label, field, options, formData, setFormData }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
      {label}
    </label>
    <select
      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      value={formData[field]}
      onChange={(e) => {
        const value = e.target.value;
        setFormData((prev) => ({ ...prev, [field]: value }));
      }}
    >
      <option value="">Select {label}...</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  </div>
);

const FormNumber = ({ label, field, formData, setFormData }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
      {label}
    </label>
    <input
      type="number"
      min="0"
      placeholder="Amount"
      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      value={formData[field]}
      onChange={(e) => {
        const value = e.target.value;
        setFormData((prev) => ({ ...prev, [field]: value }));
      }}
    />
  </div>
);

const EditSelect = ({ field, options, value, onChange }) => (
  <select
    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
    value={value}
    onChange={(e) => onChange(field, e.target.value)}
  >
    <option value="">Select...</option>
    {options.map((o) => (
      <option key={o} value={o}>
        {o}
      </option>
    ))}
  </select>
);

const EditNumber = ({ field, value, onChange }) => (
  <input
    type="number"
    min="0"
    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
    value={value}
    onChange={(e) => onChange(field, e.target.value)}
  />
);

// ─── Main Component ───────────────────────────────────────────────────────────

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

  const [monitoringOptions, setMonitoringOptions] = useState([]);
  const [representativeOptions, setRepresentativeOptions] = useState([]);
  const [supplierOptions, setSupplierOptions] = useState([]);
  const [productOptions, setProductOptions] = useState([]);

  // --- Fetch dropdown options ---
  useEffect(() => {
    if (!supabase) return;
    const fetchOptions = async () => {
      const [mon, rep, sup, prod] = await Promise.all([
        supabase.from("monitoring_employee").select("name"),
        supabase.from("representative_employee").select("name"),
        supabase.from("suppliers").select("contact_person"),
        supabase.from("raw_materials_inventory").select("name"),
      ]);
      setMonitoringOptions(mon.data?.map((r) => r.name) ?? []);
      setRepresentativeOptions(rep.data?.map((r) => r.name) ?? []);
      setSupplierOptions(sup.data?.map((r) => r.contact_person) ?? []);
      setProductOptions(prod.data?.map((r) => r.name) ?? []);
    };
    fetchOptions();
  }, [supabase]);

  // --- Fetch transaction logs ---
  const fetchRows = async () => {
    if (!supabase) return;
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
  };

  useEffect(() => {
    fetchRows();
  }, [supabase]);

  // --- Reset form when switching stock type ---
  const handleStockTypeSwitch = (type) => {
    setStockType(type);
    setFormData(type === STOCK_TYPE.INCOMING ? emptyIncoming : emptyOutgoing);
    setEditingId(null);
    setEditData({});
    setError(null);
    setSuccessMsg(null);
  };

  const showSuccess = (msg) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  // --- Get inventory_id from product name ---
  const getInventoryId = async (productName) => {
    const { data } = await supabase
      .from("raw_materials_inventory")
      .select("id")
      .eq("name", productName)
      .single();
    return data?.id ?? null;
  };

  // --- Add new row ---
  const handleAdd = async () => {
    setError(null);
    setSaving(true);
    try {
      const inventory_id = await getInventoryId(formData.product_name);
      if (!inventory_id) throw new Error("Could not resolve inventory ID for product.");

      const payload =
        stockType === STOCK_TYPE.INCOMING
          ? {
              inventory_id,
              monitoring_employee: formData.monitoring_employee,
              representative_employee: formData.representative_employee,
              supplier_name: formData.supplier_name,
              product_name: formData.product_name,
              incoming_bal: Number(formData.incoming_bal),
              outgoing_bal: 0,
            }
          : {
              inventory_id,
              monitoring_employee: formData.monitoring_employee,
              representative_employee: formData.representative_employee,
              supplier_name: supplierOptions[0] ?? "",
              product_name: formData.product_name,
              incoming_bal: 0,
              outgoing_bal: Number(formData.outgoing_bal),
            };

      const { error: insertError } = await supabase
        .from("raw_materials_transaction_log")
        .insert([payload]);
      if (insertError) throw insertError;

      setFormData(stockType === STOCK_TYPE.INCOMING ? emptyIncoming : emptyOutgoing);
      await fetchRows();
      showSuccess("Order added successfully.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // --- Start editing ---
  const handleEditStart = (row) => {
    setEditingId(row.id);
    setEditData({ ...row });
  };

  // --- Save edit ---
  const handleEditSave = async (id) => {
    setError(null);
    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from("raw_materials_transaction_log")
        .update({
          monitoring_employee: editData.monitoring_employee,
          representative_employee: editData.representative_employee,
          supplier_name: editData.supplier_name,
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
  };

  // --- Delete row ---
  const handleDelete = async (id) => {
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
  };

  const handleEditChange = (field, value) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
  };

  // --- Filtered rows based on stock type ---
  const filteredRows = rows.filter((r) =>
    stockType === STOCK_TYPE.INCOMING
      ? (r.incoming_bal ?? 0) > 0
      : (r.outgoing_bal ?? 0) > 0
  );

  const isIncoming = stockType === STOCK_TYPE.INCOMING;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-slate-800">Order Table</h1>
          <p className="text-sm text-slate-500">
            Manage incoming and outgoing raw material stock orders.
          </p>
        </div>

        {/* Toggle */}
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <button
            onClick={() => handleStockTypeSwitch(STOCK_TYPE.INCOMING)}
            className={`rounded-md px-5 py-2 text-sm font-semibold transition-all duration-200 ${
              isIncoming
                ? "bg-blue-600 text-white shadow"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            ↓ Incoming Stock
          </button>
          <button
            onClick={() => handleStockTypeSwitch(STOCK_TYPE.OUTGOING)}
            className={`rounded-md px-5 py-2 text-sm font-semibold transition-all duration-200 ${
              !isIncoming
                ? "bg-rose-600 text-white shadow"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            ↑ Outgoing Stock
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {successMsg}
          </div>
        )}

        {/* Add Form */}
        <div
          className={`rounded-xl border bg-white p-5 shadow-sm ${
            isIncoming ? "border-blue-100" : "border-rose-100"
          }`}
        >
          <h2
            className={`mb-4 text-sm font-bold uppercase tracking-widest ${
              isIncoming ? "text-blue-600" : "text-rose-600"
            }`}
          >
            {isIncoming ? "Add Incoming Order" : "Add Outgoing Order"}
          </h2>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <FormSelect
              label="Monitoring"
              field="monitoring_employee"
              options={monitoringOptions}
              formData={formData}
              setFormData={setFormData}
            />
            <FormSelect
              label="Representative"
              field="representative_employee"
              options={representativeOptions}
              formData={formData}
              setFormData={setFormData}
            />
            {isIncoming && (
              <FormSelect
                label="Supplier"
                field="supplier_name"
                options={supplierOptions}
                formData={formData}
                setFormData={setFormData}
              />
            )}
            <FormSelect
              label="Product Name"
              field="product_name"
              options={productOptions}
              formData={formData}
              setFormData={setFormData}
            />
            {isIncoming ? (
              <FormNumber
                label="Incoming Balance"
                field="incoming_bal"
                formData={formData}
                setFormData={setFormData}
              />
            ) : (
              <FormNumber
                label="Outgoing Balance"
                field="outgoing_bal"
                formData={formData}
                setFormData={setFormData}
              />
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={handleAdd}
              disabled={saving}
              className={`rounded-md px-6 py-2 text-sm font-semibold text-white shadow-sm transition-opacity disabled:opacity-60 ${
                isIncoming
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "bg-rose-600 hover:bg-rose-700"
              }`}
            >
              {saving ? "Saving..." : "Add Order"}
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div
            className={`border-b px-5 py-3 ${
              isIncoming
                ? "border-blue-100 bg-blue-50"
                : "border-rose-100 bg-rose-50"
            }`}
          >
            <span
              className={`text-xs font-bold uppercase tracking-widest ${
                isIncoming ? "text-blue-700" : "text-rose-700"
              }`}
            >
              {isIncoming ? "Incoming Stock Log" : "Outgoing Stock Log"}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-slate-400">
              Loading orders...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm text-slate-400">
              No {stockType} orders found. Add one above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Monitoring</th>
                    <th className="px-4 py-3">Representative</th>
                    {isIncoming && <th className="px-4 py-3">Supplier</th>}
                    <th className="px-4 py-3">Product Name</th>
                    <th className="px-4 py-3">
                      {isIncoming ? "Incoming Qty" : "Outgoing Qty"}
                    </th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.map((row) => {
                    const isEditing = editingId === row.id;
                    return (
                      <tr
                        key={row.id}
                        className="transition-colors hover:bg-slate-50"
                      >
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <EditSelect
                              field="monitoring_employee"
                              options={monitoringOptions}
                              value={editData.monitoring_employee}
                              onChange={handleEditChange}
                            />
                          ) : (
                            <span className="text-slate-700">
                              {row.monitoring_employee}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <EditSelect
                              field="representative_employee"
                              options={representativeOptions}
                              value={editData.representative_employee}
                              onChange={handleEditChange}
                            />
                          ) : (
                            <span className="text-slate-700">
                              {row.representative_employee}
                            </span>
                          )}
                        </td>
                        {isIncoming && (
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <EditSelect
                                field="supplier_name"
                                options={supplierOptions}
                                value={editData.supplier_name}
                                onChange={handleEditChange}
                              />
                            ) : (
                              <span className="text-slate-700">
                                {row.supplier_name}
                              </span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <EditSelect
                              field="product_name"
                              options={productOptions}
                              value={editData.product_name}
                              onChange={handleEditChange}
                            />
                          ) : (
                            <span className="font-medium text-slate-800">
                              {row.product_name}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <EditNumber
                              field={isIncoming ? "incoming_bal" : "outgoing_bal"}
                              value={
                                isIncoming
                                  ? editData.incoming_bal
                                  : editData.outgoing_bal
                              }
                              onChange={handleEditChange}
                            />
                          ) : (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                isIncoming
                                  ? "bg-blue-50 text-blue-700"
                                  : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              {isIncoming ? row.incoming_bal : row.outgoing_bal}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400">
                          {new Date(row.created_at).toLocaleDateString("en-PH", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => handleEditSave(row.id)}
                                disabled={saving}
                                className="rounded bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="rounded bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-300"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => handleEditStart(row)}
                                className="rounded bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDelete(row.id)}
                                className="rounded bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-100"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}