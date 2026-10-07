import { MdRocketLaunch } from "react-icons/md";
import Link from "next/link";
import Card from "@/components/card";
import { EnrollFlowCard } from "./enroll-flow-card";

type OnboardingLabels = {
  title: string;
  description: string;
  waitingTitle: string;
  waitingDescription: string;
  devicesLink: string;
  steps: { title: string; desc: string }[];
};

export function OnboardingCard({ deviceName, labels }: { deviceName: string | null; labels: OnboardingLabels }) {
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
            <h2 className="text-2xl font-bold text-navy-700 dark:text-white">{deviceName ? labels.waitingTitle : labels.title}</h2>
            <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
              {deviceName ? labels.waitingDescription : labels.description}
            </p>
          </div>
        </div>
      </div>

      {deviceName ? (
        <div className="px-8 py-6">
          <Link href="/devices" className="text-sm font-medium text-brand-500 hover:underline">{labels.devicesLink}</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 px-8 py-6 lg:grid-cols-[1fr_2fr]">
          <ol className="space-y-3 text-sm">
            {labels.steps.map((step, index) => <Step key={step.title} n={index + 1} {...step} />)}
          </ol>
          <div>
            <EnrollFlowCard />
          </div>
        </div>
      )}
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
