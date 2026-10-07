export function preloadNodeOptions(path: string): string {
  // NODE_OPTIONS consumes backslashes as escapes, even inside double quotes.
  return `--require="${path.replaceAll("\\", "/")}"`;
}
