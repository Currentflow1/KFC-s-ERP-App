import "./globals.css";

export const metadata = {
  title: "KFC's ERP System",
  description: "ERP inventory app",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}