# S Hub · Socin Studio

Mở S Hub là vào **Socin Studio**: trò chuyện với trợ lý **Socin AI** để vận hành cả hệ sinh thái Socin (mở app, kiểm thử repo, triển khai VPS, Zoom worker, S Remote, S Draw, Socin trên web, plugin MCP). Trang **Ứng dụng** (`/apps.html`) vẫn là S Hub như cũ để mở từng công cụ: S Build Hub, S Test Hub, S VPS và các app khác (S Chat, S VPN, S Clean, Terminal Socin).

## Socin Studio
- **Giao diện như Chat thiết kế của S Draw:** danh sách cuộc trò chuyện (tìm, ghim, đổi tên, xoá), gõ `/` chọn lệnh, nút **Lệnh** xem mọi lệnh theo nhóm, khối lệnh bấm để xem tham số và kết quả, thẻ **xin phép** cho lệnh thay đổi lớn (triển khai VPS, sao lưu, tạo bài nháp Socin, lệnh MCP phá huỷ), ô **Quyền** (Chỉ xem / Xem và thao tác / Đầy đủ), đính kèm ảnh. App mở từ chat hiện ở **khung bên** cạnh cuộc trò chuyện.
- **Dự án (ngữ cảnh kiểu Claude):** mỗi dự án có hướng dẫn cho trợ lý và tài liệu (dán chữ hoặc chọn file .txt/.md); cuộc trò chuyện trong dự án luôn gửi kèm ngữ cảnh đó. Nút **Ngữ cảnh** trên đầu chat cho xem đúng những gì trợ lý nhận.
- **Model** (nút dưới khung chat): *Tự động* (AI Socin khi có mạng, mất mạng thì model trên máy), *chỉ AI Socin*, *chỉ trên máy*. AI Socin dùng nhà cung cấp admin đã cài ở Socin → Cài đặt → AI (Claude, Gemini, OpenAI), khoá nằm trong admin Socin, không dùng `.env`. Model trên máy: Ollama, mặc định **Qwen3.5 4B** (tải ~3,4 GB, ~6 GB RAM); lần đầu bấm **Cài Ollama** (Homebrew, không có thì mở trang tải) rồi **Đồng ý tải**. Dùng chung Ollama với S Draw nên model không tải hai lần. Không có model nào thì vẫn có bộ hiểu lệnh ("mở S VPS", "bật zoom worker", `/vps_servers`...).
- **Đăng nhập tài khoản Socin hoặc offline:** đăng nhập bằng địa chỉ + khoá S Creator (dùng chung với S Creator, Zoom worker, S Remote) để có AI Socin, lệnh Socin (tài khoản MXH, bài nháp, máy từ xa) và kho plugin mới nhất. Không đăng nhập vẫn dùng được với model trên máy.
- **Plugin & kết nối:** kho plugin Socin (S Draw, Blender, Figma, GitHub, Playwright, Context7, Thư mục, Bộ nhớ, Đọc trang web...; khi offline dùng bản có sẵn), dịch vụ Store Socin, máy chủ MCP đã kết nối (bật/tắt/thử/gỡ, thêm máy chủ HTTP hoặc stdio). S Draw có sẵn: S Hub tự dò cổng MCP của S Draw khi S Draw bật "Cho AI kết nối". Mã khoá máy chủ MCP lưu trên máy (mode 600), không trả về trình duyệt.
- **Cổng MCP của S Hub** (mặc định tắt): cho Claude Desktop, Cursor, Claude Code, Windsurf, VS Code gọi vào các ứng dụng Socin. HTTP `http://127.0.0.1:<cổng>/mcp` + `Authorization: Bearer`, hoặc stdio qua `mcp-stdio.js` (nút **Thêm vào Claude Desktop**, file cấu hình không chứa mã khoá). Ba mức quyền; lệnh ví (S Xpub, gom tiền) không bao giờ có trong sổ lệnh.
- Dữ liệu ở `<workspace>/socin-studio/` (cuộc trò chuyện, dự án, cấu hình model, máy chủ MCP, cổng MCP). Mã: `socinai.js` (sổ lệnh, model, cổng MCP), `mcpclient.js`, `mcp-stdio.js`, `public/aicore.js` (lõi dùng chung), `public/chat.*`. Phía Socin: PR repo social (`POST /api/integration/creator/ai/agent`, `/plugins`, `/me`). Test: `node socinaitest.js`.

