// BL-AGENT-LATENCY F001：crontab 内容生成纯函数。cron fallback 主机没有常驻
// daemon，闸门中继延迟完全由 harness 条目的周期决定——run 条目保持用户的
// syncMinutes，harness 条目固定 2 分钟（健康快照已落 state.json 并随 heartbeat
// 上行，stdout 直接丢弃避免 agent.log 膨胀）。
// 过滤锚定 binPath 而非裸 "tokenizer"，避免误伤用户自有 cron 行，同时能一次
// 清掉旧版单条目与新版双条目，保证升级/卸载幂等。

export const HARNESS_CRON_MINUTES = 2;

export interface CronOptions {
  binPath: string;
  logPath: string;
  syncMinutes: number;
}

function userRows(current: string, binPath: string): string[] {
  return current.split(/\r?\n/).filter((row) => row && !row.includes(binPath));
}

export function tokenizerCronLines(options: CronOptions): string[] {
  return [
    `*/${Math.max(1, options.syncMinutes)} * * * * ${options.binPath} run >> ${options.logPath} 2>&1`,
    `*/${HARNESS_CRON_MINUTES} * * * * ${options.binPath} harness --json >/dev/null 2>> ${options.logPath}`
  ];
}

/** 安装/升级：保留用户行，tokenizer 条目重建为恰好两条（幂等） */
export function buildCronInstall(current: string, options: CronOptions): string {
  const rows = [...userRows(current, options.binPath), ...tokenizerCronLines(options)];
  return `${rows.join("\n")}\n`;
}

/** 卸载：仅保留用户行 */
export function buildCronUninstall(current: string, binPath: string): string {
  return `${userRows(current, binPath).join("\n")}\n`;
}
