import { spawn } from "node:child_process";
import { env, platform } from "node:process";

function resolveCargoPaths() {
  const separator = platform === "win32" ? ";" : ":";
  const existing = (env.PATH ?? "").split(separator).filter(Boolean);
  const additions = new Set();

  if (platform === "win32") {
    if (env.USERPROFILE) {
      additions.add(`${env.USERPROFILE}\\.cargo\\bin`);
    }
    if (env.LOCALAPPDATA) {
      additions.add(`${env.LOCALAPPDATA}\\Programs\\Rust\\bin`);
    }
  } else if (env.HOME) {
    additions.add(`${env.HOME}/.cargo/bin`);
  }

  const updated = [...additions, ...existing];
  return updated.join(separator);
}

const [, , command = "dev"] = process.argv;
const tauriArgs = command === "build" ? ["build"] : ["dev"];

const updatedEnv = {
  ...env,
  PATH: resolveCargoPaths(),
};

const child = spawn("tauri", tauriArgs, {
  stdio: "inherit",
  shell: true,
  env: updatedEnv,
});

child.on("close", (code) => {
  process.exit(code ?? 0);
});
