// Game Constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_WIDTH = 50;
const PLAYER_HEIGHT = 50;
const PLAYER_SPEED = 8;
const BULLET_SPEED = 7;
const ENEMY_WIDTH = 40;
const ENEMY_HEIGHT = 40;
const ENEMY_SPEED = 4;
const ENEMY_SHOOT_CHANCE = 0.002;
// Performance mode: enable simplified rendering on mobile/low-power devices
const LOW_GFX = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const ENEMY_CHARGE_TIME = 60; // frames enemies glow before firing
const ENEMY_POST_SHOT_COOLDOWN_MIN = 60;
const ENEMY_POST_SHOT_COOLDOWN_MAX = 120;

// Get canvas and context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI elements
const scoreElement = document.getElementById('score');
const livesElement = document.getElementById('lives');
const gameInfo = document.getElementById('gameInfo');

// Precomputed starfield for performance (avoid re-randomizing every frame)
const STARFIELD = Array.from({ length: 120 }, () => ({
    x: Math.random() * CANVAS_WIDTH,
    y: Math.random() * CANVAS_HEIGHT,
    r: Math.random() < 0.85 ? 1 : 2
}));


// Game state
const game = {
    running: true,
    paused: false,
    score: 0,
    lives: 3,
    level: 1,
    enemyWaveCount: 0,
    wave: 1,
    waveEnemiesDefeated: 0,
    // Wave spawn and pause control
    waveSpawnedCount: 0,
    waveEnemyCap: 4 + 1, // wave 1 => 5 enemies
    waveSpawning: true,
    wavePauseTimer: 0,
    wavePauseDuration: 120, // frames (~2 seconds at 60fps)
    // Boss control
    boss: null,
    pendingBoss: false,
    bossDefeats: 0
};

// Player object
const player = {
    x: CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    width: PLAYER_WIDTH,
    height: PLAYER_HEIGHT,
    speed: PLAYER_SPEED,
    image: null,
    color: '#00ff41',
    hitTimer: 0,
    maxHitTime: 30,
    // Collision impulse (enemy-like bounce). Added on top of pointer movement.
    bumpVX: 0,
    bumpVY: 0,
    vx: 0,
    vy: 0
};

// Arrays for game objects
const bullets = [];
const enemies = [];
const enemyBullets = [];
const explosions = [];
let enemyImage = null;
const powerUps = [];

// Cap particle count for performance
const MAX_EXPLOSIONS = 220;

// Player power-up state (stackable)
player.shotLevel = 1; // number of bullets per shot
// Touch / Pointer input + responsive scaling
let touchX = CANVAS_WIDTH / 2;
let touchY = CANVAS_HEIGHT - 70;

// Virtual joystick (touch) control
let joystickActive = false;
let joystickStartX = 0;
let joystickStartY = 0;
let joystickDX = 0;
let joystickDY = 0;
let joystickTouchId = null;
const JOYSTICK_RADIUS = 45; // pixels in game coords

let lastShootTime = 0;
const SHOOT_INTERVAL = 400; // 0.4 seconds in milliseconds

// Bullet lifetime (safety cap so bullets can't ever accumulate)
// 7–10 seconds at ~60fps
const BULLET_LIFE_MIN_FRAMES = 420;
const BULLET_LIFE_MAX_FRAMES = 600;

// Responsive canvas scaling (keep game logic in 800x600, scale visually to fit screen)
let renderScale = 1;
let deviceScale = 1;

// Keep drawing coordinates in the original 800x600 "game space" even when the canvas
// backing store is resized for different screens / pixel ratios.
function applyCanvasTransform() {
    const sx = canvas.width / CANVAS_WIDTH;
    const sy = canvas.height / CANVAS_HEIGHT;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    // Retro look: avoid blurring when scaled
    ctx.imageSmoothingEnabled = false;
}

function resizeCanvas() {
    const ui = document.querySelector('.ui');
    const uiH = ui ? ui.getBoundingClientRect().height : 0;

    // Leave a little padding so nothing touches the edges
    const pad = 16;
    const maxW = 1200; // allow larger than 800 on big screens (scaled up)
    const availW = Math.max(280, Math.min(window.innerWidth - pad * 2, maxW));
    const availH = Math.max(240, window.innerHeight - uiH - pad * 3);

    // Maintain the game's aspect ratio (800x600 = 4:3)
    let displayW = availW;
    let displayH = displayW * (CANVAS_HEIGHT / CANVAS_WIDTH);

    if (displayH > availH) {
        displayH = availH;
        displayW = displayH * (CANVAS_WIDTH / CANVAS_HEIGHT);
    }

    // CSS size (layout size)
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;

    // Backing store size (pixel size) for crisp rendering
    deviceScale = window.devicePixelRatio || 1;
    canvas.width = Math.round(displayW * deviceScale);
    canvas.height = Math.round(displayH * deviceScale);

    renderScale = displayW / CANVAS_WIDTH;

    applyCanvasTransform();
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', resizeCanvas);
resizeCanvas();

function clientToGameCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * CANVAS_WIDTH;
    const y = (clientY - rect.top) / rect.height * CANVAS_HEIGHT;
    return { x, y };
}

let pointerDown = false;

// Pointer events (works for mouse + touch on most devices)
canvas.addEventListener('pointerdown', (e) => {
    pointerDown = true;
    canvas.setPointerCapture?.(e.pointerId);
    const p = clientToGameCoords(e.clientX, e.clientY);
    touchX = p.x;
    touchY = p.y;
    e.preventDefault();
});

canvas.addEventListener('pointermove', (e) => {
    // For mouse: allow hover control; for touch: require contact
    if (e.pointerType === 'touch' && !pointerDown) return;
    const p = clientToGameCoords(e.clientX, e.clientY);
    touchX = p.x;
    touchY = p.y;
    e.preventDefault();
});

canvas.addEventListener('pointerup', (e) => {
    pointerDown = false;
    if (joystickActive && e.pointerType === 'touch' && (joystickTouchId === null || joystickTouchId === e.pointerId)) {
        joystickActive = false;
        joystickTouchId = null;
        joystickDX = 0;
        joystickDY = 0;
    }
    e.preventDefault();
});

canvas.addEventListener('pointercancel', (e) => {
    pointerDown = false;
    joystickActive = false;
    joystickTouchId = null;
    joystickDX = 0;
    joystickDY = 0;
    e.preventDefault();
});

// Fallback touch events (older iOS)
canvas.addEventListener('touchstart', (e) => {
    pointerDown = true;
    const t = e.changedTouches[0];
    if (t) {
        const p = clientToGameCoords(t.clientX, t.clientY);
        joystickActive = true;
        joystickStartX = p.x;
        joystickStartY = p.y;
        joystickDX = 0;
        joystickDY = 0;
        joystickTouchId = t.identifier;
    }
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    if (!pointerDown || !joystickActive) return;
    // Track the same finger that started the joystick
    let t = null;
    for (const tt of e.touches) {
        if (joystickTouchId === null || tt.identifier === joystickTouchId) { t = tt; break; }
    }
    if (t) {
        const p = clientToGameCoords(t.clientX, t.clientY);
        joystickDX = p.x - joystickStartX;
        joystickDY = p.y - joystickStartY;
        const len = Math.hypot(joystickDX, joystickDY);
        if (len > JOYSTICK_RADIUS) {
            joystickDX = (joystickDX / len) * JOYSTICK_RADIUS;
            joystickDY = (joystickDY / len) * JOYSTICK_RADIUS;
        }
    }
    e.preventDefault();
}, { passive: false });

