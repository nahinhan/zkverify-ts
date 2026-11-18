import path from "path";
import crypto from "crypto";
import { concat, keccak256, numberToHex } from "viem";
// @ts-expect-error snarkjs has no official bundled types
import * as snarkjs from "snarkjs";
import { evaluatePolicy, STRATEGY_PARAMS, VfyAction } from "./strategy";

const WASM_PATH = path.resolve(process.cwd(), "circuits/vfy-policy.wasm");
const ZKEY_PATH = path.resolve(process.cwd(), "circuits/vfy-policy_final.zkey");

export interface StealVfyEnvelope {
  protocolVersion: string;
  eventId: string;
  mode: string;
  matchId: string;
  turn: number;
  issuedAt: string;
  deadlineAt: string;
  state: {
    selfBalance: string;
    opponentBalance: string;
    selfFortifiedUntilTurn: number | null;
    opponentFortifiedUntilTurn: number | null;
  };
  strategyCommitment: { hash: string };
  resolverVersion: string;
  nonce: string;
}

export function computePublicInputsHash(params: {
  commitment: string;
  matchId: string;
  turn: number;
  selfBalance: string | number | bigint;
  opponentBalance: string | number | bigint;
  actionType: "HOLD" | "FORTIFY" | "EXTRACT";
  amount: number;
}): `0x${string}` {
  const actionMap = { HOLD: 0n, FORTIFY: 1n, EXTRACT: 2n } as const;
  const cleanMatchIdHex = ("0x" + params.matchId.replace(/-/g, "")) as `0x${string}`;

  return keccak256(
    concat([
      numberToHex(BigInt(params.commitment), { size: 32 }),
      numberToHex(BigInt(cleanMatchIdHex), { size: 32 }),
      numberToHex(BigInt(params.turn), { size: 32 }),
      numberToHex(BigInt(params.selfBalance), { size: 32 }),
      numberToHex(BigInt(params.opponentBalance), { size: 32 }),
      numberToHex(actionMap[params.actionType], { size: 32 }),
      numberToHex(BigInt(params.actionType === "EXTRACT" ? params.amount : 0), { size: 32 }),
      numberToHex(1n, { size: 32 }),
    ])
  );
}

export async function handleStealVfyTurn(envelope: StealVfyEnvelope) {
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(`${envelope.matchId}:${envelope.turn}:${envelope.nonce}`)
    .digest("hex");

  let chosenAction: VfyAction = { type: "HOLD" };

  try {
    chosenAction = evaluatePolicy(
      {
        selfBalance: Number(envelope.state.selfBalance),
        opponentBalance: Number(envelope.state.opponentBalance),
        selfFortifiedUntilTurn: envelope.state.selfFortifiedUntilTurn,
        opponentFortifiedUntilTurn: envelope.state.opponentFortifiedUntilTurn,
        turn: envelope.turn,
      },
      STRATEGY_PARAMS
    );
  } catch {
    chosenAction = { type: "HOLD" };
  }

  const numericAmount = chosenAction.type === "EXTRACT" ? chosenAction.amount : 0;
  const actionCode = chosenAction.type === "HOLD" ? 0 : chosenAction.type === "FORTIFY" ? 1 : 2;

  const publicInputsHash = computePublicInputsHash({
    commitment: envelope.strategyCommitment.hash,
    matchId: envelope.matchId,
    turn: envelope.turn,
    selfBalance: envelope.state.selfBalance,
    opponentBalance: envelope.state.opponentBalance,
    actionType: chosenAction.type,
    amount: numericAmount,
  });

  const saltBigInt = process.env.STRATEGY_SALT ? BigInt(process.env.STRATEGY_SALT) : 0n;

  const circuitInputs = {
    commitment: BigInt(envelope.strategyCommitment.hash).toString(),
    turn: envelope.turn.toString(),
    selfBalance: BigInt(envelope.state.selfBalance).toString(),
    opponentBalance: BigInt(envelope.state.opponentBalance).toString(),
    selfFortifiedUntilTurn: (envelope.state.selfFortifiedUntilTurn ?? 0).toString(),
    opponentFortifiedUntilTurn: (envelope.state.opponentFortifiedUntilTurn ?? 0).toString(),
    action: actionCode.toString(),
    amount: numericAmount.toString(),
    salt: saltBigInt.toString(),
    param1: STRATEGY_PARAMS.param1.toString(),
    param2: STRATEGY_PARAMS.param2.toString(),
    param3: STRATEGY_PARAMS.param3.toString(),
    param4: STRATEGY_PARAMS.param4.toString(),
  };

  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      WASM_PATH,
      ZKEY_PATH
    );

    const formattedAction =
      chosenAction.type === "EXTRACT"
        ? { type: "EXTRACT", amount: chosenAction.amount }
        : { type: chosenAction.type };

    return {
      matchId: envelope.matchId,
      turn: envelope.turn,
      action: formattedAction,
      policyProof: {
        circuitVersion: "v1",
        proof,
        public_signals: publicSignals,
        publicInputsHash,
      },
      agentTimestamp: new Date().toISOString(),
      idempotencyKey,
    };
  } catch (err) {
    console.error("[StealTheVFY] Proof generation failed:", err instanceof Error ? err.message : "unknown");
    return {
      matchId: envelope.matchId,
      turn: envelope.turn,
      action: { type: "HOLD" },
      policyProof: {
        circuitVersion: "v1",
        proof: {},
        public_signals: [],
        publicInputsHash,
      },
      agentTimestamp: new Date().toISOString(),
      idempotencyKey,
    };
  }
}