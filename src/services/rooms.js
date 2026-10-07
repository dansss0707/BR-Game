import { supabase } from './supabase.js';

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'BR-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 1. Host creates a room (cleans up any older rooms first)
export async function createRoom(hostId, roomTitle = 'Battle Lobby', maxPlayers = 10) {
  await supabase
    .from('game_rooms')
    .delete()
    .eq('host_id', hostId);

  let room = null;
  let attempts = 0;

  while (!room && attempts < 5) {
    attempts++;
    const code = generateRoomCode();

    const { data, error } = await supabase
      .from('game_rooms')
      .insert([
        {
          code,
          host_id: hostId,
          title: roomTitle,
          status: 'waiting',
          max_players: maxPlayers
        }
      ])
      .select()
      .single();

    if (!error) {
      room = data;
    } else if (error.code !== '23505') {
      console.error('Room insert failure:', error);
      throw error;
    }
  }

  if (!room) {
    throw new Error('Unable to generate room code. Try again.');
  }

  const { error: memberErr } = await supabase
    .from('room_members')
    .upsert([
      {
        room_id: room.id,
        user_id: hostId,
        status: 'accepted'
      }
    ], { onConflict: 'room_id,user_id' });

  if (memberErr) throw memberErr;

  return room;
}

// 2. Fetch active waiting rooms
export async function getOpenRooms() {
  const { data, error } = await supabase
    .from('game_rooms')
    .select(`
      id,
      code,
      title,
      status,
      max_players,
      host_id,
      profiles!game_rooms_host_id_fkey(username, equipped_color, equipped_effect),
      room_members(id, status)
    `)
    .eq('status', 'waiting')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// 3. Player requests to join
export async function requestJoinByCode(code, userId) {
  const cleanCode = code.trim().toUpperCase();

  const { data: room, error: roomErr } = await supabase
    .from('game_rooms')
    .select('id, status, max_players, host_id')
    .eq('code', cleanCode)
    .single();

  if (roomErr || !room) throw new Error('Room not found. Check the code.');
  if (room.status !== 'waiting') throw new Error('Match has already begun or finished.');

  const { data: existing } = await supabase
    .from('room_members')
    .select('id, status')
    .eq('room_id', room.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'rejected') throw new Error('You were removed from this room.');
    return { roomId: room.id, status: existing.status };
  }

  const isHost = room.host_id === userId;
  const initialStatus = isHost ? 'accepted' : 'pending';

  const { error: joinErr } = await supabase
    .from('room_members')
    .insert([
      {
        room_id: room.id,
        user_id: userId,
        status: initialStatus
      }
    ]);

  if (joinErr) throw joinErr;

  return { roomId: room.id, status: initialStatus };
}

// 4. Host accepts or rejects
export async function updateMemberStatus(memberId, newStatus) {
  if (newStatus === 'rejected') {
    const { error } = await supabase
      .from('room_members')
      .delete()
      .eq('id', memberId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('room_members')
      .update({ status: newStatus })
      .eq('id', memberId);
    if (error) throw error;
  }
}

// Replace setRoomStatus in src/services/rooms.js
export async function setRoomStatus(roomId, newStatus) {
  const payload = { status: newStatus };
  if (newStatus === 'in_progress') {
    payload.started_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('game_rooms')
    .update(payload)
    .eq('id', roomId);

  if (error) throw error;
}

// 6. Fetch members with their equipped color and aura effect
export async function getRoomMembers(roomId) {
  const { data, error } = await supabase
    .from('room_members')
    .select(`
      id,
      status,
      user_id,
      profiles (id, username, equipped_color, equipped_effect)
    `)
    .eq('room_id', roomId);

  if (error) throw error;
  return data;
}

// 7. Check if user is actively in a waiting room
export async function getActiveRoomForUser(userId) {
  const { data: hostedRoom } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('host_id', userId)
    .eq('status', 'waiting')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (hostedRoom) return hostedRoom;

  const { data: membership } = await supabase
    .from('room_members')
    .select('room_id, status, game_rooms(*)')
    .eq('user_id', userId)
    .in('status', ['accepted', 'pending'])
    .limit(1)
    .maybeSingle();

  if (membership?.game_rooms && membership.game_rooms.status === 'waiting') {
    return membership.game_rooms;
  }

  return null;
}

// 8. Leave Party or Disband Room
export async function leaveOrDisbandRoom(roomId, userId, isHost) {
  if (isHost) {
    await supabase
      .from('game_rooms')
      .delete()
      .eq('id', roomId);
  } else {
    await supabase
      .from('room_members')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', userId);
  }
}

// 9. Cancel a pending join request while in the browser
export async function cancelPendingRequest(userId) {
  await supabase
    .from('room_members')
    .delete()
    .eq('user_id', userId)
    .eq('status', 'pending');
}

// 10. Realtime Subscription
export function subscribeToRoom(roomId, onMemberChange, onRoomChange) {
  const channel = supabase
    .channel(`room:${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` },
      (payload) => onMemberChange(payload)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` },
      (payload) => onRoomChange(payload)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
