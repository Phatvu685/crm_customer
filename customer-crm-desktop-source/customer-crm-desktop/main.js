// ============================================================================
// main.js — tiến trình chính (main process) của Electron.
// Việc này làm 2 chuyện:
//   1. Mở 1 server HTTP cục bộ (chỉ trên máy, không lộ ra mạng ngoài) để phục vụ
//      các file tĩnh đã export từ Next.js (thư mục "app/" — copy từ "out/" của
//      dự án Next.js lúc build). Dùng http://localhost thay vì file:// để tránh
//      các lỗi về CORS/relative-path mà trình duyệt áp dụng nghiêm ngặt hơn với file://.
//   2. Mở 1 cửa sổ (BrowserWindow) trỏ tới server đó — chính là giao diện app.
//
// Giao diện gọi ra backend THẬT (NestJS + PostgreSQL) qua Internet bình thường
// bằng fetch() — địa chỉ backend đọc từ window.__API_BASE__ hoặc do người dùng
// tự đổi qua nút "⚙️ Đổi địa chỉ máy chủ" (lưu trong localStorage của Electron).
// ============================================================================

const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Cổng cục bộ để phục vụ file tĩnh — chọn 1 số ít khả năng trùng với app khác trên máy.
const LOCAL_PORT = 17381;

// Bảng tra loại file (MIME type) theo phần mở rộng — trình duyệt cần header
// Content-Type đúng thì mới chạy được .js/.css, hiển thị đúng ảnh...
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Thư mục chứa file tĩnh đã export — trong bản đóng gói (.exe), thư mục "app/"
// nằm cùng cấp với main.js bên trong resources/app.asar (Electron tự lo phần này).
const STATIC_ROOT = path.join(__dirname, 'app');

function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';

      let filePath = path.join(STATIC_ROOT, urlPath);

      // Chặn truy cập ra ngoài thư mục tĩnh (path traversal an toàn cơ bản)
      if (!filePath.startsWith(STATIC_ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
          // Next.js static export dùng route "/" duy nhất (SPA) -> mọi đường dẫn
          // không khớp file thật đều trả về index.html để app tự xử lý điều hướng.
          filePath = path.join(STATIC_ROOT, 'index.html');
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      });
    });

    server.listen(LOCAL_PORT, '127.0.0.1', () => resolve(server));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Quản Lý Khách Hàng — Vị Nguyên Food',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false, // KHÔNG cho trang web truy cập Node.js API — an toàn hơn
    },
  });

  win.loadURL(`http://127.0.0.1:${LOCAL_PORT}/`);

  // Bỏ menu mặc định (File/Edit/View/...) cho gọn, giữ trải nghiệm giống ứng dụng thật
  Menu.setApplicationMenu(null);
}

app.whenReady().then(async () => {
  await startLocalServer();
  createWindow();

  app.on('activate', () => {
    // macOS: bấm icon dock khi đã tắt hết cửa sổ thì mở lại
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
