-- =====================================================================
-- Physics EZ – cài đặt Supabase (chạy MỘT lần)
-- Cách chạy: Supabase → dự án → SQL Editor → New query
--            → dán toàn bộ file này → bấm Run.
-- Chạy lại lần nữa cũng không sao (không mất dữ liệu).
-- File này KHÔNG chứa mật khẩu. Mật khẩu tải lên đặt riêng bằng 1 lệnh
-- (xem bước "Đặt mật khẩu tải lên" trong HUONG-DAN-SUPABASE.txt).
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- 1) Bảng bài đăng: bài mô phỏng (sim, gồm cả file HTML và ảnh bìa) và câu lệnh mẫu (prompt)
create table if not exists public.bai_dang (
  id        uuid primary key default gen_random_uuid(),
  loai      text not null check (loai in ('sim', 'prompt')),
  tieu_de   text not null check (char_length(tieu_de) between 1 and 200),
  lop       text check (lop in ('10', '11', '12')),
  mo_ta     text not null default '' check (char_length(mo_ta) <= 500),
  nhom      text check (char_length(nhom) <= 100),
  noi_dung  text check (char_length(noi_dung) <= 20000),
  html      text check (octet_length(html) <= 3500000),
  anh_bia   text check (anh_bia is null or (anh_bia like 'data:image/%' and octet_length(anh_bia) <= 400000)),
  co_anh    boolean generated always as (anh_bia is not null) stored,
  tac_gia   text not null default '' check (char_length(tac_gia) <= 80),
  tao_luc   timestamptz not null default now(),
  constraint bai_dang_du_thong_tin check (
    (loai = 'sim'    and lop is not null and html is not null)
 or (loai = 'prompt' and nhom is not null and noi_dung is not null)
  )
);
create index if not exists bai_dang_tao_luc_idx on public.bai_dang (tao_luc);

-- Ai cũng XEM được. Không ai THÊM / SỬA / XÓA trực tiếp được:
-- chỉ đăng / xóa qua các hàm bên dưới, và hàm chỉ chạy khi đúng mật khẩu tải lên.
alter table public.bai_dang enable row level security;
revoke all on table public.bai_dang from anon, authenticated;
grant select on table public.bai_dang to anon, authenticated;
drop policy if exists "Ai cũng xem" on public.bai_dang;
create policy "Ai cũng xem" on public.bai_dang
  for select to anon, authenticated
  using (true);

-- 2) Mật khẩu tải lên: chỉ lưu dạng đã mã hóa, trong khu "private" mà web không đọc được
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.cai_dat (
  id             int primary key default 1 check (id = 1),
  mat_khau_hash  text
);
insert into private.cai_dat (id) values (1) on conflict (id) do nothing;

-- Ghi lại lần nhập sai để chặn dò mật khẩu: 10 lần sai trong 15 phút từ một mạng → khóa 15 phút
create table if not exists private.lan_sai (
  ip   text not null,
  luc  timestamptz not null default now()
);
create index if not exists lan_sai_ip_luc_idx on private.lan_sai (ip, luc);

-- Đặt / đổi mật khẩu tải lên (chỉ chạy được trong SQL Editor, web không gọi được)
create or replace function private.dat_mat_khau(moi text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if moi is null or char_length(moi) < 6 then
    raise exception 'Mật khẩu phải có ít nhất 6 kí tự';
  end if;
  update private.cai_dat
     set mat_khau_hash = extensions.crypt(moi, extensions.gen_salt('bf', 10))
   where id = 1;
  delete from private.lan_sai;
  return 'Đã đặt mật khẩu tải lên.';
end $$;
revoke all on function private.dat_mat_khau(text) from public, anon, authenticated;

-- Kiểm tra mật khẩu (dùng nội bộ)
create or replace function private.dung_mat_khau(mk text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip   text;
  v_hash text;
  v_sai  int;
begin
  -- cf-connecting-ip do Cloudflare (cổng của Supabase) gắn vào, người dùng không giả được
  v_ip := coalesce(
    nullif(trim(nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip'), ''),
    nullif(trim(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1)), ''),
    'khong-ro');
  delete from private.lan_sai where luc < now() - interval '1 day';
  select count(*) into v_sai from private.lan_sai
   where ip = v_ip and luc > now() - interval '15 minutes';
  if v_sai >= 10 then
    raise exception 'qua-nhieu-lan';
  end if;
  select mat_khau_hash into v_hash from private.cai_dat where id = 1;
  if v_hash is null then
    raise exception 'chua-dat-mat-khau';
  end if;
  if mk is not null and extensions.crypt(mk, v_hash) = v_hash then
    return true;
  end if;
  insert into private.lan_sai (ip) values (v_ip);
  return false;
end $$;
revoke all on function private.dung_mat_khau(text) from public, anon, authenticated;

-- 3) Các hàm web được gọi
-- 3a) Ô đăng nhập ở nút "Tải lên": đúng mật khẩu → true
create or replace function public.kiem_tra_mat_khau(p_mat_khau text)
returns boolean
language sql
security definer
set search_path = ''
as $$ select private.dung_mat_khau(p_mat_khau) $$;

-- 3b) Đăng câu lệnh mẫu
create or replace function public.dang_cau_lenh(
  p_mat_khau text, p_tieu_de text, p_nhom text, p_noi_dung text, p_tac_gia text default '')
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare r public.bai_dang;
begin
  if not private.dung_mat_khau(p_mat_khau) then
    return json_build_object('ok', false, 'loi', 'sai-mat-khau');
  end if;
  insert into public.bai_dang (loai, tieu_de, nhom, noi_dung, tac_gia)
  values ('prompt', trim(p_tieu_de), p_nhom, p_noi_dung, coalesce(trim(p_tac_gia), ''))
  returning * into r;
  return json_build_object('ok', true, 'id', r.id, 'tao_luc', r.tao_luc);
