# 8. Tự kiểm và câu hỏi phỏng vấn

Che đáp án, tự trả lời trước.

## Kiến trúc

1. **Replica xử lý hàng `in.q.7` chết giữa chừng thì sao?**
   Tin chưa ack nên quay lại hàng. Broker chuyển consumer sang replica khác. Phía nhận chống trùng bằng
   id tin; cổng `seq` chưa được cập nhật nên tin vẫn được giao.
2. **Sao không dùng một hàng duy nhất?** Toàn hệ thống sẽ đi tuần tự; một tenant chậm kéo chậm tất cả.
3. **Scale lên 10 replica phải sửa gì?** Không sửa code. Trần song song là số hàng (32 mỗi chiều).
4. **Vì sao không nack-requeue khi giao lỗi?** Tin quay lại sau tin mới hơn, cổng `seq` bỏ nó, tức là mất tin.
5. **Webhook đã ghi DB nhưng crash trước khi lên hàng thì sao?** `published_at` vẫn null. Lần nền tảng
   gửi lại, insert bị trùng nhưng thấy chưa publish thì publish lại.
6. **Idempotency cho tin gửi ra làm thế nào?** `clientMsgId` sinh một lần ở phía gọi, dùng lại qua mọi
   lần thử; DB có unique `(tenant, clientMsgId)`; trùng thì trả 200 "deduped".
7. **Khi nào retry, khi nào không?** 5xx và lỗi mạng: retry có backoff. 4xx: hỏng vĩnh viễn, ghi
   `failed`. Riêng 429 nên tách ra để retry.
8. **Việc định kỳ chỉ một replica được chạy thì làm sao?** Lease có hạn trong DB (upsert với điều kiện
   "đã hết hạn hoặc mình đang giữ"), cộng khoá unique ở bảng kết quả làm lớp chặn thứ hai.
9. **Exactly-once có thật không?** Trong hệ phân tán thì không. Thực tế là at-least-once cộng xử lý
   idempotent ở mọi chặng.
10. **Muốn bỏ rủi ro "cổng `seq` chỉ bỏ, không sắp lại"?** Đệm các tin đến lệch thứ tự rồi phát lại
    theo `seq`, hoặc bảo đảm chỉ một nơi duy nhất cấp `seq` và publish theo đúng thứ tự đó.

## Agent và chất lượng AI

11. **Agent trả lời bịa về ảnh, bạn điều tra từ đâu?** Kiểm ảnh có thực sự tới model không (đếm số
    ảnh, cỡ ảnh, sau khi nén context còn không), rồi xem prompt có cấm lối thoát trung thực không.
12. **Tại sao margin quan trọng hơn ngưỡng điểm?** Catalog có ảnh dùng chung cho nhiều mã; cosine cao
    chưa chắc là đúng mã. Margin giữa hạng 1 và hạng 2 mới đo được độ chắc.
13. **Lúc nào agent nên hỏi lại khách?** Khi ở mức GẦN: hỏi đúng thuộc tính khác nhau giữa các ứng
    viên, không hỏi chung chung.
14. **Eval cho agent bán hàng gồm gì?** Thư viện kịch bản (khách hỏi giá, gửi ảnh lạ, khiếu nại, hỏi
    hàng không bán, gửi biên lai giả…), chạy self-play, chấm theo luật cứng (không bịa mã, không hứa sai).
15. **Guardrail nên nằm trong prompt hay trong code?** Luật quan trọng (không có trích dẫn thì 0 điểm,
    không xác nhận thanh toán khi chưa thấy biên lai) phải được cưỡng chế trong code; prompt chỉ hướng dẫn.

## Product

16. **Bạn quyết định ưu tiên bằng gì?** Phễu thật từ DB: cài → nối kênh → có hội thoại thật → có đơn.
    Sửa chỗ rơi nhiều nhất trước.
17. **Time-to-value là gì trong sản phẩm này?** Thời gian từ lúc cài tới câu trả lời đúng đầu tiên cho
    khách thật. Bảng mẫu theo ngành và chat thử rút ngắn nó.
18. **Một tính năng chạy trên staging nhưng chưa lên production, ghi CV thế nào?** Ghi đúng trạng thái
    hoặc không ghi.

## Vận hành

19. **502 và 504 khác nhau thế nào khi điều tra?** 504 thường là app treo hoặc chậm; 502 trả về nhanh
    là process không còn lắng nghe (restart, crash, OOM).
20. **Thông điệp lỗi rỗng `{}` gợi ý gì?** Body không phải JSON, thường là trang lỗi của proxy; code xử
    lý lỗi đã nuốt mất thông tin.
21. **Xử lý ảnh làm nghẽn server Node, làm sao?** Đo event-loop lag; đưa việc CPU sang `worker_threads`;
    giới hạn đồng thời; đặt deadline cho việc chạy song song.
22. **Vì sao ảnh phải nằm ở S3/CDN khi chạy nhiều replica?** Nền tảng chat tải ảnh từ URL; URL trỏ vào
    đĩa của một replica sẽ 404 khi request rơi vào replica khác.
23. **Migration khi 3 replica khởi động cùng lúc?** Chạy dưới advisory lock, hoặc tách thành một job
    migration riêng trước khi deploy.
24. **Kênh có trong sổ nhưng không nhận tin bao giờ?** Webhook chưa đăng ký được ("kênh điếc"). Cần
    reconciler tự thử lại và một trạng thái hiển thị riêng trên dashboard.
25. **Bạn sẽ làm gì khác nếu làm lại từ đầu?** Có outbox bền ở phía agent ngay từ đầu, tách 429 khỏi
    4xx, khoá trần theo tenant, và một API để agent đọc trạng thái thật của tin đã gửi.
