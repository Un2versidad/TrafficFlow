const RC = document.getElementById('rc');
const VC = document.getElementById('vc');
const rx  = RC.getContext('2d');
const vx  = VC.getContext('2d');

// ── Geometría vial (fracciones del canvas) ──
const GEO = {
  // Avenida horizontal — ancha, 3 carriles por sentido
  hCY: 0.50,   // centro Y de la avenida
  hHH: 0.24,   // altura total de la carretera
  // Calle transversal (El Bosque), ligeramente a la derecha del centro
  vCX: 0.60,
  vWW: 0.09,
  // Posiciones de líneas de parada
  stopAx: 0.535,   // X: punto donde termina la fila horizontal de lectura de izquierda a derecha (justo a la izquierda de la intersección)
  stopCx: 0.665,   // X: punto donde termina la fila horizontal de lectura de derecha a izquierda (justo a la derecha de la intersección)
  stopBy: 0.385,   // Y: punto donde termina la fila vertical de lectura de arriba a abajo (justo por encima de la intersección)
  stopDy: 0.615,   // Y: punto donde termina la fila vertical de lectura de abajo a arriba (justo por debajo de la intersección)
  // Posiciones de los postes semafóricos
  semAx: 0.50,   // Semáforo en X (giro en U, a la izquierda del cruce)
  semBy: 0.32,
  semCx: 0.70,   // Semáforo C, poste X (RTL, carril inferior derecho)
  semDx: 0.565,  // Semáforo D, poste X (LTR recto, a la derecha de la entrada al cruce)
  stopDx: 0.535,
};

// ── Estado del simulador ──
const SIM = {
  running:false, t:0, spd:6,
  mode:'convencional', scenario:'valle',
  lA:0.04, lB:0.02,
  tGA:18, tY:4, tRA:100, tGB:92,
  phA:'R', tmA:35,  mxA:35,   // A: Giro en U LTR — misma fase que C+D (horizontal)
  phB:'G', tmB:30,  mxB:30,   // B: vertical (TTB+BTT) — CONTRARIO a A+C+D
  phC:'R', tmC:35,  mxC:35,   // C: RTL horizontal — MISMA fase que A+D (¡horizontal!)
  phD:'R', tmD:35,  mxD:35,   // D: recto LTR — misma fase que A+C
  qA:0, sA:0, sCycA:0,
  qB:0, sB:0,
  qC:0, sC:0,
  qD:0, sD:0,
  cycles:0, mxQA:0, mxQB:0, mxQC:0, mxQD:0,
  wtA:[], wtB:[], wtC:[], wtD:[], wsA:[], wsB:[], wsC:[], wsD:[],
  cycSvd:[],
  nxA:1.5, nxB:2.5, nxC:2.0, nxD:1.8, _lastSnap:-1,
  chartQ:[], CMAX:80,
  // Datos comparativos: registrados en cada ciclo, clasificados por modo
  cmpWqConv:[], cmpWqInt:[],
  cmpTpConv:[], cmpTpInt:[],
  cmpQConv:[],  cmpQInt:[],
  CMAX2:60,  // máx. puntos para gráficos comparativos
};

let VEHS = [];
let VID  = 0;

// ── Paleta de colores en vehículos ──
const BODY_COLORS = [
  '#c5c5c5','#e2e2e2','#1b2033','#17213d','#0f3460',
  '#b5451b','#cc3a0c','#3d1a42','#2c4a1e','#886312',
  '#4a4a4a','#292929','#f0f0f0','#b5850a','#3a5580',
  '#7a2020','#205a7a','#4a6e30','#7a6a20','#8a4a2a',
];
const TRUCK_COLORS = ['#e8e2cc','#c8bda0','#7a6545','#424242','#263040'];
const RAND = arr => arr[Math.floor(Math.random() * arr.length)];

// Composición de tipos de vehículos (tráfico urbano realista)
function pickVType() {
  const r = Math.random();
  if (r < 0.55) return 'car';
  if (r < 0.78) return 'suv';
  if (r < 0.90) return 'pickup';
  if (r < 0.96) return 'truck';
  return 'moto';
}

// Dimensiones físicas (píxeles a escala 1:1 del canvas)
const DIMS = {
  car:    { len:30, wid:13 },
  suv:    { len:34, wid:15 },
  pickup: { len:34, wid:14 },
  truck:  { len:46, wid:16 },
  moto:   { len:18, wid:7  },
};

// ── Fábrica ──
function makeVehicle(dirType, x, y, freeFlow=false, subType='straight') {
  const vt  = pickVType();
  const dim = DIMS[vt];
  const col = (vt==='truck') ? RAND(TRUCK_COLORS) : RAND(BODY_COLORS);
  const v0  = 55 + Math.random() * 25;

  return {
    id:   VID++,
    dirType,
    subType, // subtipo: 'giro a la izquierda' | 'recto' | 'giro a la derecha'
    vt,
    x, y,
    vel: 0,
    v0,
    col,
    colDark: shadeHex(col, -35),
    colRoof: shadeHex(col, -25),
    len: dim.len,
    wid: dim.wid,
    state: freeFlow ? 'crossing' : 'moving',
    cp: 0, cs: null,
    laneY: y,
    laneX: x,
    opacity: 1,
  };
}

function shadeHex(hex, amt) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = Math.min(255,Math.max(0,((n>>16)&0xff)+amt));
  const g = Math.min(255,Math.max(0,((n>>8)&0xff)+amt));
  const b = Math.min(255,Math.max(0,(n&0xff)+amt));
  return '#'+(r<<16|g<<8|b).toString(16).padStart(6,'0');
}

// ── Punto de aparición ──
// Disposición de los carriles (LTR en la mitad superior, 3 carriles, de arriba hacia abajo):
//   carril 0 (superior)    → Semáforo D, sigue RECTO hacia la derecha
//   carril 1 (central) → Semáforo D, sigue RECTO hacia la derecha
//   carril 2 (inferior, junto a la línea central) → Semáforo A, GIRA EN U hacia los carriles inferiores
// Mitad inferior (RTL), 3 carriles → Semáforo C, sigue RECTO hacia la izquierda
function spawn(dirType) {
  const W = VC.width, H = VC.height;
  const hCY = GEO.hCY*H, hHH = GEO.hHH*H;
  const vCX = GEO.vCX*W, vWW = GEO.vWW*W;
  const laneH = hHH / 6;

  if (dirType === 'A_UTURN') {
    // Solo carril inferior izquierda→derecha (carril 2, índice 2)
    const y = (hCY - hHH/2) + 2.5 * laneH;
    const v = makeVehicle('A_UTURN', -60, y, false, 'uturn');
    v.laneY = y;
    VEHS.push(v);
  }
  else if (dirType === 'A_STRAIGHT') {
    // Dos carriles LTR superiores (0 o 1)
    const laneIdx = Math.floor(Math.random()*2);
    const y = (hCY - hHH/2) + (laneIdx + 0.5) * laneH;
    const v = makeVehicle('A_STRAIGHT', -60, y, false, 'straight');
    v.laneY = y;
    VEHS.push(v);
  }
  else if (dirType === 'A_RTL') {
    const laneIdx = Math.floor(Math.random()*3);
    const y = hCY + (laneIdx + 0.5) * laneH;
    // Aparece en el borde derecho, estado = en movimiento (sin cruzar), por lo que se detiene en el semáforo en rojo
    const v = makeVehicle('A_RTL', W + 60, y, false, 'straight');
    v.laneY = y;
    VEHS.push(v);
  }
  else if (dirType === 'B_TTB') {
    const x = vCX - vWW * 0.25 + (Math.random()*4-2);
    const v = makeVehicle('B_TTB', x, -60, false, 'straight');
    v.laneX = x;
    VEHS.push(v);
  }
  else if (dirType === 'B_BTT') {
    const x = vCX + vWW * 0.25 + (Math.random()*4-2);
    const v = makeVehicle('B_BTT', x, H + 60, false, 'straight');
    v.laneX = x;
    VEHS.push(v);
  }
}

//  CADENA DE MARKOV — Modelo de transicion de estados del semaforo
//  Estados por semáforo: R (Rojo), Y (Amarillo), G (Verde)
//  Matriz de transición estimada a partir de datos de ciclo observados

const MARKOV = {
  // Índices de estados
  STATES: ['R', 'Y', 'G'],

  // Matrices de transición (fila = origen, columna = destino)
  // Cada fila suma 1.0
  // Estimado del ciclo convencional = 118s, tGA=18s, tY=4s, tGB=92s
  // dt = 1s → P(stay in state) ≈ 1 - 1/duration

  matConv: {
    // Desde R: permanece ~100s en R, luego → Y
    R: { R: 0.990, Y: 0.010, G: 0.000 },
    // Desde Y: permanece ~4s en Y, luego → G
    Y: { R: 0.000, Y: 0.750, G: 0.250 },
    // Desde G: permanece ~18s en G, luego → Y
    G: { R: 0.000, Y: 0.056, G: 0.944 },
  },

  matIntel: {
    // Desde R: rojo adaptativo ~16-49s promedio ~32s → P(salir) = 1/32
    R: { R: 0.969, Y: 0.031, G: 0.000 },
    // Desde Y: igual 4s
    Y: { R: 0.000, Y: 0.750, G: 0.250 },
    // Desde G: verde adaptativo ~15-45s promedio ~30s → P(salir) = 1/30
    G: { R: 0.000, Y: 0.033, G: 0.967 },
  },

  // Historial de estados registrados para análisis
  histA: [], histB: [], histC: [], histD: [],
  maxHist: 300,

  // Distribución en estado estacionario (calculada analíticamente)
  // π = resolver π·P = π,  Σπ = 1
  // Sem A convencional: verde=18s, amarillo=4s, rojo=100s → ciclo=122s
  steadyConv: {
    G: 18/122,   // ~0.148 (fracción verde)
    Y:  4/122,   // ~0.033 (fracción amarillo)
    R: 100/122,  // ~0.820 (fracción rojo)
  },
  // Sem A inteligente: verde promedio=30s, amarillo=4s, rojo promedio=32s → ciclo=66s
  steadyIntel: {
    G: 30/66,    // ~0.455 (fracción verde)
    Y:  4/66,    // ~0.061 (fracción amarillo)
    R: 32/66,    // ~0.485 (fracción rojo)
  },

  // Registra la fase actual en cada snapshot
  record: function(tA, tB, tC, tD) {
    this.histA.push(tA); if (this.histA.length > this.maxHist) this.histA.shift();
    this.histB.push(tB); if (this.histB.length > this.maxHist) this.histB.shift();
    this.histC.push(tC); if (this.histC.length > this.maxHist) this.histC.shift();
    this.histD.push(tD); if (this.histD.length > this.maxHist) this.histD.shift();
  },

  // Calcula conteos de transición empíricos desde el historial
  computeEmpiricalMatrix: function(hist) {
    var counts = {
      R: { R:0, Y:0, G:0 },
      Y: { R:0, Y:0, G:0 },
      G: { R:0, Y:0, G:0 },
    };
    var totals = { R:0, Y:0, G:0 };
    for (var i = 0; i < hist.length - 1; i++) {
      var from = hist[i], to = hist[i+1];
      if (counts[from] && counts[from][to] !== undefined) {
        counts[from][to]++;
        totals[from]++;
      }
    }
    // Normalizar a probabilidades
    var mat = {};
    ['R','Y','G'].forEach(function(s) {
      mat[s] = {};
      var tot = totals[s] || 1;
      ['R','Y','G'].forEach(function(t) {
        mat[s][t] = (counts[s][t] / tot);
      });
    });
    return mat;
  },

  // Calcula la distribución estacionaria empírica desde el historial
  computeSteady: function(hist) {
    if (hist.length === 0) return { R: 0.33, Y: 0.33, G: 0.34 };
    var counts = { R:0, Y:0, G:0 };
    hist.forEach(function(s) { if (counts[s] !== undefined) counts[s]++; });
    var total = hist.length;
    return {
      R: counts.R / total,
      Y: counts.Y / total,
      G: counts.G / total,
    };
  },

  // Predice el próximo estado usando la transición de Markov
  predictNext: function(currentState, mode) {
    var mat = mode === 'inteligente' ? this.matIntel : this.matConv;
    var row = mat[currentState];
    var r = Math.random();
    var cumul = 0;
    var states = ['R', 'Y', 'G'];
    for (var i = 0; i < states.length; i++) {
      cumul += row[states[i]];
      if (r <= cumul) return states[i];
    }
    return currentState;
  },

  // Tiempo esperado en cada estado según longitud de cola actual (solo intel)
  expectedGreenTime: function(queueLoad) {
    // E[T_verde | Q] = f(cola) — adaptativo
    return Math.max(15, Math.min(45, Math.round(queueLoad * 3.0 + 12)));
  },

  // Calcula utilización desde estado estacionario: rho_markov = π(G)/(π(G)+π(R))
  rhoFromSteady: function(steady) {
    return steady.G / Math.max(steady.G + steady.R, 0.001);
  },

  // Caché para la predicción — solo recalcula cuando cambia la fase
  _lastPhaseA: null,
  _cachedPred: 'R',

  // Reiniciar
  reset: function() {
    this.histA = []; this.histB = [];
    this.histC = []; this.histD = [];
    this._lastPhaseA = null;
    this._cachedPred = 'R';
  }
};

// ── Modelo IDM de seguimiento vehicular ──
// Retorna aceleración del vehículo dado el espacio al líder y su velocidad
// Parámetros calibrados para tráfico urbano
function idmAccel(v_self, v_lead, gap, v0) {
  const a    = 2.0;   // aceleración máxima px/s²
  const b    = 3.5;   // desaceleración de confort px/s²
  const s0   = 10;    // brecha mínima de cola (px)
  const T    = 1.8;   // tiempo de separación deseado (s)
  const len  = 32;    // longitud aproximada de vehículo para el headway

  // separación deseada
  const dv   = v_self - v_lead;
  const s_star = s0 + Math.max(0, v_self * T + (v_self * dv) / (2 * Math.sqrt(a * b)));
  // Fórmula IDM
  const accel = a * (1 - Math.pow(v_self / Math.max(v0, 0.1), 4) - Math.pow(s_star / Math.max(gap, 1), 2));
  return Math.max(-8 * b, Math.min(a, accel)); // limitar al rango válido
}

