# VauS

![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-EE4D2D?style=flat-square&logo=googlechrome&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![ESM](https://img.shields.io/badge/Module-ES%20Modules-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-4B5563?style=flat-square)

Tiện ích mở rộng trình duyệt (Chrome Extension Manifest V3) kết hợp Bot nền Node.js chuyên dụng cho việc **tự động nhận diện và lưu mã giảm giá Shopee Việt Nam** trực tiếp vào [Ví Voucher Shopee](https://shopee.vn/user/voucher-wallet).

Dự án được thiết kế tinh gọn, tập trung hoàn toàn vào độ chính xác khi lưu mã, tốc độ phản hồi thực tế từ API Shopee và khả năng vận hành ổn định không gây làm phiền màn hình.

---

## Tính Năng Chính

### 1. Lưu Mã Hàng Loạt (Batch Voucher Saver)
- Dán trực tiếp danh sách mã hoặc nguyên đoạn văn bản chia sẻ mã từ Zalo, Telegram, Facebook.
- **Smart Parser** tự động lọc từ nhiễu, nhận diện chính xác mã voucher hợp lệ theo cấu trúc và độ dài (không phụ thuộc danh sách tiền tố cố định).
- Tùy chỉnh độ trễ gửi request an toàn (**1000ms – 5000ms** kèm jitter tự nhiên) giúp hạn chế quét bot.
- Phân loại phản hồi rõ ràng theo từng mã ngay trong bảng kết quả:
  - **Thành công**: Lưu mới vào ví (hiển thị kèm tên ưu đãi nếu có).
  - **Đã có trong ví**: Xác nhận tài khoản đã sở hữu mã.
  - **Thất bại**: Hiển thị đúng lý do tiếng Việt từ Shopee (hết lượt, chưa đến khung giờ, không hợp lệ, không đủ điều kiện...).
- Hỗ trợ lọc nhanh kết quả và xuất báo cáo **CSV (UTF-8)**.

### 2. Zalo Web Auto-Sniffer & Hàng Đợi Lưu Chậm (Bot Nền 24/7)
- **Chỉ bắt tin nhắn mới đến**: Khi bạn mở Zalo Web (`chat.zalo.me`) hoặc chuyển vào nhóm mục tiêu (mặc định `[23] LONGHOUSEE`), toàn bộ lịch sử tin nhắn cũ và tin nhắn khi cuộn ngược lên xem lại đều tự động bỏ qua.
- **Hàng đợi tuần tự lưu thật chậm (Slow Queue)**: Phù hợp với các nhóm săn voucher mật độ tin nhắn cực lớn — mọi mã bắt được đưa vào một danh sách chung và lưu **từng mã một** với nhịp nghỉ dài (mặc định **6s – 8.5s/mã**, tùy chỉnh đến 14.5s) để hạn chế tối đa quét bot.
- **Chỉ bắt mã mới hoặc mã đã reset**: Tự động ghi nhớ mã đã gặp để lọc bỏ tin spam trùng lặp; chỉ nạp lại vào hàng đợi khi sang khung giờ reset mới của Shopee (`0h, 9h, 12h, 15h, 18h, 21h`) hoặc có tín hiệu reset/mở lại rõ ràng.
- **Không đuổi theo link back voucher**: Bỏ qua các tin nhắn chỉ chứa link back voucher và chỉ tập trung xử lý mã voucher ký tự.
- **Chế độ Bot Daemon Node.js (`bot/bot.js`)**: Dùng chung lõi hàng đợi lưu chậm, chạy độc lập 24/7 bằng `puppeteer-core` và đồng bộ qua API nội bộ (`127.0.0.1:23232`).

### 3. Canh Mã Back Banner (Realtime API Watcher)
- Hỗ trợ 2 chế độ săn mã back tự động từ các trang chiến dịch Shopee (ví dụ `shopee.vn/m/goi-ShopeeVIP`):
  - **Dải Giờ Vàng (Smart Window)**: Bắt đầu rà soát trước giờ G và duy trì liên tục trong 15–60 phút.
  - **Canh Ngẫu Nhiên 24/7 (Continuous)**: Kiểm tra định kỳ trạng thái quota voucher và tự động lưu ngay khi phát hiện mã nhả lượt trở lại.
- Tích hợp biểu đồ đo độ trễ mạng (Ping Monitor) trực tiếp ngay trên giao diện.

### 4. Hẹn Giờ Săn Mã 0h (Precision Scheduler)
- Đồng bộ giờ chuẩn với máy chủ Shopee (**Shopee Server Time Sync**) đến từng mili-giây.
- Chọn nhanh các khung giờ săn sale phổ biến (`00:00`, `09:00`, `12:00`, `15:00`, `18:00`, `21:00`) hoặc tùy chỉnh thời điểm bất kỳ.
- Hỗ trợ bù độ trễ mạng (Lead time `0ms – 200ms`) để bắn request đúng thời điểm mở mã.

### 5. Trợ Lý Quét Trang & Truy Cập Nhanh Ví Voucher
- Tự động cuộn trang (Auto-scroll) để nạp toàn bộ voucher lazy-load và bấm lưu hàng loạt trên các trang sự kiện Shopee.
- Lối tắt mở trực tiếp [Ví Voucher Shopee](https://shopee.vn/user/voucher-wallet) từ thanh tiêu đề Dashboard và thanh chân Popup.
- Hỗ trợ **6 bảng màu giao diện** (TokyoNight, Catppuccin Mocha, Wonderland Noir, Big Wave Blue, Bauhaus Dark và Shopee Cam) đạt chuẩn tương phản cao, dễ quan sát trên cả nền tối lẫn nền sáng.

---

## Cài Đặt Extension Trên Trình Duyệt

Tương thích với **Google Chrome**, **Microsoft Edge**, **Brave** và **Cốc Cốc**.

1. Clone hoặc tải mã nguồn dự án về máy:
   ```bash
   git clone https://github.com/damchienthang/ShoppeVoucher.git
   cd ShoppeVoucher
   ```
2. Mở trang quản lý tiện ích của trình duyệt:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Cốc Cốc: `coccoc://extensions/`
3. Bật **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
4. Chọn **Tải tiện ích đã giải nén (Load unpacked)** và trỏ tới thư mục gốc `ShoppeVoucher`.
5. Đăng nhập tài khoản Shopee tại [shopee.vn](https://shopee.vn) và mở [Ví Voucher](https://shopee.vn/user/voucher-wallet) để kiểm tra mã sau khi lưu.

---

## Cài Đặt & Chạy Bot Zalo 24/7 (Tùy Chọn)

Nếu muốn tự động bắt mã ngay cả khi không mở trình duyệt thường xuyên:

1. Cài đặt dependencies (yêu cầu Node.js >= 18):
   ```bash
   npm install
   ```
2. Tạo tệp cấu hình riêng từ mẫu có sẵn:
   ```bash
   cp bot/bot_config.example.json bot/bot_config.json
   ```
   > Lưu ý: Tệp `bot/bot_config.json` và thư mục phiên `bot/bot_data/` đã được khai báo trong `.gitignore` để tránh lộ cookie tài khoản khi push lên Git.
3. Khởi chạy Bot:
   ```bash
   npm run bot
   ```
   Hoặc chạy nhanh trên Windows bằng `start_bot.bat` (hoặc `bot/start_bot.bat`).

---

## Lệnh Phát Triển & Kiểm Thử

| Lệnh | Chức năng |
| :--- | :--- |
| `npm run dev` | Khởi chạy máy chủ xem trước giao diện Dashboard & Popup tại `http://localhost:3000` |
| `npm test` | Chạy toàn bộ bộ kiểm thử hệ thống (13 kiểm tra lõi Extension) và unit test phân loại kết quả voucher |
| `npm run lint` | Kiểm tra cú pháp toàn bộ các module JavaScript bằng `node --check` |
| `npm run build` | Chạy bước xác thực kiểm thử đầy đủ trước khi đóng gói / phát hành |
| `npm run icons` | Tái tạo bộ biểu tượng PNG (`16px`, `48px`, `128px`) khử răng cưa từ vector gốc |
| `npm run bot` | Chạy Bot Zalo Puppeteer độc lập ở chế độ nền |

---

## Cấu Trúc Thư Mục

```text
ShoppeVoucher/
├── assets/                     # Bộ icon ứng dụng (icon.svg, icon16/48/128.png)
├── bot/                        # Bot Zalo chạy nền độc lập (Puppeteer)
│   ├── bot.js                  # Engine theo dõi Zalo & Local API server (port 23232)
│   ├── bot_config.example.json # Mẫu cấu hình bot (copy sang bot_config.json khi dùng)
│   └── start_bot.bat           # Script khởi chạy nhanh trên Windows
├── dashboard/                  # Bảng điều khiển toàn trang của Extension
│   ├── dashboard.html          # Giao diện chính (Batch, Zalo, Scheduler, Banner, Settings)
│   ├── dashboard.css           # Hệ thống style & 6 bảng màu Lamplit tương phản cao
│   └── dashboard.js            # Logic điều khiển bảng điều khiển & biểu đồ mạng
├── popup/                      # Giao diện Popup nhanh trên thanh công cụ trình duyệt
│   ├── popup.html              # Layout Lưu Nhanh & Quét Trang Hiện Tại
│   ├── popup.css               # Style đồng bộ theo theme hiện hành
│   └── popup.js                # Logic lưu mã nhanh & mở trực tiếp Ví Voucher Shopee
├── scripts/                    # Content Scripts chạy trong ngữ cảnh trang web
│   ├── content.js              # Quét voucher, tự cuộn trang & nhận diện phản hồi Shopee
│   └── zalo-content.js         # Theo dõi tin nhắn thời gian thực trên Zalo Web
├── tests/                      # Bộ kiểm thử tự động
│   ├── test_suite.js           # 13 kiểm thử parser, bộ lọc link/nhóm, manifest & cơ chế tab
│   ├── voucher-result.test.js  # Unit test chuẩn hóa & phân loại phản hồi lưu mã Shopee
│   └── voucher-queue.test.js   # Unit test hàng đợi lưu chậm, lọc trùng & nhận diện mã reset
├── tools/                      # Công cụ hỗ trợ phát triển & xem trước
│   ├── server.js               # Dev server xem trước Dashboard & Popup trên localhost:3000
│   ├── chrome-preview-shim.js  # Lớp tương thích Chrome API cho môi trường preview
│   └── generate_icons.js       # Trình tạo PNG sắc nét (supersampling 4x4)
├── utils/                      # Thư viện dùng chung
│   ├── parser.js               # Smart Parser, dịch mã lỗi & chuẩn hóa kết quả lưu mã
│   ├── shopee-api.js           # Tương tác API Shopee (giả lập nguồn Mobile App & Web)
│   └── voucher-queue.js        # Hàng đợi lưu chậm tuần tự & bộ nhận diện mã mới / mã reset
├── background.js               # Service Worker trung tâm (Manifest V3)
├── manifest.json               # Khai báo quyền và cấu trúc Chrome Extension
├── package.json                # Cấu hình dự án và npm scripts
├── start_bot.bat               # Lối tắt khởi động Bot từ thư mục gốc
├── test_suite.js               # Lối tắt chạy nhanh bộ kiểm thử từ thư mục gốc
└── README.md                   # Tài liệu hướng dẫn sử dụng
```

---

## Quyền Riêng Tư & Lưu Ý Sử Dụng

- Toàn bộ cookie phiên đăng nhập Shopee được sử dụng **cục bộ ngay trên trình duyệt của bạn** để gọi trực tiếp API chính thức của `shopee.vn`, không gửi dữ liệu tài khoản ra máy chủ bên thứ ba.
- Tuyệt đối không chia sẻ tệp `bot/bot_config.json` hoặc thư mục `bot/bot_data/` vì có chứa thông tin phiên đăng nhập cá nhân.
- Khuyến nghị giữ mức độ trễ mặc định (`1800ms`) khi lưu hàng loạt để tránh bị Shopee giới hạn tốc độ truy cập.
