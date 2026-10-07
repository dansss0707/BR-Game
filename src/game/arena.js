import { supabase } from '../services/supabase.js';
import { AppState, navigateTo } from '../main.js';
import { NAME_COLORS } from '../services/profile.js';

export class GameArena {
  constructor(canvas, room, user, profile) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.room = room;
    this.user = user;
    this.profile = profile || { username: 'Player', equipped_color: 'color_white', equipped_effect: 'effect_none' };

    // Canvas sizing
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Local Player State
    this.player = {
      id: user.id,
      name: profile?.username || 'Player',
      colorId: profile?.equipped_color || 'color_white',
      effectId: profile?.equipped_effect || 'effect_none',
      x: 100 + Math.random() * 600,
      y: 100 + Math.random() * 400,
      radius: 18,
      speed: 4,
      vx: 0,
      vy: 0
    };

    // Remote Players Map (id -> { x, y, targetX, targetY, name, colorId, effectId, particles: [] })
    this.remotePlayers = new Map();

    // Input state
    this.keys = {};
    this.setupInputs();

    // Desync-proof timer (Host anchors start time or falls back to room creation)
    this.matchDurationSeconds = 120; // 2 minutes
    this.startTimestamp = Date.now();
    this.timerDisplay = document.getElementById('timer-val');

    // Realtime Broadcast Channel
    this.channel = null;
    this.broadcastInterval = null;
    this.running = false;
    this.animId = null;

    this.initNetwork();
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  setupInputs() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });
  }

  initNetwork() {
    const roomId = this.room?.id || 'public_arena';
    this.channel = supabase.channel(`arena:${roomId}`, {
      config: { broadcast: { self: false } }
    });

    this.channel
      .on('broadcast', { event: 'player_pos' }, ({ payload }) => {
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
            particles: []
          };
          this.remotePlayers.set(payload.id, remote);
        } else {
          remote.targetX = payload.x;
          remote.targetY = payload.y;
          remote.name = payload.name;
          remote.colorId = payload.colorId;
          remote.effectId = payload.effectId;
        }
      })
      .on('broadcast', { event: 'time_sync' }, ({ payload }) => {
        // Sync timestamp from host to keep perfectly in phase
        if (payload?.startTimestamp) {
          this.startTimestamp = payload.startTimestamp;
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Send 20 updates/second to avoid throttling
          this.broadcastInterval = setInterval(() => this.broadcastPosition(), 50);

          // If host, periodically broadcast the true match start timestamp
          if (this.room?.host_id === this.user.id) {
            this.channel.send({
              type: 'broadcast',
              event: 'time_sync',
              payload: { startTimestamp: this.startTimestamp }
            });
          }
        }
      });
  }

  broadcastPosition() {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'player_pos',
      payload: {
        id: this.player.id,
        name: this.player.name,
        colorId: this.player.colorId,
        effectId: this.player.effectId,
        x: Math.round(this.player.x),
        y: Math.round(this.player.y)
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

    // Normalize diagonal movement
    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }

    this.player.x += dx * this.player.speed;
    this.player.y += dy * this.player.speed;

    // Screen bounds clamp
    const pad = this.player.radius;
    this.player.x = Math.max(pad, Math.min(this.canvas.width - pad, this.player.x));
    this.player.y = Math.max(pad, Math.min(this.canvas.height - pad, this.player.y));
  }

  updateRemotePlayers() {
    // Smooth interpolation (lerp) to target coordinates
    this.remotePlayers.forEach((rp) => {
      rp.x += (rp.targetX - rp.x) * 0.35;
      rp.y += (rp.targetY - rp.y) * 0.35;
    });
  }

  updateTimer() {
    if (!this.timerDisplay) return;

    // Delta from absolute start time
    const elapsedSeconds = Math.floor((Date.now() - this.startTimestamp) / 1000);
    const remaining = Math.max(0, this.matchDurationSeconds - elapsedSeconds);

    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    this.timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  drawPlayer(x, y, radius, name, colorId, effectId, isSelf = false) {
    const colorObj = NAME_COLORS.find(c => c.id === colorId) || NAME_COLORS[0];
    const colorHex = colorObj.color;

    // 1. Draw Subtle Micro-Particles / Auras Around Player Body
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

    // 2. Player Body Circle
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = isSelf ? '#1e293b' : '#0f172a';
    this.ctx.fill();
    this.ctx.lineWidth = 2.5;
    this.ctx.strokeStyle = colorHex;
    this.ctx.stroke();

    // Direction Pip / Core
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 0.45, 0, Math.PI * 2);
    this.ctx.fillStyle = colorHex;
    this.ctx.shadowColor = colorHex;
    this.ctx.shadowBlur = 6;
    this.ctx.fill();
    this.ctx.restore();

    // 3. Above-Head Nameplate with Glow & Custom Color
    this.ctx.save();
    this.ctx.font = 'bold 12px "JetBrains Mono", monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = colorHex;
    if (colorObj.glow && colorObj.glow !== 'none') {
      this.ctx.shadowColor = colorHex;
      this.ctx.shadowBlur = 8;
    }
    
    // Draw Nameplate text 26px above player head
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
    this.ctx.fillStyle = '#080d16';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Subtle Grid lines
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    this.ctx.lineWidth = 1;
    const gridSize = 40;
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
      this.drawPlayer(rp.x, rp.y, 18, rp.name, rp.colorId, rp.effectId, false);
    });

    // Render Local Player
    this.drawPlayer(
      this.player.x,
      this.player.y,
      this.player.radius,
      this.player.name,
      this.player.colorId,
      this.player.effectId,
      true
    );

    this.animId = requestAnimationFrame(() => this.loop());
  }
}
