// SUBJECT PAGE AUDIT — which subject pages are empty, and why.
// Read-only.
import { loadEnvLocal, createAdminClient } from "./_shared.ts";
async function main(){
  loadEnvLocal(); const db=await createAdminClient();
  const {data:cats}=await db.from("taxonomy_categories")
    .select("id,name,slug,parent_id,sort_order").order("sort_order");
  const byId=new Map(((cats??[]) as any[]).map(c=>[c.id,c]));
  const {data:content}=await db.from("content_items").select("id,category_id,status");
  const {data:products}=await db.from("products").select("id,category_id,is_published");

  const artByCat=new Map<string,number>(), prodByCat=new Map<string,number>();
  for(const c of (content??[]) as any[]) if(c.status==="published"&&c.category_id)
    artByCat.set(c.category_id,(artByCat.get(c.category_id)??0)+1);
  for(const p of (products??[]) as any[]) if(p.is_published&&p.category_id)
    prodByCat.set(p.category_id,(prodByCat.get(p.category_id)??0)+1);

  const withParent=((cats??[]) as any[]).filter(c=>c.parent_id).length;
  console.log(`CATEGORIES: ${(cats??[]).length} | with a parent_id set: ${withParent}\n`);
  console.log("SUBJECT".padEnd(26),"ART","PROD","PARENT".padEnd(24),"EMPTY  CAUSE");
  console.log("-".repeat(104));
  for(const c of (cats??[]) as any[]){
    const a=artByCat.get(c.id)??0, p=prodByCat.get(c.id)??0;
    const parent=c.parent_id?(byId.get(c.parent_id)?.slug??"?"):"(top level)";
    // descendants
    const kids=((cats??[]) as any[]).filter(k=>k.parent_id===c.id);
    const kidArt=kids.reduce((n,k)=>n+(artByCat.get(k.id)??0),0);
    const kidProd=kids.reduce((n,k)=>n+(prodByCat.get(k.id)??0),0);
    const empty=(a+p)===0;
    let cause="";
    if(empty && kidArt+kidProd>0) cause=`descendants hold ${kidArt} art/${kidProd} prod - not aggregated`;
    else if(empty) cause="no content assigned to this category at all";
    console.log(
      c.slug.padEnd(26), String(a).padStart(3), String(p).padStart(4), " "+parent.padEnd(23),
      (empty?"YES":"no ")+"    "+cause);
  }
  const unassigned=((content??[]) as any[]).filter(c=>c.status==="published"&&!c.category_id).length;
  console.log(`\npublished articles with NO category: ${unassigned}`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
