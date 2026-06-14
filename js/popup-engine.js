const PopupEngine={
  esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));},
  clean(s){return String(s??'').replace(/^\uFEFF/,'').trim();},
  compact(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,'');},
  firstRaw(a,patterns=[]){
    const raw=a?.raw||{};
    for(const [k,v] of Object.entries(raw)){
      if(v===undefined||v===null||String(v).trim()==='')continue;
      if(patterns.some(p=>p.test(k)))return this.clean(v);
    }
    return '';
  },
  hvContext(a,mode='asset'){
    const cable=mode==='cable';
    const pref=cable?'NEARBY_HV_CABLE':'NEARBY_HV';
    const val=(name)=>this.firstRaw(a,[new RegExp('^'+pref+'_'+name+'$','i')]);
    const kv=val('KV');
    const phases=val('PHASES');
    const type=val('TYPE');
    const dist=val('DISTANCE_M');
    const network=val('NETWORK');
    const source=val('SOURCE');
    const status=val('STATUS');
    if(!kv&&!phases&&!type&&!dist&&!network&&!status)return null;
    return {kv,phases,type,dist,network,source,status,hasDistance:!!dist};
  },
  hvSummaryRows(a){
    const raw=a?.raw||{};
    const text=[a?.kind,a?.category,a?.label,a?.sourceFile,raw.asset_type,raw.ASSET_TYPE].join(' ').toUpperCase();
    const rows=[];
    const add=(label,ctx)=>{
      if(!ctx||!ctx.hasDistance)return;
      const parts=[ctx.kv,ctx.phases,ctx.type,ctx.dist?`${ctx.dist} m`:'' ].filter(Boolean);
      if(parts.length)rows.push([label,parts.join(' · ')]);
    };
    if(this.isPoleTower(a))add('Nearby HV cable',this.hvContext(a,'cable'));
    if(/TRANSFORMER|ELECTRICAL[-_\s]*ENCLOSURE|ENCLOSURE/.test(text))add('Nearby HV',this.hvContext(a,'asset'));
    return rows;
  },
  hvInfoRows(a){
    const raw=a?.raw||{};
    const text=[a?.kind,a?.category,a?.label,a?.sourceFile,raw.asset_type,raw.ASSET_TYPE].join(' ').toUpperCase();
    const ctx=this.isPoleTower(a)?this.hvContext(a,'cable'):(/TRANSFORMER|ELECTRICAL[-_\s]*ENCLOSURE|ENCLOSURE/.test(text)?this.hvContext(a,'asset'):null);
    if(!ctx)return [];
    const rows=[];
    const cable=this.isPoleTower(a);
    const add=(k,v)=>{v=this.clean(v); if(v)rows.push([k,v]);};
    if(cable){
      if(!ctx.hasDistance)return [];
      add('Nearby HV cable',ctx.type||'HVUG');
      add('HV cable kV',ctx.kv);
      add('HV cable phases',ctx.phases);
      add('HV cable distance',ctx.dist?`${ctx.dist} m`:'');
      add('HV cable network',ctx.network);
      add('HV cable source',ctx.source);
    }else{
      add('Nearby HV kV',ctx.kv);
      add('Nearby HV phases',ctx.phases);
      add('Nearby HV type',ctx.type);
      add('Nearby HV distance',ctx.dist?`${ctx.dist} m`:'');
      add('Nearby HV network',ctx.network);
      add('Nearby HV source',ctx.source);
      add('HV info status',ctx.status);
    }
    return rows;
  },
  gisLabel(a){
    const direct=this.clean(a?.gisLabel);
    if(direct)return direct;
    const raw=this.firstRaw(a,[/trmsn.*line.*gis.*label/i,/line.*gis.*label/i,/gis.*label/i,/circuit.*structure.*label/i]);
    if(raw)return raw;
    const fields=[a?.label,a?.structure,a?.rawStructure,a?.line].map(x=>this.clean(x)).filter(Boolean);
    return fields.find(v=>/[A-Z]{1,4}\s*[-_ ]\s*[A-Z]{1,4}\s*\d{1,4}\s*[-_ ]\s*\d{1,5}/i.test(v))||'';
  },
  cleanGisDisplay(label){
    const text=this.clean(label);
    if(!text)return '';
    const refs=window.SearchEngine?.extractLineRefsFromText?.(text)||[];
    if(refs.length){
      const pieces=refs.map(r=>`${r.line}${r.pole?'-'+r.pole:''}`);
      return pieces.join(', ');
    }
    return text.replace(/,\s*[A-Z]{1,4}(?:[-–—][A-Z]{1,4})?\s*$/,'').trim();
  },
  partsFromGis(label){
    const text=this.clean(label);
    if(!text)return {line:'',pole:''};
    const refs=window.SearchEngine?.extractLineRefsFromText?.(text)||[];
    if(refs.length)return {line:refs[0].line,pole:refs[0].pole||''};
    const m=text.match(/^(.+?\b[A-Z0-9]*\d[A-Z0-9]{0,4})[\s_-]+(\d{1,5})$/i);
    if(!m)return {line:text,pole:''};
    return {line:m[1].trim(),pole:m[2]};
  },
  displayLine(a){
    const aliases=window.SearchEngine?.lineAliasesForAsset?.(a)||[];
    if(aliases.length>1)return aliases.join(', ');
    if(aliases.length===1)return aliases[0];
    const parts=this.partsFromGis(this.gisLabel(a));
    const raw=parts.line||this.clean(a?.line)||this.clean(this.firstRaw(a,[/^LINE_NAME$/i,/circuit/i,/feeder/i,/route/i]));
    return window.SearchEngine?.formatCircuitName?SearchEngine.formatCircuitName(raw):raw;
  },
  poleNo(a){
    const refs=window.SearchEngine?.lineRefsForAsset?.(a)||[];
    const poles=[...new Set(refs.map(r=>String(r.pole||'').trim()).filter(Boolean))];
    if(poles.length>1)return poles.join(', ');
    if(poles.length===1)return poles[0];
    const parts=this.partsFromGis(this.gisLabel(a));
    if(parts.pole)return parts.pole;
    if(a?.poleNumber)return this.clean(a.poleNumber);
    const rawPole=this.firstRaw(a,[/pole.*(no|num|number)/i,/structure.*(no|num|number)/i,/point.*(no|id)/i,/s_?no/i,/snum/i]);
    if(rawPole){
      const text=this.clean(rawPole);
      const m=text.match(/(?:POLE|TOWER|STRUCTURE|POINT|S)?\s*#?\s*0*(\d{1,5})\b/i);
      if(m)return m[1];
      return text;
    }
    const label=this.clean(a?.label||a?.structure||a?.rawStructure);
    let m=label.match(/[\s_-]0*(\d{1,5})$/);
    if(m)return m[1];
    m=label.match(/(?:POLE|TOWER|STRUCTURE|S)\s*#?\s*0*(\d{1,5})\b/i);
    if(m)return m[1];
    return '';
  },
  inferredTitle(a){
    const refs=window.SearchEngine?.lineRefsForAsset?.(a)||[];
    const cleanRefs=[];
    for(const r of refs){
      const line=window.SearchEngine?.formatCircuitName?SearchEngine.formatCircuitName(r.line):this.clean(r.line);
      const pole=this.clean(r.pole);
      if(!line||!pole)continue;
      const key=this.compact(line)+'|'+this.compact(pole);
      if(!cleanRefs.some(x=>x.key===key))cleanRefs.push({line,pole,key});
    }
    if(cleanRefs.length>1)return cleanRefs.map(r=>`${r.line}-${r.pole}`).join(', ');
    return '';
  },
  displayTitle(a){
    const isPole=this.isPoleTower(a);
    const inferred=this.inferredTitle(a);
    if(isPole&&inferred)return inferred;
    const gis=this.gisLabel(a);
    const cleaned=this.cleanGisDisplay(gis);
    if(isPole&&cleaned)return cleaned;
    if(cleaned)return cleaned;
    return this.clean(a?.label||a?.structure||a?.equip||a?.substation||a?.line||'Asset');
  },
  isPoleTower(a){
    const raw=a?.raw||{};
    const kind=String(a?.kind||'').toLowerCase();
    const refKind=window.SearchEngine?.isReferencePointAsset?.(a)?(window.SearchEngine?.referenceKind?SearchEngine.referenceKind(a):kind):'';
    const referenceText=[kind,a?.category,a?.type,a?.label,a?.substation,a?.terminal,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.TERMINAL,raw.TERMINAL_NAME,raw.DEPOT_NAME,raw.SEARCH_FIELD,raw.SUBSTATION_TYPE].join(' ').toUpperCase();
    // Do not classify substations, terminals or depots as poles just because fields such as AER_NSP contain "Transmission".
    if(/^(substation|terminal|depot)$/.test(refKind)||/\b(SUBSTATION|SUBSTN|TERMINAL|DEPOT|SWITCHYARD|ZONE SUB)\b/.test(referenceText))return false;
    if(kind==='electrical-enclosure'||kind==='transformer'||kind==='streetlight'||kind==='distribution-pole')return false;
    if(kind==='structure'||kind==='tower'||kind==='pole'||kind==='transmission-structure')return true;
    const structuralText=[kind,a?.category,a?.gisLabel,a?.label,a?.line,a?.structure,a?.rawStructure,raw.STRUCTURE_LABEL,raw.STRUCTURE_ID,raw.STRUCTURE_NO,raw.STRUCT_NO,raw.POLE_NUMBER,raw.POLE_NO,raw.TOWER_NO,raw.STRUC_TYP_DESC,raw.STRUCTURE_TYPE,raw.POLE_TYPE,raw.MATRL_TYP_DESC].join(' ').toUpperCase();
    return /\b(POLE|TOWER|STRUCTURE|STRUC)\b/.test(structuralText);
  },
  assetHtml(a){
    const gps=Number.isFinite(a?.lat)&&Number.isFinite(a?.lon);
    const isPole=this.isPoleTower(a);
    const gis=this.gisLabel(a);
    const line=this.displayLine(a);
    const pole=this.poleNo(a);
    const title=this.displayTitle(a);
    const summaryRows=this.hvSummaryRows(a);
    const crossingWarn=null;
    const infoRows=this.infoRows(a,{gis,line,pole,title});
    const shownValues=[title,gis,line,pole,...summaryRows.map(r=>r[1]),...infoRows.map(r=>r[1])].map(v=>String(v||'').trim()).filter(Boolean);
    const rawRows=this.extraRows(a,shownValues);
    const calculatorMenuHtml=(window.FieldMapSpanWeightCalculator&&typeof window.FieldMapSpanWeightCalculator.calculatorMenuHtmlForAsset==='function')?window.FieldMapSpanWeightCalculator.calculatorMenuHtmlForAsset(a):'';
    const calculatorActions=calculatorMenuHtml?`<div class="popup-calculator-actions single">${calculatorMenuHtml}</div>`:'';
    const maps=gps?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.lat+','+a.lon)}`:'';
    const earth=gps?`https://earth.google.com/web/search/${encodeURIComponent(a.lat+','+a.lon)}`:'';
    const mapLinkTitle=a?.inferredMissingStructure?'Estimated placeholder coordinate - open in Google Maps':'Open in Google Maps';
    const earthLinkTitle=a?.inferredMissingStructure?'Estimated placeholder coordinate - open in Google Earth':'Open in Google Earth';
    const isReferencePoint=!!(window.SearchEngine?.isReferencePointAsset?.(a)||window.MapEngine?.isConnectedReferenceCandidate?.(a));
    const refKind=isReferencePoint&&window.SearchEngine?.referenceKind?SearchEngine.referenceKind(a):String(a?.kind||'').toLowerCase();
    const refId=this.esc(String(a?.id||''));
    const isAllSubstationsView=String(window.MapEngine?.currentDisplay||'').toLowerCase()==='all substations';
    const rawText=Object.entries(a?.raw||{}).map(([k,v])=>`${k} ${v}`).join(' ');
    const refText=[refKind,a?.kind,a?.category,a?.type,a?.label,a?.substation,a?.terminal,rawText].join(' ').toUpperCase();
    const looksDepot=refKind==='depot'||String(a?.kind||'').toLowerCase()==='depot'||/\bDEPOT\b/.test(refText);
    const looksSubOrTerminal=!looksDepot&&(refKind==='substation'||refKind==='terminal'||String(a?.kind||'').toLowerCase()==='substation'||String(a?.kind||'').toLowerCase()==='terminal'||isAllSubstationsView||(!isPole&&/SUBSTATION|SUBSTN|TERMINAL|SWITCHYARD|ZONE SUB|\bTER\b|\bSUB\b/.test(refText)));
    const strictCodes=looksSubOrTerminal?(window.MapEngine?.connectedStrictCodesForReference?.(a)||[]):[];
    const codeFromList=(strictCodes&&strictCodes.length)?String(strictCodes[0]||''):'';
    // Connected lines use ONLY this explicit abbreviation. No derived/proximity/name fallback.
    const connectedCode=String(codeFromList||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const safeConnectedCode=/^[A-Z0-9]{1,6}$/.test(connectedCode)&&/[A-Z]/.test(connectedCode)?connectedCode:'';
    const canShowConnected=!!(looksSubOrTerminal&&safeConnectedCode);
    const refToken=canShowConnected?(window.MapEngine?.registerConnectedReferenceAsset?.(a)||String(a?.id||'')):'';
    const connectedActive=canShowConnected&&window.MapEngine?.isConnectedReferenceActive?.(refToken,safeConnectedCode);
    const connectedCircuitsAction=canShowConnected?`<button class="show-connected-circuits-btn always-visible" type="button" data-connected-token="${this.esc(refToken)}" data-connected-code="${this.esc(safeConnectedCode)}" onclick="return window.fmConnectedBtn?.(this,event);">${connectedActive?'Hide':'Show'} connected circuits</button>`:'';
    const rawSubtitle=!isPole&&!looksDepot?this.clean(SearchEngine.subtitle(a)):'';
    const subtitle=(safeConnectedCode&&this.compact(rawSubtitle)===this.compact(safeConnectedCode))?'':rawSubtitle;
    const codeLine=canShowConnected&&safeConnectedCode?`<div class="popup-sub ref-abbrev">${this.esc(safeConnectedCode)}</div>`:'';
    const titleToken=window.MapEngine?.registerPopupAsset?.(a)||String(a?.id||'');
    const titleArg=this.esc(encodeURIComponent(String(titleToken||'')));
    const utilityTypes=(window.MapEngine?.utilityContextTypesForAsset?.(a)||[]);
    const hasUtilityContext=utilityTypes.length>0;
    const hasUtilityRoute=utilityTypes.some(c=>c&&(c.geomText||c.pointText));
    const hasNonEsaUtility=hasUtilityContext&&utilityTypes.some(c=>!['esa','petroleum'].includes(String(c?.type||'')));
    const hasEsaOnly=hasUtilityContext&&!hasNonEsaUtility&&utilityTypes.some(c=>String(c?.type||'')==='esa');
    const utilityLabel=hasUtilityRoute?'Show utility route':'Show utility';
    const utilityMapAction=(hasUtilityRoute||hasNonEsaUtility)?`<div class="popup-actions utility-map-action"><button type="button" class="popup-btn utility-map-btn" onclick="return window.MapEngine?.showPopupAssetUtilityContext?.('${titleArg}',event);">${utilityLabel}</button></div>`:(hasEsaOnly?`<div class="popup-actions utility-map-action"><button type="button" class="popup-btn utility-map-btn secondary-utility" onclick="return window.MapEngine?.toggleEsaFromPopup?.(event);">Show ESA layer</button></div>`:'');
    return `<div class="asset-popup">
      <button class="popup-title popup-title-zoom" type="button" title="Zoom to asset" onclick="return window.MapEngine?.zoomToPopupAsset?.('${titleArg}',event);">${this.esc(title)}</button>
      ${codeLine}
      ${a?.inferredMissingStructure?`<div class="popup-missing-warning">NO DATA FOUND · estimated from neighbouring confirmed structures</div>`:''}
      ${subtitle?`<div class="popup-sub">${this.esc(subtitle)}</div>`:''}
      ${summaryRows.length?`<div class="popup-grid popup-summary">${this.rows(summaryRows)}</div>`:''}
      ${window.UtilitiesEngine?.assetBadgeHtml?UtilitiesEngine.assetBadgeHtml(a):''}
      ${utilityMapAction}
      <div class="popup-actions ${gps?'three':''}">
        ${gps?`<a href="${maps}" target="_blank" rel="noopener" title="${mapLinkTitle}" aria-label="${mapLinkTitle}">Google Maps</a><a href="${earth}" target="_blank" rel="noopener" title="${earthLinkTitle}" aria-label="${earthLinkTitle}">Google Earth</a>`:`<button class="secondary" type="button">No map point</button>`}
      </div>
      <details class="popup-more-details"><summary class="more-info-btn">More info</summary><div class="popup-more"><div class="popup-section-title">More info</div>${calculatorActions}<div class="popup-info-box">${crossingWarn?`<div class="popup-crossing-warning">${this.esc(crossingWarn.text)}</div>`:''}${this.rows(infoRows)}${this.utilityDetailsHtml(a)}${rawRows}</div></div></details>
      ${connectedCircuitsAction?`<div class="popup-reference-actions">${connectedCircuitsAction}</div>`:''}
    </div>`;
  },
  utilityDetailsHtml(a){
    const list=window.MapEngine?.utilityContextTypesForAsset?.(a)||[];
    if(!list.length)return '';
    const rows=[];
    const add=(k,v)=>{v=this.clean(v); if(v)rows.push([k,v]);};
    for(const c of list){
      const parts=[];
      if(c.distanceLabel)parts.push(c.distanceLabel);
      if(c.detail)parts.push(c.detail);
      add(c.label||'Nearby utility',parts.join(' · '));
    }
    if(!rows.length)return '';
    return `<div class="popup-section-title">Nearby utilities / cables</div>${this.rows(rows)}`;
  },
  detailSourceAsset(a,line='',pole=''){
    try{
      const rawKeys=Object.keys(a?.raw||{}).length;
      const hasCore=rawKeys>6&&(a?.poleHeight||a?.poleLength||a?.material||a?.category||this.firstRaw(a,[/STRUC.*TYP/i,/POLE.*HEIGHT/i,/POLE.*LEN/i,/MATRL/i,/MATERIAL/i]));
      if(!a?.inferredMissingStructure&&hasCore)return a;
      const hit=window.SearchEngine?.findDetailAsset?.(line,pole,a);
      return hit||a;
    }catch(e){return a;}
  },
  infoRows(a,{gis,line,pole,title}){
    const src=this.detailSourceAsset(a,line,pole)||a;
    const raw=src?.raw||{};
    const get=(patterns)=>this.firstRaw(src,patterns);
    const rows=[];
    const add=(k,v)=>{v=this.clean(v); if(v)rows.push([k,v]);};
    if(src!==a)add('Data source','matched imported pole/tower record');
    if(src?.publicRecovery||src?.sourceQuality==='public-recovery-real-gps'||src?.raw?.PUBLIC_RECOVERY){
      add('Data status','RECOVERED PUBLIC GPS point');
      add('Recovery source','Cleaned public transmission pole dataset');
      if(src?.raw?.PUBLIC_DUPLICATE_COUNT)add('Raw duplicates collapsed',src.raw.PUBLIC_DUPLICATE_COUNT);
      if(src?.raw?.PUBLIC_COORD_VARIANTS&&Number(src.raw.PUBLIC_COORD_VARIANTS)>1)add('Coordinate variants',src.raw.PUBLIC_COORD_VARIANTS);
    }
    if(a?.inferredMissingStructure){
      add('Data status',src!==a?'Estimated map point; details recovered from imported pole/tower record':'NO DATA FOUND - estimated placeholder');
      if(a?.inferredFrom?.before||a?.inferredFrom?.after)add('Estimated between',`${a.inferredFrom.before||'?'} → ${a.inferredFrom.after||'?'}`);
      if(Number.isFinite(Number(a?.lat))&&Number.isFinite(Number(a?.lon)))add('Map links','Google Maps / Google Earth use this estimated placeholder coordinate');
    }
    add('GIS label',gis||this.gisLabel(src));
    add('Line',line);
    add('Pole',pole);
    if(Array.isArray(src?.inferredLineRefs)&&src.inferredLineRefs.length){
      add('Inferred circuit',src.inferredLineRefs.map(r=>`${r.line}${r.pole?'-'+r.pole:''}`).join(', '));
    }
    add('Type',src?.category||get([/STRUC_TYP_DESC/i,/STRUCTURE_TYPE/i,/ASSET_TYPE/i,/TYPE$/i]));
    add('Pole type',get([/^pole_type$/i,/POLE.*TYPE/i]));
    add('Structure type',get([/STRUC.*TYP.*DESC/i,/SUB_STRUC_DESC/i,/STRUC_CAT_DESC/i]));
    add('Material',src?.material||get([/MATERIAL/i,/MATRL/i]));
    add('Conductor',src?.conductor||get([/CONDUCTOR/i,/WIRE_TYPE/i,/OPGW/i]));
    const conductorLinks=Array.isArray(src?.conductorLinks)&&src.conductorLinks.length?src.conductorLinks:(window.SearchEngine?.conductorLinksForAsset?.(src)||window.SearchEngine?.conductorLinksForAsset?.(a)||[]);
    if(conductorLinks.length){
      add('Conductor span',conductorLinks.slice(0,4).map(l=>`${l.line} ${l.fromPole}-${l.toPole}: ${l.conductor}`).join('; '));
    }
    add('Voltage',src?.voltage||get([/VOLTAGE/i,/\bKV\b/i]));
    for(const row of this.hvInfoRows(src)){add(row[0],row[1]);}
    add('Pole length',src?.poleLength||get([/POLE.*LEN/i,/LENGTH/i]));
    add('Pole height',src?.poleHeight||get([/POLE.*HEIGHT/i,/HEIGHT/i]));
    add('Drawing',get([/NP_DWG_NO/i,/DRAWING/i,/DWG/i]));
    const seen=new Set();
    return rows.filter(([k,v])=>{
      const key=`${k}|${v}`.toUpperCase();
      if(seen.has(key))return false;
      seen.add(key);
      return v && String(v)!==String(title);
    });
  },
  rows(rows){
    return rows.filter(([,v])=>v!==undefined&&v!==null&&String(v).trim()!=='').map(([k,v])=>`<div class="popup-row"><b>${this.esc(k)}</b><span>${this.esc(v)}</span></div>`).join('');
  },
  prettyKey(k){
    const map={trmsn_line_gis_label:'GIS label',pole_type:'Pole type',NP_DWG_NO:'Drawing',STRUC_TYP_DESC:'Structure type',SUB_STRUC_DESC:'Sub structure',STRUC_CAT_DESC:'Category',OBJECTID:'Object ID',UTILITY_DETAIL_SUMMARY:'Service detail summary'};
    if(map[k])return map[k];
    return String(k).replace(/^original\./i,'').replace(/^DETAIL /i,'Detail ').replace(/_/g,' ').replace(/\b(kpa|kv|dn|id|gps|hv|ug)\b/ig,m=>m.toUpperCase()).replace(/\b\w/g,c=>c.toUpperCase());
  },
  safeFileName(name){return String(name||'').replace(/_?WP_\d{3}/ig,'').replace(/_?WA_GDA2020/ig,'').replace(/_?Public_Secure/ig,'').replace(/NCMT_/ig,'').replace(/_/g,' ').replace(/\s+/g,' ').trim();},
  safeSource(label){return String(label||'').replace(/geojson/ig,'map file').replace(/json/ig,'JSON').replace(/csv/ig,'CSV');},
  coord(v){
    const n=Number(v);
    return Number.isFinite(n)?String(Math.round(n*1000000)/1000000):String(v);
  },
  extraRows(a,shownValues=[]){
    const raw=a?.raw||{};
    const shown=new Set(shownValues.map(v=>String(v||'').trim()).filter(Boolean));
    const skip=/^(ROUTE_COORDS|coordinates|geometry|SHAPE|the_geom|x|y|lat|lon|latitude|longitude|gps_?lat|gps_?lon|gps_?long|gps|geometry\.x|geometry\.y|source_coords\..*|source_coords|GEOMETRY_TYPE|source|source_type|sourceType|source_file|sourceFile|sourceFiles|sources|file|filename|file_name|parser|parserVersion|importedAt|storageKey|UTILITY_.*|NEARBY_(?:HV(?:_CABLE)?|WATER|SEWER|RAIL|ESA|PETROLEUM|GAS)_.*)$/i;
    const isDepot=(window.SearchEngine?.referenceKind?.(a)==='depot')||String(a?.kind||'').toLowerCase()==='depot'||/\bDEPOT\b/i.test([a?.label,a?.substation,a?.terminal,raw.DEPOT_NAME,raw.SEARCH_FIELD].join(' '));
    const depotAbbrevSkip=/^(ABBREVIATION|ABBREV|ABBR|ACRONYM|SHORT_NAME|SHORTCODE|CODE|ALIAS|SITE_CODE|STATION_CODE|STN_CODE|SUBSTATION_CODE|SUBSTN_CODE|SUB_CODE|TERMINAL_CODE|TER_CODE|TERMINAL_ABBR|SUBSTATION_ABBR)$/i;
    const preferred=/trmsn.*line.*gis.*label|pole_type|struc.*typ|sub_struc|struc_cat|np_dwg|line|circuit|feeder|route|name|label|structure|pole|tower|asset|type|class|voltage|conductor|height|length|material|substation|street|transformer|kva|objectid|utility|nearby|nearest|pressure|kpa|kv|voltage|diam|size/i;
    const entries=Object.entries(raw)
      .filter(([k,v])=>v!==undefined&&v!==null&&String(v).trim()!==''&&!skip.test(k)&&!(isDepot&&depotAbbrevSkip.test(k))&&String(v).length<120)
      .sort((a,b)=>(preferred.test(b[0])?1:0)-(preferred.test(a[0])?1:0))
      .filter(([k,v])=>!shown.has(String(v).trim()))
      .slice(0,12);
    if(!entries.length)return '';
    return entries.map(([k,v])=>`<div class="popup-row"><b>${this.esc(this.prettyKey(k))}</b><span>${this.esc(v)}</span></div>`).join('');
  }
};

