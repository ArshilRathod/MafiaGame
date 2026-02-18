"use strict";

const createRoomForm = document.getElementById("createRoomForm");
const joinRoomForm = document.getElementById("joinRoomForm");
const hostNameInput = document.getElementById("hostName");
const totalPlayersInput = document.getElementById("totalPlayers");
const mafiaCountInput = document.getElementById("mafiaCount");
const angelCountInput = document.getElementById("angelCount");
const citizenCountInput = document.getElementById("citizenCount");
const joinNameInput = document.getElementById("joinName");
const joinCodeInput = document.getElementById("joinCode");

const authPanel = document.getElementById("authPanel");
const roomPanel = document.getElementById("roomPanel");
const authError = document.getElementById("authError");
const roomError = document.getElementById("roomError");
const roomCodeText = document.getElementById("roomCodeText");
const statusText = document.getElementById("statusText");
const playersText = document.getElementById("playersText");
const countsText = document.getElementById("countsText");
const playerList = document.getElementById("playerList");
const hostActions = document.getElementById("hostActions");

const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const leaveBtn = document.getElementById("leaveBtn");
const revealRoleBtn = document.getElementById("revealRoleBtn");
const roleCard = document.getElementById("roleCard");
const roleText = document.getElementById("roleText");

const state = {
  roomCode: "",
  token: "",
  playerId: "",
  isHost: false,
  pollId: null
};

function setAuthError(message) {
  authError.textContent = message || "";
}

function setRoomError(message) {
  roomError.textContent = message || "";
}

function setSession(session) {
  state.roomCode = session.roomCode;
  state.token = session.token;
  state.playerId = session.playerId;
  state.isHost = session.isHost;

  sessionStorage.setItem("mafiaSession", JSON.stringify(session));
}

function clearSession() {
  state.roomCode = "";
  state.token = "";
  state.playerId = "";
  state.isHost = false;

  if (state.pollId) {
    clearInterval(state.pollId);
    state.pollId = null;
  }

  sessionStorage.removeItem("mafiaSession");
}

function loadSession() {
  const raw = sessionStorage.getItem("mafiaSession");
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    if (parsed.roomCode && parsed.token && parsed.playerId) {
      setSession(parsed);
      showRoomUI();
      fetchRoom();
      startPolling();
    }
  } catch (_) {
    clearSession();
  }
}

function validateHostConfig() {
  const total = Number(totalPlayersInput.value);
  const mafia = Number(mafiaCountInput.value);
  const angels = Number(angelCountInput.value);

  if ([total, mafia, angels].some((v) => Number.isNaN(v))) {
    return { valid: false, message: "All host config fields are required." };
  }
  if (![total, mafia, angels].every(Number.isInteger)) {
    return { valid: false, message: "Use whole numbers only." };
  }
  if (total < 3) return { valid: false, message: "Minimum total players is 3." };
  if (mafia < 1) return { valid: false, message: "At least 1 Mafia is required." };
  if (angels < 0) return { valid: false, message: "Angel count cannot be negative." };
  if (mafia + angels >= total) {
    return { valid: false, message: "Mafia + Angels must be less than total players." };
  }

  return { valid: true, citizens: total - mafia - angels };
}

function updateCitizenPreview() {
  const result = validateHostConfig();
  citizenCountInput.value = result.valid ? String(result.citizens) : "";
}

