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
  lpView:'x4',
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

function normalizeModeName(mode) {
  return mode === 'inteligente' ? 'inteligente' : 'convencional';
}

function getModeMarkovAggregateKey(mode) {
  return normalizeModeName(mode) === 'inteligente' ? 'A_inteligente' : 'A_convencional';
}

const MODE_RUN_STATS = {
  convencional: { cycles: 0 },
  inteligente: { cycles: 0 },
};

function resetModeRunStats() {
  MODE_RUN_STATS.convencional.cycles = 0;
  MODE_RUN_STATS.inteligente.cycles = 0;
}

function getModeRunStats(mode) {
  return MODE_RUN_STATS[normalizeModeName(mode)];
}

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
    // Desde R: permanece ~100s en R, luego → G
    R: { R: 0.990, Y: 0.000, G: 0.010 },
    // Desde Y: permanece ~4s en Y, luego → R
    Y: { R: 0.250, Y: 0.750, G: 0.000 },
    // Desde G: permanece ~18s en G, luego → Y
    G: { R: 0.000, Y: 0.056, G: 0.944 },
  },

  matIntel: {
    // Desde R: rojo adaptativo ~16-49s promedio ~32s → P(salir) = 1/32
    R: { R: 0.969, Y: 0.000, G: 0.031 },
    // Desde Y: igual 4s
    Y: { R: 0.250, Y: 0.750, G: 0.000 },
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
    recordMarkovAggregate('A', tA);
    recordMarkovAggregate(getModeMarkovAggregateKey(SIM.mode), tA);
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
  predictNext: function(currentState, mode, matrixOverride) {
    var mat = matrixOverride || (mode === 'inteligente' ? this.matIntel : this.matConv);
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
    resetMarkovAggregate();
    resetModeRunStats();
  }
};

// ── Programación Lineal (resolución equivalente a Solver QM / Simplex) ──
// Modelo para asignar tiempos verdes por ciclo:
//   Variables: gH, gV, uH, uV
//   Max Z = 0.50*gH + 0.42*gV - 8*uH - 5*uV
//   s.a.: gH+gV=58, 15<=gH<=41, 12<=gV<=41, 0.50*gH+uH>=dH, 0.42*gV+uV>=dV, no negatividad
const LP_MODEL = {
  cycleSec: 66,
  yellowSecPerPhase: 4,
  horizDemandFactor: 1.05, // A + C + D ~= 105% de lambda_A
  sH: 0.50, // capacidad horizontal (veh/s)
  sV: 0.42, // capacidad vertical (veh/s)
  penUH: 8,
  penUV: 5,
  domainPenalty: 20,
  demandPenalty2Var: 60,
  bounds: {
    gH: [15, 41],
    gV: [12, 41],
  },

  evaluatePlan: function(gH, gV, lambdaA, lambdaB) {
    var C = this.cycleSec;
    var y = Number.isFinite(SIM.tY) ? SIM.tY : this.yellowSecPerPhase;
    var greenBudget = Math.max(0, C - 2 * y);
    var lambdaH = Math.max(0, lambdaA || 0) * this.horizDemandFactor;
    var lambdaV = Math.max(0, lambdaB || 0);
    var dH = lambdaH * C;
    var dV = lambdaV * C;
    var servedH = this.sH * Math.max(0, gH);
    var servedV = this.sV * Math.max(0, gV);
    var uH = Math.max(0, dH - servedH);
    var uV = Math.max(0, dV - servedV);
    var gHmin = this.bounds.gH[0], gHmax = this.bounds.gH[1];
    var gVmin = this.bounds.gV[0], gVmax = this.bounds.gV[1];
    var violBudget = Math.abs((gH + gV) - greenBudget);
    var violBounds =
      Math.max(0, gHmin - gH) + Math.max(0, gH - gHmax) +
      Math.max(0, gVmin - gV) + Math.max(0, gV - gVmax);
    var domainViolation = violBudget + violBounds;
    var Zraw = servedH + servedV - this.penUH * uH - this.penUV * uV;
    var Z = Zraw - this.domainPenalty * domainViolation;

    return {
      gH: gH,
      gV: gV,
      greenBudget: greenBudget,
      lambdaH: lambdaH,
      lambdaV: lambdaV,
      dH: dH,
      dV: dV,
      servedH: servedH,
      servedV: servedV,
      uH: uH,
      uV: uV,
      Zraw: Zraw,
      Z: Z,
      inDomain: domainViolation <= 1e-9,
      domainViolation: domainViolation,
      feasibleNoDeficit: uH <= 1e-9 && uV <= 1e-9,
    };
  },

  solve: function(lambdaA, lambdaB) {
    var y = Number.isFinite(SIM.tY) ? SIM.tY : this.yellowSecPerPhase;
    var greenBudget = Math.max(0, this.cycleSec - 2 * y);
    var gHmin = this.bounds.gH[0], gHmax = this.bounds.gH[1];
    var gVmin = this.bounds.gV[0], gVmax = this.bounds.gV[1];
    var best = null;

    for (var gH = gHmin; gH <= gHmax; gH++) {
      var gV = greenBudget - gH;
      if (gV < gVmin || gV > gVmax) continue;

      var e = this.evaluatePlan(gH, gV, lambdaA, lambdaB);
      if (!best) {
        best = e;
        continue;
      }
      var betterZ = e.Z > best.Z + 1e-9;
      var tieZ = Math.abs(e.Z - best.Z) <= 1e-9;
      var betterDeficit = (e.uH + e.uV) < (best.uH + best.uV) - 1e-9;
      var betterHoriz = e.gH > best.gH;
      if (betterZ || (tieZ && (betterDeficit || betterHoriz))) best = e;
    }

    if (!best) {
      best = this.evaluatePlan(gHmin, Math.max(gVmin, greenBudget - gHmin), lambdaA, lambdaB);
    }

    best.greenBudget = greenBudget;
    best.yellowTotal = 2 * y;
    return best;
  },

  evaluate2Var: function(gH, gV, lambdaA, lambdaB) {
    var C = this.cycleSec;
    var y = Number.isFinite(SIM.tY) ? SIM.tY : this.yellowSecPerPhase;
    var greenBudget = Math.max(0, C - 2 * y);
    var lambdaH = Math.max(0, lambdaA || 0) * this.horizDemandFactor;
    var lambdaV = Math.max(0, lambdaB || 0);
    var dH = lambdaH * C;
    var dV = lambdaV * C;
    var servedH = this.sH * Math.max(0, gH);
    var servedV = this.sV * Math.max(0, gV);
    var defH = Math.max(0, dH - servedH);
    var defV = Math.max(0, dV - servedV);
    var gHmin = this.bounds.gH[0], gHmax = this.bounds.gH[1];
    var gVmin = this.bounds.gV[0], gVmax = this.bounds.gV[1];
    var violBudget = Math.abs((gH + gV) - greenBudget);
    var violBounds =
      Math.max(0, gHmin - gH) + Math.max(0, gH - gHmax) +
      Math.max(0, gVmin - gV) + Math.max(0, gV - gVmax);
    var domainViolation = violBudget + violBounds;
    var demandViolation = defH + defV;
    var Zraw = servedH + servedV;
    var Z = Zraw - this.domainPenalty * domainViolation - this.demandPenalty2Var * demandViolation;

    return {
      gH: gH,
      gV: gV,
      greenBudget: greenBudget,
      lambdaH: lambdaH,
      lambdaV: lambdaV,
      dH: dH,
      dV: dV,
      servedH: servedH,
      servedV: servedV,
      uH: defH,
      uV: defV,
      Zraw: Zraw,
      Z: Z,
      inDomain: domainViolation <= 1e-9,
      domainViolation: domainViolation,
      feasibleNoDeficit: defH <= 1e-9 && defV <= 1e-9,
    };
  },

  solve2Var: function(lambdaA, lambdaB) {
    var y = Number.isFinite(SIM.tY) ? SIM.tY : this.yellowSecPerPhase;
    var greenBudget = Math.max(0, this.cycleSec - 2 * y);
    var gHmin = this.bounds.gH[0], gHmax = this.bounds.gH[1];
    var gVmin = this.bounds.gV[0], gVmax = this.bounds.gV[1];
    var best = null;

    for (var gH = gHmin; gH <= gHmax; gH++) {
      var gV = greenBudget - gH;
      if (gV < gVmin || gV > gVmax) continue;

      var e = this.evaluate2Var(gH, gV, lambdaA, lambdaB);
      if (!best) {
        best = e;
        continue;
      }
      var betterZ = e.Z > best.Z + 1e-9;
      var tieZ = Math.abs(e.Z - best.Z) <= 1e-9;
      var betterDeficit = (e.uH + e.uV) < (best.uH + best.uV) - 1e-9;
      var betterHoriz = e.gH > best.gH;
      if (betterZ || (tieZ && (betterDeficit || betterHoriz))) best = e;
    }

    if (!best) {
      best = this.evaluate2Var(gHmin, Math.max(gVmin, greenBudget - gHmin), lambdaA, lambdaB);
    }

    best.greenBudget = greenBudget;
    best.yellowTotal = 2 * y;
    return best;
  },

  projectToDomain: function(gHRaw, gVRaw) {
    var y = Number.isFinite(SIM.tY) ? SIM.tY : this.yellowSecPerPhase;
    var greenBudget = Math.max(0, this.cycleSec - 2 * y);
    var gHmin = this.bounds.gH[0], gHmax = this.bounds.gH[1];
    var gVmin = this.bounds.gV[0], gVmax = this.bounds.gV[1];
    var h = Math.max(0, Number(gHRaw) || 0);
    var v = Math.max(0, Number(gVRaw) || 0);
    var sum = h + v;

    if (sum <= 1e-9) {
      h = (gHmin + gHmax) / 2;
    } else {
      h = greenBudget * (h / sum);
    }

    h = Math.max(gHmin, Math.min(gHmax, h));
    var vv = greenBudget - h;
    if (vv < gVmin) { vv = gVmin; h = greenBudget - vv; }
    if (vv > gVmax) { vv = gVmax; h = greenBudget - vv; }

    h = Math.max(gHmin, Math.min(gHmax, h));
    vv = Math.max(gVmin, Math.min(gVmax, greenBudget - h));

    var hi = Math.round(h);
    var vi = Math.round(vv);
    var diff = greenBudget - (hi + vi);
    if (diff !== 0) hi += diff;

    if (hi < gHmin) hi = gHmin;
    if (hi > gHmax) hi = gHmax;
    vi = greenBudget - hi;
    if (vi < gVmin) { vi = gVmin; hi = greenBudget - vi; }
    if (vi > gVmax) { vi = gVmax; hi = greenBudget - vi; }

    return {
      gH: hi,
      gV: vi,
      greenBudget: greenBudget,
      rawH: Math.round(Math.max(0, Number(gHRaw) || 0)),
      rawV: Math.round(Math.max(0, Number(gVRaw) || 0)),
      rawSum: sum,
    };
  },
};

function getLPView() {
  return SIM.lpView === 'x2' ? 'x2' : 'x4';
}

function updateLPViewButtons() {
  var b2 = document.getElementById('lp-view-2');
  var b4 = document.getElementById('lp-view-4');
  if (b2) b2.classList.toggle('on', getLPView() === 'x2');
  if (b4) b4.classList.toggle('on', getLPView() === 'x4');
}

function setLPView(view) {
  SIM.lpView = view === 'x2' ? 'x2' : 'x4';
  updateLPViewButtons();
  if (typeof updateUI === 'function') updateUI();
}

function buildLPDataset(view, lpResult) {
  var safeView = view === 'x2' ? 'x2' : 'x4';
  var dH = (lpResult && Number.isFinite(lpResult.dH)) ? lpResult.dH : 0;
  var dV = (lpResult && Number.isFinite(lpResult.dV)) ? lpResult.dV : 0;
  var dHtxt = dH.toFixed(2);
  var dVtxt = dV.toFixed(2);
  var meta = safeView === 'x2'
    ? 'Variables: 2 (X1..X2) · Restricciones: 7 · Objetivo: Max'
    : 'Variables: 4 (X1..X4) · Restricciones: 7 · Objetivo: Max';
  var formula = safeView === 'x2'
    ? 'Max Z = 0.50·X1 + 0.42·X2<br>s.a. X1+X2=58, 15≤X1≤41, 12≤X2≤41, 0.50·X1≥dH, 0.42·X2≥dV'
    : 'Max Z = 0.50·X1 + 0.42·X2 − 8·X3 − 5·X4<br>s.a. X1+X2=58, 15≤X1≤41, 12≤X2≤41, 0.50·X1+X3≥dH, 0.42·X2+X4≥dV';

  var lines;
  var csvRows;
  if (safeView === 'x2') {
    lines = [
      'MAX:   0.50 X1 + 0.42 X2',
      'C1:    1.00 X1 + 1.00 X2               = 58',
      'C2:   -0.50 X1 + 0 X2                  <= -' + dHtxt,
      'C3:    0 X1 - 0.42 X2                  <= -' + dVtxt,
      'C4:    1.00 X1 + 0 X2                  <= 41',
      'C5:   -1.00 X1 + 0 X2                  <= -15',
      'C6:    0 X1 + 1.00 X2                  <= 41',
      'C7:    0 X1 - 1.00 X2                  <= -12',
      'X1=gH, X2=gV'
    ];
    csvRows = [
      ['Row', 'X1', 'X2', 'RHS', 'Equation form'],
      ['Maximize', '0.50', '0.42', '0', 'Max'],
      ['Constraint 1', '1.00', '1.00', '58', '='],
      ['Constraint 2', '-0.50', '0', '-' + dHtxt, '<='],
      ['Constraint 3', '0', '-0.42', '-' + dVtxt, '<='],
      ['Constraint 4', '1.00', '0', '41', '<='],
      ['Constraint 5', '-1.00', '0', '-15', '<='],
      ['Constraint 6', '0', '1.00', '41', '<='],
      ['Constraint 7', '0', '-1.00', '-12', '<='],
      ['Variables', 'X1=gH', 'X2=gV', '', '']
    ];
  } else {
    lines = [
      'MAX:   0.50 X1 + 0.42 X2 - 8 X3 - 5 X4',
      'C1:    1.00 X1 + 1.00 X2 + 0 X3 + 0 X4   = 58',
      'C2:   -0.50 X1 + 0 X2 - 1.00 X3 + 0 X4  <= -' + dHtxt,
      'C3:    0 X1 - 0.42 X2 + 0 X3 - 1.00 X4  <= -' + dVtxt,
      'C4:    1.00 X1 + 0 X2 + 0 X3 + 0 X4     <= 41',
      'C5:   -1.00 X1 + 0 X2 + 0 X3 + 0 X4     <= -15',
      'C6:    0 X1 + 1.00 X2 + 0 X3 + 0 X4     <= 41',
      'C7:    0 X1 - 1.00 X2 + 0 X3 + 0 X4     <= -12',
      'X1=gH, X2=gV, X3=uH, X4=uV'
    ];
    csvRows = [
      ['Row', 'X1', 'X2', 'X3', 'X4', 'RHS', 'Equation form'],
      ['Maximize', '0.50', '0.42', '-8', '-5', '0', 'Max'],
      ['Constraint 1', '1.00', '1.00', '0', '0', '58', '='],
      ['Constraint 2', '-0.50', '0', '-1.00', '0', '-' + dHtxt, '<='],
      ['Constraint 3', '0', '-0.42', '0', '-1.00', '-' + dVtxt, '<='],
      ['Constraint 4', '1.00', '0', '0', '0', '41', '<='],
      ['Constraint 5', '-1.00', '0', '0', '0', '-15', '<='],
      ['Constraint 6', '0', '1.00', '0', '0', '41', '<='],
      ['Constraint 7', '0', '-1.00', '0', '0', '-12', '<='],
      ['Variables', 'X1=gH', 'X2=gV', 'X3=uH', 'X4=uV', '', '']
    ];
  }

  return {
    view: safeView,
    meta: meta,
    formula: formula,
    lines: lines,
    txt: [
      'TITLE: TrafficFlow - LP Solver QM (' + (safeView === 'x2' ? '2 VAR' : '4 VAR') + ')',
      'OBJECTIVE: Maximize',
      meta,
      ''
    ].concat(lines).join('\n'),
    csv: csvRows.map(function(row) { return row.join(','); }).join('\n'),
  };
}

function downloadLPFile(filename, content, mimeType) {
  var blob = new Blob([content], { type: (mimeType || 'text/plain') + ';charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

function exportLPDataset(format) {
  var fmt = format === 'csv' ? 'csv' : 'txt';
  var view = getLPView();
  var lpResult = view === 'x2' ? LP_MODEL.solve2Var(SIM.lA, SIM.lB) : LP_MODEL.solve(SIM.lA, SIM.lB);
  var dataset = buildLPDataset(view, lpResult);
  var scenario = String(SIM.scenario || 'sesion').replace(/[^a-z0-9_-]/gi, '_');
  var suffix = view === 'x2' ? '2vars' : '4vars';
  var filename = 'QM_' + scenario + '_' + suffix + '.' + fmt;
  downloadLPFile(filename, fmt === 'csv' ? dataset.csv : dataset.txt, fmt === 'csv' ? 'text/csv' : 'text/plain');
  addLog('I', '📄 Dataset QM exportado: ' + filename);
}

function createMarkovAggregateStore() {
  return {
    obs: 0,
    last: null,
    visits: { R:0, Y:0, G:0 },
    trans: {
      R: { R:0, Y:0, G:0 },
      Y: { R:0, Y:0, G:0 },
      G: { R:0, Y:0, G:0 },
    },
  };
}

const MARKOV_AGG = {
  A: createMarkovAggregateStore(),
  A_convencional: createMarkovAggregateStore(),
  A_inteligente: createMarkovAggregateStore(),
};

function resetMarkovAggregate() {
  Object.keys(MARKOV_AGG).forEach(function(key) {
    MARKOV_AGG[key].obs = 0;
    MARKOV_AGG[key].last = null;
    ['R','Y','G'].forEach(function(s) {
      MARKOV_AGG[key].visits[s] = 0;
      ['R','Y','G'].forEach(function(t) {
        MARKOV_AGG[key].trans[s][t] = 0;
      });
    });
  });
}

function recordMarkovAggregate(key, state) {
  var store = MARKOV_AGG[key];
  if (!store || store.visits[state] === undefined) return;
  store.visits[state] += 1;
  store.obs += 1;
  if (store.last && store.trans[store.last] && store.trans[store.last][state] !== undefined) {
    store.trans[store.last][state] += 1;
  }
  store.last = state;
}

function getMarkovAggregateStats(key) {
  var store = MARKOV_AGG[key] || MARKOV_AGG.A;
  var total = Math.max(store.obs, 1);
  var steady = {
    R: store.visits.R / total,
    Y: store.visits.Y / total,
    G: store.visits.G / total,
  };
  var matrix = { R:{R:0,Y:0,G:0}, Y:{R:0,Y:0,G:0}, G:{R:0,Y:0,G:0} };
  ['R','Y','G'].forEach(function(from) {
    var rowTot = store.trans[from].R + store.trans[from].Y + store.trans[from].G;
    ['R','Y','G'].forEach(function(to) {
      matrix[from][to] = rowTot > 0 ? store.trans[from][to] / rowTot : 0;
    });
  });
  return {
    obs: store.obs,
    steady: steady,
    matrix: matrix,
  };
}

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
      ctx.save();
      ctx.translate(x, ly);
      ctx.lineCap='round';
      ctx.lineJoin='round';

      const drawUTurnStroke = function(strokeStyle, lineWidth) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(sz * 0.18, -sz * 0.24);
        ctx.lineTo(sz * 0.18, -sz * 0.02);
        ctx.quadraticCurveTo(sz * 0.18, sz * 0.28, -sz * 0.04, sz * 0.28);
        ctx.lineTo(-sz * 0.10, sz * 0.28);
        ctx.quadraticCurveTo(-sz * 0.26, sz * 0.28, -sz * 0.26, sz * 0.12);
        ctx.stroke();
      };

      drawUTurnStroke('rgba(4,10,6,0.92)', 3.6);
      drawUTurnStroke('rgba(236,255,244,0.98)', 1.8);

      ctx.fillStyle = 'rgba(236,255,244,0.98)';
      ctx.beginPath();
      ctx.moveTo(-sz * 0.44, sz * 0.12);
      ctx.lineTo(-sz * 0.18, -sz * 0.02);
      ctx.lineTo(-sz * 0.18, sz * 0.26);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.beginPath();
      ctx.arc(sz * 0.05, -sz * 0.18, sz * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (phase===c) {
      // Brillo simple en cualquier luz encendida — sin flecha
      ctx.fillStyle='rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(x-sz*0.17, ly-sz*0.18, sz*0.17, 0, Math.PI*2); ctx.fill();
    }
  });
  ctx.restore();
}

