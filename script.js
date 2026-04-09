/* =============================================================
   Planet Hopper – script.js
   Vanilla JS, requestAnimationFrame, no libraries
   ============================================================= */

'use strict';

// ── Constants ──────────────────────────────────────────────────
const GRAVITY        = 0.42;
const JUMP_VEL       = -13.5;
const DOUBLE_JUMP_VEL = -12;
const MOVE_SPEED     = 5.5;
const MAX_FALL       = 16;
const CAM_LERP       = 0.07;
const ENTRY_FEE      = 100;
const INIT_BALANCE   = 10000;
const GEN_AHEAD      = 1600;
const CLEANUP_BEH    = 800;
const REWARD_PER_SCORE = 0.15;
const MAX_GAP        = 310;      // never exceed reachable distance
const STAR_SPAWN_CHANCE = 0.45;
const SHAKE_DURATION = 20;
const SHAKE_MAG      = 8;

// ── Mutable state ──────────────────────────────────────────────
let balance      = INIT_BALANCE;
let gameState    = 'menu';
let score        = 0;
let finalScore   = 0;
let maxDistX     = 0;
let frames       = 0;
let rafId        = null;
let highScore    = parseInt(localStorage.getItem('ph_highScore') || '0', 10);
let earnedReward = 0;
let shakeFrames  = 0;
let deathTimer   = 0;
let isNewHigh    = false;
let comboCount   = 0;
let lastLandedId = null;

// ── Canvas ─────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ── Player ─────────────────────────────────────────────────────
const player = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  w: 28, h: 46,
  onPlanet: null,
  jumpCD: 0,
  jumpsLeft: 2,
  alive: true,
};

// ── Camera ─────────────────────────────────────────────────────
const cam = { x: 0, y: 0 };

// ── World collections ──────────────────────────────────────────
let planets     = [];
let obstacles   = [];
let particles   = [];
let bgStars     = [];
let collectibles = [];
let scorePopups = [];
let genX        = 0;
let startX      = 0;

// ── Input ──────────────────────────────────────────────────────
let moveRight  = false;
let moveLeft   = false;
let jumpQueued = false;

// ══════════════════════════════════════════════════════════════
// BACKGROUND STARS
// ══════════════════════════════════════════════════════════════
function initStars() {
  bgStars = [];
  for (let i = 0; i < 190; i++) {
    bgStars.push({
      x:     Math.random() * canvas.width,
      y:     Math.random() * canvas.height,
      r:     Math.random() * 1.6 + 0.3,
      alpha: Math.random() * 0.55 + 0.18,
      speed: Math.random() * 0.22 + 0.04,
      phase: Math.random() * Math.PI * 2,
      color: Math.random() < 0.25 ? '#a78bfa'
           : Math.random() < 0.5  ? '#38bdf8'
           :                        '#ffffff',
    });
  }
}

// ══════════════════════════════════════════════════════════════
// DIFFICULTY & COLORS
// ══════════════════════════════════════════════════════════════
function getDiff(worldX) {
  return Math.min(10, Math.floor(Math.max(0, worldX - startX) / 900));
}

const PERM_COLORS = ['#10b981','#06b6d4','#0ea5e9','#6d28d9','#8b5cf6'];

function planetColor(type, worldX) {
  if (type === 'temporary') return '#a78bfa';
  if (type === 'instant')   return '#f59e0b';
  return PERM_COLORS[Math.min(4, Math.floor(Math.max(0, worldX - startX) / 1000))];
}

// ══════════════════════════════════════════════════════════════
// PLANET FACTORY
// ══════════════════════════════════════════════════════════════
function makePlanet(x, isStart) {
  isStart = isStart || false;
  const d      = isStart ? 0 : getDiff(x);
  const midY   = canvas.height * 0.5;
  const minW   = Math.max(65, 150 - d * 8);
  const maxW   = Math.max(95, 200 - d * 7);
  const w      = Math.round(Math.random() * (maxW - minW) + minW);
  const h      = 17 + Math.random() * 10;
  const spread = Math.min(220, 50 + d * 20);
  let   y      = isStart ? midY - h / 2
                         : midY + (Math.random() - 0.5) * spread * 2 - h / 2;
  y = Math.max(90, Math.min(canvas.height - 130, y));

  let type = 'permanent';
  if (!isStart && d >= 1) {
    const r = Math.random();
    if      (d >= 3 && r < 0.12) type = 'instant';
    else if (d >= 2 && r < 0.28) type = 'temporary';
  }

  const moveChance = isStart ? 0 : Math.min(0.55, d * 0.065);
  const moving = Math.random() < moveChance;

  return {
    id:      Math.random(),
    x, y, w, h,
    bx: x, by: y,
    px: x, py: y,
    type,
    color:   planetColor(type, x),
    moving,
    mAxis:   moving ? (Math.random() < 0.6 ? 'y' : 'x') : null,
    mSpeed:  (Math.random() * 1.2 + 0.4) * (Math.random() < 0.5 ? 1 : -1),
    mRange:  50 + Math.random() * 70,
    mPhase:  Math.random() * Math.PI * 2,
    landed:    false,
    landTimer: 0,
    duration:  type === 'temporary' ? (1.5 + Math.random() * 1.5) * 60 : 0,
    instActive: false,
    instTimer:  0,
    opacity:   1,
    alive:     true,
  };
}

