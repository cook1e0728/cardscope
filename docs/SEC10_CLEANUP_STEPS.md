# 套用 180 天收藏同步清理排程（體檢 SEC-10）

隱私說明承諾「超過 180 天未同步或更新，雲端資料會自動清除」，但副庫（cardscope-ip2）目前沒有這個排程（2026-11-24 用唯讀 SQL 查 `cron.job`，只有 `browse-keys-publish`）。這一步要由你自己在 Supabase 執行，Claude 不代為執行。

## 步驟

1. 打開 https://supabase.com/dashboard ，選 **cardscope-ip2**（副庫，網址是 `kcqtmmurmggitbivonll`）。不要選主庫。
2. 左側選 **SQL Editor** → **New query**。
3. 打開 repo 裡的 `supabase/ip2/20261119180000_collection_sync_cleanup.sql`，全部複製，貼進編輯區。
4. 按 **Run**。看到 `Success` 就完成；最後一行會回傳一個數字（排程編號）。
   - 這段可以重複執行：同名排程會被取代，不會重複。
   - 執行時只建立一個函式和一個排程，不會立刻刪資料。之後每天 03:40（UTC，台灣 11:40）自動刪掉 `updated_at` 超過 180 天的同步列。
5. 回來跟 Claude 說「跑完了」，Claude 會用唯讀查詢確認。

## Claude 會跑的唯讀確認

```sql
select jobname, schedule, command, active from cron.job where jobname = 'collection-sync-purge';
select proname, prosecdef from pg_proc where proname = 'collection_sync_purge_stale';
```

預期：一列 `collection-sync-purge`、`40 3 * * *`、`active = true`；函式存在且 `prosecdef = true`。
