# S Hub · Socin

Một giao diện tổng cho các tool: S Build Hub, S Test Hub, S VPS và các app khác (S Chat, S VPN, S Clean, Terminal Socin).

## Chạy
1. Cần Node 18+ và git.
2. `cp config.example.json config.json`, điền `githubToken` (hoặc chạy `gh auth login`).
3. Bấm `start.command`, mở http://127.0.0.1:4777

## Giao diện
- Tổng quan: thẻ trạng thái từng tool (chấm xanh = đang chạy), kiểm tra gần đây.
- S Build Hub: tự dò app đang chạy trên máy theo tiêu đề trang "Build Hub" và nhúng vào đây. Nếu không dò được, điền `url` và `startCommand` trong config.json.
- S Test Hub: tích hợp sẵn (lint, build, test, bảo mật, giao diện).
- App khác: bấm là mở app trên máy bằng lệnh `command` trong config.json (sửa tên app cho đúng).

Test giao diện đầy đủ cần: `npm i playwright && npx playwright install chromium`.
Chỉ nghe ở 127.0.0.1. Kết quả lưu ở ~/TestHubWorkspace/reports/.

## S VPS (quản lý VPS)
- Thêm server (IP, user, đường dẫn SSH key). Máy này phải ssh được vào VPS bằng key.
- Thêm dự án: repo GitHub, nhánh, thư mục, cách chạy (PM2 / Docker Compose / systemd).
- Repo private: bấm "Deploy key", thêm khóa vào GitHub (Settings → Deploy keys, chỉ đọc).
- "Cài lần đầu / Cập nhật ngay": VPS tự clone/pull, cài thư viện, build, khởi động lại. Build lỗi thì mã tự về bản cũ.
- "Bật tự cập nhật": cài cron trên VPS, kiểm tra commit mới mỗi N phút, chạy được cả khi Mac tắt.
- Dọn rác tự động: cron hằng ngày + kiểm tra mỗi giờ (ổ >=85% dọn khẩn). Không xóa Docker volume.
- Có thể gửi kết quả qua Telegram (điền bot token + chat ID khi sửa server).
- Tự kiểm tra: `node vpstest.js` (dùng VPS giả cục bộ).

### Backup, Docker, Hệ thống (S VPS)
- **Backup:** chọn thư mục (trống = thư mục các dự án), loại trừ, dump MySQL/PostgreSQL/lệnh tùy chỉnh, Docker volume.
  Lưu trên VPS ở ~/.shub/backups (nén, checksum, tự kiểm tra đọc được). Giữ phiên bản: N bản gần nhất + 1 bản/tuần + 1 bản/tháng, bản ghim không bị xóa.
  Có: xem nội dung, kiểm tra toàn vẹn, tải về Mac (kiểm tra checksum), giải nén thử, khôi phục đè (tự backup an toàn trước), ghim, xóa.
  Backup tự động bằng cron trên VPS; tuỳ chọn tự đồng bộ bản mới về Mac mỗi 30 phút khi S Hub đang mở. Mỗi bản ghi lại commit của từng dự án.
- **Docker:** container (gom theo compose project), restart/dừng/chạy/xóa/log/chi tiết, CPU-RAM, compose cập nhật image + chạy lại, image, volume, dọn an toàn (không xóa volume).
- **Tiến trình & hệ thống:** PM2 (restart/dừng/chạy/log), dịch vụ systemd lỗi, cổng đang mở, phân tích dung lượng ổ đĩa, cron.

## Giao diện & brand
Brand Socin: teal `#0B7F8F`, vàng `#FFB020`, nền tối `#06111C`, font Be Vietnam Pro, tự theo chế độ sáng/tối của máy.
Logo ở `public/brand/` (`icon.svg`, `logo.svg`, `icon-1024.png`). Màu và kiểu nút nằm trong `public/brand.css`.
Trang Tổng quan theo quy trình: Kiểm thử → Dựng app → Triển khai. Cổng bận thì S Hub tự thử cổng kế tiếp.
