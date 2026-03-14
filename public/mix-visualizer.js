(function () {
  const TAU = Math.PI * 2;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Shader compile error";
      gl.deleteShader(shader);
      throw new Error(message);
    }

    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Program link error";
      gl.deleteProgram(program);
      throw new Error(message);
    }

    return program;
  }

  function normalize(vector) {
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
    return [vector[0] / length, vector[1] / length, vector[2] / length];
  }

  function subtract(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function perspectiveMatrix(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const rangeInverse = 1 / (near - far);

    return new Float32Array([
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      (near + far) * rangeInverse,
      -1,
      0,
      0,
      near * far * rangeInverse * 2,
      0,
    ]);
  }

  function lookAtMatrix(eye, target, up) {
    const zAxis = normalize(subtract(eye, target));
    const xAxis = normalize(cross(up, zAxis));
    const yAxis = cross(zAxis, xAxis);

    return new Float32Array([
      xAxis[0],
      yAxis[0],
      zAxis[0],
      0,
      xAxis[1],
      yAxis[1],
      zAxis[1],
      0,
      xAxis[2],
      yAxis[2],
      zAxis[2],
      0,
      -dot(xAxis, eye),
      -dot(yAxis, eye),
      -dot(zAxis, eye),
      1,
    ]);
  }

  function multiplyMatrix4(a, b) {
    const out = new Float32Array(16);

    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] =
          a[0 * 4 + row] * b[column * 4 + 0] +
          a[1 * 4 + row] * b[column * 4 + 1] +
          a[2 * 4 + row] * b[column * 4 + 2] +
          a[3 * 4 + row] * b[column * 4 + 3];
      }
    }

    return out;
  }

  function addVertex(positions, colors, point, color) {
    positions.push(point[0], point[1], point[2]);
    colors.push(color[0], color[1], color[2], color[3]);
  }

  function addLine(positions, colors, a, b, color) {
    addVertex(positions, colors, a, color);
    addVertex(positions, colors, b, color);
  }

  function addQuad(positions, colors, a, b, c, d, color) {
    addVertex(positions, colors, a, color);
    addVertex(positions, colors, b, color);
    addVertex(positions, colors, c, color);
    addVertex(positions, colors, a, color);
    addVertex(positions, colors, c, color);
    addVertex(positions, colors, d, color);
  }

  function addBoxWire(positions, colors, center, size, color) {
    const [cx, cy, cz] = center;
    const [sx, sy, sz] = size;
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy;
    const y1 = cy + sy;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;

    const corners = {
      a: [x0, y0, z0],
      b: [x1, y0, z0],
      c: [x1, y0, z1],
      d: [x0, y0, z1],
      e: [x0, y1, z0],
      f: [x1, y1, z0],
      g: [x1, y1, z1],
      h: [x0, y1, z1],
    };

    const edges = [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["d", "a"],
      ["e", "f"],
      ["f", "g"],
      ["g", "h"],
      ["h", "e"],
      ["a", "e"],
      ["b", "f"],
      ["c", "g"],
      ["d", "h"],
    ];

    for (const [from, to] of edges) {
      addLine(positions, colors, corners[from], corners[to], color);
    }
  }

  function addRing(positions, colors, center, radius, y, segments, color) {
    const [cx, , cz] = center;
    let previous = null;

    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * TAU;
      const point = [cx + Math.cos(angle) * radius, y, cz + Math.sin(angle) * radius];
      if (previous) {
        addLine(positions, colors, previous, point, color);
      }
      previous = point;
    }
  }

  function addPolyline(positions, colors, points, color) {
    for (let index = 1; index < points.length; index += 1) {
      addLine(positions, colors, points[index - 1], points[index], color);
    }
  }

  function projectPoint(matrix, point, width, height) {
    const x = point[0];
    const y = point[1];
    const z = point[2];
    const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];

    if (clipW <= 0.001) {
      return null;
    }

    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;

    return {
      x: ((ndcX * 0.5 + 0.5) * width),
      y: ((1 - (ndcY * 0.5 + 0.5)) * height),
    };
  }

  function rgba(color) {
    return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`;
  }

  class MixVisualizerRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas
        ? canvas.getContext("webgl2", {
            alpha: false,
            antialias: true,
            depth: true,
            powerPreference: "high-performance",
          }) ||
          canvas.getContext("webgl", {
            alpha: false,
            antialias: true,
            depth: true,
            powerPreference: "high-performance",
          }) ||
          canvas.getContext("experimental-webgl", {
            alpha: false,
            antialias: true,
            depth: true,
            powerPreference: "high-performance",
          })
        : null;
      this.ctx2d = !this.gl && canvas ? canvas.getContext("2d") : null;
      this.active = false;
      this.payload = null;
      this.snapshotTime = performance.now();
      this.linePositions = [];
      this.lineColors = [];
      this.trianglePositions = [];
      this.triangleColors = [];
      this.boundFrame = this.frame.bind(this);

      if (!this.gl && !this.ctx2d) {
        return;
      }

      if (this.gl) {
        this.program = createProgram(
          this.gl,
          `
            attribute vec3 aPosition;
            attribute vec4 aColor;
            uniform mat4 uMatrix;
            varying vec4 vColor;

            void main() {
              gl_Position = uMatrix * vec4(aPosition, 1.0);
              vColor = aColor;
            }
          `,
          `
            precision mediump float;
            varying vec4 vColor;

            void main() {
              gl_FragColor = vColor;
            }
          `,
        );

        this.positionLocation = this.gl.getAttribLocation(this.program, "aPosition");
        this.colorLocation = this.gl.getAttribLocation(this.program, "aColor");
        this.matrixLocation = this.gl.getUniformLocation(this.program, "uMatrix");
        this.positionBuffer = this.gl.createBuffer();
        this.colorBuffer = this.gl.createBuffer();
      }

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.canvas);
      } else {
        window.addEventListener("resize", () => this.resize());
      }

      this.resize();
      window.requestAnimationFrame(this.boundFrame);
    }

    setActive(active) {
      this.active = active;
      if (active) {
        this.resize();
      }
    }

    updatePayload(payload) {
      this.payload = payload;
      this.snapshotTime = performance.now();
    }

    resize() {
      if (!this.canvas) {
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));

      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }

      if (this.gl) {
        this.gl.viewport(0, 0, width, height);
      }
    }

    frame(time) {
      window.requestAnimationFrame(this.boundFrame);

      if ((!this.gl && !this.ctx2d) || !this.active) {
        return;
      }

      this.render(time * 0.001);
    }

    getDeckState() {
      const payload = this.payload || {};
      const selection = payload.selection?.evaluation || {};
      const candidates = selection.candidates || [];
      const maxScore = Math.max(1, ...candidates.map((candidate) => candidate.score || 0));
      const candidateByLayer = new Map(candidates.map((candidate) => [candidate.layer, candidate]));
      const now = performance.now();
      const deltaMs = now - this.snapshotTime;
      const fallbackLayers = Array.from({ length: 4 }, (_, index) => ({
        layer: index + 1,
        trackId: 0,
        bpm: 0,
        currentPosition: 0,
        isTransportAdvancing: false,
        state: "IDLE",
      }));
      const layers = (payload.layers && payload.layers.length ? payload.layers : fallbackLayers).slice(0, 4);

      return layers.map((layer, index) => {
        const candidate = candidateByLayer.get(layer.layer);
        const selected = selection.selectedLayer === layer.layer || payload.currentTrack?.layer === layer.layer;
        const loaded = Number.isFinite(layer.trackId) && layer.trackId > 0;
        const bpm = Number.isFinite(layer.bpm) && layer.bpm > 0 ? layer.bpm / 100 : 0;
        const moving = Boolean(layer.isTransportAdvancing);
        const livePosition = Number.isFinite(layer.currentPosition)
          ? layer.currentPosition + (moving ? deltaMs : 0)
          : 0;
        const beatPhase = bpm > 0 ? (((livePosition / 60000) * bpm) % 1 + 1) % 1 : 0;
        const bpmNormalized = clamp((bpm - 92) / 52, 0, 1);
        let level = Number.isFinite(layer.mixerLevel)
          ? clamp(layer.mixerLevel, 0.03, 1)
          : candidate
            ? clamp((candidate.score || 0) / maxScore, 0.03, 1)
            : 0.03;

        if (!candidate && loaded) {
          level = moving ? 0.18 : 0.08;
        }

        if (selected) {
          level = Math.max(level, 0.3);
        }

        return {
          layer: layer.layer || index + 1,
          selected,
          loaded,
          moving,
          bpm,
          bpmNormalized,
          beatPhase,
          level,
        };
      });
    }

    buildScene(time) {
      const decks = this.getDeckState();
      const movingDecks = decks.filter((deck) => deck.moving && deck.bpm > 0);
      const tempo = movingDecks.length
        ? movingDecks.reduce((sum, deck) => sum + deck.bpm, 0) / movingDecks.length
        : 120;
      const gridShift = ((time * tempo) / 120) % 1;
      const xPositions = [-3.2, -1.05, 1.05, 3.2];
      const averageLevel = decks.reduce((sum, deck) => sum + deck.level, 0) / Math.max(1, decks.length);
      const selectedDeck = decks.find((deck) => deck.selected) || decks.reduce((best, deck) => (deck.level > best.level ? deck : best), decks[0]);

      this.linePositions.length = 0;
      this.lineColors.length = 0;
      this.trianglePositions.length = 0;
      this.triangleColors.length = 0;

      for (let column = -6; column <= 6; column += 1) {
        const x = column * 1.25;
        addLine(
          this.linePositions,
          this.lineColors,
          [x, 0, -7],
          [x, 0, 10],
          [0.17, 0.17, 0.17, 0.28],
        );
      }

      for (let row = 0; row < 18; row += 1) {
        const z = -7 + row + gridShift;
        addLine(
          this.linePositions,
          this.lineColors,
          [-8.5, 0, z],
          [8.5, 0, z],
          [0.16, 0.16, 0.16, 0.24],
        );
      }

      addQuad(
        this.trianglePositions,
        this.triangleColors,
        [-8.5, -0.02, -7],
        [8.5, -0.02, -7],
        [8.5, -0.02, 10],
        [-8.5, -0.02, 10],
        [0.02, 0.02, 0.02, 0.95],
      );

      decks.forEach((deck, index) => {
        const x = xPositions[index];
        const laneStart = 0.72;
        const laneEnd = 7.9;
        const halfWidth = 0.14 + deck.level * 0.24 + (deck.selected ? 0.05 : 0);
        const tailWidth = halfWidth * 1.45;
        const lineAlpha = deck.loaded ? 0.12 + deck.level * 0.22 : 0.05;
        const fillAlpha = deck.loaded ? 0.035 + deck.level * 0.075 : 0.012;
        const lineColor = [0.78, 0.78, 0.78, lineAlpha];

        addQuad(
          this.trianglePositions,
          this.triangleColors,
          [x - halfWidth, 0.006, laneStart],
          [x + halfWidth, 0.006, laneStart],
          [x + tailWidth, 0.006, laneEnd],
          [x - tailWidth, 0.006, laneEnd],
          [0.08, 0.08, 0.08, fillAlpha],
        );

        addLine(
          this.linePositions,
          this.lineColors,
          [x - halfWidth, 0.012, laneStart],
          [x - tailWidth, 0.012, laneEnd],
          lineColor,
        );
        addLine(
          this.linePositions,
          this.lineColors,
          [x + halfWidth, 0.012, laneStart],
          [x + tailWidth, 0.012, laneEnd],
          lineColor,
        );

        const pulseCount = 7;
        for (let pulseIndex = 0; pulseIndex < pulseCount; pulseIndex += 1) {
          const progress = ((pulseIndex / pulseCount) + deck.beatPhase) % 1;
          const z = laneStart + progress * (laneEnd - laneStart);
          const width = halfWidth + (tailWidth - halfWidth) * progress;
          const pulseStrength = deck.moving ? Math.pow(1 - progress, 1.3) : 0.18;
          const pulseAlpha = 0.05 + pulseStrength * (deck.selected ? 0.34 : 0.18);

          addLine(
            this.linePositions,
            this.lineColors,
            [x - width, 0.018, z],
            [x + width, 0.018, z],
            [0.92, 0.92, 0.92, pulseAlpha],
          );
        }
      });

      for (let band = 0; band < 3; band += 1) {
        const points = [];
        const zBase = 4.4 + band * 1.05;
        const amplitude = 0.18 - band * 0.04;

        for (let sample = 0; sample <= 56; sample += 1) {
          const t = sample / 56;
          const x = -6 + t * 12;
          let composite = 0;

          for (const deck of decks) {
            const freq = 1.1 + deck.layer * 0.42 + band * 0.25;
            composite += Math.sin(t * TAU * freq + deck.beatPhase * TAU + deck.layer * 0.7) * deck.level;
          }

          composite /= Math.max(1, decks.length);
          const selectedBias = selectedDeck ? Math.cos(t * TAU * (1.4 + selectedDeck.layer * 0.08) + selectedDeck.beatPhase * TAU) * selectedDeck.level * 0.18 : 0;
          const y = 0.05 + Math.abs(composite + selectedBias) * amplitude + averageLevel * 0.02;
          const z = zBase + Math.sin(t * TAU * 0.5 + time * 0.7 + band * 0.8) * 0.08;
          points.push([x, y, z]);
        }

        addPolyline(
          this.linePositions,
          this.lineColors,
          points,
          [0.9, 0.9, 0.9, 0.22 + averageLevel * 0.22 - band * 0.03],
        );
      }

      const busZ = 6.95;
      const busWidth = 5.7;
      addLine(
        this.linePositions,
        this.lineColors,
        [-busWidth, 0.03, busZ],
        [busWidth, 0.03, busZ],
        [0.9, 0.9, 0.9, 0.24 + averageLevel * 0.2],
      );

      const frameNearZ = 4.75;
      const frameFarZ = 8.85;
      const nearHalfWidth = 3.4;
      const farHalfWidth = 6.1;

      addQuad(
        this.trianglePositions,
        this.triangleColors,
        [-nearHalfWidth, 0.004, frameNearZ],
        [nearHalfWidth, 0.004, frameNearZ],
        [farHalfWidth, 0.004, frameFarZ],
        [-farHalfWidth, 0.004, frameFarZ],
        [0.06, 0.06, 0.06, 0.045 + averageLevel * 0.05],
      );
      addLine(
        this.linePositions,
        this.lineColors,
        [-nearHalfWidth, 0.01, frameNearZ],
        [nearHalfWidth, 0.01, frameNearZ],
        [0.82, 0.82, 0.82, 0.16],
      );
      addLine(
        this.linePositions,
        this.lineColors,
        [-farHalfWidth, 0.01, frameFarZ],
        [farHalfWidth, 0.01, frameFarZ],
        [0.82, 0.82, 0.82, 0.16],
      );
      addLine(
        this.linePositions,
        this.lineColors,
        [-nearHalfWidth, 0.01, frameNearZ],
        [-farHalfWidth, 0.01, frameFarZ],
        [0.82, 0.82, 0.82, 0.14],
      );
      addLine(
        this.linePositions,
        this.lineColors,
        [nearHalfWidth, 0.01, frameNearZ],
        [farHalfWidth, 0.01, frameFarZ],
        [0.82, 0.82, 0.82, 0.14],
      );

      for (let gridIndex = 1; gridIndex <= 4; gridIndex += 1) {
        const t = gridIndex / 5;
        const z = frameNearZ + (frameFarZ - frameNearZ) * t;
        const width = nearHalfWidth + (farHalfWidth - nearHalfWidth) * t;
        addLine(
          this.linePositions,
          this.lineColors,
          [-width, 0.01, z],
          [width, 0.01, z],
          [0.72, 0.72, 0.72, 0.08],
        );
      }

      for (let gridIndex = -2; gridIndex <= 2; gridIndex += 1) {
        const t = (gridIndex + 2) / 4;
        const xNear = -nearHalfWidth + nearHalfWidth * 2 * t;
        const xFar = -farHalfWidth + farHalfWidth * 2 * t;
        addLine(
          this.linePositions,
          this.lineColors,
          [xNear, 0.01, frameNearZ],
          [xFar, 0.01, frameFarZ],
          [0.72, 0.72, 0.72, 0.08],
        );
      }

      decks.forEach((deck, index) => {
        const x = xPositions[index];
        const nodeSize = 0.06 + deck.level * 0.08;
        const targetY = 0.03 + deck.level * 0.06;
        const targetX = clamp(x * 0.72, -busWidth + 0.3, busWidth - 0.3);

        addLine(
          this.linePositions,
          this.lineColors,
          [x, 0.02, 5.9],
          [targetX, targetY, busZ],
          [0.84, 0.84, 0.84, 0.08 + deck.level * 0.14],
        );
        addBoxWire(
          this.linePositions,
          this.lineColors,
          [targetX, 0.01, busZ],
          [nodeSize, 0.02, nodeSize],
          [0.9, 0.9, 0.9, 0.14 + deck.level * 0.18],
        );
      });

      decks.forEach((deck, index) => {
        const x = xPositions[index];
        const z = 0;
        const pulse = deck.moving ? Math.pow(1 - deck.beatPhase, 3) : 0.08;
        const towerHeight = 0.3 + deck.level * 3.55;
        const towerWidth = 0.9 + deck.bpmNormalized * 0.12;
        const towerDepth = 0.9 + deck.bpmNormalized * 0.4;
        const lineBrightness = deck.selected ? 0.98 : deck.loaded ? 0.72 : 0.28;
        const alpha = deck.selected ? 0.95 : deck.loaded ? 0.48 : 0.18;
        const color = [lineBrightness, lineBrightness, lineBrightness, alpha];

        addQuad(
          this.trianglePositions,
          this.triangleColors,
          [x - 0.8, 0.01, z - 0.8],
          [x + 0.8, 0.01, z - 0.8],
          [x + 0.8, 0.01, z + 0.8],
          [x - 0.8, 0.01, z + 0.8],
          [0.05 + lineBrightness * 0.05, 0.05 + lineBrightness * 0.05, 0.05 + lineBrightness * 0.05, 0.08 + deck.level * 0.15],
        );

        addBoxWire(
          this.linePositions,
          this.lineColors,
          [x, 0, z],
          [towerWidth, towerHeight, towerDepth],
          color,
        );

        addRing(
          this.linePositions,
          this.lineColors,
          [x, 0, z],
          0.6 + pulse * 0.65 + deck.bpmNormalized * 0.2,
          0.05,
          28,
          [lineBrightness, lineBrightness, lineBrightness, 0.22 + pulse * 0.35],
        );

        addRing(
          this.linePositions,
          this.lineColors,
          [x, 0, z],
          0.28 + pulse * 0.22,
          towerHeight + 0.04,
          18,
          [lineBrightness, lineBrightness, lineBrightness, 0.24 + pulse * 0.28],
        );

        const orbitAngle = deck.beatPhase * TAU;
        const orbitRadius = 0.52 + deck.bpmNormalized * 0.18;
        const markerY = 0.35 + towerHeight * 0.6 + pulse * 0.8;
        const marker = [
          x + Math.cos(orbitAngle) * orbitRadius,
          markerY,
          z + Math.sin(orbitAngle) * orbitRadius,
        ];

        addBoxWire(
          this.linePositions,
          this.lineColors,
          marker,
          [0.14, 0.14 + pulse * 0.18, 0.14],
          [lineBrightness, lineBrightness, lineBrightness, 0.6],
        );

        addLine(
          this.linePositions,
          this.lineColors,
          [x, 0.04, z],
          [x, towerHeight + 0.55 + pulse * 0.5, z],
          [lineBrightness, lineBrightness, lineBrightness, 0.14 + deck.level * 0.38],
        );

        if (deck.selected) {
          addQuad(
            this.trianglePositions,
            this.triangleColors,
            [x - 0.22, 0.05, z - towerDepth * 0.28],
            [x + 0.22, 0.05, z - towerDepth * 0.28],
            [x + 0.34, towerHeight + 0.9, z - towerDepth * 0.28],
            [x - 0.34, towerHeight + 0.9, z - towerDepth * 0.28],
            [0.2, 0.2, 0.2, 0.12 + pulse * 0.12],
          );
        }
      });
    }

    drawGeometry(mode, positions, colors, matrix) {
      if (!positions.length) {
        return;
      }

      const gl = this.gl;

      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.positionLocation);
      gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.colorLocation);
      gl.vertexAttribPointer(this.colorLocation, 4, gl.FLOAT, false, 0, 0);

      gl.uniformMatrix4fv(this.matrixLocation, false, matrix);
      gl.drawArrays(mode, 0, positions.length / 3);
    }

    renderWebGL(time) {
      if (!this.gl) {
        return;
      }

      this.resize();

      const gl = this.gl;
      const aspect = this.canvas.width / this.canvas.height || 1;
      const projection = perspectiveMatrix(0.82, aspect, 0.1, 60);
      const eye = [Math.sin(time * 0.14) * 0.82, 4.2 + Math.sin(time * 0.1) * 0.14, 12.2];
      const target = [0, 1.3, 0.95];
      const view = lookAtMatrix(eye, target, [0, 1, 0]);
      const matrix = multiplyMatrix4(projection, view);

      this.buildScene(time);

      gl.clearColor(0, 0, 0, 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(this.program);

      this.drawGeometry(gl.TRIANGLES, this.trianglePositions, this.triangleColors, matrix);
      this.drawGeometry(gl.LINES, this.linePositions, this.lineColors, matrix);
    }

    renderFallback2D(time) {
      if (!this.ctx2d) {
        return;
      }

      this.resize();

      const width = this.canvas.width;
      const height = this.canvas.height;
      const ctx = this.ctx2d;
      const aspect = width / height || 1;
      const projection = perspectiveMatrix(0.82, aspect, 0.1, 60);
      const eye = [Math.sin(time * 0.14) * 0.82, 4.2 + Math.sin(time * 0.1) * 0.14, 12.2];
      const target = [0, 1.3, 0.95];
      const view = lookAtMatrix(eye, target, [0, 1, 0]);
      const matrix = multiplyMatrix4(projection, view);

      this.buildScene(time);

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      for (let index = 0; index < this.trianglePositions.length; index += 9) {
        const a = projectPoint(
          matrix,
          [this.trianglePositions[index], this.trianglePositions[index + 1], this.trianglePositions[index + 2]],
          width,
          height,
        );
        const b = projectPoint(
          matrix,
          [this.trianglePositions[index + 3], this.trianglePositions[index + 4], this.trianglePositions[index + 5]],
          width,
          height,
        );
        const c = projectPoint(
          matrix,
          [this.trianglePositions[index + 6], this.trianglePositions[index + 7], this.trianglePositions[index + 8]],
          width,
          height,
        );

        if (!a || !b || !c) {
          continue;
        }

        const color = [
          this.triangleColors[(index / 3) * 4],
          this.triangleColors[(index / 3) * 4 + 1],
          this.triangleColors[(index / 3) * 4 + 2],
          this.triangleColors[(index / 3) * 4 + 3],
        ];

        ctx.fillStyle = rgba(color);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.closePath();
        ctx.fill();
      }

      for (let index = 0; index < this.linePositions.length; index += 6) {
        const a = projectPoint(
          matrix,
          [this.linePositions[index], this.linePositions[index + 1], this.linePositions[index + 2]],
          width,
          height,
        );
        const b = projectPoint(
          matrix,
          [this.linePositions[index + 3], this.linePositions[index + 4], this.linePositions[index + 5]],
          width,
          height,
        );

        if (!a || !b) {
          continue;
        }

        const color = [
          this.lineColors[(index / 3) * 4],
          this.lineColors[(index / 3) * 4 + 1],
          this.lineColors[(index / 3) * 4 + 2],
          this.lineColors[(index / 3) * 4 + 3],
        ];

        ctx.strokeStyle = rgba(color);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "source-over";
    }

    render(time) {
      if (this.gl) {
        this.renderWebGL(time);
        return;
      }

      this.renderFallback2D(time);
    }
  }

  window.MixVisualizerRenderer = MixVisualizerRenderer;
})();
