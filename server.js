const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const crypto=require("crypto");
const app=express(), server=http.createServer(app), io=new Server(server);
const games=new Map();
app.use(express.static("public"));
const makeCode=()=>{let c;do{c=crypto.randomBytes(3).toString("hex").toUpperCase()}while(games.has(c));return c};
function state(g){return {code:g.code,hostId:g.hostId,started:g.started,players:g.players.map(p=>({id:p.id,name:p.name})),direction:g.direction,currentTurn:g.currentTurn,category:g.category}};
function send(g){io.to(g.code).emit("state",state(g));g.players.forEach(p=>io.to(p.id).emit("private",{name:p.name,category:g.category,word:g.started?(g.assign[p.id]||""): "",host:p.id===g.hostId}))}
io.on("connection",s=>{
 s.on("create",({name})=>{name=String(name||"").trim().slice(0,24);if(!name)return s.emit("err","Enter your name.");let code=makeCode();let g={code,hostId:s.id,players:[{id:s.id,name}],started:false,category:"",word:"",direction:"right",currentTurn:0,assign:{}};games.set(code,g);s.join(code);s.data.code=code;send(g)});
 s.on("join",({code,name})=>{code=String(code||"").trim().toUpperCase();name=String(name||"").trim().slice(0,24);let g=games.get(code);if(!g)return s.emit("err","Game code not found.");if(g.started)return s.emit("err","The game has already started.");if(!name)return s.emit("err","Enter your name.");if(g.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))return s.emit("err","That name is already in use.");g.players.push({id:s.id,name});s.join(code);s.data.code=code;send(g)});
 s.on("start",({word,category,direction})=>{let g=games.get(s.data.code);if(!g||g.hostId!==s.id)return;word=String(word||"").trim().slice(0,120);category=String(category||"").trim().slice(0,60);if(!word||!category)return s.emit("err","Enter both the word/phrase and category.");if(g.players.length<2)return s.emit("err","At least 2 players are needed.");g.word=word;g.category=category;g.direction=direction==="left"?"left":"right";g.started=true;g.assign={};g.players.forEach((p,i)=>{let target=g.direction==="right"?(i+1)%g.players.length:(i-1+g.players.length)%g.players.length;g.assign[g.players[target].id]=word});g.currentTurn=0;send(g)});
 s.on("next",()=>{let g=games.get(s.data.code);if(!g||g.hostId!==s.id||!g.started)return;g.currentTurn=(g.currentTurn+1)%g.players.length;send(g)});
 s.on("reset",()=>{let g=games.get(s.data.code);if(!g||g.hostId!==s.id)return;g.started=false;g.category="";g.word="";g.assign={};g.currentTurn=0;send(g)});
 s.on("disconnect",()=>{let code=s.data.code,g=games.get(code);if(!g)return;if(g.hostId===s.id){games.delete(code);io.to(code).emit("closed");return}g.players=g.players.filter(p=>p.id!==s.id);if(g.players.length)send(g);else games.delete(code)});
});
const PORT=process.env.PORT||3000;server.listen(PORT,()=>console.log("Who Am I server listening on "+PORT));
