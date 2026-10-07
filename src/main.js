import { supabase } from './services/supabase.js';
import { getProfile } from './services/auth.js';
import { getActiveRoomForUser } from './services/rooms.js';

import { mountAuthView } from './ui/authView.js';
import { mountLobbyView } from './ui/lobbyView.js';
import { mountCratesView } from './ui/cratesView.js';
import { mountRoomsView } from './ui/roomsView.js';

export const AppState = {
  user: null,
  profile: null,
  currentRoom: null,
  activeRoute: null
};

let isInitialized = false;

export function navigateTo(route, params = {}) {
  const root = document.getElementById('app-root');
  if (!root) return;

  AppState.activeRoute = route;

  switch (route) {
    case 'auth':
      mountAuthView(root);
      break;

    case 'lobby':
      mountLobbyView(root);
      break;

    case 'crates':
      mountCratesView(root);
      break;

    case 'rooms':
      mountRoomsView(root, params);
      break;

    case 'game':
      root.innerHTML = `
        <div id="game-ui-container" style="position: absolute; inset: 0; pointer-events: none; z-index: 10; display: flex; flex-direction: column; justify-content: space-between; padding: 20px; box-sizing: border-box; font-family: var(--font-mono);">
          
          <!-- TOP HEADER: LEAVE BTN + DESYNC-PROOF TIMER -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
            <button id="btn-exit-game" class="btn secondary-btn small" style="pointer-events: auto;" type="button">✕ Leave Match</button>
            
            <div style="background: rgba(12, 17, 26, 0.9); border: 1px solid var(--border-dim); padding: 8px 24px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; box-shadow: 0 4px 16px rgba(0,0,0,0.5);">
              <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px;">Storm Shrinking</span>
              <span id="timer-val" style="font-family: var(--font-display); font-size: 1.5rem; color: var(--tactical-amber); letter-spacing: 2px;">02:00</span>
            </div>

            <div style="width: 90px;"></div> <!-- Spacer for balance -->
          </div>

          <!-- BOTTOM HUD: BARS & 5-SLOT INVENTORY -->
          <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; margin-bottom: 8px;">
            
            <!-- Vitals (Shield & Health) -->
            <div style="display: flex; flex-direction: column; gap: 6px; width: 320px; background: rgba(10, 14, 22, 0.85); padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 4px 12px rgba(0,0,0,0.6);">
              <!-- Shield Bar -->
              <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: #00d2ff; margin-bottom: 3px;">
                  <span>SHIELD</span>
                  <span id="shield-text">50 / 100</span>
                </div>
                <div style="width: 100%; height: 8px; background: rgba(0,0,0,0.6); border-radius: 4px; overflow: hidden; border: 1px solid rgba(0, 210, 255, 0.2);">
                  <div id="shield-fill" style="width: 50%; height: 100%; background: linear-gradient(90deg, #0088cc, #00d2ff); transition: width 0.2s ease;"></div>
                </div>
              </div>

              <!-- Health Bar -->
              <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: #00ff88; margin-bottom: 3px;">
                  <span>HEALTH</span>
                  <span id="hp-text">100 / 100</span>
                </div>
                <div style="width: 100%; height: 10px; background: rgba(0,0,0,0.6); border-radius: 5px; overflow: hidden; border: 1px solid rgba(0, 255, 136, 0.2);">
                  <div id="hp-fill" style="width: 100%; height: 100%; background: linear-gradient(90deg, #00aa55, #00ff88); transition: width 0.2s ease;"></div>
                </div>
              </div>
            </div>

            <!-- 5-Slot Hotbar -->
            <div id="inventory-bar" style="display: flex; gap: 8px; pointer-events: auto;">
              <!-- Slots 0-4 generated dynamically in arena.js -->
            </div>

          </div>

        </div>
        <canvas id="game-canvas" style="display: block; width: 100vw; height: 100vh; background: #070b12;"></canvas>
      `;

      import('./game/arena.js').then(({ GameArena }) => {
        const canvas = document.getElementById('game-canvas');
        if (canvas) {
          const arena = new GameArena(canvas, AppState.currentRoom, AppState.user, AppState.profile);
          arena.start();

          document.getElementById('btn-exit-game')?.addEventListener('click', () => {
            arena.stop();
            navigateTo('lobby');
          });
        }
      });
      break;
  }
}

async function init() {
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (isInitialized && (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) {
      if (session?.user) AppState.user = session.user;
      return;
    }

    if (session?.user) {
      AppState.user = session.user;
      try {
        AppState.profile = await getProfile(session.user.id);
      } catch (err) {
        console.error('Failed to load profile:', err);
      }

      if (AppState.activeRoute && AppState.activeRoute !== 'auth') return;

      isInitialized = true;
      try {
        const activeRoom = await getActiveRoomForUser(session.user.id);
        if (activeRoom) {
          AppState.currentRoom = activeRoom;
          const isHost = activeRoom.host_id === session.user.id;
          navigateTo('rooms', { room: activeRoom, isHost, initialStatus: 'accepted' });
          return;
        }
      } catch (err) {
        console.warn('No active room:', err);
      }

      navigateTo('lobby');
    } else {
      isInitialized = true;
      AppState.user = null;
      AppState.profile = null;
      AppState.currentRoom = null;
      navigateTo('auth');
    }
  });
}

init();
