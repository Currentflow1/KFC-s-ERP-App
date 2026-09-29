import DashboardCards from "@/components/DashboardCards";

export default function DashboardPage() {
  return (
    <div className="px-6 py-5 bg-gray-50 min-h-screen">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Jump to any section</p>
      </div>
      <DashboardCards />
    </div>
  );
}