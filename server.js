"use strict";

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const rooms = new Map();

// Explicit root handler so serverless routing always serves the app shell.
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Explicit static routes for serverless environments where file serving can be tricky.
app.get("/styles.css", (_req, res) => {
  res.type("text/css");
  res.sendFile(path.join(__dirname, "styles.css"));
});

app.get("/app.js", (_req, res) => {
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "app.js"));
});

function randomToken(size = 24) {
  return crypto.randomBytes(size).toString("hex");
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
}

function uniqueRoomCode() {
  let tries = 0;
  while (tries < 50) {
    const code = generateRoomCode();
    if (!rooms.has(code)) return code;
    tries += 1;
  }
  throw new Error("Unable to generate unique room code");
}

function validateConfig(totalPlayers, mafiaCount, angelCount) {
  if (![totalPlayers, mafiaCount, angelCount].every(Number.isInteger)) {
    return "All counts must be whole numbers.";
  }
  if (totalPlayers < 3) return "Minimum total players is 3.";
  if (mafiaCount < 1) return "At least 1 Mafia is required.";
  if (angelCount < 0) return "Angel count cannot be negative.";
  if (mafiaCount + angelCount >= totalPlayers) {
    return "Mafia + Angels must be less than total players.";
  }
  return "";
}

function auth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ error: "Missing session token." });
  }
  const room = rooms.get(req.params.code);
  if (!room) {
    return res.status(404).json({ error: "Room not found." });
  }
  const player = room.players.find((p) => p.sessionToken === token);
  if (!player) {
    return res.status(403).json({ error: "Invalid session for this room." });
  }
  req.room = room;
  req.player = player;
  return next();
}

function hostOnly(req, res, next) {
  if (!req.player.isHost) {
    return res.status(403).json({ error: "Only host can perform this action." });
  }
  return next();
}

function buildRoles({ totalPlayers, mafiaCount, angelCount }) {
  const roles = [];
  const citizenCount = totalPlayers - mafiaCount - angelCount;

  for (let i = 0; i < mafiaCount; i += 1) roles.push("Mafia");
  for (let i = 0; i < angelCount; i += 1) roles.push("Angel");
  for (let i = 0; i < citizenCount; i += 1) roles.push("Citizen");

  return roles;
}

function secureShuffle(values) {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function assignRoles(room) {
  if (room.status !== "waiting") {
    throw new Error("Roles already generated. Reset required.");
  }
  const roles = secureShuffle(buildRoles(room.config));
  room.players.forEach((player, index) => {
    player.role = roles[index];
  });
  room.status = "started";
  room.roundSeed = randomToken(16);
  room.startedAt = new Date().toISOString();
}

function roomPublicPayload(room, requesterId) {
  return {
    code: room.code,
    status: room.status,
    expectedPlayers: room.config.totalPlayers,
    joinedPlayers: room.players.length,
    canStart: room.status === "waiting" && room.players.length === room.config.totalPlayers,
    counts: {
      mafia: room.config.mafiaCount,
      angels: room.config.angelCount,
      citizens: room.config.totalPlayers - room.config.mafiaCount - room.config.angelCount
    },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      isYou: p.id === requesterId
    })),
    round: room.status === "started" ? { startedAt: room.startedAt, seed: room.roundSeed } : null
  };
}

app.post("/api/rooms", (req, res) => {
  const { hostName, totalPlayers, mafiaCount, angelCount } = req.body;

  if (!hostName || typeof hostName !== "string" || !hostName.trim()) {
    return res.status(400).json({ error: "Host name is required." });
  }

  const configError = validateConfig(totalPlayers, mafiaCount, angelCount);
  if (configError) {
    return res.status(400).json({ error: configError });
  }

  const code = uniqueRoomCode();
  const host = {
    id: randomToken(8),
    name: hostName.trim().slice(0, 40),
    isHost: true,
    sessionToken: randomToken(),
    role: null
  };

  const room = {
    code,
    status: "waiting",
    config: { totalPlayers, mafiaCount, angelCount },
    players: [host],
    createdAt: new Date().toISOString(),
    roundSeed: null,
    startedAt: null
  };

  rooms.set(code, room);

  return res.status(201).json({
    roomCode: code,
    token: host.sessionToken,
    playerId: host.id,
    isHost: true
  });
});

app.post("/api/rooms/:code/join", (req, res) => {
  const room = rooms.get(req.params.code);
  const { name } = req.body;

  if (!room) return res.status(404).json({ error: "Room not found." });
  if (room.status !== "waiting") {
    return res.status(403).json({ error: "Game already started. No new joins allowed." });
  }
  if (room.players.length >= room.config.totalPlayers) {
    return res.status(403).json({ error: "Room is full." });
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Player name is required." });
  }

  const trimmed = name.trim().slice(0, 40);
  if (room.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
    return res.status(409).json({ error: "Name already taken in this room." });
  }

  const player = {
    id: randomToken(8),
    name: trimmed,
    isHost: false,
    sessionToken: randomToken(),
    role: null
  };

  room.players.push(player);

  return res.status(201).json({
    roomCode: room.code,
    token: player.sessionToken,
    playerId: player.id,
    isHost: false
  });
});

app.get("/api/rooms/:code", auth, (req, res) => {
  return res.json(roomPublicPayload(req.room, req.player.id));
});

app.post("/api/rooms/:code/start", auth, hostOnly, (req, res) => {
  const room = req.room;

  if (room.status !== "waiting") {
    return res.status(409).json({ error: "Game already started. Reset required." });
  }
  if (room.players.length !== room.config.totalPlayers) {
    return res.status(400).json({ error: "Cannot start until all expected players join." });
  }

  assignRoles(room);
  return res.json({ message: "Roles assigned securely.", startedAt: room.startedAt, seed: room.roundSeed });
});

app.post("/api/rooms/:code/reset", auth, hostOnly, (req, res) => {
  const room = req.room;
  room.status = "waiting";
  room.roundSeed = null;
  room.startedAt = null;
  room.players.forEach((p) => {
    p.role = null;
  });
  return res.json({ message: "Round reset. Host can start again when all players are present." });
});

app.get("/api/rooms/:code/my-role", auth, (req, res) => {
  const room = req.room;
  const player = req.player;

  if (room.status !== "started") {
    return res.status(409).json({ error: "Game has not started yet." });
  }
  if (!player.role) {
    return res.status(500).json({ error: "Role not found for player." });
  }

  return res.json({ role: player.role });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Mafia Role Randomizer server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
