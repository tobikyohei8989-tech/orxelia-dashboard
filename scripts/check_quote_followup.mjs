import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const demo = readFileSync(new URL("../quote-followup-demo.html", import.meta.url), "utf8");
const script = demo.split("<script>")[1]?.split("const el=")[0];
assert.ok(script, "The demo must contain its follow-up rules");

runInNewContext(script + `
  const day = "2026-11-06";
  const expected = ["Q01", "Q02", "Q03", "Q04", "Q05", "Q11"];
  assert.equal(samples.length, 20);
  assert.deepEqual(Array.from(samples.filter(row => needsFollowUp(row, day)), row => row.id).join(","), expected.join(","));
  assert.equal(samples.filter(row => row.status === "未対応" && !validDay(row.nextDate)).map(row => row.id).join(","), "Q20");
  assert.equal(validDay("2026-02-30"), false);
  assert.equal(needsFollowUp({status:"対応済み",nextDate:day},day), false);
  console.log("20 synthetic cases: 6 expected follow-ups, 0 missed, 0 false positives, 1 missing date.");
`, {assert, console});
