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


## Mới: S GitHub, Kho file, S Claude

- **S GitHub** (`/github.html`): liệt kê repo trên tài khoản (cần `githubToken` hoặc `gh auth login`; scope `repo`, thêm `delete_repo` nếu muốn xóa). Tab Repo (lọc, sắp xếp, phân trang, chuyển Public/Private, chi tiết, tải ZIP, lưu trữ, xóa), Tạo repo (cá nhân/tổ chức, README, .gitignore, giấy phép), Thống kê (biểu đồ). Chuyển sang Public và xóa đều bắt gõ lại tên để xác nhận.
- **Kho file** (`/files.html`): mọi file tải về nằm trong `~/TestHubWorkspace/downloads/<danh mục>` (backup VPS, báo cáo, mã nguồn, build, ...). Tạo/xóa danh mục, chuyển file, ghi chú, tìm kiếm, sắp xếp, phân trang, mở trong Finder, thống kê. Nguồn ngoài chỉ đọc (mặc định `~/SPrimeBuilds/_out`) cấu hình bằng `fileSources` trong config.json.
- **S Claude** (`/claude.html`): workflow agent (nhập JSON từ Flow Claude, xem sơ đồ, xuất spec Markdown, chạy bằng `claude -p`), dọn cache/log do Claude sinh ra (theo số ngày, không đụng cấu hình), danh mục tài liệu/agent/skill, plugin, MCP (token được che), artifacts, dự án.
- S Test Hub có tab Kết quả / Nhật ký / Lịch sử (phân trang, lọc) / Thống kê.

Cập nhật trên Mac: `cd ~/shub && git pull && ./start.command`. Test: `node newtest.js`.

## S Creator
Tạo content, ảnh, video từ concept theo bước: Concept → Ý tưởng → Kịch bản → Ảnh → Video → Lịch đăng. Claude cục bộ viết ý tưởng/kịch bản; giọng đọc dùng CIT Voice Studio (cổng 8001, tự quay về `say` của macOS nếu CIT tắt), ảnh dựng bằng Playwright (thẻ thương hiệu), tải lên hoặc server ảnh tương thích A1111; video ghép bằng ffmpeg (`brew install ffmpeg`). Lịch đăng đẩy bài nháp sang Socin qua khoá API, xem `docs/creator-socin.md`. Test: `node creatortest.js`.


## S Xpub (nạp USDT BEP20 cho S Prime CopyTrade Pay)

Tạo cụm 12/24 từ hoặc nhập cụm có sẵn, tính **xpub** (đường dẫn `m/44'/60'/0'/0`, 111 ký tự) và 3 địa chỉ nạp mẫu `#0–#2` để đối chiếu với Admin › Ví. Kết quả khớp tool `tools/gen-xpub` của repo `sprime-xauusd-server`. Nằm trong nhóm "Dựng & kiểm thử", có nút tắt ở bước "Dựng app" trang chủ.

An toàn: mọi phép tính chạy **trong trang web trên máy bạn**, không có route nào ở server nhận cụm từ; trang đặt CSP `connect-src 'none'` nên trình duyệt chặn mọi kết nối ra ngoài, không ghi file, không dùng localStorage; đóng hoặc tải lại trang là mất sạch. Không dùng thư viện ngoài (BIP39 danh sách từ, BIP32, secp256k1, Keccak, RIPEMD-160 tự cài). Từ chối xprv/khoá riêng. Không dán cụm từ vào chat hay CI. Test: `node xpubtest.js`.
