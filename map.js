"use strict";

function wrapBoxes(boxes,limit,gap,center=false) {
  const rows=[];
  let row;
  for(const box of boxes) {
    if(!row || row.width+gap+box.width>limit) {
      row={boxes:[],width:0,height:0};
      rows.push(row);
    }
    row.width+=(row.boxes.length ? gap : 0)+box.width;
    row.height=Math.max(row.height,box.height);
    row.boxes.push(box);
  }
  const width=Math.max(0,...rows.map(r=>r.width));
  let y=0;
  for(const r of rows) {
    let x=center ? (width-r.width)/2 : 0;
    for(const box of r.boxes){box.x=x;box.y=y;x+=box.width+gap;}
    y+=r.height+gap;
  }
  return {width,height:Math.max(0,y-gap)};
}

// Measure a pair as a single wrapping unit. Search and spelling may leave
// just one member visible, in which case it keeps its ordinary pill shape.
function pairedLayout(items,limit) {
  // Leave a 1 px seam within each VGA pair and 14 px between pairs.
  const byName=new Map(items.map(item=>[item.c.name,item]));
  const pairs=[];
  for(const names of vgaPairs) {
    const members=names.map(n=>byName.get(n)).filter(Boolean);
    if(!members.length) continue;
    const points=[];
    let width=0;
    for(const item of members) {
      points.push({item,x:width,y:0});
      width+=item.width+1;
    }
    pairs.push({points,width:width-1,height:Math.max(...members.map(i=>i.height))});
  }
  const dimensions=wrapBoxes(pairs,limit,14);
  return {...dimensions,points:pairs.flatMap(p=>p.points.map(q=>({
    ...q,x:p.x+q.x,y:p.y+q.y,pairSide:p.points.length===2 ? (q.x===0?"left":"right") : ""
  })))};
}

function familyLayout(items,limit,order) {
  const members=new Set(items.map(i=>i.c.name));
  const children=Map.groupBy(items,item=>{
    let parent=branchParent.get(item.c.name);
    while(parent && !members.has(parent)) parent=branchParent.get(parent);
    return parent;
  });
  // Wrap whole branches. A parent and its descendants share the same
  // horizontal offsets even when neighboring branches have to move down.
  function packBranches(branches) {
    if (order) branches.sort((a,b) => order.get(a.name)-order.get(b.name));
    const packed = wrapBoxes(branches, limit, 9, true);
    return {
      width:packed.width,
      points:branches.flatMap(b => b.points.map(p => ({item:p.item, x:b.x+p.x})))
    };
  }
  function subtree(item){
    const branches=(children.get(item.c.name)||[]).map(subtree);
    branches.sort((a,b)=>Number(b.points.length>1)-Number(a.points.length>1)||a.lightness-b.lightness);
    const packed = packBranches(branches);
    const width = Math.max(item.width,packed.width);
    const points = packed.points.map(p => ({item:p.item,x:p.x+(width-packed.width)/2}));
    points.unshift({item,x:(width-item.width)/2});
    return {name:item.c.name,width,height:item.height,points,lightness:item.c.L};
  }
  const roots=(children.get(undefined)||[]).map(subtree);
  const forest = packBranches(roots);
  // Keep the true generation even if a search hides the parent.
  const levels = Map.groupBy(forest.points, ({item}) => {
    let depth = 0;
    for (let p = branchParent.get(item.c.name); p; p = branchParent.get(p)) depth++;
    return depth;
  });
  const points = [];
  let y = 0;
  for (const [,level] of [...levels].sort(([a],[b]) => a-b)) {
    const rows = [];
    for (const p of level) {
      // Allow .01 px of rounding in the 9 px sibling gap.
      let row = rows.find(r => r.every(q =>
        p.x+p.item.width+8.99 <= q.x || q.x+q.item.width+8.99 <= p.x));
      if (!row) rows.push(row=[]);
      row.push(p);
    }
    for (const row of rows) {
      for (const p of row) points.push({...p,y});
      y += Math.max(...row.map(p => p.item.height)) + 9;
    }
    y += 15; // 9 px row gap + 15 px leaves 24 px for parent–child curves.
  }
  return {width:forest.width, height:y-24, points};
}

