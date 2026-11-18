// Panzerchess server: zero dependencies. HTTP + Server-Sent Events. Run: node server.js  (PORT env optional)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const W=10,H=12,DX=[0,1,1,1,0,-1,-1,-1],DY=[1,1,0,-1,-1,-1,0,1];
const S={A:{r:1,spd:1,tar:2,tur:0,g:[6,5]},LT:{r:2,spd:3,tar:3,tur:3,g:[2,1]},MT:{r:3,spd:2,tar:3,tur:2,g:[3,2]},HT:{r:4,spd:2,tar:2,tur:1,g:[4,3]},TD:{r:5,spd:2,tar:1,tur:0,g:[3,2]}};
const FORT=new Set(['1,3','1,6','1,8','3,4','3,7','6,4','6,7','8,3','8,5','8,8']);
const TEETH=new Set(['4,0','6,0','4,1','6,1','3,10','5,10','3,11','5,11']);
const BASE=['4,11','5,0']; // BASE[side] = square that side must reach (side 0 = bottom)
const games=new Map();
const at=(g,x,y)=>g.units.find(u=>u.x===x&&u.y===y);
const rnd=n=>crypto.randomBytes(n).toString('hex');
const cleanName=s=>String(s==null?'':s).replace(/[^\p{L}\p{N} _.\-]/gu,'').trim().slice(0,16)||'Player';
function newGame(timer,seat,name,priv){
  const mk=(s,l)=>l.map(([t,x,y],i)=>({id:s+t+i,s,t,x,y,h:s?4:0,o:0}));
  return{id:rnd(3).toUpperCase(),timer,status:'waiting',turn:0,cur:null,winner:null,log:[],clients:[],seats:[null,null],made:seat,names:Object.assign(['',''],{[seat]:name}),priv:!!priv,born:Date.now(),t:Date.now(),
   units:[...mk(0,[['LT',0,0],['TD',2,0],['MT',3,0],['A',5,0],['HT',7,0],['LT',9,0]]),...mk(1,[['LT',0,11],['HT',2,11],['A',4,11],['MT',6,11],['TD',7,11],['LT',9,11]])]};
}
function kills(a,t,rel){ // rel: 0 direct front,1/7 front,2/6 side,3/5 rear,4 direct rear
  if(a.t==='A')return rel!==0;
  const fort=FORT.has(t.x+','+t.y),d=S[a.t].r-(S[t.t].r+(fort?2:0));
  if(a.t==='TD'&&t.t==='TD'&&!fort)return rel!==1&&rel!==7;
  return d>0||(d===0&&rel>=2&&rel<=6)||(d===-1&&rel>=3&&rel<=5)||rel===4;
}
function canMove(g,s){return g.units.some(u=>u.s===s&&[...Array(2*S[u.t].tar+1)].some((_,i)=>{const d=(u.h+i-S[u.t].tar+8)%8;
  return[d,(d+4)%8].some(e=>{const x=u.x+DX[e],y=u.y+DY[e];return x>=0&&y>=0&&x<W&&y<H&&!at(g,x,y)})}))}
function win(g,s,why){g.status='over';g.winner=s;g.why=why;g.log.push((s?'Blue':'Orange')+' wins: '+why);clearTimeout(g.to)}
function ev(g,k,u){g.ev={n:(g.ev?g.ev.n:0)+1,k,u}}
function nextTurn(g){
  g.turn^=1;g.cur=null;g.undoUsed=0;
  if(!canMove(g,g.turn))return win(g,g.turn^1,'opponent cannot move');
  arm(g);
}
function arm(g){clearTimeout(g.to);g.deadline=Date.now()+g.timer*1000;
  g.to=setTimeout(()=>{if(g.status!=='play')return;win(g,g.turn^1,(g.turn?'Blue':'Orange')+' ran out of time');send(g)},g.timer*1000)}
