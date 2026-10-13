/* =========================================
   LOUP-GAROU V7
   SERVER.JS
========================================= */

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
const { Pool } = require("pg");


/* =========================================
   CONFIGURATION
========================================= */

const app = express();

const server = http.createServer(app);

const io = new Server(server);

const PORT = process.env.PORT || 3000;

const ADMIN_PSEUDO =
  (process.env.ADMIN_PSEUDO || "creator2026")
    .toLowerCase();

function getAdminRoleForUser(user){
  if(!user) return "none";
  if(normalizePseudo(user.pseudo)===ADMIN_PSEUDO) return "full";
  return user.adminRole === "reduced" ? "reduced" : "none";
}
function getAdminRoleFromPseudo(pseudo){ return getAdminRoleForUser(findUser(pseudo)); }
function isFullAdminPseudo(pseudo){ return normalizePseudo(pseudo)===ADMIN_PSEUDO; }
function isAnyAdminPseudo(pseudo){ return getAdminRoleFromPseudo(pseudo)!=="none"; }
function requireFullAdmin(req,res){ if(!isFullAdminPseudo(req.body?.adminPseudo ?? req.query?.adminPseudo)) { res.status(403).json({message:"Accès réservé à l'administrateur principal."}); return false; } return true; }
function requireAdminPanel(req,res){ if(!isAnyAdminPseudo(req.body?.adminPseudo ?? req.query?.adminPseudo)) { res.status(403).json({message:"Accès réservé aux administrateurs."}); return false; } return true; }

// Stockage persistant : sur Render, définissez DATA_DIR=/data sur le disque persistant.
// Render Free n'autorise pas l'écriture dans /data sans disque persistant.
// Par défaut, on utilise le dossier de l'application pour que le serveur démarre.
// Pour un stockage persistant plus tard : DATA_DIR=/var/data.
let DATA_DIR = process.env.DATA_DIR || "";
if (!DATA_DIR) {
  // Render/production : si un dossier persistant est monté, on le préfère.
  // Sinon on retombe sur le dossier de l'application pour rester compatible.
  const persistentCandidates = ["/var/data", "/data"];
  DATA_DIR = persistentCandidates.find(dir => {
    try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return true; } catch (_) { return false; }
  }) || __dirname;
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, "data.json");

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, "public"),
    { index: false }
  )
);

// Site officiel servi par le même serveur que le jeu.
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "site", "index.html")));
app.get("/jeu", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use("/site", express.static(path.join(__dirname, "site")));


/* =========================================
   BASE DE DONNÉES — V25
   PostgreSQL externe + fallback JSON local
========================================= */

function defaultDatabase() {
  return {
    users: [],
    rooms: [],
    friendships: [],
    friendRequests: [],
    messages: [],
    notifications: [],
    announcements: {
      text: "Bienvenue dans Loup-Garou V7 🐺"
    },
    comments: [],
    bloodMoonProgress: {},
    bloodMoonManualUntil: 0,
    halloweenEvent: { active: false, week: 0, startedAt: 0, endsAt: 0 },
    halloweenCandyClearedAt: 0,
    halloweenShopSeason: 0,
    v26Release: { active: true, version: 26, updatedAt: Date.now() },
    classDiscount: { percent: 0, until: 0 },
    personalEvents: {},
    promoCodes: {},
    maintenance: { active: false, startedAt: 0, endsAt: 0, durationMinutes: 0 },
    recoveryRequests: [],
    updateHistory: [
      { id: "v031", version: "0.31", date: "2026-10-01", features: "Identifiants uniques, récupération de compte, maintenance corrigée, codes cadeau, événements Halloween et Géant de pierre." }
    ],
    halloweenChallenge: { games: 0, target: 100, completed: 0, lastRewardAt: 0 },
    bloodMoonTitleHistory: [],
    bloodMoonWeekTitles: {},
    globalBoosts: {
      coins: { multiplier: 1, until: 0 },
      xp: { multiplier: 1, until: 0 },
      trophies: { multiplier: 1, until: 0 }
    }
  };
}

function mergeDatabase(database) {
  const merged = { ...defaultDatabase(), ...(database || {}) };
  merged.announcements = { ...defaultDatabase().announcements, ...(database?.announcements || {}) };
  merged.globalBoosts = { ...defaultDatabase().globalBoosts, ...(database?.globalBoosts || {}) };
  merged.halloweenEvent = { ...defaultDatabase().halloweenEvent, ...(database?.halloweenEvent || {}) };
  merged.v26Release = { ...defaultDatabase().v26Release, ...(database?.v26Release || {}) };
  merged.classDiscount = { ...defaultDatabase().classDiscount, ...(database?.classDiscount || {}) };
  merged.personalEvents = (database?.personalEvents && typeof database.personalEvents === "object") ? database.personalEvents : {};
  merged.promoCodes = (database?.promoCodes && typeof database.promoCodes === "object") ? database.promoCodes : {};
  merged.maintenance = { ...defaultDatabase().maintenance, ...(database?.maintenance || {}) };
  merged.maintenance.active = Boolean(database?.maintenance?.active);
  merged.maintenance.startedAt = Number(database?.maintenance?.startedAt || 0);
  merged.maintenance.endsAt = Number(database?.maintenance?.endsAt || 0);
  merged.maintenance.durationMinutes = Number(database?.maintenance?.durationMinutes || 0);
  merged.recoveryRequests = Array.isArray(database?.recoveryRequests) ? database.recoveryRequests : [];
  merged.updateHistory = Array.isArray(database?.updateHistory) ? database.updateHistory : defaultDatabase().updateHistory;
  merged.halloweenChallenge = { ...defaultDatabase().halloweenChallenge, ...(database?.halloweenChallenge || {}) };
  merged.halloweenChallenge.games = Math.max(0, Number(merged.halloweenChallenge.games || 0));
  merged.halloweenChallenge.target = 100;
  merged.halloweenChallenge.completed = Math.max(0, Number(merged.halloweenChallenge.completed || 0));
  merged.bloodMoonTitleHistory = Array.isArray(database?.bloodMoonTitleHistory) ? database.bloodMoonTitleHistory : [];
  merged.bloodMoonWeekTitles = (database?.bloodMoonWeekTitles && typeof database.bloodMoonWeekTitles === "object") ? database.bloodMoonWeekTitles : {};
  merged.halloweenCandyClearedAt = Number(database?.halloweenCandyClearedAt || 0);
  merged.halloweenShopSeason = Number(database?.halloweenShopSeason || 0);
  ["coins", "xp", "trophies"].forEach(type => {
    merged.globalBoosts[type] = {
      multiplier: Number(database?.globalBoosts?.[type]?.multiplier || 1),
      until: Number(database?.globalBoosts?.[type]?.until || 0)
    };
  });
  merged.users = Array.isArray(merged.users) ? merged.users : [];
  merged.rooms = Array.isArray(merged.rooms) ? merged.rooms : [];
  merged.friendships = Array.isArray(merged.friendships) ? merged.friendships : [];
  merged.friendRequests = Array.isArray(merged.friendRequests) ? merged.friendRequests : [];
  merged.comments = Array.isArray(merged.comments) ? merged.comments : [];
  merged.messages = Array.isArray(merged.messages) ? merged.messages : [];
  merged.notifications = Array.isArray(merged.notifications) ? merged.notifications : [];
  return merged;
}

function loadLocalDatabase() {
  const candidates = [DATA_FILE, `${DATA_FILE}.bak`];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, "utf8");
      if (!content.trim()) continue;
      const database = JSON.parse(content);
      if (!database || !Array.isArray(database.users)) continue;
      if (file !== DATA_FILE) {
        console.warn("⚠️ data.json restauré depuis la sauvegarde .bak");
        try { fs.copyFileSync(file, DATA_FILE); } catch (_) {}
      }
      return mergeDatabase(database);
    } catch (error) {
      console.error(`Erreur chargement ${file} :`, error.message);
    }
  }
  return mergeDatabase(defaultDatabase());
}

let db = loadLocalDatabase();
// V26 est désormais intégrée définitivement à la version 0.31.
db.v26Release = { active: true, version: 26, updatedAt: Number(db.v26Release?.updatedAt || Date.now()) };
let externalDbReady = false;
let externalDbPromise = null;
let saveQueue = Promise.resolve();
let pgPool = null;

if (process.env.DATABASE_URL) {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
}

function clearHalloweenCandy(reason="Événement Halloween inactif") {
  let changed=false;
  (db.users||[]).forEach(user=>{
    if(Number(user.halloweenCandy||0)!==0){ user.halloweenCandy=0; changed=true; }
  });
  if(changed) console.log(`[Halloween] ${reason} : bonbons réinitialisés pour tous les joueurs.`);
  db.halloweenCandyClearedAt=Date.now();
  return changed;
}
function expireHalloweenIfNeeded() {
  const e=db.halloweenEvent||{}, now=Date.now();
  if(!e.active || ![1,2,3,4].includes(Number(e.week)) || Number(e.endsAt||0)>now) return false;
  db.halloweenEvent={...e,active:false};
  clearHalloweenCandy("Semaine Halloween terminée");
  saveDatabase();
  return true;
}
function getHalloweenStatus() {
  expireHalloweenIfNeeded();
  const e=db.halloweenEvent||{}, now=Date.now();
  const active=Boolean(e.active)&&[1,2,3,4].includes(Number(e.week))&&Number(e.endsAt)>now;
  // Sécurité : aucune monnaie Halloween ne doit rester utilisable hors événement.
  if(!active && (db.users||[]).some(u=>Number(u.halloweenCandy||0)!==0)){
    clearHalloweenCandy();
    saveDatabase();
  }
  return {active,week:Number(e.week||0),startedAt:Number(e.startedAt||0),endsAt:active?Number(e.endsAt):null};
}
function startHalloweenWeek(week){const w=Number(week);if(![1,2,3,4].includes(w))throw new Error('Semaine Halloween invalide.');const startedAt=Date.now();db.halloweenEvent={active:true,week:w,startedAt,endsAt:startedAt+7*24*60*60*1000};saveDatabase();const status=getHalloweenStatus();io.emit('halloweenStatusChanged',status);return status;}
function stopHalloweenEvent(){const e=db.halloweenEvent||{};db.halloweenEvent={active:false,week:Number(e.week||0),startedAt:Number(e.startedAt||0),endsAt:Number(e.endsAt||0)};clearHalloweenCandy("Arrêt manuel");saveDatabase();const status=getHalloweenStatus();io.emit('halloweenStatusChanged',status);return status;}
setInterval(()=>{ if(expireHalloweenIfNeeded()){ io.emit('halloweenStatusChanged',getHalloweenStatus()); } },60000);
setInterval(()=>{ const wasActive=Boolean(db.maintenance?.active); const status=getMaintenanceStatus(); if(wasActive&&!status.active) io.emit("maintenanceStatusChanged",status); },1000);
function isV26Released(){ return Boolean(db.v26Release?.active && Number(db.v26Release?.version||0)>=26); }
function getClassDiscountPercent(){ const d=db.classDiscount||{}; return Number(d.until||0)>Date.now()?Math.max(0,Math.min(90,Number(d.percent||0))):0; }
function getClassPrice(classe,user=null){ const pct=Math.max(getClassDiscountPercent(),getPersonalDiscountPercent(user)); return Math.max(0,Math.floor(Number(classe?.price||0)*(1-pct/100))); }
function getPublicClasses(){ return CLASSES.filter(c=>c.id!=="pumpkin1" || getHalloweenStatus().active); }
function releaseV26(){ db.v26Release={active:true,version:26,updatedAt:Date.now()}; saveDatabase(); const payload={...db.v26Release}; io.emit("v26Released",payload); return payload; }
function setClassDiscount(percent,durationMinutes){ const pct=Math.max(0,Math.min(90,Number(percent||0))); db.classDiscount=pct?{percent:pct,until:Date.now()+Math.max(1,Math.min(1440,Number(durationMinutes||10)))*60000}:{percent:0,until:0}; saveDatabase(); const out={percent:getClassDiscountPercent(),until:db.classDiscount.until}; io.emit("classDiscountUpdated",out); return out; }
function getPersonalEventDefinitions(){ return [
  {id:"halloween",name:"🎃 Halloween",description:"Événement Halloween individuel."},
  {id:"bloodmoon",name:"🌕 Lune de Sang",description:"Événement Lune de Sang individuel."},
  {id:"double_coins",name:"🪙 x2 Pièces",description:"Double les pièces gagnées pendant 10 minutes."},
  {id:"double_xp",name:"✨ x2 XP",description:"Double l'XP gagnée pendant 10 minutes."},
  {id:"double_trophies",name:"🏆 x2 Trophées",description:"Double les trophées gagnés pendant 10 minutes."},
  {id:"discount_10",name:"🎟️ Réduction classes -10%",description:"Réduction personnelle de 10% sur les classes."},
  {id:"discount_25",name:"🎟️ Réduction classes -25%",description:"Réduction personnelle de 25% sur les classes."},
  {id:"discount_50",name:"🎟️ Réduction classes -50%",description:"Réduction personnelle de 50% sur les classes."},
  {id:"discount_75",name:"🎟️ Réduction classes -75%",description:"Réduction personnelle de 75% sur les classes."}
]; }
function ensurePersonalEvents(user){
  ensureUserState(user);
  user.personalEvents = user.personalEvents && typeof user.personalEvents === "object" ? user.personalEvents : {};
  const now=Date.now();
  Object.keys(user.personalEvents).forEach(id=>{ if(Number(user.personalEvents[id]?.until||0)<=now) delete user.personalEvents[id]; });
  return user.personalEvents;
}
function getPersonalEvent(user,id){
  if(!user)return null;
  const ev=ensurePersonalEvents(user)[id];
  if(!ev || Number(ev.until||0)<=Date.now()) return null;
  return ev;
}
function getActivePersonalMultiplier(user,type){
  const map={coins:"double_coins",xp:"double_xp",trophies:"double_trophies"};
  const ev=getPersonalEvent(user,map[type]);
  return ev?2:1;
}
function getPersonalDiscountPercent(user){
  const events=ensurePersonalEvents(user), now=Date.now();
  const vals=[75,50,25,10].filter(p=>{const ev=events[`discount_${p}`];return ev&&Number(ev.until||0)>now;});
  return vals.length?vals[0]:0;
}
function publicPersonalEvents(user){
  const events=ensurePersonalEvents(user), defs=getPersonalEventDefinitions(), now=Date.now();
  return defs.map(d=>{const ev=events[d.id]; return ev&&Number(ev.until||0)>now?{...d,until:Number(ev.until)}:null;}).filter(Boolean);
}

function normalizeLoadedUsers() {
  db.globalBoosts = db.globalBoosts || {};
  ["coins","xp","trophies"].forEach(type => {
    db.globalBoosts[type] = db.globalBoosts[type] || { multiplier: 1, until: 0 };
    db.globalBoosts[type].multiplier = Number(db.globalBoosts[type].multiplier || 1);
    db.globalBoosts[type].until = Number(db.globalBoosts[type].until || 0);
  });
  db.users.forEach(ensureUserState);
}

async function initializeExternalDatabase() {
  if (!pgPool) {
    normalizeLoadedUsers();
    console.warn("⚠️ DATABASE_URL n'est pas défini : V25 utilise le stockage JSON local. Pour une vraie persistance externe, ajoutez DATABASE_URL dans Render.");
    return;
  }

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS loup_garou_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const result = await pgPool.query("SELECT data FROM loup_garou_state WHERE id = 1");
  if (result.rows.length) {
    db = mergeDatabase(result.rows[0].data);
    // La V26 est incluse directement dans cette version : aucune activation manuelle.
    db.v26Release = { active: true, version: 26, updatedAt: Number(db.v26Release?.updatedAt || Date.now()) };
    console.log("✅ Base PostgreSQL externe chargée.");
  } else {
    // Première installation : si un ancien data.json existe, on le migre automatiquement.
    db = loadLocalDatabase();
    await pgPool.query(
      `INSERT INTO loup_garou_state (id, data) VALUES (1, $1::jsonb)`,
      [JSON.stringify(db)]
    );
    console.log("✅ Base PostgreSQL créée et données locales migrées.");
  }

  normalizeLoadedUsers();
  externalDbReady = true;
  // Persiste l’activation intégrée de la V26 dans PostgreSQL.
  saveDatabase();
}

