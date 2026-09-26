const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const crypto=require("crypto");

const app=express();
const server=http.createServer(app);
const io=new Server(server);
const games=new Map();
app.use(express.static("public"));

function makeCode(){
  let c;
  do c=crypto.randomBytes(3).toString("hex").toUpperCase();
  while(games.has(c));
  return c;
}

function state(g){
  return {
    code:g.code,
    hostId:g.hostId,
    started:g.started,
    players:g.players.map((p,i)=>({
      id:p.id,name:p.name,submitted:Boolean(g.submissions[p.id]),index:i
    })),
    currentTurn:g.currentTurn
  };
}

function send(g){
  io.to(g.code).emit("state",state(g));

  // IMPORTANT: The host NEVER receives submitted words/categories.
  // The host only receives which players have submitted, so the host can
  // choose a player/card without learning the secret.
  io.to(g.hostId).emit("host:cards",
    g.players.map(p=>({
      id:p.id,
      name:p.name,
      submitted:Boolean(g.submissions[p.id])
    }))
  );

  // A player only receives a word when the host moves it to that player.
  g.players.forEach(p=>{
    const a=g.assignments[p.id];
    io.to(p.id).emit("private",{
      word:a?.word||"",
      category:a?.category||"",
      hasWord:Boolean(a)
    });
  });
}

io.on("connection",s=>{
  s.on("create",({name})=>{
    name=String(name||"").trim().slice(0,24);
    if(!name)return s.emit("err","Enter your name.");
    const code=makeCode();
    const g={
      code,hostId:s.id,
      players:[{id:s.id,name}],
      submissions:{},
      assignments:{},
      started:false,
      currentTurn:0
    };
    games.set(code,g);
    s.join(code);
    s.data.code=code;
    send(g);
  });

  s.on("join",({code,name})=>{
    code=String(code||"").trim().toUpperCase();
    name=String(name||"").trim().slice(0,24);
    const g=games.get(code);
    if(!g)return s.emit("err","Game code not found.");
    if(g.started)return s.emit("err","The round has already started. Ask the host to reset.");
    if(!name)return s.emit("err","Enter your name.");
    if(g.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))
      return s.emit("err","That name is already in use.");
    g.players.push({id:s.id,name});
    s.join(code);
    s.data.code=code;
    send(g);
  });

  // Every player, including the host, submits a secret word/category.
  s.on("submit",({word,category})=>{
    const g=games.get(s.data.code);
    if(!g||g.started)return;
    word=String(word||"").trim().slice(0,120);
    category=String(category||"").trim().slice(0,60);
    if(!word||!category)return s.emit("err","Enter both a word/phrase and category.");
    g.submissions[s.id]={word,category};
    send(g);
  });

  // Host can start only after everyone has submitted.
  s.on("start",()=>{
    const g=games.get(s.data.code);
    if(!g||g.hostId!==s.id)return;
    if(g.players.length<2)return s.emit("err","At least 2 players are needed.");
    const missing=g.players.filter(p=>!g.submissions[p.id]);
    if(missing.length)return s.emit("err","Waiting for: "+missing.map(p=>p.name).join(", "));
    g.started=true;
    g.currentTurn=0;
    send(g);
  });

  // Host selects a PLAYER, not a visible word.
  // The server privately moves that player's secret word to the selected neighbor.
  s.on("move",({playerId,direction})=>{
    const g=games.get(s.data.code);
    if(!g||g.hostId!==s.id||!g.started)return;
    const sourceIndex=g.players.findIndex(p=>p.id===playerId);
    if(sourceIndex<0)return;
    const submission=g.submissions[playerId];
    if(!submission)return;

    const n=g.players.length;
    const targetIndex=direction==="left"
      ?(sourceIndex-1+n)%n
      :(sourceIndex+1)%n;

    const target=g.players[targetIndex];

    // The source player's word is transferred to the neighbor.
    // No socket other than the target receives the secret.
    g.assignments[target.id]={
      word:submission.word,
      category:submission.category
    };
    g.currentTurn=targetIndex;
    send(g);
  });

  s.on("reset",()=>{
    const g=games.get(s.data.code);
    if(!g||g.hostId!==s.id)return;
    g.started=false;
    g.submissions={};
    g.assignments={};
    g.currentTurn=0;
    send(g);
  });

  s.on("disconnect",()=>{
    const code=s.data.code,g=games.get(code);
    if(!g)return;
    if(g.hostId===s.id){
      games.delete(code);
      io.to(code).emit("closed");
      return;
    }
    g.players=g.players.filter(p=>p.id!==s.id);
    delete g.submissions[s.id];
    delete g.assignments[s.id];
    if(g.players.length)send(g);else games.delete(code);
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log("Who Am I server listening on "+PORT));
