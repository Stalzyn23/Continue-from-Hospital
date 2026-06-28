const joinView = document.querySelector("#join-view");
const gameView = document.querySelector("#game-view");
const statusLine = document.querySelector("#status-line");
const toast = document.querySelector("#toast");
const characterForm = document.querySelector("#character-form");
const faceClaimInput = document.querySelector("#face-claim");
const facePreview = document.querySelector("#face-preview");
const createRoomButton = document.querySelector("#create-room");
const joinRoomButton = document.querySelector("#join-room");
const roomCodeInput = document.querySelector("#room-code");
const copyRoomButton = document.querySelector("#copy-room");
const roomLinkInput = document.querySelector("#room-link");
const resetRoomButton = document.querySelector("#reset-room");
const playersList = document.querySelector("#players-list");
const playerCount = document.querySelector("#player-count");
const worldStrip = document.querySelector("#world-strip");
const log = document.querySelector("#log");
const optionsList = document.querySelector("#options-list");
const actionForm = document.querySelector("#action-form");
const actionInput = document.querySelector("#action-input");
const speechInput = document.querySelector("#speech-input");
const lockActionButton = document.querySelector("#lock-action");
const unlockActionButton = document.querySelector("#unlock-action");
const resolveTurnButton = document.querySelector("#resolve-turn");
const lockState = document.querySelector("#lock-state");
const resources = document.querySelector("#resources");
const npcList = document.querySelector("#npc-list");
const privateNotes = document.querySelector("#private-notes");
const dangerPill = document.querySelector("#danger-pill");
const actionOpen = document.querySelector("#action-open");
const inventoryOpen = document.querySelector("#inventory-open");
const audioToggle = document.querySelector("#audio-toggle");
const drawerBackdrop = document.querySelector("#drawer-backdrop");
const actionDrawer = document.querySelector("#action-drawer");
const inventoryDrawer = document.querySelector("#inventory-drawer");
const bodyItems = document.querySelector("#body-items");
const bagItems = document.querySelector("#bag-items");

let socket;
let appState = null;
let reconnectTimer = null;
let faceClaimData = "";
let audioEngine = null;
const savedSessionKey = "rot-2041-session";
const roomFromUrl = normalizeRoomCode(new URLSearchParams(location.search).get("room") || "");
const playerFromUrl = new URLSearchParams(location.search).get("player") || "";
if (roomFromUrl) {
  roomCodeInput.value = roomFromUrl;
  statusLine.textContent = `Ready to join ${roomFromUrl}`;
}

const icons = {
  health: icon("M20 7.5c0 6-8 10.5-8 10.5S4 13.5 4 7.5A4.5 4.5 0 0 1 12 4a4.5 4.5 0 0 1 8 3.5Z"),
  stress: icon("M12 3v4M12 17v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M3 12h4M17 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"),
  energy: icon("M13 2 4 14h7l-1 8 10-13h-7l0-7Z"),
  hunger: icon("M7 2v20M5 2v6a2 2 0 0 0 4 0V2M17 2v20M15 2h4v9a2 2 0 0 1-2 2"),
  thirst: icon("M12 2s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12Z"),
  injury: icon("M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7V3Z"),
};

connect();

faceClaimInput.addEventListener("change", async () => {
  const file = faceClaimInput.files?.[0];
  if (!file) return;
  faceClaimData = await resizeFaceClaim(file);
  facePreview.src = faceClaimData;
  facePreview.classList.add("has-image");
});

