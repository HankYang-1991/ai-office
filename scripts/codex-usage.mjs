import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {writeFileSync, renameSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Only quota percentages and timestamps cross this allowlist.
export function sanitize(result, now = new Date()) {
  const bucket = result?.rateLimitsByLimitId ? result.rateLimitsByLimitId.codex : result?.rateLimits;
  if (!bucket || (bucket.limitId && bucket.limitId !== 'codex')) throw Error('quota_unavailable');
  const window = w => {
    if (!w || typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100) return null;
    return {remaining_pct: 100 - w.usedPercent, reset_at: Number.isFinite(w.resetsAt) ? new Date(w.resetsAt * 1000).toISOString() : null};
  };
  const data = {primary: window(bucket.primary), secondary: window(bucket.secondary), updated_at: now.toISOString()};
  if (!data.primary && !data.secondary) throw Error('quota_unavailable');
  return data;
}

export async function collect({exe, output, watch = false, interval = 300000, timeout = 30000, launch = spawn}) {
  const child = launch(exe, ['app-server', '--listen', 'stdio://'], {windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']});
  let timer, poll, finished = false, initialized = false;
  const save = data => {
    writeFileSync(output + '.tmp', JSON.stringify(data, null, 2) + '\n');
    renameSync(output + '.tmp', output);
  };
  return new Promise((resolve, reject) => {
    const stop = error => {
      if (finished) return;
      finished = true; clearTimeout(timer); clearInterval(poll); child.kill();
      if (error) {
        try { save({primary: null, secondary: null, updated_at: null}); } catch { error = 'snapshot_write_failed'; }
        reject(Error(error));
      } else resolve();
    };
    const send = x => child.stdin.write(JSON.stringify(x) + '\n');
    const read = () => {
      clearTimeout(timer); timer = setTimeout(() => stop('quota_read_timeout'), timeout);
      send({id: 2, method: 'account/rateLimits/read'});
    };
    child.on('error', () => stop('app_server_unavailable'));
    child.on('exit', () => stop('app_server_stopped'));
    child.stdin.on('error', () => stop('app_server_unavailable'));
    createInterface({input: child.stdout}).on('line', line => {
      let msg; try { msg = JSON.parse(line); } catch {return;}
      if (msg.id === 1) {
        if (msg.error) return stop('initialize_failed');
        initialized = true; send({method: 'initialized'}); read();
        if (watch) poll = setInterval(read, interval);
      } else if (msg.id === 2 || (initialized && msg.method === 'account/rateLimits/updated')) {
        if (msg.error) return stop('quota_read_failed');
        try { save(sanitize(msg.result ?? msg.params)); } catch { return stop('quota_unavailable'); }
        if (msg.id === 2) clearTimeout(timer);
        if (!watch) stop();
      }
    });
    timer = setTimeout(() => stop('initialize_timeout'), timeout);
    send({id: 1, method: 'initialize', params: {clientInfo: {name: 'ai_office_usage', title: 'AI Office Usage', version: '1.0.0'}}});
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [exe, output, mode] = process.argv.slice(2);
  if (!exe || !output) { console.error('Usage: node codex-usage.mjs CODEX_EXE OUTPUT [--watch]'); process.exitCode = 2; }
  else await collect({exe, output, watch: mode === '--watch'}).catch(e => {console.error(e.message); process.exitCode = 1;});
}
