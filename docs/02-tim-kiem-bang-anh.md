# 2. Tìm sản phẩm bằng ảnh khách gửi

Khách hay gửi ảnh kèm câu "shop có mẫu này không?". Ảnh hiếm khi trùng ảnh shop đăng: bị cắt, mờ, nén
qua app chat, hoặc tự chụp ở nhà. Khó nhất không phải là tìm, mà là **biết lúc nào mình chắc**:

- khẳng định sai một mã = giao sai hàng, đổi trả;
- không dám khẳng định khi đúng = mất đơn.

## 2.1 Ba tầng bằng chứng

| Tầng | Tín hiệu | Trả lời được câu | Chi phí |
|---|---|---|---|
| ① dHash | hash ảnh, khoảng cách Hamming ≤ 10 | "đúng tấm ảnh shop đã đăng" | gần như 0 |
| ② Embedding (SigLIP) | cosine ≥ ngưỡng **và** margin với hạng 2 ≥ ngưỡng | "cùng món, khác góc / cắt / mờ" | model ~100 MB, ~1 s/ảnh trên CPU |
| ③ Vision-LLM + từ vựng | LLM tả ảnh khách bằng **bộ từ của chính catalog shop**, đối chiếu tên + mô tả | "cùng loại hàng" | một lượt LLM |

Kết luận ra ba mức, mỗi mức có giới hạn cứng:

| Mức | Được làm | Không được làm |
|---|---|---|
| **CHẮC** | báo mã, báo giá, gửi ảnh | hỏi lại vô ích |
| **GẦN** | đưa 2–3 ứng viên, hỏi đúng thuộc tính đang khác nhau | khẳng định một mã |
| **KHÔNG** | nói rõ shop chưa có, gợi ý món gần nhất | bịa món, hứa đặt hàng |

Ở mức GẦN, tool trả kèm danh sách trường khác nhau giữa ứng viên #1 và #2, nên câu hỏi lại nhắm trúng:
*"Ba mẫu này khác nhau ở bề mặt: mờ, bóng hay nhám ạ?"* thay vì "anh cần mẫu nào".

## 2.2 Từ vựng sinh từ catalog, không viết cứng trong code

Mô tả tự do không khớp được: "trắng ngà bóng loáng" và "men tuyết nano" khớp 0% dù là một thứ. Cách làm:

1. Lấy mẫu ~60 sản phẩm, cho LLM đề xuất các thuộc tính phân biệt được sản phẩm.
2. Bỏ thuộc tính không phân biệt được (mọi sản phẩm cùng giá trị), bỏ từ trùng nghĩa thông dụng.
3. Lưu thành một file schema **cho từng shop**. Cả lúc lập chỉ mục lẫn lúc chat đều quy về cùng bộ từ.

Kiểm chứng "ngành nào cũng chạy": thay catalog thiết bị vệ sinh bằng catalog gạch ốp lát, schema tự
sinh lại thành sáu trường khác hẳn, không sửa dòng code nào.

## 2.3 Benchmark trước khi chọn model

- 864 truy vấn: ảnh trùng file, cắt 10%, cắt 30%, mờ, nén, và **ảnh không liên quan** (để đo nhận nhầm).
- Thước đo chính: **recall@P100**, tức tỉ lệ truy vấn được khẳng định mà **không sai câu nào**.

| Ảnh khách gửi | dHash | SigLIP | DINOv2 |
|---|---|---|---|
| trùng file | 99,0% | 99,0% | 99,0% |
| cắt 10% | 15,6% | **95,8%** | 94,8% |
| hỗn hợp (cắt + mờ + nén) | 11,5% | **96,9%** | 93,8% |
| recall@P100 | 35,1% | **53,3%** | 26,7% |

Ba bài học:

1. **SigLIP thắng DINOv2**, trái kỳ vọng từ paper. Luôn đo trên dữ liệu của mình trước khi đổi backbone.
2. **Ngưỡng điểm thôi là không đủ.** Chỉ dùng ngưỡng cosine thì recall@P100 = 8,3%; thêm điều kiện
   margin (hạng 1 phải bỏ xa hạng 2) thì lên 53,3%. Lý do: catalog thật dùng chung một ảnh cho nhiều
   mã, nên có truy vấn cosine ~1.0 mà hạng 1 lại là mã khác.
3. **dHash vẫn đáng giữ:** gần như miễn phí, và là bằng chứng nhị phân duy nhất cho trường hợp trùng file.

## 2.4 Không dùng vector DB (ở quy mô này)

1.272 ảnh × 768 số ≈ 3,9 MB, quét brute-force mất cỡ micro giây. Vector DB đáng dùng từ khoảng 10⁵ item.
Thêm hạ tầng khi chưa cần là thêm thứ để hỏng.

## 2.5 Khi chưa bật được tầng ②

Model embedding tốn thêm ~350 MB đĩa, ~500 MB RAM và ~1 s mỗi ảnh khi lập chỉ mục. Có thể ship trước
tầng ① + ③ và để ② sau một cờ bật/tắt; code, test và benchmark giữ nguyên, bật lại chỉ cần một biến
môi trường. **Lúc phỏng vấn nói đúng trạng thái**: "đã đo và sẵn sàng", khác với "đã chạy production".