/* myMap v3.1.189: clearer nearby utility popup summary. */
(function(){
  const PE=window.PopupEngine||PopupEngine;
  if(!PE||PE.__v189UtilityPopup)return; PE.__v189UtilityPopup=true;
  const oldAssetHtml=PE.assetHtml.bind(PE);
  const clean=(v)=>String(v??'').trim();
  const isRoute=(c)=>!!(clean(c?.geomText)||clean(c?.pointText));
  const isEsa=(c)=>String(c?.type||'').toLowerCase()==='esa';
  const isArea=(c)=>['esa','petroleum'].includes(String(c?.type||'').toLowerCase());
  PE.utilityClarityHtml=function(a){
    const list=(window.MapEngine?.utilityContextTypesForAsset?.(a)||[]).filter(Boolean);
    if(!list.length)return '';
    const routeCount=list.filter(isRoute).length;
    const infoCount=list.length-routeCount;
    const token=window.MapEngine?.registerPopupAsset?.(a)||String(a?.id||'');
    const arg=this.esc(encodeURIComponent(String(token||'')));
    const chips=list.slice(0,8).map(c=>{
      const cls=isRoute(c)?'route':(isEsa(c)?'area':'info');
      const tag=isRoute(c)?'line':(isArea(c)?'area':'info');
      const name=this.esc(c?.short||c?.label||'Utility');
      const dist=this.esc(c?.distanceLabel||'');
      return `<span class="${cls}" style="--u:${this.esc(c?.color||'#1f5b2d')}"><b>${name}</b><em>${tag}${dist?' · '+dist:''}</em></span>`;
    }).join('');
    const hint=routeCount?`${routeCount} can draw a line · ${infoCount} info/area only`:`No route line imported · info/area only`;
    const btn=routeCount?`Show utility lines (${routeCount})`:(list.some(isEsa)?'Show ESA / utility info':'Show utility info');
    return `<div class="popup-utility-clarity"><div class="puc-head"><b>Nearby utilities</b><small>${this.esc(hint)}</small></div><div class="puc-chips">${chips}</div><button type="button" class="popup-btn utility-map-btn puc-btn" onclick="return window.MapEngine?.showPopupAssetUtilityContext?.('${arg}',event);">${this.esc(btn)}</button></div>`;
  };
  PE.assetHtml=function(a){
    let html=oldAssetHtml(a);
    const block=this.utilityClarityHtml(a);
    if(!block)return html;
    // Remove the old single utility button, then insert the clearer summary before map links.
    html=html.replace(/<div class="popup-actions utility-map-action">[\s\S]*?<\/div>/,'');
    const idx=html.indexOf('<div class="popup-actions');
    if(idx>=0)return html.slice(0,idx)+block+html.slice(idx);
    return html.replace('</div>',block+'</div>');
  };
  const oldUtilityDetails=PE.utilityDetailsHtml?.bind(PE);
  PE.utilityDetailsHtml=function(a){
    const list=(window.MapEngine?.utilityContextTypesForAsset?.(a)||[]).filter(Boolean);
    if(!list.length)return oldUtilityDetails?oldUtilityDetails(a):'';
    const rows=[];
    const add=(k,v)=>{v=this.clean(v); if(v)rows.push([k,v]);};
    for(const c of list){
      const status=isRoute(c)?'route line available':(isArea(c)?'area/info only - no route line':'info only - no route line');
      const parts=[status,c.distanceLabel,c.detail].filter(Boolean);
      add(c.label||'Nearby utility',parts.join(' · '));
    }
    return `<div class="popup-section-title">Nearby utilities / ESA</div>${this.rows(rows)}`;
  };
})();

