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
      if(url.pathname==='/heuristic-history'){
        // AHCだけは「コンテスト開催期間内に提出した」ことを参加の条件とする。
        // コンテスト終了後の練習提出はカウントしない。
        const contests=await load('https://kenkoooo.com/atcoder/resources/contests.json');
        if(!Array.isArray(contests))throw new Error('Unexpected contests format');
        const ahcs=new Map();
        for(const contest of contests){
          if(!/^ahc\\d+/i.test(String(contest.id||'')))continue;
          const start=Number(contest.start_epoch_second),duration=Number(contest.duration_second);
          if(Number.isFinite(start)&&start>0&&Number.isFinite(duration)&&duration>0){
            ahcs.set(String(contest.id).toLowerCase(),{start,end:start+duration});
          }
        }
        if(ahcs.size===0)throw new Error('No AHC contest metadata available');
        // AHC開始前の大量の提出は取得しない。
        let from=Math.min(...[...ahcs.values()].map(c=>c.start));
        const found=new Set(),seenSubmissions=new Set();
        let completed=false;
        for(let page=0;page<20;page++){
          // AtCoder Problemsは連続APIアクセスを1秒以上空けるよう案内している。
          if(page>0)await new Promise(resolve=>setTimeout(resolve,1100));
          const data=await load(`https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(user)}&from_second=${from}`);
          if(!Array.isArray(data))throw new Error('Unexpected submissions format');
          for(const sub of data){
            const id=String(sub.contest_id||'').toLowerCase();
            const contest=ahcs.get(id),epoch=Number(sub.epoch_second);
            if(!contest||!Number.isFinite(epoch))continue;
            if(epoch>=contest.start&&epoch<contest.end)found.add(id);
          }
          if(data.length<500){completed=true;break;}
          const last=Number(data[data.length-1]?.epoch_second);
          if(!Number.isFinite(last)||last<from)throw new Error('Invalid submission pagination');
          // 境界の同秒提出も落とさないよう、最後の秒から再取得する。
          const fresh=data.some(sub=>!seenSubmissions.has(String(sub.id)));
          if(!fresh&&last===from)throw new Error('Submission pagination stalled');
          for(const sub of data)seenSubmissions.add(String(sub.id));
          from=last;
        }
        if(!completed)throw new Error('Too many submissions to scan completely (20-page limit)');
        return json([...found].map(id=>({ContestScreenName:id})));
      }
      return json({error:'Not found'},404);
    }catch(err){return json({error:'Upstream API error',detail:String(err.message||err)},502);}
  }
};