import { spawn } from "node:child_process";
import { env, platform } from "node:process";

function resolveCargoPaths(): string {
  const separator = platform === "win32" ? ";" : ":";
  const existing = (env.PATH ?? "").split(separator).filter(Boolean);
  const additions = new Set<string>();

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

  return [...additions, ...existing].join(separator);
}

const [, , command = "dev"] = process.argv;
const tauriArgs = command === "build" ? ["build"] : ["dev"];

const updatedEnv = {
  ...env,
  PATH: resolveCargoPaths(),
};

const child =
  platform === "win32"
    ? spawn(env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `tauri ${tauriArgs.join(" ")}`], {
        stdio: "inherit",
        shell: false,
        env: updatedEnv,
      })
    : spawn("tauri", tauriArgs, {
        stdio: "inherit",
        shell: false,
        env: updatedEnv,
      });

child.on("error", (error) => {
  console.error(`Failed to start Tauri CLI: ${error.message}`);
  process.exit(1);
});

child.on("close", (code) => {
  process.exit(code ?? 1);
});