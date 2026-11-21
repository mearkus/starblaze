/** XP curve: early levels come fast, later levels take longer. */
export function xpToNext(level: number): number {
  return Math.round(8 + 6 * level + 0.8 * level * level);
}

/** Applies gained XP, returning how many level-ups happened and the leftover XP. */
export function addXp(level: number, xp: number, gained: number): { level: number; xp: number; levelsGained: number } {
  xp += gained;
  let levelsGained = 0;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level++;
    levelsGained++;
  }
  return { level, xp, levelsGained };
}

/** Credits awarded at the end of a run. */
export function creditsForRun(score: number, wavesCleared: number, bossesKilled: number, creditMul: number): number {
  return Math.floor((score * 0.02 + wavesCleared * 25 + bossesKilled * 150) * creditMul);
}

/** Combo multiplier from the current kill chain. */
export function comboMultiplier(combo: number): number {
  return Math.min(8, 1 + Math.floor(combo / 10) * 0.5);
}
