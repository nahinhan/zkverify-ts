import "dotenv/config";
// @ts-expect-error circomlibjs has no official bundled types
import { buildPoseidon } from "circomlibjs";
import { STRATEGY_PARAMS } from "../strategy";

async function main() {
  const saltRaw = process.env.STRATEGY_SALT;
  if (!saltRaw) {
    console.error("ERROR: Variabel STRATEGY_SALT belum diisi di file .env");
    process.exit(1);
  }

  const poseidon = await buildPoseidon();
  const inputs = [
    STRATEGY_PARAMS.param1,
    STRATEGY_PARAMS.param2,
    STRATEGY_PARAMS.param3,
    STRATEGY_PARAMS.param4,
    BigInt(saltRaw),
  ];

  const hashField = poseidon(inputs);
  const hashDec = poseidon.F.toString(hashField, 10);
  const hashHex = "0x" + BigInt(hashDec).toString(16).padStart(64, "0");

  console.log("=== STRATEGY COMMITMENT HASH ===");
  console.log("Decimal :", hashDec);
  console.log("Hex     :", hashHex);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});