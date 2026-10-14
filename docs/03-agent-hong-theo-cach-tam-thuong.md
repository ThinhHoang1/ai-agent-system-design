# 3. Agent hỏng theo cách tầm thường

LLM agent ít khi hỏng vì model kém. Nó hỏng vì dữ liệu bị mất hoặc méo ở **đường ống quanh model**, rồi
model cứ thế trả lời tự tin. Tám ca có thật, mỗi ca một bài học.

## 3.1 Mỗi ảnh khách gửi bị đính hai lần

- **Triệu chứng:** log ghi "khách gửi 1 ảnh" nhưng "vision: 2/2 ảnh sẵn sàng".
- **Gốc:** ghép `[urlĐãRehost, ...urlGốc.filter(u => u !== urlĐãRehost)]`; hai URL là hai chuỗi khác
  nhau nên filter không loại được gì.
- **Hậu quả:** gấp đôi token, ảnh full-size nằm lại transcript và gửi lại ở mọi lượt sau, đẩy hội thoại
  tới tràn context.
- **Bài học:** chống trùng theo **danh tính của nội dung** (id ảnh), không theo chuỗi URL.

## 3.2 Nén context nuốt mất ảnh, prompt lại cấm nói "chưa thấy"

- Tràn context thì runtime tóm tắt transcript thành chữ và **không đính lại ảnh**.
- Prompt lại khẳng định "em NHÌN ĐƯỢC ảnh" và cấm câu "em chưa nhìn rõ, anh gửi lại giúp em".
- **Kết quả:** model mù nhưng bị ép phải nói như đã thấy, nên bịa theo lịch sử và catalog. Khách gửi
  ảnh con mèo, bot trả lời "dạ đúng mẫu bồn cầu một khối".
- **Bài học:** guardrail không được cấm lối thoát trung thực. Lúc hỏng và lúc bình thường trông giống
  hệt nhau, nên phải có log phân biệt được ba trạng thái "có ảnh", "vision tắt", "tải ảnh lỗi".

## 3.3 Trả lời vào ảnh của shop thì không khớp sản phẩm

- Khách bấm "trả lời" vào ảnh shop gửi, hỏi "mẫu này bao nhiêu".
- Sau khi chuyển việc gửi sang hàng đợi, API trả về **id biên nhận của hàng đợi** thay cho id tin thật
  của nền tảng. Plugin vẫn dùng id đó làm khoá tra ảnh, nên không bao giờ khớp nữa.
- **Bài học:** đổi đồng bộ sang bất đồng bộ là đổi **ý nghĩa** của giá trị trả về. Lấy id thật từ echo
  của nền tảng, và bỏ qua mọi phản hồi có `queued: true`.

## 3.4 Model từ chối tham số, host nuốt lỗi

Một model chỉ nhận `temperature = 1`; gửi giá trị khác thì bị từ chối, host trả chuỗi rỗng, tính năng
báo "nhận diện 0 sản phẩm". Mock LLM trong unit test vẫn trả lời ngon lành.
**Bài học:** mock không trung thực là loại lỗi unit test không bao giờ bắt được. Cần ít nhất một test
gọi model thật.

## 3.5 "Context overflow" mà context còn trống

Agent chạy cả việc trong một lượt, đọc ảnh và poll log liên tục. Proxy LLM phía trước có giới hạn
**~1 MB mỗi request** và trả 413, runtime lại gọi lỗi đó là "context overflow".
**Bài học:** đọc mã lỗi thật ở tầng HTTP. Cách chữa: cho vision chạy trong request riêng và trả về báo
cáo bằng chữ; lọc log tiến độ (render in một dòng mỗi khung hình); giữ mỗi request < 0,9 MB.

## 3.6 Danh sách bị cắt nhưng khai là đủ

Ba chỗ độc lập cùng một hình dạng lỗi: lấy `.length` của mảng đã cắt để báo tổng.
UI hiện "30/50" trong khi thật ra có 203; danh sách việc trông như "đã hết việc".
**Luật:** `items` để **vẽ**, `count` để **đếm**. Tổng thật phải tính **trước** khi cắt.

## 3.7 Fallback im lặng che lỗi

Rehost ảnh lỗi 500 thì code giữ URL gốc mà không báo gì. Dashboard trông bình thường; chỉ có service
quay 500 liên tục, mỗi lần mất 2–6 giây. **Bài học:** fallback phải để lại dấu vết đo được (log có cấu
trúc, bộ đếm). Fallback không ai thấy là cách giấu sự cố.

## 3.8 Hai renderer cho cùng một thẻ thông báo

Thẻ "báo chủ shop" được vẽ ở hai nơi (kênh dùng emoji, plugin dùng nhãn chữ) và trôi lệch nhau bốn lần.
**Bài học:** một khái niệm, một chỗ vẽ. Có hai chỗ thì sớm muộn sẽ khác nhau.

## Điểm chung

Mỗi mảnh đều đúng khi đứng riêng, ghép lại thì sai. Unit test xanh là điều kiện **cần**, không phải
điều kiện **đủ**. Xem phần kiểm thử theo kích thước ở [07-lam-viec-ai-native.md](07-lam-viec-ai-native.md).