// Prevent page scrolling while interacting with the game
document.body.addEventListener('touchmove', (e) => {
    if (pointerDown) e.preventDefault();
}, { passive: false });

// Keyboard pause control
document.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        game.paused = !game.paused;
    }
});

// Keyboard restart
document.addEventListener('keydown', (e) => {
    if ((e.key === 'r' || e.key === 'R') && game.lives <= 0) {
        location.reload();
    }
});

// Debug: press 'D' to jump to the wave BEFORE the next boss
// (Bosses spawn every 5 waves: 5,10,15,... so this jumps to 4,9,14,...)
document.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
        const nextBossWave = Math.ceil((game.wave + 1) / 5) * 5;
        const targetWave = Math.max(1, nextBossWave - 1);

        game.wave = targetWave;
        game.waveSpawnedCount = 0;
        game.waveEnemyCap = 4 + game.wave;
        game.waveSpawning = true;
        enemies.length = 0;
        game.wavePauseTimer = 0; // start spawning immediately
        game.pendingBoss = false;
        game.overrideWave = false;
        console.log('Debug: jumped to wave', game.wave, '(next boss at wave', nextBossWave + ')');
    }
});

// Debug: press 'L' to add a life (testing only)
document.addEventListener('keydown', (e) => {
    if (e.key === 'l' || e.key === 'L') {
        game.lives++;
        console.log('Debug: added a life, total lives =', game.lives);
    }
});



// Debug: press 'S' to instantly gain +1 shot level (testing only)
document.addEventListener('keydown', (e) => {
    if (e.key === 's' || e.key === 'S') {
        player.shotLevel = Math.min((player.shotLevel || 1) + 1, 10);
        console.log('Debug: +1 shot level, now =', player.shotLevel);
    }
});

// Load images (will use when PNGs are added)
function loadImages() {
    // Player image - Galaga ship
    player.image = new Image();
    player.image.src = 'https://www.pngkey.com/png/detail/273-2735899_galaga-ship-png-galaga-spaceship-png.png';
    player.image.onerror = () => {
        console.log('Player image not found, using fallback shape');
        player.image = null;
    };
    
    // Enemy image
    enemyImage = new Image();
    enemyImage.src = 'assets/enemy.png';
    enemyImage.onerror = () => {
        console.log('Enemy image not found, using fallback shape');
        enemyImage = null;
    };
}

// Draw player
function drawPlayer() {
    // Determine color based on hit state
    let displayColor = player.color;
    if (player.hitTimer > 0) {
        // Blink between red and original color
        displayColor = Math.floor(player.hitTimer / 5) % 2 === 0 ? '#ff0000' : player.color;
    }
    
    if (player.image && player.image.complete) {
        ctx.drawImage(player.image, player.x, player.y, player.width, player.height);
    } else {
        // Fallback: draw as triangle
        ctx.fillStyle = displayColor;
        ctx.beginPath();
        ctx.moveTo(player.x + player.width / 2, player.y);
        ctx.lineTo(player.x + player.width, player.y + player.height);
        ctx.lineTo(player.x, player.y + player.height);
        ctx.closePath();
        ctx.fill();
        
        // Draw outline
        ctx.strokeStyle = displayColor;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

// Update player position to follow touch/mouse exactly
function updatePlayer() {
    // Decrease hit timer
    if (player.hitTimer > 0) {
        player.hitTimer--;
    }

    // Determine intended movement:
    // - Touch uses a virtual joystick (no teleport)
    // - Mouse/pen keeps legacy "follow pointer" style for desktop
    if (joystickActive) {
        const len = Math.max(1, Math.hypot(joystickDX, joystickDY));
        const nx = joystickDX / len;
        const ny = joystickDY / len;
        const mag = Math.min(JOYSTICK_RADIUS, len) / JOYSTICK_RADIUS; // 0..1
        player.vx = nx * player.speed * mag;
        player.vy = ny * player.speed * mag;
    } else {
        // Desktop pointer follow (still smooth because we move toward touchX/Y)
        const targetX = touchX - player.width / 2;
        const targetY = touchY - player.height / 2;
        const dx = targetX - player.x;
        const dy = targetY - player.y;
        player.vx = dx * 0.25;
        player.vy = dy * 0.25;
    }

    // Apply movement + collision impulse (enemy-like bounce). Impulse decays over time.
    player.x += (player.vx || 0) + (player.bumpVX || 0);
    player.y += (player.vy || 0) + (player.bumpVY || 0);

    player.bumpVX = (player.bumpVX || 0) * 0.88;
    player.bumpVY = (player.bumpVY || 0) * 0.88;

    // Keep player in bounds (walls do NOT cause damage)
    if (player.x < 0) player.x = 0;
    if (player.x + player.width > CANVAS_WIDTH) player.x = CANVAS_WIDTH - player.width;
    if (player.y < 0) player.y = 0;
    if (player.y + player.height > CANVAS_HEIGHT) player.y = CANVAS_HEIGHT - player.height;
}

// Shoot bullet (stackable shot level)
function shootBullet() {
    const maxShots = 10;
    const n = Math.min(maxShots, Math.max(1, player.shotLevel || 1));
    const centerX = player.x + player.width / 2;
    const startY = player.y;

    // Wider horizontal spread
    const spread = 60; // pixels across the fan
    for (let k = 0; k < n; k++) {
        const t = (n === 1) ? 0.5 : (k / (n - 1)); // 0..1
        const offset = (t - 0.5) * spread;

        bullets.push({
            x: centerX + offset - 2,
            y: startY,
            width: 4,
            height: 10,
            speed: BULLET_SPEED,
            color: '#ffff00'
        });
    }
}


// Draw bullets
function drawBullets() {
    ctx.fillStyle = '#ffff00';
    bullets.forEach(bullet => {
        ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
    });
}

// Update bullets
function updateBullets() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].y -= bullets[i].speed;
        if (typeof bullets[i].lifeFrames === 'number') bullets[i].lifeFrames--;
        
        // Remove bullets that go off screen
        if (bullets[i].y < -50 || (typeof bullets[i].lifeFrames === 'number' && bullets[i].lifeFrames <= 0)) {
            bullets.splice(i, 1);
        }
    }
}

// Enemy tiers (ordered weakest -> strongest)
const ENEMY_TIERS = [
    { type: 'red',    hp: 1, color: '#ff0000' },
    { type: 'blue',   hp: 2, color: '#0066ff' },
    { type: 'green',  hp: 3, color: '#00aa00' },
    { type: 'yellow', hp: 4, color: '#ffff00' },
    { type: 'pink',   hp: 5, color: '#ff66cc' },
    { type: 'purple', hp: 6, color: '#9933ff' },
    { type: 'orange', hp: 7, color: '#ff9900' },
    { type: 'white',  hp: 8, color: '#ffffff' },
];

function getTierDef(type) {
    return ENEMY_TIERS.find(t => t.type === type) || ENEMY_TIERS[1]; // default blue
}

// Tier unlock rules:
// - Wave progression unlocks up to tier 4 naturally (red->blue->green->yellow)
// - Tiers 5+ require bosses defeated (pink->purple->orange->white)
function getAllowedEnemyTierCount() {
    // Unlock more tiers slowly with wave, up to 8
    const waveTierCap = Math.min(8, 1 + Math.floor((game.wave - 1) / 3)); // +1 tier every ~3 waves
    // Bosses defeated unlock tiers beyond yellow (tier 4)
    const bossTierCap = 4 + Math.min(4, game.bossDefeats); // 0 bosses => 4 tiers max, 1 boss => 5, ... 4+ => 8
    return Math.min(waveTierCap, bossTierCap);
}

