-- BL-GATE-INBOX F002：闸门邮件通知 claim 列。纯 additive，可空无默认，滚动部署安全。
ALTER TABLE "HarnessGate" ADD COLUMN "notifiedAt" TIMESTAMP(3);