function act(g,s,{op,uid,tid}){
  if(g.status!=='play'||g.turn!==s)return'Not your turn';
  if(op==='undo'){if(!g.cur||!g.cur.n)return'Nothing to undo';if(g.undoUsed)return'Undo already used this turn';
    g.units=JSON.parse(g.snap);g.cur=null;g.undoUsed=1;g.log.push('Undo');ev(g,'undo');g.t=Date.now();return}
  const u=g.units.find(u=>u.id===uid&&u.s===s);if(!u)return'Pick one of your tanks';
  let c=g.cur;if(!c){c=g.cur={id:uid,sp:0,ta:0,tu:0,m:null,fired:0,mv:0,ex:0,n:0,from:FORT.has(u.x+','+u.y)?u.x+','+u.y:null};g.snap=JSON.stringify(g.units)}
  if(c.id!==uid)return'You already started with another tank';
  const T=S[u.t];
  if(op==='f'||op==='b'){
    const d=op==='f'?u.h:(u.h+4)%8,x=u.x+DX[d],y=u.y+DY[d],k=x+','+y;
    if(c.m&&c.m!==op)return'Cannot go forward and reverse in one turn';
    if(c.ex||c.sp>=(op==='f'?T.spd:1))return'No movement left';
    if(x<0||y<0||x>=W||y>=H||at(g,x,y))return'Blocked';
    if(k===c.from)return'Cannot re-enter the fortification you just left';
    u.x=x;u.y=y;c.m=op;c.sp++;c.mv=1;if(op==='b'||FORT.has(k)||TEETH.has(k))c.ex=1;
    ev(g,'move');if(k===BASE[s])win(g,s,'base captured');
  }else if(op==='l'||op==='r'){
    if(c.ta>=T.tar)return'No hull rotation left';c.ta++;u.h=(u.h+(op==='r'?1:7))%8;ev(g,'move');
  }else if(op==='tl'||op==='tr'){
    if(c.tu>=T.tur)return'No turret rotation left';c.tu++;u.o=(u.o+(op==='tr'?1:7))%8;ev(g,'turret');
  }else if(op==='fire'){
    if(c.fired)return'Already fired this turn';
    const dir=(u.h+u.o)%8,rng=T.g[dir%2],cand=[];
    for(let i=1;i<=rng;i++){const x=u.x+DX[dir]*i,y=u.y+DY[dir]*i;if(x<0||y<0||x>=W||y>=H)break;
      const v=at(g,x,y);
      if(u.t==='A'){if(v&&v.s!==s)cand.push(v);continue}
      if(v){if(v.s!==s)cand.push(v);break}
      if(FORT.has(x+','+y))break;}
    const t=tid?cand.find(v=>v.id===tid):cand[0];if(!t)return'No target in your line of fire';
    c.fired=1;const rel=((dir+4)%8-t.h+8)%8;
    if(kills(u,t,rel)){ev(g,'kill',u.id);g.units=g.units.filter(v=>v!==t);g.log.push(`${u.t} destroyed ${t.t}`);
      if(!g.units.some(v=>v.s!==s))win(g,s,'all enemy tanks destroyed')}
    else{ev(g,'miss',u.id);g.log.push(`${u.t} hit ${t.t} but did no damage`)}
  }else if(op==='end'){
    if(!c.mv)return'You must move this tank before ending the turn';ev(g,'end');nextTurn(g);
  }else return'Unknown action';
  c.n++;g.t=Date.now();
}
function view(g,seat){return{id:g.id,you:seat,names:g.names,priv:g.priv,timer:g.timer,status:g.status,turn:g.turn,cur:g.cur,winner:g.winner,why:g.why,units:g.units,
  log:g.log.slice(-6),ev:g.ev,undo:!!(g.cur&&g.cur.n&&!g.undoUsed),deadline:g.deadline,now:Date.now(),online:[0,1].map(i=>g.clients.some(c=>c.seat===i))}}