function pickEnemyType() {
    const allowed = getAllowedEnemyTierCount();

    // Wave-based tier probabilities:
    // Wave 1: all red
    // As waves increase, odds gradually shift toward higher tiers (within the allowed cap).
    if (game.wave <= 1) return 'red';

    const weights = [];
    let total = 0;

    // "bias" moves upward as wave increases, capped to the highest allowed tier.
    // Tweak 0.35 and sigma to make progression faster/slower.
    const bias = Math.min(allowed - 1, (game.wave - 1) * 0.35);
    const sigma = 1.15; // spread of the curve (higher = more mixed tiers)

    for (let i = 0; i < allowed; i++) {
        // Gaussian-ish curve centered on bias
        let w = Math.exp(-Math.pow(i - bias, 2) / (2 * sigma * sigma));

        // Keep a small floor so lower tiers don't vanish completely
        w += 0.04;

        weights.push(w);
        total += w;
    }

    let r = Math.random() * total;
    for (let i = 0; i < allowed; i++) {
        r -= weights[i];
        if (r <= 0) return ENEMY_TIERS[i].type;
    }
    return ENEMY_TIERS[Math.max(0, allowed - 1)].type;
}


// Create enemy
function createEnemy(type = 'blue') {
    const def = getTierDef(type);
    const health = def.hp;
    const color = def.color;

    return {
        x: Math.random() * (CANVAS_WIDTH - ENEMY_WIDTH),
        y: -ENEMY_HEIGHT,
        width: ENEMY_WIDTH,
        height: ENEMY_HEIGHT,
        speed: ENEMY_SPEED,
        image: null,
        color: color,
        health: health,
        maxHealth: health,
        type: type,
        shootTimer: 0,
        shootCharge: 0,
        shootCooldown: Math.floor(ENEMY_POST_SHOT_COOLDOWN_MIN + Math.random() * (ENEMY_POST_SHOT_COOLDOWN_MAX - ENEMY_POST_SHOT_COOLDOWN_MIN)),
        waveTime: Math.random() * 100,
        formationX: 0,
        formationY: 0,
        inFormation: false,
        // Small collision impulse so enemies bounce off each other without changing core movement
        bumpVX: 0,
        bumpVY: 0,
        // Zero-gravity drift physics (activates after reaching formation target)
        vx: 0,
        vy: 0,
        formationComplete: false
    };
}

// Create a miniboss
function createBoss() {
    const baseHP = 50;
    const hp = baseHP + (game.bossDefeats * 50); // +50 HP per previous boss // fixed boss HP (50 hits)
    const w = 80;
    const h = 80;
    // Scale difficulty with previous boss defeats (reduces cooldowns)
    const bossReduction = Math.min(80, game.bossDefeats * 12);
    const shootBase = Math.max(40, 120 - bossReduction);
    const shootRandMax = Math.max(40, 180 - bossReduction);
    const chargeBase = Math.max(20, 40 - Math.floor(game.bossDefeats * 3));
    const chargeRandMax = Math.max(1, 41 - Math.floor(game.bossDefeats * 3));
    return {
        x: CANVAS_WIDTH / 2 - w / 2,
        y: -h - 10,
        width: w,
        height: h,
        speed: 1,
        health: hp,
        maxHealth: hp,
        waveTime: 0,
        invulnerable: 60, // frames of spawn invulnerability to avoid instant damage
        // attack timing and charging (scaled down by previous defeats)
        shootCooldown: shootBase + Math.floor(Math.random() * shootRandMax),
        isCharging: false,
        chargeTimer: 0,
        // Reduced charge durations (shorter telegraph)
        chargeDuration: chargeBase + Math.floor(Math.random() * chargeRandMax),
        nextAttackType: (Math.random() < 0.34 ? 'massive' : (Math.random() < 0.67 ? 'burst' : 'bounce')),
        // Movement targets and behavior for freer roaming
        targetX: CANVAS_WIDTH / 2,
        targetY: 80,
        moveTimer: 60 + Math.floor(Math.random() * 120),
        // Prevent repeated ramming damage in consecutive frames
        hitCooldown: 0,
        type: 'boss'
    };
} 

// Draw enemies
function drawEnemies() {
    enemies.forEach(enemy => {
        let tint = enemy.color || '#ffffff';

        if (enemyImage && enemyImage.complete) {
            ctx.drawImage(enemyImage, enemy.x, enemy.y, enemy.width, enemy.height);
            // Apply translucent tint so the sprite reflects damage/state
            try {
                ctx.globalAlpha = 0.32;
                ctx.fillStyle = tint;
                ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
            } finally {
                ctx.globalAlpha = 1;
            }
        } else {
            // Fallback: draw as square
            ctx.fillStyle = tint;
            ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
            
            // Draw outline
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(enemy.x, enemy.y, enemy.width, enemy.height);
        }

// Telegraph before shooting: red blinking silhouette
if (enemy.shootCharge && enemy.shootCharge > 0) {
    const t = 1 - (enemy.shootCharge / ENEMY_CHARGE_TIME); // 0 -> 1
    const blinkOn = (Math.floor(enemy.shootCharge / 6) % 2) === 0;
    const alpha = blinkOn ? (0.20 + 0.65 * t) : (0.08 + 0.25 * t);

            // On low graphics mode, only render the overlay on blink-on frames
            if (LOW_GFX && !blinkOn) {
                // Skip drawing the silhouette this frame to save GPU work
                // (attack timing is unchanged)
                // return from this telegraph block
            }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = LOW_GFX ? 0 : (10 + t * 14);

    // Silhouette overlay (works for both sprite and fallback)
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);

    // Strong outline
    ctx.globalAlpha = Math.min(1, alpha + 0.25);
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 3;
    ctx.strokeRect(enemy.x - 1, enemy.y - 1, enemy.width + 2, enemy.height + 2);
    ctx.restore();
}
    });
}