function drawSignalMarker(ctx, x, y, code, accent, dx, dy) {
  const mx = x + dx;
  const my = y + dy;
  ctx.save();
  ctx.font = 'bold 8px JetBrains Mono,monospace';
  const boxW = Math.max(24, Math.ceil(ctx.measureText(code).width) + 14);
  ctx.fillStyle = 'rgba(7,10,16,0.92)';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  roundRect(ctx, mx - boxW/2, my - 8, boxW, 16, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(code, mx, my + 0.5);
  ctx.restore();
}

function getSignalRigLayout(W, H) {
  const hCY = GEO.hCY * H;
  const hHH = GEO.hHH * H;
  const vCX = GEO.vCX * W;
  const vWW = GEO.vWW * W;
  const sAx = GEO.stopAx * W;
  const sByY = GEO.stopBy * H;
  const sCx = GEO.stopCx * W;
  const sDy = GEO.stopDy * H;
  const iLeft = vCX - vWW / 2;
  const iRight = vCX + vWW / 2;
  const iTop = hCY - hHH / 2;
  const iBot = hCY + hHH / 2;

  return {
    iLeft: iLeft,
    iRight: iRight,
    iTop: iTop,
    iBot: iBot,
    topArmY: iTop - 37,
    bottomArmY: iBot + 37,
    poles: {
      nw: { x: iLeft - 6, y: iTop },
      ne: { x: iRight + 6, y: iTop },
      sw: { x: iLeft - 6, y: iBot },
      se: { x: iRight + 6, y: iBot },
    },
    heads: {
      A:  { x: sAx - 18,         y: iTop - 22 },
      D:  { x: sAx + 16,         y: iTop - 22 },
      BN: { x: vCX + vWW * 0.12, y: sByY - 18 },
      BS: { x: vCX - vWW * 0.12, y: sDy + 18 },
      C:  { x: sCx + 16,         y: iBot + 22 },
    },
  };
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
  ctx.fillText('A · GIRO U', GEO.stopAx*W - 8, hCY - laneH*0.5 + 3);
  ctx.fillText('D · RECTO', GEO.stopAx*W - 8, hCY - laneH*1.5 + 3);
  ctx.fillText('D · RECTO', GEO.stopAx*W - 8, hCY - laneH*2.5 + 3);
  ctx.textAlign='left';
  ctx.fillText('C · RECTO der→izq', 10, hCY+hHH/2+13);
  ctx.save(); ctx.translate(vCX+vWW/2+6, 14);
  ctx.fillText('B · CALLE EL BOSQUE', 0, 0); ctx.restore();
  ctx.textAlign='left';

  // ── Postes semafóricos — 4 esquinas de la intersección ──
  const rig = getSignalRigLayout(W, H);
  const iLeft  = rig.iLeft;
  const iRight = rig.iRight;
  const iTop   = rig.iTop;
  const iBot   = rig.iBot;

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

  function drawMastToHead(pole, head, armY) {
    ctx.strokeStyle='#1e2c40'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(pole.x, armY); ctx.lineTo(head.x, armY); ctx.stroke();
    ctx.strokeStyle='#28405c'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(pole.x, armY); ctx.lineTo(head.x, armY); ctx.stroke();
    ctx.strokeStyle='#1e2c40'; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.moveTo(head.x, armY); ctx.lineTo(head.x, head.y); ctx.stroke();
  }

  drawPole(rig.poles.nw.x, rig.poles.nw.y, 0, -38, 0);
  drawPole(rig.poles.ne.x, rig.poles.ne.y, 0, -38, 0);
  drawPole(rig.poles.sw.x, rig.poles.sw.y, 0, 38, 0);
  drawPole(rig.poles.se.x, rig.poles.se.y, 0, 38, 0);

  // Distribución del mobiliario como cruce real:
  // A en el costado del giro, D arriba del frente, B separado por aproximaciones y C aislado en su esquina.
  drawMastToHead(rig.poles.nw, rig.heads.A, rig.topArmY);
  drawMastToHead(rig.poles.nw, rig.heads.D, rig.topArmY);
  drawMastToHead(rig.poles.ne, rig.heads.BN, rig.topArmY);
  drawMastToHead(rig.poles.sw, rig.heads.BS, rig.bottomArmY);
  drawMastToHead(rig.poles.se, rig.heads.C, rig.bottomArmY);
}

// ── Renderizar frame ──
function renderFrame() {
  const W = VC.width, H = VC.height;
  const ctx = vx;
  ctx.clearRect(0,0,W,H);
  const hCY = GEO.hCY*H, hHH = GEO.hHH*H;
  const vCX = GEO.vCX*W, vWW = GEO.vWW*W;
  const rig = getSignalRigLayout(W, H);

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
    const grd = ctx.createRadialGradient(rig.heads.A.x, hCY-hHH/4, 0, rig.heads.A.x, hCY-hHH/4, 110);
    grd.addColorStop(0,'rgba(0,223,118,0.055)'); grd.addColorStop(1,'transparent');
    ctx.fillStyle=grd; ctx.fillRect(rig.heads.A.x-110,hCY-hHH/2,220,hHH/2);
  }

  const isSmrt = SIM.mode==='inteligente';
  const tlType = isSmrt ? 'smart' : 'normal';
  const laneH = hHH/6;
  const drawSignalOverlay = function() {
    drawTL(ctx, rig.heads.D.x,  rig.heads.D.y,  SIM.phD, tlType);
    drawTL(ctx, rig.heads.A.x,  rig.heads.A.y,  SIM.phA, isSmrt ? 'smart' : 'arrow_uturn');
    drawTL(ctx, rig.heads.BN.x, rig.heads.BN.y, SIM.phB, tlType);
    drawTL(ctx, rig.heads.BS.x, rig.heads.BS.y, SIM.phB, tlType);
    drawTL(ctx, rig.heads.C.x,  rig.heads.C.y,  SIM.phC, tlType);

    drawSignalMarker(ctx, rig.heads.A.x,  rig.heads.A.y,  'A', '#ffbe2e', -26, -18);
    drawSignalMarker(ctx, rig.heads.D.x,  rig.heads.D.y,  'D', '#30c2ff',  26, -18);
    drawSignalMarker(ctx, rig.heads.BN.x, rig.heads.BN.y, 'B', '#00df76',  22, -16);
    drawSignalMarker(ctx, rig.heads.C.x,  rig.heads.C.y,  'C', '#8fc8ff',  26,  16);

    if (isSmrt) {
      ctx.save();
      const cams = [
        {x: rig.heads.A.x,  y: rig.heads.A.y,  ang: Math.PI/2,  col:'rgba(30,176,255,0.10)'},
        {x: rig.heads.D.x,  y: rig.heads.D.y,  ang: Math.PI/2,  col:'rgba(30,176,255,0.10)'},
        {x: rig.heads.C.x,  y: rig.heads.C.y,  ang: -Math.PI/2, col:'rgba(30,176,255,0.10)'},
        {x: rig.heads.BN.x, y: rig.heads.BN.y, ang: Math.PI,    col:'rgba(30,176,255,0.10)'},
        {x: rig.heads.BS.x, y: rig.heads.BS.y, ang: 0,          col:'rgba(30,176,255,0.10)'},
      ];
      cams.forEach(c => {
        const fov=0.55, len=55;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.arc(c.x, c.y, len, c.ang-fov, c.ang+fov);
        ctx.closePath();
        ctx.fillStyle=c.col; ctx.fill();
      });
      ctx.setLineDash([4,4]);
      ctx.strokeStyle='rgba(30,176,255,0.25)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(rig.heads.A.x, rig.heads.A.y); ctx.lineTo(rig.heads.D.x, rig.heads.D.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rig.heads.BN.x, rig.heads.BN.y); ctx.lineTo(rig.heads.BS.x, rig.heads.BS.y); ctx.stroke();
      ctx.setLineDash([]);
      const qvs = VEHS.filter(v => v.state==='queued');
      qvs.forEach(v => {
        ctx.beginPath(); ctx.arc(v.x, v.y, v.wid*0.8+2, 0, Math.PI*2);
        ctx.strokeStyle='rgba(30,176,255,0.6)'; ctx.lineWidth=1.5; ctx.stroke();
      });
      const totalQ = SIM.qA+SIM.qB+SIM.qC+SIM.qD;
      const density = Math.min(1, totalQ/40);
      const bx=W-120, by2=8, bw2=110, bh2=10;
      ctx.fillStyle='rgba(10,15,22,0.75)'; roundRect(ctx,bx-4,by2-2,bw2+8,bh2+4,3); ctx.fill();
      const dc = density>0.7?'#ff2d50':density>0.4?'#ffbe2e':'#00df76';
      ctx.fillStyle=dc; ctx.fillRect(bx, by2, bw2*density, bh2);
      ctx.strokeStyle='rgba(30,176,255,0.4)'; ctx.lineWidth=1; ctx.strokeRect(bx, by2, bw2, bh2);
      ctx.fillStyle='rgba(180,210,255,0.85)'; ctx.font='bold 7px JetBrains Mono,monospace';
      ctx.textAlign='left'; ctx.fillText('DENSIDAD: '+Math.round(density*100)+'%  Q='+totalQ, bx+2, by2-3);
      const phaseInfo = SIM.phA==='G' ? 'FASE A+D' : SIM.phB==='G' ? 'FASE B+C' : 'TRANS';
      ctx.fillStyle='rgba(30,176,255,0.9)'; ctx.font='bold 8px JetBrains Mono,monospace';
      ctx.textAlign='right'; ctx.fillText('IA '+phaseInfo, W-6, 30);
      ctx.restore();
    }
  };

  if (isSmrt) {
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
    const labelX = qSAx - 54;
    const labelY = hCY - laneH2 * 0.45;
    // Conteo de giro U: anclado a la izquierda de la línea de parada
    // para no invadir la cabeza semafórica ni el brazo superior.
    if (SIM.qA > 0) {
      ctx.fillStyle = qColor;
      ctx.font = 'bold 9px JetBrains Mono,monospace';
      ctx.textAlign = 'left';
      ctx.fillText('A Q:' + SIM.qA, labelX, labelY);
    }
  }
  // Sem D queue label (top 2 LTR lanes)
  if (SIM.qD > 0) {
    ctx.fillStyle='rgba(255,190,46,0.9)';
    ctx.font='bold 9px JetBrains Mono,monospace';
    ctx.textAlign='left';
    ctx.fillText('D Q:'+SIM.qD, qSAx - 54, hCY - hHH/2 + 18);
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

  // Pintar semáforos y brazos al final mantiene el mobiliario vial por encima de los vehículos.
  drawSignalOverlay();
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
      getModeRunStats(SIM.mode).cycles++;
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
    const wq = SIM.wtA.length>0 ? parseFloat((SIM.wtA.reduce((a,b)=>a+b,0)/SIM.wtA.length).toFixed(2)) : 0;
    const tp = SIM.t>0 ? Math.round((SIM.sA/SIM.t)*3600) : 0;
    const q  = SIM.qA;
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
  const wq=SIM.wtA.length>0?(SIM.wtA.reduce((a,b)=>a+b,0)/SIM.wtA.length).toFixed(2):'0.00';
  // Resaltar cuando la cola de vuelta en U es crítica
  var qaEl = document.getElementById('sa-q');
  if (qaEl) {
    qaEl.style.color = SIM.qA > 20 ? 'var(--R)' : SIM.qA > 12 ? 'var(--Y)' : 'var(--G)';
    qaEl.style.fontWeight = SIM.qA > 20 ? '900' : '700';
    if (SIM.qA > 20 && SIM.t > 10) addLog('W', '⚠ Cola A critica: '+SIM.qA+' veh en la sesion actual');
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
  var tp=SIM.t>0?Math.round((SIM.sA/SIM.t)*3600):0;
  var te=document.getElementById('rp-tp'); te.textContent=tp+' v/h eq.';
  te.style.color=tp>250?'var(--G)':tp>150?'var(--Y)':'var(--R)';
  var tpNote=document.getElementById('rp-tp-note');
  if (tpNote) tpNote.textContent = SIM.sA + ' veh servidos / ' + SIM.t.toFixed(1) + ' s simulados';
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
    setMg1('mg1-rho',    rhoV.toFixed(3) + (rhoV > 0.90 ? ' CRITICO' : rhoV < 0.70 ? ' ESTABLE' : ''), rhoColor);
    setMg1('mg1-ts2',    Ts2.toFixed(1) + ' s²', null);
    setMg1('mg1-wq',     wqMin.toFixed(2) + ' min', wqColor);
    setMg1('mg1-lq',     Lq.toFixed(1) + ' veh', lqColor);

    // Badge de intervalo de confianza
    var icEl = document.getElementById('mg1-ic');
    if (icEl) {
      var nSamples = SIM.wtA.length + SIM.wtB.length + SIM.wtC.length + SIM.wtD.length;
      icEl.textContent = nSamples >= 30 ? 'IC 95% OK (' + nSamples + ' obs)' : 'n=' + nSamples + ' (min 30)';
      icEl.style.color = nSamples >= 30 ? 'var(--G)' : 'var(--Y)';
    }
  })();
  // ── Actualizar panel de Programación Lineal (Solver QM) ──
  (function() {
    var setLP = function(id, txt, col) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = txt;
      if (col) el.style.color = col;
    };

    var scMap = { valle: 'VALLE', manana: '7-9 AM', mediodia: '12-2 PM', pico: '5-7 PM' };
    var scLabel = scMap[SIM.scenario] || (SIM.scenario || 'SESION');
    var view = getLPView();
    var lpOpt = view === 'x2' ? LP_MODEL.solve2Var(SIM.lA, SIM.lB) : LP_MODEL.solve(SIM.lA, SIM.lB);
    var gHRaw = adaptTGA();
    var gVRaw = adaptTGB();
    var proj = LP_MODEL.projectToDomain(gHRaw, gVRaw);
    var lpNow = view === 'x2'
      ? LP_MODEL.evaluate2Var(proj.gH, proj.gV, SIM.lA, SIM.lB)
      : LP_MODEL.evaluatePlan(proj.gH, proj.gV, SIM.lA, SIM.lB);
    var gap = lpOpt.Z - lpNow.Z;
    var noDef = lpOpt.feasibleNoDeficit;
    var dataset = buildLPDataset(view, lpOpt);

    updateLPViewButtons();
    var fEl = document.getElementById('lp-formula');
    if (fEl) fEl.innerHTML = dataset.formula;

    setLP('lp-lambda', scLabel + ' | λA=' + SIM.lA.toFixed(2) + ' λB=' + SIM.lB.toFixed(2), 'var(--B)');
    setLP('lp-demand', lpOpt.dH.toFixed(2) + ' / ' + lpOpt.dV.toFixed(2) + ' veh', 'var(--tx)');
    setLP('lp-opt', lpOpt.gH + 's / ' + lpOpt.gV + 's', 'var(--G)');
    setLP('lp-slack', view === 'x2' ? 'N/A (2 vars)' : (lpOpt.uH.toFixed(2) + ' / ' + lpOpt.uV.toFixed(2)), view === 'x2' ? 'var(--tx3)' : ((lpOpt.uH + lpOpt.uV) > 0.1 ? 'var(--R)' : 'var(--Y)'));
    setLP('lp-z', lpOpt.Z.toFixed(2), 'var(--G)');
    setLP('lp-actual', proj.rawH + 's / ' + proj.rawV + 's → eq.PL ' + proj.gH + '/' + proj.gV + 's', 'var(--tx)');
    setLP('lp-gap', (gap >= 0 ? '+' : '') + gap.toFixed(2), gap > 1 ? 'var(--R)' : gap > 0.2 ? 'var(--Y)' : 'var(--G)');

    var st = document.getElementById('lp-status');
    if (st) {
      var statusColor = noDef ? 'var(--G)' : 'var(--R)';
      var feasText = noDef ? 'factible sin deficit' : 'con deficit de capacidad';
      st.style.color = statusColor;
      st.textContent =
        'Resultado equivalente a Solver QM (Simplex, ' + (view === 'x2' ? '2 vars' : '4 vars') + '): gH*=' + lpOpt.gH + 's, gV*=' + lpOpt.gV +
        's, Z*=' + lpOpt.Z.toFixed(2) + ' · Estado ' + feasText +
        '. Comparación del plan actual usando proyección al dominio LP (58s verdes).';
    }

    // Dataset equivalente a la captura de Solver QM
    var qmMeta = document.getElementById('lp-qm-meta');
    if (qmMeta) qmMeta.textContent = dataset.meta;
    var qmLines = document.getElementById('lp-qm-lines');
    if (qmLines) qmLines.textContent = dataset.lines.join('\n');
  })();
  // Actualizar etiqueta Wq según el modo activo
  const wqLbl=document.getElementById('wq-label');
  if(wqLbl) wqLbl.textContent = SIM.mode==='inteligente' ? 'Wq PROMEDIO SEM A — MODO INTEL' : 'Wq PROMEDIO SEM A — MODO CONV';
  drawMini(); drawCyc(); drawCmpCharts();
  // Lectura viva del modo inteligente basada en la sesión actual
  if (SIM.mode==='inteligente') {
    var intelTg = document.getElementById('it-tg');
    var intelTr = document.getElementById('it-tr');
    var intelMu = document.getElementById('it-mu');
    var intelVc = document.getElementById('it-vc');
    if (intelTg) intelTg.textContent = adaptTGA() + ' s';
    if (intelTr) intelTr.textContent = adaptTRA() + ' s';
    if (intelMu) intelMu.textContent = muEff.toFixed(4) + ' v/s';
    if (intelVc) intelVc.textContent = avg + ' veh';
  }
  // ── Actualización del panel de Cadena de Markov ──
  (function() {
    var mp = document.getElementById('markov-panel');
    if (!mp) return;

    var hist   = MARKOV.histA;
    var aggA   = getMarkovAggregateStats('A');
    var empA   = aggA.obs > 0 ? aggA.steady : MARKOV.computeSteady(hist);
    var matA   = aggA.obs > 5 ? aggA.matrix : null;
    var theoSt = SIM.mode === 'inteligente' ? MARKOV.steadyIntel : MARKOV.steadyConv;
    var rhoMk  = MARKOV.rhoFromSteady(empA);
    // Solo recalcular predicción cuando la fase cambia realmente (evita parpadeo)
    if (SIM.phA !== MARKOV._lastPhaseA) {
      MARKOV._cachedPred = MARKOV.predictNext(SIM.phA, SIM.mode, matA || (SIM.mode === 'inteligente' ? MARKOV.matIntel : MARKOV.matConv));
      MARKOV._lastPhaseA = SIM.phA;
    }
    var predA = MARKOV._cachedPred;

    var setM  = function(id, v) { var e=document.getElementById(id); if(e) e.textContent=v; };
    var setW  = function(id, pct) { var e=document.getElementById(id); if(e) e.style.width=Math.min(100,Math.max(0,pct))+'%'; };
    var setCol= function(id, col) { var e=document.getElementById(id); if(e) e.style.color=col; };
    var fmtRow = function(row) {
      var rr = row && Number.isFinite(row.R) ? row.R : 0;
      var yy = row && Number.isFinite(row.Y) ? row.Y : 0;
      var gg = row && Number.isFinite(row.G) ? row.G : 0;
      return '[' + rr.toFixed(3) + ', ' + yy.toFixed(3) + ', ' + gg.toFixed(3) + ']';
    };
    var fmtGYR = function(row) {
      var gg = row && Number.isFinite(row.G) ? row.G : 0;
      var yy = row && Number.isFinite(row.Y) ? row.Y : 0;
      var rr = row && Number.isFinite(row.R) ? row.R : 0;
      return '[' + gg.toFixed(3) + ', ' + yy.toFixed(3) + ', ' + rr.toFixed(3) + ']';
    };

    // Conteo de observaciones
    setM('mk-n', (aggA.obs || hist.length) + ' obs acum.');

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

    // Matriz teórica y proyecciones numéricas p(t)=p0*P^t desde el estado actual
    var theoMat = SIM.mode === 'inteligente' ? MARKOV.matIntel : MARKOV.matConv;
    setM('mk-row-r', fmtRow(theoMat.R));
    setM('mk-row-y', fmtRow(theoMat.Y));
    setM('mk-row-g', fmtRow(theoMat.G));
    var pow10 = markovMatrixPower(theoMat, 10);
    var pow60 = markovMatrixPower(theoMat, 60);
    var p10 = pow10[SIM.phA] || pow10.R;
    var p60 = pow60[SIM.phA] || pow60.R;
    setM('mk-p10', fmtGYR(p10));
    setM('mk-p60', fmtGYR(p60));

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
  // ── Integración PL + Markov + Simulación para decisión operativa ──
  (function() {
    var setOR = function(id, txt, col) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = txt;
      if (col) el.style.color = col;
    };
    var view = getLPView();
    var lpOpt = view === 'x2' ? LP_MODEL.solve2Var(SIM.lA, SIM.lB) : LP_MODEL.solve(SIM.lA, SIM.lB);
    var gHRaw = adaptTGA();
    var gVRaw = adaptTGB();
    var proj = LP_MODEL.projectToDomain(gHRaw, gVRaw);
    var lpNow = view === 'x2'
      ? LP_MODEL.evaluate2Var(proj.gH, proj.gV, SIM.lA, SIM.lB)
      : LP_MODEL.evaluatePlan(proj.gH, proj.gV, SIM.lA, SIM.lB);
    var theoMat = SIM.mode === 'inteligente' ? MARKOV.matIntel : MARKOV.matConv;
    var theoSteady = SIM.mode === 'inteligente' ? MARKOV.steadyIntel : MARKOV.steadyConv;
    var risk30 = markovBlockedProbability(theoMat, SIM.phA, 30, 1) * 100;
    var tGreen = markovExpectedTimeToGreen(theoMat, theoSteady, SIM.phA, 1);
    var wqNow = Number(wq);
    var zGap = lpOpt.Z - lpNow.Z;
    var planMismatch = Math.abs(lpNow.gH - lpOpt.gH) > 3 || Math.abs(lpNow.gV - lpOpt.gV) > 3 || zGap > 1.5;

    setOR(
      'or-pl',
      'opt ' + lpOpt.gH + '/' + lpOpt.gV + 's · eqPL ' + lpNow.gH + '/' + lpNow.gV + 's · ΔZ ' + zGap.toFixed(2),
      planMismatch ? 'var(--Y)' : 'var(--G)'
    );
    setOR('or-mk', 'Pbloq(30s)=' + Math.round(risk30) + '% · E[T→G]=' + Math.round(tGreen) + 's', risk30 > 70 ? 'var(--R)' : risk30 > 45 ? 'var(--Y)' : 'var(--B)');
    setOR('or-sim', 'Wq=' + wqNow.toFixed(2) + 'm · QA=' + SIM.qA + ' · TH=' + tp + ' v/h', wqNow > 2.5 ? 'var(--R)' : wqNow > 1.8 ? 'var(--Y)' : 'var(--G)');

    var decisionEl = document.getElementById('or-decision');
    if (!decisionEl) return;
    var msg = '';
    var col = 'var(--tx2)';
    if ((planMismatch && risk30 > 55) || wqNow > 2.5) {
      msg = 'Decision sugerida: subir prioridad al eje horizontal con el plan LP hasta reducir riesgo y Wq.';
      col = 'var(--R)';
    } else if (!planMismatch && risk30 < 45 && wqNow <= 1.8) {
      msg = 'Decision sugerida: mantener el plan actual. PL + Markov + simulacion se mantienen en zona estable.';
      col = 'var(--G)';
    } else {
      msg = 'Decision sugerida: conservar control adaptativo y monitorear convergencia Markov junto con Wq.';
      col = 'var(--Y)';
    }
    decisionEl.textContent = msg;
    decisionEl.style.color = col;
  })();
  updateForecastSidebar();
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
  var values = [wqC, wqI].filter(function(v) { return v !== null && Number.isFinite(v); });
  var maxV = values.length ? Math.max(1, Math.max.apply(null, values) * 1.25) : 1;
  var baseY = H - 22;
  var chartH = baseY - 10;

  // Líneas de cuadrícula en Y
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  [0.25, 0.5, 0.75, 1].forEach(function(f) {
    var v = maxV * f;
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

  function drawOneBar(x, val, barColor, label) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.strokeRect(x, 10, barW, chartH);
    if (val !== null && Number.isFinite(val)) {
      var bh = Math.max(2, (val / maxV) * chartH);
      var by = baseY - bh;
      ctx.fillStyle = barColor;
      ctx.fillRect(x, by, barW, bh);
      ctx.fillStyle = barColor;
      ctx.font = 'bold 9px JetBrains Mono,monospace'; ctx.textAlign = 'center';
      ctx.fillText(val.toFixed(1) + 'm', x + barW/2, by - 3);
    } else {
      ctx.fillStyle = 'rgba(100,130,160,0.5)';
      ctx.font = '7px JetBrains Mono,monospace'; ctx.textAlign = 'center';
      ctx.fillText('sin corrida', x + barW/2, baseY - 6);
    }

    // Etiqueta inferior
    ctx.fillStyle = 'rgba(160,180,210,0.65)';
    ctx.font = '7px JetBrains Mono,monospace';
    ctx.fillText(label, x + barW/2, baseY + 9);
  }

  drawOneBar(xC, wqC, 'rgba(255,45,80,0.80)', 'CONV');
  drawOneBar(xI, wqI, 'rgba(0,223,118,0.80)', 'INTEL');

  // Texto delta en esquina inferior derecha — sin superposición
  if (wqC !== null && wqI !== null && wqC > 0) {
    var pct = Math.round(((wqC - wqI) / wqC) * 100);
    var better = pct > 0;
    ctx.fillStyle = better ? 'rgba(0,223,118,0.8)' : 'rgba(255,190,46,0.8)';
    ctx.font = 'bold 8px JetBrains Mono,monospace';
    ctx.textAlign = 'right';
    ctx.fillText((better ? '-' : '+') + Math.abs(pct) + '%', W - 6, baseY + 9);
  }
}


function drawCmpCharts() {
  drawCmpChart('cmp-wq', SIM.cmpWqConv, SIM.cmpWqInt, '#ff2d50','#00df76', function(v){return v.toFixed(1)+'m';});
  drawBarChart('cmp-bar', SIM.cmpWqConv, SIM.cmpWqInt);
  drawCmpChart('cmp-tp', SIM.cmpTpConv, SIM.cmpTpInt, '#ff2d50','#00df76', function(v){return v+'v/h eq.';});
  drawCmpChart('cmp-q',  SIM.cmpQConv,  SIM.cmpQInt,  '#ff2d50','#00df76', function(v){return v+'veh';});

  const cmp = getComparisonSnapshot();
  const conv = cmp.conv;
  const intel = cmp.intel;
  const set = function(id, value, fmt) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value !== null && value !== undefined && Number.isFinite(value) ? fmt(value) : '--';
  };
  const setDelta = function(id, baseValue, compareValue, lowerIsBetter) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!(baseValue !== null && compareValue !== null && Number.isFinite(baseValue) && Number.isFinite(compareValue) && Math.abs(baseValue) > 0.0001)) {
      el.textContent = '--';
      el.style.color = 'var(--tx3)';
      return;
    }
    const pct = Math.round(((lowerIsBetter ? baseValue - compareValue : compareValue - baseValue) / Math.max(Math.abs(baseValue), 0.01)) * 100);
    el.textContent = (pct >= 0 ? (lowerIsBetter ? '↓' : '↑') : (lowerIsBetter ? '↑' : '↓')) + Math.abs(pct) + '%';
    el.style.color = pct >= 0 ? 'var(--G)' : 'var(--R)';
  };
  const setNeutralDelta = function(id, text, color) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.style.color = color || 'var(--tx2)';
  };
  const setChip = function(id, summary, accent, bg) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!summary.hasData) {
      el.textContent = (summary.mode === 'inteligente' ? 'INTEL' : 'CONV') + ' sin corrida';
      el.style.color = accent;
      el.style.background = bg;
      return;
    }
    const suffix = summary.markovObs > 0 ? (summary.markovObs + ' obs') : (summary.cycles + ' ciclos');
    el.textContent = (summary.mode === 'inteligente' ? 'INTEL ' : 'CONV ') + suffix;
    el.style.color = accent;
    el.style.background = bg;
  };

  set('cs-wqc', conv.wq, function(v){ return v.toFixed(2) + 'm'; });
  set('cs-wqi', intel.wq, function(v){ return v.toFixed(2) + 'm'; });
  setDelta('cs-wqdelta', conv.wq, intel.wq, true);

  set('cs-tpc', conv.tp, function(v){ return Math.round(v) + 'v/h eq.'; });
  set('cs-tpi', intel.tp, function(v){ return Math.round(v) + 'v/h eq.'; });
  setDelta('cs-tpdelta', conv.tp, intel.tp, false);

  set('cs-qc', conv.peakQ, function(v){ return Math.round(v) + 'veh'; });
  set('cs-qi', intel.peakQ, function(v){ return Math.round(v) + 'veh'; });
  setDelta('cs-qdelta', conv.peakQ, intel.peakQ, true);

  set('cs-rhoc', conv.rho, function(v){ return v.toFixed(2); });
  set('cs-rhoi', intel.rho, function(v){ return v.toFixed(2); });
  setDelta('cs-rhodelta', conv.rho, intel.rho, true);

  set('cs-capc', conv.capacityVehH, function(v){ return Math.round(v) + ' v/h eq.'; });
  set('cs-capi', intel.capacityVehH, function(v){ return Math.round(v) + ' v/h eq.'; });
  setDelta('cs-capdelta', conv.capacityVehH, intel.capacityVehH, false);

  set('cs-obsc', conv.markovObs, function(v){ return Math.round(v).toString(); });
  set('cs-obsi', intel.markovObs, function(v){ return Math.round(v).toString(); });
  if (conv.markovObs > 0 && intel.markovObs > 0) setNeutralDelta('cs-obsdelta', 'ok', 'var(--B)');
  else setNeutralDelta('cs-obsdelta', 'pend.', 'var(--tx3)');

  setChip('rp-chip-conv', conv, 'var(--R)', 'var(--R2)');
  setChip('rp-chip-intel', intel, 'var(--G)', 'var(--G2)');

  const qaNote = document.getElementById('rp-qa-note');
  if (qaNote) {
    if (conv.peakQ !== null && intel.peakQ !== null) {
      qaNote.textContent = 'Cola pico observada: conv ' + Math.round(conv.peakQ) + ' veh · intel ' + Math.round(intel.peakQ) + ' veh';
    } else if (conv.hasData || intel.hasData) {
      qaNote.textContent = 'Comparativa pendiente: falta una corrida registrada del ' + (conv.hasData ? 'modo inteligente' : 'modo convencional') + '.';
    } else {
      qaNote.textContent = 'Comparativa pendiente: ejecuta ambos modos para ver contraste observado.';
    }
  }

  const wqDiffEl = document.getElementById('cs-wqdiff');
  if (wqDiffEl) {
    if (conv.wq !== null && intel.wq !== null && conv.wq > 0) {
      const pct = Math.round(((conv.wq - intel.wq) / Math.max(conv.wq, 0.01)) * 100);
      const better = pct > 0;
      wqDiffEl.textContent = better ? 'INTEL reduce ' + pct + '% el tiempo de espera observado' : (pct < 0 ? 'CONV reduce ' + Math.abs(pct) + '% el tiempo de espera observado' : 'Empate observado en Wq');
      wqDiffEl.style.background = better ? 'rgba(0,223,118,0.1)' : 'rgba(255,45,80,0.1)';
      wqDiffEl.style.color = better ? 'var(--G)' : 'var(--R)';
      wqDiffEl.style.border = '1px solid ' + (better ? 'rgba(0,223,118,0.3)' : 'rgba(255,45,80,0.3)');
    } else {
      wqDiffEl.textContent = 'Comparacion pendiente: solo se resumira cuando existan corridas registradas de ambos modos.';
      wqDiffEl.style.background = 'rgba(30,176,255,0.08)';
      wqDiffEl.style.color = 'var(--B)';
      wqDiffEl.style.border = '1px solid rgba(30,176,255,0.28)';
    }
  }

  const tpDiffEl = document.getElementById('cs-tpdiff');
  if (tpDiffEl) {
    if (conv.tp !== null && intel.tp !== null && conv.tp > 0) {
      const pct = Math.round(((intel.tp - conv.tp) / Math.max(conv.tp, 1)) * 100);
      const better = pct > 0;
      tpDiffEl.textContent = better ? 'INTEL aumenta ' + pct + '% la tasa equivalente observada' : (pct < 0 ? 'CONV aumenta ' + Math.abs(pct) + '% la tasa equivalente observada' : 'Empate observado en tasa Sem A');
      tpDiffEl.style.background = better ? 'rgba(0,223,118,0.1)' : 'rgba(255,45,80,0.1)';
      tpDiffEl.style.color = better ? 'var(--G)' : 'var(--R)';
      tpDiffEl.style.border = '1px solid ' + (better ? 'rgba(0,223,118,0.3)' : 'rgba(255,45,80,0.3)');
    } else {
      tpDiffEl.textContent = 'Sin rellenos ni referencias: esta tabla usa solo series registradas por la simulacion.';
      tpDiffEl.style.background = 'rgba(30,176,255,0.08)';
      tpDiffEl.style.color = 'var(--B)';
      tpDiffEl.style.border = '1px solid rgba(30,176,255,0.28)';
    }
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
  const cmp = getComparisonSnapshot();
  const conv = cmp.conv;
  const intel = cmp.intel;
  const wqC = conv.wq, wqI = intel.wq;
  const tpC = conv.tp, tpI = intel.tp;
  const qC  = conv.peakQ, qI = intel.peakQ;

  const setEl = function(id, v, fmt) {
    var el = document.getElementById(id); if (!el) return;
    el.textContent = v !== null && v !== undefined && Number.isFinite(v) ? fmt(v) : '--';
  };
  const setDelta = function(id, vC, vI, lowerBetter) {
    var el = document.getElementById(id);
    if (!el) return;
    if (!(vC !== null && vI !== null && Number.isFinite(vC) && Number.isFinite(vI) && Math.abs(vC) > 0.0001)) {
      el.textContent = '--';
      el.style.color = 'var(--tx3)';
      return;
    }
    var pct = Math.round(((lowerBetter ? vC - vI : vI - vC) / Math.max(Math.abs(vC), 0.01)) * 100);
    var better = pct > 0;
    el.textContent = (better ? (lowerBetter ? '\u2193' : '\u2191') : (lowerBetter ? '\u2191' : '\u2193')) + Math.abs(pct) + '%';
    el.style.color = better ? 'var(--G)' : 'var(--R)';
  };

  setEl('sc-wqc', wqC, function(v) { return v.toFixed(2) + ' min'; });
  setEl('sc-wqi', wqI, function(v) { return v.toFixed(2) + ' min'; });
  setDelta('sc-wqd', wqC, wqI, true);

  setEl('sc-tpc', tpC, function(v) { return Math.round(v) + ' v/h eq.'; });
  setEl('sc-tpi', tpI, function(v) { return Math.round(v) + ' v/h eq.'; });
  setDelta('sc-tpd', tpC, tpI, false);

  setEl('sc-qc', qC, function(v) { return v + ' veh'; });
  setEl('sc-qi', qI, function(v) { return v + ' veh'; });
  setDelta('sc-qd', qC, qI, true);

  setEl('sc-qac', conv.peakQ, function(v) { return Math.round(v) + ' veh'; });
  setEl('sc-qai', intel.peakQ, function(v) { return Math.round(v) + ' veh'; });
  setDelta('sc-qad', conv.peakQ, intel.peakQ, true);
  setEl('sc-qbc', conv.markovObs, function(v) { return Math.round(v) + ' obs'; });
  setEl('sc-qbi', intel.markovObs, function(v) { return Math.round(v) + ' obs'; });
  var qbd = document.getElementById('sc-qbd');
  if (qbd) {
    qbd.textContent = conv.markovObs > 0 && intel.markovObs > 0 ? 'OK' : 'PEND.';
    qbd.style.color = conv.markovObs > 0 && intel.markovObs > 0 ? 'var(--B)' : 'var(--tx3)';
  }
  setEl('sc-rhoc', conv.rho, function(v) { return v.toFixed(2); });
  setEl('sc-rhoi', intel.rho, function(v) { return v.toFixed(2); });
  setDelta('sc-rhod', conv.rho, intel.rho, true);
  setEl('sc-capc', conv.capacityVehH, function(v) { return Math.round(v) + ' v/h eq.'; });
  setEl('sc-capi', intel.capacityVehH, function(v) { return Math.round(v) + ' v/h eq.'; });
  setDelta('sc-capd', conv.capacityVehH, intel.capacityVehH, false);

  var sccc = document.getElementById('sc-cyccc'); if (sccc) sccc.textContent = conv.cycles;
  var scci = document.getElementById('sc-cycci'); if (scci) scci.textContent = intel.cycles;
  var sccd = document.getElementById('sc-cyccd');
  if (sccd) {
    if (conv.cycles > 0 && intel.cycles > 0) {
      sccd.textContent = 'OK';
      sccd.style.color = 'var(--B)';
    } else {
      sccd.textContent = 'PEND.';
      sccd.style.color = 'var(--tx3)';
    }
  }

  var verdict = document.getElementById('sc-verdict');
  if (verdict) {
    var hasData = cmp.bothObserved && wqC !== null && wqI !== null;
    if (!hasData) {
      verdict.style.background = 'rgba(30,176,255,0.08)';
      verdict.style.border = '1px solid rgba(30,176,255,0.2)';
      verdict.innerHTML = '<span style="font-family:var(--fm);font-size:9px;color:var(--B)">La tabla comparativa solo se completa con corridas registradas en ambos modos.<br>Si falta uno, la lectura queda en pendiente y no rellena valores.</span>';
    } else {
      var wqPct = Math.round(((wqC - wqI) / Math.max(wqC, 0.01)) * 100);
      var tpPct = Math.round(((tpI - tpC) / Math.max(tpC, 1)) * 100);
      var qPct  = Math.round(((qC  - qI)  / Math.max(qC,  1)) * 100);
      var allBetter = wqPct > 0 && tpPct > 0 && qPct > 0;
      verdict.style.background = allBetter ? 'rgba(0,223,118,0.08)' : 'rgba(255,190,46,0.08)';
      verdict.style.border = '1px solid ' + (allBetter ? 'rgba(0,223,118,0.3)' : 'rgba(255,190,46,0.3)');
      if (allBetter) {
        verdict.innerHTML = '<span style="font-family:var(--fm);font-size:11px;font-weight:700;color:var(--G)">VENTAJA OBSERVADA DEL MODO INTELIGENTE</span>'
          + '<br><span style="font-size:8px;color:var(--tx2);font-family:var(--fm)">Wq \u2212' + wqPct + '% \u2022 Tasa +' + tpPct + '% \u2022 Cola pico \u2212' + qPct + '% \u2022 Solo datos observados</span>';
      } else {
        verdict.innerHTML = '<span style="font-family:var(--fm);font-size:9px;color:var(--Y)">Hay corrida registrada en ambos modos, pero todavia no hay una dominancia clara en todos los KPIs observados.</span>';
      }
    }
  }
  document.getElementById('scorecard').classList.add('show');
}

