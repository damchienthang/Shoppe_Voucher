# ⚡ Shopee Voucher Auto-Saver Pro

Tiện ích mở rộng trình duyệt (Chrome Extension Manifest V3) cao cấp hỗ trợ:
- **Tự động bắt tin nhắn & link từ nhóm Zalo săn sale (`chat.zalo.me`)**
- **Tự động lưu mã giảm giá Shopee hàng loạt**
- **Quét voucher sự kiện & tự cuộn trang**
- **Hẹn giờ săn sale 0h chuẩn xác từng mili-giây trên Shopee Việt Nam**

---

## 🌟 Các Tính Năng Nổi Bật

### 1. 💬 Zalo Web Auto-Sniffer (Tự động bắt tin nhắn nhóm Zalo)
- Chạy trực tiếp trên Zalo Web (`chat.zalo.me`).
- Khi bạn mở nhóm săn sale trên Zalo Web, script ngầm sẽ tự động lắng nghe tin nhắn mới theo thời gian thực (Real-time).
- **Nếu tin nhắn có Mã giảm giá:** Tiện ích tự động gọi API Shopee để lưu ngay vào ví chỉ trong tích tắc.
- **Nếu tin nhắn có Link Shopee (kể cả link rút gọn `s.shopee.vn`, `shp.ee`):** Tiện ích tự động mở tab ngầm -> tự động bấm nút "Lưu mã / Nhận" -> và tự động đóng tab.
- Gửi thông báo Desktop Notification và phát tiếng chuông khi lưu thành công!

### 2. 🚀 Lưu mã ký tự hàng loạt (Batch Voucher Saver)
- Hỗ trợ dán danh sách mã hoặc toàn bộ bài viết chia sẻ mã từ Telegram/Facebook/Zalo.
- Bộ nhận diện thông minh (Smart Parser) tự động loại bỏ từ thừa và trích xuất mã chuẩn.
- Tùy chỉnh tốc độ gửi request (Delay từ 100ms - 2000ms) để an toàn tuyệt đối, tránh rate limit.
- Bảng kết quả thời gian thực với phân loại thành công/thất bại và xuất báo cáo CSV.

### 3. 🎯 Trợ lý tự động quét trang (Page Auto-Collector & Auto-Scroll)
- Tự động cuộn trang (Auto-scroll) để tải toàn bộ banner voucher lười tải (lazy-load).
- Tự động bấm lưu tất cả các nút voucher trên trang Mã Giảm Giá `shopee.vn/m/ma-giam-gia`, Live hoặc trang sự kiện lớn (9/9, 11/11, 12/12...).
- Widget trợ lý nổi thông minh (Floating helper widget) trực tiếp trên giao diện Shopee.

### 4. ⏰ Hẹn giờ săn mã 0h chớp nhoáng (Precision Countdown & Fast-Claim)
- Cài đặt sẵn các khung giờ vàng: **00:00, 09:00, 12:00, 15:00, 18:00, 21:00** hoặc tùy chỉnh thời gian bất kỳ.
- Đồng bộ thời gian thực với Server Shopee (Shopee Server Time NTP Sync).
- Tùy chỉnh kích hoạt sớm trước giờ G (Lead time 30ms - 80ms) để bù độ trễ mạng (ping latency).

### 5. 👛 Quản lý ví Voucher (Wallet Inspector)
- Xem toàn bộ voucher hiện có trong ví tài khoản Shopee.
- Phân loại trực quan: Miễn phí vận chuyển (Freeship), Voucher Shopee (Giảm %, Giảm cố định), Voucher Shop.

---

## 🛠️ Hướng Dẫn Cài Đặt Vào Trình Duyệt Chrome / Edge / Cốc Cốc

1. Mở trình duyệt và truy cập đường dẫn:
   - Trên Google Chrome: `chrome://extensions/`
   - Trên Microsoft Edge: `edge://extensions/`
   - Trên Cốc Cốc: `coccoc://extensions/`