// Update enemies
function updateEnemies() {
    // Boss incoming trigger for waves 5,10,15,20,... (every 5 levels)
// Spawn boss immediately and override normal waves for that milestone.
if ((game.wave % 5) === 0 && game.waveSpawnedCount === 0 && game.waveSpawning && !game.pendingBoss) {
    game.pendingBoss = false;
    game.waveSpawning = false;
    game.overrideWave = true; // block normal waves
    enemies.length = 0;
    game.boss = createBoss();
    console.log('Boss spawned. HP:', game.boss.maxHealth);
    game.waveSpawnedCount = 1; // boss counts as spawned
    game.wavePauseTimer = 0;
    return;
}

    // If boss is active, update boss only
    if (game.boss) {
        const boss = game.boss;
        boss.waveTime++;

        // Free roaming: occasionally pick a new target and smoothly move toward it
        boss.moveTimer--;
        if (boss.moveTimer <= 0) {
            boss.targetX = 50 + Math.random() * (CANVAS_WIDTH - 100 - boss.width);
            boss.targetY = 40 + Math.random() * (CANVAS_HEIGHT / 2 - 60);
            boss.moveTimer = 60 + Math.floor(Math.random() * 120);
        }
        // Smooth approach
        boss.x += (boss.targetX - boss.x) * 0.03;
        boss.y += (boss.targetY - boss.y) * 0.03;
        // Keep boss in bounds (stay in upper half)
        if (boss.x < 0) boss.x = 0;
        if (boss.x + boss.width > CANVAS_WIDTH) boss.x = CANVAS_WIDTH - boss.width;
        if (boss.y < 0) boss.y = 0;
        if (boss.y + boss.height > CANVAS_HEIGHT / 1.5) boss.y = CANVAS_HEIGHT / 1.5 - boss.height;

        // decrement ram hit cooldown
        if (boss.hitCooldown && boss.hitCooldown > 0) boss.hitCooldown--;

        // Handle spawn invulnerability (still move, but do not attack)
        if (boss.invulnerable && boss.invulnerable > 0) {
            boss.invulnerable--;
        }

        // Charge / attack logic (only if not invulnerable)
        if (boss.invulnerable <= 0) {
            if (!boss.isCharging) {
                boss.shootCooldown--;
                if (boss.shootCooldown <= 0) {
                    boss.isCharging = true;
                    boss.chargeTimer = boss.chargeDuration;
                    const r = Math.random();
                    boss.nextAttackType = (r < 0.25 ? 'massive' : (r < 0.50 ? 'burst' : (r < 0.75 ? 'bounce' : 'seeker')));
                }
            } else {
                boss.chargeTimer--;
                if (boss.chargeTimer <= 0) {
                    // Perform attack
                    if (boss.nextAttackType === 'massive') {
                        // Big straight projectile (larger)
                        shootEnemyBullet(boss, 0, 8, 28, 56, '#ff9900');
                    } else if (boss.nextAttackType === 'burst') {
                        // Burst in 6 directions (larger)
                        for (let i = 0; i < 6; i++) {
                            const angle = (i / 6) * Math.PI * 2;
                            const vx = Math.cos(angle) * 5;
                            const vy = Math.sin(angle) * 5;
                            shootEnemyBullet(boss, vx, vy, 14, 14, '#ff66ff');
                        }
                    } else if (boss.nextAttackType === 'bounce') {
                        // Bouncing mini-star projectile
                        // Starts aimed roughly toward the player, then ricochets around the screen
                        const px = player.x + player.width / 2;
                        const py = player.y + player.height / 2;
                        const bx = boss.x + boss.width / 2;
                        const by = boss.y + boss.height / 2;
                        const dx = px - bx;
                        const dy = py - by;
                        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                        const speed = 6;
                        let vx = (dx / dist) * speed;
                        let vy = (dy / dist) * speed;
                        // Add a tiny random twist so it isn't perfectly predictable
                        vx += (Math.random() - 0.5) * 1.2;
                        vy += (Math.random() - 0.5) * 1.2;
                        shootEnemyBouncyStar(boss, vx, vy);
                    } else {
                        // Slow homing triangle projectile (tracks player, times out)
                        shootEnemySeekerTriangle(boss);
                    }
                    boss.isCharging = false;
                    boss.shootCooldown = Math.max(40, 180 - game.bossDefeats * 20 + Math.floor(Math.random() * Math.max(20, 240 - game.bossDefeats * 20)));
                    // shorter re-charge duration scaled by defeats
                    boss.chargeDuration = Math.max(15, 30 - Math.floor(game.bossDefeats * 2) + Math.floor(Math.random() * Math.max(1, 61 - game.bossDefeats * 2)));
                
                }
            }
        }
        return;
    }

    // Wave system - spawn a capped number per wave, with a pause after a wave clears
    const maxEnemies = 12 + game.wave * 3;
    // Enemy tier progression:
// red -> blue -> green -> yellow unlock by wave
// pink -> purple -> orange -> white unlock only after bosses are defeated
// (tiers 5+ require game.bossDefeats)
// Only spawn while current wave is in spawning state and not overridden by a boss
if (!game.overrideWave && game.waveSpawning && game.waveSpawnedCount < game.waveEnemyCap && enemies.length < maxEnemies) {
    if (Math.random() < 0.03) {
        const type = pickEnemyType();
        enemies.push(createEnemy(type));
        game.waveSpawnedCount++;
    }
}


    // If we've spawned the cap and all enemies are cleared, start the pause before next wave
    if (game.waveSpawnedCount >= game.waveEnemyCap && enemies.length === 0 && game.waveSpawning) {
        game.waveSpawning = false;
        // Fixed pause: 5 seconds (assuming ~60fps)
        game.wavePauseTimer = 300;
    }

    // Move enemies
    enemies.forEach((enemy, index) => {
        enemy.waveTime++;        if (!enemy.inFormation) {
            // Pattern movement - sine wave
            enemy.y += enemy.speed;
            enemy.x = enemy.x + Math.sin(enemy.waveTime * 0.05) * 1.5;

            // Check if enemy should enter formation (reached middle of screen)
            if (enemy.y > CANVAS_HEIGHT / 3) {
                enemy.inFormation = true;
                enemy.formationComplete = false;
                // Calculate position in formation (3x3 grid centered)
                const formationIndex = enemies.indexOf(enemy) % 9;
                const row = Math.floor(formationIndex / 3);
                const col = formationIndex % 3;
                enemy.formationX = CANVAS_WIDTH / 2 - 60 + col * 60;
                enemy.formationY = CANVAS_HEIGHT / 2 - 60 + row * 60;
            }
        } else if (!enemy.formationComplete) {
            // Move smoothly to formation position (pathfinding/settle)
            const dx = enemy.formationX - enemy.x;
            const dy = enemy.formationY - enemy.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 3) {
                const speed = 1;
                enemy.x += (dx / distance) * speed;
                enemy.y += (dy / distance) * speed;
            } else {
                // Formation reached: switch to zero-gravity drift mode
                enemy.formationComplete = true;
                enemy.vx = 0;
                enemy.vy = 0;
            }
        } else {
            // Zero gravity: drift & bounce when bumped by other enemies/objects
            enemy.x += enemy.vx;
            enemy.y += enemy.vy;

            // Very light damping so it doesn't drift forever at high speed
            enemy.vx *= 0.995;
            enemy.vy *= 0.995;

            // Bounce off walls
            const restitution = 0.90;
            if (enemy.x < 0) { enemy.x = 0; enemy.vx = Math.abs(enemy.vx) * restitution; }
            if (enemy.x + enemy.width > CANVAS_WIDTH) { enemy.x = CANVAS_WIDTH - enemy.width; enemy.vx = -Math.abs(enemy.vx) * restitution; }
            if (enemy.y < 0) { enemy.y = 0; enemy.vy = Math.abs(enemy.vy) * restitution; }
            if (enemy.y + enemy.height > CANVAS_HEIGHT) { enemy.y = CANVAS_HEIGHT - enemy.height; enemy.vy = -Math.abs(enemy.vy) * restitution; }
        }

        // Apply small collision impulses (from enemy-enemy bumps)
        if (enemy.bumpVX || enemy.bumpVY) {
            enemy.x += enemy.bumpVX;
            enemy.y += enemy.bumpVY;
            enemy.bumpVX *= 0.82;
            enemy.bumpVY *= 0.82;
            if (Math.abs(enemy.bumpVX) < 0.02) enemy.bumpVX = 0;
            if (Math.abs(enemy.bumpVY) < 0.02) enemy.bumpVY = 0;
        }

        // Enemy attack telegraph: glow for a moment before shooting
if (enemy.shootCharge && enemy.shootCharge > 0) {
    enemy.shootCharge--;
    if (enemy.shootCharge <= 0) {
        shootEnemyBullet(enemy);
        enemy.shootCooldown = Math.floor(ENEMY_POST_SHOT_COOLDOWN_MIN + Math.random() * (ENEMY_POST_SHOT_COOLDOWN_MAX - ENEMY_POST_SHOT_COOLDOWN_MIN));
    }
} else {
    if (enemy.shootCooldown && enemy.shootCooldown > 0) {
        enemy.shootCooldown--;
    } else if (Math.random() < ENEMY_SHOOT_CHANCE) {
        enemy.shootCharge = ENEMY_CHARGE_TIME;
    }
}

        
        // Keep enemies in horizontal bounds
        if (enemy.x < 0) enemy.x = 0;
        if (enemy.x + enemy.width > CANVAS_WIDTH) enemy.x = CANVAS_WIDTH - enemy.width;
    });
    // Soft repulsion prevents stacking even before overlaps happen
    applyEnemyRepulsion();

    // Resolve overlaps and add collision impulse
    resolveEnemyCollisions();
}

