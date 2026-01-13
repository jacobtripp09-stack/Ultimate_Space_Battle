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

// Get canvas and context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

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
    maxHitTime: 30
};

// Arrays for game objects
const bullets = [];
const enemies = [];
const enemyBullets = [];
const explosions = [];
let enemyImage = null;
const powerUps = [];

// Player power-up state
player.doubleShot = false;
player.doubleShotPermanent = false;
player.powerUpTimer = 0;

// Touch/Mouse input
let touchX = CANVAS_WIDTH / 2;
let touchY = CANVAS_HEIGHT - 70;
let lastShootTime = 0;
const SHOOT_INTERVAL = 400; // 0.4 seconds in milliseconds

// Pointer input (mouse/touch/click)
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    touchX = e.clientX - rect.left;
    touchY = e.clientY - rect.top;
});

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    touchX = e.clientX - rect.left;
    touchY = e.clientY - rect.top;
});

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    if (e.touches.length > 0) {
        touchX = e.touches[0].clientX - rect.left;
        touchY = e.touches[0].clientY - rect.top;
    }
});

// Touch movement
canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    if (e.touches.length > 0) {
        touchX = e.touches[0].clientX - rect.left;
        touchY = e.touches[0].clientY - rect.top;
    }
});

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

// Debug: press 'D' to skip to wave 4 (hotkey only skips levels)
document.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
        // Skip to wave 4 and reset spawn state so normal spawning continues from there
        game.wave = 4;
        game.waveSpawnedCount = 0;
        game.waveEnemyCap = 4 + game.wave;
        game.waveSpawning = true;
        enemies.length = 0;
        game.wavePauseTimer = 0; // start spawning immediately
        game.pendingBoss = false;
        game.overrideWave = false;
        console.log('Debug: jumped to wave', game.wave);
    }
});

