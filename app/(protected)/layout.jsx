import Sidebar from "@/components/Sidebar";

export default function ProtectedLayout({ children }) {
  return (
    <div className="flex min-h-screen bg-zinc-900 text-white">
      <Sidebar />
      <main className="flex-1 p-6 overflow-auto">
        {children}
      </main>
    </div>
  );
}