"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabaseClient";

const PRODUCT_TYPE = { RAW: "raw", FINISHED: "finished" };
const STOCK_TYPE   = { INCOMING: "incoming", OUTGOING: "outgoing" };

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function emptyForm() {
  return {
    monitoring_employee: "",
    representative_employee: "",
    staff_employee: "",
    supplier_name: "",
    warehouse: "",
    product_name: "",
    incoming_bal: "",
    outgoing_bal: "",
  };
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
        <p className="text-sm text-gray-700 mb-6">{message}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors">Delete</button>
        </div>
      </div>
    </div>
  );
}

function SearchableSelect({ label, value, options, onChange, placeholder, disabled = false }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const containerRef      = useRef(null);
  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false); setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function select(opt) { onChange(opt); setOpen(false); setQuery(""); }
  function clear(e) { e.stopPropagation(); onChange(""); setQuery(""); }

  return (
    <div className="flex flex-col gap-1" ref={containerRef}>
      {label && <label className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</label>}
      <div className="relative">
        <button type="button" disabled={disabled}
          onClick={() => { if (!disabled) setOpen((p) => !p); setQuery(""); }}
          className={`w-full flex items-center justify-between rounded-md border px-3 py-1.5 text-sm text-left transition-colors ${
            disabled ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                     : "bg-white border-gray-200 text-gray-800 hover:border-blue-400 focus:outline-none"
          }`}>
          <span className={value ? "text-gray-800" : "text-gray-400"}>
            {value || placeholder || `Select ${label}…`}
          </span>
          <span className="flex items-center gap-1 ml-2 shrink-0">
            {value && !disabled && <span onClick={clear} className="text-gray-400 hover:text-gray-600 text-xs cursor-pointer px-1">✕</span>}
            <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
          </span>
        </button>
        {open && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
            <div className="p-2 border-b border-gray-100">
              <input autoFocus type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…" className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <ul className="max-h-48 overflow-y-auto">
              {filtered.length === 0
                ? <li className="px-3 py-2 text-sm text-gray-400">No results</li>
                : filtered.map((o) => (
                  <li key={o} onClick={() => select(o)}
                    className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition-colors ${value === o ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"}`}>
                    {o}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function WarehouseMultiSelect({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggle(w) {
    onChange(selected.includes(w) ? selected.filter((x) => x !== w) : [...selected, w]);
  }

  const label = selected.length === 0
    ? "All warehouses"
    : selected.length === 1
      ? `Warehouse: ${selected[0]}`
      : `${selected.length} warehouses`;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        disabled={options.length === 0}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
          selected.length > 0
            ? "bg-blue-50 text-blue-700 border-blue-300"
            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {label}
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && options.length > 0 && (
        <div className="absolute z-50 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
          <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-gray-100">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Warehouses</span>
            {selected.length > 0 && (
              <button onClick={() => onChange([])} className="text-xs text-blue-600 hover:underline">Clear</button>
            )}
          </div>
          <ul className="max-h-56 overflow-y-auto">
            {options.map((w) => {
              const checked = selected.includes(w);
              return (
                <li key={w}>
                  <label className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(w)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {w}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function OrderTable() {
  const supabase = useMemo(() => createClient(), []);

  const [productType, setProductType] = useState(PRODUCT_TYPE.RAW);
  const [stockType, setStockType]     = useState(STOCK_TYPE.INCOMING);
  const [rows, setRows]               = useState([]);
  const [formData, setFormData]       = useState(emptyForm());
  const [editingId, setEditingId]     = useState(null);
  const [editData, setEditData]       = useState({});
  const [loading, setLoading]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);
  const [successMsg, setSuccessMsg]   = useState(null);
  const [search, setSearch]           = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [offline, setOffline]         = useState(false);
  const [isFinalized, setIsFinalized] = useState(false);
  const [checkingFinalization, setCheckingFinalization] = useState(false);
  const [tableWarehouseFilter, setTableWarehouseFilter] = useState([]);

  // Current user — stamped onto every inserted order as `created_by` so
  // Transaction Logs can resolve "Account Responsible" for ordered rows too
  // (previously only manipulated rows from ManipulatePanel carried this).
  const [userId, setUserId] = useState(null);

  const [monitoringOptions, setMonitoringOptions]         = useState([]);
  const [representativeOptions, setRepresentativeOptions] = useState([]);
  const [staffOptions, setStaffOptions]                   = useState([]);
  const [supplierOptions, setSupplierOptions]             = useState([]);

  // Products shaped as { name, warehouse } — only active (non-discontinued) products.
  // Each product can appear multiple times (once per warehouse).
  const [rawProducts, setRawProducts]           = useState([]);
  const [finishedProducts, setFinishedProducts] = useState([]);

  const isRaw        = productType === PRODUCT_TYPE.RAW;
  const isIncoming   = stockType   === STOCK_TYPE.INCOMING;
  const showSupplier = isRaw && isIncoming;

  const txTableName   = isRaw ? "raw_materials_transaction_log"    : "finished_products_transaction_log";
  const invTableName  = isRaw ? "raw_materials_inventory"          : "finished_products_inventory";
  const histTableName = isRaw ? "raw_materials_inventory_history"  : "finished_products_inventory_history";

  // All unique warehouses for the active product type (from active products only)
  const warehouseOptions = useMemo(() => {
    const source = isRaw ? rawProducts : finishedProducts;
    return [...new Set(source.map((p) => p.warehouse).filter(Boolean))].sort();
  }, [isRaw, rawProducts, finishedProducts]);

  // Product names filtered by selected warehouse in the add form
  const productOptions = useMemo(() => {
    const source = isRaw ? rawProducts : finishedProducts;
    if (!formData.warehouse) return [...new Set(source.map((p) => p.name))];
    return source.filter((p) => p.warehouse === formData.warehouse).map((p) => p.name);
  }, [isRaw, rawProducts, finishedProducts, formData.warehouse]);

  // Product names filtered by selected warehouse in edit mode
  const editProductOptions = useMemo(() => {
    const source = isRaw ? rawProducts : finishedProducts;
    if (!editData.warehouse) return [...new Set(source.map((p) => p.name))];
    return source.filter((p) => p.warehouse === editData.warehouse).map((p) => p.name);
  }, [isRaw, rawProducts, finishedProducts, editData.warehouse]);

  // ── Offline detection ─────────────────────────────────────────────────────

  useEffect(() => {
    setOffline(!isOnline());
    function handleOffline() { setOffline(true); }
    function handleOnline()  { setOffline(false); }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  // ── Load current user (for created_by stamping) ──────────────────────────

  useEffect(() => {
    async function loadUser() {
      if (!isOnline()) return;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setUserId(user?.id ?? null);
      } catch (e) {
        console.error("[OrderTable] failed to load current user:", e.message);
      }
    }
    loadUser();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Check if today is already finalized ───────────────────────────────────

  async function checkIfTodayFinalized() {
    if (!isOnline()) return;
    setCheckingFinalization(true);
    try {
      const { data, error } = await supabase
        .from(histTableName)
        .select("id")
        .eq("inventory_date", todayLocal())
        .limit(1);
      if (error) throw error;
      setIsFinalized(!!(data && data.length > 0));
    } catch (e) {
      console.error("Failed to check finalization status:", e.message);
    } finally {
      setCheckingFinalization(false);
    }
  }

  useEffect(() => {
    fetchOptions();
    checkIfTodayFinalized();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchRows();
    resetForm();
    checkIfTodayFinalized();
    setTableWarehouseFilter([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productType, stockType]);

  // ── Fetch dropdown options ────────────────────────────────────────────────
  // Only active (non-discontinued) products are fetched via !inner join filtering.
  // Warehouse is fetched from junction tables joined to the static table,
  // producing { name, warehouse } pairs. Discontinued products are excluded
  // at the database level using the !inner join + .eq() filter.

  async function fetchOptions() {
    if (!isOnline()) return;
    const [mon, rep, staff, sup, rawJunction, finJunction] = await Promise.all([
      supabase.from("monitoring_employee").select("name"),
      supabase.from("representative_employee").select("name"),
      supabase.from("staff_employee").select("name"),
      supabase.from("suppliers").select("contact_person"),
      // Join raw_materials_warehouses → raw_materials_static, excluding discontinued
      supabase
        .from("raw_materials_warehouses")
        .select("warehouse, raw_materials_static!inner(name, discontinued)")
        .eq("raw_materials_static.discontinued", false),
      // Join finished_products_warehouses → finished_products_static, excluding discontinued
      supabase
        .from("finished_products_warehouses")
        .select("warehouse, finished_products_static!inner(name, discontinued)")
        .eq("finished_products_static.discontinued", false),
    ]);

    setMonitoringOptions(mon.data?.map((r) => r.name) ?? []);
    setRepresentativeOptions(rep.data?.map((r) => r.name) ?? []);
    setStaffOptions(staff.data?.map((r) => r.name) ?? []);
    setSupplierOptions(
      (sup.data?.map((r) => r.contact_person) ?? []).filter((n) => n !== "N/A")
    );

    // Flatten junction rows into { name, warehouse } pairs — only active products
    setRawProducts(
      (rawJunction.data ?? [])
        .filter((r) => r.raw_materials_static?.name && !r.raw_materials_static?.discontinued)
        .map((r) => ({ name: r.raw_materials_static.name, warehouse: r.warehouse }))
    );

    setFinishedProducts(
      (finJunction.data ?? [])
        .filter((r) => r.finished_products_static?.name && !r.finished_products_static?.discontinued)
        .map((r) => ({ name: r.finished_products_static.name, warehouse: r.warehouse }))
    );
  }

  // ── Fetch pending orders ──────────────────────────────────────────────────

  async function fetchRows() {
    if (!isOnline()) {
      setError("You're offline — Order Table requires an internet connection.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from(txTableName)
        .select("*")
        .is("finalized_at", null)
        .is("removed_at", null)
        .order("created_at", { ascending: false });
      if (e) throw e;
      setRows(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function showSuccess(msg) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  function resetForm() {
    setFormData(emptyForm());
    setEditingId(null);
    setEditData({});
    setError(null);
    setSuccessMsg(null);
    setSearch("");
  }

  function handleWarehouseChange(warehouse) {
    setFormData((prev) => {
      const source = isRaw ? rawProducts : finishedProducts;
      const validNames = warehouse
        ? source.filter((p) => p.warehouse === warehouse).map((p) => p.name)
        : [...new Set(source.map((p) => p.name))];
      return {
        ...prev,
        warehouse,
        product_name: validNames.includes(prev.product_name) ? prev.product_name : "",
      };
    });
  }

  function handleEditWarehouseChange(warehouse) {
    setEditData((prev) => {
      const source = isRaw ? rawProducts : finishedProducts;
      const validNames = warehouse
        ? source.filter((p) => p.warehouse === warehouse).map((p) => p.name)
        : [...new Set(source.map((p) => p.name))];
      return {
        ...prev,
        warehouse,
        product_name: validNames.includes(prev.product_name) ? prev.product_name : "",
      };
    });
  }

  async function resolveInventoryId(productName, warehouse) {
    const { data, error } = await supabase
      .from(invTableName)
      .select("id")
      .eq("name", productName)
      .eq("warehouse", warehouse);
    if (error) throw new Error(`Inventory lookup failed: ${error.message}`);
    if (!data || data.length === 0) throw new Error(`No inventory row found for "${productName}" in warehouse "${warehouse}".`);
    return data[0].id;
  }

  // ── ADD ───────────────────────────────────────────────────────────────────

  async function handleAdd() {
    if (isFinalized) { setError("⚠️ Today is already finalized. Undo finalize to add orders."); return; }
    if (!isOnline())  { setError("You're offline — reconnect to add an order."); return; }
    setError(null);
    const qty = Number(isIncoming ? formData.incoming_bal : formData.outgoing_bal);

    if (!formData.warehouse)                              { setError("Select a warehouse."); return; }
    if (!formData.monitoring_employee)                    { setError("Select a monitoring employee."); return; }
    if (!isIncoming && !formData.representative_employee) { setError("Select a representative employee."); return; }
    if (isRaw && isIncoming && !formData.supplier_name)   { setError("Select a supplier."); return; }
    if (!formData.product_name)                           { setError("Select a product."); return; }
    if (!qty || qty <= 0)                                 { setError("Enter a valid quantity."); return; }

    setSaving(true);
    try {
      const inventory_id = await resolveInventoryId(formData.product_name, formData.warehouse);
      const payload = {
        inventory_id,
        monitoring_employee:      formData.monitoring_employee,
        representative_employee:  isIncoming ? null : formData.representative_employee,
        staff_employee:           isIncoming ? null : (formData.staff_employee || null),
        product_name:             formData.product_name,
        warehouse:                formData.warehouse,
        incoming_bal:             isIncoming ? qty : 0,
        outgoing_bal:             isIncoming ? 0 : qty,
        transaction_source:       "ordered",
        transaction_type:         "stock_movement",
        created_by:               userId,
        ...(isRaw ? { supplier_name: isIncoming ? formData.supplier_name : null } : {}),
      };
      const { error: insertError } = await supabase.from(txTableName).insert([payload]);
      if (insertError) throw insertError;
      resetForm();
      await fetchRows();
      showSuccess("Order added.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── EDIT ──────────────────────────────────────────────────────────────────

  async function handleEditSave(id) {
    if (isFinalized) { setError("⚠️ Today is already finalized. Undo finalize to edit orders."); return; }
    if (!isOnline())  { setError("You're offline — reconnect to save changes."); return; }
    setError(null);
    setSaving(true);
    try {
      const newInventoryId = await resolveInventoryId(editData.product_name, editData.warehouse);
      const updatePayload = {
        inventory_id:             newInventoryId,
        monitoring_employee:      editData.monitoring_employee,
        representative_employee:  editData.representative_employee ?? null,
        staff_employee:           editData.staff_employee ?? null,
        product_name:             editData.product_name,
        warehouse:                editData.warehouse,
        incoming_bal:             Number(editData.incoming_bal ?? 0),
        outgoing_bal:             Number(editData.outgoing_bal ?? 0),
        ...(isRaw ? {
          supplier_name: Number(editData.incoming_bal ?? 0) > 0
            ? (editData.supplier_name || null) : null,
        } : {}),
      };
      const { error: updateError } = await supabase.from(txTableName).update(updatePayload).eq("id", id);
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

  // ── DELETE (soft) ─────────────────────────────────────────────────────────

  async function confirmDelete() {
    if (isFinalized) { setError("⚠️ Today is already finalized. Undo finalize to delete orders."); setDeleteTarget(null); return; }
    if (!isOnline())  { setError("You're offline — reconnect to delete this order."); setDeleteTarget(null); return; }
    const id = deleteTarget;
    setDeleteTarget(null);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from(txTableName)
        .update({ removed_at: new Date().toISOString(), removed_reason: "deleted" })
        .eq("id", id);
      if (deleteError) throw deleteError;
      await fetchRows();
      showSuccess("Order deleted.");
    } catch (e) {
      setError(e.message);
    }
  }

  function handleEditStart(row) {
    if (isFinalized) { setError("⚠️ Today is already finalized. Undo finalize to edit orders."); return; }
    if (!isOnline())  { setError("You're offline — reconnect to edit this order."); return; }
    setEditingId(row.id);
    setEditData({ ...row, warehouse: row.warehouse || "" });
  }

  function handleEditChange(field, value) { setEditData((prev) => ({ ...prev, [field]: value })); }

  const filteredRows = rows
    .filter((r) => isIncoming ? (r.incoming_bal ?? 0) > 0 : (r.outgoing_bal ?? 0) > 0)
    .filter((r) => r.product_name?.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((r) => tableWarehouseFilter.length === 0 || tableWarehouseFilter.includes(r.warehouse));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">

      {deleteTarget && (
        <ConfirmModal
          message="Delete this order? The change will be recorded in Transaction Logs."
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Order Table</h1>
        <p className="text-sm text-gray-500 mt-0.5">Pending orders — applied to inventory permanently on Finalize Day.</p>
      </div>

      {offline && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <span className="font-semibold">You're offline.</span> Order Table requires an internet connection.
        </div>
      )}

      {isFinalized && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="text-lg">🔒</span>
            <div>
              <p className="font-semibold">Today is finalized — Order Table is locked</p>
              <p className="text-xs mt-1 text-red-700">
                Go to the Inventory page and use <strong>↩ Finalize</strong> to re-open today's orders, or wait until tomorrow.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-5 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
          <button onClick={() => setProductType(PRODUCT_TYPE.RAW)}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${isRaw ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            Raw Materials
          </button>
          <button onClick={() => setProductType(PRODUCT_TYPE.FINISHED)}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${!isRaw ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            Finished Products
          </button>
        </div>
        <div className="w-px h-6 bg-gray-200 mx-0.5" />
        <div className="flex rounded-md border border-gray-200 overflow-hidden shrink-0">
          <button onClick={() => setStockType(STOCK_TYPE.INCOMING)}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${isIncoming ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            ↓ Incoming
          </button>
          <button onClick={() => setStockType(STOCK_TYPE.OUTGOING)}
            className={`px-4 py-1.5 text-sm font-medium border-l border-gray-200 transition-colors ${!isIncoming ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
            ↑ Outgoing
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
      )}
      {successMsg && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">{successMsg}</div>
      )}

      {/* Add form */}
      <div className={`bg-white border border-gray-200 rounded-lg shadow-sm p-4 mb-5 transition-opacity ${isFinalized ? "opacity-60" : ""}`}>
        <h2 className="text-sm font-semibold text-gray-900 mb-4">
          {isIncoming ? "Add Incoming Order" : "Add Outgoing Order"}
          <span className="ml-2 text-gray-400 font-normal">— {isRaw ? "Raw Materials" : "Finished Products"}</span>
        </h2>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <SearchableSelect
            label="Warehouse"
            value={formData.warehouse}
            options={warehouseOptions}
            disabled={offline || isFinalized || warehouseOptions.length === 0}
            placeholder={warehouseOptions.length === 0 ? "No warehouses set" : "All warehouses"}
            onChange={handleWarehouseChange}
          />
          <SearchableSelect label="Monitoring" value={formData.monitoring_employee}
            options={monitoringOptions} disabled={offline || isFinalized}
            onChange={(v) => setFormData((p) => ({ ...p, monitoring_employee: v }))} />
          {!isIncoming && (
            <SearchableSelect label="Representative" value={formData.representative_employee}
              options={representativeOptions} disabled={offline || isFinalized}
              onChange={(v) => setFormData((p) => ({ ...p, representative_employee: v }))} />
          )}
          {!isIncoming && (
            <SearchableSelect label="Staff" value={formData.staff_employee}
              options={staffOptions} disabled={offline || isFinalized}
              onChange={(v) => setFormData((p) => ({ ...p, staff_employee: v }))} />
          )}
          {showSupplier && (
            <SearchableSelect label="Supplier" value={formData.supplier_name}
              options={supplierOptions} disabled={offline || isFinalized}
              onChange={(v) => setFormData((p) => ({ ...p, supplier_name: v }))} />
          )}
          <SearchableSelect
            label={formData.warehouse ? `Product (${formData.warehouse})` : "Product"}
            value={formData.product_name}
            options={productOptions}
            disabled={offline || isFinalized}
            onChange={(v) => setFormData((p) => ({ ...p, product_name: v }))}
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {isIncoming ? "Incoming Qty" : "Outgoing Qty"}
            </label>
            <input type="number" min="0" placeholder="0" disabled={offline || isFinalized}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
              value={isIncoming ? formData.incoming_bal : formData.outgoing_bal}
              onChange={(e) => setFormData((p) => ({
                ...p,
                [isIncoming ? "incoming_bal" : "outgoing_bal"]: e.target.value,
              }))} />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={handleAdd} disabled={saving || offline || isFinalized}
            title={isFinalized ? "Order Table is locked — undo finalize to add orders" : ""}
            className="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            {saving ? "Saving…" : "Add Order"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-3 border-b border-gray-200 bg-gray-50">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full max-w-xs border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {search && (
            <button onClick={() => setSearch("")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Clear</button>
          )}

          <WarehouseMultiSelect
            options={warehouseOptions}
            selected={tableWarehouseFilter}
            onChange={setTableWarehouseFilter}
          />

          {!loading && (
            <span className="ml-auto text-xs text-gray-400 shrink-0">
              {filteredRows.length} {filteredRows.length === 1 ? "order" : "orders"}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          {offline ? (
            <div className="px-4 py-8 text-sm text-gray-400 text-center">Reconnect to view and manage orders.</div>
          ) : loading ? (
            <div className="px-4 py-4 text-sm text-gray-400">Loading…</div>
          ) : filteredRows.length === 0 ? (
            <div className="px-4 py-8 text-sm text-gray-400 text-center">
              {search ? `No orders matching "${search}"` : `No ${stockType} orders found.`}
            </div>
          ) : (
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Warehouse</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Monitoring</th>
                  {!isIncoming && <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Representative</th>}
                  {!isIncoming && <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Staff</th>}
                  {showSupplier && <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Supplier</th>}
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Product</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">{isIncoming ? "Incoming Qty" : "Outgoing Qty"}</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRows.map((row) => {
                  const isEditing = editingId === row.id;
                  return (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-500">{row.warehouse ?? "—"}</td>
                      <td className="px-4 py-3 min-w-[160px]">
                        {isEditing
                          ? <SearchableSelect value={editData.monitoring_employee} options={monitoringOptions} onChange={(v) => handleEditChange("monitoring_employee", v)} />
                          : <span className="text-gray-700">{row.monitoring_employee}</span>}
                      </td>
                      {!isIncoming && (
                        <td className="px-4 py-3 min-w-[160px]">
                          {isEditing
                            ? <SearchableSelect value={editData.representative_employee ?? ""} options={representativeOptions} onChange={(v) => handleEditChange("representative_employee", v)} />
                            : <span className="text-gray-700">{row.representative_employee}</span>}
                        </td>
                      )}
                      {!isIncoming && (
                        <td className="px-4 py-3 min-w-[160px]">
                          {isEditing
                            ? <SearchableSelect value={editData.staff_employee ?? ""} options={staffOptions} onChange={(v) => handleEditChange("staff_employee", v)} />
                            : <span className="text-gray-700">{row.staff_employee}</span>}
                        </td>
                      )}
                      {showSupplier && (
                        <td className="px-4 py-3 min-w-[160px]">
                          {isEditing
                            ? <SearchableSelect value={editData.supplier_name ?? ""} options={supplierOptions} onChange={(v) => handleEditChange("supplier_name", v)} />
                            : <span className="text-gray-700">{row.supplier_name}</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 font-medium text-gray-900 min-w-[200px]">
                        {isEditing ? (
                          <div className="flex flex-col gap-1.5">
                            <SearchableSelect
                              placeholder="Filter by warehouse…"
                              value={editData.warehouse ?? ""}
                              options={warehouseOptions}
                              onChange={handleEditWarehouseChange}
                            />
                            <SearchableSelect
                              value={editData.product_name}
                              options={editProductOptions}
                              onChange={(v) => handleEditChange("product_name", v)}
                            />
                          </div>
                        ) : row.product_name}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input type="number" min="0"
                            className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={isIncoming ? editData.incoming_bal : editData.outgoing_bal}
                            onChange={(e) => handleEditChange(isIncoming ? "incoming_bal" : "outgoing_bal", e.target.value)} />
                        ) : (
                          <span className="text-gray-900">{isIncoming ? row.incoming_bal : row.outgoing_bal}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <button onClick={() => handleEditSave(row.id)} disabled={saving || offline || isFinalized}
                              className="px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed">Save</button>
                            <button onClick={() => setEditingId(null)}
                              className="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors">Cancel</button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button onClick={() => handleEditStart(row)} disabled={offline || isFinalized}
                              title={isFinalized ? "Order Table is locked" : ""}
                              className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed">Edit</button>
                            <button onClick={() => setDeleteTarget(row.id)} disabled={offline || isFinalized}
                              title={isFinalized ? "Order Table is locked" : ""}
                              className="px-3 py-1.5 text-xs font-medium bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed">Delete</button>
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
    </div>
  );
}