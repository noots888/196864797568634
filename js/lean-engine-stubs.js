// Lean core stubs.
// These keep old engine references safe after removing optional utility/crossing/span modules.
var UtilitiesEngine = window.UtilitiesEngine = {
  types:[], labels:{}, grid:null, gridStats:null, lastResults:[], lastScanMeta:null,
  init(){}, invalidateGrid(){}, clear(){}, updatePanel(){}, refreshAssetBadgePanel(){},
  hasAnyImportedUtility(){return false;}, hasAnyUtilityEnabled(){return false;}, isUtilityFileMeta(){return false;},
  isUtility(a){
    if(!a)return false;
    const raw=a.raw||{};
    const kind=String(a.kind||raw.KIND||raw.kind||raw.asset_type||'').toLowerCase();
    const file=String(a.sourceFile||a.sourcePath||'').toUpperCase();
    return kind.startsWith('utility-') || String(raw.DRAW_CONTEXT_SIDECAR||'')==='1' || /UTILITY_CONTEXT_MODE/i.test(Object.keys(raw).join(' ')) || /POLE[_\s-]*DRAW[_\s-]*CONTEXT|FAST[_\s-]*CONTEXT|UTILITY[_\s-]*ROUTE[_\s-]*SNIPPETS/i.test(file);
  },
  typeOf(a){return String(a?.utilityType||a?.kind||'').replace(/^utility-/,'');},
  filterKey(type){const s=String(type||'utility'); return 'utility'+s.charAt(0).toUpperCase()+s.slice(1);},
  utilityContexts(a){
    // v3.1.180: FAST direct-context check only. Do not call MapEngine.utilityContextTypesForAsset
    // while drawing circuit dots; that fallback can scan the full asset database for every marker.
    try{
      const raw=a?.raw||{};
      const has=(re)=>Object.keys(raw).some(k=>re.test(k)&&String(raw[k]??'').trim()!==''&&!/^no\s+/i.test(String(raw[k]??'')));
      const out=[];
      if(has(/^NEARBY_HV_CABLE_(DISTANCE_M|KV|TYPE|PHASES)$/i))out.push({label:'HV underground cable',short:'HVUG'});
      if(has(/^NEARBY_WATER_(DISTANCE_M|SUMMARY|STATUS)$/i))out.push({label:'Water pipe',short:'Water'});
      if(has(/^NEARBY_SEWER_(DISTANCE_M|SUMMARY|STATUS)$/i))out.push({label:'Sewer pressure main',short:'Sewer'});
      if(has(/^NEARBY_RAIL_(CORRIDOR|CROSSING)_(DISTANCE_M|SUMMARY|STATUS)$/i))out.push({label:'Rail context',short:'Rail'});
      if(has(/^NEARBY_ESA_(DISTANCE_M|SUMMARY|STATUS)$/i))out.push({label:'Environmentally sensitive area',short:'ESA'});
      if(has(/^NEARBY_(PETROLEUM|GAS)_(DISTANCE_M|SUMMARY|STATUS)$/i))out.push({label:'Petroleum/gas title area',short:'Gas'});
      return out;
    }catch(e){return [];}
  },
  hasPrecomputedMarkup(a){return this.utilityContexts(a).length>0;},
  assetBadgeHtml(a){
    const list=this.utilityContexts(a).slice(0,6);
    if(!list.length)return '';
    const esc=(v)=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    return `<div class="utility-badge-row">${list.map(c=>`<span>${esc(c.short||c.label||c.type||'Utility')}</span>`).join('')}</div>`;
  },
  proximityScan(){return [];}, nearest(){return [];}
};

var HVCrossingsLayer = window.HVCrossingsLayer = {
  init(){}, loadStore(){return Promise.resolve();}, migrateStoredAssetCrossings(){return Promise.resolve();},
  clearActive(){}, showForAsset(){}, showForCircuit(){}, showForCircuitFull(){return Promise.resolve();},
  deleteBySourceFile(){return Promise.resolve();}, storeImported(){return Promise.resolve({stored:0});},
  isCrossingAsset(){return false;}, isLikelyCrossingFile(){return false;}, ingestRecords(){return Promise.resolve({imported:0});}
};
