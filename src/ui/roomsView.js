import { AppState, navigateTo } from '../main.js';
import { 
  createRoom, 
  getOpenRooms, 
  requestJoinByCode, 
  getRoomMembers, 
  updateMemberStatus, 
  setRoomStatus, 
  leaveOrDisbandRoom,
  subscribeToRoom 
} from '../services/rooms.js';
import { showToast } from '../utils/helpers.js';
import { supabase } from '../services/supabase.js';

let activeRoomChannelCleanup = null;
let currentRoomData = null;
let pendingRoomChannelCleanup = null;

export function mountRoomsView(container, params = {}) {
  if (params.room && (params.isHost || params.initialStatus === 'accepted')) {
    renderRoomLobby(container, params.room, params.isHost, params.initialStatus);
  } else {
    renderRoomsBrowser(container);
  }
}

// 1. Clean Room Browser Screen
export async function renderRoomsBrowser(container) {
  if (activeRoomChannelCleanup) {
    activeRoomChannelCleanup();
    activeRoomChannelCleanup = null;
  }
  currentRoomData = null;
  AppState.currentRoom = null;

  container.innerHTML = `
    <section id="view-rooms" class="view" style="padding: 32px; max-width: 1000px; margin: 0 auto; gap: 24px;">
      <div class="rooms-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <button id="btn-rooms-back" class="btn secondary-btn small" type="button">← Main Menu</button>
        <h2 style="font-family: var(--font-display); letter-spacing: 1px;">Game Lobbies</h2>
        <button id="btn-create-room-modal" class="btn primary-btn small" type="button">+ Create Room</button>
      </div>

      <div class="rooms-grid">
        <div class="room-panel">
          <h3 style="font-family: var(--font-display); margin-bottom: 14px;">Open Games</h3>
          <div id="room-list-loading" style="font-family: var(--font-mono); color: var(--text-muted); font-size: 0.85rem;">Finding games...</div>
          <div id="room-list" class="room-list"></div>
        </div>

        <div class="room-panel">
          <h3 style="font-family: var(--font-display); margin-bottom: 12px;">Join Private Game</h3>
          <p style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-muted); margin-bottom: 14px;">
            Got a code from a friend? Enter it below to join their party:
          </p>
          <div class="invite-box">
            <input type="text" id="input-room-code" placeholder="e.g. BR-8A2K" maxlength="8" />
            <button id="btn-join-code" class="btn primary-btn small" type="button">Join</button>
          </div>
          <div id="request-pending-notice" style="display: none; margin-top: 16px; padding: 12px; background: rgba(255, 179, 0, 0.1); border: 1px solid var(--tactical-amber); font-family: var(--font-mono); font-size: 0.8rem; color: var(--tactical-amber); border-radius: 4px;">
            ⏳ Request sent! Waiting for host to let you in...
          </div>
        </div>
      </div>
    </section>
  `;

  document.getElementById('btn-rooms-back')?.addEventListener('click', () => {
    if (pendingRoomChannelCleanup) {
      pendingRoomChannelCleanup();
      pendingRoomChannelCleanup = null;
    }
    navigateTo('lobby');
  });

  document.getElementById('btn-create-room-modal')?.addEventListener('click', () => handleCreateRoom(container));
  document.getElementById('btn-join-code')?.addEventListener('click', () => handleJoinByCode(container));

  await loadRoomList(container);
}

async function loadRoomList(container) {
  const listEl = document.getElementById('room-list');
  const loader = document.getElementById('room-list-loading');
  if (!listEl) return;

  try {
    const rooms = await getOpenRooms();
    if (loader) loader.style.display = 'none';
    listEl.innerHTML = '';

    if (!rooms || rooms.length === 0) {
      listEl.innerHTML = `<p style="font-family: var(--font-mono); color: var(--text-muted); font-size: 0.82rem;">No active games right now. Click "+ Create Room" to start one!</p>`;
      return;
    }

    rooms.forEach(room => {
      const acceptedCount = room.room_members?.filter(m => m.status === 'accepted').length || 1;
      const isMyRoom = room.host_id === AppState.user?.id;
      const myMembership = room.room_members?.find(m => m.user_id === AppState.user?.id);

      const card = document.createElement('div');
      card.className = 'room-item';
      card.innerHTML = `
        <div>
          <strong style="font-family: var(--font-display); letter-spacing: 0.5px;">${room.title}</strong>
          <div class="meta" style="font-family: var(--font-mono); font-size: 0.75rem; margin-top: 4px;">
            <span>Code: <b style="color: var(--tactical-amber);">${room.code}</b></span>
            <span>Host: ${room.profiles?.username || 'Player'}</span>
            <span>Players: ${acceptedCount}/${room.max_players}</span>
          </div>
        </div>
        <button class="btn secondary-btn small btn-action-room" data-code="${room.code}" type="button">
          ${isMyRoom ? 'Your Lobby' : (myMembership?.status === 'pending' ? 'Pending...' : 'Join Game')}
        </button>
      `;

      const btn = card.querySelector('.btn-action-room');
      if (myMembership?.status === 'pending') {
        btn.disabled = true;
        btn.style.opacity = '0.6';
      }

      btn.addEventListener('click', () => {
        handleJoinDirect(container, room.code, btn);
      });

      listEl.appendChild(card);
    });
  } catch (err) {
    if (loader) loader.textContent = 'Could not load games.';
    showToast(err.message, 'error');
  }
}