function saveDatabase() {
  if (!externalDbReady || !pgPool) {
    // Développement/local : conserver le fallback JSON.
    if (!pgPool) {
      try {
        const tempFile = `${DATA_FILE}.tmp`;
        const json = JSON.stringify(db, null, 2);
        fs.writeFileSync(tempFile, json, "utf8");
        fs.renameSync(tempFile, DATA_FILE);
        try { fs.writeFileSync(`${DATA_FILE}.bak`, json, "utf8"); } catch (_) {}
      } catch (error) {
        console.error("Erreur sauvegarde locale :", error.message);
      }
    }
    return Promise.resolve();
  }

  // Une file d'écriture évite que plusieurs sauvegardes concurrentes se marchent dessus.
  const snapshot = JSON.parse(JSON.stringify(db));
  saveQueue = saveQueue
    .then(() => pgPool.query(
      `INSERT INTO loup_garou_state (id, data, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [JSON.stringify(snapshot)]
    ))
    .catch(error => console.error("❌ Erreur sauvegarde PostgreSQL :", error.message));
  return saveQueue;
}

/* =========================================
   OUTILS
========================================= */

function normalizePseudo(pseudo) {
  return String(
    pseudo || ""
  )
    .trim()
    .toLowerCase();
}

function cleanPseudo(pseudo) {
  return String(
    pseudo || ""
  ).trim();
}

function findUser(pseudo) {
  const normalized =
    normalizePseudo(pseudo);

  return db.users.find(
    (user) =>
      normalizePseudo(user.pseudo) ===
      normalized
  );
}

function getHalloweenStatusForPublic() {
  const e = db.halloweenEvent || {};
  return Boolean(e.active && [1,2,3,4].includes(Number(e.week)) && Number(e.endsAt || 0) > Date.now());
}

function publicUser(user) {
  if (!user) return null;

  const {
    password,
    ...safeUser
  } = user;

  // Les bonbons sont une monnaie temporaire : ils ne sont jamais exposés hors Halloween.
  if (!getHalloweenStatusForPublic() && !getPersonalEvent(user,"halloween")) safeUser.halloweenCandy = 0;
  safeUser.personalEvents = publicPersonalEvents(user);
  safeUser.identifier = `LG-${String(user.id || "").toUpperCase()}`;
  safeUser.adminRole = getAdminRoleForUser(user);
  return safeUser;
}

function userIdentifier(user){ return `LG-${String(user?.id || "").toUpperCase()}`; }
function findUserByIdentifier(identifier){
  const raw=String(identifier||"").trim().toUpperCase();
  if(!raw) return null;
  const id=raw.startsWith("LG-") ? raw.slice(3) : raw;
  return db.users.find(u=>String(u.id||"").toUpperCase()===id) || null;
}

function generateCode() {
  const characters =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code = "";

  for (
    let index = 0;
    index < 6;
    index++
  ) {
    code +=
      characters[
        Math.floor(
          Math.random() *
          characters.length
        )
      ];
  }

  return code;
}

function createUniqueRoomCode() {
  let code = generateCode();

  while (
    db.rooms.some(
      (room) => room.code === code
    )
  ) {
    code = generateCode();
  }

  return code;
}

function createId() {
  return (
    Date.now()
      .toString(36) +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );
}


/* =========================================
   CLASSES
========================================= */

const CLASSES = [

  {
    id: "wolf1",
    name: "Loup débutant",
    price: 0,
    chance: 10
  },

  {
    id: "wolf2",
    name: "Loup confirmé",
    price: 300,
    chance: 20
  },

  {
    id: "seer1",
    name: "Voyante",
    price: 500,
    chance: 25
  },

  {
    id: "witch1",
    name: "Sorcière",
    price: 750,
    chance: 30
  },

  {
    id: "cupid1",
    name: "Cupidon",
    price: 900,
    chance: 30
  },

  {
    id: "pumpkin1",
    name: "Citrouille",
    price: 1200,
    chance: 30,
    temporary: true,
    event: "halloween"
  },

  {
    id: "premium1",
    name: "Premium 1",
    price: 2000,
    chance: 60
  },

  {
    id: "premium2",
    name: "Premium 2",
    price: 2500,
    chance: 70
  },

  {
    id: "premium3",
    name: "Premium 3",
    price: 3000,
    chance: 75
  },

  {
    id: "premium_certified",
    name: "Premium certifié",
    price: 3500,
    chance: 80
  },

  {
    id: "admin1",
    name: "Admin 1",
    price: 5000,
    chance: 85
  },

  {
    id: "admin2",
    name: "Admin 2",
    price: 6000,
    chance: 90
  },

  {
    id: "admin3",
    name: "Admin 3",
    price: 7000,
    chance: 95
  },

  {
    id: "admin_certified",
    name: "Admin certifié",
    price: 10000,
    chance: 99
  }
];


/* =========================================
   QUÊTES NORMALES
========================================= */

const QUESTS = [
  { id:"play_1", title:"Premier hurlement", description:"Joue 1 partie.", target:1, stat:"gamesPlayed", xp:50, coins:25 },
  { id:"play_3", title:"Villageois actif", description:"Joue 3 parties.", target:3, stat:"gamesPlayed", xp:100, coins:50 },
  { id:"play_5", title:"Nuit agitée", description:"Joue 5 parties.", target:5, stat:"gamesPlayed", xp:150, coins:75 },
  { id:"play_10", title:"Chasseur de loups", description:"Joue 10 parties.", target:10, stat:"gamesPlayed", xp:300, coins:150 },
  { id:"play_25", title:"Habitué du village", description:"Joue 25 parties.", target:25, stat:"gamesPlayed", xp:600, coins:300 },
  { id:"play_50", title:"Maître du village", description:"Joue 50 parties.", target:50, stat:"gamesPlayed", xp:1200, coins:600 },
  { id:"win_1", title:"Première victoire", description:"Gagne 1 partie.", target:1, stat:"gamesWon", xp:100, coins:100 },
  { id:"win_3", title:"Héros du village", description:"Gagne 3 parties.", target:3, stat:"gamesWon", xp:250, coins:150 },
  { id:"win_10", title:"Légende", description:"Gagne 10 parties.", target:10, stat:"gamesWon", xp:1000, coins:500 },
  { id:"win_25", title:"Terreur du village", description:"Gagne 25 parties.", target:25, stat:"gamesWon", xp:2000, coins:1000 },
  { id:"social_1", title:"Bienvenue au village", description:"Ajoute 1 ami.", target:1, stat:"friendsAdded", xp:50, coins:25 },
  { id:"social_5", title:"Village soudé", description:"Aie 5 amis.", target:5, stat:"friendsCount", xp:150, coins:100 },
  { id:"ranked_1", title:"Premier combat classé", description:"Joue 1 partie classée.", target:1, stat:"rankedPlayed", xp:150, coins:75 },
  { id:"ranked_5", title:"Combattant classé", description:"Joue 5 parties classées.", target:5, stat:"rankedPlayed", xp:500, coins:250 },
  { id:"ranked_win_1", title:"Première victoire classée", description:"Gagne 1 partie classée.", target:1, stat:"rankedWon", xp:250, coins:150 },
  { id:"ranked_win_5", title:"Champion classé", description:"Gagne 5 parties classées.", target:5, stat:"rankedWon", xp:750, coins:400 },
  { id:"wolf_win_1", title:"Premier hurlement", description:"Gagne une partie dans le camp des Loups-Garous.", target:1, stat:"wolfWins", xp:200, coins:150 },
  { id:"special_1", title:"Pouvoir spécial", description:"Joue 1 partie avec un rôle spécial.", target:1, stat:"specialRoles", xp:100, coins:75 },
  { id:"special_5", title:"Maître des pouvoirs", description:"Joue 5 parties avec un rôle spécial.", target:5, stat:"specialRoles", xp:400, coins:250 },
  { id:"survive_1", title:"Dernier souffle", description:"Gagne 1 partie en étant vivant à la fin.", target:1, stat:"survivals", xp:250, coins:150 },
  { id:"trophy_100", title:"Premiers trophées", description:"Atteins 100 trophées.", target:100, stat:"trophies", xp:200, coins:150 },
  { id:"trophy_500", title:"Collectionneur", description:"Atteins 500 trophées.", target:500, stat:"trophies", xp:500, coins:350 },
  { id:"level_5", title:"Montée en puissance", description:"Atteins le niveau 5.", target:5, stat:"level", xp:300, coins:200 },
  { id:"level_10", title:"Vétéran", description:"Atteins le niveau 10.", target:10, stat:"level", xp:750, coins:500 }
];


/* =========================================
   QUÊTES LUNE DE SANG
========================================= */

const BLOOD_MOON_QUESTS = [
 {id:"bloodmoon_play",title:"Sous la Lune de Sang",description:"Participe à 1 partie pendant l'événement.",target:1,stat:"bloodPlayed",bloodMoonQuarters:1},
 {id:"bloodmoon_win",title:"Victoire sanglante",description:"Gagne 1 partie pendant l'événement.",target:1,stat:"bloodWon",bloodMoonQuarters:1},
 {id:"bloodmoon_ranked",title:"Chasseur écarlate",description:"Joue 1 partie classée pendant l'événement.",target:1,stat:"bloodRanked",bloodMoonQuarters:1},
 {id:"bloodmoon_five",title:"Nuit rouge",description:"Joue 5 parties pendant l'événement.",target:5,stat:"bloodPlayed",bloodMoonQuarters:1}
];


/* =========================================
   LUNE DE SANG
   Vendredi 07:00 -> 20:00
========================================= */

function getParisDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone:"Europe/Paris", weekday:"short", hour:"2-digit", minute:"2-digit", hour12:false }).formatToParts(date);
  const get=(type)=>parts.find(p=>p.type===type)?.value||"";
  const weekdays={lun:1,mar:2,mer:3,jeu:4,ven:5,sam:6,dim:0};
  return {day:weekdays[get("weekday").toLowerCase().replace(".","")] ?? new Date(date).getDay(),hour:Number(get("hour")),minute:Number(get("minute"))};
}
function getBloodMoonWeekKey(date = new Date()) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const y=Number(parts.find(p=>p.type==="year")?.value),m=Number(parts.find(p=>p.type==="month")?.value),d=Number(parts.find(p=>p.type==="day")?.value);
  const base=new Date(Date.UTC(y,m-1,d)); const day=base.getUTCDay(); base.setUTCDate(base.getUTCDate()-((day+2)%7)); return base.toISOString().slice(0,10);
}
const BLOOD_MOON_TITLES=[
  "Loup écarlate","Sang de la nuit","Croissant maudit","Gardien lunaire","Hurlement rouge","Marcheur lunaire","Furie écarlate","Seigneur de la Lune",
  "Griffe carmin","Veilleur écarlate","Ombre sanguine","Roi du croissant","Traqueur rouge","Lune maudite","Hurleur nocturne","Sentinelle du sang",
  "Loup de rubis","Éclat lunaire","Prédateur écarlate","Oracle de sang","Rôdeur de la lune","Cœur carmin","Faucheur nocturne","Prince écarlate",
  "Gardien carmin","Chasseur de lune","Flamme sanguine","Maître du croissant","Hurlement de rubis","Éclipse rouge","Veilleur nocturne","Seigneur carmin",
  "Lune ardente","Loup de l'éclipse","Traqueur carmin","Sang de rubis","Gardien rouge","Rôdeur écarlate","Croissant de sang","Furie lunaire",
  "Chasseur carmin","Ombre du croissant","Hurleur de rubis","Sentinelle rouge","Loup nocturne","Éclipse carmine","Maître lunaire","Griffe de sang",
  "Veilleur de rubis","Seigneur écarlate","Traqueur lunaire","Gardien de l'éclipse"
];
function getWeeklyBloodMoonTitle(weekKey){
  const key=String(weekKey);
  db.bloodMoonWeekTitles=db.bloodMoonWeekTitles||{};
  if(db.bloodMoonWeekTitles[key]) return db.bloodMoonWeekTitles[key];
  db.bloodMoonTitleHistory=Array.isArray(db.bloodMoonTitleHistory)?db.bloodMoonTitleHistory:[];
  const used=new Set(db.bloodMoonTitleHistory);
  const available=BLOOD_MOON_TITLES.filter(t=>!used.has(t));
  let n=0; for(const c of key)n=(n*31+c.charCodeAt(0))>>>0;
  const pool=available.length?available:BLOOD_MOON_TITLES;
  const title=pool[n%pool.length];
  db.bloodMoonWeekTitles[key]=title;
  if(!db.bloodMoonTitleHistory.includes(title)) db.bloodMoonTitleHistory.push(title);
  saveDatabase();
  return title;
}
function getBloodMoonStatus(){
  const now=new Date(),p=getParisDateParts(now);
  const manualActive = Number(db.bloodMoonManualUntil || 0) > Date.now();
  const scheduledActive = p.day===5 && (p.hour>7 || (p.hour===7&&p.minute>=0)) && p.hour<20;
  const active = manualActive || scheduledActive;
  let endsAt=null;
  if(manualActive){
    endsAt=Number(db.bloodMoonManualUntil);
  } else if(scheduledActive){
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
    const date=`${parts.find(x=>x.type==="year").value}-${parts.find(x=>x.type==="month").value}-${parts.find(x=>x.type==="day").value}`;
    const tzParts=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Paris",timeZoneName:"shortOffset",hour:"2-digit"}).formatToParts(new Date(`${date}T20:00:00Z`));
    const offsetText=tzParts.find(x=>x.type==="timeZoneName")?.value||"GMT+1";
    const match=offsetText.match(/GMT([+-])(\d+)(?::(\d+))?/);
    const offsetMinutes=match?(Number(match[2])*60+(Number(match[3]||0)))*(match[1]==="-"?-1:1):60;
    endsAt=Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7))-1,Number(date.slice(8,10)),20,0,0)-offsetMinutes*60000;
    if(Number.isNaN(endsAt))endsAt=Date.now()+((20-p.hour)*60-p.minute)*60000;
  }
  const weekKey=getBloodMoonWeekKey(now),progress=db.bloodMoonProgress?.[weekKey]||{};
  return {active,endsAt,weekKey,quarters:Math.min(4,Number(progress.quarters||0)),title:progress.title||getWeeklyBloodMoonTitle(weekKey)};
}


/* =========================================
   RANGS CLASSÉS
========================================= */

function getRank(trophies) {
  const score =
    Number(trophies || 0);

  if (score >= 5000) {
    return "Admin";
  }

  if (score >= 3000) {
    return "Pro";
  }

  if (score >= 1800) {
    return "Chasseur";
  }

  if (score >= 1000) {
    return "Diamant";
  }

  if (score >= 500) {
    return "Or";
  }

  if (score >= 200) {
    return "Bronze";
  }

  return "Bois";
}

function getRankIcon(rank) {
  const icons = {
    Bois: "🪵",
    Bronze: "🥉",
    Or: "🥇",
    Diamant: "💎",
    Chasseur: "🏹",
    Pro: "⭐",
    Admin: "👑"
  };

  return icons[rank] || "🪵";
}


/* =========================================
   NIVEAUX
========================================= */

function updateLevel(user) {
  if (!user) return;

  const xp =
    Number(user.xp || 0);

  user.level =
    Math.max(
      1,
      Math.floor(xp / 500) + 1
    );
}


/* =========================================
   NOTIFICATIONS
========================================= */

const NOTIFICATION_TTL = 30 * 1000;

function purgeExpiredNotifications() {
  const cutoff = Date.now() - NOTIFICATION_TTL;
  db.notifications = (db.notifications || []).filter(n => Number(n.createdAt || 0) > cutoff);
}

function addNotification(
  pseudo,
  notification
) {
  purgeExpiredNotifications();
  const user = findUser(pseudo);

  if (!user) return;

  const item = {
    id: createId(),

    pseudo: user.pseudo,

    title:
      notification.title ||
      "Notification",

    message:
      notification.message ||
      "",

    type:
      notification.type ||
      "info",

    reward:
      notification.reward ||
      null,

    action:
      notification.action ||
      null,

    claimed:
      false,

    createdAt:
      Date.now()
  };

  db.notifications.push(item);

  saveDatabase();

  const socketId =
    onlineUsers.get(
      normalizePseudo(user.pseudo)
    );

  if (socketId) {
    io.to(socketId).emit(
      "notification",
      item
    );
  }

  return item;
}


/* =========================================
   RÉCOMPENSES
========================================= */

function rewardDescription(reward = {}) {
  const parts = [];
  const coins = Number(reward.coins || 0);
  const xp = Number(reward.xp || 0);
  const trophies = Number(reward.trophies || 0);
  const halloweenCandy = Math.max(0, Number(reward.halloweenCandy || 0));
  if (coins > 0) parts.push(`${coins} pièce${coins > 1 ? "s" : ""} 🪙`);
  if (xp > 0) parts.push(`${xp} XP ✨`);
  if (trophies > 0) parts.push(`${trophies} trophée${trophies > 1 ? "s" : ""} 🏆`);
  if (halloweenCandy > 0) parts.push(`${halloweenCandy} bonbon${halloweenCandy > 1 ? "s" : ""} 🍬`);
  if (reward.classId) {
    const classe = CLASSES.find(c => c.id === reward.classId);
    if (classe) parts.push(`la classe ${classe.name} 🐺`);
  }
  return parts.length ? parts.join(" + ") : "une récompense";
}

function applyReward(
  user,
  reward
) {
  if (!user) return null;

  const coins =
    Math.max(
      0,
      Number(reward.coins || 0)
    );

  const xp =
    Math.max(
      0,
      Number(reward.xp || 0)
    );

  const trophies =
    Number(reward.trophies || 0);

  const halloweenCandy = Math.max(0, Number(reward.halloweenCandy || 0));

  user.coins =
    Number(user.coins || 0) +
    coins;

  user.xp =
    Number(user.xp || 0) +
    xp;

  user.trophies =
    Math.max(
      0,
      Number(user.trophies || 0) +
      trophies
    );

  if (halloweenCandy > 0) user.halloweenCandy = Math.max(0, Number(user.halloweenCandy || 0) + halloweenCandy);

  if (reward.classId) {
    user.classes =
      user.classes || [];

    if (
      !user.classes.includes(
        reward.classId
      )
    ) {
      user.classes.push(
        reward.classId
      );
    }
  }

  updateLevel(user);

  user.rank =
    getRank(user.trophies);

  return user;
}


/* =========================================
   PROGRESSION DES QUÊTES / SAISON
========================================= */
function ensureUserState(user) {
  if (!user) return;
  user.questStats = user.questStats || {};
  user.claimedQuests = user.claimedQuests || [];
  user.rankedSeason = user.rankedSeason || getRankedSeasonKey();
  if (user.rankedSeason !== getRankedSeasonKey()) resetRankedSeason(user);
  user.rankedPoints = Number(user.rankedPoints || 0);
  user.rankedWins = Number(user.rankedWins || 0);
  user.titles = Array.isArray(user.titles) ? user.titles : ["Nouveau Villageois"];
  user.equippedTitle = user.equippedTitle || user.titles[0];
  user.chatEnabled = user.chatEnabled !== false;
  user.chatAllowed = Array.isArray(user.chatAllowed) ? user.chatAllowed : [];
  user.boosts = user.boosts || {};
  user.boosts.double_coins_until = Number(user.boosts.double_coins_until || 0);
  user.boosts.double_xp_until = Number(user.boosts.double_xp_until || 0);
  user.boosts.double_trophies_until = Number(user.boosts.double_trophies_until || 0);
  user.halloweenCandy = Math.max(0, Number(user.halloweenCandy || 0));
  user.halloweenBoxes = { haunted: Math.max(0, Number(user.halloweenBoxes?.haunted || 0)), cursed: Math.max(0, Number(user.halloweenBoxes?.cursed || 0)), nocturnal: Math.max(0, Number(user.halloweenBoxes?.nocturnal || 0)) };
  user.personalEvents = user.personalEvents && typeof user.personalEvents === "object" ? user.personalEvents : {};
  user.usedPromoCodes = Array.isArray(user.usedPromoCodes) ? user.usedPromoCodes : [];
  if(user.adminRole !== "reduced") delete user.adminRole;
}
function getRankedSeasonKey(date=new Date()) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"}).formatToParts(date);
  return `${parts.find(x=>x.type==="year")?.value}-${parts.find(x=>x.type==="month")?.value}`;
}
function resetRankedSeason(user) {
  user.rankedSeason=getRankedSeasonKey(); user.rankedPoints=0; user.rankedWins=0; user.rankedRank="Bois";
}
function getRankedRank(points) {
  const p=Number(points||0);
  if(p>=2500)return "Admin"; if(p>=1800)return "Pro"; if(p>=1200)return "Chasseur"; if(p>=800)return "Diamant"; if(p>=450)return "Or"; if(p>=200)return "Bronze"; return "Bois";
}
function getFriendCount(user){ return db.friendships.filter(f=>normalizePseudo(f.user1)===normalizePseudo(user.pseudo)||normalizePseudo(f.user2)===normalizePseudo(user.pseudo)).length; }
function questStatValue(user, stat){
  ensureUserState(user);
  if(stat==="friendsCount") return getFriendCount(user);
  if(stat==="trophies") return Number(user.trophies||0);
  if(stat==="level") return Number(user.level||1);
  return Number(user.questStats[stat]||0);
}
function registerQuestStat(user, stat, amount=1){ ensureUserState(user); user.questStats[stat]=Number(user.questStats[stat]||0)+Number(amount||0); }
function questView(user, quest){
  const progress=Math.min(quest.target,questStatValue(user,quest.stat));
  return {...quest,progress,completed:progress>=quest.target,claimed:user.claimedQuests.includes(quest.id)};
}
function getQuestPayload(user){ return QUESTS.map(q=>questView(user,q)); }
function claimQuest(user, questId){
  ensureUserState(user); const q=QUESTS.find(x=>x.id===questId);
  if(!q) return {ok:false,message:"Quête introuvable."};
  const view=questView(user,q);
  if(!view.completed)return {ok:false,message:"Quête non terminée."};
  if(view.claimed)return {ok:false,message:"Quête déjà récupérée."};
  user.claimedQuests.push(q.id); applyReward(user,{coins:q.coins,xp:q.xp}); return {ok:true,quest:q,user:publicUser(user)};
}
function getBloodProgress(user, weekKey=getBloodMoonStatus().weekKey){
  db.bloodMoonProgress=db.bloodMoonProgress||{}; db.bloodMoonProgress[weekKey]=db.bloodMoonProgress[weekKey]||{}; const key=normalizePseudo(user?.pseudo||"guest");
  if(!db.bloodMoonProgress[weekKey][key])db.bloodMoonProgress[weekKey][key]={quarters:0,claimed:[],questClaims:[],stats:{},title:getWeeklyBloodMoonTitle(weekKey)};
  return db.bloodMoonProgress[weekKey][key];
}
function addBloodMoonQuarter(user){const st=getBloodMoonStatus();if(!st.active)return false;const p=getBloodProgress(user,st.weekKey);p.quarters=Math.min(4,Number(p.quarters||0)+1);return true;}

function bloodMoonPayload(user){const st=getBloodMoonStatus();const p=getBloodProgress(user,st.weekKey);const stats=p.stats||{};const quests=BLOOD_MOON_QUESTS.map(q=>({...q,progress:Math.min(q.target,Number(stats[q.stat]||0)),completed:Number(stats[q.stat]||0)>=q.target,claimed:(p.questClaims||[]).includes(q.id)}));return {event:st,quarters:Number(p.quarters||0),claimed:p.claimed||[],title:p.title||st.title,quests,milestones:[{quarter:1,reward:{coins:100}},{quarter:2,reward:{xp:200}},{quarter:3,reward:{xp:500}},{quarter:4,reward:{title:p.title||st.title}}]};}
function registerBloodQuest(user,stat,amount=1){const st=getBloodMoonStatus();if(!st.active)return;const p=getBloodProgress(user,st.weekKey);p.stats=p.stats||{};p.stats[stat]=Number(p.stats[stat]||0)+Number(amount||0);}

function filterChatText(text){
  const bad=[
    "idiot","idiote","imbecile","imbécile","connard","connasse","conne","con",
    "pute","putain","salope","salaud","nique","niquer","fdp","fils de pute",
    "merde","encule","enculé","enculer","batard","bâtard","batarde","bâtarde",
    "abruti","abrutie","crétin","cretin","bouffon","enfoire","enfoiré","tg"
  ];
  let out=String(text||"").trim().slice(0,500);
  for(const word of bad){
    const normalized=word.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const pattern=normalized.split("").map(ch=>ch.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("[^a-zA-ZÀ-ÿ]*");
    out=out.replace(new RegExp(pattern,"gi"),"•••");
  }
  return out;
}

function areFriends(a,b){return db.friendships.some(f=>(normalizePseudo(f.user1)===normalizePseudo(a)&&normalizePseudo(f.user2)===normalizePseudo(b))||(normalizePseudo(f.user2)===normalizePseudo(a)&&normalizePseudo(f.user1)===normalizePseudo(b)));}
function emitProfile(user){ const sid=onlineUsers.get(normalizePseudo(user.pseudo)); if(sid)io.to(sid).emit("profileUpdated",publicUser(user)); }

/* =========================================
   UTILISATEURS EN LIGNE
========================================= */

const onlineUsers = new Map();

const socketUsers = new Map();


function getOnlineUserInfo() {
  return Array.from(
    onlineUsers.keys()
  );
}

function isUserOnline(pseudo) {
  return onlineUsers.has(
    normalizePseudo(pseudo)
  );
}


/* =========================================
   SALONS
========================================= */

function findRoom(code) {
  return db.rooms.find(
    (room) => room.code === code
  );
}

function roomPublic(room) {
  if (!room) return null;

  return {
    code: room.code,

    host: room.host,

    players: room.players.map((p)=>({pseudo:p.pseudo,isBot:Boolean(p.isBot)})),

    ranked: Boolean(
      room.ranked
    ),

    status:
      room.status || "waiting",

    maxPlayers: 8
  };
}

function removeUserFromRooms(pseudo) {
  const normalized=normalizePseudo(pseudo);
  db.rooms.forEach(room=>{
    const wasHost=normalizePseudo(room.host)===normalized;
    room.players=room.players.filter(player=>normalizePseudo(player.pseudo)!==normalized);
    if(wasHost&&room.players.length) room.host=room.players[0].pseudo;
  });
  db.rooms=db.rooms.filter(room=>room.players.length>0);
}

const BOT_PSEUDOS = [
  "LunaNoire","CrocsDArgent","OmbreFurtive","NuitSauvage","GriffeRouge","BrumeNoire","PetitLoup","Loupiote","LoupSombre","EtoileGrise",
  "FauconNoir","RenardLunaire","CorbeauNoir","Tempete","FeuFollet","ChasseurNocturne","BrumeLunaire","GriffeDeNuit","VentSombre","LoupFantome",
  "PlumeNoire","EclairGris","RoiDesBois","ReineDeNuit","Hurlement","CroissantDeLune","Nebuleuse","SombreLoup","CendreNoire","ForetMystique",
  "OmbreGrise","LuneRouge","NuitEtoilee","GivreNoir","Rodeur","EspritDesBois","LoupArgente","BrumeGrise","EchoNocturne","LoupDeMinuit"
];
function randomBotPseudo(room){
  const used=new Set(room.players.map(p=>normalizePseudo(p.pseudo)));
  const available=BOT_PSEUDOS.filter(name=>!used.has(normalizePseudo(name)));
  if(available.length)return available[Math.floor(Math.random()*available.length)];
  let i=2,candidate=`LoupMystere${i}`;
  while(used.has(normalizePseudo(candidate)))candidate=`LoupMystere${++i}`;
  return candidate;
}
function addBotsToRoom(room){
  while(room.players.length<8){
    room.players.push({pseudo:randomBotPseudo(room),isBot:true,socketId:null});
  }
}

/* =========================================
   VRAIE PARTIE LOUP-GAROU
========================================= */

function shuffle(array) {
  const copy =
    [...array];

  for (
    let index =
      copy.length - 1;
    index > 0;
    index--
  ) {
    const randomIndex =
      Math.floor(
        Math.random() *
        (index + 1)
      );

    [
      copy[index],
      copy[randomIndex]
    ] =
      [
        copy[randomIndex],
        copy[index]
      ];
  }

  return copy;
}

function getEquippedClass(player) {
  if (!player || player.isBot) return null;

  const user = findUser(player.pseudo);
  if (!user) return null;

  return (
    CLASSES.find(
      (classe) => classe.id === user.equippedClass
    ) || null
  );
}

function classCanGrantRole(classId, role) {
  const exact={wolf1:["Loup-Garou"],wolf2:["Loup-Garou"],seer1:["Voyante"],witch1:["Sorcière"],cupid1:["Cupidon"],pumpkin1:["Citrouille"]};
  return Boolean(exact[classId]?.includes(role));
}
function getClassRole(classId){ return ({wolf1:"Loup-Garou",wolf2:"Loup-Garou",seer1:"Voyante",witch1:"Sorcière",cupid1:"Cupidon",pumpkin1:"Citrouille"})[classId]||null; }
function assignRolesForGame(players){
  const released=isV26Released();
  const halloween=getHalloweenStatus().active;
  const rolePool=halloween
    ? (released
      ? ["Loup-Garou","Loup-Garou","Voyante","Sorcière","Cupidon","Géant de pierre","Citrouille","Villageois"]
      : ["Loup-Garou","Loup-Garou","Voyante","Sorcière","Cupidon","Citrouille","Villageois","Villageois"])
    : released
      ? ["Loup-Garou","Loup-Garou","Voyante","Sorcière","Cupidon","Géant de pierre","Villageois","Villageois"]
      : ["Loup-Garou","Loup-Garou","Voyante","Sorcière","Cupidon","Villageois","Villageois","Villageois"];
  const assignments=new Map(),slots={};
  rolePool.forEach(r=>slots[r]=(slots[r]||0)+1);
  const pumpkinDenied=new Set();

  // Les classes normales garantissent leur rôle si le rôle existe dans la partie.
  // La classe Citrouille est différente : elle donne 30 % de chance d'obtenir ce rôle.
  shuffle(players.slice()).forEach(player=>{
    const c=getEquippedClass(player),wanted=getClassRole(c?.id);
    if(!wanted||!slots[wanted])return;
    if(wanted==="Citrouille"&&Math.random()>.30){
      pumpkinDenied.add(player.pseudo);
      return;
    }
    assignments.set(player.pseudo,wanted);
    slots[wanted]--;
  });

  // Répartition des rôles restants en respectant le refus de la Citrouille.
  const free=shuffle(players.filter(p=>!assignments.has(p.pseudo)));
  const remaining=[];
  Object.entries(slots).forEach(([role,n])=>{
    for(let i=0;i<n;i++)remaining.push(role);
  });
  shuffle(remaining);
  const used=new Set();
  free.forEach(p=>{
    let idx=remaining.findIndex(role=>!(role==="Citrouille"&&pumpkinDenied.has(p.pseudo)));
    if(idx<0)idx=remaining.findIndex(role=>role!=="Citrouille");
    if(idx<0)idx=remaining.length?0:-1;
    if(idx>=0){
      const role=remaining.splice(idx,1)[0];
      assignments.set(p.pseudo,role);
      used.add(role);
    }
  });

  // Si personne n'a réussi le tirage 30 %, le slot Citrouille devient Villageois.
  // Cela évite de donner involontairement la Citrouille à 100 % des parties Halloween.
  players.forEach(p=>{if(!assignments.has(p.pseudo))assignments.set(p.pseudo,"Villageois");});
  return assignments;
}
function isWolfTeamRole(role){return role==="Loup-Garou"||role==="Citrouille";}

function createGame(room) {
  const players = shuffle(room.players);
  const assignments = assignRolesForGame(players);
  const gamePlayers = players.map(player => ({
    pseudo: player.pseudo,
    isBot: Boolean(player.isBot),
    alive: true,
    role: assignments.get(player.pseudo) || "Villageois",
    classId: getEquippedClass(player)?.id || null,
    classChance: getEquippedClass(player)?.chance || 0
  }));

  return {
    id: createId(), roomCode: room.code, ranked: Boolean(room.ranked), phase: "night",
    nightStep: "cupid", day: 1, chat: [], players: gamePlayers,
    nightVotes: {}, dayVotes: {}, nightTargetPseudo: null,
    nightActions: { saved: null, witchKill: null, pumpkinKills: [], giantKill: null },
    witchSaveUsed: false, witchKillUsed: false, cupidUsed: false, pumpkinUsed: false, giantUsed: false,
    linkedPlayers: [], seerUsedThisNight: false, winner: null, createdAt: Date.now()
  };
}

function getGameForRoom(room) {
  return room.game || null;
}

function getAlivePlayers(game) {
  return game.players.filter(
    (player) => player.alive
  );
}

function checkGameWinner(game) {
  const alive =
    getAlivePlayers(game);

  const wolves =
    alive.filter(
      (player) =>
        isWolfTeamRole(player.role)
    );

  const villagers =
    alive.filter(
      (player) =>
        !isWolfTeamRole(player.role)
    );

  if (wolves.length === 0) {
    game.winner =
      "Villageois";

    return true;
  }

  if (
    wolves.length >=
    villagers.length
  ) {
    game.winner =
      "Loups-Garous";

    return true;
  }

  return false;
}

function getActiveGlobalMultiplier(type) {
  const boost = db.globalBoosts?.[type];
  if (!boost) return 1;
  if (Number(boost.until || 0) <= Date.now()) return 1;
  return Math.max(1, Number(boost.multiplier || 1));
}

function getGlobalBoostPayload() {
  const now = Date.now();
  const result = {};
  ["coins","xp","trophies"].forEach(type => {
    const b = db.globalBoosts?.[type] || { multiplier: 1, until: 0 };
    result[type] = {
      multiplier: Number(b.until || 0) > now ? Math.max(1, Number(b.multiplier || 1)) : 1,
      until: Number(b.until || 0)
    };
  });
  return result;
}

const HALLOWEEN_SHOP_ITEMS = [
  {id:"halloween_coins", name:"Sac de pièces hantées", price:100, description:"Échange 100 bonbons contre 250 pièces."},
  {id:"halloween_xp", name:"Éclat d'expérience", price:150, description:"Échange 150 bonbons contre 500 XP."},
  {id:"halloween_title", name:"Titre : Maître des citrouilles", price:300, description:"Titre Halloween permanent à équiper."},
  {id:"halloween_trophy", name:"Trophée maudit", price:400, description:"Échange 400 bonbons contre 3 trophées."}
];
function halloweenSeasonKey(){ return Number(db.halloweenEvent?.week||0)>0 ? Number(db.halloweenEvent.week) : 0; }
function awardHalloweenCandy(user, amount){ if(!user)return 0; const st=getHalloweenStatus(); if(!st.active)return 0; const n=Math.max(0,Math.floor(Number(amount||0))); user.halloweenCandy=Math.max(0,Number(user.halloweenCandy||0)+n); return n; }
function awardHalloweenBox(user){
  if(!user || !getHalloweenStatus().active) return null;
  ensureUserState(user);
  const roll=Math.random();
  const type=roll<0.68 ? "haunted" : roll<0.93 ? "cursed" : "nocturnal";
  user.halloweenBoxes[type]=Number(user.halloweenBoxes[type]||0)+1;
  return type;
}
function halloweenBoxPayload(user){
  ensureUserState(user);
  return {haunted:Number(user.halloweenBoxes.haunted||0),cursed:Number(user.halloweenBoxes.cursed||0),nocturnal:Number(user.halloweenBoxes.nocturnal||0)};
}
function openHalloweenBox(user,type){
  if(!user) throw new Error("Compte introuvable.");
  if(!getHalloweenStatus().active) throw new Error("Les boîtes Halloween sont disponibles uniquement pendant l'événement.");
  ensureUserState(user);
  if(!["haunted","cursed","nocturnal"].includes(type)) throw new Error("Boîte inconnue.");
  if(Number(user.halloweenBoxes[type]||0)<=0) throw new Error("Tu ne possèdes pas cette boîte.");
  user.halloweenBoxes[type]--;
  const rewards={
    haunted:[{coins:75},{coins:150},{xp:150},{xp:250},{halloweenCandy:25},{trophies:1},{title:"Fantôme du village"}],
    cursed:[{coins:250},{coins:400},{xp:350},{xp:600},{trophies:2},{halloweenCandy:50},{title:"Maudit du village"},{classId:"pumpkin1"}],
    nocturnal:[{coins:500},{coins:750},{xp:750},{xp:1200},{trophies:3},{halloweenCandy:120},{title:"Ombre de la Nuit"},{title:"Seigneur de la nuit"},{classId:"pumpkin1"}]
  };
  let reward={...rewards[type][Math.floor(Math.random()*rewards[type].length)]};
  // Une récompense unique ne doit jamais être perdue si le joueur la possède déjà.
  if(reward.title){
    user.titles=user.titles||["Nouveau Villageois"];
    if(user.titles.includes(reward.title)) reward={coins:type==="nocturnal"?350:type==="cursed"?200:100};
  }
  if(reward.classId && (user.classes||[]).includes(reward.classId)) reward={coins:type==="nocturnal"?400:type==="cursed"?250:125};
  if(reward.title){ user.titles=user.titles||["Nouveau Villageois"]; if(!user.titles.includes(reward.title)) user.titles.push(reward.title); }
  applyReward(user,reward);
  const rewardLabel=reward.coins?reward.coins+" pièces 🪙":reward.xp?reward.xp+" XP ✨":reward.trophies?reward.trophies+" trophée(s) 🏆":reward.halloweenCandy?reward.halloweenCandy+" bonbons 🍬":reward.classId?"la classe "+(CLASSES.find(c=>c.id===reward.classId)?.name||reward.classId)+" 🐺":"le titre « "+reward.title+" » 🏷️";
  addNotification(user.pseudo,{title:"🎃 Boîte Halloween ouverte !",message:`Tu as obtenu ${rewardLabel}.`,type:"halloweenBox"});
  emitProfile(user);
  saveDatabase();
  return {type,reward,boxes:halloweenBoxPayload(user),user:publicUser(user)};
}

function getHalloweenChallengeStatus(){
  const active=getHalloweenStatus().active;
  const c=db.halloweenChallenge||{games:0,target:100,completed:0,lastRewardAt:0};
  return {active,games:Math.max(0,Number(c.games||0)),target:100,completed:Math.max(0,Number(c.completed||0)),percent:Math.min(100,Math.round((Number(c.games||0)/100)*100))};
}
function registerHalloweenChallengeGame(){
  if(!getHalloweenStatus().active) return getHalloweenChallengeStatus();
  db.halloweenChallenge=db.halloweenChallenge||{games:0,target:100,completed:0,lastRewardAt:0};
  db.halloweenChallenge.games=Math.min(100,Number(db.halloweenChallenge.games||0)+1);
  if(db.halloweenChallenge.games>=100){
    let count=0;
    db.users.forEach(u=>{ensureUserState(u);applyReward(u,{coins:200});addNotification(u.pseudo,{title:"🎃 Défi Halloween terminé !",message:"La communauté a terminé 100 parties ! Tu reçois 200 pièces.",type:"halloweenChallenge",reward:{coins:200}});emitProfile(u);count++;});
    db.halloweenChallenge.completed=Number(db.halloweenChallenge.completed||0)+1;
    db.halloweenChallenge.lastRewardAt=Date.now();
    db.halloweenChallenge.games=0;
    io.emit("halloweenChallengeCompleted",{rewardCoins:200,players:count});
  }
  const status=getHalloweenChallengeStatus();
  io.emit("halloweenChallengeUpdated",status);
  return status;
}

function finishGame(room) {
  const game=room.game; if(!game || game.phase==="finished") return;
  game.phase="finished"; const blood=getBloodMoonStatus();
  game.players.forEach(player=>{
    if(player.isBot)return; const user=findUser(player.pseudo); if(!user)return; ensureUserState(user);
    const isWolf=isWolfTeamRole(player.role);
    if(blood.active){registerBloodQuest(user,"bloodPlayed",1);if(game.ranked)registerBloodQuest(user,"bloodRanked",1);}
    const won=(game.winner==="Loups-Garous"&&isWolf)||(game.winner==="Villageois"&&!isWolf);
    // Chaque victoire rapporte toujours 1 trophée, même en partie normale.
    // Les défaites ne retirent pas de trophée.
    let xp=50+(won?100:0), coins=25+(won?50:0), trophies=won?1:0;
    if(blood.active){xp*=2;coins*=2;trophies*=2;}
    user.boosts=user.boosts||{};
    const nowBoost=Date.now();
    if(Number(user.boosts.double_coins_until||0)>nowBoost) coins*=2;
    if(Number(user.boosts.double_xp_until||0)>nowBoost) xp*=2;
    if(Number(user.boosts.double_trophies_until||0)>nowBoost) trophies*=2;

    // Bonus globaux activés depuis le panneau Admin.
    coins *= getActiveGlobalMultiplier("coins") * getActivePersonalMultiplier(user,"coins");
    xp *= getActiveGlobalMultiplier("xp") * getActivePersonalMultiplier(user,"xp");
    trophies *= getActiveGlobalMultiplier("trophies") * getActivePersonalMultiplier(user,"trophies");

    applyReward(user,{xp,coins,trophies});
    const candyEarned = awardHalloweenCandy(user, won ? 25 : 10);
    if(candyEarned) registerQuestStat(user,"halloweenCandy",candyEarned);
    const boxEarned = awardHalloweenBox(user);
    if(boxEarned) addNotification(user.pseudo,{title:"🎃 Nouvelle boîte Halloween !",message:`Tu as gagné une ${boxEarned==="haunted"?"boîte hantée":boxEarned==="cursed"?"boîte maudite":"boîte nocturne"}.`,type:"halloweenBoxDrop"});
    user.gamesPlayed=Number(user.gamesPlayed||0)+1; registerQuestStat(user,"gamesPlayed",1);
    if(won){user.gamesWon=Number(user.gamesWon||0)+1;registerQuestStat(user,"gamesWon",1);if(blood.active)registerBloodQuest(user,"bloodWon",1);}
    if(game.ranked){registerQuestStat(user,"rankedPlayed",1);if(won){registerQuestStat(user,"rankedWon",1);user.rankedWins++;user.rankedPoints+=30;}else{user.rankedPoints=Math.max(0,user.rankedPoints-10);}user.rankedRank=getRankedRank(user.rankedPoints);}
    if(isWolf&&won)registerQuestStat(user,"wolfWins",1);
    if(player.role!=="Villageois")registerQuestStat(user,"specialRoles",1);
    if(won&&player.alive)registerQuestStat(user,"survivals",1);
    emitProfile(user);
  });
  registerHalloweenChallengeGame();
  saveDatabase();
  io.to(room.code).emit("gameFinished",{winner:game.winner,players:game.players.map(p=>({pseudo:p.pseudo,alive:p.alive,isBot:p.isBot,role:p.isBot?undefined:p.role}))});
  room.status="finished";
  setTimeout(()=>{ const r=findRoom(room.code); if(r&&r.status==="finished"){db.rooms=db.rooms.filter(x=>x.code!==r.code);saveDatabase();io.emit("roomsList",db.rooms.filter(x=>x.status==="waiting").map(roomPublic));}},30000);
}


/* =========================================
   API : INSCRIPTION
========================================= */

app.post(
  "/api/register",
  async (req, res) => {
    try {
      const {
        pseudo,
        email,
        password
      } = req.body;

      const clean =
        cleanPseudo(pseudo);

      if (
        clean.length < 3
      ) {
        return res
          .status(400)
          .json({
            message:
              "Le pseudo doit contenir au moins 3 caractères."
          });
      }

      if (
        !email ||
        !String(email).includes("@")
      ) {
        return res
          .status(400)
          .json({
            message:
              "Adresse e-mail invalide."
          });
      }

      if (
        !password ||
        String(password).length < 4
      ) {
        return res
          .status(400)
          .json({
            message:
              "Le mot de passe doit contenir au moins 4 caractères."
          });
      }

      if (
        findUser(clean)
      ) {
        return res
          .status(400)
          .json({
            message:
              "Ce pseudo existe déjà."
          });
      }

      const emailExists =
        db.users.some(
          (user) =>
            String(
              user.email
            ).toLowerCase() ===
            String(
              email
            ).toLowerCase()
        );

      if (emailExists) {
        return res
          .status(400)
          .json({
            message:
              "Cette adresse e-mail est déjà utilisée."
          });
      }

      const hashedPassword =
        await bcrypt.hash(
          password,
          10
        );

      const user = {
        id: createId(),

        pseudo: clean,

        email:
          String(email)
            .trim()
            .toLowerCase(),

        password:
          hashedPassword,

        icon: "🐺",

        title:
          "Nouveau Villageois",

        titles: [
          "Nouveau Villageois"
        ],

        equippedTitle:
          "Nouveau Villageois",

        level: 1,

        xp: 0,

        coins: 50,

        halloweenCandy: 0,

        halloweenBoxes: { haunted: 0, cursed: 0, nocturnal: 0 },

        trophies: 0,

        rank: "Bois",

        classes: [
          "wolf1"
        ],

        equippedClass:
          null,

        gamesPlayed: 0,

        gamesWon: 0,

        createdAt:
          Date.now(),

        questStats: {},
        claimedQuests: [],
        rankedSeason: getRankedSeasonKey(),
        rankedPoints: 0,
        rankedWins: 0,
        rankedRank: "Bois",
        chatEnabled: true
      };

      db.users.push(user);

      saveDatabase();

      addNotification(
        user.pseudo,
        {
          title:
            "Bienvenue !",

          message:
            "Vous avez reçu 50 pièces 🐺.",

          type:
            "reward"
        }
      );

      return res.json({
        message:
          "Compte créé avec succès.",
        user:
          publicUser(user)
      });

    } catch (error) {
      console.error(error);

      return res
        .status(500)
        .json({
          message:
            "Erreur serveur."
        });
    }
  }
);



/* =========================================
   API : PROFIL ENREGISTRÉ
   Permet de recharger les vraies données du
   compte après un rafraîchissement/reconnexion.
========================================= */
app.get("/api/profile/:pseudo", (req, res) => {
  try {
    const user = findUser(req.params.pseudo);
    if (!user) {
      return res.status(404).json({ message: "Compte introuvable." });
    }

    updateLevel(user);
    user.rank = getRank(user.trophies);
    saveDatabase();

    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error("Erreur profil :", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
});


/* =========================================
   API : ÉTAT DU STOCKAGE
   Permet de distinguer une vraie absence de compte
   d'un problème de stockage/réseau.
========================================= */
app.get("/api/storage-status", (req, res) => {
  try {
    const stat = fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE) : null;
    res.json({
      ok: true,
      persistentPath: DATA_DIR,
      dataFile: DATA_FILE,
      writable: (() => { try { fs.accessSync(DATA_DIR, fs.constants.W_OK); return true; } catch (_) { return false; } })(),
      dataFileExists: !!stat,
      dataFileSize: stat ? stat.size : 0,
      accounts: db.users.length
    });
  } catch (error) {
    res.status(500).json({ ok:false, message:"État du stockage indisponible." });
  }
});

/* =========================================
   API : CONNEXION
========================================= */

app.post(
  "/api/login",
  async (req, res) => {
    try {
      const {
        pseudo,
        password
      } = req.body;

      const user =
        findUser(pseudo);

      if (!user) {
        return res
          .status(401)
          .json({
            message:
              "Pseudo ou mot de passe incorrect."
          });
      }

      const valid =
        await bcrypt.compare(
          password || "",
          user.password
        );

      if (!valid) {
        return res
          .status(401)
          .json({
            message:
              "Pseudo ou mot de passe incorrect."
          });
      }

      updateLevel(user);

      user.rank =
        getRank(
          user.trophies
        );

      saveDatabase();

      return res.json({
        message:
          "Connexion réussie.",
        user:
          publicUser(user)
      });

    } catch (error) {
      console.error(error);

      return res
        .status(500)
        .json({
          message:
            "Erreur serveur."
        });
    }
  }
);


/* =========================================
   API : CLASSES
========================================= */

app.get("/api/classes",(req,res)=>{ const user=findUser(req.query.pseudo||""); const personalDiscount=getPersonalDiscountPercent(user); res.json({classes:getPublicClasses().map(c=>({...c,originalPrice:c.price,effectivePrice:getClassPrice(c,user)})),discountPercent:Math.max(getClassDiscountPercent(),personalDiscount),discountUntil:Number(db.classDiscount?.until||0),personalDiscount}); });

app.post(
  "/api/classes/buy",
  (req, res) => {
    const {
      pseudo,
      classId
    } = req.body;

    const user =
      findUser(pseudo);

    const classe =
      CLASSES.find(
        (item) =>
          item.id === classId
      );

    if (!user) {
      return res
        .status(404)
        .json({
          message:
            "Utilisateur introuvable."
        });
    }

    if (!classe) {
      return res
        .status(404)
        .json({
          message:
            "Classe introuvable."
        });
    }

    user.classes =
      user.classes || [];

    if (
      user.classes.includes(
        classe.id
      )
    ) {
      return res
        .status(400)
        .json({
          message:
            "Tu possèdes déjà cette classe."
        });
    }

    const price=getClassPrice(classe,user);
    if (
      Number(user.coins || 0) <
      price
    ) {
      return res
        .status(400)
        .json({
          message:
            "Tu n'as pas assez de pièces."
        });
    }

    user.coins -=
      price;

    user.classes.push(
      classe.id
    );

    saveDatabase();

    res.json({
      message:
        getClassDiscountPercent()>0 ? `Classe achetée avec ${getClassDiscountPercent()}% de réduction !` : "Classe achetée !",
      user:
        publicUser(user)
    });
  }
);

app.post(
  "/api/classes/equip",
  (req, res) => {
    const {
      pseudo,
      classId
    } = req.body;

    const user =
      findUser(pseudo);

    if (!user) {
      return res
        .status(404)
        .json({
          message:
            "Utilisateur introuvable."
        });
    }

    if (
      !(user.classes || [])
        .includes(classId)
    ) {
      return res
        .status(400)
        .json({
          message:
            "Tu ne possèdes pas cette classe."
        });
    }

    user.equippedClass =
      classId;

    saveDatabase();

    res.json({
      message:
        "Classe équipée !",
      user:
        publicUser(user)
    });
  }
);


/* =========================================
   API : QUÊTES
========================================= */

app.get("/api/quests", (req,res)=>{
  const user=findUser(req.query.pseudo || "");
  if(!user) return res.status(404).json({message:"Utilisateur introuvable."});
  ensureUserState(user); saveDatabase();
  res.json({quests:getQuestPayload(user)});
});
app.post("/api/quests/claim", (req,res)=>{
  const user=findUser(req.body.pseudo); if(!user)return res.status(404).json({message:"Utilisateur introuvable."});
  const result=claimQuest(user,req.body.questId); if(!result.ok)return res.status(400).json({message:result.message});
  saveDatabase(); emitProfile(user); addNotification(user.pseudo,{title:"📜 Quête terminée",message:`${result.quest.title} : récompense récupérée !`,type:"quest"});
  res.json({message:"Récompense récupérée !",user:publicUser(user),quest:result.quest});
});

app.get("/api/blood-moon",(req,res)=>{
  const user=findUser(req.query.pseudo||""); res.json({event:getBloodMoonStatus(),quests:BLOOD_MOON_QUESTS,progress:user?bloodMoonPayload(user):bloodMoonPayload({})});
});
app.post("/api/blood-moon/quest-claim",(req,res)=>{const user=findUser(req.body.pseudo),st=getBloodMoonStatus();if(!user||!st.active)return res.status(400).json({message:"Événement indisponible."});const p=getBloodProgress(user,st.weekKey);p.questClaims=p.questClaims||[];const q=BLOOD_MOON_QUESTS.find(x=>x.id===req.body.questId);if(!q)return res.status(404).json({message:"Quête introuvable."});if(p.questClaims.includes(q.id))return res.status(400).json({message:"Quête déjà récupérée."});if(Number(p.stats?.[q.stat]||0)<q.target)return res.status(400).json({message:"Quête non terminée."});p.questClaims.push(q.id);addBloodMoonQuarter(user);saveDatabase();emitProfile(user);res.json({message:"Quart de Lune de Sang gagné !",user:publicUser(user),progress:bloodMoonPayload(user)});});
app.post("/api/blood-moon/claim",(req,res)=>{
  const user=findUser(req.body.pseudo); const st=getBloodMoonStatus(); if(!user)return res.status(404).json({message:"Utilisateur introuvable."});
  if(!st.active)return res.status(400).json({message:"La Lune de Sang est terminée."});
  const p=getBloodProgress(user,st.weekKey); const q=Number(req.body.quarter); if(![1,2,3,4].includes(q))return res.status(400).json({message:"Quart invalide."});
  if(Number(p.quarters||0)<q)return res.status(400).json({message:"Ce palier n'est pas encore atteint."}); p.claimed=p.claimed||[]; if(p.claimed.includes(q))return res.status(400).json({message:"Palier déjà récupéré."});
  const rewards={1:{coins:100},2:{xp:200},3:{xp:500},4:{title:p.title||getWeeklyBloodMoonTitle(st.weekKey)}}; const reward=rewards[q];
  if(q<4) applyReward(user,reward);
  else {
    user.titles=user.titles||["Nouveau Villageois"];
    if(user.titles.includes(reward.title)){
      return res.status(400).json({message:"Ce titre a déjà été obtenu sur ce compte. Ce titre ne peut être obtenu qu'une seule fois."});
    }
    user.titles.push(reward.title);
  }
  p.claimed.push(q); saveDatabase(); emitProfile(user); res.json({message:"Récompense Lune de Sang récupérée !",user:publicUser(user),progress:bloodMoonPayload(user)});
});


/* =========================================
   API : ADMIN - ÉVÉNEMENT HALLOWEEN
========================================= */
app.get('/api/halloween',(req,res)=>res.json({event:getHalloweenStatus()}));
function getMaintenanceStatus() {
  const m = db.maintenance || { active:false, startedAt:0, endsAt:0, durationMinutes:0 };
  const endsAt = Number(m.endsAt || 0);
  const active = Boolean(m.active);
  if (active && endsAt > 0 && endsAt <= Date.now()) {
    // Expiration automatique : à 0, la maintenance s'arrête sans action manuelle.
    db.maintenance = { active:false, startedAt:0, endsAt:0, durationMinutes:0 };
    saveDatabase();
    return { active:false, startedAt:0, endsAt:0, durationMinutes:0, remainingMs:0, expired:true };
  }
  return {
    active,
    startedAt: Number(m.startedAt || 0),
    endsAt,
    durationMinutes: Number(m.durationMinutes || 0),
    remainingMs: Math.max(0, endsAt - Date.now())
  };
}

app.get("/api/maintenance", (req,res)=>{
  res.json({ maintenance: getMaintenanceStatus() });
});

app.post("/api/admin/maintenance/start", async (req,res)=>{
  if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});
  const minutes = Number(req.body.durationMinutes);
  if(!Number.isFinite(minutes) || minutes < 0.01 || minutes > 10080){
    return res.status(400).json({message:"La durée doit être comprise entre 0,01 minute et 7 jours."});
  }
  const now=Date.now();
  db.maintenance={active:true,startedAt:now,endsAt:now+Math.round(minutes*60000),durationMinutes:minutes};
  await saveDatabase();
  const maintenance=getMaintenanceStatus();
  io.emit("maintenanceStatusChanged", maintenance);
  res.json({message:`🛠️ Maintenance activée pendant ${minutes} minute(s).`,maintenance});
});

app.post("/api/admin/maintenance/stop", async (req,res)=>{
  if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});
  db.maintenance={active:false,startedAt:0,endsAt:0,durationMinutes:0};
  await saveDatabase();
  const maintenance=getMaintenanceStatus();
  io.emit("maintenanceStatusChanged", maintenance);
  res.json({message:"🛠️ Maintenance arrêtée. Le jeu est de nouveau accessible.",maintenance});
});

app.post('/api/admin/halloween/start',(req,res)=>{if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:'Accès refusé.'});try{const event=startHalloweenWeek(req.body.week);res.json({message:`🎃 Semaine ${event.week} d'Halloween activée pendant 7 jours.`,event});}catch(e){res.status(400).json({message:e.message});}});
app.post('/api/admin/halloween/stop',(req,res)=>{if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:'Accès refusé.'});const was=getHalloweenStatus().active,event=stopHalloweenEvent();res.json({message:was?'🛑 Événement Halloween arrêté manuellement.':'🛑 Événement Halloween déjà arrêté.',event});});

/* =========================================
   API : ADMIN - LUNE DE SANG MANUELLE
========================================= */
app.post("/api/admin/blood-moon/start", (req,res)=>{
  if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});
  db.bloodMoonManualUntil=Date.now()+20*60*1000;
  saveDatabase();
  const status=getBloodMoonStatus();
  io.emit("bloodMoonStatusChanged",status);
  res.json({message:"🌕 Lune de Sang activée pendant 20 minutes.",event:status});
});