createRoomButton.addEventListener("click", () => send({ type: "createRoom", roomCode: roomCodeInput.value, character: getCharacter() }));
joinRoomButton.addEventListener("click", () => send({ type: "joinRoom", roomCode: roomCodeInput.value, character: getCharacter() }));
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = normalizeRoomCode(roomCodeInput.value);
});
copyRoomButton.addEventListener("click", async () => {
  if (!appState) return;
  const link = getRoomLink(appState.room.code);
  try {
    await navigator.clipboard.writeText(link);
    showToast("Copied room link");
  } catch {
    showToast(link);
  }
});
resetRoomButton.addEventListener("click", () => send({ type: "resetRoom" }));
actionOpen.addEventListener("click", () => openDrawer(actionDrawer));
inventoryOpen.addEventListener("click", () => openDrawer(inventoryDrawer));
drawerBackdrop.addEventListener("click", closeDrawers);
document.querySelectorAll("[data-close-drawer]").forEach((button) => button.addEventListener("click", closeDrawers));
audioToggle.addEventListener("click", toggleAudio);
actionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  send({ type: "submitAction", action: actionInput.value, spokenWords: speechInput.value });
  closeDrawers();
});
unlockActionButton.addEventListener("click", () => send({ type: "unlockAction" }));
resolveTurnButton.addEventListener("click", () => send({ type: "resolveTurn" }));

