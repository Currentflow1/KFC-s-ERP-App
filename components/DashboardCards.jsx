import Link from "next/link";
import { navGroups } from "@/lib/navGroups";

// Each section gets its own accent color so the groups are easy to tell apart.
// (Full class names are written out so Tailwind can detect them.)
const GROUP_STYLES = {
  Overview: {
    tile: "bg-blue-50 border-blue-100",
    bar: "bg-blue-500",
    hover: "hover:border-blue-400",
    title: "group-hover:text-blue-700",
    arrow: "group-hover:text-blue-600",
  },
  Operations: {
    tile: "bg-green-50 border-green-100",
    bar: "bg-green-500",
    hover: "hover:border-green-400",
    title: "group-hover:text-green-700",
    arrow: "group-hover:text-green-600",
  },
  "Master Data": {
    tile: "bg-amber-50 border-amber-100",
    bar: "bg-amber-500",
    hover: "hover:border-amber-400",
    title: "group-hover:text-amber-700",
    arrow: "group-hover:text-amber-600",
  },
};

const DEFAULT_STYLE = {
  tile: "bg-gray-50 border-gray-100",
  bar: "bg-gray-400",
  hover: "hover:border-gray-400",
  title: "group-hover:text-gray-900",
  arrow: "group-hover:text-gray-700",
};

export default function DashboardCards() {
  // The dashboard doesn't need a card pointing to itself
  const groups = navGroups
    .map((g) => ({ ...g, links: g.links.filter((l) => l.href !== "/dashboard") }))
    .filter((g) => g.links.length > 0);

  return (
    <div className="space-y-10">
      {groups.map((group) => {
        const style = GROUP_STYLES[group.label] ?? DEFAULT_STYLE;

        return (
          <section key={group.label}>
            {/* Section header */}
            <div className="flex items-center gap-3 mb-4">
              <span className={`inline-block w-1.5 h-6 rounded-full ${style.bar}`} />
              <h2 className="text-base font-bold uppercase tracking-wider text-gray-800">
                {group.label}
              </h2>
              <span className="text-xs font-medium text-gray-500 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full">
                {group.links.length}
              </span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Cards */}
            <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
              {group.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`group relative flex flex-col justify-between min-h-[160px] bg-white border border-gray-200 rounded-xl shadow-sm p-6 transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 ${style.hover}`}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={`flex items-center justify-center w-14 h-14 rounded-xl border text-3xl leading-none ${style.tile}`}
                    >
                      {link.symbol}
                    </span>
                    <span
                      className={`text-xl text-gray-300 transition-all duration-150 group-hover:translate-x-1 ${style.arrow}`}
                      aria-hidden="true"
                    >
                      →
                    </span>
                  </div>

                  <div className="mt-5">
                    <p className={`text-lg font-bold text-gray-900 transition-colors ${style.title}`}>
                      {link.label}
                    </p>
                    <p className="text-sm text-gray-500 mt-1 leading-snug">
                      {link.description}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}