async function handleCreateRoom(container) {
  const defaultTitle = `${AppState.profile?.username || 'Player'}'s Match`;
  const title = prompt('Enter a room name:', defaultTitle) || defaultTitle;

  try {
    const room = await createRoom(AppState.user.id, title, 10);
    showToast(`Room created! Code: ${room.code}`, 'success');
    AppState.currentRoom = room;
    renderRoomLobby(container, room, true, 'accepted');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleJoinByCode(container) {
  const input = document.getElementById('input-room-code');
  const code = input?.value;
  if (!code) {
    showToast('Please type in a room code', 'error');
    return;
  }
  const submitBtn = document.getElementById('btn-join-code');
  handleJoinDirect(container, code, submitBtn);
}

async function handleJoinDirect(container, code, buttonEl) {
  try {
    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.textContent = 'Sending...';
    }

    const { roomId, status } = await requestJoinByCode(code, AppState.user.id);
    
    const { data: room, error } = await supabase
      .from('game_rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (error || !room) throw new Error('Could not find that room.');

    if (room.host_id === AppState.user.id || status === 'accepted') {
      AppState.currentRoom = room;
      renderRoomLobby(container, room, room.host_id === AppState.user.id, 'accepted');
      return;
    }

    showToast('Join request sent! Waiting for host...', 'info');

    if (buttonEl) {
      buttonEl.textContent = 'Pending...';
    }

    const pendingNotice = document.getElementById('request-pending-notice');
    if (pendingNotice) pendingNotice.style.display = 'block';

    if (pendingRoomChannelCleanup) pendingRoomChannelCleanup();

    pendingRoomChannelCleanup = subscribeToRoom(
      room.id,
      async () => {
        const { data: membership } = await supabase
          .from('room_members')
          .select('status')
          .eq('room_id', room.id)
          .eq('user_id', AppState.user.id)
          .maybeSingle();

        if (membership?.status === 'accepted') {
          showToast('Accepted! Joining lobby...', 'success');
          if (pendingRoomChannelCleanup) {
            pendingRoomChannelCleanup();
            pendingRoomChannelCleanup = null;
          }
          AppState.currentRoom = room;
          renderRoomLobby(container, room, false, 'accepted');
        } else if (membership?.status === 'rejected') {
          showToast('The host declined your join request.', 'error');
          if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.textContent = 'Join Game';
          }
          if (pendingNotice) pendingNotice.style.display = 'none';
        }
      },
      (payload) => {
        if (payload.new && payload.new.status === 'finished') {
          showToast('This room was closed by the host.', 'info');
          if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.textContent = 'Join Game';
          }
          if (pendingNotice) pendingNotice.style.display = 'none';
        }
      }
    );

  } catch (err) {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = 'Join Game';
    }
    showToast(err.message, 'error');
  }
}

