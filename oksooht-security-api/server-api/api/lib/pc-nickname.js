// 관리자가 설정한 PC 별명 — 클라이언트 하트비트로 덮어쓰지 않도록 MAC 목록으로 보호
const LOCK_KEY = 'pc_nickname_locked_macs';

async function loadLockedMacs(supabase) {
  const { data } = await supabase.from('settings').select('value').eq('key', LOCK_KEY).single();
  if (!data?.value) return new Set();
  try {
    const arr = JSON.parse(data.value);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (_) {
    return new Set();
  }
}

async function saveLockedMacs(supabase, locked) {
  await supabase.from('settings').upsert(
    { key: LOCK_KEY, value: JSON.stringify([...locked]) },
    { onConflict: 'key' }
  );
}

async function lockMac(supabase, mac) {
  const locked = await loadLockedMacs(supabase);
  locked.add(mac);
  await saveLockedMacs(supabase, locked);
}

async function unlockMac(supabase, mac) {
  const locked = await loadLockedMacs(supabase);
  locked.delete(mac);
  await saveLockedMacs(supabase, locked);
}

async function isMacLocked(supabase, mac) {
  return (await loadLockedMacs(supabase)).has(mac);
}

async function resolveUsernameForUpsert(supabase, mac_address, clientUsername) {
  if (!(await isMacLocked(supabase, mac_address))) return clientUsername;
  const { data } = await supabase.from('pcs').select('username').eq('mac_address', mac_address).single();
  return data?.username ?? clientUsername;
}

async function updatePcNickname(supabase, mac_address, username) {
  const trimmed = String(username ?? '').trim();
  if (trimmed.length > 64) throw new Error('별명은 64자 이하여야 합니다.');

  const { data: pc, error: findErr } = await supabase
    .from('pcs')
    .select('id')
    .eq('mac_address', mac_address)
    .single();
  if (findErr || !pc) throw new Error('PC를 찾을 수 없습니다.');

  if (trimmed) {
    const { error } = await supabase.from('pcs').update({ username: trimmed }).eq('mac_address', mac_address);
    if (error) throw error;
    await lockMac(supabase, mac_address);
  } else {
    const { error } = await supabase.from('pcs').update({ username: null }).eq('mac_address', mac_address);
    if (error) throw error;
    await unlockMac(supabase, mac_address);
  }

  return trimmed;
}

module.exports = {
  loadLockedMacs,
  lockMac,
  unlockMac,
  isMacLocked,
  resolveUsernameForUpsert,
  updatePcNickname
};
