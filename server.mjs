import { createServer } from "node:http";
import { readFile, readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
loadDotEnv(join(__dirname, ".env"));

const publicDir = join(__dirname, "public");
const maxPlayers = 4;
const startPort = Number(process.env.PORT || 8787);
const openaiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const rooms = new Map();
const clients = new Set();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

const hospitalStarts = [
  {
    location: "Mercy General - ICU Bay 3",
    routine: "sitting beside your younger sister Imani while a nurse adjusts her oxygen line",
    bond: { name: "Imani", relation: "younger sister", status: "sedated after surgery, same room", trust: 3 },
    body: ["phone", "wallet", "visitor badge", "half-full water bottle"],
    bag: ["hoodie", "phone charger", "snack bar", "old prayer card"],
    options: ["Check Imani's monitor", "Call for the nurse", "Move the bed toward the exit"],
  },
  {
    location: "Mercy General - Pediatric Ward",
    routine: "reading discharge papers for your son while cartoons flicker without sound",
    bond: { name: "Malik", relation: "son", status: "recovering from fever, same room", trust: 3 },
    body: ["phone", "keys", "visitor wristband", "toy car"],
    bag: ["diaper wipes", "two juice boxes", "spare shirt", "paper discharge folder"],
    options: ["Pick up Malik", "Barricade the ward door", "Ask the nurse what is happening"],
  },
  {
    location: "Mercy General - Oncology Waiting Room",
    routine: "waiting for your mother to return from a scan that should have ended ten minutes ago",
    bond: { name: "Amina", relation: "mother", status: "in radiology, outside your room", trust: 3 },
    body: ["phone", "wallet", "transit card", "paper coffee cup"],
    bag: ["umbrella", "scarf", "medication list", "book"],
    options: ["Find radiology", "Call Amina", "Help the panicking receptionist"],
  },
  {
    location: "Mercy General - Staff Break Room",
    routine: "finishing a double shift while your friend Nia argues with vending machine glass",
    bond: { name: "Nia", relation: "best friend", status: "same room, exhausted and scared", trust: 3 },
    body: ["phone", "ID badge", "penlight", "latex gloves"],
    bag: ["spare scrubs", "protein drink", "small first-aid pouch", "notebook"],
    options: ["Lock the break room", "Reach the nurses station", "Check the staff radio"],
  },
];

const archetypeLoadouts = {
  Scavenger: { body: ["coin pouch"], bag: ["folding tote", "granola bar"] },
  Hunter: { body: ["pocket compass"], bag: ["weather jacket", "field notebook"] },
  Soldier: { body: ["old service ring"], bag: ["clean socks", "fitness wrap"] },
  Mechanic: { body: ["multi-bit keychain"], bag: ["work gloves", "roll of tape"] },
  Medic: { body: ["penlight"], bag: ["pocket first-aid pouch", "sanitizer"] },
  Mystic: { body: ["ash charm"], bag: ["old journal", "salt packet"] },
  Custom: { body: ["keepsake"], bag: ["spare shirt", "snack bar"] },
};

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

function makeWorld() {
  return {
    currentTime: "2041-09-18 14:06",
    weather: "hot rain on hospital glass, rolling blackout warnings",
    dangerLevel: "low",
    turn: 1,
    setting: "Mercy General Hospital",
    aiProvider: process.env.OPENAI_API_KEY ? "openai" : "local-fallback",
    resources: {
      power: 72,
      medicine: 64,
      order: 58,
      morale: 46,
      panic: 18,
      rotPressure: 7,
    },
    flags: {
      outbreakDeclared: false,
      alarmsActive: false,
      firstScreamHeard: false,
      emergencyDoorsSealed: false,
      stairwellCompromised: false,
      securityConfused: true,
      magicManifested: false,
      intercomWarning: false,
    },
    locations: [
      { name: "ICU Bay 3", status: "quiet, dim, one monitor lagging" },
      { name: "Pediatric Ward", status: "nurses moving too quickly" },
      { name: "Radiology Hall", status: "lights flickering behind sealed glass" },
      { name: "Staff Break Room", status: "vending machine humming during a blackout warning" },
      { name: "Main Atrium", status: "crowded, phones failing, rain hammering skylights" },
      { name: "East Stairwell", status: "unknown, alarm sensor blinking red" },
    ],
    factions: [
      { name: "Hospital Staff", reputation: "overwhelmed but reachable" },
      { name: "Private Security", reputation: "confused, armed with batons only" },
      { name: "Panicked Visitors", reputation: "volatile" },
    ],
    npcs: [
      { name: "Dr. Vale", role: "night attending", status: "arguing with the intercom system", trust: 0 },
      { name: "Nurse Sade", role: "triage nurse", status: "trying to keep children calm", trust: 0 },
      { name: "Officer Holt", role: "hospital security", status: "calling for backup that will not come", trust: 0 },
      { name: "Mr. Chen", role: "patient in radiology", status: "missing after the lights failed", trust: 0 },
    ],
    recentEvents: [
      "Mercy General is still functioning, but every system feels half a step late.",
      "No one has said outbreak yet.",
      "Each player begins with someone or something personal to lose.",
    ],
  };
}

function createRoom(code) {
  return {
    code,
    createdAt: new Date().toISOString(),
    phase: "hospital-outbreak",
    resolveTimer: null,
    resolving: false,
    world: makeWorld(),
    players: [],
    log: [
      {
        id: randomUUID(),
        type: "shared",
        title: "Mercy General Hospital",
        text:
          "It begins as a normal hospital afternoon. Elevators complain between floors. Visitors whisper over paper cups. Somewhere behind the walls, emergency power clicks once and fails to sound ordinary.",
        turn: 1,
        createdAt: Date.now(),
      },
    ],
  };
}

function makeRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let tries = 0; tries < 50; tries += 1) {
    let tail = "";
    for (let i = 0; i < 4; i += 1) tail += letters[Math.floor(Math.random() * letters.length)];
    const code = `ROT-${tail}`;
    if (!rooms.has(code)) return code;
  }
  return `ROT-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

function clean(value, fallback = "", max = 1200) {
  return String(value ?? fallback).replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function createPlayer(character, slot) {
  const start = hospitalStarts[slot - 1] || hospitalStarts[0];
  const archetype = clean(character.archetype, "Custom");
  const classItems = archetypeLoadouts[archetype] || archetypeLoadouts.Custom;
  const name = clean(character.name, `Player ${slot}`, 32);
  const personalNpcName = clean(character.personalNpcName, start.bond.name, 36);
  const personalNpcRelation = clean(character.personalNpcRelation, start.bond.relation, 40);
  const personalNpcStatus = clean(
    character.personalNpcStatus,
    start.bond.status,
    120,
  );
  const player = {
    id: randomUUID(),
    slot,
    connected: true,
    name,
    age: clean(character.age, "28", 3),
    gender: clean(character.gender, "Unspecified", 24),
    archetype,
    trait: clean(character.trait, "Lucky", 32),
    background: clean(character.background, "", 300),
    faceClaim: sanitizeFaceClaim(character.faceClaim),
    location: start.location,
    routine: start.routine,
    emotionalBaggage: clean(
      character.emotionalBaggage,
      `You cannot leave ${personalNpcName} behind.`,
      220,
    ),
    personalNpc: {
      name: personalNpcName,
      relation: personalNpcRelation,
      status: personalNpcStatus,
      trust: 3,
    },
    health: 100,
    energy: 82,
    stress: 14 + slot * 3,
    hunger: 18,
    thirst: 21,
    injury: 0,
    infection: 0,
    inventory: {
      body: [...start.body, ...classItems.body],
      bag: [...start.bag, ...classItems.bag],
    },
    relationships: {
      [personalNpcName]: 3,
      "Dr. Vale": 0,
      "Nurse Sade": 0,
      "Officer Holt": 0,
    },
    privateKnowledge: [
      `You are in ${start.location}, ${start.routine}.`,
      `Emotional baggage: ${clean(character.emotionalBaggage, `You cannot leave ${personalNpcName} behind.`, 220)}`,
    ],
    options: [],
    locked: false,
    action: "",
    spokenWords: "",
    lastResult: "",
    joinedAt: Date.now(),
  };
  player.options = buildOptions(player, makeWorld());
  return player;
}

function sanitizeFaceClaim(value) {
  const text = clean(value, "", 120000);
  if (!text.startsWith("data:image/")) return "";
  return text;
}

function getPublicPlayer(player, viewerId) {
  const own = player.id === viewerId;
  return {
    id: player.id,
    slot: player.slot,
    connected: player.connected,
    name: player.name,
    age: player.age,
    gender: player.gender,
    archetype: player.archetype,
    trait: player.trait,
    faceClaim: player.faceClaim,
    location: player.location,
    routine: own ? player.routine : undefined,
    emotionalBaggage: own ? player.emotionalBaggage : undefined,
    personalNpc: own ? player.personalNpc : { name: player.personalNpc.name, relation: player.personalNpc.relation },
    health: player.health,
    energy: player.energy,
    stress: player.stress,
    hunger: player.hunger,
    thirst: player.thirst,
    injury: player.injury,
    infection: player.infection,
    inventory: own ? player.inventory : { body: [`${player.inventory.body.length} body items`], bag: [`${player.inventory.bag.length} bag items`] },
    relationships: own ? player.relationships : undefined,
    privateKnowledge: own ? player.privateKnowledge : undefined,
    options: own ? player.options : [],
    locked: player.locked,
    lastResult: own ? player.lastResult : "",
  };
}

function getClientState(room, viewerId) {
  const viewer = room.players.find((player) => player.id === viewerId);
  return {
    type: "state",
    viewerId,
    room: {
      code: room.code,
      phase: room.phase,
      createdAt: room.createdAt,
      resolving: room.resolving,
      world: room.world,
      players: room.players.map((player) => getPublicPlayer(player, viewerId)),
      log: room.log.filter((entry) => entry.type === "shared" || entry.playerId === viewerId),
      myPlayer: viewer ? getPublicPlayer(viewer, viewerId) : null,
      canResolve: room.players.some((player) => player.locked) && !room.resolving,
      allActiveLocked:
        room.players.length > 0 &&
        room.players.filter((player) => player.connected).every((player) => player.locked),
    },
  };
}

function sendState(client) {
  const room = rooms.get(client.roomCode);
  if (room && client.playerId) sendJson(client, getClientState(room, client.playerId));
}

function broadcastRoom(room) {
  for (const client of clients) {
    if (client.roomCode === room.code && client.playerId) sendState(client);
  }
}

function sendError(client, message) {
  sendJson(client, { type: "error", message });
}

function assignPlayerToClient(client, room, player) {
  client.roomCode = room.code;
  client.playerId = player.id;
  player.connected = true;
  player.lastSeen = Date.now();
  sendJson(client, { type: "joined", roomCode: room.code, playerId: player.id });
  broadcastRoom(room);
}

async function handleMessage(client, data) {
  let message;
  try {
    message = JSON.parse(data);
  } catch {
    sendError(client, "The server could not read that message.");
    return;
  }

  if (message.type === "createRoom") {
    const room = createRoom(makeRoomCode());
    const player = createPlayer(message.character || {}, 1);
    rooms.set(room.code, room);
    room.players.push(player);
    room.log.push({
      id: randomUUID(),
      type: "private",
      playerId: player.id,
      title: `${player.name} - Before`,
      text: `You are ${player.routine}. ${player.personalNpc.name} matters. That is the first thing the outbreak will test.`,
      turn: room.world.turn,
      createdAt: Date.now(),
    });
    assignPlayerToClient(client, room, player);
    return;
  }

  if (message.type === "joinRoom") {
    const roomCode = clean(message.roomCode).toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return sendError(client, "That room code is not active.");
    if (room.players.length >= maxPlayers) return sendError(client, "That room already has four players.");
    const player = createPlayer(message.character || {}, room.players.length + 1);
    room.players.push(player);
    room.log.push({
      id: randomUUID(),
      type: "shared",
      title: "Another Ordinary Moment",
      text: `${player.name} is elsewhere in Mercy General, caught in their own normal afternoon before the hospital changes shape.`,
      turn: room.world.turn,
      createdAt: Date.now(),
    });
    assignPlayerToClient(client, room, player);
    return;
  }

  if (message.type === "resumeRoom") {
    const room = rooms.get(clean(message.roomCode).toUpperCase());
    if (!room) return sendError(client, "Saved room is no longer active on this server.");
    const player = room.players.find((item) => item.id === message.playerId);
    if (!player) return sendError(client, "Saved player slot was not found in that room.");
    assignPlayerToClient(client, room, player);
    return;
  }

  const room = rooms.get(client.roomCode);
  const player = room?.players.find((item) => item.id === client.playerId);
  if (!room || !player) return sendError(client, "Join a room before sending actions.");

  if (message.type === "submitAction") {
    const action = clean(message.action, "", 500);
    if (!action) return sendError(client, "Give the GM an action to resolve.");
    player.action = action;
    player.spokenWords = clean(message.spokenWords, "", 180);
    player.locked = true;
    room.log.push({
      id: randomUUID(),
      type: "shared",
      title: player.name,
      text: player.spokenWords ? `${player.action}\n\n"${player.spokenWords}"` : player.action,
      turn: room.world.turn,
      createdAt: Date.now(),
    });
    broadcastRoom(room);
    maybeAutoResolve(room);
    return;
  }

  if (message.type === "unlockAction") {
    player.locked = false;
    player.action = "";
    player.spokenWords = "";
    broadcastRoom(room);
    return;
  }

  if (message.type === "resolveTurn") {
    await resolveTurn(room);
    broadcastRoom(room);
    return;
  }

  if (message.type === "resetRoom") {
    resetRoom(room);
    broadcastRoom(room);
  }
}

function maybeAutoResolve(room) {
  if (room.resolveTimer) clearTimeout(room.resolveTimer);
  const active = room.players.filter((player) => player.connected);
  if (active.length > 0 && active.every((player) => player.locked)) {
    room.resolveTimer = setTimeout(async () => {
      await resolveTurn(room);
      broadcastRoom(room);
    }, 700);
  }
}

function resetRoom(room) {
  const oldPlayers = room.players;
  const fresh = createRoom(room.code);
  room.phase = fresh.phase;
  room.world = fresh.world;
  room.log = fresh.log;
  room.resolveTimer = null;
  room.resolving = false;
  room.players = oldPlayers.map((player, index) => {
    const reset = createPlayer(player, index + 1);
    reset.id = player.id;
    reset.connected = player.connected;
    return reset;
  });
}

async function resolveTurn(room) {
  if (room.resolving) return;
  if (room.resolveTimer) clearTimeout(room.resolveTimer);
  room.resolveTimer = null;
  const actors = room.players.filter((player) => player.locked && player.action.trim());
  if (actors.length === 0) return;

  room.resolving = true;
  broadcastRoom(room);

  const local = runLocalTurn(room, actors);
  let ai = null;
  if (process.env.OPENAI_API_KEY) {
    try {
      ai = await callOpenAiGm(room, actors, local);
    } catch (error) {
      room.log.push({
        id: randomUUID(),
        type: "shared",
        title: "GM Fallback",
        text: `OpenAI GM call failed, so the local rules engine resolved this turn. ${error.message}`,
        turn: room.world.turn,
        createdAt: Date.now(),
      });
    }
  }
  applyTurnResult(room, actors, ai || local, ai ? "OpenAI GM" : "Local GM");
  room.resolving = false;
}

function runLocalTurn(room, actors) {
  const world = room.world;
  const turnNumber = world.turn;
  const sharedBeats = [];
  const privateResults = {};
  const patch = [];
  let panicShift = 0;
  let rotShift = 0;
  let orderShift = 0;

  for (const player of room.players) {
    if (!player.locked) {
      privateResults[player.id] = {
        privateNarration: "You freeze for one breath too long. The hospital keeps moving without asking whether you are ready.",
        stressDelta: 4,
        energyDelta: -2,
      };
    }
  }

  for (const player of actors) {
    const result = resolveHospitalAction(player, room);
    privateResults[player.id] = result;
    panicShift += result.panicShift || 0;
    rotShift += result.rotShift || 0;
    orderShift += result.orderShift || 0;
    if (result.sharedBeat) sharedBeats.push(result.sharedBeat);
    for (const item of result.patch || []) patch.push(item);
  }

  if (!world.flags.outbreakDeclared && world.turn >= 1) {
    world.flags.outbreakDeclared = true;
    world.flags.alarmsActive = true;
    world.flags.firstScreamHeard = true;
    panicShift += 18;
    rotShift += 12;
    orderShift -= 8;
    sharedBeats.push("The first scream comes from radiology, followed by every monitor in the ICU stuttering into alarm.");
    patch.push("Outbreak declared. Hospital alarms active. Mercy General enters lockdown drift.");
  }

  const sharedNarration = makeHospitalNarration(room, actors, sharedBeats);
  return {
    turnNumber,
    sharedNarration,
    privateResults,
    worldPatch: {
      panicShift,
      rotShift,
      orderShift,
      moraleShift: -3,
      powerShift: -4,
      medicineShift: -1,
      patch,
    },
  };
}

function resolveHospitalAction(player, room) {
  const action = player.action.toLowerCase();
  const world = room.world;
  const words = (...needles) => needles.some((needle) => action.includes(needle));
  const result = {
    privateNarration: "",
    privateKnowledge: "",
    sharedBeat: "",
    patch: [],
    healthDelta: 0,
    energyDelta: -7,
    stressDelta: 3,
    hungerDelta: 2,
    thirstDelta: 3,
    injuryDelta: 0,
    infectionDelta: 0,
    panicShift: 1,
    rotShift: 0,
    orderShift: 0,
    inventoryAddBody: [],
    inventoryAddBag: [],
    relationshipDelta: {},
    locationChange: "",
  };

  if (words("loved", "imani", "malik", "amina", "nia", "mother", "son", "sister", "friend", "patient")) {
    result.stressDelta = -4;
    result.panicShift = -1;
    result.relationshipDelta[player.personalNpc.name] = 1;
    result.privateNarration = `You reach ${player.personalNpc.name} before the room understands the danger. Their eyes find you, and for one second the whole hospital narrows to a promise you may not be able to keep.`;
    result.privateKnowledge = `${player.personalNpc.name} will follow you if you keep them calm.`;
    result.sharedBeat = `${player.name} chooses the person who matters before choosing the exit.`;
    result.patch.push(`${player.personalNpc.name}'s trust rises.`);
    return result;
  }

  if (words("barricade", "lock", "block", "door", "seal")) {
    world.flags.emergencyDoorsSealed = true;
    result.energyDelta = -12;
    result.stressDelta = 5;
    result.orderShift = 6;
    result.privateNarration = "You drag furniture with shaking hands and practical anger. The door is not safe, exactly, but it is no longer an invitation.";
    result.sharedBeat = `${player.name} buys time by changing the room before the panic arrives.`;
    result.patch.push("A local door is barricaded. Order improves in that area.");
    return result;
  }

  if (words("nurse", "doctor", "staff", "radio", "intercom", "call")) {
    world.flags.intercomWarning = true;
    result.stressDelta = 2;
    result.orderShift = 4;
    result.relationshipDelta["Nurse Sade"] = 1;
    result.privateNarration = "The first official voice you reach is too calm, which makes it worse. Behind it, someone is crying and someone else keeps repeating that bites should not bloom black veins.";
    result.privateKnowledge = "Bites are causing black-vein spread within minutes.";
    result.sharedBeat = `${player.name} pulls a warning out of the failing hospital channels.`;
    result.patch.push("Intercom warning unlocked. Staff trust rises.");
    return result;
  }

  if (words("exit", "stairs", "stairwell", "elevator", "escape", "atrium", "radiology")) {
    result.locationChange = words("radiology") ? "Mercy General - Radiology Hall" : "Mercy General - Main Atrium";
    result.energyDelta = -10;
    result.stressDelta = 8;
    result.panicShift = 5;
    result.rotShift = 3;
    result.privateNarration = "You step into the corridor and the hospital answers with too many directions. A visitor sprints past barefoot. An elevator opens on an empty gurney smeared with something dark and fungal.";
    result.privateKnowledge = "The main routes are filling with panic faster than they are filling with infected.";
    result.sharedBeat = `${player.name} reaches the corridor and sees Mercy General starting to break.`;
    result.patch.push("Corridor visibility gained. Panic increases.");
    return result;
  }

  if (words("search", "bag", "supplies", "medicine", "gloves", "mask", "tool")) {
    const found = player.archetype === "Medic" ? "sealed mask" : player.archetype === "Mechanic" ? "maintenance keycard" : "clean towel";
    result.inventoryAddBag = [found];
    result.energyDelta = -5;
    result.stressDelta = -1;
    result.privateNarration = `You search like a person, not a hero: shallow drawers, pockets, the floor under the chair. You find a ${found}, small enough to carry and useful enough to matter.`;
    result.sharedBeat = `${player.name} finds something useful before the room empties into panic.`;
    result.patch.push(`${player.name} gains ${found}.`);
    return result;
  }

  if (words("rot", "crystal", "magic", "sense", "vision", "pulse")) {
    world.flags.magicManifested = true;
    result.stressDelta = player.trait === "Iron Will" ? 8 : 14;
    result.infectionDelta = 1;
    result.rotShift = 7;
    result.privateNarration = "For one impossible moment, the fluorescent lights show roots inside the walls. Not wires. Roots. They pulse toward the ICU like the hospital has grown a second nervous system.";
    result.privateKnowledge = "The Rot is not only biological. It is moving through infrastructure.";
    result.sharedBeat = `${player.name} senses the first magical fracture under the hospital systems.`;
    result.patch.push("Magic manifestation unlocked. Rot pressure rises.");
    return result;
  }

  result.privateNarration = "You move because standing still has become its own kind of choice. The mundane shape of the day tears a little wider.";
  result.sharedBeat = `${player.name} acts through the confusion.`;
  result.patch.push("Tension rises without a clean answer yet.");
  return result;
}

