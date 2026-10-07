import { supabase } from '../services/supabase.js';
import { NAME_COLORS } from '../services/profile.js';

export const WEAPON_REGISTRY = {
  ar: { 
    id: 'ar', 
    name: 'Assault Rifle', 
    short: 'AR', 
    icon: '⚡', 
    color: '#38bdf8', 
    damage: 22, 
    speed: 16, 
    cooldown: 140, 
    spread: 0.05, 
    bulletColor: '#7dd3fc',
    barrelLen: 16
  },
  shotgun: { 
    id: 'shotgun', 
    name: 'Pump Shotgun', 
    short: 'PUMP', 
    icon: '💥', 
    color: '#f59e0b', 
    damage: 16, // per pellet (x5)
    speed: 13, 
    cooldown: 800, 
    pellets: 5, 
    spread: 0.22, 
    bulletColor: '#fbbf24',
    barrelLen: 12
  },
  pistol: { 
    id: 'pistol', 
    name: 'Tactical Pistol', 
    short: 'PISTOL', 
    icon: '🔫', 
    color: '#94a3b8', 
    damage: 26, 
    speed: 14, 
    cooldown: 280, 
    spread: 0.02, 
    bulletColor: '#cbd5e1',
    barrelLen: 10
  },
  sniper: { 
    id: 'sniper', 
    name: 'Heavy Sniper', 
    short: 'SNIPER', 
    icon: '🎯', 
    color: '#c084fc', 
    damage: 90, 
    speed: 26, 
    cooldown: 1200, 
    spread: 0.001, 
    bulletColor: '#e9d5ff',
    barrelLen: 22
  },
  mini_pot: { 
    id: 'mini_pot', 
    name: 'Shield Mini', 
    short: 'SHIELD', 
    icon: '🧪', 
    color: '#00d2ff', 
    isConsumable: true, 
    shieldAmount: 25, 
    count: 2 
  }
};

export class GameArena {
  constructor(canvas, room, user, profile) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.room = room;
    this.user = user;
    this.profile = profile || { username: 'Player', equipped_color: 'color_white', equipped_effect: 'effect_none' };

    // Host status dictates authoritative timer
    this.isHost = !room || room.host_id === user.id;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Local Player
    this.player = {
      id: user.id,
      name: profile?.username || 'Player',
      colorId: profile?.equipped_color || 'color_white',
      effectId: profile?.equipped_effect || 'effect_none',
      x: 150 + Math.random() * 400,
      y: 150 + Math.random() * 300,
      radius: 19,
      speed: 4.2,
      health: 100,
      shield: 50,
      angle: 0,
      selectedSlot: 0,
      lastShotTime: 0,
      inventory: [
        { ...WEAPON_REGISTRY.ar },
        { ...WEAPON_REGISTRY.shotgun },
        { ...WEAPON_REGISTRY.pistol },
        { ...WEAPON_REGISTRY.sniper },
        { ...WEAPON_REGISTRY.mini_pot }
      ]
    };

    // Remote Players Map: id -> player
    this.remotePlayers = new Map();

    // Active Projectiles (local simulation + networked hits)
    this.bullets = [];

    // Inputs
    this.keys = {};
    this.mouse = { x: 0, y: 0, isDown: false };
    this.setupInputs();

    // Authoritative Host Timer State
    this.matchSecondsLeft = 120; // 2 minutes
    this.timerDisplay = document.getElementById('timer-val');
    this.hostTimerInterval = null;

    // Networking
    this.channel = null;
    this.broadcastInterval = null;
    this.running = false;
    this.animId = null;

