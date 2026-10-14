# 6. Product: kích hoạt và đo lường

## 6.1 Đọc phễu từ database trước khi gắn tracking

Câu hỏi "agent có thật sự được dùng không?" thường dẫn tới kế hoạch "gắn analytics một tuần". Thật ra
mọi sự kiện cốt lõi (tin vào, câu trả lời, gửi lỗi) **đã có vết trong DB** của service. Một câu SQL trả
lời trong 10 phút:

```
cài đặt → đã nối kênh → có tin nhắn thật đi về
```

Điều phễu cho thấy: phần lớn tenant **dừng trước cuộc hội thoại thật đầu tiên**. Vấn đề là kích hoạt,
không phải thiếu tính năng.

Cùng câu SQL trên bảng tin ra còn cho thấy một tỉ lệ gửi lỗi đáng kể, phần lớn do **ảnh**: nền tảng
không tải được ảnh từ URL mình đưa. Thứ tự ưu tiên tự hiện ra: sửa đường ảnh trước, rồi đo lại bằng
đúng câu SQL đó. Không cần analytics.

**Bài học:** dữ liệu vận hành thường đã đủ để trả lời câu hỏi sản phẩm. Analytics để theo dõi lâu dài,
không phải để bắt đầu.

## 6.2 Thiết kế lại onboarding quanh time-to-value

Luồng mới đưa chủ shop tới "à, nó dùng được" nhanh nhất:

```
nối kênh  →  bảng sản phẩm mẫu theo ngành  →  chat thử với agent  →  đưa vào hoạt động
```

- **Bảng mẫu theo ngành:** chưa cần nhập catalog thật đã thấy agent tư vấn ra sao.
- **Chat thử:** dùng chính agent thật trong một phiên sandbox; mọi tác dụng phụ (sổ đơn, báo chủ) phải
  rẽ nhánh theo "đây là phiên thử".
- **Nút điều hướng:** test đủ vòng khứ hồi ≥ 2 lượt. Lỗi hay gặp: đi tới thì được, quay lại thì một
  modal không mở nữa vì cờ trạng thái chưa được reset.

## 6.3 Mỗi agent một vai

Định vị "công ty số" đơn giản hơn với chủ shop so với "AI agent": họ **tuyển nhân viên** (bán hàng,
quản lý fanpage, chăm sóc khách, SEO), giao việc qua chat và duyệt kết quả. Nhân viên nối vào kênh shop
đang dùng và vào app sẵn có (Gmail, Sheets, CRM…) qua một lớp connector chung (OAuth + MCP). Nhờ vậy
thêm vai mới không phải viết tích hợp mới cho từng agent.

## 6.4 Nói đúng trạng thái

Trong CV hay khi phỏng vấn, phân biệt rõ: **đã chạy production**, **đã ở staging**, **đã đo nhưng tắt
mặc định**. Bị hỏi vặn mà lộ là mất uy tín nhanh hơn mọi điểm cộng.
