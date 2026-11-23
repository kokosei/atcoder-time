const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Cache-Control':'public, max-age=300'}});
const valid=user=>/^[A-Za-z0-9_-]{1,40}$/.test(user);
async function load(url){
  const res=await fetch(url,{headers:{Accept:'application/json'}});
  if(!res.ok)throw new Error(`Upstream HTTP ${res.status}`);
  return res.json();
}
export default {
  async fetch(request){
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    const url=new URL(request.url);
    if(request.method!=='GET')return json({error:'Method not allowed'},405);
    const user=url.searchParams.get('user')||'';
    if(url.pathname!=='/contests'&&!valid(user))return json({error:'Invalid username'},400);
    try{
      if(url.pathname==='/contests'){
        const data=await load('https://kenkoooo.com/atcoder/resources/contests.json');
        if(!Array.isArray(data))throw new Error('Unexpected contests format');
        return json(data);
      }
      if(url.pathname==='/history'){
        const data=await load(`https://kenkoooo.com/atcoder/proxy/users/${encodeURIComponent(user)}/history/json`);
        if(!Array.isArray(data))throw new Error('Unexpected history format');
        return json(data);
      }
      if(url.pathname==='/participated'){
        // AtCoder Problems submission API: max 500 submissions per request.
        // Pagination is bounded to avoid unbounded Worker execution.
        const ids=new Set();let from=0,partial=false;
        for(let page=0;page<20;page++){
          const data=await load(`https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(user)}&from_second=${from}`);
          if(!Array.isArray(data))throw new Error('Unexpected submissions format');
          for(const entry of data)if(typeof entry.contest_id==='string')ids.add(entry.contest_id);
          if(data.length<500){partial=false;break;}
          if(page===19){partial=true;break;}
          const last=Number(data[data.length-1]?.epoch_second);
          if(!Number.isFinite(last)||last<from)throw new Error('Invalid pagination');
          // Same-second boundary may omit submissions; conservative flag.
          from=last+1;
        }
        return json({contestIds:[...ids],partial});
      }
      return json({error:'Not found'},404);
    }catch(err){return json({error:'Upstream API error',detail:String(err.message||err)},502);}
  }
};