// Pixel offsets shared by the initial layout and subsequent branch moves.
const regionInset = 14;
const regionHeading = 37;
const regionVerticalSpace = regionHeading + 10; // Bottom padding below the last chip.
function makeRegion(title,items,width,graph=false) {
  const limit=Math.max(1,width-2*regionInset);
  let layout;
  if(graph && title!=="Individual names") layout=familyLayout(items,limit);
  else if(title===eras[0]) layout=pairedLayout(items,limit);
  else {
    const points=items.map(item=>({item,width:item.width,height:item.height}));
    layout={...wrapBoxes(points,limit,8),points};
  }
  if (graph && title !== "Individual names") {
    // About 9 px per heading character, plus room for its count and padding.
    width = Math.min(width, Math.max(layout.width+2*regionInset, title.length*9+50));
  }
  return {title,width,height:regionVerticalSpace+layout.height,points:layout.points.map(p=>({...p,x:p.x+regionInset,y:p.y+regionHeading}))};
}

function familyMap(groups, width) {
  const gutter = 22; // Space between family cards for the dashed connectors.
  const available = Math.max(1, width - 2*gutter);
  const pending = new Map(groups);
  const regions = [];
  let row = [], x = gutter, y = gutter;

  function finishRow() {
    if (!row.length) return;
    const bottom = y + Math.max(...row.map(region => region.height));
    y = bottom + gutter;
    x = gutter;
    row = [];
  }
  function place(region) {
    if (row.length && x+region.width > width-gutter) finishRow();
    Object.assign(region, {x,y});
    regions.push(region);
    row.push(region);
    x += region.width + gutter;
  }
  // Keep each linked cluster consecutive. A pair starts a fresh row if that
  // lets both families sit together; on narrow screens they stack in order.
  const clusters = [
    [["Green"],["Olive"],["Yellow","Goldenrod"],["Lime"]],
    [["Orange","Red"],["Violet"],["Blue"]]
  ];
  for (const cluster of clusters) for (const titles of cluster) {
    const pair = [];
    for (const title of titles) {
      if (!pending.has(title)) continue;
      pair.push(makeRegion(title,pending.get(title),available,true));
      pending.delete(title);
    }
    if (pair.length === 2) {
      const span = pair[0].width + gutter + pair[1].width;
      if (row.length && span <= available && x+span > width-gutter) finishRow();
    }
    pair.forEach(place);
  }
  for (const [title,items] of pending) place(makeRegion(title,items,available,true));
  finishRow();
  shortenFamilyLinks(regions);
  return {regions,height:Math.max(58,y)};
}

// Treat dashed links as springs. Move whole sibling branches between slots,
// measuring their links after wrapping, with the family cards held in place.
function shortenFamilyLinks(regions) {
  const positions = new Map();
  const cards = new Map(regions.map(r => [r.title,r]));
  function centers(region, points) {
    return new Map(points.map(({item,x,y}) => [item.c.name, {
      x:region.x+x+item.width/2, y:region.y+y+item.height/2
    }]));
  }
  for (const region of regions) {
    for (const [name,point] of centers(region,region.points)) positions.set(name,point);
  }

  // A second pass lets each family react to moves made by its neighbors.
  for (let pass=0; pass<2; pass++) for (const region of regions) {
    if (!linkedFamilies.has(region.title)) continue;
    const items = region.points.map(p => p.item);
    const members = new Set(items.map(item => item.c.name));
    const links = [];
    for (const name of members) for (const other of neighbors.get(name)) {
      const target = cards.get(familyTitle(other));
      if (!positions.has(other) || target===region) continue;
      // A nearby card has more say over the facing edge than a distant card
      // on another row. Normalize by the distance between the card centers.
      const dx = target.x+target.width/2-region.x-region.width/2;
      const dy = target.y+target.height/2-region.y-region.height/2;
      links.push([name,other,1/Math.max(1,dx*dx+dy*dy)]);
    }
    if (!links.length) continue;
    function tension(local) {
      return links.reduce((sum,[name,other,weight]) => {
        const a=local.get(name), b=positions.get(other);
        return sum + weight*((a.x-b.x)**2 + (a.y-b.y)**2);
      },0);
    }
    const visibleParent = name => {
      let parent = branchParent.get(name);
      while (parent && !members.has(parent)) parent = branchParent.get(parent);
      return parent;
    };
    const siblings = Map.groupBy([...members],visibleParent);
    const rank = new Map();
    for (const names of siblings.values()) names.forEach((name,i) => rank.set(name,i));
    let best = tension(positions);
    const branches = new Set();
    for (const [name] of links) {
      for (let branch=name; branch; branch=visibleParent(branch)) branches.add(branch);
    }
    for (const branch of branches) {
      const names = siblings.get(visibleParent(branch));
      if (names.length<2) continue;
      const others = names.filter(n => n!==branch);
      let chosen = names.slice();
      for (let i=0; i<names.length; i++) {
        if (names[i]===branch) continue;
        const trial = others.toSpliced(i,0,branch);
        trial.forEach((name,j) => rank.set(name,j));
        const layout = familyLayout(items,region.width-2*regionInset,rank);
        if (layout.height+regionVerticalSpace>region.height) continue;
        const points = layout.points.map(p => ({...p,x:p.x+regionInset,y:p.y+regionHeading}));
        const local = centers(region,points);
        const cost = tension(local);
        if (cost>=best-1e-8) continue; // Preserve sibling order on numerical ties.
        best = cost;
        chosen = trial;
        region.points = points;
        for (const [name,point] of local) positions.set(name,point);
      }
      siblings.set(visibleParent(branch),chosen);
      chosen.forEach((name,i) => rank.set(name,i));
    }
  }
}

