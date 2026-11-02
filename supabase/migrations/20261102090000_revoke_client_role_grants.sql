-- 網站只透過伺服器的 service role 連資料庫，anon／authenticated 不需要任何資料表權限（2026-11-02 資安審查）。
-- RLS 擋不住 TRUNCATE，所以連同預設權限一起收回，之後新建的表也不會再帶。
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

alter function public.cardscope_db_size_bytes() set search_path to '';