    this.renderHotbarUI();
    this.updateVitalsUI();
    this.initNetwork();
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  setupInputs() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
      const num = parseInt(e.key);
      if (num >= 1 && num <= 5) {
        this.selectSlot(num - 1);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.player.angle = Math.atan2(this.mouse.y - this.player.y, this.mouse.x - this.player.x);
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouse.isDown = true;
        this.shootCurrentWeapon();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouse.isDown = false;
      }
    });
  }

  selectSlot(index) {
    if (index < 0 || index > 4) return;
    this.player.selectedSlot = index;

    const item = this.player.inventory[index];
    if (item && item.isConsumable) {
      if (this.player.shield < 100) {
        this.player.shield = Math.min(100, this.player.shield + item.shieldAmount);
        item.count--;
        if (item.count <= 0) {
          this.player.inventory[index] = null;
        }
        this.updateVitalsUI();
      }
    }

    this.renderHotbarUI();
  }

  renderHotbarUI() {
    const bar = document.getElementById('inventory-bar');
    if (!bar) return;

    bar.innerHTML = this.player.inventory.map((item, idx) => {
      const isSelected = this.player.selectedSlot === idx;
      return `
        <div class="inv-slot" data-slot="${idx}" style="
          width: 60px; 
          height: 60px; 
          background: ${isSelected ? 'rgba(30, 41, 59, 0.95)' : 'rgba(15, 23, 42, 0.8)'};
          border: 2px solid ${isSelected ? 'var(--tactical-amber)' : 'rgba(255,255,255,0.1)'};
          box-shadow: ${isSelected ? '0 0 10px rgba(255, 179, 0, 0.4)' : 'none'};
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          cursor: pointer;
          user-select: none;
          transition: border-color 0.12s ease;
        ">
          <span style="position: absolute; top: 2px; left: 5px; font-size: 0.65rem; color: var(--text-dim);">${idx + 1}</span>
          ${item ? `
            <span style="font-size: 1.35rem;">${item.icon}</span>
            <span style="font-size: 0.58rem; color: ${item.color}; font-weight: bold; margin-top: -2px;">${item.short}</span>${item.count > 1 ? `<span style="position: absolute; bottom: 2px; right: 5px; font-size: 0.65rem; color: #fff;">x${item.count}</span>` : ''}
          ` : `
            <span style="font-size: 0.65rem; color: rgba(255,255,255,0.15);">EMPTY</span>
          `}
        </div>
      `;
    }).join('');

    bar.querySelectorAll('.inv-slot').forEach(el => {
      el.addEventListener('click', () => {
        this.selectSlot(parseInt(el.dataset.slot));
      });
    });
  }

  updateVitalsUI() {
    const hpFill = document.getElementById('hp-fill');
    const hpText = document.getElementById('hp-text');
    const shieldFill = document.getElementById('shield-fill');
    const shieldText = document.getElementById('shield-text');

    if (hpFill) hpFill.style.width = `${Math.max(0, this.player.health)}%`;
    if (hpText) hpText.textContent = `${this.player.health} / 100`;

    if (shieldFill) shieldFill.style.width = `${Math.max(0, this.player.shield)}%`;
    if (shieldText) shieldText.textContent = `${this.player.shield} / 100`;
  }

  formatTime(totalSecs) {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  shootCurrentWeapon() {
    const weapon = this.player.inventory[this.player.selectedSlot];
    if (!weapon || weapon.isConsumable) return;

    const now = Date.now();
    if (now - this.player.lastShotTime < weapon.cooldown) return;
    this.player.lastShotTime = now;

    const spawnBullet = (angleOffset) => {
      const finalAngle = this.player.angle + angleOffset;
      const b = {
        shooterId: this.player.id,
        x: this.player.x + Math.cos(this.player.angle) * (this.player.radius + weapon.barrelLen),
        y: this.player.y + Math.sin(this.player.angle) * (this.player.radius + weapon.barrelLen),
        vx: Math.cos(finalAngle) * weapon.speed,
        vy: Math.sin(finalAngle) * weapon.speed,
        damage: weapon.damage,
        color: weapon.bulletColor,
        life: 75
      };
      this.bullets.push(b);
      this.broadcastBullet(b);
    };

    if (weapon.pellets) {
      for (let i = 0; i < weapon.pellets; i++) {
        const spread = (Math.random() - 0.5) * weapon.spread;
        spawnBullet(spread);
      }
    } else {
      const spread = (Math.random() - 0.5) * weapon.spread;
      spawnBullet(spread);
    }
  }

  broadcastBullet(bullet) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'bullet_fired',
      payload: bullet
    });
  }

  initNetwork() {
    const roomId = this.room?.id || 'public_arena';
    this.channel = supabase.channel(`arena:${roomId}`, {
      config: { broadcast: { self: false } }
    });

    this.channel
      // 1. Host Authoritative Timer Sync
      .on('broadcast', { event: 'host_timer_tick' }, ({ payload }) => {
        if (payload?.secondsLeft !== undefined) {
          this.matchSecondsLeft = payload.secondsLeft;
          if (this.timerDisplay) {
            this.timerDisplay.textContent = this.formatTime(this.matchSecondsLeft);
          }
        }
      })
      // 2. Player Movement and Weapon Sync
      .on('broadcast', { event: 'player_state' }, ({ payload }) => {
        if (!payload || payload.id === this.user.id) return;

        let remote = this.remotePlayers.get(payload.id);
        if (!remote) {
          remote = {
            id: payload.id,
            name: payload.name,
            colorId: payload.colorId,
            effectId: payload.effectId,
            x: payload.x,
            y: payload.y,
            targetX: payload.x,
            targetY: payload.y,
            angle: payload.angle,
            targetAngle: payload.angle,
            weapon: payload.weapon
          };
          this.remotePlayers.set(payload.id, remote);
        } else {
          remote.targetX = payload.x;
          remote.targetY = payload.y;
          remote.targetAngle = payload.angle;
          remote.name = payload.name;
          remote.colorId = payload.colorId;
          remote.effectId = payload.effectId;
          remote.weapon = payload.weapon;
        }
      })
      // 3. Bullet Spawn Sync
      .on('broadcast', { event: 'bullet_fired' }, ({ payload }) => {
        if (!payload || payload.shooterId === this.user.id) return;
        this.bullets.push(payload);
      })
      // 4. Damage Received Sync
      .on('broadcast', { event: 'take_damage' }, ({ payload }) => {
        if (payload.targetId === this.user.id) {
          this.applyDamage(payload.damage);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Send 20 position packets/second
          this.broadcastInterval = setInterval(() => this.broadcastState(), 50);

          // If Host, start the authoritative timer interval (ticks 1x per second)
          if (this.isHost) {
            const badge = document.getElementById('host-badge');
            if (badge) badge.textContent = 'HOST MASTER CLOCK';

            this.hostTimerInterval = setInterval(() => {
              if (this.matchSecondsLeft > 0) {
                this.matchSecondsLeft--;
              }
              if (this.timerDisplay) {
                this.timerDisplay.textContent = this.formatTime(this.matchSecondsLeft);
              }
              // Broadcast exact second to all peers
              this.channel.send({
                type: 'broadcast',
                event: 'host_timer_tick',
                payload: { secondsLeft: this.matchSecondsLeft }
              });
            }, 1000);
          }
        }
      });
  }

  broadcastState() {
    if (!this.channel) return;
    const currentWeapon = this.player.inventory[this.player.selectedSlot];

    this.channel.send({
      type: 'broadcast',
      event: 'player_state',
      payload: {
        id: this.player.id,
        name: this.player.name,
        colorId: this.player.colorId,
        effectId: this.player.effectId,
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
        angle: parseFloat(this.player.angle.toFixed(2)),
        weapon: currentWeapon ? {
          name: currentWeapon.name,
          color: currentWeapon.color,
          barrelLen: currentWeapon.barrelLen
        } : null
      }
    });
  }

  applyDamage(amt) {
    if (this.player.shield > 0) {
      if (this.player.shield >= amt) {
        this.player.shield -= amt;
      } else {
        const remaining = amt - this.player.shield;
        this.player.shield = 0;
        this.player.health = Math.max(0, this.player.health - remaining);
      }
    } else {
      this.player.health = Math.max(0, this.player.health - amt);
    }
    this.updateVitalsUI();
  }

  start() {
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.animId) cancelAnimationFrame(this.animId);
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
    if (this.hostTimerInterval) clearInterval(this.hostTimerInterval);
    if (this.channel) supabase.removeChannel(this.channel);
  }

  updateMovement() {
    let dx = 0;
    let dy = 0;

    if (this.keys['w'] || this.keys['arrowup']) dy -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) dy += 1;
    if (this.keys['a'] || this.keys['arrowleft']) dx -= 1;
    if (this.keys['d'] || this.keys['arrowright']) dx += 1;

    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }

    this.player.x += dx * this.player.speed;
    this.player.y += dy * this.player.speed;

    const pad = this.player.radius;
    this.player.x = Math.max(pad, Math.min(this.canvas.width - pad, this.player.x));
    this.player.y = Math.max(pad, Math.min(this.canvas.height - pad, this.player.y));

    // Auto-fire while holding left-click
    if (this.mouse.isDown) {
      this.shootCurrentWeapon();
    }
  }

  updateRemotePlayers() {
    this.remotePlayers.forEach((rp) => {
      rp.x += (rp.targetX - rp.x) * 0.35;
      rp.y += (rp.targetY - rp.y) * 0.35;
      rp.angle += (rp.targetAngle - rp.angle) * 0.35;
    });
  }

  updateBullets() {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx;
      b.y += b.vy;
      b.life--;

      // Hit registration against remote players (when fired by local player)
      if (b.shooterId === this.player.id) {
        this.remotePlayers.forEach((rp) => {
          const dist = Math.hypot(b.x - rp.x, b.y - rp.y);
          if (dist < 20) {
            // Register hit
            this.channel.send({
              type: 'broadcast',
              event: 'take_damage',
              payload: { targetId: rp.id, damage: b.damage }
            });
            b.life = 0; // Destroy bullet
          }
        });
      }

      if (b.life <= 0 || b.x < 0 || b.x > this.canvas.width || b.y < 0 || b.y > this.canvas.height) {
        this.bullets.splice(i, 1);
      }
    }
  }

  drawPlayer(x, y, radius, angle, name, colorId, effectId, weapon, isSelf = false) {
    const colorObj = NAME_COLORS.find(c => c.id === colorId) || NAME_COLORS[0];
    const colorHex = colorObj.color;

    // 1. Orbiting Micro-particles
    if (effectId && effectId !== 'effect_none') {
      this.ctx.save();
      this.ctx.fillStyle = colorHex;
      this.ctx.shadowColor = colorHex;
      this.ctx.shadowBlur = 4;
      const t = Date.now() * 0.003;
      for (let i = 0; i < 3; i++) {
        const theta = t + (i * Math.PI * 2) / 3;
        const dist = radius + 6;
        this.ctx.beginPath();
        this.ctx.arc(x + Math.cos(theta) * dist, y + Math.sin(theta) * dist, 1.4, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    }

    // 2. Body & Weapon
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(angle);

    // Gun Barrel
    if (weapon) {
      this.ctx.fillStyle = weapon.color || '#94a3b8';
      this.ctx.shadowColor = weapon.color || '#94a3b8';
      this.ctx.shadowBlur = 4;
      const bLen = weapon.barrelLen || 14;
      this.ctx.fillRect(radius - 2, -3.5, bLen, 7);
    }

    // Body Circle
    this.ctx.beginPath();
    this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = isSelf ? '#1e293b' : '#0f172a';
    this.ctx.fill();
    this.ctx.lineWidth = 2.5;
    this.ctx.strokeStyle = colorHex;
    this.ctx.stroke();

    // Hands
    this.ctx.fillStyle = '#64748b';
    this.ctx.beginPath();
    this.ctx.arc(radius - 2, 7, 3.5, 0, Math.PI * 2);
    this.ctx.arc(radius - 2, -7, 3.5, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.restore();

    // 3. Above-Head Nameplate
    this.ctx.save();
    this.ctx.font = 'bold 12px "JetBrains Mono", monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = colorHex;
    if (colorObj.glow && colorObj.glow !== 'none') {
      this.ctx.shadowColor = colorHex;
      this.ctx.shadowBlur = 8;
    }
    this.ctx.fillText(isSelf ? `${name} (You)` : name, x, y - radius - 10);
    this.ctx.restore();
  }

  loop() {
    if (!this.running) return;

    this.updateMovement();
    this.updateRemotePlayers();
    this.updateBullets();

    // Canvas Background
    this.ctx.fillStyle = '#070b12';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Grid Floor
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    this.ctx.lineWidth = 1;
    const gridSize = 45;
    for (let x = 0; x < this.canvas.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }
    for (let y = 0; y < this.canvas.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }
    this.ctx.restore();

    // Draw Projectiles
    this.ctx.save();
    this.bullets.forEach((b) => {
      this.ctx.beginPath();
      this.ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      this.ctx.fillStyle = b.color;
      this.ctx.shadowColor = b.color;
      this.ctx.shadowBlur = 6;
      this.ctx.fill();
    });
    this.ctx.restore();

    // Draw Remote Players
    this.remotePlayers.forEach((rp) => {
      this.drawPlayer(rp.x, rp.y, 19, rp.angle || 0, rp.name, rp.colorId, rp.effectId, rp.weapon, false);
    });

    // Draw Local Player
    const currentWeapon = this.player.inventory[this.player.selectedSlot];
    this.drawPlayer(
      this.player.x,
      this.player.y,
      this.player.radius,
      this.player.angle,
      this.player.name,
      this.player.colorId,
      this.player.effectId,
      currentWeapon,
      true
    );

    this.animId = requestAnimationFrame(() => this.loop());
  }
}
