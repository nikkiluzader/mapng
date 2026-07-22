export const FPV_MOVE_SPEED_METERS_PER_SECOND = 12;
export const FPV_FAST_MULTIPLIER = 4;
export const FPV_MOUSE_SENSITIVITY = 0.0018;
export const FPV_EYE_HEIGHT_METERS = 2;

const MIN_PITCH = -(Math.PI / 2) + 0.02;
const MAX_PITCH = (Math.PI / 2) - 0.02;
const CONTROL_KEYS = new Set(['w', 'a', 's', 'd', 'shift']);

export const isFpvControlKey = (key) => CONTROL_KEYS.has(String(key || '').toLowerCase());

export const clampFpvPitch = (pitch) => Math.min(MAX_PITCH, Math.max(MIN_PITCH, pitch));

export const getFpvMovement = (pressedKeys, deltaSeconds) => {
  const keys = pressedKeys instanceof Set ? pressedKeys : new Set();
  const safeDelta = Math.min(0.1, Math.max(0, Number(deltaSeconds) || 0));
  const multiplier = keys.has('shift') ? FPV_FAST_MULTIPLIER : 1;
  const distance = FPV_MOVE_SPEED_METERS_PER_SECOND * multiplier * safeDelta;

  return {
    forward: (keys.has('w') ? distance : 0) - (keys.has('s') ? distance : 0),
    right: (keys.has('d') ? distance : 0) - (keys.has('a') ? distance : 0),
  };
};
