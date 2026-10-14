# 1. Kiến trúc relay tin nhắn chạy 3 replica

Bài toán: một service đứng giữa **nền tảng chat** (Messenger, Zalo, web) và **agent của từng shop**.
Nó nhận tin khách, chuyển tới đúng agent, nhận câu trả lời và gửi ngược lại đúng khách. Có hàng trăm
shop (tenant), mỗi shop có nhiều kênh.

## 1.1 Vì sao 1 replica không đủ

Bản đầu chạy **một process**, mọi thứ nằm trong đó: SQLite trên đĩa, bus sự kiện trong RAM đẩy xuống
agent qua SSE, ảnh lưu trên đĩa.

| Vấn đề | Hậu quả người dùng thấy |
|---|---|
| Restart hay deploy là chết 20–40 giây | Agent gửi trả lời gặp 502, khách nhắn mà bot im |
| Không thêm process được | Mỗi process giữ một mảnh dữ liệu riêng |
| Ảnh nằm trên đĩa một máy | Nền tảng chat tải ảnh trúng máy khác, 404, "upload attachment failure" |

**Mục tiêu:** process nào chết bất cứ lúc nào cũng không mất tin, tin của một khách luôn đúng thứ tự,
thêm hay bớt replica không phải sửa code.

## 1.2 Năm nguyên tắc

1. **Process không giữ trạng thái.** Trạng thái chung ở Postgres, file ở object storage (S3) phát qua
   CDN. Trong RAM chỉ được để thứ mất cũng không sao: cache, bộ đếm, số liệu.
2. **Nhận trước, trả lời sau.** Webhook ghi DB và đẩy lên hàng đợi xong (broker đã xác nhận) mới trả
   200. Nền tảng chat chỉ gửi lại khi không nhận được 200.
3. **Nhận trùng thì được, xử lý trùng thì không.** Hệ thống có retry thì chắc chắn sẽ có trùng
   (at-least-once). Mỗi chặng có một khoá chống trùng: id tin của nền tảng, `clientMsgId` của câu
   trả lời, `seq` của hội thoại.
4. **Giữ thứ tự bằng hàng đợi, không bằng khoá.** Hash theo hội thoại vào N hàng cố định; mỗi hàng chỉ
   có **một consumer hoạt động** (single-active-consumer).
5. **Việc chỉ được chạy ở một nơi thì dùng lease.** Ví dụ vòng quét định kỳ: một dòng trong bảng
   `leases` có hạn dùng; ai giữ thì chạy, hết hạn thì replica khác lấy.

## 1.3 Sơ đồ

```
Nền tảng chat ──webhook──▶ [ relay1 | relay2 | relay3 ]     (cùng image, ai cũng nhận)
                              │ ① kiểm HMAC trên raw body
                              │ ② INSERT inbound (unique tenant + id tin)
                              │ ③ publish lên hàng, CHỜ broker confirm
                              │ ④ đánh dấu published_at, rồi mới trả 200
                              ▼
               in.q.0 … in.q.31      hàng = hash("tenant:hội thoại") % 32
                              │ single-active-consumer: 1 replica xử lý, 2 replica chờ sẵn
                              ▼
               cổng thứ tự (bảng order_gate): seq ≤ mốc đã giao → bỏ
                              ▼
               đẩy xuống agent của shop (ký HMAC, timeout, retry tại chỗ, quá hạn → DLQ)
                              ▼ agent trả lời
   POST /messages (clientMsgId) ─▶ replica nào cũng nhận
                              │ INSERT outbound (unique tenant + clientMsgId)
                              │   trùng → 200 "deduped" · mới → publish → 202
                              ▼
               out.q.0 … out.q.31 ─▶ worker gửi Send API
                              │ 2xx: sent · 4xx: failed ngay · 5xx/mạng: thử lại có backoff
```

## 1.4 Các câu "tại sao"

**Vì sao 32 hàng cố định mà không phải mỗi hội thoại một hàng?** Số hội thoại không có giới hạn, số
hàng thì phải có. Hash theo `tenant:hội thoại` giữ tin của một khách luôn ở cùng một hàng, nên đúng thứ
tự; 32 hàng cho 32 luồng song song.

