// Crash-consistency child: resolve a mixed resolution in a tight loop; the
// driver SIGKILLs us mid-flight. argv: <home>
import { event } from "./harness";

const home = process.argv[2];

async function main() {
  const { resolveQueueEvents } = await import("@/cli/queue");
  const i = Number(process.env.ITER ?? "0");
  const doomed = event(`crash-${i}`, { model: "bad" }, 0);
  // Resolution: reject the doomed event (quarantine step then checkpoint step;
  // we may be killed between or during either).
  resolveQueueEvents({ accepted: [], rejected: [{ event: doomed, code: "invalid_event" }] });
  console.log("completed");
}
main();
