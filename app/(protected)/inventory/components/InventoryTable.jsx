"use client";

// Two warehouses → consistent blue/green assignment, black text for readability.
// Hash-based so the same warehouse name always gets the same color.
function warehouseStyle(name) {
  if (!name) return null;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 2 === 0
    ? "bg-blue-100 text-black border border-blue-200"
    : "bg-green-100 text-black border border-green-200";
}

export default function InventoryTable({ items, loading, onSelect, isFinalized, warehouseFilter }) {
  if (loading) {
    return (
      <div className="px-4 py-8 text-sm text-gray-400 text-center animate-pulse">
        Loading inventory…
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="px-4 py-10 text-sm text-gray-400 text-center">
        {warehouseFilter && warehouseFilter.length > 0
          ? "No items match the selected warehouse filter."
          : "No inventory items found."}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Warehouse</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Beg</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Incoming</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Outgoing</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Current</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Actual</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">Loss</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => {
            const isDiscontinued = item._discontinued;
            const isLocked = isFinalized || isDiscontinued;

            return (
              <tr
                key={item.id}
                onClick={() => onSelect(item)}
                className={[
                  "transition-all duration-200 relative",
                  isDiscontinued
                    ? "opacity-50 bg-gray-50 cursor-not-allowed"
                    : isLocked
                      ? "cursor-not-allowed hover:bg-gray-50"
                      : "cursor-pointer hover:bg-blue-50 hover:shadow-[inset_3px_0_0_0_#3b82f6] hover:-translate-y-px",
                ].join(" ")}
                title={
                  isDiscontinued
                    ? "Discontinued — re-activate this product in the Products page to edit it"
                    : isFinalized
                      ? "Today is finalized — undo the finalize to make changes"
                      : "Click to adjust this item"
                }
              >
                {/* Name + discontinued badge */}
                <td className="px-4 py-3 font-medium text-gray-900">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className={isDiscontinued ? "line-through text-gray-400" : ""}>
                      {item.name}
                    </span>
                    {isDiscontinued && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full leading-none">
                        <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                        Discontinued
                      </span>
                    )}
                  </span>
                </td>

                {/* Warehouse */}
                <td className="px-4 py-3">
                  {item.warehouse ? (
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${warehouseStyle(item.warehouse)}`}
                    >
                      {item.warehouse}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>

                {/* Numeric columns */}
                <td className="px-4 py-3 text-right text-gray-500">{item.beg_bal}</td>
                <td className="px-4 py-3 text-right font-semibold text-green-600">
                  {item.incoming_bal > 0 ? `+${item.incoming_bal}` : item.incoming_bal}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-red-500">
                  {item.outgoing_bal > 0 ? `-${item.outgoing_bal}` : item.outgoing_bal}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                    item.current_bal === 0
                      ? "bg-red-100 text-red-700"
                      : item.current_bal < 100
                        ? "bg-amber-100 text-amber-700"
                        : "bg-gray-100 text-gray-700"
                  }`}>
                    {item.current_bal}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-gray-600">{item.actual_bal}</td>
                <td className="px-4 py-3 text-right font-semibold text-red-500">
                  {item.loss > 0 ? item.loss : <span className="text-gray-300 font-normal">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}