// ══════════════════════════════════════════════════════════════
// COLLECTIBLE STAR FACTORY
// ══════════════════════════════════════════════════════════════
function makeCollectible(x, y) {
  return {
    x, y,
    r: 12,
    value: 25 + Math.floor(Math.random() * 26),
    phase: Math.random() * Math.PI * 2,
    alive: true,
  };
}

// ══════════════════════════════════════════════════════════════
// PLANET INITIALIZATION
// ══════════════════════════════════════════════════════════════
function initPlanets() {
  planets      = [];
  obstacles    = [];
  collectibles = [];
  scorePopups  = [];

  const sp = makePlanet(100, true);
  sp.w = 220;
  planets.push(sp);

  startX = sp.x + sp.w / 2;
  player.x          = sp.x + sp.w / 2 - player.w / 2;
  player.y          = sp.y - player.h;
  player.vx         = 0;
  player.vy         = 0;
  player.onPlanet   = sp;
  player.jumpCD     = 0;
  player.jumpsLeft  = 2;
  player.alive      = true;
  maxDistX          = 0;
  frames            = 0;
  score             = 0;
  comboCount        = 0;
  lastLandedId      = sp.id;
  shakeFrames       = 0;
  deathTimer        = 0;

  genX = sp.x + sp.w;
  while (genX < canvas.width + GEN_AHEAD) spawnNext();

  cam.x = player.x - canvas.width  * 0.32;
  cam.y = player.y - canvas.height * 0.50;
}

// ══════════════════════════════════════════════════════════════
// SPAWN NEXT PLANET (and maybe obstacle / collectible)
// ══════════════════════════════════════════════════════════════
function spawnNext() {
  const d    = getDiff(genX);
  const minG = 70  + d * 18;
  const maxG = Math.min(MAX_GAP, 140 + d * 22);
  const gap  = Math.random() * (maxG - minG) + minG;
  const last = planets[planets.length - 1];
  const x    = last.x + last.w + gap;

  planets.push(makePlanet(x));
  genX = x + planets[planets.length - 1].w;

  // Obstacle at difficulty ≥ 3
  if (d >= 3 && Math.random() < 0.22) {
    const oy = last.y - 50 - Math.random() * 60;
    obstacles.push({
      bx:    x - gap * 0.5,
      by:    oy,
      x:     x - gap * 0.5,
      y:     oy,
      w: 26, h: 26,
      range: 80 + Math.random() * 60,
      speed: 0.8 + Math.random() * 0.8,
      angle: 0,
      alive: true,
    });
  }

  // Collectible star between planets
  if (Math.random() < STAR_SPAWN_CHANCE) {
    const midX = last.x + last.w + gap * (0.3 + Math.random() * 0.4);
    const midY = Math.min(last.y, planets[planets.length - 1].y) - 40 - Math.random() * 80;
    collectibles.push(makeCollectible(midX, Math.max(60, midY)));
  }
}

// ══════════════════════════════════════════════════════════════
// PARTICLES
// ══════════════════════════════════════════════════════════════
function burst(x, y, color, n) {
  n = n || 9;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * 2 * i / n + Math.random() * 0.4;
    const s = Math.random() * 2.4 + 0.8;
    particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 1.5,
      life:    38 + Math.random() * 14,
      maxLife: 52,
      r:       Math.random() * 3 + 1.5,
      color,
    });
  }
}

function deathBurst(x, y) {
  const colors = ['#ef4444', '#f97316', '#fbbf24', '#f87171', '#ffffff'];
  for (let i = 0; i < 30; i++) {
    const a = Math.PI * 2 * Math.random();
    const s = Math.random() * 5 + 1.5;
    particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 2,
      life:    40 + Math.random() * 30,
      maxLife: 70,
      r:       Math.random() * 4 + 2,
      color:   colors[Math.floor(Math.random() * colors.length)],
    });
  }
}

