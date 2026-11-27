"use strict";

const $ = id => document.getElementById(id);
const capture = (event, properties) => window.posthog?.capture(event, properties);
const logAtlas = (message, attributes) => window.posthog?.logger?.info(message, attributes);
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
// Inverse sRGB transfer function, applied after normalizing each 8-bit channel.
// https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html#dfn-relative-luminance
const linear = v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4;
function describe([name, hex, membership]) {
  const [r,g,b] = hex.slice(1).match(/../g).map(v => linear(parseInt(v,16)/255));
  // Björn Ottosson's linear-sRGB → OKLab transform. The first matrix gives
  // LMS cone responses; the second acts on their cube roots to give L, a, b.
  // https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab
  const l = Math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b);
  const m = Math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b);
  const s = Math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
  const L = .2104542553*l + .793617785*m - .0040720468*s;
  const a = 1.9779984951*l - 2.428592205*m + .4505937099*s;
  const axisB = .0259040371*l + .7827717662*m - .808675766*s;
  // WCAG relative luminance and contrast ratio (lighter + .05)/(darker + .05).
  // White's luminance is 1 and black's is 0.
  const y = .2126*r + .7152*g + .0722*b;
  const ink = 1.05/(y+.05) > (y+.05)/.05 ? "white" : "black";
  return {name,hex,categories:[membership].flat(),L,a,b:axisB,chroma:Math.hypot(a,axisB),
    hue:(Math.atan2(axisB,a)*180/Math.PI+360)%360,ink};
}
const colors = colorRecords.map(describe);
const byName = new Map(colors.map(c => [c.name,c]));
const byHex = Map.groupBy(colors,c => c.hex);
const alphabet = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const modes = ["Alphabetical","Name length","Categories","Families","History","Hue","Lightness","Chroma","Color space","Nearest neighbors"];
const visual = new Set(["Hue","Lightness","Chroma","Color space","Nearest neighbors"]);
const vgaPairs = [["Black","Gray"],["Silver","White"],["Maroon","Red"],["Olive","Yellow"],
  ["Green","Lime"],["Teal","Aqua"],["Navy","Blue"],["Purple","Fuchsia"]];