/* =========================================
   API : CLASSEMENT
========================================= */

app.get("/api/ranking",(req,res)=>{const ranked=req.query.mode==="ranked";db.users.forEach(ensureUserState);const users=db.users.map(u=>{const x=publicUser(u);x.rankedPoints=Number(u.rankedPoints||0);x.rankedRank=getRankedRank(u.rankedPoints);return x;}).sort((a,b)=>ranked?b.rankedPoints-a.rankedPoints:Number(b.trophies||0)-Number(a.trophies||0));res.json({mode:ranked?"ranked":"normal",season:getRankedSeasonKey(),users});});


/* =========================================
   API : RECHERCHE JOUEUR
========================================= */

app.get(
  "/api/users/:pseudo",
  (req, res) => {
    const search = String(req.params.pseudo || "").trim();
    const user = search.toUpperCase().startsWith("LG-") ? findUserByIdentifier(search) : findUser(search);

    if (!user) {
      return res
        .status(404)
        .json({
          message:
            "Joueur introuvable."
        });
    }

    res.json({
      user:
        publicUser(user)
    });
  }
);


/* =========================================
   API : NOTIFICATIONS
========================================= */

app.get(
  "/api/notifications/:pseudo",
  (req, res) => {
    purgeExpiredNotifications();
    saveDatabase();
    const searchValue = String(req.params.pseudo || "").trim();
    const user = searchValue.toUpperCase().startsWith("LG-")
      ? findUserByIdentifier(searchValue)
      : findUser(searchValue);

    if (!user) {
      return res
        .status(404)
        .json({
          message:
            "Utilisateur introuvable."
        });
    }

    const notifications =
      db.notifications
        .filter(
          (notification) =>
            normalizePseudo(
              notification.pseudo
            ) ===
            normalizePseudo(
              user.pseudo
            )
        )
        .sort(
          (a, b) =>
            b.createdAt -
            a.createdAt
        );

    // Une validation de récupération reste disponible jusqu’à son utilisation,
    // même si les notifications ordinaires expirent après 30 secondes.
    const approvedRecovery=(db.recoveryRequests||[])
      .filter(r=>r.pseudo===user.pseudo && r.approvedAt && !r.usedAt && r.token)
      .map(r=>({
        id:`recovery-${r.id}`,
        pseudo:user.pseudo,
        title:"🔐 Récupération de compte validée",
        message:"Le créateur a validé ta demande. Tu peux récupérer ton compte avec le bouton ci-dessous.",
        type:"recoveryApproved",
        reward:null, claimed:false, createdAt:Number(r.approvedAt),
        action:{type:"recoveryApproved",token:r.token}
      }));

    res.json({
      notifications:[...approvedRecovery,...notifications]
    });
  }
);