// 2. Friendly Lobby Screen
export async function renderRoomLobby(container, room, isHost, initialStatus = 'accepted') {
  currentRoomData = room;
  AppState.currentRoom = room;

  container.innerHTML = `
    <section id="view-rooms" class="view" style="padding: 32px; max-width: 1000px; margin: 0 auto; gap: 24px;">
      <div class="rooms-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <button id="btn-leave-room" class="btn secondary-btn small" type="button">← Leave Party</button>
        <div>
          <h2 style="font-family: var(--font-display); letter-spacing: 1px;">
            ${room.title} <span style="color: var(--tactical-amber); font-family: var(--font-mono); font-size: 1rem;">[${room.code}]</span>
          </h2>
          <p id="room-status-badge" style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--terminal-green); margin-top: 4px;">
            Status: ${initialStatus === 'accepted' ? 'Ready in Lobby' : 'Waiting for Host'}
          </p>
        </div>
        ${isHost ? `<button id="btn-start-match" class="btn primary-btn small" type="button">Start Game</button>` : ''}
      </div>

      <div class="rooms-grid">
        <div class="room-panel">
          <h3 style="font-family: var(--font-display); margin-bottom: 14px;">
            Players in Party (<span id="member-count">1</span>/${room.max_players})
          </h3>
          <div id="accepted-members-list" class="room-list"></div>
        </div>

        ${isHost ? `
        <div class="room-panel">
          <h3 style="font-family: var(--font-display); margin-bottom: 14px;">Join Requests</h3>
          <div id="pending-members-list" class="room-list"></div>
        </div>
        ` : `
        <div class="room-panel">
          <h3 style="font-family: var(--font-display); margin-bottom: 14px;">Game Info</h3>
          <p style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--text-muted); line-height: 1.6;">
            Hang tight! As soon as the party leader hits <b>Start Game</b>, your match will launch automatically.
          </p>
        </div>
        `}
      </div>
    </section>
  `;

  document.getElementById('btn-leave-room')?.addEventListener('click', async () => {
    try {
      await leaveOrDisbandRoom(room.id, AppState.user.id, isHost);
    } catch (err) {
      console.error('Error leaving room:', err);
    } finally {
      renderRoomsBrowser(container);
    }
  });

  if (isHost) {
    document.getElementById('btn-start-match')?.addEventListener('click', async () => {
      try {
        await setRoomStatus(room.id, 'in_progress');
        showToast('Starting the match...', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (activeRoomChannelCleanup) {
    activeRoomChannelCleanup();
  }

  activeRoomChannelCleanup = subscribeToRoom(
    room.id,
    () => syncMembers(room.id, isHost),
    (payload) => {
      if (payload.new && payload.new.status === 'in_progress') {
        showToast('Match starting! Loading map...', 'success');
        AppState.currentRoom = room;
        navigateTo('game');
      } else if (payload.new && payload.new.status === 'finished') {
        showToast('The room was closed by the host.', 'info');
        renderRoomsBrowser(container);
      }
    }
  );

  syncMembers(room.id, isHost);
}

async function syncMembers(roomId, isHost) {
  try {
    const members = await getRoomMembers(roomId);
    if (!members) return;

    const myMembership = members.find(m => m.user_id === AppState.user?.id);
    if (myMembership) {
      const badge = document.getElementById('room-status-badge');
      if (badge) badge.textContent = `Status: ${myMembership.status === 'accepted' ? 'Ready in Lobby' : 'Pending'}`;
      if (myMembership.status === 'rejected') {
        showToast('You were removed from the room.', 'error');
        const root = document.getElementById('app-root');
        if (root) renderRoomsBrowser(root);
        return;
      }
    }

    const accepted = members.filter(m => m.status === 'accepted');
    const pending = members.filter(m => m.status === 'pending');

    const countEl = document.getElementById('member-count');
    if (countEl) countEl.textContent = accepted.length;

    const acceptedList = document.getElementById('accepted-members-list');
    if (acceptedList) {
      acceptedList.innerHTML = accepted.map(m => `
        <div class="room-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px;">
          <span style="font-family: var(--font-display); letter-spacing: 0.5px;">
            ${m.profiles?.username || 'Player'} ${m.user_id === currentRoomData?.host_id ? '<span style="color: var(--tactical-amber); font-size: 0.8rem;">👑 Party Leader</span>' : ''}
          </span>
          <span style="font-family: var(--font-mono); color: var(--terminal-green); font-size: 0.78rem;">Ready</span>
        </div>
      `).join('');
    }

    if (isHost) {
      const pendingList = document.getElementById('pending-members-list');
      if (pendingList) {
        if (pending.length === 0) {
          pendingList.innerHTML = `<p style="font-family: var(--font-mono); color: var(--text-dim); font-size: 0.78rem;">No pending join requests.</p>`;
        } else {
          pendingList.innerHTML = pending.map(m => `
            <div class="room-item" data-member-id="${m.id}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px;">
              <span style="font-family: var(--font-display); font-size: 0.95rem;">${m.profiles?.username || 'Player'}</span>
              <div style="display: flex; gap: 8px;">
                <button class="btn primary-btn small btn-accept" type="button">Accept</button>
                <button class="btn secondary-btn small btn-decline" type="button">Decline</button>
              </div>
            </div>
          `).join('');

          pendingList.querySelectorAll('.btn-accept').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              const memId = e.target.closest('.room-item').dataset.memberId;
              await updateMemberStatus(memId, 'accepted');
            });
          });

          pendingList.querySelectorAll('.btn-decline').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              const memId = e.target.closest('.room-item').dataset.memberId;
              await updateMemberStatus(memId, 'rejected');
            });
          });
        }
      }
    }
  } catch (err) {
    console.error('Member sync error:', err);
  }
}