// Soft repulsion so enemies don't stack (acts like a gentle outward gravity).
function applyEnemyRepulsion() {
    const n = enemies.length;
    if (n < 2) return;

    // Tunables
    const radius = 70;          // how far the repulsion reaches
    const strength = 0.018;     // acceleration per frame at close range
    const maxAccel = 0.12;      // cap so it stays subtle

    for (let i = 0; i < n; i++) {
        const a = enemies[i];
        const acx = a.x + a.width / 2;
        const acy = a.y + a.height / 2;
        for (let j = i + 1; j < n; j++) {
            const b = enemies[j];
            const bcx = b.x + b.width / 2;
            const bcy = b.y + b.height / 2;

            let dx = bcx - acx;
            let dy = bcy - acy;
            let dist = Math.hypot(dx, dy);

            if (dist === 0) {
                dx = (Math.random() - 0.5) || 0.01;
                dy = (Math.random() - 0.5) || 0.01;
                dist = Math.hypot(dx, dy);
            }

            if (dist < radius) {
                const nx = dx / dist;
                const ny = dy / dist;
                // 1 at dist=0, 0 at dist=radius
                const t = (radius - dist) / radius;
                const accel = Math.min(maxAccel, strength * t);

                // Push away from each other.
                if (a.formationComplete) {
                    a.vx -= nx * accel;
                    a.vy -= ny * accel;
                } else {
                    a.bumpVX = (a.bumpVX || 0) - nx * accel;
                    a.bumpVY = (a.bumpVY || 0) - ny * accel;
                }

                if (b.formationComplete) {
                    b.vx += nx * accel;
                    b.vy += ny * accel;
                } else {
                    b.bumpVX = (b.bumpVX || 0) + nx * accel;
                    b.bumpVY = (b.bumpVY || 0) + ny * accel;
                }
            }
        }
    }
}

// Separation + bounce impulse so enemies don't overlap and will shove each other around.
function resolveEnemyCollisions() {
    const n = enemies.length;
    if (n < 2) return;

    // Tunables
    const impulseStrength = 0.22;
    const maxImpulse = 3.0;

    for (let i = 0; i < n; i++) {
        const a = enemies[i];
        const ar = Math.min(a.width, a.height) / 2;
        const acx = a.x + a.width / 2;
        const acy = a.y + a.height / 2;

        for (let j = i + 1; j < n; j++) {
            const b = enemies[j];
            const br = Math.min(b.width, b.height) / 2;
            const bcx = b.x + b.width / 2;
            const bcy = b.y + b.height / 2;

            let dx = bcx - acx;
            let dy = bcy - acy;
            let dist = Math.hypot(dx, dy);
            const minDist = ar + br;

            if (dist === 0) {
                dx = (Math.random() - 0.5) || 0.01;
                dy = (Math.random() - 0.5) || 0.01;
                dist = Math.hypot(dx, dy);
            }

            if (dist < minDist) {
                const nx = dx / dist;
                const ny = dy / dist;
                const overlap = (minDist - dist);

                // Hard separation: move each enemy by half the overlap
                const push = overlap / 2;
                a.x -= nx * push;
                a.y -= ny * push;
                b.x += nx * push;
                b.y += ny * push;

                // Bounce impulse: adds shove so it feels like collision
                const imp = Math.min(maxImpulse, overlap * impulseStrength);

                // If they finished formation, they drift (vx/vy). Otherwise keep it as a small bump.
                if (a.formationComplete) {
                    a.vx -= nx * imp;
                    a.vy -= ny * imp;
                } else {
                    a.bumpVX = (a.bumpVX || 0) - nx * imp;
                    a.bumpVY = (a.bumpVY || 0) - ny * imp;
                }

                if (b.formationComplete) {
                    b.vx += nx * imp;
                    b.vy += ny * imp;
                } else {
                    b.bumpVX = (b.bumpVX || 0) + nx * imp;
                    b.bumpVY = (b.bumpVY || 0) + ny * imp;
                }
            }
        }
    }

    // Keep everyone in bounds after separation/impulses
    for (let i = 0; i < n; i++) {
        const e = enemies[i];
        if (e.x < 0) { e.x = 0; if (e.formationComplete) e.vx = Math.abs(e.vx || 0); else e.bumpVX = Math.abs(e.bumpVX || 0); }
        if (e.x + e.width > CANVAS_WIDTH) { e.x = CANVAS_WIDTH - e.width; if (e.formationComplete) e.vx = -Math.abs(e.vx || 0); else e.bumpVX = -Math.abs(e.bumpVX || 0); }
        if (e.y < 0) { e.y = 0; if (e.formationComplete) e.vy = Math.abs(e.vy || 0); else e.bumpVY = Math.abs(e.bumpVY || 0); }
        if (e.y + e.height > CANVAS_HEIGHT) { e.y = CANVAS_HEIGHT - e.height; if (e.formationComplete) e.vy = -Math.abs(e.vy || 0); else e.bumpVY = -Math.abs(e.bumpVY || 0); }
    }
}


// Enemy shoot (supports vx/vy bullets)
function shootEnemyBullet(enemy, vx = 0, vy = 4, width = 4, height = 10, color = '#ff6666') {
    enemyBullets.push({
        x: enemy.x + enemy.width / 2 - width / 2,
        y: enemy.y + enemy.height / 2 - height / 2,
        vx: vx,
        vy: vy,
        width: width,
        height: height,
        color: color
    });
}



// Boss special: bouncing star projectile
function shootEnemyBouncyStar(enemy, vx, vy) {
    const size = 18;
    enemyBullets.push({
        x: enemy.x + enemy.width / 2 - size / 2,
        y: enemy.y + enemy.height / 2 - size / 2,
        vx: vx,
        vy: vy,
        width: size,
        height: size,
        color: '#66ccff',
        kind: 'bouncyStar',
        bouncesLeft: 10
    });
}

// Boss special: slow homing triangle that tracks the player, despawns after 10-15 seconds
function shootEnemySeekerTriangle(enemy) {
    const size = 16; // smallish
    const ttl = 600 + Math.floor(Math.random() * 301); // 10-15 seconds @ ~60fps
    const px = player.x + player.width / 2;
    const py = player.y + player.height / 2;
    const bx = enemy.x + enemy.width / 2;
    const by = enemy.y + enemy.height / 2;
    const dx = px - bx;
    const dy = py - by;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const speed = 2.0; // slow
    enemyBullets.push({
        x: enemy.x + enemy.width / 2 - size / 2,
        y: enemy.y + enemy.height / 2 - size / 2,
        vx: (dx / dist) * speed,
        vy: (dy / dist) * speed,
        width: size,
        height: size,
        color: '#ff3333',
        kind: 'seekerTriangle',
        ttl: ttl
    });
}


