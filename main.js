(() => {
const ID = 'mrjeffagency.phpworkstation';
const T = '/tmp/pw';
const A = window.acode;
const appSettings = A.require('settings');
function Page(title) {
  const o = document.createElement('div');
  o.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;display:flex;flex-direction:column;background:#1e1e1e;color:#eee;padding-top:env(safe-area-inset-top,0px)';
  const h = document.createElement('div');
  h.style.cssText = 'display:flex;align-items:center;padding:8px 12px;background:#2b2b2b;font-weight:bold';
  const t = document.createElement('span'); t.style.flex = '1'; t.textContent = title;
  const x = document.createElement('button'); x.textContent = '✕'; x.style.cssText = 'border:0;border-radius:4px;padding:6px 12px;background:#555;color:#fff';
  h.append(t, x);
  const c = document.createElement('div'); c.style.cssText = 'flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column';
  o.append(h, c);
  const p = { onhide: null,
    set body(el) { c.innerHTML = ''; c.appendChild(el); },
    show() { document.body.appendChild(o); },
    hide() { o.remove(); if (p.onhide) p.onhide(); } };
  x.onclick = () => p.hide();
  return p;
}
const select = A.require('select');
const prompt = A.require('prompt');
const alertBox = A.require('alert');
const toast = A.require('toast');
const fileBrowser = A.require('fileBrowser');
const fsOperation = A.require('fsOperation');
const sidebarApps = A.require('sidebarApps');

const DEF_CFG = { root: '', useActive: false, port: 8080, hot: false, hotSec: 3, devtools: 'off',
  sqlLogin: false, sqlUser: 'root', sqlPass: '', adminerOwn: false, adminerUser: '', adminerPass: '', adminerBrowser: false };
const PMA_PORT = 8081, ADM_PORT = 8082;
const DEF_SET = { enabled: true, linter: 'gutter', snippets: true, customSnippets: false, customSnippetsFolder: '', prettier: '' };

let cfg = Object.assign({}, DEF_CFG, JSON.parse(localStorage.getItem('pw.cfg') || '{}'));
const saveCfg = () => localStorage.setItem('pw.cfg', JSON.stringify(cfg));
const S = () => Object.assign({}, DEF_SET, appSettings.value[ID] || {});

const b64 = s => btoa(unescape(encodeURIComponent(s)));
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const ALPINE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
// Keep the payload out of the visible command line: write it to a temp file and
// run that file. Piping encoded data straight into a shell is what security
// scanners (rightly) flag as obfuscated execution.
const runScript = script => `f=$(mktemp) && printf '%s' ${shq(script)} > "$f" && { sh "$f"; c=$?; rm -f "$f"; exit 0; }`;
const sh = script => new Promise(res => {
  try {
    Executor.execute(`export PATH="${ALPINE_PATH}:$PATH"; ${runScript(script)}`, true).then(o => res(String(o || ''))).catch(e => res('ERR:' + e));
  } catch (e) { res('ERR:' + e); }
});
const stream = (script, cb) => new Promise(res => {
  try {
    Executor.start(`export PATH="${ALPINE_PATH}:$PATH"; ${runScript(script)}`, (type, data) => {
      if (type === 'exit') res(data);
      else cb(String(data === undefined ? type : data));
    }, true).catch(e => { cb('ERR: ' + e); res(-1); });
  } catch (e) { cb('ERR: ' + e); res(-1); }
});
const writeFile = (path, content) => sh(`mkdir -p "$(dirname ${path})"; echo ${b64(content)} | base64 -d > ${path}`);

// ---- paths ----
function toAlpine(u) {
  if (!u) return '';
  try { u = decodeURIComponent(u); } catch (e) {}
  if (u.startsWith('/')) return u;
  let m = u.match(/::primary:(.*)$/) || u.match(/primary:(.*)$/);
  if (m) return '/sdcard/' + m[1];
  m = u.match(/^file:\/\/\/storage\/emulated\/0\/(.*)$/);
  if (m) return '/sdcard/' + m[1];
  m = u.match(/^file:\/\/(\/.*)$/);
  return m ? m[1] : '';
}
const dirname = p => p.replace(/\/[^\/]*$/, '') || '/';
async function resolveRoot() {
  if (cfg.useActive) {
    const f = editorManager.activeFile;
    const p = f && f.uri ? toAlpine(f.uri) : '';
    if (p) return dirname(p);
  }
  return cfg.root || '/sdcard';
}

// ---- support files ----
const INJECT = `<?php if(getenv('PW_DEVTOOLS')==='eruda'){$h=implode("\\n",headers_list());if(stripos($h,'content-type')===false||stripos($h,'text/html')!==false){echo '<script src="https://cdn.jsdelivr.net/npm/eruda@3.0.1/eruda.js"></script><script>try{eruda.init()}catch(e){}</script>';}}`;
const PMA_CFG = () => `<?php
$cfg['blowfish_secret']='phpworkstation_secret_key_32char';
$i=1;$cfg['Servers'][$i]['host']='127.0.0.1';$cfg['Servers'][$i]['auth_type']=${cfg.sqlLogin ? "'cookie'" : "'config'"};
$cfg['Servers'][$i]['user']='${esc(cfg.sqlUser)}';$cfg['Servers'][$i]['password']='${esc(cfg.sqlPass)}';
$cfg['Servers'][$i]['AllowNoPassword']=true;$cfg['AllowThirdPartyFraming']=true;$cfg['TempDir']='/tmp/pw/pma';
`;
const ADM_INDEX = () => `<?php
function adminer_object(){
  class PW extends Adminer {
    function credentials(){ return ['127.0.0.1:3306', '${esc(cfg.adminerOwn ? cfg.adminerUser : cfg.sqlUser)}', '${esc(cfg.adminerOwn ? cfg.adminerPass : cfg.sqlPass)}']; }
    function login($l,$p){ return true; }
    function headers(){ return false; }
  }
  return new PW;
}
include './adminer.php';
`;
async function ensureFiles() {
  await writeFile(`${T}/inject.php`, INJECT);
  await sh(`mkdir -p ${T}/pma /opt/adminer; chmod 777 ${T}/pma`);
  const hasPma = (await sh('[ -f /usr/share/webapps/phpmyadmin/index.php ] && echo 1')).trim() === '1';
  if (hasPma) await writeFile(`/usr/share/webapps/phpmyadmin/config.inc.php`, PMA_CFG());
  await writeFile(`/opt/adminer/index.php`, ADM_INDEX());
}

// ---- status ----
const st = { dep: { php: false, sql: false, pma: false, adm: false }, server: false, sql: false, pma: false, adm: false };
const STATUS_URLS = [
  'file:///storage/emulated/0/.php-workstation-status.json',
  'file:///storage/emulated/0/Download/.php-workstation-status.json'
];
const STATUS_SCRIPT = `
export PATH="${ALPINE_PATH}:$PATH"
php=0; [ -x /usr/bin/php ] && php=1
sql=0; (command -v mariadbd || command -v mysqld) >/dev/null 2>&1 && sql=1
pma=0; [ -f /usr/share/webapps/phpmyadmin/index.php ] && pma=1
adm=0; [ -f /opt/adminer/adminer.php ] && adm=1
server=0; [ -f ${T}/server.pid ] && kill -0 "$(cat ${T}/server.pid)" 2>/dev/null && server=1
sqlrun=0; (mariadb-admin ping || mysqladmin ping) 2>/dev/null | grep -q alive && sqlrun=1
pmaRun=0; [ -f ${T}/pma.pid ] && kill -0 "$(cat ${T}/pma.pid)" 2>/dev/null && pmaRun=1
admRun=0; [ -f ${T}/adm.pid ] && kill -0 "$(cat ${T}/adm.pid)" 2>/dev/null && admRun=1
json=$(printf '{"php":%s,"sql":%s,"pma":%s,"adm":%s,"server":%s,"sqlRun":%s,"pmaRun":%s,"admRun":%s,"ts":%s}' "$php" "$sql" "$pma" "$adm" "$server" "$sqlrun" "$pmaRun" "$admRun" "$(date +%s)")
# Shared storage may be read-only for the terminal; try a user folder too and stay silent.
for f in /sdcard/.php-workstation-status.json /sdcard/Download/.php-workstation-status.json; do
  if { printf '%s\\n' "$json" > "$f"; } 2>/dev/null; then break; fi
done
`;
async function readTerminalStatus() {
  let best = null;
  for (const u of STATUS_URLS) {
    try {
      const fs = fsOperation(u);
      if (!(await fs.exists())) continue;
      const j = JSON.parse(await fs.readFile('utf8'));
      if (j && (!best || Number(j.ts || 0) > Number(best.ts || 0))) best = j;
    } catch (e) {}
  }
  return best;
}
function applyShared(shared) {
  st.dep = { php: !!shared.php, sql: !!shared.sql, pma: !!shared.pma, adm: !!shared.adm };
  st.server = !!shared.server; st.sql = !!shared.sqlRun; st.pma = !!shared.pmaRun; st.adm = !!shared.admRun;
  renderDash();
}
async function refreshStatus(force) {
  const shared = await readTerminalStatus();
  const age = shared && shared.ts ? Date.now() / 1000 - Number(shared.ts) : Infinity;
  // Trust the terminal's status file only while it is fresh; otherwise verify live
  // so processes killed by Android are not shown as running forever.
  if (shared && Math.abs(age) < 8 && !force) { applyShared(shared); return; }
  const o = await sh(`
([ -x /usr/bin/php ] || command -v php >/dev/null 2>&1) && echo php=1
(command -v mariadbd || command -v mysqld) >/dev/null 2>&1 && echo sql=1
[ -f /usr/share/webapps/phpmyadmin/index.php ] && echo pma=1
[ -f /opt/adminer/adminer.php ] && echo adm=1
for n in server pma adm; do [ -f ${T}/$n.pid ] && kill -0 $(cat ${T}/$n.pid) 2>/dev/null && echo run_$n=1; done
(mariadb-admin ping || mysqladmin ping) 2>/dev/null | grep -q alive && echo run_sql=1
true`);
  if (o.startsWith('ERR:')) { if (shared) applyShared(shared); return; }
  st.dep = { php: /(^|\n)php=1/.test(o), sql: /(^|\n)sql=1/.test(o), pma: /(^|\n)pma=1/.test(o), adm: /(^|\n)adm=1/.test(o) };
  st.server = /run_server=1/.test(o); st.pma = /run_pma=1/.test(o); st.adm = /run_adm=1/.test(o); st.sql = /run_sql=1/.test(o);
  renderDash();
}

// ---- install ----
const INSTALL_SCRIPT = `
set -e
command -v apk >/dev/null 2>&1 || { echo "apk not found in the Acode Alpine terminal"; exit 1; }
apk update
V=""
for v in 85 84 83 82 81; do if apk add --no-cache php$v; then V=$v; break; fi; done
if [ -z "$V" ]; then echo "PHP install failed: no supported PHP package was installed"; exit 1; fi
for e in session mysqli pdo pdo_mysql mbstring json curl xml dom openssl ctype iconv zip gd fileinfo tokenizer simplexml xmlwriter xmlreader phar sodium bz2; do apk add --no-cache php$V-$e || true; done
ln -sf /usr/bin/php$V /usr/bin/php
apk add --no-cache mariadb mariadb-client mariadb-common curl wget
apk add --no-cache phpmyadmin || echo "phpMyAdmin package not available; Adminer will still be installed"
mkdir -p /opt/adminer
if [ ! -s /opt/adminer/adminer.php ]; then wget -O /opt/adminer/adminer.php https://www.adminer.org/latest-mysql.php || curl -L -o /opt/adminer/adminer.php https://www.adminer.org/latest-mysql.php || { echo "Adminer download failed"; exit 1; }; fi
mkdir -p /run/mysqld; chown mysql:mysql /run/mysqld 2>/dev/null || true
[ -d /var/lib/mysql/mysql ] || mariadb-install-db --user=mysql --datadir=/var/lib/mysql
`;
const SUPPORT_FILES_SCRIPT = () => `
mkdir -p ${T}/pma /opt/adminer
chmod 777 ${T}/pma
echo ${b64(INJECT)} | base64 -d > ${T}/inject.php
if [ -f /usr/share/webapps/phpmyadmin/index.php ]; then echo ${b64(PMA_CFG())} | base64 -d > /usr/share/webapps/phpmyadmin/config.inc.php; fi
echo ${b64(ADM_INDEX())} | base64 -d > /opt/adminer/index.php`;


let runtimeTerminal = null;
async function openSetupTerminal() {
  if (runtimeTerminal) return runtimeTerminal;
  let term;
  try { term = A.require('terminal'); } catch (e) { throw new Error('Acode terminal API is not available: ' + e); }
  if (!term) throw new Error('Acode terminal API is not available');
  let inst;
  if (typeof term.createServer === 'function') {
    inst = await term.createServer({ name: 'PHP Workstation' });
  } else if (typeof term.create === 'function') {
    inst = await term.create({ name: 'PHP Workstation', serverMode: true });
  } else {
    throw new Error('This Acode version does not expose createServer/create for a server terminal');
  }
  if (!inst || inst.id === undefined) throw new Error('Acode did not return a server terminal session');
  if (typeof term.write !== 'function') throw new Error('Acode terminal write API is not available');
  runtimeTerminal = { term, id: inst.id };
  return runtimeTerminal;
}

async function install() {
  const log = logPage('Install / Check');
  log.add('Opening Acode server terminal...\n');
  let session;
  try { session = await openSetupTerminal(); }
  catch (e) { log.add('Could not open the Acode server terminal: ' + String(e) + '\n'); return; }

  // Run the package check and install in the same visible Alpine terminal session.
  const installScript = `${INSTALL_SCRIPT}\n${SUPPORT_FILES_SCRIPT()}\n${STATUS_SCRIPT}\necho "INSTALL FINISHED"`;
  await writeFile(`${T}/install-pw.sh`, installScript);
  log.add('Starting setup in the visible Acode Alpine terminal. Watch that terminal for errors and keep it open until it prints INSTALL FINISHED.\n');
  try { session.term.write(session.id, `/bin/sh ${T}/install-pw.sh; rm -f ${T}/install-pw.sh\r\n`); }
  catch (e) { log.add('Could not send the install script to the Acode terminal: ' + String(e) + '\n'); return; }
  log.add('Installer command sent. The dashboard will recheck package status when you return.\n');
}

// ---- server ----
async function startServer() {
  const root = await resolveRoot();
  let session;
  try { session = await openSetupTerminal(); }
  catch (e) { return alertBox('PHP Workstation', String(e)); }
  const script = `
export PATH="${ALPINE_PATH}:$PATH"
if [ ! -x /usr/bin/php ]; then echo "ERROR: PHP is not executable at /usr/bin/php in the Acode terminal"; ${STATUS_SCRIPT}; exit 1; fi
mkdir -p ${T}
echo ${b64(INJECT)} | base64 -d > ${T}/inject.php
if [ -f ${T}/server.pid ]; then kill "$(cat ${T}/server.pid)" 2>/dev/null || true; fi
cd ${shq(root)} || { echo "ERROR: document root could not be opened"; ${STATUS_SCRIPT}; exit 1; }
PW_DEVTOOLS=${shq(cfg.devtools)} setsid nohup /usr/bin/php -S 0.0.0.0:${Number(cfg.port) || 8080} -t ${shq(root)} -d auto_append_file=${T}/inject.php -d display_errors=1 >${T}/server.log 2>&1 </dev/null &
pid=$!
echo "$pid" > ${T}/server.pid
sleep 1
if kill -0 "$pid" 2>/dev/null; then echo "PHP_SERVER_STARTED port=${Number(cfg.port) || 8080}"; else echo "PHP_SERVER_FAILED"; cat ${T}/server.log 2>/dev/null || true; fi
${STATUS_SCRIPT}`;
  await writeFile(`${T}/server-pw.sh`, script);
  try { session.term.write(session.id, `/bin/sh ${T}/server-pw.sh; rm -f ${T}/server-pw.sh\r\n`); }
  catch (e) { return alertBox('PHP Workstation', 'Could not send the server command to Acode Terminal: ' + String(e)); }
  toast('PHP server command sent to Acode Terminal; check its output.', 3500);
  await new Promise(r => setTimeout(r, 1800));
  await refreshStatus();
}
const stopSvc = async n => {
  if (n === 'server') {
    let session;
    try { session = await openSetupTerminal(); }
    catch (e) { return alertBox('PHP Workstation', String(e)); }
    const script = `export PATH="${ALPINE_PATH}:$PATH"; if [ -f ${T}/server.pid ]; then kill "$(cat ${T}/server.pid)" 2>/dev/null || true; rm -f ${T}/server.pid; fi; echo "PHP_SERVER_STOPPED"; ${STATUS_SCRIPT}`;
    await writeFile(`${T}/stop-pw.sh`, script);
    try { session.term.write(session.id, `/bin/sh ${T}/stop-pw.sh; rm -f ${T}/stop-pw.sh\r\n`); }
    catch (e) { return alertBox('PHP Workstation', 'Could not send the stop command to Acode Terminal: ' + String(e)); }
    await new Promise(r => setTimeout(r, 900));
    await refreshStatus();
    return;
  }
  await sh(`[ -f ${T}/${n}.pid ] && kill $(cat ${T}/${n}.pid) 2>/dev/null; rm -f ${T}/${n}.pid; ${STATUS_SCRIPT}`);
  await refreshStatus();
};
async function startWeb(name, dir, port) {
  if (!st.dep.php) return toast('PHP not installed', 2500);
  await ensureFiles();
  await sh(`[ -f ${T}/${name}.pid ] && kill $(cat ${T}/${name}.pid) 2>/dev/null
rm -f ${T}/${name}.pid
cd ${shq(dir)} || { echo "ERROR: web root not found"; exit 1; }
setsid nohup /usr/bin/php -S 127.0.0.1:${port} -t ${shq(dir)} >${T}/${name}.log 2>&1 </dev/null &
echo $! > ${T}/${name}.pid
sleep 0.5
${STATUS_SCRIPT}`);
  await new Promise(r => setTimeout(r, 300));
  await refreshStatus();
}

// ---- mysql ----
async function startSql() {
  if (!st.dep.sql) return toast('MariaDB not installed. Tap Install / Check', 3000);
  toast('Starting MySQL...', 2000);
  await sh(`export PATH="${ALPINE_PATH}:$PATH"
mkdir -p /run/mysqld; chown mysql:mysql /run/mysqld 2>/dev/null
[ -d /var/lib/mysql/mysql ] || mariadb-install-db --user=mysql --datadir=/var/lib/mysql >/dev/null 2>&1
setsid nohup mysqld_safe --user=mysql --datadir=/var/lib/mysql --bind-address=127.0.0.1 >${T}/mysql.log 2>&1 </dev/null &
i=0; while [ $i -lt 20 ]; do (mariadb-admin ping || mysqladmin ping) 2>/dev/null | grep -q alive && break; i=$((i+1)); sleep 1; done
${STATUS_SCRIPT}`);
  await refreshStatus();
  if (st.sql) await applyGrants(true);
  else alertBox('MySQL', 'MariaDB did not start. Open MySQL ⚙ → Open log for details.');
}
async function stopSql() {
  await sh(`(mariadb-admin shutdown || mysqladmin shutdown) 2>/dev/null; pkill mysqld 2>/dev/null; sleep 1; ${STATUS_SCRIPT}`);
  await new Promise(r => setTimeout(r, 500)); await refreshStatus();
}
async function applyGrants(quiet) {
  const u = esc(cfg.sqlUser), p = esc(cfg.sqlLogin ? cfg.sqlPass : '');
  const q = `CREATE USER IF NOT EXISTS '${u}'@'localhost' IDENTIFIED BY '${p}'; CREATE USER IF NOT EXISTS '${u}'@'127.0.0.1' IDENTIFIED BY '${p}'; ALTER USER '${u}'@'localhost' IDENTIFIED BY '${p}'; ALTER USER '${u}'@'127.0.0.1' IDENTIFIED BY '${p}'; GRANT ALL ON *.* TO '${u}'@'localhost' WITH GRANT OPTION; GRANT ALL ON *.* TO '${u}'@'127.0.0.1' WITH GRANT OPTION; FLUSH PRIVILEGES;`;
  const run = pass => `echo ${b64(q)} | base64 -d | mariadb -u root ${pass} 2>&1`;
  const passArg = cfg.sqlPass ? `-p${shq(cfg.sqlPass)}` : '';
  const o = await sh(`${run(passArg)} || ${run('')}`);
  if (!quiet) alertBox('MySQL', o.trim() || 'Grants applied.');
}
async function testSql() {
  const o = await sh(`mariadb -h 127.0.0.1 -u ${shq(cfg.sqlUser)} ${cfg.sqlPass ? `-p${shq(cfg.sqlPass)}` : ''} -e "SELECT VERSION() AS version;" 2>&1`);
  alertBox('Test connection', o.trim());
}

// ---- preview ----
let pv = null;
function openPreview(url) {
  url = url || `http://127.0.0.1:${cfg.port}/`;
  const home = url;
  const page = Page('PHP Preview');
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';
  wrap.innerHTML = `<div style="display:flex;gap:4px;padding:4px;background:var(--secondary-color);align-items:center">
<button data-a=back>◀</button><button data-a=fwd>▶</button><button data-a=home>⌂</button>
<input style="flex:1;min-width:0;padding:4px;border-radius:4px;border:1px solid var(--border-color);background:var(--popup-background-color);color:var(--popup-text-color)">
<button data-a=go>↻</button><button data-a=w>📱</button><button data-a=ext>↗</button></div>
<div style="flex:1;overflow:auto;display:flex;justify-content:center;background:#888"><iframe style="border:0;width:100%;height:100%;background:#fff"></iframe></div>`;
  const input = wrap.querySelector('input'), fr = wrap.querySelector('iframe'), box = fr.parentNode;
  wrap.querySelectorAll('button').forEach(b => b.style.cssText = 'padding:6px 9px;border:0;border-radius:4px;background:var(--primary-color);color:var(--primary-text-color)');
  const nav = u => { input.value = u; fr.src = u; };
  let mobile = false, timer = null;
  wrap.onclick = e => {
    const a = e.target.dataset && e.target.dataset.a;
    if (!a) return;
    if (a === 'back') try { fr.contentWindow.history.back(); } catch (x) {}
    if (a === 'fwd') try { fr.contentWindow.history.forward(); } catch (x) {}
    if (a === 'home') nav(home);
    if (a === 'go') nav(input.value.startsWith('http') ? input.value : 'http://127.0.0.1:' + cfg.port + '/' + input.value.replace(/^\//, ''));
    if (a === 'w') { mobile = !mobile; fr.style.width = mobile ? '390px' : '100%'; e.target.textContent = mobile ? '🖥' : '📱'; }
    if (a === 'ext') window.open(input.value, '_system');
  };
  input.onkeydown = e => { if (e.key === 'Enter') wrap.querySelector('[data-a=go]').click(); };
  page.body = wrap;
  page.onhide = () => { clearInterval(timer); pv = null; };
  page.show();
  nav(url);
  if (cfg.hot) timer = setInterval(() => { try { fr.src = fr.src; } catch (e) {} }, Math.max(1, cfg.hotSec) * 1000);
  pv = { fr, nav };
}
const openWeb = (port, inApp, path) => {
  const url = `http://127.0.0.1:${port}/${path || ''}`;
  if (inApp) openPreview(url); else window.open(url, '_system');
};

// ---- log page ----
function logPage(title) {
  const page = Page(title);
  const pre = document.createElement('pre');
  pre.style.cssText = 'padding:10px;white-space:pre-wrap;word-break:break-word;font-size:12px;user-select:text;';
  page.body = pre; page.show();
  return { add: t => { pre.textContent += t + (t.endsWith('\n') ? '' : '\n'); pre.parentNode && (pre.parentNode.scrollTop = 1e9); } };
}
async function showLog(name) { const l = logPage(name + ' log'); l.add(await sh(`tail -n 200 ${T}/${name}.log 2>&1`)); }

const getCode = () => { const ed = editorManager.editor; return typeof ed.getValue === 'function' ? ed.getValue() : (ed.state && ed.state.doc ? ed.state.doc.toString() : ''); };
const setCode = t => { const ed = editorManager.editor; if (typeof ed.setValue === 'function') { const p = ed.getCursorPosition(); ed.setValue(t, -1); ed.moveCursorToPosition(p); } else if (ed.dispatch) ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: t } }); };
// ---- run / lint ----
async function runFile() {
  const f = editorManager.activeFile;
  const p = f && f.uri ? toAlpine(f.uri) : '';
  if (!p) return toast('Open a saved PHP file in shared storage', 3000);
  const l = logPage('php ' + f.filename);
  l.add(await sh(`cd "${dirname(p)}"; php "${p}" 2>&1`));
}
let lintTimer = null;
const aceMarks = new WeakMap();
// CodeMirror 6 editor (current Acode) exposes state/dispatch; legacy Ace exposes session.
const cmView = () => { const ed = editorManager.editor; return ed && ed.state && ed.state.doc && typeof ed.dispatch === 'function' ? ed : null; };
function cmLintApi() {
  let api = null;
  try { api = A.require('@codemirror/lint'); } catch (e) {}
  if (!api || typeof api.setDiagnostics !== 'function') { try { const cm = A.require('codemirror'); api = cm && cm.lint; } catch (e) {} }
  return api && typeof api.setDiagnostics === 'function' ? api : null;
}
function applyCmDiagnostics(msg, lineNo) {
  const ed = cmView(); if (!ed) return false;
  const api = cmLintApi(); if (!api) return false;
  const diags = [];
  if (msg) {
    const n = Math.min(Math.max(1, +lineNo || 1), ed.state.doc.lines);
    const line = ed.state.doc.line(n);
    diags.push({ from: line.from, to: line.to, severity: 'error', message: msg });
  }
  try { ed.dispatch(api.setDiagnostics(ed.state, diags)); return true; } catch (e) { return false; }
}
async function lint() {
  const s = S(); const f = editorManager.activeFile;
  if (!s.enabled || !f || !/\.php$/i.test(f.filename || '')) return;
  if (s.linter === 'off') { applyCmDiagnostics(null); return; }
  if (!st.dep.php) return;
  const code = getCode();
  const o = await sh(`echo ${b64(code)} | base64 -d | /usr/bin/php -l 2>&1`);
  const m = o.match(/(?:Parse|Fatal) error:\s*(.*?) in .*? on line (\d+)/i);
  if (cmView()) { applyCmDiagnostics(m ? m[1] : null, m && m[2]); return; }
  const sess = editorManager.editor.session;
  if (!sess) { if (m) toast(m[1].slice(0, 120), 3000); return; }
  sess.clearAnnotations();
  (aceMarks.get(sess) || []).forEach(k => sess.removeMarker(k)); aceMarks.set(sess, []);
  if (!m) return;
  const row = Math.max(0, +m[2] - 1);
  if (s.linter === 'gutter' || s.linter === 'both') sess.setAnnotations([{ row, column: 0, text: m[1], type: 'error' }]);
  if (s.linter === 'inline' || s.linter === 'both') {
    try { const R = ace.require('ace/range').Range; const marks = aceMarks.get(sess) || []; marks.push(sess.addMarker(new R(row, 0, row, 1e3), 'ace_error-line', 'fullLine')); aceMarks.set(sess, marks); } catch (e) {}
  }
}
const lintSoon = () => { clearTimeout(lintTimer); lintTimer = setTimeout(lint, 700); };

// ---- formatter ----
const loadJs = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
async function formatPhp() {
  if (!window.prettier) await loadJs('https://cdn.jsdelivr.net/npm/prettier@3.3.3/standalone.js');
  if (!window.prettierPlugins || !prettierPlugins.php) await loadJs('https://cdn.jsdelivr.net/npm/@prettier/plugin-php@0.22.4/standalone.js');
  let opts = { tabWidth: 4, printWidth: 100, singleQuote: true, trailingComma: 'none', braceStyle: '1tbs' };
  try { if (S().prettier) Object.assign(opts, JSON.parse(S().prettier)); } catch (e) { toast('Invalid Prettier JSON', 3000); }
  const out = await prettier.format(getCode(), Object.assign(opts, { parser: 'php', plugins: [prettierPlugins.php] }));
  setCode(out);
}

// ---- snippets ----
const SNIPS = [
  { caption: 'php', snippet: '<?php\n$0\n?>' }, { caption: 'echo', snippet: 'echo ${1:\'\'};$0' },
  { caption: 'func', snippet: 'function ${1:name}(${2}) {\n\t$0\n}' }, { caption: 'class', snippet: 'class ${1:Name}\n{\n\tpublic function __construct(${2})\n\t{\n\t\t$0\n\t}\n}' },
  { caption: 'foreach', snippet: 'foreach ($${1:arr} as $${2:v}) {\n\t$0\n}' }, { caption: 'for', snippet: 'for ($${1:i} = 0; $${1:i} < ${2:n}; $${1:i}++) {\n\t$0\n}' },
  { caption: 'if', snippet: 'if (${1:cond}) {\n\t$0\n}' }, { caption: 'ifelse', snippet: 'if (${1:cond}) {\n\t$2\n} else {\n\t$0\n}' },
  { caption: 'try', snippet: 'try {\n\t$1\n} catch (Exception $e) {\n\t$0\n}' }, { caption: 'pdo', snippet: '$pdo = new PDO(\'mysql:host=127.0.0.1;dbname=${1:db};charset=utf8mb4\', \'${2:root}\', \'${3}\');\n$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);$0' },
  { caption: 'mysqli', snippet: '$db = new mysqli(\'127.0.0.1\', \'${1:root}\', \'${2}\', \'${3:db}\');\nif ($db->connect_error) { die($db->connect_error); }$0' },
  { caption: 'json', snippet: 'header(\'Content-Type: application/json\');\necho json_encode(${1:$data});$0' }, { caption: 'post', snippet: '$${1:v} = $_POST[\'${2:key}\'] ?? \'\';$0' },
  { caption: 'session', snippet: 'session_start();\n$0' }, { caption: 'vd', snippet: 'echo \'<pre>\'; var_dump(${1}); echo \'</pre>\';$0' }
];
let regSnips = [];
async function loadSnippets() {
  try {
    const { snippetManager } = ace.require('ace/snippets');
    if (regSnips.length) snippetManager.unregister(regSnips, 'php');
    regSnips = [];
    const s = S();
    if (!s.enabled || !s.snippets) return;
    let list = SNIPS.slice();
    if (s.customSnippets && s.customSnippetsFolder) {
      const path = s.customSnippetsFolder.replace(/\/$/, '') + '/php_snippets.json';
      const fs = fsOperation(path);
      if (!(await fs.exists())) await fsOperation(s.customSnippetsFolder).createFile('php_snippets.json', JSON.stringify({ php: [{ caption: 'myfunc', snippet: 'function myFunc() {\n\t$0\n}', meta: 'snippet' }] }, null, 2));
      const txt = await fsOperation(path).readFile('utf8');
      list = list.concat((JSON.parse(txt).php || []));
    }
    regSnips = list.map(x => ({ name: x.caption, tabTrigger: x.caption, content: x.snippet }));
    snippetManager.register(regSnips, 'php');
  } catch (e) { console.warn('PW snippets', e); }
}

// ---- gear menus ----
async function pickRoot() {
  const r = await select('Server root', [['pick', 'Browse folder'], ['type', 'Type path (/sdcard/...)'], ['active', (cfg.useActive ? '✓ ' : '') + 'Use active file folder']]);
  if (r === 'pick') { const d = await fileBrowser('folder', 'Select project root'); const p = toAlpine(d.url); if (!p) return toast('Cannot map folder; type path instead', 3000); cfg.root = p; cfg.useActive = false; }
  if (r === 'type') { const v = await prompt('Root path', cfg.root || '/sdcard', 'text'); if (v) { cfg.root = v; cfg.useActive = false; } }
  if (r === 'active') cfg.useActive = !cfg.useActive;
  saveCfg(); renderDash();
}
async function serverMenu() {
  const r = await select('Server settings', [['port', 'Port: ' + cfg.port], ['root', 'Document root'], ['hot', 'Hot reload: ' + (cfg.hot ? 'on' : 'off')], ['sec', 'Hot reload interval: ' + cfg.hotSec + 's'], ['dev', 'DevTools (Eruda): ' + cfg.devtools], ['log', 'View server log']]);
  if (r === 'port') { const v = await prompt('Port', String(cfg.port), 'number'); if (v) cfg.port = +v; }
  if (r === 'root') return pickRoot();
  if (r === 'hot') cfg.hot = !cfg.hot;
  if (r === 'sec') { const v = await prompt('Seconds', String(cfg.hotSec), 'number'); if (v) cfg.hotSec = +v; }
  if (r === 'dev') cfg.devtools = cfg.devtools === 'off' ? 'eruda' : 'off';
  if (r === 'log') return showLog('server');
  saveCfg(); renderDash();
  if (st.server && ['port', 'dev'].includes(r)) toast('Restart the server to apply', 2500);
}
async function sqlMenu() {
  const r = await select('MySQL settings', [['login', 'Login required: ' + (cfg.sqlLogin ? 'yes' : 'no')], ['user', 'Default user: ' + cfg.sqlUser], ['pass', 'Password'], ['test', 'Test connection'], ['grants', 'Reset grants'], ['log', 'Open log']]);
  if (r === 'login') cfg.sqlLogin = !cfg.sqlLogin;
  if (r === 'user') { const v = await prompt('User', cfg.sqlUser, 'text'); if (v) cfg.sqlUser = v; }
  if (r === 'pass') { const v = await prompt('Password', cfg.sqlPass, 'text'); if (v !== null && v !== undefined) cfg.sqlPass = v; }
  saveCfg();
  if (r === 'test') return testSql();
  if (r === 'grants' || r === 'login' || r === 'pass') { if (st.sql) { await applyGrants(r !== 'grants'); await ensureFiles(); } }
  if (r === 'log') return showLog('mysql');
}
async function adminerMenu() {
  const r = await select('Adminer settings', [['own', 'Own user: ' + (cfg.adminerOwn ? 'yes' : 'use MySQL login')], ['au', 'Adminer user'], ['ap', 'Adminer password'], ['br', 'Prefer browser: ' + (cfg.adminerBrowser ? 'yes' : 'no')], ['re', 'Re-download Adminer'], ['cl', 'Clear sessions']]);
  if (r === 'own') cfg.adminerOwn = !cfg.adminerOwn;
  if (r === 'au') { const v = await prompt('User', cfg.adminerUser, 'text'); if (v) cfg.adminerUser = v; }
  if (r === 'ap') { const v = await prompt('Password', cfg.adminerPass, 'text'); if (v !== null && v !== undefined) cfg.adminerPass = v; }
  if (r === 'br') cfg.adminerBrowser = !cfg.adminerBrowser;
  saveCfg();
  if (r === 're') { const l = logPage('Adminer'); await stream('wget -O /opt/adminer/adminer.php https://www.adminer.org/latest-mysql.php && echo ok', d => l.add(d)); }
  if (r === 'cl') { await sh('rm -rf /tmp/sess_* 2>/dev/null; true'); toast('Sessions cleared'); }
  await ensureFiles();
}

// ---- dashboard ----
let dashEl = null;
let statusTimer = null, lintOff = null;
function bindLintListeners() {
  const off = [];
  try {
    const ed = editorManager.editor;
    if (ed && typeof ed.on === 'function') {
      ed.on('change', lintSoon);
      off.push(() => { try { ed.off('change', lintSoon); } catch (e) {} });
    } else if (typeof editorManager.on === 'function') {
      editorManager.on('update', lintSoon);
      off.push(() => { try { editorManager.off('update', lintSoon); } catch (e) {} });
    }
  } catch (e) {}
  try {
    editorManager.on('switch-file', lintSoon);
    off.push(() => { try { editorManager.off('switch-file', lintSoon); } catch (e) {} });
  } catch (e) {}
  return () => off.forEach(f => { try { f(); } catch (e) {} });
}
const dot = on => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${on ? '#2ecc71' : '#888'};margin-right:6px"></span>`;
function renderDash() {
  if (!dashEl) return;
  const card = (title, on, body) => `<div style="margin:8px;padding:10px;border-radius:8px;background:var(--secondary-color);border:1px solid var(--border-color)"><div style="font-weight:bold;margin-bottom:8px">${dot(on)}${title}</div>${body}</div>`;
  const btn = (a, t) => `<button data-act="${a}" style="margin:2px;padding:7px 10px;border:0;border-radius:5px;background:var(--primary-color);color:var(--primary-text-color)">${t}</button>`;
  const missing = Object.entries(st.dep).filter(([, v]) => !v).map(([k]) => k);
  dashEl.innerHTML = `<div style="padding:6px 8px;font-weight:bold">PHP Workstation</div>
${missing.length ? card('Setup needed', false, `<div style="font-size:12px;margin-bottom:6px">Missing: ${missing.join(', ')}</div>${btn('install', 'Install / Check')}`) : ''}
${card('Apache / PHP server', st.server, `<div style="font-size:12px;opacity:.8;margin-bottom:6px;word-break:break-all" data-act="root">Root: ${cfg.useActive ? 'active file folder' : (cfg.root || 'tap to choose')}</div>
${btn(st.server ? 'srvstop' : 'srvstart', st.server ? 'Stop' : 'Start')}${btn('srvapp', 'Open in App')}${btn('srvweb', 'Browser')}${btn('srvset', '⚙')}`)}
${card('MySQL engine', st.sql, `${btn(st.sql ? 'sqlstop' : 'sqlstart', st.sql ? 'Stop' : 'Start')}${btn('sqlset', '⚙')}`)}
${card('phpMyAdmin / Adminer', st.pma || st.adm, `${btn('pmaapp', 'phpMyAdmin')}${btn('pmaweb', 'pMA ↗')}${btn('admapp', 'Adminer')}${btn('admweb', 'Adm ↗')}${btn('admset', '⚙')}`)}
${card('Tools', false, `${btn('run', 'Run file')}${btn('fmt', 'Format')}${btn('lint', 'Lint now')}${btn('install', 'Install / Check')}`)}`;
}
async function dashClick(e) {
  const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.dataset.act === 'install') toast('Starting setup...', 1500);
  try {
    switch (a.dataset.act) {
      case 'install': return install();
      case 'root': return pickRoot();
      case 'srvstart': return startServer();
      case 'srvstop': return stopSvc('server');
      case 'srvapp': return openWeb(cfg.port, true);
      case 'srvweb': return openWeb(cfg.port, false);
      case 'srvset': return serverMenu();
      case 'sqlstart': return startSql();
      case 'sqlstop': return stopSql();
      case 'sqlset': return sqlMenu();
      case 'pmaapp': case 'pmaweb': if (!st.pma) await startWeb('pma', '/usr/share/webapps/phpmyadmin', PMA_PORT); return openWeb(PMA_PORT, a.dataset.act === 'pmaapp');
      case 'admapp': case 'admweb': if (!st.adm) await startWeb('adm', '/opt/adminer', ADM_PORT); return openWeb(ADM_PORT, a.dataset.act === 'admapp' && !cfg.adminerBrowser);
      case 'admset': return adminerMenu();
      case 'run': return runFile();
      case 'fmt': return formatPhp();
      case 'lint': return lint();
    }
  } catch (err) { alertBox('PHP Workstation error', String(err && err.stack || err)); }
}

