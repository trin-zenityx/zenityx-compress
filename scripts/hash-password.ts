// scripts/hash-password.ts
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hashPassword } from "../src/auth/password.js";

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const password = await rl.question("Enter new password: ");
  rl.close();
  if (!password || password.length < 8) {
    console.error("Password must be at least 8 characters");
    process.exit(1);
  }
  const hash = await hashPassword(password);
  console.log("");
  console.log("Copy this into .env as AUTH_PASSWORD_HASH:");
  console.log(hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
