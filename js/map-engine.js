const MapEngine={
  map:null, layers:{}, markerLayer:null, routeLayer:null, connectedLineLayer:null, utilityLayer:null, userMarker:null, gpsWatchId:null, gpsMode:'free', gpsProfile:'walking', gpsLast:null, gpsError:false, base:'street', satellite:false, drawing:false, drawToken:0, mapRenderer:null, currentDisplay:'none', currentCircuit:null, currentCircuits:[], currentCircuitRoutes:[], lastFullCircuitAssets:[], lastFullCircuitLabel:'', circuitDensityMode:'', gpsNearestCache:null, gpsPanelHidden:false,
  init(){
    if(!window.L){throw new Error('Leaflet failed to load. Check internet connection for map library.');}
    this.map=L.map('map',{zoomControl:false,preferCanvas:true}).setView([-31.9523,115.8613],10);
    this.mapRenderer=L.canvas({padding:0.35});
    this.layers.street=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OpenStreetMap'});
    this.layers.satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'});
    this.layers.topo=L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17,attribution:'© OpenTopoMap'});
    this.layers.street.addTo(this.map);
    this.markerLayer=L.layerGroup().addTo(this.map);
    this.routeLayer=L.layerGroup().addTo(this.map);
    this.connectedLineLayer=L.layerGroup().addTo(this.map);
    this.utilityLayer=L.layerGroup().addTo(this.map);
    this.map.on('popupopen',ev=>this.preparePopupScroll(ev));
    this.map.on('popupclose',()=>{try{this.map.dragging.enable();}catch(e){}});
    this.map.on('zoomend',()=>this.onZoomDensityChange());
    this.loadGpsProfile();
    setTimeout(()=>{this.updateGpsButton();this.updateGpsProfileButtons();},50);
    setTimeout(()=>this.map.invalidateSize(),250);
    // Gutted UI: do not auto-start GPS on boot. User taps + > GPS mode when needed.
  },
  preparePopupScroll(ev){
    setTimeout(()=>{
      const root=ev?.popup?.getElement?.();
      if(!root||!window.L)return;
      const nodes=root.querySelectorAll('.leaflet-popup-content,.asset-popup,.popup-more,.popup-info-box');
      nodes.forEach(el=>{
        try{L.DomEvent.disableScrollPropagation(el);L.DomEvent.disableClickPropagation(el);}catch(e){}
      });
      root.querySelectorAll('.show-connected-circuits-btn').forEach(btn=>{
        // Single inline click handler only. Extra touch/pointer/capture handlers caused
        // double toggles on Samsung/Android preview (show -> hide -> show flicker).
        btn.dataset.connectedBound='1';
      });
      const release=()=>{try{this.map.dragging.enable();}catch(e){}};
      const hold=()=>{try{this.map.dragging.disable();}catch(e){}};
      root.querySelectorAll('.popup-more,.leaflet-popup-content').forEach(el=>{
        if(el.dataset.scrollReady==='1')return;
        el.dataset.scrollReady='1';
        el.addEventListener('touchstart',hold,{passive:true});
        el.addEventListener('touchend',release,{passive:true});
        el.addEventListener('touchcancel',release,{passive:true});
        el.addEventListener('mouseenter',hold,{passive:true});
        el.addEventListener('mouseleave',release,{passive:true});
      });
      this.refitOpenPopup();
    },0);
  },
  popupOptions(){
    return {maxWidth:260,minWidth:150,autoPan:true,keepInView:false,autoPanPaddingTopLeft:[18,88],autoPanPaddingBottomRight:[18,34]};
  },
  focusDot(a,marker,opts={}){
    if(!this.map)return;
    let ll=null;
    try{ll=marker?.getLatLng?.();}catch(e){}
    if(!ll){const p=this.markerLatLng(a); if(p)ll=L.latLng(p[0],p[1]);}
    if(!ll)return;
    const current=Number(this.map.getZoom?.()||0);
    const targetZoom=Number(opts.zoom)||Math.max(current,16);
    try{this.map.setView(ll,targetZoom,{animate:true,duration:0.18});}catch(e){try{this.map.panTo(ll,{animate:true,duration:0.18});}catch(_){}}
    // No delayed snap-back. Once the asset is loaded, user panning must stay free.
  },
  refitOpenPopup(){
    if(!this.map)return;
    const popup=this.map._popup;
    try{popup?.update?.();}catch(e){}
    try{popup?._adjustPan?.();}catch(e){}
    const root=popup?.getElement?.();
    const mapEl=this.map.getContainer?.()||document.getElementById('map');
    if(!root||!mapEl)return;
    try{
      const r=root.getBoundingClientRect();
      const m=mapEl.getBoundingClientRect();
      const topPad=72;
      const bottomPad=24;
      let dx=0,dy=0;
      if(r.left<m.left+8)dx=r.left-(m.left+8);
      else if(r.right>m.right-8)dx=r.right-(m.right-8);
      if(r.top<m.top+topPad)dy=r.top-(m.top+topPad);
      else if(r.bottom>m.bottom-bottomPad)dy=r.bottom-(m.bottom-bottomPad);
      if(dx||dy)this.map.panBy([dx,dy],{animate:true,duration:0.12});
    }catch(e){}
  },
  setBase(layer='street'){
    if(!this.map)return;
    const wanted=this.layers[layer]?layer:'street';
    for(const [name,tile] of Object.entries(this.layers)){
      if(tile&&this.map.hasLayer(tile)&&name!==wanted)this.map.removeLayer(tile);
    }
    if(this.layers[wanted]&&!this.map.hasLayer(this.layers[wanted]))this.layers[wanted].addTo(this.map);
    this.base=wanted;
    this.satellite=wanted==='satellite';
    document.querySelectorAll('[data-base-layer]').forEach(btn=>btn.classList.toggle('active',btn.dataset.baseLayer===wanted));
    const label={street:'Street map',satellite:'Satellite',topo:'Topo'}[wanted]||wanted;
    UI?.toast?.(`${label} layer on`);
  },
  cycleBase(){
    const order=['street','satellite','topo'];
    const i=Math.max(0,order.indexOf(this.base||'street'));
    this.setBase(order[(i+1)%order.length]);
  },
  toggleBase(){
    this.cycleBase();
  },
  async renderAssets(){
    // Deliberately disabled: this build must NOT auto-load every asset/dot.
    // Dots are drawn only after a search result/circuit is selected.
    this.clearDisplay(false);
    Diagnostics.log('Auto render blocked','Map stays empty until a search result is loaded.');
  },
  clearDisplay(showToast=true){
    this.drawToken=(this.drawToken||0)+1;
    this.drawing=false;
    this.markerLayer?.clearLayers();
    this.routeLayer?.clearLayers();
    this.connectedLineLayer?.clearLayers();
    this.connectedLinesVisible=false; this.connectedLinesKey=''; this.connectedLinesList=[];
    UtilitiesEngine?.clear?.(false);
    HVCrossingsLayer?.clearActive?.({silent:true});
    this.lastDrawnAssets=[];
    App.drawnMarkers=0;
    this.currentDisplay='none';
    this.currentCircuit=null;
    this.currentCircuits=[];
    this.currentCircuitRoutes=[];
    this.lastFullCircuitAssets=[];
    this.lastFullCircuitLabel='';
    this.circuitDensityMode='';
    UI.refreshCounts?.();
    if(showToast)UI.toast('Map display cleared. Search to load dots.');
  },
  approvedDrawLabels(){
    return ['asset search result','circuit <name>','route <name>',"What's here",'current map view','patrol'];
  },
  drawAllowed(label){
    const text=String(label||'').trim();
    // Hard lock: typing/search/results/details must never draw. Only explicit map buttons pass these labels.
    return /^asset search result$/i.test(text)||/^circuit\s+.+/i.test(text)||/^multi-circuit$/i.test(text)||/^route\s+.+/i.test(text)||/^What's here$/i.test(text)||/^current map view$/i.test(text)||/^current view$/i.test(text)||/^patrol\b/i.test(text);
  },

  cancelDraw(){
    this.drawToken=(this.drawToken||0)+1;
    this.drawing=false;
  },
  assetLatLng(a){
    const lat=Number(a?.lat), lon=Number(a?.lon);
    return Number.isFinite(lat)&&Number.isFinite(lon)?[lat,lon]:null;
  },
  markerLatLng(a){
    const ll=this.assetLatLng(a);
    if(!ll)return null;
    const off=a&&a.__mapDotOffset;
    if(!off)return ll;
    const lat=Number(ll[0]), lon=Number(ll[1]);
    const north=Number(off.northM||0), east=Number(off.eastM||0);
    const dLat=north/111320;
    const dLon=east/(111320*Math.cos(lat*Math.PI/180)||111320);
    return [lat+dLat,lon+dLon];
  },
  mapDotIdentity(a){
    try{
      const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
      const pole=String(a?.poleNumber||refs[0]?.pole||'').trim();
      const line=SearchEngine?.compact?.(refs[0]?.line||a?.line||'')||'';
      if(line&&pole)return `${line}|P${SearchEngine.stripZeros(pole)}`;
    }catch(e){}
    return String(a?.id||a?.label||a?.gisLabel||'');
  },
  prepareMapDotOffsets(list=[]){
    const groups=new Map();
    for(const a of list||[]){
      if(!a||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))continue;
      if(a.__mapDotOffset)delete a.__mapDotOffset;
      const key=`${Number(a.lat).toFixed(7)},${Number(a.lon).toFixed(7)}`;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(a);
    }
    let adjusted=0;
    for(const group of groups.values()){
      if(group.length<2)continue;
      group.sort((a,b)=>(SearchEngine?.sortByStructure?.(a,b)||String(this.mapDotIdentity(a)).localeCompare(String(this.mapDotIdentity(b)))));
      const radius=4.5;
      const n=group.length;
      for(let i=0;i<n;i++){
        const angle=(2*Math.PI*i)/n - Math.PI/2;
        group[i].__mapDotOffset={eastM:Math.cos(angle)*radius,northM:Math.sin(angle)*radius,reason:'duplicate-gps-fan'};
        adjusted++;
      }
    }
    if(adjusted){
      try{Diagnostics?.log?.('Map dot fan offsets',`${adjusted} same-GPS structures offset slightly so suffix/double structures remain clickable`);}catch(e){}
    }
    return adjusted;
  },
  fitAssetList(assets=[],routes=[],maxZoom=16){
    if(!this.map)return false;
    const pts=[];
    for(const a of assets||[]){
      const ll=this.assetLatLng(a);
      if(ll)pts.push(ll);
    }
    for(const r of routes||[]){
      const coords=Array.isArray(r?.routeCoords)?r.routeCoords:[];
      if(coords.length){
        // Full route bounds are cheap enough, but sample very long routes to avoid mobile stalls.
        const step=Math.max(1,Math.floor(coords.length/120));
        for(let i=0;i<coords.length;i+=step){
          const c=coords[i];
          if(Array.isArray(c)&&Number.isFinite(Number(c[0]))&&Number.isFinite(Number(c[1])))pts.push([Number(c[0]),Number(c[1])]);
        }
        const last=coords[coords.length-1];
        if(Array.isArray(last)&&Number.isFinite(Number(last[0]))&&Number.isFinite(Number(last[1])))pts.push([Number(last[0]),Number(last[1])]);
      }
    }
    if(!pts.length)return false;
    try{this.map.fitBounds(L.latLngBounds(pts),{padding:[28,28],maxZoom}); return true;}catch(e){return false;}
  },
  orderAssetsForViewport(list){
    if(!this.map||!Array.isArray(list)||list.length<80)return list;
    let b=null, c=null;
    try{b=this.map.getBounds(); c=this.map.getCenter();}catch(e){}
    if(!b||!c)return list;
    const dist=(a)=>{
      const lat=Number(a?.lat), lon=Number(a?.lon);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))return Infinity;
      const dLat=lat-Number(c.lat), dLon=lon-Number(c.lng);
      return dLat*dLat+dLon*dLon;
    };
    return list.slice().sort((a,bx)=>{
      const ai=b.contains([Number(a.lat),Number(a.lon)])?0:1;
      const bi=b.contains([Number(bx.lat),Number(bx.lon)])?0:1;
      if(ai!==bi)return ai-bi;
      const ad=dist(a), bd=dist(bx);
      if(ad!==bd)return ad-bd;
      return SearchEngine?.sortByStructure?.(a,bx)||0;
    });
  },

  isCircuitLabel(label){
    const text=String(label||'');
    return /^circuit\s+/i.test(text)||/^multi-circuit$/i.test(text);
  },
  circuitDotModeForZoom(){
    const z=Number(this.map?.getZoom?.()||0);
    return z && z<15 ? 'sample20' : 'full';
  },
  lineKeyForAsset(a){
    try{
      const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
      const ref=refs[0]||{};
      return SearchEngine?.compact?.(ref.line||a?.line||'')||String(a?.line||'').toUpperCase();
    }catch(e){return String(a?.line||'').toUpperCase();}
  },
  structureLabelForDot(a){
    try{
      const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
      const pole=refs[0]?.pole||a?.poleNumber||a?.structureNumber||a?.nameplate||a?.label||'';
      const m=String(pole||'').match(/(\d{1,6}[A-Z]?)\s*$/i)||String(pole||'').match(/(\d{1,6}[A-Z]?)/i);
      return m?m[1]:'';
    }catch(e){
      const m=String(a?.poleNumber||a?.label||'').match(/(\d{1,6}[A-Z]?)/i);
      return m?m[1]:'';
    }
  },
  structureNumberForDot(a){
    try{
      const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
      const pole=refs[0]?.pole||a?.poleNumber||a?.structureNumber||a?.nameplate||a?.label||'';
      const p=SearchEngine?.poleIdParts?.(pole);
      if(p&&Number.isFinite(Number(p.num)))return Number(p.num);
      const m=String(pole||'').match(/(\d{1,6})/);
      return m?Number(m[1]):NaN;
    }catch(e){
      const m=String(a?.poleNumber||a?.label||'').match(/(\d{1,6})/);
      return m?Number(m[1]):NaN;
    }
  },
  sampleCircuitDots(list=[],every=20){
    if(!Array.isArray(list)||list.length<=30)return list||[];
    const groups=new Map();
    for(const a of list){
      const k=this.lineKeyForAsset(a)||'line';
      if(!groups.has(k))groups.set(k,[]);
      groups.get(k).push(a);
    }
    const out=[];
    const seen=new Set();
    const cloneWithLabel=(a,label)=>{
      if(!label)return a;
      try{return Object.assign({},a,{_sampleMarkerNum:String(label)});}catch(e){a._sampleMarkerNum=String(label);return a;}
    };
    const add=(a,label='')=>{
      const k=this.mapDotIdentity(a)||`${a?.lat},${a?.lon}`;
      if(seen.has(k))return;
      seen.add(k);
      out.push(cloneWithLabel(a,label));
    };
    for(const group of groups.values()){
      const arr=group.slice().sort(SearchEngine?.sortByStructure||(()=>0));
      const n=arr.length;
      if(!n)continue;
      add(arr[0]);
      let addedMiddle=0;
      for(let i=1;i<n-1;i++){
        const a=arr[i];
        if(a?.kind==='substation'||a?.kind==='depot'){add(a);continue;}
        const num=this.structureNumberForDot(a);
        if(Number.isFinite(num)&&every>0&&num%every===0){add(a,this.structureLabelForDot(a)||String(num));addedMiddle++;continue;}
      }
      // Some branch/odd-labelled circuits may not have clean multiples of 20; fall back to every-20 structure-order indicators and label them.
      if(!addedMiddle&&n>every){
        for(let i=every;i<n-1;i+=every){
          const a=arr[i];
          add(a,this.structureLabelForDot(a)||String(i+1));
        }
      }
      if(n>1)add(arr[n-1]);
    }
    return out;
  },
  filteredAssetsForZoom(list=[],label=''){
    if(!this.isCircuitLabel(label)){this.circuitDensityMode='';return list||[];}
    this.lastFullCircuitAssets=(list||[]).slice();
    this.lastFullCircuitLabel=label;
    const mode=this.circuitDotModeForZoom();
    this.circuitDensityMode=mode;
    if(mode==='sample20')return this.sampleCircuitDots(list,20);
    return list||[];
  },
  async onZoomDensityChange(){
    if(!this.lastFullCircuitAssets?.length||!this.lastFullCircuitLabel)return;
    const next=this.circuitDotModeForZoom();
    if(next===this.circuitDensityMode)return;
    try{await this.drawAssets(this.lastFullCircuitAssets,this.lastFullCircuitLabel,false,{viewportFirst:true,densityRefresh:true});}
    catch(e){try{Diagnostics?.log?.('Circuit density refresh failed',String(e?.message||e));}catch(_){}}
    try{if(HVCrossingsLayer?.hasActiveSelections?.())HVCrossingsLayer.refreshActive({silent:true}); else HVCrossingsLayer?.renderControls?.();}catch(e){}
  },
  drawCircuitGuideLines(assets=[]){
    if(!this.routeLayer||!Array.isArray(assets)||!assets.length)return 0;
    const groups=new Map();
    for(const a of assets){
      const ll=this.assetLatLng(a); if(!ll)continue;
      const k=this.lineKeyForAsset(a)||String(a?.line||'line');
      if(!groups.has(k))groups.set(k,[]);
      groups.get(k).push(a);
    }
    let drawn=0;
    for(const group of groups.values()){
      const arr=group.slice().sort(SearchEngine?.sortByStructure||(()=>0));
      let chunk=[]; let prev=null;
      const flush=()=>{if(chunk.length>1){L.polyline(chunk,{weight:5,opacity:.34,color:'#1f6b36',interactive:false,lineCap:'round',lineJoin:'round'}).addTo(this.routeLayer);drawn++;} chunk=[];};
      for(const a of arr){
        const ll=this.assetLatLng(a); if(!ll)continue;
        if(prev){
          const d=SearchEngine?.distanceKm?.({lat:prev[0],lon:prev[1]},{lat:ll[0],lon:ll[1]})??0;
          if(Number.isFinite(d)&&d>8)flush();
        }
        chunk.push(ll); prev=ll;
      }
      flush();
    }
    return drawn;
  },
  markerModeFor(label,list){
    const text=String(label||'');
    if((/^circuit\s+/i.test(text)||/^multi-circuit$/i.test(text))&&Array.isArray(list)&&list.length>180)return 'canvas-dot';
    if(/^current map view|^What's here/i.test(text)&&Array.isArray(list)&&list.length>300)return 'canvas-dot';
    return 'dom-dot';
  },
  async drawAssets(assets,label='search results',fit=true,opts={}){
    if(!this.drawAllowed(label)){
      Diagnostics?.log?.('Blocked non-explicit map draw',label);
      UI?.toast?.('Map draw blocked. Use Load circuit, Map, or What\'s here.');
      return 0;
    }
    if(!this.markerLayer)return 0;
    if(App.safeMode && !/^asset search result$/i.test(String(label||''))){UI.toast('Safe Mode is on. Circuit/bulk map drawing is blocked.'); return 0;}
    const token=++this.drawToken;
    this.markerLayer.clearLayers();
    App.drawnMarkers=0;
    UI.refreshCounts?.();
    const baseList=(assets||[]).filter(a=>SearchEngine.passesFilters(a)&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))&&a.kind!=='circuit'&&!UtilitiesEngine?.isUtility?.(a));
    const drawBase=this.filteredAssetsForZoom(baseList,label);
    this.prepareMapDotOffsets(drawBase);
    const list=opts.viewportFirst?this.orderAssetsForViewport(drawBase):drawBase;
    this.lastDrawnAssets=drawBase;
    const mode=this.markerModeFor(label,drawBase);
    const batch=mode==='canvas-dot'?(drawBase.length>1000?75:95):(drawBase.length>600?90:140);
    this.drawing=true;
    this.currentDisplay=label;
    let drawn=0;
    for(let i=0;i<list.length;i+=batch){
      if(token!==this.drawToken){Diagnostics?.log?.('Map draw cancelled',String(label||'')); return drawn;}
      const part=list.slice(i,i+batch);
      for(const a of part){this.addMarker(a,{mode}); drawn++;}
      App.drawnMarkers=drawn;
      if(i===0 || i%Math.max(batch*3,240)===0 || drawn>=list.length)UI.refreshCounts?.();
      await new Promise(r=>requestAnimationFrame(r));
    }
    if(token!==this.drawToken)return drawn;
    this.drawing=false;
    App.drawnMarkers=drawn;
    UI.refreshCounts?.();
    Diagnostics?.log?.('Rendered searched markers',`${drawn} markers drawn for ${label} · mode ${mode} · batch ${batch}`);
    if(fit&&drawBase.length)this.fitVisible();
    if(drawBase.length)UtilitiesEngine?.updatePanel?.('Click an asset dot to view details.');
    return drawn;
  },
  assetDotClass(a){
    const raw=String(a?.kind||'structure').toLowerCase().trim();
    const cat=String(a?.category||a?.assetType||a?.raw?.TYPE||'').toLowerCase();
    const text=[raw,cat,a?.label,a?.substation,a?.terminal,a?.raw?.SEARCH_FIELD,a?.raw?.SUBSTATION,a?.raw?.SUBSTATION_NAME,a?.raw?.TERMINAL,a?.raw?.TERMINAL_NAME,a?.raw?.TYPE].join(' ').toLowerCase();
    if(raw==='dx-pole'||raw==='distribution-pole'||/distribution\s+pole|dx\s*pole/.test(cat))return 'distribution-pole';
    if(raw==='transformer'||/transformer|tx\s*site|kiosk|padmount/.test(cat))return 'transformer';
    if(raw==='streetlight'||raw==='electrical-enclosure'||/street\s*light|streetlight|light/.test(cat))return 'streetlight';
    if(raw==='depot'||/\bdepot\b/.test(text))return 'depot';
    if(raw==='terminal'||/\bterminal\b/.test(text))return 'terminal';
    if(raw==='substation'||/\bsubstation\b|\bsub\b|switchyard|zone\s+sub/.test(text))return 'substation';
    return raw||'structure';
  },
  assetDotFill(a){
    const k=this.assetDotClass(a);
    if(k==='distribution-pole')return '#1f6f7a';
    if(k==='transformer')return '#d97706';
    if(k==='streetlight')return '#d8aa16';
    if(k==='substation')return '#f57c00';
    if(k==='terminal')return '#d32f2f';
    if(k==='depot')return '#8a5a2b';
    return '#1e6fb7';
  },
  forceDomDot(a){
    const k=this.assetDotClass(a);
    return k==='substation'||k==='terminal'||k==='depot';
  },
  addMarker(a,opts={}){
    // Main transmission/estimated dots use the blue field-dot style. Other asset types keep the same field-dot shape/size but use their own colours; substations/depots are square markers.
    const marked=!!(window.UtilitiesEngine?.hasPrecomputedMarkup?.(a));
    const visualKind=this.assetDotClass(a);
    const mode=(opts.mode||'dom-dot');
    let m;
    const ll=this.markerLatLng(a)||[Number(a.lat),Number(a.lon)];
    if(mode==='canvas-dot'&&!this.forceDomDot(a)&&window.L?.circleMarker){
      m=L.circleMarker(ll,{
        renderer:this.mapRenderer||undefined,
        radius:8.5,
        weight:3,
        opacity:0.98,
        fillOpacity:0.98,
        color:'#f7efd9',
        fillColor:this.assetDotFill(a),
        bubblingMouseEvents:false,
        interactive:true
      }).bindPopup(()=>PopupEngine.assetHtml(a),this.popupOptions());
      try{m.options.title=PopupEngine.displayTitle(a);}catch(e){}
    }else{
      const cls=['asset-dot',a.sourceType||'json',visualKind,a.kind||'structure',marked?'utility-marked':'',a.inferredMissingStructure?'inferred-missing-dot':''].filter(Boolean).join(' ');
      const sampleNum=String(a._sampleMarkerNum||'').trim();
      const html=sampleNum?`<div class="asset-dot-wrap sampled-20"><div class="${cls}"></div><div class="asset-dot-num">${sampleNum}</div></div>`:`<div class="${cls}"></div>`;
      const iconSize=sampleNum?[58,50]:[marked?30:24,marked?30:24];
      const iconAnchor=sampleNum?[29,13]:[marked?15:12,marked?12:12];
      const icon=L.divIcon({className:'',html,iconSize,iconAnchor,popupAnchor:[0,-12]});
      m=L.marker(ll,{icon,riseOnHover:true,title:PopupEngine.displayTitle(a)}).bindPopup(()=>PopupEngine.assetHtml(a),this.popupOptions());
    }
    m.on('click',()=>{App.selectedAsset=a; setTimeout(()=>this.refitOpenPopup(),80); setTimeout(()=>HVCrossingsLayer?.showBayForAsset?.(a,{silent:true}),120);});
    m.on('popupopen',()=>{App.selectedAsset=a; setTimeout(()=>UtilitiesEngine?.refreshAssetBadgePanel?.(a),40); setTimeout(()=>this.refitOpenPopup(),80);});
    this.markerLayer.addLayer(m);
    return m;
  },
  showAsset(a,zoom=17){
    if(!a)return;
    this.cancelDraw();
    this.routeLayer?.clearLayers();
    this.connectedLineLayer?.clearLayers();
    this.markerLayer?.clearLayers();
    UtilitiesEngine?.clear?.(false);
    App.drawnMarkers=0;
    if(Number.isFinite(a.lat)&&Number.isFinite(a.lon)){
      const marker=this.addMarker(a);
      App.drawnMarkers=1;
      this.lastDrawnAssets=[a];
      this.currentDisplay='asset search result';
      this.currentCircuit=null;
      this.currentCircuitRoutes=[];
      UI.refreshCounts();
      this.focusDot(a,marker,{zoom});
      marker.openPopup();
      UtilitiesEngine?.updatePanel?.('Click an asset dot to view details.');
      setTimeout(()=>UtilitiesEngine?.refreshAssetBadgePanel?.(a),80);
      setTimeout(()=>HVCrossingsLayer?.showBayForAsset?.(a,{silent:true}),140);
      UI.toast('Loaded searched asset only.');
    }else{
      UI.refreshCounts();
      UI.toast('Asset found but has no map point.');
    }
  },
  selectedLineRefForAsset(line,a){
    const wanted=SearchEngine?.compact?.(SearchEngine?.formatCircuitName?.(line)||line)||String(line||'').toUpperCase();
    const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
    let hit=refs.find(r=>(SearchEngine?.compact?.(r.line)||'')===wanted);
    if(hit)return hit;
    const direct=SearchEngine?.formatCircuitName?.(a?.line||'')||a?.line||'';
    if((SearchEngine?.compact?.(direct)||'')===wanted){
      return {line:direct,pole:a?.poleNumber||''};
    }
    return null;
  },
  inferMissingCircuitDots(line,assets=[]){
    // Pass 16: some imported WP structure sets have real gaps where every now and then
    // a tower is absent from the map.  This creates estimated placeholder dots using the same green field-dot style
    // between two confirmed GPS dots on the same circuit.  It does not create endless
    // routes and it never pretends the placeholder is source data.
    const out=[];
    const wantedLine=SearchEngine?.formatCircuitName?.(line)||line;
    const wantedKey=SearchEngine?.compact?.(wantedLine)||String(wantedLine||'').toUpperCase();
    const entries=[];
    const seen=new Set();
    for(const a of assets||[]){
      if(!a||a.inferredMissingStructure)continue;
      if(!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))continue;
      const ref=this.selectedLineRefForAsset(line,a);
      if(!ref)continue;
      const p=SearchEngine?.poleIdParts?.(ref.pole||a.poleNumber||'');
      if(!p||p.isBranch||p.suffix)continue; // do not invent A/B/G/branch legs
      const key=String(p.num);
      if(seen.has(key))continue;
      seen.add(key);
      entries.push({asset:a,ref,parts:p,num:Number(p.num),pole:String(ref.pole||a.poleNumber||'')});
    }
    entries.sort((a,b)=>a.num-b.num);
    if(entries.length<3)return out;
    const existing=new Set(entries.map(e=>e.num));
    const MAX_GAP_COUNT=8;        // max missing pole numbers created in one break
    const MAX_TOTAL_ESTIMATES=120; // hard cap for mobile safety
    const MAX_TOTAL_GAP_KM=4.0;   // prevents long missing corridors being filled
    const MAX_AVG_SPAN_KM=0.9;    // prevents false placeholders over long jumps
    const distKm=(a,b)=>SearchEngine?.distanceKm?.(a,b)??Infinity;
    for(let i=0;i<entries.length-1;i++){
      if(out.length>=MAX_TOTAL_ESTIMATES)break;
      const left=entries[i], right=entries[i+1];
      const gap=right.num-left.num-1;
      if(gap<1||gap>MAX_GAP_COUNT)continue;
      const d=distKm(left.asset,right.asset);
      if(!Number.isFinite(d)||d<=0||d>MAX_TOTAL_GAP_KM)continue;
      const avg=d/(gap+1);
      if(avg>MAX_AVG_SPAN_KM)continue;
      for(let n=left.num+1;n<right.num;n++){
        if(out.length>=MAX_TOTAL_ESTIMATES)break;
        if(existing.has(n))continue;
        const ratio=(n-left.num)/(right.num-left.num);
        const lat=Number(left.asset.lat)+(Number(right.asset.lat)-Number(left.asset.lat))*ratio;
        const lon=Number(left.asset.lon)+(Number(right.asset.lon)-Number(left.asset.lon))*ratio;
        if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
        const pole=SearchEngine?.formatPoleLike?.(left.pole||right.pole||'0000',n)||String(n).padStart(4,'0');
        const title=`${wantedLine}-${pole}`;
        const mapsUrl=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat+','+lon)}`;
        const earthUrl=`https://earth.google.com/web/search/${encodeURIComponent(lat+','+lon)}`;
        out.push({
          id:`inferred-missing|${wantedKey}|${pole}|${left.pole}|${right.pole}`,
          sourceType:'inferred',
          sourceFile:'App inferred gap - not source data',
          sourcePath:'pass16.missing-structure-placeholder',
          kind:'structure',
          line:wantedLine,
          poleNumber:pole,
          label:`${title} · NO DATA FOUND`,
          structure:`${title} · NO DATA FOUND`,
          gisLabel:`${title} · NO DATA FOUND`,
          category:'NO DATA FOUND - estimated missing structure',
          lat,lon,
          inferredMissingStructure:true,
          inferredFrom:{before:left.pole,after:right.pole,beforeLat:left.asset.lat,beforeLon:left.asset.lon,afterLat:right.asset.lat,afterLon:right.asset.lon,method:'linear-between-confirmed-neighbour-dots'},
          raw:{
            DATA_STATUS:'NO DATA FOUND - estimated placeholder',
            LINE_NAME:wantedLine,
            NAMEPLATE_ID:pole,
            INFERRED_FROM:`${left.pole} to ${right.pole}`,
            GOOGLE_MAPS:mapsUrl,
            GOOGLE_EARTH:earthUrl,
            NOTE:'This dot was estimated by the app because the source structure record was missing or had no usable GPS. Treat location as approximate. Google Maps and Google Earth buttons use the estimated coordinate.'
          },
          searchText:`${wantedLine} ${pole} ${title} NO DATA FOUND MISSING ESTIMATED PLACEHOLDER`
        });
      }
    }
    if(out.length){
      try{Diagnostics?.log?.('Missing structure placeholders',`${wantedLine}: ${out.length} estimated blue dot(s) inserted between confirmed neighbouring structures.`);}catch(e){}
    }
    return out;
  },
  async showCircuit(line,opts={}){
    if(App.safeMode){UI.toast('Safe Mode is on. Circuit drawing blocked; search results still work.'); return;}
    const all=SearchEngine.lineAssets(line);
    const sortedConfirmed=all.filter(a=>Number.isFinite(a.lat)&&Number.isFinite(a.lon)&&a.kind!=='circuit'&&!UtilitiesEngine?.isUtility?.(a)).sort(SearchEngine.sortByStructure);
    const inferredMissing=this.inferMissingCircuitDots(line,sortedConfirmed);
    const sorted=[...sortedConfirmed,...inferredMissing].sort(SearchEngine.sortByStructure);
    const routes=SearchEngine.lineCircuitAssets?SearchEngine.lineCircuitAssets(line):[];
    this.currentCircuit=line;
    this.currentCircuits=[line];
    this.currentCircuitRoutes=routes||[];
    this.routeLayer.clearLayers();
    this.connectedLineLayer?.clearLayers();
    this.connectedLinesVisible=false; this.connectedLinesKey=''; this.connectedLinesList=[];
    this.markerLayer.clearLayers();
    App.drawnMarkers=0;
    UI.refreshCounts();
    // v1.58: no crossing pre-scan before drawing asset dots. It was slow and
    // only existed to paint old warning dots. Advisory markers are drawn after.
    const preFit=this.fitAssetList(sorted,routes,16);
    this.drawCircuitGuideLines(sorted);
    await this.drawAssets(sorted,`circuit ${line}`,false,{viewportFirst:true});
    if(App.drawnMarkers>0){
      if(!preFit)this.fitVisible();
      const gapNote=inferredMissing?.length?` · ${inferredMissing.length} estimated missing green dot(s)`:'';
      UI.toast(`Loaded searched circuit: ${line} (${App.drawnMarkers} dots${gapNote}).`);
    }else if(routes.length){
      this.drawCircuits(routes);
      if(!preFit)this.fitVisible();
      UI.toast(`Loaded searched circuit line: ${line}. No pole dots found.`);
    }else{
      UI.toast(`Circuit found: ${line}, but no map points to draw.`);
    }
    try{
      await HVCrossingsLayer?.onCircuitLoaded?.(line,{silent:true});
    }catch(e){Diagnostics?.log?.('HV/TX crossing layer failed',String(e?.message||e));}
  },
  async showCircuits(lines=[],opts={}){
    if(App.safeMode){UI.toast('Safe Mode is on. Circuit drawing blocked; search results still work.'); return;}
    const rawLines=Array.isArray(lines)?lines:[lines];
    const cleaned=[]; const seen=new Set();
    for(const line of rawLines){
      const formatted=SearchEngine?.formatCircuitName?.(line)||String(line||'').trim();
      const key=SearchEngine?.compact?.(formatted)||String(formatted||'').toUpperCase();
      if(formatted&&key&&!seen.has(key)){seen.add(key);cleaned.push(formatted);}
    }
    if(!cleaned.length){UI.toast('No circuits selected.');return;}
    if(cleaned.length===1)return this.showCircuit(cleaned[0],opts);
    this.currentCircuit=cleaned[0];
    this.currentCircuits=cleaned.slice();
    this.routeLayer.clearLayers();
    this.connectedLineLayer?.clearLayers();
    this.connectedLinesVisible=false; this.connectedLinesKey=''; this.connectedLinesList=[];
    this.markerLayer.clearLayers();
    App.drawnMarkers=0;
    UI.refreshCounts();
    const allAssets=[];
    const allRoutes=[];
    let inferredCount=0;
    for(const line of cleaned){
      const all=SearchEngine.lineAssets(line);
      const confirmed=all.filter(a=>Number.isFinite(a.lat)&&Number.isFinite(a.lon)&&a.kind!=='circuit'&&!UtilitiesEngine?.isUtility?.(a)).sort(SearchEngine.sortByStructure);
      const inferred=this.inferMissingCircuitDots(line,confirmed);
      inferredCount+=inferred.length;
      allAssets.push(...confirmed,...inferred);
      const routes=SearchEngine.lineCircuitAssets?SearchEngine.lineCircuitAssets(line):[];
      allRoutes.push(...(routes||[]));
    }
    const sorted=allAssets.sort((a,b)=>{
      const la=String(a?.line||''), lb=String(b?.line||'');
      const c=la.localeCompare(lb,undefined,{numeric:true,sensitivity:'base'});
      return c||SearchEngine.sortByStructure(a,b);
    });
    const preFit=this.fitAssetList(sorted,allRoutes,15);
    this.drawCircuitGuideLines(sorted);
    await this.drawAssets(sorted,`multi-circuit`,false,{viewportFirst:true});
    if(App.drawnMarkers>0){
      if(!preFit)this.fitVisible();
      this.currentDisplay='multi-circuit';
      const gapNote=inferredCount?` · ${inferredCount} estimated missing green dot(s)`:'';
      UI.toast(`Loaded ${cleaned.length} circuits (${App.drawnMarkers} dots${gapNote}).`);
    }else if(allRoutes.length){
      this.drawCircuits(allRoutes);
      this.currentCircuit=cleaned[0];
      this.currentCircuits=cleaned.slice();
      if(!preFit)this.fitVisible();
      UI.toast(`Loaded ${cleaned.length} circuit lines. No pole dots found.`);
    }else{
      UI.toast(`Selected circuits found, but no map points to draw.`);
    }
    try{await HVCrossingsLayer?.onCircuitsLoaded?.(cleaned,{silent:true});}
    catch(e){Diagnostics?.log?.('HV/TX crossing layer failed',String(e?.message||e));}
  },

  drawCircuits(routes){
    if(!this.routeLayer)return;
    let count=0;
    for(const r of routes||[]){
      if(!Array.isArray(r.routeCoords)||r.routeCoords.length<2)continue;
      if(App.safeMode)continue;
      const line=L.polyline(r.routeCoords,{weight:4,opacity:.78,color:'#1f3b25'});
      line.bindPopup(()=>PopupEngine.assetHtml(r),this.popupOptions());
      this.routeLayer.addLayer(line);
      count++;
    }
    App.drawnMarkers=0;
    this.currentDisplay='searched circuit route';
    UI.refreshCounts();
    Diagnostics.log('Rendered searched circuit',`${count} circuit sections drawn.`);
  },


  referenceTitle(a){
    try{return SearchEngine?.referenceName?.(a)||PopupEngine?.displayTitle?.(a)||String(a?.label||a?.substation||'Reference');}
    catch(e){return String(a?.label||a?.substation||'Reference');}
  },
  isConnectedReferenceCandidate(a){
    if(!a||typeof a!=='object')return false;
    const raw=a.raw||{};
    const kind=String(a.kind||'').toLowerCase();
    const text=[kind,a.category,a.type,a.label,a.substation,a.terminal,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.TERMINAL,raw.TERMINAL_NAME,raw.SEARCH_FIELD,raw.ABBREVIATION,raw.abbreviation,raw.CODE,raw.code,raw.SITE_CODE,raw.STATION_CODE,raw.SUBSTATION_CODE,raw.TERMINAL_CODE,Object.entries(raw).map(([k,v])=>`${k} ${v}`).join(' ')].join(' ').toUpperCase();
    if(kind==='depot'||/\bDEPOT\b/.test(text))return false;
    if(String(this.currentDisplay||'').toLowerCase()==='all substations')return true;
    const refKind=SearchEngine?.referenceKind?SearchEngine.referenceKind(a):kind;
    if(kind==='substation'||kind==='terminal'||refKind==='terminal')return true;
    if(/SUBSTATION|SUBSTN|TERMINAL|SWITCHYARD|ZONE SUB|\bZONE\b|\bSUB\b|\bTER\b/.test(text))return true;
    if((raw.ABBREVIATION||raw.abbreviation||raw.ABBR||raw.abbr||raw.CODE||raw.code||raw.SUBSTATION_CODE||raw.TERMINAL_CODE||raw.STATION_CODE||raw.SITE_CODE)&&(raw.SUBSTATION||raw.SUBSTATION_NAME||raw.TERMINAL||raw.TERMINAL_NAME||raw.SEARCH_FIELD||raw.NAME||raw.TITLE))return true;
    return false;
  },
  registerPopupAsset(a){
    if(!a)return '';
    if(!this.popupAssetRegistry)this.popupAssetRegistry=new Map();
    let token=String(a.id||'').trim();
    if(!token){
      const ll=this.assetLatLng?.(a)||[];
      token=['popup',a.kind||'',a.label||a.substation||a.terminal||a.depot||'',ll[0]||'',ll[1]||''].join('|');
    }
    token=String(token||'').slice(0,220);
    this.popupAssetRegistry.set(token,a);
    return token;
  },
  zoomToPopupAsset(token='',ev=null){
    try{if(ev){ev.preventDefault?.();ev.stopPropagation?.();if(window.L?.DomEvent)try{L.DomEvent.stop(ev);}catch(_){}}}catch(_){}
    try{this.map?.dragging?.enable?.();}catch(_){}
    const raw=decodeURIComponent(String(token||''));
    let a=(this.popupAssetRegistry&&this.popupAssetRegistry.get(raw))||(this.connectedReferenceRegistry&&this.connectedReferenceRegistry.get(raw))||(SearchEngine?.assetMap&&SearchEngine.assetMap.get(raw))||(App.assets||[]).find(x=>String(x?.id||'')===raw);
    if(!a){UI?.toast?.('Asset target not found.');return false;}
    const ll=this.markerLatLng?.(a)||this.assetLatLng?.(a);
    if(!ll){UI?.toast?.('Asset has no map point.');return false;}
    const cur=Number(this.map?.getZoom?.()||0);
    const targetZoom=Math.max(cur,15);
    try{this.map.setView(ll,targetZoom,{animate:true,duration:0.2});}
    catch(e){try{this.map.panTo(ll,{animate:true,duration:0.2});}catch(_){}}
    return false;
  },
  registerConnectedReferenceAsset(a){
    if(!a)return '';
    if(!this.connectedReferenceRegistry)this.connectedReferenceRegistry=new Map();
    let token=String(a.id||'').trim();
    if(!token){
      const raw=a.raw||{};
      const title=(SearchEngine?.referenceName?.(a)||a.label||a.substation||a.terminal||raw.SEARCH_FIELD||raw.SUBSTATION||raw.TERMINAL||'ref');
      token='ref_'+(SearchEngine?.compact?SearchEngine.compact(title):String(title).toUpperCase().replace(/[^A-Z0-9]/g,''))+'_'+String(Number(a.lat)||0).replace(/[^0-9-]/g,'')+'_'+String(Number(a.lon)||0).replace(/[^0-9-]/g,'');
    }
    this.connectedReferenceRegistry.set(token,a);
    return encodeURIComponent(token);
  },

  connectedStatusHtml(title='Connected circuits',body='Checking…'){
    const esc=(v)=>UI?.esc?UI.esc(v):String(v??'');
    return `<div class="connected-action-panel"><div class="connected-action-head"><b>${esc(title)}</b><button type="button" onclick="window.MapEngine?.closeConnectedStatus?.()">×</button></div><div class="connected-action-body">${body}</div></div>`;
  },
  openConnectedStatus(aOrTitle,body='Checking connected circuits…'){
    try{
      const title=typeof aOrTitle==='string'?aOrTitle:(this.referenceTitle?.(aOrTitle)||'Connected circuits');
      const html=this.connectedStatusHtml(title,body);
      let host=document.getElementById('connectedActionHost');
      if(!host){
        host=document.createElement('div');
        host.id='connectedActionHost';
        host.className='connected-action-host';
        document.body.appendChild(host);
      }
      host.innerHTML=html;
      host.classList.remove('hidden');
    }catch(e){try{UI?.toast?.(String(body).replace(/<[^>]*>/g,' '));}catch(_){}}
  },
  updateConnectedStatus(aOrTitle,body=''){
    this.openConnectedStatus(aOrTitle,body);
  },
  closeConnectedStatus(){
    try{document.getElementById('connectedActionHost')?.classList.add('hidden');}catch(e){}
  },
  connectedLineButtonHtml(line){
    const esc=(v)=>UI?.esc?UI.esc(v):String(v??'');
    const label=this.connectedCanonicalCircuitName?.(line)||String(line||'');
    const arg=encodeURIComponent(label);
    return `<button type="button" class="connected-load-line-btn" onclick="window.MapEngine?.showCircuitFromConnectedLine?.('${arg}')">${esc(label)}</button>`;
  },
  handleMoreInfoButton(btn,ev){
    try{
      ev?.preventDefault?.(); ev?.stopPropagation?.(); ev?.stopImmediatePropagation?.();
    }catch(e){}
    const p=btn?.closest?.('.asset-popup');
    if(!p)return false;
    const more=p.querySelector?.('.popup-more');
    const open=!p.classList.contains('show-more');
    p.classList.toggle('show-more',open);
    if(more)more.style.display=open?'block':'none';
    if(btn)btn.textContent=open?'Less info':'More info';
    // No Leaflet popup update/refit here. That was the source of the reference-popup flicker.
    try{this.map?.dragging?.enable?.();}catch(e){}
    return false;
  },
  handleConnectedCircuitsButton(btn,ev){
    try{
      if(ev){
        if(ev.__fmConnectedHandled)return false;
        ev.__fmConnectedHandled=true;
        ev.preventDefault?.(); ev.stopPropagation?.(); ev.stopImmediatePropagation?.();
      }
    }catch(e){}
    const el=btn||ev?.target?.closest?.('.show-connected-circuits-btn')||ev?.target;
    const token=el?.getAttribute?.('data-connected-token')||'';
    const code=el?.getAttribute?.('data-connected-code')||'';
    const key=this.connectedReferenceKeyFromToken?.(token,code)||String(code||token||'').toUpperCase();
    const now=Date.now();
    if(this._lastConnectedTapKey===key && now-(this._lastConnectedTapAt||0)<450)return false;
    this._lastConnectedTapKey=key;
    this._lastConnectedTapAt=now;
    const wantsHide=!!(this.connectedLinesVisible&&(this.connectedLinesKey===key||/hide/i.test(String(el?.textContent||''))));
    try{ this.map?.dragging?.enable?.(); }catch(e){}
    try{ this.map?.closePopup?.(); }catch(e){}
    if(wantsHide){
      try{ this.map?.dragging?.enable?.(); }catch(e){}
      this.hideConnectedCircuitLines();
      if(el)el.textContent='Show connected circuits';
      UI?.toast?.('Connected circuit lines hidden.');
      return false;
    }
    if(el){
      if(el.dataset.connectedBusy==='1')return false;
      el.dataset.connectedBusy='1';
      el.disabled=true;
      el.dataset.oldText=el.dataset.oldText||'Show connected circuits';
      el.textContent='Showing…';
    }
    try{ this.map?.dragging?.enable?.(); }catch(e){}
    const job=token?this.showConnectedCircuitsForReferenceToken(token,code,{key,button:el}):this.showConnectedCircuitsForCodes([code],`abbreviation ${code}`,{key,button:el});
    Promise.resolve(job).catch(err=>{
      Diagnostics?.capture?.(err);
      UI?.toast?.('Connected circuits failed.');
    }).finally(()=>{
      if(el){
        el.disabled=false;
        el.dataset.connectedBusy='0';
        el.textContent=(this.connectedLinesVisible&&this.connectedLinesKey===key)?'Hide connected circuits':'Show connected circuits';
      }
    });
    return false;
  },
  connectedReferenceKeyFromToken(token='',fallbackCode=''){
    const raw=String(token||'');
    let key=raw;
    try{key=decodeURIComponent(raw);}catch(e){}
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const code=compact(fallbackCode);
    if(code)return `CODE:${code}`;
    if(key)return `REF:${compact(key)}`;
    return 'CONNECTED';
  },
  isConnectedReferenceActive(token='',fallbackCode=''){
    const key=this.connectedReferenceKeyFromToken?.(token,fallbackCode)||String(fallbackCode||token||'').toUpperCase();
    return !!(this.connectedLinesVisible&&this.connectedLinesKey&&this.connectedLinesKey===key);
  },
  hideConnectedCircuitLines(){
    try{this.connectedLineLayer?.clearLayers?.();}catch(e){}
    this.connectedLinesVisible=false;
    this.connectedLinesKey='';
    this.connectedLinesReference=null;
    this.connectedLinesList=[];
    try{document.querySelectorAll('.show-connected-circuits-btn').forEach(b=>{b.textContent='Show connected circuits';});}catch(e){}
  },
  async showConnectedCircuitsForReferenceToken(token='',fallbackCode='',opts={}){
    const raw=String(token||'');
    let key=raw;
    try{key=decodeURIComponent(raw);}catch(e){}
    let a=(this.connectedReferenceRegistry&&this.connectedReferenceRegistry.get(key))||(this.connectedReferenceRegistry&&this.connectedReferenceRegistry.get(raw))||(SearchEngine?.assetMap&&SearchEngine.assetMap.get(key))||(SearchEngine?.assetMap&&SearchEngine.assetMap.get(raw))||(App.assets||[]).find(x=>String(x?.id||'')===key||String(x?.id||'')===raw);
    if(!a&&this.connectedReferenceRegistry){
      const ck=SearchEngine?.compact?SearchEngine.compact(key):key.toUpperCase().replace(/[^A-Z0-9]/g,'');
      for(const [k,v] of this.connectedReferenceRegistry.entries()){
        const c=SearchEngine?.compact?SearchEngine.compact(k):String(k).toUpperCase().replace(/[^A-Z0-9]/g,'');
        if(c&&ck&&c===ck){a=v;break;}
      }
    }
    if(!a&&fallbackCode){
      const code=SearchEngine?.compact?SearchEngine.compact(fallbackCode):String(fallbackCode).toUpperCase().replace(/[^A-Z0-9]/g,'');
      const list=(SearchEngine?.referencePointsByCode&&SearchEngine.referencePointsByCode.get(code))||[];
      a=list[0]||null;
    }
    if(!a&&fallbackCode){
      return this.showConnectedCircuitsForCodes([fallbackCode],`code ${fallbackCode}`,opts);
    }
    if(!a){UI.toast('Substation/terminal reference not found.');return 0;}
    return this.showConnectedCircuitsForReference(a,fallbackCode?[fallbackCode]:[],opts);
  },
  async showReferencePoints(kind='substation'){
    if(!this.map){UI.toast('Map not ready.');return 0;}
    this.cancelDraw();
    this.markerLayer?.clearLayers();
    this.routeLayer?.clearLayers();
    this.connectedLineLayer?.clearLayers();
    this.connectedLinesVisible=false; this.connectedLinesKey=''; this.connectedLinesList=[];
    UtilitiesEngine?.clear?.(false);
    HVCrossingsLayer?.clearActive?.({silent:true});
    const want=String(kind||'substation').toLowerCase();
    // V3.1.80: never trust an empty reference index over the actual loaded assets.
    // V3.1.79 could leave SearchEngine.referencePoints as an empty array after a smart-skip/import path,
    // which made Show All Substations say nothing was loaded even though App.assets still contained them.
    try{
      if(SearchEngine?.buildReferenceIndex && (!Array.isArray(SearchEngine.referencePoints)||!SearchEngine.referencePoints.length)){
        SearchEngine.buildReferenceIndex(App.assets||[]);
      }
    }catch(e){Diagnostics?.log?.('Reference index recovery skipped',String(e?.message||e));}
    const refSource=[];
    const seenRefs=new Set();
    const addRef=(a)=>{
      if(!a||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))return;
      const raw=a.raw||{};
      const text=[a.kind,a.category,a.type,raw.TYPE,raw.type,raw.ASSET_TYPE,raw.asset_type,raw.SEARCH_FIELD,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.TERMINAL,raw.TERMINAL_NAME,raw.DEPOT_NAME,a.label].join(' ').toUpperCase();
      const isRef=SearchEngine?.isReferencePointAsset?SearchEngine.isReferencePointAsset(a):/SUBSTATION|SUBSTN|TERMINAL|SWITCHYARD|DEPOT|\bZONE\b/.test(text);
      if(!isRef)return;
      const id=String(a.id||a.assetId||a.globalId||'')||`${Number(a.lat).toFixed(7)},${Number(a.lon).toFixed(7)},${this.referenceTitle(a)}`;
      if(seenRefs.has(id))return;
      seenRefs.add(id); refSource.push(a);
    };
    for(const a of (Array.isArray(SearchEngine?.referencePoints)?SearchEngine.referencePoints:[]))addRef(a);
    // Recovery union: smart-skip/index rebuilds can leave SearchEngine.referencePoints incomplete.
    // Always union against the loaded asset records so Show All Substations/Depots cannot drop
    // imported reference points just because the saved reference index is stale.
    for(const a of (App.assets||[]))addRef(a);
    const list=refSource.filter(a=>{
      if(!a||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))return false;
      const k=SearchEngine?.referenceKind?SearchEngine.referenceKind(a):String(a.kind||'').toLowerCase();
      if(want==='depot')return k==='depot';
      return k==='substation'||k==='terminal';
    }).sort((a,b)=>this.referenceTitle(a).localeCompare(this.referenceTitle(b),undefined,{numeric:true,sensitivity:'base'}));
    if(!list.length){
      try{SearchEngine?.buildReferenceIndex?.(App.assets||[]);}catch(e){}
      UI.toast(want==='depot'?'No depots with map points loaded. Re-import depot file if this continues.':'No substations/terminals with map points loaded. Re-import substation/terminal file if this continues.');
      return 0;
    }
    App.drawnMarkers=0;
    this.currentDisplay=want==='depot'?'all depots':'all substations';
    this.currentCircuit=null;
    this.currentCircuits=[];
    this.currentCircuitRoutes=[];
    this.lastFullCircuitAssets=[];
    this.lastFullCircuitLabel='';
    const batch=90;
    for(let i=0;i<list.length;i+=batch){
      for(const a of list.slice(i,i+batch)){this.addMarker(a,{mode:'dom-dot'});App.drawnMarkers++;}
      UI.refreshCounts?.();
      await new Promise(r=>requestAnimationFrame(r));
    }
    this.lastDrawnAssets=list.slice();
    this.fitVisible();
    UI.toast(`${want==='depot'?'Depots':'Substations'} shown: ${list.length.toLocaleString()}.`);
    return list.length;
  },

  connectedStrictCodesForReference(a,extraCodes=[]){
    // CONNECTED-LINES RULE: use only the selected reference abbreviation/code.
    // No proximity-derived, name-derived, or multi-code guessing here.
    // If the abbreviation is not explicitly on the reference record, do not invent one.
    const out=[]; const seen=new Set();
    const bad=/^(SUB|SUBS|SUBSTATION|SUBSTN|STATION|TERMINAL|TERM|DEPOT|ZONE|ZONE50|ZONE51|SWITCHYARD|WESTERN|POWER|TRANSMISSION|DISTRIBUTION|PUBLIC|SECURE|POINT|POLE|TOWER|STRUCTURE|ASSET|OBJECT|OBJECTID|GLOBALID|FEATURE|FEATUREID|UNKNOWN|NULL|NONE|NIL|NA|GPS|LAT|LONG|EASTING|NORTHING|OWNER|AER|NSP)$/i;
    const clean=(v)=>SearchEngine?.compact?SearchEngine.compact(v):String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const add=(v)=>{
      let c=clean(v);
      if(!c||bad.test(c)||!/[A-Z]/.test(c)||c.length>6)return;
      if(!seen.has(c)){seen.add(c);out.push(c);}
    };
    const raw=a?.raw||{};
    const rawVal=(names)=>{
      for(const name of names||[]){
        if(raw[name]!==undefined&&raw[name]!==null&&String(raw[name]).trim())return String(raw[name]).trim();
        const hit=Object.keys(raw).find(k=>String(k).toUpperCase()===String(name).toUpperCase());
        if(hit&&raw[hit]!==undefined&&raw[hit]!==null&&String(raw[hit]).trim())return String(raw[hit]).trim();
      }
      return '';
    };
    const explicitFields=['ABBREVIATION','ABBREV','ABBR','ACRONYM','SHORT_NAME','SHORTCODE','STATION_CODE','STN_CODE','SUBSTATION_CODE','SUBSTN_CODE','SUB_CODE','TERMINAL_CODE','TER_CODE','TERMINAL_ABBR','SUBSTATION_ABBR','SITE_CODE'];
    for(const f of explicitFields)add(rawVal([f]));
    add(a?.abbreviation); add(a?.abbr); add(a?.stationCode); add(a?.substationCode); add(a?.terminalCode);
    // Only accept CODE/ALIAS if it looks like a real short station code, not object id / feature id.
    for(const f of ['CODE','ALIAS','SITE']){
      const v=rawVal([f]);
      if(v&&String(v).length<=8)add(v);
    }
    // Explicit bracketed/parenthesised codes inside reference title/search field, e.g. MERREDIN TERMINAL (MRT), Kalamunda (K).
    const textFields=[raw.SEARCH_FIELD,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.NAME,raw.TITLE,raw.TERMINAL,raw.TERMINAL_NAME,a?.substation,a?.terminal,a?.label,SearchEngine?.referenceName?.(a)||''].filter(Boolean).map(String);
    for(const t of textFields){
      let m; const re=/[\(\[]\s*([A-Z0-9]{1,6})\s*[\)\]]/gi;
      while((m=re.exec(t)))add(m[1]);
    }
    // Free-text terminal/substation suffix forms only when they clearly carry a code at the end.
    // Examples: "Byford Substation BYF", "Terminal OP", "Baandee Terminal BD".
    for(const t0 of textFields){
      const t=String(t0||'').trim(); if(!t)return;
      let m;
      m=t.match(/\b(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\s*[-–—:\/]?\s*([A-Z0-9]{1,5})\s*$/i); if(m)add(m[1]);
      m=t.match(/\b(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\b.*?\b([A-Z0-9]{1,5})\s*$/i); if(m)add(m[1]);
    }
    // Extra code from the popup is accepted last, but only when it passes the same strict cleaning.
    for(const c of extraCodes||[])add(c);
    // Keep the first explicit code only. This prevents nearby/alternate codes being unioned into unrelated line sets.
    return out.slice(0,1);
  },
  referenceCodesFor(a,extraCodes=[]){
    const vals=[]; const seen=new Set(); const strongSeen=new Set();
    const badCode=/^(SUB|SUBS|SUBSTATION|SUBSTN|STATION|TERMINAL|TERM|DEPOT|ZONE|SWITCHYARD|WESTERN|POWER|TRANSMISSION|DISTRIBUTION|PUBLIC|SECURE|POINT|POLE|TOWER|STRUCTURE|ASSET|UNKNOWN|NULL|NONE|NIL|NA|GPS|LAT|LONG|INAL)$/i;
    const addCode=(c,strong=false)=>{
      c=SearchEngine?.compact?SearchEngine.compact(c):String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(!c||badCode.test(c)||!/[A-Z]/.test(c)||c.length>8)return;
      // Plain free-text names like MERREDIN TERMINAL or BAANDEE TERMINAL are not abbreviations.
      // Keep long tokens only when they came from explicit code fields or endpoint/proximity derivation.
      if(!strong&&c.length>4)return;
      if(strong)strongSeen.add(c);
      if(!seen.has(c)){seen.add(c);vals.push(c);}
    };
    try{for(const c of SearchEngine?.referenceCodeCandidates?.(a)||[])addCode(c,false);}catch(e){}
    try{for(const c of extraCodes||[])addCode(c,true);}catch(e){}
    const raw=a?.raw||{};
    const addText=(v,explicit=false)=>{
      v=String(v??'').trim(); if(!v)return;
      const parts=v.split(/[;,|]+/);
      for(let part of parts){
        part=String(part||'').trim(); if(!part)continue;
        let m; const paren=/[\(\[]\s*([A-Z0-9]{1,8}(?:\s*[-\/]\s*[A-Z0-9]{1,4})?)\s*[\)\]]/gi;
        while((m=paren.exec(part)))addCode(m[1],true);
        m=/^\s*([A-Z0-9]{1,8})\s*[-–—:]\s+/i.exec(part); if(m)addCode(m[1],explicit);
        m=/\s+[-–—:]\s*([A-Z0-9]{1,8})\s*$/i.exec(part); if(m)addCode(m[1],explicit);
        m=/^\s*([A-Z0-9]{1,6})\s+(?:TERMINAL|TERM|SUBSTATION|SUBSTN|SWITCHYARD|ZONE\s+SUB)\b/i.exec(part); if(m)addCode(m[1],explicit);
        if(explicit){for(const t of part.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean))addCode(t,true);}
      }
    };
    const explicitKeys=['ABBREVIATION','abbreviation','ABBREV','abbrev','ABBR','abbr','CODE','code','STATION_CODE','SUBSTATION_CODE','TERMINAL_CODE','SITE_CODE','STN_CODE','SUB_CODE','SUBSTN_CODE','TER_CODE','short_name','SHORT_NAME','alias','ALIAS'];
    for(const k of explicitKeys)addText(raw[k],true);
    for(const [k,v] of Object.entries(raw)){ if(/ABBR|ABBREV|ACRONYM|SHORT|\bCODE\b|SITE|STN|SUBSTN|SUBSTATION_CODE|TERMINAL_CODE|TER_CODE/i.test(k))addText(v,true); }
    addText(a?.abbreviation,true); addText(a?.abbr,true); addText(a?.code,true); addText(a?.stationCode,true); addText(a?.substationCode,true); addText(a?.terminalCode,true);
    const refCode=SearchEngine?.referenceCode?.(a)||''; addCode(refCode,false);
    try{for(const c of SearchEngine?.deriveReferenceCodesFromLineEndpoints?.(a,12)||[])addCode(c,true);}catch(e){}
    const refKind=(SearchEngine?.referenceKind?SearchEngine.referenceKind(a):String(a?.kind||'').toLowerCase());
    const texts=[raw.SEARCH_FIELD,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.NAME,raw.TITLE,raw.TERMINAL,raw.TERMINAL_NAME,a?.substation,a?.terminal,a?.label,SearchEngine?.referenceName?.(a)||''].filter(Boolean).map(String);
    for(const t of texts)addText(t,false);
    // More robust imported reference parsing. Common source files often store the code
    // inside free text only, e.g. "Byford Substation BYF", "Terminal OP", or
    // "Byford / BYF". Pull those tokens without hard-coding any station names.
    for(const t of texts){
      const tx=String(t||'').trim();
      let m;
      m=tx.match(/\b(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\s*[-–—:\/]?\s*([A-Z0-9]{1,5})\s*$/i); if(m)addCode(m[1],false);
      m=tx.match(/(?:^|[\s,;|])([A-Z0-9]{1,4})\s*[-–—:\/]?\s*(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\b/i); if(m)addCode(m[1],false);
      m=tx.match(/\b(?:SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)\b.*?\b([A-Z0-9]{1,5})\s*$/i); if(m)addCode(m[1],false);
      m=tx.match(/(?:^|[\s,;|])([A-Z0-9]{1,5})\s*$/); if(m&&/(SUBSTATION|SUBSTN|STATION|SWITCHYARD|TERMINAL|TERM|ZONE\s+SUB)/i.test(tx))addCode(m[1]);
    }
    if(refKind==='terminal'){
      for(const t of texts){const m=String(t).trim().match(/^([A-Z0-9])(?:\s|$|[-–—:])/i); if(m)addCode(m[1],false);}
    }
    // When transmission lines are indexed, suppress weak free-text fragments that are not actual line endpoints.
    // Explicit/imported fields and proximity-derived endpoint codes always survive.
    try{
      const idx=this.buildConnectedEndpointIndex?.();
      if(idx?.byCode?.size){
        const filtered=vals.filter(c=>strongSeen.has(c)||idx.byCode.has(c)||c.length<=3);
        return filtered.length?filtered:vals.filter(c=>strongSeen.has(c)||idx.byCode.has(c));
      }
    }catch(e){}
    return vals;
  },
  endpointCoordsForLineGroup(g){
    const assets=(g?.assets||[]).filter(a=>Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))).slice();
    try{assets.sort(SearchEngine.sortByStructure);}catch(e){}
    const pts=[];
    const take=10;
    let startAssets=assets.slice(0,take), endAssets=assets.slice(Math.max(0,assets.length-take));
    if(assets.length&&assets.length<=take*2){
      const split=Math.max(1,Math.floor(assets.length/2));
      startAssets=assets.slice(0,split);
      endAssets=assets.slice(split);
    }
    for(const a of startAssets)pts.push([Number(a.lat),Number(a.lon)]);
    for(const a of endAssets)pts.push([Number(a.lat),Number(a.lon)]);
    for(const r of (g?.routeAssets||[])){
      const coords=Array.isArray(r?.routeCoords)?r.routeCoords:[];
      if(coords.length){
        const first=coords[0], last=coords[coords.length-1];
        if(Array.isArray(first)&&Number.isFinite(Number(first[0]))&&Number.isFinite(Number(first[1])))pts.push([Number(first[0]),Number(first[1])]);
        if(Array.isArray(last)&&Number.isFinite(Number(last[0]))&&Number.isFinite(Number(last[1])))pts.push([Number(last[0]),Number(last[1])]);
      }
    }
    return pts;
  },
  isReferenceNearLineEndpoint(a,g,maxKm=2.2){
    if(!Number.isFinite(Number(a?.lat))||!Number.isFinite(Number(a?.lon)))return false;
    const ref={lat:Number(a.lat),lon:Number(a.lon)};
    const pts=this.endpointCoordsForLineGroup(g);
    for(const p of pts){
      let km=Infinity;
      try{km=SearchEngine?.distanceKm?SearchEngine.distanceKm(ref,{lat:p[0],lon:p[1]}):Infinity;}catch(e){}
      if(!Number.isFinite(km)){
        const R=6371,dLat=(p[0]-ref.lat)*Math.PI/180,dLon=(p[1]-ref.lon)*Math.PI/180,la1=ref.lat*Math.PI/180,la2=p[0]*Math.PI/180;
        const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2; km=2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
      }
      if(km<=maxKm)return true;
    }
    return false;
  },
  connectedEndpointCodesForLine(line){
    const raw=String(line||'').toUpperCase().replace(/[–—_]+/g,'-').replace(/\s+/g,' ').trim();
    const out=[]; const add=c=>{c=String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,''); if(c&&/[A-Z]/.test(c)&&c.length<=8&&!out.includes(c))out.push(c);};
    try{for(const c of SearchEngine?.lineEndpointCodes?.(raw)||[])add(c);}catch(e){}
    // Strip the voltage/circuit suffix, then split endpoint section. Examples:
    // BYF-CC 81 -> BYF, CC · KW-KEM/OLY 91 -> KW, KEM, OLY · A-OP 81 -> A, OP
    let core=raw.replace(/\b(?:\d{1,3}|X\d|[A-Z]?\d{1,2})\s*$/,'').trim();
    core=core.replace(/\s+\d{1,4}[A-Z0-9]*$/,'').trim();
    const m=core.match(/^([A-Z0-9]{1,8})\s*-\s*([A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*)/);
    if(m){ add(m[1]); for(const part of m[2].split('/'))add(part); }
    else{
      for(const part of core.split(/[-\/]/))add(part);
    }
    return out;
  },
  lineLabelsForAssetConnected(a){
    const out=[]; const add=l=>{l=SearchEngine?.formatCircuitName?.(l)||String(l||'').trim(); const k=SearchEngine?.compact?.(l)||l.toUpperCase().replace(/[^A-Z0-9]/g,''); if(l&&/\d|X\d/i.test(l)&&!out.some(x=>(SearchEngine?.compact?.(x)||x)===k))out.push(l);};
    try{for(const r of SearchEngine?.lineRefsForAsset?.(a,true)||[])add(r.line);}catch(e){}
    add(a?.line); add(a?.raw?.LINE_NAME); add(a?.raw?.LINE_NAME_1);
    const text=[a?.gisLabel,a?.structure,a?.label,a?.raw?.TRMSN_LINE_GIS_LABEL,a?.raw?.LINE_NAME,a?.raw?.LINE_NAME_1].filter(Boolean).join(' ');
    try{for(const r of SearchEngine?.extractLineRefsFromText?.(text)||[])add(r.line);}catch(e){}
    const re=/\b([A-Z0-9]{1,8}\s*[-–—]\s*[A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*\s*(?:X\d|\d{1,3}|[A-Z]?\d{1,2}))\b/gi;
    let m; while((m=re.exec(text)))add(m[1]);
    return out;
  },
  buildConnectedEndpointIndex(){
    // FAST connected-circuit index. Do not scan every imported asset here.
    // The old button path scanned App.assets and then scanned again while drawing lines,
    // which caused mobile freezes on large local imports.
    const lineMap=SearchEngine?.lineMap;
    const stamp=[lineMap?.size||0,App.lastImport?.time||'',App.assets?.length||0].join('|');
    if(this.connectedEndpointIndex&&this.connectedEndpointIndexStamp===stamp)return this.connectedEndpointIndex;
    const byCode=new Map(), lineSet=new Set();
    const addToCode=(code,line)=>{
      const ck=SearchEngine?.compact?.(code)||String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      line=SearchEngine?.formatCircuitName?.(line)||String(line||'').trim();
      const lk=SearchEngine?.compact?.(line)||line.toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(!ck||!/[A-Z]/.test(ck)||ck.length>8||!line||!lk||lineSet.has(lk+'|'+ck))return;
      lineSet.add(lk+'|'+ck);
      if(!byCode.has(ck))byCode.set(ck,new Set());
      byCode.get(ck).add(line);
    };
    try{
      for(const g of lineMap?.values?.()||[]){
        const line=SearchEngine?.formatCircuitName?.(g?.line||g?.rawLine||'')||String(g?.line||g?.rawLine||'').trim();
        if(!line)continue;
        let codes=[];
        try{codes=SearchEngine?.lineEndpointCodes?.(line)||this.connectedEndpointCodesForLine(line)||[];}catch(e){codes=this.connectedEndpointCodesForLine(line)||[];}
        for(const c of codes)addToCode(c,line);
      }
    }catch(e){Diagnostics?.log?.('Connected endpoint index failed',String(e?.message||e));}
    this.connectedEndpointIndex={byCode};
    this.connectedEndpointIndexStamp=stamp;
    return this.connectedEndpointIndex;
  },
  referenceNameKeysForConnected(a){
    const raw=a?.raw||{};
    const addRaw=[raw.SEARCH_FIELD,raw.SUBSTATION,raw.SUBSTATION_NAME,raw.SUBSTN_NAME,raw.STATION_NAME,raw.TERMINAL,raw.TERMINAL_NAME,raw.NAME,raw.TITLE,a?.substation,a?.terminal,a?.label];
    const out=[]; const seen=new Set();
    const push=(v)=>{
      let t=String(v||'').toUpperCase();
      if(!t)return;
      t=t.replace(/[\(\[]\s*[A-Z0-9]{1,10}\s*[\)\]]\s*$/,'');
      t=t.replace(/\b(SUBSTATION|SUBSTN|STATION|TERMINAL|TERM|SWITCHYARD|ZONE|SUB|DEPOT|WESTERN|POWER|TRANSMISSION|DISTRIBUTION)\b/g,' ');
      t=t.replace(/[^A-Z0-9]+/g,' ').trim();
      if(!t)return;
      const compact=SearchEngine?.compact?SearchEngine.compact(t):t.replace(/[^A-Z0-9]/g,'');
      if(compact.length>=4&&!seen.has(compact)){seen.add(compact);out.push(compact);}
      for(const part of t.split(/\s+/)){
        const c=SearchEngine?.compact?SearchEngine.compact(part):part.replace(/[^A-Z0-9]/g,'');
        if(c.length>=4&&!seen.has(c)){seen.add(c);out.push(c);}
      }
    };
    for(const v of addRaw)push(v);
    return out;
  },
  connectedLineTextKeys(line,g){
    const arr=[line,g?.line,g?.rawLine,g?.label,g?.gisLabel];
    try{for(const a of g?.assets||[]){arr.push(a?.line,a?.label,a?.gisLabel,a?.raw?.LINE_NAME,a?.raw?.LINE_NAME_1,a?.raw?.TRMSN_LINE_GIS_LABEL);}}
    catch(e){}
    return arr.filter(Boolean).map(v=>SearchEngine?.compact?SearchEngine.compact(v):String(v).toUpperCase().replace(/[^A-Z0-9]/g,''));
  },
  assetHasExactConfirmedLine(a,line){
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const target=compact(this.connectedCircuitNameForMatch?.(line)||line);
    if(!a||!target)return false;
    try{
      const refs=SearchEngine?.lineRefsForAsset?.(a,false)||[]; // confirmed refs only; no inferred/proximity aliases
      for(const r of refs){
        const lk=compact(this.connectedCircuitNameForMatch?.(r?.line)||r?.line);
        if(lk&&lk===target)return true;
      }
    }catch(e){}
    const direct=compact(this.connectedCircuitNameForMatch?.(a?.line||'')||a?.line||'');
    return !!(direct&&direct===target);
  },
  connectedGroupsForExactLine(line){
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const target=compact(this.connectedCircuitNameForMatch?.(line)||line);
    const groups=[]; const seen=new Set();
    const groupMatches=(g,mapKey='')=>{
      const labels=[g?.line,g?.rawLine,g?.label,g?.gisLabel,mapKey];
      for(const v of labels){if(compact(this.connectedCircuitNameForMatch?.(v)||v)===target)return true;}
      const assets=[...(Array.isArray(g?.assets)?g.assets:[]),...(Array.isArray(g?.routeAssets)?g.routeAssets:[])];
      for(const a of assets.slice(0,80)){
        try{for(const l of SearchEngine?.lineLabelsForAssetConnected?.(a)||[]){if(compact(this.connectedCircuitNameForMatch?.(l)||l)===target)return true;}}catch(e){}
        for(const v of [a?.line,a?.raw?.LINE_NAME,a?.raw?.LINE_NAME_1,a?.raw?.TRMSN_LINE_GIS_LABEL,a?.gisLabel,a?.label]){
          if(compact(this.connectedCircuitNameForMatch?.(v)||v)===target)return true;
        }
      }
      return false;
    };
    try{
      for(const [k,g] of SearchEngine?.lineMap?.entries?.()||[]){
        const id=String(k||'')+'|'+String(g?.line||g?.rawLine||'');
        if(!seen.has(id)&&groupMatches(g,k)){seen.add(id);groups.push(g);}
      }
    }catch(e){Diagnostics?.log?.('Connected exact group lookup failed',String(e?.message||e));}
    return groups;
  },
  connectedAssetsForLineFallback(line){
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const target=compact(this.connectedCircuitNameForMatch?.(line)||line);
    const groups=this.connectedGroupsForExactLine?.(line)||[];
    const exact=[]; const loose=[]; const seenExact=new Set(); const seenLoose=new Set();
    const push=(arr,a,seen)=>{
      if(!a||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))return;
      const id=String(a.id||a.uid||'')||`${Number(a.lat).toFixed(6)},${Number(a.lon).toFixed(6)}`;
      if(seen.has(id))return; seen.add(id); arr.push(a);
    };
    const assetMatches=(a)=>{
      try{for(const l of SearchEngine?.lineLabelsForAssetConnected?.(a)||[]){if(compact(this.connectedCircuitNameForMatch?.(l)||l)===target)return true;}}catch(e){}
      for(const v of [a?.line,a?.raw?.LINE_NAME,a?.raw?.LINE_NAME_1,a?.raw?.TRMSN_LINE_GIS_LABEL,a?.gisLabel,a?.label]){
        if(compact(this.connectedCircuitNameForMatch?.(v)||v)===target)return true;
      }
      return false;
    };
    for(const g of groups){
      for(const a of (Array.isArray(g?.assets)?g.assets:[])){
        if(assetMatches(a))push(exact,a,seenExact);
        push(loose,a,seenLoose);
      }
    }
    const assets=exact.length>=2?exact:[];
    try{assets.sort(SearchEngine?.sortByStructure||(()=>0));}catch(e){}
    return assets;
  },
  connectedRouteAssetsForLineStrict(line){
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const target=compact(this.connectedCircuitNameForMatch?.(line)||line);
    const groups=this.connectedGroupsForExactLine?.(line)||[];
    const out=[]; const seen=new Set();
    const routeMatches=(a)=>{
      try{for(const l of SearchEngine?.lineLabelsForAssetConnected?.(a)||[]){if(compact(this.connectedCircuitNameForMatch?.(l)||l)===target)return true;}}catch(e){}
      for(const v of [a?.line,a?.raw?.LINE_NAME,a?.raw?.LINE_NAME_1,a?.raw?.TRMSN_LINE_GIS_LABEL,a?.gisLabel,a?.label]){
        if(compact(this.connectedCircuitNameForMatch?.(v)||v)===target)return true;
      }
      return false;
    };
    for(const g of groups){
      for(const r of (Array.isArray(g?.routeAssets)?g.routeAssets:[])){
        const id=String(r?.id||r?.uid||r?.raw?.OBJECTID||'')||JSON.stringify((r?.routeCoords||[]).slice(0,1));
        if(seen.has(id))continue;
        if(routeMatches(r)){seen.add(id);out.push(r);}
      }
    }
    return out;
  },

  connectedCircuitsByEndpointProximity(a,maxKm=8){
    const out=[]; const seen=new Set();
    const addLine=(line)=>{
      line=SearchEngine?.formatCircuitName?.(line)||String(line||'').trim();
      const key=SearchEngine?.compact?.(line)||String(line||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(line&&key&&!seen.has(key)){seen.add(key);out.push(line);}
    };
    if(!a||!Number.isFinite(Number(a?.lat))||!Number.isFinite(Number(a?.lon)))return out;
    const ref={lat:Number(a.lat),lon:Number(a.lon)};
    const dist=(pt)=>{
      try{return SearchEngine?.distanceKm?SearchEngine.distanceKm(ref,{lat:Number(pt[0]),lon:Number(pt[1])}):Infinity;}catch(e){return Infinity;}
    };
    try{
      for(const g of SearchEngine?.lineMap?.values?.()||[]){
        const line=SearchEngine?.formatCircuitName?.(g?.line||g?.rawLine||'')||String(g?.line||g?.rawLine||'').trim();
        if(!line)continue;
        let best=Infinity;
        const pts=this.endpointCoordsForLineGroup?.(g)||[];
        for(const p of pts){
          if(!Array.isArray(p))continue;
          const km=dist(p); if(km<best)best=km;
          if(best<=maxKm)break;
        }
        if(best<=maxKm)addLine(line);
      }
    }catch(e){Diagnostics?.log?.('Connected circuit endpoint proximity failed',String(e?.message||e));}
    return out;
  },
  connectedCanonicalCircuitName(line){
    let original=String(line||'').trim().replace(/[–—_]+/g,'-').replace(/\s+/g,' ');
    if(!original)return '';
    let s=original.toUpperCase().replace(/[–—_]+/g,'-').replace(/\s+/g,' ').trim();
    try{s=String(SearchEngine?.formatCircuitName?.(s)||s).toUpperCase().replace(/[–—_]+/g,'-').replace(/\s+/g,' ').trim();}catch(e){}
    // Collapse branch/geometry labels back to the real circuit label.
    // Examples: KAT-WAG 71-G0000 -> KAT-WAG 71, KW-KEM/OLY 91-G0000 -> KW-KEM/OLY 91.
    let m=s.match(/^([A-Z0-9]{1,8})\s*-\s*([A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*)\s+(X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3}(?:\/[A-Z0-9]{1,4})?)(?:\s*[-]\s*[A-Z0-9/]+.*)?$/i);
    if(m)return `${m[1].toUpperCase()}-${String(m[2]||'').toUpperCase().replace(/\s*\/\s*/g,'/')} ${m[3].toUpperCase()}`;
    // Compact two-letter circuit fallback only, e.g. DK81 -> D-K 81.
    if(!/-/.test(s)){
      const compact=String(original||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      m=compact.match(/^([A-Z]{2})(X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3})(?:[A-Z]\d{3,})?$/);
      if(m)return `${m[1][0]}-${m[1][1]} ${m[2]}`;
    }
    // Last resort: remove trailing GIS/branch suffixes only after a valid circuit token.
    s=s.replace(/\s*[-]\s*[A-Z]?\d{3,}[A-Z0-9/]*\s*$/,'').trim();
    return s;
  },
  connectedCircuitNameForMatch(line){
    return this.connectedCanonicalCircuitName?.(line)||String(line||'').trim().toUpperCase();
  },
  connectedEndpointTokensFromCircuitName(line){
    const raw=String(line||'');
    const name=this.connectedCanonicalCircuitName?.(raw)||raw;
    const out=[]; const seen=new Set();
    const add=v=>{
      const c=SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(c&&/[A-Z]/.test(c)&&c.length<=8&&!seen.has(c)){seen.add(c);out.push(c);}
    };
    // Exact endpoint tokens only. Use the same parser as circuit search so every substation/terminal
    // button uses the loaded circuit names, not a broken local regex.
    try{
      const parsed=SearchEngine?.lineEndpointCodes?.(name)||[];
      for(const c of parsed)add(c);
      if(out.length>=2)return out;
    }catch(e){}
    const m=String(name||'').match(/^([A-Z0-9]{1,8})\s*-\s*([A-Z0-9]{1,8}(?:\s*\/\s*[A-Z0-9]{1,8})*)\s+(?:X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3})\b/i);
    if(m){
      add(m[1]);
      for(const part of String(m[2]||'').split('/'))add(part);
    }
    return out;
  },
  connectedLineHasExactReferenceCode(line,codes=[]){
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const wanted=(codes||[]).map(compact).filter(c=>c&&/[A-Z]/.test(c)&&c.length<=8);
    if(!wanted.length)return false;
    const tokens=this.connectedEndpointTokensFromCircuitName?.(line)||[];
    return wanted.some(c=>tokens.includes(c));
  },
  connectedCircuitCandidateLines(){
    const out=[]; const seen=new Set();
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const add=(v)=>{
      const line=this.connectedCircuitNameForMatch?.(v)||String(v||'').trim();
      const key=compact(line);
      if(!line||!key||seen.has(key))return;
      const tokens=this.connectedEndpointTokensFromCircuitName?.(line)||[];
      if(tokens.length<2)return;
      if(!/^([A-Z0-9]{1,8})\s*-\s*[A-Z0-9]{1,8}/.test(line)||!/(?:\s|^)(?:X\d|[A-Z]?\d{1,4}[A-Z0-9]{0,3})\b/.test(line))return;
      if(SearchEngine?.isDisplayableTransmissionCircuitLine&&!SearchEngine.isDisplayableTransmissionCircuitLine(line))return;
      seen.add(key); out.push(line);
    };
    try{
      try{
        const pathIdx=SearchEngine?.buildCircuitPathIndex?.(App.assets||[])||SearchEngine?.circuitPathIndex;
        for(const g of pathIdx?.values?.()||[])add(g?.line);
      }catch(e){}
      for(const [mapKey,g] of SearchEngine?.lineMap?.entries?.()||[]){
        add(g?.line); add(g?.rawLine); add(g?.label); add(g?.gisLabel); add(mapKey);
        const assets=[...(Array.isArray(g?.assets)?g.assets:[]),...(Array.isArray(g?.routeAssets)?g.routeAssets:[])];
        for(const a of assets.slice(0,80)){
          try{for(const l of SearchEngine?.lineLabelsForAssetConnected?.(a)||[])add(l);}catch(e){}
          add(a?.line); add(a?.raw?.LINE_NAME); add(a?.raw?.LINE_NAME_1); add(a?.raw?.TRMSN_LINE_GIS_LABEL); add(a?.gisLabel); add(a?.label);
        }
      }
    }catch(e){Diagnostics?.log?.('Connected candidate line build failed',String(e?.message||e));}
    return out.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
  },
  connectedCircuitsForReference(a,extraCodes=[]){
    const out=[]; const seen=new Set();
    if(!a)return out;
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const codes=this.connectedStrictCodesForReference(a,extraCodes).map(compact).filter(c=>c&&/[A-Z]/.test(c)&&c.length<=6);
    if(!codes.length)return out;
    const addLine=(line)=>{
      line=this.connectedCircuitNameForMatch?.(line)||String(line||'').trim();
      const key=compact(line);
      if(!line||!key||seen.has(key))return;
      if(!this.connectedLineHasExactReferenceCode?.(line,codes))return;
      seen.add(key);
      out.push(line);
    };
    for(const line of this.connectedCircuitCandidateLines?.()||[])addLine(line);
    return out.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})).slice(0,36);
  },
  showConnectedCircuitsForCodes(codes=[],sourceLabel='code',opts={}){
    const clean=[]; const seen=new Set();
    const compact=(v)=>SearchEngine?.compact?SearchEngine.compact(v):String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    for(const c of codes||[]){const cc=compact(c); if(cc&&/[A-Z]/.test(cc)&&!seen.has(cc)){seen.add(cc);clean.push(cc);}}
    if(!clean.length){UI.toast('No substation/terminal abbreviation found.');return 0;}
    const fake={raw:{},label:String(sourceLabel||clean.join(', ')),kind:'terminal',abbreviation:clean[0],code:clean[0],substation:String(sourceLabel||clean[0])};
    clean.forEach((c,i)=>{fake.raw[i===0?'ABBREVIATION':`CODE_${i}`]=c;});
    return this.showConnectedCircuitsForReference(fake,[],opts);
  },
  sampleCoords(coords=[],max=220){
    const arr=(coords||[]).filter(c=>Array.isArray(c)&&Number.isFinite(Number(c[0]))&&Number.isFinite(Number(c[1]))).map(c=>[Number(c[0]),Number(c[1])]);
    if(arr.length<=max)return arr;
    const out=[]; const step=Math.max(1,Math.ceil(arr.length/max));
    for(let i=0;i<arr.length;i+=step)out.push(arr[i]);
    const last=arr[arr.length-1];
    if(last&&out[out.length-1]!==last)out.push(last);
    return out;
  },
  splitCoordsByDistance(coords=[],maxJumpKm=2.2){
    const out=[]; let cur=[];
    const dist=(a,b)=>{
      try{
        if(SearchEngine?.distanceKm)return SearchEngine.distanceKm({lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]});
      }catch(e){}
      const R=6371, dLat=(b[0]-a[0])*Math.PI/180, dLon=(b[1]-a[1])*Math.PI/180;
      const la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180;
      const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
      return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
    };
    for(const c of coords||[]){
      if(!Array.isArray(c)||!Number.isFinite(Number(c[0]))||!Number.isFinite(Number(c[1])))continue;
      const pt=[Number(c[0]),Number(c[1])];
      if(cur.length&&dist(cur[cur.length-1],pt)>maxJumpKm){
        if(cur.length>=2)out.push(cur);
        cur=[];
      }
      cur.push(pt);
    }
    if(cur.length>=2)out.push(cur);
    return out;
  },

  connectedAssetLabelsForLinePath(a){
    const raw=a?.raw||{};
    const vals=[
      raw.TRMSN_LINE_GIS_LABEL,raw.trmsn_line_gis_label,raw.LINE_NAME,raw.line_name,raw.LINE_NAME_1,raw.line_name_1,
      raw.CIRCUIT,raw.circuit,raw.FEEDER,raw.feeder,raw.NAME,raw.name,
      a?.gisLabel,a?.line,a?.rawLine,a?.label,a?.substation
    ];
    const out=[]; const seen=new Set();
    for(const v of vals){
      const s=String(v||'').trim();
      if(!s)continue;
      const k=s.toUpperCase().replace(/\s+/g,' ');
      if(seen.has(k))continue;
      seen.add(k); out.push(s);
    }
    try{
      for(const l of SearchEngine?.lineAliasesForAsset?.(a)||[]){
        const s=String(l||'').trim();
        const k=s.toUpperCase().replace(/\s+/g,' ');
        if(s&&!seen.has(k)){seen.add(k); out.push(s);}
      }
    }catch(e){}
    return out;
  },
  connectedAssetRefsForLinePath(a){
    try{return SearchEngine?.lineRefsForAsset?.(a,true)||[];}catch(e){return [];}
  },
  connectedAssetMatchesExactLine(a,line){
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const target=compact(this.connectedCircuitNameForMatch?.(line)||line);
    if(!target)return false;
    for(const v of this.connectedAssetLabelsForLinePath?.(a)||[]){
      const c=compact(this.connectedCircuitNameForMatch?.(v)||v);
      if(c===target)return true;
    }
    return false;
  },
  connectedStructureOrderFromLabel(label,asset=null){
    const s=String(label||'').toUpperCase().replace(/[–—_]+/g,'-').replace(/\s+/g,' ').trim();
    const tryToken=(tok='')=>{
      tok=String(tok||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(!tok)return null;
      let m=tok.match(/^G(\d{1,6})$/i);
      if(m)return {order:1000000+Number(m[1]||0),key:'G'+String(Number(m[1]||0)),raw:tok};
      m=tok.match(/^(\d{1,6})G$/i);
      if(m){
        const num=Number(m[1]||0);
        return {order:num+0.08,key:String(num)+'G',raw:tok};
      }
      m=tok.match(/^[A-Z]?(\d{1,6})([A-Z]{0,3})$/i);
      if(m)return {order:Number(m[1]),key:String(Number(m[1]))+(m[2]||''),raw:tok};
      return null;
    };
    // Prefer the structure suffix that follows the circuit name, e.g. NT-HBK 81-0057 or KAT-WAG 71-G0000.
    let matches=[]; let re=/-\s*([A-Z]?\d{1,6}[A-Z]{0,3})(?=\b|,|\s|$)/gi; let m;
    while((m=re.exec(s)))matches.push(m[1]);
    for(let i=matches.length-1;i>=0;i--){const r=tryToken(matches[i]); if(r)return r;}
    // Fallback to normal pole/structure fields when the imported label has already been normalised.
    const raw=asset?.raw||{};
    const candidates=[asset?.poleNumber,asset?.structure,asset?.structureNo,asset?.structure_id,raw.STRUCTURE_ID,raw.structure_id,raw.STRUCTURE,raw.POLE,raw.POLE_NUMBER,asset?.label,asset?.id];
    for(const v of candidates){
      const str=String(v||'').toUpperCase();
      let mm=str.match(/(\d{1,6}[A-Z]{0,3})\s*$/i);
      if(mm){const r=tryToken(mm[1]); if(r)return r;}
    }
    return null;
  },
  connectedStructurePathSegmentsForLine(line){
    // Build the connected line from the imported pole/tower points themselves.
    // This avoids drawing short bay stubs, duplicate route overlays, and fan/triangle joins.
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const target=compact(this.connectedCircuitNameForMatch?.(line)||line);
    if(!target)return [];
    const stamp=`${App?.assets?.length||0}|${SearchEngine?.lineMap?.size||0}|${target}`;
    if(!this._connectedStructurePathCache)this._connectedStructurePathCache=new Map();
    const cached=this._connectedStructurePathCache.get(stamp);
    if(cached)return cached;
    const seenAsset=new Set();
    const assets=[];
    const addAsset=(a)=>{
      if(!a||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon)))return;
      if(a.kind==='circuit'||UtilitiesEngine?.isUtility?.(a))return;
      const id=String(a.id||a.assetId||a.globalId||`${a.lat},${a.lon},${assets.length}`);
      if(seenAsset.has(id))return;
      if(!this.connectedAssetMatchesExactLine?.(a,line))return;
      seenAsset.add(id); assets.push(a);
    };
    try{for(const a of SearchEngine?.lineAssets?.(line)||[])addAsset(a);}catch(e){}
    // If the search index only returned a small partial subset, recover from loaded assets using exact circuit labels.
    if(assets.length<6){
      try{for(const a of App?.assets||[])addAsset(a);}catch(e){}
    }
    if(assets.length<2){this._connectedStructurePathCache.set(stamp,[]);return [];}
    const groups=new Map();
    const addPoint=(ord,a,label)=>{
      if(!ord)return;
      const key=`${ord.order}|${ord.key}`;
      if(!groups.has(key))groups.set(key,{order:ord.order,key:ord.key,label:String(label||''),pts:new Map()});
      const lat=Number(a.lat), lon=Number(a.lon);
      const pkey=lat.toFixed(7)+','+lon.toFixed(7);
      groups.get(key).pts.set(pkey,[lat,lon]);
    };
    for(const a of assets){
      let addedForAsset=false;
      // Prefer exact line/nameplate pairs. This prevents a shared pole carrying several
      // LINE_NAME_n fields from being ordered with the wrong NAMEPLATE_ID_n.
      for(const ref of this.connectedAssetRefsForLinePath?.(a)||[]){
        const lineName=this.connectedCircuitNameForMatch?.(ref?.line||'')||String(ref?.line||'');
        if(compact(lineName)!==target)continue;
        const ord=this.connectedStructureOrderFromLabel?.(ref?.pole||ref?.structure||'',a);
        if(ord){addPoint(ord,a,ref?.line||''); addedForAsset=true;}
      }
      if(addedForAsset)continue;
      let best=null, bestLabel='';
      const labels=this.connectedAssetLabelsForLinePath?.(a)||[];
      for(const lab of labels){
        if(compact(this.connectedCircuitNameForMatch?.(lab)||lab)!==target)continue;
        const ord=this.connectedStructureOrderFromLabel?.(lab,a);
        if(ord){best=ord;bestLabel=lab;break;}
      }
      if(!best)best=this.connectedStructureOrderFromLabel?.('',a);
      addPoint(best,a,bestLabel);
    }
    const rows=Array.from(groups.values()).filter(g=>g.pts.size).sort((a,b)=>a.order-b.order||String(a.key).localeCompare(String(b.key),undefined,{numeric:true}));
    if(rows.length<2){this._connectedStructurePathCache.set(stamp,[]);return [];}
    const coords=[];
    for(const g of rows){
      let lat=0,lon=0,n=0;
      for(const p of g.pts.values()){lat+=p[0]; lon+=p[1]; n++;}
      if(n)coords.push([lat/n,lon/n]);
    }
    const dist=(a,b)=>{
      try{if(SearchEngine?.distanceKm)return SearchEngine.distanceKm({lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]});}catch(e){}
      const R=6371, dLat=(b[0]-a[0])*Math.PI/180, dLon=(b[1]-a[1])*Math.PI/180;
      const la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180;
      const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
      return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
    };
    const segs=[]; let cur=[];
    for(const pt of coords){
      if(cur.length&&dist(cur[cur.length-1],pt)>45){
        if(cur.length>=2)segs.push(cur);
        cur=[];
      }
      const last=cur[cur.length-1];
      if(!last||Math.abs(last[0]-pt[0])>1e-7||Math.abs(last[1]-pt[1])>1e-7)cur.push(pt);
    }
    if(cur.length>=2)segs.push(cur);
    const out=segs.filter(s=>s.length>=2);
    this._connectedStructurePathCache.set(stamp,out);
    return out;
  },
  connectedLineSegments(line){
    // V3.1.83: connected circuits must come from exact imported line/nameplate pole/tower
    // point path index only. Do not fall back to route stubs, nearby geometry, substation
    // endpoint chords, or any inferred straight-line geometry. The user supplied every GPS
    // point; if the point path is not present, draw nothing rather than drawing a wrong line.
    const canonical=this.connectedCanonicalCircuitName?.(line)||String(line||'').trim();
    const compact=(v)=>SearchEngine?.compact?.(v)||String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const key=compact(canonical||line);
    if(!key)return [];

    const dist=(a,b)=>{
      try{if(SearchEngine?.distanceKm)return SearchEngine.distanceKm({lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]});}catch(e){}
      const R=6371, dLat=(b[0]-a[0])*Math.PI/180, dLon=(b[1]-a[1])*Math.PI/180;
      const la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180;
      const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
      return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
    };
    const cleanSeg=(seg=[])=>{
      const out=[]; let last='';
      for(const c of seg||[]){
        if(!Array.isArray(c)||!Number.isFinite(Number(c[0]))||!Number.isFinite(Number(c[1])))continue;
        const pt=[Number(c[0]),Number(c[1])];
        const k=pt[0].toFixed(7)+','+pt[1].toFixed(7);
        if(k===last)continue;
        last=k; out.push(pt);
      }
      return out.length>=2?out:[];
    };
    const lengthKm=(seg=[])=>{let n=0; for(let i=1;i<seg.length;i++){const d=dist(seg[i-1],seg[i]); if(Number.isFinite(d))n+=d;} return n;};
    const normaliseSegs=(segs=[])=>{
      const out=[];
      for(const raw of segs||[]){
        const seg=cleanSeg(raw);
        if(seg.length<2)continue;
        const len=lengthKm(seg);
        // Ignore tiny terminal stubs and two-point long chords. Those are the exact false
        // red/blue lines that were being drawn from fallback route/endpoint data.
        if(seg.length<4&&len>1.2)continue;
        if(len<0.03)continue;
        out.push(seg);
      }
      return out;
    };

    let segs=[];
    try{
      if(!SearchEngine?.circuitPathIndex?.size)SearchEngine?.buildCircuitPathIndex?.(App.assets||[],{force:true});
      segs=SearchEngine?.circuitPathSegments?.(canonical)||SearchEngine?.circuitPathSegments?.(line)||[];
    }catch(e){
      Diagnostics?.log?.('Connected pole path lookup failed',String(e?.message||e));
      segs=[];
    }
    segs=normaliseSegs(segs);
    if(segs.length){
      try{Diagnostics?.log?.('Connected geometry source',JSON.stringify({line:canonical,source:'strict-imported-pole-path',segments:segs.length,points:segs.reduce((n,s)=>n+s.length,0)}));}catch(e){}
      return segs;
    }

    // Recovery is still point-only: rebuild directly from exact pole/tower point labels already
    // loaded in App.assets. This does not use LineString routes, substation coords, or hardcoded data.
    let recovered=[];
    try{recovered=this.connectedStructurePathSegmentsForLine?.(canonical)||[];}catch(e){recovered=[];}
    recovered=normaliseSegs(recovered);
    if(recovered.length&&recovered.reduce((n,s)=>n+s.length,0)>=6){
      try{Diagnostics?.log?.('Connected geometry source',JSON.stringify({line:canonical,source:'strict-loaded-pole-recovery',segments:recovered.length,points:recovered.reduce((n,s)=>n+s.length,0)}));}catch(e){}
      return recovered;
    }

    try{Diagnostics?.log?.('Connected geometry missing',JSON.stringify({line:canonical,reason:'no imported pole/tower point path available'}));}catch(e){}
    return [];
  },
  coordsForConnectedLine(line){
    const segs=this.connectedLineSegments(line);
    return segs[0]||[];
  },
  connectedCircuitsListHtml(lines=[],drawn=0,meta={}){
    const esc=(v)=>UI?.esc?UI.esc(v):String(v||'');
    const codes=(meta?.codes||[]).filter(Boolean);
    const rows=(lines||[]).slice(0,40).map(line=>this.connectedLineButtonHtml(line)).join('');
    const more=(lines||[]).length>40?`<div class="connected-list-more">+ ${(lines.length-40).toLocaleString()} more</div>`:'';
    const codeLine=codes.length?`<div class="connected-list-code">Code: ${esc(codes.join(', '))}</div>`:'';
    const drawnLine=drawn?`<div class="connected-list-status good">${drawn.toLocaleString()} connected circuit line(s) drawn.</div>`:'';
    const status=lines?.length?`${drawnLine}<div class="connected-list-status">Tap a circuit below to load its poles/dots.</div>`:`<div class="connected-list-status bad">No circuit names matched this terminal/substation. Codes checked: ${esc(codes.join(', ')||'none')}.</div><div class="connected-list-status">This means the loaded transmission line labels do not contain those endpoint codes, or the circuit endpoint geometry is not close enough to this terminal point.</div>`;
    return `<div class="connected-line-popup connected-line-list"><b>Connected circuits</b>${codeLine}${status}${rows}${more}</div>`;
  },
  openConnectedCircuitsList(a,lines=[],drawn=0,meta={}){
    try{
      const html=this.connectedCircuitsListHtml(lines||[],drawn,meta);
      this.updateConnectedStatus?.(a||'Connected circuits',html);
      if(!this.map||!window.L)return;
      const ll=this.assetLatLng?.(a)||this.map.getCenter();
      L.popup(this.popupOptions()).setLatLng(ll).setContent(html).openOn(this.map);
    }catch(e){Diagnostics?.log?.('Connected circuits list failed',String(e?.message||e));}
  },
  connectedLineColour(i=0){
    const colours=['#d32f2f','#1976d2','#388e3c','#f57c00','#7b1fa2','#0097a7','#c2185b','#5d4037','#455a64','#afb42b','#512da8','#0288d1'];
    return colours[Math.abs(Number(i)||0)%colours.length];
  },
  async drawConnectedCircuitLines(lines=[],limit=36){
    if(!this.connectedLineLayer||!window.L)return 0;
    // Connected-circuit mode is a line-only overlay. Clear the normal searched-circuit
    // route layer first so the same circuit is not shown twice as a faint route line plus
    // a coloured connected line. Markers remain so substations/terminals still work.
    try{this.routeLayer?.clearLayers?.();}catch(e){}
    this.connectedLineLayer.clearLayers();
    let drawn=0;
    const chosen=(lines||[]).slice(0,limit);
    for(let i=0;i<chosen.length;i++){
      const line=this.connectedCanonicalCircuitName?.(chosen[i])||chosen[i];
      const colour=this.connectedLineColour(i);
      const segs=this.connectedLineSegments?.(line)||[];
      let lineDrawn=false;
      for(const seg of segs){
        if(!Array.isArray(seg)||seg.length<2)continue;
        const pl=L.polyline(seg,{weight:4.5,opacity:.92,color:colour,interactive:true,lineCap:'round',lineJoin:'round'});
        pl.options.connectedCircuitLine=String(line||'');
        pl.bindPopup(()=>this.connectedLinePopupHtml(line),this.popupOptions());
        this.connectedLineLayer.addLayer(pl);
        lineDrawn=true;
      }
      if(lineDrawn)drawn++;
      await new Promise(r=>setTimeout(r,0));
    }
    return drawn;
  },
  connectedLinePopupHtml(line){
    const safe=String(line||'');
    return `<div class="connected-line-popup compact"><b>${UI?.esc?UI.esc(safe):safe}</b></div>`;
  },
  async showConnectedCircuitsForReferenceId(id=''){
    const key=String(id||'');
    const a=(SearchEngine?.assetMap&&SearchEngine.assetMap.get(key))||(App.assets||[]).find(x=>String(x?.id||'')===key);
    return this.showConnectedCircuitsForReference(a);
  },
  async showConnectedCircuitsForReference(a,extraCodes=[],opts={}){
    if(!a){UI.toast('Substation/terminal not found.');return 0;}
    this.closeConnectedStatus?.();
    await new Promise(r=>setTimeout(r,0));
    const codes=this.connectedStrictCodesForReference(a,extraCodes);
    const lines=this.connectedCircuitsForReference(a,extraCodes);
    if(!lines.length){
      this.hideConnectedCircuitLines();
      UI.toast(codes.length?`No connected circuit names matched ${codes.join(', ')}.`:'No abbreviation/code found on this substation/terminal.');
      return 0;
    }
    const drawn=await this.drawConnectedCircuitLines(lines,36);
    this.connectedLinesVisible=drawn>0;
    this.connectedLinesKey=opts?.key||this.connectedReferenceKeyFromToken?.('',codes[0]||'')||String(codes[0]||'CONNECTED');
    this.connectedLinesReference=a;
    this.connectedLinesList=lines.slice();
    try{this.map?.dragging?.enable?.();}catch(e){}
    if(opts?.button)opts.button.textContent='Hide connected circuits';
    UI.toast(drawn?`Connected circuit shown: ${drawn.toLocaleString()} circuit(s). Tap a line for its circuit name.`:`Connected circuits found but no line geometry loaded.`);
    return drawn;
  },
  async showCircuitFromConnectedLine(encoded=''){
    const line=decodeURIComponent(String(encoded||''));
    if(!line)return;
    UI.progress?.(true,'Loading circuit…',line,20);
    try{await this.showCircuit(line);}
    catch(err){Diagnostics?.capture?.(err);UI.toast('Circuit load failed.');}
    finally{UI.progress?.(false);UI.refreshCounts?.();}
  },
  currentViewStats(){
    if(!this.map)return {total:0,visible:0,hidden:0,withGps:0,withoutGps:0,byKind:{},bySource:{},drawn:App.drawnMarkers||0};
    const b=this.map.getBounds();
    const stats={total:0,visible:0,hidden:0,withGps:0,withoutGps:0,byKind:{},bySource:{},drawn:App.drawnMarkers||0,samples:[]};
    const assets=App.assets||[];
    stats.withGps=assets.filter(a=>Number.isFinite(a?.lat)&&Number.isFinite(a?.lon)).length;
    stats.withoutGps=assets.length-stats.withGps;
    const inView=SearchEngine.assetsInBounds?SearchEngine.assetsInBounds(b):assets.filter(a=>Number.isFinite(a?.lat)&&Number.isFinite(a?.lon)&&b.contains([a.lat,a.lon]));
    for(const a of inView){
      if(!a||a.kind==='circuit')continue;
      stats.total++;
      const visible=SearchEngine.passesFilters(a);
      if(visible)stats.visible++; else stats.hidden++;
      const kind=a.kind||'structure'; stats.byKind[kind]=(stats.byKind[kind]||0)+1;
      const src=a.sourceType||'unknown'; stats.bySource[src]=(stats.bySource[src]||0)+1;
      if(stats.samples.length<8)stats.samples.push({title:PopupEngine.displayTitle(a),kind,src,line:a.line||'',file:a.sourceFile||''});
    }
    return stats;
  },

  async whatsHere(){
    // Shows only assets in the current map window that pass active filters.
    // Utilities/context layers are handled by UtilitiesEngine so lines/polygons can render.
    let assetCount=0;
    try{assetCount=await this.revealCurrentView(false,{label:"What's here",toastPrefix:"What's here"});}
    catch(err){Diagnostics?.log?.("What's here asset reveal failed",String(err?.message||err));}
    try{
      if(window.UtilitiesEngine?.hasAnyImportedUtility?.()){
        if(window.UtilitiesEngine.hasAnyUtilityEnabled?.()){
          await window.UtilitiesEngine.updateOverlay(false,{forceMapView:true,source:'whats-here'});
        }else{
          window.UtilitiesEngine.updatePanel('Background context records are imported but not shown in this lean UI.');
        }
      }
    }catch(err){Diagnostics?.log?.("What's here utility preview failed",String(err?.message||err));}
    return assetCount;
  },
  async revealCurrentView(includeHidden=false,opts={}){
    if(!this.map){UI.toast('Map not ready.');return 0;}
    if(App.safeMode && includeHidden){UI.toast('Safe Mode is on. Hidden bulk reveal blocked.');return 0;}
    const b=this.map.getBounds();
    const list=[];
    const hidden=[];
    const inView=SearchEngine.assetsInBounds?SearchEngine.assetsInBounds(b):(App.assets||[]).filter(a=>Number.isFinite(a?.lat)&&Number.isFinite(a?.lon)&&b.contains([a.lat,a.lon]));
    for(const a of inView){
      if(!a||a.kind==='circuit')continue;
      const visible=SearchEngine.passesFilters(a);
      if(visible || includeHidden)list.push(a);
      if(!visible)hidden.push(a);
    }
    if(!list.length){
      UI.toast(includeHidden?'No hidden mapped assets in this map view.':'No filtered mapped assets in this map view. Change Display filters if something is hidden.');
      Diagnostics.log('Area reveal found no assets',JSON.stringify(this.currentViewStats()));
      return 0;
    }
    const hardLimit=Number(App.settings?.areaRevealLimit||5000);
    const draw=list.slice(0,hardLimit);
    await this.drawAssets(draw,includeHidden?'current view including hidden':(opts.label||'current map view'),false);
    if(draw.length)this.fitVisible();
    const prefix=opts.toastPrefix||'Area reveal';
    const msg=`${prefix}: ${draw.length.toLocaleString()} shown${list.length>draw.length?` of ${list.length.toLocaleString()}`:''}. ${hidden.length.toLocaleString()} hidden by filters in view.`;
    UI.toast(msg);
    Diagnostics.log('Area reveal',msg+' '+JSON.stringify(this.currentViewStats()));
    return draw.length;
  },
  clearCircuit(){this.clearDisplay();},
  fitVisible(){
    const pts=[];
    this.markerLayer?.eachLayer(l=>{if(l.getLatLng)pts.push(l.getLatLng());});
    this.routeLayer?.eachLayer(l=>{if(l.getBounds){const b=l.getBounds(); if(b?.isValid?.()){pts.push(b.getNorthEast(),b.getSouthWest());}}});
    this.utilityLayer?.eachLayer(l=>{if(l.getBounds){const b=l.getBounds(); if(b?.isValid?.()){pts.push(b.getNorthEast(),b.getSouthWest());}}});
    if(pts.length)this.map.fitBounds(L.latLngBounds(pts),{padding:[28,28],maxZoom:16});
    else UI.toast('No searched map dots to fit.');
  },
  locate(){
    this.cycleGpsMode();
  },
  toggleGpsFollow(){
    this.cycleGpsMode();
  },
  cycleGpsMode(){
    const order=['free','follow','track'];
    const current=order.includes(this.gpsMode)?this.gpsMode:'free';
    this.gpsMode=order[(order.indexOf(current)+1)%order.length];
    this.gpsError=false;
    try{localStorage.setItem('fieldMapGpsMode',this.gpsMode);}catch(e){}
    this.updateGpsButton();
    this.showGpsPanel();
    this.startGpsWatch(false);
    const label=this.gpsMode==='free'?'Free scroll — GPS updates only':this.gpsMode==='follow'?'Follow — map follows your movement':'Tracking — tight follow / higher zoom';
    UI?.toast?.(`GPS mode: ${label}`);
    if(this.gpsLast&&(this.gpsMode==='follow'||this.gpsMode==='track'))this.applyGpsModeView([this.gpsLast.lat,this.gpsLast.lon]);
  },
  loadGpsProfile(){
    try{
      const saved=localStorage.getItem('fieldMapGpsProfile');
      if(['walking','driving','helicopter'].includes(saved))this.gpsProfile=saved;
      const mode=localStorage.getItem('fieldMapGpsMode');
      if(['free','follow','track'].includes(mode))this.gpsMode=mode;
    }catch(e){}
    return this.gpsProfile||'walking';
  },
  gpsProfileLabel(profile){
    const p=profile||this.gpsProfile||'walking';
    return p==='helicopter'?'Helicopter':p==='driving'?'Driving':'Walking';
  },
  setGpsProfile(profile='walking'){
    const p=['walking','driving','helicopter'].includes(profile)?profile:'walking';
    this.gpsProfile=p;
    try{localStorage.setItem('fieldMapGpsProfile',p);}catch(e){}
    if(p==='helicopter'&&this.gpsMode==='free')this.gpsMode='follow';
    if(p==='driving'&&this.gpsMode==='track')this.gpsMode='follow';
    try{localStorage.setItem('fieldMapGpsMode',this.gpsMode);}catch(e){}
    this.showGpsPanel();
    this.updateGpsButton();
    this.updateGpsProfileButtons();
    this.updateGpsPanel();
    this.startGpsWatch(false);
    UI?.toast?.(`GPS profile: ${this.gpsProfileLabel(p)}.`);
  },
  gpsModeLabel(){
    return this.gpsMode==='track'?'Tracking':this.gpsMode==='follow'?'Follow':'Free scroll';
  },
  showGpsPanel(){
    this.gpsPanelHidden=false;
    const panel=document.getElementById('gpsPatrolPanel');
    if(panel)panel.classList.remove('hidden');
    this.updateGpsProfileButtons();
    this.updateGpsPanel();
  },
  hideGpsPanel(){
    this.gpsPanelHidden=true;
    document.getElementById('gpsPatrolPanel')?.classList.add('hidden');
  },
  updateGpsProfileButtons(){
    const p=this.gpsProfile||'walking';
    document.querySelectorAll('[data-gps-profile],[data-tools-gps-profile]').forEach(btn=>{
      const v=btn.dataset.gpsProfile||btn.dataset.toolsGpsProfile||'';
      btn.classList.toggle('active',v===p);
    });
    const lab=document.getElementById('gpsProfileLabel');
    if(lab)lab.textContent=`${this.gpsProfileLabel(p)} GPS`;
  },
  updateGpsButton(){
    const btn=document.getElementById('gpsFollow');
    if(!btn)return;
    btn.classList.remove('gps-free','gps-following','gps-tracking','gps-error','gps-helicopter','gps-driving','active');
    btn.classList.add(this.gpsError?'gps-error':(this.gpsMode==='track'?'gps-tracking':this.gpsMode==='follow'?'gps-following':'gps-free'));
    if(this.gpsProfile==='helicopter')btn.classList.add('gps-helicopter');
    if(this.gpsProfile==='driving')btn.classList.add('gps-driving');
    btn.classList.toggle('active',this.gpsMode!=='free');
    btn.title=`${this.gpsProfileLabel()} GPS ${this.gpsModeLabel()} — tap to change follow mode`;
    btn.setAttribute('aria-label',btn.title);
  },
  startGpsWatch(auto=false){
    this.loadGpsProfile();
    this.updateGpsButton();
    this.updateGpsProfileButtons();
    if(!this.gpsPanelHidden)this.showGpsPanel();
    if(this.gpsWatchId!==null)return;
    if(!navigator.geolocation){this.gpsError=true; this.updateGpsButton(); if(!auto)UI.toast('GPS not available in this browser.'); return;}
    const icon=L.divIcon({className:'',html:'<div class="user-dot"></div>',iconSize:[22,22],iconAnchor:[11,11]});
    const update=pos=>{
      const lat=Number(pos.coords.latitude), lon=Number(pos.coords.longitude);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
      const ll=[lat,lon];
      const prev=this.gpsLast;
      const headingRaw=Number(pos.coords.heading);
      const derivedHeading=(Number.isFinite(headingRaw)&&headingRaw>=0)?headingRaw:this.deriveGpsHeading(prev,{lat,lon});
      this.gpsError=false;
      this.gpsLast={
        lat,lon,
        accuracy:pos.coords.accuracy,
        altitude:pos.coords.altitude,
        altitudeAccuracy:pos.coords.altitudeAccuracy,
        heading:derivedHeading,
        speed:pos.coords.speed,
        ts:Date.now()
      };
      if(!this.userMarker)this.userMarker=L.marker(ll,{icon,zIndexOffset:900}).addTo(this.map); else this.userMarker.setLatLng(ll);
      this.applyGpsModeView(ll);
      const acc=Math.round(pos.coords.accuracy||0);
      const status=document.getElementById('gpsStatus');
      if(status)status.textContent=`GPS ${acc?`${acc}m`:'—'}`;
      const arrow=document.querySelector('#gpsFollow .gps-arrow-icon');
      if(arrow&&Number.isFinite(derivedHeading))arrow.style.transform=`rotate(${Number(derivedHeading)}deg)`;
      this.updateGpsButton();
      this.updateGpsPanel(pos);
    };
    const fail=err=>{
      this.gpsError=true;
      this.updateGpsButton();
      if(!auto)UI.toast(`GPS failed: ${err.message}`);
      const status=document.getElementById('gpsStatus');
      if(status)status.textContent='GPS —';
    };
    this.gpsWatchId=navigator.geolocation.watchPosition(update,fail,{enableHighAccuracy:true,timeout:15000,maximumAge:this.gpsProfile==='helicopter'?750:1500});
  },
  applyGpsModeView(ll){
    if(!this.map||!Array.isArray(ll))return;
    if(this.gpsMode==='free')return;
    const now=Date.now();
    const heli=this.gpsProfile==='helicopter';
    const drive=this.gpsProfile==='driving';
    const throttle=heli?1100:(drive?750:400);
    if(now-(this._lastGpsViewAt||0)<throttle)return;
    this._lastGpsViewAt=now;
    if(heli){
      const z=this.gpsMode==='track'?15:Math.max(Math.min(this.map.getZoom()||14,15),14);
      this.map.setView(ll,z,{animate:true,duration:0.35});
    }else if(drive){
      const z=this.gpsMode==='track'?17:Math.max(this.map.getZoom()||16,16);
      this.map.setView(ll,z,{animate:true,duration:0.25});
    }else if(this.gpsMode==='follow'){
      const z=Math.max(this.map.getZoom()||17,17);
      this.map.setView(ll,z,{animate:true,duration:0.2});
    }else if(this.gpsMode==='track'){
      this.map.setView(ll,18,{animate:true,duration:0.18});
    }
  },
  deriveGpsHeading(prev,next){
    if(!prev||!next)return NaN;
    const dist=this.distanceM(prev,next);
    if(!Number.isFinite(dist)||dist<4)return Number(prev.heading);
    return this.bearingDeg(prev,next);
  },
  distanceM(a,b){
    const lat1=Number(a?.lat), lon1=Number(a?.lon), lat2=Number(b?.lat), lon2=Number(b?.lon);
    if(!Number.isFinite(lat1)||!Number.isFinite(lon1)||!Number.isFinite(lat2)||!Number.isFinite(lon2))return Infinity;
    const R=6371000;
    const dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
    const s1=Math.sin(dLat/2), s2=Math.sin(dLon/2);
    const h=s1*s1+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*s2*s2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  },
  bearingDeg(a,b){
    const lat1=Number(a?.lat)*Math.PI/180, lat2=Number(b?.lat)*Math.PI/180;
    const dLon=(Number(b?.lon)-Number(a?.lon))*Math.PI/180;
    if(!Number.isFinite(lat1)||!Number.isFinite(lat2)||!Number.isFinite(dLon))return NaN;
    const y=Math.sin(dLon)*Math.cos(lat2);
    const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
    return (Math.atan2(y,x)*180/Math.PI+360)%360;
  },
  angleDiffDeg(a,b){
    if(!Number.isFinite(Number(a))||!Number.isFinite(Number(b)))return 999;
    let d=Math.abs((Number(a)-Number(b)+540)%360-180);
    return d;
  },
  fmtGpsDistance(m){
    const n=Number(m);
    if(!Number.isFinite(n))return '—';
    if(n<1000)return `${Math.round(n)} m`;
    return `${(n/1000).toFixed(n<10000?1:0)} km`;
  },
  titleForGpsAsset(a){
    if(!a)return '—';
    try{return PopupEngine?.displayTitle?.(a)||SearchEngine?.referenceName?.(a)||a.label||a.line||'Asset';}
    catch(e){return a?.label||a?.line||'Asset';}
  },
  circuitForGpsAsset(a){
    if(!a)return this.currentCircuit||'';
    try{
      const refs=SearchEngine?.lineRefsForAsset?.(a,true)||[];
      const line=refs[0]?.line||a.line||this.currentCircuit||'';
      return SearchEngine?.formatCircuitName?.(line)||line||'';
    }catch(e){return a?.line||this.currentCircuit||'';}
  },
  structureNumberForGpsAsset(a){
    try{return Number(this.structureNumberForDot?.(a));}catch(e){return NaN;}
  },
  nearbyAssetsForGps(lat,lon){
    const active=(Array.isArray(this.lastFullCircuitAssets)&&this.lastFullCircuitAssets.length?this.lastFullCircuitAssets:(Array.isArray(this.lastDrawnAssets)?this.lastDrawnAssets:[]))
      .filter(a=>a&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))&&a.kind!=='circuit');
    if(active.length)return active;
    const idx=SearchEngine?.spatialIndex;
    const size=Number(SearchEngine?.spatialGridSize||0.025);
    if(idx&&idx.size&&Number.isFinite(size)&&size>0){
      const cy=Math.floor(Number(lat)/size), cx=Math.floor(Number(lon)/size);
      const seen=new Set(); const out=[];
      for(const r of [1,2,4,8]){
        for(let y=cy-r;y<=cy+r;y++)for(let x=cx-r;x<=cx+r;x++){
          const cell=idx.get(`${y}|${x}`); if(!cell)continue;
          for(const a of cell){
            if(!a||!Number.isFinite(Number(a.lat))||!Number.isFinite(Number(a.lon))||a.kind==='circuit')continue;
            const id=String(a.id||a.assetId||`${a.lat},${a.lon},${a.label||''}`);
            if(seen.has(id))continue; seen.add(id); out.push(a);
          }
        }
        if(out.length>=30)return out;
      }
      if(out.length)return out;
    }
    const all=App.assets||[];
    if(all.length>60000)return [];
    return all.filter(a=>a&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))&&a.kind!=='circuit'&&!UtilitiesEngine?.isUtility?.(a));
  },
  gpsNearestSummary(){
    const g=this.gpsLast;
    if(!g)return null;
    const now=Date.now();
    if(this.gpsNearestCache&&now-(this.gpsNearestCache.ts||0)<(this.gpsProfile==='helicopter'?900:1600))return this.gpsNearestCache;
    const origin={lat:g.lat,lon:g.lon};
    const list=this.nearbyAssetsForGps(g.lat,g.lon);
    let nearest=null, nearestM=Infinity;
    for(const a of list){
      const m=this.distanceM(origin,a);
      if(m<nearestM){nearestM=m;nearest=a;}
    }
    let next=null,nextM=Infinity;
    const circuit=this.circuitForGpsAsset(nearest)||this.currentCircuit||'';
    const active=(Array.isArray(this.lastFullCircuitAssets)&&this.lastFullCircuitAssets.length?this.lastFullCircuitAssets:(Array.isArray(this.lastDrawnAssets)?this.lastDrawnAssets:[]));
    if(nearest&&active.length>1){
      const nLine=SearchEngine?.compact?.(this.circuitForGpsAsset(nearest)||'')||'';
      const sorted=active.filter(a=>a&&Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))&&(nLine?SearchEngine?.compact?.(this.circuitForGpsAsset(a)||'')===nLine:true)).slice().sort(SearchEngine?.sortByStructure||(()=>0));
      const ni=sorted.indexOf(nearest);
      const candidates=[];
      if(ni>0)candidates.push(sorted[ni-1]);
      if(ni>=0&&ni<sorted.length-1)candidates.push(sorted[ni+1]);
      const heading=Number(g.heading);
      let bestScore=Infinity;
      for(const c of candidates){
        const m=this.distanceM(origin,c);
        const b=this.bearingDeg(origin,c);
        const diff=this.angleDiffDeg(heading,b);
        const score=(Number.isFinite(heading)?diff*7:0)+m;
        if(score<bestScore){bestScore=score;next=c;nextM=m;}
      }
    }
    if(!next&&nearest){
      const heading=Number(g.heading); let bestScore=Infinity;
      for(const a of list){
        if(a===nearest)continue;
        const m=this.distanceM(origin,a);
        if(!Number.isFinite(m)||m<2)continue;
        const b=this.bearingDeg(origin,a);
        const diff=this.angleDiffDeg(heading,b);
        const score=(Number.isFinite(heading)?diff*8:0)+m;
        if(score<bestScore){bestScore=score;next=a;nextM=m;}
      }
    }
    const summary={ts:now,nearest,nearestM,next,nextM,circuit};
    this.gpsNearestCache=summary;
    return summary;
  },
  updateGpsPanel(pos){
    const g=this.gpsLast;
    this.updateGpsProfileButtons();
    if(!g)return;
    const speedMps=Number(g.speed);
    const kmh=Number.isFinite(speedMps)&&speedMps>=0?speedMps*3.6:NaN;
    const kt=Number.isFinite(speedMps)&&speedMps>=0?speedMps*1.943844:NaN;
    const speedText=Number.isFinite(kmh)?(this.gpsProfile==='helicopter'?`${Math.round(kmh)} km/h · ${Math.round(kt)} kt`:`${Math.round(kmh)} km/h`):'—';
    const altitude=Number(g.altitude);
    const heading=Number(g.heading);
    const acc=Number(g.accuracy);
    const set=(id,val)=>{const el=document.getElementById(id); if(el)el.textContent=val;};
    set('gpsSpeedValue',speedText);
    set('gpsAltitudeValue',Number.isFinite(altitude)?`${Math.round(altitude)} m`:'—');
    set('gpsHeadingValue',Number.isFinite(heading)?`${Math.round(heading)}°`:'—');
    set('gpsAccuracyValue',Number.isFinite(acc)?`${Math.round(acc)} m`:'—');
    const status=document.getElementById('gpsStatus');
    if(status)status.textContent=`${this.gpsModeLabel()} · ${Number.isFinite(acc)?Math.round(acc)+'m':'GPS'}`;
    const sum=this.gpsNearestSummary();
    if(sum?.nearest){
      set('gpsNearestValue',`${this.titleForGpsAsset(sum.nearest)} · ${this.fmtGpsDistance(sum.nearestM)}`);
      set('gpsCircuitValue',sum.circuit||this.circuitForGpsAsset(sum.nearest)||'—');
    }else{
      set('gpsNearestValue','No mapped asset nearby');
      set('gpsCircuitValue',this.currentCircuit||'—');
    }
    if(sum?.next)set('gpsNextValue',`${this.titleForGpsAsset(sum.next)} · ${this.fmtGpsDistance(sum.nextM)}`);
    else set('gpsNextValue','—');
  },

  proximityOrigin(){return null;},
  proximityKind(){return 'other';},
  proximityLabelFor(){return 'Asset';},
  async collectDxProximityAssets(){return {items:[],skipped:false,total:0};},
  async showProximity(){UI?.toast?.('Proximity is disabled in this core-only build.');},
  formatProximityDistance(){return '—';},
  stopGpsFollow(toast=true){
    // Kept for older code paths. GPS now stays live so movement keeps updating.
    this.gpsMode='free';
    try{localStorage.setItem('fieldMapGpsMode','free');}catch(e){}
    this.updateGpsButton();
    this.updateGpsPanel();
    if(toast)UI.toast('GPS free scroll mode. Location still updates.');
  }
};

try{window.MapEngine=MapEngine; window.fmConnectedBtn=(btn,ev)=>MapEngine.handleConnectedCircuitsButton(btn,ev); window.fmMoreInfoBtn=(btn,ev)=>MapEngine.handleMoreInfoButton(btn,ev);}catch(e){}