// Draw enemy bullets
function drawEnemyBullets() {
    enemyBullets.forEach(bullet => {
        if (bullet.kind === 'bouncyStar') {
    // Cheap draw for performance (stars can be expensive on mobile)
    const cx = bullet.x + bullet.width / 2;
    const cy = bullet.y + bullet.height / 2;
    if (LOW_GFX) {
        ctx.fillStyle = bullet.color || '#66ccff';
        ctx.beginPath();
        ctx.moveTo(cx, cy - bullet.height / 2);
        ctx.lineTo(cx + bullet.width / 2, cy);
        ctx.lineTo(cx, cy + bullet.height / 2);
        ctx.lineTo(cx - bullet.width / 2, cy);
        ctx.closePath();
        ctx.fill();
    } else {
        drawStar(ctx, cx, cy, 5, bullet.width / 2, bullet.width / 4, bullet.color || '#66ccff', '#ffffff');
    }
} else if (bullet.kind === 'seekerTriangle') {
            // Tracker projectile — draw as a circle for clearer readability
            const cx = bullet.x + bullet.width / 2;
            const cy = bullet.y + bullet.height / 2;
            const r = Math.min(bullet.width, bullet.height) / 2;

            ctx.fillStyle = bullet.color || '#ff3333';
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();

            // Subtle outline so it stays visible on bright backgrounds
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.fillStyle = bullet.color || '#ff6666';
            ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
        }
    });
}


// Update enemy bullets
function updateEnemyBullets() {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];

        // Homing triangle: slowly turn toward the player; despawn after TTL
        if (b.kind === 'seekerTriangle') {
            b.ttl = (b.ttl ?? 600) - 1;
            if (b.ttl <= 0) {
                enemyBullets.splice(i, 1);
                continue;
            }
            const px = player.x + player.width / 2;
            const py = player.y + player.height / 2;
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2;
            const dx = px - cx;
            const dy = py - cy;
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const speed = 2.0; // slow
            const desiredVx = (dx / dist) * speed;
            const desiredVy = (dy / dist) * speed;
            const turn = 0.06; // how quickly it can turn
            b.vx = (b.vx ?? desiredVx) * (1 - turn) + desiredVx * turn;
            b.vy = (b.vy ?? desiredVy) * (1 - turn) + desiredVy * turn;
        }

        b.x += b.vx || 0;
        b.y += b.vy || 0;

        // Special: boss bouncing star (10 bounces then disappears)
        if (b.kind === 'bouncyStar') {
            let bounced = false;

            if (b.x <= 0) {
                b.x = 0;
                b.vx = Math.abs(b.vx || 0) || 4;
                bounced = true;
            } else if (b.x + b.width >= CANVAS_WIDTH) {
                b.x = CANVAS_WIDTH - b.width;
                b.vx = -Math.abs(b.vx || 0) || -4;
                bounced = true;
            }

            if (b.y <= 0) {
                b.y = 0;
                b.vy = Math.abs(b.vy || 0) || 4;
                bounced = true;
            } else if (b.y + b.height >= CANVAS_HEIGHT) {
                b.y = CANVAS_HEIGHT - b.height;
                b.vy = -Math.abs(b.vy || 0) || -4;
                bounced = true;
            }

            if (bounced) {
                b.bouncesLeft = (b.bouncesLeft ?? 10) - 1;
                if (b.bouncesLeft <= 0) {
                    enemyBullets.splice(i, 1);
                    continue;
                }
            }
        }

        // Check collision with player
        if (checkCollision(b, player)) {
            game.lives--;
            player.hitTimer = player.maxHitTime;
            createExplosion(player.x + player.width / 2, player.y + player.height / 2);
            enemyBullets.splice(i, 1);
            continue;
        }

        // Remove bullets that go off screen (skip bouncy stars; they bounce)
        if (b.kind !== 'bouncyStar' && (b.y > CANVAS_HEIGHT + 50 || b.y < -50 || b.x < -50 || b.x > CANVAS_WIDTH + 50)) {
            enemyBullets.splice(i, 1);
        }
    }
}

// Check collision between two objects
function checkCollision(obj1, obj2) {
    return obj1.x < obj2.x + obj2.width &&
           obj1.x + obj1.width > obj2.x &&
           obj1.y < obj2.y + obj2.height &&
           obj1.y + obj1.height > obj2.y;
}

