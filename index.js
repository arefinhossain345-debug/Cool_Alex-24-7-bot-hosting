"use strict";

const { addLog, getLogs } = require("./logger");
const mineflayer = require("mineflayer");
const pvp = require('mineflayer-pvp').plugin;
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const { GoalBlock } = goals;
const collectBlock = require('mineflayer-collectblock').plugin;
const config = require("./settings.json");
const express = require("express");

// ============================================================
// EXPRESS SERVER - Keep Render/Aternos alive & Dashboard
// ============================================================
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 5000;

let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: [],
  wasThrottled: false,
};

let bot;

// Web UI Dashboard Endpoint
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name || 'AFK Bot'} Dashboard</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
        <style>
          *, *::before, *::after { box-sizing: border-box; }
          body { font-family: 'Inter', sans-serif; background: #0d1117; color: #e6edf3; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 24px; }
          main { width: 100%; max-width: 400px; }
          header { margin-bottom: 28px; }
          header h1 { font-size: 26px; font-weight: 700; color: #f0f6fc; margin: 0; }
          header p { font-size: 14px; color: #8b949e; margin: 6px 0 0; }
          .status-section { border-radius: 12px; padding: 20px 24px; margin-bottom: 16px; display: flex; align-items: center; gap: 16px; }
          .status-section.online  { background: #0d2218; border: 2px solid #238636; }
          .status-section.offline { background: #200d0d; border: 2px solid #da3633; }
          .status-icon { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
          .status-icon.online  { background: #238636; }
          .status-icon.offline { background: #da3633; }
          .status-label { font-size: 18px; font-weight: 700; }
          .status-label.online  { color: #3fb950; }
          .status-label.offline { color: #f85149; }
          .stat-card { background: #161b22; border: 1px solid #21262d; border-radius: 10px; padding: 16px 20px; margin-bottom: 10px; }
          dt { font-size: 12px; color: #8b949e; font-weight: 600; margin-bottom: 4px; }
          dd { margin: 0; font-size: 17px; font-weight: 600; color: #e6edf3; }
          .controls { margin-top: 8px; }
          .btn-grid { display: grid; gap: 10px; margin-bottom: 10px; }
          .btn-grid-2 { grid-template-columns: 1fr 1fr; }
          .btn-primary { min-height: 52px; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; border: none; }
          .btn-start { border: 2px solid #238636; background: #0d2218; color: #3fb950; }
          .btn-stop  { border: 2px solid #da3633; background: #200d0d; color: #f85149; }
          .btn-secondary { min-height: 44px; border-radius: 10px; border: 1px solid #21262d; background: #161b22; color: #8b949e; text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 13px; }
        </style>
      </head>
      <body>
        <main>
          <header>
            <h1>AFK Bot Dashboard</h1>
            <p>Live status console</p>
          </header>
          <section id="status-section" class="status-section ${botState.connected ? 'online' : 'offline'}">
            <div class="status-icon ${botState.connected ? 'online' : 'offline'}">${botState.connected ? '✓' : '✗'}</div>
            <div>
              <div class="status-label ${botState.connected ? 'online' : 'offline'}">${botState.connected ? 'Connected' : 'Disconnected'}</div>
            </div>
          </section>
          <section>
            <div class="stat-card">
              <dt>Server Address</dt>
              <dd>${config.server ? config.server.ip : 'solocloud.host'}</dd>
            </div>
          </section>
          <section class="controls">
            <div class="btn-grid btn-grid-2">
              <button class="btn-primary btn-start" onclick="location.reload()">Refresh</button>
              <a href="/logs" class="btn-secondary">View Logs</a>
            </div>
          </section>
        </main>
      </body>
    </html>
  `);
});

// Logs Endpoint
app.get("/logs", (req, res) => {
  const logs = typeof getLogs === 'function' ? getLogs() : ["Bot initializing..."];
  res.send(`
    <html>
      <body style="background:#0d1117; color:#e6edf3; font-family:monospace; padding:20px;">
        <a href="/" style="color:#58a6ff; text-decoration:none;"><- Back Dashboard</a>
        <h2>Console Logs</h2>
        <div style="background:#161b22; padding:15px; border-radius:8px; max-height:500px; overflow-y:auto;">
          ${logs.map(l => `<p style="margin:4px 0;">${l}</p>`).join('')}
        </div>
      </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    status: botState.connected ? "connected" : "disconnected",
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: bot && bot.entity ? bot.entity.position : null
  });
});

app.listen(PORT, () => {
  console.log(`Dashboard Web Server running on port ${PORT}`);
});

// ============================================================
// MINEFLAYER MINECRAFT BOT LOGIC (Zombie Kill & Woodcutter)
// ============================================================
const botOptions = {
  host: config.server ? config.server.ip : 'brother-opSmp.aternos.me',
  port: config.server ? config.server.port : 59607,
  username: config['bot-account'] ? config['bot-account'].username : 'Cool_alex4',
  version: config.server ? config.server.version : '1.20.1',
  auth: 'offline'
};

function createBot() {
  bot = mineflayer.createBot(botOptions);

  // Load Pathfinder, PVP, and CollectBlock Plugins
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(collectBlock);

  bot.on('spawn', () => {
    botState.connected = true;
    console.log("Bot joined the server successfully.");
    if (typeof addLog === 'function') addLog("Bot joined the server successfully.");
    
    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    // Auto-login / Auto-register system
    setTimeout(() => {
      bot.chat('/login SoloPlayz');
      bot.chat('/register SoloPlayz SoloPlayz');
    }, 1500);

    // Main AI Loop: Fights zombies, if no zombies, cuts trees
    setInterval(() => {
      if (!bot.pvp.isAttacking) {
        const zombieFound = killZombies();
        if (!zombieFound) {
          cutTrees();
        }
      }
    }, 8000);

    // Anti-AFK Broadcasting messages
    setInterval(() => {
      const messages = [
        "I'm a regular player",
        "Subscribe to SoloPlayz!",
        "Want Cheap Premium MC Server? https://discord.gg/VRMUnDkf95"
      ];
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];
      bot.chat(randomMessage);
    }, 120000);
  });

  // Zombie Fighting Logic
  function killZombies() {
    const zombie = bot.nearestEntity(entity => 
      entity.name.toLowerCase() === 'zombie' && 
      entity.position.distanceTo(bot.entity.position) < 16
    );
    
    if (zombie) {
      const weapon = bot.inventory.items().find(item => item.name.includes('sword') || item.name.includes('axe'));
      if (weapon) bot.equip(weapon, 'hand');
      bot.pvp.attack(zombie);
      if (typeof addLog === 'function') addLog("Attacking nearby zombie...");
      return true;
    }
    return false;
  }

  // Wood/Log Cutting Logic
  function cutTrees() {
    const logBlock = bot.findBlock({
      matching: block => block.name.includes('log') || block.name.includes('wood'),
      maxDistance: 16
    });

    if (logBlock) {
      const axe = bot.inventory.items().find(item => item.name.includes('axe'));
      if (axe) bot.equip(axe, 'hand');

      if (typeof addLog === 'function') addLog(`Moving to cut block: ${logBlock.name}`);
      bot.collectBlock.collect(logBlock, err => {
        if (!err) {
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 500);
        }
      });
    }
  }

  // Auto Eat Logic when health/food bar drops
  bot.on('health', () => {
    if (bot.food < 15) {
      const food = bot.inventory.items().find(item => item.name !== 'rotten_flesh' && bot.registry.foodsByName[item.name]);
      if (food) {
        bot.equip(food, 'hand');
        bot.consume((err) => {});
      }
    }
  });

  bot.on('end', (reason) => {
    botState.connected = false;
    console.log(`Bot disconnected: ${reason}. Reconnecting in 10s...`);
    setTimeout(() => {
      createBot();
    }, 10000);
  });

  bot.on('error', (err) => {
    console.log("Bot Error: ", err);
  });
}

// Start the Minecraft Bot
createBot();
