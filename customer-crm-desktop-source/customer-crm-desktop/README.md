# Customer CRM Desktop (Electron)

Vỏ desktop cho app "Quản Lý Khách Hàng — Vị Nguyên Food". Chỉ hiển thị giao diện —
toàn bộ dữ liệu vẫn nằm ở backend NestJS + PostgreSQL (Neon) trên cloud, y hệt
bản web, chỉ khác là đóng gói thành 1 file .exe chạy trực tiếp trên Windows,
không cần mở trình duyệt hay cài Node.js.

## Cấu trúc
- `main.js` — tiến trình chính Electron: mở 1 server tĩnh cục bộ (chỉ trên máy)
  phục vụ file đã export từ Next.js, rồi mở cửa sổ trỏ vào đó.
- `app/` — bản export tĩnh của frontend Next.js (copy từ thư mục `out/` sau khi
  build) — **không có trong git, phải tự tạo lại** (xem bước 1 dưới).
- `package.json` — cấu hình `electron-builder` để đóng gói ra `.exe`.

## Cách build lại từ đầu

### Bước 1 — Export frontend Next.js thành file tĩnh
```bash
cd ../customer-crm-nextjs      # thư mục dự án Next.js
ELECTRON_BUILD=1 npm run build  # sinh ra thư mục out/
cp -r out ../customer-crm-desktop/app
```

### Bước 2 — Cài dependencies & build .exe
```bash
cd ../customer-crm-desktop
npm install
npm run build:win
```

File kết quả nằm trong `release/`.

## Lưu ý về định dạng đóng gói

`package.json` hiện đặt `"target": ["zip"]` — tạo ra 1 file zip chứa app đã
đóng gói sẵn (portable, giải nén ra chạy `Quan Ly Khach Hang.exe` là dùng được
ngay, không cần cài đặt). Đây là lựa chọn AN TOÀN, build được trên MỌI hệ điều
hành (Windows/Mac/Linux) mà không cần công cụ gì thêm.

Nếu muốn có **trình cài đặt (installer) thật** với icon Start Menu, gỡ cài đặt
được (`Setup.exe` kiểu chuyên nghiệp), đổi `"target": ["zip"]` thành
`"target": ["nsis"]` trong `package.json`, rồi build lại:
- **Trên Windows**: chạy thẳng `npm run build:win`, không cần cài gì thêm.
- **Trên Linux/Mac**: cần cài thêm `wine` (`sudo apt install wine wine32:i386
  xvfb` trên Ubuntu) — máy tạo ra bản zip này gặp lỗi ở bước wine nên phải
  dùng "zip" thay thế; trên máy Windows thật (hoặc CI/CD như GitHub Actions
  với runner Windows) bước "nsis" sẽ chạy trơn tru không cần chỉnh gì.

## Đổi địa chỉ backend sau khi đã đóng gói .exe

KHÔNG cần build lại app khi backend đổi domain (vd chuyển nhà cung cấp
hosting). Mở app, ở màn hình đăng nhập bấm "⚙️ Đổi địa chỉ máy chủ", nhập URL
mới (vd `https://api-cua-ban.onrender.com/api`) — lưu lại trong máy, dùng cho
các lần mở app sau.