// Debug: press 'L' to add a life (testing only)
document.addEventListener('keydown', (e) => {
    if (e.key === 'l' || e.key === 'L') {
        game.lives++;
        console.log('Debug: added a life, total lives =', game.lives);
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

    // Snap player to pointer position exactly
    player.x = touchX - player.width / 2;
    player.y = touchY - player.height / 2;

    // Keep player in bounds
    if (player.x < 0) player.x = 0;
    if (player.x + player.width > CANVAS_WIDTH) player.x = CANVAS_WIDTH - player.width;
    if (player.y < 0) player.y = 0;
    if (player.y + player.height > CANVAS_HEIGHT) player.y = CANVAS_HEIGHT - player.height;
}

// Shoot bullet (supports double-shot power-up)
function shootBullet() {
    if (player.doubleShot) {
        // Two projectiles offset left/right
        bullets.push({
            x: player.x + player.width / 2 - 10,
            y: player.y,
            width: 4,
            height: 10,
            speed: BULLET_SPEED,
            color: '#ffff00'
        });
        bullets.push({
            x: player.x + player.width / 2 + 6,
            y: player.y,
            width: 4,
            height: 10,
            speed: BULLET_SPEED,
            color: '#ffff00'
        });
    } else {
        bullets.push({
            x: player.x + player.width / 2 - 2,
            y: player.y,
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
        
        // Remove bullets that go off screen
        if (bullets[i].y < 0) {
            bullets.splice(i, 1);
        }
    }
}

// Create enemy (type: 'yellow' = 4hp, 'green' = 3hp, 'blue' = 2hp, 'red' = 1hp)
function createEnemy(type = 'blue') {
    let health = 2;
    let color = '#0066ff';
    if (type === 'yellow') { health = 4; color = '#ffff00'; }
    if (type === 'green') { health = 3; color = '#00aa00'; }
    if (type === 'red') { health = 1; color = '#ff0000'; }

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
        waveTime: Math.random() * 100,
        formationX: 0,
        formationY: 0,
        inFormation: false
    };
}

// Create a miniboss
function createBoss() {
    const hp = 30; // fixed boss HP (30 hits)
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
        nextAttackType: Math.random() < 0.5 ? 'massive' : 'burst',
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
        // Determine tint color based on health (yellow > green > blue > red)
        let tint = '#ff0000';
        if (enemy.health >= 4) tint = '#ffff00';
        else if (enemy.health >= 3) tint = '#00aa00';
        else if (enemy.health === 2) tint = '#0066ff';
        else tint = '#ff0000';

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
    });
}

// Update enemies
function updateEnemies() {
    // Boss incoming trigger for waves 5,15,25,... (every 10 levels offset by 5)
    // Schedule miniboss for these milestone waves (overrides normal waves)
    if ((game.wave % 10) === 5 && game.waveSpawnedCount === 0 && game.waveSpawning && !game.pendingBoss) {
        game.pendingBoss = true;
        game.waveSpawning = false;
        game.overrideWave = true; // block normal waves
        // Show 'Mini boss' for a couple seconds
        game.wavePauseTimer = 120;
        return; // pause spawning until boss is handled
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
                    boss.nextAttackType = Math.random() < 0.5 ? 'massive' : 'burst';
                }
            } else {
                boss.chargeTimer--;
                if (boss.chargeTimer <= 0) {
                    // Perform attack
                    if (boss.nextAttackType === 'massive') {
                        // Big straight projectile (larger)
                        shootEnemyBullet(boss, 0, 8, 28, 56, '#ff9900');
                    } else {
                        // Burst in 6 directions (larger)
                        for (let i = 0; i < 6; i++) {
                            const angle = (i / 6) * Math.PI * 2;
                            const vx = Math.cos(angle) * 5;
                            const vy = Math.sin(angle) * 5;
                            shootEnemyBullet(boss, vx, vy, 14, 14, '#ff66ff');
                        }
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
    // Chance breakdown (yellow introduced very slowly, green introduced slowly, blue increases over time)
    const yellowChance = Math.min(0.12, 0.005 + 0.01 * (game.wave - 1));
    const greenChance = Math.min(0.20, 0.02 + 0.02 * (game.wave - 1));
    const blueChance = Math.min(0.75, 0.3 + 0.04 * (game.wave - 1));

    // Only spawn while current wave is in spawning state and not overridden by a boss
    if (!game.overrideWave && game.waveSpawning && game.waveSpawnedCount < game.waveEnemyCap && enemies.length < maxEnemies) {
        if (Math.random() < 0.03) {
            const r = Math.random();
            let type = 'red';
            if (r < yellowChance) type = 'yellow';
            else if (r < yellowChance + greenChance) type = 'green';
            else if (r < yellowChance + greenChance + blueChance) type = 'blue';
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
        enemy.waveTime++;
        
        if (!enemy.inFormation) {
            // Pattern movement - sine wave
            enemy.y += enemy.speed;
            enemy.x = enemy.x + Math.sin(enemy.waveTime * 0.05) * 1.5;
            
            // Check if enemy should enter formation (reached middle of screen)
            if (enemy.y > CANVAS_HEIGHT / 3) {
                enemy.inFormation = true;
                // Calculate position in formation (3x3 grid centered)
                const formationIndex = enemies.indexOf(enemy) % 9;
                const row = Math.floor(formationIndex / 3);
                const col = formationIndex % 3;
                enemy.formationX = CANVAS_WIDTH / 2 - 60 + col * 60;
                enemy.formationY = CANVAS_HEIGHT / 2 - 60 + row * 60;
            }
        } else {
            // Move smoothly to formation position
            const dx = enemy.formationX - enemy.x;
            const dy = enemy.formationY - enemy.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > 3) {
                const speed = 1;
                enemy.x += (dx / distance) * speed;
                enemy.y += (dy / distance) * speed;
            }
        }
        
        // Enemy shoots randomly
        if (Math.random() < ENEMY_SHOOT_CHANCE) {
            shootEnemyBullet(enemy);
        }
        
        // Keep enemies in horizontal bounds
        if (enemy.x < 0) enemy.x = 0;
        if (enemy.x + enemy.width > CANVAS_WIDTH) enemy.x = CANVAS_WIDTH - enemy.width;
    });
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

// Draw enemy bullets
function drawEnemyBullets() {
    enemyBullets.forEach(bullet => {
        ctx.fillStyle = bullet.color || '#ff6666';
        ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
    });
}

// Update enemy bullets
function updateEnemyBullets() {
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.x += b.vx || 0;
        b.y += b.vy || 0;
        
        // Check collision with player
        if (checkCollision(b, player)) {
            game.lives--;
            player.hitTimer = player.maxHitTime;
            createExplosion(player.x + player.width / 2, player.y + player.height / 2);
            enemyBullets.splice(i, 1);
            continue;
        }
        
        // Remove bullets that go off screen
        if (b.y > CANVAS_HEIGHT + 50 || b.y < -50 || b.x < -50 || b.x > CANVAS_WIDTH + 50) {
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
    // Bullet vs Enemy
    for (let i = bullets.length - 1; i >= 0; i--) {
        let bulletUsed = false;
        for (let j = enemies.length - 1; j >= 0; j--) {
            if (checkCollision(bullets[i], enemies[j])) {
                enemies[j].health--;
                createExplosion(enemies[j].x + enemies[j].width / 2, enemies[j].y + enemies[j].height / 2);
                bullets.splice(i, 1);
                bulletUsed = true;
                
                if (enemies[j].health <= 0) {
                    createExplosion(enemies[j].x + enemies[j].width / 2, enemies[j].y + enemies[j].height / 2);
                    // Award points scaled with enemy max health
                    game.score += 100 * (enemies[j].maxHealth || 1);
                    enemies.splice(j, 1);
                    game.waveEnemiesDefeated++;
                } else {
                    // Update color/tint to reflect reduced health (yellow > green > blue > red)
                    if (enemies[j].health >= 4) enemies[j].color = '#ffff00';
                    else if (enemies[j].health >= 3) enemies[j].color = '#00aa00';
                    else if (enemies[j].health === 2) enemies[j].color = '#0066ff';
                    else enemies[j].color = '#ff0000';
                }
                break;
            }
        }
        if (bulletUsed) continue;

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
                        type: 'double',
                        duration: 600, // frames (unused for permanent upgrades)
                        floatOffset: Math.random() * Math.PI * 2
                    });
                // Award player bonus lives and track boss defeats to scale future bosses
                game.lives += 20;
                game.bossDefeats++;
                console.log('Mini boss defeated; lives +20, total lives =', game.lives);
                game.boss = null;
                // Boss no longer overrides waves
                game.overrideWave = false;
                // Start pause before next wave
                game.waveSpawning = false;
                game.wavePauseTimer = 300; // fixed 5 seconds
                game.waveSpawnedCount = game.waveEnemyCap; // mark wave as 'spawned' so it proceeds
            }

            // Player ramming damage: when player collides with boss it also damages the boss (with a short cooldown to avoid frame spam)
            if (game.boss && game.boss.invulnerable <= 0 && game.boss.hitCooldown <= 0 && checkCollision(player, game.boss)) {
                game.boss.health--;
                game.boss.hitCooldown = 30; // frames of immunity from repeated ramming
                createExplosion(game.boss.x + game.boss.width / 2, game.boss.y + game.boss.height / 2);
                player.hitTimer = player.maxHitTime;
                if (game.boss.health <= 0) {
                    createExplosion(game.boss.x + game.boss.width / 2, game.boss.y + game.boss.height / 2);
                    // Spawn a double-shot powerup at the boss location
                    powerUps.push({
                        x: game.boss.x + game.boss.width / 2 - 10,
                        y: game.boss.y + game.boss.height / 2 - 10,
                        width: 20,
                        height: 20,
                        type: 'double',
                        duration: 600,
                        floatOffset: Math.random() * Math.PI * 2
                    });
                    // Award lives and increment boss defeat counter
                    game.lives += 20;
                    game.bossDefeats++;
                    game.score += 2000;
                    console.log('Mini boss defeated; lives +20, total lives =', game.lives);
                    game.boss = null;
                    game.overrideWave = false;
                    game.waveSpawning = false;
                    game.wavePauseTimer = 300;
                    game.waveSpawnedCount = game.waveEnemyCap;
                }
            }
        }
    }

    // Power-up pickup: player collects power-up to enable double-shot
    for (let p = powerUps.length - 1; p >= 0; p--) {
        const pu = powerUps[p];
        if (checkCollision(player, pu)) {
            if (pu.type === 'double') {
                player.doubleShot = true;
                player.doubleShotPermanent = true;
            }
            createExplosion(pu.x + pu.width / 2, pu.y + pu.height / 2);
            powerUps.splice(p, 1);
            game.score += 250; // small reward for collecting
        }
    }
    
    // Track defeats for stats; actual wave transition happens via wavePauseTimer in the main loop
    // (no immediate wave increment here)
}

