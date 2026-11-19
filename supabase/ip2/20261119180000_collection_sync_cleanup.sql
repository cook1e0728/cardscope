-- 收藏雲端同步的資料清理（docs/NEXT_PHASE_PLAN.md Y4）：180 天沒有任何裝置寫入（updated_at 沒動）的同步列就刪掉，不留人家不再用的資料。
-- 只有寫入（push）會更新 updated_at；只拉不寫不算使用中，所以每次同步成功後有改動的裝置都會讓這列保持新鮮。
-- 每天 03:40（資料庫時區 UTC）跑一次；可重複執行（同名排程會被取代）。這個檔案只寫了，尚未套用到副庫。

create extension if not exists pg_cron;

create or replace function public.collection_sync_purge_stale()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_deleted integer;
begin
  delete from public.collection_sync where updated_at < now() - interval '180 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function public.collection_sync_purge_stale() from public, anon, authenticated;

select cron.schedule('collection-sync-purge', '40 3 * * *', 'select public.collection_sync_purge_stale()');