app.post(
  "/api/notifications/claim",
  (req, res) => {
    const {
      pseudo,
      notificationId
    } = req.body;

    const user =
      findUser(pseudo);

    const notification =
      db.notifications.find(
        (item) =>
          item.id ===
          notificationId &&
          normalizePseudo(
            item.pseudo
          ) ===
          normalizePseudo(pseudo)
      );

    if (
      !user ||
      !notification
    ) {
      return res
        .status(404)
        .json({
          message:
            "Notification introuvable."
        });
    }

    if (notification.claimed) {
      return res
        .status(400)
        .json({
          message:
            "Récompense déjà récupérée."
        });
    }

    notification.claimed = true;

    if (notification.reward) {
      applyReward(
        user,
        notification.reward
      );
    }

    saveDatabase();

    res.json({
      message:
        "Récompense récupérée !",

      user:
        publicUser(user)
    });
  }
);


/* =========================================
   API : ANNONCE
========================================= */

app.get(
  "/api/announcement",
  (req, res) => {
    res.json(
      db.announcements
    );
  }
);

app.post(
  "/api/admin/announcement",
  (req, res) => {
    const {
      adminPseudo,
      text
    } = req.body;

    if (
      normalizePseudo(
        adminPseudo
      ) !== ADMIN_PSEUDO
    ) {
      return res
        .status(403)
        .json({
          message:
            "Accès refusé."
        });
    }

    db.announcements.text =
      String(text || "")
        .trim()
        .slice(0, 2000);

    saveDatabase();

    io.emit(
      "announcementUpdated",
      db.announcements
    );

    res.json({
      message:
        "Annonce enregistrée."
    });
  }
);


/* =========================================
   API : COMMENTAIRES DU MENU
========================================= */
function publicComment(c){
  return {
    id:String(c.id),
    pseudo:String(c.pseudo||""),
    text:String(c.text||""),
    parentId:c.parentId?String(c.parentId):null,
    createdAt:Number(c.createdAt||0),
    likes:Array.isArray(c.likes)?c.likes.map(String):[]
  };
}

app.get("/api/comments",(req,res)=>{
  res.json({comments:(db.comments||[]).map(publicComment)});
});

app.post("/api/comments",(req,res)=>{
  const user=findUser(req.body.pseudo);
  const text=String(req.body.text||"").trim().slice(0,500);
  if(!user)return res.status(404).json({message:"Utilisateur introuvable."});
  if(!text)return res.status(400).json({message:"Le commentaire est vide."});
  const parentId=req.body.parentId?String(req.body.parentId):null;
  if(parentId&&!db.comments.some(c=>String(c.id)===parentId))return res.status(404).json({message:"Commentaire parent introuvable."});
  const comment={id:createId(),pseudo:user.pseudo,text,parentId,createdAt:Date.now(),likes:[]};
  db.comments.push(comment);
  saveDatabase();
  io.emit("commentCreated",publicComment(comment));
  res.json({message:"Commentaire publié.",comment:publicComment(comment)});
});

app.post("/api/comments/:id/like",(req,res)=>{
  const user=findUser(req.body.pseudo);
  const comment=db.comments.find(c=>String(c.id)===String(req.params.id));
  if(!user)return res.status(404).json({message:"Utilisateur introuvable."});
  if(!comment)return res.status(404).json({message:"Commentaire introuvable."});
  comment.likes=Array.isArray(comment.likes)?comment.likes.map(String):[];
  const key=normalizePseudo(user.pseudo);
  const index=comment.likes.findIndex(x=>normalizePseudo(x)===key);
  let liked;
  if(index>=0){comment.likes.splice(index,1);liked=false;}else{comment.likes.push(user.pseudo);liked=true;}
  saveDatabase();
  io.emit("commentUpdated",publicComment(comment));
  res.json({liked,comment:publicComment(comment)});
});

/* =========================================
   API : ADMIN
========================================= */

app.get("/api/admin/users/:pseudo", (req,res)=>{
  if(!requireAdminPanel(req,res)) return;
  const search=String(req.params.pseudo||"").trim();
  const user=search.toUpperCase().startsWith("LG-") ? findUserByIdentifier(search) : findUser(search);
  if(!user) return res.status(404).json({message:"Joueur introuvable."});
  res.json({user:publicUser(user)});
});

app.post(
  "/api/admin/reward",
  (req, res) => {
    const {
      adminPseudo,
      targetPseudo,
      coins,
      xp,
      trophies,
      halloweenCandy,
      classId
    } = req.body;

    if (!isAnyAdminPseudo(adminPseudo)) {
      return res.status(403).json({message:"Accès réservé aux administrateurs."});
    }

    const user = findUser(targetPseudo) || findUserByIdentifier(targetPseudo);

    if (!user) {
      return res
        .status(404)
        .json({
          message:
            "Joueur introuvable."
        });
    }

    if (
      classId &&
      !CLASSES.some(
        (classe) =>
          classe.id === classId
      )
    ) {
      return res
        .status(400)
        .json({
          message:
            "Classe invalide."
        });
    }

    const reward = {
      coins:
        Math.max(
          0,
          Number(coins || 0)
        ),

      xp:
        Math.max(
          0,
          Number(xp || 0)
        ),

      trophies:
        Math.max(
          0,
          Number(trophies || 0)
        ),

      halloweenCandy: Math.max(0, Number(halloweenCandy || 0)),

      classId:
        classId || ""
    };

    ensureUserState(user);
    applyReward(user,reward);
    addNotification(user.pseudo,{title:"🎁 Cadeau du créateur",message:`Le créateur du jeu vous a offert ${rewardDescription(reward)}. Le cadeau a été ajouté à votre compte !`,type:"creatorGift"});
    saveDatabase();

    const socketId =
      onlineUsers.get(
        normalizePseudo(
          user.pseudo
        )
      );

    if (socketId) {
      io.to(socketId).emit(
        "profileUpdated",
        publicUser(user)
      );
    }

    res.json({
      message:
        "Récompense envoyée !",

      user:
        publicUser(user)
    });
  }
);


app.get("/api/admin/personal-events",(req,res)=>{
  if(normalizePseudo(req.query.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});
  res.json({events:getPersonalEventDefinitions(),durationMinutes:10});
});

app.post("/api/admin/personal-event",(req,res)=>{
  if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});
  const target=findUser(req.body.targetPseudo);
  if(!target)return res.status(404).json({message:"Joueur introuvable."});
  const eventId=String(req.body.eventId||"");
  const definition=getPersonalEventDefinitions().find(e=>e.id===eventId);
  if(!definition)return res.status(400).json({message:"Événement invalide."});
  ensurePersonalEvents(target);
  const until=Date.now()+10*60*1000;
  target.personalEvents[eventId]={until};
  addNotification(target.pseudo,{title:"⚡ Événement offert par le créateur",message:`Le créateur du jeu vous a offert ${definition.name} pendant 10 minutes !`,type:"creatorEvent"});
  saveDatabase();
  emitProfile(target);
  res.json({message:`${definition.name} offert à ${target.pseudo} pendant 10 minutes.`,event:{...definition,until},user:publicUser(target)});
});


/* =========================================
   ADMIN : RÉCOMPENSER TOUS LES JOUEURS
========================================= */

app.post(
  "/api/admin/reward-all",
  (req, res) => {
    const {
      adminPseudo,
      coins,
      xp,
      trophies,
      halloweenCandy,
      classId,
      onlineOnly
    } = req.body;

    if (
      normalizePseudo(
        adminPseudo
      ) !== ADMIN_PSEUDO
    ) {
      return res
        .status(403)
        .json({
          message:
            "Accès refusé."
        });
    }

    if (
      classId &&
      !CLASSES.some(
        (classe) =>
          classe.id === classId
      )
    ) {
      return res
        .status(400)
        .json({
          message:
            "Classe invalide."
        });
    }

    const reward = {
      coins:
        Math.max(
          0,
          Number(coins || 0)
        ),

      xp:
        Math.max(
          0,
          Number(xp || 0)
        ),

      trophies:
        Math.max(
          0,
          Number(trophies || 0)
        ),

      halloweenCandy: Math.max(0, Number(halloweenCandy || 0)),

      classId:
        classId || ""
    };

    let count = 0;

    db.users.forEach(
      (user) => {
        if (
          onlineOnly &&
          !isUserOnline(
            user.pseudo
          )
        ) {
          return;
        }

        ensureUserState(user);
        applyReward(user,reward);
        addNotification(user.pseudo,{title:"🎁 Cadeau du créateur",message:`Le créateur du jeu vous a offert ${rewardDescription(reward)}. Le cadeau a été ajouté à votre compte !`,type:"creatorGift"});

        const socketId =
          onlineUsers.get(
            normalizePseudo(
              user.pseudo
            )
          );

        if (socketId) {
          io.to(socketId).emit(
            "profileUpdated",
            publicUser(user)
          );
        }

        count++;
      }
    );

    saveDatabase();

    res.json({
      message:
        `Récompense envoyée à ${count} joueur(s).`
    });
  }
);



