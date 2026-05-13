(function () {
  'use strict';
  if (typeof THREE === 'undefined') { console.warn('THREE not loaded'); return; }

  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd6dde6, 50, 120);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
  camera.position.set(0, 0, 70);

  // --- Device tier (low-end Android => softer budget) ---
  const lowEnd = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
              || (navigator.deviceMemory && navigator.deviceMemory <= 3);

  // --- Adaptive node count from area & device tier ---
  // На узких экранах площадь маленькая → тут раньше на iPhone выходило
  // всего ~40 точек и граф был почти пустой. Снижаем denom и поднимаем cap.
  function nodeCount() {
    const w = window.innerWidth, h = window.innerHeight;
    const area = w * h;
    const isMobile = w < 720;
    const denom = isMobile ? (lowEnd ? 14000 : 8000) : 11000;
    const cap   = isMobile ? (lowEnd ? 90  : 170)  : 230;
    let n = Math.round(area / denom);
    n = Math.max(60, Math.min(cap, n));
    return n;
  }

  let N = nodeCount();
  const SPHERE_R = 32;
  const MAX_DIST = 11;          // edges considered up to this 3D distance
  const FADE_START = 7.5;       // edges fully opaque below this
  const COLOR = new THREE.Color(0x1a5f7a);

  // Buffers (re-allocated on resize/density change)
  let nodePos, nodePhase, nodeColor, edgePos, edgeAlpha, edgeColor;
  let nodeGeom, nodeMesh, edgeGeom, edgeMesh;
  let MAX_EDGES;

  function rebuildScene() {
    // dispose previous
    if (nodeMesh) { scene.remove(nodeMesh); nodeMesh.geometry.dispose(); nodeMesh.material.dispose(); }
    if (edgeMesh) { scene.remove(edgeMesh); edgeMesh.geometry.dispose(); edgeMesh.material.dispose(); }

    N = nodeCount();
    MAX_EDGES = N * 6; // soft cap on segments per frame

    nodePos = new Float32Array(N * 3);
    nodePhase = new Float32Array(N * 4);
    nodeColor = new Float32Array(N * 3); // per-node teal w/ small hue jitter
    const nodeSize = new Float32Array(N);

    // HSL→RGB inline (h,s,l in [0,1])
    const hsl2rgb = (h, s, l, out, idx) => {
      const a = s * Math.min(l, 1 - l);
      const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))); };
      out[idx] = f(0); out[idx+1] = f(8); out[idx+2] = f(4);
    };

    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = SPHERE_R * (0.55 + 0.45 * Math.cbrt(Math.random()));
      nodePos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      nodePos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      nodePos[i * 3 + 2] = r * Math.cos(phi);
      nodePhase[i * 4]     = 0.6 + Math.random() * 0.6;
      nodePhase[i * 4 + 1] = Math.random() * Math.PI * 2;
      nodePhase[i * 4 + 2] = Math.random() * Math.PI * 2;
      nodePhase[i * 4 + 3] = Math.random() * Math.PI * 2;
      // На мобильном dpr=1.5 (capped), gl_PointSize в физ. пикселях →
      // в CSS-пикселях точки получаются мельче, чем на десктопе.
      // Компенсируем умножителем на узких экранах.
      const sizeBoost = window.innerWidth < 720 ? 1.6 : 1.0;
      nodeSize[i] = (0.85 + Math.random() * 0.85) * sizeBoost;
      // hue 195±10° around teal
      const h = (195 + (Math.random() - 0.5) * 20) / 360;
      const s = 0.55 + Math.random() * 0.18;
      const l = 0.30 + Math.random() * 0.10;
      hsl2rgb(h, s, l, nodeColor, i * 3);
    }

    // ---- Nodes (Points) ----
    nodeGeom = new THREE.BufferGeometry();
    nodeGeom.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
    nodeGeom.setAttribute('aSize', new THREE.BufferAttribute(nodeSize, 1));
    nodeGeom.setAttribute('aColor', new THREE.BufferAttribute(nodeColor, 3));

    const nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uPxRatio: { value: Math.min(window.devicePixelRatio || 1, window.innerWidth < 720 ? 1.5 : 2) },
        uFogNear: { value: 50 },
        uFogFar: { value: 120 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: `
        attribute float aSize;
        attribute vec3 aColor;
        uniform float uPxRatio;
        varying float vDepthFade;
        varying vec3 vColor;
        uniform float uFogNear;
        uniform float uFogFar;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float dist = -mv.z;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPxRatio * (180.0 / dist);
          vDepthFade = clamp((uFogFar - dist) / (uFogFar - uFogNear), 0.0, 1.0);
          vDepthFade = mix(0.20, 1.0, vDepthFade);
          vColor = aColor;
        }
      `,
      fragmentShader: `
        varying float vDepthFade;
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          // single soft radial — no hard edge
          float a = smoothstep(0.5, 0.0, d) * 0.7 * vDepthFade;
          gl_FragColor = vec4(vColor, a);
        }
      `
    });
    nodeMesh = new THREE.Points(nodeGeom, nodeMat);
    scene.add(nodeMesh);

    // ---- Edges (LineSegments with per-vertex alpha + color) ----
    edgePos = new Float32Array(MAX_EDGES * 2 * 3);
    edgeAlpha = new Float32Array(MAX_EDGES * 2);
    edgeColor = new Float32Array(MAX_EDGES * 2 * 3);

    edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute('position', new THREE.BufferAttribute(edgePos, 3).setUsage(THREE.DynamicDrawUsage));
    edgeGeom.setAttribute('aAlpha', new THREE.BufferAttribute(edgeAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    edgeGeom.setAttribute('aColor', new THREE.BufferAttribute(edgeColor, 3).setUsage(THREE.DynamicDrawUsage));
    edgeGeom.setDrawRange(0, 0);

    const edgeMat = new THREE.ShaderMaterial({
      uniforms: { uFogNear: { value: 50 }, uFogFar: { value: 120 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: `
        attribute float aAlpha;
        attribute vec3 aColor;
        varying float vAlpha;
        varying float vDepthFade;
        varying vec3 vColor;
        uniform float uFogNear;
        uniform float uFogFar;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float dist = -mv.z;
          gl_Position = projectionMatrix * mv;
          vAlpha = aAlpha;
          vColor = aColor;
          vDepthFade = clamp((uFogFar - dist) / (uFogFar - uFogNear), 0.0, 1.0);
          vDepthFade = mix(0.18, 1.0, vDepthFade);
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying float vDepthFade;
        varying vec3 vColor;
        void main() {
          gl_FragColor = vec4(vColor, vAlpha * vDepthFade * 0.42);
        }
      `
    });
    edgeMesh = new THREE.LineSegments(edgeGeom, edgeMat);
    scene.add(edgeMesh);
  }

  rebuildScene();

  // --- Resize ---
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 720 ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    // На портрете (узкий экран) виден только тонкий центральный срез
    // сферы — поэтому подводим камеру ближе, чтобы граф «заполнял» экран
    // примерно так же, как на широком десктопе.
    if (camera.aspect < 1) {
      // 0.5 → z=46, 0.7 → z=58, 1.0 → z=70
      camera.position.z = 30 + 40 * camera.aspect;
    } else {
      camera.position.z = 70;
    }

    camera.updateProjectionMatrix();
    if (nodeMesh) nodeMesh.material.uniforms.uPxRatio.value = dpr;
  }
  resize();

  let resizeTimer;
  function debouncedResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      // rebuild density only on big size changes
      const newN = nodeCount();
      if (Math.abs(newN - N) > N * 0.25) rebuildScene();
    }, 200);
  }
  window.addEventListener('resize', debouncedResize);
  window.addEventListener('orientationchange', debouncedResize);

  // --- Mouse parallax + scroll ---
  const mouse = { tx: 0, ty: 0, x: 0, y: 0 };
  let scrollY = 0, scrollTarget = 0;

  const isFinePtr = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (isFinePtr) {
    window.addEventListener('mousemove', (e) => {
      mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
  }
  window.addEventListener('scroll', () => {
    scrollTarget = window.scrollY || window.pageYOffset || 0;
  }, { passive: true });

  // --- Visibility pause ---
  // Защита от double-rAF: раньше при быстром скрытии/показе вкладки
  // запускалось несколько loop'ов параллельно.
  let visible = !document.hidden;
  let rafId = 0;
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible && !reduced) {
      last = performance.now();
      if (!rafId) rafId = requestAnimationFrame(loop);
    }
  });

  // --- Animation loop ---
  let last = performance.now();
  // Случайное начальное время — иначе на любом браузере при первой
  // загрузке граф запускается из одного и того же кадра анимации.
  let t = Math.random() * 1000;

  // Time-based sin/cos раньше пересчитывались внутри flow() для каждой
  // частицы (~6N трига/кадр). Теперь хоистим сюда — обновляются раз в кадр.
  let _tw = 0, _ts21 = 0, _ts17 = 0, _ts19 = 0, _ts23 = 0, _ts18 = 0, _ts22 = 0;

  function refreshTimeTerms(time) {
    _tw   = Math.sin(time * 0.11) * 0.6 + Math.cos(time * 0.07) * 0.5;
    _ts21 = time * 0.21 + _tw;
    _ts17 = time * 0.17 - _tw * 0.7;
    _ts19 = time * 0.19 - _tw * 0.5;
    _ts23 = time * 0.23 + _tw;
    _ts18 = time * 0.18 + _tw * 0.8;
    _ts22 = time * 0.22 - _tw;
  }

  // 4D-feeling curl flow: два trig-поля, time-кросс-модулированные.
  function flow(x, y, z, out) {
    const s = 0.045;
    out[0] = Math.sin(y * s + _ts21)        - Math.sin(z * s * 1.07 + _ts17);
    out[1] = Math.sin(z * s + _ts19)        - Math.sin(x * s * 0.93 + _ts23);
    out[2] = Math.sin(x * s + _ts18)        - Math.sin(y * s * 1.11 + _ts22);
  }

  const tmp = [0, 0, 0];

  function step(dt) {
    t += dt;
    refreshTimeTerms(t); // один раз на кадр вместо N раз

    // Move nodes via curl-flow + mild spring back to shell
    const npos = nodePos;
    const nph = nodePhase;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      let px = npos[i3], py = npos[i3 + 1], pz = npos[i3 + 2];

      flow(px, py, pz, tmp);
      const speed = 0.32 + nph[i * 4] * 0.22; // ~8–15 px/s on screen
      px += tmp[0] * dt * speed;
      py += tmp[1] * dt * speed;
      pz += tmp[2] * dt * speed;

      // gentle spring back to sphere shell (no wrap-teleport)
      const r = Math.sqrt(px * px + py * py + pz * pz) || 1;
      const target = SPHERE_R * 0.9;
      const k = 0.18; // stiffness
      const dr = (target - r);
      const f = k * dt * dr / r;
      px += px * f;
      py += py * f;
      pz += pz * f;

      npos[i3] = px;
      npos[i3 + 1] = py;
      npos[i3 + 2] = pz;
    }
    nodeGeom.attributes.position.needsUpdate = true;

    // Rebuild edges via k-NN — clean graph structure, not a web
    // Mobile: refresh every other frame to halve CPU cost (edges still follow nodes visually).
    step._fc = ((step._fc | 0) + 1) | 0;
    const _isMob = window.innerWidth < 720;
    const rebuildEdges = !_isMob || (step._fc & 1) === 0;
    if (rebuildEdges) {
    let ei = 0;
    const K = 3;
    const maxD = MAX_DIST;
    const maxD2 = maxD * maxD;
    if (!step._knnDist || step._knnDist.length < N) { step._knnDist = new Float32Array(N); step._knnIdx = new Int32Array(N); }
    const knnDist = step._knnDist, knnIdx = step._knnIdx;
    // Раньше new Set() аллоцировался каждый кадр (GC-давление).
    // Хоистим — чистим и переиспользуем.
    if (!step._seen) step._seen = new Set();
    const seen = step._seen; seen.clear();
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      const ax = npos[i3], ay = npos[i3 + 1], az = npos[i3 + 2];
      let cnt = 0;
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        const j3 = j * 3;
        const dx = npos[j3] - ax, dy = npos[j3 + 1] - ay, dz = npos[j3 + 2] - az;
        const d2 = dx*dx + dy*dy + dz*dz;
        if (d2 < maxD2) { knnDist[cnt] = d2; knnIdx[cnt] = j; cnt++; }
      }
      // partial insertion sort to extract K smallest
      for (let a = 1; a < cnt; a++) {
        const kd = knnDist[a], ki = knnIdx[a];
        let b = a - 1;
        while (b >= 0 && knnDist[b] > kd) { knnDist[b+1] = knnDist[b]; knnIdx[b+1] = knnIdx[b]; b--; }
        knnDist[b+1] = kd; knnIdx[b+1] = ki;
      }
      const take = Math.min(K, cnt);
      for (let k = 0; k < take; k++) {
        const j = knnIdx[k];
        const lo = i < j ? i : j;
        const hi = i < j ? j : i;
        const key = lo * 65536 + hi;
        if (seen.has(key)) continue;
        seen.add(key);
        if (ei >= MAX_EDGES) break;
        const d = Math.sqrt(knnDist[k]);
        const tt = d / maxD;
        const a = 1 - tt * tt; // quadratic falloff — smooth, no flicker
        const j3 = j * 3;
        const o = ei * 6;
        edgePos[o]     = ax; edgePos[o+1] = ay; edgePos[o+2] = az;
        edgePos[o+3]   = npos[j3]; edgePos[o+4] = npos[j3+1]; edgePos[o+5] = npos[j3+2];
        edgeAlpha[ei*2]     = a;
        edgeAlpha[ei*2 + 1] = a;
        edgeColor[o]   = nodeColor[i3];   edgeColor[o+1] = nodeColor[i3+1]; edgeColor[o+2] = nodeColor[i3+2];
        edgeColor[o+3] = nodeColor[j3];   edgeColor[o+4] = nodeColor[j3+1]; edgeColor[o+5] = nodeColor[j3+2];
        ei++;
      }
    }
    edgeGeom.setDrawRange(0, ei * 2);
    edgeGeom.attributes.position.needsUpdate = true;
    edgeGeom.attributes.aAlpha.needsUpdate = true;
    edgeGeom.attributes.aColor.needsUpdate = true;
    }

    // Camera parallax + scroll-driven slow rotation around y
    mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 2.5);
    mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 2.5);
    scrollY += (scrollTarget - scrollY) * Math.min(1, dt * 4);

    // slow auto-orbit + parallax + scroll-driven Z fly-through
    const yaw = mouse.x * 0.14 + t * 0.018;
    const pitch = -mouse.y * 0.08;
    const camR = 70;
    const flyZ = Math.min(scrollY / 600, 2.2) * 16;
    camera.position.x = Math.sin(yaw) * camR;
    camera.position.y = Math.sin(pitch) * camR * 0.4;
    camera.position.z = Math.cos(yaw) * camR - flyZ;
    camera.lookAt(0, 0, 0);
  }

  // FPS-cap пересчитывается живьём: после поворота планшета/окна
  // тип устройства меняется. + acc -= вместо =0 (раньше при FPS-cap
  // терялся хвост dt → подёргивания).
  function frameMin() { return (window.innerWidth < 720) ? (1 / 36) : 0; }
  let acc = 0;
  function loop(now) {
    rafId = 0;
    if (!visible) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    acc += dt;
    const fm = frameMin();
    if (acc >= fm) {
      step(acc);
      renderer.render(scene, camera);
      acc = fm > 0 ? acc - fm : 0;
    }
    if (!reduced) rafId = requestAnimationFrame(loop);
  }

  // First render (always); animate unless reduced-motion
  renderer.render(scene, camera);
  if (reduced) {
    // do one extra step for a settled look, then stop
    step(0.016); renderer.render(scene, camera);
  } else {
    rafId = requestAnimationFrame(loop);
  }

  // WebGL context loss recovery
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); }, false);
})();