function crossCurve(a, b, horizontal, bow) {
  const x = a.x+a.width/2, y = a.y+a.height/2;
  const u = b.x+b.width/2, v = b.y+b.height/2;
  if (horizontal) {
    const sign = Math.sign(u-x);
    const start = x+sign*a.width/2, end = u-sign*b.width/2;
    const middle = (start+end)/2;
    return [[start,y],[middle,y+bow],[middle,v+bow],[end,v]];
  }
  const sign = Math.sign(v-y);
  const start = y+sign*a.height/2, end = v-sign*b.height/2;
  const middle = (start+end)/2;
  return [[x,start],[x+bow,middle],[u+bow,middle],[u,end]];
}

// Prefer the direct curve. Try gentle arcs to either side when it runs
// through another family. Score only the final layout, never animation frames.
function chooseCrossCurve(a, b, obstacles, width) {
  const dx = b.x+b.width/2-a.x-a.width/2, dy = b.y+b.height/2-a.y-a.height/2;
  const horizontal = Math.abs(dx)>Math.abs(dy);
  const distance = Math.hypot(dx,dy);
  // Tuned in screen pixels: bow by 22% of the span, capped at 150 px.
  // Nearly aligned ends get a small 18 px arc so their link reads as a curve.
  const bend = Math.min(150, distance*.22);
  const nearStraight = Math.abs(horizontal ? dy : dx)<12;
  const bows = nearStraight ? [18,-18,bend,-bend] : [0,bend,-bend];
  const steps = Math.max(12,Math.ceil(distance/14)); // At least 12 samples, then about one per 14 px.
  let best = bows[0], bestScore = Infinity;
  for (const bow of bows) {
    const curve = crossCurve(a,b,horizontal,bow);
    const hits = new Set();
    let inside = 0, clipped = false;
    for (let i=1;i<steps;i++) {
      const t = i/steps, s = 1-t;
      const weights = [s**3,3*s*s*t,3*s*t*t,t**3];
      const x = curve.reduce((sum,p,j) => sum+p[0]*weights[j],0);
      const y = curve.reduce((sum,p,j) => sum+p[1]*weights[j],0);
      if (x<1 || x>width-1 || y<1) clipped = true;
      for (const r of obstacles) {
        if (x>r.x && x<r.x+r.width && y>r.y && y<r.y+r.height) {
          hits.add(r);
          inside++;
        }
      }
    }
    // Prefer staying on screen, then fewer crossed cards, then less distance inside them.
    const score = (clipped ? obstacles.length+1 : 0) + hits.size + inside/(steps+1);
    if (score<bestScore) { best = bow; bestScore = score; }
    if (score===0) break;
  }
  return {horizontal,bow:best};
}

