// Provider registry keeps source capabilities explicit. Disabled adapters are placeholders only;
// they must not be enabled until their public access method and parser have been verified.
export const providerRegistry = {
  ebay: { market:'GLOBAL', mode:'api', enabledEnv:'EBAY_CLIENT_ID', priceTypes:['listing'], refreshHours:24 },
  justtcg: { market:'US', mode:'api', enabledEnv:'JUSTTCG_API_KEY', priceTypes:['market'], refreshHours:24 },
  yuyutei: { market:'JP', mode:'public-page', enabledEnv:'SCRAPE_SECRET', priceTypes:['buyback'], refreshHours:24 },
  kapaipai: { market:'TW', mode:'public-page', enabled:false, priceTypes:['listing','sale'], refreshHours:24, note:'待確認公開頁面結構與允許的存取方式' },
  snkrdunk: { market:'JP', mode:'public-page', enabled:false, priceTypes:['listing','sale'], refreshHours:24, note:'待確認公開頁面結構與允許的存取方式' },
  amazon: { market:'GLOBAL', mode:'official-or-partner-preferred', enabled:false, priceTypes:['listing'], refreshHours:24, note:'不繞過登入、CAPTCHA 或反自動化限制' }
};

export function publicProviderRegistry(env = process.env){
  return Object.fromEntries(Object.entries(providerRegistry).map(([id, config]) => [id, {
    market: config.market,
    mode: config.mode,
    enabled: config.enabled === false ? false : Boolean(config.enabledEnv ? env[config.enabledEnv] : config.enabled),
    priceTypes: config.priceTypes,
    refreshHours: config.refreshHours,
    note: config.note || null
  }]));
}
