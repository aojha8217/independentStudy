'use strict';

// Zero-dependency Node.js app. Browsers subscribe to server-sent events for live updates.
const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_MAX_AGE = 12 * 60 * 60 * 1000;
const MAX_PLAYERS = 60;
const MAX_ROOMS = 1500;
const DEFAULT_QUESTION = 'What is your most irrational fear?';
const PUBLIC = path.join(__dirname, 'public');
const ASSETS = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/index.html', ['index.html','text/html; charset=utf-8']],
  ['/styles.css', ['styles.css','text/css; charset=utf-8']],
  ['/app.js', ['app.js','text/javascript; charset=utf-8']],
  ['/icon.svg', ['icon.svg','image/svg+xml']]
]);

function clean(value, max) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}
function secret() { return crypto.randomBytes(24).toString('base64url'); }
function codeFor(rooms) {
  for (let attempt = 0; attempt < 40; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Could not generate a room code.');
}
function randomize(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function playerFor(name) { return { id:secret(), token:secret(), name, streams:new Set() }; }
function sendJson(res, status, body) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function error(res, status, message) { sendJson(res, status, { ok:false, error:message }); }
function success(res, body = {}) { sendJson(res, 200, { ok:true, ...body }); }
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 6000) { reject(new Error('Request too large.')); req.destroy(); }
    });
    req.on('end', () => {
      try { const object = JSON.parse(raw || '{}'); resolve(object && typeof object === 'object' && !Array.isArray(object) ? object : {}); }
      catch { reject(new Error('Invalid request.')); }
    });
    req.on('error', reject);
  });
}
function createServer() {
  const rooms = new Map();
  let heartbeat;
  let cleanup;

  function stateFor(room, player, hostAuthorized) {
    return {
      roomCode:room.code, round:room.round, phase:room.phase,
      question:room.question, isHost:hostAuthorized,
      me:{ id:player.id, name:player.name },
      myAnswer:room.answers.get(player.id) || '',
      players:[...room.players.values()].map(p => ({
        id:p.id,name:p.name,online:p.streams.size > 0,submitted:room.answers.has(p.id)
      })),
      submittedCount:room.answers.size,
      answerBoard:hostAuthorized && room.phase === 'reveal'
        ? room.board.map(item => ({
          id:item.id, text:item.text,
          revealedName:item.revealed ? room.players.get(item.ownerId)?.name || 'Former player' : null
        })) : null,
      revealedCount:room.board.filter(item => item.revealed).length
    };
  }
  function writeEvent(res, data, event) {
    if (res.destroyed || res.writableEnded) return;
    try {
      if (event) res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* connection just dropped */ }
  }
  function broadcast(room) {
    room.touched = Date.now();
    for (const connection of room.streams) {
      const player = room.players.get(connection.playerId);
      if (player) writeEvent(connection.res, stateFor(room, player, connection.hostAuthorized));
    }
  }
  function authenticate(body) {
    const code = clean(body.code, 8).toUpperCase();
    const room = rooms.get(code);
    if (!room) return null;
    const player = [...room.players.values()].find(p => p.token === body.playerToken);
    if (!player) return null;
    return {room, player, isHost:player.id === room.hostId && body.hostKey === room.hostKey};
  }
  function requireUser(body, res, hostOnly = false) {
    const context = authenticate(body);
    if (!context) { error(res, 401, 'Room or player session not found. Rejoin the room.'); return null; }
    if (hostOnly && !context.isHost) { error(res, 403, 'Only the host can do that.'); return null; }
    return context;
  }
  function openEvents(req, res, url) {
    const body = Object.fromEntries(url.searchParams.entries());
    const context = requireUser(body, res);
    if (!context) return;
    const {room,player,isHost} = context;
    res.writeHead(200, {
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-store, no-transform',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no',
      'X-Content-Type-Options':'nosniff'
    });
    res.write(': connected\n\n');
    const connection = {res,playerId:player.id,hostAuthorized:isHost};
    room.streams.add(connection);
    player.streams.add(connection);
    broadcast(room);
    req.on('close', () => {
      room.streams.delete(connection);
      player.streams.delete(connection);
      broadcast(room);
    });
  }

  function action(endpoint, body, res) {
    if (endpoint === 'create') {
      const name = clean(body.name, 30);
      if (!name) return error(res, 400, 'Enter your name to create a room.');
      if (rooms.size >= MAX_ROOMS) return error(res, 429, 'Too many active rooms right now.');
      const code = codeFor(rooms);
      const player = playerFor(name);
      const room = {
        code,hostKey:secret(),hostId:player.id,round:1,
        question:clean(body.question,200) || DEFAULT_QUESTION,phase:'collect',players:new Map([[player.id,player]]),
        answers:new Map(),board:[],streams:new Set(),touched:Date.now()
      };
      rooms.set(code, room);
      return success(res, {code,playerToken:player.token,hostKey:room.hostKey});
    }
    if (endpoint === 'join') {
      const code = clean(body.code, 8).toUpperCase();
      const room = rooms.get(code);
      if (!room) return error(res, 404, 'Room not found. Check the code or ask for a fresh link.');
      const hostAuthorized = !!body.hostKey && body.hostKey === room.hostKey;
      let player = [...room.players.values()].find(p => p.token === body.playerToken);
      if (hostAuthorized && !player) player = room.players.get(room.hostId);
      if (!player) {
        const name = clean(body.name, 30);
        if (!name) return error(res, 400, 'Enter your name to join.');
        if (room.players.size >= MAX_PLAYERS) return error(res, 400, 'This room is full.');
        if ([...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) {
          return error(res, 400, 'That name is already taken. Try another name.');
        }
        player = playerFor(name);
        room.players.set(player.id, player);
      }
      success(res, {code,playerToken:player.token,hostKey:hostAuthorized && player.id === room.hostId ? room.hostKey : null});
      broadcast(room);
      return;
    }
    if (endpoint === 'ping') {
      const context = requireUser(body,res);
      if (context) success(res);
      return;
    }
    const hostOnly = ['setQuestion','reveal','revealOne','newRound','kick'].includes(endpoint);
    const context = requireUser(body,res,hostOnly);
    if (!context) return;
    const {room,player} = context;
    switch (endpoint) {
      case 'submit': {
        if (room.phase !== 'collect') return error(res, 409, 'Submissions are closed for this round.');
        const answer = clean(body.answer,220);
        if (!answer) return error(res,400,'Type an answer before submitting.');
        room.answers.set(player.id,answer);
        break;
      }
      case 'setQuestion': {
        if (room.phase !== 'collect') return error(res,409,'Start a new round to change the question.');
        const question = clean(body.question,200);
        if (!question) return error(res,400,'Enter a question.');
        if (question !== room.question) {room.question = question;room.answers.clear();}
        break;
      }
      case 'reveal': {
        if (room.phase !== 'collect') return error(res,409,'Already in the reveal phase.');
        if (!room.answers.size) return error(res,400,'Wait for at least one answer.');
        room.board = randomize([...room.answers].map(([ownerId,text]) => ({id:secret(),ownerId,text,revealed:false})));
        room.phase = 'reveal';
        break;
      }
      case 'revealOne': {
        if (room.phase !== 'reveal') return error(res,409,'No answers to reveal yet.');
        const item = room.board.find(entry => entry.id === body.id);
        if (!item) return error(res,404,'Answer not found.');
        item.revealed = true;
        break;
      }
      case 'newRound': {
        const question = clean(body.question,200);
        if (!question) return error(res,400,'Enter a question for the new round.');
        room.question = question;room.round++;room.phase = 'collect';room.answers.clear();room.board = [];
        break;
      }
      case 'kick': {
        if (room.phase !== 'collect') return error(res,409,'Remove players between rounds.');
        if (body.id === room.hostId) return error(res,400,'You cannot remove the host.');
        const removed = room.players.get(body.id);
        if (!removed) return error(res,404,'Player not found.');
        for (const connection of removed.streams) {
          writeEvent(connection.res,{},'removed');
          room.streams.delete(connection);
          connection.res.end();
        }
        room.players.delete(removed.id);room.answers.delete(removed.id);
        break;
      }
      default: return error(res,404,'Unknown action.');
    }
    success(res);
    broadcast(room);
  }

  const httpServer = http.createServer(async (req,res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') return success(res, {status:'ok'});
    if (req.method === 'GET' && url.pathname === '/api/events') return openEvents(req,res,url);
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      try {
        const body = await parseBody(req);
        return action(url.pathname.slice('/api/'.length),body,res);
      } catch {return error(res,400,'Invalid request.');}
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const asset = ASSETS.get(url.pathname);
      if (asset) {
        const [filename, contentType] = asset;
        res.writeHead(200, {'Content-Type':contentType, 'X-Content-Type-Options':'nosniff'});
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(path.join(PUBLIC,filename)).pipe(res);
      }
    }
    error(res,404,'Not found.');
  });

  heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const connection of room.streams) {
        if (!connection.res.writableEnded && !connection.res.destroyed) connection.res.write(': heartbeat\n\n');
      }
    }
  }, 25000);
  heartbeat.unref();
  cleanup = setInterval(() => {
    for (const [code,room] of rooms) {
      if (Date.now()-room.touched > ROOM_MAX_AGE && room.streams.size===0) rooms.delete(code);
    }
  },60*60*1000);
  cleanup.unref();
  return {
    httpServer, rooms,
    close:()=>new Promise(resolve=>{
      clearInterval(heartbeat);clearInterval(cleanup);
      for(const room of rooms.values()) for(const connection of room.streams) connection.res.end();
      httpServer.close(resolve);
    })
  };
}
if(require.main===module){
  const {httpServer} = createServer();
  const port = Number(process.env.PORT || 3000);
  httpServer.listen(port,'0.0.0.0',()=>console.log(`Empire is running at http://localhost:${port}`));
}
module.exports = {createServer};