// Fixed chart extent: the most chromatic swatch fits below .35, leaving a
// little headroom. Keep the axis stable when the user filters the palette.
const chartMaxChroma = .35;
function spaceLayout(items,width) {
  // Cap the square at 620 px; reserve 78 px horizontally for labels and margins.
  const size=Math.max(1,Math.min(620,width-78));
  const left=45,top=24;
  const points=[];
  const sorted=[...items].sort((a,b)=>Number(b.c.name==="White"||b.c.name==="Black")-Number(a.c.name==="White"||a.c.name==="Black")||a.c.chroma-b.c.chroma);
  for(const item of sorted){
    const exactX=left+size*item.c.chroma/chartMaxChroma,exactY=top+size*(1-item.c.L);
    const spacing=item.width+2;
    let cx=exactX,cy=exactY;
    search: for(let ring=0;ring<=Math.ceil(size/spacing);ring++){
      const steps=Math.max(1,ring*8); // More samples on larger rings keep candidate spacing roughly constant.
      for(let i=0;i<steps;i++){
        const angle=2*Math.PI*i/steps;
        const x=exactX+ring*spacing*Math.cos(angle), y=exactY+ring*spacing*Math.sin(angle);
        if(x<left-.01 || x>left+size+.01 || y<top-.01 || y>top+size+.01) continue;
        if(points.some(p=>Math.hypot(p.cx-x,p.cy-y)<spacing-.01)) continue;
        cx=x;cy=y;break search;
      }
    }
    points.push({item,cx,cy,exactX,exactY,x:cx-item.width/2,y:cy-item.height/2});
  }
  const chartWidth=size+78;
  return {regions:[{plot:{left,top,size},title:"Color space",x:(width-chartWidth)/2,y:0,width:chartWidth,height:size+74,points}],height:size+118};
}

function layoutMap(groups,width,preset){
  if(preset==="Color space" && groups.length) return spaceLayout(groups[0][1],width);
  if(preset==="Families") return familyMap(groups,width);
  const regions=[],gap=12;
  let x=0,y=0,rowHeight=0;
  const newRow=()=>{if(x)y+=rowHeight+gap;x=0;rowHeight=0;};
  function place(region){
    if(x && x+region.width>width+.01)newRow();
    regions.push({...region,x,y});
    x+=region.width+gap;rowHeight=Math.max(rowHeight,region.height);
  }
  const ordered=preset!=="Categories";
  const foodPlant=groups.filter(([name])=>[category.food,foodPlantOverlap,category.plants].includes(name));
  const connected=preset==="Categories" && foodPlant.some(([name])=>name===foodPlantOverlap);
  for(const [title,items] of groups){
    if(connected && foodPlant.some(([name])=>name===title)){
      if(title===foodPlant[0][0]){
        const across=width>=800,w=across?width/foodPlant.length:width; // Matches the side-by-side CSS container query.
        const band=foodPlant.map(([t,entries])=>makeRegion(t,entries,w,false));
        const bandHeight=Math.max(...band.map(b=>b.height));
        for(const [i,region] of band.entries()){
          if(across)region.height=bandHeight;
          region.zone=region.title===foodPlantOverlap?"shared":region.title===category.plants?"plants":"food";
          regions.push({...region,x:across?i*w:0,y});
          if(!across)y+=region.height;
        }
        y+=(across?bandHeight:0)+gap;
      }
      continue;
    }
    const full=ordered||title===category.pigments;
    if(full)newRow();
    // Estimate chip area including breathing room. A 1.9 width multiplier
    // favors landscape cards; 200 px keeps small groups readable.
    const area=items.reduce((sum,i)=>sum+(i.width+12)*(i.height+15),0);
    const ideal=Math.max(title.length*9+50,...items.map(i=>i.width+28),Math.sqrt(area)*1.9,200);
    place(makeRegion(title,items,full?width:Math.min(width,Math.ceil(ideal))));
  }
  newRow();
  return {regions,height:Math.max(58,y)};
}
function svgElement(tag,attributes) {
  const element=document.createElementNS("http://www.w3.org/2000/svg",tag);
  for(const [key,value] of Object.entries(attributes))element.setAttribute(key,value);
  return element;
}
function plotAxes(region){
  const {left,top,size}=region.plot;
  const svg=svgElement("svg",{width:region.width,height:region.height,"aria-hidden":"true"});
  function label(x,y,text,anchor="middle"){
    const element=svgElement("text",{x,y,"text-anchor":anchor});
    element.textContent=text;svg.append(element);
    return element;
  }
  svg.append(svgElement("rect",{x:left,y:top,width:size,height:size,class:"plot-paper"}));
  for(const lightness of [0,.25,.5,.75,1]){
    const y=top+size*(1-lightness);
    svg.append(svgElement("line",{x1:left,y1:y,x2:left+size,y2:y,class:"plot-grid"}));
    label(left-9,y+4,Math.round(lightness*100)+"%","end");
  }
  for(const chroma of [0,.1,.2,.3,chartMaxChroma]){
    const x=left+size*chroma/chartMaxChroma;
    svg.append(svgElement("line",{x1:x,y1:top,x2:x,y2:top+size,class:"plot-grid"}));
    label(x,top+size+19,String(chroma));
  }
  label(left,top-12,"Lightness","start");
  label(left+size/2,top+size+41,"Chroma");
  for(const p of region.points){
    if(p.cx!==p.exactX||p.cy!==p.exactY) svg.append(svgElement("line",{x1:p.exactX,y1:p.exactY,x2:p.cx,y2:p.cy,class:"plot-leader"}));
  }
  return svg;
}

