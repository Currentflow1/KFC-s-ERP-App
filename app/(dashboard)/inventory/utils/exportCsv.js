export function exportInventoryCSV(items, date) {
  if (!items || !items.length) return;

  const headers = [
    "Name",
    "Beginning",
    "Incoming",
    "Outgoing",
    "Current",
    "Actual",
    "Loss",
  ];

  function escape(value) {
    if (value === null || value === undefined) return "";
    const str = String(value);

    // escape quotes
    if (str.includes('"')) {
      return `"${str.replace(/"/g, '""')}"`;
    }

    // wrap if commas exist
    if (str.includes(",")) {
      return `"${str}"`;
    }

    return str;
  }

  const rows = items.map((i) => [
    escape(i.name),
    i.beg_bal,
    i.incoming_bal,
    i.outgoing_bal,
    i.current_bal,
    i.actual_bal,
    i.loss,
  ]);

  const csv = [
    headers.join(","),
    ...rows.map((r) => r.join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;

  const safeDate = date || "today";
  a.download = `inventory_${safeDate}.csv`;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}