function send(g){for(const c of g.clients)c.res.write('data: '+JSON.stringify(view(g,c.seat))+'\n\n')}
const MIME={'.html':'text/html','.stl':'model/stl','.js':'text/javascript','.css':'text/css'};
function handle(req,res){
  const url=new URL(req.url,'http://x'),q=url.searchParams;
  const json=(o,code=200)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(o))};
  if(url.pathname==='/api/lobby'){ // open games: waiting, public, creator still connected (or created in the last 15 s)
    const now=Date.now();
    return json({games:[...games.values()].filter(g=>g.status==='waiting'&&!g.priv&&(g.clients.some(c=>c.seat===g.made)||now-g.born<15000))
      .sort((a,b)=>b.born-a.born).slice(0,50).map(g=>({id:g.id,name:g.names[g.made],side:g.made?'second':'first',timer:g.timer}))});
  }
  if(url.pathname==='/api/events'){
    const tk=q.get('token'),g=games.get(String(q.get('id')||'').toUpperCase()),seat=g&&tk?g.seats.indexOf(tk):-1;
    if(!g||seat<0)return json({error:'Unknown game or seat'},404);
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
    const c={seat,res};g.clients.push(c);send(g);
    const ka=setInterval(()=>res.write(': ka\n\n'),20000);
    req.on('close',()=>{clearInterval(ka);g.clients=g.clients.filter(x=>x!==c);send(g)});return;
  }
  if(req.method==='POST'&&url.pathname.startsWith('/api/')){
    let b='';req.on('data',d=>{b+=d;if(b.length>5e3)req.destroy()});
    req.on('end',()=>{let p;try{p=JSON.parse(b||'{}')}catch{return json({error:'Bad request'},400)}
      if(!p||typeof p!=='object'||Array.isArray(p))return json({error:'Bad request'},400);
      if(url.pathname==='/api/create'){
        const timer=Math.min(120,Math.max(30,Math.round((+p.timer||60)/30)*30)),seat=p.side==='second'?1:0,g=newGame(timer,seat,cleanName(p.name),p.priv);
        g.seats[seat]=rnd(8);games.set(g.id,g);return json({id:g.id,token:g.seats[seat],seat});}
      const g=games.get(String(p.id||'').toUpperCase());if(!g)return json({error:'Game not found'},404);
      if(url.pathname==='/api/join'){
        const seat=g.seats.indexOf(null);if(seat<0)return json({error:'Game is full'},409);
        g.seats[seat]=rnd(8);g.names[seat]=cleanName(p.name);g.status='play';g.log.push('Game started');arm(g);send(g);return json({id:g.id,token:g.seats[seat],seat});}
      if(url.pathname==='/api/act'){
        const seat=typeof p.token==='string'&&p.token?g.seats.indexOf(p.token):-1;if(seat<0)return json({error:'Bad token'},403);
        const e=act(g,seat,p);if(e&&g.cur&&!g.cur.n)g.cur=null;send(g);return json(e?{error:e}:{ok:1});}
      json({error:'Not found'},404)});return;
  }
  let rel;try{rel=decodeURIComponent(url.pathname)}catch{return json({error:'Bad request'},400)}
  const pub=path.join(__dirname,'public'),f=path.join(pub,url.pathname==='/'?'index.html':rel);
  if(!f.startsWith(pub+path.sep))return json({error:'Forbidden'},403);
  fs.readFile(f,(e,d)=>{if(e)return json({error:'Not found'},404);res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});res.end(d)});
}
http.createServer((req,res)=>{try{handle(req,res)}catch(e){console.error(e);try{if(res.headersSent)res.end();else{res.writeHead(400,{'Content-Type':'application/json'});res.end('{"error":"Bad request"}')}}catch{}}})
  .listen(process.env.PORT||3000,()=>console.log('Panzerchess on port '+(process.env.PORT||3000)));
process.on('uncaughtException',e=>console.error('uncaught:',e)); // last-resort net: one bad request must never kill every running game
setInterval(()=>{const now=Date.now();for(const[id,g]of games){const w=g.status==='waiting';if(w&&g.clients.some(c=>c.seat===g.made))g.t=now;
  if(now-g.t>(w?10*6e4:6*36e5)){clearTimeout(g.to);games.delete(id)}}},6e4);
