import "./globals.css";

export const metadata = {
  title: "Quản Lý Khách Hàng — Đại lý Gạo",
  description: "Quản Lý Khách Hàng — Vị Nguyên Food",
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
