import { MdRocketLaunch } from "react-icons/md";
import Card from "@/components/card";
import { EnrollFlowCard } from "./enroll-flow-card";

// Replaces the empty home dashboard for a fresh account. Gives the user
// somewhere to land instead of a wall of zeros, and a single button that
// kicks off the entire connect-your-first-machine flow inline.
export function OnboardingCard() {
  return (
    <Card extra="overflow-hidden p-0">
      <div className="relative border-b border-gray-200 bg-gradient-to-br from-brand-500/10 via-white to-brand-500/5 px-8 py-8 dark:border-white/10 dark:from-brand-500/20 dark:via-navy-800 dark:to-brand-500/5">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <span className="rounded-2xl bg-brand-500/15 p-3 text-brand-500">
            <MdRocketLaunch className="h-7 w-7" />
          </span>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-navy-700 dark:text-white">👋 欢迎使用 Tokenizer</h2>
            <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
              Tokenizer 自动追踪 Claude Code / Codex CLI / OpenCode / Aider 等开发工具的 token 用量与成本。要看到数据,先连接你的第一台机器。
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 px-8 py-6 lg:grid-cols-[1fr_2fr]">
        <ol className="space-y-3 text-sm">
          <Step n={1} title="生成安装命令" desc="点击右侧按钮,服务器签发一条仅本次有效的安装命令(30 分钟过期)。" />
          <Step n={2} title="在你的 Mac / Linux / WSL 终端粘贴" desc="安装脚本会自动检测 Node、注册设备、配置后台 agent。" />
          <Step n={3} title="等待第一次同步" desc="客户端首次上线后约 60-90 秒,数据会自动出现在 dashboard。" />
        </ol>
        <div>
          <EnrollFlowCard />
        </div>
      </div>
    </Card>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-xs font-bold text-brand-500">
        {n}
      </span>
      <div className="min-w-0">
        <div className="font-medium text-navy-700 dark:text-white">{title}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{desc}</div>
      </div>
    </li>
  );
}