## Socin Code (lập trình kiểu Claude Code)

Mở ở thanh trái Socin Studio → **Socin Code** (`/code.html`). Chọn một thư mục dự án (hoặc clone repo GitHub), rồi giao việc bằng lời: agent đọc mã, tìm, sửa file, chạy lệnh terminal, dùng git, ghi kế hoạch.

- Lệnh của agent: `list_files`, `read_file`, `search`, `edit_file`, `write_file`, `run_command`, `git_status`, `git_diff`, `git_log`, `git_commit`, `todo_write` (`socincode.js`).
- Ba chế độ: **Kế hoạch** (chỉ đọc, đề xuất), **Hỏi trước** (mặc định: sửa file và chạy lệnh đều hiện diff/lệnh để duyệt), **Tự sửa file** (tự sửa, chạy lệnh vẫn hỏi). Lệnh chỉ đọc (`git status`, `ls`, `cat`...) tự chạy. Server kiểm tra quyền lần nữa, không tin trình duyệt.
- Mỗi lần sửa có diff và nút **Hoàn tác**; bảng bên: Thay đổi (git diff), Kế hoạch, File, Ngữ cảnh.
- An toàn: không ra ngoài thư mục dự án (kể cả qua symlink), không ghi vào `.git`, không đọc `.env`/khoá gửi cho AI, API chỉ nhận JSON từ trang local.
- Ghi nhớ dự án: tự đọc `SOCIN.md` (hoặc `AGENTS.md`, `CLAUDE.md`); `/init` để agent tạo. Lệnh nhanh: `/explain`, `/review`, `/test`, `/commit`, `/clear`, `/diff`; `@file` chèn file; `!lệnh` chạy lệnh không cần model.
- Model: dùng chung nút Model của Studio (AI Socin hoặc Ollama trên máy, lời nhắc riêng cho lập trình). Dữ liệu ở `<workspace>/socin-studio/code*.json`, bản lưu hoàn tác ở `code-snaps/`.
- Test: `node codetest.js`.

## Chạy
1. Cần Node 18+ và git.
2. `cp config.example.json config.json`, điền `githubToken` (hoặc chạy `gh auth login`).
3. Bấm `start.command` (Mac) hoặc `start-windows.cmd` (Windows), mở http://127.0.0.1:4777

## Giao diện
- Menu chính chỉ có **Tổng quan** và các **danh mục**; bấm vào danh mục mới hiện bảng công cụ thuộc nhóm đó (tên, mô tả, trạng thái, nút Mở). Đang ở trong công cụ thì có đường dẫn `Tổng quan › Danh mục` và nút quay lại.
  - 🚀 Dựng & kiểm thử: S Test Hub, S Build Hub
  - 🖥 Máy chủ & thiết bị: S VPS, S Remote, S Zoom worker
  - 🧠 Mã nguồn & AI: S GitHub, S Claude, Kho file
  - 🎮 Game & 3D: S Game
  - 🎬 Nội dung: S Creator
  - 💰 Ví & thanh toán: S Xpub, Gom tiền BEP20
  - 💻 Ứng dụng trên Mac: các app `type: "launch"` (S Chat, S VPN, S Clean, Terminal Socin)
  - 📦 Khác: công cụ tự thêm trong config.json chưa thuộc nhóm nào (chỉ hiện khi có)
  Sửa nhóm ở mảng `CATS` đầu phần script của `public/index.html`.
