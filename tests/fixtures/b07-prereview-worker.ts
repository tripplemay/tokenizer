import { mergeQueueEvents, readQueue, resolveQueueEvents } from "../../src/cli/queue";
import { readRejectedUsageEvents } from "../../src/cli/rejected-events";
import type { UsageEventInput } from "../../src/shared/usage";

const [operation, payload = "[]"] = process.argv.slice(2);
const events = JSON.parse(payload) as UsageEventInput[];
if (operation === "merge") mergeQueueEvents(events);
else if (operation === "accept") resolveQueueEvents({ accepted: events, rejected: [] });
else if (operation === "reject") resolveQueueEvents({ accepted: [], rejected: events.map((event) => ({ event, code: "invalid_event" })) });
else if (operation !== "read") throw new Error("Unknown operation");
console.log(JSON.stringify({ active: readQueue(), rejected: readRejectedUsageEvents() }));
