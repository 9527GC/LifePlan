export type PomodoroPhase = "work" | "rest";

const WORK_SECONDS = 25 * 60;
const REST_SECONDS = 5 * 60;
const BLOCK_SECONDS = WORK_SECONDS + REST_SECONDS;

export const formatSeconds = (seconds: number) => `${String(Math.max(0, Math.floor(seconds / 60))).padStart(2, "0")}:${String(Math.max(0, seconds % 60)).padStart(2, "0")}`;

export const getPhaseInfo = (plannedSeconds: number, elapsedSeconds: number) => {
  const elapsed = Math.max(0, Math.min(plannedSeconds, elapsedSeconds));
  const isScheduledSession = plannedSeconds >= BLOCK_SECONDS && plannedSeconds % BLOCK_SECONDS === 0;
  if (!isScheduledSession) return { phase: "work" as PomodoroPhase, remaining: Math.max(0, plannedSeconds - elapsed), total: plannedSeconds, round: 1, rounds: 1 };
  const cycleElapsed = elapsed % BLOCK_SECONDS;
  const isRest = cycleElapsed >= WORK_SECONDS;
  const total = isRest ? REST_SECONDS : WORK_SECONDS;
  const phaseElapsed = isRest ? cycleElapsed - WORK_SECONDS : cycleElapsed;
  return { phase: isRest ? "rest" as PomodoroPhase : "work" as PomodoroPhase, remaining: Math.max(0, total - phaseElapsed), total, round: Math.min(Math.floor(elapsed / BLOCK_SECONDS) + 1, plannedSeconds / BLOCK_SECONDS), rounds: plannedSeconds / BLOCK_SECONDS };
};
