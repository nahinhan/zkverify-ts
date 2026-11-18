export interface GameState {
  selfBalance: number;
  opponentBalance: number;
  selfFortifiedUntilTurn: number | null;
  opponentFortifiedUntilTurn: number | null;
  turn: number;
}

export type VfyAction =
  | { type: "HOLD" }
  | { type: "FORTIFY" }
  | { type: "EXTRACT"; amount: number };

// TODO: Isi parameter strategi kompetitif Anda di sini sebelum menjalankan `npm run commit:strategy`.
export const STRATEGY_PARAMS = {
  param1: 0n,
  param2: 0n,
  param3: 0n,
  param4: 0n,
};

export function evaluatePolicy(state: GameState, params: typeof STRATEGY_PARAMS): VfyAction {
  // TODO: Ganti logika di bawah ini agar sesuai 100% dengan sirkuit vfy-policy.wasm dan STRATEGY_PARAMS Anda.
  void state;
  void params;
  return { type: "HOLD" };
}