function normalizePromoCode(value){ return String(value||"").trim().toUpperCase().replace(/\s+/g,""); }
function publicPromoCode(code){
  if(!code)return null;
  return {code:code.code,reward:code.reward||{},maxUses:Number(code.maxUses||0),uses:Number(code.uses||0),active:code.active!==false,createdAt:Number(code.createdAt||0),remaining:Number(code.maxUses||0)>0?Math.max(0,Number(code.maxUses)-Number(code.uses||0)):null};
}
function promoRewardDescription(reward={}){
  const parts=[]; const coins=Math.max(0,Number(reward.coins||0)),xp=Math.max(0,Number(reward.xp||0)),trophies=Math.max(0,Number(reward.trophies||0)),candy=Math.max(0,Number(reward.halloweenCandy||0));
  if(coins)parts.push(`${coins} 🪙`); if(xp)parts.push(`${xp} XP`); if(trophies)parts.push(`${trophies} 🏆`); if(candy)parts.push(`${candy} 🍬`); if(reward.classId)parts.push(`classe ${reward.classId}`); if(reward.title)parts.push(`titre « ${reward.title} »`);
  return parts.join(" + ")||"récompense";
}
function sanitizePromoReward(body={}){
  const type=String(body.rewardType||""); const amount=Math.max(0,Math.floor(Number(body.amount||0))); const r={coins:0,xp:0,trophies:0,halloweenCandy:0,classId:"",title:""};
  if(type==="coins")r.coins=amount; else if(type==="xp")r.xp=amount; else if(type==="trophies")r.trophies=amount; else if(type==="halloweenCandy")r.halloweenCandy=amount; else if(type==="class")r.classId=String(body.classId||"").trim(); else if(type==="title")r.title=String(body.title||"").trim().slice(0,80); else return null;
  if(type!=="class"&&type!=="title"&&amount<=0)return null;
  if(type==="class"&&!CLASSES.some(c=>c.id===r.classId))return null;
  if(type==="title"&&!r.title)return null;
  return r;
}
app.get("/api/promo-codes",(req,res)=>{
  const user=findUser(req.query.pseudo||""); if(!user)return res.status(404).json({message:"Utilisateur introuvable."});
  res.json({usedCodes:Array.isArray(user.usedPromoCodes)?user.usedPromoCodes:[]});
});
app.post("/api/promo-codes/redeem",(req,res)=>{
  const user=findUser(req.body.pseudo), codeText=normalizePromoCode(req.body.code);
  if(!user)return res.status(404).json({message:"Utilisateur introuvable."});
  if(!codeText)return res.status(400).json({message:"Entre un code."});
  const code=db.promoCodes?.[codeText];
  if(!code||code.active===false)return res.status(404).json({message:"Code invalide ou supprimé."});
  ensureUserState(user);
  user.usedPromoCodes=Array.isArray(user.usedPromoCodes)?user.usedPromoCodes:[];
  if(user.usedPromoCodes.includes(codeText))return res.status(400).json({message:"Tu as déjà utilisé ce code sur ce compte."});
  const maxUses=Number(code.maxUses||0), uses=Number(code.uses||0);
  if(maxUses>0&&uses>=maxUses)return res.status(400).json({message:"Ce code a atteint sa limite d'utilisation."});
  const reward=code.reward||{};
  if(reward.classId&&!CLASSES.some(c=>c.id===reward.classId))return res.status(400).json({message:"La récompense de ce code n'est plus disponible."});
  if(reward.title){user.titles=user.titles||["Nouveau Villageois"];if(user.titles.includes(reward.title))return res.status(400).json({message:"Tu possèdes déjà le titre de ce code."});}
  applyReward(user,{coins:Math.max(0,Number(reward.coins||0)),xp:Math.max(0,Number(reward.xp||0)),trophies:Math.max(0,Number(reward.trophies||0)),halloweenCandy:Math.max(0,Number(reward.halloweenCandy||0)),classId:reward.classId||""});
  if(reward.title)user.titles.push(reward.title);
  user.usedPromoCodes.push(codeText); code.uses=uses+1; code.lastUsedAt=Date.now(); code.lastUsedBy=user.pseudo;
  saveDatabase(); emitProfile(user);
  addNotification(user.pseudo,{title:"🎁 Code utilisé",message:`Code ${codeText} accepté : ${promoRewardDescription(reward)}.`,type:"promoCode"});
  res.json({message:`Code accepté ! Tu as reçu ${promoRewardDescription(reward)}.`,user:publicUser(user)});
});
app.get("/api/admin/promo-codes",(req,res)=>{
  if(normalizePseudo(req.query.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});
  res.json({codes:Object.values(db.promoCodes||{}).map(publicPromoCode).sort((a,b)=>String(a.code).localeCompare(String(b.code)))});
});
app.post("/api/admin/promo-codes",(req,res)=>{
  if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});
  const code=normalizePromoCode(req.body.code); if(!/^[A-Z0-9_-]{3,32}$/.test(code))return res.status(400).json({message:"Code invalide : 3 à 32 caractères, lettres/chiffres/_/- uniquement."});
  if(db.promoCodes?.[code])return res.status(400).json({message:"Ce code existe déjà."});
  const reward=sanitizePromoReward(req.body); if(!reward)return res.status(400).json({message:"Récompense invalide ou incomplète."});
  const rawLimit=Number(req.body.maxUses||0); const maxUses=Number.isFinite(rawLimit)&&rawLimit>0?Math.floor(rawLimit):0;
  db.promoCodes=db.promoCodes||{}; db.promoCodes[code]={code,reward,maxUses,uses:0,active:true,createdAt:Date.now()}; saveDatabase();
  res.json({message:`Code ${code} créé.`,code:publicPromoCode(db.promoCodes[code])});
});
app.delete("/api/admin/promo-codes/:code",(req,res)=>{
  if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});
  const code=normalizePromoCode(req.params.code); if(!db.promoCodes?.[code])return res.status(404).json({message:"Code introuvable."});
  delete db.promoCodes[code]; saveDatabase(); res.json({message:`Code ${code} supprimé.`});
});

app.post("/api/recovery/request", (req,res)=>{
  const identifier=String(req.body.identifier||"").trim();
  if(!identifier) return res.status(400).json({message:"Entre ton identifiant de compte."});
  const user=findUserByIdentifier(identifier);
  if(user && normalizePseudo(user.pseudo)===ADMIN_PSEUDO) return res.status(403).json({message:"Tu n’as pas accès au compte du créateur."});
  if(!user) return res.status(404).json({message:"Identifiant introuvable. Vérifie ton identifiant de compte."});
  const existing=(db.recoveryRequests||[]).find(r=>r.identifier===userIdentifier(user)&&!r.usedAt);
  const request=existing||{id:createId(),identifier:userIdentifier(user),pseudo:user.pseudo,createdAt:Date.now(),status:"ready",approvedAt:0,usedAt:0,token:""};
  if(!request.token) request.token=`REC-${createId()}-${createId()}`;
  request.status="ready";
  db.recoveryRequests=db.recoveryRequests||[];
  if(!existing) db.recoveryRequests.push(request);
  saveDatabase();
  const adminOnline=isUserOnline(ADMIN_PSEUDO);
  addNotification(ADMIN_PSEUDO,{title:"🆘 Récupération de compte",message:`${user.pseudo} a demandé une récupération automatique (${userIdentifier(user)}).`,type:"recoveryRequest",action:{type:"recoveryRequest",requestId:request.id,identifier:request.identifier}});
  res.json({message:"Identifiant vérifié. Tu peux récupérer automatiquement ton compte avec le bouton ci-dessous.",requestId:request.id,token:request.token,adminOnline});
});

app.post("/api/recovery/claim", (req,res)=>{
  const request=(db.recoveryRequests||[]).find(r=>String(r.token||"")===String(req.body.token||"") && !r.usedAt);
  if(!request) return res.status(400).json({message:"Cette récupération n’est plus disponible."});
  const user=findUserByIdentifier(request.identifier);
  if(!user) return res.status(404).json({message:"Compte introuvable."});
  if(normalizePseudo(user.pseudo)===ADMIN_PSEUDO) return res.status(403).json({message:"Tu n’as pas accès au compte du créateur."});
  request.usedAt=Date.now(); request.status="used"; request.token="";
  saveDatabase();
  res.json({message:"Compte récupéré.",user:publicUser(user)});
});

app.post("/api/admin/recovery/approve", async (req,res)=>{
  if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});
  const identifier=String(req.body.identifier||"").trim();
  const user=findUserByIdentifier(identifier);
  if(user && normalizePseudo(user.pseudo)===ADMIN_PSEUDO)return res.status(403).json({message:"Tu n’as pas accès au compte du créateur."});
  if(!user)return res.status(404).json({message:"Joueur introuvable."});
  const request=(db.recoveryRequests||[]).find(r=>r.identifier===userIdentifier(user)&&!r.usedAt);
  if(!request)return res.status(404).json({message:"Aucune demande de récupération en attente pour cet identifiant."});
  request.approvedAt=Date.now(); request.status="approved"; request.token=`REC-${createId()}-${createId()}`;
  await saveDatabase();
  addNotification(user.pseudo,{title:"🔐 Récupération de compte validée",message:"Le créateur a validé ta demande. Tu peux récupérer ton compte avec le bouton ci-dessous.",type:"recoveryApproved",action:{type:"recoveryApproved",token:request.token}});
  res.json({message:"Récupération validée. Le joueur a reçu son bouton de reconnexion.",requestId:request.id});
});

app.get("/api/halloween/challenge",(req,res)=>{res.set("Cache-Control","no-store");res.json({challenge:getHalloweenChallengeStatus()});});

app.get("/api/updates",(req,res)=>{
  res.json({updates:(db.updateHistory||[]).slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")))});
});
app.post("/api/admin/updates",async(req,res)=>{
  if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});
  const version=String(req.body.version||"").trim();
  const date=String(req.body.date||"").trim();
  const features=String(req.body.features||"");
  if(!version||!date||!features.trim())return res.status(400).json({message:"Version, date et contenu sont obligatoires."});
  const item={id:createId(),version,date,features,createdAt:Date.now(),updatedAt:Date.now()};
  db.updateHistory=db.updateHistory||[]; db.updateHistory.push(item); await saveDatabase(); res.json({message:"Mise à jour ajoutée.",update:item});
});
app.put("/api/admin/updates/:id",async(req,res)=>{
  if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});
  const item=(db.updateHistory||[]).find(x=>String(x.id)===String(req.params.id));
  if(!item)return res.status(404).json({message:"Mise à jour introuvable."});
  if(req.body.version!==undefined)item.version=String(req.body.version).trim();
  if(req.body.date!==undefined)item.date=String(req.body.date).trim();
  if(req.body.features!==undefined)item.features=String(req.body.features);
  item.updatedAt=Date.now(); await saveDatabase(); res.json({message:"Mise à jour modifiée.",update:item});
});

/* =========================================
   ADMIN : GESTION DES COMPTES / ADMIN RÉDUIT
========================================= */
app.post("/api/admin/create-account", async (req,res)=>{
  if(!isAnyAdminPseudo(req.body.adminPseudo)) return res.status(403).json({message:"Accès réservé aux administrateurs."});
  try{
    const clean=cleanPseudo(req.body.pseudo);
    const email=String(req.body.email||"").trim().toLowerCase();
    const password=String(req.body.password||"");
    if(clean.length<3||clean.length>20)return res.status(400).json({message:"Le pseudo doit contenir entre 3 et 20 caractères."});
    if(!email.includes("@"))return res.status(400).json({message:"Adresse e-mail invalide."});
    if(password.length<4)return res.status(400).json({message:"Le mot de passe doit contenir au moins 4 caractères."});
    if(findUser(clean))return res.status(400).json({message:"Ce pseudo existe déjà."});
    if(db.users.some(u=>String(u.email||"").toLowerCase()===email))return res.status(400).json({message:"Cette adresse e-mail est déjà utilisée."});
    const user={id:createId(),pseudo:clean,email,password:await bcrypt.hash(password,10),icon:"🐺",title:"Nouveau Villageois",titles:["Nouveau Villageois"],equippedTitle:"Nouveau Villageois",level:1,xp:0,coins:50,halloweenCandy:0,halloweenBoxes:{haunted:0,cursed:0,nocturnal:0},trophies:0,rank:"Bois",classes:["wolf1"],equippedClass:null,gamesPlayed:0,gamesWon:0,createdAt:Date.now(),questStats:{},claimedQuests:[],rankedSeason:getRankedSeasonKey(),rankedPoints:0,rankedWins:0,rankedRank:"Bois",chatEnabled:true};
    db.users.push(user); ensureUserState(user); saveDatabase(); addNotification(user.pseudo,{title:"Bienvenue !",message:"Vous avez reçu 50 pièces 🐺.",type:"reward"});
    res.json({message:`Compte ${user.pseudo} créé avec succès.`,user:publicUser(user)});
  }catch(e){console.error(e);res.status(500).json({message:"Erreur serveur."});}
});
app.post("/api/admin/account-admin-role",(req,res)=>{
  if(!requireFullAdmin(req,res)) return;
  const target=findUser(req.body.targetPseudo)||findUserByIdentifier(req.body.targetPseudo);
  if(!target)return res.status(404).json({message:"Joueur introuvable."});
  if(isFullAdminPseudo(target.pseudo))return res.status(400).json({message:"Le compte créateur ne peut pas être modifié."});
  const enabled=req.body.enabled!==false;
  if(enabled)target.adminRole="reduced"; else delete target.adminRole;
  saveDatabase(); emitProfile(target);
  res.json({message:enabled?`Panel admin réduit accordé à ${target.pseudo}.`:`Panel admin réduit retiré à ${target.pseudo}.`,user:publicUser(target)});
});
app.delete("/api/admin/users/:pseudo",(req,res)=>{
  if(!requireFullAdmin(req,res)) return;
  const search=String(req.params.pseudo||"").trim();
  const target=search.toUpperCase().startsWith("LG-")?findUserByIdentifier(search):findUser(search);
  if(!target)return res.status(404).json({message:"Joueur introuvable."});
  if(isFullAdminPseudo(target.pseudo))return res.status(400).json({message:"Le compte créateur ne peut pas être supprimé."});
  const key=normalizePseudo(target.pseudo); const socketId=onlineUsers.get(key);
  if(socketId){ try{ io.sockets.sockets.get(socketId)?.emit("forceLogout",{message:"Ton compte a été supprimé par l'administrateur."}); io.sockets.sockets.get(socketId)?.disconnect(true); }catch(_){} onlineUsers.delete(key); }
  db.users=db.users.filter(u=>u!==target);
  db.friendships=db.friendships.filter(f=>normalizePseudo(f.user1)!==key&&normalizePseudo(f.user2)!==key);
  db.friendRequests=db.friendRequests.filter(r=>normalizePseudo(r.fromPseudo)!==key&&normalizePseudo(r.toPseudo)!==key);
  db.messages=db.messages.filter(m=>normalizePseudo(m.from)!==key&&normalizePseudo(m.to)!==key);
  db.notifications=db.notifications.filter(n=>normalizePseudo(n.pseudo)!==key);
  db.recoveryRequests=(db.recoveryRequests||[]).filter(r=>normalizePseudo(r.pseudo)!==key);
  saveDatabase(); io.emit("userDeleted",{pseudo:target.pseudo});
  res.json({message:`Compte ${target.pseudo} supprimé définitivement.`});
});

app.get("/api/admin/bootstrap",(req,res)=>{
  if(!isAnyAdminPseudo(req.query.adminPseudo))return res.status(403).json({message:"Accès réservé aux administrateurs."});
  const role=getAdminRoleFromPseudo(req.query.adminPseudo);
  const base={users:db.users.map(publicUser),classes:getPublicClasses(),role};
  if(role==="full") Object.assign(base,{announcement:db.announcements,globalBoosts:getGlobalBoostPayload(),halloween:getHalloweenStatus(),maintenance:getMaintenanceStatus(),v26Release:db.v26Release||{active:false,version:25,updatedAt:0},promoCodes:Object.values(db.promoCodes||{}).map(publicPromoCode),recoveryRequests:(db.recoveryRequests||[]).filter(r=>!r.approvedAt&&!r.usedAt).map(r=>({id:r.id,identifier:r.identifier,pseudo:r.pseudo,createdAt:r.createdAt,status:r.status||"pending"})),updates:(db.updateHistory||[]).slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))),halloweenChallenge:getHalloweenChallengeStatus(),classDiscount:{percent:getClassDiscountPercent(),until:Number(db.classDiscount?.until||0)}});
  res.json(base);
});

app.post("/api/admin/reward-all-now",(req,res)=>{
  if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});
  const reward={coins:Math.max(0,Number(req.body.coins||0)),xp:Math.max(0,Number(req.body.xp||0)),trophies:Math.max(0,Number(req.body.trophies||0)),halloweenCandy:Math.max(0,Number(req.body.halloweenCandy||0)),classId:req.body.classId||""};
  if(reward.classId&&!CLASSES.some(c=>c.id===reward.classId))return res.status(400).json({message:"Classe invalide."});

  let count=0;
  db.users.forEach(u=>{
    // Par défaut, TOUS les comptes reçoivent réellement le cadeau,
    // même s'ils sont hors ligne. Le checkbox onlineOnly reste disponible
    // uniquement si l'admin veut volontairement limiter l'envoi.
    if(req.body.onlineOnly&&!isUserOnline(u.pseudo))return;
    ensureUserState(u);
    applyReward(u,reward);
    addNotification(u.pseudo,{
      title:"🎁 Cadeau du créateur",
      message:`Le créateur du jeu vous a offert ${rewardDescription(reward)}. Le cadeau a été ajouté à votre compte !`,
      type:"creatorGift"
    });
    const socketId=onlineUsers.get(normalizePseudo(u.pseudo));
    if(socketId)io.to(socketId).emit("profileUpdated",publicUser(u));
    count++;
  });

  saveDatabase();
  res.json({message:`Cadeau reçu par ${count} joueur(s).`,count});
});



app.get("/api/release",(req,res)=>res.json({v26Release:db.v26Release||{active:false,version:25,updatedAt:0}}));

app.post("/api/admin/class-discount",(req,res)=>{if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO)return res.status(403).json({message:"Accès refusé."});const pct=Number(req.body.percent||0);if(![0,10,25,50,75].includes(pct))return res.status(400).json({message:"Réduction invalide."});const discount=setClassDiscount(pct,Number(req.body.durationMinutes||10));res.json({message:pct?`🎟️ Réduction classes de ${pct}% activée.`:"🎟️ Réduction classes désactivée.",classDiscount:discount});});

app.post("/api/admin/global-boost", (req,res)=>{
  if(normalizePseudo(req.body.adminPseudo)!==ADMIN_PSEUDO){
    return res.status(403).json({message:"Accès refusé."});
  }

  const type=String(req.body.type||"");
  const allowed=["coins","xp","trophies"];
  const multiplier=Number(req.body.multiplier||1);
  const durationMinutes=Math.max(1,Math.min(1440,Number(req.body.durationMinutes||10)));

  if(!allowed.includes(type)){
    return res.status(400).json({message:"Type de bonus invalide."});
  }
  if(![1,2,4,5,10].includes(multiplier)){
    return res.status(400).json({message:"Multiplicateur invalide."});
  }

  if(multiplier===1){
    db.globalBoosts[type]={multiplier:1,until:0};
  }else{
    db.globalBoosts[type]={
      multiplier,
      until:Date.now()+durationMinutes*60*1000
    };
  }

  saveDatabase();
  io.emit("globalBoostUpdated",{type,boost:db.globalBoosts[type]});

  res.json({
    message: multiplier===1
      ? `Bonus ${type} désactivé.`
      : `Bonus ${type} x${multiplier} activé pendant ${durationMinutes} minutes.`,
    globalBoosts:getGlobalBoostPayload()
  });
});

/* =========================================
   API : AMIS
========================================= */

app.get(
  "/api/friends/:pseudo",
  (req, res) => {
    const pseudo =
      req.params.pseudo;

    const friends =
      db.friendships
        .filter(
          (friendship) =>
            normalizePseudo(
              friendship.user1
            ) ===
              normalizePseudo(pseudo) ||
            normalizePseudo(
              friendship.user2
            ) ===
              normalizePseudo(pseudo)
        )
        .map(
          (friendship) => {
            const friendPseudo =
              normalizePseudo(
                friendship.user1
              ) ===
              normalizePseudo(pseudo)
                ? friendship.user2
                : friendship.user1;

            const friend =
              findUser(
                friendPseudo
              );

            const room =
              db.rooms.find(
                (item) =>
                  item.players.some(
                    (player) =>
                      normalizePseudo(
                        player.pseudo
                      ) ===
                      normalizePseudo(
                        friendPseudo
                      )
                  )
              );

            return {
              user:
                publicUser(friend),

              online:
                isUserOnline(
                  friendPseudo
                ),

              inRoom:
                Boolean(room),

              roomCode:
                room
                  ? room.code
                  : null
            };
          }
        );

    res.json({
      friends
    });
  }
);