const originalNames = new Set(vgaPairs.flat());
const eras = ["Original HTML / VGA","SVG expansion (X11-derived)","CSS Color 4"];
const hueReferences = ["Red","Orange","Yellow","Lime","Green","SeaGreen","Cyan","SkyBlue","Blue","Violet","Magenta","DeepPink"].map(name => byName.get(name));
const mergedHues = {SeaGreen:"Green",DeepPink:"Magenta",SkyBlue:"Blue"};
// Atlas cutoffs on OKLab L and OKLCH C. The lightness breaks were chosen to
// balance this palette; the chroma breaks separate muted and vivid swatches.
const lightThresholds = [.56,.76,.92];
const chromaThresholds = [.03,.07,.13,.20];
function hueGroup(c) {
  if (c.chroma < chromaThresholds[0]) return {title:"Near-neutral",order:hueReferences.length,value:c.L};
  // Wrap angular differences to [-180, 180) so hues near 0° and 360° touch.
  const angleDistance = ref => Math.abs((c.hue-ref.hue+540)%360-180);
  const nearest = Math.min(...hueReferences.map(angleDistance));
  // Allow roundoff for references with equal hue (Green and Lime).
  const matches = hueReferences.filter(ref => angleDistance(ref)<=nearest+.00001);
  matches.sort((a,b) => Math.abs(c.L-a.L)-Math.abs(c.L-b.L));
  const name = matches[0].name;
  const title = c.name.endsWith("SlateBlue") ? "Violet" : mergedHues[name] || name;
  const ref = byName.get(title);
  return {title,order:hueReferences.indexOf(ref),value:(c.hue-ref.hue+540)%360-180};
}
const lightBands = ["Dark","Midtone","Light","Very light"];
const chromaBands = ["Neutral","Muted","Soft","Colorful","Vivid"];
const collate = (a,b) => a.localeCompare(b,"en");
let mode = modes[0], anchor = byName.get("Coral"), selected;
let spelling = "Gray";
try { spelling = localStorage.getItem("atlas-spelling") || spelling; } catch {}
if (!["Gray","Grey","Both"].includes(spelling)) spelling = "Gray";
const spellingAllows = c => spelling === "Both" || !c.name.includes(spelling === "Gray" ? "Grey" : "Gray");
function directParents(name) {
  const words = name.match(/[A-Z][a-z]*/g), candidates = [];
  for (let start=0;start<words.length;start++) for (let end=start+1;end<=words.length;end++) {
    const part=words.slice(start,end).join("");
    if(part!==name && byName.has(part)) candidates.push({part,start,end});
  }
  return candidates.filter(c=>!candidates.some(other=>other!==c && other.start<=c.start && other.end>=c.end)).map(c=>c.part);
}
const parents = new Map(colors.map(c=>[c.name,directParents(c.name)]));
const neighbors = new Map(colors.map(c=>[c.name,new Set(parents.get(c.name))]));
for(const [child,names] of parents) for(const name of names) neighbors.get(name).add(child);
const branchParent = new Map(colors.map(({name})=>{
  const direct=parents.get(name);
  return [name,direct.find(p=>name.endsWith(p)) || direct[0]];
}));
function familyTitle(name) {
  if(!neighbors.get(name).size) return "Individual names";
  while(branchParent.get(name)) name=branchParent.get(name);
  return name;
}
const linkedFamilies = new Map(), bridges = new Set();
for(const [child,ancestors] of parents) {
  const family=familyTitle(child);
  for(const parent of ancestors) {
    const other=familyTitle(parent);
    if(family===other) continue;
    bridges.add(child);
    for(const [from,to] of [[family,other],[other,family]]) {
      if(!linkedFamilies.has(from)) linkedFamilies.set(from,new Set());
      linkedFamilies.get(from).add(to);
    }
  }
}
const distance=c=>Math.hypot(c.L-anchor.L,c.a-anchor.a,c.b-anchor.b);
function grouped(items){
  const groups=new Map(),seen=new Set(),appearance=visual.has(mode);
  if(mode==="Alphabetical") alphabet.forEach(letter=>groups.set(letter,[]));
  for(const c of items){
    if(appearance && seen.has(c.hex)) continue;
    seen.add(c.hex);
    const aliases=appearance ? byHex.get(c.hex).filter(spellingAllows) : [c];
    let title,order=0,value=0;
    switch(mode){
      case "Alphabetical": title=c.name[0]; break;
      case "Name length": order=c.name.length; title=String(order); break;
      case "History":
        order=originalNames.has(c.name)?0:c.name==="RebeccaPurple"?2:1;
        title=eras[order]; break;
      case "Color space": title="OKLab"; break;
      case "Categories":
        title=c.categories.join(categorySeparator);
        // The three adjoining food/plant regions come first, pigments last.
        order=[category.food,foodPlantOverlap,category.plants].indexOf(title);
        if(order<0) order=title===category.pigments?4:3;
        break;
      case "Families":
        title=familyTitle(c.name);
        order=title==="Individual names"?1:-(linkedFamilies.get(title)?.size || 0);
        break;
      case "Hue": ({title,order,value}=hueGroup(c)); break;
      case "Lightness":
        order=lightThresholds.filter(t=>c.L>=t).length; title=lightBands[order]; value=c.L; break;
      case "Chroma": {
        const band = chromaThresholds.filter(t => c.chroma >= t).length;
        title = chromaBands[band];
        order = chromaBands.length - 1 - band;
        value = c.chroma;
        break;
      }
      case "Nearest neighbors":
        // Euclidean OKLab distance (ΔEOK). The .10 and .23 cutoffs are
        // browsing bands chosen for this palette, not perceptibility thresholds.
        value=distance(c); order=value===0?0:value<.1?1:value<.23?2:3;
        title=["Reference","Closest","Similar","Further away"][order]; break;
    }
    if(!groups.has(title)) groups.set(title,[]);
    groups.get(title).push({c,aliases,order,value});
  }
  return [...groups].sort(([a,x],[b,y])=>(x[0]?.order||0)-(y[0]?.order||0)||collate(a,b));
}
function detailLink(label, action) {
  const button = el("button", label, "detail-link");
  button.onclick = action;
  return button;
}
function visitCategories() {
  $("detail").close();
  mode = "Categories";
  $("search").value = "";
  capture("atlas_view_selected", {view: mode, source: "color_detail"});
  render(true);
}
function showDetail(c, source="atlas"){
  selected=c;
  capture("color_detail_opened", {color_name: c.name, source});
  logAtlas("color detail opened", {event: "color_detail_opened", color_name: c.name, source});
  $("sample").style.backgroundColor=c.name;
  $("detail-name").textContent=c.name;
  const meta = $("meta");
  meta.replaceChildren(c.hex.toUpperCase());
  for (const category of c.categories) {
    meta.append(" · ", mode === "Categories" ? category : detailLink(category, visitCategories));
  }
  for (const twin of byHex.get(c.hex).filter(t => t !== c && spellingAllows(t))) {
    meta.append(" · Also ", detailLink(twin.name, () => showDetail(twin, "alias")));
  }
  const related=[...neighbors.get(c.name)].filter(n=>spellingAllows(byName.get(n)));
  const connections = $("connections");
  connections.replaceChildren();
  related.forEach((name, index) => {
    connections.append(index ? ", " : "Related to ", detailLink(name, () => showDetail(byName.get(name), "related_color")));
  });
  $("notice").textContent="";
  if ($("detail").open) $("detail-name").focus();
  else $("detail").showModal();
}
const atlas=new AtlasMap($("world"));
function render(animate=false){
  const query=$("search").value.trim().toLowerCase().replace(/grey/g,"gray");
  const items=colors.filter(c=>spellingAllows(c)&&(c.name.toLowerCase().replace(/grey/g,"gray").includes(query)||c.hex.includes(query)));
  const groups=grouped(items);
  $("view-title").textContent=mode;
  if(mode==="Nearest neighbors"){
    const select=el("select",undefined,"anchor-select");
    select.setAttribute("aria-label","Reference color");
    for(const c of colors.filter(spellingAllows)) select.add(new Option(c.name,c.name,false,c===anchor));
    select.onchange=()=>{anchor=byName.get(select.value);render(true);$("view-title").querySelector("select").focus();};
    $("view-title").append(select);
  }
  for(const [id,preset] of [["hue-note","Hue"],["space-note","Color space"],["history-note","History"],["families-note","Families"]]) $(id).hidden=mode!==preset;
  for(const [,entries] of groups) entries.sort((x,y)=>x.value-y.value || collate(x.c.name,y.c.name));
  atlas.draw(groups,parents,animate);
  const count=groups.reduce((n,[,items])=>n+items.length,0);
  $("count").textContent=count+" "+(visual.has(mode)?"color":"name")+(count===1?"":"s");
  for(const b of $("presets").children) b.setAttribute("aria-pressed",String(b.textContent===mode));
}
for(const label of modes){
  const button=el("button",label);
  button.onclick=()=>{if(label!==mode){mode=label;capture("atlas_view_selected", {view: mode, source: "preset"});render(true);}};
  $("presets").append(button);
}
$("search").oninput=()=>render();
document.querySelectorAll("[data-color]").forEach(n=>n.onclick=()=>showDetail(byName.get(n.dataset.color), "featured_color"));
$("close").onclick=()=>$("detail").close();
$("detail").onclick=e=>{
  if(e.target!==$("detail")) return;
  const r=$("detail").getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) $("detail").close();
};
$("near").onclick=()=>{
  anchor=selected; mode="Nearest neighbors"; $("search").value="";
  capture("similar_colors_viewed", {color_name: selected.name});
  $("detail").close();render(true);$("view-title").scrollIntoView({block:"start"});
  $("view-title").querySelector("select").focus({preventScroll:true});
};
$("copy").onclick=async()=>{
  try{await navigator.clipboard.writeText(selected.hex);capture("hex_copied", {color_name: selected.name});logAtlas("hex copied", {event: "hex_copied", color_name: selected.name});$("notice").textContent="Hex copied";}
  catch{$("notice").textContent="Select and copy "+selected.hex;}
};
const scheme=matchMedia("(prefers-color-scheme:dark)");
let preference;
try{preference=localStorage.getItem("atlas-theme");}catch{}
function applyTheme(){
  const dark=preference?preference==="dark":scheme.matches;
  document.documentElement.dataset.theme=dark?"dark":"light";
  $("theme").setAttribute("aria-label","Switch to "+(dark?"light":"dark")+" theme");
  $("theme").querySelector("span").textContent=dark?"Dark":"Light";
}
$("theme").onclick=()=>{
  preference=document.documentElement.dataset.theme==="dark"?"light":"dark";
  try{localStorage.setItem("atlas-theme",preference);}catch{}
  capture("theme_preference_changed", {theme: preference});
  applyTheme();
};
scheme.addEventListener("change",applyTheme);applyTheme();
$("spelling").value=spelling;
$("spelling").onchange=()=>{
  spelling=$("spelling").value;
  if(!spellingAllows(anchor)) anchor=byHex.get(anchor.hex).find(spellingAllows);
  try{localStorage.setItem("atlas-spelling",spelling);}catch{}
  capture("spelling_preference_changed", {spelling});
  render(true);
};
$("explorer").hidden=false;
let mapWidth=$("world").clientWidth;
new ResizeObserver(()=>{
  const width=$("world").clientWidth;
  if(width!==mapWidth){mapWidth=width;render();}
}).observe($("world"));
render();
document.documentElement.setAttribute("data-atlas-ready", "");