class AtlasMap {
  constructor(viewport) {
    this.viewport=viewport;this.nodes=new Map();this.frame=0;
    this.motion=!matchMedia("(prefers-reduced-motion:reduce)").matches;
    try { const saved=localStorage.getItem("atlas-motion");if(saved!==null)this.motion=saved==="on"; } catch {}
    this.updateMotionButton();
    $("motion").onclick=()=>{
      this.motion=!this.motion;
      try{localStorage.setItem("atlas-motion",this.motion?"on":"off");}catch{}
      this.updateMotionButton();
    };
  }
  updateMotionButton(){
    document.documentElement.dataset.motion=this.motion?"on":"off";
    $("motion").textContent=this.motion?"Motion on":"Motion off";
    $("motion").setAttribute("aria-pressed",String(this.motion));
  }
  draw(groups,parents,animate){
    cancelAnimationFrame(this.frame);
    const oldPositions=new Map();
    for(const p of this.nodes.values())for(const name of p.names)oldPositions.set(name,{x:p.x,y:p.y});
    const graph=mode==="Families",plot=mode==="Color space";
    this.viewport.dataset.layout=plot?"space":graph?"families":mode==="Categories"?"islands":"ordered";
    const visible=new Map();
    for(const [,items] of groups)for(const item of items){
      const names=item.aliases.map(a=>a.name),key=names[0];
      let point=this.nodes.get(key);
      if(!point){
        const button=el("button",undefined,"chip");$("points").append(button);
        point={button,names};this.nodes.set(key,point);
      }
      const {button}=point;
      point.names=names;
      button.textContent=names.join(" / ");
      button.style.backgroundColor=item.c.name;button.style.color=item.c.ink;
      button.classList.toggle("bridge",graph && bridges.has(key));
      button.removeAttribute("data-pair-side");
      button.title=plot?names.join(" / "):graph && bridges.has(key)?"Links "+[...new Set([familyTitle(key),...parents.get(key).map(familyTitle)])].join(" and "):"";
      button.onclick=()=>showDetail(item.c);button.inert=false;button.removeAttribute("aria-hidden");
      visible.set(key,point);
    }
    for(const [,items] of groups)for(const item of items){
      const p=visible.get(item.aliases[0].name);
      p.width=item.width=p.button.offsetWidth;p.height=item.height=p.button.offsetHeight;
    }
    const layout=layoutMap(groups,this.viewport.clientWidth,mode);
    this.viewport.style.height=layout.height+"px";
    const regions=document.createDocumentFragment(),target=new Map(),readingOrder=[];
    for(const island of layout.regions){
      const area=el("div",undefined,island.plot?"plot-field":"island"+(island.points.length?"":" vacant"));
      if(island.zone)area.dataset.zone=island.zone;
      Object.assign(area.style,{left:island.x+"px",top:island.y+"px",width:island.width+"px",height:island.height+"px"});
      if(island.plot)area.append(plotAxes(island));
      else {
        const heading = el(mode === "Categories" ? "h3" : "strong", island.title);
        area.append(heading, el("small",String(island.points.length)));
      }
      regions.append(area);
      for(const {item,x,y,pairSide} of [...island.points].sort((a,b)=>a.y-b.y||a.x-b.x)){
        const dest={x:island.x+x,y:island.y+y};
        for(const alias of item.aliases)target.set(alias.name,dest);
        const button=visible.get(item.aliases[0].name).button;
        if(pairSide)button.dataset.pairSide=pairSide;
        readingOrder.push(button);
      }
    }
    if(!groups.length)regions.append(el("p","No matching colors.","map-empty"));
    $("regions").replaceChildren(regions);
    const readout=$("space-readout"),hint="Hover or focus a swatch to see its name.";
    readout.hidden=!plot||!visible.size;readout.textContent=hint;
    const layer=$("points"),focused=document.activeElement;
    let cursor=layer.firstElementChild;
    for(const button of readingOrder){
      if(cursor===button)cursor=cursor.nextElementSibling;
      else layer.insertBefore(button,cursor);
    }
    if(focused!==document.activeElement&&readingOrder.includes(focused))focused.focus({preventScroll:true});
    const flights=[];
    for(const [key,p] of this.nodes){
      const active=visible.has(key),dest=target.get(key);
      if(!dest){p.button.remove();this.nodes.delete(key);continue;}
      const start=Number.isFinite(p.x)?p:oldPositions.get(key)||dest;
      if(!active){p.button.inert=true;p.button.setAttribute("aria-hidden","true");}
      flights.push({p,key,active,dest,x:start.x,y:start.y,opacity:Number(p.button.style.opacity||1)});
    }
    const lines=[];$("edges").replaceChildren();
    if(graph)for(const [child,ancestors] of parents)for(const parent of ancestors){
      const a=visible.get(parent),b=visible.get(child);
      if(!a||!b)continue;
      const path=svgElement("path",{});
      let route;
      if(familyTitle(child)!==familyTitle(parent)) {
        path.classList.add("cross-family");
        const obstacles = layout.regions.filter(r => r.title!==familyTitle(parent) && r.title!==familyTitle(child));
        route = chooseCrossCurve({...target.get(parent),width:a.width,height:a.height},
          {...target.get(child),width:b.width,height:b.height}, obstacles, this.viewport.clientWidth);
      }
      $("edges").append(path);lines.push({a,b,path,route});
    }
    for(const point of visible.values()){
      const highlight=active=>{
        if(plot){
          const c=byName.get(point.names[0]);
          readout.textContent=active?point.names.join(" / ")+" · "+Math.round(c.L*100)+"% lightness · "+c.chroma.toFixed(3)+" chroma":hint;
        }
        for(const {a,b,path} of lines){
          path.classList.toggle("highlighted",active&&(a===point||b===point));
          path.classList.toggle("muted",active&&a!==point&&b!==point);
        }
      };
      point.button.onpointerenter=point.button.onfocus=()=>highlight(true);
      point.button.onpointerleave=point.button.onblur=()=>highlight(false);
    }
    const begin=performance.now();
    const tick=now=>{
      // 960 ms fits a chip flight into about a second. Cubic smoothstep
      // (3t² − 2t³) starts and ends with zero velocity.
      const t=animate&&this.motion?Math.min(1,Math.max(0,(now-begin)/960)):1,f=t*t*(3-2*t);
      for(const {p,key,active,dest,x,y,opacity} of flights){
        const dx=dest.x-x,dy=dest.y-y,length=Math.hypot(dx,dy);
        const bend=Math.sin(Math.PI*f)*Math.min(45,length*.12)/(length||1); // Bow by 12% of travel, up to 45 px.
        p.x=x+dx*f-dy*bend;p.y=y+dy*f+dx*bend;
        p.button.style.transform="translate("+p.x+"px,"+p.y+"px)";
        p.button.style.opacity=opacity+((active?1:0)-opacity)*f;
        if(!active&&t===1){p.button.remove();this.nodes.delete(key);}
      }
      for(const {a,b,path,route} of lines){
        if (route) {
          const [start,c1,c2,end] = crossCurve(a,b,route.horizontal,route.bow);
          path.setAttribute("d", "M"+start+" C"+c1+" "+c2+" "+end);
          continue;
        }
        const x=a.x+a.width/2,y=a.y+a.height,endX=b.x+b.width/2,endY=b.y,middle=(y+endY)/2;
        path.setAttribute("d","M"+x+" "+y+" C"+x+" "+middle+" "+endX+" "+middle+" "+endX+" "+endY);
      }
      if(t<1)this.frame=requestAnimationFrame(tick);
    };
    tick(begin);
  }
}
