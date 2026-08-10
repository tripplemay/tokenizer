import { hostname, platform } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { configure, ensureDevice, readConfig, readDevice, writeCredentials, writeDevice } from "./config";
import { agentFetch } from "./fetch";

function defaultDeviceName() {
  return hostname().replace(/\.local$/i, "") || "Tokenizer Device";
}

async function resolveDeviceName(options: { deviceName?: string; yes?: boolean }) {
  if (options.deviceName?.trim()) return options.deviceName.trim();
  const detected = defaultDeviceName();
  if (options.yes || !process.stdin.isTTY) return detected;
  const rl = createInterface({ input, output });
  try {
    const useDefault = (await rl.question(`Detected device name: ${detected}\nUse this name? [Y/n]: `)).trim().toLowerCase();
    if (!useDefault || useDefault === "y" || useDefault === "yes") return detected;
    const custom = (await rl.question("Enter device name: ")).trim();
    return custom || detected;
  } finally {
    rl.close();
  }
}

export async function enrollDevice(options: { enrollToken: string; serverUrl?: string; deviceName?: string; yes?: boolean }) {
  if (options.serverUrl) configure({ serverUrl: options.serverUrl });
  const config = readConfig();
  ensureDevice();
  const current = readDevice();
  const name = await resolveDeviceName(options);
  const device = { ...current, name, hostname: hostname(), platform: platform(), metadata: { ...(current.metadata as object), enrolledAt: new Date().toISOString() } };
  writeDevice(device);

  // agentFetch 的直连/代理自愈与 enroll 同样相关：首装环境经常带着尚未
  // 生效或刚关掉的代理，全局 fetch 在这里失败会直接终止 onboarding。
  const response = await agentFetch(`${config.serverUrl.replace(/\/+$/, "")}/api/devices/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enrollToken: options.enrollToken, device })
  });
  if (!response.ok) throw new Error(`Enroll failed: ${response.status} ${await response.text()}`);
  const result = (await response.json()) as { deviceToken: string };
  writeCredentials({ deviceToken: result.deviceToken });
  return { device };
}
