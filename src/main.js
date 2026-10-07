import { supabase } from './services/supabase.js';
import { NAME_COLORS } from './services/profile.js';

// Base weapons and items catalog
export const WEAPON_TYPES = {
  pistol: { id: 'pistol', name: 'Pistol', icon: '🔫', color: '#a0aec0', damage: 18, fireRate: 350 },
  rifle: { id: 'rifle', name: 'Assault Rifle', icon: '⚡', color: '#38bdf8', damage: 24, fireRate: 150 },
  shotgun: { id: 'shotgun', name: 'Pump Shotgun', icon: '💥', color: '#f59e0b', damage: 60, fireRate: 800 },
  sniper: { id: 'sniper', name: 'Heavy Sniper', icon: '🎯', color: '#a855f7', damage: 95, fireRate: 1200 },
  shield_pot: { id: 'shield_pot', name: 'Shield Mini', icon: '🧪', color: '#00d2ff', isConsumable: true, shieldAmount: 25 }
};

export class GameArena {
  constructor(canvas, room, user, profile) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.room = room;
    this.user = user;
    this.profile = profile || { username: 'Player', equipped_color: 'color_white', equipped_effect: 'effect_none' };

    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Local Player Vitals & Inventory
    this.player = {
      id: user.id,
      name: profile?.username || 'Player',
      colorId: profile?.equipped_color || 'color_white',
      effectId: profile?.equipped_effect || 'effect_none',
      x: 200 + Math.random() * 400,
      y: 200 + Math.random() * 300,
      radius: 20,
      speed: 4,
      health: 100,
      shield: 50,
      angle: 0,
      selectedSlot: 0,
      inventory: [
        { ...WEAPON_TYPES.rifle },
        { ...WEAPON_TYPES.shotgun },
        { ...WEAPON_TYPES.pistol },
        { ...WEAPON_TYPES.shield_pot, count: 2 },
        null
      ]
    };

    // Remote Players Map
    this.remotePlayers = new Map();

    // Inputs
    this.keys = {};
    this.mouse = { x: 0, y: 0 };
    this.setupInputs();

    // Desync-Proof Timer Setup
    this.matchDuration = 120; // 2 minutes
    this.startedAtMs = room?.started_at ? new Date(room.started_at).getTime() : Date.now();
    this.timerDisplay = document.getElementById('timer-val');

    // Network
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

