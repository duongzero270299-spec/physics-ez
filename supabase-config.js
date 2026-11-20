/* Physics EZ – nối web với Supabase.
   Chỉ sửa 2 dòng url và key bên dưới (giữ nguyên dấu nháy đơn ' ').
   Lấy ở Supabase → nút Connect (hoặc Project Settings → Data API / API Keys).
   CHỈ dán "Publishable key" (bắt đầu bằng sb_publishable_) hoặc "anon public".
   TUYỆT ĐỐI KHÔNG dán "Secret key" / "service_role" vào đây.
   KHÔNG ghi mật khẩu tải lên vào file này: mật khẩu chỉ nhập lúc bấm nút "Tải lên".
   Để trống cả hai thì web chạy như cũ, không dùng Supabase. */
window.EZ_SUPABASE = {
  url: 'https://xwvzrfqvuotayevuoxov.supabase.co',
  key: 'sb_publishable_wtpY2SG04VxCL2DAO4a6DQ_pl5nH5Bk'
};