// Collision detection
function checkCollisions() {
    // Bullet vs Enemy / Boss / Bouncy Star
    for (let i = bullets.length - 1; i >= 0; i--) {
        let bulletUsed = false;

        // Bullet vs Enemy (tier pop)
        for (let j = enemies.length - 1; j >= 0; j--) {
            if (checkCollision(bullets[i], enemies[j])) {
                createExplosion(enemies[j].x + enemies[j].width / 2, enemies[j].y + enemies[j].height / 2);
                bullets.splice(i, 1);
                bulletUsed = true;

                // Each hit drops one tier: white -> ... -> red -> dead
                const currentIndex = ENEMY_TIERS.findIndex(t => t.type === enemies[j].type);

                // Knockback: only higher-tier enemies (more layers) get pushed by player shots.
                // Not applied to bosses (boss has its own collision branch).
                if (currentIndex >= 1) {
                    const ex = enemies[j].x + enemies[j].width / 2;
                    const ey = enemies[j].y + enemies[j].height / 2;
                    const px = player.x + player.width / 2;
                    const py = player.y + player.height / 2;
                    let dx = ex - px;
                    let dy = ey - py;
                    const dist = Math.max(1, Math.hypot(dx, dy));
                    dx /= dist;
                    dy /= dist;

                    // Slightly stronger knock for higher tiers, but keep it subtle.
                    const base = 0.9;
                    const perTier = 0.22;
                    const knock = Math.min(2.2, base + perTier * currentIndex);

                    if (enemies[j].formationComplete) {
                        // In zero-gravity drift mode, apply to vx/vy so it keeps drifting.
                        enemies[j].vx = (enemies[j].vx || 0) + dx * knock;
                        enemies[j].vy = (enemies[j].vy || 0) + dy * knock;
                    } else {
                        // While pathing/settling, apply as a short impulse (bump) so it doesn't break formation logic.
                        enemies[j].bumpVX = (enemies[j].bumpVX || 0) + dx * knock;
                        enemies[j].bumpVY = (enemies[j].bumpVY || 0) + dy * knock;
                    }
                }

                if (currentIndex <= 0) {
                    // Red (or unknown) -> destroyed
                    game.score += 100 * (enemies[j].maxHealth || 1);
                    enemies.splice(j, 1);
                    game.waveEnemiesDefeated++;
                } else {
                    const nextTier = ENEMY_TIERS[currentIndex - 1];
                    enemies[j].type = nextTier.type;
                    enemies[j].color = nextTier.color;
                    enemies[j].health = nextTier.hp;
                    // keep original maxHealth for scoring value if desired
                    enemies[j].maxHealth = enemies[j].maxHealth || ENEMY_TIERS[currentIndex].hp;
                }
                break;
            }
        }
        if (bulletUsed) continue;

        // Player bullets do NOT interact with bouncy stars; they behave like normal enemy projectiles.
// Bullet vs Boss (skip if boss invulnerable)
        if (game.boss && game.boss.invulnerable <= 0 && checkCollision(bullets[i], game.boss)) {
            game.boss.health--;
            createExplosion(game.boss.x + game.boss.width / 2, game.boss.y + game.boss.height / 2);
            bullets.splice(i, 1);

            if (game.boss.health <= 0) {
                createExplosion(game.boss.x + game.boss.width / 2, game.boss.y + game.boss.height / 2);

                // Spawn a double-shot powerup at the boss location
                powerUps.push({
                    x: game.boss.x + game.boss.width / 2 - 10,
                    y: game.boss.y + game.boss.height / 2 - 10,
                    width: 20,
                    height: 20,
                    type: 'shot',
                    duration: 600,
                    floatOffset: Math.random() * Math.PI * 2
                });

                // Reward note: small life boost, track defeats to scale future bosses and unlock tiers
                game.lives += 2;
                game.bossDefeats++;
                game.score += 2000;

                game.boss = null;
                game.overrideWave = false;

                // Start pause before next wave
                game.waveSpawning = false;
                game.wavePauseTimer = 300;
                game.waveSpawnedCount = game.waveEnemyCap;
            }
        }
    }

    // Player takes damage when colliding with any enemy type (walls do not hurt)
    for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (checkCollision(player, e)) {
            // Damage gate so you don't lose all lives instantly while overlapping
            if (player.hitTimer <= 0) {
                game.lives--;
                player.hitTimer = player.maxHitTime;
                createExplosion(player.x + player.width / 2, player.y + player.height / 2);
            }

            // Enemy-style bounce impulse for both player and enemy
            const px = player.x + player.width / 2;
            const py = player.y + player.height / 2;
            const ex = e.x + e.width / 2;
            const ey = e.y + e.height / 2;
            let dx = ex - px;
            let dy = ey - py;
            const dist = Math.max(1, Math.hypot(dx, dy));
            dx /= dist;
            dy /= dist;

            const shove = 2.3;
            // Nudge enemy out of the player so they don't stay stacked on top of each other
            e.x += dx * 1.5;
            e.y += dy * 1.5;
            player.bumpVX = (player.bumpVX || 0) - dx * shove;
            player.bumpVY = (player.bumpVY || 0) - dy * shove;

            if (e.formationComplete) {
                e.vx = (e.vx || 0) + dx * shove;
                e.vy = (e.vy || 0) + dy * shove;
            } else {
                e.bumpVX = (e.bumpVX || 0) + dx * shove;
                e.bumpVY = (e.bumpVY || 0) + dy * shove;
            }
        }
    }

    // Player ramming damage vs boss (separate from bullet loop)
    if (game.boss && game.boss.invulnerable <= 0 && game.boss.hitCooldown <= 0 && checkCollision(player, game.boss)) {
        // Collision hurts the player too (walls don't hurt)
        if (player.hitTimer <= 0) {
            game.lives--;
            createExplosion(player.x + player.width / 2, player.y + player.height / 2);
        }
        game.boss.health--;
        game.boss.hitCooldown = 30;
        createExplosion(game.boss.x + game.boss.width / 2, game.boss.y + game.boss.height / 2);
        player.hitTimer = player.maxHitTime;

        // Bounce the player away a bit (enemy-style impulse)
        const px = player.x + player.width / 2;
        const py = player.y + player.height / 2;
        const bx = game.boss.x + game.boss.width / 2;
        const by = game.boss.y + game.boss.height / 2;
        let dx = bx - px;
        let dy = by - py;
        const dist = Math.max(1, Math.hypot(dx, dy));
        dx /= dist;
        dy /= dist;
        player.bumpVX = (player.bumpVX || 0) - dx * 3.0;
        player.bumpVY = (player.bumpVY || 0) - dy * 3.0;

        if (game.boss.health <= 0) {
            createExplosion(game.boss.x + game.boss.width / 2, game.boss.y + game.boss.height / 2);

            powerUps.push({
                x: game.boss.x + game.boss.width / 2 - 10,
                y: game.boss.y + game.boss.height / 2 - 10,
                width: 20,
                height: 20,
                type: 'shot',
                duration: 600,
                floatOffset: Math.random() * Math.PI * 2
            });

            game.lives += 2;
            game.bossDefeats++;
            game.score += 2000;

            game.boss = null;
            game.overrideWave = false;
            game.waveSpawning = false;
            game.wavePauseTimer = 300;
            game.waveSpawnedCount = game.waveEnemyCap;
        }
    }

    // Power-up pickup: player collects power-up to enable double-shot
    for (let p = powerUps.length - 1; p >= 0; p--) {
        const pu = powerUps[p];
        if (checkCollision(player, pu)) {
            if (pu.type === 'shot') {
                player.shotLevel = Math.min((player.shotLevel || 1) + 1, 10);
            }
            createExplosion(pu.x + pu.width / 2, pu.y + pu.height / 2);
            powerUps.splice(p, 1);
            game.score += 250;
        }
    }
}


// Create explosion effect
function createExplosion(x, y) {
    const count = LOW_GFX ? 4 : 8;
    for (let i = 0; i < count; i++) {
        explosions.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            life: 30,
            maxLife: 30,
            color: `hsl(${Math.random() * 60}, 100%, 50%)`
        });
    }
    // Keep particle list bounded
    if (explosions.length > MAX_EXPLOSIONS) {
        explosions.splice(0, explosions.length - MAX_EXPLOSIONS);
    }
}

// Draw explosions
function drawExplosions() {
    explosions.forEach((exp) => {
        const alpha = exp.life / exp.maxLife;
        ctx.fillStyle = exp.color;
        ctx.globalAlpha = alpha;
        if (LOW_GFX) {
            ctx.fillRect(exp.x, exp.y, 3, 3);
        } else {
            ctx.beginPath();
            ctx.arc(exp.x, exp.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    });
}


// Draw and update power-ups
function drawPowerUps() {
    powerUps.forEach(p => {
        const floatY = Math.sin((p.floatOffset || 0)) * 4;
        // Diamond shape
        ctx.fillStyle = '#66ffff';
        ctx.beginPath();
        ctx.moveTo(p.x + p.width / 2, p.y + floatY);
        ctx.lineTo(p.x + p.width, p.y + p.height / 2 + floatY);
        ctx.lineTo(p.x + p.width / 2, p.y + p.height + floatY);
        ctx.lineTo(p.x, p.y + p.height / 2 + floatY);
        ctx.closePath();
        ctx.fill();
        // Label
        ctx.fillStyle = '#003344';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('+1', p.x + p.width / 2, p.y + p.height / 2 + 4 + floatY);
    });
}

function updatePowerUps() {
    for (let i = powerUps.length - 1; i >= 0; i--) {
        const p = powerUps[i];
        p.floatOffset = (p.floatOffset || 0) + 0.08;
        // Optional: expire uncollected power-ups after a long time - omitted for now
    }
}

// Draw boss (top-level)
function drawBoss() {
    const b = game.boss;
    if (!b) return;

    // Low graphics boss: simple rectangle (much faster than star path drawing)
    if (LOW_GFX) {
        ctx.fillStyle = '#990099';
        ctx.fillRect(b.x, b.y, b.width, b.height);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x, b.y, b.width, b.height);

        // Health bar above boss
        const barW = b.width;
        const barH = 12;
        const bx = b.x;
        const by = b.y - 24;
        ctx.fillStyle = '#555';
        ctx.fillRect(bx, by, barW, barH);
        const hpRatio = Math.max(0, b.health / b.maxHealth);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(bx + 2, by + 2, (barW - 4) * hpRatio, barH - 4);

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${b.health} / ${b.maxHealth}`, b.x + b.width / 2, by + barH - 2);
        return;
    }

    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;


    // Draw star body
    drawStar(ctx, cx, cy, 8, b.width / 2, b.width / 4, '#990099', '#ffffff');

    // Invulnerability indicator (when recently spawned)
    if (b.invulnerable && b.invulnerable > 0) {
        const prog = b.invulnerable / 60;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(0,255,255,${0.25 + 0.5 * prog})`;
        ctx.lineWidth = 6;
        ctx.arc(cx, cy, b.width / 2 + 14, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Charging indicator (pulsing ring)
    if (b.isCharging) {
        const progress = 1 - (b.chargeTimer / b.chargeDuration);
        const alpha = 0.25 + progress * 0.75;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255,200,0,${alpha})`;
        ctx.lineWidth = 6;
        ctx.arc(cx, cy, b.width / 2 + 14, 0, Math.PI * 2);
        ctx.stroke();

        // Charge progress bar under boss
        const barW = b.width;
        const barH = 8;
        const bx = b.x;
        const by = b.y + b.height + 8;
        ctx.fillStyle = '#333';
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = '#ff9900';
        ctx.fillRect(bx + 2, by + 2, (barW - 4) * progress, barH - 4);
    }

    // Draw health bar above boss
    const barW = b.width;
    const barH = 12;
    const bx = b.x;
    const by = b.y - 24;
    ctx.fillStyle = '#555';
    ctx.fillRect(bx, by, barW, barH);
    const hpRatio = Math.max(0, b.health / b.maxHealth);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(bx + 2, by + 2, (barW - 4) * hpRatio, barH - 4);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 2, by + 2, barW - 4, barH - 4);

    // HP numbers
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${b.health} / ${b.maxHealth}`, cx, by + barH - 2);
}

// Update explosions
function updateExplosions() {
    for (let i = explosions.length - 1; i >= 0; i--) {
        explosions[i].x += explosions[i].vx;
        explosions[i].y += explosions[i].vy;
        explosions[i].life--;
        
        if (explosions[i].life <= 0) {
            explosions.splice(i, 1);
        }
    }
}

// Draw a star shape helper
function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius, fillStyle, strokeStyle) {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;

        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
    }
    ctx.closePath();
    ctx.fillStyle = fillStyle || '#990099';
    ctx.fill();
    if (strokeStyle) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}  

