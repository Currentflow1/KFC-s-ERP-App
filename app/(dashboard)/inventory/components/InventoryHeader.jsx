"use client";

import { exportInventoryCSV } from "../utils/exportCsv";

export default function InventoryHeader({
  onPrint,
  items = [],
  date = "",
}) {
  function handleExport() {
    exportInventoryCSV(items, date);
  }

  function pad(str, len) {
    str = String(str ?? "");
    if (str.length >= len) return str.slice(0, len - 1) + " ";
    return str + " ".repeat(len - str.length);
  }

  function padNum(num, len) {
    const str = String(num ?? 0);
    if (str.length >= len) return str.slice(0, len);
    return " ".repeat(len - str.length) + str;
  }

  function handlePrint() {
    // Column widths tuned for an 80-column dot matrix printer
    const cols = [
      { key: "name", label: "ITEM", width: 26 },
      { key: "beg_bal", label: "BEG", width: 9 },
      { key: "incoming_bal", label: "IN", width: 9 },
      { key: "outgoing_bal", label: "OUT", width: 9 },
      { key: "current_bal", label: "CURR", width: 9 },
      { key: "actual_bal", label: "ACTUAL", width: 9 },
      { key: "loss", label: "LOSS", width: 9 },
    ];

    const lineWidth = cols.reduce((sum, c) => sum + c.width, 0);
    const divider = "-".repeat(lineWidth);

    let out = "";
    out += "INVENTORY REPORT\n";
    out += `Date: ${date || new Date().toISOString().slice(0, 10)}  (${date ? "Historical" : "Live"})\n`;
    out += divider + "\n";

    out +=
      cols
        .map(c => (c.key === "name" ? pad(c.label, c.width) : padNum(c.label, c.width)))
        .join("") + "\n";
    out += divider + "\n";

    items.forEach(item => {
      out +=
        cols
          .map(c =>
            c.key === "name" ? pad(item.name, c.width) : padNum(item[c.key], c.width)
          )
          .join("") + "\n";
    });

    out += divider + "\n";
    out += `Total items: ${items.length}\n`;

    const escaped = out
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Inventory Report</title>
          <style>
            @page { size: auto; margin: 5mm; }
            body {
              font-family: "Courier New", Courier, monospace;
              font-size: 10pt;
              line-height: 1.2;
              white-space: pre;
              margin: 0;
              color: #000;
              background: #fff;
            }
          </style>
        </head>
        <body>${escaped}</body>
      </html>
    `);
    printWindow.document.close();

    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    };
  }

  return (
    <div className="mb-6 flex justify-between items-center">

      {/* TITLE */}
      <div>
        <h1 className="text-2xl font-bold">Inventory Dashboard</h1>
        <p className="text-sm text-gray-500">
          Manage Inventory System
        </p>
      </div>

      {/* ACTIONS */}
      <div className="flex gap-2">

        <button
          onClick={handleExport}
          className="bg-green-600 text-white px-4 py-2 rounded"
        >
          Export CSV
        </button>

        <button
          onClick={handlePrint}
          className="bg-black text-white px-4 py-2 rounded"
        >
          Print
        </button>

      </div>

    </div>
  );
}