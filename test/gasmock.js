// GAS の代わり。今回のコードが使う範囲だけ再現する
process.env.TZ = 'Asia/Tokyo';
const pad = n => ('0' + n).slice(-2);

function colToNum(s){ let n=0; for (const ch of s) n = n*26 + (ch.charCodeAt(0)-64); return n; }
function numToCol(n){ let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; }
function parseA1(a1){
  const m = a1.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) throw new Error('A1 '+a1);
  const r1=+m[2], c1=colToNum(m[1]); const r2=m[4]?+m[4]:r1, c2=m[3]?colToNum(m[3]):c1;
  return [r1,c1,r2-r1+1,c2-c1+1];
}

let SHEET_SEQ = 1;
let STRICT = !!process.env.STRICT;
class Sheet {
  constructor(ss, name){ this.ss=ss; this.name=name; this.id=SHEET_SEQ++; this.cells={}; this.fmt={}; this.merges=[];
    this.maxRows=1000; this.maxCols=26; this.rowH={}; this.colW={}; this.hiddenRows=new Set(); this.hidden=false; }
  getName(){ return this.name; } setName(n){ this.name=n; return this; } getSheetId(){ return this.id; }
  key(r,c){ return r+','+c; }
  getRange(a,b,c,d){
    let R;
    if (typeof a === 'string') { const [r1,c1,nr,nc]=parseA1(a); R = new Range(this,r1,c1,nr,nc); }
    else R = new Range(this,a,b,c||1,d||1);
    if (STRICT && (R.c + R.nc - 1 > this.maxCols)) throw new Error('範囲外の列 '+this.name+' '+(R.c+R.nc-1)+'>'+this.maxCols);
    if (STRICT && (R.r + R.nr - 1 > this.maxRows)) throw new Error('範囲外の行 '+this.name+' '+(R.r+R.nr-1)+'>'+this.maxRows);
    return R;
  }
  getRangeList(list){ const rs = list.map(a => this.getRange(a));
    const o = { getRanges: () => rs };
    ['setNumberFormat','setFontWeight','setBackground','setFontColor','clearContent','setHorizontalAlignment'].forEach(m => { o[m] = (...a) => { rs.forEach(r => r[m] && r[m](...a)); return o; }; });
    return o; }
  getLastRow(){ let m=0; for (const k in this.cells){ const v=this.cells[k]; if (v!=='' && v!=null){ const r=+k.split(',')[0]; if (r>m) m=r; } } return m; }
  getLastColumn(){ let m=0; for (const k in this.cells){ const v=this.cells[k]; if (v!=='' && v!=null){ const c=+k.split(',')[1]; if (c>m) m=c; } } return m; }
  getMaxRows(){ return this.maxRows; } getMaxColumns(){ return this.maxCols; }
  insertRowsAfter(_, n){ this.maxRows += n; } insertColumnsAfter(_, n){ this.maxCols += n; }
  deleteColumns(c, n){ this.maxCols = c - 1; }
  deleteRows(r, n){   // r 行目から n 行消して、下の行を上へ詰める
    const cells = {}, fmt = {};
    for (const k in this.cells){ const [rr, cc] = k.split(',').map(Number);
      if (rr < r) cells[k] = this.cells[k]; else if (rr >= r + n) cells[(rr - n) + ',' + cc] = this.cells[k]; }
    for (const k in this.fmt){ const [rr, cc] = k.split(',').map(Number);
      if (rr < r) fmt[k] = this.fmt[k]; else if (rr >= r + n) fmt[(rr - n) + ',' + cc] = this.fmt[k]; }
    this.cells = cells; this.fmt = fmt; this.maxRows -= n;
  }
  setRowHeight(r,h){ this.rowH[r]=h; return this; }
  setRowHeights(r,n,h){ for(let i=0;i<n;i++) this.rowH[r+i]=h; return this; }
  setColumnWidth(c,w){ this.colW[c]=w; return this; }
  hideRows(r,n){ for(let i=0;i<n;i++) this.hiddenRows.add(r+i); }
  hideSheet(){ this.hidden=true; return this; } showSheet(){ this.hidden=false; return this; }
  clear(){ this.cells={}; this.fmt={}; this.merges=[]; return this; }
  clearFormats(){ this.fmt={}; return this; }
  getFilter(){ return null; }
  copyTo(ss){
    const s = new Sheet(ss, 'Copy of '+this.name);
    s.cells = JSON.parse(JSON.stringify(this.cells)); s.fmt = JSON.parse(JSON.stringify(this.fmt));
    s.merges = JSON.parse(JSON.stringify(this.merges)); s.rowH = {...this.rowH}; s.colW={...this.colW};
    s.hiddenRows = new Set(this.hiddenRows); s.maxRows=this.maxRows; s.maxCols=this.maxCols; s.hidden=this.hidden;
    ss.sheets.push(s); return s;
  }
  setFrozenRows(){ return this; } setHiddenGridlines(){ return this; } setConditionalFormatRules(){ return this; }
  getDataRange(){ return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn())); }
}

