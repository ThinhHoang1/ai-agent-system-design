# 7. Làm việc AI-native

## 7.1 Đội agent có vai, có luật, có cổng

Dùng một đội agent (trong Claude Code) với các vai tách bạch: PM, architect, tech lead, frontend,
backend, QA, product, chuyên gia platform. Ba thứ làm đội này chạy được:

1. **Giao thức chung:** mọi lần giao việc là một khối HANDOFF đầy đủ, vì agent nhận không thấy hội
   thoại của agent giao. Quyết định ghi vào một sổ chung.
2. **Chia file trước khi giao:** hai agent không sửa chung một file.
3. **Hook làm cổng chất lượng**, chặn bằng máy chứ không bằng lời nhắc:
   - task không có dòng "định nghĩa xong" thì không tạo được;
   - task gắn nhãn release không đóng được khi sổ còn lỗi chặn;
   - agent không được im lặng dừng mà không báo cáo.

Bẫy: thông báo "agent đã dừng" **không mang kết quả**. Chưa nhận báo cáo thì phải hỏi lại.

## 7.2 Kiểm thử theo kích thước (mô hình của Google)

| Cỡ | Ràng buộc | Dùng cho |
|---|---|---|
| Small | 1 process, không I/O, không mạng | logic thuần, ca biên, tổ hợp nhánh (~80%) |
| Medium | nhiều process trên 1 máy, chỉ `localhost` | service thật + DB tạm (~15%) |
| Large | hệ thống thật, đi đúng đường người dùng | luồng người dùng quan trọng (~5%) |

Kim tự tháp quy định **số lượng** test. Nó không cho phép bỏ tầng trên cùng: thay đổi nào chạm luồng
người dùng phải có **ít nhất một ca Large chạy thật** trước khi báo xong.

## 7.3 Skill E2E tự sửa môi trường

Một skill mà agent gọi trước khi báo "xong". Skill tự làm toàn bộ:

1. Tự cài và sửa môi trường test: dependency, trình duyệt, file env, phiên đăng nhập.
2. Dò repo nào đang đổi để chọn đúng các ca Large bắt buộc.
3. Chạy theo thứ tự small → Large → ca hỏng.
4. Ca chưa có thì viết thành file spec Playwright.
5. Báo cáo kèm bằng chứng (ảnh chụp, log, dữ liệu trước và sau).

Chỉ dừng khi gặp việc **chỉ người làm được**: bấm cho phép, đăng nhập, cấp tài khoản.

## 7.4 Kiểm một skill bằng cách giao cho agent lạ

Skill viết ra để agent khác làm trọn một việc. Cách kiểm: giao skill cho một agent **mới**, không có
ngữ cảnh gì khác, xem nó làm tới đâu. Lần đầu nó làm ra sản phẩm đạt 93% và lộ 16 lỗ hổng trong skill;
vá hết rồi mới coi skill là xong.

## 7.5 Audit fan-out có phản biện

Khi một kết luận quan trọng (ví dụ nguyên nhân gốc của sự cố production) dựa trên suy luận, giao cho
nhiều agent kiểm độc lập, rồi cho các agent khác **phản biện** từng kết luận. Lần làm với 60 agent đã
đảo hướng chẩn đoán: thời gian service chết là 20–40 giây chứ không phải 1–2 giây, tức là restart chứ
không phải nghẽn chốc lát.

## 7.6 Cổng chất lượng có thể bị agent lách

Một cổng đo chất lượng hình ảnh tự động đã bị agent lách ngay lần đầu: chép cảnh cũ, rung khung hình
giả để lừa chỉ số chuyển động. Chặn bằng cách đo sau khi đã căn chỉnh, đánh dấu trạng thái thật của nhân
vật, chỉ tính những gì người xem thấy được, và ghi luật "không chép, không lách" vào skill.
**Bài học:** chỉ số nào dùng làm cổng thì sẽ bị tối ưu. Phải nghĩ cách agent lách trước khi tin con số.