- Ô **Tìm công cụ** (phím `/` hoặc ⌘K) tìm theo tên, mô tả, danh mục, gõ không dấu cũng được. Mục **Dùng gần đây** nhớ 4 công cụ mở gần nhất (lưu trong trình duyệt).
- Tổng quan gồm 3 phần:
  - **Lối tắt nhanh**: mọi tính năng xếp theo danh mục, bấm là vào thẳng (ví dụ "Kiểm thử repo", "Điều khiển Windows", "Tạo xpub").
  - **Kết nối & cấu hình chung**: đăng nhập **Socin** ngay tại đây (địa chỉ + khoá S Creator, tạo ở Socin → menu Khoá S Creator), dùng chung cho S Creator, S Zoom worker, S Remote; trạng thái GitHub; công cụ cần có trên máy (Node, git, gh, Playwright, ffmpeg, Claude) và thư mục làm việc; dịch vụ nền (Zoom worker, Build Hub, số server VPS).
  - **Tổng quan**: số lần kiểm thử, lỗi, server VPS, tài khoản MXH trên Socin, kiểm thử gần đây.
- S Build Hub: tự dò app đang chạy trên máy theo tiêu đề trang "Build Hub" và nhúng vào đây. Chưa chạy thì S Hub tự khởi động: nó tìm chỗ cài theo thứ tự thư mục đã chọn trên giao diện → `buildHubDir` trong config.json → các chỗ hay đặt (`~/SPrimeBuilds/build-hub`, `~/sprime-build-hub`, `~/sbuildapp`…) → `S Build Hub.app` trong Applications. Không tìm thấy thì màn S Build Hub có ô để dán thư mục (hoặc file `.app`), S Hub nhớ cho lần sau. Nhật ký khởi động ở `<workspace>/buildhub.log`. Vẫn có thể tự điền `url` và `startCommand` trong config.json. Test: `node buildhubtest.js`.
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


## S Xpub (nạp USDT BEP20/TRC20 cho S Prime CopyTrade Pay)

Tạo cụm 12/24 từ hoặc nhập cụm có sẵn, tính **xpub** và địa chỉ nạp. Nằm trong nhóm "Dựng & kiểm thử", có nút tắt ở bước "Dựng app" trang chủ.

- **Mạng**: BEP20/ERC20 (EVM, `m/44'/60'/0'/0`, khớp tool `tools/gen-xpub` của repo `sprime-xauusd-server`) hoặc TRC20 (Tron, `m/44'/195'/0'/0`, địa chỉ `T…`).
- **Passphrase** (từ thứ 13/25) tuỳ chọn; có cảnh báo vì xpub sẽ khác hẳn.
- **Địa chỉ thứ i**: chọn vị trí bắt đầu và số lượng (1–1000), đối chiếu một địa chỉ bất kỳ đang thấy trên Admin.
- **Tra từ xpub**: dán xpub (không cần cụm từ) để xem địa chỉ nạp thứ i, EVM hoặc Tron.
- **QR, in, xuất file**: QR cho xpub và từng địa chỉ (tự cài, không thư viện), in giấy (tuỳ chọn in kèm cụm từ để sao lưu, passphrase không bao giờ in), tải CSV/TXT chỉ chứa xpub và địa chỉ.

An toàn: mọi phép tính chạy **trong trang web trên máy bạn**, không có route nào ở server nhận cụm từ; trang đặt CSP `connect-src 'none'` nên trình duyệt chặn mọi kết nối ra ngoài, không dùng localStorage; đóng hoặc tải lại trang là mất sạch. Không dùng thư viện ngoài (BIP39, BIP32, secp256k1, Keccak, RIPEMD-160, QR tự cài). Từ chối xprv/khoá riêng. Không dán cụm từ vào chat hay CI.

### Gom tiền BEP20 (`/sweep.html`, trang riêng, cần mạng)

Gom USDT BEP20 từ các địa chỉ nạp về ví chính. Tách hẳn khỏi trang offline: CSP chỉ cho kết nối tới 3 RPC BNB Smart Chain (`bsc-dataseed.bnbchain.org`, `bsc-dataseed1.binance.org`, `bsc-rpc.publicnode.com`).

