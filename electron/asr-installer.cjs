const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const MODEL_SHA = '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe';
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

// Only fixed, app-owned operations; never accepts a renderer-supplied command or path.
function installerScript(job, home) {
  return `#!/bin/bash
set -e
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export HOMEBREW_NO_ANALYTICS=1 HOMEBREW_NO_AUTO_UPDATE=1
job=${quote(job)}
model_dir=${quote(path.join(home, '.cache/whisper'))}
echo $$ > "$job/pid"
exec > >(tee -a "$job/install.log") 2>&1
stage() { printf '%s' "$1" > "$job/stage.tmp"; mv "$job/stage.tmp" "$job/stage"; }
trap 'stage error' EXIT
stage dependencies
brew_bin=''
for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if [ -x "$candidate" ]; then brew_bin="$candidate"; break; fi
done
if [ -z "$brew_bin" ]; then
  stage authorization
  echo 'OpeniFLYTEK 正在准备本地语音组件。如需授权，请在此输入 Mac 登录密码（输入不回显）。'
  /usr/bin/sudo -v
  /usr/bin/curl --fail --location --proto '=https' --connect-timeout 20 --max-time 180 --retry 2 https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$job/homebrew.sh"
  NONINTERACTIVE=1 /bin/bash "$job/homebrew.sh"
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$candidate" ]; then brew_bin="$candidate"; break; fi
  done
fi
[ -n "$brew_bin" ]
stage dependencies
"$brew_bin" install whisper-cpp ffmpeg
stage model
mkdir -p "$model_dir"
model="$model_dir/ggml-base.bin"
verify_model() { [ -f "$1" ] && [ "$(/usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}')" = '${MODEL_SHA}' ]; }
if ! verify_model "$model"; then
  /usr/bin/curl --fail --location --proto '=https' --connect-timeout 20 --max-time 3600 --retry 2 https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o "$job/model.partial"
  verify_model "$job/model.partial"
  mv "$job/model.partial" "$model"
fi
stage verifying
ffmpeg -version
ffmpeg -v error -f lavfi -i anullsrc=r=16000:cl=mono -t 1 -y "$job/check.wav"
whisper-cli -m "$model" -f "$job/check.wav" -l zh -nt
rm -f "$job/check.wav"
stage complete
trap - EXIT
echo 'OpeniFLYTEK：本地语音组件已准备完成，可以关闭此窗口。'
`;
}

function createAsrInstaller({home=os.homedir(), platform=process.platform, launch=spawn}={}) {
  const root = path.join(home, 'Library/Application Support/VIAIM Studio/asr-install');
  const job = path.join(root, 'active');
  const labels = {starting:'正在准备安装…', authorization:'请在自动打开的安装窗口中完成 Mac 权限授权', dependencies:'正在安装识别引擎与音频工具…', model:'正在下载并校验中文/多语种模型（约 148 MB）…', verifying:'正在验证模型和识别引擎…', complete:'本地语音组件安装完成', error:'安装未完成，可查看安装日志后重试'};
  function status() {
    if (!fs.existsSync(job)) return {state:'idle', message:'', running:false};
    let stage='starting';
    try {stage=fs.readFileSync(path.join(job,'stage'),'utf8').trim();}catch{}
    let running=!['complete','error'].includes(stage);
    if (running) {
      try {const pid=Number(fs.readFileSync(path.join(job,'pid'),'utf8'));if(!Number.isSafeInteger(pid)||pid<=1)throw Error();process.kill(pid,0);}
      catch {if(Date.now()-fs.statSync(job).birthtimeMs>30000) {stage='error';running=false;}}
    }
    let downloaded=0;
    try {downloaded=fs.statSync(path.join(job,'model.partial')).size;}catch{}
    return {state:stage, running, message:labels[stage]||labels.error, downloadedBytes:downloaded, totalBytes:147951465};
  }
  function start() {
    if(platform!=='darwin')throw new Error('一键安装目前支持 macOS 桌面版。');
    if(status().running)return status();
    fs.mkdirSync(root,{recursive:true,mode:0o700});
    if(fs.existsSync(job))fs.renameSync(job,path.join(root,`previous-${Date.now()}`));
    fs.mkdirSync(job,{mode:0o700});
    fs.writeFileSync(path.join(job,'stage'),'starting');
    const script=path.join(job,'install.command');
    fs.writeFileSync(script,installerScript(job,home),{mode:0o700});
    const hasBrew=['/opt/homebrew/bin/brew','/usr/local/bin/brew'].some(p=>fs.existsSync(p));
    // Homebrew bootstrap needs a TTY for sudo. Existing Homebrew installs run in background.
    const child=hasBrew
      ? launch('/bin/bash',[script],{detached:true,stdio:'ignore'})
      : launch('/usr/bin/open',['-a','Terminal',script],{stdio:'ignore'});
    child.on('error',()=>fs.writeFileSync(path.join(job,'stage'),'error'));
    child.on('exit',code=>{if(code!==0)fs.writeFileSync(path.join(job,'stage'),'error');});
    child.unref();
    return status();
  }
  return {start,status,logPath:()=>path.join(job,'install.log')};
}
module.exports={createAsrInstaller,installerScript,MODEL_SHA};
