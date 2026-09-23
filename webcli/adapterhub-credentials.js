import { spawn } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";

const DEFAULT_FILE = join(homedir(), ".webcli", "credentials", "adapterhub-token.dpapi");

export function credentialFile() {
  return process.env.WEBCLI_ADAPTERHUB_CREDENTIAL_FILE || DEFAULT_FILE;
}

function runPowerShell(script, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script,
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Windows DPAPI 操作失败: ${Buffer.concat(stderr).toString("utf8").trim() || `exit ${code}`}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
    child.stdin.end(input, "utf8");
  });
}

const PROTECT_SCRIPT = [
  "Add-Type -AssemblyName System.Security",
  "$plain=[Console]::In.ReadToEnd()",
  "$bytes=[Text.Encoding]::UTF8.GetBytes($plain)",
  "$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($protected))",
].join(";");

const UNPROTECT_SCRIPT = [
  "Add-Type -AssemblyName System.Security",
  "$encoded=[Console]::In.ReadToEnd().Trim()",
  "$protected=[Convert]::FromBase64String($encoded)",
  "$bytes=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))",
].join(";");

export async function saveAdapterHubToken(token) {
  const normalized = String(token || "").trim();
  if (!/^ahp_[A-Za-z0-9_-]{16,}$/.test(normalized)) {
    throw new Error("AdapterHub PAT 格式无效，应以 ahp_ 开头。");
  }
  if (process.platform !== "win32") {
    throw new Error("当前安全凭据初始化仅支持 Windows DPAPI；其他平台请临时使用 ADAPTERHUB_TOKEN。");
  }
  const encrypted = await runPowerShell(PROTECT_SCRIPT, normalized);
  const file = credentialFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${encrypted}\n`, { encoding: "utf8", mode: 0o600 });
  return file;
}

export async function loadAdapterHubToken() {
  const envToken = String(process.env.ADAPTERHUB_TOKEN || "").trim();
  if (envToken) return { token: envToken, source: "environment" };
  const file = credentialFile();
  if (!existsSync(file)) return { token: "", source: "none" };
  if (process.platform !== "win32") return { token: "", source: "unsupported" };
  const encrypted = (await readFile(file, "utf8")).trim();
  if (!encrypted) return { token: "", source: "none" };
  const token = (await runPowerShell(UNPROTECT_SCRIPT, encrypted)).trim();
  return { token, source: "windows-dpapi" };
}

export async function removeAdapterHubToken() {
  const file = credentialFile();
  const existed = existsSync(file);
  await rm(file, { force: true });
  return existed;
}

export async function adapterHubCredentialStatus() {
  if (String(process.env.ADAPTERHUB_TOKEN || "").trim()) return { configured: true, source: "environment" };
  const file = credentialFile();
  return { configured: existsSync(file), source: existsSync(file) ? "windows-dpapi" : "none" };
}

export async function readHiddenToken(prompt = "AdapterHub PAT: ") {
  if (!process.stdin.isTTY || !process.stderr.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("init 需要交互式终端；请在本机终端运行 webcli adapterhub init。");
  }
  process.stderr.write(prompt);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error); else resolve(value.trim());
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") return finish(new Error("已取消。"));
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}
