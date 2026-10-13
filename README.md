# FlashCard — PWA học tiếng Anh

App flash card chạy ngay trong trình duyệt. Vì bạn dùng Windows (không có Mac/Xcode),
đây là cách **duy nhất khả thi** để "cài" app lên iPhone mà không mất phí Apple Developer ($99/năm).
PWA chạy fullscreen, có icon trên màn hình chính, hoạt động offline sau lần mở đầu tiên.

## Tính năng

- **Nhập 1 từ → tự điền** loại từ, định nghĩa, phiên âm, ví dụ, audio phát âm (dùng Free Dictionary API, không cần API key).
- **Lật thẻ 3D** (mặt trước: từ + phát âm; mặt sau: loại từ + nghĩa + ví dụ).
- **Spaced Repetition (SM-2)** — thuật toán của Anki phiên bản gọn: thẻ bạn nhớ sẽ cách xa dần, thẻ hay quên lặp lại sớm.
- **Nhiều bộ thẻ (deck)** — tách theo chủ đề (TOEIC, giao tiếp, công việc…).
- **Tìm kiếm & sửa / xóa** từng thẻ.
- **Dark/Light mode**, theo hệ thống hoặc tự chọn.
- **Phát âm**: audio thật từ từ điển; không có thì fallback sang `speechSynthesis` của iOS.
- **Thống kê**: tổng số thẻ, cần ôn hôm nay, thẻ mới, đã thuộc.
- **Export / Import JSON** để backup, chuyển máy, hoặc tránh mất dữ liệu khi xóa Safari cache.
- **Offline** — chạy được không cần mạng (sau lần mở đầu). Tra từ mới cần mạng.

## Chạy thử trên máy

Mở PowerShell trong thư mục `flash_card` rồi chạy:

```powershell
python -m http.server 8080
```

(hoặc `npx serve .` nếu có Node). Mở http://localhost:8080 trên trình duyệt.

## Cách cài lên iPhone (3 lựa chọn)

### Cách 1 — Deploy lên GitHub Pages (khuyên dùng, miễn phí, HTTPS)

1. Tạo repo mới trên https://github.com/new (ví dụ tên `flashcard`).
2. Upload toàn bộ file trong thư mục này lên repo (nút "uploading an existing file").
3. Vào **Settings → Pages → Source: `main` branch, folder: `/ (root)` → Save**.
4. Sau 1-2 phút, GitHub cho bạn link kiểu `https://<username>.github.io/flashcard/`.
5. **Trên iPhone, mở link đó bằng Safari** (bắt buộc Safari, không dùng Chrome).
6. Bấm nút **Chia sẻ** (ô vuông mũi tên lên) → **Add to Home Screen** → **Add**.
7. Icon xuất hiện ở màn hình chính. Mở ra, chạy fullscreen như app native.

### Cách 2 — Netlify Drop (nhanh nhất, không cần Git)

1. Mở https://app.netlify.com/drop
2. Kéo thả cả thư mục `flash_card` vào trang.
3. Netlify cho bạn link `https://xxx.netlify.app` (HTTPS sẵn).
4. Trên iPhone, mở link đó bằng **Safari** → **Add to Home Screen**.

### Cách 3 — Chạy trên WiFi nhà (không cần internet)

1. Trên máy Windows, trong thư mục `flash_card`:
   ```powershell
   python -m http.server 8080
   ```
2. Lấy IP máy: `ipconfig` → tìm `IPv4 Address` (ví dụ `192.168.1.5`).
3. iPhone cùng WiFi, mở Safari → `http://192.168.1.5:8080`
4. **Add to Home Screen** như trên.
   - Lưu ý: trên HTTP (không HTTPS), service worker không chạy → không có offline, nhưng app vẫn mở được và lưu dữ liệu bình thường trong Safari.

## Cách dùng app

1. Tab **Thêm từ** → gõ từ tiếng Anh → bấm **Tra** (hoặc Enter).
   App tự fill loại từ + định nghĩa + ví dụ + phiên âm + audio.
2. Chỉnh sửa nếu cần → **Lưu thẻ**.
3. Tab **Học** → bấm thẻ để lật → tự đánh giá:
   - **Không nhớ**: hiện lại sau 1 phút.
   - **Khó / Được / Dễ**: giãn khoảng ôn theo thuật toán SM-2.
4. Tab **Thống kê** → xuất JSON để backup định kỳ.

## Lưu ý

- Dữ liệu lưu trong `localStorage` của Safari trên iPhone. Nếu bạn xóa dữ liệu Safari hoặc gỡ web clip, dữ liệu mất → **nhớ Xuất JSON** sau mỗi lần thêm nhiều từ.
- Free Dictionary API chỉ hỗ trợ tiếng Anh và đôi khi không có từ hiếm. Nếu không tìm thấy, bạn có thể tự nhập nghĩa.
- iOS Safari chạy PWA có vài giới hạn (không push notification trừ iOS 16.4+, không nền đầy đủ), nhưng với app học từ vựng thì không ảnh hưởng.
