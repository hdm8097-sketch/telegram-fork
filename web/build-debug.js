'use strict';
// بُنىة تشخيصية غير مصغّرة (docs/_debug.js + docs/debug.html)
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');
const SHIM_DIR = path.join(__dirname, 'shims');
const SHIM_FILES = { fs:'fs.js', path:'path.js', os:'os.js', net:'net.js', tls:'net.js', http:'http.js', https:'http.js', crypto:'crypto.js', zlib:'zlib.js', 'timers/promises':'timers-promises.js', socks:'socks.js', 'node-localstorage':'localstorage.js' };
const NOOP = new Set(['stream','string_decoder','util','assert','url','child_process','worker_threads','dns','readline','tty','constants','perf_hooks','v8','vm','module','process','punycode','querystring','domain','cluster','repl','sys','fs/promises']);
const plugin = { name:'x', setup(build){ build.onResolve({ filter:/^(?:node:)?[a-z_\/-]+$/i }, (args)=>{ const raw=args.path; const base=raw.startsWith('node:')?raw.slice(5):raw; if(base==='events') return { path: path.join(__dirname,'..','node_modules','events','events.js') }; if(SHIM_FILES[raw]) return { path: path.join(SHIM_DIR, SHIM_FILES[raw]) }; if(SHIM_FILES[base]) return { path: path.join(SHIM_DIR, SHIM_FILES[base]) }; if(NOOP.has(base)) return { path: path.join(SHIM_DIR,'noop.js') }; return null; }); } };
esbuild.build({ entryPoints:[path.join(__dirname,'entry.js')], outfile:path.join(__dirname,'..','docs','_debug.js'), bundle:true, format:'iife', platform:'browser', plugins:[plugin], inject:[path.join(SHIM_DIR,'inject-globals.js')], define:{ __WEB__:'true', global:'globalThis' }, logLevel:'error' }).then(()=>{
  const html = fs.readFileSync(path.join(__dirname,'..','docs','index.html'),'utf8');
  fs.writeFileSync(path.join(__dirname,'..','docs','debug.html'), html.replace('src="app.js"','src="_debug.js"'),'utf8');
  console.log('DEBUG OK');
}).catch(e=>{ console.error(e.message); process.exit(1); });
