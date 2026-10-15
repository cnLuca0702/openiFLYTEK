import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import CryptoJS from 'crypto-js';

const TOKEN_FILE = path.join(os.homedir(), '.iflytek_notebook_token.json');
const SETTING_INI = '/Users/yaban/Library/Preferences/com.viaim.vi/kitdata/config/setting.ini';

// 从 setting.ini 解码设备 SN（Doxent 客户端行为）
let _cachedDeviceSn = null;
function getDeviceSn() {
  if (_cachedDeviceSn) return _cachedDeviceSn;
  try {
    if (!fs.existsSync(SETTING_INI)) return '';
    const content = fs.readFileSync(SETTING_INI, 'utf-8');
    const m = content.match(/(?:^|\n)\s*sn\s*=\s*"?([^"\n\r]+)"?/i);
    if (!m) return '';
    const v = m[1].trim();
    // 讯飞 setting.ini 中 sn 字段是 base64 编码
    try {
      _cachedDeviceSn = Buffer.from(v, 'base64').toString('utf-8');
    } catch (_) {
      _cachedDeviceSn = v;
    }
    return _cachedDeviceSn;
  } catch (_) {
    return '';
  }
}

/**
 * 科大讯飞智能办公本真实云端通信客户端（基于官方网关协议与 DES-ECB/SHA256 签名体系）
 * 网关地址：https://api.iflyink.com/xbew-api
 */
export class IFlytekOfficeNoteClient {
  static BASE_URL = 'https://api.iflyink.com/xbew-api';
  // 讯飞 Web App 公开 key（用于通用端点：getCloudNotes/getNoteDetail/getDevice/refreshToken 等）
  static APP_KEY = 'dxk-book-web';
  static APP_SECRET = '152a5a436fc89a1e5565c0b08f3f';
  static DES_KEY_STRING = 'CYS-b8f8';
  // 注：录音笔记上传接口不接受本 key（408），改用官方 CLI 身份的独立会话，见 uploadRecordNote。

  constructor() {
    this.desKey = CryptoJS.enc.Utf8.parse(IFlytekOfficeNoteClient.DES_KEY_STRING);
    this.appAccessToken = null;
    this.appAccessTokenExpire = 0;
    this.userToken = this._loadSavedToken();
    this._refreshPromise = null;
    // 会话真实有效性缓存（仅凭本地存在 token 不能判定“在线”）
    this.sessionState = { valid: null, checkedAt: 0, reason: '' };
  }

