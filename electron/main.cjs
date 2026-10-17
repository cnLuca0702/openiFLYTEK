const { app, BrowserWindow, Menu, ipcMain, shell, systemPreferences, nativeImage, dialog } = require('electron');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const {checkBackend, waitForBackend} = require('./backend-health.cjs');
const {version} = require('../package.json');
const asrInstaller = require('./asr-installer.cjs').createAsrInstaller();

let mainWindow = null;
let serverProcess = null;

// 检查端口是否已在监听
function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = net.createConnection({ port, host: '127.0.0.1' })
      .once('connect', () => {
        tester.destroy();
        resolve(true);
      })
      .once('error', () => {
        resolve(false);
      });
  });
}

// 启动内部 Real Backend 服务 (Port 3800)
async function startBackendServer() {
  if (await isPortInUse(3800)) {
    if (await checkBackend(3800, version)) return;
    throw new Error('端口 3800 正被旧版或其他后端占用，无法连接当前版本。请先保存录音，完全退出旧版 OpeniFLYTEK；如果另行启动过 npm run server / npm start，也请停止该服务，然后重新打开应用。');
  }
  const serverPath = path.join(__dirname, '../server/server.js');
  if (!fs.existsSync(serverPath)) throw new Error('应用缺少内置服务文件，请重新安装。');
  serverProcess = fork(serverPath, [], {
    execArgv: ['--experimental-sqlite'],
    env: { ...process.env, PORT: '3800' },
    stdio: 'inherit'
  });
  serverProcess.on('error', error => { serverProcess.spawnError = error; });
  await waitForBackend(3800, version, serverProcess);
}

// 创建 Mac 主窗口
function createMainWindow() {
  try {
    const iconPath = path.join(__dirname, 'resources/icon.png');
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1080,
      minHeight: 700,
      show: true, // 立即显示原生窗口
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor: '#0A0E17',
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
        allowRunningInsecureContent: true,
      },
    });

    // Web research citations and provider setup links open in the system browser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      try { if (['https:', 'http:'].includes(new URL(url).protocol)) void shell.openExternal(url); } catch (_) {}
      return { action: 'deny' };
    });

    const distPath = path.join(__dirname, '../dist/index.html');
    const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

    if (isDev) {
      console.log('[Electron] Loading dev server http://localhost:3000');
      mainWindow.loadURL('http://localhost:3000').catch(() => {
        mainWindow.loadFile(distPath);
      });
    } else if (fs.existsSync(distPath)) {
      console.log('[Electron] Loading local bundle:', distPath);
      mainWindow.loadFile(distPath);
      // 临时：转发渲染进程 console 报错，便于定位白屏
      mainWindow.webContents.on('console-message', (_e, _lvl, msg) => {
        if (/error|uncaught|failed/i.test(msg)) console.log('[Renderer]', msg);
      });
    } else {
      mainWindow.loadURL('http://localhost:3000');
    }

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      console.error('[Electron] Page failed to load:', errorCode, errorDescription, validatedURL);
    });

    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[Electron] OpeniFLYTEK page loaded successfully');
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  } catch (err) {
    console.error('[Electron] Error creating main window:', err);
  }
}

// 设置 macOS 原生菜单栏
function setupMacMenu() {
  try {
    const isMac = process.platform === 'darwin';
    const template = [
      ...(isMac ? [{
        label: 'OpeniFLYTEK',
        submenu: [
          { label: '关于 OpeniFLYTEK', role: 'about' },
          { type: 'separator' },
          { label: '偏好设置...', accelerator: 'Cmd+,', click: () => { mainWindow?.webContents.send('open-settings'); } },
          { type: 'separator' },
          { label: '隐藏 OpeniFLYTEK', role: 'hide' },
          { label: '隐藏其他', role: 'hideOthers' },
          { label: '全部显示', role: 'unhide' },
          { type: 'separator' },
          { label: '退出 OpeniFLYTEK', role: 'quit' }
        ]
      }] : []),
      {
        label: '会议 (Meeting)',
        submenu: [
          { 
            label: '开始/结束 会议录音', 
            accelerator: 'Cmd+N', 
            click: () => { mainWindow?.webContents.send('toggle-recording'); } 
          },
          { type: 'separator' },
          { 
            label: '推送到讯飞智能办公本', 
            accelerator: 'Cmd+P', 
            click: () => { mainWindow?.webContents.send('push-to-notebook'); } 
          }
        ]
      },
      {
        label: '编辑 (Edit)',
        submenu: [
          { label: '撤销', role: 'undo' },
          { label: '重做', role: 'redo' },
          { type: 'separator' },
          { label: '剪切', role: 'cut' },
          { label: '复制', role: 'copy' },
          { label: '粘贴', role: 'paste' },
          { label: '全选', role: 'selectAll' }
        ]
      },
      {
        label: '视图 (View)',
        submenu: [
          { label: '重新加载', role: 'reload' },
          { label: '开发者工具', role: 'toggleDevTools' },
          { type: 'separator' },
          { label: '实际大小', role: 'resetZoom' },
          { label: '放大', role: 'zoomIn' },
          { label: '缩小', role: 'zoomOut' },
          { type: 'separator' },
          { label: '切换全屏', role: 'togglefullscreen' }
        ]
      },
      {
        label: '窗口 (Window)',
        submenu: [
          { label: '最小化', role: 'minimize' },
          { label: '缩放', role: 'zoom' },
          { type: 'separator' },
          { label: '前置全部窗口', role: 'front' }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } catch (err) {
    console.warn('[Electron] Setup menu warning:', err);
  }
}

// macOS 权限请求
async function requestMacPermissions() {
  if (process.platform === 'darwin') {
    try {
      const micStatus = systemPreferences.getMediaAccessStatus('microphone');
      if (micStatus !== 'granted') {
        await systemPreferences.askForMediaAccess('microphone');
      }
    } catch (e) {
      console.warn('请求麦克风权限失败:', e);
    }
  }
}

app.whenReady().then(async () => {
  // 安全设置 Dock 图标 (必须使用 PNG 或 nativeImage)
  if (process.platform === 'darwin') {
    const pngPath = path.join(__dirname, 'resources/icon.png');
    if (fs.existsSync(pngPath)) {
      try {
        const img = nativeImage.createFromPath(pngPath);
        if (!img.isEmpty()) {
          app.dock.setIcon(img);
        }
      } catch (err) {
        console.warn('[Electron] Set dock icon failed:', err.message);
      }
    }
  }

  await requestMacPermissions();
  setupMacMenu();
  try {
    await startBackendServer();
    createMainWindow();
  } catch (error) {
    dialog.showErrorBox('OpeniFLYTEK 服务未就绪', error.message);
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

// IPC 处理
ipcMain.on('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow?.close();
});

ipcMain.on('open-external', (_event, url) => {
  shell.openExternal(url);
});

// Installation is desktop-only; the unauthenticated HTTP API cannot launch installers.
for (const [channel, action] of Object.entries({
  'asr-install-start': () => asrInstaller.start(),
  'asr-install-status': () => asrInstaller.status(),
  'asr-install-log': () => shell.openPath(asrInstaller.logPath()),
})) {
  ipcMain.handle(channel, (event) => {
    const frameUrl = event.senderFrame?.url || '';
    const bundleUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
    const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
    const trustedUrl = frameUrl.split(/[?#]/)[0] === bundleUrl || (isDev && /^http:\/\/localhost:3000(?:\/|$)/.test(frameUrl));
    if (!trustedUrl || !mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('仅允许主窗口操作本地语音安装');
    }
    return action();
  });
}