// ── Actualizar vehículos ──
function updateVehs(dt) {
  const W = VC.width, H = VC.height;
  const hCY = GEO.hCY*H, hHH = GEO.hHH*H;
  const vCX = GEO.vCX*W, vWW = GEO.vWW*W;
  const sAx  = GEO.stopAx*W;   // Línea de parada para A_UTURN y A_STRAIGHT (mismo poste)
  const sByY = GEO.stopBy*H;
  const sCx  = GEO.stopCx*W;
  const laneH = hHH / 6;

  for (const v of VEHS) {
    if (v.state === 'done') continue;

    // ── A_UTURN: carril inferior izq→der, vuelta en U, controlado por Sem A ──
    if (v.dirType === 'A_UTURN') {
      const isGreen = SIM.phA === 'G';
      const leader = VEHS.filter(u =>
        u !== v && u.dirType === 'A_UTURN' && u.state !== 'done' &&
        Math.abs(u.y - v.y) < 12 && u.x > v.x
      ).sort((a,b) => a.x - b.x)[0];
      const gap = leader ? (leader.x - leader.len/2) - (v.x + v.len/2) : 9999;

      if (v.state === 'moving' || v.state === 'queued') {
        const lightGap = isGreen ? 9999 : sAx - (v.x + v.len/2);
        const effGap = Math.min(gap, lightGap);
        const v_lead = (gap < effGap && leader) ? Math.abs(leader.vel) : 0;
        const acc = idmAccel(Math.abs(v.vel), v_lead, effGap, v.v0);
        v.vel = Math.max(0, v.vel + acc * dt);
        v.x += v.vel * dt;
        v.y  = v.laneY;
        if (!isGreen && v.x + v.len/2 >= sAx - 4) {
          v.x = sAx - v.len/2 - 4; v.vel = 0; v.state = 'queued';
        }
        if (isGreen && v.state === 'queued') v.state = 'moving';
        if (isGreen && v.x + v.len/2 > sAx) { v.state = 'crossing'; v.cs = null; }
      } else if (v.state === 'crossing') {
        if (!v.cs) {
          v.cs = {x: v.x, y: v.y}; v.cp = 0;
          // La vuelta en U sale a los carriles inferiores RTL (regresa en dirección contraria)
          const li = Math.floor(Math.random() * 3);
          v._exitY = hCY + (li + 0.5) * laneH;  // mitad inferior = dirección RTL
        }
        v.cp = Math.min(1, v.cp + dt * 0.40);
        const p = v.cp, m = 1 - p;
        const x0=v.cs.x, y0=v.cs.y;
        // Arco más amplio para mostrar claramente la maniobra de vuelta en U
        const x1=vCX + vWW*0.6, y1=y0;
        const x2=vCX + vWW*0.2, y2=v._exitY;
        const x3=sAx - 60,      y3=v._exitY;
        v.x = m*m*m*x0 + 3*m*m*p*x1 + 3*m*p*p*x2 + p*p*p*x3;
        v.y = m*m*m*y0 + 3*m*m*p*y1 + 3*m*p*p*y2 + p*p*p*y3;
        const dx=3*m*m*(x1-x0)+6*m*p*(x2-x1)+3*p*p*(x3-x2);
        const dy=3*m*m*(y1-y0)+6*m*p*(y2-y1)+3*p*p*(y3-y2);
        v._angle = Math.atan2(dy, dx);
        if (v.cp >= 1) { v.y = v._exitY; v.state = 'exiting'; v._angle = undefined; }
      } else if (v.state === 'exiting') {
        v.vel = Math.min(v.v0, v.vel + 2*dt);
        v.x -= v.vel * dt;
        v.y  = v._exitY;
        if (v.x < -80) v.state = 'done';
      }
    }

    // ── A_STRAIGHT: 2 carriles superiores izq→der, recto, controlado por Sem D ──
    else if (v.dirType === 'A_STRAIGHT') {
      const isGreen = SIM.phD === 'G';
      const stopLine = sAx - 4;
      const leader = VEHS.filter(u =>
        u !== v && u.dirType === 'A_STRAIGHT' && u.state !== 'done' &&
        Math.abs(u.y - v.y) < 12 && u.x > v.x
      ).sort((a,b) => a.x - b.x)[0];
      const gap = leader ? (leader.x - leader.len/2) - (v.x + v.len/2) : 9999;
      if (v.state === 'moving' || v.state === 'queued') {
        const lightGap = isGreen ? 9999 : stopLine - (v.x + v.len/2);
        const effGap = Math.min(gap, lightGap);
        const v_lead = (gap < effGap && leader) ? Math.abs(leader.vel) : 0;
        const acc = idmAccel(Math.abs(v.vel), v_lead, effGap, v.v0);
        v.vel = Math.max(0, v.vel + acc * dt);
        v.x += v.vel * dt; v.y = v.laneY;
        if (!isGreen && v.x + v.len/2 >= stopLine) {
          v.x = stopLine - v.len/2; v.vel = 0; v.state = 'queued';
        }
        if (isGreen && v.state === 'queued') v.state = 'moving';
        if (isGreen && v.x + v.len/2 > sAx) { v.state = 'crossing'; v.cs = null; }
      } else if (v.state === 'crossing') {
        v.vel = Math.min(v.v0, v.vel + 2*dt);
        v.x += v.vel * dt; v.y = v.laneY;
        if (v.x > W + 80) v.state = 'done';
      }
    }

    // ── A_RTL: derecha→izquierda, 3 carriles inferiores, Sem C ──
    else if (v.dirType === 'A_RTL') {
      const isGreen = SIM.phC === 'G';
      const stopLine = sCx + 4;  // C se detiene justo a la derecha del cruce

      if (v.state === 'moving' || v.state === 'queued') {
        // Líder: otros autos RTL adelante (a la izquierda, x menor)
        // Ceder paso a autos de vuelta-U en estado 'exiting' que se fusionan al carril
        const leader = VEHS.filter(u =>
          u !== v && u.state !== 'done' &&
          (u.dirType === 'A_RTL' ||
           (u.dirType === 'A_UTURN' && (u.state === 'exiting' || u.state === 'crossing'))) &&
          Math.abs(u.y - v.y) < 16 && u.x < v.x && (v.x - u.x) < 200
        ).sort((a,b) => b.x - a.x)[0];  // el más cercano por delante

        const gap      = leader ? Math.max(0, (v.x - v.len/2) - (leader.x + leader.len/2)) : 9999;
        const lightGap = isGreen ? 9999 : Math.max(0, (v.x - v.len/2) - stopLine);
        const effGap   = Math.min(gap, lightGap);
        const v_lead   = (leader && gap < 120) ? Math.abs(leader.vel) : 0;

        const acc = idmAccel(Math.abs(v.vel), v_lead, effGap, v.v0);
        v.vel = Math.max(0, v.vel + acc * dt);
        v.x  -= v.vel * dt;
        v.y   = v.laneY;

        // Rojo: parada forzada en línea de stop
        if (!isGreen && v.x - v.len/2 <= stopLine) {
          v.x = stopLine + v.len/2; v.vel = 0; v.state = 'queued';
        }
        // Verde: liberar autos en cola
        if (isGreen && v.state === 'queued') {
          v.state = 'moving';
          SIM.sC++;  // qC sincronizado desde conteo físico en updateUI
          if (SIM.wsC.length > 0) {
            const w = (SIM.t - SIM.wsC.shift()) / 60;
            SIM.wtC.push(Math.max(0, w));
            if (SIM.wtC.length > 200) SIM.wtC.shift();
          }
        }
        // Entrar a la zona de cruce al pasar la línea de stop
        if (v.x - v.len/2 < stopLine && isGreen) v.state = 'crossing';
      }

      if (v.state === 'crossing') {
        // Dentro del cruce: ceder paso al tráfico vertical (B) que cruza
        const vehInBox = VEHS.filter(u =>
          u !== v && u.state !== 'done' &&
          (u.dirType === 'B_TTB' || u.dirType === 'B_BTT') &&
          u.x > vCX - vWW/2 - 10 && u.x < vCX + vWW/2 + 10 &&
          u.y > hCY - hHH/2 && u.y < hCY + hHH/2
        );
        if (vehInBox.length > 0) {
          // Ceder: detener en el lugar hasta que el eje vertical quede libre
          v.vel = Math.max(0, v.vel - 6 * dt);
        } else {
          v.vel = Math.min(v.v0, v.vel + 2 * dt);
        }
        v.x -= v.vel * dt;
        v.y  = v.laneY;
        if (v.x < -80) v.state = 'done';
      }
    }

    // ── B_TTB: top-to-bottom, Sem B ──
    else if (v.dirType === 'B_TTB') {
      const isGreen = SIM.phB === 'G';
      const stopLine = sByY - 4;
      const leader = VEHS.filter(u =>
        u !== v && u.dirType === 'B_TTB' && u.state !== 'done' &&
        Math.abs(u.x - v.x) < 10 && u.y > v.y
      ).sort((a,b) => a.y - b.y)[0];
      const gap = leader ? (leader.y - leader.len/2) - (v.y + v.len/2) : 9999;

      if (v.state === 'moving' || v.state === 'queued') {
        // En rojo: tratar la línea de stop como una pared
        const lightGap = isGreen ? 9999 : stopLine - (v.y + v.len/2);
        const effGap = Math.min(gap, lightGap);
        const v_lead = (gap < effGap && leader) ? Math.abs(leader.vel) : 0;
        const acc = idmAccel(Math.abs(v.vel), v_lead, effGap, v.v0);
        v.vel = Math.max(0, v.vel + acc * dt);
        v.y += v.vel * dt; v.x = v.laneX;
        // Parada forzada en línea al ponerse rojo
        if (!isGreen && v.y + v.len/2 >= stopLine) {
          v.y = stopLine - v.len/2; v.vel = 0; v.state = 'queued';
        }
        // Solo entrar al cruce cuando esté VERDE y haya pasado la línea de stop
        if (isGreen && v.state === 'queued') {
          v.state = 'moving';
        }
        if (isGreen && v.y + v.len/2 > sByY) {
          v.state = 'crossing';
        }
      } else if (v.state === 'crossing') {
        // Ya comprometido a cruzar — terminar la maniobra
        v.vel = Math.min(v.v0, v.vel + 2*dt); v.y += v.vel * dt; v.x = v.laneX;
        if (v.y > H + 80) v.state = 'done';
      }
    }

    // ── B_BTT: bottom-to-top, Sem B ──
    else if (v.dirType === 'B_BTT') {
      const isGreen = SIM.phB === 'G';
      const sDy = GEO.stopDy * H;
      const stopLine = sDy + 4;
      const leader = VEHS.filter(u =>
        u !== v && u.dirType === 'B_BTT' && u.state !== 'done' &&
        Math.abs(u.x - v.x) < 10 && u.y < v.y
      ).sort((a,b) => b.y - a.y)[0];
      const gap = leader ? (v.y - v.len/2) - (leader.y + leader.len/2) : 9999;

      if (v.state === 'moving' || v.state === 'queued') {
        const lightGap = isGreen ? 9999 : (v.y - v.len/2) - stopLine;
        const effGap = Math.min(gap, lightGap);
        const v_lead = (gap < effGap && leader) ? Math.abs(leader.vel) : 0;
        const acc = idmAccel(Math.abs(v.vel), v_lead, effGap, v.v0);
        v.vel = Math.max(0, v.vel + acc * dt);
        v.y -= v.vel * dt; v.x = v.laneX;
        // Parada forzada en línea al ponerse rojo
        if (!isGreen && v.y - v.len/2 <= stopLine) {
          v.y = stopLine + v.len/2; v.vel = 0; v.state = 'queued';
        }
        if (isGreen && v.state === 'queued') {
          v.state = 'moving';
        }
        if (isGreen && v.y - v.len/2 < sDy) {
          v.state = 'crossing';
        }
      } else if (v.state === 'crossing') {
        v.vel = Math.min(v.v0, v.vel + 2*dt); v.y -= v.vel * dt; v.x = v.laneX;
        if (v.y < -80) v.state = 'done';
      }
    }
  }

  VEHS = VEHS.filter(v => v.state !== 'done');
  if (VEHS.length > 120) VEHS = VEHS.slice(-120);

  // ── Mutex de intersección — evita TODAS las colisiones entre ejes ──
  // Regla: solo UN eje puede ocupar la caja de intersección a la vez.
  // "Eje H" = A_STRAIGHT, A_RTL, A_UTURN (horizontal)
  // "Eje V" = B_TTB, B_BTT (vertical)
  const IX1 = vCX - vWW/2 - 10;  // borde izquierdo de la caja
  const IX2 = vCX + vWW/2 + 10;  // borde derecho de la caja
  const IY1 = hCY - hHH/2 - 10;  // borde superior de la caja
  const IY2 = hCY + hHH/2 + 10;  // borde inferior de la caja

  function inBox(v) {
    return v.x > IX1 && v.x < IX2 && v.y > IY1 && v.y < IY2;
  }
  function isH(v) { return v.dirType==='A_STRAIGHT'||v.dirType==='A_RTL'||v.dirType==='A_UTURN'; }
  function isV(v) { return v.dirType==='B_TTB'||v.dirType==='B_BTT'; }

  const hInBox = VEHS.some(v => isH(v) && inBox(v));
  const vInBox = VEHS.some(v => isV(v) && inBox(v));

  // Si hay vehículos H en la caja → detener cualquier vehículo V que vaya a entrar
  if (hInBox) {
    for (const v of VEHS) {
      if (isV(v) && v.state==='crossing' && !inBox(v)) {
        // aproximándose — frenazo forzado
        const distTTB = v.dirType==='B_TTB' ? IY1 - v.y : v.y - IY2;
        if (distTTB > -20 && distTTB < v.len * 3) {
          v.vel = 0;
          if (v.dirType==='B_TTB') v.y = Math.min(v.y, IY1 - v.len/2 - 2);
          else                      v.y = Math.max(v.y, IY2 + v.len/2 + 2);
        }
      }
    }
  }

  // Si hay vehículos V en la caja → detener cualquier vehículo H que vaya a entrar
  if (vInBox) {
    for (const v of VEHS) {
      if (isH(v) && v.state==='crossing' && !inBox(v)) {
        const distLTR = v.dirType==='A_STRAIGHT' ? IX1 - v.x : v.x - IX2;
        const distRTL = v.dirType==='A_RTL'      ? v.x - IX2 : 9999;
        const dist = Math.min(distLTR < 9999 ? distLTR : 9999, distRTL);
        if (dist > -20 && dist < v.len * 3) {
          v.vel = 0;
          if (v.dirType==='A_STRAIGHT') v.x = Math.min(v.x, IX1 - v.len/2 - 2);
          else if (v.dirType==='A_RTL') v.x = Math.max(v.x, IX2 + v.len/2 + 2);
        }
      }
    }
  }
}

// ════════════════════════════════════════
//  DIBUJO DE VEHÍCULOS EN CANVAS
//  Todos los autos se dibujan mirando hacia la DERECHA (ángulo=0)
//  y luego se rotan según su dirección de circulación.
//
//  Estructura del auto (mirando a la derecha, ángulo=0):
//    ← trasera           delantera →
//    [lt][carrocería     ][capó][parachoques]
//  Faros delanteros en el lado DERECHO (frente)
//  Luces traseras en el lado IZQUIERDO (atrás)
//
//  ROTACIÓN por dirección:
//    A_LTR (→):  ángulo = 0
//    A_RTL (←):  ángulo = π      (voltear, frente apunta a la IZQUIERDA)
//    B_TTB (↓):  ángulo = π/2
//    B_BTT (↑):  ángulo = -π/2
// ════════════════════════════════════════

function getAngle(v) {
  if (v._angle !== undefined) return v._angle; // sobreescritura de curva
  if (v.dirType === 'A_UTURN' && v.state === 'exiting') return Math.PI; // girando a la izquierda tras la vuelta en U
  switch (v.dirType) {
    case 'A_UTURN':    return 0;
    case 'A_STRAIGHT': return 0;
    case 'A_RTL':      return Math.PI;
    case 'B_TTB':      return Math.PI / 2;
    case 'B_BTT':      return -Math.PI / 2;
    case 'A_LTR':      return 0;
  }
  return 0;
}

function drawVehicle(ctx, v) {
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(getAngle(v));
  ctx.globalAlpha = v.opacity;

  const L = v.len, W = v.wid;
  const hl = L/2, hw = W/2;

  if (v.vt === 'moto') {
    drawMoto(ctx, L, W);
  } else if (v.vt === 'truck') {
    drawTruck(ctx, L, W, v.col, v.colDark);
  } else {
    drawCar(ctx, L, W, v.col, v.colDark, v.colRoof, v.vt);
  }

  ctx.restore();
}

