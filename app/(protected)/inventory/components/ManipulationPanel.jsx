"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabaseClient";
import {
  writeInventory,
  queueTxLog,
  setCache,
  getCache,
  patchInventorySnapshot,
} from "@/lib/sync";

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function SearchableSelect({ label, value, options, onChange, placeholder, disabled = false }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const ref               = useRef(null);
  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(""); }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function select(opt) { onChange(opt); setOpen(false); setQuery(""); }
  function clear(e)    { e.stopPropagation(); onChange(""); setQuery(""); }

  return (
    <div className="flex flex-col gap-1" ref={ref}>
      {label && (
        <label className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</label>
      )}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => { if (!disabled) setOpen((p) => !p); setQuery(""); }}
          className={`w-full flex items-center justify-between rounded-md border px-3 py-1.5 text-sm text-left transition-colors ${
            disabled
              ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
              : "bg-white border-gray-200 text-gray-800 hover:border-blue-400 focus:outline-none"
          }`}
        >
          <span className={value ? "text-gray-800" : "text-gray-400"}>
            {value || placeholder || "Select…"}
          </span>
          <span className="flex items-center gap-1 ml-2 shrink-0">
            {value && !disabled && (
              <span onClick={clear} className="text-gray-400 hover:text-gray-600 text-xs cursor-pointer px-1">✕</span>
            )}
            <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
          </span>
        </button>
        {open && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
            <div className="p-2 border-b border-gray-100">
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <ul className="max-h-40 overflow-y-auto">
              {filtered.length === 0
                ? <li className="px-3 py-2 text-sm text-gray-400">No results</li>
                : filtered.map((o) => (
                  <li key={o} onClick={() => select(o)}
                    className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 hover:text-blue-700 transition-colors ${
                      value === o ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"
                    }`}>
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

export default function ManipulatePanel({ item, tab, onClose, onUpdated, onLocalPatch, isFinalized = false }) {
  const supabase = createClient();

  const isRaw       = tab === "raw";
  const table       = isRaw ? "raw_materials_inventory"        : "finished_products_inventory";
  const txLogTable  = isRaw ? "raw_materials_transaction_log"  : "finished_products_transaction_log";
  const snapshotKey = isRaw ? "raw"                            : "finished";
  const staticTable = isRaw ? "raw_materials_static"           : "finished_products_static";

  // ── Stock direction — mirrors Orders module ───────────────────────────────
  const [stockMode, setStockMode] = useState("incoming");
  const isIncoming = stockMode === "incoming";
  const showSupplier = isRaw && isIncoming;

  // ── Form state ────────────────────────────────────────────────────────────
  const [qty,                    setQty]                    = useState("");
  const [actual,                 setActual]                 = useState("");
  const [saving,                 setSaving]                 = useState(false);
  const [txError,                setTxError]                = useState(null);
  const [monitoringEmployee,     setMonitoringEmployee]     = useState("");
  const [representativeEmployee, setRepresentativeEmployee] = useState("");
  const [staffEmployee,          setStaffEmployee]          = useState("");
  const [supplierName,           setSupplierName]           = useState("");

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [role,        setRole]        = useState(null);
  const [userId,      setUserId]      = useState(null);
  const [offlineMode, setOfflineMode] = useState(false);

  // ── Options ───────────────────────────────────────────────────────────────
  const [monitoringOptions,     setMonitoringOptions]     = useState([]);
  const [representativeOptions, setRepresentativeOptions] = useState([]);
  const [staffOptions,          setStaffOptions]          = useState([]);
  const [supplierOptions,       setSupplierOptions]       = useState([]);
  const [warehouse,             setWarehouse]             = useState(null);

  const displayedCurrent = Number(item.current_bal     ?? 0);
  const pendingIn        = Number(item._pendingIncoming ?? 0);
  const pendingOut       = Number(item._pendingOutgoing ?? 0);

  // ── Init: permissions + options ───────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function loadFromCache() {
      const [r, u, m, rep, staff, sup, wh] = await Promise.all([
        getCache("role"),
        getCache("userId"),
        getCache("monitoringOptions"),
        getCache("representativeOptions"),
        getCache("staffOptions"),
        getCache("supplierOptions"),
        getCache(`warehouse_${tab}_${item.id}`),
      ]);
      if (cancelled) return;
      setRole(r ?? "staff");
      setUserId(u ?? null);
      setMonitoringOptions(m   ?? []);
      setRepresentativeOptions(rep ?? []);
      setStaffOptions(staff ?? []);
      setSupplierOptions(sup   ?? []);
      setWarehouse(wh   ?? null);
      setOfflineMode(true);
    }

    async function init() {
      if (!isOnline()) { await loadFromCache(); return; }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (!cancelled) setRole("staff"); return; }
        if (cancelled) return;
        setUserId(user.id);
        await setCache("userId", user.id);

        const [
          { data: profile },
          { data: monRows },
          { data: repRows },
          { data: staffRows },
          { data: supRows },
          { data: staticRows },
        ] = await Promise.all([
          supabase.from("profiles").select("role").eq("id", user.id).single(),
          supabase.from("monitoring_employee").select("name"),
          supabase.from("representative_employee").select("name"),
          supabase.from("staff_employee").select("name"),
          supabase.from("suppliers").select("contact_person"),
          supabase.from(staticTable).select("warehouse").eq("name", item.name).limit(1),
        ]);
        if (cancelled) return;

        const resolvedRole  = profile?.role ?? "staff";
        const monNames      = (monRows   ?? []).map((r) => r.name);
        const repNames      = (repRows   ?? []).map((r) => r.name);
        const staffNames    = (staffRows ?? []).map((r) => r.name).filter(Boolean);
        const supNames      = (supRows   ?? []).map((r) => r.contact_person).filter((n) => n !== "N/A");
        const itemWarehouse = staticRows?.[0]?.warehouse ?? null;

        setRole(resolvedRole);
        setMonitoringOptions(monNames);
        setRepresentativeOptions(repNames);
        setStaffOptions(staffNames);
        setSupplierOptions(supNames);
        setWarehouse(itemWarehouse);

        await setCache("role",                        resolvedRole);
        await setCache("monitoringOptions",           monNames);
        await setCache("representativeOptions",       repNames);
        await setCache("staffOptions",                staffNames);
        await setCache("supplierOptions",             supNames);
        await setCache(`warehouse_${tab}_${item.id}`, itemWarehouse);
      } catch (e) {
        console.error("[ManipulatePanel] live fetch failed, using cache:", e);
        await loadFromCache();
      }
    }

    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Validation — same rules as Orders ────────────────────────────────────

  function validate() {
    if (!monitoringEmployee) {
      setTxError("Select a monitoring employee."); return false;
    }
    if (!isIncoming && !representativeEmployee) {
      setTxError("Select a representative employee for outgoing."); return false;
    }
    if (showSupplier && !supplierName) {
      setTxError("Select a supplier for incoming raw materials."); return false;
    }
    const q = Number(qty || 0);
    if (!q || q <= 0) {
      setTxError("Enter a valid quantity."); return false;
    }
    setTxError(null);
    return true;
  }

  // ── Tx log payload ────────────────────────────────────────────────────────
  // Includes `warehouse` so the log records where the movement happened —
  // mirrors the `warehouse` column on raw_materials_transaction_log /
  // finished_products_transaction_log.

  function buildTxPayload({ mode, q, actual_bal, loss, txType }) {
    return {
      inventory_id:            item.id,
      monitoring_employee:     monitoringEmployee,
      representative_employee: representativeEmployee || null,
      staff_employee:          staffEmployee || null,
      ...(isRaw ? { supplier_name: showSupplier ? (supplierName || null) : null } : {}),
      product_name:            item.name,
      incoming_bal:            txType === "stock_movement" && mode === "in"  ? q : 0,
      outgoing_bal:            txType === "stock_movement" && mode === "out" ? q : 0,
      finalized_at:            new Date().toISOString(),
      created_by:              userId,
      transaction_source:      "manipulated",
      transaction_type:        txType,
      actual_bal,
      loss,
      warehouse:               warehouse || null,
    };
  }

  // ── Apply IN / OUT ────────────────────────────────────────────────────────

  async function applyChange() {
    // ─── FINALIZATION SAFETY CHECK ───
    if (isFinalized) {
      setTxError("🔒 Today is finalized. You cannot edit inventory.");
      return;
    }

    if (!validate()) return;
    const q    = Number(qty);
    const mode = isIncoming ? "in" : "out";
    setSaving(true);

    await onUpdated(async () => {
      const online = isOnline();
      let beg, incoming, outgoing, existing_actual;

      if (online) {
        const { data, error } = await supabase
          .from(table).select("*").eq("id", item.id).maybeSingle();
        if (error || !data) { alert("Failed to fetch current values."); return null; }
        beg             = Number(data.beg_bal      ?? 0);
        incoming        = Number(data.incoming_bal  ?? 0);
        outgoing        = Number(data.outgoing_bal  ?? 0);
        existing_actual = data.actual_bal != null ? Number(data.actual_bal) : null;
      } else {
        beg             = Number(item.beg_bal      ?? 0);
        incoming        = Number(item.incoming_bal  ?? 0);
        outgoing        = Number(item.outgoing_bal  ?? 0);
        existing_actual = item.actual_bal != null ? Number(item.actual_bal) : null;
      }

      if (mode === "in")  incoming += q;
      if (mode === "out") outgoing += q;

      const current_bal = beg + incoming - outgoing;
      const actual_bal  = existing_actual ?? current_bal;
      const loss        = existing_actual != null ? Math.max(0, current_bal - existing_actual) : 0;

      const invPayload = {
        id: item.id, name: item.name,
        beg_bal: beg, incoming_bal: incoming, outgoing_bal: outgoing,
        current_bal, actual_bal, loss,
        warehouse: warehouse || null,
      };
      const txPayload = buildTxPayload({ mode, q, actual_bal, loss, txType: "stock_movement" });

      const synced = await writeInventory(table, item.id, invPayload);

      if (!synced) {
        await queueTxLog(txLogTable, txPayload);
        const patch = {
          beg_bal: beg, incoming_bal: incoming, outgoing_bal: outgoing,
          current_bal, actual_bal, loss, warehouse: warehouse || null,
        };
        await patchInventorySnapshot(snapshotKey, item.id, patch);
        onLocalPatch?.(item.id, patch);
        return null;
      }

      const { data: txRow, error: txErr } = await supabase
        .from(txLogTable).insert(txPayload).select("id").single();
      if (txErr) { alert("Inventory updated but tx log failed: " + txErr.message); return null; }
      return txRow?.id ?? null;
    });

    setSaving(false);
    setQty("");
  }

  // ── Set actual count ──────────────────────────────────────────────────────

  async function setActualValue() {
    // ─── FINALIZATION SAFETY CHECK ───
    if (isFinalized) {
      setTxError("🔒 Today is finalized. You cannot edit inventory.");
      return;
    }

    if (actual === "") return;
    if (!monitoringEmployee) { setTxError("Select a monitoring employee."); return; }
    setTxError(null);
    setSaving(true);

    await onUpdated(async () => {
      const online = isOnline();
      const a      = Number(actual);
      let current_bal, beg_bal, incoming_bal, outgoing_bal;

      if (online) {
        const { data, error } = await supabase
          .from(table).select("*").eq("id", item.id).maybeSingle();
        if (error || !data) { alert("Failed to fetch current values."); return null; }
        beg_bal      = Number(data.beg_bal      ?? 0);
        incoming_bal = Number(data.incoming_bal  ?? 0);
        outgoing_bal = Number(data.outgoing_bal  ?? 0);
        current_bal  = Number(data.current_bal   ?? 0);
      } else {
        beg_bal      = Number(item.beg_bal      ?? 0);
        incoming_bal = Number(item.incoming_bal  ?? 0);
        outgoing_bal = Number(item.outgoing_bal  ?? 0);
        current_bal  = Number(item.current_bal   ?? 0);
      }

      const loss       = Math.max(0, current_bal - a);
      const invPayload = {
        id: item.id, name: item.name,
        beg_bal, incoming_bal, outgoing_bal, current_bal,
        actual_bal: a, loss,
        warehouse: warehouse || null,
      };
      const txPayload = buildTxPayload({ mode: null, q: 0, actual_bal: a, loss, txType: "count_correction" });

      const synced = await writeInventory(table, item.id, invPayload);

      if (!synced) {
        await queueTxLog(txLogTable, txPayload);
        const patch = { current_bal, actual_bal: a, loss, warehouse: warehouse || null };
        await patchInventorySnapshot(snapshotKey, item.id, patch);
        onLocalPatch?.(item.id, patch);
        return null;
      }

      const { data: txRow, error: txErr } = await supabase
        .from(txLogTable).insert(txPayload).select("id").single();
      if (txErr) { alert("Inventory updated but tx log failed: " + txErr.message); return null; }
      return txRow?.id ?? null;
    });

    setSaving(false);
    setActual("");
  }

  const lossPreview = actual !== "" ? Math.max(0, displayedCurrent - Number(actual)) : null;

  // ── Loading ───────────────────────────────────────────────────────────────

  if (role === null) {
    return (
      <div className="fixed bottom-6 right-6 bg-white text-gray-900 border shadow-lg p-4 w-80 rounded-lg z-10">
        <div className="flex justify-between items-start mb-3">
          <h2 className="font-bold text-base">{item.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <p className="text-sm text-gray-400 text-center py-6 animate-pulse">Checking permissions…</p>
      </div>
    );
  }

  // ── Staff blocked ─────────────────────────────────────────────────────────

  if (role !== "admin") {
    return (
      <div className="fixed bottom-6 right-6 bg-white text-gray-900 border shadow-lg p-4 w-80 rounded-lg z-10">
        <div className="flex justify-between items-start mb-4">
          <h2 className="font-bold text-base">{item.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-6 text-center">
          <div className="text-3xl mb-2">🔒</div>
          <p className="text-sm font-semibold text-red-700">Access Restricted</p>
          <p className="text-xs text-red-400 mt-1">Only admins can manipulate inventory.</p>
        </div>
      </div>
    );
  }

  // ── Admin panel ───────────────────────────────────────────────────────────

  return (
    <div className={`fixed bottom-6 right-6 bg-white text-gray-900 border shadow-lg p-4 w-80 rounded-lg z-10 max-h-[90vh] overflow-y-auto transition-opacity ${isFinalized ? "opacity-60 pointer-events-none" : ""}`}>

      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <h2 className="font-bold text-base leading-tight">{item.name}</h2>
          {warehouse && (
            <span className="text-xs text-gray-400 mt-0.5 block">📦 {warehouse}</span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-2 shrink-0">✕</button>
      </div>

      {/* ─── FINALIZATION LOCK BANNER FOR PANEL ─── */}
      {isFinalized && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          <div className="font-semibold flex items-center gap-1">
            <span>🔒</span>
            Panel Locked
          </div>
          <p className="mt-1 text-red-600">Today is finalized. Undo to make changes.</p>
        </div>
      )}

      {/* Offline banner */}
      {offlineMode && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span className="font-semibold">Offline mode</span> — using cached permissions. Changes sync when wifi returns.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center text-xs">
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-400 mb-0.5">Current</div>
          <div className="font-semibold text-gray-800">{displayedCurrent}</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-400 mb-0.5">Actual</div>
          <div className="font-semibold text-gray-800">{Number(item.actual_bal ?? 0)}</div>
        </div>
        <div className="bg-red-50 rounded p-2">
          <div className="text-red-400 mb-0.5">Loss</div>
          <div className="font-semibold text-red-600">{Number(item.loss ?? 0)}</div>
        </div>
      </div>

      {/* Pending orders */}
      {(pendingIn > 0 || pendingOut > 0) && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <div className="font-semibold mb-0.5">Pending orders (not yet closed)</div>
          {pendingIn  > 0 && <div>↓ Incoming: +{pendingIn}</div>}
          {pendingOut > 0 && <div>↑ Outgoing: −{pendingOut}</div>}
        </div>
      )}

      {/* ── Section: Stock Movement — mirrors Orders exactly ── */}
      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs font-semibold text-gray-700 mb-3">
          {isIncoming ? "Add Incoming" : "Add Outgoing"}
          <span className="ml-1.5 text-gray-400 font-normal">— {isRaw ? "Raw Material" : "Finished Product"}</span>
        </p>

        {/* Incoming / Outgoing toggle */}
        <div className="flex rounded-md border border-gray-200 overflow-hidden mb-3">
          <button
            onClick={() => { setStockMode("incoming"); setQty(""); setTxError(null); setSupplierName(""); setRepresentativeEmployee(""); setStaffEmployee(""); }}
            disabled={isFinalized}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              isIncoming ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            } ${isFinalized ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            ↓ Incoming
          </button>
          <button
            onClick={() => { setStockMode("outgoing"); setQty(""); setTxError(null); setSupplierName(""); }}
            disabled={isFinalized}
            className={`flex-1 py-1.5 text-xs font-medium border-l border-gray-200 transition-colors ${
              !isIncoming ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            } ${isFinalized ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            ↑ Outgoing
          </button>
        </div>

        <div className="space-y-3">

          {/* Monitoring — always shown, same as Orders */}
          <SearchableSelect
            label="Monitoring"
            value={monitoringEmployee}
            options={monitoringOptions}
            onChange={(v) => { setMonitoringEmployee(v); setTxError(null); }}
            placeholder="Select monitoring employee…"
            disabled={isFinalized}
          />

          {/* Representative — outgoing only (required), optional incoming */}
          {!isIncoming && (
            <SearchableSelect
              label="Representative"
              value={representativeEmployee}
              options={representativeOptions}
              onChange={(v) => { setRepresentativeEmployee(v); setTxError(null); }}
              placeholder="Select representative employee…"
              disabled={isFinalized}
            />
          )}

          {/* Staff — outgoing only, sourced from staff_employee table (Employees module) */}
          {!isIncoming && (
            <SearchableSelect
              label="Staff"
              value={staffEmployee}
              options={staffOptions}
              onChange={(v) => { setStaffEmployee(v); setTxError(null); }}
              placeholder={staffOptions.length ? "Select staff…" : "No staff found — add one in Employees"}
              disabled={isFinalized || staffOptions.length === 0}
            />
          )}

          {/* Supplier — raw + incoming only, same as Orders */}
          {showSupplier && (
            <SearchableSelect
              label="Supplier"
              value={supplierName}
              options={supplierOptions}
              onChange={(v) => { setSupplierName(v); setTxError(null); }}
              placeholder="Select supplier…"
              disabled={isFinalized}
            />
          )}

          {/* Qty */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {isIncoming ? "Incoming Qty" : "Outgoing Qty"}
            </label>
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              type="number"
              min="0"
              disabled={isFinalized}
              className={`border p-2 w-full rounded text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isFinalized ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}`}
            />
          </div>

          {txError && <p className="text-xs text-red-500">{txError}</p>}

          <button
            onClick={applyChange}
            disabled={saving || isFinalized}
            className={`w-full py-2 rounded text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isIncoming ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
            }`}
            title={isFinalized ? "Panel locked — undo finalize to edit" : ""}
          >
            {saving ? "Saving…" : isIncoming ? "+ Apply Incoming" : "− Apply Outgoing"}
          </button>
        </div>
      </div>

      {/* ── Section: Set actual count ── */}
      <div className="border-t border-gray-100 pt-3 mt-3 space-y-2">
        <p className="text-xs font-semibold text-gray-700 mb-2">Count Correction</p>

        {/* Monitoring for actual count — reuses same field */}
        {!monitoringEmployee && (
          <p className="text-xs text-amber-600">Select a monitoring employee above first.</p>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Actual count
          </label>
          <input
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder="Physical count…"
            type="number"
            min="0"
            disabled={isFinalized}
            className={`border p-2 w-full rounded text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${isFinalized ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}`}
          />
        </div>

        {lossPreview !== null && (
          <p className={`text-xs ${lossPreview > 0 ? "text-red-500" : "text-green-600"}`}>
            Loss preview: {lossPreview}{lossPreview === 0 ? " (no loss)" : ""}
          </p>
        )}

        <button
          onClick={setActualValue}
          disabled={saving || isFinalized}
          className="bg-purple-600 hover:bg-purple-700 text-white w-full py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={isFinalized ? "Panel locked — undo finalize to edit" : ""}
        >
          {saving ? "Saving…" : "Update Actual Count"}
        </button>
      </div>
    </div>
  );
}