async function callOpenAiGm(room, actors, localDraft) {
  const request = {
    roomId: room.code,
    style: "first-person-present, tense, intimate, survival horror, no explicit gore",
    worldState: room.world,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      location: player.location,
      routine: player.routine,
      emotionalBaggage: player.emotionalBaggage,
      personalNpc: player.personalNpc,
      stats: {
        health: player.health,
        energy: player.energy,
        stress: player.stress,
        hunger: player.hunger,
        thirst: player.thirst,
        injury: player.injury,
        infection: player.infection,
      },
      bodyItems: player.inventory.body,
      bagItems: player.inventory.bag,
    })),
    submittedActions: actors.map((player) => ({
      playerId: player.id,
      characterName: player.name,
      location: player.location,
      action: player.action,
      spokenWords: player.spokenWords,
    })),
    localRulesDraft: localDraft,
    requiredJsonShape: {
      sharedNarration: "string",
      playerResults: [
        {
          playerId: "string",
          privateNarration: "string",
          privateKnowledge: "string optional",
          statDeltas: { health: 0, energy: 0, stress: 0, hunger: 0, thirst: 0, injury: 0, infection: 0 },
          locationChange: "string optional",
          inventoryAddBody: ["string"],
          inventoryAddBag: ["string"],
          relationshipDelta: { npcName: 0 },
        },
      ],
      worldPatch: {
        panicShift: 0,
        rotShift: 0,
        orderShift: 0,
        moraleShift: 0,
        powerShift: 0,
        medicineShift: 0,
        patch: ["string"],
      },
    },
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      input: [
        {
          role: "system",
          content:
            "You are the AI GM for Rot 2041, a four-player fantasy zombie apocalypse RP. Absorb all player actions and current state. Preserve strict state fairness. Never mention hidden mechanics. Return only valid JSON matching the requested shape.",
        },
        {
          role: "user",
          content: JSON.stringify(request),
        },
      ],
      text: {
        format: {
          type: "json_object",
        },
      },
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI ${response.status}: ${message.slice(0, 180)}`);
  }
  const data = await response.json();
  const text =
    data.output_text ||
    data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI response did not include output text.");
  return normalizeAiTurn(JSON.parse(text), localDraft);
}

function normalizeAiTurn(ai, localDraft) {
  const results = {};
  for (const item of ai.playerResults || []) {
    results[item.playerId] = {
      privateNarration: clean(item.privateNarration, "", 1600),
      privateKnowledge: clean(item.privateKnowledge, "", 300),
      healthDelta: item.statDeltas?.health || 0,
      energyDelta: item.statDeltas?.energy || 0,
      stressDelta: item.statDeltas?.stress || 0,
      hungerDelta: item.statDeltas?.hunger || 0,
      thirstDelta: item.statDeltas?.thirst || 0,
      injuryDelta: item.statDeltas?.injury || 0,
      infectionDelta: item.statDeltas?.infection || 0,
      locationChange: clean(item.locationChange, "", 80),
      inventoryAddBody: Array.isArray(item.inventoryAddBody) ? item.inventoryAddBody.map((x) => clean(x, "", 50)).filter(Boolean) : [],
      inventoryAddBag: Array.isArray(item.inventoryAddBag) ? item.inventoryAddBag.map((x) => clean(x, "", 50)).filter(Boolean) : [],
      relationshipDelta: item.relationshipDelta || {},
    };
  }
  return {
    turnNumber: localDraft.turnNumber,
    sharedNarration: clean(ai.sharedNarration, localDraft.sharedNarration, 2400),
    privateResults: { ...localDraft.privateResults, ...results },
    worldPatch: {
      ...localDraft.worldPatch,
      ...(ai.worldPatch || {}),
      patch: Array.isArray(ai.worldPatch?.patch) ? ai.worldPatch.patch.map((x) => clean(x, "", 140)).filter(Boolean) : localDraft.worldPatch.patch,
    },
  };
}

function applyTurnResult(room, actors, result, gmTitle) {
  const world = room.world;
  for (const player of room.players) {
    const privateResult = result.privateResults[player.id];
    if (!privateResult) continue;
    applyPlayerResult(player, privateResult);
    room.log.push({
      id: randomUUID(),
      type: "private",
      playerId: player.id,
      title: `${player.name} - Private`,
      text: privateResult.privateNarration,
      turn: result.turnNumber,
      createdAt: Date.now(),
    });
    player.locked = false;
    player.action = "";
    player.spokenWords = "";
  }

  const patch = result.worldPatch || {};
  world.resources.panic = clamp(world.resources.panic + (patch.panicShift || 0), 0, 100);
  world.resources.rotPressure = clamp(world.resources.rotPressure + (patch.rotShift || 0), 0, 100);
  world.resources.order = clamp(world.resources.order + (patch.orderShift || 0), 0, 100);
  world.resources.morale = clamp(world.resources.morale + (patch.moraleShift || 0), 0, 100);
  world.resources.power = clamp(world.resources.power + (patch.powerShift || 0), 0, 100);
  world.resources.medicine = clamp(world.resources.medicine + (patch.medicineShift || 0), 0, 100);
  world.dangerLevel = getDangerLabel(world.resources.rotPressure, world.resources.panic);
  world.aiProvider = process.env.OPENAI_API_KEY ? "openai" : "local-fallback";
  world.turn += 1;
  world.currentTime = advanceTime(world.currentTime, 4 + actors.length);
  world.recentEvents = [...(patch.patch || []), result.sharedNarration, ...world.recentEvents].slice(0, 8);

  for (const player of room.players) player.options = buildOptions(player, world);

  room.log.push({
    id: randomUUID(),
    type: "shared",
    title: `${gmTitle} - Turn ${result.turnNumber}`,
    text: result.sharedNarration,
    turn: result.turnNumber,
    createdAt: Date.now(),
  });
}

function applyPlayerResult(player, result) {
  player.health = clamp(player.health + (result.healthDelta || 0), 0, 100);
  player.energy = clamp(player.energy + (result.energyDelta || 0), 0, 100);
  player.stress = clamp(player.stress + (result.stressDelta || 0), 0, 100);
  player.hunger = clamp(player.hunger + (result.hungerDelta || 0), 0, 100);
  player.thirst = clamp(player.thirst + (result.thirstDelta || 0), 0, 100);
  player.injury = clamp(player.injury + (result.injuryDelta || 0), 0, 100);
  player.infection = clamp(player.infection + (result.infectionDelta || 0), 0, 100);
  for (const item of result.inventoryAddBody || []) if (!player.inventory.body.includes(item)) player.inventory.body.push(item);
  for (const item of result.inventoryAddBag || []) if (!player.inventory.bag.includes(item)) player.inventory.bag.push(item);
  for (const [npc, delta] of Object.entries(result.relationshipDelta || {})) {
    player.relationships[npc] = (player.relationships[npc] || 0) + Number(delta || 0);
  }
  if (result.privateKnowledge) player.privateKnowledge.push(result.privateKnowledge);
  if (result.locationChange) player.location = result.locationChange;
  player.lastResult = result.privateNarration || player.lastResult;
}

function buildOptions(player, world) {
  const options = [
    { id: "protect-bond", label: `Protect ${player.personalNpc.name}`, risk: "medium", requirement: player.personalNpc.relation },
    { id: "call-staff", label: "Get a staff update", risk: "low", requirement: "Voice or radio" },
    { id: "search-room", label: "Search nearby supplies", risk: "low", requirement: "Time" },
    { id: "secure-door", label: "Secure the room", risk: "medium", requirement: "Furniture" },
    { id: "move-corridor", label: "Enter the corridor", risk: "high", requirement: "Line of sight" },
  ];
  if (world.flags.outbreakDeclared) {
    options.push({ id: "evacuate", label: "Find a safer route", risk: "high", requirement: "Crowd control" });
  }
  if (player.archetype === "Mystic" || player.trait === "Iron Will") {
    options.push({ id: "sense-rot", label: "Listen for the Rot pulse", risk: "high", requirement: "Willpower" });
  }
  options.push({ id: "custom", label: "Custom action", risk: "variable", requirement: "Your call" });
  return options.slice(0, 7);
}

function makeHospitalNarration(room, actors, sharedBeats) {
  const names = actors.map((player) => player.name).join(", ");
  const beats = sharedBeats.join(" ");
  if (room.world.flags.outbreakDeclared) {
    return `${names} move inside different fragments of the same disaster. ${beats} The hospital does not collapse all at once. It becomes personal first: one locked door, one missing loved one, one monitor screaming with no nurse close enough to answer.`;
  }
  return `${names} move before the word outbreak exists. ${beats} A normal afternoon begins to tilt, and everyone feels it before anyone can explain it.`;
}

function getDangerLabel(rotPressure, panic) {
  const score = Math.max(rotPressure, panic);
  if (score >= 80) return "critical";
  if (score >= 55) return "high";
  if (score >= 28) return "medium";
  return "low";
}

function advanceTime(value, minutes) {
  const [datePart, timePart] = value.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute + minutes));
  const pad = (input) => String(input).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function encodeFrame(payload) {
  const data = Buffer.from(payload);
  const length = data.length;
  if (length <= 125) return Buffer.concat([Buffer.from([0x81, length]), data]);
  if (length <= 65535) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, data]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, data]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  let mask;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.slice(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.slice(offset, offset + length));
  if (masked) {
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  }
  return { opcode, data: payload.toString("utf8"), rest: buffer.slice(offset + length) };
}

function sendJson(client, payload) {
  if (!client.socket.destroyed) client.socket.write(encodeFrame(JSON.stringify(payload)));
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      ok: true,
      rooms: rooms.size,
      aiProvider: process.env.OPENAI_API_KEY ? "openai" : "local-fallback",
      openaiModel,
      liveblocksConfigured: Boolean(process.env.LIVEBLOCKS_PUBLIC_KEY),
    }));
    return;
  }
  if (url.pathname === "/config") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      aiProvider: process.env.OPENAI_API_KEY ? "openai" : "local-fallback",
      openaiModel,
      liveblocksPublicKeyPresent: Boolean(process.env.LIVEBLOCKS_PUBLIC_KEY),
    }));
    return;
  }

  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(publicDir, decodeURIComponent(requestPath)));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    readFile(filePath, (error, body) => {
      if (error) {
        res.writeHead(500);
        res.end(error.message);
        return;
      }
      res.writeHead(200, { "content-type": mimeTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream" });
      res.end(body);
    });
  } catch (error) {
    res.writeHead(500);
    res.end(error.message);
  }
}

function createAppServer() {
  const server = createServer(serveStatic);
  server.on("upgrade", (req, socket) => {
    if (req.headers.upgrade?.toLowerCase() !== "websocket") return socket.destroy();
    const key = req.headers["sec-websocket-key"];
    if (!key) return socket.destroy();
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "", ""].join("\r\n"));
    const client = { id: randomUUID(), socket, buffer: Buffer.alloc(0), roomCode: "", playerId: "" };
    clients.add(client);
    socket.on("data", (chunk) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      while (client.buffer.length > 0) {
        const frame = decodeFrame(client.buffer);
        if (!frame) break;
        client.buffer = frame.rest;
        if (frame.opcode === 0x8) {
          socket.end();
          break;
        }
        if (frame.opcode === 0x1) handleMessage(client, frame.data).catch((error) => sendError(client, error.message));
      }
    });
    socket.on("close", () => {
      clients.delete(client);
      const room = rooms.get(client.roomCode);
      const player = room?.players.find((item) => item.id === client.playerId);
      if (player) {
        player.connected = false;
        player.lastSeen = Date.now();
        broadcastRoom(room);
      }
    });
    socket.on("error", () => socket.destroy());
  });
  return server;
}

function listenOnAvailablePort(port) {
  const server = createAppServer();
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && port < startPort + 20) return listenOnAvailablePort(port + 1);
    console.error(error);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(`Rot 2041 multiplayer prototype running at http://localhost:${port}`);
  });
}

listenOnAvailablePort(startPort);
