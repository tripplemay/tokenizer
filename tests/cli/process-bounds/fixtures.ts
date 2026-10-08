import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function makeGitShim(root: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const script = fileURLToPath(new URL("../../fixtures/process-bounds/git-shim.mjs", import.meta.url));
  const result = { ...env, PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${env.PATH}`, PB_NODE: process.execPath, PB_GIT_SCRIPT: script };
  if (process.platform === "win32") {
    const csc = join(env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    if (!existsSync(csc)) throw new Error("Windows executable fixture requires the native .NET C# compiler");
    execFileSync(csc, ["/nologo", "/target:exe", `/out:${join(bin, "git.exe")}`,
      fileURLToPath(new URL("../../fixtures/process-bounds/windows-git-shim.cs", import.meta.url))], {
      env, timeout: 10_000, killSignal: "SIGKILL", stdio: "pipe"
    });
  } else {
    const executable = join(bin, "git");
    copyFileSync(script, executable);
    writeFileSync(executable, `#!${process.execPath}\n${readFileSync(executable, "utf8")}`);
    chmodSync(executable, 0o755);
  }
  return result;
}
