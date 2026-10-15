const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'darwin') throw new Error('DMG packaging requires macOS');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist_mac');
const version = require('../package.json').version;
const dmg = path.join(output, `OpeniFLYTEK-${version}-${process.arch}.dmg`);
const app = path.join(output, 'OpeniFLYTEK.app');
if (!fs.existsSync(app)) throw new Error('Run npm run app:build first');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'openiflytek-dmg-'));
try {
  execFileSync('ditto', [app, path.join(stage, 'OpeniFLYTEK.app')], { stdio: 'inherit' });
  fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
  execFileSync('hdiutil', ['create', '-volname', 'OpeniFLYTEK', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg], { stdio: 'inherit' });
  execFileSync('hdiutil', ['verify', dmg], { stdio: 'inherit' });
  console.log(`DMG ready: ${dmg}`);
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
