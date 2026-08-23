const fs=require('fs'),p=require('path');
const dir=p.join(__dirname,'_parts');
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort();
let out=[];
for(const f of files){const a=JSON.parse(fs.readFileSync(p.join(dir,f),'utf8'));out=out.concat(a);}
const seen=new Set();for(const l of out){if(seen.has(l.slug))console.error('DUP',l.slug);seen.add(l.slug);}
fs.writeFileSync(p.join(__dirname,'lenses.json'),JSON.stringify(out,null,2)+'\n');
console.log('lenses:',out.length,'files:',files.join(','));
