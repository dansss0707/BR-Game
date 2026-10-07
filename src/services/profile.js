import { supabase } from './supabase.js';

export const ROLL_COST = 50;

// Drop table with rarity tiers and drop weights
export const NAME_COLORS = [
  { id: 'color_white', name: 'Standard White', color: '#e0e6ed', glow: 'none', rarity: 'Common', weight: 45 },
  { id: 'color_neon_cyan', name: 'Electric Cyan', color: '#00f0ff', glow: '0 0 6px rgba(0, 240, 255, 0.7)', rarity: 'Rare', weight: 25 },
  { id: 'color_toxic_lime', name: 'Toxic Lime', color: '#39ff14', glow: '0 0 6px rgba(57, 255, 20, 0.7)', rarity: 'Rare', weight: 15 },
  { id: 'color_void_purple', name: 'Void Purple', color: '#b026ff', glow: '0 0 8px rgba(176, 38, 255, 0.8)', rarity: 'Epic', weight: 10 },
  { id: 'color_solar_gold', name: 'Solar Gold', color: '#ffd700', glow: '0 0 10px rgba(255, 215, 0, 0.9)', rarity: 'Legendary', weight: 4 },
  { id: 'color_crimson_curse', name: 'Crimson Glitch', color: '#ff003c', glow: '0 0 12px rgba(255, 0, 60, 1)', rarity: 'Mythic', weight: 1 }
];

export const AURA_EFFECTS = [
  { id: 'effect_none', name: 'Clean', type: 'none', rarity: 'Common', weight: 40 },
  { id: 'effect_dust', name: 'Mote Drift', type: 'dust', color: '#00f0ff', rarity: 'Rare', weight: 30 },
  { id: 'effect_sparks', name: 'Micro Sparks', type: 'sparks', color: '#ffd700', rarity: 'Epic', weight: 20 },
  { id: 'effect_embers', name: 'Cinder Glow', type: 'embers', color: '#ff3b30', rarity: 'Legendary', weight: 8 },
  { id: 'effect_void_orbit', name: 'Void Orbiters', type: 'orbit', color: '#b026ff', rarity: 'Mythic', weight: 2 }
];

// Helper to pick from weighted table
function pickWeighted(pool) {
  const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const item of pool) {
    if (rand < item.weight) return item;
    rand -= item.weight;
  }
  return pool[0];
}

// Fetch player profile
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

// Roll for Name Color
export async function rollNameColor(userId) {
  const profile = await getProfile(userId);
  if (!profile || (profile.coins ?? 0) < ROLL_COST) {
    throw new Error(`Need at least ${ROLL_COST} coins to roll!`);
  }

  const rolled = pickWeighted(NAME_COLORS);
  const newCoins = profile.coins - ROLL_COST;

  const { data, error } = await supabase
    .from('profiles')
    .update({
      coins: newCoins,
      equipped_color: rolled.id
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return { updatedProfile: data, item: rolled };
}

// Roll for Aura Effect
export async function rollAuraEffect(userId) {
  const profile = await getProfile(userId);
  if (!profile || (profile.coins ?? 0) < ROLL_COST) {
    throw new Error(`Need at least ${ROLL_COST} coins to roll!`);
  }

  const rolled = pickWeighted(AURA_EFFECTS);
  const newCoins = profile.coins - ROLL_COST;

  const { data, error } = await supabase
    .from('profiles')
    .update({
      coins: newCoins,
      equipped_effect: rolled.id
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return { updatedProfile: data, item: rolled };
}

// Crate opener (rewards either a random color or a random aura effect)
export async function openCrate(userId) {
  const CRATE_COST = 100;
  const profile = await getProfile(userId);
  if (!profile || (profile.coins ?? 0) < CRATE_COST) {
    throw new Error(`Need at least ${CRATE_COST} coins to open a crate!`);
  }

  const isColor = Math.random() < 0.5;
  const pool = isColor ? NAME_COLORS : AURA_EFFECTS;
  const wonItem = pickWeighted(pool);
  const newCoins = profile.coins - CRATE_COST;

  const updates = {
    coins: newCoins
  };

  if (isColor) {
    updates.equipped_color = wonItem.id;
  } else {
    updates.equipped_effect = wonItem.id;
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return { updatedProfile: data, wonItem: { ...wonItem, itemType: isColor ? 'color' : 'effect' } };
}

// Backwards compatibility exports
export const SKINS_CATALOG = [];