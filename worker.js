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
  if(!res.ok)throw new Error(`Upstream HTTP ${res.status} from ${new URL(url).hostname}`);
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
      if(url.pathname==='/participation'){
        // Algorithm / Heuristic / Other をすべて開催期間内の提出だけで判定。
        // 同一ユーザーの集計結果をキャッシュして、再集計を高速化する。
        const cache=caches.default,cacheKey=new Request(url.toString(),{method:'GET'});
        const cached=await cache.match(cacheKey);
        if(cached)return cached;
        const contests=await load('https://kenkoooo.com/atcoder/resources/contests.json');
        if(!Array.isArray(contests))throw new Error('Unexpected contests format');
        const byId=new Map();
        let earliest=Infinity;
        for(const contest of contests){
          const id=String(contest.id||'').toLowerCase();
          const start=Number(contest.start_epoch_second),duration=Number(contest.duration_second);
          if(!id||!Number.isFinite(start)||start<=0||!Number.isFinite(duration)||duration<=0)continue;
          byId.set(id,{...contest,id,start,end:start+duration});
          earliest=Math.min(earliest,start);
        }
        if(!byId.size)throw new Error('No valid contest metadata');
        let from=earliest,completed=false,pages=0;
        const found=new Set(),seen=new Set();
        for(let page=0;page<20;page++){
          if(page>0)await new Promise(resolve=>setTimeout(resolve,1100));
          const data=await load(`https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(user)}&from_second=${from}`);
          if(!Array.isArray(data))throw new Error('Unexpected submissions format');
          pages++;
          for(const sub of data){
            const id=String(sub.contest_id||'').toLowerCase(),c=byId.get(id);
            const epoch=Number(sub.epoch_second);
            if(c&&Number.isFinite(epoch)&&epoch>=c.start&&epoch<c.end)found.add(id);
          }
          if(data.length<500){completed=true;break;}
          const last=Number(data[data.length-1]?.epoch_second);
          if(!Number.isFinite(last)||last<from)throw new Error('Invalid submission pagination');
          // 同じ秒の複数提出を落とさないよう境界秒も再取得する。
          const fresh=data.some(sub=>!seen.has(String(sub.id)));
          if(!fresh&&last===from)throw new Error('Submission pagination stalled');
          for(const sub of data)seen.add(String(sub.id));
          from=last;
        }
        if(!completed)throw new Error('Submission history exceeds 20-page scan limit: refusing incomplete totals');
        const matched=[...found].map(id=>{
          const {start,end,...contest}=byId.get(id);
          return contest;
        });
        const response=new Response(JSON.stringify({contests:matched,pages}),{
          headers:{...cors,'Cache-Control':'public, max-age=600'}
        });
        await cache.put(cacheKey,response.clone());
        return response;
      }
      return json({error:'Not found'},404);
    }catch(err){return json({error:'Upstream API error',detail:String(err.message||err)},502);}
  }
};