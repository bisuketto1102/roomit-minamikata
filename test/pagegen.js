const fs=require('fs');
function page(file){
  let h = fs.readFileSync('' + require('path').join(__dirname, '../') + '' + file + '.html', 'utf8');
  h = h.replace("<?!= include('Lang') ?>", fs.readFileSync('' + require('path').join(__dirname, '../') + 'Lang.html', 'utf8'));
  const shim = `<script>
  window.google = { script: { run: (function mk(ok, ng){ return new Proxy({}, { get(_, k){
    if (k === 'withSuccessHandler') return f => mk(f, ng);
    if (k === 'withFailureHandler') return f => mk(ok, f);
    return (...a) => { window.__gas(k, JSON.stringify(a)).then(r => { const o = JSON.parse(r);
      setTimeout(() => o.err ? (ng && ng({message: o.err})) : (ok && ok(o.v)), 30); }); };
  }}); })(null, null) } };
  window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message));
  window.confirm = () => true; window.prompt = () => '';
  </script>`;
  return h.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">' + shim);
}
module.exports={page};
