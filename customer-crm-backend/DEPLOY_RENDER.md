# Deploy to Render (quick steps)

1. Commit and push the `customer-crm-backend` folder to a GitHub repository (branch `main` recommended).

2. On render.com: Create -> Web Service -> Connect your GitHub repo -> Select `customer-crm-backend` and branch `main`.

3. Choose "Docker" as the environment (Render will use `Dockerfile`).

4. Set required Environment Variables in Render (Settings -> Environment):
   - `DATABASE_URL` (Postgres or other DB)
   - `JWT_SECRET` (your JWT secret)
   - any other app-specific vars used by your app

5. Start the service. Render will build the Docker image and deploy it. The service URL will be provided.

Local test (build and run locally):

```
docker build -t crm-backend .
docker run -p 3000:3000 -e DATABASE_URL="postgres://..." crm-backend
```

---

## 1) Push code lên GitHub (lệnh sẵn để copy)

Mở terminal ở thư mục `customer-crm-backend` rồi chạy các lệnh dưới (PowerShell/Windows):

```bash
git init
git add .
git commit -m "Add Docker + Render config"
git branch -M main
git remote add origin https://github.com/your-username/your-repo.git
git push -u origin main
```

Thay `https://github.com/your-username/your-repo.git` bằng repo GitHub của bạn.

Nếu repo đã có Git và remote, chỉ cần:

```bash
git add .
git commit -m "Prepare for Render: Dockerfile + render.yaml"
git push
```

## 2) Từng bước trên Render (UI)

1. Đăng nhập vào https://render.com.
2. Click `New` → `Web Service`.
3. Chọn GitHub, kết nối tài khoản nếu chưa kết nối.
4. Chọn repository của bạn và branch `main`.
5. Environment: chọn `Docker` (Render sẽ dùng `Dockerfile` trong thư mục root của repo hoặc theo `render.yaml`).
6. Build Command / Start Command: để trống khi dùng Docker (image tự chạy theo `CMD` trong Dockerfile).
7. Settings → Environment → Add Environment Variables:
    - `DATABASE_URL` = giá trị kết nối Postgres
    - `JWT_SECRET` = bí mật JWT
    - `CORS_ORIGIN` = ví dụ `https://your-frontend.com`
    - (Tùy chọn) `PORT` nếu bạn muốn dùng port khác
8. Click `Create Web Service` → Render sẽ bắt đầu build. Chờ hoàn thành và nhận URL công khai.

## 3) Kiểm tra logs & xử lý lỗi phổ biến

- Vào Dashboard → Service → Logs để xem cả build logs và runtime logs.
- Lỗi thường gặp:
   - `PrismaClientInitializationError`: chưa set `DATABASE_URL` đúng hoặc DB chưa reachable.
   - Build fail do thiếu dependency: kiểm tra `package.json` và `npm ci` logs.
   - Port conflict: đảm bảo app lắng nghe `process.env.PORT` hoặc dùng giá trị mặc định 3001.

## 4) Chạy và debug local bằng VS Code Docker extension

- Build image từ GUI: Docker panel → Images → Build Image (chọn folder chứa Dockerfile).
- Run container: Images → chọn image → Run (detached) → thêm `--env-file .env` và port mapping `3001:3001`.
- Xem logs trong Docker panel hoặc terminal.

---

File liên quan: [customer-crm-backend/Dockerfile](customer-crm-backend/Dockerfile), [customer-crm-backend/.env.example](customer-crm-backend/.env.example), [customer-crm-backend/render.yaml](customer-crm-backend/render.yaml)