function thrustPuff(x, y) {
  particles.push({
    x: x + Math.random() * player.w,
    y,
    vx:  (Math.random() - 0.5) * 1.4,
    vy:   Math.random() * 2 + 1.2,
    life: 18, maxLife: 18,
    r:    Math.random() * 2.5 + 1,
    color: '#fbbf24',
  });
}

function collectBurst(x, y) {
  const colors = ['#fbbf24', '#fde68a', '#ffffff'];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI * 2 * i / 10;
    const s = Math.random() * 3 + 1;
    particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 1,
      life:    20 + Math.random() * 10,
      maxLife: 30,
      r:       Math.random() * 2.5 + 1,
      color:   colors[Math.floor(Math.random() * colors.length)],
    });
  }
}

// ══════════════════════════════════════════════════════════════
// SCORE POPUPS
// ══════════════════════════════════════════════════════════════
function addScorePopup(x, y, text, color) {
  scorePopups.push({
    x, y, text, color: color || '#fbbf24',
    life: 60, maxLife: 60,
  });
}

// ══════════════════════════════════════════════════════════════
// UPDATE – PLANETS
// ══════════════════════════════════════════════════════════════
function updatePlanets() {
  const t = performance.now() / 1000;

  for (const p of planets) {
    p.px = p.x;
    p.py = p.y;

    if (p.moving && p.alive) {
      if (p.mAxis === 'y') {
        p.y = p.by + Math.sin(t * Math.abs(p.mSpeed) + p.mPhase) * p.mRange;
      } else {
        p.x = p.bx + Math.sin(t * Math.abs(p.mSpeed) + p.mPhase) * p.mRange;
      }
    }

    if (p.type === 'temporary' && p.landed && p.alive) {
      p.landTimer++;
      if (p.landTimer >= p.duration) {
        p.alive = false;
        if (player.onPlanet === p) player.onPlanet = null;
      } else if (p.duration - p.landTimer < 50) {
        p.opacity = 0.28 + 0.72 * Math.abs(Math.sin(p.landTimer * 0.35));
      }
    }

    if (p.type === 'instant' && p.instActive) {
      p.instTimer--;
      p.opacity = Math.max(0, p.instTimer / 30);
      if (p.instTimer <= 0) {
        p.alive = false;
        if (player.onPlanet === p) player.onPlanet = null;
      }
    }
  }

  planets = planets.filter(p => p.alive || p.opacity > 0);
}

