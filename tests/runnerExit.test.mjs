import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A desktop job's last message ('done' with its result) must reach the app before the job exits: process.send only
// queues it, and the download step's was lost on exit nearly every time (the app took the clean exit for a
// failure and the export downloaded everything again). exitAfterSending waits for the channel.
test('a job that sends its result and exits: the app gets the result every time', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapng-exit-'));
  const script = path.join(dir, 'job.mjs');
  const common = new URL('../desktop/runner/common.mjs', import.meta.url).href;
  // (a big result, as an export data step's: the larger the message, the likelier a plain exit loses it)
  fs.writeFileSync(script, `import { send, exitAfterSending } from ${JSON.stringify(common)};
send({ type: 'done', result: 'x'.repeat(2 * 1024 * 1024) });
exitAfterSending(0);
`);
  try {
    for (let run = 0; run < 20; run++) {
      const got = await new Promise((resolve) => {
        const child = fork(script, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        let done = false;
        child.on('message', (m) => { if (m?.type === 'done') done = true; });
        child.on('exit', (code) => resolve({ done, code }));
      });
      assert.deepEqual(got, { done: true, code: 0 }, `run ${run}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
