// Fetches koffi's native binaries for every packaging target into build/koffi-prebuilds/<platform>_<arch>/koffi.node.
// npm only installs the optional @koromix/koffi-<os>-<arch> package for the host OS, so cross-builds
// (e.g. Windows .exe from Linux) need these copied in as extraResources (koffi looks in resources/koffi/<triplet>/).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const koffiDir = path.resolve(path.dirname(require.resolve('koffi')), '.');
const version = JSON.parse(fs.readFileSync(path.join(koffiDir, 'package.json'), 'utf8')).version;
const targets = ['win32-x64', 'darwin-x64', 'darwin-arm64'];
const outRoot = path.resolve(import.meta.dirname, '../build/koffi-prebuilds');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koffi-'));
for (const t of targets) {
  const triplet = t.replace('-', '_');
  const dest = path.join(outRoot, triplet, 'koffi.node');
  if (fs.existsSync(dest)) continue;
  const tgz = execFileSync('npm', ['pack', `@koromix/koffi-${t}@${version}`, '--silent'], { cwd: tmp, encoding: 'utf8' }).trim().split('\n').pop();
  execFileSync('tar', ['xzf', tgz], { cwd: tmp });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(tmp, 'package', triplet, 'koffi.node'), dest);
  fs.rmSync(path.join(tmp, 'package'), { recursive: true, force: true });
  console.log(`koffi ${version}: ${triplet}`);
}