**Vì sao single-active-consumer?** Để có thứ tự mà không phải tự viết bầu leader. Broker tự chọn một
consumer cho mỗi hàng; consumer đó chết thì consumer khác nhận thay ngay (đã thử trong `sample/`).

**Vì sao đã có hàng đợi mà vẫn cần cổng `seq`?** Nền tảng chat có thể gửi lại tin cũ, hoặc một tin
được publish lại sau khi crash. Cổng `seq` chặn tin "lùi thời gian". Nhưng nó chỉ **bỏ**, không sắp
lại; nên mọi chỗ khác phải giữ được thứ tự, và **không được nack-requeue** (xem dưới).

**Vì sao retry tại chỗ thay vì nack để broker giao lại?** Tin bị requeue có thể quay lại **sau** tin
mới hơn. Khi đó cổng `seq` thấy nó cũ và bỏ đi: tin mất mà không ai hay. Giữ tin lại và thử tại chỗ thì
đúng thứ tự, đổi lại hàng đó bị chặn trong lúc agent của shop đang chết.

**Vì sao cập nhật cổng `seq` SAU khi giao thành công?** Crash giữa "giao xong" và "ghi cổng" thì tin
được giao lại; phía agent chống trùng bằng id tin. Làm ngược lại (ghi cổng trước) thì crash là mất tin.

**Vì sao ghi DB trước rồi mới trả 200?** Trả 200 trước mà process chết thì tin mất vĩnh viễn. Ghi trước
thì tệ nhất là nhận trùng, mà trùng đã có khoá unique chặn. Có thêm cột `published_at`: tin đã ghi DB
nhưng chưa lên hàng (crash giữa hai bước) sẽ được publish lại ở lần nền tảng gửi lại.

**Vì sao 4xx thì không retry?** 4xx là nền tảng từ chối hẳn (token chết, ngoài cửa sổ 24 giờ…), thử lại
chỉ làm tắc hàng. Đánh đổi: lỗi giới hạn tần suất cũng là 4xx; muốn đúng hơn thì tách riêng 429.

**Vì sao migration phải chạy dưới advisory lock?** 3 replica khởi động cùng lúc, `create table if not
exists` chạy song song vẫn có thể đụng nhau trong catalog của Postgres.

**Vì sao vòng quét cần lease?** 3 replica cùng quét thì làm việc 3 lần, tốn gấp 3 hạn mức API, và có
thể trả lời một bình luận 3 lần. Lease cho một replica chạy; lớp chặn thứ hai là khoá unique ở bảng kết
quả (`on conflict do nothing`).

**Đổi SQLite sang Postgres mà không viết lại logic thế nào?** Đặt một "dialect seam": code nghiệp vụ
gọi một interface, bên dưới có bản Postgres và bản SQLite, cả hai cùng chạy một bộ **parity test**.

## 1.5 Chung và riêng

| Chung (Postgres / S3) | Riêng từng replica (RAM, mất cũng không sao) |
|---|---|
| sổ kênh của từng tenant, api key, phiên OAuth, tin vào, cổng thứ tự, tin ra, lease, file ảnh | cache địa chỉ agent (cũ tối đa vài chục giây), bộ đếm, số liệu `/metrics` |

## 1.6 Đánh đổi còn mở

1. Agent trả 200 lúc **xếp hàng**, chưa phải lúc xử lý xong; agent sập ngay sau đó là mất tin.
2. Hàng đẩy xuống agent đi tuần tự: một tin lỗi chặn cả hàng tới khi vào DLQ.
3. Trần số kênh mỗi tenant đếm không khoá: hai replica cùng nối kênh có thể vượt trần.
4. Tín hiệu "đang gõ" đi đường thẳng, không qua hàng, nên có thể tới sau câu trả lời.
5. Phía agent cũng cần **outbox**: trong `sample/`, tenant chỉ thử lại 5 lần nên khi một replica chết,
   3/1.200 câu trả lời không tới được relay. Hệ thật giữ tin chờ trong outbox tới 5 phút.

## 1.7 Đọc tiếp

- Code mẫu: [sample/src/relay.ts](../sample/src/relay.ts) có đủ 4 phần: inbound, giao có thứ tự,
  outbound, lease.
- Tự kiểm: [08-tu-kiem-va-phong-van.md](08-tu-kiem-va-phong-van.md).