end $$;

-- 3c) Đăng bài mô phỏng (file HTML + ảnh bìa nhỏ dạng data:image/...)
create or replace function public.dang_bai_mo_phong(
  p_mat_khau text, p_tieu_de text, p_lop text, p_mo_ta text, p_html text,
  p_anh_bia text default null, p_tac_gia text default '')
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare r public.bai_dang;
begin
  if not private.dung_mat_khau(p_mat_khau) then
    return json_build_object('ok', false, 'loi', 'sai-mat-khau');
  end if;
  insert into public.bai_dang (loai, tieu_de, lop, mo_ta, html, anh_bia, tac_gia)
  values ('sim', trim(p_tieu_de), p_lop, coalesce(trim(p_mo_ta), ''), p_html,
          nullif(p_anh_bia, ''), coalesce(trim(p_tac_gia), ''))
  returning * into r;
  return json_build_object('ok', true, 'id', r.id, 'tao_luc', r.tao_luc);
end $$;

-- 3d) Xóa bài đã đăng (phải đúng mật khẩu tải lên)
create or replace function public.xoa_bai(p_mat_khau text, p_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  if not private.dung_mat_khau(p_mat_khau) then
    return json_build_object('ok', false, 'loi', 'sai-mat-khau');
  end if;
  delete from public.bai_dang where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then
    return json_build_object('ok', false, 'loi', 'khong-tim-thay');
  end if;
  return json_build_object('ok', true, 'id', p_id);
end $$;

revoke all on function public.kiem_tra_mat_khau(text) from public, anon, authenticated;
revoke all on function public.dang_cau_lenh(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.dang_bai_mo_phong(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.xoa_bai(text, uuid) from public, anon, authenticated;
grant execute on function public.kiem_tra_mat_khau(text) to anon, authenticated;
grant execute on function public.dang_cau_lenh(text, text, text, text, text) to anon, authenticated;
grant execute on function public.dang_bai_mo_phong(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.xoa_bai(text, uuid) to anon, authenticated;

-- 4) Đếm lượt truy cập (hiện ở khung cuối trang chủ)
--    Mỗi trình duyệt chỉ được đếm 1 lần cho mỗi phiên mở web.
create table if not exists public.site_stats (
  id      int primary key default 1 check (id = 1),
  visits  bigint not null default 0
);
insert into public.site_stats (id, visits) values (1, 0) on conflict (id) do nothing;

alter table public.site_stats enable row level security;
revoke all on table public.site_stats from anon, authenticated;
grant select on table public.site_stats to anon, authenticated;

drop policy if exists "Ai cũng xem số lượt truy cập" on public.site_stats;
create policy "Ai cũng xem số lượt truy cập" on public.site_stats
  for select to anon, authenticated
  using (true);

create or replace function public.ghi_luot_truy_cap()
returns bigint
language sql
security definer
set search_path = ''
as $$
  update public.site_stats set visits = visits + 1 where id = 1 returning visits;
$$;
revoke all on function public.ghi_luot_truy_cap() from public, anon, authenticated;
grant execute on function public.ghi_luot_truy_cap() to anon, authenticated;

-- Xong phần cài đặt. Bước tiếp theo: đặt mật khẩu tải lên (chạy riêng, KHÔNG lưu vào file):
--   select private.dat_mat_khau('mat-khau-cua-co');
-- Đổi mật khẩu sau này: chạy lại đúng lệnh đó với mật khẩu mới.
-- Đặt lại số lượt truy cập về 0:
--   update public.site_stats set visits = 0 where id = 1;
-- Gỡ bài: dùng nút Xóa ở trang Tải lên (sau khi đăng nhập),
-- hoặc Table Editor → bai_dang → tick dòng đó → Delete.
