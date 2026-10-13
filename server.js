'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';
const INDEX = path.join(__dirname, 'index.html');
const rooms = new Map();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') { res.writeHead(200, {'content-type':'text/plain; charset=utf-8'}); return res.end('ok'); }
  if (url.pathname !== '/' && url.pathname !== '/index.html') { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(INDEX, (err, data) => {
    if (err) { res.writeHead(500); return res.end('No se pudo cargar index.html'); }
    res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'}); res.end(data);
  });
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });
const send = (ws, obj) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };
const roomKey = s => String(s || '').trim().toLocaleLowerCase('es');
function roomPlayers(room) { return [...room.players].filter(p => p.readyState === WebSocket.OPEN); }
function broadcastRoom(room, obj, except = null) { for (const p of roomPlayers(room)) if (p !== except) send(p, obj); }
function updateLobby(room) {
  const players = roomPlayers(room);
  for (const p of players) send(p, { type:'room-status', room:room.name, mode:room.mode, seed:room.seed, playerCount:players.length, maxPlayers:room.maxPlayers, role:p._role });
}
function startRoom(room) {
  if (room.started) return;
  const players = roomPlayers(room);
  if (players.length < room.maxPlayers) return;
  room.started = true;
  for (const p of players) {
    const others = players.filter(q => q !== p);
    send(p, { type:'ready', room:room.name, mode:room.mode, seed:room.seed, maxPlayers:room.maxPlayers, playerCount:players.length, role:p._role, peerName:others.map(q=>q._name).join(', ') || 'Rival' });
  }
}
function removePlayer(ws) {
  const key = ws._roomKey;
  if (!key) return;
  const room = rooms.get(key);
  ws._roomKey = null;
  if (!room) return;
  room.players.delete(ws);
  if (room.players.size === 0) { rooms.delete(key); return; }
  room.started = false;
  room.rematch.clear(); room.raceReady.clear();
  broadcastRoom(room, { type:'peer-left' });
  updateLobby(room);
}
function fail(ws, message) { send(ws, {type:'error', message}); }
wss.on('connection', ws => {
  ws._roomKey = null; ws._name = 'Jugador'; ws._role = 'guest';
  ws.on('message', raw => {
    let d; try { d = JSON.parse(raw.toString()); } catch { return fail(ws, 'Mensaje inválido.'); }
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'create') {
      if (ws._roomKey) removePlayer(ws);
      const name = String(d.room || '').trim().slice(0, 40);
      const password = String(d.password || '').slice(0, 128);
      if (!name || !password) return fail(ws, 'Escribe un nombre de sala y una contraseña.');
      const key = roomKey(name);
      if (rooms.has(key)) return fail(ws, 'Ya existe una sala con ese nombre. Elige otro nombre o únete a la existente.');
      const requestedMax = Number(d.maxPlayers) || 2;
      // The current client synchronizes one remote rival, so do not create broken 3–5 player matches.
      if (requestedMax > 2) return fail(ws, 'Esta versión del juego sincroniza 2 jugadores reales como máximo. Selecciona capacidad 2.');
      const maxPlayers = Math.max(1, Math.min(2, requestedMax));
      const room = { key, name, password, mode: String(d.mode || '1v1'), maxPlayers, seed: crypto.randomInt(1, 0x7fffffff), players: new Set(), started:false, rematch:new Set(), raceReady:new Set() };
      rooms.set(key, room); room.players.add(ws); ws._roomKey = key; ws._name = String(d.name || 'Jugador').slice(0, 32); ws._role = 'host';
      send(ws, { type:'created', room:name, mode:room.mode, seed:room.seed, playerCount:1, maxPlayers });
      if (maxPlayers === 1) startRoom(room); else send(ws, {type:'waiting', room:name, mode:room.mode, seed:room.seed, playerCount:1, maxPlayers, role:'host', message:'Sala creada. Comparte el nombre y la contraseña.'});
      return;
    }
    if (d.type === 'join') {
      if (ws._roomKey) removePlayer(ws);
      const name = String(d.room || '').trim(); const key = roomKey(name); const room = rooms.get(key);
      if (!room) return fail(ws, 'No existe esa sala. Comprueba el nombre o pide al anfitrión que la cree primero.');
      if (String(d.password || '') !== room.password) return fail(ws, 'Contraseña incorrecta.');
      const players = roomPlayers(room);
      if (room.started || players.length >= room.maxPlayers) return fail(ws, 'La sala ya está llena.');
      if (room.mode !== String(d.mode || room.mode)) return fail(ws, 'Selecciona el mismo modo de juego que eligió el anfitrión.');
      ws._roomKey = key; ws._name = String(d.name || 'Jugador').slice(0, 32); ws._role = 'guest'; room.players.add(ws);
      updateLobby(room);
      if (roomPlayers(room).length >= room.maxPlayers) startRoom(room);
      else send(ws, {type:'waiting', room:room.name, mode:room.mode, seed:room.seed, playerCount:roomPlayers(room).length, maxPlayers:room.maxPlayers, role:'guest', message:'Contraseña correcta. Esperando a que se llene la sala…'});
      return;
    }
    if (d.type === 'leave') { removePlayer(ws); return; }
    const room = ws._roomKey && rooms.get(ws._roomKey);
    if (!room) return;
    if (d.type === 'race-ready') {
      room.raceReady.add(ws);
      if (room.raceReady.size >= room.maxPlayers) { room.raceReady.clear(); broadcastRoom(room, {type:'race-start'}); }
      else send(ws, {type:'race-ready-wait'});
      return;
    }
    if (d.type === 'rematch') {
      room.rematch.add(ws);
      if (room.rematch.size >= roomPlayers(room).length && roomPlayers(room).length >= 2) {
        room.rematch.clear(); room.seed = crypto.randomInt(1, 0x7fffffff); broadcastRoom(room, {type:'rematch-ready', seed:room.seed});
      }
      return;
    }
    // Forward gameplay messages to the other players in the same room.
    broadcastRoom(room, d, ws);
  });
  ws.on('close', () => removePlayer(ws));
  ws.on('error', () => removePlayer(ws));
});
server.listen(PORT, HOST, () => console.log(`Juego online escuchando en ${HOST}:${PORT}`));