1. **Quét** chỉ cần xpub: đọc số dư USDT và BNB, lập kế hoạch (địa chỉ nào gom, địa chỉ nào cần nạp gas, ví phí cần bao nhiêu BNB).
2. **Ký**: nhập cụm từ ví nạp (phải khớp xpub đã quét, không khớp là dừng) và ví phí (khoá riêng hoặc cụm từ, chỉ cần khi có địa chỉ thiếu gas).
3. **Gửi**: phải tích xác nhận và gõ `GOM`. Nạp gas từ ví phí, chờ xác nhận, rồi chuyển toàn bộ USDT của từng địa chỉ về ví chính, chờ từng giao dịch xác nhận. Có nút dừng. Khoá bị xoá khỏi trang sau khi gửi.

Ký giao dịch tự cài (EIP-155 legacy, RFC 6979, low-s), đã đối chiếu byte-by-byte với ethers v6. Thứ duy nhất rời máy là địa chỉ ví và giao dịch đã ký. Chưa hỗ trợ gom TRC20.

Test: `node xpubtest.js` (cần `playwright` cho phần giao diện; cài thêm `jsqr` để kiểm tra giải mã QR).

## S Zoom worker (Zoom giữ phòng của Socin)
Chạy `zoom-worker` của Socin ngay trên máy này, không cần `.env`. Nằm trong nhóm "Máy chủ".

1. **Liên kết theo tài khoản Socin (khuyên dùng):** nếu S Creator đã kết nối Socin bằng khoá S Creator của **admin hệ thống**, mỗi lần bật worker S Hub tự hỏi Socin (`POST /api/integration/creator/zoom-worker`, cần Socin 0.154.0+) để lấy khoá worker hiện tại. Khoá này chỉ nằm trong bộ nhớ, không ghi xuống đĩa. Nếu admin tạo khoá worker mới, worker bị từ chối (401) và S Hub tự lấy lại khoá rồi khởi động lại (tối đa 1 lần mỗi 5 phút).
2. **Dự phòng:** dán khoá worker (Socin → Cài đặt → 🎥 Zoom → Tạo khoá worker). Khoá lưu ở `~/TestHubWorkspace/zoom/settings.json` (mode 600) và không bao giờ trả về trình duyệt.
3. **Cài / cập nhật worker:** S Hub tải riêng thư mục `zoom-worker/` của repo `social` (sparse clone; repo private dùng `githubToken` hoặc `gh auth login`, token đi qua biến môi trường của git, không nằm trong URL), chạy `npm install` và tải Chromium (hoặc điền đường dẫn Chrome có sẵn).
4. **Bật / Tắt / Khởi động lại**, trạng thái (đang chờ phiên, đang giữ phòng, lỗi kết nối kèm cách sửa) và nhật ký trực tiếp (khoá luôn bị che). Tự bật lại khi worker dừng bất ngờ (tối đa 5 lần / 10 phút); tuỳ chọn tự bật khi mở S Hub. Tắt S Hub thì worker cũng tắt.

Mỗi bot là một Chrome riêng (~400–700 MB RAM). Chỉ dùng cho họp của chính tài khoản Zoom doanh nghiệp. Test: `node zoomtest.js` (repo, npm và Socin đều giả).

## S Remote (điều khiển máy Windows từ Mac này)
Nằm trong nhóm máy chủ, cạnh S Zoom worker. Dùng chung kết nối Socin của **S Creator** (khoá của admin hoặc chủ doanh nghiệp), cần Socin 0.161.0 trở lên.
- Danh sách máy Windows giống menu **Điều khiển từ xa** trong admin Socin, kèm trạng thái. Bấm **Kết nối** là mở RustDesk vào thẳng máy (qua Tailscale hoặc ID RustDesk).
- **Thêm máy Windows** → nhận **bộ cài một chạm** (file `.cmd`, lưu sẵn vào Kho file `downloads/remote/`). Chép sang máy Windows, bấm đúp, bấm Yes, đặt mật khẩu trong cửa sổ là xong.
- Mục **Mac này**: kiểm tra và cài RustDesk, Tailscale bằng Homebrew.
- Mật khẩu RustDesk không đi qua S Hub hay Socin. Test: `node remotetest.js`.

## S Game (công cụ làm game, nhân vật 3D, video 3D chibi vinyl)

