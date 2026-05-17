import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import Card from "@/components/card";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const params = await searchParams;
  const session = await auth();
  if (session?.user) redirect(params.callbackUrl ?? "/");

  // Server action — when AUTH_RESEND_KEY isn't configured, the "resend"
  // provider isn't registered, signIn() throws, and we redirect back here
  // with ?error=Configuration so the user sees a useful message.
  async function loginAction(formData: FormData) {
    "use server";
    const email = formData.get("email");
    if (typeof email !== "string" || !email) return;
    await signIn("resend", { email, redirectTo: "/" });
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <Card extra="p-8">
        <h1 className="text-2xl font-bold text-navy-700 dark:text-white">登录 Tokenizer</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          填写邮箱,我们会发送一封登录链接邮件到你的邮箱,点击链接即可登录,无需密码。
        </p>
        {params.error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {params.error === "Configuration"
              ? "登录服务暂未配置完成,请稍后再试或联系管理员。"
              : `登录失败 (${params.error})。`}
          </div>
        ) : null}
        <form action={loginAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-gray-500">
              邮箱
            </label>
            <input
              id="email"
              type="email"
              name="email"
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-navy-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-navy-800 dark:text-white"
              placeholder="you@example.com"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-brand-500 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-600 active:scale-[0.99]"
          >
            发送登录链接
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-gray-500">
          首次使用?填写邮箱后会自动创建账号。
        </p>
      </Card>
    </div>
  );
}