function exportPDF() {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { alert('jsPDF no cargado'); return; }
  const btn = document.getElementById('btnPDF');
  setButtonIconLabel('btnPDF', 'file', 'GENERANDO...');
  btn.disabled = true;

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
      const wqAvg  = SIM.wtA.length > 0 ? SIM.wtA.reduce((a,b)=>a+b,0)/SIM.wtA.length : 0;
      const tpA    = SIM.t > 0 ? Math.round((SIM.sA/SIM.t)*3600) : 0;
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
      const pdfOperational = getOperationalMarkovContext();
      const pdfCmp = getComparisonSnapshot();
      const pdfForecast = getObservedPdfForecastContext({
        scenario: SIM.scenario || 'valle',
        months: 6,
        nRep: 120,
      });
      const convSummary = pdfCmp.conv;
      const intelSummary = pdfCmp.intel;
      const metricText = function(summary, value, formatter, emptyText) {
        return summary.hasData && value !== null && value !== undefined && Number.isFinite(value)
          ? formatter(value)
          : (emptyText || 'sin corrida registrada');
      };
      const deltaText = function(baseValue, compareValue, lowerBetter) {
        if (!(baseValue !== null && compareValue !== null && Number.isFinite(baseValue) && Number.isFinite(compareValue) && Math.abs(baseValue) > 0.0001)) {
          return 'pend.';
        }
        const pct = Math.round(((lowerBetter ? baseValue - compareValue : compareValue - baseValue) / Math.max(Math.abs(baseValue), 0.01)) * 100);
        return (pct >= 0 ? (lowerBetter ? '-' : '+') : (lowerBetter ? '+' : '-')) + Math.abs(pct) + '%';
      };

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

      const drawPdfCompareCard = (x, yy, w, h, cfg) => {
        const values = [cfg.currentValue, cfg.compareValue].filter(v => Number.isFinite(v));
        const maxV = Math.max(cfg.minScale || 1, values.length ? Math.max.apply(null, values) : 1);
        const label1 = cfg.currentLabel || 'ACT';
        const label2 = cfg.compareLabel || 'CMP';
        const formatter = cfg.formatter || function(v) { return String(Math.round(v)); };
        const barX = x + 16;
        const barW = Math.max(18, w - 34);
        const row1Y = yy + 12;
        const row2Y = yy + 21;

        fill('#09131f'); doc.roundedRect(x, yy, w, h, 2, 2, 'F');
        draw('#18324a'); doc.setLineWidth(0.2); doc.roundedRect(x, yy, w, h, 2, 2, 'S');
        txt('#1eb0ff'); doc.setFontSize(6.5); doc.setFont('helvetica','bold');
        doc.text(safe(cfg.title || ''), x + 3, yy + 5);

        const drawBarRow = (rowY, label, value, color) => {
          txt('#6f86a6'); doc.setFontSize(6); doc.setFont('helvetica','bold');
          doc.text(safe(label), x + 3, rowY + 1);
          fill('#0d1826'); doc.rect(barX, rowY - 2.5, barW, 4, 'F');
          if (Number.isFinite(value)) {
            fill(color);
            doc.rect(barX, rowY - 2.5, Math.max(1, barW * (value / maxV)), 4, 'F');
            txt(color); doc.setFontSize(6.2); doc.setFont('helvetica','bold');
            doc.text(safe(formatter(value)), x + w - 3, rowY + 1, { align:'right' });
          } else {
            txt('#4e6078'); doc.setFontSize(6); doc.setFont('helvetica','normal');
            doc.text('sin dato', x + w - 3, rowY + 1, { align:'right' });
          }
        };

        drawBarRow(row1Y, label1, cfg.currentValue, cfg.currentColor || '#ff2d50');
        drawBarRow(row2Y, label2, cfg.compareValue, cfg.compareColor || '#00df76');

        if (cfg.deltaText) {
          txt(cfg.deltaColor || '#cfd8ec'); doc.setFontSize(6); doc.setFont('helvetica','bold');
          doc.text(safe(cfg.deltaText), x + w / 2, yy + h - 3, { align:'center' });
        }
      };

      // ── 1. PARÁMETROS ──
      y = sec('1', safe('Base observada por modo en la sesion'), y);
      const W1=[72,32,32,48], bg0='#0d1017', bg1='#0f1520';
      y = tableHead(['Indicador','Convencional','Inteligente','Fuente'], W1, y);
      const pRows = [
        ['Obs. Markov Sem A', metricText(convSummary, convSummary.markovObs, function(v) { return Math.round(v) + ' obs'; }), metricText(intelSummary, intelSummary.markovObs, function(v) { return Math.round(v) + ' obs'; }), 'Cadena empirica acumulada'],
        ['Wq Sem A', metricText(convSummary, convSummary.wq, function(v) { return v.toFixed(2) + ' min'; }), metricText(intelSummary, intelSummary.wq, function(v) { return v.toFixed(2) + ' min'; }), 'Serie de espera observada'],
        ['Tasa Sem A', metricText(convSummary, convSummary.tp, function(v) { return Math.round(v) + ' v/h eq.'; }), metricText(intelSummary, intelSummary.tp, function(v) { return Math.round(v) + ' v/h eq.'; }), 'Servidos / tiempo simulado'],
        ['Cola pico Sem A', metricText(convSummary, convSummary.peakQ, function(v) { return Math.round(v) + ' veh'; }), metricText(intelSummary, intelSummary.peakQ, function(v) { return Math.round(v) + ' veh'; }), 'Maximo observado en corrida'],
        ['Ciclos completos', metricText(convSummary, convSummary.cycles, function(v) { return Math.round(v).toString(); }), metricText(intelSummary, intelSummary.cycles, function(v) { return Math.round(v).toString(); }), 'Conteo por modo'],
        ['rho estimado', metricText(convSummary, convSummary.rho, function(v) { return v.toFixed(3); }), metricText(intelSummary, intelSummary.rho, function(v) { return v.toFixed(3); }), 'lambda / mu efectivo'],
        ['Convergencia pi', metricText(convSummary, convSummary.convergencePct, function(v) { return Math.round(v) + '%'; }, 'sin base Markov'), metricText(intelSummary, intelSummary.convergencePct, function(v) { return Math.round(v) + '%'; }, 'sin base Markov'), 'Estado estable emp. vs teorico'],
        ['Capacidad Markov', metricText(convSummary, convSummary.capacityVehH, function(v) { return Math.round(v) + ' v/h eq.'; }, 'sin base Markov'), metricText(intelSummary, intelSummary.capacityVehH, function(v) { return Math.round(v) + ' v/h eq.'; }, 'sin base Markov'), 'Mu efectivo derivado'],
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
        ['Tasa Sem A',  tpA+' v/h eq.',         tpA>250?'#00df76':tpA>150?'#ffbe2e':'#ff2d50'],
        ['Sem A serv.', SIM.sA+' veh',           '#cfd8ec'],
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

      // ── 3. INDICADORES OR CON MARKOV ──
      y = sec('3', safe('Indicadores OR con Cadena de Markov - Semaforo A'), y);
      const markovParagraphs = [
        'Escenario: ' + pdfOperational.scenarioLabel + ' | Obs Markov ' + pdfOperational.readiness.markovObs + '/' + pdfOperational.readiness.requiredObs +
          ' | Ciclos ' + pdfOperational.readiness.cycles + '/' + pdfOperational.readiness.requiredCycles +
          ' | Convergencia pi ' + pdfOperational.readiness.convergencePct + '%'
      ];
      if (pdfOperational.readiness.ready) {
        if (pdfOperational.comparisonReady) {
          markovParagraphs.push(
            'Tiempo esperado al verde desde el estado actual: ' + Math.round(pdfOperational.current.timeToGreenSec) + ' s | ' +
            pdfOperational.comparisonLabel + ': ' + Math.round(pdfOperational.benchmark.timeToGreenSec) + ' s | ' +
            'Racha roja esperada: ' + Math.round(pdfOperational.current.redRunSec) + ' s -> ' + Math.round(pdfOperational.benchmark.redRunSec) + ' s'
          );
          markovParagraphs.push(
            'Bloqueo estacionario: ' + Math.round(pdfOperational.current.blockedSharePct) + '% -> ' + Math.round(pdfOperational.benchmark.blockedSharePct) +
            '% | Riesgo sin verde en 30 s: ' + Math.round(pdfOperational.current.blockedRisk30Pct) + '% -> ' + Math.round(pdfOperational.benchmark.blockedRisk30Pct) +
            '% | Capacidad efectiva: ' + Math.round(pdfOperational.current.capacityVehH) + ' -> ' + Math.round(pdfOperational.benchmark.capacityVehH) + ' v/h eq.'
          );
          markovParagraphs.push(
            'Margen capacidad-demanda: ' + formatSignedVeh(pdfOperational.current.marginVehH) + ' -> ' + formatSignedVeh(pdfOperational.benchmark.marginVehH) +
            ' | Comparacion basada solo en corridas registradas de ambos modos dentro de la misma sesion.'
          );
        } else {
          markovParagraphs.push(
            'Tiempo esperado al verde desde el estado actual: ' + Math.round(pdfOperational.current.timeToGreenSec) + ' s | ' +
            'Racha roja esperada: ' + Math.round(pdfOperational.current.redRunSec) + ' s | ' +
            'Bloqueo estacionario: ' + Math.round(pdfOperational.current.blockedSharePct) + '%'
          );
          markovParagraphs.push(
            'Riesgo sin verde en 30 s: ' + Math.round(pdfOperational.current.blockedRisk30Pct) + '% | ' +
            'Capacidad efectiva observada: ' + Math.round(pdfOperational.current.capacityVehH) + ' v/h eq. | ' +
            'Margen capacidad-demanda: ' + formatSignedVeh(pdfOperational.current.marginVehH)
          );
          markovParagraphs.push(
            'No se presenta contraste con ' + pdfOperational.missingComparisonLabel +
            ' porque no existen registros observados de ese modo en la sesion actual.'
          );
        }
        markovParagraphs.push(
          'Se usa la cadena de Markov para modelar transiciones R-A-V, estimar estado estable, tiempo esperado al verde y riesgo de bloqueo sin depender solo de promedios instantaneos.'
        );
      } else {
        markovParagraphs.push(
          'El PDF no habilita la lectura de Markov mientras la simulacion no tenga historial suficiente. Este bloqueo evita sacar conclusiones operativas sin una matriz empirica minima.'
        );
      }
      const markovWrapW = CW - 10;
      const markovLineH = 4.6;
      const markovTopPad = 10;
      const markovBottomPad = 5;
      let markovBoxH = markovTopPad + markovBottomPad;
      const markovWrapped = markovParagraphs.map(function(paragraph) {
        const lines = doc.splitTextToSize(safe(paragraph), markovWrapW);
        markovBoxH += lines.length * markovLineH + 1.6;
        return lines;
      });
      fill('#08121e'); doc.rect(M, y-3, CW, markovBoxH, 'F');
      draw('#1eb0ff'); doc.setLineWidth(0.2); doc.rect(M, y-3, CW, markovBoxH, 'S');
      txt(pdfOperational.readiness.ready ? '#00df76' : '#ffbe2e');
      doc.setFontSize(7.5); doc.setFont('helvetica','bold');
      doc.text(pdfOperational.readiness.ready ? 'CADENA EMPIRICA VALIDADA PARA ANALISIS OR' : 'CADENA MARKOV AUN NO VALIDADA', M+4, y+3);
      txt('#8899bb'); doc.setFontSize(6.5); doc.setFont('helvetica','normal');
      let markovTextY = y + 10;
      markovWrapped.forEach(function(lines) {
        lines.forEach(function(line) {
          doc.text(line, M + 4, markovTextY);
          markovTextY += markovLineH;
        });
        markovTextY += 1.6;
      });
      y += markovBoxH + 6;

      const orCardGap = 6;
      const orCardW = (CW - orCardGap) / 2;
      const orCardH = 28;
      const currentModeLabel = pdfOperational.current.mode === 'inteligente' ? 'INTEL' : 'CONV';
      const compareModeLabel = pdfOperational.comparisonReady
        ? (pdfOperational.benchmark.mode === 'inteligente' ? 'INTEL' : 'CONV')
        : '---';
      const currentModeColor = pdfOperational.current.mode === 'inteligente' ? '#00df76' : '#ff2d50';
      const compareModeColor = pdfOperational.comparisonReady
        ? (pdfOperational.benchmark.mode === 'inteligente' ? '#00df76' : '#ff2d50')
        : '#4e6078';
      const cardDeltaText = pdfOperational.comparisonReady ? 'comparacion observada' : 'sesion actual';

      drawPdfCompareCard(M, y, orCardW, orCardH, {
        title: 'Tiempo esperado al verde',
        currentLabel: currentModeLabel,
        compareLabel: compareModeLabel,
        currentValue: pdfOperational.current.timeToGreenSec,
        compareValue: pdfOperational.comparisonReady ? pdfOperational.benchmark.timeToGreenSec : null,
        currentColor: currentModeColor,
        compareColor: compareModeColor,
        formatter: function(v) { return Math.round(v) + ' s'; },
        deltaText: cardDeltaText,
      });
      drawPdfCompareCard(M + orCardW + orCardGap, y, orCardW, orCardH, {
        title: 'Racha roja esperada',
        currentLabel: currentModeLabel,
        compareLabel: compareModeLabel,
        currentValue: pdfOperational.current.redRunSec,
        compareValue: pdfOperational.comparisonReady ? pdfOperational.benchmark.redRunSec : null,
        currentColor: currentModeColor,
        compareColor: compareModeColor,
        formatter: function(v) { return Math.round(v) + ' s'; },
        deltaText: cardDeltaText,
      });
      y += orCardH + orCardGap;
      drawPdfCompareCard(M, y, orCardW, orCardH, {
        title: 'Riesgo sin verde en 30 s',
        currentLabel: currentModeLabel,
        compareLabel: compareModeLabel,
        currentValue: pdfOperational.current.blockedRisk30Pct,
        compareValue: pdfOperational.comparisonReady ? pdfOperational.benchmark.blockedRisk30Pct : null,
        currentColor: currentModeColor,
        compareColor: compareModeColor,
        formatter: function(v) { return Math.round(v) + '%'; },
        deltaText: cardDeltaText,
        minScale: 100,
      });
      drawPdfCompareCard(M + orCardW + orCardGap, y, orCardW, orCardH, {
        title: 'Capacidad efectiva',
        currentLabel: currentModeLabel,
        compareLabel: compareModeLabel,
        currentValue: pdfOperational.current.capacityVehH,
        compareValue: pdfOperational.comparisonReady ? pdfOperational.benchmark.capacityVehH : null,
        currentColor: currentModeColor,
        compareColor: compareModeColor,
        formatter: function(v) { return Math.round(v) + ' v/h'; },
        deltaText: cardDeltaText,
      });
      y += orCardH + 10;

      // ── 4. TABLA COMPARATIVA ──
      y = sec('4', safe('Comparativa observada Convencional vs Inteligente'), y);

      const W3=[68,34,34,50];
      y = tableHead([safe('Indicador'),'Convencional','Inteligente','Lectura'], W3, y);

      const cmpRows = [
        ['Wq Sem A', metricText(convSummary, convSummary.wq, function(v) { return v.toFixed(2) + ' min'; }), metricText(intelSummary, intelSummary.wq, function(v) { return v.toFixed(2) + ' min'; }), deltaText(convSummary.wq, intelSummary.wq, true), '#00df76'],
        ['Tasa Sem A', metricText(convSummary, convSummary.tp, function(v) { return Math.round(v) + ' v/h eq.'; }), metricText(intelSummary, intelSummary.tp, function(v) { return Math.round(v) + ' v/h eq.'; }), deltaText(convSummary.tp, intelSummary.tp, false), '#00df76'],
        ['Cola pico Sem A', metricText(convSummary, convSummary.peakQ, function(v) { return Math.round(v) + ' veh'; }), metricText(intelSummary, intelSummary.peakQ, function(v) { return Math.round(v) + ' veh'; }), deltaText(convSummary.peakQ, intelSummary.peakQ, true), '#00df76'],
        ['rho estimado', metricText(convSummary, convSummary.rho, function(v) { return v.toFixed(3); }), metricText(intelSummary, intelSummary.rho, function(v) { return v.toFixed(3); }), deltaText(convSummary.rho, intelSummary.rho, true), '#00df76'],
        ['Capacidad Markov', metricText(convSummary, convSummary.capacityVehH, function(v) { return Math.round(v) + ' v/h eq.'; }, 'sin base'), metricText(intelSummary, intelSummary.capacityVehH, function(v) { return Math.round(v) + ' v/h eq.'; }, 'sin base'), deltaText(convSummary.capacityVehH, intelSummary.capacityVehH, false), '#00df76'],
        ['Obs. Markov', metricText(convSummary, convSummary.markovObs, function(v) { return Math.round(v) + ' obs'; }), metricText(intelSummary, intelSummary.markovObs, function(v) { return Math.round(v) + ' obs'; }), (convSummary.markovObs > 0 && intelSummary.markovObs > 0) ? 'ambos' : 'pend.', '#1eb0ff'],
        ['Ciclos completos', metricText(convSummary, convSummary.cycles, function(v) { return Math.round(v).toString(); }), metricText(intelSummary, intelSummary.cycles, function(v) { return Math.round(v).toString(); }), (convSummary.cycles > 0 && intelSummary.cycles > 0) ? 'ambos' : 'pend.', '#1eb0ff'],
      ];

      cmpRows.forEach((r3, i) => {
        const [label, cv, iv, dv, dc] = r3;
        fill(i%2===0?'#0d1017':'#0f1520'); doc.rect(M, y-3, CW, 8, 'F');
        const vals3 = [label, cv, iv, dv];
        const cols3 = ['#8899bb','#ff5566','#00df76', dc||'#00df76'];
        W3.forEach((w, ci) => {
          const x = M + W3.slice(0,ci).reduce((a,b)=>a+b,0);
          txt(cols3[ci]); doc.setFontSize(ci===0?6.5:7); doc.setFont('helvetica', ci>0?'bold':'normal');
          doc.text(safe(vals3[ci]), x+2, y+1.5);
        });
        y += 8;
      });

      y += 6;

      // ─────────────────────────────────────
      //  PAGE 3 — PRONOSTICO MARKOV
      // ─────────────────────────────────────
      doc.addPage();
      fill('#07090d'); doc.rect(0,0,PW,PH,'F');
      fill('#1eb0ff'); doc.rect(0,0,PW,3,'F');
      fill('#0d1b2e'); doc.rect(0,3,PW,20,'F');
      txt('#cfd8ec'); doc.setFontSize(11); doc.setFont('helvetica','bold');
      doc.text(safe('TrafficFlow - Pronostico Markov de Mejora'), M, 16);
      y = 30;

      y = sec('5', safe('Pronostico 6 meses con Cadena de Markov - mejora del trafico'), y);
      const forecastParagraphs = [
        'Base comparativa: escenario ' + pdfForecast.scenarioLabel +
          ' | Conv ' + (pdfForecast.convParams.markovObs || 0) + ' obs / ' + (pdfForecast.convParams.cycles || 0) + ' ciclos' +
          ' | Intel ' + (pdfForecast.intelParams.markovObs || 0) + ' obs / ' + (pdfForecast.intelParams.cycles || 0) + ' ciclos' +
          (pdfForecast.ready
            ? ' | Demanda observada usada como base: ~' + pdfForecast.demandVehH + ' v/h.'
            : ' | El pronostico solo se activa cuando ambas corridas aportan base observada suficiente.')
      ];
      if (pdfForecast.ready) {
        forecastParagraphs.push(
          'Supuesto del pronostico: durante los proximos 6 meses se mantiene la demanda observada de la sesion y se conservan las cadenas de Markov estimadas para ambos modos. No se introduce crecimiento externo ni aprendizaje artificial adicional.'
        );
        forecastParagraphs.push(
          'Convencional (Monte Carlo ' + pdfForecast.nRep + ' replicas): Wq ' + pdfForecast.conv.wq.mean.toFixed(2) +
          ' min (IC95% ' + pdfForecast.conv.wq.lo.toFixed(2) + '-' + pdfForecast.conv.wq.hi.toFixed(2) + ')' +
          ' | Tasa ' + Math.round(pdfForecast.conv.tp.mean) + ' v/h eq. (IC95% ' + Math.round(pdfForecast.conv.tp.lo) + '-' + Math.round(pdfForecast.conv.tp.hi) + ')' +
          ' | Cola pico ' + Math.round(pdfForecast.conv.maxQ.mean) + ' veh.'
        );
        forecastParagraphs.push(
          'Inteligente (Monte Carlo ' + pdfForecast.nRep + ' replicas): Wq ' + pdfForecast.intel.wq.mean.toFixed(2) +
          ' min (IC95% ' + pdfForecast.intel.wq.lo.toFixed(2) + '-' + pdfForecast.intel.wq.hi.toFixed(2) + ')' +
          ' | Tasa ' + Math.round(pdfForecast.intel.tp.mean) + ' v/h eq. (IC95% ' + Math.round(pdfForecast.intel.tp.lo) + '-' + Math.round(pdfForecast.intel.tp.hi) + ')' +
          ' | Cola pico ' + Math.round(pdfForecast.intel.maxQ.mean) + ' veh.'
        );
        forecastParagraphs.push(
          'Mejora sostenida proyectada del modo inteligente frente al convencional: Wq ' +
          (pdfForecast.deltas.wqPct !== null ? (pdfForecast.deltas.wqPct >= 0 ? '-' : '+') + Math.abs(pdfForecast.deltas.wqPct) + '%' : 'pend.') +
          ' | Tasa ' +
          (pdfForecast.deltas.tpPct !== null ? (pdfForecast.deltas.tpPct >= 0 ? '+' : '-') + Math.abs(pdfForecast.deltas.tpPct) + '%' : 'pend.') +
          ' | Cola pico ' +
          (pdfForecast.deltas.qPct !== null ? (pdfForecast.deltas.qPct >= 0 ? '-' : '+') + Math.abs(pdfForecast.deltas.qPct) + '%' : 'pend.') +
          '. Esta proyeccion usa solo corridas registradas de ambos modos.'
        );
      } else {
        forecastParagraphs.push(
          'El PDF no incluye pronostico comparativo a 6 meses porque aun no existe base observada suficiente en ambos modos. El bloque se habilita solo cuando convencional e inteligente alcanzan cadena empirica valida, ciclos minimos y muestras de espera suficientes.'
        );
        forecastParagraphs.push(
          'Estado actual de habilitacion: Conv ' + pdfForecast.convReadiness.markov.value + '/' + pdfForecast.convReadiness.markov.required +
          ' obs Markov, ' + pdfForecast.convReadiness.cycles.value + '/' + pdfForecast.convReadiness.cycles.required + ' ciclos, ' +
          pdfForecast.convReadiness.waits.value + '/' + pdfForecast.convReadiness.waits.required + ' muestras Wq' +
          ' | Intel ' + pdfForecast.intelReadiness.markov.value + '/' + pdfForecast.intelReadiness.markov.required +
          ' obs Markov, ' + pdfForecast.intelReadiness.cycles.value + '/' + pdfForecast.intelReadiness.cycles.required + ' ciclos, ' +
          pdfForecast.intelReadiness.waits.value + '/' + pdfForecast.intelReadiness.waits.required + ' muestras Wq.'
        );
      }
      const forecastWrapW = CW - 10;
      const forecastLineH = 4.6;
      const forecastTopPad = 10;
      const forecastBottomPad = 5;
      let forecastBoxH = forecastTopPad + forecastBottomPad;
      const forecastWrapped = forecastParagraphs.map(function(paragraph) {
        const lines = doc.splitTextToSize(safe(paragraph), forecastWrapW);
        forecastBoxH += lines.length * forecastLineH + 1.6;
        return lines;
      });
      fill('#08121e'); doc.rect(M, y-3, CW, forecastBoxH, 'F');
      draw('#1eb0ff'); doc.setLineWidth(0.2); doc.rect(M, y-3, CW, forecastBoxH, 'S');
      txt(pdfForecast.ready ? '#00df76' : '#ffbe2e');
      doc.setFontSize(7.5); doc.setFont('helvetica','bold');
      doc.text(pdfForecast.ready ? 'PRONOSTICO MARKOV HABILITADO CON AMBOS MODOS' : 'PRONOSTICO MARKOV AUN NO HABILITADO', M+4, y+3);
      txt('#8899bb'); doc.setFontSize(6.5); doc.setFont('helvetica','normal');
      let forecastTextY = y + 10;
      forecastWrapped.forEach(function(lines) {
        lines.forEach(function(line) {
          doc.text(line, M + 4, forecastTextY);
          forecastTextY += forecastLineH;
        });
        forecastTextY += 1.6;
      });
      y += forecastBoxH + 6;

      if (pdfForecast.ready) {
        const fcCardGap = 6;
        const fcCardW = (CW - fcCardGap) / 2;
        const fcCardH = 28;
        drawPdfCompareCard(M, y, fcCardW, fcCardH, {
          title: 'Wq proyectado',
          currentLabel: 'CONV',
          compareLabel: 'INTEL',
          currentValue: pdfForecast.conv.wq.mean,
          compareValue: pdfForecast.intel.wq.mean,
          currentColor: '#ff2d50',
          compareColor: '#00df76',
          formatter: function(v) { return v.toFixed(2) + ' m'; },
          deltaText: (pdfForecast.deltas.wqPct !== null ? ((pdfForecast.deltas.wqPct >= 0 ? '-' : '+') + Math.abs(pdfForecast.deltas.wqPct) + '%') : 'pend.'),
          deltaColor: '#00df76',
        });
        drawPdfCompareCard(M + fcCardW + fcCardGap, y, fcCardW, fcCardH, {
          title: 'Tasa proyectada',
          currentLabel: 'CONV',
          compareLabel: 'INTEL',
          currentValue: pdfForecast.conv.tp.mean,
          compareValue: pdfForecast.intel.tp.mean,
          currentColor: '#ff2d50',
          compareColor: '#00df76',
          formatter: function(v) { return Math.round(v) + ' v/h'; },
          deltaText: (pdfForecast.deltas.tpPct !== null ? ((pdfForecast.deltas.tpPct >= 0 ? '+' : '-') + Math.abs(pdfForecast.deltas.tpPct) + '%') : 'pend.'),
          deltaColor: '#00df76',
        });
        y += fcCardH + fcCardGap;
        drawPdfCompareCard(M, y, CW, 26, {
          title: 'Cola pico proyectada',
          currentLabel: 'CONV',
          compareLabel: 'INTEL',
          currentValue: pdfForecast.conv.maxQ.mean,
          compareValue: pdfForecast.intel.maxQ.mean,
          currentColor: '#ff2d50',
          compareColor: '#00df76',
          formatter: function(v) { return Math.round(v) + ' veh'; },
          deltaText: (pdfForecast.deltas.qPct !== null ? ((pdfForecast.deltas.qPct >= 0 ? '-' : '+') + Math.abs(pdfForecast.deltas.qPct) + '%') : 'pend.'),
          deltaColor: '#00df76',
        });
      }

      // ─────────────────────────────────────
      //  PAGE 4 — GRAFICAS
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

      addImg(imgBar, safe('Wq Sem A - barra comparativa observada por modo'), 28);
      addImg(imgWQ,  safe('Wq acumulado en tiempo - Convencional (rojo) vs Inteligente (verde)'), 24);
      addImg(imgTP,  safe('Tasa Sem A (veh/h eq.) - Convencional (rojo) vs Inteligente (verde)'), 24);
      addImg(imgQ,   safe('Cola Sem A acumulada - Convencional (rojo) vs Inteligente (verde)'), 24);
      addImg(imgCC,  safe('Diagrama ciclo semaforo - Verde / Amarillo / Rojo actual'), 16);

      // Caja de metodología
      if (y + 64 < PH-14) {
        fill('#08121e'); doc.rect(M, y, CW, 62, 'F');
        draw('#1eb0ff'); doc.setLineWidth(0.2); doc.rect(M, y, CW, 62, 'S');
        txt('#1eb0ff'); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
        doc.text('Metodologia Integrada OR - Fases del Proyecto', M+4, y+7);
        const phases = [
          safe('FASE 1 - Levantamiento de datos: Ciclos semaforos, conteo vehicular 7-9AM / 12-2PM / 5-7PM'),
          safe('FASE 2 - Modelo M/G/1: Colas con tasa lambda (Poisson), mu efectivo, Wq y Lq en vivo.'),
          safe('FASE 3 - Programacion Lineal (Solver QM): gH, gV, uH, uV con objetivo y restricciones operativas.'),
          safe('FASE 4 - Cadena de Markov: matriz de transicion P, p(t)=p0*P^t, distribucion estacionaria y riesgo de bloqueo.'),
          safe('FASE 5 - Integracion y validacion: optimizar (PL) + predecir (Markov) + validar (Simulacion).'),
        ];
        phases.forEach((p, i) => {
          txt(i%2===0?'#cfd8ec':'#8899bb'); doc.setFontSize(6.5); doc.setFont('helvetica','normal');
          doc.text(p, M+4, y+15+i*7.5);
        });
      }

      // Pie de página en todas las páginas
      const N = doc.getNumberOfPages();
      for (let p=1; p<=N; p++) {
        doc.setPage(p);
        fill('#07090d'); doc.rect(0, PH-11, PW, 11, 'F');
        draw('#182030'); doc.setLineWidth(0.2); doc.line(0, PH-11, PW, PH-11);
        txt('#2a3848'); doc.setFontSize(6); doc.setFont('helvetica','normal');
        doc.text('TrafficFlow | Interseccion El Bosque, Panama | PL + Markov + M/G/1 + IDM', M, PH-4);
        doc.text('Pag. '+p+'/'+N, PW-M, PH-4, {align:'right'});
      }

      doc.save('TrafficFlow_Informe.pdf');
    } catch(e) {
      alert('Error generando PDF: ' + e.message);
      console.error(e);
    } finally {
      setButtonIconLabel('btnPDF', 'file', 'PDF');
      btn.disabled = false;
    }
  }, 80);
}