async function apiRequest(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(url, { ...options, headers });
  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function showRoomUI() {
  authPanel.classList.add("hidden");
  roomPanel.classList.remove("hidden");
  roomCodeText.textContent = state.roomCode;
  hostActions.classList.toggle("hidden", !state.isHost);
}

function showAuthUI() {
  roomPanel.classList.add("hidden");
  authPanel.classList.remove("hidden");
  roleCard.classList.add("hidden");
  roleText.textContent = "";
}

function renderRoom(room) {
  statusText.textContent = `Status: ${room.status}`;
  playersText.textContent = `Players: ${room.joinedPlayers}/${room.expectedPlayers}`;
  countsText.textContent = `Counts: Mafia ${room.counts.mafia} | Angels ${room.counts.angels} | Citizens ${room.counts.citizens}`;

  playerList.innerHTML = "";
  room.players.forEach((player) => {
    const li = document.createElement("li");
    li.textContent = `${player.name}${player.isHost ? " (Host)" : ""}${player.isYou ? " (You)" : ""}`;
    playerList.appendChild(li);
  });

  if (state.isHost) {
    startBtn.disabled = !(room.status === "waiting" && room.canStart);
    resetBtn.disabled = room.status !== "started";
  }

  const gameStarted = room.status === "started";
  revealRoleBtn.disabled = !gameStarted;

  if (!gameStarted) {
    roleCard.classList.add("hidden");
  }
}

async function fetchRoom() {
  if (!state.roomCode || !state.token) return;
  try {
    const room = await apiRequest(`/api/rooms/${state.roomCode}`);
    renderRoom(room);
    setRoomError("");
  } catch (error) {
    setRoomError(error.message);
    if (error.message.includes("Invalid session") || error.message.includes("Room not found")) {
      clearSession();
      showAuthUI();
    }
  }
}

function startPolling() {
  if (state.pollId) clearInterval(state.pollId);
  state.pollId = setInterval(fetchRoom, 2000);
}

function roleClass(role) {
  if (role === "Mafia") return "mafia";
  if (role === "Angel") return "angel";
  return "citizen";
}

async function handleCreateRoom(event) {
  event.preventDefault();
  setAuthError("");

  const hostName = hostNameInput.value.trim();
  if (!hostName) {
    setAuthError("Host name is required.");
    return;
  }

  const validation = validateHostConfig();
  if (!validation.valid) {
    setAuthError(validation.message);
    return;
  }

  try {
    const payload = await apiRequest("/api/rooms", {
      method: "POST",
      body: JSON.stringify({
        hostName,
        totalPlayers: Number(totalPlayersInput.value),
        mafiaCount: Number(mafiaCountInput.value),
        angelCount: Number(angelCountInput.value)
      })
    });

    setSession(payload);
    showRoomUI();
    await fetchRoom();
    startPolling();
  } catch (error) {
    setAuthError(error.message);
  }
}

async function handleJoinRoom(event) {
  event.preventDefault();
  setAuthError("");

  const name = joinNameInput.value.trim();
  const code = joinCodeInput.value.trim().toUpperCase();

  if (!name || !code) {
    setAuthError("Name and room code are required.");
    return;
  }

  try {
    const payload = await apiRequest(`/api/rooms/${code}/join`, {
      method: "POST",
      body: JSON.stringify({ name })
    });

    setSession(payload);
    showRoomUI();
    await fetchRoom();
    startPolling();
  } catch (error) {
    setAuthError(error.message);
  }
}

async function handleStartGame() {
  setRoomError("");
  try {
    await apiRequest(`/api/rooms/${state.roomCode}/start`, { method: "POST" });
    await fetchRoom();
  } catch (error) {
    setRoomError(error.message);
  }
}

async function handleReset() {
  setRoomError("");
  try {
    await apiRequest(`/api/rooms/${state.roomCode}/reset`, { method: "POST" });
    roleCard.classList.add("hidden");
    await fetchRoom();
  } catch (error) {
    setRoomError(error.message);
  }
}

async function handleRevealRole() {
  setRoomError("");
  try {
    if (!roleCard || !roleText) {
      setRoomError("UI is out of sync. Refresh the page and try again.");
      return;
    }

    const payload = await apiRequest(`/api/rooms/${state.roomCode}/my-role`);
    roleText.textContent = payload.role;
    roleText.className = `role-text ${roleClass(payload.role)}`;

    roleCard.classList.remove("hidden");
    roleCard.classList.remove("reveal-animation");
    void roleCard.offsetWidth;
    roleCard.classList.add("reveal-animation");
  } catch (error) {
    setRoomError(error.message);
  }
}

function handleLeaveSession() {
  clearSession();
  showAuthUI();
  setRoomError("");
  setAuthError("");
}

createRoomForm.addEventListener("submit", handleCreateRoom);
joinRoomForm.addEventListener("submit", handleJoinRoom);
startBtn.addEventListener("click", handleStartGame);
resetBtn.addEventListener("click", handleReset);
revealRoleBtn.addEventListener("click", handleRevealRole);
leaveBtn.addEventListener("click", handleLeaveSession);

[totalPlayersInput, mafiaCountInput, angelCountInput].forEach((input) => {
  input.addEventListener("input", () => {
    const result = validateHostConfig();
    setAuthError(result.valid ? "" : result.message);
    updateCitizenPreview();
  });
});

updateCitizenPreview();
loadSession();