// ══════════════════════════════════════════════════════════════
// UPDATE – PLAYER
// ══════════════════════════════════════════════════════════════
function updatePlayer() {
  if (!player.alive) return;

  // Carry player along with moving platform
  if (player.onPlanet && player.onPlanet.alive) {
    const p = player.onPlanet;
    player.x += p.x - p.px;
    player.y += p.y - p.py;
  }

  // Jump (ground jump or double jump)
  if (jumpQueued && player.jumpCD <= 0) {
    if (player.onPlanet && player.onPlanet.alive) {
      // Ground jump
      player.vy = JUMP_VEL;
      player.jumpsLeft = 1;  // one more jump available mid-air
      burst(player.x + player.w / 2, player.y + player.h, '#38bdf8', 6);
      const lp = player.onPlanet;
      if (lp.type === 'instant' && !lp.instActive) {
        lp.instActive = true;
        lp.instTimer  = 30;
      }
      player.onPlanet = null;
      player.jumpCD   = 6;
    } else if (!player.onPlanet && player.jumpsLeft > 0) {
      // Double jump (mid-air)
      player.vy = DOUBLE_JUMP_VEL;
      player.jumpsLeft--;
      burst(player.x + player.w / 2, player.y + player.h, '#a78bfa', 5);
      player.jumpCD = 6;
    }
  }
  jumpQueued = false;
  if (player.jumpCD > 0) player.jumpCD--;

  // Horizontal movement (left AND right)
  if (moveRight && !moveLeft) {
    player.vx = Math.min(player.vx + 1.1, MOVE_SPEED);
  } else if (moveLeft && !moveRight) {
    player.vx = Math.max(player.vx - 1.1, -MOVE_SPEED * 0.7);
  } else {
    player.vx *= player.onPlanet ? 0.55 : 0.965;
  }

  // Gravity (only while airborne)
  if (!player.onPlanet) {
    player.vy = Math.min(player.vy + GRAVITY, MAX_FALL);
  }

  // Integrate
  player.x += player.vx;
  player.y += player.vy;

  // ── Landing detection ──────────────────────────────────────
  const prevOnPlanet = player.onPlanet;
  player.onPlanet = null;

  if (player.vy >= 0) {
    for (const p of planets) {
      if (!p.alive || p.opacity < 0.12) continue;

      const foot   = player.y + player.h;
      const prevFt = foot - player.vy;
      const left   = player.x + player.w * 0.15;
      const right  = player.x + player.w * 0.85;

      if (right > p.x && left < p.x + p.w
          && foot >= p.y && prevFt <= p.y + p.h * 0.5) {

        player.y  = p.y - player.h;
        player.vy = 0;
        player.jumpsLeft = 2;

        // First contact with this planet
        if (prevOnPlanet !== p) {
          if (p.type !== 'instant') {
            burst(player.x + player.w / 2, p.y, p.color, 8);
          }
          if (p.type === 'temporary' && !p.landed) {
            p.landed = true;
          }
          if (p.type === 'instant' && !p.instActive) {
            p.instActive = true;
            p.instTimer  = 30;
            burst(player.x + player.w / 2, p.y, p.color, 12);
          }

          // Combo tracking
          if (lastLandedId !== p.id) {
            comboCount++;
            lastLandedId = p.id;
            if (comboCount > 1 && comboCount % 5 === 0) {
              const bonus = comboCount * 5;
              score += bonus;
              addScorePopup(player.x + player.w / 2, player.y - 20,
                            `${comboCount}x COMBO +${bonus}`, '#38bdf8');
            }
          }
        }

        player.onPlanet = p;
        break;
      }
    }
  }

  // ── Collectible pickup ─────────────────────────────────────
  const pcx = player.x + player.w / 2;
  const pcy = player.y + player.h / 2;
  for (const c of collectibles) {
    if (!c.alive) continue;
    const dx = pcx - c.x;
    const dy = pcy - c.y;
    if (dx * dx + dy * dy < (c.r + 14) * (c.r + 14)) {
      c.alive = false;
      score += c.value;
      collectBurst(c.x, c.y);
      addScorePopup(c.x, c.y - 10, `+${c.value}`, '#fbbf24');
    }
  }
  collectibles = collectibles.filter(c => c.alive || c.x > cam.x - CLEANUP_BEH);

  // ── Track max distance & update score ─────────────────────
  const dist = player.x - startX;
  if (dist > maxDistX) maxDistX = dist;
  frames++;
  score = Math.max(score, Math.floor(Math.max(0, maxDistX) / 8 + frames * 0.04));

  // ── Death conditions ───────────────────────────────────────
  if (player.y > canvas.height + 250) triggerDeath();
}

// ══════════════════════════════════════════════════════════════
// UPDATE – OBSTACLES
// ══════════════════════════════════════════════════════════════
function updateObstacles() {
  const t = performance.now() / 1000;
  for (const o of obstacles) {
    o.x     = o.bx + Math.sin(t * o.speed) * o.range;
    o.angle  = (o.angle || 0) + 0.04;

    if (player.alive && rectsOverlap(
      player.x + 5, player.y + 5, player.w - 10, player.h - 10,
      o.x, o.y, o.w, o.h
    )) {
      triggerDeath();
    }
  }
}

// ══════════════════════════════════════════════════════════════
// UPDATE – PARTICLES
// ══════════════════════════════════════════════════════════════
function updateParticles() {
  for (const p of particles) {
    p.x  += p.vx;
    p.y  += p.vy;
    p.vy += 0.12;
    p.life--;
  }
  particles = particles.filter(p => p.life > 0);
}

// ══════════════════════════════════════════════════════════════
// UPDATE – SCORE POPUPS
// ══════════════════════════════════════════════════════════════
function updateScorePopups() {
  for (const p of scorePopups) {
    p.y -= 0.8;
    p.life--;
  }
  scorePopups = scorePopups.filter(p => p.life > 0);
}

// ══════════════════════════════════════════════════════════════
// UPDATE – CAMERA
// ══════════════════════════════════════════════════════════════
function updateCamera() {
  const tx = player.x - canvas.width  * 0.32;
  const ty = player.y - canvas.height * 0.48;
  cam.x += (tx - cam.x) * CAM_LERP;
  cam.y += (ty - cam.y) * CAM_LERP * 0.65;
}