function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`);
  statusLine.textContent = "Connecting";
  socket.addEventListener("open", () => {
    statusLine.textContent = "Connected";
    const saved = getSavedSession();
    const canResumeLinkedPlayer = roomFromUrl && playerFromUrl && saved?.roomCode === roomFromUrl && saved?.playerId === playerFromUrl;
    if ((!roomFromUrl || canResumeLinkedPlayer) && saved?.roomCode && saved?.playerId) {
      send({ type: "resumeRoom", roomCode: saved.roomCode, playerId: saved.playerId });
    }
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "joined") {
      localStorage.setItem(savedSessionKey, JSON.stringify(message));
      updateRoomUrl(message.roomCode, message.playerId);
      showToast(`Joined ${message.roomCode}`);
      return;
    }
    if (message.type === "state") {
      appState = message;
      render();
      return;
    }
    if (message.type === "error") {
      showToast(message.message);
      statusLine.textContent = message.message;
    }
  });
  socket.addEventListener("close", () => {
    statusLine.textContent = "Disconnected";
    reconnectTimer = setTimeout(connect, 1200);
  });
}

function normalizeRoomCode(value) {
  const raw = String(value || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!raw) return "";
  const withoutPrefix = raw.startsWith("ROT-") ? raw.slice(4) : raw;
  return `ROT-${withoutPrefix}`.slice(0, 12);
}

function getRoomLink(code) {
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  url.searchParams.delete("player");
  return url.toString();
}

function updateRoomUrl(code, playerId = "") {
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  if (playerId) url.searchParams.set("player", playerId);
  history.replaceState(null, "", url);
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast("Server connection is not ready.");
    return;
  }
  socket.send(JSON.stringify(payload));
}

function getSavedSession() {
  try {
    return JSON.parse(localStorage.getItem(savedSessionKey));
  } catch {
    return null;
  }
}

function getCharacter() {
  const data = new FormData(characterForm);
  return {
    name: data.get("name"),
    age: data.get("age"),
    gender: data.get("gender"),
    archetype: data.get("archetype"),
    trait: data.get("trait"),
    background: data.get("background"),
    personalNpcName: data.get("personalNpcName"),
    personalNpcRelation: data.get("personalNpcRelation"),
    emotionalBaggage: data.get("emotionalBaggage"),
    faceClaim: faceClaimData,
  };
}

function render() {
  if (!appState?.room) return;
  joinView.classList.add("hidden");
  gameView.classList.remove("hidden");
  const { room } = appState;
  const world = room.world;
  const me = room.myPlayer;
  copyRoomButton.textContent = "Copy Link";
  roomLinkInput.value = getRoomLink(room.code);
  playerCount.textContent = `${room.players.length}/4`;
  dangerPill.textContent = world.dangerLevel;
  dangerPill.dataset.level = world.dangerLevel;
  renderPlayers(room.players, appState.viewerId);
  renderWorldStrip(world);
  renderLog(room.log);
  renderOptions(me);
  renderActionState(me, room);
  renderResources(world.resources);
  renderNpcs(world.npcs);
  renderPrivateNotes(me);
  renderInventory(me);
}

function renderPlayers(players, viewerId) {
  playersList.innerHTML = "";
  for (const player of players) {
    const card = document.createElement("article");
    card.className = `player-card ${player.id === viewerId ? "is-me" : ""}`;
    card.innerHTML = `
      <div class="player-row">
        ${avatar(player)}
        <div class="player-main">
          <div class="player-top">
            <div>
              <strong>${escapeHtml(player.name)}</strong>
              <span>${escapeHtml(player.location)}</span>
            </div>
            <b>${player.locked ? "Ready" : "Open"}</b>
          </div>
          <small>${escapeHtml(player.archetype)} / ${escapeHtml(player.trait)} - ${player.connected ? "online" : "offline"}</small>
        </div>
      </div>
      <div class="stats-grid">
        ${stat("health", player.health)}
        ${stat("stress", player.stress)}
        ${stat("energy", player.energy)}
        ${stat("hunger", player.hunger)}
        ${stat("thirst", player.thirst)}
        ${stat("injury", player.injury)}
      </div>
    `;
    playersList.append(card);
  }
  for (let slot = players.length + 1; slot <= 4; slot += 1) {
    const empty = document.createElement("article");
    empty.className = "player-card empty";
    empty.innerHTML = `<strong>Open Slot ${slot}</strong><p>Waiting on room code.</p>`;
    playersList.append(empty);
  }
}

function avatar(player) {
  if (player.faceClaim) return `<img class="avatar" src="${player.faceClaim}" alt="${escapeHtml(player.name)} face claim">`;
  return `<span class="avatar avatar-empty">${escapeHtml(player.name.slice(0, 1) || "?")}</span>`;
}

function stat(name, value) {
  return `
    <div class="stat" title="${labelize(name)}">
      ${icons[name] || ""}
      <i style="--value:${Number(value)}%"></i>
      <b>${Number(value)}</b>
    </div>
  `;
}

function icon(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;
}

function renderWorldStrip(world) {
  worldStrip.innerHTML = `
    <span>${escapeHtml(world.currentTime)}</span>
    <span>${escapeHtml(world.weather)}</span>
    <span>Turn ${world.turn}</span>
    <span>GM ${escapeHtml(world.aiProvider)}</span>
    <span>Rot ${world.resources.rotPressure}</span>
  `;
}

function renderLog(entries) {
  log.innerHTML = "";
  for (const entry of entries.slice().sort((a, b) => a.createdAt - b.createdAt)) {
    const item = document.createElement("article");
    item.className = `log-entry ${entry.type}`;
    item.innerHTML = `
      <div class="log-title">
        <strong>${escapeHtml(entry.title)}</strong>
        <span>Turn ${entry.turn}</span>
      </div>
      <p>${escapeHtml(entry.text).replace(/\n/g, "<br>")}</p>
    `;
    log.append(item);
  }
  log.scrollTop = log.scrollHeight;
}

function renderOptions(me) {
  optionsList.innerHTML = "";
  if (!me) return;
  for (const option of me.options || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option-button";
    button.dataset.risk = option.risk;
    button.innerHTML = `<span>${escapeHtml(option.label)}</span><small>${escapeHtml(option.requirement || option.risk)}</small>`;
    button.addEventListener("click", () => {
      if (option.id === "custom") return actionInput.focus();
      actionInput.value = optionToAction(option, me);
      actionInput.focus();
    });
    optionsList.append(button);
  }
}

function optionToAction(option, me) {
  const npc = me?.personalNpc?.name || "my loved one";
  const map = {
    "protect-bond": `Get to ${npc}, keep them calm, and prepare to move without leaving them exposed.`,
    "call-staff": "Find the nearest staff member or working call button and ask what is happening before panic spreads.",
    "search-room": "Search nearby drawers, bags, and counters for supplies that can be carried quietly.",
    "secure-door": "Secure the room door with furniture while keeping a line of sight into the corridor.",
    "move-corridor": "Step into the corridor carefully, checking the nearest exit route and who needs help.",
    evacuate: "Find a safer route through the hospital without abandoning anyone important.",
    "sense-rot": "Focus on the strange pressure in the walls and listen for the Rot pulse.",
  };
  return map[option.id] || option.label;
}

function renderActionState(me, room) {
  if (!me) return;
  const locked = me.locked;
  lockState.textContent = room.resolving ? "GM resolving" : locked ? "Ready" : "Open";
  actionInput.disabled = locked || room.resolving;
  speechInput.disabled = locked || room.resolving;
  lockActionButton.disabled = locked || room.resolving;
  unlockActionButton.disabled = !locked || room.resolving;
  resolveTurnButton.disabled = !room.canResolve;
  actionOpen.textContent = locked ? "Turn Ready" : "Take Turn";
}

function renderResources(values) {
  resources.innerHTML = "";
  for (const [name, value] of Object.entries(values)) {
    const row = document.createElement("div");
    row.className = "resource-row";
    row.innerHTML = `<span>${labelize(name)}</span><b>${value}</b><i style="--value:${Math.min(Number(value), 100)}%"></i>`;
    resources.append(row);
  }
}

function renderNpcs(npcs) {
  npcList.innerHTML = "";
  for (const npc of npcs || []) {
    const row = document.createElement("div");
    row.className = "npc-row";
    row.innerHTML = `<strong>${escapeHtml(npc.name)}</strong><span>${escapeHtml(npc.status)}</span><b>${npc.trust >= 0 ? "+" : ""}${npc.trust}</b>`;
    npcList.append(row);
  }
}

function renderPrivateNotes(me) {
  privateNotes.innerHTML = "";
  for (const note of (me?.privateKnowledge || []).slice(-6)) {
    const item = document.createElement("li");
    item.textContent = note;
    privateNotes.append(item);
  }
}

function renderInventory(me) {
  bodyItems.innerHTML = "";
  bagItems.innerHTML = "";
  for (const item of me?.inventory?.body || []) bodyItems.append(inventoryItem(item));
  for (const item of me?.inventory?.bag || []) bagItems.append(inventoryItem(item));
}

function inventoryItem(text) {
  const item = document.createElement("li");
  item.textContent = text;
  return item;
}

function openDrawer(drawer) {
  closeDrawers();
  drawerBackdrop.classList.remove("hidden");
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeDrawers() {
  drawerBackdrop.classList.add("hidden");
  for (const drawer of [actionDrawer, inventoryDrawer]) {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }
}

function toggleAudio() {
  if (!audioEngine) audioEngine = createAudioEngine();
  audioEngine.toggle();
  audioToggle.classList.toggle("is-on", audioEngine.playing);
  audioToggle.textContent = audioEngine.playing ? "Audio On" : "Audio";
}

function createAudioEngine() {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0.045;
  master.connect(ctx.destination);
  let playing = false;
  let timer = 0;
  const nodes = [];

  function pulse(freq, duration, gainValue, type = "sine") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(gainValue, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
    nodes.push(osc, gain);
  }

  function loop() {
    if (!playing) return;
    pulse(44, 4.8, 0.34, "sine");
    pulse(73 + Math.random() * 8, 2.2, 0.08, "triangle");
    if (Math.random() > 0.55) pulse(240 + Math.random() * 90, 0.25, 0.12, "sawtooth");
    timer = window.setTimeout(loop, 2200 + Math.random() * 1800);
  }

  return {
    get playing() {
      return playing;
    },
    toggle() {
      if (ctx.state === "suspended") ctx.resume();
      playing = !playing;
      if (playing) loop();
      else {
        clearTimeout(timer);
        nodes.splice(0).forEach((node) => node.disconnect?.());
      }
    },
  };
}

async function resizeFaceClaim(file) {
  const bitmap = await createImageBitmap(file);
  const size = 220;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2600);
}

function labelize(value) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