function toggleRun() {
  SIM.running = !SIM.running;
  const btn=document.getElementById('btnR'), dot=document.getElementById('ld');
  if (SIM.running) {
    setButtonIconLabel('btnR', 'pause', 'PAUSAR'); btn.className='btn pause';
    dot.style.background='var(--G)'; lastTS=null; requestAnimationFrame(tick);
    addLog('I','▶ Iniciado — '+SIM.mode.toUpperCase()+' | '+SIM.scenario.toUpperCase());
  } else {
    setButtonIconLabel('btnR', 'play', 'INICIAR'); btn.className='btn go';
    dot.style.background='var(--Y)'; addLog('I','⏸ Pausado');
  }
}
function resetAll() {
  SIM.running=false;
  setButtonIconLabel('btnR', 'play', 'INICIAR');
  document.getElementById('btnR').className='btn go';
  document.getElementById('ld').style.background='var(--G)';
  Object.assign(SIM,{t:0,phA:'R',tmA:35,mxA:35,phB:'G',tmB:30,mxB:30,
    phC:'R',tmC:35,mxC:35, phD:'R',tmD:35,mxD:35,
    qA:0,sA:0,sCycA:0,qB:0,sB:0,qC:0,sC:0,qD:0,sD:0,
    cycles:0,mxQA:0,mxQB:0,mxQC:0,mxQD:0,
    wtA:[],wtB:[],wtC:[],wtD:[],wsA:[],wsB:[],wsC:[],wsD:[],
    cycSvd:[],nxA:1.5,nxB:2.5,nxC:2.0,nxD:1.8,_lastSnap:-1,chartQ:[],
    cmpWqConv:[],cmpWqInt:[],cmpTpConv:[],cmpTpInt:[],cmpQConv:[],cmpQInt:[]});
  VEHS=[]; clearLog(); updateSemUI();
  MARKOV.reset();
  FORECAST_CACHE.modal = null;
  FORECAST_CACHE.sidebar = null;
  FORECAST_CACHE.pdf = null;
  vx.clearRect(0,0,VC.width,VC.height); drawRoad(); renderFrame();
  updateUI();
  document.getElementById('clk').textContent='T = 0.0 s';
  renderForecastBlocked(getForecastContext({
    scenario: SIM.scenario || 'valle',
    startMonth: new Date().getMonth ? new Date().getMonth() : 0,
    nRep: 100,
    months: 6,
    cacheSlot: 'modal',
  }));
  updateForecastSidebar();
  addLog('I','↺ Reiniciado — Intersección El Bosque · Panamá');
}
function toggleMode() {
  SIM.mode = SIM.mode==='convencional'?'inteligente':'convencional';
  const btn=document.getElementById('btnM');
  if (SIM.mode==='inteligente') {
    setButtonIconLabel('btnM', 'cpu', 'INTELIGENTE'); btn.style.borderColor='var(--G)'; btn.style.color='var(--G)';
    addLog('I','🧠 MODO INTELIGENTE activado — verde adaptativo, servicio optimizado');
    const it1=document.getElementById('intel-targets'); if(it1) it1.style.display='block';
    addLog('I','📷 Cámaras + sensores de cola activos en 4 semáforos');
    addLog('I','🔄 Sincronización A+D ↔ B+C: fases adaptativas por densidad');
    addLog('I','📊 Verde A+D = f(qA+qD)·2.0+10s · Verde B+C = f(qB+qC)·1.8+10s');
  } else {
    setButtonIconLabel('btnM', 'bolt', 'CONVENCIONAL'); btn.style.borderColor=''; btn.style.color='';
    addLog('I','⚡ CONVENCIONAL: Fase1=A+D verde '+SIM.tGA+'s · Fase2=B+C verde '+SIM.tGB+'s');
    const it2=document.getElementById('intel-targets'); if(it2) it2.style.display='none';
  }
  FORECAST_CACHE.modal = null;
  FORECAST_CACHE.sidebar = null;
  FORECAST_CACHE.pdf = null;
  updateForecastSidebar();
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
  FORECAST_CACHE.modal = null;
  FORECAST_CACHE.sidebar = null;
  FORECAST_CACHE.pdf = null;
  updateForecastSidebar();
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
updateForecastSidebar();
addLog('I','🚦 TrafficFlow — Intersección El Bosque · Panamá');
addLog('I','Vehículos con canvas: autos, SUV, pickup, camión, moto — orientación correcta');
addLog('I','Modelo IDM (Intelligent Driver Model): espaciado y desaceleración realistas');
addLog('I','Sem.A (horiz/vuelta-U) complementario con Sem.B (vertical/avenida)');
addLog('I','▶ INICIAR para correr la simulación de eventos discretos');
// ══════════════════════════════════════════════════════════════════════════════
//  MÓDULO PRONÓSTICO MARKOV — 6 MESES
//  Simulación estocástica por escenario horario usando cadenas de Markov.
//  Para cada mes proyecta: Wq, cola máxima, throughput, ρ en ambos modos.
//  Utiliza Monte Carlo (N réplicas) para obtener media e IC 95%.
// ══════════════════════════════════════════════════════════════════════════════

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Parámetros de escenario: {lA, lB, muA, cycleConv, cycleIntel, label}
const FC_SCENARIOS = {
  pico:     { lA:0.25, lB:0.08, label:'5–7 PM Pico' },
  manana:   { lA:0.18, lB:0.06, label:'7–9 AM Mañana' },
  mediodia: { lA:0.06, lB:0.03, label:'12–2 PM Mediodía' },
  valle:    { lA:0.04, lB:0.02, label:'Hora Valle' },
};

// Factor de crecimiento mensual de demanda (tendencia leve +1.5% mensual urbano Panamá)
const GROWTH_RATE = 0.015;

// Factor de mejora acumulada del modo inteligente (aprende de patrones, +0.8% por mes)
const INTEL_LEARN_RATE = 0.008;

const FC_MIN_MARKOV_OBS = 10;
const FC_MARKOV_STEP_SEC = 2;
const FC_MIN_CYCLES = 1;
const FC_PREVIEW_WAIT_SAMPLES = 6;
const FC_MIN_WAIT_SAMPLES = 12;
const FORECAST_CACHE = { modal:null, sidebar:null, pdf:null };

function fcClamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function buttonIconHTML(iconId, label) {
  return '<span class="btn-ico" aria-hidden="true"><svg class="ico"><use href="#i-' + iconId + '"></use></svg></span><span>' + label + '</span>';
}

function setButtonIconLabel(id, iconId, label) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = buttonIconHTML(iconId, label);
}

