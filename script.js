// Mind Markets — Pixel Lab (no deps)
(() => {
  // ----- Utilities -----
  const randn = (() => {
    // Box-Muller
    let spare, hasSpare = false;
    return (mean=0, std=1) => {
      if (hasSpare) { hasSpare = false; return spare * std + mean; }
      let u, v, s;
      do { u = Math.random()*2-1; v = Math.random()*2-1; s = u*u+v*v; } while (s===0 || s>=1);
      const mul = Math.sqrt(-2.0*Math.log(s)/s);
      spare = v*mul; hasSpare = true;
      return mean + std * u * mul;
    };
  })();

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ----- Agent & Market -----
  class Agent {
    constructor(rho, h, c, a, theta, s=randn(0,0.1)) {
      this.rho=rho; this.h=h; this.c=c; this.a=a; this.theta=theta;
      this.s=s; this.q=0; this.cash=1000;
    }
    decide(trend, H, vol, news, r_last, q_max=5){
      const trendComp = (1-this.c)*trend - this.c*trend;
      const signal = trendComp + 0.5*this.s + this.h*H + 0.6*news - this.rho*vol;
      const desired = this.a * signal;
      let dq = clamp(desired - this.q, -q_max, q_max);
      if (Math.abs(r_last) < this.theta && Math.abs(news) < 1e-9) dq = 0;
      return dq;
    }
    updateSentiment(r, H){
      this.s = Math.tanh(0.8*this.s + 0.6*r + 0.4*H + randn(0,0.05));
    }
  }

  class Market {
    constructor(params){
      this.N = params.N;
      this.kappa = params.kappa;
      this.sigma = params.sigma;
      this.newsProb = params.newsProb;
      this.t = 0;
      this.P = 100;
      this.r_last = 0;
      this.agents = this.initAgents(params);
      this.rHist = [];
      this.series = {price:[this.P], sentiment:[], flow:[], vol:[], r:[]};
    }
    initAgents(params){
      const agents = [];
      for(let i=0;i<this.N;i++){
        const rho = clamp(randn(params.rho, 0.15), 0.05, 1.5);
        const h   = clamp(randn(params.h, 0.15), 0, 1);
        const c   = clamp(Math.max(0, Math.min(1, (Math.random()**2))), 0, 1); // mostly trend-followers
        const a   = clamp(randn(params.a, 0.3), 0.2, 2.0);
        const th  = clamp(randn(0.003, 0.002), 0.0, 0.02);
        agents.push(new Agent(rho, h, c, a, th));
      }
      return agents;
    }
    tick(exoNews=0){
      // signals
      const trend = Math.tanh(this.rHist.length>=10 ? this.rHist.slice(-10).reduce((a,b)=>a+b,0)/10 : 0);
      const H = this.agents.reduce((a,x)=>a+x.s,0)/this.N;
      const window = 50;
      const V = (this.rHist.length>=window)
        ? std(this.rHist.slice(-window))
        : (this.rHist.length ? std(this.rHist) : 0);
      const news = (Math.random() < this.newsProb) ? randn(0,0.05) : 0;
      const n = news + exoNews;

      // orders
      const dq = new Array(this.N);
      let OD = 0;
      for(let i=0;i<this.N;i++){ const d = this.agents[i].decide(trend, H, V, n, this.r_last); dq[i]=d; OD += d; }

      // price update
      const r = this.kappa * (OD/this.N) + randn(0,this.sigma);
      this.P *= Math.exp(r);

      // settle
      for(let i=0;i<this.N;i++){
        const ag = this.agents[i];
        ag.q += dq[i];
        ag.cash -= dq[i]*this.P;
        ag.updateSentiment(r, H);
      }

      // logs
      this.series.price.push(this.P);
      this.series.sentiment.push(H);
      this.series.flow.push(OD);
      this.series.vol.push(V);
      this.series.r.push(r);
      this.rHist.push(r);
      this.r_last = r;
      this.t += 1;
      return {H, OD, V, r};
    }
    panic(){
      for(const ag of this.agents){ ag.s = clamp(ag.s - 0.8, -1, 1); }
    }
    boost(){
      for(const ag of this.agents){ ag.s = clamp(ag.s + 0.5, -1, 1); }
    }
  }

  function std(arr){
    const m = arr.reduce((a,b)=>a+b,0)/arr.length;
    const v = arr.reduce((a,b)=>a+(b-m)*(b-m),0)/arr.length;
    return Math.sqrt(v);
  }

  // ----- UI -----
  const el = id => document.getElementById(id);
  const priceCanvas = el("priceCanvas");
  const agentsCanvas = el("agentsCanvas");
  const pctx = priceCanvas.getContext("2d");
  const actx = agentsCanvas.getContext("2d");

  const sliders = ["N","h","rho","a","kappa","sigma","newsProb"];
  const labels = {"N":"labelN","h":"labelH","rho":"labelRho","a":"labelA","kappa":"labelKappa","sigma":"labelSigma","newsProb":"labelNews"};
  for(const k of sliders){
    const s = el(k), l = el(labels[k]);
    const fmt = (k==="N") ? v=>v : v=>Number(v).toFixed( k==="sigma"||k==="newsProb" ? 3 : 2 );
    l.textContent = fmt(s.value);
    s.addEventListener("input", () => l.textContent = fmt(s.value));
  }

  let running = false;
  let market = null;

  function paramsFromUI(){
    return {
      N: Number(el("N").value),
      h: Number(el("h").value),
      rho: Number(el("rho").value),
      a: Number(el("a").value),
      kappa: Number(el("kappa").value),
      sigma: Number(el("sigma").value),
      newsProb: Number(el("newsProb").value),
    };
  }

  function reset(){
    market = new Market(paramsFromUI());
    clearCanvas();
    draw();
    updateStats(0,0,0);
  }

  function step(exo=0){
    const {H, OD, V, r} = market.tick(exo);
    draw();
    updateStats(H, OD, V);
  }

  function run(){
    if(!running){ running = true; el("run").textContent = "⏸ Pause"; loop(); }
    else { running = false; el("run").textContent = "▶︎ Start"; }
  }

  function loop(){
    if(!running) return;
    step(0);
    requestAnimationFrame(loop);
  }

  function clearCanvas(){
    pctx.clearRect(0,0,priceCanvas.width, priceCanvas.height);
    actx.clearRect(0,0,agentsCanvas.width, agentsCanvas.height);
  }

  function draw(){
    // draw price
    const w = priceCanvas.width, h = priceCanvas.height;
    pctx.fillStyle = "#0a0b0e"; pctx.fillRect(0,0,w,h);
    const data = market.series.price;
    const max = Math.max(...data.slice(-900));
    const min = Math.min(...data.slice(-900));
    const span = (max-min) || 1;
    pctx.strokeStyle = "#8ee3a6"; pctx.lineWidth = 2; pctx.beginPath();
    const start = Math.max(0, data.length-900);
    for(let i=start;i<data.length;i++){
      const x = (i-start)/(900-1)*w;
      const y = h - ((data[i]-min)/span)*h;
      if(i===start) pctx.moveTo(x,y); else pctx.lineTo(x,y);
    }
    pctx.stroke();

    // draw agents pixels
    const cols = 45, rows = 30; // 1350 pixels max visible
    const cellW = Math.floor(agentsCanvas.width/cols);
    const cellH = Math.floor(agentsCanvas.height/rows);
    actx.fillStyle = "#0a0b0e"; actx.fillRect(0,0,agentsCanvas.width, agentsCanvas.height);
    const perCell = Math.ceil(market.N/(cols*rows));
    // render by sampling agents
    for(let idx=0; idx<cols*rows; idx++){
      const i0 = Math.floor(idx*perCell);
      const i1 = Math.min(market.N, i0+perCell);
      if(i0>=i1) continue;
      let s = 0;
      for(let i=i0;i<i1;i++){ s += market.agents[i].s; }
      s /= (i1-i0);
      const color = sentimentColor(s);
      const x = (idx % cols)*cellW;
      const y = Math.floor(idx/cols)*cellH;
      actx.fillStyle = color;
      actx.fillRect(x,y,cellW-1,cellH-1);
    }
  }

  function sentimentColor(s){
    // map [-1,1] to red->gray->green
    const r = s<0 ? 200 : Math.floor(120*(1-Math.tanh(s))+40);
    const g = s>0 ? 200 : Math.floor(120*(1-Math.tanh(-s))+40);
    const b = 60;
    const t = Math.abs(s);
    // stronger saturation with |s|
    const rr = Math.floor(80 + (r-80)*t);
    const gg = Math.floor(80 + (g-80)*t);
    return `rgb(${rr},${gg},${b})`;
  }

  function updateStats(H, OD, V){
    el("statPrice").textContent = market.P.toFixed(2);
    el("statSent").textContent = H.toFixed(3);
    el("statFlow").textContent = OD.toFixed(1);
    el("statVol").textContent = V.toFixed(4);
    el("statT").textContent = market.t;
  }

  // Buttons
  el("reset").addEventListener("click", reset);
  el("run").addEventListener("click", run);
  el("step").addEventListener("click", ()=>step(0));
  el("goodNews").addEventListener("click", ()=>step(0.25));
  el("badNews").addEventListener("click", ()=>step(-0.25));
  el("panic").addEventListener("click", ()=>{ market.panic(); draw(); });

  reset();
})();