/* myMap v3.1.190: single clean utility detail card, no repeated utility chips/summary. */
(function(){
  const PE=window.PopupEngine||PopupEngine;
  if(!PE||PE.__v190UtilityDetailPopup)return; PE.__v190UtilityDetailPopup=true;
  const clean=(v)=>String(v??'').trim();
  const isRoute=(c)=>!!(clean(c?.geomText)||clean(c?.pointText));
  const typeOf=(c)=>String(c?.type||'').toLowerCase();
  const isEsa=(c)=>typeOf(c)==='esa';
  const isArea=(c)=>['esa','petroleum','gas'].includes(typeOf(c))&&isEsa(c);
  const utilityName=(c)=>clean(c?.short)||clean(c?.label)||'Utility';
  const statusText=(c)=>isRoute(c)?'route line':(isEsa(c)?'area overlay':'info only');
  const detailText=(c)=>{
    const bits=[];
    const d=clean(c?.distanceLabel); if(d)bits.push(d);
    const det=clean(c?.detail); if(det)bits.push(det);
    if(!bits.length&&isEsa(c))bits.push('inside ESA area');
    return bits.join(' · ');
  };
  PE.utilityClarityHtml=function(a){
    const list=(window.MapEngine?.utilityContextTypesForAsset?.(a)||[]).filter(Boolean);
    if(!list.length)return '';
    const routes=list.filter(isRoute);
    const infos=list.filter(c=>!isRoute(c));
    const hasEsa=list.some(isEsa);
    const token=window.MapEngine?.registerPopupAsset?.(a)||String(a?.id||'');
    const arg=this.esc(encodeURIComponent(String(token||'')));
    const rows=list.slice(0,8).map(c=>{
      const cls=isRoute(c)?'route':(isEsa(c)?'area':'info');
      const name=this.esc(utilityName(c));
      const state=this.esc(statusText(c));
      const detail=this.esc(detailText(c));
      return `<div class="utility-detail-row ${cls}" style="--u:${this.esc(c?.color||'#1f5b2d')}"><div class="utility-detail-main"><span></span><b>${name}</b><em>${state}</em></div>${detail?`<div class="utility-detail-sub">${detail}</div>`:''}</div>`;
    }).join('');
    const lineSummary=routes.length?`${routes.length} line${routes.length===1?'':'s'} can draw`:'no route line';
    const infoSummary=infos.length?`${infos.length} info/area only`:'';
    const headerSmall=[lineSummary,infoSummary].filter(Boolean).join(' · ');
    const routeLabel=routes.length===1?`Show ${this.esc(utilityName(routes[0]))} route`:`Show utility routes (${routes.length})`;
    const routeBtn=routes.length?`<button type="button" class="popup-btn utility-map-btn puc-btn" onclick="return window.MapEngine?.showPopupAssetUtilityContext?.('${arg}',event);">${routeLabel}</button>`:'';
    const esaBtn=hasEsa?`<button type="button" class="popup-btn utility-map-btn puc-btn secondary-utility" onclick="return window.MapEngine?.toggleEsaFromPopup?.(event);">Show ESA overlay</button>`:'';
    const note=infos.length?`<div class="utility-detail-note">Only rows marked <b>route line</b> draw as lines. Info/area rows are proximity or overlay context.</div>`:'';
    return `<div class="popup-utility-clarity utility-detail-card"><div class="puc-head"><b>Nearby utility detail</b><small>${this.esc(headerSmall)}</small></div><div class="utility-detail-list">${rows}</div><div class="utility-detail-actions">${routeBtn}${esaBtn}</div>${note}</div>`;
  };
  const oldAssetHtml=PE.assetHtml.bind(PE);
  PE.assetHtml=function(a){
    let html=oldAssetHtml(a);
    // Remove duplicated quick summaries now represented in the utility detail card.
    html=html.replace(/<div class="popup-grid popup-summary">[\s\S]*?<\/div>/g,(m)=>/Nearby\s+HV/i.test(m)?'':m);
    html=html.replace(/<div class="utility-badge-row">[\s\S]*?<\/div>/g,'');
    // If an older utility card/button slipped in, keep only the v190 detail card.
    const cards=[...html.matchAll(/<div class="popup-utility-clarity(?! utility-detail-card)[\s\S]*?<\/div>\s*<button[\s\S]*?<\/button>\s*<\/div>/g)];
    for(const m of cards)html=html.replace(m[0],'');
    return html;
  };
  PE.utilityDetailsHtml=function(a){
    const list=(window.MapEngine?.utilityContextTypesForAsset?.(a)||[]).filter(Boolean);
    if(!list.length)return '';
    const rows=[];
    const add=(k,v)=>{v=this.clean(v); if(v)rows.push([k,v]);};
    for(const c of list){
      const name=utilityName(c);
      const status=statusText(c);
      const detail=detailText(c);
      add(name,`${status}${detail?' · '+detail:''}`);
    }
    return `<div class="popup-section-title">Utility details</div>${this.rows(rows)}`;
  };
})();

/* myMap v3.1.191: cleaner utility details + More info asset-only. */
(function(){
  const PE=window.PopupEngine||PopupEngine;
  if(!PE||PE.__v191UtilityAssetOnly)return; PE.__v191UtilityAssetOnly=true;
  const clean=(v)=>String(v??'').trim();
  const isRoute=(c)=>!!(clean(c?.geomText)||clean(c?.pointText));
  const typeOf=(c)=>String(c?.type||'').toLowerCase();
  const isEsa=(c)=>typeOf(c)==='esa';
  const isArea=(c)=>['esa','petroleum','gas'].includes(typeOf(c));
  const utilityName=(c)=>clean(c?.short)||clean(c?.label)||'Utility';
  const stateText=(c)=>isRoute(c)?'route line':(isEsa(c)?'ESA area':'nearby info');
  const detailText=(c)=>{
    const bits=[];
    const dist=clean(c?.distanceLabel); if(dist)bits.push(dist);
    const det=clean(c?.detail); if(det)bits.push(det);
    if(!bits.length&&isEsa(c))bits.push('inside ESA area');
    return bits.join(' · ');
  };
  PE.utilityDetailsHtml=function(){return '';};
  PE.utilityClarityHtml=function(a){
    const list=(window.MapEngine?.utilityContextTypesForAsset?.(a)||[]).filter(Boolean);
    if(!list.length)return '';
    const routes=list.filter(isRoute);
    const hasEsa=list.some(isEsa);
    const token=window.MapEngine?.registerPopupAsset?.(a)||String(a?.id||'');
    const arg=this.esc(encodeURIComponent(String(token||'')));
    const rows=list.slice(0,8).map(c=>{
      const cls=isRoute(c)?'route':(isEsa(c)?'area':'info');
      const name=this.esc(utilityName(c));
      const state=this.esc(stateText(c));
      const dist=this.esc(clean(c?.distanceLabel));
      const detail=this.esc(detailText(c));
      const label=dist?`${state} · ${dist}`:state;
      return `<details class="utility-mini-row ${cls}" style="--u:${this.esc(c?.color||'#1f5b2d')}"><summary><span></span><b>${name}</b><em>${label}</em></summary>${detail?`<div>${detail}</div>`:''}</details>`;
    }).join('');
    const routeLabel=routes.length===1?`Show ${this.esc(utilityName(routes[0]))} route`:`Show utility routes (${routes.length})`;
    const routeBtn=routes.length?`<button type="button" class="popup-btn utility-map-btn puc-btn" onclick="return window.MapEngine?.showPopupAssetUtilityContext?.('${arg}',event);">${routeLabel}</button>`:'';
    const esaBtn=hasEsa?`<button type="button" class="popup-btn utility-map-btn puc-btn secondary-utility" onclick="return window.MapEngine?.toggleEsaFromPopup?.(event);">ESA layer</button>`:'';
    const head=routes.length?`${routes.length} route line${routes.length===1?'':'s'} available`:'area/info only';
    return `<div class="popup-utility-clarity utility-detail-card utility-detail-card-v191"><div class="puc-head"><b>Nearby utilities</b><small>${this.esc(head)}</small></div><div class="utility-mini-list">${rows}</div><div class="utility-detail-actions">${routeBtn}${esaBtn}</div></div>`;
  };
  const oldAssetHtml=PE.assetHtml.bind(PE);
  PE.assetHtml=function(a){
    let html=oldAssetHtml(a);
    // Remove old duplicated utility blocks and keep More info to actual dot/asset fields only.
    html=html.replace(/<div class="popup-grid popup-summary">[\s\S]*?<\/div>/g,(m)=>/Nearby\s+HV/i.test(m)?'':m);
    html=html.replace(/<div class="utility-badge-row">[\s\S]*?<\/div>/g,'');
    html=html.replace(/<div class="popup-section-title">Utility details<\/div>[\s\S]*?(?=<\/div><\/div><\/details>)/g,'');
    html=html.replace(/<div class="popup-section-title">Nearby utilities \/ ESA<\/div>[\s\S]*?(?=<\/div><\/div><\/details>)/g,'');
    html=html.replace(/<div class="popup-section-title">Nearby utilities \/ cables<\/div>[\s\S]*?(?=<\/div><\/div><\/details>)/g,'');
    return html;
  };
})();

/* myMap v3.1.192: clean asset popup, fixed map buttons, utility detail only in popup card. */
(function(){
  const PE=window.PopupEngine||PopupEngine;
  if(!PE||PE.__v192CleanPopup)return; PE.__v192CleanPopup=true;
  const clean=(v)=>String(v??'').trim();
  const typeOf=(c)=>String(c?.type||'').toLowerCase();
  const isRoute=(c)=>!!(clean(c?.geomText)||clean(c?.pointText));
  const isEsa=(c)=>typeOf(c)==='esa';
  const utilityName=(c)=>clean(c?.short)||clean(c?.label)||'Utility';
  const routeWord=(n)=>`${n} route line${n===1?'':'s'} available`;
  const stateText=(c)=>isRoute(c)?'route line':(isEsa(c)?'area overlay':'info only');
  const detailText=(c)=>{
    const bits=[];
    const dist=clean(c?.distanceLabel); if(dist)bits.push(dist);
    const det=clean(c?.detail); if(det)bits.push(det);
    if(!bits.length&&isEsa(c))bits.push('inside / touches ESA area');
    return bits.join(' · ');
  };
  PE.utilityDetailsHtml=function(){return '';};
  PE.utilityClarityHtml=function(a){
    const list=(window.MapEngine?.utilityContextTypesForAsset?.(a)||[]).filter(Boolean);
    if(!list.length)return '';
    const routes=list.filter(isRoute);
    const token=window.MapEngine?.registerPopupAsset?.(a)||String(a?.id||'');
    const arg=this.esc(encodeURIComponent(String(token||'')));
    const rows=list.slice(0,8).map(c=>{
      const cls=isRoute(c)?'route':(isEsa(c)?'area':'info');
      const name=this.esc(utilityName(c));
      const state=this.esc(stateText(c));
      const detail=this.esc(detailText(c));
      return `<details class="utility-mini-row ${cls}" style="--u:${this.esc(c?.color||'#1f5b2d')}"><summary><span></span><b>${name}</b><em>${state}</em></summary>${detail?`<div>${detail}</div>`:''}</details>`;
    }).join('');
    const buttonLabel=routes.length===1?`Show ${this.esc(utilityName(routes[0]))} route`:`Show route lines (${routes.length})`;
    const btn=routes.length?`<button type="button" class="popup-btn utility-map-btn puc-btn" onclick="return window.MapEngine?.showPopupAssetUtilityContext?.('${arg}',event);">${buttonLabel}</button>`:'';
    const note=list.some(c=>!isRoute(c))?`<div class="utility-detail-note">Only <b>route line</b> rows draw. <b>Info only</b> is proximity detail. <b>Area overlay</b> is toggled from Map Layers.</div>`:'';
    const head=routes.length?routeWord(routes.length):'no route line for this asset';
    return `<div class="popup-utility-clarity utility-detail-card utility-detail-card-v192"><div class="puc-head"><b>Nearby utilities</b><small>${this.esc(head)}</small></div><div class="utility-mini-list">${rows}</div>${btn?`<div class="utility-detail-actions">${btn}</div>`:''}${note}</div>`;
  };
  function filteredInfoRows(pe,a,ctx){
    const rows=(pe.infoRows?.(a,ctx)||[]).filter(([k])=>!/nearby|hv\s*cable|utility|esa|water|sewer|petroleum|gas/i.test(String(k||'')));
    return rows;
  }
  PE.assetHtml=function(a){
    const gps=Number.isFinite(a?.lat)&&Number.isFinite(a?.lon);
    const isPole=this.isPoleTower(a);
    const gis=this.gisLabel(a);
    const line=this.displayLine(a);
    const pole=this.poleNo(a);
    const title=this.displayTitle(a);
    const utilityBlock=this.utilityClarityHtml(a);
    const infoRows=filteredInfoRows(this,a,{gis,line,pole,title});
    const shownValues=[title,gis,line,pole,...infoRows.map(r=>r[1])].map(v=>String(v||'').trim()).filter(Boolean);
    const rawRows=this.extraRows(a,shownValues);
    const calculatorMenuHtml=(window.FieldMapSpanWeightCalculator&&typeof window.FieldMapSpanWeightCalculator.calculatorMenuHtmlForAsset==='function')?window.FieldMapSpanWeightCalculator.calculatorMenuHtmlForAsset(a):'';
    const calculatorActions=calculatorMenuHtml?`<div class="popup-calculator-actions single">${calculatorMenuHtml}</div>`:'';
    const maps=gps?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.lat+','+a.lon)}`:'';
    const earth=gps?`https://earth.google.com/web/search/${encodeURIComponent(a.lat+','+a.lon)}`:'';
    const mapLinkTitle=a?.inferredMissingStructure?'Estimated placeholder coordinate - open in Google Maps':'Open in Google Maps';
    const earthLinkTitle=a?.inferredMissingStructure?'Estimated placeholder coordinate - open in Google Earth':'Open in Google Earth';
    const isReferencePoint=!!(window.SearchEngine?.isReferencePointAsset?.(a)||window.MapEngine?.isConnectedReferenceCandidate?.(a));
    const refKind=isReferencePoint&&window.SearchEngine?.referenceKind?SearchEngine.referenceKind(a):String(a?.kind||'').toLowerCase();
    const isAllSubstationsView=String(window.MapEngine?.currentDisplay||'').toLowerCase()==='all substations';
    const rawText=Object.entries(a?.raw||{}).map(([k,v])=>`${k} ${v}`).join(' ');
    const refText=[refKind,a?.kind,a?.category,a?.type,a?.label,a?.substation,a?.terminal,rawText].join(' ').toUpperCase();
    const looksDepot=refKind==='depot'||String(a?.kind||'').toLowerCase()==='depot'||/\bDEPOT\b/.test(refText);
    const looksSubOrTerminal=!looksDepot&&(refKind==='substation'||refKind==='terminal'||String(a?.kind||'').toLowerCase()==='substation'||String(a?.kind||'').toLowerCase()==='terminal'||isAllSubstationsView||(!isPole&&/SUBSTATION|SUBSTN|TERMINAL|SWITCHYARD|ZONE SUB|\bTER\b|\bSUB\b/.test(refText)));
    const strictCodes=looksSubOrTerminal?(window.MapEngine?.connectedStrictCodesForReference?.(a)||[]):[];
    const codeFromList=(strictCodes&&strictCodes.length)?String(strictCodes[0]||''):'';
    const connectedCode=String(codeFromList||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const safeConnectedCode=/^[A-Z0-9]{1,6}$/.test(connectedCode)&&/[A-Z]/.test(connectedCode)?connectedCode:'';
    const canShowConnected=!!(looksSubOrTerminal&&safeConnectedCode);
    const refToken=canShowConnected?(window.MapEngine?.registerConnectedReferenceAsset?.(a)||String(a?.id||'')):'';
    const connectedActive=canShowConnected&&window.MapEngine?.isConnectedReferenceActive?.(refToken,safeConnectedCode);
    const connectedCircuitsAction=canShowConnected?`<button class="show-connected-circuits-btn always-visible" type="button" data-connected-token="${this.esc(refToken)}" data-connected-code="${this.esc(safeConnectedCode)}" onclick="return window.fmConnectedBtn?.(this,event);">${connectedActive?'Hide':'Show'} connected circuits</button>`:'';
    const rawSubtitle=!isPole&&!looksDepot?this.clean(SearchEngine.subtitle(a)):'';
    const subtitle=(safeConnectedCode&&this.compact(rawSubtitle)===this.compact(safeConnectedCode))?'':rawSubtitle;
    const codeLine=canShowConnected&&safeConnectedCode?`<div class="popup-sub ref-abbrev">${this.esc(safeConnectedCode)}</div>`:'';
    const titleToken=window.MapEngine?.registerPopupAsset?.(a)||String(a?.id||'');
    const titleArg=this.esc(encodeURIComponent(String(titleToken||'')));
    const mapLinks=gps?`<div class="popup-actions map-link-actions"><a class="popup-btn" href="${maps}" target="_blank" rel="noopener" title="${mapLinkTitle}" aria-label="${mapLinkTitle}">Google Maps</a><a class="popup-btn" href="${earth}" target="_blank" rel="noopener" title="${earthLinkTitle}" aria-label="${earthLinkTitle}">Google Earth</a></div>`:`<div class="popup-actions map-link-actions single"><button class="popup-btn secondary" type="button">No map point</button></div>`;
    return `<div class="asset-popup asset-popup-v192">
      <button class="popup-title popup-title-zoom" type="button" title="Zoom to asset" onclick="return window.MapEngine?.zoomToPopupAsset?.('${titleArg}',event);">${this.esc(title)}</button>
      ${codeLine}
      ${a?.inferredMissingStructure?`<div class="popup-missing-warning">NO DATA FOUND · estimated from neighbouring confirmed structures</div>`:''}
      ${subtitle?`<div class="popup-sub">${this.esc(subtitle)}</div>`:''}
      ${window.UtilitiesEngine?.assetBadgeHtml?UtilitiesEngine.assetBadgeHtml(a):''}
      ${utilityBlock}
      ${mapLinks}
      <details class="popup-more-details"><summary class="more-info-btn">More info</summary><div class="popup-more"><div class="popup-section-title">More info</div><div class="popup-info-box">${this.rows(infoRows)}${rawRows}</div>${calculatorActions}</div></details>
      ${connectedCircuitsAction?`<div class="popup-reference-actions">${connectedCircuitsAction}</div>`:''}
    </div>`;
  };
})();


/* myMap v3.1.201: show transformer/enclosure derived HV kV/phases clearly. */
(function(){
  const PE=window.PopupEngine||PopupEngine;
  if(!PE||PE.__v201HvAssetCard)return; PE.__v201HvAssetCard=true;
  const clean=(v)=>String(v??'').trim();
  const esc=(v)=>PE.esc?PE.esc(v):String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function isTxOrBox(a){
    const raw=a?.raw||{};
    const t=[a?.kind,a?.category,a?.type,a?.label,a?.sourceFile,raw.asset_type,raw.ASSET_TYPE,raw.type,raw.TYPE].join(' ').toUpperCase();
    return /TRANSFORMER|ELECTRICAL[-_\s]*ENCLOSURE|ENCLOSURE|DISTBOX|DIST\s*BOX|PILLAR|SWITCHGEAR/.test(t);
  }
  function rawFirst(a,names){
    const raw=a?.raw||{};
    for(const want of names){
      for(const [k,v] of Object.entries(raw)){
        if(v===undefined||v===null||String(v).trim()==='')continue;
        if(String(k).toUpperCase()===String(want).toUpperCase())return clean(v);
      }
    }
    return '';
  }
  function hvCtx(a){
    if(!isTxOrBox(a))return null;
    let ctx=null;
    try{ctx=PE.hvContext?PE.hvContext(a,'asset'):null;}catch(_){ctx=null;}
    const out={
      kv:clean(ctx?.kv)||rawFirst(a,['NEARBY_HV_KV','HV_KV','KV','VOLTAGE']),
      phases:clean(ctx?.phases)||rawFirst(a,['NEARBY_HV_PHASES','HV_PHASES','PHASES']),
      type:clean(ctx?.type)||rawFirst(a,['NEARBY_HV_TYPE','HV_TYPE','TYPE']),
      dist:clean(ctx?.dist)||rawFirst(a,['NEARBY_HV_DISTANCE_M','HV_DISTANCE_M','NEAREST_HV_DISTANCE_M']),
      network:clean(ctx?.network)||rawFirst(a,['NEARBY_HV_NETWORK','HV_NETWORK','NETWK_NAME']),
      source:clean(ctx?.source)||rawFirst(a,['NEARBY_HV_SOURCE','HV_SOURCE']),
      status:clean(ctx?.status)||rawFirst(a,['NEARBY_HV_STATUS','HV_INFO_STATUS'])
    };
    if(!out.kv&&!out.phases&&!out.type&&!out.dist&&!out.network&&!out.status)return null;
    return out;
  }
  function hvCard(a){
    const h=hvCtx(a); if(!h)return '';
    const main=[h.kv,h.phases,h.type].filter(Boolean).join(' · ')||'HV context found';
    const dist=h.dist?`${h.dist} m`:'';
    const network=[h.network,dist].filter(Boolean).join(' · ');
    const source=h.status||h.source||'Derived from imported HV route context';
    return `<div class="hv-asset-detail-card"><div class="hv-head"><b>Nearby HV detail</b>${dist?`<small>${esc(dist)}</small>`:''}</div><div class="hv-main">${esc(main)}</div>${network?`<div class="hv-sub">${esc(network)}</div>`:''}<div class="hv-sub">${esc(source)}</div></div>`;
  }
  const oldAssetHtml=PE.assetHtml.bind(PE);
  PE.assetHtml=function(a){
    let html=oldAssetHtml(a);
    if(!html)return html;
    html=html.replace('asset-popup asset-popup-v192','asset-popup asset-popup-v192 asset-popup-v201');
    const card=hvCard(a);
    if(card && !/Nearby HV detail/.test(html)){
      const idx=html.indexOf('<div class="popup-actions map-link-actions');
      if(idx>=0)html=html.slice(0,idx)+card+html.slice(idx);
      else html=html.replace('</div>',card+'</div>');
    }
    return html;
  };
  const oldInfoRows=PE.infoRows?.bind(PE);
  PE.infoRows=function(a,ctx){
    const rows=oldInfoRows?oldInfoRows(a,ctx):[];
    const h=hvCtx(a);
    if(h){
      const add=(k,v)=>{v=clean(v); if(v&&!rows.some(r=>String(r[0]).toLowerCase()===k.toLowerCase()&&String(r[1])===v))rows.push([k,v]);};
      add('Nearby HV kV',h.kv);
      add('Nearby HV phases',h.phases);
      add('Nearby HV type',h.type);
      add('Nearby HV distance',h.dist?`${h.dist} m`:'');
      add('Nearby HV network',h.network);
      add('HV info status',h.status);
    }
    return rows;
  };
})();

/* myMap v3.1.204: normalise HV voltage/phase display everywhere.
   22 kV = network class, 12.7 kV = phase-earth on 1-phase 22 kV systems. */
(function(){
  const PE=window.PopupEngine;
  if(!PE||PE.__v203HvVoltageFix)return; PE.__v203HvVoltageFix=true;
  const clean=v=>String(v??'').replace(/^\uFEFF/,'').trim();
  const esc=s=>PE.esc?PE.esc(s):String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function firstNumber(text){const m=clean(text).replace(/,/g,' ').match(/\b(\d+(?:\.\d+)?)\b/); return m?Number(m[1]):NaN;}
  function fmt(n){n=Number(n); if(!Number.isFinite(n))return ''; return Math.abs(n-Math.round(n))<0.05?`${Math.round(n)} kV`:`${n.toFixed(1).replace(/\.0$/,'')} kV`;}
  function fmtDist(v){const t=clean(v); if(!t)return ''; const n=Number(t.replace(/[^0-9.\-]/g,'')); return Number.isFinite(n)?`${Math.round(n*10)/10} m`:t.replace(/\s*m$/i,' m');}
  function phaseFrom(text, fallback=''){
    text=[text,fallback].map(clean).filter(Boolean).join(' ');
    let m=text.match(/\b([123])\s*ph\b/i); if(m)return `${m[1]}Ph`;
    m=text.match(/^\s*([123])\s*$/); if(m)return `${m[1]}Ph`;
    if(/single\s*phase|one\s*phase/i.test(text))return '1Ph';
    if(/two\s*phase/i.test(text))return '2Ph';
    if(/three\s*phase/i.test(text))return '3Ph';
    return '';
  }
  function typeFrom(text){
    text=clean(text);
    if(/\bHVUG\b|UNDER\s*GROUND|UNDERGROUND|\bUG\b/i.test(text))return 'HVUG';
    if(/\bHVOH\b|OVER\s*HEAD|OVERHEAD|\bOH\b/i.test(text))return 'HVOH';
    return '';
  }
  function phaseEarthNetwork(n){
    n=Number(n); if(!Number.isFinite(n))return null;
    if(n>=6.0&&n<=6.8)return {network:11,phaseEarth:Number(n.toFixed(1))};
    if(n>=12.2&&n<=13.3)return {network:22,phaseEarth:Number(n.toFixed(1))};
    if(n>=18.5&&n<=19.6)return {network:33,phaseEarth:Number(n.toFixed(1))};
    return null;
  }
  function parse(input={}){
    const kv=clean(input.kv), phasesRaw=clean(input.phases), typeRaw=clean(input.type), network=clean(input.network), source=clean(input.source), status=clean(input.status), dist=fmtDist(input.dist);
    const all=[kv,phasesRaw,typeRaw,network,source,status].join(' ');
    const phases=phaseFrom(phasesRaw, all);
    const hvType=typeFrom(typeRaw)||typeFrom(all);
    const kvNum=firstNumber(kv);
    const typeNum=firstNumber(typeRaw);
    let networkKv='', phaseEarth='';
    const onePh=phases==='1Ph'||/\b1\s*ph\b/i.test(all);
    if(onePh){
      const peFromType=phaseEarthNetwork(typeNum);
      const peFromKv=phaseEarthNetwork(kvNum);
      if(peFromType){phaseEarth=fmt(peFromType.phaseEarth); if(!networkKv)networkKv=fmt(peFromType.network);}
      if(peFromKv && (!/\b(11|22|33)\s*kV\b/i.test(kv) || kvNum<20)){phaseEarth=phaseEarth||fmt(peFromKv.phaseEarth); networkKv=networkKv||fmt(peFromKv.network);}
    }
    if(!networkKv && Number.isFinite(kvNum)){
      let n=kvNum;
      if(n>=18.5&&n<=19.6)n=33;
      networkKv=fmt(n);
    }
    if(!networkKv){
      const m=all.match(/\b(11|22|33|66|132|220|330)\s*kV\b/i);
      if(m)networkKv=`${m[1]} kV`;
    }
    const displayKv=(onePh&&phaseEarth)?phaseEarth:networkKv;
    const bits=[];
    if(displayKv)bits.push(displayKv);
    if(phases)bits.push(phases);
    if(hvType)bits.push(hvType);
    return {displayKv,networkKv,phases,hvType,phaseEarth,network,source,status,dist,summary:bits.join(' · '),phaseEarthLabel:phaseEarth?`${phaseEarth} phase-earth`:''};
  }
  window.myMapHvDisplay={parse,fmt,fmtDist,phaseFrom,typeFrom};

  function rawFirst(a,names){
    const raw=a?.raw||{};
    for(const want of names){
      for(const [k,v] of Object.entries(raw)){
        if(v===undefined||v===null||String(v).trim()==='')continue;
        if(String(k).toUpperCase()===String(want).toUpperCase())return clean(v);
      }
    }
    return '';
  }
  function isTxOrBox(a){
    const txt=[a?.kind,a?.category,a?.label,a?.sourceFile,a?.raw?.asset_type,a?.raw?.ASSET_TYPE,a?.raw?.TYPE].map(clean).join(' ').toUpperCase();
    return /TRANSFORMER|ELECTRICAL[-_\s]*ENCLOSURE|ENCLOSURE|BOX|RMU/.test(txt);
  }
  function hvCtx(a){
    if(!isTxOrBox(a))return null;
    let ctx=null; try{ctx=PE.hvContext?PE.hvContext(a,'asset'):null;}catch(_){ctx=null;}
    const out={
      kv:clean(ctx?.kv)||rawFirst(a,['NEARBY_HV_KV','HV_KV','KV','VOLTAGE']),
      phases:clean(ctx?.phases)||rawFirst(a,['NEARBY_HV_PHASES','HV_PHASES','PHASES']),
      type:clean(ctx?.type)||rawFirst(a,['NEARBY_HV_TYPE','HV_TYPE','TYPE']),
      dist:clean(ctx?.dist)||rawFirst(a,['NEARBY_HV_DISTANCE_M','HV_DISTANCE_M','NEAREST_HV_DISTANCE_M']),
      network:clean(ctx?.network)||rawFirst(a,['NEARBY_HV_NETWORK','HV_NETWORK','NETWK_NAME']),
      source:clean(ctx?.source)||rawFirst(a,['NEARBY_HV_SOURCE','HV_SOURCE']),
      status:clean(ctx?.status)||rawFirst(a,['NEARBY_HV_STATUS','HV_INFO_STATUS'])
    };
    if(!out.kv&&!out.phases&&!out.type&&!out.dist&&!out.network&&!out.status)return null;
    return out;
  }
  function hvCard(a){
    const h=hvCtx(a); if(!h)return '';
    const d=parse(h);
    const main=d.summary||'HV context found';
    const sub=[];
    if(d.network)sub.push(d.network);
    const source=d.status||d.source||'Derived from nearest imported HV OH/UG route within 15 m';
    return `<div class="hv-asset-detail-card hv-v203"><div class="hv-head"><b>Nearby HV detail</b>${d.dist?`<small>${esc(d.dist)}</small>`:''}</div><div class="hv-main">${esc(main)}</div>${sub.length?`<div class="hv-sub">${esc(sub.join(' · '))}</div>`:''}<div class="hv-sub">${esc(source)}</div></div>`;
  }
  function stripOldHvCard(html){
    const start=html.indexOf('<div class="hv-asset-detail-card');
    if(start<0)return html;
    const after=html.indexOf('<div class="popup-actions',start);
    if(after>start)return html.slice(0,start)+html.slice(after);
    return html.replace(/\s*<div class="hv-asset-detail-card[\s\S]*?<\/div>\s*<\/div>/,'');
  }
  const oldAssetHtml=PE.assetHtml?.bind(PE);
  if(oldAssetHtml){
    PE.assetHtml=function(a){
      let html=oldAssetHtml(a); if(!html)return html;
      const card=hvCard(a);
      if(card){
        html=stripOldHvCard(html);
        const idx=html.indexOf('<div class="popup-actions');
        if(idx>=0)html=html.slice(0,idx)+card+html.slice(idx);
      }
      return html;
    };
  }
  const oldInfoRows=PE.infoRows?.bind(PE);
  if(oldInfoRows){
    PE.infoRows=function(a,ctx){
      let rows=oldInfoRows(a,ctx)||[];
      rows=rows.filter(r=>!/^Nearby HV (?:kV|phases|type|distance|network|source)$|^HV info status$/i.test(String(r?.[0]||'')));
      const h=hvCtx(a);
      if(h){
        const d=parse(h);
        const add=(k,v)=>{v=clean(v); if(v&&!rows.some(r=>String(r[0]).toLowerCase()===k.toLowerCase()))rows.push([k,v]);};
        add('HV voltage',d.displayKv);
        add('HV phases',d.phases);
        add('HV type',d.hvType);
        add('HV distance',d.dist);
        add('HV route/network',d.network);
        add('HV info status',d.status);
      }
      return rows;
    };
  }
})();


/* myMap v3.1.206: correct HV phase display everywhere.
   Supports 1Ph, 2Ph and 3Ph. 1Ph displays the conductor phase-earth value; 2Ph/3Ph display network voltage.
   Phase count is kept as its own row; raw long decimals are rounded. */
(function(){
  const PE=window.PopupEngine;
  const clean=v=>String(v??'').replace(/^\uFEFF/,'').trim();
  function firstNum(text){ const m=clean(text).replace(/,/g,' ').match(/\b(\d+(?:\.\d+)?)\b/); return m?Number(m[1]):NaN; }
  function allNums(text){ const ms=clean(text).replace(/,/g,' ').match(/\b\d+(?:\.\d+)?\b/g)||[]; return ms.map(Number).filter(Number.isFinite); }
  function fmt(n){ n=Number(n); if(!Number.isFinite(n))return ''; return Math.abs(n-Math.round(n))<0.05?`${Math.round(n)} kV`:`${n.toFixed(1).replace(/\.0$/,'')} kV`; }
  function fmtDist(v){ const t=clean(v); if(!t)return ''; const n=Number(t.replace(/[^0-9.\-]/g,'')); return Number.isFinite(n)?`${Math.round(n*10)/10} m`:t.replace(/\s*m$/i,' m'); }
  function phaseFrom(text){ text=clean(text); let m=text.match(/\b([123])\s*ph\b/i); if(m)return `${m[1]}Ph`; m=text.match(/^\s*([123])\s*$/); if(m)return `${m[1]}Ph`; if(/single\s*phase|one\s*phase/i.test(text))return '1Ph'; if(/two\s*phase/i.test(text))return '2Ph'; if(/three\s*phase/i.test(text))return '3Ph'; return ''; }
  function typeFrom(text){ text=clean(text); if(/\bHVUG\b|UNDER\s*GROUND|UNDERGROUND|\bUG\b/i.test(text))return 'HVUG'; if(/\bHVOH\b|OVER\s*HEAD|OVERHEAD|\bOH\b/i.test(text))return 'HVOH'; return ''; }
  function networkToPhaseEarth(n){ n=Number(n); if(!Number.isFinite(n))return NaN; if(Math.abs(n-11)<.6)return 6.4; if(Math.abs(n-22)<.8)return 12.7; if(Math.abs(n-33)<1.2)return 19.1; return NaN; }
  function phaseEarthToNetwork(n){ n=Number(n); if(!Number.isFinite(n))return NaN; if(n>=6.0&&n<=6.8)return 11; if(n>=12.0&&n<=13.4)return 22; if(n>=18.5&&n<=19.8)return 33; return NaN; }
  function parse(input={}){
    const kv=clean(input.kv), phasesRaw=clean(input.phases), typeRaw=clean(input.type), network=clean(input.network), source=clean(input.source), status=clean(input.status), dist=fmtDist(input.dist);
    const all=[kv,phasesRaw,typeRaw,network,source,status].filter(Boolean).join(' ');
    let phases=phaseFrom([phasesRaw,typeRaw,kv,all].join(' '));
    const hvType=typeFrom(typeRaw)||typeFrom(all);
    const nums=allNums([typeRaw,kv].join(' '));
    let phaseEarthNum=nums.find(n=>n>=5&&n<20);
    let networkNum=nums.find(n=>n>=20&&n<=330);
    if(!Number.isFinite(networkNum) && Number.isFinite(phaseEarthNum)) networkNum=phaseEarthToNetwork(phaseEarthNum);
    if(phases==='1Ph' && !Number.isFinite(phaseEarthNum) && Number.isFinite(networkNum)) phaseEarthNum=networkToPhaseEarth(networkNum);
    if(!phases && Number.isFinite(phaseEarthNum)) phases='1Ph';
    if(!phases && Number.isFinite(networkNum) && /\b2\s*ph\b/i.test(all)) phases='2Ph';
    if(!phases && Number.isFinite(networkNum) && /\b3\s*ph\b/i.test(all)) phases='3Ph';
    const displayKv=(phases==='1Ph' && Number.isFinite(phaseEarthNum))?fmt(phaseEarthNum):(Number.isFinite(networkNum)?fmt(networkNum):(Number.isFinite(firstNum(kv))?fmt(firstNum(kv)):''));
    const networkKv=Number.isFinite(networkNum)?fmt(networkNum):'';
    const phaseEarth=Number.isFinite(phaseEarthNum)?fmt(phaseEarthNum):'';
    const bits=[]; if(displayKv)bits.push(displayKv); if(phases)bits.push(phases); if(hvType)bits.push(hvType);
    return {displayKv,networkKv,phases,hvType,phaseEarth,network,source,status,dist,summary:bits.join(' · '),phaseEarthLabel:(phases==='1Ph'&&phaseEarth)?`${phaseEarth} phase-earth`:''};
  }
  window.myMapHvDisplay={parse,fmt,fmtDist,phaseFrom,typeFrom};
})();

/* myMap v3.1.212: utility rows always show their details, no collapsed hidden info. */
(function(){
  const PE=window.PopupEngine;
  if(!PE||PE.__v212UtilityRowsVisible)return; PE.__v212UtilityRowsVisible=true;
  const clean=v=>String(v??'').trim();
  const typeOf=c=>String(c?.type||'').toLowerCase();
  const isRoute=c=>!!(clean(c?.geomText)||clean(c?.pointText));
  const isEsa=c=>typeOf(c)==='esa';
  const utilityName=c=>clean(c?.short)||clean(c?.label)||'Utility';
  const stateText=c=>isRoute(c)?'route line':(isEsa(c)?'area overlay':'info only');
  const detailText=c=>{
    const bits=[];
    const dist=clean(c?.distanceLabel); if(dist)bits.push(dist);
    const det=clean(c?.detail); if(det)bits.push(det);
    if(!bits.length&&isEsa(c))bits.push('inside / touches ESA area');
    return bits.join(' · ');
  };
  PE.utilityClarityHtml=function(a){
    const list=(window.MapEngine?.utilityContextTypesForAsset?.(a)||[]).filter(Boolean);
    if(!list.length)return '';
    const routes=list.filter(isRoute);
    const token=window.MapEngine?.registerPopupAsset?.(a)||String(a?.id||'');
    const arg=this.esc(encodeURIComponent(String(token||'')));
    const rows=list.slice(0,8).map(c=>{
      const cls=isRoute(c)?'route':(isEsa(c)?'area':'info');
      const name=this.esc(utilityName(c));
      const state=this.esc(stateText(c));
      const detail=this.esc(detailText(c));
      return `<div class="utility-full-row ${cls}" style="--u:${this.esc(c?.color||'#1f5b2d')}"><div class="utility-full-main"><span></span><b>${name}</b><em>${state}</em></div>${detail?`<div class="utility-full-detail">${detail}</div>`:''}</div>`;
    }).join('');
    const buttonLabel=routes.length===1?`Show ${this.esc(utilityName(routes[0]))} route`:`Show route lines (${routes.length})`;
    const btn=routes.length?`<button type="button" class="popup-btn utility-map-btn puc-btn" onclick="return window.MapEngine?.showPopupAssetUtilityContext?.('${arg}',event);">${buttonLabel}</button>`:'';
    const head=routes.length?`${routes.length} route line${routes.length===1?'':'s'} available`:'info/area only';
    return `<div class="popup-utility-clarity utility-detail-card utility-detail-card-v212"><div class="puc-head"><b>Nearby utilities</b><small>${this.esc(head)}</small></div><div class="utility-full-list">${rows}</div>${btn?`<div class="utility-detail-actions">${btn}</div>`:''}</div>`;
  };
})();