class Range {
  constructor(sh,r,c,nr,nc){ this.sh=sh; this.r=r; this.c=c; this.nr=nr; this.nc=nc; }
  each(fn){ for(let i=0;i<this.nr;i++) for(let j=0;j<this.nc;j++) fn(this.r+i,this.c+j,i,j); }
  f(r,c){ const k=this.sh.key(r,c); return this.sh.fmt[k] || (this.sh.fmt[k]={}); }
  getRow(){ return this.r; } getColumn(){ return this.c; } getSheet(){ return this.sh; }
  getNumRows(){ return this.nr; } getNumColumns(){ return this.nc; }
  getA1Notation(){ const a=numToCol(this.c)+this.r; return (this.nr===1&&this.nc===1)?a:a+':'+numToCol(this.c+this.nc-1)+(this.r+this.nr-1); }
  setValue(v){ this.sh.cells[this.sh.key(this.r,this.c)] = v; delete this.f(this.r,this.c).formula; return this; }
  getValue(){ const v=this.sh.cells[this.sh.key(this.r,this.c)]; return v===undefined?'':v; }
  setValues(a){ this.each((r,c,i,j)=>{ this.sh.cells[this.sh.key(r,c)] = a[i][j]; }); return this; }
  getValues(){ const out=[]; for(let i=0;i<this.nr;i++){ const row=[]; for(let j=0;j<this.nc;j++){ const v=this.sh.cells[this.sh.key(this.r+i,this.c+j)]; row.push(v===undefined?'':v);} out.push(row);} return out; }
  getDisplayValue(){ return String(this.getValue()); }
  getDisplayValues(){ return this.getValues().map(r=>r.map(v=>String(v))); }
  setFormula(fm){ this.f(this.r,this.c).formula = fm; this.sh.cells[this.sh.key(this.r,this.c)] = fm; return this; }
  clearContent(){ this.each((r,c)=>{ delete this.sh.cells[this.sh.key(r,c)]; }); return this; }
  merge(){ this.sh.merges.push([this.r,this.c,this.nr,this.nc]); return this; }
  mergeVertically(){ for(let j=0;j<this.nc;j++) this.sh.merges.push([this.r,this.c+j,this.nr,1]); return this; }
  breakApart(){ this.sh.merges = this.sh.merges.filter(m => !(m[0]>=this.r && m[0]<this.r+this.nr && m[1]>=this.c && m[1]<this.c+this.nc)); return this; }
  setBorder(top,left,bottom,right,vert,horiz,color,style){
    const st = style || 'SOLID';
    this.each((r,c,i,j)=>{
      const f=this.f(r,c);
      if (top!==null && top!==undefined && i===0) f.bt = top?st:null;
      if (bottom!==null && bottom!==undefined && i===this.nr-1) f.bb = bottom?st:null;
      if (left!==null && left!==undefined && j===0) f.bl = left?st:null;
      if (right!==null && right!==undefined && j===this.nc-1) f.br = right?st:null;
      if (horiz!==null && horiz!==undefined){ if (i>0) f.bt = horiz?st:null; if (i<this.nr-1) f.bb = horiz?st:null; }
      if (vert!==null && vert!==undefined){ if (j>0) f.bl = vert?st:null; if (j<this.nc-1) f.br = vert?st:null; }
    });
    return this;
  }
  _set(key, v){ this.each((r,c)=>{ this.f(r,c)[key]=v; }); return this; }
  _set2(key, a){ this.each((r,c,i,j)=>{ this.f(r,c)[key]=a[i][j]; }); return this; }
  setBackground(v){ return this._set('bg', v); } setBackgrounds(a){ return this._set2('bg', a); }
  setFontColor(v){ return this._set('fc', v); } setFontColors(a){ return this._set2('fc', a); }
  setFontWeight(v){ return this._set('bold', v==='bold'); }
  setFontSize(v){ return this._set('sz', v); }
  setHorizontalAlignment(v){ return this._set('ha', v); }
  setVerticalAlignment(v){ return this._set('va', v); }
  setWrap(v){ return this._set('wrap', !!v); }
  setNumberFormat(){ return this; } setFontFamily(){ return this; }
  setDataValidation(){ return this; } clearDataValidations(){ return this; }
  setNote(){ return this; } createFilter(){ return this; } activate(){ return this; }
}