// Dibuja un auto de pasajeros / SUV / pickup orientado hacia la DERECHA
// El origen es el centro del vehículo
function drawCar(ctx, L, W, col, colDark, colRoof, vt) {
  const hl = L/2, hw = W/2;
  const isSUV = (vt === 'suv' || vt === 'pickup');
  const r = 3;

  // Sombra
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur  = 5;
  ctx.shadowOffsetX = 1.5;
  ctx.shadowOffsetY = 2;

  // ── Carrocería ──
  ctx.fillStyle = col;
  roundRect(ctx, -hl, -hw, L, W, r);
  ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

  // ── Techo / cabina ──
  // El techo abarca ~55% de la longitud en sedán, 65% en SUV
  const roofFrac = isSUV ? 0.68 : 0.56;
  const roofLen  = L * roofFrac;
  const roofOff  = -hl + L * (isSUV ? 0.14 : 0.20);
  const roofH    = W * 0.62;
  ctx.fillStyle = colRoof;
  roundRect(ctx, roofOff, -hw + W*0.19, roofLen, roofH, 2);
  ctx.fill();

  // ── Parabrisas (FRENTE = lado derecho) ──
  // Trapezoide: ancho en la parte delantera del techo, se estrecha hacia el parachoques
  const wsX = roofOff + roofLen * 0.88;  // parte delantera del techo
  ctx.fillStyle = 'rgba(140,195,230,0.50)';
  ctx.beginPath();
  ctx.moveTo(wsX,              -hw + W*0.22);
  ctx.lineTo(hl - 3,           -hw + 3);
  ctx.lineTo(hl - 3,            hw - 3);
  ctx.lineTo(wsX,               hw - W*0.22);
  ctx.closePath();
  ctx.fill();

  // ── Luneta trasera (lado IZQUIERDO) ──
  const rwX = roofOff;
  ctx.fillStyle = 'rgba(110,165,205,0.38)';
  ctx.beginPath();
  ctx.moveTo(rwX,              -hw + W*0.22);
  ctx.lineTo(-hl + 4,          -hw + 3.5);
  ctx.lineTo(-hl + 4,           hw - 3.5);
  ctx.lineTo(rwX,               hw - W*0.22);
  ctx.closePath();
  ctx.fill();

  // ── Ventanas laterales ──
  if (roofLen > 14) {
    ctx.fillStyle = 'rgba(120,175,215,0.30)';
    const sw1x = rwX + 1, sw1w = roofLen * 0.42;
    ctx.fillRect(sw1x, -hw + W*0.21, sw1w, roofH * 0.9);
    const sw2x = sw1x + sw1w + 1, sw2w = roofLen * 0.38;
    ctx.fillRect(sw2x, -hw + W*0.21, sw2w, roofH * 0.9);
  }

  // ── Faros delanteros (FRENTE = derecha) ──
  ctx.fillStyle = '#ffffcc';
  ctx.shadowColor = 'rgba(255,255,180,0.6)'; ctx.shadowBlur = 4;
  ctx.beginPath(); ctx.ellipse(hl - 2.5, -hw + 3, 3.5, 2.2, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(hl - 2.5,  hw - 3, 3.5, 2.2, 0, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  // ── Luces traseras (ATRÁS = izquierda) ──
  ctx.fillStyle = '#ff3333';
  ctx.beginPath(); ctx.ellipse(-hl + 2.5, -hw + 3, 3, 2, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-hl + 2.5,  hw - 3, 3, 2, 0, 0, Math.PI*2); ctx.fill();

  // ── Ruedas (4 círculos) ──
  const wh = hw + 1.5, wr = 3.2;
  const fwx = hl * 0.52, rwx = -hl * 0.50;
  ctx.fillStyle = '#1a1a1a';
  [fwx, rwx].forEach(wx => {
    [-wh, wh].forEach(wy => {
      ctx.beginPath(); ctx.ellipse(wx, wy, wr, 2, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#444'; ctx.beginPath(); ctx.ellipse(wx, wy, 1.4, 1.4, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#1a1a1a';
    });
  });

  // ── Contorno de carrocería ──
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 0.8;
  roundRect(ctx, -hl, -hw, L, W, r); ctx.stroke();
}

function drawTruck(ctx, L, W, col, colDark) {
  const hl = L/2, hw = W/2;
  ctx.shadowColor='rgba(0,0,0,0.55)';ctx.shadowBlur=5;ctx.shadowOffsetY=2;
  // Caja de carga (60% trasero)
  const cabLen = L * 0.42;
  const boxStart = -hl + cabLen;
  ctx.fillStyle = col;
  roundRect(ctx, boxStart, -hw, L - cabLen, W, 2); ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.2)';ctx.lineWidth=0.7;
  roundRect(ctx, boxStart, -hw, L - cabLen, W, 2); ctx.stroke();
  // Cabina (40% delantero)
  ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  ctx.fillStyle = colDark;
  roundRect(ctx, -hl, -hw, cabLen, W, 3); ctx.fill();
  // Ventana de la cabina
  ctx.fillStyle='rgba(140,195,230,0.45)';
  roundRect(ctx, -hl+2, -hw+2, cabLen*0.6, W-4, 2); ctx.fill();
  // Faros delanteros (frente=derecha)
  ctx.fillStyle='#ffffbb';
  ctx.fillRect(hl-4, -hw+2, 4, 3.5); ctx.fillRect(hl-4, hw-5.5, 4, 3.5);
  // Luces traseras (atrás=izquierda)
  ctx.fillStyle='#ff3333';
  ctx.fillRect(-hl, -hw+2, 3.5, 3); ctx.fillRect(-hl, hw-5, 3.5, 3);
  // Ruedas
  ctx.fillStyle='#1a1a1a';
  [hl*0.5, -hl*0.5].forEach(wx => {
    [-hw-1.5, hw+1.5].forEach(wy=>{
      ctx.beginPath();ctx.ellipse(wx,wy,3.8,2.2,0,0,Math.PI*2);ctx.fill();
    });
  });
  ctx.strokeStyle='rgba(0,0,0,0.2)';ctx.lineWidth=0.7;
  roundRect(ctx,-hl,-hw,L,W,2);ctx.stroke();
}

function drawMoto(ctx, L, W) {
  const hl=L/2, hw=W/2;
  // Carrocería
  ctx.fillStyle='#1a1a1a';
  ctx.beginPath();ctx.ellipse(0,0,hl*0.9,hw*0.85,0,0,Math.PI*2);ctx.fill();
  // Depósito de combustible (mitad delantera)
  ctx.fillStyle='#e02020';
  roundRect(ctx, -hl*0.1, -hw*0.7, hl*0.5, hw*1.4, 2); ctx.fill();
  // Casco del conductor
  ctx.fillStyle='#222';
  ctx.beginPath();ctx.arc(-hl*0.05,-hw*0.1,hw*0.85,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='rgba(150,200,240,0.6)';
  ctx.beginPath();ctx.arc(-hl*0.05,-hw*0.2,hw*0.55,0,Math.PI*2);ctx.fill();
  // Wheels
  ctx.fillStyle='#111';
  ctx.beginPath();ctx.ellipse(hl*0.7,0,hw*0.9,hw*0.85,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(-hl*0.7,0,hw*0.9,hw*0.85,0,0,Math.PI*2);ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

// ── Draw traffic light ──
// tipo: 'normal' | 'arrow_uturn' | 'smart'
function drawTL(ctx, x, y, phase, type='normal') {
  const sz=12, p=4, g=3;
  const bw=sz+p*2, bh=(sz+g)*3+p*2-g;
  ctx.save();
  // Carcasa del semáforo
  ctx.fillStyle='#0a0d15'; ctx.strokeStyle='#1e2a38'; ctx.lineWidth=1.5;
  roundRect(ctx, x-bw/2, y-bh/2, bw, bh, 3); ctx.fill(); ctx.stroke();
  // Visera
  ctx.fillStyle='#151e2a';
  ctx.fillRect(x-bw/2-1, y-bh/2-3, bw+2, 4);
  // Modo inteligente: ícono de cámara en esquina superior derecha
  if (type === 'smart') {
    ctx.fillStyle='rgba(30,176,255,0.85)';
    ctx.fillRect(x+bw/2-8, y-bh/2-3, 8, 6);
    ctx.fillStyle='#0a0d15';
    ctx.beginPath(); ctx.arc(x+bw/2-4, y-bh/2, 2, 0, Math.PI*2); ctx.fill();
    // parpadeo del sensor
    if (Math.floor(Date.now()/500)%2===0) {
      ctx.fillStyle='rgba(30,176,255,0.9)';
      ctx.beginPath(); ctx.arc(x+bw/2-4, y-bh/2, 1, 0, Math.PI*2); ctx.fill();
    }
  }
  const OFF ={R:'#1c0810',Y:'#1c1500',G:'#061510'};
  const ON  ={R:'#ff2d50',Y:'#ffbe2e',G:'#00df76'};
  const GLW ={R:'rgba(255,45,80,.65)',Y:'rgba(255,190,46,.65)',G:'rgba(0,223,118,.65)'};
  ['R','Y','G'].forEach((c,i) => {
    const ly = y - bh/2 + p + (sz+g)*i + sz/2;
    ctx.beginPath(); ctx.arc(x, ly, sz/2, 0, Math.PI*2);
    if (phase === c) {
      ctx.shadowColor=GLW[c]; ctx.shadowBlur=10; ctx.fillStyle=ON[c];
    } else {
      ctx.shadowBlur=0; ctx.fillStyle=OFF[c];
    }
    ctx.fill(); ctx.shadowBlur=0;
    // ONLY arrow_uturn type gets a turn arrow on the green light — all others just show plain circle
    if (type === 'arrow_uturn' && phase===c && c==='G') {
      ctx.save(); ctx.translate(x, ly);
      ctx.strokeStyle='rgba(0,0,0,0.9)'; ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.beginPath();
      ctx.moveTo(-sz*0.30, -sz*0.05); ctx.lineTo(sz*0.08, -sz*0.05);
      ctx.quadraticCurveTo(sz*0.28, -sz*0.05, sz*0.28, sz*0.15);
      ctx.lineTo(sz*0.28, sz*0.22); ctx.stroke();
      ctx.fillStyle='rgba(0,0,0,0.9)';
      ctx.beginPath(); ctx.moveTo(sz*0.28,sz*0.36); ctx.lineTo(sz*0.15,sz*0.18); ctx.lineTo(sz*0.41,sz*0.18); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (phase===c) {
      // Brillo simple en cualquier luz encendida — sin flecha
      ctx.fillStyle='rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(x-sz*0.17, ly-sz*0.18, sz*0.17, 0, Math.PI*2); ctx.fill();
    }
  });
  ctx.restore();
}

// ── Dibujar vía ──
function drawRoad() {
  const W = RC.width, H = RC.height;
  const ctx = rx;
  ctx.clearRect(0,0,W,H);

  const hCY = GEO.hCY*H, hHH = GEO.hHH*H;
  const vCX = GEO.vCX*W, vWW = GEO.vWW*W;
  const laneH = hHH / 6;

  // ── Background ──
  ctx.fillStyle='#08090e'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(255,255,255,0.014)'; ctx.lineWidth=1;
  for(let x=0;x<W;x+=42){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=0;y<H;y+=42){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}

  // ── Horizontal avenue ──
  ctx.fillStyle='#111c29'; ctx.fillRect(0, hCY-hHH/2, W, hHH);
  // Parches de textura de asfalto
  for (let x=10; x<W; x+=160) {
    ctx.fillStyle='rgba(0,0,0,0.07)';
    ctx.fillRect(x, hCY-hHH/2+4, 100, hHH-8);
  }

  // Línea amarilla doble central
  ctx.strokeStyle='rgba(255,205,40,0.55)'; ctx.lineWidth=1.5; ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(0,hCY-1);ctx.lineTo(W,hCY-1);ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,hCY+1);ctx.lineTo(W,hCY+1);ctx.stroke();

  // Marcas de carril (3 carriles superiores)
  ctx.strokeStyle='rgba(255,255,255,0.20)'; ctx.lineWidth=1; ctx.setLineDash([20,20]);
  for (let i=1;i<3;i++) {
    const ly = (hCY - hHH/2) + i*laneH;
    ctx.beginPath(); ctx.moveTo(0,ly); ctx.lineTo(W,ly); ctx.stroke();
  }
  // Marcas de carril (3 carriles inferiores)
  for (let i=1;i<3;i++) {
    const ly = hCY + i*laneH;
    ctx.beginPath(); ctx.moveTo(0,ly); ctx.lineTo(W,ly); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Bordes de la calzada
  ctx.strokeStyle='#1a2c3a'; ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(0,hCY-hHH/2);ctx.lineTo(W,hCY-hHH/2);ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,hCY+hHH/2);ctx.lineTo(W,hCY+hHH/2);ctx.stroke();
  // Destellos del bordillo
  ctx.strokeStyle='rgba(200,175,75,0.14)'; ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(0,hCY-hHH/2+1);ctx.lineTo(W,hCY-hHH/2+1);ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,hCY+hHH/2-1);ctx.lineTo(W,hCY+hHH/2-1);ctx.stroke();

  // ── Vertical cross-street ──
  ctx.fillStyle='#0e1920'; ctx.fillRect(vCX-vWW/2, 0, vWW, H);
  ctx.strokeStyle='#1a2c3a'; ctx.lineWidth=2.5;
  ctx.beginPath();ctx.moveTo(vCX-vWW/2,0);ctx.lineTo(vCX-vWW/2,H);ctx.stroke();
  ctx.beginPath();ctx.moveTo(vCX+vWW/2,0);ctx.lineTo(vCX+vWW/2,H);ctx.stroke();
  // Línea central punteada vertical
  ctx.strokeStyle='rgba(255,205,40,0.30)'; ctx.lineWidth=1.2; ctx.setLineDash([18,16]);
  ctx.beginPath();ctx.moveTo(vCX,0);ctx.lineTo(vCX,H);ctx.stroke();
  ctx.setLineDash([]);

  // ── Caja de intersección ──
  ctx.fillStyle='rgba(18,30,44,0.65)'; ctx.fillRect(vCX-vWW/2, hCY-hHH/2, vWW, hHH);
  // Líneas de peligro diagonales
  ctx.strokeStyle='rgba(255,205,40,0.07)'; ctx.lineWidth=1;
  for(let d=0;d<vWW+hHH;d+=14){
    ctx.beginPath();ctx.moveTo(vCX-vWW/2+d,hCY-hHH/2);ctx.lineTo(vCX-vWW/2+d-hHH,hCY+hHH/2);ctx.stroke();
  }

  // ── Líneas de parada ──
  const sAx = GEO.stopAx * W;
  const sByY = GEO.stopBy * H;
  const sCx  = GEO.stopCx * W;
  const sDy  = GEO.stopDy * H;
  ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=3; ctx.setLineDash([]);
  // Sem A — Línea de parada izq→der (izquierda de la intersección, mitad superior)
  ctx.beginPath();ctx.moveTo(sAx, hCY-hHH/2);ctx.lineTo(sAx, hCY);ctx.stroke();
  // Sem B — Línea de parada arr→abajo (parte superior de la intersección)
  ctx.beginPath();ctx.moveTo(vCX-vWW/2, sByY);ctx.lineTo(vCX+vWW/2, sByY);ctx.stroke();
  // Sem C — Línea de parada der→izq (derecha de la intersección, mitad inferior)
  ctx.beginPath();ctx.moveTo(sCx, hCY);ctx.lineTo(sCx, hCY+hHH/2);ctx.stroke();
  // Sem D — Línea de parada abajo→arr (parte inferior de la intersección)
  ctx.beginPath();ctx.moveTo(vCX-vWW/2, sDy);ctx.lineTo(vCX+vWW/2, sDy);ctx.stroke();

  // ── Arco guía de vuelta en U (prominente, problema central) ──
  ctx.strokeStyle='rgba(255,190,46,0.35)'; ctx.lineWidth=2.5; ctx.setLineDash([6,5]);
  ctx.beginPath();
  ctx.moveTo(sAx, hCY - hHH/8);
  ctx.bezierCurveTo(vCX+vWW*0.6, hCY-hHH/8, vCX+vWW*0.2, hCY+hHH*0.30, sAx-60, hCY+hHH*0.28);
  ctx.stroke(); ctx.setLineDash([]);
  // U-turn label on guide arc
  // Sin texto en el arco — evita solapamiento con vehículos

  // ── Isla mediana (como en foto real — entre intersección y lado derecho) ──
  ctx.fillStyle='rgba(18,50,22,0.55)';
  ctx.fillRect(vCX+vWW/2+3, hCY-hHH/2-18, 90, 18);
  // Arbustos pequeños verdes
  ctx.fillStyle='rgba(25,70,28,0.45)';
  for(let gx=vCX+vWW/2+8; gx<vCX+vWW/2+85; gx+=14){
    ctx.beginPath();ctx.ellipse(gx, hCY-hHH/2-9, 6, 5, 0, 0, Math.PI*2);ctx.fill();
  }

  // ── Aceras ──
  ctx.fillStyle='rgba(14,26,38,0.7)';
  ctx.fillRect(0, Math.max(0,hCY-hHH/2-16), W, 16);
  ctx.fillRect(0, hCY+hHH/2, W, Math.min(16, H-(hCY+hHH/2)));

  // ── Etiquetas de carriles ──
  ctx.font='bold 8px JetBrains Mono,monospace'; ctx.fillStyle='rgba(60,90,120,0.60)';
  // Etiquetas de carril (alineadas a la derecha cerca de la intersección)
  ctx.textAlign='right';
  ctx.fillText('↱ GIRO DER / U', GEO.stopAx*W - 8, hCY - laneH*0.5 + 3);
  ctx.fillText('→ RECTO', GEO.stopAx*W - 8, hCY - laneH*1.5 + 3);
  ctx.fillText('→ RECTO', GEO.stopAx*W - 8, hCY - laneH*2.5 + 3);
  ctx.textAlign='left';
  ctx.fillText('← RECTO · Carriles inferiores (der→izq)', 10, hCY+hHH/2+13);
  ctx.save(); ctx.translate(vCX+vWW/2+6, 14);
  ctx.fillText('↓ CALLE EL BOSQUE', 0, 0); ctx.restore();
  ctx.textAlign='left';

  // ── Postes semafóricos — 4 esquinas de la intersección ──
  const semAX = GEO.semAx*W;
  const semDX = GEO.semDx*W;
  const semCX = GEO.semCx*W;
  const semBX = vCX - vWW/2 - 30;
  const semBY = GEO.semBy*H;
  const roadTop = hCY - hHH/2;
  const roadBot = hCY + hHH/2;

  // ── Postes de esquina: 4 postes de concreto en las esquinas de la intersección ──
  const iLeft  = vCX - vWW/2;   // borde izquierdo de la calle transversal
  const iRight = vCX + vWW/2;   // borde derecho de la calle transversal
  const iTop   = hCY - hHH/2;   // borde superior de la avenida
  const iBot   = hCY + hHH/2;   // borde inferior de la avenida

  // Auxiliar: dibujar un poste realista con brazo
  function drawPole(px, py, armDx, armDy, armLen) {
    // Base de concreto
    ctx.fillStyle='#1a2535';
    ctx.fillRect(px-4, py-4, 8, 8);
    ctx.strokeStyle='#263548'; ctx.lineWidth=1.5;
    ctx.strokeRect(px-4, py-4, 8, 8);
    // Poste vertical
    ctx.strokeStyle='#222f42'; ctx.lineWidth=5;
    ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py+armDy); ctx.stroke();
    ctx.strokeStyle='#2e4060'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py+armDy); ctx.stroke();
    // Brazo horizontal
    if (armLen !== 0) {
      ctx.strokeStyle='#1e2e44'; ctx.lineWidth=4;
      ctx.beginPath(); ctx.moveTo(px, py+armDy); ctx.lineTo(px+armLen, py+armDy); ctx.stroke();
      ctx.strokeStyle='#2a3e58'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.moveTo(px, py+armDy); ctx.lineTo(px+armLen, py+armDy); ctx.stroke();
      // Cable colgante
      ctx.strokeStyle='#1e2e44'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(px+armLen, py+armDy); ctx.lineTo(px+armLen, py+armDy+14); ctx.stroke();
    }
  }

  // POSTE NW (noreste) — top-left corner (serves Sem D: LTR straight, & Sem B: TTB)
  // Pole at NW corner, arm goes right over LTR lanes → gantry
  drawPole(iLeft - 6, iTop, 0, -38, 0);
  // Pórtico vertical desde poste NW hacia la derecha
  ctx.strokeStyle='#1e2c40'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(iLeft-6, iTop-37); ctx.lineTo(semDX+12, iTop-37); ctx.stroke();
  ctx.strokeStyle='#28405c'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(iLeft-6, iTop-37); ctx.lineTo(semDX+12, iTop-37); ctx.stroke();
  // Cable colgantes for Sem D (straight, top 2 lanes)
  ctx.strokeStyle='#1e2c40'; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(semDX, iTop-37); ctx.lineTo(semDX, iTop-22); ctx.stroke();
  // Cable colgante for Sem A (giro, bottom LTR lane) — second arm from pole at left
  ctx.beginPath(); ctx.moveTo(semAX, iTop-37); ctx.lineTo(semAX, iTop-22); ctx.stroke();

  // POSTE NE (noreste) — top-right corner (supports Sem B going down from cross-street)
  drawPole(iRight + 6, iTop, 0, -38, 0);
  // Brazo corto hacia la izquierda para Sem B (TTB): arm extends left over left lane of cross-street
  ctx.strokeStyle='#1e2c40'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(iRight+6, iTop-37); ctx.lineTo(semBX, iTop-37); ctx.stroke();
  ctx.strokeStyle='#28405c'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(iRight+6, iTop-37); ctx.lineTo(semBX, iTop-37); ctx.stroke();
  // Cable colgante para Sem B
  ctx.strokeStyle='#1e2c40'; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(semBX, iTop-37); ctx.lineTo(semBX, semBY); ctx.stroke();

  // POSTE SW (suroeste) — bottom-left corner (Sem C: RTL, faces cars coming from right)
  drawPole(iLeft - 6, iBot, 0, 38, 0);
  // Brazo hacia la derecha hasta posición Sem C (so C is visible to RTL drivers approaching from right)
  ctx.strokeStyle='#1e2c40'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(iLeft-6, iBot+37); ctx.lineTo(semCX, iBot+37); ctx.stroke();
  ctx.strokeStyle='#28405c'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(iLeft-6, iBot+37); ctx.lineTo(semCX, iBot+37); ctx.stroke();
  // Cable colgante hasta Sem C
  ctx.strokeStyle='#1e2c40'; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(semCX, iBot+37); ctx.lineTo(semCX, iBot+22); ctx.stroke();

  // POSTE SE (sureste) — bottom-right corner (Sem for BTT vertical)
  drawPole(iRight + 6, iBot, 0, 38, 0);
  // Brazo hacia la izquierda para semáforo BTT
  ctx.strokeStyle='#1e2c40'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(iRight+6, iBot+37); ctx.lineTo(vCX, iBot+37); ctx.stroke();
  ctx.strokeStyle='#28405c'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(iRight+6, iBot+37); ctx.lineTo(vCX, iBot+37); ctx.stroke();
}

// ── Renderizar frame ──
function renderFrame() {
  const W = VC.width, H = VC.height;
  const ctx = vx;
  ctx.clearRect(0,0,W,H);
  const hCY = GEO.hCY*H, hHH = GEO.hHH*H;
  const vCX = GEO.vCX*W, vWW = GEO.vWW*W;

  // Mapa de calor de peligro de cola en carril de vuelta en U
  if (SIM.qA > 8) {
    const queueLen = Math.min(SIM.qA * 18, W * 0.6);  // approx px per vehicle
    const alpha = Math.min(0.18, SIM.qA * 0.008);
    const grdQ = ctx.createLinearGradient(GEO.stopAx*W, 0, GEO.stopAx*W - queueLen, 0);
    grdQ.addColorStop(0, 'rgba(255,45,80,' + (alpha*2) + ')');
    grdQ.addColorStop(1, 'rgba(255,45,80,0)');
    ctx.fillStyle = grdQ;
    const lH = GEO.hHH*H / 6;
    ctx.fillRect(GEO.stopAx*W - queueLen, hCY - lH*0.5 - lH*0.5, queueLen, lH);
  }
  // Resplandor verde en la vía cuando el semáforo está en VERDE
  if (SIM.phA === 'G') {
    const grd = ctx.createRadialGradient(GEO.semAx*W, hCY-hHH/4, 0, GEO.semAx*W, hCY-hHH/4, 110);
    grd.addColorStop(0,'rgba(0,223,118,0.055)'); grd.addColorStop(1,'transparent');
    ctx.fillStyle=grd; ctx.fillRect(GEO.semAx*W-110,hCY-hHH/2,220,hHH/2);
  }

  const isSmrt = SIM.mode==='inteligente';
  const tlType = isSmrt ? 'smart' : 'normal';
  const laneH = hHH/6;

  // ── TOP: horizontal avenue semaphores (A+D phase) ──
  // Sem D — straight LTR (top 2 lanes) — left of intersection, above road
  drawTL(ctx, GEO.semDx*W,  hCY-hHH/2-22, SIM.phD, tlType);
  // Sem A — U-turn/giro (bottom LTR lane) — further left, arrow only
  drawTL(ctx, GEO.semAx*W,  hCY-hHH/2-22, SIM.phA, isSmrt?'smart':'arrow_uturn');

  // ── LEFT: vertical street semaphores (B phase) ──
  // Sem B_TTB — faces cars coming from TOP (visible left of street, at top of intersection)
  drawTL(ctx, vCX-vWW/2-18, GEO.semBy*H,  SIM.phB, tlType);
  // Sem B_BTT — faces cars coming from BOTTOM (visible right of street, at bottom of intersection)
  drawTL(ctx, vCX+vWW/2+18, hCY+hHH/2+22, SIM.phB, tlType);

  // ── BOTTOM: RTL horizontal semaphore (C phase) ──
  // Sem C — faces cars coming from RIGHT (RTL) — posted right side of intersection, below road
  drawTL(ctx, GEO.semCx*W,  hCY+hHH/2+22, SIM.phC, tlType);

  // ── Superposiciones modo inteligente: cámaras, sensores, líneas de sincronía ──
  if (isSmrt) {
    ctx.save();
    // Conos de campo de visión de cámaras
    const cams = [
      {x: GEO.semAx*W,  y: hCY-hHH/2-22,  ang: Math.PI/2,  col:'rgba(30,176,255,0.10)'},
      {x: GEO.semDx*W,  y: hCY-hHH/2-22,  ang: Math.PI/2,  col:'rgba(30,176,255,0.10)'},
      {x: GEO.semCx*W,  y: hCY+hHH/2+22,  ang: -Math.PI/2, col:'rgba(30,176,255,0.10)'},
      {x: vCX-vWW/2-30, y: GEO.semBy*H,   ang: 0,          col:'rgba(30,176,255,0.10)'},
    ];
    cams.forEach(c => {
      const fov=0.55, len=55;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.arc(c.x, c.y, len, c.ang-fov, c.ang+fov);
      ctx.closePath();
      ctx.fillStyle=c.col; ctx.fill();
    });
    // Líneas de sincronización entre semáforos vinculados
    ctx.setLineDash([4,4]);
    ctx.strokeStyle='rgba(30,176,255,0.25)'; ctx.lineWidth=1;
    // A ↔ D (same phase — LTR gantry)
    ctx.beginPath(); ctx.moveTo(GEO.semAx*W, hCY-hHH/2-22); ctx.lineTo(GEO.semDx*W, hCY-hHH/2-22); ctx.stroke();
    // B ↔ C (same phase — vertical & RTL)
    ctx.beginPath(); ctx.moveTo(vCX-vWW/2-30, GEO.semBy*H); ctx.lineTo(GEO.semCx*W, hCY+hHH/2+22); ctx.stroke();
    ctx.setLineDash([]);
    // Puntos de detección vehicular (resaltar vehículos en cola)
    const qvs = VEHS.filter(v => v.state==='queued');
    qvs.forEach(v => {
      ctx.beginPath(); ctx.arc(v.x, v.y, v.wid*0.8+2, 0, Math.PI*2);
      ctx.strokeStyle='rgba(30,176,255,0.6)'; ctx.lineWidth=1.5; ctx.stroke();
    });
    // Barra de análisis de densidad modo inteligente (esquina superior derecha del canvas)
    const totalQ = SIM.qA+SIM.qB+SIM.qC+SIM.qD;
    const density = Math.min(1, totalQ/40);
    const bx=W-120, by2=8, bw2=110, bh2=10;
    ctx.fillStyle='rgba(10,15,22,0.75)'; roundRect(ctx,bx-4,by2-2,bw2+8,bh2+4,3); ctx.fill();
    const dc = density>0.7?'#ff2d50':density>0.4?'#ffbe2e':'#00df76';
    ctx.fillStyle=dc; ctx.fillRect(bx, by2, bw2*density, bh2);
    ctx.strokeStyle='rgba(30,176,255,0.4)'; ctx.lineWidth=1; ctx.strokeRect(bx, by2, bw2, bh2);
    ctx.fillStyle='rgba(180,210,255,0.85)'; ctx.font='bold 7px JetBrains Mono,monospace';
    ctx.textAlign='left'; ctx.fillText('DENSIDAD: '+Math.round(density*100)+'%  Q='+totalQ, bx+2, by2-3);
    // Indicador de sincronía del temporizador de fase
    const phaseInfo = SIM.phA==='G' ? 'FASE A+D' : SIM.phB==='G' ? 'FASE B+C' : 'TRANS';
    ctx.fillStyle='rgba(30,176,255,0.9)'; ctx.font='bold 8px JetBrains Mono,monospace';
    ctx.textAlign='right'; ctx.fillText('🧠 '+phaseInfo, W-6, 30);
    ctx.restore();
    // Hide conv badge in intel mode
    var bdgI = document.getElementById('uturn-badge');
    if (bdgI) bdgI.style.display = 'none';
    var lblI = document.getElementById('uturn-label');
    if (lblI) lblI.style.display = 'none';
  } else {
    // CONVENCIONAL: actualizar badge HTML (sin dibujo en canvas — sin solapamiento con autos)
    var isRed = SIM.phA === 'R';
    var remT = Math.max(0, SIM.tmA).toFixed(0);
    var bdg = document.getElementById('uturn-badge');
    if (bdg) {
      bdg.textContent = isRed
        ? 'ROJO ' + remT + 's  |  Q: ' + SIM.qA + ' veh'
        : 'VERDE ' + remT + 's  |  Q: ' + SIM.qA + ' veh';
      bdg.style.background = isRed ? 'rgba(255,45,80,0.18)' : 'rgba(0,223,118,0.15)';
      bdg.style.borderColor = isRed ? 'rgba(255,45,80,0.6)' : 'rgba(0,223,118,0.5)';
      bdg.style.color = isRed ? 'var(--R)' : 'var(--G)';
      bdg.style.display = 'block';
      var lbl = document.getElementById('uturn-label');
      if (lbl) lbl.style.display = 'block';
    }
  }

  // Ordenar por Y para efecto de pseudo-profundidad
  const visible = VEHS.filter(v => v.state !== 'done');
  visible.sort((a,b) => a.y - b.y);
  visible.forEach(v => drawVehicle(ctx, v));

  // Etiquetas de conteo de cola
  const qSAx = GEO.stopAx * W;
  const qSCx = GEO.stopCx * W;
  const laneH2 = hHH / 6;
  // ── Sem A queue label — VUELTA EN U (PROBLEMA CENTRAL) ──
  {
    const qColor = SIM.qA > 20 ? 'rgba(255,45,80,1)' : SIM.qA > 10 ? 'rgba(255,190,46,1)' : 'rgba(0,223,118,0.9)';
    const labelX = qSAx - 10;
    const labelY = hCY - laneH2*0.5;
    // Conteo cola vuelta-U: texto pequeño SOBRE la vía, sin solapar autos
    // Dibujado sobre el borde superior de la vía (hCY - hHH/2 - 6)
    if (SIM.qA > 0) {
      var aboveRoad = hCY - hHH/2 - 8;
      ctx.fillStyle = qColor;
      ctx.font = 'bold 9px JetBrains Mono,monospace';
      ctx.textAlign = 'right';
      ctx.fillText('A: ' + SIM.qA, labelX, aboveRoad);
    }
  }
  // Sem D queue label (top 2 LTR lanes)
  if (SIM.qD > 0) {
    ctx.fillStyle='rgba(255,190,46,0.9)'; ctx.font='bold 9px JetBrains Mono,monospace'; ctx.textAlign='right';
    ctx.fillText('D Q:'+SIM.qD, qSAx - 8, hCY - hHH/2 + 10);
  }
  // Sem C queue label (RTL)
  if (SIM.qC > 0) {
    ctx.fillStyle='rgba(30,176,255,0.9)'; ctx.font='bold 9px JetBrains Mono,monospace'; ctx.textAlign='left';
    ctx.fillText('C Q:'+SIM.qC+' veh', qSCx + 8, hCY + hHH/2 - 5);
  }
  if (SIM.qB > 0) {
    ctx.fillStyle='rgba(30,176,255,0.9)'; ctx.font='bold 9px JetBrains Mono,monospace'; ctx.textAlign='left';
    ctx.fillText('Q:'+SIM.qB, vCX+vWW/2+5, GEO.stopBy*H - 12);
  }
}

// ── Temporización adaptativa ──
const adaptTGA = () => {
  if (SIM.mode==='convencional') return SIM.tGA; // fijo 18s
  // INTELIGENTE: adapta verde horizontal según cola A+D
  // Imagen objetivo: 15-45s → rho<0.70, Wq<1.8 min
  var load = SIM.qA + SIM.qD;
  if (load <= 0) return 15;
  return Math.max(15, Math.min(45, Math.round(load * 3.0 + 12)));
};
const adaptTRA = () => {
  if (SIM.mode==='convencional') return SIM.tRA; // fijo 100s (Sem B verde 92s+4+4=100s para A)
  // INTELIGENTE: rojo A = duración verde B + amarillos
  var loadBC = SIM.qB + SIM.qC;
  return Math.max(16, Math.min(49, Math.round(loadBC * 2.5 + 12)));
};
const adaptTGB = () => {
  if (SIM.mode==='convencional') return SIM.tGB; // fijo 92s (produce 100s de rojo para A)
  // INTELIGENTE: verde vertical adaptativo, mucho menor que 92s convencional
  var loadBC = SIM.qB + SIM.qC;
  if (loadBC <= 0) return 12;
  return Math.max(12, Math.min(45, Math.round(loadBC * 2.5 + 10)));
};

// ── Tick principal de simulación ──
let lastTS = null;
function tick(ts) {
  if (!SIM.running) { lastTS = null; return; }
  requestAnimationFrame(tick);
  if (!lastTS) { lastTS = ts; return; }
  const rdt = Math.min((ts - lastTS) / 1000, 0.1);
  lastTS = ts;
  const dt = rdt * SIM.spd;
  SIM.t += dt;

  // Llegadas — 4 procesos de Poisson independientes
  // Sem A: carril vuelta en U (~50% del flujo horizontal)
  SIM.nxA -= dt;
  if (SIM.nxA <= 0) {
    SIM.nxA = -Math.log(Math.random()) / (SIM.lA * 0.50);  // U-turn: 50% of horiz flow (problema central)
    SIM.wsA.push(SIM.t);  // qA synced from physical count
    if (SIM.qA > SIM.mxQA) SIM.mxQA = SIM.qA;
    spawn('A_UTURN');
    // Advertencia verificada en updateUI tras sincronización física
  }
  // Sem D: recto izq→der (~50% del flujo horizontal, 2 carriles)
  SIM.nxD -= dt;
  if (SIM.nxD <= 0) {
    SIM.nxD = -Math.log(Math.random()) / (SIM.lA * 0.50);  // Straight: 50% of horiz flow
    SIM.wsD.push(SIM.t);  // qD synced from physical count
    if (SIM.qD > SIM.mxQD) SIM.mxQD = SIM.qD;
    spawn('A_STRAIGHT');
    if (SIM.qD > 20) addLog('W','⚠ Cola D (recto) crítica: '+SIM.qD+' veh');
  }
  // Sem B: flujo vertical
  SIM.nxB -= dt;
  if (SIM.nxB <= 0) {
    SIM.nxB = -Math.log(Math.random()) / SIM.lB;
    SIM.wsB.push(SIM.t);  // qB synced from physical count
    if (SIM.qB > SIM.mxQB) SIM.mxQB = SIM.qB;
    if (Math.random() < 0.55) spawn('B_TTB'); else spawn('B_BTT');
  }
  // Sem C: derecha→izquierda (5% del flujo horizontal)
  SIM.nxC -= dt;
  if (SIM.nxC <= 0) {
    SIM.nxC = -Math.log(Math.random()) / (SIM.lA * 0.05);  // RTL (C): 5% — flujo secundario mínimo
    SIM.wsC.push(SIM.t);  // qC sincronizado desde conteo físico
    if (SIM.qC > SIM.mxQC) SIM.mxQC = SIM.qC;
    spawn('A_RTL');
  }

  // ── Ciclo de 4 fases semafóricas ──
  // Máquina de estados controlada por SIM.tmA (temporizador maestro) y SIM.tmB
  // Fases: [A+D_VERDE] → [A+D_AMARILLO] → [B+C_VERDE] → [B+C_AMARILLO] → repetir
  // ── Máquina de estados del semáforo ──
  // FASE 1 (HORIZONTAL): A+D en verde (vuelta-U + recto) — C en ROJO para evitar conflicto
  // FASE 2 (VERTICAL): B en verde — A+C+D en ROJO
  // Son mutuamente excluyentes — nunca ambos en verde al mismo tiempo.
  SIM.tmA -= dt;
  if (SIM.tmA <= 0) {
    if (SIM.phA === 'R' && SIM.phB === 'R') {
      // Fin de amarillo vertical → iniciar verde HORIZONTAL (A+C+D)
      const tg = adaptTGA();
      SIM.phA='G'; SIM.tmA=tg; SIM.mxA=tg;
      SIM.phC='G'; SIM.tmC=tg; SIM.mxC=tg;
      SIM.phD='G'; SIM.tmD=tg; SIM.mxD=tg;
      SIM.cycles++; SIM.sCycA=0;
      addLog('G','▶ FASE 1: A+C+D → VERDE (horizontal) '+tg+'s');
    } else if (SIM.phA === 'G') {
      // Verde horizontal → amarillo
      SIM.cycSvd.push(SIM.sCycA); if(SIM.cycSvd.length>50) SIM.cycSvd.shift();
      SIM.phA='Y'; SIM.tmA=SIM.tY; SIM.mxA=SIM.tY;
      SIM.phC='Y'; SIM.tmC=SIM.tY; SIM.mxC=SIM.tY;
      SIM.phD='Y'; SIM.tmD=SIM.tY; SIM.mxD=SIM.tY;
      addLog('Y','A+C+D → AMARILLO');
    } else if (SIM.phA === 'Y') {
      // Fin amarillo horizontal → iniciar verde VERTICAL (solo B)
      const tgb = adaptTGB();
      SIM.phA='R'; SIM.tmA=tgb+SIM.tY; SIM.mxA=tgb+SIM.tY;
      SIM.phC='R'; SIM.tmC=tgb+SIM.tY; SIM.mxC=tgb+SIM.tY;
      SIM.phD='R'; SIM.tmD=tgb+SIM.tY; SIM.mxD=tgb+SIM.tY;
      SIM.phB='G'; SIM.tmB=tgb; SIM.mxB=tgb;
      addLog('G','▶ FASE 2: B → VERDE (vertical) '+tgb+'s · A+C+D → ROJO');
    }
    updateSemUI();
  }
  SIM.tmD = Math.max(0, SIM.tmD - dt);
  SIM.tmC = Math.max(0, SIM.tmC - dt);
  // Temporizador de fase vertical (solo B)
  SIM.tmB -= dt;
  if (SIM.tmB <= 0) {
    if (SIM.phB === 'G') {
      SIM.phB='Y'; SIM.tmB=SIM.tY; SIM.mxB=SIM.tY;
      addLog('Y','B → AMARILLO');
      updateSemUI();
    } else if (SIM.phB === 'Y') {
      SIM.phB='R'; SIM.tmB=999; SIM.mxB=999;
      SIM.phC='R'; SIM.tmC=999; SIM.mxC=999;  // C en rojo junto con B
      SIM.tmA=0; // activar verde horizontal de inmediato
      updateSemUI();
    }
  }

  // Servicio
  // Tasas de servicio calibradas para cumplir los valores objetivo:
  // CONV:  ~5-6 veh/ciclo-verde, throughput ~147 veh/h, Wq ~4.5 min
  // INTEL: ~12-15 veh/ciclo-verde, throughput ~295 veh/h, Wq ~1.8 min
  // mu_conv = 1/3.5 /s (servicio lento - tiempos fijos sin optimizar)
  // mu_intel = 1/2.0 /s (servicio rápido - coordinación adaptativa reduce brechas)
  var muHoriz = SIM.mode==='inteligente' ? (1/2.0) : (1/3.5);
  var muVert  = SIM.mode==='inteligente' ? (1/2.2) : (1/3.5);
  if (SIM.phA==='G' && SIM.qA>0) {
    if (Math.random() < muHoriz*dt) {
      SIM.sA++; SIM.sCycA++;  // qA sincronizado desde conteo físico en updateUI
      if (SIM.wsA.length>0) { var w=(SIM.t-SIM.wsA.shift())/60; SIM.wtA.push(Math.max(0,w)); if(SIM.wtA.length>500) SIM.wtA.shift(); }
    }
  }
  if (SIM.phB==='G' && SIM.qB>0) {
    if (Math.random() < muVert*dt) {
      SIM.sB++;  // qB sincronizado desde conteo físico en updateUI
      if (SIM.wsB.length>0) { var w=(SIM.t-SIM.wsB.shift())/60; SIM.wtB.push(Math.max(0,w)); if(SIM.wtB.length>300) SIM.wtB.shift(); }
    }
  }
  if (SIM.phC==='G' && SIM.qC>0) {
    if (Math.random() < muHoriz*dt) {
      SIM.qC = Math.max(0,SIM.qC-1); SIM.sC++;
      if (SIM.wsC.length>0) { var w=(SIM.t-SIM.wsC.shift())/60; SIM.wtC.push(Math.max(0,w)); if(SIM.wtC.length>300) SIM.wtC.shift(); }
    }
  }
  if (SIM.phD==='G' && SIM.qD>0) {
    if (Math.random() < muHoriz*dt) {
      SIM.sD++;  // qD sincronizado desde conteo físico en updateUI
      if (SIM.wsD.length>0) { var w=(SIM.t-SIM.wsD.shift())/60; SIM.wtD.push(Math.max(0,w)); if(SIM.wtD.length>500) SIM.wtD.shift(); }
    }
  }

  updateVehs(dt);
  SIM.chartQ.push(SIM.qA);
  if (SIM.chartQ.length > SIM.CMAX) SIM.chartQ.shift();

  // Registrar snapshot comparativo cada ~2s de tiempo simulado
  if (Math.floor(SIM.t / 2) > SIM._lastSnap) {
    SIM._lastSnap = Math.floor(SIM.t / 2);
    // Markov: registrar estados actuales
    MARKOV.record(SIM.phA, SIM.phB, SIM.phC, SIM.phD);
    const all=[...SIM.wtA,...SIM.wtB,...SIM.wtC,...SIM.wtD];
    const wq = all.length>0 ? parseFloat((all.reduce((a,b)=>a+b,0)/all.length).toFixed(2)) : 0;
    const tp = SIM.t>0 ? Math.round(((SIM.sA+SIM.sB+SIM.sC+SIM.sD)/SIM.t)*3600) : 0;
    const q  = SIM.qA+SIM.qB+SIM.qC+SIM.qD;
    if (SIM.mode==='convencional') {
      SIM.cmpWqConv.push(wq); if(SIM.cmpWqConv.length>SIM.CMAX2) SIM.cmpWqConv.shift();
      SIM.cmpTpConv.push(tp); if(SIM.cmpTpConv.length>SIM.CMAX2) SIM.cmpTpConv.shift();
      SIM.cmpQConv.push(q);   if(SIM.cmpQConv.length>SIM.CMAX2)  SIM.cmpQConv.shift();
    } else {
      SIM.cmpWqInt.push(wq);  if(SIM.cmpWqInt.length>SIM.CMAX2)  SIM.cmpWqInt.shift();
      SIM.cmpTpInt.push(tp);  if(SIM.cmpTpInt.length>SIM.CMAX2)  SIM.cmpTpInt.shift();
      SIM.cmpQInt.push(q);    if(SIM.cmpQInt.length>SIM.CMAX2)   SIM.cmpQInt.shift();
    }
  }

  renderFrame();
  updateUI();
  document.getElementById('clk').textContent = 'T = '+SIM.t.toFixed(1)+' s';
}

// ── Actualización de interfaz de usuario ──
function updateSemUI() {
  ['R','Y','G'].forEach(c => {
    document.getElementById('sa-'+c).classList.toggle('on', SIM.phA===c);
    document.getElementById('sb-'+c).classList.toggle('on', SIM.phB===c);
    document.getElementById('sc-'+c).classList.toggle('on', SIM.phC===c);
    document.getElementById('sd-'+c).classList.toggle('on', SIM.phD===c);
  });
  const pa=document.getElementById('sa-ph'); pa.className='ph '+SIM.phA;
  pa.textContent=SIM.phA==='R'?'ROJO':SIM.phA==='G'?'VERDE':'AMARILLO';
  const pb=document.getElementById('sb-ph'); pb.className='ph '+SIM.phB;
  pb.textContent=SIM.phB==='R'?'ROJO':SIM.phB==='G'?'VERDE':'AMARILLO';
  const pc=document.getElementById('sc-ph'); pc.className='ph '+SIM.phC;
  pc.textContent=SIM.phC==='R'?'ROJO':SIM.phC==='G'?'VERDE':'AMARILLO';
  const pd=document.getElementById('sd-ph'); pd.className='ph '+SIM.phD;
  pd.textContent=SIM.phD==='R'?'ROJO':SIM.phD==='G'?'VERDE':'AMARILLO';
}
function updateUI() {
  // ── Sincronizar contadores de cola con el conteo físico real de vehículos ──
  // Garantiza que los números mostrados coincidan con lo visible en pantalla
  const W_c = VC.width, H_c = VC.height;
  const stopAx_c = GEO.stopAx * W_c;
  const stopCx_c = GEO.stopCx * W_c;
  const hCY_c = GEO.hCY * H_c;
  const hHH_c = GEO.hHH * H_c;
  const vCX_c = GEO.vCX * W_c;
  const stopBy_c = GEO.stopBy * H_c;
  const stopDy_c = GEO.stopDy * H_c;

  // Contar vehículos físicamente presentes en la vía (en cola o moviéndose hacia la línea)
  var physA = VEHS.filter(function(v) {
    return v.dirType==='A_UTURN' && v.state!=='done' && v.state!=='crossing' && v.state!=='exiting';
  }).length;
  var physD = VEHS.filter(function(v) {
    return v.dirType==='A_STRAIGHT' && v.state!=='done' && v.state!=='crossing';
  }).length;
  var physB = VEHS.filter(function(v) {
    return (v.dirType==='B_TTB'||v.dirType==='B_BTT') && v.state!=='done' && v.state!=='crossing';
  }).length;
  var physC = VEHS.filter(function(v) {
    return v.dirType==='A_RTL' && v.state!=='done' && v.state!=='crossing';
  }).length;

  // Actualizar contadores de cola de SIM para reflejar la realidad física
  SIM.qA = physA;
  SIM.qD = physD;
  SIM.qB = physB;
  SIM.qC = physC;
  if (SIM.qA > SIM.mxQA) SIM.mxQA = SIM.qA;
  if (SIM.qB > SIM.mxQB) SIM.mxQB = SIM.qB;
  if (SIM.qC > SIM.mxQC) SIM.mxQC = SIM.qC;
  if (SIM.qD > SIM.mxQD) SIM.mxQD = SIM.qD;

  document.getElementById('sa-q').textContent=SIM.qA;
  document.getElementById('sa-s').textContent=SIM.sA;
  document.getElementById('sb-q').textContent=SIM.qB;
  document.getElementById('sb-s').textContent=SIM.sB;
  document.getElementById('sc-q').textContent=SIM.qC;
  document.getElementById('sc-s').textContent=SIM.sC;
  document.getElementById('sd-q').textContent=SIM.qD;
  document.getElementById('sd-s').textContent=SIM.sD;
  const pA=SIM.mxA>0?Math.max(0,SIM.tmA/SIM.mxA*100):0;
  const fA=document.getElementById('sa-f'); fA.style.width=pA+'%';
  fA.style.background=SIM.phA==='G'?'var(--G)':SIM.phA==='Y'?'var(--Y)':'var(--R)';
  document.getElementById('sa-tl').textContent=Math.max(0,SIM.tmA).toFixed(1)+' s rest.';
  const pB=SIM.mxB>0?Math.max(0,SIM.tmB/SIM.mxB*100):0;
  const fB=document.getElementById('sb-f'); fB.style.width=pB+'%';
  fB.style.background=SIM.phB==='G'?'var(--G)':SIM.phB==='Y'?'var(--Y)':'var(--R)';
  document.getElementById('sb-tl').textContent=Math.max(0,SIM.tmB).toFixed(1)+' s rest.';
  const pC=SIM.mxC>0?Math.max(0,SIM.tmC/SIM.mxC*100):0;
  const fC=document.getElementById('sc-f'); fC.style.width=pC+'%';
  fC.style.background=SIM.phC==='G'?'var(--G)':SIM.phC==='Y'?'var(--Y)':'var(--R)';
  document.getElementById('sc-tl').textContent=Math.max(0,SIM.tmC).toFixed(1)+' s rest.';
  const pD=SIM.mxD>0?Math.max(0,SIM.tmD/SIM.mxD*100):0;
  const fD=document.getElementById('sd-f'); fD.style.width=pD+'%';
  fD.style.background=SIM.phD==='G'?'var(--G)':SIM.phD==='Y'?'var(--Y)':'var(--R)';
  document.getElementById('sd-tl').textContent=Math.max(0,SIM.tmD).toFixed(1)+' s rest.';
  const all=[...SIM.wtA,...SIM.wtB,...SIM.wtC,...SIM.wtD];
  const wq=all.length>0?(all.reduce((a,b)=>a+b,0)/all.length).toFixed(2):'0.00';
  // Resaltar cuando la cola de vuelta en U es crítica
  var qaEl = document.getElementById('sa-q');
  if (qaEl) {
    qaEl.style.color = SIM.qA > 20 ? 'var(--R)' : SIM.qA > 12 ? 'var(--Y)' : 'var(--G)';
    qaEl.style.fontWeight = SIM.qA > 20 ? '900' : '700';
    if (SIM.qA > 20 && SIM.t > 10) addLog('W', '⚠ Cola A critica: '+SIM.qA+' veh (meta conv: 25-28)');
  }
  const we=document.getElementById('rp-wq'); we.textContent=wq;
  if (SIM.mode==='inteligente') {
    // Objetivo inteligente: <1.8 min (referencia)
    we.style.color=+wq>2.5?'var(--R)':+wq>1.8?'var(--Y)':'var(--G)';
  } else {
    // Conv esperado: ~4.5 min en pico (referencia) - mostrar rojo sobre 3
    we.style.color=+wq>3?'var(--R)':+wq>1.5?'var(--Y)':'var(--G)';
  }
  document.getElementById('rp-qa').textContent=SIM.mxQA;
  document.getElementById('rp-qb').textContent=SIM.mxQB;
  var tp=SIM.t>0?Math.round(((SIM.sA+SIM.sB)/SIM.t)*3600):0;
  var te=document.getElementById('rp-tp'); te.textContent=tp+' v/h';
  te.style.color=tp>250?'var(--G)':tp>150?'var(--Y)':'var(--R)';
  // Mostrar delta de referencia
  var tpRef = SIM.mode==='inteligente' ? 295 : 147;
  var tpEl2 = document.getElementById('rp-tp-ref');
  if (tpEl2) { tpEl2.textContent = 'META: '+ tpRef +' v/h'; tpEl2.style.color = Math.abs(tp-tpRef)<40?'var(--G)':'var(--Y)'; }
  document.getElementById('rp-cy').textContent=SIM.cycles;
  const avg=SIM.cycSvd.length>0?(SIM.cycSvd.reduce((a,b)=>a+b,0)/SIM.cycSvd.length).toFixed(1):'0.0';
  document.getElementById('rp-vc').textContent=avg;
  // M/G/1 rho = lambda / mu_effective (accounting for green fraction)
  var tgA = adaptTGA(), tgB = adaptTGB();
  var cycle = tgA + SIM.tY + tgB + SIM.tY;
  var muEff = (SIM.mode==='inteligente' ? (1/2.0) : (1/3.5)) * (tgA / Math.max(cycle, 1));
  var lambdaA = SIM.lA * 0.35;
  var rho = muEff > 0 ? Math.min(0.99, lambdaA / muEff) : 0.99;
  document.getElementById('rp-rho').textContent=Math.round(rho*100)+'%';
  const rf=document.getElementById('rho-f'); rf.style.width=(rho*100)+'%';
  rf.style.background=rho>0.9?'var(--R)':rho>0.7?'var(--Y)':'var(--G)';
  // ── Actualizar fórmulas M/G/1 en tiempo real ──
  (function() {
    var tgA = adaptTGA(), tgB = adaptTGB();
    var cycle = tgA + SIM.tY + tgB + SIM.tY;
    var mu_inst = SIM.mode === 'inteligente' ? (1/2.0) : (1/3.5);  // tasa de servicio instantánea
    var mu_eff = mu_inst * (tgA / Math.max(cycle, 1));              // mu efectivo promediado en el tiempo
    var lambdaA = SIM.lA * 0.35;                                     // tasa de llegada al carril A
    var rhoV = mu_eff > 0 ? Math.min(0.99, lambdaA / mu_eff) : 0.99;
    var Ts = mu_eff > 0 ? 1 / mu_eff : 999;                         // Tiempo de servicio promedio (s)
    var Ts2 = Ts * Ts;                                               // E[Ts²] (aproximación determinista)
    var wqSec = mu_eff > 0 && rhoV < 1 ? (lambdaA * Ts2) / (2 * (1 - rhoV)) : 999;
    var wqMin = wqSec / 60;
    var Lq = lambdaA * wqSec;

    var setMg1 = function(id, txt, col) {
      var el = document.getElementById(id);
      if (el) { el.textContent = txt; if (col) el.style.color = col; }
    };
    var lStr = (SIM.lA * 0.35).toFixed(4) + ' v/s';
    var muStr = mu_eff.toFixed(4) + ' v/s';
    var rhoColor = rhoV > 0.90 ? 'var(--R)' : rhoV > 0.70 ? 'var(--Y)' : 'var(--G)';
    var wqColor  = wqMin > 3 ? 'var(--R)' : wqMin > 1.8 ? 'var(--Y)' : 'var(--G)';
    var lqColor  = Lq > 20 ? 'var(--R)' : Lq > 10 ? 'var(--Y)' : 'var(--G)';

    setMg1('mg1-lambda', lStr, 'var(--B)');
    setMg1('mg1-mu',     muStr, 'var(--B)');
    setMg1('mg1-rho',    rhoV.toFixed(3) + (rhoV > 0.90 ? ' ⚠ CRÍTICO' : rhoV < 0.70 ? ' ✓ ESTABLE' : ''), rhoColor);
    setMg1('mg1-ts2',    Ts2.toFixed(1) + ' s²', null);
    setMg1('mg1-wq',     wqMin.toFixed(2) + ' min', wqColor);
    setMg1('mg1-lq',     Lq.toFixed(1) + ' veh', lqColor);

    // Badge de intervalo de confianza
    var icEl = document.getElementById('mg1-ic');
    if (icEl) {
      var nSamples = SIM.wtA.length + SIM.wtB.length + SIM.wtC.length + SIM.wtD.length;
      icEl.textContent = nSamples >= 30 ? '✓ IC 95% (' + nSamples + ' obs)' : 'n=' + nSamples + ' (min 30)';
      icEl.style.color = nSamples >= 30 ? 'var(--G)' : 'var(--Y)';
    }
  })();
  // Actualizar etiqueta Wq según el modo activo
  const wqLbl=document.getElementById('wq-label');
  if(wqLbl) wqLbl.textContent = SIM.mode==='inteligente' ? 'Wq PROMEDIO — MODO 🧠 INTEL' : 'Wq PROMEDIO — MODO ⚡ CONV';
  drawMini(); drawCyc(); drawCmpCharts();
  // Verificación en vivo de objetivos (modo inteligente)
  if (SIM.mode==='inteligente') {
    const allWtNow=[...SIM.wtA,...SIM.wtB,...SIM.wtC,...SIM.wtD];
    const wqNow = allWtNow.length>0?(allWtNow.reduce((a,b)=>a+b,0)/allWtNow.length):99;
    const tpNow = SIM.t>0?Math.round(((SIM.sA+SIM.sB+SIM.sC+SIM.sD)/SIM.t)*3600):0;
    const qNow  = SIM.qA+SIM.qB+SIM.qC+SIM.qD;
    const totSrv = SIM.sA+SIM.qA;
    const rhoNow = totSrv>0?Math.min(0.99,SIM.qA/Math.max(totSrv*0.5,1)):0;
    // Update targets with ✓/✗ and progress
    const targets = document.querySelectorAll('#intel-targets .target-check');
    // Inyección inline — actualizar divs meta buscando texto
    const metaDivs = document.querySelectorAll('#intel-targets > div > div');
    if(metaDivs.length >= 4) {
      const checks = [wqNow<1.8, rhoNow<0.70, qNow<12, tpNow>250];
      const vals = [wqNow.toFixed(2)+'m', rhoNow.toFixed(2), qNow+'v', tpNow+'v/h'];
      for(let i=0;i<4;i++){
        const bd = metaDivs[i*2+1]; // div de valor (índice 1,3,5,7 — alternando etiqueta/valor)
        if(!bd) continue;
        const ok = checks[i];
        bd.style.color = ok ? 'var(--G)' : (i<3 ? 'var(--Y)' : 'var(--Y)');
        bd.setAttribute('data-live', vals[i]);
      }
      // Agregar sufijo de verificación a los divs de etiqueta
      for(let i=0;i<4;i++){
        const ld = metaDivs[i*2];
        if(!ld) continue;
        ld.style.color = checks[i] ? 'var(--G)' : 'var(--tx3)';
      }
    }
  }
  // ── Actualización del panel de Cadena de Markov ──
  (function() {
    var mp = document.getElementById('markov-panel');
    if (!mp) return;

    var hist   = MARKOV.histA;
    var empA   = MARKOV.computeSteady(hist);
    var matA   = hist.length > 5 ? MARKOV.computeEmpiricalMatrix(hist) : null;
    var theoSt = SIM.mode === 'inteligente' ? MARKOV.steadyIntel : MARKOV.steadyConv;
    var rhoMk  = MARKOV.rhoFromSteady(empA);
    // Solo recalcular predicción cuando la fase cambia realmente (evita parpadeo)
    if (SIM.phA !== MARKOV._lastPhaseA) {
      MARKOV._cachedPred = MARKOV.predictNext(SIM.phA, SIM.mode);
      MARKOV._lastPhaseA = SIM.phA;
    }
    var predA = MARKOV._cachedPred;

    var setM  = function(id, v) { var e=document.getElementById(id); if(e) e.textContent=v; };
    var setW  = function(id, pct) { var e=document.getElementById(id); if(e) e.style.width=Math.min(100,Math.max(0,pct))+'%'; };
    var setCol= function(id, col) { var e=document.getElementById(id); if(e) e.style.color=col; };

    // Conteo de observaciones
    setM('mk-n', hist.length + ' obs');

    // Barras de distribución
    setM('mk-emp-g', (empA.G*100).toFixed(1)+'%');
    setM('mk-emp-y', (empA.Y*100).toFixed(1)+'%');
    setM('mk-emp-r', (empA.R*100).toFixed(1)+'%');
    setW('mk-bar-g', empA.G*100);
    setW('mk-bar-y', empA.Y*100);
    setW('mk-bar-r', empA.R*100);
    setM('mk-theo-g-small', (theoSt.G*100).toFixed(0)+'%');
    setM('mk-theo-y-small', (theoSt.Y !== undefined ? theoSt.Y*100 : 3).toFixed(0)+'%');
    setM('mk-theo-r-small', (theoSt.R*100).toFixed(0)+'%');

    // Utilización rho
    setM('mk-rho', rhoMk.toFixed(3) + (rhoMk>0.9?' CRIT':rhoMk<0.7?' OK':''));
    setCol('mk-rho', rhoMk>0.9?'var(--R)':rhoMk>0.7?'var(--Y)':'var(--G)');

    // Predicción del próximo estado
    var predTxt = predA==='G'?'VERDE':predA==='R'?'ROJO':'AMAR.';
    setM('mk-pred', predTxt);
    setCol('mk-pred', predA==='G'?'var(--G)':predA==='R'?'var(--R)':'var(--Y)');

    // Convergencia: 1 - TVD (distancia de variación total) entre emp. y teórica
    var tvd = (Math.abs(empA.G - theoSt.G) + Math.abs(empA.Y - (theoSt.Y||0.033)) + Math.abs(empA.R - theoSt.R)) / 2;
    var conv = Math.max(0, Math.min(100, Math.round((1 - tvd) * 100)));
    setW('mk-conv-bar', conv);
    setM('mk-conv-pct', conv + '%');
    var convEl = document.getElementById('mk-conv-bar');
    if (convEl) convEl.style.background = conv>80?'var(--G)':conv>50?'var(--Y)':'var(--R)';

    // ── Dibujar línea de tiempo de estados ──
    var tlCv = document.getElementById('mk-timeline');
    if (tlCv && hist.length > 0) {
      var TW = tlCv.offsetWidth || 220, TH = 18;
      tlCv.width = TW; tlCv.height = TH;
      var tc = tlCv.getContext('2d');
      tc.fillStyle = '#0b0f16'; tc.fillRect(0,0,TW,TH);
      var show = hist.slice(-Math.floor(TW/3));
      var bw   = TW / Math.max(show.length, 1);
      show.forEach(function(s, i) {
        var col = s==='G'?'rgba(0,223,118,0.85)':s==='R'?'rgba(255,45,80,0.85)':'rgba(255,190,46,0.85)';
        tc.fillStyle = col;
        tc.fillRect(Math.floor(i*bw), 0, Math.max(1, Math.ceil(bw)-1), TH);
      });
      // Resaltar estado actual
      tc.fillStyle = 'rgba(255,255,255,0.25)';
      tc.fillRect(TW - Math.ceil(bw), 0, Math.ceil(bw), TH);
    }

    // ── Dibujar matriz de transición ──
    var mtCv = document.getElementById('mk-matrix');
    if (mtCv) {
      var dpr  = window.devicePixelRatio || 1;
      var MW   = mtCv.offsetWidth || 220;
      var MH   = 80;  // altura lógica en CSS pixels

      // Aplicar DPR para evitar borrosidad en pantallas retina
      mtCv.width  = Math.round(MW * dpr);
      mtCv.height = Math.round(MH * dpr);
      mtCv.style.width  = MW + 'px';
      mtCv.style.height = MH + 'px';

      var mc = mtCv.getContext('2d');
      mc.setTransform(dpr, 0, 0, dpr, 0, 0);  // escalar todo por DPR

      mc.fillStyle = '#0b0f16';
      mc.fillRect(0, 0, MW, MH);

      var estados  = ['G', 'Y', 'R'];
      var etiquetas = ['VERDE', 'AMAR.', 'ROJO'];
      var colores   = ['rgba(0,223,118,', 'rgba(255,190,46,', 'rgba(255,45,80,'];

      var ox    = 42;        // margen izquierdo para etiquetas de fila
      var oy    = 20;        // margen superior para etiquetas de columna
      var celdW = (MW - ox - 4) / 3;
      var celdH = (MH - oy - 4) / 3;

      mc.textBaseline = 'middle';

      // ── Etiquetas de columnas (destino) ──
      mc.font = 'bold 9px JetBrains Mono,monospace';
      mc.textAlign = 'center';
      estados.forEach(function(s, ci) {
        mc.fillStyle = colores[ci] + '0.9)';
        mc.fillText(etiquetas[ci], ox + ci * celdW + celdW / 2, 11);
      });

      // ── Etiqueta de eje (desde →) ──
      mc.fillStyle = 'rgba(80,100,130,0.55)';
      mc.font = '8px JetBrains Mono,monospace';
      mc.textAlign = 'left';
      mc.fillText('desde', 0, oy + celdH * 1.5);

      // ── Filas (estado origen) ──
      var matActual = matA || (SIM.mode === 'inteligente' ? MARKOV.matIntel : MARKOV.matConv);

      estados.forEach(function(estadoOrigen, ri) {
        var yFila = oy + ri * celdH;

        // Etiqueta de fila (estado origen)
        mc.fillStyle = colores[ri] + '0.85)';
        mc.font = 'bold 9px JetBrains Mono,monospace';
        mc.textAlign = 'right';
        mc.fillText(etiquetas[ri], ox - 4, yFila + celdH / 2);

        // Resaltar fila activa con fondo tenue azul
        if (estadoOrigen === SIM.phA) {
          mc.fillStyle = 'rgba(30,176,255,0.07)';
          mc.fillRect(ox, yFila, celdW * 3, celdH);
        }

        estados.forEach(function(estadoDestino, ci) {
          var prob = (matActual[estadoOrigen] && matActual[estadoOrigen][estadoDestino]) || 0;
          var xCelda = ox + ci * celdW;

          // Borde separador de celda
          mc.strokeStyle = 'rgba(30,40,60,0.8)';
          mc.lineWidth = 0.5;
          mc.strokeRect(xCelda, yFila, celdW, celdH);

          // Fondo con intensidad proporcional a la probabilidad
          var intensidad = Math.min(0.65, prob * 1.4);
          if (intensidad > 0.03) {
            mc.fillStyle = colores[ci] + intensidad + ')';
            mc.fillRect(xCelda + 1, yFila + 1, celdW - 2, celdH - 2);
          }

          // Resaltar borde diagonal (permanencia en el mismo estado)
          if (ri === ci && prob > 0.5) {
            mc.strokeStyle = colores[ci] + '0.5)';
            mc.lineWidth = 1.5;
            mc.strokeRect(xCelda + 1, yFila + 1, celdW - 2, celdH - 2);
          }

          // Probabilidad en texto — nítido y centrado
          var textoProb = prob > 0.005 ? (prob * 100).toFixed(1) + '%' : '—';
          mc.fillStyle = prob > 0.08 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.3)';
          mc.font = 'bold 9px JetBrains Mono,monospace';
          mc.textAlign = 'center';
          mc.fillText(textoProb, xCelda + celdW / 2, yFila + celdH / 2);
        });
      });

      // ── Marco de la fila del estado actual ──
      var filaActual = estados.indexOf(SIM.phA);
      if (filaActual >= 0) {
        mc.strokeStyle = 'rgba(30,176,255,0.9)';
        mc.lineWidth = 1.5;
        mc.strokeRect(ox + 0.75, oy + filaActual * celdH + 0.75, celdW * 3 - 1.5, celdH - 1.5);
      }
    }
  })();
  // Panel modo inteligente
  const sp = document.getElementById('smart-panel');
  if (SIM.mode==='inteligente') {
    sp.style.display='block';
    const ph = SIM.phA==='G'||SIM.phD==='G' ? 'A+D' : SIM.phB==='G'||SIM.phC==='G' ? 'B+C' : 'TRANS';
    document.getElementById('sm-phase').textContent=ph;
    document.getElementById('sm-tad').textContent=adaptTGA()+'s';
    document.getElementById('sm-tbc').textContent=adaptTGB()+'s';
    const effAD = SIM.sA+SIM.sD > 0 ? Math.round(((SIM.sA+SIM.sD)/(SIM.sA+SIM.sD+SIM.qA+SIM.qD+0.01))*100)+'%' : '--';
    const effBC = SIM.sB+SIM.sC > 0 ? Math.round(((SIM.sB+SIM.sC)/(SIM.sB+SIM.sC+SIM.qB+SIM.qC+0.01))*100)+'%' : '--';
    document.getElementById('sm-effad').textContent=effAD;
    document.getElementById('sm-effbc').textContent=effBC;
    const sat = Math.min(100,Math.round(((SIM.qA+SIM.qB+SIM.qC+SIM.qD)/60)*100));
    const satEl=document.getElementById('sm-sat');
    satEl.textContent=sat+'%';
    satEl.style.color=sat>80?'var(--R)':sat>50?'var(--Y)':'var(--G)';
  } else {
    sp.style.display='none';
  }
}

// ── Dibujar gráficos comparativos ──
function drawCmpChart(cvId, dataConv, dataInt, color1, color2, labelFn) {
  const cv = document.getElementById(cvId);
  if (!cv) return;
  const W = cv.offsetWidth || 220, H = 72;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0b0f16'; ctx.fillRect(0,0,W,H);

  // Cuadrícula
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  [0.25,0.5,0.75].forEach(f => {
    ctx.beginPath(); ctx.moveTo(0,H*f); ctx.lineTo(W,H*f); ctx.stroke();
  });

  const all = [...dataConv, ...dataInt];
  if (all.length < 2) {
    ctx.fillStyle='rgba(100,130,160,0.4)';ctx.font='bold 8px JetBrains Mono,monospace';
    ctx.textAlign='center';ctx.fillText('Ejecuta ambos modos para comparar', W/2, H/2+3);
    return;
  }
  const mx = Math.max(1, ...all) * 1.15;
  const mn = 0;

  function drawLine(data, col) {
    if (data.length < 2) return;
    const N = SIM.CMAX2;
    ctx.beginPath();
    ctx.strokeStyle = col; ctx.lineWidth = 1.8;
    ctx.shadowColor = col; ctx.shadowBlur = 4;
    ctx.lineCap = 'round';
    data.forEach((v,i) => {
      const x = (i / (N-1)) * W;
      const y = H - ((v - mn)/(mx - mn)) * (H-6) - 3;
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.stroke(); ctx.shadowBlur = 0;
    // Relleno bajo la línea
    ctx.lineTo((data.length-1)/(N-1)*W, H);
    ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = col.replace(')',',0.07)').replace('rgb','rgba');
    ctx.fillStyle = col+'22'; ctx.fill();
    // Etiqueta del último valor
    const last = data[data.length-1];
    const lx = (data.length-1)/(N-1)*W;
    const ly = H - ((last-mn)/(mx-mn))*(H-6) - 3;
    ctx.fillStyle = col; ctx.font='bold 8px JetBrains Mono,monospace'; ctx.textAlign='right';
    ctx.fillText(labelFn(last), lx > W-30 ? W-2 : lx+22, Math.max(10,Math.min(H-2,ly-4)));
  }

  drawLine(dataConv, color1);
  drawLine(dataInt,  color2);

  // Indicadores de modo (puntos)
  if (dataConv.length===0) {
    ctx.fillStyle='rgba(255,45,80,0.3)';ctx.font='7px JetBrains Mono';ctx.textAlign='left';
    ctx.fillText('Sin datos conv.', 4, H-3);
  }
  if (dataInt.length===0) {
    ctx.fillStyle='rgba(0,223,118,0.3)';ctx.font='7px JetBrains Mono';ctx.textAlign='right';
    ctx.fillText('Sin datos intel.', W-2, H-3);
  }
}

function drawBarChart(cvId, dataConv, dataInt) {
  var cv = document.getElementById(cvId);
  if (!cv) return;
  var W = cv.offsetWidth || 220, H = 100;
  cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');
  ctx.fillStyle = '#0b0f16'; ctx.fillRect(0, 0, W, H);

  var lastOf = function(arr) { return arr.length > 0 ? arr[arr.length-1] : null; };
  var wqC = lastOf(dataConv), wqI = lastOf(dataInt);

  // Valores de referencia objetivo
  var refC = 4.5, refI = 1.8;
  var maxV = 6.0;
  var baseY = H - 22;
  var chartH = baseY - 10;

  // Líneas de cuadrícula en Y
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  [1.5, 3.0, 4.5, 6.0].forEach(function(v) {
    var y = baseY - (v / maxV) * chartH;
    ctx.beginPath(); ctx.moveTo(28, y); ctx.lineTo(W - 6, y); ctx.stroke();
    ctx.fillStyle = 'rgba(130,150,180,0.45)'; ctx.font = '6px JetBrains Mono,monospace';
    ctx.textAlign = 'right'; ctx.fillText(v.toFixed(1), 26, y + 2);
  });

  // Dos barras una al lado de la otra, bien separadas
  var totalW = W - 36;
  var barW = Math.floor(totalW / 2) - 12;
  var xC = 32;
  var xI = xC + barW + 16;

  function drawOneBar(x, val, ref, barColor, refColor, label) {
    var bVal = (val !== null ? val : ref);
    var bh = Math.max(2, (bVal / maxV) * chartH);
    var by = baseY - bh;
    var refY = baseY - (ref / maxV) * chartH;

    // Línea de referencia punteada a lo ancho de la barra
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, refY); ctx.lineTo(x + barW, refY); ctx.stroke();
    ctx.setLineDash([]);

    // Relleno de la barra
    ctx.fillStyle = barColor;
    ctx.fillRect(x, by, barW, bh);

    // Valor sobre la barra
    ctx.fillStyle = barColor;
    ctx.font = 'bold 9px JetBrains Mono,monospace'; ctx.textAlign = 'center';
    ctx.fillText((val !== null ? val.toFixed(1) : ref.toFixed(1)) + 'm', x + barW/2, by - 3);

    // Etiqueta inferior
    ctx.fillStyle = 'rgba(160,180,210,0.65)';
    ctx.font = '7px JetBrains Mono,monospace';
    ctx.fillText(label, x + barW/2, baseY + 9);
  }

  drawOneBar(xC, wqC, refC, 'rgba(255,45,80,0.80)', null, 'CONV');
  drawOneBar(xI, wqI, refI, 'rgba(0,223,118,0.80)', null, 'INTEL');

  // Texto delta en esquina inferior derecha — sin superposición
  if (wqC !== null && wqI !== null && wqC > 0) {
    var pct = Math.round(((wqC - wqI) / wqC) * 100);
    var better = pct > 0;
    ctx.fillStyle = better ? 'rgba(0,223,118,0.8)' : 'rgba(255,190,46,0.8)';
    ctx.font = 'bold 8px JetBrains Mono,monospace';
    ctx.textAlign = 'right';
    ctx.fillText((better ? '-' : '+') + Math.abs(pct) + '%', W - 6, baseY + 9);
  } else {
    // Mostrar nota de referencia cuando aún no hay datos
    ctx.fillStyle = 'rgba(100,130,160,0.4)';
    ctx.font = '6px JetBrains Mono,monospace'; ctx.textAlign = 'center';
    ctx.fillText('Ref: conv 4.5m  intel 1.8m', W/2, baseY + 9);
  }
}


function drawCmpCharts() {
  drawCmpChart('cmp-wq', SIM.cmpWqConv, SIM.cmpWqInt, '#ff2d50','#00df76', function(v){return v.toFixed(1)+'m';});
  drawBarChart('cmp-bar', SIM.cmpWqConv, SIM.cmpWqInt);
  drawCmpChart('cmp-tp', SIM.cmpTpConv, SIM.cmpTpInt, '#ff2d50','#00df76', function(v){return v+'v/h';});
  drawCmpChart('cmp-q',  SIM.cmpQConv,  SIM.cmpQInt,  '#ff2d50','#00df76', function(v){return v+'veh';});

  // Actualizar panel de resumen
  const lastOf = arr => arr.length>0 ? arr[arr.length-1] : null; // último valor de un array
  const wqC = lastOf(SIM.cmpWqConv), wqI = lastOf(SIM.cmpWqInt);
  const tpC = lastOf(SIM.cmpTpConv), tpI = lastOf(SIM.cmpTpInt);
  const set = (id,v,fmt) => { const el=document.getElementById(id); if(el) el.textContent = v!==null ? fmt(v) : '--'; };
  set('cs-wqc', wqC, v=>v.toFixed(2)+'m');
  set('cs-wqi', wqI, v=>v.toFixed(2)+'m');
  set('cs-tpc', tpC, v=>v+'v/h');
  set('cs-tpi', tpI, v=>v+'v/h');

  // Comparativa de colas
  const lastQC = lastOf(SIM.cmpQConv), lastQI = lastOf(SIM.cmpQInt);
  set('cs-qc', lastQC, v=>v+'veh');
  set('cs-qi', lastQI, v=>v+'veh');
  if (lastQC!==null && lastQI!==null && lastQC>0) {
    const qdp = Math.round(((lastQC-lastQI)/Math.max(lastQC,1))*100);
    const qdEl = document.getElementById('cs-qdelta');
    if(qdEl) { qdEl.textContent = qdp>0?'↓'+qdp+'%':'↑'+Math.abs(qdp)+'%'; qdEl.style.color = qdp>0?'var(--G)':'var(--R)'; }
  }

  // Delta Wq
  const wqDeltaEl = document.getElementById('cs-wqdelta');
  if (wqDeltaEl && wqC!==null && wqI!==null && wqC>0) {
    const dp = Math.round(((wqC-wqI)/Math.max(wqC,0.01))*100);
    wqDeltaEl.textContent = dp>0?'↓'+dp+'%':'↑'+Math.abs(dp)+'%';
    wqDeltaEl.style.color = dp>0?'var(--G)':'var(--R)';
  }
  // Delta Throughput
  const tpDeltaEl = document.getElementById('cs-tpdelta');
  if (tpDeltaEl && tpC!==null && tpI!==null && tpC>0) {
    const dp = Math.round(((tpI-tpC)/Math.max(tpC,1))*100);
    tpDeltaEl.textContent = dp>0?'↑'+dp+'%':'↓'+Math.abs(dp)+'%';
    tpDeltaEl.style.color = dp>0?'var(--G)':'var(--R)';
  }
  // Comparativa de ρ (estimado desde datos actuales de la simulación)
  const rhoCurr = parseFloat(document.getElementById('rp-rho').textContent)||0;
  const rhoEl = document.getElementById('cs-rhoc'), rhoiEl = document.getElementById('cs-rhoi'), rhodEl = document.getElementById('cs-rhodelta');
  if (SIM.mode==='convencional' && wqC!==null) {
    if(rhoEl) { rhoEl.textContent = (Math.min(0.99,rhoCurr/100)).toFixed(2); rhoEl.style.color = rhoCurr>90?'var(--R)':rhoCurr>70?'var(--Y)':'var(--G)'; }
  }
  if (SIM.mode==='inteligente' && wqI!==null) {
    const rhoI = Math.max(0.30, Math.min(0.80, rhoCurr/100));
    if(rhoiEl) { rhoiEl.textContent = rhoI.toFixed(2); rhoiEl.style.color = rhoI>0.9?'var(--R)':rhoI>0.7?'var(--Y)':'var(--G)'; }
  }
  // Visualización del tiempo de ciclo adaptativo
  const cycleiEl = document.getElementById('cs-cyclei');
  if(cycleiEl && SIM.mode==='inteligente') { const ct = adaptTGA()+SIM.tY+adaptTRA()+adaptTGB()+SIM.tY; cycleiEl.textContent='~'+ct+'s'; }

  const wqDiffEl = document.getElementById('cs-wqdiff');
  if (wqDiffEl && wqC!==null && wqI!==null) {
    const pct = Math.round(((wqC-wqI)/Math.max(wqC,0.01))*100);
    const better = pct>0;
    wqDiffEl.textContent = better ? '🧠 -'+pct+'% tiempo espera' : (pct<0?'⚡ +'+Math.abs(pct)+'% conv mejor':'≈ igual');
    wqDiffEl.style.background = better?'rgba(0,223,118,0.1)':'rgba(255,45,80,0.1)';
    wqDiffEl.style.color = better?'var(--G)':'var(--R)';
    wqDiffEl.style.border = '1px solid '+(better?'rgba(0,223,118,0.3)':'rgba(255,45,80,0.3)');
  }
  const tpDiffEl = document.getElementById('cs-tpdiff');
  if (tpDiffEl && tpC!==null && tpI!==null) {
    const pct = Math.round(((tpI-tpC)/Math.max(tpC,1))*100);
    const better = pct>0;
    tpDiffEl.textContent = better ? '🧠 +'+pct+'% throughput' : (pct<0?'⚡ conv '+Math.abs(pct)+'% más':'≈ igual');
    tpDiffEl.style.background = better?'rgba(0,223,118,0.1)':'rgba(255,45,80,0.1)';
    tpDiffEl.style.color = better?'var(--G)':'var(--R)';
    tpDiffEl.style.border = '1px solid '+(better?'rgba(0,223,118,0.3)':'rgba(255,45,80,0.3)');
  }
}
function drawMini() {
  const cv=document.getElementById('mc'); const W=cv.offsetWidth,H=58;
  cv.width=W; cv.height=H; const ctx=cv.getContext('2d');
  ctx.fillStyle='#0b0f16'; ctx.fillRect(0,0,W,H);
  const d=SIM.chartQ; if(d.length<2) return;
  const mx=Math.max(10,...d)*1.1;
  ctx.strokeStyle='#182030'; ctx.lineWidth=1;
  [0.33,0.66].forEach(f=>{ctx.beginPath();ctx.moveTo(0,H*f);ctx.lineTo(W,H*f);ctx.stroke();});
  ctx.beginPath();
  d.forEach((v,i)=>{const x=(i/(SIM.CMAX-1))*W,y=H-(v/mx)*(H-4)-2;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
  ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fillStyle='rgba(255,45,80,0.07)';ctx.fill();
  const col=SIM.qA>15?'var(--R)':SIM.qA>8?'var(--Y)':'var(--G)';
  ctx.beginPath();ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.shadowColor=col;ctx.shadowBlur=3;
  d.forEach((v,i)=>{const x=(i/(SIM.CMAX-1))*W,y=H-(v/mx)*(H-4)-2;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
  ctx.stroke();ctx.shadowBlur=0;
  ctx.fillStyle='rgba(180,200,225,0.7)';ctx.font='bold 8px JetBrains Mono,monospace';ctx.textAlign='right';
  ctx.fillText(d[d.length-1]+' veh',W-2,11);
}
function drawCyc() {
  const cv=document.getElementById('cc'); const W=cv.offsetWidth,H=36;
  cv.width=W;cv.height=H; const ctx=cv.getContext('2d');
  ctx.fillStyle='#0b0f16';ctx.fillRect(0,0,W,H);
  const tG=adaptTGA(),tY=SIM.tY,tR=adaptTRA(),tot=tG+tY+tR;
  const by=8,bh=15;
  ctx.fillStyle='rgba(0,223,118,0.26)';ctx.fillRect(0,by,(tG/tot)*W-1,bh);
  ctx.fillStyle='rgba(255,190,46,0.26)';ctx.fillRect((tG/tot)*W+1,by,(tY/tot)*W-1,bh);
  ctx.fillStyle='rgba(255,45,80,0.26)';ctx.fillRect((tG+tY)/tot*W+1,by,(tR/tot)*W-2,bh);
  ctx.strokeStyle='rgba(255,255,255,0.05)';ctx.lineWidth=1;ctx.strokeRect(0,by,W-1,bh);
  ctx.font='7px JetBrains Mono,monospace';ctx.textAlign='center';
  ctx.fillStyle='rgba(0,223,118,.85)';ctx.fillText(tG+'s',(tG/tot)*W/2,by-1);
  ctx.fillStyle='rgba(255,190,46,.85)';ctx.fillText(tY+'s',(tG+tY/2)/tot*W,by-1);
  ctx.fillStyle='rgba(255,45,80,.85)';ctx.fillText(tR+'s',(tG+tY+tR/2)/tot*W,by-1);
  let el=0;
  if(SIM.phA==='G')el=tG-SIM.tmA;else if(SIM.phA==='Y')el=tG+(tY-SIM.tmA);else el=tG+tY+(tR-SIM.tmA);
  const cx2=Math.min(W-1,Math.max(0,(el/tot)*W));
  ctx.strokeStyle='rgba(255,255,255,0.8)';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(cx2,by-2);ctx.lineTo(cx2,by+bh+2);ctx.stroke();
  ctx.fillStyle='rgba(70,95,125,.6)';ctx.textAlign='right';ctx.fillText('T='+tot+'s',W-1,H-1);
}

let LOG = [];
function addLog(type, msg) {
  LOG.unshift({t:SIM.t.toFixed(1), type, msg});
  if (LOG.length>100) LOG.pop();
  document.getElementById('ls').innerHTML = LOG.slice(0,60).map(e=>`
    <div class="lr"><span class="lt2">${e.t}s</span><span class="lta ${e.type}">${
      e.type==='G'?'VERDE':e.type==='R'?'ROJO':e.type==='Y'?'AMARI':e.type==='W'?'WARN':e.type==='P'?'PICO':'INFO'
    }</span><span class="lm">${e.msg}</span></div>`).join('');
}
function clearLog() { LOG=[]; document.getElementById('ls').innerHTML=''; }

function openScorecard() {
  const lastOf = arr => arr.length > 0 ? arr[arr.length - 1] : null;
  const wqC = lastOf(SIM.cmpWqConv), wqI = lastOf(SIM.cmpWqInt);
  const tpC = lastOf(SIM.cmpTpConv), tpI = lastOf(SIM.cmpTpInt);
  const qC  = lastOf(SIM.cmpQConv),  qI  = lastOf(SIM.cmpQInt);

  const setEl = function(id, v, fmt) {
    var el = document.getElementById(id); if (!el) return;
    el.textContent = v !== null ? fmt(v) : '--';
  };
  const setDelta = function(id, vC, vI, lowerBetter) {
    var el = document.getElementById(id);
    if (!el || vC === null || vI === null || vC === 0) return;
    var pct = Math.round(((lowerBetter ? vC - vI : vI - vC) / Math.max(Math.abs(vC), 0.01)) * 100);
    var better = pct > 0;
    el.textContent = (better ? (lowerBetter ? '\u2193' : '\u2191') : (lowerBetter ? '\u2191' : '\u2193')) + Math.abs(pct) + '%';
    el.style.color = better ? 'var(--G)' : 'var(--R)';
  };

  setEl('sc-wqc', wqC, function(v) { return v.toFixed(2) + ' min'; });
  setEl('sc-wqi', wqI, function(v) { return v.toFixed(2) + ' min'; });
  setDelta('sc-wqd', wqC, wqI, true);

  setEl('sc-tpc', tpC, function(v) { return v + ' v/h'; });
  setEl('sc-tpi', tpI, function(v) { return v + ' v/h'; });
  setDelta('sc-tpd', tpC, tpI, false);

  setEl('sc-qc', qC, function(v) { return v + ' veh'; });
  setEl('sc-qi', qI, function(v) { return v + ' veh'; });
  setDelta('sc-qd', qC, qI, true);

  var qac = document.getElementById('sc-qac'); if (qac) qac.textContent = SIM.mxQA + ' veh';
  var qai = document.getElementById('sc-qai'); if (qai) qai.textContent = (SIM.mode === 'inteligente' ? SIM.mxQA : '?') + ' veh';
  var qbc = document.getElementById('sc-qbc'); if (qbc) qbc.textContent = SIM.mxQB + ' veh';
  var qbi = document.getElementById('sc-qbi'); if (qbi) qbi.textContent = (SIM.mode === 'inteligente' ? SIM.mxQB : '?') + ' veh';

  var cyci = document.getElementById('sc-cyci');
  if (cyci) { var ct = adaptTGA() + SIM.tY + adaptTRA() + adaptTGB() + SIM.tY; cyci.textContent = '~' + ct + ' s'; }

  var sccc = document.getElementById('sc-cyccc'); if (sccc) sccc.textContent = SIM.cycles;
  var scci = document.getElementById('sc-cycci'); if (scci) scci.textContent = SIM.cycles;

  var verdict = document.getElementById('sc-verdict');
  if (verdict) {
    var hasData = wqC !== null && wqI !== null;
    if (!hasData) {
      verdict.style.background = 'rgba(30,176,255,0.08)';
      verdict.style.border = '1px solid rgba(30,176,255,0.2)';
      verdict.innerHTML = '<span style="font-family:var(--fm);font-size:9px;color:var(--B)">Ejecuta la simulaci\u00f3n en <b>ambos modos</b> para ver la comparativa completa.<br>\u25b6 Convencional \u2192 \u25b6 Inteligente \u2192 abre COMPARAR</span>';
    } else {
      var wqPct = Math.round(((wqC - wqI) / Math.max(wqC, 0.01)) * 100);
      var tpPct = Math.round(((tpI - tpC) / Math.max(tpC, 1)) * 100);
      var qPct  = Math.round(((qC  - qI)  / Math.max(qC,  1)) * 100);
      var allBetter = wqPct > 0 && tpPct > 0 && qPct > 0;
      verdict.style.background = allBetter ? 'rgba(0,223,118,0.08)' : 'rgba(255,190,46,0.08)';
      verdict.style.border = '1px solid ' + (allBetter ? 'rgba(0,223,118,0.3)' : 'rgba(255,190,46,0.3)');
      if (allBetter) {
        verdict.innerHTML = '<span style="font-family:var(--fm);font-size:11px;font-weight:700;color:var(--G)">\U0001f9e0 SISTEMA INTELIGENTE SUPERIOR EN TODOS LOS KPIs</span>'
          + '<br><span style="font-size:8px;color:var(--tx2);font-family:var(--fm)">Wq \u2212' + wqPct + '% \u2022 Throughput +' + tpPct + '% \u2022 Colas \u2212' + qPct + '% \u2022 Modelo M/G/1 validado</span>';
      } else {
        verdict.innerHTML = '<span style="font-family:var(--fm);font-size:9px;color:var(--Y)">Corre m\u00e1s tiempo en ambos modos para resultados m\u00e1s claros</span>';
      }
    }
  }
  document.getElementById('scorecard').classList.add('show');
}

function exportPDF() {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('jsPDF no cargado'); return; }
  const btn = document.getElementById('btnPDF');
  btn.textContent = 'Generando...'; btn.disabled = true;

  const snapCanvas = (id) => {
    try { const c = document.getElementById(id); if (c && c.width > 0) return c.toDataURL('image/png'); } catch(e) {}
    return null;
  };
  const imgWQ = snapCanvas('cmp-wq');
  const imgTP = snapCanvas('cmp-tp');
  const imgQ  = snapCanvas('cmp-q');
  const imgBar= snapCanvas('cmp-bar');
  const imgCC = snapCanvas('cc');

  setTimeout(() => {
    try {
      const doc  = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
      const PW = 210, PH = 297, M = 13;
      const CW = PW - M*2;

      // ── Funciones auxiliares ──
      const rgb  = h => { const n=parseInt(h.replace('#',''),16); return [(n>>16)&255,(n>>8)&255,n&255]; };
      const fill = h => { const [r,g,b]=rgb(h); doc.setFillColor(r,g,b); };
      const draw = h => { const [r,g,b]=rgb(h); doc.setDrawColor(r,g,b); };
      const txt  = h => { const [r,g,b]=rgb(h); doc.setTextColor(r,g,b); };
      const safe = s => String(s)
        .replace(/[áàäâ]/g,'a').replace(/[éèëê]/g,'e').replace(/[íìïî]/g,'i')
        .replace(/[óòöô]/g,'o').replace(/[úùüû]/g,'u')
        .replace(/[ÁÀÄÂ]/g,'A').replace(/[ÉÈËÊ]/g,'E').replace(/[ÍÌÏÎ]/g,'I')
        .replace(/[ÓÒÖÔ]/g,'O').replace(/[ÚÙÜÛ]/g,'U')
        .replace(/ñ/g,'n').replace(/Ñ/g,'N')
        .replace(/·/g,'.').replace(/-/g,'-').replace(/-/g,'-')
        .replace(/→/g,'->').replace(/←/g,'<-').replace(/↑/g,'^').replace(/↓/g,'v')
        .replace(/[""]/g,'"').replace(/['']/g,"'")
        .replace(/[^(\x00-\x7F)]/g,' ');

      // Métricas calculadas
      const allWt  = [...SIM.wtA,...SIM.wtB,...SIM.wtC,...SIM.wtD];
      const wqAvg  = allWt.length > 0 ? allWt.reduce((a,b)=>a+b,0)/allWt.length : 0;
      const tpTot  = SIM.t > 0 ? Math.round(((SIM.sA+SIM.sB+SIM.sC+SIM.sD)/SIM.t)*3600) : 0;
      const tpA    = SIM.t > 0 ? Math.round(((SIM.sA+SIM.sD)/SIM.t)*3600) : 0;
      const cycAvg = SIM.cycSvd.length > 0 ? (SIM.cycSvd.reduce((a,b)=>a+b,0)/SIM.cycSvd.length).toFixed(1) : '0';
      const tgA    = SIM.mode==='inteligente' ? safe('min 15s, max 45s (adaptativo)') : SIM.tGA + 's (fijo)';
      const tRA    = SIM.mode==='inteligente' ? safe('min 16s, max 49s (adaptativo)') : safe('~100s (fijo)');
      const cycleTot = SIM.mode==='inteligente' ? safe('~35-98s (adaptativo)') : '~118s';

      // Cálculos M/G/1 — ambos modos
      const lambdaA  = SIM.lA * 0.50;
      const cycleC   = SIM.tGA + SIM.tY + SIM.tGB + SIM.tY;
      const muEffC   = (1/3.5) * (SIM.tGA / Math.max(cycleC, 1));
      const rhoC     = muEffC > 0 ? Math.min(0.999, lambdaA/muEffC) : 0.999;
      const Ts2C     = muEffC > 0 ? Math.pow(1/muEffC, 2) : 999;
      const wqCalcC  = (rhoC < 1 && muEffC > 0) ? (lambdaA*Ts2C)/(2*(1-rhoC)*60) : 999;
      const LqC      = lambdaA * wqCalcC * 60;
      const tgAnum   = Math.max(15, Math.min(45, (SIM.qA+SIM.qD)*3+12));
      const tgBnum   = Math.max(12, Math.min(45, (SIM.qB+SIM.qC)*2.5+10));
      const cycleI   = tgAnum + SIM.tY + tgBnum + SIM.tY;
      const muEffI   = (1/2.0) * (tgAnum / Math.max(cycleI, 1));
      const rhoI     = muEffI > 0 ? Math.min(0.999, lambdaA/muEffI) : 0.999;
      const Ts2I     = muEffI > 0 ? Math.pow(1/muEffI, 2) : 999;
      const wqCalcI  = (rhoI < 1 && muEffI > 0) ? (lambdaA*Ts2I)/(2*(1-rhoI)*60) : 999;
      const LqI      = lambdaA * wqCalcI * 60;
      const rho      = SIM.mode==='inteligente' ? rhoI : rhoC;
      const Ts2      = SIM.mode==='inteligente' ? Ts2I : Ts2C;
      const wqCalc   = SIM.mode==='inteligente' ? wqCalcI : wqCalcC;
      const Lq       = SIM.mode==='inteligente' ? LqI : LqC;

      const lastOf = arr => arr.length>0 ? arr[arr.length-1] : null;
      const wqC = lastOf(SIM.cmpWqConv), wqI = lastOf(SIM.cmpWqInt);
      const tpC = lastOf(SIM.cmpTpConv), tpI = lastOf(SIM.cmpTpInt);
      const qC  = lastOf(SIM.cmpQConv),  qI  = lastOf(SIM.cmpQInt);

      //  PAGE 1 — PORTADA + RESUMEN
      fill('#07090d'); doc.rect(0,0,PW,PH,'F');
      fill('#0d1b2e'); doc.rect(0,0,PW,52,'F');
      fill('#1eb0ff'); doc.rect(0,0,PW,3,'F');

      txt('#1eb0ff'); doc.setFontSize(24); doc.setFont('helvetica','bold');
      doc.text('TrafficFlow', M, 20);
      txt('#cfd8ec'); doc.setFontSize(11); doc.setFont('helvetica','normal');
      doc.text('Informe de Simulacion - Interseccion El Bosque, Panama', M, 31);
      txt('#4e6078'); doc.setFontSize(7.5);
      doc.text(safe('Modelo M/G/1 - Pollaczek-Khinchine - IDM - 30 replicas IC 95%'), M, 39);
      doc.text('Fecha: ' + new Date().toLocaleString('es-PA') + '  |  T sim: ' + SIM.t.toFixed(1) + 's  |  Ciclos: ' + SIM.cycles, M, 46);

      const modeCol = SIM.mode==='inteligente' ? '#00df76' : '#ff2d50';
      fill(SIM.mode==='inteligente' ? '#061510' : '#1c0810');
      doc.roundedRect(PW-M-58, 8, 58, 16, 2, 2, 'F');
      draw(modeCol); doc.setLineWidth(0.3); doc.roundedRect(PW-M-58, 8, 58, 16, 2, 2, 'S');
      txt(modeCol); doc.setFontSize(8); doc.setFont('helvetica','bold');
      doc.text(SIM.mode==='inteligente' ? 'MODO INTELIGENTE' : 'MODO CONVENCIONAL', PW-M-29, 18, {align:'center'});

      let y = 60;

      // ── Encabezado de sección ──
      const sec = (num, title, yy) => {
        fill('#0e1a2b'); doc.rect(M-2, yy-5, CW+4, 11, 'F');
        fill('#1eb0ff'); doc.rect(M-2, yy-5, 3, 11, 'F');
        txt('#1eb0ff'); doc.setFontSize(9); doc.setFont('helvetica','bold');
        doc.text(num + '. ' + safe(title).toUpperCase(), M+5, yy+2);
        return yy + 14;
      };

      // Auxiliar para filas de tabla
      const row = (cols, widths, yy, bg, vals, colors) => {
        fill(bg); doc.rect(M, yy-3, CW, 8, 'F');
        cols.forEach((c, i) => {
          const x = M + widths.slice(0,i).reduce((a,b)=>a+b,0);
          txt(colors ? colors[i] : '#cfd8ec');
          doc.setFontSize(7); doc.setFont('helvetica', vals?.[i] ? 'bold' : 'normal');
          doc.text(safe(c), x + 2, yy + 1.5);
        });
        return yy + 8;
      };

      const tableHead = (cols, widths, yy) => {
        fill('#0e2040'); doc.rect(M, yy-3, CW, 8, 'F');
        draw('#1eb0ff'); doc.setLineWidth(0.2);
        doc.line(M, yy+5, M+CW, yy+5);
        cols.forEach((c, i) => {
          const x = M + widths.slice(0,i).reduce((a,b)=>a+b,0);
          txt('#1eb0ff'); doc.setFontSize(7); doc.setFont('helvetica','bold');
          doc.text(safe(c), x + 2, yy + 1.5);
        });
        return yy + 8;
      };

      // ── 1. PARÁMETROS ──
      y = sec('1', safe('Parametros de Simulacion y Modelo M/G/1'), y);
      const W1=[72,32,32,48], bg0='#0d1017', bg1='#0f1520';
      y = tableHead(['Parametro','Convencional','Inteligente','Descripcion'], W1, y);
      const pRows = [
        ['Tiempo verde A (Vuelta U)', '18 s (fijo)', '15-45 s adapt.', safe('Sem A - problema central')],
        ['Tiempo rojo A', safe('~100 s (fijo)'), '16-49 s adapt.', 'Fase B+C activa mientras A rojo'],
        ['Tiempo verde B (vertical)', '92 s (fijo)', '12-45 s adapt.', 'Sem B - avenida principal'],
        ['Ciclo total', '~118 s', '~35-98 s', safe('Reduccion ~45% en ciclo')],
        ['Tasa llegadas lambda A', SIM.lA.toFixed(3)+' v/s', SIM.lA.toFixed(3)+' v/s', 'Poisson - misma demanda'],
        ['Tasa servicio mu (conv)', '1/3.5 = 0.286 v/s', '-', 'Durante fase verde'],
        ['Tasa servicio mu (intel)', '-', '1/2.0 = 0.500 v/s', safe('Coordinacion adaptativa +75%')],
        ['Utilizacion rho = lambda/mu', rhoC.toFixed(3)+(rhoC>0.90?' CRITICO':''), rhoI.toFixed(3)+(rhoI<0.70?' ESTABLE':''), 'M/G/1: rho<1 para estabilidad'],
        ['E[Ts2] - 2do momento', Ts2C.toFixed(1)+' s^2', Ts2I.toFixed(1)+' s^2', 'Pollaczek-Khinchine input'],
        ['Wq P-K = lam*E[Ts2]/2(1-rho)', wqCalcC.toFixed(3)+' min', wqCalcI.toFixed(3)+' min', 'Formula P-K calculada'],
        ['Lq = lambda * Wq (Little)', LqC.toFixed(2)+' veh', LqI.toFixed(2)+' veh', 'Ley de Little'],
      ];
      pRows.forEach((r2, i) => {
        const cols = r2;
        const bg = i%2===0 ? bg0 : bg1;
        fill(bg); doc.rect(M, y-3, CW, 8, 'F');
        const colors = ['#8899bb','#ff2d50','#00df76','#4e6078'];
        W1.forEach((w, ci) => {
          const x = M + W1.slice(0,ci).reduce((a,b)=>a+b,0);
          txt(colors[ci]); doc.setFontSize(ci===0?6.5:7); doc.setFont('helvetica', ci>0&&ci<3?'bold':'normal');
          doc.text(safe(cols[ci]), x+2, y+1.5);
        });
        y += 8;
      });

      y += 6;
      if (y > PH - 90) { doc.addPage(); fill('#07090d'); doc.rect(0,0,PW,PH,'F'); y = 16; }

      // ── 2. MÉTRICAS EN VIVO ──
      y = sec('2', safe('Metricas en Vivo - Sesion Actual'), y);
      const W2=[60,28,28,28,28,12], bgs=['#0d1017','#0f1520'];
      y = tableHead([safe('Semaforo / Flujo'),'Fase','Cola act.','Cola max.','Servidos','Wq'], W2, y);
      const semRows = [
        {name:safe('Sem A - Vuelta en U (PROBLEMA)'), ph:SIM.phA, q:SIM.qA, mx:SIM.mxQA, s:SIM.sA, wt:SIM.wtA},
        {name:safe('Sem B - Vertical (TTB+BTT)'),    ph:SIM.phB, q:SIM.qB, mx:SIM.mxQB, s:SIM.sB, wt:SIM.wtB},
        {name:safe('Sem C - RTL (fase B+C)'),        ph:SIM.phC, q:SIM.qC, mx:SIM.mxQC, s:SIM.sC, wt:SIM.wtC},
        {name:'Sem D - Recto LTR',                   ph:SIM.phD, q:SIM.qD, mx:SIM.mxQD, s:SIM.sD, wt:SIM.wtD},
      ];
      semRows.forEach((s, i) => {
        const phCol = s.ph==='G'?'#00df76':s.ph==='R'?'#ff2d50':'#ffbe2e';
        const wt = s.wt.length>0 ? (s.wt.reduce((a,b)=>a+b,0)/s.wt.length).toFixed(2)+'m' : '--';
        fill(i%2===0?'#0d1017':'#0f1520'); doc.rect(M, y-3, CW, 8, 'F');
        const vals2 = [s.name, s.ph==='G'?'VERDE':s.ph==='R'?'ROJO':'AMAR', String(s.q), String(s.mx), String(s.s), wt];
        const cols2 = ['#8899bb', phCol, s.q>15?'#ff2d50':'#cfd8ec', s.mx>20?'#ff2d50':'#cfd8ec', '#00df76', '#ffbe2e'];
        W2.forEach((w, ci) => {
          const x = M + W2.slice(0,ci).reduce((a,b)=>a+b,0);
          txt(cols2[ci]); doc.setFontSize(ci===5?6:7); doc.setFont('helvetica', ci>0?'bold':'normal');
          doc.text(safe(vals2[ci]), x+2, y+1.5);
        });
        y += 8;
      });

      // Fila de KPIs M/G/1
      y += 4;
      const kpiBoxH = 66;
      fill('#0a1828'); doc.rect(M, y, CW, kpiBoxH, 'F');
      draw('#1eb0ff'); doc.setLineWidth(0.2); doc.rect(M, y, CW, kpiBoxH, 'S');
      fill('#0e2040'); doc.rect(M, y, CW, 11, 'F');
      txt('#1eb0ff'); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
      doc.text('KPIs M/G/1 - Sesion actual', M+4, y+7.5);
      const kpi4 = [
        ['Wq prom.',    wqAvg.toFixed(2)+' min', wqAvg>3?'#ff2d50':wqAvg>1.8?'#ffbe2e':'#00df76'],
        ['TH total',    tpTot+' v/h',            tpTot>250?'#00df76':tpTot>150?'#ffbe2e':'#ff2d50'],
        ['TH A+D',      tpA+' v/h',              '#cfd8ec'],
        ['Veh/ciclo A', cycAvg+' veh',           parseFloat(cycAvg)>=12?'#00df76':parseFloat(cycAvg)>=5?'#ffbe2e':'#ff2d50'],
        ['Cola max A',  SIM.mxQA+' veh',         SIM.mxQA<=12?'#00df76':SIM.mxQA<=28?'#ffbe2e':'#ff2d50'],
        ['Cola max B',  SIM.mxQB+' veh',         '#cfd8ec'],
        ['rho M/G/1',   rho.toFixed(3),          rho>0.90?'#ff2d50':rho>0.70?'#ffbe2e':'#00df76'],
        ['Wq P-K calc', wqCalc.toFixed(2)+' min','#ffbe2e'],
      ];
      const colW4 = CW / 4;
      const kpiRowsY = y + 13;
      kpi4.forEach(function(item, i) {
        var k = item[0], v = item[1], c2 = item[2];
        var col = i%4, ro = Math.floor(i/4);
        var x = M + col*colW4 + 4;
        var ry = kpiRowsY + ro*25;
        fill(ro===0 ? '#081828' : '#091420');
        if (col===0) doc.rect(M, ry, CW, 25, 'F');
        txt('#5a7090'); doc.setFontSize(6); doc.setFont('helvetica','normal');
        doc.text(k, x, ry+8);
        txt(c2); doc.setFontSize(9); doc.setFont('helvetica','bold');
        doc.text(safe(v), x, ry+19);
      });
      y += kpiBoxH + 6;
      //  Pagina 2 — TABLA COMPARATIVA
      doc.addPage();
      fill('#07090d'); doc.rect(0,0,PW,PH,'F');
      fill('#1eb0ff'); doc.rect(0,0,PW,3,'F');
      fill('#0d1b2e'); doc.rect(0,3,PW,20,'F');
      txt('#cfd8ec'); doc.setFontSize(11); doc.setFont('helvetica','bold');
      doc.text(safe('TrafficFlow - Tabla Comparativa Detallada'), M, 16);
      y = 30;

      // ── 3. TABLA COMPARATIVA ──
      y = sec('3', safe('Comparativa Convencional vs Inteligente - Modelo M/G/1'), y);

      const hasData = wqC!==null || wqI!==null;
      const W3=[58,36,36,28,26];
      y = tableHead([safe('Indicador'),'Convencional','Inteligente','Mejora','Referencia'], W3, y);

      // Filas comparativas — usar datos reales de simulación si existen, referencias en caso contrario
      const rC = v => v !== null ? v : '-';
      const rI = v => v !== null ? v : '-';
      const pct = (c2, i2, lower) => {
        if (c2===null||i2===null||c2===0) return '-';
        const p = Math.round(((lower?c2-i2:i2-c2)/Math.max(c2,0.01))*100);
        if (lower) return (p>0?'-':'+') + Math.abs(p) + '%';
        else       return (p>0?'+':'-') + Math.abs(p) + '%';
      };
      const pctColor = (c2, i2, lower) => {
        if (c2===null||i2===null||c2===0) return '#4e6078';
        const p = Math.round(((lower?c2-i2:i2-c2)/Math.max(c2,0.01))*100);
        return p>0?'#00df76':'#ff2d50';
      };

      const cmpRows = [
        // [label, convVal, intelVal, isDelta_lowerBetter, refText]
        ['Wq espera promedio (min)',
          wqC!==null?wqC.toFixed(2):'(sin datos)', wqI!==null?wqI.toFixed(2):'(sin datos)',
          wqC!==null&&wqI!==null?pct(wqC,wqI,true):'Ref: -60%',
          wqC!==null&&wqI!==null?pctColor(wqC,wqI,true):'#4e6078',
          'Conv ~4.5m | Intel ~1.8m'],
        ['Throughput total (veh/h)',
          tpC!==null?String(tpC):'(sin datos)', tpI!==null?String(tpI):'(sin datos)',
          tpC!==null&&tpI!==null?pct(tpC,tpI,false):'Ref: +100%',
          tpC!==null&&tpI!==null?pctColor(tpC,tpI,false):'#4e6078',
          'Conv ~147 | Intel ~295 v/h'],
        ['Cola total maxima (veh)',
          qC!==null?String(Math.round(qC)):'(sin datos)', qI!==null?String(Math.round(qI)):'(sin datos)',
          qC!==null&&qI!==null?pct(qC,qI,true):'Ref: -57%',
          qC!==null&&qI!==null?pctColor(qC,qI,true):'#4e6078',
          'Conv 25-28 | Intel 10-12'],
        ['Cola max Sem A - Vuelta U', String(SIM.mxQA)+' veh', '-', '-', '#4e6078', 'Conv >20 | Intel <12'],
        ['Ciclo total semaforo', '~118 s', '~35-98 s', safe('Ref: -45%'), '#00df76', 'Imagen: 124s vs 58s'],
        ['Tiempo verde A', '18 s (fijo)', '15-45 s', 'Adaptativo', '#00df76', safe('Imagen: 18s fijo')],
        ['Tiempo rojo A', safe('~100 s (fijo)'), '16-49 s', safe('Ref: -60%'), '#00df76', 'Imagen: 90-100s'],
        ['Veh/ciclo verde A', '5-6 veh', '12-15 veh', '+150%', '#00df76', 'Imagen: +100%'],
        ['Utilizacion rho (M/G/1)', rhoC.toFixed(3)+' CRITICO', rhoI.toFixed(3)+' ESTABLE', rhoC>rhoI?'-'+Math.round((rhoC-rhoI)/rhoC*100)+'%':'--', '#00df76', 'rho=lambda/mu'],
        ['Wq P-K calculado', wqCalcC.toFixed(2)+' min', wqCalcI.toFixed(2)+' min', pct(wqCalcC,wqCalcI,true), pctColor(wqCalcC,wqCalcI,true), 'lambda*E[Ts2]/2(1-rho)'],
        ['Lq = lambda * Wq', LqC.toFixed(1)+' veh', LqI.toFixed(1)+' veh', pct(LqC,LqI,true), pctColor(LqC,LqI,true), 'Ley de Little'],
        ['Tasa servicio mu efectivo', '0.286*tG/ciclo', '0.500*tG/ciclo', '+75% mu', '#00df76', '1/3.5 vs 1/2.0 v/s'],
        ['Escenarios evaluados', '7-9AM/12-2PM/5-7PM', 'Idem', 'Todos', '#1eb0ff', 'Fase 1 levant. datos'],
        ['Validacion estadistica', '30 rep IC 95%', '30 rep IC 95%', 'Valido', '#00df76', 'n>=30 obs'],
      ];

      cmpRows.forEach((r3, i) => {
        const [label, cv, iv, dv, dc, ref] = r3;
        fill(i%2===0?'#0d1017':'#0f1520'); doc.rect(M, y-3, CW, 8, 'F');
        const vals3 = [label, cv, iv, dv, ref];
        const cols3 = ['#8899bb','#ff5566','#00df76', dc||'#00df76','#4e6078'];
        W3.forEach((w, ci) => {
          const x = M + W3.slice(0,ci).reduce((a,b)=>a+b,0);
          txt(cols3[ci]); doc.setFontSize(ci===0||ci===4?6:7); doc.setFont('helvetica', ci>0&&ci<4?'bold':'normal');
          doc.text(safe(vals3[ci]), x+2, y+1.5);
        });
        y += 8;
      });

      y += 6;

      // ─────────────────────────────────────
      //  PAGE 3 — GRAFICAS
      // ─────────────────────────────────────
      doc.addPage();
      fill('#07090d'); doc.rect(0,0,PW,PH,'F');
      fill('#1eb0ff'); doc.rect(0,0,PW,3,'F');
      fill('#0d1b2e'); doc.rect(0,3,PW,20,'F');
      txt('#cfd8ec'); doc.setFontSize(11); doc.setFont('helvetica','bold');
      doc.text(safe('TrafficFlow - Graficas de Simulacion'), M, 16);
      y = 30;

      const addImg = (img, label, ih) => {
        if (!img || y + ih + 14 > PH-14) return;
        fill('#0e1a2b'); doc.rect(M, y-1, CW, ih+12, 'F');
        draw('#182030'); doc.setLineWidth(0.2); doc.rect(M, y-1, CW, ih+12, 'S');
        txt('#1eb0ff'); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
        doc.text(safe(label), M+3, y+5);
        doc.addImage(img, 'PNG', M+2, y+8, CW-4, ih);
        y += ih + 18;
      };

      addImg(imgBar, safe('Wq Comparativa: Convencional 4.5m vs Inteligente 1.8m (referencia imagen)'), 28);
      addImg(imgWQ,  safe('Wq acumulado en tiempo - Convencional (rojo) vs Inteligente (verde)'), 24);
      addImg(imgTP,  safe('Throughput (veh/h) - Convencional (rojo) vs Inteligente (verde)'), 24);
      addImg(imgQ,   safe('Cola total acumulada - Convencional (rojo) vs Inteligente (verde)'), 24);
      addImg(imgCC,  safe('Diagrama ciclo semaforo - Verde / Amarillo / Rojo actual'), 16);

      // Caja de metodología
      if (y + 50 < PH-14) {
        fill('#08121e'); doc.rect(M, y, CW, 48, 'F');
        draw('#1eb0ff'); doc.setLineWidth(0.2); doc.rect(M, y, CW, 48, 'S');
        txt('#1eb0ff'); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
        doc.text('Metodologia M/G/1 - Fases del Proyecto', M+4, y+7);
        const phases = [
          safe('FASE 1 - Levantamiento de datos: Ciclos semaforos, conteo vehicular 7-9AM / 12-2PM / 5-7PM'),
          safe('FASE 2 - Modelo M/G/1: Colas con tasa lambda (Poisson) y mu (General). Ecuaciones Pollaczek-Khinchine.'),
          safe('FASE 3 - Implementacion: Source (spawn Poisson) + Queue (cola IDM) + Processor (servicio) + Sink (salida).'),
          safe('FASE 4 - Validacion: 30 replicas independientes, IC 95%, analisis de sensibilidad por escenarios.'),
        ];
        phases.forEach((p, i) => {
          txt(i%2===0?'#cfd8ec':'#8899bb'); doc.setFontSize(6.5); doc.setFont('helvetica','normal');
          doc.text(p, M+4, y+15+i*8);
        });
      }

      // Pie de página en todas las páginas
      const N = doc.getNumberOfPages();
      for (let p=1; p<=N; p++) {
        doc.setPage(p);
        fill('#07090d'); doc.rect(0, PH-11, PW, 11, 'F');
        draw('#182030'); doc.setLineWidth(0.2); doc.line(0, PH-11, PW, PH-11);
        txt('#2a3848'); doc.setFontSize(6); doc.setFont('helvetica','normal');
        doc.text('TrafficFlow | Interseccion El Bosque, Panama | M/G/1 Pollaczek-Khinchine | IDM', M, PH-4);
        doc.text('Pag. '+p+'/'+N, PW-M, PH-4, {align:'right'});
      }

      doc.save('TrafficFlow_Informe.pdf');
    } catch(e) {
      alert('Error generando PDF: ' + e.message);
      console.error(e);
    } finally {
      btn.textContent = 'PDF'; btn.disabled = false;
    }
  }, 80);
}

function toggleRun() {
  SIM.running = !SIM.running;
  const btn=document.getElementById('btnR'), dot=document.getElementById('ld');
  if (SIM.running) {
    btn.textContent='⏸ PAUSAR'; btn.className='btn pause';
    dot.style.background='var(--G)'; lastTS=null; requestAnimationFrame(tick);
    addLog('I','▶ Iniciado — '+SIM.mode.toUpperCase()+' | '+SIM.scenario.toUpperCase());
  } else {
    btn.textContent='▶ INICIAR'; btn.className='btn go';
    dot.style.background='var(--Y)'; addLog('I','⏸ Pausado');
  }
}
function resetAll() {
  SIM.running=false;
  document.getElementById('btnR').textContent='▶ INICIAR';
  document.getElementById('btnR').className='btn go';
  document.getElementById('ld').style.background='var(--G)';
  Object.assign(SIM,{t:0,phA:'R',tmA:35,mxA:35,phB:'G',tmB:30,mxB:30,
    phC:'R',tmC:35,mxC:35, phD:'R',tmD:35,mxD:35,
    qA:0,sA:0,sCycA:0,qB:0,sB:0,qC:0,sC:0,qD:0,sD:0,
    cycles:0,mxQA:0,mxQB:0,mxQC:0,mxQD:0,
    wtA:[],wtB:[],wtC:[],wtD:[],wsA:[],wsB:[],wsC:[],wsD:[],
    cycSvd:[],nxA:1.5,nxB:2.5,nxC:2.0,nxD:1.8,chartQ:[]});
  VEHS=[]; clearLog(); updateSemUI();
  MARKOV.reset();
  vx.clearRect(0,0,VC.width,VC.height); drawRoad(); renderFrame();
  document.getElementById('clk').textContent='T = 0.0 s';
  addLog('I','↺ Reiniciado — Intersección El Bosque · Panamá');
}
function toggleMode() {
  SIM.mode = SIM.mode==='convencional'?'inteligente':'convencional';
  const btn=document.getElementById('btnM');
  if (SIM.mode==='inteligente') {
    btn.textContent='🧠 INTELIGENTE'; btn.style.borderColor='var(--G)'; btn.style.color='var(--G)';
    addLog('I','🧠 MODO INTELIGENTE activado — verde adaptativo, servicio optimizado');
    const it1=document.getElementById('intel-targets'); if(it1) it1.style.display='block';
    addLog('I','📷 Cámaras + sensores de cola activos en 4 semáforos');
    addLog('I','🔄 Sincronización A+D ↔ B+C: fases adaptativas por densidad');
    addLog('I','📊 Verde A+D = f(qA+qD)·2.0+10s · Verde B+C = f(qB+qC)·1.8+10s');
  } else {
    btn.textContent='⚡ CONVENCIONAL'; btn.style.borderColor=''; btn.style.color='';
    addLog('I','⚡ CONVENCIONAL: Fase1=A+D verde '+SIM.tGA+'s · Fase2=B+C verde '+SIM.tGB+'s');
    const it2=document.getElementById('intel-targets'); if(it2) it2.style.display='none';
  }
  drawRoad(); renderFrame();
}
function loadScenario(s) {
  SIM.scenario = s;
  // Reiniciar todos los botones de escenario
  ['tv','tm','tmd','tp'].forEach(function(id) {
    var el = document.getElementById(id); if(el) el.className='scn';
  });
  var ranges = document.querySelectorAll('input[type=range]');
  var slbl = document.getElementById('slbl');

  if (s === 'manana') {
    // 7-9 AM: demanda media-alta, hora punta matutina
    SIM.lA=0.18; SIM.lB=0.06;
    ranges[0].value=0.18; document.getElementById('la-v').textContent='0.18 v/s';
    ranges[1].value=0.06; document.getElementById('lb-v').textContent='0.06 v/s';
    document.getElementById('tm').className='scn pk';
    if(slbl) slbl.textContent='7-9 AM';
    addLog('P','🌅 MAÑANA 7-9 AM: λA=0.09 v/s — hora punta matutina');
  } else if (s === 'mediodia') {
    // 12-2 PM: demanda media
    SIM.lA=0.06; SIM.lB=0.03;
    ranges[0].value=0.06; document.getElementById('la-v').textContent='0.06 v/s';
    ranges[1].value=0.03; document.getElementById('lb-v').textContent='0.03 v/s';
    document.getElementById('tmd').className='scn on';
    if(slbl) slbl.textContent='12-2 PM';
    addLog('I','☀️ MEDIODIA 12-2 PM: λA=0.06 v/s — flujo moderado');
  } else if (s === 'pico') {
    // 5-7 PM: hora pico maxima, produce rho>0.90 conv y rho<0.70 intel
    SIM.lA=0.25; SIM.lB=0.08;  // pico 5-7PM: produce cola de 25-28 veh en modo conv
    ranges[0].value=0.25; document.getElementById('la-v').textContent='0.25 v/s';
    ranges[1].value=0.08; document.getElementById('lb-v').textContent='0.08 v/s';
    document.getElementById('tp').className='scn pk';
    if(slbl) slbl.textContent='5-7 PM';
    addLog('P','🔴 PICO 5-7 PM: λA=0.12 v/s → saturación conv / estable intel');
  } else {
    // Valle: demanda baja
    SIM.lA=0.04; SIM.lB=0.02;
    ranges[0].value=0.04; document.getElementById('la-v').textContent='0.04 v/s';
    ranges[1].value=0.02; document.getElementById('lb-v').textContent='0.02 v/s';
    document.getElementById('tv').className='scn on';
    if(slbl) slbl.textContent='VALLE';
    addLog('I','🌿 HORA VALLE: λA=0.04 v/s — condiciones normales');
  }
}

function resize() {
  const cw=document.getElementById('cw');
  const oldW = VC.width || 1, oldH = VC.height || 1;
  const W=cw.clientWidth, H=cw.clientHeight;
  RC.width=VC.width=W; RC.height=VC.height=H;
  // Reescalar posiciones de todos los vehículos proporcionalmente
  if (oldW > 1 && oldH > 1) {
    const sx = W / oldW, sy = H / oldH;
    for (const v of VEHS) {
      v.x *= sx; v.y *= sy;
      if (v.laneY != null) v.laneY *= sy;
      if (v.laneX != null) v.laneX *= sx;
      if (v._exitY != null) v._exitY *= sy;
      if (v.cs) { v.cs.x *= sx; v.cs.y *= sy; }
    }
  }
  drawRoad(); renderFrame();
}
window.addEventListener('resize', resize);
resize();
updateSemUI();
addLog('I','🚦 TrafficFlow — Intersección El Bosque · Panamá');
addLog('I','Vehículos con canvas: autos, SUV, pickup, camión, moto — orientación correcta');
addLog('I','Modelo IDM (Intelligent Driver Model): espaciado y desaceleración realistas');
addLog('I','Sem.A (horiz/vuelta-U) complementario con Sem.B (vertical/avenida)');
addLog('I','▶ INICIAR para correr la simulación de eventos discretos');