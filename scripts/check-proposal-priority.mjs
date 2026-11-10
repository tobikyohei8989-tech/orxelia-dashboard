import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const pipeline = readFileSync(new URL('./orxelia-proposal-pipeline.mjs', import.meta.url), 'utf8');
const logic = pipeline.slice(pipeline.indexOf('const readyStages'), pipeline.indexOf('const proposal=await selectProposal'));
const shortlist = Array.from({ length: 100 }, (_, index) => ({
  id: String(index),
  status: 'approved_for_development',
}));
shortlist.push(
  { id: 'recent-review', status: 'awaiting_final_approval', recommendation: 'needs_evidence', last_researched_at: new Date().toISOString(), priority_rank: '1' },
  { id: 'selected', status: 'revision_requested', priority_rank: '1' },
  { id: 'also-selected', status: 'approved_for_development', priority_rank: '1' },
);
const requests = [];
const run = (rows, reload) => vm.runInNewContext(logic + '\nselectProposal()', {
  idFilter: id => 'orxelia_proposals?id=eq.' + id,
  api: async query => {
    requests.push(query);
    const offset = query.match(/&offset=(\d+)/);
    if (offset) return rows.slice(Number(offset[1]), Number(offset[1]) + 100);
    return reload ? [{ id: query.match(/id=eq\.([^&]+)/)[1] }] : [];
  },
});
assert.equal((await run(shortlist, true)).id, 'selected');
assert.ok(requests.at(-1).includes('status=eq.revision_requested'));
assert.ok(requests.every(query => query.includes('dashboard_deleted_at=is.null')));
assert.equal((await run(shortlist.slice(0, 2), true)).id, '0');
assert.equal(await run(shortlist, false), undefined);
assert.equal(await run([{ id: 'already-reviewed', status: 'awaiting_final_approval', recommendation: 'ready_for_approval', priority_rank: '1' }], true), undefined);
console.log('PASS: priority across multiple pages, older-first ties, review cooldown, concurrent stage change and approval protection');
