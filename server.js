const express=require("express"),http=require("http"),{Server}=require("socket.io"),crypto=require("crypto");
const app=express(),server=http.createServer(app),io=new Server(server),games=new Map();
app.use(express.static("public"));
const code=()=>{let c;do c=crypto.randomBytes(3).toString("hex").toUpperCase();while(games.has(c));return c};
function state(g){return {code:g.code,hostId:g.hostId,phase:g.phase,players:g.players.map((p,i)=>({id:p.id,name:p.name,submitted:!!g.submissions[p.id],index:i})),pending:g.pending&&{sourceId:g.pending.sourceId,targetId:g.pending.targetId,direction:g.pending.direction}}}
function send(g){
 io.to(g.code).emit("state",state(g));
 io.to(g.hostId).emit("host:cards",g.players.map(p=>({id:p.id,name:p.name,submitted:!!g.submissions[p.id]})));
 g.players.forEach(p=>{let a=g.active[p.id];io.to(p.id).emit("private",{hasWord:!!a,word:a?.word||"",category:a?.category||""})});
}
io.on("connection",s=>{
 s.on("create",({name})=>{name=String(name||"").trim().slice(0,24);if(!name)return s.emit("err","Enter your name.");let c=code(),g={code:c,hostId:s.id,players:[{id:s.id,name}],submissions:{},pending:null,active:{},phase:"lobby"};games.set(c,g);s.join(c);s.data.code=c;send(g)});
 s.on("join",({code,name})=>{code=String(code||"").trim().toUpperCase();name=String(name||"").trim().slice(0,24);let g=games.get(code);if(!g)return s.emit("err","Game code not found.");if(g.phase!=="lobby")return s.emit("err","The round has started.");if(!name)return s.emit("err","Enter your name.");if(g.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))return s.emit("err","That name is already in use.");g.players.push({id:s.id,name});s.join(code);s.data.code=code;send(g)});
 s.on("submit",({word,category})=>{let g=games.get(s.data.code);if(!g||g.phase!=="lobby")return;word=String(word||"").trim().slice(0,120);category=String(category||"").trim().slice(0,60);if(!word||!category)return s.emit("err","Enter both a word/phrase and category.");g.submissions[s.id]={word,category};send(g)});
 s.on("chooseMove",({sourceId,direction})=>{let g=games.get(s.data.code);if(!g||g.hostId!==s.id||g.phase!=="lobby")return;let i=g.players.findIndex(p=>p.id===sourceId);if(i<0||!g.submissions[sourceId])return s.emit("err","That player has not submitted a word.");if(!["left","right"].includes(direction))return;let t=direction==="left"?(i-1+g.players.length)%g.players.length:(i+1)%g.players.length;g.pending={sourceId,targetId:g.players[t].id,direction};send(g)});
 s.on("startGame",()=>{let g=games.get(s.data.code);if(!g||g.hostId!==s.id||g.phase!=="lobby")return;if(g.players.length<2)return s.emit("err","At least 2 players are needed.");if(g.players.some(p=>!g.submissions[p.id]))return s.emit("err","Everyone must submit first.");if(!g.pending)return s.emit("err","Choose a card and press Move left or Move right first.");let a=g.submissions[g.pending.sourceId];g.active={};g.active[g.pending.targetId]={word:a.word,category:a.category};g.phase="playing";send(g)});
 s.on("returnDashboard",()=>{let g=games.get(s.data.code);if(!g)return;delete g.active[s.id];g.phase="lobby";g.pending=null;send(g)});
 s.on("reset",()=>{let g=games.get(s.data.code);if(!g||g.hostId!==s.id)return;g.submissions={};g.pending=null;g.active={};g.phase="lobby";send(g)});
 s.on("disconnect",()=>{let g=games.get(s.data.code);if(!g)return;if(g.hostId===s.id){games.delete(g.code);return io.to(g.code).emit("closed")}g.players=g.players.filter(p=>p.id!==s.id);delete g.submissions[s.id];delete g.active[s.id];if(g.pending&&(g.pending.sourceId===s.id||g.pending.targetId===s.id))g.pending=null;if(g.players.length)send(g);else games.delete(g.code)})
});
server.listen(process.env.PORT||3000);
