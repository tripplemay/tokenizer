#!/usr/bin/env bash
# console-mode.md —— 生成控制台签名密钥对（Ed25519）。
#
# 私钥给控制台服务端（tokenizer），公钥入项目仓库 .claude/console/console.pub。
# 写代码的 agent 读得到公钥、伪造不了签名 —— 这是「人闸门归人」在中继通道下的机械保证。
#
# ⚠️ 私钥只应存在于控制台服务端（环境变量或密钥管理器），**绝不入任何项目仓库**。
set -euo pipefail
OUT="${1:-.}"
command -v openssl >/dev/null || { echo "⛔ 需要 openssl" >&2; exit 2; }
openssl genpkey -algorithm ed25519 -out "$OUT/console.key"
chmod 600 "$OUT/console.key"
openssl pkey -in "$OUT/console.key" -pubout -out "$OUT/console.pub"
echo "✓ 私钥：$OUT/console.key   ← 只给控制台服务端，绝不入项目仓库"
echo "✓ 公钥：$OUT/console.pub   ← 拷进每个项目的 .claude/console/console.pub 并提交"
echo
echo "控制台服务端用法（环境变量注入，勿落盘）："
echo "  export HARNESS_CONSOLE_SIGNING_KEY=\"\$(cat $OUT/console.key)\""
