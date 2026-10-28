-- 瀏覽排序鍵的「發布」改由資料庫內排程執行（2026-10-28，盤點 #1）。
-- 寶可夢的 browse_refresh_keys_publish 約要 25 秒，伺服器經 PostgREST 呼叫在 20 秒被切斷（函式上的 statement_timeout 90s 不會重設已開始的計時），
-- 所以 10-23 起每小時建好新世代卻發布失敗，快路徑一直關著、舊世代也一直留著。伺服器照舊每小時 :07 建立世代；這個排程在 :25 發布任何待發布的世代。
-- 每個遊戲各自包在例外處理裡，一個失敗不影響其他遊戲；可重複執行（同名排程會被取代）。

create extension if not exists pg_cron;

create or replace function public.browse_publish_pending_keys()
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  g text;
  v_result jsonb := '[]'::jsonb;
begin
  for g in select p.game_id from public.browse_key_pending p order by 1 loop
    begin
      v_result := v_result || jsonb_build_array(public.browse_refresh_keys_publish(g));
    exception when others then
      v_result := v_result || jsonb_build_array(jsonb_build_object('game', g, 'error', sqlerrm));
    end;
  end loop;
  return v_result;
end;
$function$;

revoke all on function public.browse_publish_pending_keys() from public, anon, authenticated;

select cron.schedule('browse-keys-publish', '25 * * * *', 'select public.browse_publish_pending_keys()');
