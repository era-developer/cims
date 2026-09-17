// Runs after `npm run build`: stamps the service worker's cache version with
// this build's bundle hash, so every deploy installs a fresh worker and old
// app-shell caches are dropped on activation.
const fs = require('fs');
const path = require('path');
const build = path.join(__dirname, '..', 'build');
const sw = path.join(build, 'sw.js');
const js = fs.readdirSync(path.join(build, 'static', 'js')).find(f => /^main\.[a-z0-9]+\.js$/.test(f));
const hash = js ? js.split('.')[1] : Date.now().toString(36);
fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace("const CACHE_VERSION = 'kims-v1';", `const CACHE_VERSION = 'kims-${hash}';`));
console.log(`sw.js cache version -> kims-${hash}`);
