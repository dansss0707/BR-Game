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
        <div id="game-ui-overlay" style="position: absolute; top: 0; left: 0; width: 100%; pointer-events: none; z-index: 10; padding: 16px; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box;">
          <button id="btn-exit-game" class="btn secondary-btn small" style="pointer-events: auto;" type="button">✕ Leave Arena</button>
          
          <!-- Desync-Proof Synced Match Timer -->
          <div style="background: rgba(10, 16, 26, 0.85); border: 1px solid var(--border-dim); padding: 8px 18px; border-radius: 6px; display: flex; gap: 8px; align-items: center; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
            <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase;">Zone Collapse</span>
            <span id="timer-val" style="font-family: var(--font-display); font-size: 1.15rem; color: var(--tactical-amber); letter-spacing: 1px;">02:00</span>
          </div>

          <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--terminal-green); background: rgba(10, 16, 26, 0.85); border: 1px solid var(--border-dim); padding: 8px 14px; border-radius: 6px;">
            WASD / ARROWS to Move
          </div>
        </div>
        <canvas id="game-canvas" style="display: block; width: 100vw; height: 100vh; background: #080d16;"></canvas>
      `;

      // Dynamically load arena module and start loop
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
    // Prevent unneeded re-routing when switching tabs or refreshing auth tokens
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

      // If user is already on an active screen, don't kick them out
      if (AppState.activeRoute && AppState.activeRoute !== 'auth') {
        return;
      }

      isInitialized = true;

      // Restore active room if reconnecting or reloading mid-party
      try {
        const activeRoom = await getActiveRoomForUser(session.user.id);
        if (activeRoom) {
          AppState.currentRoom = activeRoom;
          const isHost = activeRoom.host_id === session.user.id;
          navigateTo('rooms', { room: activeRoom, isHost, initialStatus: 'accepted' });
          return;
        }
      } catch (err) {
        console.warn('No active room to restore:', err);
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
