# S Creator ↔ Socin

S Creator đẩy bài **nháp** sang Socin (app.socin.org) qua khoá API riêng.

1. Socin → Nội dung & Đăng bài → **Khoá S Creator** → Tạo khoá (hiện một lần).
2. S Hub → S Creator → Kết nối: nhập địa chỉ Socin (https) và dán khoá.

## API (Bearer `spcr_…`)
- `GET  {base}/api/integration/creator/accounts` → `{accounts:[{id,platform,display_name,status}]}` (TikTok, Threads của chủ khoá)
- `POST {base}/api/integration/creator/posts` body `{platform,account_id,title,caption,run_at,external_ref,video_name,video_mime,video_size}` → `201 {id,status:"draft"}`; gửi lại cùng `external_ref` → `200 {duplicate:true}`.

## Giới hạn
- Bài luôn là nháp: vào Socin gửi duyệt/duyệt như bài tay.
- Video **không** gửi lên Socin; TikTok chỉ lưu tên/loại/dung lượng, video tải thẳng lên TikTok từ trình duyệt.
- Mã phía Socin: PR samuelmastercheef/social#213 (cần merge và deploy).
