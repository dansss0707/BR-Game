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
        <div id="game-hud">
          <div id="zone-timer">Storm closing: <span id="timer-val">01:30</span></div>
          <div id="player-status"><div class="hp-bar"><div id="hp-fill"></div></div></div>
        </div>
        <canvas id="game-canvas"></canvas>
      `;
      break;
  }
}

async function init() {
  supabase.auth.onAuthStateChange(async (event, session) => {
    // Ignore routine token refreshes or tab-focus triggers if already inside a view
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

      // If we are already on an active screen, don't kick the user out on tab switch
      if (AppState.activeRoute && AppState.activeRoute !== 'auth') {
        return;
      }

      isInitialized = true;

      // Check if user has an active room to restore
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