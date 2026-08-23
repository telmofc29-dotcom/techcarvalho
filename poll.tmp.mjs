import { chromium } from "playwright";
const b=await chromium.launch();
const ctx=await b.newContext({userAgent:"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"});
const p=await ctx.newPage();
await p.goto("https://www.techcarvalho.com/admin/login",{waitUntil:"domcontentloaded"});
await p.fill('input[name=email]',process.env.E); await p.fill('input[name=password]',process.env.PW);
await Promise.all([p.waitForLoadState("networkidle"),p.click('form button[type=submit]')]);
for(let i=0;i<20;i++){
  await p.goto("https://www.techcarvalho.com/admin/media/new?cb="+Date.now(),{waitUntil:"domcontentloaded"}).catch(()=>{});
  const n=await p.evaluate(()=>document.querySelectorAll("#asset_role").length).catch(()=>0);
  if(n===1){ console.log(`DEPLOYED after ~${i*30}s`); 
    console.log(JSON.stringify(await p.evaluate(()=>({
      crashed:/Something went wrong|Minified React error/i.test(document.body.textContent||""),
      conceptOption: !!document.querySelector('#asset_role option[value="concept_render"]'),
      roleOptions: document.querySelectorAll('#asset_role option').length,
    })))); break; }
  if(i===19) console.log("still not deployed after 10 minutes");
  await new Promise(s=>setTimeout(s,30000));
}
await b.close();