app.post(
  "/api/friends/request",
  (req, res) => {
    const {
      fromPseudo,
      toPseudo
    } = req.body;

    const from =
      findUser(fromPseudo);

    const to =
      findUser(toPseudo);

    if (
      !from ||
      !to
    ) {
      return res
        .status(404)
        .json({
          message:
            "Utilisateur introuvable."
        });
    }

    if (
      normalizePseudo(
        from.pseudo
      ) ===
      normalizePseudo(
        to.pseudo
      )
    ) {
      return res
        .status(400)
        .json({
          message:
            "Tu ne peux pas t'ajouter toi-même."
        });
    }

    const exists =
      db.friendships.some(
        (item) =>
          (
            normalizePseudo(
              item.user1
            ) ===
            normalizePseudo(from.pseudo) &&
            normalizePseudo(
              item.user2
            ) ===
            normalizePseudo(to.pseudo)
          ) ||
          (
            normalizePseudo(
              item.user2
            ) ===
            normalizePseudo(from.pseudo) &&
            normalizePseudo(
              item.user1
            ) ===
            normalizePseudo(to.pseudo)
          )
      );

    if (exists) {
      return res
        .status(400)
        .json({
          message:
            "Vous êtes déjà amis."
        });
    }

    const requestExists =
      db.friendRequests.some(
        (item) =>
          normalizePseudo(
            item.fromPseudo
          ) ===
          normalizePseudo(
            from.pseudo
          ) &&
          normalizePseudo(
            item.toPseudo
          ) ===
          normalizePseudo(
            to.pseudo
          )
      );

    if (requestExists) {
      return res
        .status(400)
        .json({
          message:
            "Demande déjà envoyée."
        });
    }

    const request = {
      id: createId(),

      fromPseudo:
        from.pseudo,

      toPseudo:
        to.pseudo,

      type: "friend",

      createdAt:
        Date.now()
    };

    db.friendRequests.push(
      request
    );

    saveDatabase();

    addNotification(
      to.pseudo,
      {
        title:
          "👥 Demande d'ami",

        message:
          `${from.pseudo} souhaite devenir votre ami.`,

        type:"friendRequest",
        action:{requestId:request.id,fromPseudo:request.fromPseudo}
      }
    );

    res.json({
      message:
        "Demande envoyée."
    });
  }
);

app.get(
  "/api/friends/requests/:pseudo",
  (req, res) => {
    const requests =
      db.friendRequests.filter(
        (request) =>
          normalizePseudo(
            request.toPseudo
          ) ===
          normalizePseudo(
            req.params.pseudo
          )
      );

    res.json({
      requests
    });
  }
);

app.post(
  "/api/friends/respond",
  (req, res) => {
    const {
      pseudo,
      requestId,
      accept
    } = req.body;

    const request =
      db.friendRequests.find(
        (item) =>
          item.id === requestId &&
          normalizePseudo(
            item.toPseudo
          ) ===
          normalizePseudo(pseudo)
      );

    if (!request) {
      return res
        .status(404)
        .json({
          message:
            "Demande introuvable."
        });
    }

    db.friendRequests =
      db.friendRequests.filter(
        (item) =>
          item.id !== request.id
      );

    if (accept) {
      db.friendships.push({
        id: createId(),
        user1: request.fromPseudo,
        user2: request.toPseudo,
        createdAt: Date.now()
      });
      const acceptedFrom=findUser(request.fromPseudo), acceptedTo=findUser(request.toPseudo);
      if(acceptedFrom)registerQuestStat(acceptedFrom,"friendsAdded",1);
      if(acceptedTo)registerQuestStat(acceptedTo,"friendsAdded",1);
    }

    saveDatabase();

    res.json({
      message:
        accept
          ? "Ami ajouté !"
          : "Demande refusée."
    });
  }
);


/* =========================================
   API : CHAT AMIS
========================================= */

app.get(
  "/api/chat/:pseudo/:friendPseudo",
  (req, res) => {
    const {
      pseudo,
      friendPseudo
    } = req.params;

    const a=findUser(pseudo), b=findUser(friendPseudo);
    if(!a||!b||!areFriends(a.pseudo,b.pseudo)||a.chatEnabled===false||b.chatEnabled===false||!(Array.isArray(a.chatAllowed)&&Array.isArray(b.chatAllowed)&&a.chatAllowed.includes(normalizePseudo(b.pseudo))&&b.chatAllowed.includes(normalizePseudo(a.pseudo)))){
      return res.status(403).json({message:"Le chat n'est pas autorisé entre ces deux joueurs."});
    }

    const messages =
      db.messages.filter(
        (message) =>
          (
            normalizePseudo(
              message.from
            ) ===
            normalizePseudo(pseudo) &&
            normalizePseudo(
              message.to
            ) ===
            normalizePseudo(friendPseudo)
          ) ||
          (
            normalizePseudo(
              message.from
            ) ===
            normalizePseudo(friendPseudo) &&
            normalizePseudo(
              message.to
            ) ===
            normalizePseudo(pseudo)
          )
      );

    res.json({
      messages
    });
  }
);

app.post("/api/chat/send",(req,res)=>{
  const from=findUser(req.body.fromPseudo),to=findUser(req.body.toPseudo);
  if(!from||!to||!areFriends(from.pseudo,to.pseudo))return res.status(403).json({message:"Le chat est réservé aux amis."});
  if(from.chatEnabled===false||to.chatEnabled===false)return res.status(403).json({message:"Le chat est désactivé."});
  const allowed=Array.isArray(from.chatAllowed)&&Array.isArray(to.chatAllowed)&&from.chatAllowed.includes(normalizePseudo(to.pseudo))&&to.chatAllowed.includes(normalizePseudo(from.pseudo));
  if(!allowed)return res.status(403).json({message:"Vous devez accepter la demande de chat."});
  const content=filterChatText(req.body.text);
  if(!content)return res.status(400).json({message:"Message vide."});
  const message={id:createId(),from:from.pseudo,to:to.pseudo,text:content,createdAt:Date.now()};
  db.messages.push(message); saveDatabase();
  const socketId=onlineUsers.get(normalizePseudo(to.pseudo));
  if(socketId)io.to(socketId).emit("friendMessage",message);
  res.json({message});
});

/* =========================================
   API : PARAMÈTRES
========================================= */

app.post(
  "/api/settings/chat",
  (req, res) => {
    const {
      pseudo,
      chatEnabled
    } = req.body;

    const user =
      findUser(pseudo);

    if (!user) {
      return res
        .status(404)
        .json({
          message:
            "Utilisateur introuvable."
        });
    }

    user.chatEnabled =
      Boolean(chatEnabled);

    saveDatabase();

    res.json({
      message:
        "Paramètre enregistré.",

      user:
        publicUser(user)
    });
  }
);


app.get("/api/chat/status/:pseudo/:friendPseudo",(req,res)=>{
  const a=findUser(req.params.pseudo),b=findUser(req.params.friendPseudo); if(!a||!b)return res.status(404).json({message:"Utilisateur introuvable."});
  const allowed=areFriends(a.pseudo,b.pseudo)&&a.chatEnabled!==false&&b.chatEnabled!==false; const pending=db.friendRequests.some(r=>r.type==="chat"&&normalizePseudo(r.fromPseudo)===normalizePseudo(a.pseudo)&&normalizePseudo(r.toPseudo)===normalizePseudo(b.pseudo)); res.json({allowed,pending});
});
app.post("/api/chat/request",(req,res)=>{const from=findUser(req.body.fromPseudo),to=findUser(req.body.toPseudo);if(!from||!to)return res.status(404).json({message:"Utilisateur introuvable."});if(!areFriends(from.pseudo,to.pseudo))return res.status(403).json({message:"Vous devez être amis."});if(from.chatEnabled===false||to.chatEnabled===false)return res.status(403).json({message:"Le chat est désactivé."});if(db.friendRequests.some(r=>r.type==="chat"&&normalizePseudo(r.fromPseudo)===normalizePseudo(from.pseudo)&&normalizePseudo(r.toPseudo)===normalizePseudo(to.pseudo)))return res.status(400).json({message:"Demande déjà envoyée."});const r={id:createId(),fromPseudo:from.pseudo,toPseudo:to.pseudo,type:"chat",createdAt:Date.now()};db.friendRequests.push(r);addNotification(to.pseudo,{title:"💬 Demande de chat",message:`${from.pseudo} souhaite discuter avec toi.`,type:"chatRequest",requestId:r.id});saveDatabase();res.json({message:"Demande de chat envoyée."});});
app.post("/api/chat/respond",(req,res)=>{const r=db.friendRequests.find(x=>x.id===req.body.requestId&&x.type==="chat"&&normalizePseudo(x.toPseudo)===normalizePseudo(req.body.pseudo));if(!r)return res.status(404).json({message:"Demande introuvable."});db.friendRequests=db.friendRequests.filter(x=>x.id!==r.id);if(req.body.accept){const from=findUser(r.fromPseudo),to=findUser(r.toPseudo);from.chatAllowed=from.chatAllowed||[];to.chatAllowed=to.chatAllowed||[];if(!from.chatAllowed.includes(normalizePseudo(to.pseudo)))from.chatAllowed.push(normalizePseudo(to.pseudo));if(!to.chatAllowed.includes(normalizePseudo(from.pseudo)))to.chatAllowed.push(normalizePseudo(from.pseudo));addNotification(r.fromPseudo,{title:"💬 Chat accepté",message:`${r.toPseudo} a accepté ta demande de chat.`,type:"info"});}else{addNotification(r.fromPseudo,{title:"💬 Chat refusé",message:`${r.toPseudo} a refusé ta demande de chat.`,type:"info"});}saveDatabase();res.json({message:req.body.accept?"Chat accepté !":"Chat refusé."});});
app.post("/api/chat/send-safe",(req,res)=>{const from=findUser(req.body.fromPseudo),to=findUser(req.body.toPseudo);if(!from||!to||!areFriends(from.pseudo,to.pseudo))return res.status(403).json({message:"Le chat est réservé aux amis."});if(from.chatEnabled===false||to.chatEnabled===false)return res.status(403).json({message:"Le chat est désactivé."});const allowed=Array.isArray(from.chatAllowed)&&Array.isArray(to.chatAllowed)&&from.chatAllowed.includes(normalizePseudo(to.pseudo))&&to.chatAllowed.includes(normalizePseudo(from.pseudo)); if(!allowed)return res.status(403).json({message:"Vous devez accepter la demande de chat."});const msg={id:createId(),from:from.pseudo,to:to.pseudo,text:filterChatText(req.body.text),createdAt:Date.now()};db.messages.push(msg);saveDatabase();const sid=onlineUsers.get(normalizePseudo(to.pseudo));if(sid)io.to(sid).emit("chatMessage",msg);res.json({message:msg});});
app.post("/api/settings/chat",(req,res)=>{const u=findUser(req.body.pseudo);if(!u)return res.status(404).json({message:"Utilisateur introuvable."});u.chatEnabled=req.body.chatEnabled!==false;saveDatabase();res.json({message:"Paramètre du chat enregistré.",user:publicUser(u)});});

const SHOP_ITEMS=[
  {id:"double_coins",name:"x2 pièces",price:200,description:"x2 pièces pendant 10 minutes.",durationMs:10*60*1000},
  {id:"double_xp",name:"x2 XP",price:200,description:"x2 XP pendant 10 minutes.",durationMs:10*60*1000},
  {id:"double_trophies",name:"x2 trophées",price:200,description:"x2 trophées pendant 10 minutes.",durationMs:10*60*1000}
];
app.get("/api/shop",(req,res)=>{
  const st=getBloodMoonStatus();
  const items=[...SHOP_ITEMS];
  if(st.active)items.push({id:"blood_quarter",name:"Quart de Lune de Sang",price:500,description:"Ajoute un quart à ta progression de Lune de Sang."});
  const halloween=getHalloweenStatus();
  res.json({items,halloween:{active:Boolean(halloween.active),week:halloween.week,candy:0,shopItems:HALLOWEEN_SHOP_ITEMS}});
});
app.get("/api/halloween/boxes",(req,res)=>{
  const u=findUser(req.query.pseudo); if(!u)return res.status(404).json({message:"Compte introuvable."});
  const active=getHalloweenStatus().active;
  res.json({active,boxes:halloweenBoxPayload(u)});
});
app.post("/api/halloween/boxes/open",(req,res)=>{
  try{const u=findUser(req.body.pseudo); if(!u)return res.status(404).json({message:"Compte introuvable."}); const result=openHalloweenBox(u,String(req.body.type||"")); res.json(result);}
  catch(e){res.status(400).json({message:e.message});}
});
app.get("/api/halloween/shop",(req,res)=>{
  const u=findUser(req.query.pseudo);
  const st=getHalloweenStatus();
  if(!u)return res.status(404).json({message:"Utilisateur introuvable."});
  ensureUserState(u);
  if(!st.active){ if(Number(u.halloweenCandy||0)!==0){u.halloweenCandy=0;saveDatabase();} return res.json({active:false,candy:0,items:[]}); }
  res.json({active:true,week:st.week,candy:Number(u.halloweenCandy||0),items:HALLOWEEN_SHOP_ITEMS});
});
app.post("/api/halloween/shop/buy",(req,res)=>{
  const u=findUser(req.body.pseudo);
  const st=getHalloweenStatus();
  if(!u)return res.status(404).json({message:"Utilisateur introuvable."});
  if(!st.active)return res.status(400).json({message:"La boutique Halloween est fermée."});
  ensureUserState(u);
  const item=HALLOWEEN_SHOP_ITEMS.find(x=>x.id===req.body.itemId);
  if(!item)return res.status(404).json({message:"Article Halloween introuvable."});
  if(Number(u.halloweenCandy||0)<item.price)return res.status(400).json({message:"Pas assez de bonbons."});
  if(item.id==="halloween_title"){u.titles=u.titles||["Nouveau Villageois"];if(u.titles.includes("Maître des citrouilles"))return res.status(400).json({message:"Tu possèdes déjà ce titre."});}
  u.halloweenCandy-=item.price;
  if(item.id==="halloween_coins")u.coins=Number(u.coins||0)+250;
  if(item.id==="halloween_xp"){u.xp=Number(u.xp||0)+500;updateLevel(u);}
  if(item.id==="halloween_trophy")u.trophies=Number(u.trophies||0)+3;
  if(item.id==="halloween_title")u.titles.push("Maître des citrouilles");
  saveDatabase(); emitProfile(u);
  res.json({message:`${item.name} acheté !`,user:publicUser(u),candy:u.halloweenCandy});
});
app.post("/api/shop/buy",(req,res)=>{
  const u=findUser(req.body.pseudo);
  if(!u)return res.status(404).json({message:"Utilisateur introuvable."});
  ensureUserState(u);
  const st=getBloodMoonStatus();
  const id=req.body.itemId;
  const item=[...SHOP_ITEMS,...(st.active?[{id:"blood_quarter",name:"Quart de Lune de Sang",price:500}]:[])].find(x=>x.id===id);
  if(!item)return res.status(404).json({message:"Article indisponible."});
  if(Number(u.coins||0)<item.price)return res.status(400).json({message:"Pas assez de pièces."});
  u.coins-=item.price;
  const now=Date.now();
  if(id==="blood_quarter"){ addBloodMoonQuarter(u); }
  else { const key=`${id}_until`; const currentUntil=Number(u.boosts[key]||0); u.boosts[key]=Math.max(currentUntil,now)+item.durationMs; }
  saveDatabase(); emitProfile(u);
  res.json({message:id==="blood_quarter"?"Quart de Lune de Sang acheté !":"Achat effectué : bonus actif pendant 10 minutes !",user:publicUser(u),boosts:u.boosts});
});

app.post("/api/titles/equip",(req,res)=>{const u=findUser(req.body.pseudo);if(!u||!(u.titles||[]).includes(req.body.title))return res.status(400).json({message:"Titre indisponible."});u.equippedTitle=req.body.title;u.title=req.body.title;saveDatabase();res.json({message:"Titre équipé !",user:publicUser(u)});});


/* =========================================
   API : COMPTE
========================================= */

app.post(
  "/api/account/email",
  async (req, res) => {
    const {
      pseudo,
      email,
      password
    } = req.body;

    const user =
      findUser(pseudo);

    if (!user) {
      return res
        .status(404)
        .json({
          message:
            "Utilisateur introuvable."
        });
    }

    const valid =
      await bcrypt.compare(
        password || "",
        user.password
      );

    if (!valid) {
      return res
        .status(401)
        .json({
          message:
            "Mot de passe incorrect."
        });
    }

    user.email =
      String(email || "")
        .trim()
        .toLowerCase();

    saveDatabase();

    res.json({
      message:
        "Adresse e-mail modifiée."
    });
  }
);

app.post(
  "/api/account/delete",
  async (req, res) => {
    const {
      pseudo,
      password
    } = req.body;

    const user =
      findUser(pseudo);

    if (!user) {
      return res
        .status(404)
        .json({
          message:
            "Utilisateur introuvable."
        });
    }

    const valid =
      await bcrypt.compare(
        password || "",
        user.password
      );

    if (!valid) {
      return res
        .status(401)
        .json({
          message:
            "Mot de passe incorrect."
        });
    }

    const normalized =
      normalizePseudo(
        user.pseudo
      );

    db.users =
      db.users.filter(
        (item) =>
          normalizePseudo(
            item.pseudo
          ) !== normalized
      );

    db.friendships =
      db.friendships.filter(
        (item) =>
          normalizePseudo(
            item.user1
          ) !== normalized &&
          normalizePseudo(
            item.user2
          ) !== normalized
      );

    removeUserFromRooms(
      user.pseudo
    );

    saveDatabase();

    res.json({
      message:
        "Compte supprimé."
    });
  }
);


/* =========================================
   API : MOT DE PASSE
========================================= */

app.post(
  "/api/password/forgot",
  (req, res) => {
    const user =
      findUser(
        req.body.pseudo
      );

    /*
      Pour une vraie version publique,
      il faudra ajouter un système
      d'e-mail sécurisé.
    */

    if (!user) {
      return res
        .status(404)
        .json({
          message:
            "Joueur introuvable."
        });
    }

    res.json({
      message:
        "Fonction de récupération disponible prochainement."
    });
  }
);


function emitGameStart(room) {
  io.to(room.code).emit(
    "gameStarted",
    {
      room: roomPublic(room),
      phase: room.game.phase,
      day: room.game.day,
      players: room.game.players.map((player) => ({
        pseudo: player.pseudo,
        alive: player.alive,
        isBot: player.isBot
      }))
    }
  );

  room.game.players.forEach((player) => {
    if (player.isBot) return;

    const playerSocket = onlineUsers.get(
      normalizePseudo(player.pseudo)
    );

    if (playerSocket) {
      io.to(playerSocket).emit("yourRole", {
        role: player.role,
        classChance: player.classChance,
        teammates: []
      });
    }
  });
}

function launchRoomGame(room) {
  if (!room || room.status !== "waiting") return false;
  if(room.startingAt && Date.now()-room.startingAt<9000)return false;
  room.startingAt=null;
  addBotsToRoom(room);
  if (room.players.length < 8) return false;
  room.status = "playing";
  room.game = createGame(room);
  saveDatabase();
  emitGameStart(room);
  setTimeout(()=>startNightPhase(room),250);
  return true;
}

function randomAliveTarget(game, filterFn) {
  const list=getAlivePlayers(game).filter(filterFn||(()=>true)); return list.length?list[Math.floor(Math.random()*list.length)]:null;
}
const GAME_TIMERS = {
  cupid: 60000,
  wolves: 90000,
  seer: 60000,
  witch: 60000,
  day: 120000,
  pumpkin: 60000,
  giant: 60000
};

function aliveRole(game, role) {
  return game.players.find(p => p.alive && p.role === role) || null;
}

function applyLinkedDeaths(game) {
  const queue = game.players.filter(p => !p.alive && game.linkedPlayers.includes(p.pseudo));
  const killed = [];
  while (queue.length) {
    const dead = queue.shift();
    const linked = game.linkedPlayers.find(x => x !== dead.pseudo && game.linkedPlayers.includes(x));
    if (!linked) continue;
    const other = game.players.find(p => p.pseudo === linked);
    if (other && other.alive) {
      other.alive = false;
      killed.push(other.pseudo);
      queue.push(other);
    }
  }
  return killed;
}

function emitPublicGameState(room,event="gameState") {
  const g=room.game;if(!g)return;
  const voters=g.phase==="night" && g.nightStep==="wolves"
    ?g.players.filter(p=>p.alive&&p.role==="Loup-Garou")
    :g.phase==="day"?g.players.filter(p=>p.alive):[];
  const votes=g.phase==="night"?(g.nightVotes||{}):(g.dayVotes||{});
  io.to(room.code).emit(event,{
    phase:g.phase, day:g.day, winner:g.winner, nightStep:g.nightStep||null,
    players:g.players.map(p=>({pseudo:p.pseudo,alive:p.alive,isBot:p.isBot})),
    ranked:g.ranked, voteCount:Object.keys(votes).length, requiredVotes:voters.length,
    chat:(g.chat||[]).slice(-50),
    nightActionsAvailable:{wolvesVote:g.phase==="night"&&g.nightStep==="wolves",seer:g.phase==="night"&&g.nightStep==="seer",witch:g.phase==="night"&&g.nightStep==="witch",pumpkin:g.phase==="night"&&g.nightStep==="pumpkin",giant:g.phase==="night"&&g.nightStep==="giant",cupid:g.phase==="night"&&g.nightStep==="cupid"}
  });
}

function startNightPhase(room){
  const g=room.game;if(!g||g.phase==="finished")return;
  g.phase="night";
  g.nightVotes={};
  g.nightTargetPseudo=null;
  g.nightActions={saved:null,witchKill:null,pumpkinKills:[],giantKill:null};
  g.seerUsedThisNight=false;
  const cupid=aliveRole(g,"Cupidon");
  g.nightStep=(g.day===1 && cupid && !g.cupidUsed)?"cupid":"wolves";
  startNightStep(room,g.nightStep);
}

