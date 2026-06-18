export function exportInventoryCSV(items = [], date = "") {
  const headers = ["Name","Beginning","In","Out","Current","Actual","Loss"];
  const rows = items.map((i) => [
    `"${(i.name ?? "").replace(/"/g, '""')}"`,
    i.beg_bal ?? 0, i.incoming_bal ?? 0, i.outgoing_bal ?? 0,
    i.current_bal ?? 0, i.actual_bal ?? 0, i.loss ?? 0,
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventory_${date || new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}