// ══════════════════════════════════════════════════════════════
// DYNAMIC GENERATION & CLEANUP
// ══════════════════════════════════════════════════════════════
function maybeGenerate() {
  while (genX < cam.x + canvas.width + GEN_AHEAD) spawnNext();

  if (planets.length > 60) {
    planets = planets.filter(p => p.x + p.w > cam.x - CLEANUP_BEH);
  }
  if (obstacles.length > 30) {
    obstacles = obstacles.filter(o => o.bx > cam.x - CLEANUP_BEH);
  }
  if (collectibles.length > 40) {
    collectibles = collectibles.filter(c => c.x > cam.x - CLEANUP_BEH);
  }
}

// ══════════════════════════════════════════════════════════════
// HELPER – AABB overlap
// ══════════════════════════════════════════════════════════════
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ══════════════════════════════════════════════════════════════
// HELPERS – colour maths
// ══════════════════════════════════════════════════════════════
function hexAdjust(hex, delta) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (n >> 16)         + delta));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xFF) + delta));
  const b = Math.min(255, Math.max(0, (n & 0xFF)        + delta));
  return `rgb(${r},${g},${b})`;
}

// ══════════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════════
function render() {
  const W = canvas.width;
  const H = canvas.height;
  const t = performance.now() / 1000;

  // Screen shake
  let sx = 0, sy = 0;
  if (shakeFrames > 0) {
    const intensity = shakeFrames / SHAKE_DURATION;
    sx = (Math.random() - 0.5) * SHAKE_MAG * intensity;
    sy = (Math.random() - 0.5) * SHAKE_MAG * intensity;
    shakeFrames--;
  }

  ctx.save();
  ctx.translate(sx, sy);

  // Background
  ctx.fillStyle = '#020212';
  ctx.fillRect(0, 0, W, H);

  // Nebula blobs
  drawNebula(W * 0.18, H * 0.28, 220, '#6d28d9', 0.065);
  drawNebula(W * 0.72, H * 0.62, 170, '#0ea5e9', 0.052);
  drawNebula(W * 0.50, H * 0.10, 140, '#10b981', 0.040);

  // Stars with parallax + twinkle
  for (const s of bgStars) {
    const starX = ((s.x - cam.x * s.speed) % W + W) % W;
    const starY = s.y;
    ctx.globalAlpha = s.alpha * (0.55 + 0.45 * Math.sin(t * 1.9 + s.phase));
    ctx.fillStyle   = s.color;
    ctx.beginPath();
    ctx.arc(starX, starY, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // World transform
  ctx.save();
  ctx.translate(-cam.x, -cam.y);

  for (const p of planets)   drawPlanet(p, t);
  for (const o of obstacles) drawObstacle(o);
  for (const c of collectibles) {
    if (c.alive) drawCollectible(c, t);
  }

  // Particles
  for (const pt of particles) {
    const a = pt.life / pt.maxLife;
    ctx.globalAlpha = a;
    ctx.fillStyle   = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.r * Math.max(0.1, a), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Score popups
  for (const p of scorePopups) {
    const a = p.life / p.maxLife;
    ctx.globalAlpha = a;
    ctx.fillStyle   = p.color;
    ctx.font        = 'bold 14px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign   = 'center';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  if (player.alive) drawRocket(t);

  ctx.restore(); // world transform
  ctx.restore(); // screen shake
}

// ── Draw nebula ────────────────────────────────────────────────
function drawNebula(x, y, r, color, alpha) {
  const hex = Math.round(alpha * 255).toString(16).padStart(2, '0');
  const g   = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color + hex);
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ── Draw planet ────────────────────────────────────────────────
function drawPlanet(p, t) {
  if (p.opacity <= 0) return;
  ctx.globalAlpha = p.opacity;

  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const rx = p.w / 2;
  const ry = p.h / 2;

  // Outer glow
  const glow = ctx.createRadialGradient(cx, cy, rx * 0.3, cx, cy, rx * 2.0);
  glow.addColorStop(0, p.color + '50');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 2.0, ry * 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  const bg = ctx.createRadialGradient(cx - rx * 0.28, cy - ry * 0.32, 0, cx, cy, rx);
  bg.addColorStop(0,   hexAdjust(p.color,  55));
  bg.addColorStop(0.5, p.color);
  bg.addColorStop(1,   hexAdjust(p.color, -40));
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // Specular shine
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.22, cy - ry * 0.3, rx * 0.36, ry * 0.21, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Dashed ring for moving planets
  if (p.moving) {
    ctx.strokeStyle = 'rgba(255,255,255,0.24)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 9, ry + 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Temporary: countdown arc
  if (p.type === 'temporary' && p.landed && p.duration > 0) {
    const frac = 1 - p.landTimer / p.duration;
    ctx.strokeStyle = frac < 0.3 ? '#f87171' : '#fbbf24';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rx + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
  }

  // Type icon above planet
  ctx.font      = '11px sans-serif';
  ctx.textAlign = 'center';
  if (p.type === 'temporary') {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('⏱', cx, p.y - 6);
  } else if (p.type === 'instant') {
    ctx.fillStyle = 'rgba(255,200,0,0.9)';
    ctx.fillText('⚡', cx, p.y - 6);
  }

  ctx.globalAlpha = 1;
}

// ── Draw collectible star ──────────────────────────────────────
function drawCollectible(c, t) {
  const bobY = c.y + Math.sin(t * 3 + c.phase) * 5;
  const rot  = t * 2.5 + c.phase;
  const pulseR = c.r + Math.sin(t * 4 + c.phase) * 2;

  // Glow
  ctx.globalAlpha = 0.3;
  ctx.fillStyle   = '#fbbf24';
  ctx.beginPath();
  ctx.arc(c.x, bobY, pulseR * 2, 0, Math.PI * 2);
  ctx.fill();

  // Star shape
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(c.x, bobY);
  ctx.rotate(rot);

  ctx.fillStyle   = '#fbbf24';
  ctx.shadowBlur  = 10;
  ctx.shadowColor = '#fbbf24';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const outerA = Math.PI * 2 * i / 5 - Math.PI / 2;
    const innerA = outerA + Math.PI / 5;
    const ox = Math.cos(outerA) * pulseR;
    const oy = Math.sin(outerA) * pulseR;
    const ix = Math.cos(innerA) * pulseR * 0.45;
    const iy = Math.sin(innerA) * pulseR * 0.45;
    if (i === 0) ctx.moveTo(ox, oy);
    else         ctx.lineTo(ox, oy);
    ctx.lineTo(ix, iy);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  // Inner highlight
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(0, -pulseR * 0.15, pulseR * 0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.globalAlpha = 1;
}

// ── Draw obstacle (asteroid) ───────────────────────────────────
function drawObstacle(o) {
  ctx.save();
  ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
  ctx.rotate(o.angle || 0);

  ctx.shadowBlur  = 14;
  ctx.shadowColor = '#ef4444';
  ctx.fillStyle   = '#7f1d1d';
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth   = 1.5;

  ctx.beginPath();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * 2 * i / n;
    const r = o.w * 0.38 + Math.sin(i * 2.1) * o.w * 0.1;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else         ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.restore();
}

// ── Draw rocket ─────────────────────────────────────────────────
function drawRocket(t) {
  const cx = player.x + player.w / 2;
  const w  = player.w;
  const h  = player.h;

  ctx.save();
  ctx.translate(cx, player.y + h);

  // Tilt rocket based on horizontal velocity
  const tiltAngle = player.vx * 0.04;
  ctx.rotate(tiltAngle);

  // Thrust flame
  if (moveRight || moveLeft || !player.onPlanet) {
    const fl = 11 + Math.sin(t * 22) * 5;
    const fg = ctx.createLinearGradient(0, 0, 0, fl);
    fg.addColorStop(0,   '#fde68a');
    fg.addColorStop(0.4, '#f97316');
    fg.addColorStop(1,   'rgba(220,38,38,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-w * 0.17, 0);
    ctx.lineTo(0, fl);
    ctx.lineTo( w * 0.17, 0);
    ctx.closePath();
    ctx.fill();

    if (Math.random() < 0.38) thrustPuff(player.x, player.y + h);
  }

  ctx.translate(0, -h);

  // Nozzle
  ctx.fillStyle = '#374151';
  ctx.fillRect(-w * 0.21, h * 0.76, w * 0.42, h * 0.24);

  // Body
  const bodyGrad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  bodyGrad.addColorStop(0,    '#1e3a8a');
  bodyGrad.addColorStop(0.45, '#2563eb');
  bodyGrad.addColorStop(0.55, '#3b82f6');
  bodyGrad.addColorStop(1,    '#1e3a8a');
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(-w * 0.3, h * 0.28, w * 0.6, h * 0.52);

  // Nose cone
  ctx.fillStyle = '#60a5fa';
  ctx.beginPath();
  ctx.moveTo(0,        0);
  ctx.lineTo(-w * 0.3, h * 0.31);
  ctx.lineTo( w * 0.3, h * 0.31);
  ctx.closePath();
  ctx.fill();

  // Porthole
  ctx.fillStyle   = '#bae6fd';
  ctx.shadowBlur  = 6;
  ctx.shadowColor = '#38bdf8';
  ctx.beginPath();
  ctx.arc(0, h * 0.44, w * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur  = 0;
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.arc(0, h * 0.44, w * 0.13, 0, Math.PI * 2);
  ctx.stroke();

  // Left fin
  ctx.fillStyle = '#1e40af';
  ctx.beginPath();
  ctx.moveTo(-w * 0.3,  h * 0.66);
  ctx.lineTo(-w * 0.52, h * 0.92);
  ctx.lineTo(-w * 0.3,  h * 0.86);
  ctx.closePath();
  ctx.fill();

  // Right fin
  ctx.beginPath();
  ctx.moveTo( w * 0.3,  h * 0.66);
  ctx.lineTo( w * 0.52, h * 0.92);
  ctx.lineTo( w * 0.3,  h * 0.86);
  ctx.closePath();
  ctx.fill();

  // Double-jump indicator (small ring around rocket when jump available mid-air)
  if (!player.onPlanet && player.jumpsLeft > 0) {
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.5)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(0, h * 0.5, w * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

// ══════════════════════════════════════════════════════════════
// GAME LOOP
// ══════════════════════════════════════════════════════════════
function gameLoop() {
  if (gameState === 'dying') {
    // Continue rendering during death animation
    deathTimer++;
    updateParticles();
    updateScorePopups();
    updateCamera();
    render();
    if (deathTimer >= 50) {
      showGameOver();
    } else {
      rafId = requestAnimationFrame(gameLoop);
    }
    return;
  }

  updatePlanets();
  updatePlayer();
  updateObstacles();
  updateParticles();
  updateScorePopups();
  updateCamera();
  maybeGenerate();
  render();
  document.getElementById('hudScore').textContent = score.toLocaleString();
  rafId = requestAnimationFrame(gameLoop);
}

// Menu / game-over background animation
function bgLoop() {
  const W = canvas.width;
  const H = canvas.height;
  const t = performance.now() / 1000;

  ctx.fillStyle = '#020212';
  ctx.fillRect(0, 0, W, H);

  drawNebula(W * 0.18, H * 0.28, 220, '#6d28d9', 0.065);
  drawNebula(W * 0.72, H * 0.62, 170, '#0ea5e9', 0.052);
  drawNebula(W * 0.50, H * 0.10, 140, '#10b981', 0.040);

  for (const s of bgStars) {
    ctx.globalAlpha = s.alpha * (0.55 + 0.45 * Math.sin(t * 1.9 + s.phase));
    ctx.fillStyle   = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  rafId = requestAnimationFrame(bgLoop);
}

// ══════════════════════════════════════════════════════════════
// DEATH
// ══════════════════════════════════════════════════════════════
function triggerDeath() {
  if (!player.alive) return;
  player.alive = false;
  finalScore   = score;
  gameState    = 'dying';
  deathTimer   = 0;
  shakeFrames  = SHAKE_DURATION;

  // Death explosion
  deathBurst(player.x + player.w / 2, player.y + player.h / 2);

  // Calculate reward
  earnedReward = Math.floor(finalScore * REWARD_PER_SCORE);
  balance += earnedReward;

  // Update high score
  isNewHigh = finalScore > highScore;
  if (isNewHigh) {
    highScore = finalScore;
    localStorage.setItem('ph_highScore', String(highScore));
  }
}

function showGameOver() {
  gameState = 'gameover';
  cancelAnimationFrame(rafId);

  document.getElementById('finalScore').textContent = finalScore.toLocaleString();
  document.getElementById('goBalance').textContent  = fmtBalance(balance);
  document.getElementById('goReward').textContent   = `+${earnedReward.toLocaleString()} $STARS`;

  const hsEl = document.getElementById('goHighScore');
  hsEl.textContent = highScore.toLocaleString();
  if (isNewHigh) {
    hsEl.innerHTML = highScore.toLocaleString() + ' <span class="new-hs-badge">NEW!</span>';
  }

  document.getElementById('hud').classList.add('hidden');
  document.getElementById('gameOverScreen').classList.remove('hidden');

  const rb = document.getElementById('restartBtn');
  if (balance < ENTRY_FEE) {
    rb.disabled = true;
    rb.querySelector('.btn-label').textContent = '❌ INSUFFICIENT FUNDS';
  } else {
    rb.disabled = false;
    rb.querySelector('.btn-label').textContent = '▶ PLAY AGAIN';
  }

  rafId = requestAnimationFrame(bgLoop);
}

// ══════════════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════════════
function fmtBalance(n) {
  return `${n.toLocaleString()} $STARS`;
}

function refreshUI() {
  document.getElementById('menuBalance').textContent   = fmtBalance(balance);
  document.getElementById('hudBalance').textContent    = fmtBalance(balance);
  document.getElementById('menuHighScore').textContent = highScore.toLocaleString();
}

// ══════════════════════════════════════════════════════════════
// KEYBOARD INPUT
// ══════════════════════════════════════════════════════════════
window.addEventListener('keydown', function(e) {
  if (e.code === 'Space' || e.key === ' ' || e.code === 'KeyW' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (gameState === 'playing') jumpQueued = true;
  }
  if (e.code === 'KeyD' || e.code === 'ArrowRight') {
    e.preventDefault();
    if (gameState === 'playing') moveRight = true;
  }
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
    e.preventDefault();
    if (gameState === 'playing') moveLeft = true;
  }
}, { passive: false });

window.addEventListener('keyup', function(e) {
  if (e.code === 'KeyD' || e.code === 'ArrowRight') moveRight = false;
  if (e.code === 'KeyA' || e.code === 'ArrowLeft')  moveLeft  = false;
});

// ══════════════════════════════════════════════════════════════
// TOUCH INPUT
// ══════════════════════════════════════════════════════════════
let touchRight = null;
let touchLeft  = null;
let touchJump  = null;

canvas.addEventListener('touchstart', function(e) {
  e.preventDefault();
  for (let i = 0; i < e.changedTouches.length; i++) {
    const touch = e.changedTouches[i];
    if (touch.clientY < canvas.height * 0.4) {
      // Top area = jump
      if (touchJump === null) {
        touchJump = touch.identifier;
        if (gameState === 'playing') jumpQueued = true;
      }
    } else if (touch.clientX > canvas.width * 0.6) {
      // Right area = move right
      if (touchRight === null) {
        touchRight = touch.identifier;
        if (gameState === 'playing') moveRight = true;
      }
    } else if (touch.clientX < canvas.width * 0.4) {
      // Left area = move left
      if (touchLeft === null) {
        touchLeft = touch.identifier;
        if (gameState === 'playing') moveLeft = true;
      }
    } else {
      // Middle area = jump
      if (touchJump === null) {
        touchJump = touch.identifier;
        if (gameState === 'playing') jumpQueued = true;
      }
    }
  }
}, { passive: false });

canvas.addEventListener('touchend', function(e) {
  e.preventDefault();
  for (let i = 0; i < e.changedTouches.length; i++) {
    const touch = e.changedTouches[i];
    if (touch.identifier === touchRight) { touchRight = null; moveRight = false; }
    if (touch.identifier === touchLeft)  { touchLeft  = null; moveLeft  = false; }
    if (touch.identifier === touchJump)  { touchJump  = null; }
  }
}, { passive: false });

canvas.addEventListener('touchcancel', function(e) {
  touchRight = null;
  touchLeft  = null;
  touchJump  = null;
  moveRight  = false;
  moveLeft   = false;
}, { passive: false });

// ══════════════════════════════════════════════════════════════
// BUTTON HANDLERS
// ══════════════════════════════════════════════════════════════
document.getElementById('playBtn').addEventListener('click', function() {
  if (balance < ENTRY_FEE) return;
  balance -= ENTRY_FEE;
  refreshUI();

  document.getElementById('menuScreen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');

  moveRight  = false;
  moveLeft   = false;
  jumpQueued = false;

  initPlanets();
  gameState = 'playing';
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(gameLoop);
});

document.getElementById('restartBtn').addEventListener('click', function() {
  if (balance < ENTRY_FEE) return;
  balance -= ENTRY_FEE;
  refreshUI();

  document.getElementById('gameOverScreen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');

  moveRight  = false;
  moveLeft   = false;
  jumpQueued = false;

  initPlanets();
  gameState = 'playing';
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(gameLoop);
});

document.getElementById('menuBtn').addEventListener('click', function() {
  document.getElementById('gameOverScreen').classList.add('hidden');
  document.getElementById('menuScreen').classList.remove('hidden');

  const rb = document.getElementById('restartBtn');
  rb.disabled = false;
  rb.querySelector('.btn-label').textContent = '▶ PLAY AGAIN';

  gameState = 'menu';
  refreshUI();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(bgLoop);
});

// ══════════════════════════════════════════════════════════════
// STARTUP
// ══════════════════════════════════════════════════════════════
initStars();
refreshUI();
gameState = 'menu';
rafId = requestAnimationFrame(bgLoop);
