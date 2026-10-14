# AI Agent System Design: sổ tay học lại

Ghi chép cá nhân về cách thiết kế, vận hành và đo đạc một **AI sales agent đa kênh** (Messenger,
Zalo, web chat) cho shop nhỏ, kèm một **bản code mẫu viết lại từ đầu** để tự chạy và phá thử.

> Repo này **không chứa code, dữ liệu, tên miền, khoá hay số liệu kinh doanh của bất kỳ công ty nào**.
> Tài liệu là bài học được viết lại bằng lời của mình. Code trong `sample/` là bản tối giản tự viết
> mới, chỉ để minh hoạ các pattern.

## Học theo thứ tự này

| # | Bài | Học được gì |
|---|---|---|
| 1 | [Kiến trúc 3 replica](docs/01-kien-truc-3-replica.md) | Stateless pod, nhận trước trả lời sau, hàng đợi giữ thứ tự, idempotency, lease |
| 2 | [Code mẫu chạy được](sample/README.md) | Tự dựng 3 replica, bắn tải, giết replica, kiểm 0 mất / 0 đảo thứ tự |
| 3 | [Điều tra sự cố "bot im lặng"](docs/04-dieu-tra-su-co-bot-im-lang.md) | Đọc triệu chứng đúng: 502 khác 504, `{}` là manh mối, đo trước khi sửa |
| 4 | [Agent hỏng theo cách tầm thường](docs/03-agent-hong-theo-cach-tam-thuong.md) | 8 lỗi production có thật của LLM agent và cách chặn |
| 5 | [Tìm sản phẩm bằng ảnh](docs/02-tim-kiem-bang-anh.md) | dHash → SigLIP → vision-LLM, benchmark, margin, khi nào hỏi lại |
| 6 | [Multi-tenant và quyền sở hữu kênh](docs/05-multi-tenant-so-huu-kenh.md) | Bất biến, chuyển chủ, trần, mồ côi, gỡ cài đặt không mất dữ liệu |
| 7 | [Product: kích hoạt và đo lường](docs/06-product-kich-hoat-va-do-luong.md) | Đọc phễu từ DB trước khi gắn tracking, time-to-value |
| 8 | [Làm việc AI-native](docs/07-lam-viec-ai-native.md) | Đội agent, hook làm cổng chất lượng, skill E2E, audit fan-out |
| 9 | [Tự kiểm và câu hỏi phỏng vấn](docs/08-tu-kiem-va-phong-van.md) | 25 câu hỏi kèm đáp án ngắn |

## Chạy code mẫu trong 2 phút

```bash
cd sample
docker compose -p chatrelay up -d --build
docker compose -p chatrelay --profile tools run --rm tools npm run burst
# lấy RUN_ID in ra ở trên, đợi vài giây:
docker compose -p chatrelay --profile tools run --rm -e RUN_ID=<runId> tools npm run verify
```

Kết quả đo thật trên máy mình (40 hội thoại × 10 tin, 91 tin bị gửi trùng cố ý):

```json
{ "inboundStored": 400, "deliveredToTenant": 400, "missing": 0, "outOfOrderPairs": 0,
  "outbound": { "failed": 12, "sent": 388 }, "repliesSentTwiceToProvider": 0 }
```

Giết một replica giữa lúc bắn 1.200 tin: vẫn 1.200/1.200, 0 mất, 0 đảo thứ tự. Chi tiết và các bài
thực hành phá hệ thống nằm trong [sample/README.md](sample/README.md).
