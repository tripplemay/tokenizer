import { MdMarkEmailRead } from "react-icons/md";
import Card from "@/components/card";

export const dynamic = "force-dynamic";

export default function VerifyPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <Card extra="p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/10 text-brand-500">
          <MdMarkEmailRead className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-2xl font-bold text-navy-700 dark:text-white">查收你的邮箱</h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          登录链接已发送。点击邮件里的链接即可登录;链接 10 分钟内有效,过期后可重新发送。
        </p>
        <p className="mt-6 text-xs text-gray-500">
          没收到邮件?检查垃圾邮件文件夹,或确认邮箱地址正确后<a className="text-brand-500 hover:underline" href="/login">重新发送</a>。
        </p>
      </Card>
    </div>
  );
}