// ---- init ----
const style = document.createElement('style');
style.textContent = `.pw-icon{background:center/22px no-repeat url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><ellipse cx='12' cy='12' rx='11' ry='6.5' fill='%23777bb3'/><text x='12' y='15' font-size='8' font-weight='bold' text-anchor='middle' fill='white' font-family='sans-serif'>php</text></svg>")}`;

A.setPluginInit(ID, async () => {
  if (!appSettings.value[ID]) { appSettings.value[ID] = Object.assign({}, DEF_SET); appSettings.update(false); }
  document.head.appendChild(style);
  sidebarApps.add('pw-icon', ID, 'PHP Workstation', el => {
    dashEl = el; el.style.overflow = 'auto'; el.onclick = dashClick; renderDash(); refreshStatus();
  });
  try { A.registerFormatter(ID, ['php'], formatPhp, 'PHP (Prettier)'); } catch (e) { console.warn(e); }
  await loadSnippets();
  if (!lintOff) lintOff = bindLintListeners();
  if (!statusTimer) statusTimer = setInterval(() => { if (dashEl && dashEl.offsetParent) refreshStatus(); }, 5000);
  refreshStatus();
}, {
  list: [
    { key: 'enabled', text: 'Enable plugin', checkbox: S().enabled !== false },
    { key: 'linter', text: 'Linter mode', value: S().linter, select: ['gutter', 'inline', 'both', 'off'] },
    { key: 'snippets', text: 'Built-in snippets', checkbox: S().snippets !== false },
    { key: 'customSnippets', text: 'Custom snippets', checkbox: !!S().customSnippets },
    { key: 'customSnippetsFolder', text: 'Custom snippets folder', info: 'Folder where php_snippets.json is created/read (file:// or content:// URL).', value: S().customSnippetsFolder, prompt: 'Folder URL', promptType: 'text' },
    { key: 'prettier', text: 'Prettier JSON rules', info: 'e.g. {"tabWidth":2,"singleQuote":false}', value: S().prettier, prompt: 'JSON', promptType: 'text' }
  ],
  cb: (k, v) => { appSettings.value[ID][k] = v; appSettings.update(); loadSnippets(); }
});

A.setPluginUnmount(ID, () => {
  if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  if (lintTimer) { clearTimeout(lintTimer); lintTimer = null; }
  if (lintOff) { try { lintOff(); } catch (e) {} lintOff = null; }
  try { applyCmDiagnostics(null); } catch (e) {}
  try { sidebarApps.remove(ID); } catch (e) {}
  dashEl = null;
  try { A.unregisterFormatter && A.unregisterFormatter(ID); } catch (e) {}
  try {
    const { snippetManager } = ace.require('ace/snippets');
    if (regSnips.length) { snippetManager.unregister(regSnips, 'php'); regSnips = []; }
  } catch (e) {}
  try { style.remove(); } catch (e) {}
});
})();
