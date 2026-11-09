// サーバー側：切り出しの読みの足し方
const fs=require('fs'),vm=require('vm');
const ctx={console,JSON,Math,Object,Array,String,Number,RegExp,Error,Date};vm.createContext(ctx);
const src=fs.readFileSync(''+require('path').join(__dirname,'../ApaIndicator.js')+'','utf8');
vm.runInContext(src+';this.addFullCrop_=addFullCrop_;this.fullCropPrompt_=fullCropPrompt_;',ctx);
const ok=(c,m)=>console.log((c?'OK  ':'NG  ')+m);
const mk=(full,split)=>({fullClean:full.slice(),handwritten:[],split:split||[]});
let o=mk(['805','811','914','1101','905'],[{field:'フル清掃',room:'905'}]);
ctx.addFullCrop_(o,{rooms:['414','613','805','811','905','914','1101']},7);
ok(o.fullClean.length===7&&o.fullClean.includes('414')&&o.fullClean.includes('613'),'11/9：切り出しで 414・613 が足される');
ok(o.split.length===0,'数が合えば要確認なし（905 の片方だけも外れる）:'+JSON.stringify(o.split));
o=mk(['805','811'],[]);
ctx.addFullCrop_(o,{rooms:['414','805','811']},5);
ok(o.fullClean.includes('414')&&o.split.some(x=>x.room==='414'),'数が合わないとき切り出しだけの部屋は要確認');
o=mk(['805'],[]);
ctx.addFullCrop_(o,{rooms:['805'],handwritten:['1203']},1);
ok(o.fullClean.includes('1203')&&o.handwritten.includes('1203')&&o.split.some(x=>x.room==='1203'),'手書きは足して要確認・handwritten に入る');
ok(/\n/.test(ctx.fullCropPrompt_()),'プロンプトは改行区切り');