// Update UI
function updateUI() {
    scoreElement.textContent = game.score;
    livesElement.textContent = game.lives;

    // Don't update info if element missing
    if (!gameInfo) return;

    if (game.lives <= 0) {
        gameInfo.textContent = 'Game Over — press R to restart';
        return;
    }

    if (game.paused) {
        gameInfo.textContent = 'Paused — press P to resume';
        return;
    }

    // Boss fight
    if (game.overrideWave && game.boss) {
        const power = Math.max(1, player.shotLevel || 1);
        gameInfo.textContent = `BOSS HP: ${game.boss.health} | Shots: ${power}`;
        return;
    }

    // Wave countdown
    if (game.wavePauseTimer > 0) {
        const secondsLeft = Math.ceil(game.wavePauseTimer / 60);
        const nextWave = game.wave + 1;
        if (game.pendingBoss || (nextWave % 5) === 0) {
            gameInfo.textContent = `Boss incoming in ${secondsLeft}s`;
        } else {
            gameInfo.textContent = `Wave ${nextWave} incoming in ${secondsLeft}s`;
        }
        return;
    }

    // Normal status
    const power = Math.max(1, player.shotLevel || 1);
    gameInfo.textContent = `Wave: ${game.wave} | Enemies: ${enemies.length} | Shots: ${power}`;
}

// Draw background
function drawBackground() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Starfield (stable positions, slight downward drift)
    ctx.fillStyle = '#222';
    for (let i = 0; i < STARFIELD.length; i++) {
        const s = STARFIELD[i];
        ctx.fillRect(s.x, s.y, s.r, s.r);
        s.y += 0.15;
        if (s.y > CANVAS_HEIGHT) {
            s.y = -2;
            s.x = Math.random() * CANVAS_WIDTH;
        }
    }
}


// Main game loop
function gameLoop() {
    // Ensure the context is scaled so all drawing uses 800x600 game coordinates.
    applyCanvasTransform();

    drawBackground();

    try {
    
    if (!game.paused && game.lives > 0) {
        updatePlayer();
        updateBullets();
        updateEnemies();
        updateEnemyBullets();
        updateExplosions();
        updatePowerUps();
        checkCollisions();
        
        // Auto-shoot every 0.4 seconds
        const currentTime = Date.now();
        if (currentTime - lastShootTime >= SHOOT_INTERVAL) {
            shootBullet();
            lastShootTime = currentTime;
        }

        
        // Wave pause handling: countdown and transition to next wave or spawn pending boss
        if (!game.waveSpawning && game.wavePauseTimer > 0) {
            game.wavePauseTimer--;
            if (game.wavePauseTimer <= 0) {
                if (game.pendingBoss) {
                    // Spawn the miniboss for this wave
                    game.boss = createBoss();
                    console.log('Boss spawned. HP:', game.boss.maxHealth);
                    // clear any normal enemies and ensure no other spawns occur
                    enemies.length = 0;
                    game.pendingBoss = false;
                    game.waveSpawnedCount = 1; // boss counts as spawned
                    game.overrideWave = true;
                } else {
                    // Start next wave
                    game.wave++;
                    game.waveSpawnedCount = 0;
                    game.waveEnemyCap = 4 + game.wave;
                    game.waveSpawning = true;
                }
            }
        }
        
        // keep old enemyWaveCount behavior for level progression (optional)
        game.enemyWaveCount++;
    }
    
    // Draw game objects
    drawPlayer();
    drawBullets();
    drawEnemies();
    drawPowerUps();
    if (game.boss) drawBoss();
    drawEnemyBullets();
    drawExplosions();


    
    updateUI();
    
    // Show incoming wave message overlay when in pause
    if (!game.waveSpawning && game.wavePauseTimer > 0 && game.lives > 0) {
        const secondsLeft = Math.ceil(game.wavePauseTimer / 60);
        const nextWave = game.wave + 1;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, CANVAS_HEIGHT / 2 - 70, CANVAS_WIDTH, 140);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        if (game.pendingBoss || (nextWave % 5) === 0) {
            ctx.fillText(`BOSS incoming`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 5);
        } else {
            ctx.fillText(`Wave ${nextWave} incoming`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 5);
        }
        ctx.font = '24px Arial';
        ctx.fillText(`${secondsLeft}s`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);
    }

    // Show active boss header while a boss is present
    if (game.boss && game.lives > 0) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.12)';
        ctx.fillRect(0, 10, CANVAS_WIDTH, 60);
        ctx.fillStyle = '#ffdddd';
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('BOSS', CANVAS_WIDTH / 2, 44);
        // show boss HP
        const b = game.boss;
        const hpText = `${b.health} / ${b.maxHealth}`;
        ctx.font = '18px Arial';
        ctx.fillText(hpText, CANVAS_WIDTH / 2, 68);
    }
    
    // Game over or level clear
    if (game.lives <= 0) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        ctx.fillStyle = '#ff0000';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);
        
        ctx.fillStyle = '#ffff00';
        ctx.font = '24px Arial';
        ctx.fillText(`Final Score: ${game.score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40);
    }
    
    if (game.paused) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    
    } catch (e) {
        console.error('Game loop error:', e);
        ctx.fillStyle = 'rgba(255, 0, 0, 0.95)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('Error: ' + (e && e.message ? e.message : String(e)), 20, 40);
    }

    requestAnimationFrame(gameLoop);
}

// Start game
loadImages();
gameLoop();