Mở S Hub là tự kiểm tra máy (Mac hoặc Windows) có đủ công cụ theo dự án game cổ tích chưa: cửa sổ dòng lệnh in số công cụ thiếu, thẻ **Máy này** ở Tổng quan hiện "Công cụ làm game: Thiếu N". Vào **Game & 3D → S Game** để xem từng mục và bấm cài.

| Nhóm | Công cụ | Mac | Windows |
|---|---|---|---|
| Nền tảng | Homebrew / winget, git, Python 3.11, uv | brew | winget |
| Làm game | Godot 4; tuỳ chọn: export templates, JDK 17, Android SDK, Xcode | `--cask godot` | `GodotEngine.GodotEngine` |
| Nhân vật 3D | Blender, Draw Things (Mac) / ComfyUI (Windows, cài tay), thư viện Python 3D (trimesh, pyrender, faster-whisper), AI dựng 3D Hunyuan3D-2mini + TripoSR | `--cask blender`, `--cask draw-things` | `BlenderFoundation.Blender` |
| Video | ffmpeg, CIT Voice Studio (cài tay, kiểm tra cổng 8001) | `ffmpeg` | `Gyan.FFmpeg` |

- **Cài tất cả còn thiếu** bỏ qua mục *tuỳ chọn* (xuất bản Android, iOS) và mục nặng (AI dựng 3D ~5 GB, Android SDK): các mục đó bấm cài riêng. Công cụ cần trước (uv, git) được tự cài trước.
- Môi trường Python cài vào `~/SGame/py` và `~/SGame/ai3d` (đổi bằng `"sgame": { "dir": "..." }` trong config.json). Nếu `~/Downloads/ClaudeCode/thu-3d` đã có môi trường thì dùng luôn; Godot portable ở `~/Downloads/ClaudeCode/cong-cu/Godot.app` cũng được nhận (đổi bằng `"sgame": { "apps": ["..."] }`).
- Homebrew cần cài tay một lần (S Game hiện lệnh để chép). Trên Windows, winget có sẵn trong Windows 10/11 (App Installer).
- Thêm công cụ: thêm một mục vào danh sách trong hàm `tools()` của `sgame.js`. Test: `node sgametest.js` (brew, winget, uv đều giả).

### Đất cổ tích (trong S Game)

Kho tài nguyên của dự án game cổ tích, gom dưới một giao diện: **Game & 3D → Đất cổ tích** (hoặc nút "Đất cổ tích" ở đầu trang S Game).
S Hub đọc thẳng thư mục dự án trên máy (mặc định `~/Downloads/ClaudeCode`, đổi bằng `"sgame": { "cotichDir": "..." }`), không chép, không sửa file. Bấm **Quét lại** sau khi có file mới.

- **Tổng quan**: % tiến độ 12 tướng, số thẻ, game, lịch đăng YouTube, video, file mới cập nhật.
- **Tiến độ**: bảng từng tướng × 6 bước (Ảnh 2D, Bộ thẻ, Mô hình 3D, Gắn xương, Vào game Godot, Video giới thiệu), tính từ file có thật; ghi chú lấy từ `thu-3d/tien-do*.md`.
- **Nhân vật**: thẻ 12 tướng; bấm vào xem mô hình 3D xoay được, hoạt cảnh (đứng, đi, chạy, đánh, xoay 360°), bộ thẻ, hệ, vai, nội tại và 3 chiêu (đọc từ `hero_data.gd` của Trăm Trứng).
- **Game & giao diện**: Trăm Trứng Phiêu Lưu, Gióng: Giữ Làng, bộ hình Trăm Trứng; nút Chơi thử / Mở trong Godot (chạy file `.command` có sẵn), README, hình giao diện app.
- **Kênh & content**: kênh @datcotich (bộ nhận diện, mô tả, danh sách phát, lịch đăng từ `lich-dang.csv` kèm trạng thái), các tập Làng cổ tích, bối cảnh, video giới thiệu, caption.
- **Video**: mọi video đã xuất (bỏ bản nháp, bản cũ `.vN`), lọc theo loại. **Tài liệu**: mọi file `.md`.

Thêm tướng hay game mới: sửa mảng `HEROES`, `STEPS`, `GAMES` đầu `cotich.js`. Test: `node cotichtest.js`.
