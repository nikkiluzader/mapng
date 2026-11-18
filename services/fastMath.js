// fastHypot(x, y[, z]): the length of a 2D or 3D vector, Math.sqrt(x*x + y*y [+ z*z]).
//
// Math.hypot does the same but guards against overflow and underflow (scaling every argument by the largest), and
// takes any number of arguments: in V8 that made it about five times slower than the plain square root and the
// export's biggest single source of garbage (a dense 8 km city: ~12 % of all it allocated; scratch/memprobe,
// 2026-11-18). MapNG's lengths are metres and degrees, far from either limit. The two differ only in the last bit
// of the result (about a third of the time), a trillionth of a metre.
export function fastHypot(x, y, z) {
  return z === undefined ? Math.sqrt(x * x + y * y) : Math.sqrt(x * x + y * y + z * z);
}
