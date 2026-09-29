export const navGroups = [
  {
    label: "Overview",
    links: [
      { label: "Dashboard", href: "/dashboard", symbol: "📊", description: "Jump to any section" },
      { label: "Summary",   href: "/summary",   symbol: "📈", description: "Live stock, alerts, and variance by item" },
    ],
  },
  {
    label: "Operations",
    links: [
      { label: "Records",      href: "/records",      symbol: "🎥", description: "Finalized history and monthly summaries" },
      { label: "Inventory",    href: "/inventory",    symbol: "📋", description: "Current stock and daily counts" },
      { label: "Orders",       href: "/orders",       symbol: "🛒", description: "Place and track orders" },
      { label: "Transactions", href: "/transactions", symbol: "🔄", description: "Full audit trail of stock movements" },
    ],
  },
  {
    label: "Master Data",
    links: [
      { label: "Categories", href: "/categories", symbol: "🗂️", description: "Organize product categories" },
      { label: "Suppliers",  href: "/suppliers",  symbol: "🤝", description: "Manage your suppliers" },
      { label: "Products",   href: "/products",   symbol: "📦", description: "Raw, finished, and packaging items" },
      { label: "Employees",  href: "/employees",  symbol: "👨🏻‍💼", description: "Monitoring, representatives, and staff" },
    ],
  },
];