      // 1 to 5 for Inventory hotbar selection
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
      // Calculate rotation facing mouse
      this.player.angle = Math.atan2(this.mouse.y - this.player.y, this.mouse.x - this.player.x);
    });
  }

  selectSlot(index) {
    if (index < 0 || index > 4) return;
    this.player.selectedSlot = index;

    // Use consumable directly if selected
    const item = this.player.inventory[index];
    if (item && item.isConsumable && this.player.shield < 100) {
      this.player.shield = Math.min(100, this.player.shield + item.shieldAmount);
      item.count = (item.count || 1) - 1;
      if (item.count <= 0) {
        this.player.inventory[index] = null;
      }
      this.updateVitalsUI();
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
          width: 58px; 
          height: 58px; 
          background: ${isSelected ? 'rgba(30, 41, 59, 0.95)' : 'rgba(15, 23, 42, 0.75)'};
          border: 2px solid ${isSelected ? 'var(--tactical-amber)' : 'rgba(255,255,255,0.1)'};
          box-shadow: ${isSelected ? '0 0 12px rgba(255, 179, 0, 0.4)' : 'none'};
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          cursor: pointer;
          user-select: none;
          transition: all 0.15s ease;
        ">
          <span style="position: absolute; top: 3px; left: 6px; font-size: 0.65rem; color: var(--text-dim);">${idx + 1}</span>
          ${item ? `
            <span style="font-size: 1.4rem;">${item.icon}</span>
            <span style="font-size: 0.6rem; color: ${item.color}; font-weight: bold; margin-top: -2px;">${item.name.split(' ')[0]}</span>${item.count > 1 ? `<span style="position: absolute; bottom: 2px; right: 5px; font-size: 0.65rem; color: #fff;">x${item.count}</span>` : ''}
          ` : `
            <span style="font-size: 0.7rem; color: rgba(255,255,255,0.15);">EMPTY</span>
          `}
        </div>
      `;
    }).join('');

    bar.querySelectorAll('.inv-slot').forEach(el => {
      el.addEventListener('click', () => {
        const slot = parseInt(el.dataset.slot);
        this.selectSlot(slot);
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

  initNetwork() {
    const roomId = this.room?.id || 'public_arena';
    this.channel = supabase.channel(`arena:${roomId}`, {
      config: { broadcast: { self: false } }
    });

    this.channel
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
            equippedWeapon: payload.equippedWeapon
          };
          this.remotePlayers.set(payload.id, remote);
        } else {
          remote.targetX = payload.x;
          remote.targetY = payload.y;
          remote.targetAngle = payload.angle;
          remote.name = payload.name;
          remote.colorId = payload.colorId;
          remote.effectId = payload.effectId;
          remote.equippedWeapon = payload.equippedWeapon;
        }
      })
      .on('broadcast', { event: 'host_sync_time' }, ({ payload }) => {
        // Authoritative sync from host
        if (payload?.startedAtMs) {
          this.startedAtMs = payload.startedAtMs;
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.broadcastInterval = setInterval(() => this.broadcastState(), 50);

          // Host emits sync time anchor
          if (this.room?.host_id === this.user.id) {
            this.channel.send({
              type: 'broadcast',
              event: 'host_sync_time',
              payload: { startedAtMs: this.startedAtMs }
            });
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
        equippedWeapon: currentWeapon ? { name: currentWeapon.name, icon: currentWeapon.icon, color: currentWeapon.color } : null
      }
    });
  }

  start() {
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.animId) cancelAnimationFrame(this.animId);
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
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
  }

  updateRemotePlayers() {
    this.remotePlayers.forEach((rp) => {
      rp.x += (rp.targetX - rp.x) * 0.35;
      rp.y += (rp.targetY - rp.y) * 0.35;
      rp.angle += (rp.targetAngle - rp.angle) * 0.35;
    });
  }

  updateTimer() {
    if (!this.timerDisplay) return;

    // Fixed against shared start timestamp
    const now = Date.now();
    const elapsed = Math.floor((now - this.startedAtMs) / 1000);
    const remaining = Math.max(0, this.matchDuration - elapsed);

    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    this.timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  drawPlayer(x, y, radius, angle, name, colorId, effectId, weapon, isSelf = false) {
    const colorObj = NAME_COLORS.find(c => c.id === colorId) || NAME_COLORS[0];
    const colorHex = colorObj.color;

    // 1. Micro-Aura / Particles
    if (effectId && effectId !== 'effect_none') {
      this.ctx.save();
      this.ctx.fillStyle = colorHex;
      this.ctx.shadowColor = colorHex;
      this.ctx.shadowBlur = 4;
      const time = Date.now() * 0.003;
      for (let i = 0; i < 3; i++) {
        const theta = time + (i * Math.PI * 2) / 3;
        const dist = radius + 6;
        const px = x + Math.cos(theta) * dist;
        const py = y + Math.sin(theta) * dist;
        this.ctx.beginPath();
        this.ctx.arc(px, py, 1.4, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    }

    // 2. Visible Weapon Barrel
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(angle);

    if (weapon) {
      this.ctx.fillStyle = weapon.color || '#94a3b8';
      this.ctx.shadowColor = weapon.color || '#94a3b8';
      this.ctx.shadowBlur = 4;
      // Gun barrel pointing along forward direction
      this.ctx.fillRect(radius - 2, -3, 14, 6);
    }

    // Player Body
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
    this.ctx.arc(radius - 2, 8, 4, 0, Math.PI * 2);
    this.ctx.arc(radius - 2, -8, 4, 0, Math.PI * 2);
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
    const label = isSelf ? `${name} (You)` : name;
    this.ctx.fillText(label, x, y - radius - 10);
    this.ctx.restore();
  }

  loop() {
    if (!this.running) return;

    this.updateMovement();
    this.updateRemotePlayers();
    this.updateTimer();

    // Clear Canvas
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

    // Render Remote Players
    this.remotePlayers.forEach((rp) => {
      this.drawPlayer(
        rp.x,
        rp.y,
        18,
        rp.angle || 0,
        rp.name,
        rp.colorId,
        rp.effectId,
        rp.equippedWeapon,
        false
      );
    });

    // Render Local Player
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