function startNightStep(room,step){
  const g=room.game;if(!g||g.phase!=="night")return;
  g.nightStep=step;
  emitPublicGameState(room,"nightStepStarted");
  const duration=GAME_TIMERS[step]||25000;
  io.to(room.code).emit("nightStepTimer",{step,duration});

  if(step==="cupid"){
    const cupid=aliveRole(g,"Cupidon");
    if(!cupid){g.cupidUsed=true;return startNightStep(room,"wolves");}
    if(cupid.isBot){
      setTimeout(()=>{
        if(room.game?.phase!=="night"||room.game.nightStep!=="cupid")return;
        const targets=getAlivePlayers(g).filter(p=>p.pseudo!==cupid.pseudo);
        if(targets.length>=2){
          const a=targets[Math.floor(Math.random()*targets.length)];
          const rest=targets.filter(p=>p.pseudo!==a.pseudo);
          const b=rest[Math.floor(Math.random()*rest.length)];
          g.linkedPlayers=[a.pseudo,b.pseudo];
        }
        g.cupidUsed=true;
        io.to(room.code).emit("cupidUsed",{message:"Cupidon a désigné deux joueurs."});
        startNightStep(room,"wolves");
      },1500);
    }
    setTimeout(()=>{if(room.game?.phase==="night"&&room.game.nightStep==="cupid"){g.cupidUsed=true;startNightStep(room,"wolves");}},duration);
    return;
  }

  if(step==="wolves"){
    const wolves=g.players.filter(p=>p.alive&&p.role==="Loup-Garou");
    wolves.filter(p=>p.isBot).forEach((bot,i)=>setTimeout(()=>{
      if(room.game?.phase!=="night"||room.game.nightStep!=="wolves")return;
      const target=randomAliveTarget(g,p=>p.role!=="Loup-Garou");
      if(target)g.nightVotes[bot.pseudo]=target.pseudo;
      emitPublicGameState(room,"voteUpdate");
      if(wolves.every(w=>g.nightVotes[w.pseudo])) finishNightWolves(room);
    },1200+i*800));
    setTimeout(()=>{
      if(room.game?.phase!=="night"||room.game.nightStep!=="wolves")return;
      wolves.forEach(w=>{if(!g.nightVotes[w.pseudo]){const t=randomAliveTarget(g,p=>p.role!=="Loup-Garou");if(t)g.nightVotes[w.pseudo]=t.pseudo;}});
      finishNightWolves(room);
    },duration);
    return;
  }

  if(step==="pumpkin"){
    const pumpkin=aliveRole(g,"Citrouille"); if(!pumpkin||g.pumpkinUsed)return startNightStep(room,"seer");
    const sid=onlineUsers.get(normalizePseudo(pumpkin.pseudo)); if(sid)io.to(sid).emit("pumpkinTurn",{uses:1});
    if(pumpkin.isBot){setTimeout(()=>{if(room.game?.phase!=="night"||room.game.nightStep!=="pumpkin"||g.pumpkinUsed)return;const ts=shuffle(getAlivePlayers(g).filter(x=>x.pseudo!==pumpkin.pseudo)).slice(0,2);g.nightActions.pumpkinKills=ts.map(x=>x.pseudo);g.pumpkinUsed=true;pumpkin.role="Villageois";const ps=onlineUsers.get(normalizePseudo(pumpkin.pseudo));if(ps)io.to(ps).emit("yourRole",{role:"Villageois",classChance:pumpkin.classChance,teammates:[]});io.to(room.code).emit("roleActionResult",{message:"La Citrouille a utilisé son pouvoir et est devenue Villageois."});startNightStep(room,"seer");},1200);}
    setTimeout(()=>{if(room.game?.phase==="night"&&room.game.nightStep==="pumpkin"&&!g.pumpkinUsed)startNightStep(room,"seer");},duration); return;
  }
  if(step==="giant"){
    const giant=aliveRole(g,"Géant de pierre"); if(!giant||g.giantUsed)return resolveNight(room);
    const sid=onlineUsers.get(normalizePseudo(giant.pseudo)); if(sid)io.to(sid).emit("giantTurn",{uses:1});
    if(giant.isBot){setTimeout(()=>{if(room.game?.phase!=="night"||room.game.nightStep!=="giant"||g.giantUsed)return;const t=randomAliveTarget(g,x=>x.pseudo!==giant.pseudo);if(t)g.nightActions.giantKill=t.pseudo;g.giantUsed=true;giant.role="Villageois";const gs=onlineUsers.get(normalizePseudo(giant.pseudo));if(gs)io.to(gs).emit("yourRole",{role:"Villageois",classChance:giant.classChance,teammates:[]});io.to(room.code).emit("roleActionResult",{message:"Le Géant de pierre a utilisé son pouvoir et est devenu Villageois."});resolveNight(room);},1200);}
    setTimeout(()=>{if(room.game?.phase==="night"&&room.game.nightStep==="giant"&&!g.giantUsed)resolveNight(room);},duration); return;
  }

  if(step==="seer"){
    const seer=aliveRole(g,"Voyante");
    if(!seer)return startNightStep(room,"witch");
    if(seer.isBot){
      setTimeout(()=>{
        if(room.game?.phase!=="night"||room.game.nightStep!=="seer")return;
        const target=randomAliveTarget(g,p=>p.pseudo!==seer.pseudo);
        if(target)io.to(onlineUsers.get(normalizePseudo(seer.pseudo))||"").emit("seerResult",{target:target.pseudo,role:target.role});
        g.seerUsedThisNight=true;
        startNightStep(room,"witch");
      },1200);
    }
    setTimeout(()=>{if(room.game?.phase==="night"&&room.game.nightStep==="seer")startNightStep(room,"witch");},duration);
    return;
  }

  if(step==="witch"){
    const witch=aliveRole(g,"Sorcière");
    if(!witch)return startNightStep(room,"giant");
    const sid=onlineUsers.get(normalizePseudo(witch.pseudo));
    if(sid)io.to(sid).emit("witchTurn",{
      victim:g.nightTargetPseudo,
      canSave:!g.witchSaveUsed,
      canKill:!g.witchKillUsed
    });
    if(witch.isBot){
      setTimeout(()=>{if(room.game?.phase!=="night"||room.game.nightStep!=="witch")return;startNightStep(room,"giant");},12000);
    }
    setTimeout(()=>{if(room.game?.phase==="night"&&room.game.nightStep==="witch")startNightStep(room,"giant");},duration);
  }
}


function finishNightWolves(room){
  const g=room.game;if(!g||g.phase!=="night"||g.nightStep!=="wolves")return;
  const counts={};Object.values(g.nightVotes||{}).forEach(t=>counts[t]=(counts[t]||0)+1);
  g.nightTargetPseudo=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]||null;
  if(getHalloweenStatus().active&&aliveRole(g,"Citrouille")&&!g.pumpkinUsed)return startNightStep(room,"pumpkin");
  startNightStep(room,"seer");
}

function resolveNight(room){
  const g=room.game;if(!g||g.phase!=="night")return;
  const victim=g.players.find(p=>p.pseudo===g.nightTargetPseudo&&p.alive);
  if(victim&&g.nightActions?.saved!==victim.pseudo)victim.alive=false;
  const witchKill=g.nightActions?.witchKill;
  if(witchKill){const v=g.players.find(p=>p.pseudo===witchKill&&p.alive);if(v)v.alive=false;}
  (g.nightActions?.pumpkinKills||[]).forEach(id=>{const v=g.players.find(p=>p.pseudo===id&&p.alive);if(v)v.alive=false;});
  const giantKill=g.nightActions?.giantKill;
  if(giantKill){const v=g.players.find(p=>p.pseudo===giantKill&&p.alive);if(v)v.alive=false;}
  const linked=applyLinkedDeaths(g);
  const deaths=g.players.filter(p=>!p.alive).map(p=>p.pseudo);
  g.nightVotes={};
  g.nightStep=null;
  io.to(room.code).emit("nightResolved",{victim:victim?.pseudo||null,linkedDeaths:linked,deaths});
  if(checkGameWinner(g)){finishGame(room);return;}
  startDayPhase(room,deaths);
}

function startDayPhase(room,deathPseudos=[]){
  const g=room.game;if(!g||g.phase==="finished")return;
  g.phase="day";g.nightStep=null;g.dayVotes={};
  emitPublicGameState(room,"dayStarted");
  io.to(room.code).emit("dayStarted",{victims:deathPseudos,players:g.players.map(p=>({pseudo:p.pseudo,alive:p.alive,isBot:p.isBot}))});
  const alive=g.players.filter(p=>p.alive);
  alive.filter(p=>p.isBot).forEach((bot,i)=>setTimeout(()=>{
    if(room.game?.phase!=="day")return;
    const t=randomAliveTarget(g,p=>p.pseudo!==bot.pseudo);
    if(t)g.dayVotes[bot.pseudo]=t.pseudo;
    emitPublicGameState(room,"voteUpdate");
    if(alive.every(p=>g.dayVotes[p.pseudo]))tryResolveDay(room);
  },2500+i*1200));
  setTimeout(()=>{
    if(room.game?.phase!=="day")return;
    g.players.filter(p=>p.alive).forEach(p=>{if(!g.dayVotes[p.pseudo]){const t=randomAliveTarget(g,x=>x.pseudo!==p.pseudo);if(t)g.dayVotes[p.pseudo]=t.pseudo;}});
    tryResolveDay(room);
  },GAME_TIMERS.day);
}

function tryResolveDay(room){
  const g=room.game;if(!g||g.phase!=="day")return;
  const alive=g.players.filter(p=>p.alive);if(alive.some(p=>!g.dayVotes[p.pseudo]))return;
  const counts={};Object.values(g.dayVotes).forEach(t=>counts[t]=(counts[t]||0)+1);
  const targetPseudo=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
  const eliminated=g.players.find(p=>p.pseudo===targetPseudo);
  if(eliminated)eliminated.alive=false;
  const linked=applyLinkedDeaths(g);
  io.to(room.code).emit("dayVoteResult",{target:targetPseudo,counts,linkedDeaths:linked});
  g.dayVotes={};
  if(checkGameWinner(g)){finishGame(room);return;}
  g.day++;startNightPhase(room);
}

function handleRoleAction(room,data){
  const g=room.game;if(!g||g.phase!=="night")return;
  const p=g.players.find(x=>normalizePseudo(x.pseudo)===normalizePseudo(data.pseudo));if(!p||!p.alive)return;
  const target=g.players.find(x=>x.pseudo===data.targetPseudo);
  if(p.role==="Cupidon"&&g.nightStep==="cupid"&&data.action==="cupid"){
    if(g.cupidUsed)return;
    if(!target||target.pseudo===p.pseudo)return;
    const second=g.players.find(x=>x.pseudo===data.secondTargetPseudo&&x.alive&&x.pseudo!==p.pseudo&&x.pseudo!==target.pseudo);
    if(!second)return;
    g.linkedPlayers=[target.pseudo,second.pseudo];g.cupidUsed=true;
    io.to(room.code).emit("cupidUsed",{message:"Cupidon a désigné deux joueurs."});
    return startNightStep(room,"wolves");
  }
  if(p.role==="Loup-Garou"&&g.nightStep==="wolves"&&data.action==="vote"){
    if(!target||!target.alive||target.role==="Loup-Garou")return;
    if(g.nightVotes[p.pseudo])return;
    g.nightVotes[p.pseudo]=target.pseudo;
    io.to(room.code).emit("voteUpdate",{voter:p.pseudo,target:target.pseudo,count:Object.keys(g.nightVotes).length,required:g.players.filter(x=>x.alive&&x.role==="Loup-Garou").length});
    const wolves=g.players.filter(x=>x.alive&&x.role==="Loup-Garou");if(wolves.every(w=>g.nightVotes[w.pseudo]))finishNightWolves(room);
    return;
  }
  if(p.role==="Voyante"&&g.nightStep==="seer"&&data.action==="inspect"&&target){
    const sid=onlineUsers.get(normalizePseudo(p.pseudo));if(sid)io.to(sid).emit("seerResult",{target:target.pseudo,role:target.role});
    g.seerUsedThisNight=true;return startNightStep(room,"witch");
  }
  if(p.role==="Citrouille"&&g.nightStep==="pumpkin"&&data.action==="pumpkinKill"){if(!getHalloweenStatus().active||g.pumpkinUsed)return;const second=g.players.find(x=>x.pseudo===data.secondTargetPseudo&&x.alive&&x.pseudo!==p.pseudo&&x.pseudo!==target?.pseudo);if(!target||!target.alive||target.pseudo===p.pseudo||!second)return;g.nightActions.pumpkinKills=[target.pseudo,second.pseudo];g.pumpkinUsed=true;p.role="Villageois";const sid=onlineUsers.get(normalizePseudo(p.pseudo));if(sid)io.to(sid).emit("yourRole",{role:"Villageois",classChance:p.classChance,teammates:[]});io.to(room.code).emit("roleActionResult",{message:"La Citrouille a utilisé son pouvoir et est devenue Villageois."});return startNightStep(room,"seer");}
  if(p.role==="Géant de pierre"&&g.nightStep==="giant"&&data.action==="giantKill"){if(!isV26Released()||g.giantUsed)return;if(!target||!target.alive||target.pseudo===p.pseudo)return;g.nightActions.giantKill=target.pseudo;g.giantUsed=true;p.role="Villageois";const sid=onlineUsers.get(normalizePseudo(p.pseudo));if(sid)io.to(sid).emit("yourRole",{role:"Villageois",classChance:p.classChance,teammates:[]});io.to(room.code).emit("roleActionResult",{message:"Le Géant de pierre a utilisé son pouvoir et est devenu Villageois."});return resolveNight(room);}
  if(p.role==="Sorcière"&&g.nightStep==="witch"){
    if(data.action==="save"&&target&&target.pseudo===g.nightTargetPseudo&&!g.witchSaveUsed){g.nightActions.saved=target.pseudo;g.witchSaveUsed=true;io.to(room.code).emit("roleActionResult",{message:"La Sorcière a utilisé sa potion de vie."});return startNightStep(room,"giant");}
    if(data.action==="kill"&&target&&target.alive&&!g.witchKillUsed){g.nightActions.witchKill=target.pseudo;g.witchKillUsed=true;io.to(room.code).emit("roleActionResult",{message:"La Sorcière a utilisé sa potion de mort."});return startNightStep(room,"giant");}
    if(data.action==="pass")return startNightStep(room,"giant");
  }
}

/* =========================================
   SOCKET.IO
========================================= */

const matchmakingQueue=[];let matchmakingTimer=null;
function removeFromMatchmaking(pseudo){const n=normalizePseudo(pseudo);for(let i=matchmakingQueue.length-1;i>=0;i--)if(normalizePseudo(matchmakingQueue[i].pseudo)===n)matchmakingQueue.splice(i,1);}
function runRealMatchmaking(){matchmakingTimer=null;const groups=[true,false];groups.forEach(ranked=>{const take=matchmakingQueue.filter(x=>Boolean(x.ranked)===ranked).slice(0,8);if(!take.length)return;take.forEach(x=>removeFromMatchmaking(x.pseudo));const room={code:createUniqueRoomCode(),host:take[0].pseudo,ranked,status:"playing",players:take.map(x=>({pseudo:x.pseudo,isBot:false,socketId:x.socketId})),createdAt:Date.now()};addBotsToRoom(room);db.rooms.push(room);take.forEach(x=>{const sock=io.sockets.sockets.get(x.socketId);if(sock)sock.join(room.code);});room.game=createGame(room);saveDatabase();take.forEach(x=>io.to(x.socketId).emit("matchmakingFound",{room:roomPublic(room)}));emitGameStart(room);setTimeout(()=>startNightPhase(room),250);});saveDatabase();}
function queueRealMatchmaking(socket,pseudo,ranked){removeFromMatchmaking(pseudo);removeUserFromRooms(pseudo);matchmakingQueue.push({pseudo,socketId:socket.id,ranked:Boolean(ranked),queuedAt:Date.now()});socket.emit("playerSearchStarted",{duration:10000,realPlayers:true,queuedCount:matchmakingQueue.length});if(matchmakingQueue.filter(x=>Boolean(x.ranked)===Boolean(ranked)).length>=8)runRealMatchmaking();else if(!matchmakingTimer)matchmakingTimer=setTimeout(runRealMatchmaking,10000);}

