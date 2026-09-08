import { readFile } from 'node:fs/promises';

const registry=JSON.parse(await readFile(new URL('../data/source-registry.json',import.meta.url),'utf8'));
const byRuntimeProvider=new Map(registry.sources.filter(source=>source.runtimeProvider).map(source=>[source.runtimeProvider,source]));
const DISPLAYABLE_IMAGE_RIGHTS=new Set(['licensed','partner-provided','user-provided']);

export function sourcePolicyForProvider(provider){return byRuntimeProvider.get(provider)||null}
export function catalogCollectionAllowed(provider){return sourcePolicyForProvider(provider)?.collectionEnabled===true}
export function filterAllowedCatalogProviders(providers=[]){return providers.filter(catalogCollectionAllowed)}
export function imageCollectionAllowed(provider){return sourcePolicyForProvider(provider)?.imagePolicy==='rehost-permitted'}
export function imageRightsAllowDisplay(status,expiresAt=null){
  if(!DISPLAYABLE_IMAGE_RIGHTS.has(String(status||'')))return false;
  return !expiresAt||new Date(expiresAt).getTime()>Date.now();
}
export function publicSourcePolicies(){return registry.sources.map(({notes,...source})=>({...source,status:source.collectionEnabled?'enabled':'blocked'}))}
export function sourcePolicySummary(){
  const runtime=registry.sources.filter(source=>source.runtimeProvider);
  return {version:registry.version,reviewedAt:registry.reviewedAt,enabled:runtime.filter(source=>source.collectionEnabled).length,blocked:runtime.filter(source=>!source.collectionEnabled).length,total:runtime.length};
}
