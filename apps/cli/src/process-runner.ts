import { spawn } from "node:child_process";

export interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessRunner {
  run(
    command: string,
    args: readonly string[],
    options?: { readonly environment?: NodeJS.ProcessEnv; readonly quiet?: boolean },
  ): Promise<ProcessResult>;
}

export function createProcessRunner(): ProcessRunner {
  return {
    run(command, args, options = {}) {
      return new Promise((resolve, reject) => {
        const quiet = options.quiet ?? false;
        const child = spawn(command, [...args], {
          stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
          env: options.environment ?? process.env,
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        if (quiet) {
          child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
          child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        }
        child.once("error", reject);
        child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      });
    },
  };
}

export async function requireSuccess(
  runner: ProcessRunner,
  command: string,
  args: readonly string[],
  options?: { readonly environment?: NodeJS.ProcessEnv; readonly quiet?: boolean },
): Promise<ProcessResult> {
  const result = await runner.run(command, args, options);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.code}${detail ? `: ${detail}` : ""}`);
  }
  return result;
}