function fcAvg(arr) {
  return arr && arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function fcLast(arr) {
  return arr && arr.length ? arr[arr.length - 1] : null;
}

function fcSamplePoisson(lambdaWindow) {
  if (!Number.isFinite(lambdaWindow) || lambdaWindow <= 0) return 0;
  const L = Math.exp(-lambdaWindow);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function fcNormalizeSteady(steady, fallback) {
  const base = fallback || { R:0.33, Y:0.33, G:0.34 };
  const out = { R:0, Y:0, G:0 };
  let total = 0;
  ['R', 'Y', 'G'].forEach(function(state) {
    const value = Number(steady && steady[state]);
    out[state] = Number.isFinite(value) && value >= 0 ? value : 0;
    total += out[state];
  });
  if (total <= 0) return fcNormalizeSteady(base);
  ['R', 'Y', 'G'].forEach(function(state) { out[state] /= total; });
  return out;
}

function fcNormalizeMatrix(matrix, fallbackMatrix) {
  const safeFallback = fallbackMatrix || MARKOV.matConv;
  const out = {};
  ['R', 'Y', 'G'].forEach(function(from) {
    const row = {};
    let total = 0;
    ['R', 'Y', 'G'].forEach(function(to) {
      const value = Number(matrix && matrix[from] && matrix[from][to]);
      row[to] = Number.isFinite(value) && value >= 0 ? value : 0;
      total += row[to];
    });
    if (total <= 0) {
      total = 0;
      ['R', 'Y', 'G'].forEach(function(to) {
        const fb = Number(safeFallback[from] && safeFallback[from][to]);
        row[to] = Number.isFinite(fb) && fb >= 0 ? fb : 0;
        total += row[to];
      });
    }
    if (total <= 0) total = 1;
    ['R', 'Y', 'G'].forEach(function(to) { row[to] /= total; });
    out[from] = row;
  });
  return out;
}

function fcSampleFromSteady(steady, fallbackState) {
  const dist = fcNormalizeSteady(steady);
  const r = Math.random();
  let cumul = 0;
  const states = ['R', 'Y', 'G'];
  for (let i = 0; i < states.length; i++) {
    cumul += dist[states[i]];
    if (r <= cumul) return states[i];
  }
  return fallbackState || 'R';
}

function fcNextMarkovState(currentState, matrix) {
  const row = (matrix && matrix[currentState]) || (matrix && matrix.R) || MARKOV.matConv.R;
  const r = Math.random();
  let cumul = 0;
  const states = ['R', 'Y', 'G'];
  for (let i = 0; i < states.length; i++) {
    cumul += row[states[i]];
    if (r <= cumul) return states[i];
  }
  return currentState || 'R';
}

function markovMatrixMultiply(a, b) {
  const out = { R:{R:0,Y:0,G:0}, Y:{R:0,Y:0,G:0}, G:{R:0,Y:0,G:0} };
  ['R','Y','G'].forEach(function(i) {
    ['R','Y','G'].forEach(function(j) {
      let sum = 0;
      ['R','Y','G'].forEach(function(k) {
        sum += (a[i] && a[i][k] ? a[i][k] : 0) * (b[k] && b[k][j] ? b[k][j] : 0);
      });
      out[i][j] = sum;
    });
  });
  return out;
}

function markovMatrixPower(matrix, steps) {
  const safe = fcNormalizeMatrix(matrix, MARKOV.matConv);
  let out = { R:{R:1,Y:0,G:0}, Y:{R:0,Y:1,G:0}, G:{R:0,Y:0,G:1} };
  for (let i = 0; i < Math.max(0, steps); i++) out = markovMatrixMultiply(out, safe);
  return out;
}

function markovExpectedRunSeconds(matrix, state, stepSec) {
  const safe = fcNormalizeMatrix(matrix, MARKOV.matConv);
  const pStay = fcClamp((safe[state] && safe[state][state]) || 0, 0, 0.999);
  return stepSec / Math.max(1 - pStay, 0.001);
}

function markovMeanStepsToTarget(matrix, targetState) {
  const safe = fcNormalizeMatrix(matrix, MARKOV.matConv);
  let h = { R:0, Y:0, G:0 };
  for (let iter = 0; iter < 300; iter++) {
    const next = { R:0, Y:0, G:0 };
    let maxDiff = 0;
    ['R','Y','G'].forEach(function(s) {
      if (s === targetState) {
        next[s] = 0;
        return;
      }
      next[s] = 1 + safe[s].R * h.R + safe[s].Y * h.Y + safe[s].G * h.G;
      maxDiff = Math.max(maxDiff, Math.abs(next[s] - h[s]));
    });
    h = next;
    if (maxDiff < 1e-6) break;
  }
  return h;
}

function markovExpectedTimeToGreen(matrix, steady, currentState, stepSec) {
  const safeSteady = fcNormalizeSteady(steady, MARKOV.steadyConv);
  if (currentState === 'G') {
    return stepSec / Math.max(safeSteady.G, 0.001);
  }
  const hits = markovMeanStepsToTarget(matrix, 'G');
  return hits[currentState] * stepSec;
}

function markovBlockedProbability(matrix, currentState, horizonSec, stepSec) {
  const steps = Math.max(1, Math.ceil(horizonSec / Math.max(stepSec, 1)));
  const power = markovMatrixPower(matrix, steps);
  const row = power[currentState] || power.R;
  return fcClamp((row.R || 0) + (row.Y || 0), 0, 1);
}

function formatSignedVeh(value) {
  const rounded = Math.round(value || 0);
  return (rounded >= 0 ? '+' : '') + rounded + ' v/h';
}

function getScenarioConfig() {
  try {
    return FC_SCENARIOS[SIM.scenario] || FC_SCENARIOS.valle || { lA: SIM.lA || 0, label: SIM.scenario || 'Sesion actual' };
  } catch (err) {
    return { lA: SIM.lA || 0, label: SIM.scenario || 'Sesion actual' };
  }
}

function getModeSeries(mode) {
  const safeMode = normalizeModeName(mode);
  return {
    wq: safeMode === 'inteligente' ? SIM.cmpWqInt : SIM.cmpWqConv,
    tp: safeMode === 'inteligente' ? SIM.cmpTpInt : SIM.cmpTpConv,
    q:  safeMode === 'inteligente' ? SIM.cmpQInt  : SIM.cmpQConv,
  };
}

function computeModeConvergencePct(modeSummary) {
  if (!modeSummary || !modeSummary.params || !modeSummary.params.hasAnyRealData || !modeSummary.params.usesEmpiricalMatrix) return null;
  const defaults = getForecastModeDefaults(modeSummary.mode);
  const steady = modeSummary.params.steady || defaults.steady;
  const theo = defaults.steady;
  const tvd = (
    Math.abs((steady.G || 0) - (theo.G || 0)) +
    Math.abs((steady.Y || 0) - (theo.Y || 0)) +
    Math.abs((steady.R || 0) - (theo.R || 0))
  ) / 2;
  return Math.max(0, Math.min(100, Math.round((1 - tvd) * 100)));
}

function getModeObservedSummary(mode, fallbackLA) {
  const safeMode = normalizeModeName(mode);
  const currentMode = normalizeModeName(SIM.mode);
  const params = getRealSimParams(safeMode, fallbackLA);
  const series = getModeSeries(safeMode);
  const liveWq = safeMode === currentMode && SIM.wtA.length > 0
    ? parseFloat((SIM.wtA.reduce(function(a, b) { return a + b; }, 0) / SIM.wtA.length).toFixed(2))
    : null;
  const liveTp = safeMode === currentMode && SIM.t > 0 ? Math.round((SIM.sA / SIM.t) * 3600) : null;
  const liveQ = safeMode === currentMode ? SIM.qA : null;
  const livePeakQ = safeMode === currentMode ? SIM.mxQA : null;
  const cycles = getModeRunStats(safeMode).cycles || 0;
  const latestWq = liveWq !== null ? liveWq : fcLast(series.wq);
  const latestTp = liveTp !== null ? liveTp : fcLast(series.tp);
  const latestQ = liveQ !== null ? liveQ : fcLast(series.q);
  const peakQ = livePeakQ !== null ? livePeakQ : (series.q.length ? Math.max.apply(null, series.q) : null);
  const lambdaA = (params.lABase || fallbackLA || 0) * 0.35;
  const rho = params.hasAnyRealData && params.muEff > 0 ? Math.min(0.999, lambdaA / params.muEff) : null;
  const markovValid = params.hasAnyRealData && params.usesEmpiricalMatrix && cycles >= FC_MIN_CYCLES;
  return {
    mode: safeMode,
    hasData: params.hasAnyRealData || series.wq.length > 0 || series.tp.length > 0 || series.q.length > 0 || cycles > 0,
    wq: latestWq,
    tp: latestTp,
    q: latestQ,
    peakQ: peakQ,
    cycles: cycles,
    markovObs: params.markovObs || 0,
    rho: rho,
    convergencePct: computeModeConvergencePct({ mode: safeMode, params: params }),
    capacityVehH: markovValid ? params.muEff * 3600 : null,
    params: params,
    markovValid: markovValid,
  };
}

function getComparisonSnapshot() {
  const sc = getScenarioConfig();
  const conv = getModeObservedSummary('convencional', sc.lA);
  const intel = getModeObservedSummary('inteligente', sc.lA);
  return {
    scenarioLabel: sc.label || 'Sesion actual',
    conv: conv,
    intel: intel,
    bothObserved: conv.hasData && intel.hasData,
  };
}

function getForecastModeDefaults(mode) {
  const isIntel = mode === 'inteligente';
  const tYellow = SIM.tY || 4;
  const tGreen  = isIntel ? 30 : 18;
  const tRed    = isIntel ? 32 : 100;
  const steady  = isIntel ? MARKOV.steadyIntel : MARKOV.steadyConv;
  const matrix  = isIntel ? MARKOV.matIntel : MARKOV.matConv;
  const muGreen = isIntel ? (1 / 2.0) : (1 / 3.5);
  return {
    mode: mode,
    tYellow: tYellow,
    tGreen: tGreen,
    tRed: tRed,
    cycleT: tGreen + tYellow + tRed,
    steady: steady,
    matrix: matrix,
    muGreen: muGreen,
    muEff: steady.G * muGreen,
    stepSec: FC_MARKOV_STEP_SEC,
    initialQueue: 0,
  };
}

function getRealSimParams(mode, fallbackLA) {
  const safeMode = normalizeModeName(mode);
  const defaults = getForecastModeDefaults(safeMode);
  const currentMode = normalizeModeName(SIM.mode);
  const aggregate = getMarkovAggregateStats(getModeMarkovAggregateKey(safeMode));
  const modeStats = getModeRunStats(safeMode);
  const markovObs = aggregate.obs;
  const cmpWqSeries = safeMode === 'inteligente' ? SIM.cmpWqInt : SIM.cmpWqConv;
  const cmpTpSeries = safeMode === 'inteligente' ? SIM.cmpTpInt : SIM.cmpTpConv;
  const cmpQSeries  = safeMode === 'inteligente' ? SIM.cmpQInt  : SIM.cmpQConv;
  const waitFocus = cmpWqSeries.slice();
  const latestWq = fcLast(cmpWqSeries);
  const latestTpSeries = fcLast(cmpTpSeries);
  const latestQSeries  = fcLast(cmpQSeries);
  const latestTp = latestTpSeries;
  const baseQueue = safeMode === currentMode && Number.isFinite(SIM.qA) ? SIM.qA : (latestQSeries !== null ? latestQSeries : 0);
  const hasAnyRealData = markovObs > 0 || waitFocus.length > 0 || (modeStats.cycles || 0) > 0 || latestTp !== null;
  const usesEmpiricalMatrix = markovObs >= FC_MIN_MARKOV_OBS;
  const steady = fcNormalizeSteady(markovObs > 0 ? aggregate.steady : defaults.steady, defaults.steady);
  let inferredCycle = defaults.cycleT;
  if (steady.Y > 0.001) {
    const cycleFromYellow = defaults.tYellow / steady.Y;
    if (Number.isFinite(cycleFromYellow) && cycleFromYellow > defaults.tYellow) {
      inferredCycle = fcClamp(cycleFromYellow, defaults.tYellow + 8, 240);
    }
  }
  const tGreen = fcClamp(inferredCycle * steady.G, 6, 90);
  const tRed   = fcClamp(inferredCycle * steady.R, 6, 180);
  const cycleT = tGreen + defaults.tYellow + tRed;
  const matrix = fcNormalizeMatrix(usesEmpiricalMatrix ? aggregate.matrix : defaults.matrix, defaults.matrix);
  const muEffObserved = latestTp !== null ? latestTp / 3600 : null;
  const muGreenObserved = muEffObserved ? muEffObserved / Math.max(steady.G, 0.05) : null;
  const muGreen = muGreenObserved ? fcClamp(muGreenObserved, 0.05, 1.20) : defaults.muGreen;
  const sourceKind = !hasAnyRealData ? 'fallback' : (usesEmpiricalMatrix ? 'real' : 'partial');
  return {
    mode: safeMode,
    lABase: hasAnyRealData && SIM.lA > 0 ? SIM.lA : fallbackLA,
    matrix: matrix,
    steady: steady,
    tYellow: defaults.tYellow,
    tGreen: tGreen,
    tRed: tRed,
    cycleT: cycleT,
    muGreen: muGreen,
    muEff: muGreen * Math.max(steady.G, 0.001),
    stepSec: defaults.stepSec,
    initialQueue: Math.max(0, Math.round(baseQueue || 0)),
    markovObs: markovObs,
    waitCount: waitFocus.length,
    latestWq: latestWq,
    latestTp: latestTp,
    totalServed: latestTp !== null && SIM.t > 0 ? Math.round((latestTp / 3600) * SIM.t) : 0,
    simTime: SIM.t || 0,
    cycles: modeStats.cycles || 0,
    hasAnyRealData: hasAnyRealData,
    usesEmpiricalMatrix: usesEmpiricalMatrix,
    sourceKind: sourceKind,
  };
}

function getForecastReadiness(sourceParams) {
  const progress = function(value, required) {
    const safeValue = Math.max(0, value || 0);
    return {
      value: safeValue,
      required: required,
      ready: safeValue >= required,
      pct: Math.min(100, Math.round((safeValue / Math.max(required, 1)) * 100)),
    };
  };
  const markov = progress(sourceParams && sourceParams.markovObs, FC_MIN_MARKOV_OBS);
  const cycles = progress(sourceParams && sourceParams.cycles, FC_MIN_CYCLES);
  const previewWaits = progress(sourceParams && sourceParams.waitCount, FC_PREVIEW_WAIT_SAMPLES);
  const waits  = progress(sourceParams && sourceParams.waitCount, FC_MIN_WAIT_SAMPLES);
  const hasEmpiricalBase = !!(sourceParams && sourceParams.hasAnyRealData && sourceParams.usesEmpiricalMatrix && markov.ready && cycles.ready);
  const previewReady = !!(hasEmpiricalBase && previewWaits.ready);
  const ready = !!(previewReady && waits.ready);
  return {
    ready: ready,
    previewReady: previewReady,
    renderable: previewReady,
    state: ready ? 'ready' : (previewReady ? 'preview' : 'blocked'),
    confidenceLabel: ready ? 'alta' : (previewReady ? 'media' : 'baja'),
    markov: markov,
    cycles: cycles,
    previewWaits: previewWaits,
    waits: waits,
  };
}

function summarizeForecastResults(results) {
  let totalWqDelta = 0;
  let totalTpDelta = 0;
  results.forEach(function(r) {
    const wqPct = r.conv.wq.mean > 0 ? Math.round((1 - r.intel.wq.mean / r.conv.wq.mean) * 100) : 0;
    const tpPct = r.conv.tp.mean > 0 ? Math.round((r.intel.tp.mean - r.conv.tp.mean) / r.conv.tp.mean * 100) : 0;
    totalWqDelta += wqPct;
    totalTpDelta += tpPct;
  });
  return {
    avgWqDelta: results.length ? Math.round(totalWqDelta / results.length) : 0,
    avgTpDelta: results.length ? Math.round(totalTpDelta / results.length) : 0,
    firstMonth: results.length ? results[0] : null,
  };
}

function getOperationalMarkovContext() {
  const scenario = SIM.scenario || 'valle';
  const sc = FC_SCENARIOS[scenario] || FC_SCENARIOS.valle;
  const currentMode = normalizeModeName(SIM.mode);
  const actual = getRealSimParams(currentMode, sc.lA);
  const actualDefaults = getForecastModeDefaults(currentMode);
  const comparisonMode = currentMode === 'inteligente' ? 'convencional' : 'inteligente';
  const comparisonObserved = getRealSimParams(comparisonMode, sc.lA);
  const lambdaVeh = (actual.lABase || sc.lA || 0) * 3600;
  const currentState = SIM.phA || 'R';
  const stepSec = actual.stepSec || FC_MARKOV_STEP_SEC;
  const markovReady = actual.hasAnyRealData && actual.usesEmpiricalMatrix && (actual.cycles || 0) >= FC_MIN_CYCLES;
  const comparisonObservedReady = comparisonObserved.hasAnyRealData &&
    comparisonObserved.usesEmpiricalMatrix &&
    (comparisonObserved.cycles || 0) >= FC_MIN_CYCLES;
  const theoSt = actualDefaults.steady;
  const tvd = (Math.abs(actual.steady.G - theoSt.G) + Math.abs(actual.steady.Y - (theoSt.Y || 0.033)) + Math.abs(actual.steady.R - theoSt.R)) / 2;
  const convergencePct = Math.max(0, Math.min(100, Math.round((1 - tvd) * 100)));

  const current = {
    mode: currentMode,
    state: currentState,
    matrix: actual.matrix,
    steady: actual.steady,
    timeToGreenSec: markovExpectedTimeToGreen(actual.matrix, actual.steady, currentState, stepSec),
    redRunSec: markovExpectedRunSeconds(actual.matrix, 'R', stepSec),
    blockedSharePct: (actual.steady.R + actual.steady.Y) * 100,
    blockedRisk30Pct: markovBlockedProbability(actual.matrix, currentState, 30, stepSec) * 100,
    capacityVehH: actual.muEff * 3600,
    marginVehH: (actual.muEff * 3600) - lambdaVeh,
  };

  const benchmark = comparisonObservedReady ? {
    mode: comparisonMode,
    matrix: comparisonObserved.matrix,
    steady: comparisonObserved.steady,
    timeToGreenSec: markovExpectedTimeToGreen(comparisonObserved.matrix, comparisonObserved.steady, currentState, stepSec),
    redRunSec: markovExpectedRunSeconds(comparisonObserved.matrix, 'R', stepSec),
    blockedSharePct: (comparisonObserved.steady.R + comparisonObserved.steady.Y) * 100,
    blockedRisk30Pct: markovBlockedProbability(comparisonObserved.matrix, currentState, 30, stepSec) * 100,
    capacityVehH: comparisonObserved.muEff * 3600,
    marginVehH: comparisonObserved.muEff * 3600 - lambdaVeh,
    sourceKind: 'observed',
    markovObs: comparisonObserved.markovObs || 0,
    labelShort: comparisonMode === 'inteligente' ? 'IA OBS.' : 'CONV OBS.',
  } : null;

  return {
    scenario: scenario,
    scenarioLabel: sc.label,
    actual: actual,
    current: current,
    benchmark: benchmark,
    comparisonMode: comparisonMode,
    comparisonReady: comparisonObservedReady,
    comparisonLabel: comparisonMode === 'inteligente' ? 'modo inteligente observado' : 'modo convencional observado',
    missingComparisonLabel: comparisonMode === 'inteligente' ? 'modo inteligente' : 'modo convencional',
    lambdaVehH: lambdaVeh,
    readiness: {
      ready: !!markovReady,
      markovObs: actual.markovObs || 0,
      requiredObs: FC_MIN_MARKOV_OBS,
      cycles: actual.cycles || 0,
      requiredCycles: FC_MIN_CYCLES,
      convergencePct: convergencePct,
    },
  };
}

function formatForecastDelta(baseValue, compareValue, lowerIsBetter) {
  if (!(baseValue > 0) || !Number.isFinite(compareValue)) return '--';
  const pct = lowerIsBetter
    ? Math.round((1 - compareValue / baseValue) * 100)
    : Math.round((compareValue - baseValue) / baseValue * 100);
  if (lowerIsBetter) return (pct >= 0 ? '-' : '+') + Math.abs(pct) + '%';
  return (pct >= 0 ? '+' : '-') + Math.abs(pct) + '%';
}

function renderForecastSidebarPreview(container, context) {
  if (!container) return;
  const canRender = !!(context && context.readiness && context.readiness.ready);
  container.style.display = canRender ? 'grid' : 'none';
  if (!canRender) {
    container.innerHTML = '';
    return;
  }
  if (!context.benchmark) {
    container.innerHTML = [
      '<div class="fc-side-card">' +
        '<div class="m">T - VERDE</div>' +
        '<div class="wq">' + Math.round(context.current.timeToGreenSec) + ' s</div>' +
        '<div class="tp">SESION ACTUAL</div>' +
        '<div class="tag">comparacion pendiente</div>' +
      '</div>',
      '<div class="fc-side-card">' +
        '<div class="m">RACHA ROJA</div>' +
        '<div class="wq">' + Math.round(context.current.redRunSec) + ' s</div>' +
        '<div class="tp">SESION ACTUAL</div>' +
        '<div class="tag">comparacion pendiente</div>' +
      '</div>',
      '<div class="fc-side-card">' +
        '<div class="m">CAPACIDAD</div>' +
        '<div class="wq">' + Math.round(context.current.capacityVehH) + ' v/h</div>' +
        '<div class="tp">SESION ACTUAL</div>' +
        '<div class="tag">' + formatSignedVeh(context.current.marginVehH) + '</div>' +
      '</div>',
      '<div class="fc-side-card">' +
        '<div class="m">RIESGO 30S</div>' +
        '<div class="wq">' + Math.round(context.current.blockedRisk30Pct) + '%</div>' +
        '<div class="tp">SESION ACTUAL</div>' +
        '<div class="tag">' + Math.round(context.current.blockedSharePct) + '% bloqueado</div>' +
      '</div>',
    ].join('');
    return;
  }
  const cmpLabel = context.benchmark.labelShort;
  const deltaTime = Math.round(context.benchmark.timeToGreenSec - context.current.timeToGreenSec);
  const deltaRed = Math.round(context.benchmark.redRunSec - context.current.redRunSec);
  const deltaCap = Math.round(context.benchmark.capacityVehH - context.current.capacityVehH);
  const deltaRisk = Math.round(context.benchmark.blockedRisk30Pct - context.current.blockedRisk30Pct);
  container.innerHTML = [
    '<div class="fc-side-card">' +
      '<div class="m">T - VERDE</div>' +
      '<div class="wq">' + Math.round(context.current.timeToGreenSec) + ' s</div>' +
      '<div class="tp">' + cmpLabel + ' ' + Math.round(context.benchmark.timeToGreenSec) + ' s</div>' +
      '<div class="tag">' + (deltaTime <= 0 ? '' : '+') + deltaTime + ' s</div>' +
    '</div>',
    '<div class="fc-side-card">' +
      '<div class="m">RACHA ROJA</div>' +
      '<div class="wq">' + Math.round(context.current.redRunSec) + ' s</div>' +
      '<div class="tp">' + cmpLabel + ' ' + Math.round(context.benchmark.redRunSec) + ' s</div>' +
      '<div class="tag">' + (deltaRed <= 0 ? '' : '+') + deltaRed + ' s</div>' +
    '</div>',
    '<div class="fc-side-card">' +
      '<div class="m">CAPACIDAD</div>' +
      '<div class="wq">' + Math.round(context.current.capacityVehH) + ' v/h</div>' +
      '<div class="tp">' + cmpLabel + ' ' + Math.round(context.benchmark.capacityVehH) + ' v/h</div>' +
      '<div class="tag">' + (deltaCap >= 0 ? '+' : '') + deltaCap + ' v/h</div>' +
    '</div>',
    '<div class="fc-side-card">' +
      '<div class="m">RIESGO 30S</div>' +
      '<div class="wq">' + Math.round(context.current.blockedRisk30Pct) + '%</div>' +
      '<div class="tp">' + cmpLabel + ' ' + Math.round(context.benchmark.blockedRisk30Pct) + '%</div>' +
      '<div class="tag">' + (deltaRisk >= 0 ? '+' : '') + deltaRisk + ' pt</div>' +
    '</div>',
  ].join('');
}

function getForecastStartMonth(defaultMonth) {
  const sel = document.getElementById('fc-start-month');
  if (sel) {
    const v = parseInt(sel.value, 10);
    if (Number.isFinite(v)) return v;
  }
  return Number.isFinite(defaultMonth) ? defaultMonth : (new Date().getMonth ? new Date().getMonth() : 0);
}

function getForecastContext(options) {
  const opts = options || {};
  const scenario = opts.scenario || SIM.scenario || 'valle';
  const startMonth = getForecastStartMonth(opts.startMonth);
  const nRep = opts.nRep || 100;
  const months = opts.months || 6;
  const cacheSlot = opts.cacheSlot || null;
  const sc = FC_SCENARIOS[scenario] || FC_SCENARIOS.valle;
  const sourceParams = getRealSimParams(SIM.mode || 'convencional', sc.lA);
  const readiness = getForecastReadiness(sourceParams);
  const baseLA = sourceParams.hasAnyRealData && SIM.lA > 0 ? SIM.lA : sc.lA;
  const cacheKey = [
    scenario,
    startMonth,
    nRep,
    months,
    SIM.mode,
    sourceParams.markovObs,
    sourceParams.cycles,
    sourceParams.waitCount,
    Number(baseLA || 0).toFixed(4),
  ].join('|');

  if (cacheSlot && FORECAST_CACHE[cacheSlot] && FORECAST_CACHE[cacheSlot].key === cacheKey) {
    return FORECAST_CACHE[cacheSlot].ctx;
  }

  const context = {
    startMonth: startMonth,
    scenario: scenario,
    scenarioLabel: sc.label,
    nRep: nRep,
    months: months,
    baseLA: baseLA,
    sourceParams: sourceParams,
    readiness: readiness,
    results: [],
    summary: null,
  };

  if (readiness.renderable) {
    const convParams = getRealSimParams('convencional', baseLA);
    const intelParams = getRealSimParams('inteligente', baseLA);
    const cyclesPerSim = sourceParams.cycles >= 12 ? Math.round(fcClamp(sourceParams.cycles, 12, 60)) : 30;

    for (let m = 0; m < months; m++) {
      const mIdx  = (startMonth + m) % 12;
      const growth = Math.pow(1 + GROWTH_RATE, m);
      const lA_m   = Math.min(0.35, baseLA * growth);
      const intelBoost = Math.pow(1 - INTEL_LEARN_RATE, m);
      const conv  = monteCarlo(lA_m, 'convencional', cyclesPerSim, nRep, convParams);
      const intel = monteCarlo(lA_m * intelBoost, 'inteligente', cyclesPerSim, nRep, intelParams);
      context.results.push({ mIdx, conv, intel, lA: lA_m });
    }

    context.summary = summarizeForecastResults(context.results);
  }

  if (cacheSlot) FORECAST_CACHE[cacheSlot] = { key: cacheKey, ctx: context };
  return context;
}

function getObservedPdfForecastContext(options) {
  const opts = options || {};
  const scenario = opts.scenario || SIM.scenario || 'valle';
  const months = opts.months || 6;
  const nRep = opts.nRep || 120;
  const sc = FC_SCENARIOS[scenario] || FC_SCENARIOS.valle;
  const convParams = getRealSimParams('convencional', sc.lA);
  const intelParams = getRealSimParams('inteligente', sc.lA);
  const convReadiness = getForecastReadiness(convParams);
  const intelReadiness = getForecastReadiness(intelParams);
  const baseLA = Math.max(convParams.lABase || 0, intelParams.lABase || 0, SIM.lA || 0, sc.lA || 0);
  const cyclesPerSim = Math.round(fcClamp(Math.max(convParams.cycles || 0, intelParams.cycles || 0, 12), 12, 60));
  const ready = !!(convReadiness.ready && intelReadiness.ready && baseLA > 0);
  const context = {
    ready: ready,
    months: months,
    nRep: nRep,
    scenario: scenario,
    scenarioLabel: sc.label,
    baseLA: baseLA,
    demandVehH: Math.round(baseLA * 3600),
    cyclesPerSim: cyclesPerSim,
    convParams: convParams,
    intelParams: intelParams,
    convReadiness: convReadiness,
    intelReadiness: intelReadiness,
    conv: null,
    intel: null,
    deltas: null,
  };

  if (!ready) return context;

  const conv = monteCarlo(baseLA, 'convencional', cyclesPerSim, nRep, convParams);
  const intel = monteCarlo(baseLA, 'inteligente', cyclesPerSim, nRep, intelParams);
  const safePct = function(baseValue, compareValue, lowerBetter) {
    if (!(Number.isFinite(baseValue) && Number.isFinite(compareValue) && Math.abs(baseValue) > 0.0001)) return null;
    const raw = lowerBetter
      ? (1 - compareValue / baseValue) * 100
      : ((compareValue - baseValue) / baseValue) * 100;
    return Math.round(raw);
  };

  context.conv = conv;
  context.intel = intel;
  context.deltas = {
    wqPct: safePct(conv.wq.mean, intel.wq.mean, true),
    tpPct: safePct(conv.tp.mean, intel.tp.mean, false),
    qPct: safePct(conv.maxQ.mean, intel.maxQ.mean, true),
  };
  return context;
}

function updateForecastDataSource(context, scenarioLabel) {
  const el = document.getElementById('fc-data-source');
  if (!el) return;
  const realParams = context && context.sourceParams ? context.sourceParams : context;
  const readiness = context && context.readiness ? context.readiness : getForecastReadiness(realParams || {});
  if (!realParams || !realParams.hasAnyRealData) {
    el.className = 'fc-data-source warn';
    el.textContent = 'SIN DATOS OBSERVADOS · usando escenario ' + scenarioLabel + ' como base provisional del pronostico';
    return;
  }
  if (!readiness.renderable) {
    el.className = 'fc-data-source warn';
    el.textContent = 'RECOLECTANDO DATOS OBSERVADOS · Markov ' + readiness.markov.value + '/' + readiness.markov.required +
      ' · ciclos ' + readiness.cycles.value + '/' + readiness.cycles.required +
      ' · muestras Wq ' + readiness.waits.value + '/' + readiness.waits.required;
    return;
  }
  const wqText = realParams.latestWq !== null && Number.isFinite(realParams.latestWq)
    ? realParams.latestWq.toFixed(2) + 'm'
    : '—';
  const tpText = realParams.latestTp !== null && Number.isFinite(realParams.latestTp)
    ? Math.round(realParams.latestTp) + 'v/h'
    : '—';
  const muText = Number.isFinite(realParams.muEff) ? realParams.muEff.toFixed(4) + ' v/s' : '—';
  const obsText = (realParams.markovObs || 0) + ' obs Markov';
  const cyclesText = (realParams.cycles || 0) + ' ciclos';
  if (!readiness.ready) {
    const pendingWaits = Math.max(0, readiness.waits.required - readiness.waits.value);
    el.className = 'fc-data-source preview';
    el.textContent = 'BASE EMPIRICA PRELIMINAR · ' + obsText + ' · Wq=' + wqText + ' · TP=' + tpText +
      ' · ' + cyclesText + ' · confianza ' + readiness.confidenceLabel + ' · faltan ' + pendingWaits + ' muestras Wq';
    return;
  }
  if (realParams.sourceKind === 'real') {
    el.className = 'fc-data-source ok';
    el.textContent = 'DATOS OBSERVADOS · ' + obsText + ' · Wq=' + wqText + ' · TP=' + tpText + ' · ' + cyclesText + ' · mu_eff=' + muText;
    return;
  }
  el.className = 'fc-data-source warn';
  el.textContent = 'DATOS PARCIALES · ' + obsText + ' · matriz teorica fallback · Wq=' + wqText + ' · TP=' + tpText + ' · ' + cyclesText;
}

function setForecastModalReady(isReady) {
  const charts = document.getElementById('fc-charts-wrap');
  const table = document.getElementById('fc-table-wrap');
  const empty = document.getElementById('fc-empty-state');
  if (charts) charts.style.display = isReady ? 'grid' : 'none';
  if (table) table.style.display = isReady ? 'block' : 'none';
  if (empty) empty.style.display = isReady ? 'none' : 'block';
}

function renderForecastBlocked(context) {
  setForecastModalReady(false);
  updateForecastDataSource(context, context.scenarioLabel);
  const empty = document.getElementById('fc-empty-state');
  if (empty) {
    empty.innerHTML =
      'Pronóstico bloqueado hasta acumular datos observados suficientes.<br>' +
      'Progreso actual: Markov ' + context.readiness.markov.value + '/' + context.readiness.markov.required +
      ' · ciclos ' + context.readiness.cycles.value + '/' + context.readiness.cycles.required +
      ' · muestras Wq ' + context.readiness.waits.value + '/' + context.readiness.waits.required + '.<br>' +
      'La vista preliminar se habilita desde ' + FC_PREVIEW_WAIT_SAMPLES + ' muestras Wq y la version consolidada desde ' + FC_MIN_WAIT_SAMPLES + '.';
  }
  const tbody = document.getElementById('fc-table-body');
  if (tbody) tbody.innerHTML = '';
  const verdict = document.getElementById('fc-verdict-row');
  if (verdict) {
    verdict.style.background = 'rgba(255,190,46,0.08)';
    verdict.style.border = '1px solid rgba(255,190,46,0.3)';
    verdict.style.color = 'var(--Y)';
    verdict.textContent = 'Corre la simulacion unos ciclos mas. El pronostico mensual se habilita en vista preliminar desde la base empirica minima y luego se consolida automaticamente.';
  }
}

function updateForecastSidebar() {
  const panel = document.getElementById('forecast-side-panel');
  if (!panel) return;
  const setText = function(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  const setBar = function(id, pct, color) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (color) el.style.background = color;
  };
  const chip = document.getElementById('fc-side-chip');
  const source = document.getElementById('fc-side-source');
  const preview = document.getElementById('fc-side-preview');
  const summary = document.getElementById('fc-side-summary');
  try {
    const ctx = getOperationalMarkovContext();
    if (chip) {
      chip.className = 'fc-side-chip ' + (ctx.readiness.ready ? 'ok' : 'wait');
      chip.textContent = ctx.readiness.ready ? 'VALIDADO' : 'RECOLECTANDO';
    }
    if (source) {
      if (!ctx.actual.hasAnyRealData) {
        source.textContent = 'Sin datos observados todavia. El analisis operacional aparecera cuando la simulacion acumule una cadena empirica minima.';
      } else {
        const comparisonSource = ctx.comparisonReady
          ? (ctx.comparisonLabel + ' · ' + ctx.benchmark.markovObs + ' obs')
          : ('falta una corrida registrada del ' + ctx.missingComparisonLabel);
        source.textContent = 'Cadena empirica de la sesion actual · ' + ctx.scenarioLabel + ' · ' + ctx.readiness.markovObs +
          ' obs · estado actual ' + (ctx.current.state === 'G' ? 'VERDE' : ctx.current.state === 'R' ? 'ROJO' : 'AMARILLO') +
          ' · λ=' + Math.round(ctx.lambdaVehH) + ' v/h · comparacion: ' + comparisonSource;
      }
    }
    const obsPct = Math.min(100, Math.round((ctx.readiness.markovObs / Math.max(ctx.readiness.requiredObs, 1)) * 100));
    const cyclesPct = Math.min(100, Math.round((ctx.readiness.cycles / Math.max(ctx.readiness.requiredCycles, 1)) * 100));
    setText('fc-side-obs', ctx.readiness.markovObs + '/' + ctx.readiness.requiredObs);
    setText('fc-side-cycles', ctx.readiness.cycles + '/' + ctx.readiness.requiredCycles);
    setText('fc-side-conv', ctx.readiness.convergencePct + '%');
    setBar('fc-side-obs-bar', obsPct, obsPct >= 100 ? 'var(--G)' : 'var(--Y)');
    setBar('fc-side-cycles-bar', cyclesPct, cyclesPct >= 100 ? 'var(--G)' : 'var(--Y)');
    setBar('fc-side-conv-bar', ctx.readiness.convergencePct, ctx.readiness.convergencePct >= 80 ? 'var(--G)' : (ctx.readiness.convergencePct >= 50 ? 'var(--Y)' : 'var(--R)'));
    renderForecastSidebarPreview(preview, ctx);

    if (!summary) return;
    if (!ctx.readiness.ready) {
      summary.textContent = 'La lectura operativa de Markov se habilita cuando existan al menos ' + ctx.readiness.requiredObs +
        ' observaciones y ' + ctx.readiness.requiredCycles + ' ciclo completo. A diferencia del forecast, aqui no dependemos de Wq sino de la matriz empirica.';
      return;
    }
    if (!ctx.comparisonReady) {
      summary.textContent =
        'Lectura OR con Markov de la sesion actual: Sem A queda bloqueado ' + Math.round(ctx.current.blockedSharePct) +
        '% del tiempo, tarda ' + Math.round(ctx.current.timeToGreenSec) + ' s en llegar a verde desde el estado actual, ' +
        'su racha roja esperada es ' + Math.round(ctx.current.redRunSec) + ' s y la capacidad efectiva observada es ' +
        Math.round(ctx.current.capacityVehH) + ' v/h. El contraste aparecera cuando tambien exista una corrida registrada del ' +
        ctx.missingComparisonLabel + ' en esta sesion.';
      return;
    }
    const fromLabel = ctx.current.mode === 'inteligente' ? 'esquema inteligente actual' : 'control actual';
    const toLabel = ctx.comparisonLabel;
    summary.textContent =
      'Lectura OR con Markov: el ' + fromLabel + ' deja a Sem A bloqueado ' + Math.round(ctx.current.blockedSharePct) +
      '% del tiempo y tarda ' + Math.round(ctx.current.timeToGreenSec) + ' s en promedio para llegar a verde desde el estado actual. ' +
      'Con la misma demanda observada, el ' + toLabel + ' llevaria ese bloqueo a ' + Math.round(ctx.benchmark.blockedSharePct) +
      '% y cambiaria la capacidad efectiva de ' + Math.round(ctx.current.capacityVehH) + ' a ' + Math.round(ctx.benchmark.capacityVehH) +
      ' v/h. Esto es mas util para IO: estado estable, tiempos de paso y margen capacidad-demanda (' +
      formatSignedVeh(ctx.current.marginVehH) + ' -> ' + formatSignedVeh(ctx.benchmark.marginVehH) + '). La comparacion usa datos observados del otro modo dentro de la misma sesion.';
  } catch (err) {
    console.error('Forecast sidebar error', err);
    if (chip) {
      chip.className = 'fc-side-chip wait';
      chip.textContent = 'ERROR';
    }
    if (source) {
      source.textContent = 'Hubo un error actualizando el analisis operativo basado en Markov. Recarga la pagina o reinicia la corrida.';
    }
    renderForecastSidebarPreview(preview, null);
    setText('fc-side-obs', '--');
    setText('fc-side-cycles', '--');
    setText('fc-side-conv', '--');
    setBar('fc-side-obs-bar', 0, 'var(--R)');
    setBar('fc-side-cycles-bar', 0, 'var(--R)');
    setBar('fc-side-conv-bar', 0, 'var(--R)');
    if (summary) {
      summary.textContent = 'El lateral deberia mostrar indicadores operativos basados en la cadena de Markov. Si ves este mensaje, hubo un error calculando esa lectura.';
    }
  }
}

/**
 * Simula una ventana de operación usando la matriz de Markov real cuando existe.
 * Si no hay historial suficiente, cae en la matriz teórica del modo.
 */
function markovDaySimulation(lA, mode, cycles, realParams) {
  const defaults = getForecastModeDefaults(mode);
  const params = realParams || defaults;
  const stepSec = Math.max(1, params.stepSec || defaults.stepSec);
  const cycleT = Math.max(10, Number.isFinite(params.cycleT) ? params.cycleT : defaults.cycleT);
  const totalTimeSec = Math.max(stepSec, cycles * cycleT);
  const totalSteps = Math.max(1, Math.round(totalTimeSec / stepSec));
  const mat = fcNormalizeMatrix(params.matrix, defaults.matrix);
  const steady = fcNormalizeSteady(params.steady, defaults.steady);
  const muGreen = fcClamp(Number.isFinite(params.muGreen) ? params.muGreen : defaults.muGreen, 0.01, 1.20);

  let totalArrivals = 0;
  let totalQTime = 0;
  let totalSv = 0;
  let maxQAll = 0;
  let state = fcSampleFromSteady(steady, 'R');
  let queue = Math.max(0, Math.round(params.initialQueue || 0));

  for (let step = 0; step < totalSteps; step++) {
    const arrivals = fcSamplePoisson(Math.max(0, lA) * stepSec);
    queue += arrivals;
    totalArrivals += arrivals;

    if (state === 'G' && queue > 0) {
      const served = Math.min(queue, fcSamplePoisson(muGreen * stepSec));
      queue -= served;
      totalSv += served;
    }

    if (queue > maxQAll) maxQAll = queue;
    totalQTime += queue * stepSec;
    state = fcNextMarkovState(state, mat);
  }

  const lambdaEff = totalTimeSec > 0 ? totalArrivals / totalTimeSec : lA;
  const Lq = totalTimeSec > 0 ? totalQTime / totalTimeSec : 0;
  const wqSec = lambdaEff > 0 ? (Lq / lambdaEff) : 0;
  const muEff = muGreen * Math.max(steady.G, 0.001);
  const rho = Math.min(0.99, lambdaEff / Math.max(muEff, 0.001));
  const tp = totalSv / (totalTimeSec / 3600);

  return {
    wq:   Math.max(0, wqSec / 60),
    maxQ: maxQAll,
    tp:   Math.round(tp),
    rho:  rho,
    Lq:   Lq,
  };
}

/**
 * Monte Carlo: corre N réplicas con los parámetros reales del simulador.
 */
function monteCarlo(lA, mode, cycles, nRep, realParams) {
  const wqs = [], maxQs = [], tps = [], rhos = [];
  for (let i = 0; i < nRep; i++) {
    const r = markovDaySimulation(lA, mode, cycles, realParams);
    wqs.push(r.wq); maxQs.push(r.maxQ); tps.push(r.tp); rhos.push(r.rho);
  }
  function stats(arr) {
    arr.sort((a,b)=>a-b);
    const n = arr.length;
    const mean = arr.reduce((s,v)=>s+v,0)/n;
    const std  = Math.sqrt(arr.reduce((s,v)=>s+(v-mean)*(v-mean),0)/n);
    const z95  = 1.96;
    const se   = std / Math.sqrt(n);
    return { mean, lo: Math.max(0, mean - z95*se), hi: mean + z95*se,
             p10: arr[Math.floor(n*0.10)], p90: arr[Math.floor(n*0.90)] };
  }
  return {
    wq:   stats(wqs),
    maxQ: stats(maxQs),
    tp:   stats(tps),
    rho:  stats(rhos),
  };
}

function openForecast() {
  document.getElementById('forecast-modal').classList.add('show');
  const scenarioSel = document.getElementById('fc-scenario');
  if (scenarioSel && SIM.scenario && FC_SCENARIOS[SIM.scenario]) scenarioSel.value = SIM.scenario;
  // Si ya hay datos de la simulación corriendo, ejecutar inmediatamente
  runMarkovForecast();
}

function runMarkovForecast() {
  const startMonth = parseInt(document.getElementById('fc-start-month').value);
  const scenario   = document.getElementById('fc-scenario').value;
  const nRep       = parseInt(document.getElementById('fc-replicas').value);
  document.getElementById('fc-rep-label').textContent = nRep;
  const context = getForecastContext({
    startMonth: startMonth,
    scenario: scenario,
    nRep: nRep,
    months: 6,
    cacheSlot: 'modal',
  });
  if (!context.readiness.renderable) {
    renderForecastBlocked(context);
    return;
  }
  setForecastModalReady(true);
  updateForecastDataSource(context, context.scenarioLabel);
  renderForecastCharts(context.results);
  renderForecastTable(context.results, startMonth, scenario);
}

// ── Renderizado de gráficos ──────────────────────────────────────────────────

function drawForecastChart(canvasId, datasets, yLabel, fmtY) {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.offsetWidth || cv.parentElement.clientWidth || 400;
  cv.width = W; // reasignar width para limpiar
  const H = cv.height;
  ctx.clearRect(0, 0, W, H);

  const PAD = { t:10, r:14, b:28, l:50 };
  const pw = W - PAD.l - PAD.r;
  const ph = H - PAD.t - PAD.b;
  const N  = datasets[0].x.length;

  // Fondo
  ctx.fillStyle = '#0b0f16';
  ctx.fillRect(0, 0, W, H);

  // Calcular rango Y
  let allVals = [];
  datasets.forEach(d => {
    if (d.lo)  allVals = allVals.concat(d.lo);
    if (d.hi)  allVals = allVals.concat(d.hi);
    allVals = allVals.concat(d.y);
  });
  const yMin = 0;
  const yMax = Math.max(...allVals) * 1.12 || 1;

  const xPos = i => PAD.l + (i / (N - 1)) * pw;
  const yPos = v => PAD.t + ph - ((v - yMin) / (yMax - yMin)) * ph;

  // Grid
  ctx.strokeStyle = '#182030'; ctx.lineWidth = 0.5;
  for (let gi = 0; gi <= 4; gi++) {
    const yv = yMin + (yMax - yMin) * gi / 4;
    const yp = yPos(yv);
    ctx.beginPath(); ctx.moveTo(PAD.l, yp); ctx.lineTo(PAD.l + pw, yp); ctx.stroke();
    ctx.fillStyle = '#2a3848'; ctx.font = '8px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(fmtY(yv), PAD.l - 4, yp + 3);
  }

  // Etiquetas X (meses)
  datasets[0].labels.forEach((lbl, i) => {
    ctx.fillStyle = '#4e6078'; ctx.font = '7px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(lbl, xPos(i), H - 8);
    // tick vertical
    ctx.strokeStyle = '#182030'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.moveTo(xPos(i), PAD.t + ph); ctx.lineTo(xPos(i), PAD.t + ph + 3); ctx.stroke();
  });

  // Eje Y label
  ctx.save(); ctx.translate(10, PAD.t + ph/2); ctx.rotate(-Math.PI/2);
  ctx.fillStyle = '#2a3848'; ctx.font = '7px JetBrains Mono, monospace';
  ctx.textAlign = 'center'; ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  // Bandas IC 95%
  datasets.forEach(d => {
    if (!d.lo || !d.hi) return;
    ctx.beginPath();
    for (let i = 0; i < N; i++) ctx.lineTo(xPos(i), yPos(d.hi[i]));
    for (let i = N-1; i >= 0; i--) ctx.lineTo(xPos(i), yPos(d.lo[i]));
    ctx.closePath();
    ctx.fillStyle = d.bandColor || 'rgba(255,255,255,0.05)';
    ctx.fill();
    // Borde dashed
    ctx.setLineDash([3,3]);
    ctx.strokeStyle = d.dashColor || 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    d.hi.forEach((v,i) => i===0 ? ctx.moveTo(xPos(i),yPos(v)) : ctx.lineTo(xPos(i),yPos(v)));
    ctx.stroke();
    ctx.beginPath();
    d.lo.forEach((v,i) => i===0 ? ctx.moveTo(xPos(i),yPos(v)) : ctx.lineTo(xPos(i),yPos(v)));
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // Líneas principales + puntos
  datasets.forEach(d => {
    ctx.beginPath();
    d.y.forEach((v, i) => i===0 ? ctx.moveTo(xPos(i), yPos(v)) : ctx.lineTo(xPos(i), yPos(v)));
    ctx.strokeStyle = d.color; ctx.lineWidth = 2; ctx.stroke();

    // Puntos
    d.y.forEach((v, i) => {
      ctx.beginPath();
      ctx.arc(xPos(i), yPos(v), 3.5, 0, Math.PI*2);
      ctx.fillStyle = d.color; ctx.fill();
      ctx.strokeStyle = '#07090d'; ctx.lineWidth = 1; ctx.stroke();
      // Valor encima
      ctx.fillStyle = d.color; ctx.font = '7px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(fmtY(v), xPos(i), yPos(v) - 6);
    });
  });
}

function renderForecastCharts(results) {
  const labels = results.map(r => MONTH_NAMES[r.mIdx].substring(0,3));

  // ─ Wq ─
  drawForecastChart('fc-wq-chart', [
    {
      x: results.map((_,i)=>i), y: results.map(r=>+r.conv.wq.mean.toFixed(2)),
      lo: results.map(r=>+r.conv.wq.lo.toFixed(2)),
      hi: results.map(r=>+r.conv.wq.hi.toFixed(2)),
      color:'#ff2d50', bandColor:'rgba(255,45,80,0.10)', dashColor:'rgba(255,45,80,0.35)',
      labels,
    },
    {
      x: results.map((_,i)=>i), y: results.map(r=>+r.intel.wq.mean.toFixed(2)),
      lo: results.map(r=>+r.intel.wq.lo.toFixed(2)),
      hi: results.map(r=>+r.intel.wq.hi.toFixed(2)),
      color:'#00df76', bandColor:'rgba(0,223,118,0.08)', dashColor:'rgba(0,223,118,0.35)',
      labels,
    },
  ], 'min', v => v.toFixed(1)+'m');

  // ─ Cola ─
  drawForecastChart('fc-q-chart', [
    {
      x: results.map((_,i)=>i), y: results.map(r=>Math.round(r.conv.maxQ.mean)),
      lo: results.map(r=>Math.round(r.conv.maxQ.lo)),
      hi: results.map(r=>Math.round(r.conv.maxQ.hi)),
      color:'#ff2d50', bandColor:'rgba(255,45,80,0.10)', dashColor:'rgba(255,45,80,0.35)',
      labels,
    },
    {
      x: results.map((_,i)=>i), y: results.map(r=>Math.round(r.intel.maxQ.mean)),
      lo: results.map(r=>Math.round(r.intel.maxQ.lo)),
      hi: results.map(r=>Math.round(r.intel.maxQ.hi)),
      color:'#00df76', bandColor:'rgba(0,223,118,0.08)', dashColor:'rgba(0,223,118,0.35)',
      labels,
    },
  ], 'veh', v => Math.round(v)+'');

  // ─ Throughput ─
  drawForecastChart('fc-tp-chart', [
    {
      x: results.map((_,i)=>i), y: results.map(r=>Math.round(r.conv.tp.mean)),
      lo: results.map(r=>Math.round(r.conv.tp.lo)),
      hi: results.map(r=>Math.round(r.conv.tp.hi)),
      color:'#ff2d50', bandColor:'rgba(255,45,80,0.10)', dashColor:'rgba(255,45,80,0.35)',
      labels,
    },
    {
      x: results.map((_,i)=>i), y: results.map(r=>Math.round(r.intel.tp.mean)),
      lo: results.map(r=>Math.round(r.intel.tp.lo)),
      hi: results.map(r=>Math.round(r.intel.tp.hi)),
      color:'#00df76', bandColor:'rgba(0,223,118,0.08)', dashColor:'rgba(0,223,118,0.35)',
      labels,
    },
  ], 'v/h', v => Math.round(v)+'');

  // ─ ρ ─
  drawForecastChart('fc-rho-chart', [
    {
      x: results.map((_,i)=>i), y: results.map(r=>+(r.conv.rho.mean*100).toFixed(1)),
      lo: results.map(r=>+(r.conv.rho.lo*100).toFixed(1)),
      hi: results.map(r=>+(r.conv.rho.hi*100).toFixed(1)),
      color:'#ff2d50', bandColor:'rgba(255,45,80,0.10)', dashColor:'rgba(255,45,80,0.35)',
      labels,
    },
    {
      x: results.map((_,i)=>i), y: results.map(r=>+(r.intel.rho.mean*100).toFixed(1)),
      lo: results.map(r=>+(r.intel.rho.lo*100).toFixed(1)),
      hi: results.map(r=>+(r.intel.rho.hi*100).toFixed(1)),
      color:'#00df76', bandColor:'rgba(0,223,118,0.08)', dashColor:'rgba(0,223,118,0.35)',
      labels,
    },
  ], '%', v => v.toFixed(0)+'%');
}

function renderForecastTable(results, startMonth, scenario) {
  const tbody = document.getElementById('fc-table-body');
  tbody.innerHTML = '';
  const summary = summarizeForecastResults(results);

  results.forEach(r => {
    const wqC  = r.conv.wq.mean.toFixed(2);
    const wqI  = r.intel.wq.mean.toFixed(2);
    const wqPct = r.conv.wq.mean > 0
      ? Math.round((1 - r.intel.wq.mean / r.conv.wq.mean) * 100) : 0;
    const qC  = Math.round(r.conv.maxQ.mean);
    const qI  = Math.round(r.intel.maxQ.mean);
    const tpC = Math.round(r.conv.tp.mean);
    const tpI = Math.round(r.intel.tp.mean);
    const tpPct = tpC > 0 ? Math.round((tpI - tpC) / tpC * 100) : 0;

    const wqCol = wqPct >= 0 ? 'var(--G)' : 'var(--R)';
    const tpCol = tpPct >= 0 ? 'var(--G)' : 'var(--R)';

    const row = document.createElement('div');
    row.className = 'fc-tbl-row';
    row.innerHTML = `
      <span>${MONTH_NAMES[r.mIdx]}</span>
      <span class="cv">${wqC}m</span>
      <span class="iv">${wqI}m</span>
      <span class="dv" style="color:${wqCol}">${wqPct>=0?'↓':'↑'}${Math.abs(wqPct)}%</span>
      <span class="cv">${qC}</span>
      <span class="iv">${qI}</span>
      <span class="cv">${tpC}</span>
      <span class="iv">${tpI}</span>
      <span class="dv" style="color:${tpCol}">${tpPct>=0?'↑':'↓'}${Math.abs(tpPct)}%</span>
    `;
    tbody.appendChild(row);
  });

  const avgWq = summary.avgWqDelta;
  const avgTp = summary.avgTpDelta;
  const scLabel = FC_SCENARIOS[scenario].label;

  const verdict = document.getElementById('fc-verdict-row');
  const isPositive = avgWq > 0 && avgTp > 0;
  verdict.style.background   = isPositive ? 'rgba(0,223,118,0.08)' : 'rgba(255,190,46,0.08)';
  verdict.style.border       = '1px solid ' + (isPositive ? 'rgba(0,223,118,0.3)' : 'rgba(255,190,46,0.3)');
  verdict.style.color        = isPositive ? 'var(--G)' : 'var(--Y)';
  verdict.innerHTML = isPositive
    ? `Escenario: ${scLabel} · Proyeccion 6 meses: modo INTELIGENTE reduce Wq ~${avgWq}% y mejora throughput ~${avgTp}% en promedio mensual · λ crece +${(GROWTH_RATE*100).toFixed(1)}%/mes · mejora adaptativa acumulada +${(INTEL_LEARN_RATE*100).toFixed(1)}%/mes`
    : `Escenario: ${scLabel} · Alta demanda proyectada: revisar capacidad de interseccion. Mejora Wq ~${Math.abs(avgWq)}% aun esperada con modo inteligente.`;
}
