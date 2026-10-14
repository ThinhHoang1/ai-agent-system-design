# Code mẫu: chat relay 3 replica

Bản tối giản **viết mới hoàn toàn** để minh hoạ [kiến trúc 3 replica](../docs/01-kien-truc-3-replica.md).
Khoảng 500 dòng TypeScript: Hono + amqplib + pg, chạy bằng Docker.

| Service | Vai |
|---|---|
| `relay1`, `relay2`, `relay3` | cùng một image: nhận webhook, giao có thứ tự, nhận và gửi câu trả lời, lease |
| `rabbitmq` | 32 hàng vào + 32 hàng ra (quorum, single-active-consumer) + DLQ. UI: http://localhost:15673 (guest/guest) |
| `postgres` | tin vào, cổng thứ tự, tin ra, lease |
| `tenant` | agent giả của shop: thỉnh thoảng lỗi 503, thỉnh thoảng gửi trả lời hai lần |
| `provider` | Send API giả của nền tảng chat: thỉnh thoảng trả 5xx (tạm thời) hoặc 4xx (vĩnh viễn) |

## Đọc code theo thứ tự

1. [src/relay.ts](src/relay.ts): mục 1 inbound (ghi trước, trả 200 sau), mục 2 giao có thứ tự (cổng
   `seq`, retry tại chỗ), mục 3 outbound (idempotent, phân loại 4xx/5xx), mục 4 lease.
2. [src/mq.ts](src/mq.ts): hash hội thoại vào hàng, khai báo quorum queue, publish có confirm.
3. [src/db.ts](src/db.ts): schema, và migration dưới advisory lock.
4. [scripts/verify.ts](scripts/verify.ts): ba lời hứa được kiểm bằng SQL.

## Chạy

```bash
docker compose -p chatrelay up -d --build
docker compose -p chatrelay --profile tools run --rm tools npm run burst
docker compose -p chatrelay --profile tools run --rm -e RUN_ID=<runId> tools npm run verify
docker compose -p chatrelay down -v      # dọn sạch
```

## Kết quả đo thật

**Bình thường:** 40 hội thoại × 10 tin, 91 tin bị gửi trùng cố ý.

```json
{ "inboundStored": 400, "deliveredToTenant": 400, "missing": 0, "outOfOrderPairs": 0,
  "outbound": { "failed": 12, "sent": 388 }, "repliesSentTwiceToProvider": 0 }
```

**Giết `relay2` một giây sau khi bắt đầu bắn, 4 giây sau bật lại:** 60 hội thoại × 20 tin, 237 tin trùng,
662 lần webhook phải gửi lại vì trúng replica chết.

```json
{ "inboundStored": 1200, "deliveredToTenant": 1200, "missing": 0, "outOfOrderPairs": 0,
  "outbound": { "failed": 27, "sent": 1170 }, "repliesSentTwiceToProvider": 0 }
```

`failed` là các ca provider giả trả 4xx, hoặc 5xx kéo dài quá 5 lần thử: đúng như thiết kế.

**Phát hiện thật trong lần này:** 1.200 tin vào nhưng chỉ có 1.197 câu trả lời. Ba câu trả lời không bao
giờ tới relay, vì `tenant` chỉ thử 5 lần (khoảng 4,5 giây) trong lúc một replica đang chết. Đó là lý do hệ
thật cần **outbox bền ở phía agent**: giữ tin và thử lại tới vài phút. Bài tập 5 dưới đây.

## Bài tập: tự phá hệ thống

1. **Giết replica:** `docker compose -p chatrelay kill relay1` giữa lúc chạy `burst`, rồi `verify`. Mở UI
   RabbitMQ, tab Queues, xem consumer hoạt động của từng hàng chuyển sang replica khác.
2. **Agent hay chết:** `TENANT_FAIL_RATE=0.5 docker compose -p chatrelay up -d tenant`, chạy lại. Thứ tự
   có còn đúng không? Hàng bị chặn bao lâu?
3. **Phá thứ tự:** sửa `handleInbound` thành `ch.nack(msg, false, true)` thay vì retry tại chỗ, đặt
   `TENANT_FAIL_RATE=0.3`, rồi xem `missing` và log `gate drop`. Đây là bài học "đừng requeue".
4. **Phá idempotency:** bỏ `on conflict ... do nothing` ở `/messages`, đặt `TENANT_DUP_SEND_RATE=0.5`,
   rồi xem `repliesSentTwiceToProvider`.
5. **Thêm outbox cho tenant:** để `reply()` không bao giờ bỏ cuộc khi relay tạm chết (lưu Postgres, quét
   lại định kỳ, giữ nguyên `clientMsgId`). Chạy lại bài 1, mục tiêu 1.200/1.200 câu trả lời.
6. **Lease:** giết replica đang giữ lease (`docker compose -p chatrelay logs | grep lease`) và đo xem bao
   lâu thì replica khác nhận.
