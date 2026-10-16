const fs = require('node:fs');
const path = require('node:path');
const { execSync, execFileSync } = require('node:child_process');

const rootDir = path.join(__dirname, '..');
const distMacDir = path.join(rootDir, 'dist_mac');
const targetApp = path.join(distMacDir, 'OpeniFLYTEK.app');
const electronDistApp = path.join(rootDir, 'node_modules/electron/dist/Electron.app');
const iconSrc = path.join(__dirname, 'resources/icon.icns');

console.log('[Mac Packager] Building native macOS Application Bundle...');

if (!fs.existsSync(iconSrc)) throw new Error('Missing release icon: '+iconSrc);

if (!fs.existsSync(electronDistApp)) {
  console.error('[Mac Packager] Electron.app template not found in node_modules/electron/dist');
  process.exit(1);
}

// 确保清理旧目标目录
if (fs.existsSync(distMacDir)) {
  fs.rmSync(distMacDir, { recursive: true, force: true });
}
fs.mkdirSync(distMacDir, { recursive: true });

// 1. 复制 Electron.app
console.log('[Mac Packager] Copying Electron app template...');
execSync(`cp -R "${electronDistApp}" "${targetApp}"`);

// 2. 重命名二进制文件
console.log('[Mac Packager] Renaming binary to OpeniFLYTEK...');
const macosDir = path.join(targetApp, 'Contents/MacOS');
const oldBin = path.join(macosDir, 'Electron');
const newBin = path.join(macosDir, 'OpeniFLYTEK');
if (fs.existsSync(oldBin)) {
  fs.renameSync(oldBin, newBin);
}

// 3. 复制应用真实源码至 Contents/Resources/app
console.log('[Mac Packager] Copying application assets into app bundle...');
const appResourcesDir = path.join(targetApp, 'Contents/Resources/app');
fs.mkdirSync(appResourcesDir, { recursive: true });

execSync(`cp -R "${path.join(rootDir, 'dist')}" "${appResourcesDir}/"`);
execSync(`cp -R "${path.join(rootDir, 'server')}" "${appResourcesDir}/"`);
execSync(`cp -R "${path.join(rootDir, 'electron')}" "${appResourcesDir}/"`);
execSync(`cp "${path.join(rootDir, 'package.json')}" "${appResourcesDir}/"`);

// Install a self-contained runtime; never link back into the build checkout.
fs.copyFileSync(path.join(rootDir, 'package-lock.json'), path.join(appResourcesDir, 'package-lock.json'));
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: appResourcesDir, stdio: 'inherit' });

// 4. 替换原生应用图标
if (fs.existsSync(iconSrc)) {
  console.log('[Mac Packager] Applying OpeniFLYTEK .icns icon...');
  fs.copyFileSync(iconSrc, path.join(targetApp, 'Contents/Resources/electron.icns'));
  fs.copyFileSync(iconSrc, path.join(targetApp, 'Contents/Resources/icon.icns'));
}

// 5. 更新 Info.plist 注入应用元数据与麦克风权限描述
console.log('[Mac Packager] Patching Info.plist for macOS permissions and branding...');
const plistPath = path.join(targetApp, 'Contents/Info.plist');
if (fs.existsSync(plistPath)) {
  let plist = fs.readFileSync(plistPath, 'utf-8');
  plist = plist.replace(/<string>Electron<\/string>/g, '<string>OpeniFLYTEK</string>');
  plist = plist.replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]+<\/string>/, '<key>CFBundleExecutable</key>\n\t<string>OpeniFLYTEK</string>');
  plist = plist.replace(/<key>CFBundleIdentifier<\/key>\s*<string>[^<]+<\/string>/, '<key>CFBundleIdentifier</key>\n\t<string>com.openiflytek.app</string>');
  
  for (const [key,value] of Object.entries({CFBundleName:'OpeniFLYTEK',CFBundleDisplayName:'OpeniFLYTEK',CFBundleIconFile:'icon.icns'})) {
    const pattern=new RegExp(`<key>${key}</key>\\s*<string>[^<]*</string>`);
    const entry=`<key>${key}</key>\n\t<string>${value}</string>`;
    plist=pattern.test(plist)?plist.replace(pattern,entry):plist.replace('</dict>',entry+'\n</dict>');
  }
  const version = require('../package.json').version;
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
    plist = plist.replace(new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`), `<key>${key}</key>\n\t<string>${version}</string>`);
  }

  // 注入麦克风隐私权限描述
  if (!plist.includes('NSMicrophoneUsageDescription')) {
    plist = plist.replace('</dict>', `\t<key>NSMicrophoneUsageDescription</key>\n\t<string>OpeniFLYTEK 需要访问麦克风以录制会议并执行双通道回声消除实时转写。</string>\n</dict>`);
  }

  fs.writeFileSync(plistPath, plist, 'utf-8');
}

execFileSync('codesign', ['--force', '--deep', '--sign', '-', targetApp], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--deep', '--strict', targetApp], { stdio: 'inherit' });

console.log('[Mac Packager] Success! Standalone Mac app created at:');
console.log(targetApp);
