// A JavaScript action receives the runner-owned artifact runtime environment.
// Do not forward runtime credentials to shell steps or print exception details.
const {run} = require('../../../scripts/wait-pages-artifact.cjs');
run().then(code => { process.exitCode = code; }).catch(() => {
  console.error('Pages artifact readiness failed [UNEXPECTED]; deployment stopped.');
  process.exitCode = 1;
});
