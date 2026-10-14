# 4. Điều tra sự cố "khách nhắn dồn dập thì bot im"

Một bài tập về **đọc triệu chứng đúng trước khi sửa**.

## 4.1 Triệu chứng

```
error  outbound TOTAL send failure (2/2 parts failed): ServiceSendError(502): {} | ServiceSendError(502): {}
error  AGENT SILENT-FAIL — dispatcher returned without delivering reply. Triggering fail-safe handoff.
```

Hệ thống tự kết luận "agent hỏng" và bật chế độ chuyển cho người. Chủ shop báo: lỗi xảy ra khi khách
nhắn dồn dập.

## 4.2 Đọc manh mối

**Chữ `{}` là chìa khoá.** Mọi route của service khi lỗi đều trả JSON `{ok:false, error:{...}}`. In ra
`{}` nghĩa là body **không parse được JSON**: client dùng `res.json().catch(() => ({}))`, nên một trang
lỗi HTML biến thành `{}`. Đoạn code đó đã tự xoá mất chẩn đoán.
→ 502 này do **reverse proxy** sinh ra, request chưa hề tới app.

**Agent không hỏng.** Agent đã sinh câu trả lời đúng; chỉ có đường ống chết. Cả hai kết luận tự động
("agent silent-fail" và "bật chuyển cho người") đều sai.

**502 khác 504.** Event loop nghẽn thì proxy hết thời gian chờ và trả **504**. 502 trả về nhanh, kèm
body HTML, nghĩa là kết nối bị từ chối, tức process không còn lắng nghe: restart, crash hoặc OOM.

**Khoảng 10 giây trong log khớp với nhánh retry thứ hai.** Đếm ngược lại thì service đã chết ít nhất
20–40 giây. Đó là dấu vết của restart hay deploy, không phải nghẽn chốc lát.

## 4.3 Đo, đừng đoán

Dựng bộ "burst lab" giả lập khách nhắn dồn dập và đo **event-loop lag**:

| Giả thuyết | Đo được | Kết luận |
|---|---|---|
| SQLite đồng bộ làm nghẽn | 0,04–0,1 ms mỗi sự kiện | vô tội |
| Xử lý ảnh (decode/encode) trên main thread | lag **3,3 s** | thủ phạm |
| Đưa xử lý ảnh sang `worker_threads` | lag **1,1 ms** | đã chữa |
| Khớp ảnh quét ứng viên tuần tự | **31,8 s** trên đường trả lời | chuyển sang song song + deadline: **2,8 s** |

## 4.4 Sửa những thứ đúng bất kể nguyên nhân nào

Burst có ít nhất 4 đường dẫn tới cùng triệu chứng: nghẽn event loop, unhandled rejection làm process
chết, OOM, nhiều lượt agent song song huỷ nhau. Log không đủ để chốt đường nào, nên sửa những thứ đúng
với **mọi** đường:

- lưới an toàn ở cấp process: chết thì phải để lại dòng log;
- idempotency cho gửi tin, để retry không thành gửi trùng;
- giới hạn đồng thời cho xử lý ảnh, và bịt rò bộ nhớ của cache ảnh;
- `keepAliveTimeout` của server lớn hơn của proxy (tái hiện được nguyên nhân 502);
- phân loại lỗi: lỗi đường truyền **không** được biến thành "agent im";
- outbox bền ở phía agent: tin không bốc hơi khi service tạm chết.

## 4.5 Bài học

1. Thông điệp lỗi rỗng thường là dấu hiệu code xử lý lỗi đã nuốt mất thông tin. Sửa chỗ đó trước.
2. Phân biệt lỗi đường truyền với lỗi agent. Gộp hai thứ làm một sẽ cho ra hành động sai (tắt bot oan).
3. Mã trạng thái kể chuyện: 502 khác 504, nhanh khác chậm.
4. Dựng lab tái hiện và đo trước khi sửa. Nghi phạm "hiển nhiên" (SQLite) hoá ra vô tội.
