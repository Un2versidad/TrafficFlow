<div align="center">

```
████████╗██████╗  █████╗ ███████╗███████╗██╗ ██████╗    
╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██╔════╝██║██╔════╝    
   ██║   ██████╔╝███████║█████╗  █████╗  ██║██║         
   ██║   ██╔══██╗██╔══██║██╔══╝  ██╔══╝  ██║██║         
   ██║   ██║  ██║██║  ██║██║     ██║     ██║╚██████╗    
   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝     ╚═╝ ╚═════╝    
███████╗██╗      ██████╗ ██╗    ██╗                      
██╔════╝██║     ██╔═══██╗██║    ██║                      
█████╗  ██║     ██║   ██║██║ █╗ ██║                      
██╔══╝  ██║     ██║   ██║██║███╗██║                      
██║     ███████╗╚██████╔╝╚███╔███╔╝                      
╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝                       
```

**Simulación de Eventos Discretos · Optimización del Flujo Vehicular en la Vuelta en U del Bosque**  
*Ingeniería de Sistemas · Simulación de Sistemas*

---

[![Vanilla JS](https://img.shields.io/badge/Vanilla_JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Canvas API](https://img.shields.io/badge/Canvas_API-07090d?style=flat-square&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
[![jsPDF](https://img.shields.io/badge/jsPDF-2.5.1-1eb0ff?style=flat-square)](https://github.com/parallax/jsPDF)
[![Google Fonts](https://img.shields.io/badge/Rajdhani_·_JetBrains_Mono-4285F4?style=flat-square&logo=google-fonts&logoColor=white)](https://fonts.google.com/)
[![M/G/1 Queue](https://img.shields.io/badge/Teoría_de_Colas-M%2FG%2F1-00df76?style=flat-square)]()
[![No dependencies](https://img.shields.io/badge/dependencias-0-ff2d50?style=flat-square)]()
[![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-deployed-222?style=flat-square&logo=github)](https://un2versidad.github.io/TrafficFlow/)

</div>

---

## Contexto académico

Proyecto final de la asignatura **Simulación de Sistemas** — Ingeniería de Sistemas, 2026.

El semáforo de la vuelta en U frente a la universidad afecta diariamente la movilidad del campus. Con ciclo fijo de 100s en rojo y solo 18s en verde, el sistema convencional genera colas de hasta **28 vehículos y 80–140 metros** en horas pico, provocando retrasos de **4.5 a 8 minutos por conductor** y afectando directamente actividades académicas y laborales.

Este proyecto modela ese problema con simulación de eventos discretos y propone un controlador adaptativo basado en densidad de cola, validado con las ecuaciones de **Pollaczek-Khinchine** del modelo M/G/1.

**Misión:** brindar un modelo de simulación confiable basado en datos reales que permita identificar deficiencias operativas y sea herramienta de apoyo para la toma de decisiones en gestión vial.

---

## Demo

> **[→ Abrir simulador en vivo](https://un2versidad.github.io/TrafficFlow/)**

O clonar y abrir localmente — no requiere servidor, no requiere `npm install`:

```bash
git clone https://github.com/un2versidad/TrafficFlow.git
cd TrafficFlow
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

---

## El problema en números

```
SISTEMA CONVENCIONAL (tiempos fijos)    SISTEMA INTELIGENTE (tiempos adaptativos)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Verde A:    18 s  (fijo)                Verde A:    15–45 s  (f(cola A+D))
Rojo A:    100 s  (fijo)                Rojo A:     16–49 s  (f(cola B+C))
Ciclo:     ~124 s                       Ciclo:      35–98 s
Veh/ciclo:   5–6                        Veh/ciclo:  12–15         ↑ +100%
Cola máx:  25–28 veh  ← PROBLEMA        Cola máx:  10–12 veh      ↓ −57%
Wq:          4.5 min                    Wq:          1.8 min       ↓ −60%
Throughput: ~147 veh/h                  Throughput: ~295 veh/h     ↑ +100%
ρ:          > 0.90  CRÍTICO             ρ:          < 0.70  ESTABLE
Ciclos bal:   1:5.5  (desbalanceado)    Ciclo bal:  dinámico según demanda
```

Resultados basados en 30 réplicas independientes con IC al 95%.

---

## Arquitectura técnica

### Stack

| Capa | Tecnología | Detalle |
|---|---|---|
| Render vial | `Canvas 2D API` (`#rc`) | Asfalto, carriles, semáforos, postes, estructura fija |
| Render vehículos | `Canvas 2D API` (`#vc`) | Capa separada, limpiada cada frame |
| Lógica de simulación | JS puro (`sim.js`, 2600 líneas) | Loop `requestAnimationFrame` |
| Generación de PDF | `jsPDF 2.5.1` (CDN) | 3 páginas: portada, tabla M/G/1, gráficas |
| Tipografía | Google Fonts | `Rajdhani` (UI) + `JetBrains Mono` (datos) |
| Sin build | — | Cero dependencias locales, cero `npm install` |

### Módulos internos (`sim.js`)

```
sim.js
├── GEO          — geometría vial (fracciones del canvas, escalable)
├── SIM          — estado global del simulador
├── MARKOV       — cadena de Markov discreta para Sem A
│   ├── matConv  — matriz de transición P convencional
│   ├── matIntel — matriz de transición P inteligente
│   ├── record() — registra historial de estados
│   ├── computeEmpiricalMatrix() — P empírica desde historial
│   ├── computeSteady() — distribución π empírica
│   └── predictNext() — predicción del próximo estado
├── idmAccel()   — modelo IDM de seguimiento vehicular
├── updateVehs() — máquina de estados por tipo de vehículo + mutex de intersección
├── drawVehicle()
│   ├── drawCar()   — sedán / SUV / pickup (ventanas, faros, ruedas)
│   ├── drawTruck() — camión (cabina + caja de carga)
│   └── drawMoto()  — motocicleta
├── drawRoad()   — calzada, semáforos, postes, pórticos
├── renderFrame()— overlay: heatmap de cola, luces semafóricas, modo inteligente
├── tick()       — loop principal: Poisson → semáforo → IDM → UI
├── updateUI()   — panel M/G/1, Markov, comparativas
├── drawCmpCharts() — gráficas de línea y barras comparativas
└── exportPDF()  — informe en 3 páginas con jsPDF
```

---

## Modelos matemáticos implementados

### 1. Llegadas — Proceso de Poisson

Cuatro flujos independientes generados con el método de la transformada inversa:

```js
// Tiempo hasta el próximo vehículo en el carril X
nxA = -Math.log(Math.random()) / λ_A
```

| Flujo | Dirección | Fracción de λ_A |
|---|---|---|
| A | Vuelta en U (LTR → U-turn) | 50% |
| D | Recto izquierda→derecha | 50% |
| B | Vertical (↑↓ Av. Principal) | λ_B independiente |
| C | Recto derecha→izquierda | 5% de λ_A |

### 2. Seguimiento vehicular — IDM (Intelligent Driver Model)

```
         ⎡         ⎛ v    ⎞⁴    ⎛  s*(v, Δv)  ⎞²⎤
a(t) = a ⎢1  −     ⎜ ——   ⎟  −  ⎜  ——————————   ⎟
         ⎣         ⎝ v₀   ⎠     ⎝    s(t)     ⎠ ⎦

s*(v, Δv) = s₀ + vT + v·Δv / (2√(a·b))
```

| Parámetro | Valor | Descripción |
|---|---|---|
| `a` | 2.0 px/s² | Aceleración máxima |
| `b` | 3.5 px/s² | Desaceleración de confort |
| `s0` | 10 px | Brecha mínima de cola |
| `T` | 1.8 s | Tiempo de separación deseado |
| `v0` | 55–80 px/s | Velocidad libre (aleatoria por vehículo) |

### 3. Modelo de colas M/G/1 — Pollaczek-Khinchine

```
         λ · E[Ts²]
Wq  =  ————————————
          2(1 − ρ)

Lq  =  λ · Wq

ρ   =  λ / μ_efectivo

μ_efectivo  =  μ_inst · (T_verde / T_ciclo)
```

Calculado en vivo en el panel derecho. Los IC al 95% se estiman con 30 réplicas independientes.

### 4. Cadena de Markov discreta — Sem A

Estado del semáforo modelado como cadena de Markov de tiempo discreto (dt = 1s):

**Modo convencional** (ciclo 122s: verde 18s · amarillo 4s · rojo 100s):

```
        ┌─────────────────────────────────┐
        │  → VERDE  → AMARILLO  → ROJO  → │
        │                                 │
P_conv: │  R→R: 0.990   R→Y: 0.010        │
        │  Y→Y: 0.750   Y→G: 0.250        │
        │  G→G: 0.944   G→Y: 0.056        │
        └─────────────────────────────────┘

Distribución estacionaria: π(G)=0.148  π(Y)=0.033  π(R)=0.820
```

**Modo inteligente** (ciclo ~66s: verde 30s · amarillo 4s · rojo 32s promedio):

```
P_intel: R→R: 0.969   R→Y: 0.031
         Y→Y: 0.750   Y→G: 0.250
         G→G: 0.967   G→Y: 0.033

Distribución estacionaria: π(G)≈0.455  π(R)≈0.485
```

El panel lateral muestra la matriz empírica P en tiempo real, la distribución π observada vs teórica, la métrica de convergencia (1 − TVD), y la predicción del próximo estado.

---

## Metodología del proyecto

El proyecto siguió 4 fases definidas en la presentación académica:

**FASE 1 — Levantamiento de datos de campo**
- Medición directa de ciclos semafóricos en la intersección
- Conteo vehicular por franjas horarias: **7–9 AM · 12–2 PM · 5–7 PM**
- Registro de patrones críticos: colas de hasta 80–140 m en hora pico

**FASE 2 — Diseño del modelo M/G/1**
- Sistema de colas M/G/1 con tasa λ (Poisson) y μ (General)
- Ecuaciones de Pollaczek-Khinchine para Wq, Lq
- Variables continuas (tiempo) y discretas (estados semafóricos)

**FASE 3 — Implementación**
- Arquitectura Source → Queue → Processor → Sink
- Distribución exponencial para llegadas (proceso de Poisson)
- Configuración de tiempos adaptativos según densidad de cola

**FASE 4 — Validación y análisis**
- 30 réplicas independientes con IC al 95%
- Validación cruzada con teoría M/G/1
- Análisis de sensibilidad por escenario (valle, mañana, mediodía, pico)

---

## Arquitectura del sistema propuesto

El documento académico define tres capas para la implementación real:

```
┌─────────────────────────────────────────────────────────────────┐
│  CAPA FÍSICA                                                    │
│  Sensores de presencia (inductivos / cámara)                    │
│  Unidad Edge (Raspberry Pi / IPC)                               │
│  Módulo de decisión local · Algoritmo adaptativo                │
│  Controlador de semáforo MPI · Microcontrolador                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Base de datos · API REST
┌─────────────────────▼───────────────────────────────────────────┐
│  BACKEND EN LA NUBE (Centro de Control)                         │
│  Servidor de aplicación · Motor de información y control        │
│  Base de datos: eventos, métricas, histórico                    │
│  Módulo analítico · Cálculo KPI · Optimización                  │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Configuración parametrizada
┌─────────────────────▼───────────────────────────────────────────┐
│  CAPA DE USUARIO                                                │
│  Dashboard web · Monitoreo en tiempo real                       │
│  Panel de configuración · Parámetros · Modo inteligente         │
└─────────────────────────────────────────────────────────────────┘
```

El simulador en este repositorio implementa la lógica del **motor de control adaptativo**, permitiendo validar el algoritmo antes de un despliegue físico sobre hardware real.

---

## Escenarios de demanda

| Escenario | Hora | λ_A (v/s) | λ_B (v/s) | ρ conv | ρ intel |
|---|---|---|---|---|---|
| 🌿 Valle | 9–11 AM / 3–4:30 PM | 0.04 | 0.02 | ~0.45 | ~0.22 |
| 🌅 Mañana | 7–9 AM | 0.18 | 0.06 | ~0.82 | ~0.55 |
| ☀️ Mediodía | 12–2 PM | 0.06 | 0.03 | ~0.55 | ~0.30 |
| 🔴 **Pico** | **5–7 PM** | **0.25** | **0.08** | **>0.90 ⚠** | **<0.70 ✓** |

En el escenario pico, las colas físicas medidas en campo alcanzan **80–140 metros** con demandas de **250–300 veh/h**. Es el caso de estudio central: satura el sistema convencional mientras el inteligente se mantiene estable.

---

## Tipos de vehículo

Composición basada en distribución realista de tráfico urbano panameño:

| Tipo | Probabilidad | Longitud | Anchura |
|---|---|---|---|
| Auto (`car`) | 55% | 30 px | 13 px |
| SUV (`suv`) | 23% | 34 px | 15 px |
| Pickup (`pickup`) | 12% | 34 px | 14 px |
| Camión (`truck`) | 6% | 46 px | 16 px |
| Moto (`moto`) | 4% | 18 px | 7 px |

Cada vehículo se genera con color aleatorio de paletas diferenciadas, sombra, ventanas, faros, luces traseras y ruedas renderizados con `Canvas 2D`.

---

## Semáforos

| ID | Dirección | Fase | Descripción |
|---|---|---|---|
| **Sem A** | LTR carril inferior | Horizontal | ⚠ Vuelta en U — problema central |
| **Sem B** | Vertical ↑↓ | Vertical | Av. Principal, TTB + BTT |
| **Sem C** | RTL ← | Horizontal (≡ A+D) | Recto derecha→izquierda |
| **Sem D** | LTR → | Horizontal (≡ A+C) | Recto izquierda→derecha, 2 carriles |

**Fases (mutuamente excluyentes):**
```
FASE 1:  A + C + D  → VERDE   (eje horizontal)
         B          → ROJO

FASE 2:  B          → VERDE   (eje vertical)
         A + C + D  → ROJO
```

**Verde adaptativo (modo inteligente):**
```js
T_verde_AD = clamp(15, 45, (qA + qD) × 3.0 + 12)   // segundos
T_verde_BC = clamp(12, 45, (qB + qC) × 2.5 + 10)   // segundos
```

---

## Exportación PDF

El botón **PDF** genera un informe de 3 páginas con `jsPDF 2.5.1`:

- **Página 1** — Portada, resumen ejecutivo, parámetros del escenario
- **Página 2** — Tabla M/G/1: λ, μ, ρ, Wq, Lq, throughput, ciclos, comparativa conv vs intel
- **Página 3** — Capturas de las 5 gráficas canvas + caja de metodología (fases del proyecto)

La función `safe()` sanitiza caracteres no-ASCII para compatibilidad con el encoding Latin-1 de jsPDF.

---

## Estructura de archivos

```
trafficflow/
├── index.html   — UI completa (toolbar, panel izquierdo, canvas, panel derecho, log, scorecard)
├── style.css    — sistema de diseño con CSS variables, grid 3×3, scrollbars custom
└── sim.js       — toda la lógica (~2600 líneas)
```

---

## Referencias

- **Newell, G.F.** (1982). *Applications of Queueing Theory*. Chapman and Hall.  
- **Treiber, M., Hennecke, A., & Helbing, D.** (2000). [Congested traffic states in empirical observations and microscopic simulations](https://arxiv.org/abs/cond-mat/0002177). *Physical Review E*, 62(2), 1805.  
- **Kleinrock, L.** (1975). *Queueing Systems, Vol. 1: Theory*. Wiley.  
- **Highway Capacity Manual** (2022). Transportation Research Board, 7th ed.  
- **jsPDF** — [https://github.com/parallax/jsPDF](https://github.com/parallax/jsPDF)  
- **Google Fonts: Rajdhani** — [https://fonts.google.com/specimen/Rajdhani](https://fonts.google.com/specimen/Rajdhani)  
- **Google Fonts: JetBrains Mono** — [https://fonts.google.com/specimen/JetBrains+Mono](https://fonts.google.com/specimen/JetBrains+Mono)  
- **MDN Canvas API** — [https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)

---

## APIs y recursos externos

| Recurso | URL | Uso |
|---|---|---|
| jsPDF 2.5.1 | `cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js` | Generación de PDF |
| Google Fonts | `fonts.googleapis.com` | Rajdhani + JetBrains Mono |
| Canvas 2D API | Nativo del browser | Todo el render gráfico |
| Web Animations | `requestAnimationFrame` nativo | Loop de simulación |

Sin telemetría. Sin cookies. Sin backend. Todo corre en el navegador del usuario.
