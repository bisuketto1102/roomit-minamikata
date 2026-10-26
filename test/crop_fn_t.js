/* ---------- インジケーター PDF → 表だけの画像2枚 ----------
 * PDF のまま送ると Gemini がページ全体を小さく縮めて読むので、SD と D の文字がつぶれやすい。
 * ブラウザで 300dpi 相当の画像にし、色の付いたマス（集計ボックス〜表の下端）の範囲を自動で探して、
 * 上（集計ボックス＋12F〜07F）と下（06F〜02F）に分けて切り出す（境目は少し重ねる）。
 * pdf.js は使うときだけ読み込む。読み込めない・表が見つからないときは PDF のまま読む。 */
var PDFJS = null;
window.loadPdfJs = function(){
  if (PDFJS) return PDFJS;
  PDFJS = new Promise((res, rej)=>{
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    sc.onload = ()=>{
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      res(pdfjsLib);
    };
    sc.onerror = ()=>{ PDFJS = null; rej(new Error('pdf.js')); };
    document.head.appendChild(sc);
  });
  return PDFJS;
}
window.cropIndicator = async function(file){
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const v1 = page.getViewport({ scale: 1 });
  const scale = 3508 / Math.max(v1.width, v1.height);         // 長い辺を約3500px（A4で300dpi）
  const vp = page.getViewport({ scale });
  const big = document.createElement('canvas');
  big.width = Math.round(vp.width); big.height = Math.round(vp.height);
  await page.render({ canvasContext: big.getContext('2d'), viewport: vp }).promise;

  // 小さく縮めたコピーで、色の付いた範囲を探す
  const W = 500, H = Math.round(big.height * W / big.width);
  const sm = document.createElement('canvas'); sm.width = W; sm.height = H;
  const sx = sm.getContext('2d'); sx.drawImage(big, 0, 0, W, H);
  const px = sx.getImageData(0, 0, W, H).data;
  const colN = new Array(W).fill(0), rowN = new Array(H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = px[i], g = px[i+1], b = px[i+2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn > 45 && mx > 120) { colN[x]++; rowN[y]++; }
  }
  // 表のマスは色の付いた画素がまとまって並ぶ。表の外の小さな色（手書きの赤ペンなど）に引っぱられないよう、
  // いちばん色の多い列の2割以上・いちばん色の多い行の1割以上ある列と行だけで範囲を決める
  const span = (arr, min) => { let a = -1, b = -1; arr.forEach((n, i) => { if (n >= min) { if (a < 0) a = i; b = i; } }); return [a, b]; };
  const topC = Math.max.apply(null, colN), topR = Math.max.apply(null, rowN);
  let [x0, x1] = span(colN, Math.max(3, topC * 0.2)), [y0, y1] = span(rowN, Math.max(3, topR * 0.1));
  if (x0 < 0 || y0 < 0 || (x1 - x0) < W * 0.15 || (y1 - y0) < H * 0.25) throw new Error('表が見つからない');
  // 集計ボックスの「出済(O)」は表の右端より外に出ているので、右は広めに取る
  const sw = x1 - x0;
  x0 = Math.max(0, x0 - sw * 0.06); x1 = Math.min(W, x1 + sw * 0.16);
  y0 = Math.max(0, y0 - (y1 - y0) * 0.03); y1 = Math.min(H, y1 + (y1 - y0) * 0.03);
  const k = big.width / W;
  const cut = (ya, yb) => {
    const c = document.createElement('canvas');
    c.width = Math.round((x1 - x0) * k); c.height = Math.round((yb - ya) * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(big, x0 * k, ya * k, c.width, c.height, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  };
  // 上：集計ボックス＋12F〜07F、下：06F〜02F。境目を少し重ねる（9/29 の PDF で確かめた位置）
  const h = y1 - y0;
  return [cut(y0, y0 + h * SPLIT_A), cut(y0 + h * SPLIT_B, y1)];
}
