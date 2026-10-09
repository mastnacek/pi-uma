/**
 * Thin re-export so the muscle slice stays self-contained: the actual dialog
 * lives in src/shared/muscle_dialog.ts (shared code, reachable by commands too).
 */

export { confirmMuscleExecution as confirmExecution } from "../../shared/muscle_dialog.js";
