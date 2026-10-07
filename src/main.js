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
  if (!root) {
    console.error('Missing #app-root element in index.html!');
    return;
  }

  // Ensure root is visible and filling screen
  root.style.display = 'block';
  root.style.width = '100vw';
  root.style.height = '100vh';
  root.style.overflow = 'hidden';
  root.style.position = 'relative';

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
        <div id="game-ui-overlay" style="position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 20; display: flex; flex-direction: column; justify-content: space-between; padding: 18px; box-sizing: border-box; font-family: var(--font-mono, monospace);">
          
          <!-- TOP ROW: EXIT + TIMER -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
            <button id="btn-exit-game" class="btn secondary-btn small" style="pointer-events: auto; padding: 8px 14px; cursor: pointer; background: #1e293b; color: #fff; border: 1px solid #475569; border-radius: 4px;" type="button">✕ Leave Arena</button>
            
            <div style="background: rgba(10, 14, 22, 0.9); border: 1px solid rgba(255,255,255,0.15); padding: 8px 24px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; box-shadow: 0 4px 14px rgba(0,0,0,0.6);">
              <span id="host-badge" style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">ZONE COLLAPSE</span>
              <span id="timer-val" style="font-family: var(--font-display, monospace); font-size: 1.6rem; color: #f59e0b; font-weight: bold; letter-spacing: 2px;">02:00</span>
            </div>

            <div style="font-size: 0.7rem; color: #94a3b8; background: rgba(10, 14, 22, 0.8); padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
              CLICK: Shoot | 1-5: Swap
            </div>
          </div>

          <!-- BOTTOM ROW: VITALS + 5-SLOT INVENTORY -->
          <div style="display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 8px;">
            
            <!-- Vitals -->
            <div style="width: 320px; background: rgba(8, 12, 18, 0.95); border: 1px solid rgba(255,255,255,0.1); padding: 8px 12px; border-radius: 8px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 4px 14px rgba(0,0,0,0.6);">
              <!-- Shield -->
              <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.68rem; color: #00d2ff; margin-bottom: 2px;">
                  <span>SHIELD</span>
                  <span id="shield-text">50 / 100</span>
                </div>
                <div style="width: 100%; height: 7px; background: rgba(0,0,0,0.6); border-radius: 4px; overflow: hidden; border: 1px solid rgba(0,210,255,0.25);">
                  <div id="shield-fill" style="width: 50%; height: 100%; background: linear-gradient(90deg, #0077b6, #00d2ff); transition: width 0.15s ease;"></div>
                </div>
              </div>

              <!-- Health -->
              <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.68rem; color: #00ff88; margin-bottom: 2px;">
                  <span>HEALTH</span>
                  <span id="hp-text">100 / 100</span>
                </div>
                <div style="width: 100%; height: 9px; background: rgba(0,0,0,0.6); border-radius: 4px; overflow: hidden; border: 1px solid rgba(0,255,136,0.25);">
                  <div id="hp-fill" style="width: 100%; height: 100%; background: linear-gradient(90deg, #009944, #00ff88); transition: width 0.15s ease;"></div>
                </div>
              </div>
            </div>

            <!-- 5-Slot Hotbar -->
            <div id="inventory-bar" style="display: flex; gap: 8px; pointer-events: auto;"></div>

          </div>

        </div>
        <canvas id="game-canvas" style="position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: #070b12; display: block; z-index: 1;"></canvas>
      `;

      // Fallback check: look in both ./game/arena.js and ./arena.js
      const loadArena = async () => {
        try {
          return await import('./game/arena.js');
        } catch {
          return await import('./arena.js');
        }
      };

      loadArena()
        .then(({ GameArena }) => {
          const canvas = document.getElementById('game-canvas');
          if (canvas) {
            const arena = new GameArena(canvas, AppState.currentRoom, AppState.user, AppState.profile);
            arena.start();

            document.getElementById('btn-exit-game')?.addEventListener('click', () => {
              arena.stop();
              navigateTo('lobby');
            });
          }
        })
        .catch((err) => {
          console.error('Failed to load arena module:', err);
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
