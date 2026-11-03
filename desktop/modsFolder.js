// Where BeamNG.drive keeps mods on this machine, if it is installed: its
// user folder's current/mods (Windows; Linux native; Linux under Steam's
// Proton). Null when none exists: the app asks once.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STEAM_APP_ID = '284160';

export function modsFolderCandidates(platform = process.platform, env = process.env, home = os.homedir()) {
  const user = (base) => path.join(base, 'BeamNG', 'BeamNG.drive', 'current', 'mods');
  if (platform === 'win32') {
    return [env.LOCALAPPDATA && user(env.LOCALAPPDATA)].filter(Boolean);
  }
  const proton = (steam) => user(path.join(steam, 'steamapps', 'compatdata', STEAM_APP_ID, 'pfx', 'drive_c', 'users', 'steamuser', 'AppData', 'Local'));
  return [
    user(path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'))),
    proton(path.join(home, '.steam', 'steam')),
    proton(path.join(home, '.local', 'share', 'Steam')),
  ];
}

export function findModsFolder() {
  return modsFolderCandidates().find((dir) => fs.existsSync(dir)) || null;
}
