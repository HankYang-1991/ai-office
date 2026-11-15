const {createRequire} = require('node:module');
const path = require('node:path');

async function waitForArtifact(client, expectedId, {attempts = 7, delay = ms => new Promise(r => setTimeout(r, ms))} = {}) {
  if (!/^\d+$/.test(String(expectedId))) throw Error('Missing upload artifact ID');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Same runtime-scoped service used by deploy-pages v5, not the REST list API.
    const {artifacts} = await client.listArtifacts();
    const matches = artifacts.filter(a => a.name === 'github-pages');
    if (matches.length > 1) throw Error('Duplicate github-pages artifacts');
    if (matches.length === 1) {
      if (String(matches[0].id) !== String(expectedId)) throw Error('Artifact ID differs from this upload');
      if (!(matches[0].size > 0)) throw Error('Empty Pages artifact');
      return;
    }
    if (attempt < attempts) await delay(5000);
  }
  throw Error('Uploaded github-pages artifact is still invisible after 30 seconds; deployment was not attempted');
}
module.exports = {waitForArtifact};
if (require.main === module) {
  const runtimeRequire = createRequire(path.join(process.env.PAGES_METADATA_SDK, 'package.json'));
  const {DefaultArtifactClient} = runtimeRequire('@actions/artifact');
  waitForArtifact(new DefaultArtifactClient(), process.env.PAGES_ARTIFACT_ID)
    .then(() => console.log('This run\'s Pages artifact is visible to the deployment service'))
    .catch(() => { console.error('Pages artifact readiness check failed; deployment stopped.'); process.exitCode = 1; });
}
