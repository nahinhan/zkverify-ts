import path from "path";
// @ts-expect-error snarkjs has no official bundled types
import * as snarkjs from "snarkjs";

const GATEKEEPER_VK_HASH = "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
const WASM_PATH = path.resolve(process.cwd(), "circuits/gatekeeper.wasm");
const ZKEY_PATH = path.resolve(process.cwd(), "circuits/gatekeeper_final.zkey");
const KURIER_API_URL = "https://api.kurier.xyz/api/v1";

const usedProofRefs = new Set<string>();

export interface GatekeeperInput {
  registered_vk: string;
  proof_vk: string;
  minimum: string | number;
  public_balance: string | number;
  expiry_block: string | number;
  current_block: string | number;
  recipient: string;
  condition_recipient: string;
  amount: string | number;
  max_transfer: string | number;
  proof_tx: string;
}

export interface GatekeeperTask {
  type: string;
  task_id: string;
  mode?: string;
  issued_at?: string;
  deadline_at?: string;
  input: GatekeeperInput;
}

function evaluateSecurityRules(input: GatekeeperInput): { valid: boolean; reasonCode: string } {
  if (!input || typeof input !== "object") {
    return { valid: false, reasonCode: "MALFORMED_INPUT" };
  }

  if (!input.registered_vk || !input.proof_vk || input.registered_vk.toLowerCase() !== input.proof_vk.toLowerCase()) {
    return { valid: false, reasonCode: "VK_SUBSTITUTION" };
  }

  if (!input.proof_tx || usedProofRefs.has(input.proof_tx.toLowerCase())) {
    return { valid: false, reasonCode: "PROOF_REPLAY" };
  }

  if (
    !input.recipient ||
    !input.condition_recipient ||
    input.recipient.toLowerCase() !== input.condition_recipient.toLowerCase()
  ) {
    return { valid: false, reasonCode: "RECIPIENT_MISMATCH" };
  }

  try {
    const balance = BigInt(input.public_balance);
    const minimum = BigInt(input.minimum);
    const currentBlock = BigInt(input.current_block);
    const expiryBlock = BigInt(input.expiry_block);
    const amount = BigInt(input.amount);
    const maxTransfer = BigInt(input.max_transfer);

    if (balance < minimum) {
      return { valid: false, reasonCode: "INSUFFICIENT_BALANCE" };
    }

    if (currentBlock > expiryBlock) {
      return { valid: false, reasonCode: "EXPIRED_PROOF" };
    }

    if (amount <= 0n || amount > maxTransfer || amount > balance) {
      return { valid: false, reasonCode: "AMOUNT_EXCEEDS_LIMIT" };
    }
  } catch {
    return { valid: false, reasonCode: "INVALID_NUMERIC_FIELD" };
  }

  return { valid: true, reasonCode: "VALID_REQUEST" };
}

async function submitToKurierAndAwaitFinalized(proof: unknown, publicSignals: string[]): Promise<string | null> {
  const apiKey = process.env.KURIER_API_KEY;
  if (!apiKey) return null;

  const submitRes = await fetch(`${KURIER_API_URL}/submit-proof/${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      proofType: "groth16",
      vkRegistered: true,
      proofOptions: { library: "snarkjs", curve: "bn128" },
      proofData: {
        proof,
        publicSignals,
        vk: GATEKEEPER_VK_HASH,
      },
    }),
  });

  if (!submitRes.ok) return null;
  const job = (await submitRes.json()) as { jobId?: string; txHash?: string };
  if (!job.jobId) return job.txHash ?? null;

  const start = Date.now();
  while (Date.now() - start < 42_000) {
    await new Promise((r) => setTimeout(r, 2_500));
    const statusRes = await fetch(`${KURIER_API_URL}/job-status/${apiKey}/${job.jobId}`);
    if (!statusRes.ok) continue;
    const statusData = (await statusRes.json()) as { status?: string; txHash?: string };
    if (statusData.status === "Finalized") {
      return statusData.txHash ?? job.jobId;
    }
    if (statusData.status === "Failed") {
      return null;
    }
  }
  return null;
}

export async function handleGatekeeperTask(task: GatekeeperTask) {
  if (task.deadline_at && Date.now() > Date.parse(task.deadline_at)) {
    return {
      decision: "REJECT",
      reason_code: "DEADLINE_EXCEEDED",
      proof_tx: task.input?.proof_tx ?? "",
    };
  }

  const check = evaluateSecurityRules(task.input);

  const circuitInputs = {
    registered_vk: BigInt(task.input.registered_vk).toString(),
    proof_vk: BigInt(task.input.proof_vk).toString(),
    minimum: BigInt(task.input.minimum).toString(),
    public_balance: BigInt(task.input.public_balance).toString(),
    expiry_block: BigInt(task.input.expiry_block).toString(),
    current_block: BigInt(task.input.current_block).toString(),
    recipient: BigInt(task.input.recipient).toString(),
    condition_recipient: BigInt(task.input.condition_recipient).toString(),
    amount: BigInt(task.input.amount).toString(),
    max_transfer: BigInt(task.input.max_transfer).toString(),
  };

  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      WASM_PATH,
      ZKEY_PATH
    );

    let finalizedTx = task.input.proof_tx;

    if (check.valid && process.env.KURIER_API_KEY) {
      const kurierTx = await submitToKurierAndAwaitFinalized(proof, publicSignals);
      if (!kurierTx) {
        return {
          decision: "REJECT",
          reason_code: "VERIFICATION_NOT_FINALIZED",
          proof_tx: task.input.proof_tx,
          proof,
          public_signals: publicSignals,
        };
      }
      finalizedTx = kurierTx;
    }

    if (check.valid) {
      usedProofRefs.add(task.input.proof_tx.toLowerCase());
      return {
        decision: "APPROVE",
        reason_code: check.reasonCode,
        proof_tx: finalizedTx,
        proof,
        public_signals: publicSignals,
      };
    }

    return {
      decision: "REJECT",
      reason_code: check.reasonCode,
      proof_tx: task.input.proof_tx,
      proof,
      public_signals: publicSignals,
    };
  } catch (err) {
    console.error("[Gatekeeper] Proof generation error:", err instanceof Error ? err.message : "unknown");
    return {
      decision: "REJECT",
      reason_code: check.valid ? "PROOF_GENERATION_FAILED" : check.reasonCode,
      proof_tx: task.input?.proof_tx ?? "",
    };
  }
}