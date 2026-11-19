-- 收藏雲端同步（docs/NEXT_PHASE_PLAN.md Y1）：第二庫（cardscope-ip2）一張表，一組同步碼一列。
-- 只在第二庫建立，不放主庫。沒有帳號、沒有任何個資：鍵是同步碼的 SHA-256（十六進位小寫），原始同步碼不會到資料庫。
-- 只有 service_role（伺服器的 SUPABASE2_SERVICE_KEY）能讀寫；匿名與登入角色一律沒有權限，RLS 開著而且不設任何 policy。
-- 寫入由伺服器用 PATCH ... where revision = 舊值 做樂觀鎖（單一 UPDATE 在資料庫裡是原子的），所以不需要額外的 RPC。
-- 這個檔案只是 migration，尚未套用；套用時照 docs/UA_SECOND_DB_PLAN.md 的流程在第二庫執行。

create table if not exists public.collection_sync (
  sync_key_hash text not null,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone not null default now(),
  revision integer not null default 1,
  constraint collection_sync_pkey primary key (sync_key_hash),
  constraint collection_sync_hash_check check (sync_key_hash ~ '^[0-9a-f]{64}$'),
  constraint collection_sync_items_check check (jsonb_typeof(items) = 'array'),
  constraint collection_sync_revision_check check (revision >= 1)
);

comment on table public.collection_sync is 'CardSeek 收藏雲端同步：每組同步碼（只存 SHA-256）一列；items 是驗證過的收藏項目與墓碑，revision 是樂觀鎖版本。';

alter table public.collection_sync enable row level security;
revoke all on public.collection_sync from public, anon, authenticated;
grant select, insert, update, delete on public.collection_sync to service_role;
