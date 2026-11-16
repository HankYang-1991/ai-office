const {createRequire} = require('node:module');
const path = require('node:path');

class ReadinessError extends Error {
  constructor(code, message) { super(message); this.safeCode = code; }
}
async function waitForArtifact(client, expectedId, {attempts = 7, delay = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  if (!/^\d+$/.test(String(expectedId))) throw new ReadinessError('UPLOAD_ID_MISSING', 'Missing upload artifact ID');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Same runtime-scoped service used by deploy-pages v5, not the REST list API.
    const {artifacts} = await client.listArtifacts();
    const matches = artifacts.filter(a => a.name === 'github-pages');
    if (matches.length > 1) throw new ReadinessError('DUPLICATE_ARTIFACT', 'Duplicate github-pages artifacts');
    if (matches.length === 1) {
      if (String(matches[0].id) !== String(expectedId)) throw new ReadinessError('ARTIFACT_ID_MISMATCH', 'Artifact ID differs from this upload');
      if (!(matches[0].size > 0)) throw new ReadinessError('EMPTY_ARTIFACT', 'Empty Pages artifact');
      return;
    }
    if (attempt < attempts) await delay(5000);
  }
  throw new ReadinessError('VISIBILITY_TIMEOUT', 'Uploaded github-pages artifact is still invisible after 30 seconds; deployment was not attempted');
}
async function run({env = process.env, load = p => createRequire(p)('@actions/artifact'),
  info = message => console.log(message), error = message => console.error(message), wait = waitForArtifact} = {}) {
  let phase = 'CONFIG_INVALID';
  try {
    if (!env.ACTIONS_RUNTIME_TOKEN || !env.ACTIONS_RESULTS_URL)
      throw new ReadinessError('RUNTIME_ENV_MISSING', 'Use the JavaScript action runtime');
    if (!env.PAGES_METADATA_SDK || !path.isAbsolute(env.PAGES_METADATA_SDK))
      throw new ReadinessError('SDK_PATH_INVALID', 'SDK path must be absolute');
    phase = 'SDK_LOAD_FAILED';
    const {DefaultArtifactClient} = load(path.join(env.PAGES_METADATA_SDK, 'package.json'));
    const client = new DefaultArtifactClient();
    phase = 'ARTIFACT_QUERY_FAILED';
    await wait(client, env.PAGES_ARTIFACT_ID);
    info('This run\'s Pages artifact is visible to the deployment service');
    return 0;
  } catch (failure) {
    // No SDK exception text, URLs, headers, tokens, or stacks may reach logs.
    const code = failure instanceof ReadinessError ? failure.safeCode : phase;
    error(`Pages artifact readiness failed [${code}]; deployment stopped.`);
    return 1;
  }
}
module.exports = {waitForArtifact, run};
if (require.main === module) run().then(code => { process.exitCode = code; });