io.on(
  "connection",
  (socket) => {

    console.log(
      "Connexion :",
      socket.id
    );


    /* =====================================
       UTILISATEUR EN LIGNE
    ===================================== */

    socket.on(
      "userOnline",
      (data) => {
        const pseudo =
          cleanPseudo(
            data?.pseudo
          );

        if (!pseudo) return;

        const user =
          findUser(pseudo);

        if (!user) return;

        onlineUsers.set(
          normalizePseudo(
            user.pseudo
          ),
          socket.id
        );

        socketUsers.set(
          socket.id,
          user.pseudo
        );

        socket.emit(
          "onlineUsers",
          getOnlineUserInfo()
        );

        socket.emit("globalBoostUpdated", { all: true, boosts: getGlobalBoostPayload() });

        io.emit(
          "userStatusChanged",
          {
            pseudo:
              user.pseudo,

            online: true
          }
        );
      }
    );


    /* =====================================
       CRÉER SALON
    ===================================== */

    socket.on(
      "createRoom",
      (data) => {
        const pseudo =
          cleanPseudo(
            data?.pseudo
          );

        const user =
          findUser(pseudo);

        if (!user) {
          socket.emit(
            "roomError",
            "Utilisateur introuvable."
          );

          return;
        }

        removeUserFromRooms(
          user.pseudo
        );

        const room = {
          code:
            createUniqueRoomCode(),

          host:
            user.pseudo,

          ranked: false,

          status:
            "waiting",

          players: [
            {
              pseudo:
                user.pseudo,

              isBot: false,

              socketId:
                socket.id
            }
          ],

          createdAt:
            Date.now()
        };

        db.rooms.push(
          room
        );

        socket.join(
          room.code
        );

        saveDatabase();

        socket.emit(
          "roomCreated",
          roomPublic(room)
        );

        io.emit(
          "roomsList",
          db.rooms
            .filter(
              (item) =>
                item.status ===
                "waiting"
            )
            .map(roomPublic)
        );
      }
    );


    /* =====================================
       MODE CLASSÉ
    ===================================== */

    socket.on(
      "setRoomRanked",
      (data) => {
        const room =
          findRoom(
            data?.code
          );

        if (!room) return;

        if (
          normalizePseudo(
            room.host
          ) !==
          normalizePseudo(
            data?.pseudo
          )
        ) {
          socket.emit(
            "roomError",
            "Seul le créateur peut modifier ce mode."
          );

          return;
        }

        room.ranked =
          Boolean(
            data?.ranked
          );

        saveDatabase();

        io.to(room.code).emit(
          "roomUpdated",
          roomPublic(room)
        );
      }
    );


    /* =====================================
       REJOINDRE SALON
    ===================================== */

    socket.on(
      "joinRoom",
      (data) => {
        const code =
          String(
            data?.code || ""
          )
            .trim()
            .toUpperCase();

        const pseudo =
          cleanPseudo(
            data?.pseudo
          );

        const room =
          findRoom(code);

        const user =
          findUser(pseudo);

        if (
          !room ||
          !user
        ) {
          socket.emit(
            "roomError",
            "Salon introuvable."
          );

          return;
        }

        if (
          room.status !==
          "waiting"
        ) {
          socket.emit(
            "roomError",
            "Cette partie a déjà commencé."
          );

          return;
        }

        const alreadyInRoom =
          room.players.some(
            (player) =>
              normalizePseudo(
                player.pseudo
              ) ===
              normalizePseudo(
                user.pseudo
              )
          );

        if (!alreadyInRoom) {
          if (
            room.players.length >= 8
          ) {
            socket.emit(
              "roomError",
              "Le salon est complet."
            );

            return;
          }

          removeUserFromRooms(
            user.pseudo
          );

          room.players.push({
            pseudo:
              user.pseudo,

            isBot: false,

            socketId:
              socket.id
          });
        }

        socket.join(
          room.code
        );

        saveDatabase();

        socket.emit(
          "joinedRoom",
          roomPublic(room)
        );

        io.to(room.code).emit(
          "roomUpdated",
          roomPublic(room)
        );

        io.emit(
          "roomsList",
          db.rooms
            .filter(
              (item) =>
                item.status ===
                "waiting"
            )
            .map(roomPublic)
        );
      }
    );


    /* =====================================
       INVITER UN AMI
    ===================================== */

    socket.on("inviteFriendToRoom",(data)=>{
      const room=findRoom(data?.code), fromPseudo=cleanPseudo(data?.fromPseudo), toPseudo=cleanPseudo(data?.toPseudo);
      if(!room)return socket.emit("roomError","Salon introuvable.");
      if(room.status!=="waiting")return socket.emit("roomError","Le salon a déjà commencé.");
      if(!room.players.some(p=>normalizePseudo(p.pseudo)===normalizePseudo(fromPseudo)))return socket.emit("roomError","Tu dois être dans le salon.");
      if(!areFriends(fromPseudo,toPseudo))return socket.emit("roomError","Tu dois être ami avec ce joueur.");
      if(room.players.length>=8)return socket.emit("roomError","Le salon est complet.");
      const target=findUser(toPseudo); if(!target)return socket.emit("roomError","Joueur introuvable.");
      const request={id:createId(),fromPseudo,toPseudo:target.pseudo,type:"roomInvite",roomCode:room.code,createdAt:Date.now()}; db.friendRequests.push(request);
      addNotification(target.pseudo,{title:"🎮 Invitation de salon",message:`${fromPseudo} t'invite dans le salon ${room.code}.`,type:"roomInvite",action:{requestId:request.id,code:room.code,fromPseudo}}); saveDatabase();
    });

    socket.on("respondRoomInvite",(data)=>{
      const request=db.friendRequests.find(r=>r.id===data?.requestId&&r.type==="roomInvite"&&normalizePseudo(r.toPseudo)===normalizePseudo(data?.pseudo));
      if(!request)return socket.emit("roomError","Invitation introuvable.");
      db.friendRequests=db.friendRequests.filter(r=>r.id!==request.id);
      if(!data.accept){saveDatabase();return socket.emit("roomInviteResult",{accepted:false,message:"Invitation refusée."});}
      const room=findRoom(request.roomCode), user=findUser(data.pseudo);
      if(!room||room.status!=="waiting")return socket.emit("roomError","Le salon n'est plus disponible.");
      if(room.players.length>=8)return socket.emit("roomError","Le salon est complet.");
      // Quitter les autres salons avant d'entrer dans celui-ci.
      db.rooms.forEach(r=>{if(r.code!==room.code)r.players=r.players.filter(p=>normalizePseudo(p.pseudo)!==normalizePseudo(user.pseudo));});
      if(!room.players.some(p=>normalizePseudo(p.pseudo)===normalizePseudo(user.pseudo)))room.players.push({pseudo:user.pseudo,isBot:false,socketId:socket.id});
      const targetRoom=room;
      socket.join(targetRoom.code); saveDatabase(); socket.emit("joinedRoom",roomPublic(targetRoom)); io.to(targetRoom.code).emit("roomUpdated",roomPublic(targetRoom));
      addNotification(request.fromPseudo,{title:"🎮 Invitation acceptée",message:`${user.pseudo} a rejoint ton salon.`,type:"info"});
    });


    /* =====================================
       RECHERCHE DE JOUEURS
    ===================================== */

    socket.on(
      "searchPlayers",
      (data) => {
        const room = findRoom(data?.code);
        const pseudo = cleanPseudo(data?.pseudo);

        if (!room) {
          socket.emit("roomError", "Salon introuvable.");
          return;
        }

        queueRealMatchmaking(socket,pseudo,Boolean(room.ranked)); return;
        if (normalizePseudo(room.host) !== normalizePseudo(pseudo)) {
          socket.emit("roomError", "Seul le créateur peut lancer la recherche.");
          return;
        }

        if (room.status !== "waiting") {
          socket.emit("roomError", "La partie est déjà lancée.");
          return;
        }

        if(room.startingAt)return; room.startingAt=Date.now(); saveDatabase();
        io.to(room.code).emit("playerSearchStarted", { duration: 10000 });
        setTimeout(() => { if(room.status!=="waiting")return; launchRoomGame(room); },10000);
      }
    );

    /* =====================================
       LANCER AVEC D'AUTRES JOUEURS
    ===================================== */

    socket.on(
      "startGame",
      (data) => {
        const room = findRoom(data?.code);
        const pseudo = cleanPseudo(data?.pseudo);

        if (!room) {
          socket.emit("roomError", "Salon introuvable.");
          return;
        }

        if(!findUser(pseudo)) return socket.emit("roomError","Compte introuvable.");
        queueRealMatchmaking(socket,pseudo,Boolean(room.ranked));
        return;

        if (normalizePseudo(room.host) !== normalizePseudo(pseudo)) {
          socket.emit("roomError", "Seul le créateur peut lancer la partie.");
          return;
        }

        if (room.status !== "waiting") {
          socket.emit("roomError", "La partie est déjà lancée.");
          return;
        }

        // Recherche de joueurs pendant 10 secondes, puis bots si nécessaire.
        if(room.startingAt)return; room.startingAt=Date.now(); saveDatabase();
        io.to(room.code).emit("playerSearchStarted", { duration: 10000 });
        setTimeout(() => { if(room.status!=="waiting")return; launchRoomGame(room); },10000);
      }
    );

    /* =====================================
       LANCER AVEC BOTS
    ===================================== */

    socket.on(
      "startGameWithBots",
      (data) => {
        const room =
          findRoom(
            data?.code
          );

        const pseudo =
          cleanPseudo(
            data?.pseudo
          );

        if (!room) {
          socket.emit(
            "roomError",
            "Salon introuvable."
          );

          return;
        }

        if (
          normalizePseudo(
            room.host
          ) !==
          normalizePseudo(
            pseudo
          )
        ) {
          socket.emit(
            "roomError",
            "Seul le créateur peut lancer la partie."
          );

          return;
        }

        if(room.status!=="waiting")return socket.emit("roomError","La partie est déjà lancée.");
        if(room.startingAt)return; room.startingAt=Date.now(); saveDatabase();
        io.to(room.code).emit("botLoadingStarted",{duration:10000});
        setTimeout(()=>{if(room.status!=="waiting")return;launchRoomGame(room);},10000);
      }
    );


    /* =====================================
       ACTIONS DE PARTIE
    ===================================== */
    socket.on("nightVote",(data)=>{handleRoleAction(findRoom(data?.code),{...data,action:"vote"});saveDatabase();});
    socket.on("gameChat",(data)=>{
      const room=findRoom(data?.code);
      const pseudo=String(data?.pseudo||"");
      const player=room?.game?.players?.find(p=>normalizePseudo(p.pseudo)===normalizePseudo(pseudo));
      if(!room||!player||!player.alive||room.game.phase==="finished") return;
      if(room.game.phase!=="day") return;
      const text=String(data?.text||"").trim();
      if(!text)return;
      const filtered=filterChatText(text);
      const msg={id:createId(),pseudo:player.pseudo,text:filtered,createdAt:Date.now()};
      room.game.chat=Array.isArray(room.game.chat)?room.game.chat:[];
      room.game.chat.push(msg);
      room.game.chat=room.game.chat.slice(-80);
      io.to(room.code).emit("gameChatMessage",msg);
      saveDatabase();
    });

    socket.on("roleAction",(data)=>{const room=findRoom(data?.code);if(!room)return;handleRoleAction(room,data);saveDatabase();});
    socket.on("hunterAction",(data)=>{const room=findRoom(data?.code);const g=room?.game;if(!g)return;const hunter=g.players.find(p=>p.pseudo===data?.pseudo&&p.role==="Chasseur"&&!p.alive);const target=g.players.find(p=>p.pseudo===data?.targetPseudo&&p.alive);if(!hunter||!target)return;target.alive=false;io.to(room.code).emit("hunterShot",{hunter:hunter.pseudo,target:target.pseudo});if(checkGameWinner(g))finishGame(room);else if(g.phase==="day"){g.day++;startNightPhase(room);}else startDayPhase(room,null);});
    socket.on("dayVote",(data)=>{const room=findRoom(data?.code);if(!room?.game||room.game.phase!=="day")return;const g=room.game,v=g.players.find(p=>normalizePseudo(p.pseudo)===normalizePseudo(data?.pseudo)),t=g.players.find(p=>p.pseudo===data?.targetPseudo);if(!v||!t||!v.alive||!t.alive)return;
if(g.dayVotes[v.pseudo]){socket.emit("voteError",{message:"Tu as déjà voté aujourd'hui."});return;}
g.dayVotes[v.pseudo]=t.pseudo;io.to(room.code).emit("voteUpdate",{voter:v.pseudo,target:t.pseudo,count:Object.keys(g.dayVotes).length,required:g.players.filter(p=>p.alive).length});tryResolveDay(room);saveDatabase();});

    /* =====================================
       LISTE DES SALONS
    ===================================== */

    socket.on(
      "getRooms",
      () => {
        socket.emit(
          "roomsList",
          db.rooms
            .filter(
              (room) =>
                room.status ===
                "waiting"
            )
            .map(roomPublic)
        );
      }
    );


    /* =====================================
       DÉCONNEXION
    ===================================== */

    socket.on(
      "disconnect",
      () => {
        const pseudo =
          socketUsers.get(
            socket.id
          );

        if (pseudo) {
          removeFromMatchmaking(pseudo);
          onlineUsers.delete(
            normalizePseudo(
              pseudo
            )
          );

          socketUsers.delete(
            socket.id
          );

          io.emit(
            "userStatusChanged",
            {
              pseudo,
              online: false
            }
          );
        }

        console.log(
          "Déconnexion :",
          socket.id
        );
      }
    );
  }
);


/* =========================================
   PAGE PRINCIPALE
========================================= */

app.get(
  "*",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);


/* =========================================
   NETTOYAGE DES SALONS
========================================= */

setInterval(
  () => {
    const now = Date.now();

    db.rooms =
      db.rooms.filter(
        (room) => {
          if (
            room.status ===
            "waiting"
          ) {
            return (
              now -
              room.createdAt
            ) <
              1000 *
              60 *
              60 *
              12;
          }

          return true;
        }
      );

    saveDatabase();

  },
  1000 * 60 * 10
);



/* =========================================
   SITE OFFICIEL — boutique et récompenses
   Authentification par jeton HMAC signé.
========================================= */
const SITE_TOKEN_SECRET = process.env.SITE_TOKEN_SECRET || process.env.ADMIN_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SITE_TOKEN_SECRET && !process.env.ADMIN_SECRET) {
  console.warn("⚠️ SITE_TOKEN_SECRET absent : les sessions du site seront invalidées au redémarrage. Configurez une clé secrète dans Render.");
}
const WEBSITE_DEFAULT_ITEMS = [
  { id: "title-moon-guardian", name: "Gardien de la Lune", description: "Un titre mystérieux à afficher sur ton profil.", icon: "🌕", price: 250, rewardType: "title", rewardValue: "Gardien de la Lune", active: true },
  { id: "xp-boost-pack", name: "Savoir ancien", description: "Gagne 150 XP sur ton compte.", icon: "📜", price: 120, rewardType: "xp", rewardValue: "150", active: true },
  { id: "trophy-pack", name: "Trophée du village", description: "Ajoute 10 trophées à ton profil.", icon: "🏆", price: 300, rewardType: "trophies", rewardValue: "10", active: true }
];
const WEBSITE_DEFAULT_REWARDS = [
  { type: "coins", amount: 100, weight: 45, label: "100 pièces" },
  { type: "coins", amount: 250, weight: 25, label: "250 pièces" },
  { type: "xp", amount: 200, weight: 20, label: "200 XP" },
  { type: "trophies", amount: 5, weight: 10, label: "5 trophées" }
];
function siteItems() {
  if (!Array.isArray(db.websiteShopItems)) db.websiteShopItems = WEBSITE_DEFAULT_ITEMS.map(x => ({...x}));
  return db.websiteShopItems;
}
function siteRewardPool() {
  if (!Array.isArray(db.websiteRewardPool) || !db.websiteRewardPool.length) db.websiteRewardPool = WEBSITE_DEFAULT_REWARDS.map(x => ({...x}));
  return db.websiteRewardPool;
}
function siteSafeUser(user) {
  return { pseudo: user.pseudo, coins: Number(user.coins || 0), xp: Number(user.xp || 0), trophies: Number(user.trophies || 0), titles: Array.isArray(user.titles) ? user.titles : [], classes: Array.isArray(user.classes) ? user.classes : [] };
}
function siteSignToken(user) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, pseudo: user.pseudo, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", SITE_TOKEN_SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}
function siteVerifyToken(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 2) return res.status(401).json({message:"Connecte-toi pour continuer."});
  const expected = crypto.createHmac("sha256", SITE_TOKEN_SECRET).update(parts[0]).digest();
  let provided;
  try { provided = Buffer.from(parts[1], "base64url"); } catch (_) { return res.status(401).json({message:"Session invalide."}); }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return res.status(401).json({message:"Session invalide."});
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch (_) { return res.status(401).json({message:"Session invalide."}); }
  if (!payload.exp || payload.exp < Date.now()) return res.status(401).json({message:"Session expirée. Reconnecte-toi."});
  const user = db.users.find(u => String(u.id) === String(payload.sub) && normalizePseudo(u.pseudo) === normalizePseudo(payload.pseudo));
  if (!user) return res.status(401).json({message:"Compte introuvable. Reconnecte-toi."});
  req.siteUser = user;
  next();
}
function siteRequireAdmin(req, res, next) {
  if (normalizePseudo(req.siteUser?.pseudo) !== ADMIN_PSEUDO) return res.status(403).json({message:"Accès réservé au compte créateur."});
  next();
}
function siteMakeCode() {
  return "LUNE-" + crypto.randomBytes(5).toString("hex").toUpperCase();
}
function siteWeightedReward() {
  const pool = siteRewardPool().filter(r => ["coins","xp","trophies"].includes(r.type) && Number(r.amount) > 0 && Number(r.weight) > 0);
  if (!pool.length) throw new Error("Aucune récompense valide n'est configurée.");
  const total = pool.reduce((n,r) => n + Number(r.weight), 0);
  let n = crypto.randomInt(0, Math.max(1, Math.floor(total * 1000))) / 1000;
  for (const r of pool) { n -= Number(r.weight); if (n < 0) return {type:r.type, amount:Math.floor(Number(r.amount)), label:String(r.label || `${r.amount} ${r.type}`)}; }
  const r=pool[pool.length-1]; return {type:r.type,amount:Math.floor(Number(r.amount)),label:String(r.label || `${r.amount} ${r.type}`)};
}
app.post("/api/site/login", async (req,res) => {
  try {
    const user = findUser(req.body?.pseudo);
    if (!user || !(await bcrypt.compare(String(req.body?.password || ""), user.password))) return res.status(401).json({message:"Pseudo ou mot de passe incorrect."});
    return res.json({token:siteSignToken(user), user:siteSafeUser(user)});
  } catch (e) { console.error("Site login:", e.message); return res.status(500).json({message:"Erreur de connexion."}); }
});
app.get("/api/site/me", siteVerifyToken, (req,res) => res.json({user:siteSafeUser(req.siteUser)}));
app.get("/api/site/shop", siteVerifyToken, (req,res) => res.json({coins:Number(req.siteUser.coins||0),items:siteItems().filter(i=>i.active!==false).map(i=>({id:i.id,name:i.name,description:i.description,icon:i.icon,price:Number(i.price)}))}));
app.post("/api/site/shop/buy", siteVerifyToken, async (req,res) => {
  try {
    const user=req.siteUser, item=siteItems().find(i=>i.id===String(req.body?.itemId||"") && i.active!==false);
    if(!item) return res.status(404).json({message:"Article introuvable."});
    const price=Math.floor(Number(item.price));
    if(!Number.isSafeInteger(price)||price<1) return res.status(400).json({message:"Prix invalide."});
    ensureUserState(user);
    if(Number(user.coins||0)<price) return res.status(400).json({message:"Tu n'as pas assez de pièces."});
    const type=String(item.rewardType||""), value=String(item.rewardValue||"");
    if(type==="title") {
      if(!value.trim()) return res.status(400).json({message:"Titre invalide."});
      user.titles=Array.isArray(user.titles)?user.titles:["Nouveau Villageois"];
      if(user.titles.includes(value)) return res.status(400).json({message:"Tu possèdes déjà cet article."});
    } else if(type==="class") {
      if(!CLASSES.some(c=>c.id===value)) return res.status(400).json({message:"Cette classe n'existe pas dans le jeu."});
      user.classes=Array.isArray(user.classes)?user.classes:[];
      if(user.classes.includes(value)) return res.status(400).json({message:"Tu possèdes déjà cette classe."});
    } else if(!["xp","trophies"].includes(type) || !Number.isSafeInteger(Number(value)) || Number(value)<=0) return res.status(400).json({message:"Récompense de l'article invalide."});
    user.coins=Number(user.coins||0)-price;
    if(type==="title") { user.titles.push(value); }
    else if(type==="class") { user.classes.push(value); }
    else if(type==="xp") { user.xp=Number(user.xp||0)+Number(value); if(typeof updateLevel==="function") updateLevel(user); }
    else if(type==="trophies") { user.trophies=Number(user.trophies||0)+Number(value); if(typeof getRank==="function") user.rank=getRank(user.trophies); }
    await saveDatabase();
    if(typeof emitProfile==="function") emitProfile(user);
    if(typeof addNotification==="function") addNotification(user.pseudo,{title:"🛒 Achat boutique",message:`Article acheté : ${item.name}.`,type:"websiteShop"});
    res.json({message:`Achat réussi : ${item.name} !`,user:siteSafeUser(user)});
  } catch(e) { console.error("Site shop buy:",e.message); res.status(500).json({message:"L'achat n'a pas pu être finalisé."}); }
});
app.post("/api/site/rewards/generate", siteVerifyToken, async (req,res) => {
  try {
    const user=req.siteUser;
    db.websiteMonthlyClaims = db.websiteMonthlyClaims && typeof db.websiteMonthlyClaims==="object" ? db.websiteMonthlyClaims : {};
    const month=new Date().toISOString().slice(0,7);
    const key=String(user.id)+"|"+month;
    if(db.websiteMonthlyClaims[key]) return res.status(400).json({message:"Tu as déjà généré ta récompense ce mois-ci."});
    const reward=siteWeightedReward();
    let code=siteMakeCode(); while(db.promoCodes?.[code]) code=siteMakeCode();
    db.promoCodes=db.promoCodes||{};
    db.promoCodes[code]={code,reward:{coins:reward.type==="coins"?reward.amount:0,xp:reward.type==="xp"?reward.amount:0,trophies:reward.type==="trophies"?reward.amount:0},maxUses:1,uses:0,active:true,createdAt:Date.now(),source:"website-monthly"};
    db.websiteMonthlyClaims[key]={code,reward:reward.label,createdAt:Date.now(),userId:user.id};
    await saveDatabase();
    res.json({code,message:"Récompense tirée : "+reward.label+". Saisis ce code dans le jeu pour récupérer ton cadeau."});
  } catch(e) { console.error("Site monthly reward:",e.message); res.status(500).json({message:e.message||"Impossible de générer la récompense."}); }
});
app.get("/api/site/admin/items",siteVerifyToken,siteRequireAdmin,(req,res)=>res.json({items:siteItems()}));
app.post("/api/site/admin/items",siteVerifyToken,siteRequireAdmin,async(req,res)=>{
  const b=req.body||{},name=String(b.name||"").trim(),description=String(b.description||"").trim(),icon=String(b.icon||"🎭").slice(0,8),price=Math.floor(Number(b.price)),type=String(b.rewardType||""),value=String(b.rewardValue||"").trim();
  if(!name||!description||!Number.isSafeInteger(price)||price<1||price>100000000) return res.status(400).json({message:"Vérifie le nom, la description et le prix."});
  if(type==="class"&&!CLASSES.some(c=>c.id===value))return res.status(400).json({message:"ID de classe inconnu. Utilise un ID présent dans le jeu."});
  if(type==="title"&&!value)return res.status(400).json({message:"Indique le titre à attribuer."});
  if(["xp","trophies"].includes(type)&&(!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>1000000))return res.status(400).json({message:"Quantité invalide."});
  if(!["title","class","xp","trophies"].includes(type))return res.status(400).json({message:"Type de récompense invalide."});
  const id="site-"+crypto.randomBytes(6).toString("hex");
  siteItems().push({id,name,description,icon,price,rewardType:type,rewardValue:value,active:true,createdAt:Date.now()});
  await saveDatabase();res.json({message:"Article ajouté.",items:siteItems()});
});
app.put("/api/site/admin/items/:id",siteVerifyToken,siteRequireAdmin,async(req,res)=>{
  const item=siteItems().find(i=>i.id===String(req.params.id));
  if(!item)return res.status(404).json({message:"Article introuvable."});
  const price=Number(req.body?.price);
  if(!Number.isSafeInteger(price)||price<1||price>100000000)return res.status(400).json({message:"Prix invalide."});
  item.price=price;
  await saveDatabase();
  res.json({message:"Prix modifié.",item:{id:item.id,price:item.price}});
});
app.delete("/api/site/admin/items/:id",siteVerifyToken,siteRequireAdmin,async(req,res)=>{
  const before=siteItems().length;db.websiteShopItems=siteItems().filter(i=>i.id!==String(req.params.id));
  if(db.websiteShopItems.length===before)return res.status(404).json({message:"Article introuvable."});
  await saveDatabase();res.json({message:"Article supprimé."});
});


/* =========================================
   DÉMARRAGE
========================================= */

setInterval(()=>{const before=Boolean(db.halloweenEvent?.active),status=getHalloweenStatus();if(before&&!status.active)io.emit("halloweenStatusChanged",status);purgeExpiredNotifications();saveDatabase();},30000);

async function startServer() {
  try {
    await initializeExternalDatabase();
    server.listen(PORT, () => {
      console.log(`🐺 Loup-Garou V7 lancé sur le port ${PORT}`);
      if (externalDbReady) console.log("💾 Persistance active : PostgreSQL externe");
    });
  } catch (error) {
    console.error("❌ Impossible d'initialiser la base externe :", error.message);
    console.error("Vérifiez DATABASE_URL / DATABASE_SSL dans Render.");
    process.exit(1);
  }
}

process.on("SIGTERM", async () => {
  try {
    await saveQueue;
    if (pgPool) await pgPool.end();
  } finally {
    process.exit(0);
  }
});

process.on("SIGINT", async () => {
  try {
    await saveQueue;
    if (pgPool) await pgPool.end();
  } finally {
    process.exit(0);
  }
});

startServer();
