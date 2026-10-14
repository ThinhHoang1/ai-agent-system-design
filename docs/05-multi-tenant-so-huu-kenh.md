# 5. Multi-tenant và quyền sở hữu kênh

Một shop (tenant) nối được nhiều kênh, ví dụ nhiều Fanpage, nhưng vận hành **một** agent và **một**
dashboard. Nhiều tenant chạy chung một service.

## 5.1 Ba bất biến

| Bất biến | Giữ bằng |
|---|---|
| Một kênh thuộc đúng một tenant | id kênh là **khoá chính** của bảng sổ kênh |
| Mọi câu trả lời mang id kênh của tin gốc | id kênh rỗng thì từ chối **trước** khi gọi mạng |
| Token của nền tảng chỉ nằm ở service | mã hoá AES-256-GCM trong DB; agent chỉ giữ api key của mình |

Bất biến phải được giữ bằng **cấu trúc dữ liệu** (khoá chính, unique), không bằng `if` rải rác trong code.

## 5.2 OAuth: `/me/accounts` trả về nhiều hơn bạn nghĩ

API liệt kê **mọi** kênh người dùng từng cấp quyền, không chỉ kênh họ vừa tick. Vì thế service không
được tự lấy kênh đang thuộc tenant khác. Mỗi kênh trả về được xét riêng:

| Kết quả | Khi nào | Xử lý |
|---|---|---|
| Nối mới | kênh chưa có chủ | ghi, tính vào trần |
| Làm mới | tenant này đang giữ | thay token, không tính vào trần |
| Tự chuyển | chủ cũ đã bị thu hồi hoặc mồ côi | chuyển về, tính vào trần |
| Thuộc nơi khác | tenant khác đang giữ | **không ghi**; tạo link CLAIM dùng một lần, hết hạn 15 phút |
| Chạm trần | đã đủ số kênh | không ghi |

## 5.3 Vòng đời và các bẫy

- **Gỡ cài đặt thất bại không được xoá dữ liệu khách.** Chỉ thu hồi key khi gỡ thành công; cài lại mà
  lỗi thì giữ nguyên key và dữ liệu.
- **Đánh dấu "bảo vệ dữ liệu tenant" để ở một cột riêng**, đừng để chung trường với heartbeat: tiến
  trình heartbeat ghi đè là mất cờ.
- **Kênh mồ côi** (key bị xoá): vẫn nhận và lưu tin nhưng không đẩy đi đâu; sau 30 ngày mới xoá hẳn.
  Ai nối lại cũng nhận được, vẫn phải qua trần.
- **Kênh "điếc"**: có trong sổ nhưng đăng ký webhook thất bại. Trên dashboard nó trông giống hệt "chưa
  có khách nhắn". Cần một reconciler tự thử lại (giãn cách 2ⁿ, dừng sau 8 lần) và một trạng thái hiển
  thị riêng.
- **Trần đếm không khoá** thì hai request song song có thể vượt trần. Muốn chặt thì khoá theo tenant
  (`select ... for update`) hoặc đặt ràng buộc ở DB.

## 5.4 Danh tính cho từng agent runtime

Mỗi agent runtime cần chứng minh "tôi là ai" khi gọi các service khác mà không cần chia sẻ một secret
chung. Cách làm: nền tảng phát **JWT ký số** (subject là domain của runtime) và công bố **JWKS**; service
nhận tự kiểm chữ ký bằng public key, xoay khoá không phải phát lại secret cho từng nơi.
