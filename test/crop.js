const fs = require('fs'); const { chromium } = require('playwright');
const SPLIT = process.argv[3] || '0.62,0.50';
(async () => {
  const br = await chromium.launch(); const pg = await br.newPage();
  await pg.route('https://cdnjs.cloudflare.com/**', r => {
    const f = r.request().url().split('/').pop();
    r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync('node_modules/pdfjs-dist/build/' + f) });
  });
  await pg.route('http://app.test/**', r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await pg.goto('http://app.test/');
  pg.on('console', m => console.log('console:', m.text()));
  const fn = fs.readFileSync('crop_fn_t.js', 'utf8').replace('SPLIT_A', SPLIT.split(',')[0]).replace('SPLIT_B', SPLIT.split(',')[1]);
  const b64 = fs.readFileSync(process.argv[2]).toString('base64');
  const out = await pg.evaluate(async ([fn, b64]) => {
    eval(fn);
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const file = new File([u], 'a.pdf', { type: 'application/pdf' });
    try { return await window.cropIndicator(file); } catch (e) { return 'ERR ' + e.message; }
  }, [fn, b64]);
  if (typeof out === 'string') { console.log(out); } else out.forEach((c, i) => fs.writeFileSync('crop' + i + '.jpg', Buffer.from(c, 'base64')));
  await br.close();
})();
