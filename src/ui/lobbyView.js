import { AppState, navigateTo } from '../main.js';
import { logoutUser } from '../services/auth.js';
import { 
  NAME_COLORS, 
  AURA_EFFECTS, 
  ROLL_COST, 
  rollNameColor, 
  rollAuraEffect 
} from '../services/profile.js';
import { AuraRenderer } from '../utils/particleFx.js';
import { showToast } from '../utils/helpers.js';

let auraEngine = null;

export function mountLobbyView(container) {
  const profile = AppState.profile || { 
    username: 'Player', 
    coins: 250, 
    wins: 0, 
    equipped_color: 'color_white',
    equipped_effect: 'effect_none'
  };

  const currentColor = NAME_COLORS.find(c => c.id === (profile.equipped_color || 'color_white')) || NAME_COLORS[0];
  const currentEffect = AURA_EFFECTS.find(e => e.id === (profile.equipped_effect || 'effect_none')) || AURA_EFFECTS[0];

  container.innerHTML = `
    <section id="view-lobby">
      <header class="top-nav">
        <div class="user-badge">
          <div class="rank-insignia">LVL <span>1</span></div>
          <div class="user-meta">
            <span class="username" id="display-nav-name" style="color: ${currentColor.color}; text-shadow: ${currentColor.glow};">
              ${profile.username}
            </span>
            <span class="combat-tag">Ready</span>
          </div>
        </div>

        <div class="lobby-currencies">
          <div class="stat-pill"><span class="icon">🪙</span> <span id="lobby-coin-count">${profile.coins ?? 0}</span> <small>Coins</small></div>
          <div class="stat-pill highlight"><span class="icon">🏆</span> <span>${profile.wins ?? 0}</span> <small>Wins</small></div>
          <button id="btn-logout" class="btn secondary-btn small" type="button">Log Out</button>
        </div>
      </header>

      <div class="deck-grid">
        <!-- LEFT: PLAY MODES -->
        <aside class="deck-rail left">
          <div class="rail-header">
            <span class="subtext">Play Modes</span>
            <h3>Battle</h3>
          </div>

          <div class="action-stack">
            <button id="btn-open-rooms" class="deck-action-card primary" type="button">
              <div class="card-stencil">Custom Matches</div>
              <div class="card-body">
                <h2>Join or Host a Room</h2>
                <p>Play with friends via party codes or join public matches.</p>
              </div>
              <div class="card-tag">Multiplayer</div>
            </button>

            <button id="btn-quick-play" class="deck-action-card" type="button">
              <div class="card-stencil">Instant Play</div>
              <div class="card-body">
                <h2>Practice Arena</h2>
                <p>Jump into a single-player arena against bots.</p>
              </div>
              <div class="card-tag">Solo</div>
            </button>
          </div>
        </aside>

        <!-- CENTER: AVATAR & MICRO-PARTICLE RING -->
        <main class="deck-centerpiece">
          <div class="pedestal-hologram" style="position: relative;">
            <canvas id="lobby-aura-canvas" width="260" height="260" style="position: absolute; top: -20px; left: 30px; pointer-events: none; z-index: 2;"></canvas>
            
            <div class="pedestal-ring"></div>
            
            <div class="character-pod" style="position: relative; z-index: 5;">
              <div class="character-sprite" style="background: radial-gradient(circle, #1a2332 0%, #080c14 100%);">
                <span class="avatar-icon" style="filter: drop-shadow(0 0 6px ${currentColor.color});">⚡</span>
              </div>
            </div>

            <div class="operative-id-plate">
              <span class="plate-class">EQUIPPED ROLLS</span>
              <span class="plate-name" id="display-plate-name" style="color: ${currentColor.color}; text-shadow: ${currentColor.glow};">
                ${profile.username}
              </span>
              <span class="plate-rarity" id="display-plate-effect" style="color: var(--tactical-amber);">
                ${currentEffect.name.toUpperCase()} (${currentEffect.rarity})
              </span>
            </div>
          </div>
        </main>

        <!-- RIGHT: THE RNG ROLLING LAB -->
        <aside class="deck-rail right">
          <div class="rail-header">
            <span class="subtext">RNG Shrine</span>
            <h3>Spin Station</h3>
          </div>

          <div class="action-stack" style="gap: 16px;">
            <!-- Roll Name Color -->
            <div class="room-panel" style="padding: 16px; border: 1px solid var(--border-dim); border-radius: 6px; background: rgba(0,0,0,0.25);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-family: var(--font-display); font-size: 0.9rem;">Name Color</span>
                <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--tactical-amber);">${ROLL_COST} 🪙</span>
              </div>
              <p style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); margin-bottom: 12px;">
                Roll for rare neon glows and mythic tints.
              </p>
              <button id="btn-roll-color" class="btn primary-btn small" style="width: 100%;" type="button">
                🎲 Roll Color
              </button>
            </div>

            <!-- Roll Aura Effect -->
            <div class="room-panel" style="padding: 16px; border: 1px solid var(--border-dim); border-radius: 6px; background: rgba(0,0,0,0.25);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-family: var(--font-display); font-size: 0.9rem;">Micro Aura</span>
                <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--tactical-amber);">${ROLL_COST} 🪙</span>
              </div>
              <p style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); margin-bottom: 12px;">
                Roll for orbiting particles, sparks, or ember dust.
              </p>
              <button id="btn-roll-aura" class="btn primary-btn small" style="width: 100%;" type="button">
                ✨ Roll Aura
              </button>
            </div>
          </div>
        </aside>
      </div>

      <footer class="deck-ticker">
        <div class="ticker-badge">Live</div>
        <div class="ticker-text">
          <span>Rolls auto-equip and show live in parties</span>
        </div>
      </footer>
    </section>
  `;

  // Start Canvas Micro-Particles
  const canvas = document.getElementById('lobby-aura-canvas');
  if (canvas) {
    if (auraEngine) auraEngine.stop();
    auraEngine = new AuraRenderer(canvas);
    auraEngine.setEffect(currentEffect.type, currentEffect.color || currentColor.color);
    auraEngine.start();
  }

  // Animate Roll Helper
  function runRollAnimation(element, candidateNames, finalItem, onDone) {
    let index = 0;
    const interval = setInterval(() => {
      element.textContent = candidateNames[index % candidateNames.length];
      index++;
    }, 60);

    setTimeout(() => {
      clearInterval(interval);
      element.textContent = finalItem.name;
      onDone();
    }, 800);
  }

  // 1. Roll Name Color Handler
  const rollColorBtn = document.getElementById('btn-roll-color');
  rollColorBtn?.addEventListener('click', async () => {
    try {
      rollColorBtn.disabled = true;
      rollColorBtn.textContent = 'Rolling...';

      const { updatedProfile, item } = await rollNameColor(AppState.user.id);
      AppState.profile = updatedProfile;

      const coinEl = document.getElementById('lobby-coin-count');
      if (coinEl) coinEl.textContent = updatedProfile.coins;

      const namePlate = document.getElementById('display-plate-name');
      const navName = document.getElementById('display-nav-name');

      runRollAnimation(namePlate, NAME_COLORS.map(c => c.name), item, () => {
        namePlate.textContent = updatedProfile.username;
        namePlate.style.color = item.color;
        namePlate.style.textShadow = item.glow;

        if (navName) {
          navName.style.color = item.color;
          navName.style.textShadow = item.glow;
        }

        const eff = AURA_EFFECTS.find(e => e.id === updatedProfile.equipped_effect) || AURA_EFFECTS[0];
        if (auraEngine && eff.type === 'none') {
          auraEngine.setEffect('none', item.color);
        }

        showToast(`Rolled [${item.rarity}] ${item.name}!`, 'success');
        rollColorBtn.disabled = false;
        rollColorBtn.textContent = '🎲 Roll Color';
      });

    } catch (err) {
      showToast(err.message, 'error');
      rollColorBtn.disabled = false;
      rollColorBtn.textContent = '🎲 Roll Color';
    }
  });

  // 2. Roll Aura Effect Handler
  const rollAuraBtn = document.getElementById('btn-roll-aura');
  rollAuraBtn?.addEventListener('click', async () => {
    try {
      rollAuraBtn.disabled = true;
      rollAuraBtn.textContent = 'Rolling...';

      const { updatedProfile, item } = await rollAuraEffect(AppState.user.id);
      AppState.profile = updatedProfile;

      const coinEl = document.getElementById('lobby-coin-count');
      if (coinEl) coinEl.textContent = updatedProfile.coins;

      const effectPlate = document.getElementById('display-plate-effect');

      runRollAnimation(effectPlate, AURA_EFFECTS.map(e => e.name), item, () => {
        effectPlate.textContent = `${item.name.toUpperCase()} (${item.rarity})`;

        const col = NAME_COLORS.find(c => c.id === updatedProfile.equipped_color) || NAME_COLORS[0];
        if (auraEngine) {
          auraEngine.setEffect(item.type, item.color || col.color);
        }

        showToast(`Rolled [${item.rarity}] ${item.name}!`, 'success');
        rollAuraBtn.disabled = false;
        rollAuraBtn.textContent = '✨ Roll Aura';
      });

    } catch (err) {
      showToast(err.message, 'error');
      rollAuraBtn.disabled = false;
      rollAuraBtn.textContent = '✨ Roll Aura';
    }
  });

  // Navigation handlers
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if (auraEngine) auraEngine.stop();
    await logoutUser();
    navigateTo('auth');
  });

  document.getElementById('btn-open-rooms')?.addEventListener('click', () => {
    if (auraEngine) auraEngine.stop();
    navigateTo('rooms');
  });

  document.getElementById('btn-quick-play')?.addEventListener('click', () => {
    if (auraEngine) auraEngine.stop();
    navigateTo('game');
  });
}