2. Bật chế độ **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
3. Bấm nút **Tải tiện ích đã giải nén (Load unpacked)**.
4. Chọn thư mục: `d:\Tools\ShoppeVoucher`.
5. Ghim (Pin) biểu tượng tiện ích lên thanh công cụ trình duyệt để sử dụng.

---

## 📋 Cách Dùng Tính Năng Săn Voucher Từ Nhóm Zalo

1. Đăng nhập tài khoản Shopee của bạn trên trình duyệt.
2. Mở Zalo Web tại địa chỉ: [chat.zalo.me](https://chat.zalo.me) trên cùng trình duyệt.
3. Chọn nhóm Zalo săn deal/mã giảm giá bạn đang tham gia.
4. Ở góc dưới màn hình Zalo sẽ xuất hiện huy hiệu: `⚡ Săn Voucher Shopee: 🟢 Đang tự động theo dõi tin nhắn nhóm`.
5. Bất cứ khi nào nhóm có tin nhắn mới chứa mã voucher hoặc link `shopee.vn` / `s.shopee.vn`, hệ thống sẽ **tự động lưu ngay lập tức vào ví của bạn** và phát thông báo trên màn hình!
6. **Bộ lọc thông minh chống spam:** Hệ thống sẽ tự động bỏ qua các link quảng cáo từ các tên miền ngoài (`longhousee`, `shorten.asia`, `lazada`, `tiktok`...) và chỉ log, xử lý các tin nhắn và đường link chính thống của Shopee.

---

## 📁 Cấu Trúc Thư Mục Dự Án (Clean Architecture)

```text
ShoppeVoucher/
├── assets/                    # Icon ứng dụng & tài nguyên đồ họa (SVG, PNG)
├── bot/                       # Bot Node.js Daemon độc lập chạy ngầm 24/7
│   ├── bot.js                 # Engine Puppeteer bắt tin nhắn Zalo ngầm
│   ├── bot_config.json        # Cấu hình bot (nhóm Zalo, delay...)
│   └── start_bot.bat          # File chạy nhanh Bot Zalo 24/7
├── dashboard/                 # Bảng điều khiển quản trị toàn trang
│   ├── dashboard.html         # Giao diện chính (Tabs, Charts, Config)
│   ├── dashboard.css          # CSS styles & hệ thống theme (Lamplit themes)
│   └── dashboard.js           # Logic điều khiển Dashboard
├── popup/                     # Menu pop-up nhanh trên thanh công cụ trình duyệt
│   ├── popup.html             # Giao diện pop-up gọn gàng
│   ├── popup.css              # Style cho pop-up
│   └── popup.js               # Logic lưu mã nhanh & đồng bộ trạng thái
├── scripts/                   # Content Scripts tiêm vào trang web
│   ├── content.js             # Script tiêm vào Shopee (tự động nhận voucher)
│   └── zalo-content.js        # Script tiêm vào Zalo Web (theo dõi tin nhắn)
├── tests/                     # Hệ thống kiểm thử tự động
│   └── test_suite.js          # Bộ test suite 13/13 tiêu chuẩn
├── tools/                     # Công cụ tiện ích phát triển (Icon generator)
│   └── generate_icons.js      # Tạo bộ icon chuẩn kích thước
├── utils/                     # Thư viện dùng chung
│   ├── parser.js              # Trích xuất mã thông minh & lọc rác
│   └── shopee-api.js          # Bộ gọi API Shopee & giả lập app di động
├── background.js              # Service Worker trung tâm của Extension
├── manifest.json              # Khai báo chuẩn Chrome Extension Manifest V3
├── package.json               # Cấu hình dự án & npm scripts
├── README.md                  # Tài liệu hướng dẫn sử dụng
├── start_bot.bat              # Shortcut khởi động Bot Zalo ở thư mục gốc
└── test_suite.js              # Shortcut chạy test nhanh từ thư mục gốc
```
