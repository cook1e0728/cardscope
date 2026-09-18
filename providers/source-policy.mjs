import { readFile } from 'node:fs/promises';

const registry=JSON.parse(await readFile(new URL('../data/source-registry.json',import.meta.url),'utf8'));
const byRuntimeProvider=new Map(registry.sources.filter(source=>source.runtimeProvider).map(source=>[source.runtimeProvider,source]));
const DISPLAYABLE_IMAGE_RIGHTS=new Set(['licensed','partner-provided','user-provided']);

export function sourcePolicyForProvider(provider){return byRuntimeProvider.get(provider)||null}
export function catalogCollectionAllowed(provider){return sourcePolicyForProvider(provider)?.collectionEnabled===true}
export function filterAllowedCatalogProviders(providers=[]){return providers.filter(catalogCollectionAllowed)}
export function imageCollectionAllowed(provider){return sourcePolicyForProvider(provider)?.imagePolicy==='rehost-permitted'}
export function imageDisplayPolicies(){return {...registry.imageDisplayPolicies}}
export function imageRiskAcceptedSources(){return Object.entries(imageDisplayPolicies()).filter(([,policy])=>policy==='risk-accepted').map(([source])=>source)}
export function imageRightsAllowDisplay(status,expiresAt=null,source=null){
  const normalized=String(status||'not-provided');
  if(normalized==='not-displayable')return false;
  const policy=registry.imageDisplayPolicies?.[source];
  if(!['rights-approved','risk-accepted'].includes(policy))return false;
  if(!DISPLAYABLE_IMAGE_RIGHTS.has(normalized)&&!(policy==='risk-accepted'&&normalized==='not-provided'))return false;
  return !expiresAt||new Date(expiresAt).getTime()>Date.now();
}
export function publicSourcePolicies(){return registry.sources.map(({notes,...source})=>({...source,imageDisplayPolicy:registry.imageDisplayPolicies?.[source.id]||'blocked',status:source.collectionEnabled?'enabled':'blocked'}))}
export function sourcePolicySummary(){
  const runtime=registry.sources.filter(source=>source.runtimeProvider);
  return {version:registry.version,imageDisplayPolicyMode:'per-source',reviewedAt:registry.reviewedAt,enabled:runtime.filter(source=>source.collectionEnabled).length,blocked:runtime.filter(source=>!source.collectionEnabled).length,total:runtime.length,unverifiedImageDisplayEnabled:registry.unverifiedImageDisplayEnabled===true,riskAcceptedAt:registry.riskAcceptedAt||null};
}
