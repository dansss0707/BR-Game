import { AppState, navigateTo } from '../main.js';
import { openCrate, NAME_COLORS, AURA_EFFECTS } from '../services/profile.js';
import { showToast } from '../utils/helpers.js';

export function mountCratesView(container) {
  const profile = AppState.profile || { coins: 250 };

  container.innerHTML = `
    <section id="view-crates" class="view" style="padding: 32px; max-width: 900px; margin: 0 auto; text-align: center; gap: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <button id="btn-crates-back" class="btn secondary-btn small" type="button">← Main Menu</button>
        <h2 style="font-family: var(--font-display); letter-spacing: 2px;">MYSTERY CRATE SHOP</h2>
        <div class="stat-pill"><span class="icon">🪙</span> <span id="crates-coin-display">${profile.coins}</span> <small>Coins</small></div>
      </div>

      <div class="room-panel" style="margin-top: 24px; padding: 40px 24px; display: flex; flex-direction: column; align-items: center; gap: 20px;">
        <div id="crate-display-box" style="
          width: 160px; 
          height: 160px; 
          background: radial-gradient(circle, #253346 0%, #0d121a 100%);
          border: 2px solid var(--tactical-amber);
          box-shadow: 0 0 25px rgba(255, 179, 0, 0.3);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 4rem;
        ">
          📦
        </div>

        <div id="crate-result" style="min-height: 48px; display: flex; flex-direction: column; align-items: center;">
          <h3 id="reward-title" style="font-family: var(--font-display); font-size: 1.2rem; color: #fff;">Mystery Loot Crate</h3>
          <p id="reward-desc" style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
            Unlocks rare neon name colors and animated aura particle effects.
          </p>
        </div>

        <button id="btn-unlock-crate" class="btn primary-btn" style="padding: 14px 36px; font-size: 1rem;" type="button">
          Open Crate (100 🪙)
        </button>
      </div>
    </section>
  `;

  document.getElementById('btn-crates-back')?.addEventListener('click', () => navigateTo('lobby'));

  const unlockBtn = document.getElementById('btn-unlock-crate');
  const box = document.getElementById('crate-display-box');
  const title = document.getElementById('reward-title');
  const desc = document.getElementById('reward-desc');
  const coinDisplay = document.getElementById('crates-coin-display');

  unlockBtn?.addEventListener('click', async () => {
    try {
      unlockBtn.disabled = true;
      unlockBtn.textContent = 'Opening...';
      box.textContent = '🎲';
      box.style.transform = 'scale(1.1)';

      const { updatedProfile, wonItem } = await openCrate(AppState.user.id);
      AppState.profile = updatedProfile;
      if (coinDisplay) coinDisplay.textContent = updatedProfile.coins;

      setTimeout(() => {
        box.textContent = wonItem.itemType === 'color' ? '🎨' : '✨';
        box.style.transform = 'scale(1)';
        title.textContent = wonItem.name;
        title.style.color = wonItem.color || 'var(--tactical-amber)';
        desc.textContent = `Unlocked new ${wonItem.itemType === 'color' ? 'Name Color' : 'Aura Effect'} (${wonItem.rarity})! Equipped in Lobby.`;
        showToast(`Unlocked: ${wonItem.name}!`, 'success');
        unlockBtn.disabled = false;
        unlockBtn.textContent = 'Open Another (100 🪙)';
      }, 700);

    } catch (err) {
      showToast(err.message, 'error');
      box.textContent = '📦';
      box.style.transform = 'scale(1)';
      unlockBtn.disabled = false;
      unlockBtn.textContent = 'Open Crate (100 🪙)';
    }
  });
}