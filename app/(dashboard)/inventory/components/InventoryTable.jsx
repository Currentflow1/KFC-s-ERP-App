export default function InventoryTable({ items, loading, onSelect }) {
  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="bg-white border rounded-lg overflow-x-auto">

      <table className="w-full text-sm min-w-[900px]">

        <thead className="bg-gray-100">
          <tr>
            <th className="p-3 text-left">Name</th>
            <th className="p-3 text-left">Beginning</th>
            <th className="p-3 text-left">In</th>
            <th className="p-3 text-left">Out</th>
            <th className="p-3 text-left">Current</th>
            <th className="p-3 text-left">Actual</th>
            <th className="p-3 text-left">Loss</th>
            <th className="p-3 text-left">Action</th>
          </tr>
        </thead>

        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan="8" className="p-4 text-gray-500">
                No data found
              </td>
            </tr>
          ) : (
            items.map((i) => (
              <tr key={i.id} className="border-t hover:bg-gray-50">

                <td className="p-3 font-medium">{i.name}</td>

                <td className="p-3">{i.beg_bal}</td>
                <td className="p-3 text-green-600">{i.incoming_bal}</td>
                <td className="p-3 text-red-600">{i.outgoing_bal}</td>

                <td className="p-3">{i.current_bal}</td>
                <td className="p-3">{i.actual_bal}</td>
                <td className="p-3 text-orange-600">{i.loss}</td>

                <td className="p-3">
                  <button
                    onClick={() => onSelect(i)}
                    className="bg-blue-600 text-white px-3 py-1 rounded"
                  >
                    Manipulate
                  </button>
                </td>

              </tr>
            ))
          )}
        </tbody>

      </table>
    </div>
  );
}