class Spreadsheet {
  constructor(name){ this.name=name; this.sheets=[]; this.id='SS_'+name; }
  getId(){ return this.id; } getUrl(){ return 'https://docs.google.com/spreadsheets/d/'+this.id; }
  getSheetByName(n){ return this.sheets.find(s=>s.name===n) || null; }
  insertSheet(n){ const s=new Sheet(this,n); this.sheets.push(s); return s; }
  deleteSheet(s){ this.sheets = this.sheets.filter(x=>x!==s); }
  getSheets(){ return this.sheets.slice(); }
  setActiveSheet(){ return this; }
}

const BOOKS = {};
const props = {};
const cache = {};
const env = {
  SpreadsheetApp: {
    BorderStyle: { SOLID:'SOLID', SOLID_MEDIUM:'MEDIUM', SOLID_THICK:'THICK', DOTTED:'DOTTED', DASHED:'DASHED' },
    create: n => { const ss=new Spreadsheet(n); ss.insertSheet('シート1'); BOOKS[ss.id]=ss; return ss; },
    openById: id => BOOKS[id],
    flush: () => {},
    newDataValidation: () => { const b={ requireValueInList(){return b;}, setAllowInvalid(){return b;}, build(){return {};} }; return b; },
    newConditionalFormatRule: () => { const b={ whenNumberGreaterThan(){return b;}, setBackground(){return b;}, setRanges(){return b;}, build(){return {};} }; return b; }
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null), setProperty: (k,v) => { props[k]=String(v); },
    getProperties: () => ({...props}), deleteProperty: k => { delete props[k]; } }) },
  CacheService: { getScriptCache: () => ({
    get: k => (k in cache ? cache[k] : null), put: (k,v) => { cache[k]=v; },
    remove: k => { delete cache[k]; }, removeAll: ks => ks.forEach(k=>delete cache[k]) }) },
  LockService: { getScriptLock: () => ({ waitLock(){}, tryLock(){ return true; }, releaseLock(){} }) },
  Utilities: {
    sleep(){},
    formatDate(d, tz, fmt){
      d = new Date(d);
      return fmt.replace(/yyyy|MM|M|dd|d|HH|mm/g, t => ({ yyyy:d.getFullYear(), MM:pad(d.getMonth()+1), M:d.getMonth()+1,
        dd:pad(d.getDate()), d:d.getDate(), HH:pad(d.getHours()), mm:pad(d.getMinutes()) })[t]);
    }
  },
  UrlFetchApp: { fetch(){ throw new Error('このテスト環境ではPDFは作れません（GAS上では作られます）'); } },
  DriveApp: { getFileById: () => ({ setTrashed(){}, getParents: () => ({ hasNext: () => false }) }), getRootFolder(){ return {}; } },
  ScriptApp: { getOAuthToken: () => 'x', getProjectTriggers: () => [], newTrigger(){ const b={timeBased(){return b;},atHour(){return b;},everyDays(){return b;},inTimezone(){return b;},create(){return b;}}; return b; } },
  HtmlService: {},
  Logger: { log(){} },
  console
};
module.exports = { cache, env, BOOKS, props, cache, numToCol };