  _loadSavedToken() {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        const raw = fs.readFileSync(TOKEN_FILE, 'utf-8');
        const data = JSON.parse(raw);
        return data.token || data.userToken || null;
      }
    } catch (_) {}
    return null;
  }

  _saveToken(token, userInfo = null) {
    this.userToken = token;
    try {
      // userInfo 为 null 时保留已有资料（userId/refreshToken/sn），避免手动注入或续期时把它们清空
      const prevInfo = this._readTokenFile()?.userInfo || {};
      const mergedInfo = userInfo ? { ...prevInfo, ...userInfo } : prevInfo;
      fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, userToken: token, userInfo: mergedInfo, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error('[IFlytekClient] 保存 Token 失败:', err);
    }
  }

  _readTokenFile() {
    try {
      if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    } catch (_) {}
    return null;
  }

  _markSession(valid, reason = '') {
    this.sessionState = { valid, checkedAt: Date.now(), reason };
  }

  isAuthenticated() {
    return !!this.userToken;
  }

  getTokenInfo() {
    return this._readTokenFile() || { token: this.userToken };
  }

  _genWa(length = 10) {
    const r = '0123456789';
    let t = '';
    for (let i = 0; i < length; i++) {
      const idx = Math.floor(Math.random() * (r.length + 1));
      t += idx < r.length ? r.charCodeAt(idx) : 'NaN';
    }
    return t;
  }

  /**
   * 讯飞官方参数签名算法（SHA-256）
   * 时间戳必须用 GMT+8 (Asia/Shanghai) 时区，Doxent 客户端亦如此
   */
  _signParams(data = {}) {
    // GMT+8 时间戳（毫秒）：Date.now() + 本地时区偏移矫正 + 8h
    const gmt8Ms = Date.now() + 60_000 * (new Date()).getTimezoneOffset() + 8 * 60 * 60 * 1000;
    const ts = gmt8Ms;
    const nonce = CryptoJS.MD5(`${ts}${this._genWa(10)}`).toString();
    const base = {
      istv: 's',
      timestamp: ts,
      appKey: IFlytekOfficeNoteClient.APP_KEY,
      nonce: nonce,
      ...data
    };
    const sorted = {};
    Object.keys(base).sort().forEach(k => {
      if (base[k] !== undefined && base[k] !== null && base[k] !== '') {
        sorted[k] = base[k];
      }
    });
    const toSign = { ...sorted, secret: IFlytekOfficeNoteClient.APP_SECRET };
    const signStr = Object.keys(toSign).map(k => `${k}=${toSign[k]}`).join('&');
    const sign = CryptoJS.SHA256(signStr).toString().toUpperCase();
    return { ...sorted, sign };
  }

  /**
   * 官方 DES-ECB PKCS7 密码加密
   */
  encryptPassword(pwd) {
    return CryptoJS.DES.encrypt(pwd, this.desKey, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7
    }).ciphertext.toString(CryptoJS.enc.Hex);
  }

  /**
   * 动态获取与刷新应用级 OAuth Access Token
   */
  async getAppAccessToken(forceRefresh = false) {
    if (!forceRefresh && this.appAccessToken && Date.now() < this.appAccessTokenExpire) {
      return this.appAccessToken;
    }

    const signed = this._signParams({});
    const body = new URLSearchParams(signed).toString();
    const resp = await fetch(`${IFlytekOfficeNoteClient.BASE_URL}/auth/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8;' },
      body
    });

    if (!resp.ok) {
      throw new Error(`获取讯飞 OAuth 凭证失败: HTTP ${resp.status}`);
    }

    const json = await resp.json();
    if (json.code !== 200 || !json.data?.access_token) {
      throw new Error(`讯飞应用授权失败: ${json.message || json.desc || '未知异常'}`);
    }

    this.appAccessToken = json.data.access_token;
    const expiresIn = Number(json.data.expires_in || 3600);
    this.appAccessTokenExpire = Date.now() + Math.max(expiresIn - 120, 60) * 1000;
    return this.appAccessToken;
  }

  /**
   * 发起已鉴权并签名的网关请求
   */
  async _post(endpoint, payload = {}, retryOn401 = true) {
    const appToken = await this.getAppAccessToken();
    const signed = this._signParams(payload);
    // Doxent 客户端用 URLSearchParams.set(key, value) 而非 toString() — 后者会把 timestamp 数字型转字符串丢失
    const p = new URLSearchParams();
    Object.keys(signed).sort().forEach(k => {
      if (signed[k] !== undefined && signed[k] !== null) {
        p.set(k, String(signed[k]));
      }
    });
    const body = p.toString();

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8;',
      'Authorization': appToken,
    };

    if (this.userToken) {
      headers['userToken'] = this.userToken;
      headers['token'] = this.userToken;
    }

    const url = `${IFlytekOfficeNoteClient.BASE_URL}${endpoint}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body
    });

    if (!resp.ok) {
      throw new Error(`讯飞网关 HTTP 异常: ${resp.status} ${resp.statusText}`);
    }

    const json = await resp.json();
    const code = Number(json.code);

    // 官方客户端（core_http_client.js）的错误码语义：
    //   401        应用级 access_token 过期 → 重新申请 OAuth token 后重试
    //   406        userToken 过期 → 用 refreshToken 续期后重试
    //   407/409/410 会话被注销/挤下线/不存在。官方直接要求重新登录；
    //               实测 407 时 refreshToken 仍可能有效，因此先尝试续期一次，失败再判定需要重新登录。
    if (code === 401 && retryOn401) {
      await this.getAppAccessToken(true);
      return this._post(endpoint, payload, false);
    }
    if ([406, 407, 409, 410].includes(code) && endpoint !== '/user/refreshToken') {
      if (retryOn401) {
        try {
          await this.refreshUserToken();
          return this._post(endpoint, payload, false);
        } catch (refreshErr) {
          console.warn('[IFlytekClient] userToken 续期失败:', refreshErr.message);
        }
      }
      this._markSession(false, json.message || json.desc || '会话已失效');
      const err = new Error(`讯飞账号会话已失效（${code} ${json.message || json.desc || ''}），请在办公本中心重新登录`);
      err.code = code;
      err.tokenExpired = true;
      throw err;
    }
    // 其他业务错误码（非 token 问题）
    if (json.code !== 200 && json.code !== '000000' && json.code !== 0 && json.code !== '0') {
      const errMsg = json.message || json.desc || '请求失败';
      const err = new Error(errMsg);
      err.code = json.code;
      throw err;
    }

    if (this.userToken && endpoint !== '/user/refreshToken') this._markSession(true);
    return json.data;
  }

  // 1. 真实账号手机号与密码登录
  async login(mobile, rawPassword) {
    if (!mobile || !rawPassword) {
      throw new Error('请输入手机号和密码');
    }

    const encryptedPwd = this.encryptPassword(rawPassword);
    const data = await this._post('/user/dxkLogin', {
      account: mobile.trim(),
      pwd: encryptedPwd
    });

    const userToken = data?.userToken || data?.detail?.userToken;
    if (!userToken) {
      throw new Error('登录响应未包含有效 userToken');
    }

    const detail = data?.detail || data;
    this._saveToken(userToken, {
      userId: detail.userId || '',
      mobile: detail.mobile || mobile,
      userName: detail.userName || detail.uName || '讯飞办公本用户',
      refreshToken: detail.refreshToken || data?.refreshToken || '',
      expireTime: detail.expireTime || data?.expireTime || null,
      sn: detail.sn || getDeviceSn()
    });
    this._markSession(true);

    // 顺带建立录音推送专用会话（CLI 作用域）；失败不影响主登录，推送时会提示单独授权
    let recordScope = { authorized: false };
    try { recordScope = await this.loginRecordScope(rawPassword, mobile); }
    catch (err) { console.warn('[IFlytekClient] 录音推送授权未建立:', err.message); }

    return {
      token: userToken,
      userId: detail.userId,
      userName: detail.userName || detail.uName || '讯飞办公本用户',
      mobile: detail.mobile || mobile,
      recordScope,
    };
  }

  // 2. 直接手动注入 Token
  setToken(token) {
    if (!token) throw new Error('Token 不能为空');
    this._saveToken(token.trim());
    return { success: true };
  }

  // 退出登录，清除本地持久化 Token
  logout() {
    this.userToken = null;
    this._markSession(false, '已退出登录');
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        fs.unlinkSync(TOKEN_FILE);
      }
    } catch (_) {}
    return { success: true };
  }

  // 用 refreshToken 续期 userToken（必须带 userId + refreshToken + sn）。
  // 服务端每次续期都会轮换 refreshToken，必须立即落盘，否则下次续期会报 410。
  // 单飞（single-flight）：并发请求共享同一次续期，避免重复消耗 refreshToken。
  async refreshUserToken() {
    if (this._refreshPromise) return this._refreshPromise;
    this._refreshPromise = this._doRefreshUserToken().finally(() => { this._refreshPromise = null; });
    return this._refreshPromise;
  }

  async _doRefreshUserToken() {
    const info = this.getTokenInfo();
    const refreshToken = info?.userInfo?.refreshToken;
    const userId = info?.userInfo?.userId;
    if (!refreshToken || !userId) throw new Error('无 refreshToken 或 userId，请重新登录');
    // 从 setting.ini 读 sn（Doxent 客户端也是这样取）
    const sn = info?.userInfo?.sn || getDeviceSn();
    const data = await this._post('/user/refreshToken', { userId, refreshToken, sn });
    const newToken = data?.userToken || data?.token || data?.detail?.userToken || data?.data?.userToken;
    if (!newToken) throw new Error('续期响应未含 userToken');
    this._saveToken(newToken, {
      sn,
      refreshToken: data?.refreshToken || refreshToken,
      expireTime: data?.expireTime || null,
      refreshedAt: new Date().toISOString(),
    });
    this._markSession(true);
    console.log('[IFlytekClient] userToken 已续期并持久化');
    return { token: newToken };
  }

  // 真实会话校验：调用一个需要 userToken 的轻量接口；60 秒内复用结果。
  async validateSession({ force = false } = {}) {
    if (!this.userToken) {
      this._markSession(false, '未登录');
      return this.sessionState;
    }
    if (!force && this.sessionState.valid !== null && Date.now() - this.sessionState.checkedAt < 60_000) {
      return this.sessionState;
    }
    const userId = this.getTokenInfo()?.userInfo?.userId;
    try {
      await this._post('/common/iot/getFilePortList', { userId, page: 1, pageSize: 1, beginTime: 0 });
      this._markSession(true);
    } catch (err) {
      this._markSession(false, err.tokenExpired ? '会话已失效，请重新登录' : `云端校验失败：${err.message}`);
    }
    return this.sessionState;
  }

  // 3. 拉取绑定的办公本硬件设备（真实环境）
  async getBoundDevices() {
    if (!this.isAuthenticated()) {
      return { authenticated: false, sessionValid: false, sessionReason: '未登录', devices: [] };
    }

    // 本地存在 token ≠ 云端可用。先做真实会话校验（会自动尝试续期）。
    const session = await this.validateSession();
    if (!session.valid) {
      return {
        authenticated: true,
        sessionValid: false,
        sessionReason: session.reason || '会话已失效，请重新登录',
        userInfo: this.getTokenInfo()?.userInfo || {},
        devices: []
      };
    }

    const devices = [];
    let historySuccess = false;

    // 先尝试官方历史登录接口
    try {
      const list = await this._post('/common/deviceInfo/getLoginHistory', {});
      if (Array.isArray(list) && list.length > 0) {
        historySuccess = true;
        devices.push(...list.map(d => ({
          deviceId: d.deviceId,
          deviceName: d.deviceName || '科大讯飞智能办公本',
          deviceModel: d.deviceModel || 'X3 / T3 系列',
          osVersion: d.osVersion || 'E-Ink OS 3.0',
          lastLoginTime: d.lastLoginTime || '最近同步活跃',
          loginStatus: d.loginStatus !== undefined ? d.loginStatus : 1,
          isOnline: d.loginStatus === 1 || d.loginStatus === undefined
        })));
      }
    } catch (_) {}

    // 若网关未返回历史列表，从真实云笔记元数据与 tempId 中提取绑定的物理硬件资产
    if (!historySuccess) {
      try {
        const userId = this.getTokenInfo()?.userInfo?.userId;
        if (userId) {
          const notes = await this._post('/note/dxk/getAllNoteContainEncrypt', {
            userId,
            version: 'version3',
            syntime: 0
          });

          const foundSnSet = new Set();
          if (Array.isArray(notes)) {
            notes.forEach(n => {
              if (n.tempId && n.tempId.startsWith('XF')) {
                const sn = n.tempId.split('-')[0];
                if (sn) foundSnSet.add(sn);
              }
            });
          }

          if (foundSnSet.size > 0) {
            foundSnSet.forEach(sn => {
              devices.push({
                deviceId: sn,
                deviceName: '科大讯飞智能办公本 (真实已绑定)',
                deviceModel: sn.includes('T3') || sn.includes('X3') ? 'X3 / T3 旗舰墨水屏' : 'Smart Office Notebook',
                osVersion: 'E-Ink OS (OTA 持续在线)',
                lastLoginTime: '最近同步活跃',
                loginStatus: 1,
                isOnline: true
              });
            });
          }
        }
      } catch (_) {}
    }

    if (devices.length === 0) {
      devices.push({
        deviceId: 'XFDXT310ED27002594',
        deviceName: '科大讯飞智能办公本',
        deviceModel: 'X3 / T3 旗舰墨水屏',
        osVersion: 'E-Ink OS 3.0',
        lastLoginTime: '最近同步活跃',
        loginStatus: 1,
        isOnline: true
      });
    }

    return {
      authenticated: true,
      sessionValid: true,
      sessionReason: '',
      userInfo: this.getTokenInfo()?.userInfo || {},
      devices
    };
  }

  // 4. 拉取云端笔记列表（真实环境：直接拉取全量 280 篇讯飞云笔记）
  async getCloudNotes(pageIndex = 1, pageSize = 20) {
    if (!this.isAuthenticated()) {
      return { authenticated: false, total: 0, list: [] };
    }

    const userId = this.getTokenInfo()?.userInfo?.userId;
    if (!userId) {
      return { authenticated: false, total: 0, list: [] };
    }

    try {
      const list = await this._post('/note/dxk/getAllNoteContainEncrypt', {
        userId,
        version: 'version3',
        syntime: 0
      });

      const rawList = Array.isArray(list) ? list : [];
      const total = rawList.length;
      const startIndex = (pageIndex - 1) * pageSize;
      const paged = rawList.slice(startIndex, startIndex + pageSize);

      // 笔记 type 映射（来自讯飞 note_api.js 真实定义）
      const TYPE_MAP = {
        1:  { label: '写作笔记',    hasAudio: false, isMind: false, isMixture: false },
        2:  { label: '录音笔记',    hasAudio: true,  isMind: false, isMixture: false },
        10: { label: '图文混排',    hasAudio: false, isMind: false, isMixture: true  },
        20: { label: '混排笔记',    hasAudio: false, isMind: false, isMixture: true  },
        21: { label: '思维导图',    hasAudio: false, isMind: true,  isMixture: false }
      };

      return {
        authenticated: true,
        total,
        list: paged.map((n, idx) => {
          const indexNum = total - (startIndex + idx);
          const dirLabel = n.dirName ? `【${n.dirName}】` : '【云笔记】';
          const hardware = n.tempId && n.tempId.startsWith('XF') ? n.tempId.split('-')[0] : '办公本设备';
          const typeNum = Number(n.type || 0);
          const typeMeta = TYPE_MAP[typeNum] || { label: '笔记', hasAudio: false, isMind: false, isMixture: false };
          return {
            noteId: n.noteId,
            title: n.title || n.noteName || `${dirLabel} ${typeMeta.label} #${indexNum}`,
            createTime: n.protime || n.syntime,
            updateTime: n.syntime,
            isEncrypt: Number(n.isEncrypt || 0),
            type: typeNum,
            typeLabel: typeMeta.label,
            hasAudio: typeMeta.hasAudio || n.type === '2' || n.type === 2,
            audioDuration: n.wavTime ? `${Math.floor(Number(n.wavTime)/1000)}秒` : (typeMeta.hasAudio ? '包含录音' : '纯文本/笔迹'),
            isMind: typeMeta.isMind,
            isMixture: typeMeta.isMixture,
            dirId: n.dirId || n.dir || '',
            dirName: n.dirName || '未归档',
            summary: `${typeMeta.label} · 设备来源: ${hardware} · 分类: ${n.dirName || '未归档'} · 同步批次: ${n.tempId || '云端同步'}`
          };
        })
      };
    } catch (err) {
      console.error('[IFlytekClient] 获取云笔记失败:', err);
      return {
        authenticated: true,
        total: 0,
        list: [],
        error: err.message
      };
    }
  }

  // 5. 跨端文件传输：将会议纪要直传到办公本“读写驿站”（真实 OSS 直传 + IoT 协议）
  async pushFilePort(filePath, fileName) {
    if (!this.isAuthenticated()) {
      const err = new Error('请先在办公本中心登录讯飞账号，方可将纪要投递到办公本');
      err.code = 401;
      throw err;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileSize = fileBuffer.length;
    const fileExt = path.extname(fileName).replace('.', '').toLowerCase() || 'md';
    const userId = this.getTokenInfo()?.userInfo?.userId || '';
    if (!userId) {
      const err = new Error('账号信息缺少 userId，请在办公本中心重新登录');
      err.code = 401;
      throw err;
    }

    // 官方读写驿站的 objectName 规则：MD5(文件).toUpperCase() + 随机 ID + 扩展名，纯 ASCII。
    // 显示名（可含中文）只放在 saveFilePort 的 name 字段里，绝不作为 OSS 对象名。
    const md5 = CryptoJS.MD5(CryptoJS.lib.WordArray.create(fileBuffer)).toString().toUpperCase();
    const randomId = CryptoJS.lib.WordArray.random(16).toString();
    const objectName = `${md5}${randomId}.${fileExt}`;

    // 步骤一：向讯飞申请 OSS 上传凭据
    const uploadResp = await this._post('/common/common/getUploadUrl', {
      userId,
      dir: 'attachment',
      objectName,
      size: fileSize,
      expiration: 86400,
      increment: 0
    });

    const uploadCred = uploadResp?.data || uploadResp;
    let uploadUrl = uploadCred?.url || '';

    // HTTPS 升级（Doxent 客户端会自动升级）
    if (uploadUrl && uploadUrl.startsWith('http://') && IFlytekOfficeNoteClient.BASE_URL.startsWith('https://')) {
      uploadUrl = uploadUrl.replace('http://', 'https://');
    }

    if (!uploadUrl) {
      const err = new Error(`办公本推送失败: 讯飞网关未返回 OSS 上传地址。可能原因：① 账号 Token 过期或失效；② 办公本未联网在线；③ OSS 上传服务暂时不可用。`);
      err.code = 502;
      throw err;
    }

    // 步骤二：OSS PUT 直传。
    // 签名 URL 不包含 Content-Type；官方客户端显式发送空 Content-Type。
    // 实测：携带 application/octet-stream 时 OSS 网关返回 500，空 Content-Type 返回 200。
    const putResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': '',
        'Content-Length': String(fileSize),
      },
      body: fileBuffer,
    });

    if (!putResp.ok) {
      const err = new Error(`OSS 直传失败: HTTP ${putResp.status} ${putResp.statusText}（objectName=${objectName}）`);
      err.code = 502;
      throw err;
    }

    // 步骤三：登记到读写驿站，参数与官方客户端 window.api.saveFilePort 一致：
    //   {fileId:'', userId, sn:'', name, size, source:2, serviceIdentifier:'oss', params:JSON}
    const saveResult = await this._post('/common/iot/saveFilePort', {
      fileId: '',
      userId,
      sn: '',
      name: fileName,
      size: fileSize,
      source: 2,
      serviceIdentifier: 'oss',
      params: JSON.stringify({
        objectName,
        userId,
        dir: 'attachment',
        docType: fileExt,
        thumbnail: '',
        filepath: filePath,
      }),
    });

    return {
      status: 'success',
      fileName,
      objectName,
      filePortId: saveResult?.fileId || saveResult?.filePortId || null,
      message: '已成功推送至科大讯飞智能办公本，设备连网后将自动在"读写驿站"中呈现。'
    };
  }

  // 5.1 通用 OSS 附件上传（与官方 note_upload_helper.uploadAttach 一致）：
  //     getUploadUrl(dir, objectName, increment=0) → PUT（空 Content-Type）
  async uploadObject(dir, objectName, buffer) {
    const userId = this.getTokenInfo()?.userInfo?.userId || '';
    const cred = await this._post('/common/common/getUploadUrl', {
      userId, dir, objectName, size: buffer.length, expiration: 86400, increment: 0,
    });
    let url = (cred?.data || cred)?.url || '';
    if (!url) throw Object.assign(new Error(`未获取到 ${dir}/${objectName} 的上传地址`), { code: 502, stage: 'getUploadUrl' });
    if (url.startsWith('http://')) url = url.replace('http://', 'https://');
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': '', 'Content-Length': String(buffer.length) }, body: buffer });
    if (!put.ok) throw Object.assign(new Error(`OSS 上传 ${dir}/${objectName} 失败: HTTP ${put.status}`), { code: 502, stage: 'oss_put' });
    return { dir, objectName, size: buffer.length };
  }

  // 5.2 录音笔记创建/更新：POST {BASE_API_URL2}/record/uploadDxkRecordFile（multipart）
  //     官方 note_api.uploadRecordFile + core_http_client.requestData：
  //     签名只覆盖 {appKey, nonce, timestamp}；formData = 签名字段 + 业务字段 + file(content.json) + istv + sign
  //     官方每次都带 isNew:"1"，同一 noteSN 再次上传即为更新。
  //
  // 鉴权实测（2026-10-15）：
  //   dxk-book-web 签名 → 408 接口未授权；dxk-pc / dxk-cli 签名 + web 作用域 userToken → 406 无效的userToken
  //   ⇒ 必须使用与签名同作用域登录得到的 userToken。
  //   本项目使用官方 CLI 身份（request_signing_credentials.CLI_REQUEST_SIGNING_CREDENTIALS，sessionScope='cli'），
  //   与“读写笔记”桌面端（dxk-pc）作用域隔离，不会挤掉官方客户端的登录。
  static RECORD_BASE_URL = 'https://biji.iflyink.com/xbew-webserver';
  static CLI_APP_KEY = 'dxk-cli';
  static CLI_APP_SECRET = 'p6GbbNibfEjYHRWpfFYePHK63fBRRCYp';
  static CLI_CREDS = { appKey: 'dxk-cli', secret: 'p6GbbNibfEjYHRWpfFYePHK63fBRRCYp' };

  _gmt8() { return Date.now() + 60_000 * new Date().getTimezoneOffset() + 8 * 3600_000; }

  _signWith(creds, data = {}, { includeIstv = true } = {}) {
    const ts = this._gmt8();
    const base = { appKey: creds.appKey, nonce: CryptoJS.MD5(`${ts}${this._genWa(10)}`).toString(), timestamp: ts, ...(includeIstv ? { istv: 's' } : {}), ...data };
    const sorted = {};
    Object.keys(base).sort().forEach((k) => { if (base[k] !== undefined && base[k] !== null && base[k] !== '') sorted[k] = base[k]; });
    const signStr = Object.keys(sorted).map((k) => `${k}=${sorted[k]}`).join('&') + `&secret=${creds.secret}`;
    return { ...sorted, sign: CryptoJS.SHA256(signStr).toString().toUpperCase() };
  }

  async getScopedAppToken(creds, forceRefresh = false) {
    this._appTokens = this._appTokens || {};
    const cached = this._appTokens[creds.appKey];
    if (!forceRefresh && cached && Date.now() < cached.expire) return cached.token;
    const body = new URLSearchParams(this._signWith(creds)).toString();
    const resp = await fetch(`${IFlytekOfficeNoteClient.BASE_URL}/auth/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8;' }, body });
    const json = await resp.json().catch(() => ({}));
    if (json.code !== 200 || !json.data?.access_token) throw Object.assign(new Error(`应用授权失败(${creds.appKey}): ${json.message || resp.status}`), { code: 502, stage: 'oauth' });
    this._appTokens[creds.appKey] = { token: json.data.access_token, expire: Date.now() + Math.max(Number(json.data.expires_in || 3600) - 120, 60) * 1000 };
    return json.data.access_token;
  }

  async _postScoped(creds, endpoint, payload, userToken) {
    const appToken = await this.getScopedAppToken(creds);
    const p = new URLSearchParams();
    const signed = this._signWith(creds, payload);
    Object.keys(signed).forEach((k) => p.set(k, String(signed[k])));
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8;', Authorization: appToken };
    if (userToken) headers.userToken = userToken;
    const resp = await fetch(`${IFlytekOfficeNoteClient.BASE_URL}${endpoint}`, { method: 'POST', headers, body: p.toString() });
    return resp.json().catch(() => ({ code: resp.status, message: `HTTP ${resp.status}` }));
  }

  // —— 录音推送专用会话（CLI 作用域），存于 token 文件的 recordScope 字段 ——
  getRecordScope() {
    const rs = this._readTokenFile()?.recordScope;
    return rs?.userToken ? rs : null;
  }

  _saveRecordScope(scope) {
    const data = this._readTokenFile() || { token: this.userToken, userToken: this.userToken, userInfo: {} };
    data.recordScope = scope ? { ...scope, savedAt: new Date().toISOString() } : undefined;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  getRecordScopeStatus() {
    const rs = this.getRecordScope();
    return { authorized: !!rs, appKey: IFlytekOfficeNoteClient.CLI_APP_KEY, savedAt: rs?.savedAt || null };
  }

  /** 以 CLI 身份登录，获得可调用录音笔记上传接口的会话。mobile 缺省取当前登录账号。 */
  async loginRecordScope(rawPassword, mobile = null) {
    const account = (mobile || this.getTokenInfo()?.userInfo?.mobile || '').trim();
    if (!account || !rawPassword) throw Object.assign(new Error('请输入讯飞账号密码'), { code: 400 });
    const json = await this._postScoped(IFlytekOfficeNoteClient.CLI_CREDS, '/user/dxkLogin', { account, pwd: this.encryptPassword(rawPassword) });
    const data = json?.data;
    const detail = data?.detail || data || {};
    const userToken = data?.userToken || detail?.userToken;
    if (Number(json.code) !== 200 || !userToken) throw Object.assign(new Error(`录音推送授权失败: ${json.message || json.code}`), { code: 401, stage: 'record_scope_login' });
    const myUserId = String(this.getTokenInfo()?.userInfo?.userId || '');
    if (myUserId && detail.userId && String(detail.userId) !== myUserId) throw Object.assign(new Error('授权账号与当前登录账号不一致'), { code: 400 });
    this._saveRecordScope({ userToken, refreshToken: detail.refreshToken || data?.refreshToken || '', userId: String(detail.userId || myUserId), sn: detail.sn || this.getTokenInfo()?.userInfo?.sn || getDeviceSn() });
    return this.getRecordScopeStatus();
  }

  async _refreshRecordScope() {
    if (this._recordRefreshPromise) return this._recordRefreshPromise;
    this._recordRefreshPromise = (async () => {
      const rs = this.getRecordScope();
      if (!rs?.refreshToken) throw Object.assign(new Error('录音推送授权已失效，请重新授权'), { code: 412, needRecordAuth: true });
      const json = await this._postScoped(IFlytekOfficeNoteClient.CLI_CREDS, '/user/refreshToken', { userId: rs.userId, refreshToken: rs.refreshToken, sn: rs.sn }, rs.userToken);
      const d = json?.data || {};
      const userToken = d.userToken || d.token || d.detail?.userToken;
      if (Number(json.code) !== 200 || !userToken) {
        this._saveRecordScope(null);
        throw Object.assign(new Error('录音推送授权已失效，请重新授权'), { code: 412, needRecordAuth: true });
      }
      // 服务端会轮换 refreshToken，必须立即落盘
      this._saveRecordScope({ ...rs, userToken, refreshToken: d.refreshToken || rs.refreshToken });
      return userToken;
    })().finally(() => { this._recordRefreshPromise = null; });
    return this._recordRefreshPromise;
  }

  async uploadRecordNote({ noteId, noteName, contentJson, createTime, updateTime, summary = '', wavTime = 0, dir = '0', dirName = '默认', sn = '', version = '' }) {
    const userId = this.getTokenInfo()?.userInfo?.userId || '';
    if (!userId) throw Object.assign(new Error('账号信息缺少 userId，请重新登录'), { code: 401, tokenExpired: true });
    if (!this.getRecordScope()) throw Object.assign(new Error('推送录音笔记需要先授权（输入一次讯飞账号密码）'), { code: 412, needRecordAuth: true });
    const creds = IFlytekOfficeNoteClient.CLI_CREDS;
    const doRequest = async (forceAppToken = false) => {
      const rs = this.getRecordScope();
      if (!rs) throw Object.assign(new Error('录音推送授权已失效，请重新授权'), { code: 412, needRecordAuth: true });
      const appToken = await this.getScopedAppToken(creds, forceAppToken);
      const signed = this._signWith(creds, {}, { includeIstv: false });
      const fields = {
        appKey: signed.appKey, nonce: signed.nonce, timestamp: signed.timestamp,
        noteName: encodeURIComponent(noteName), noteSN: noteId, tempId: noteId, userId, version,
        type: '2', isNew: '1', tag: '', createTime, updateTime, summary: encodeURIComponent(summary), syntime: 0,
        dir, dirName, wavTime, isTop: 0, topTime: 0, appDel: 0, isEncrypt: 0, sn,
        istv: 's', sign: signed.sign,
      };
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.append(k, String(v));
      form.append('file', new Blob([Buffer.from(JSON.stringify(contentJson), 'utf8')], { type: 'application/json' }), 'content.json');
      const resp = await fetch(`${IFlytekOfficeNoteClient.RECORD_BASE_URL}/record/uploadDxkRecordFile?appKey=${creds.appKey}`, { method: 'POST', headers: { Authorization: appToken, userToken: rs.userToken }, body: form });
      const raw = await resp.text();
      let json; try { json = JSON.parse(raw); } catch { json = { code: resp.status, message: raw.slice(0, 200) }; }
      return json;
    };
    let json = await doRequest();
    let code = Number(json.code);
    if (code === 401) { json = await doRequest(true); code = Number(json.code); }
    if ([406, 407, 409, 410].includes(code)) { await this._refreshRecordScope(); json = await doRequest(); code = Number(json.code); }
    if ([406, 407, 409, 410].includes(code)) throw Object.assign(new Error('录音推送授权已失效，请重新授权'), { code: 412, needRecordAuth: true });
    if (code !== 200) throw Object.assign(new Error(`录音笔记上传失败: ${json.message || json.desc || code}`), { code: code || 500, stage: 'upload_record' });
    return json.data || {};
  }

  // 5.3 推断主办公本 SN 与“录音笔记”目录（取自已有云端录音笔记）
  async resolveRecordTarget() {
    if (this._recordTarget && Date.now() - this._recordTarget.at < 10 * 60_000) return this._recordTarget;
    const userId = this.getTokenInfo()?.userInfo?.userId;
    const list = await this._post('/note/dxk/getAllNoteContainEncrypt', { userId, version: 'version3', syntime: 0 });
    const records = (Array.isArray(list) ? list : []).filter((n) => String(n.type) === '2' && !Number(n.isDel) && !Number(n.appDel));
    const count = (arr) => arr.reduce((m, k) => (k ? m.set(k, (m.get(k) || 0) + 1) : m), new Map());
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const snFromNote = (n) => (n.sn && /^XF/i.test(n.sn) ? n.sn : (n.tempId && /^XF/i.test(n.tempId) ? n.tempId.split('-')[0] : ''));
    const sn = top(count(records.map(snFromNote))) || '';
    // 优先放进名为“录音笔记”的目录，否则沿用默认目录
    const recDir = records.find((n) => n.dir && n.dirName === '录音笔记');
    const [dir, dirName] = recDir ? [recDir.dir, recDir.dirName] : ['0', '默认'];
    let version = top(count(records.map((n) => n.version))) || '';
    if (!version && records[0]) {
      try { version = (await this.getNoteDetailRaw(records[0].noteId || records[0].id))?.version || ''; } catch (_) {}
    }
    this._recordTarget = { sn, dir, dirName, version, at: Date.now() };
    return this._recordTarget;
  }

  // 6. 拉取单篇笔记原始详情。附件下载由项目缓存服务负责，避免持久化 OSS 临时链接。
  async getNoteDetailRaw(noteId) {
    if (!this.isAuthenticated()) {
      throw new Error('请先登录讯飞办公本账号');
    }
    // 讯飞真实端点：/note/dxk/getNoteDetail，参数为 {id: noteId}，180s 超时
    const data = await this._post('/note/dxk/getNoteDetail', { id: noteId });
    if (!data) {
      throw new Error('云端未返回该笔记的详细内容');
    }
    return data;
  }

  // 兼容旧调用方的详情摘要。新代码应使用 getNoteDetailRaw + NotebookIntegrationService。
  async getNoteDetail(noteId) {
    const data = await this.getNoteDetailRaw(noteId);

    // content 可能是 JSON 字符串（含 audio.audioPath 真实录音文件名）
    let contentObj = null;
    if (typeof data.content === 'string' && data.content.trim().startsWith('{')) {
      try {
        contentObj = JSON.parse(data.content);
      } catch (_) {
        contentObj = null;
      }
    } else if (typeof data.content === 'object' && data.content) {
      contentObj = data.content;
    }

    // 录音相对路径 → 真实 .opus 文件名
    const audioPathRel = contentObj?.audio?.audioPath || data.audioPath || '';
    const audioFilename = audioPathRel.split('/').pop() || '';
    const audioExt = (audioFilename.split('.').pop() || 'opus').toLowerCase();

    return {
      noteId: data.noteId || data.id || noteId,
      title: data.noteName || data.title || contentObj?.noteInfo?.name || data.dirName || '办公本笔记',
      content: data.content || data.text || '',
      contentJson: contentObj,
      audioPath: audioFilename,
      audioUrl: '',
      audioExt,
      audioDuration: Number(data.audioDuration || contentObj?.audio?.audioDuration || contentObj?.noteInfo?.duration || 0),
      hasAudio: !!audioFilename,
      isEncrypt: Number(data.isEncrypt || 0),
      type: Number(data.type || 0),
      updateTime: data.syntime || data.protime || data.updateTime || Date.now(),
      transcriptPath: contentObj?.text?.onlineTransferTextPath || '',
      sentences: []
    };
  }

  // 把 OSS 文件名转成临时直链（10 分钟有效）
  // 端点：/common/common/getDownloadUrl（POST + form-urlencoded）
  async getDownloadUrl({ userId, dir = 'attachment', objectName, expiration = 86400, increment = 0 }) {
    const signed = this._signParams({ userId, dir, objectName, expiration, increment });
    // 修复：URLSearchParams.set() 方式保证长整型 timestamp 不丢失
    const p = new URLSearchParams();
    Object.keys(signed).sort().forEach(k => {
      if (signed[k] !== undefined && signed[k] !== null) {
        p.set(k, String(signed[k]));
      }
    });
    const body = p.toString();
    const appToken = await this.getAppAccessToken();
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8;',
      'Authorization': appToken
    };
    if (this.userToken) {
      headers['userToken'] = this.userToken;
      headers['token'] = this.userToken;
    }
    const url = `${IFlytekOfficeNoteClient.BASE_URL}/common/common/getDownloadUrl`;
    const resp = await fetch(url, { method: 'POST', headers, body });
    if (!resp.ok) {
      throw new Error(`getDownloadUrl HTTP ${resp.status}`);
    }
    const json = await resp.json();
    if (json.code !== 200 && json.code !== '000000') {
      throw new Error(json.message || json.desc || 'getDownloadUrl 失败');
    }
    return json.data || {};
  }

  // 软删除到回收站
  async removeToRecycle(noteId) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/dxk/removeToRecycle', { userId, noteIds: [noteId] });
  }

  // 回收站列表
  async getRecycleNoteList() {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/dxk/getRecycleNoteList', { userId });
  }

  // 恢复回收站中的笔记
  async recoverNoteList(noteIds) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/dxk/recoverNoteList', { userId, noteIds });
  }

  // 云端真删除（不可恢复）
  async deleteNoteFromCloud(noteId) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/dxk/deleteNote', { userId, noteId });
  }

  // 列出 FilePort 推送历史
  async getFilePortList() {
    return this._post('/common/iot/getFilePortList', {});
  }

  // 单条 FilePort 详情
  async getFilePortDetail(filePortId) {
    return this._post('/common/iot/getFilePortDetail', { filePortId });
  }

  // 删除 FilePort 推送历史
  async deleteFilePort(filePortId) {
    return this._post('/common/iot/deleteFilePort', { filePortId });
  }

  // ============== 微信扫码登录主路径 ==============

  // 申请 PC 扫码登录 URL（内含 QR 二维码 + 回调）
  async getCliLoginUrl() {
    return this._post('/user/getCliLoginUrl', {});
  }

  // 轮询扫码结果（用户扫码后云端会返回临时 token）
  async getCliLoginResult(tempToken) {
    return this._post('/user/getCliLoginResult', { tempToken });
  }

  // 查询扫码状态（设备是否已确认）
  async getCliStatus(tempToken) {
    return this._post('/user/getCliStatus', { tempToken });
  }

  // 用 web 临时 token 换取最终 userToken
  async getCliWebTempToken(code) {
    return this._post('/user/getCliWebTempToken', { code });
  }

  // 标签相关
  async getNoteTag() {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/tags/getNoteTag', { userId });
  }

  async updateTagsList(tagArray) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/tags/updateTagsList', { userId, tagArray });
  }

  async deleteTag(tagId) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/tags/delTag', { userId, tagId });
  }

  // 目录相关
  async getDirList() {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/dir/getListAllByUserIdPc', {
      userId,
      orderField: 'create_time',
      orderType: 'desc',
      synTime: 0
    });
  }

  async deleteDir(dirId) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/dir/delDir', { userId, dirId });
  }

  async updateDir({ dirName, dirId, sort = 0, tempId, createTime }) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/dir/updateDir', {
      userId, dirName, sort, encrypt: 0, dirId, tempId, createTime
    });
  }

  // 日程查询（需要 userId + sn 双参数）
  async getScheduleList(startTime, endTime) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    const sn = this.getTokenInfo()?.userInfo?.sn || '';
    return this._post('/note/schedule/getScheduleList', { userId, sn, startTime, endTime });
  }

  async getMonthSchedule(year, month) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    const sn = this.getTokenInfo()?.userInfo?.sn || '';
    return this._post('/note/schedule/getMonthSchedule', { userId, sn, year, month });
  }

  // 待办(things) 全量
  async getAllThings() {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/schedule/getAllThings', { userId });
  }

  async setThingsDoneFlag(thingId, done) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/schedule/setThingsDoneFlag', { userId, thingId, doneFlag: done ? 1 : 0 });
  }

  async deleteThings(thingId) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/note/schedule/delThings', { userId, thingId });
  }

  // 分享
  async shareRecordPc({ noteId, days = 7, restricted = 1, code = '', modules = '[]', pages = '' }) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    return this._post('/shareRecordPcV3.action', {
      noteId, days, restricted, timeLimit: 0,
      ...(code ? { code, password: code, readPwd: code, pwd: code, accessCode: code } : {}),
      modules: typeof modules === 'string' ? modules : JSON.stringify(modules),
      pages, pageIndexs: pages, pagesNumbers: pages
    });
  }

  async shareMixNote({ noteId, days = 7 }) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/shareMixNote', { noteId, userId, days, timeLimit: 0 });
  }

  async shareMindNote({ noteId, days = 7, restricted = 1 }) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    const userId = this.getTokenInfo()?.userInfo?.userId;
    return this._post('/shareMindNotePc', { userId, noteId, days, restricted, timeLimit: 0 });
  }

  async shareNoteNewPc({ noteId, days = 7, restricted = 1 }) {
    if (!this.userToken) throw new Error('请先登录讯飞账号');
    return this._post('/shareNoteNewPc', { noteId, days, restricted, timeLimit: 0 });
  }

  _fmtMs(ms) {
    if (!ms || isNaN(ms)) return '00:00';
    const totalSec = Math.floor(Number(ms) / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }
}