// Create explosion effect
function createExplosion(x, y) {
    for (let i = 0; i < 8; i++) {
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
}

// Draw explosions
function drawExplosions() {
    explosions.forEach((exp, index) => {
        const alpha = exp.life / exp.maxLife;
        ctx.fillStyle = exp.color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(exp.x, exp.y, 4, 0, Math.PI * 2);
        ctx.fill();
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
        ctx.fillText('2x', p.x + p.width / 2, p.y + p.height / 2 + 4 + floatY);
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
    document.getElementById('score').textContent = game.score;
    document.getElementById('lives').textContent = game.lives;
    
    const gameInfo = document.getElementById('gameInfo');
    if (game.paused) {
        gameInfo.textContent = 'PAUSED - Press P to Resume';
    } else if (game.lives <= 0) {
        gameInfo.textContent = 'GAME OVER - Press R to Restart';
    } else if (!game.waveSpawning && game.wavePauseTimer > 0) {
        // Show incoming wave and countdown in seconds
        const secondsLeft = Math.ceil(game.wavePauseTimer / 60);
        const nextWave = game.wave + 1;
        if (game.pendingBoss || (nextWave % 10) === 5) {
            gameInfo.textContent = `Mini boss incoming in ${secondsLeft}s`;
        } else {
            gameInfo.textContent = `Wave ${nextWave} incoming in ${secondsLeft}s`;
        }
    } else {
        if (player.doubleShot) {
            if (player.doubleShotPermanent) {
                gameInfo.textContent = `Wave: ${game.wave} | Enemies: ${enemies.length} | POWER: 2x (permanent)`;
            } else if (player.powerUpTimer > 0) {
                const secondsLeft = Math.ceil(player.powerUpTimer / 60);
                gameInfo.textContent = `Wave: ${game.wave} | Enemies: ${enemies.length} | POWER: 2x (${secondsLeft}s)`;
            } else {
                gameInfo.textContent = `Wave: ${game.wave} | Enemies: ${enemies.length}`;
            }
        } else {
            gameInfo.textContent = `Wave: ${game.wave} | Enemies: ${enemies.length}`;
        }
    }
}

// Draw background
function drawBackground() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Draw subtle starfield
    ctx.fillStyle = '#222';
    for (let i = 0; i < 80; i++) {
        const sx = Math.random() * CANVAS_WIDTH;
        const sy = Math.random() * CANVAS_HEIGHT;
        ctx.fillRect(sx, sy, 1, 1);
    }
}

// Main game loop
function gameLoop() {
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
                    console.log('Mini boss spawned. HP:', game.boss.maxHealth);
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
        if (game.pendingBoss || (nextWave % 10) === 5) {
            ctx.fillText(`MINI BOSS incoming`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 5);
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
        ctx.fillText('MINI BOSS', CANVAS_WIDTH / 2, 44);
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
