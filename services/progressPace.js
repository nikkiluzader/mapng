// Overall progress for the stage card (components/ui/StageLoader.vue), Generate and Export alike: paced by time.
//
// The stages' weights are their expected seconds (services/generationProgress.js stageSeconds, exportBeamNGLevel.js
// exportPhaseWeights). Done by weights alone, two things made the bar jump:
//   - a stage weighted but never run (the ground filter on lidar): its share was jumped over when the next began;
//   - a download that overran its weight many times (OSM on a busy server, 25 s against 2 s): the bar held in that
//     stage's slice, then ran through the rest in a second.
// Here, from each stage's start, the rest of the bar is spread over the remaining time expected at this run's pace
// (seconds per unit of weight over the stages finished, from the weights as a prior; one slow download counts at
// most four times its weight): share = base + (1 - base) · t / (t + remaining), t the time since the stage began. Each stage starts where
// the last left the bar, so it never jumps, and it meets the end when the work does.
// A stage running past its expected time is taken to need about a third of the time it has run again (so a long
// wait does not peg the bar at 99 %, nor hold it still). Runs on time give the same share as the weights.

const OVERRUN_SHARE = 0.3;     // a stage past its time: this share of its time so far still to come
const MIN_PACE_WEIGHT = 0.05;
const PACE_PRIOR = 3;          // weight units of prior at one second a unit
const PACE_CAP = 4;            // a stage's seconds counted at most this many times its weight  // stages lighter than this say nothing about the pace (rounding)

/** Stage creep for silent stretches: ~85 % by the expected time, then on slowly toward 99 %. */
export const stageCreep = (t) => 0.9 * (1 - Math.exp(-2.3 * t)) + 0.09 * (1 - Math.exp(-t / 6));

/**
 * One run's pacing. update({ fine, activeStage, activeFraction, finished }) with fine the stages in order as
 * [[key, weight]...] returns { overall, stageShare }: the overall share (0..0.995, never backwards) and the running
 * stage's share (never backwards within it).
 */
export function createProgressPace({ now = () => performance.now() } = {}) {
  let base = 0;           // the overall share when the running stage began
  let stage = null;
  let stageAt = 0;
  let share = 0;
  let overall = 0;
  // this run's pace, from the weights as a prior (they are measured seconds) toward the stages finished: a few fast
  // early stages do not make the rest look nearly done, and one stage's overrun counts at most PACE_CAP times over
  let paceSecs = 0; let paceWeight = 0;
  const pace = () => Math.min(30, Math.max(0.1, (paceSecs + PACE_PRIOR) / (paceWeight + PACE_PRIOR)));
  return {
    update({ fine, activeStage, activeFraction = 0, finished = false }) {
      if (finished) { overall = 1; share = 1; return { overall, stageShare: share }; }
      const i = fine.findIndex(([k]) => k === activeStage);
      if (i < 0) return { overall, stageShare: share };
      const t = now();
      if (activeStage !== stage) {
        if (stage !== null) {
          const w0 = Math.max(0, Number(fine.find(([k]) => k === stage)?.[1]) || 0);
          if (w0 >= MIN_PACE_WEIGHT) { paceSecs += Math.min(PACE_CAP * w0, (t - stageAt) / 1000); paceWeight += w0; }
        }
        stage = activeStage; stageAt = t; share = 0; base = overall;
      }
      const p = pace();
      const w = Math.max(0, Number(fine[i][1]) || 0);
      const inStage = (t - stageAt) / 1000;
      const expected = Math.max(0.3, w * p);
      share = Math.min(1, Math.max(share, stageCreep(inStage / expected), Number(activeFraction) || 0));
      let after = 0;
      for (let j = i + 1; j < fine.length; j++) after += Math.max(0, Number(fine[j][1]) || 0);
      const left = Math.max(w * (1 - share) * p, inStage > expected ? OVERRUN_SHARE * inStage : 0) + after * p;
      const byTime = base + (1 - base) * (inStage + left > 0 ? inStage / (inStage + left) : 0);
      overall = Math.min(0.995, Math.max(overall, byTime));
      return { overall, stageShare: share };
    },
  };
}
