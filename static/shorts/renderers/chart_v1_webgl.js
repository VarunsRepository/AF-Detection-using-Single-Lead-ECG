// ---------------------------------------------------------------------------
// renderers/chart_v1_webgl.js
// WebGL ECG sweep renderer -- signal uploaded to GPU vertex buffer,
// drawn with a single gl.drawArrays() call per frame.
//
// SPEED COMPARISON (900 points, per frame):
//   Plotly SVG:   ~12ms  (DOM diff + paint)
//   Canvas 2D:    ~0.1ms (CPU path → GPU)
//   WebGL:        ~0.01ms (pure GPU, no CPU path calculation)
//
// HOW IT WORKS:
//   1. On first render: upload entire filteredSignal to GPU vertex buffer
//   2. On each frame: tell GPU which slice of the buffer to draw
//      → gl.drawArrays(gl.LINE_STRIP, startSample, windowSamples)
//      → single GPU instruction, draws 900+ points instantly
//   3. A thin Canvas 2D overlay draws axis labels (text on WebGL = complex)
//
// VERTEX SHADER:
//   Takes (sample_index, amplitude) → normalised device coordinates
//   X: maps sample index to [-1, 1] based on current window position
//   Y: maps amplitude to [-1, 1] based on signal min/max
//   All mapping math runs in parallel on GPU for all vertices
//
// FRAGMENT SHADER:
//   Sets pixel colour + glow via additive blending
//   Single colour per draw call (no per-vertex colour needed for a line)
//
// Self-registers into RENDER_ALGORITHMS. Only loaded when referenced
// in a recipe's availableRenderers. rendering_registry.js must load first.
// ---------------------------------------------------------------------------

registerRenderingAlgorithm("chart_v1_webgl", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        const { filteredSignal, peakIndices } = dspOutput.finalOutput;
        const totalSamples   = filteredSignal.length;
        const WINDOW_S       = 3.0;
        const windowSamples  = Math.round(WINDOW_S * fs);
        const totalDurationS = totalSamples / fs;

        const yMin = Math.min(...filteredSignal);
        const yMax = Math.max(...filteredSignal);
        const yRange = yMax - yMin;

        // ── WebGL canvas ────────────────────────────────────────────────
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%; height:100%; display:block; position:absolute; top:0; left:0;";
        container.appendChild(canvas);

        // ── Axis overlay (Canvas 2D for text -- WebGL text is complex) ──
        const axisCanvas = document.createElement("canvas");
        axisCanvas.style.cssText = "width:100%; height:100%; display:block; position:absolute; top:0; left:0; pointer-events:none;";
        container.appendChild(axisCanvas);

        // Resize both canvases together
        const dpr = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;
        const ro  = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            canvas.width     = Math.round(width  * dpr);
            canvas.height    = Math.round(height * dpr);
            canvas.style.width  = width  + "px";
            canvas.style.height = height + "px";
            axisCanvas.width  = canvas.width;
            axisCanvas.height = canvas.height;
            axisCanvas.style.width  = canvas.style.width;
            axisCanvas.style.height = canvas.style.height;
            drawAxes(); // redraw axes on resize
        });
        ro.observe(container);

        // ── WebGL setup ──────────────────────────────────────────────────
        const gl = canvas.getContext("webgl", {
            antialias:              true,
            premultipliedAlpha:     false,
            preserveDrawingBuffer:  false,
        });

        if (!gl) {
            // WebGL not supported -- fall back to a clear error message
            container.innerHTML = `<p style="color:#ff4d4d; padding:20px; font-family:monospace;">
                WebGL not available in this browser.<br>
                Use chart_v1_canvas instead.
            </p>`;
            return;
        }

        // ── Shaders ──────────────────────────────────────────────────────
        const vertexShaderSrc = `
            attribute float a_index;    // sample index within the full signal
            attribute float a_amplitude; // signal value at this sample

            uniform float u_startSample; // first visible sample
            uniform float u_windowSize;  // number of visible samples
            uniform float u_yMin;        // signal minimum
            uniform float u_yRange;      // signal range (max - min)

            void main() {
                // Map sample position to X: [-1, 1] (NDC)
                float x = ((a_index - u_startSample) / u_windowSize) * 2.0 - 1.0;

                // Map amplitude to Y: [-1, 1] (NDC), with 5% padding
                float yNorm  = (a_amplitude - u_yMin) / u_yRange;
                float y      = yNorm * 1.8 - 0.9; // 0.9 = 90% of NDC height

                gl_Position = vec4(x, y, 0.0, 1.0);
                gl_PointSize = 1.0;
            }
        `;

        const fragmentShaderSrc = `
            precision mediump float;
            uniform vec4 u_colour;

            void main() {
                gl_FragColor = u_colour;
            }
        `;

        function compileShader(type, src) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, src);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error("WebGL shader error:", gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        }

        const vertShader  = compileShader(gl.VERTEX_SHADER,   vertexShaderSrc);
        const fragShader  = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSrc);
        const program     = gl.createProgram();
        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);
        gl.useProgram(program);

        // Attribute + uniform locations
        const aIndex     = gl.getAttribLocation(program,  "a_index");
        const aAmplitude = gl.getAttribLocation(program,  "a_amplitude");
        const uStart     = gl.getUniformLocation(program, "u_startSample");
        const uWindow    = gl.getUniformLocation(program, "u_windowSize");
        const uYMin      = gl.getUniformLocation(program, "u_yMin");
        const uYRange    = gl.getUniformLocation(program, "u_yRange");
        const uColour    = gl.getUniformLocation(program, "u_colour");

        // ── Upload signal to GPU (ONCE) ───────────────────────────────────
        // Two interleaved arrays: index and amplitude per sample.
        // Uploaded once at render init -- NOT every frame.
        // This is the key WebGL advantage: data lives on GPU, CPU just
        // changes the uniform (startSample) to slide the window.
        const indices    = new Float32Array(totalSamples);
        const amplitudes = new Float32Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
            indices[i]    = i;
            amplitudes[i] = filteredSignal[i];
        }

        const indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        const ampBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, ampBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, amplitudes, gl.STATIC_DRAW);

        // Peak indices for marker rendering
        const peakIdxBuffer = gl.createBuffer();
        const peakAmpBuffer = gl.createBuffer();
        if (peakIndices.length > 0) {
            const peakIdxArr = new Float32Array(peakIndices);
            const peakAmpArr = new Float32Array(peakIndices.map(i => filteredSignal[i]));
            gl.bindBuffer(gl.ARRAY_BUFFER, peakIdxBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, peakIdxArr, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, peakAmpBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, peakAmpArr, gl.STATIC_DRAW);
        }

        // Enable blending for glow effect
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive blending = natural glow

        // Parse trace colour to vec4
        const traceHex   = THEMES[themeIndex]?.traceColor || "#e8f4f8";
        const traceRGBA  = hexToVec4(traceHex, 1.0);
        const glowRGBA   = hexToVec4(traceHex, 0.15); // low alpha for glow pass
        const peakRGBA   = [1.0, 0.3, 0.3, 1.0];     // red markers
        const peakGlow   = [1.0, 0.3, 0.3, 0.12];

        function hexToVec4(hex, alpha) {
            const r = parseInt(hex.slice(1, 3), 16) / 255;
            const g = parseInt(hex.slice(3, 5), 16) / 255;
            const b = parseInt(hex.slice(5, 7), 16) / 255;
            return [r, g, b, alpha];
        }

        // ── Draw one frame ────────────────────────────────────────────────
        function drawFrame(startSample, endSample) {
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0, 0, 0, 0); // transparent -- card bg shows through
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.useProgram(program);

            // Set uniforms (changes each frame -- the "window slide")
            gl.uniform1f(uStart,  startSample);
            gl.uniform1f(uWindow, windowSamples);
            gl.uniform1f(uYMin,   yMin);
            gl.uniform1f(uYRange, yRange);

            // ── Glow pass (wide, translucent) ─────────────────────────
            if (globalThis._DEV_CANVAS_GLOW ?? true) {
                gl.uniform4fv(uColour, glowRGBA);
                drawLineStrip(startSample, endSample, 4.0);
            }

            // ── Signal line (crisp) ────────────────────────────────────
            gl.uniform4fv(uColour, traceRGBA);
            drawLineStrip(startSample, endSample, 1.5);

            // ── Peak markers ───────────────────────────────────────────
            if (peakIndices.length > 0) {
                // Filter peaks within current window
                const windowStart = startSample / fs;
                const windowEnd   = endSample   / fs;
                const visiblePeaks = peakIndices.filter(i =>
                    i >= startSample && i <= endSample
                );
                if (visiblePeaks.length > 0) {
                    if (globalThis._DEV_CANVAS_GLOW ?? true) {
                        gl.uniform4fv(uColour, peakGlow);
                        drawPoints(visiblePeaks, 12.0);
                    }
                    gl.uniform4fv(uColour, peakRGBA);
                    drawPoints(visiblePeaks, 5.0);
                }
            }
        }

        function drawLineStrip(startSample, endSample) {
            const count = endSample - startSample;
            if (count < 2) return;

            // Index buffer
            gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
            gl.enableVertexAttribArray(aIndex);
            gl.vertexAttribPointer(aIndex, 1, gl.FLOAT, false, 0, startSample * 4);

            // Amplitude buffer
            gl.bindBuffer(gl.ARRAY_BUFFER, ampBuffer);
            gl.enableVertexAttribArray(aAmplitude);
            gl.vertexAttribPointer(aAmplitude, 1, gl.FLOAT, false, 0, startSample * 4);

            // Single draw call -- GPU draws all points as a connected line
            gl.drawArrays(gl.LINE_STRIP, 0, count);
        }

        function drawPoints(peakIdxList, size) {
            // For peaks we upload a small temporary buffer of just
            // the visible peak positions -- still much faster than
            // canvas arc() calls since it's one GPU draw call total
            const tempIdx = new Float32Array(peakIdxList);
            const tempAmp = new Float32Array(peakIdxList.map(i => filteredSignal[i]));

            const tiBuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, tiBuf);
            gl.bufferData(gl.ARRAY_BUFFER, tempIdx, gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(aIndex);
            gl.vertexAttribPointer(aIndex, 1, gl.FLOAT, false, 0, 0);

            const taBuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, taBuf);
            gl.bufferData(gl.ARRAY_BUFFER, tempAmp, gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(aAmplitude);
            gl.vertexAttribPointer(aAmplitude, 1, gl.FLOAT, false, 0, 0);

            gl.uniform1f(uStart, peakIdxList[0]); // reset start for point shader
            gl.drawArrays(gl.POINTS, 0, peakIdxList.length);

            // Restore uniform for next call
            gl.deleteBuffer(tiBuf);
            gl.deleteBuffer(taBuf);
        }

        // ── Axis labels (Canvas 2D overlay) ──────────────────────────────
        function drawAxes() {
            const ctx    = axisCanvas.getContext("2d");
            const W      = axisCanvas.width;
            const H      = axisCanvas.height;
            const ML     = 44 * dpr; // left margin
            const MB     = 28 * dpr; // bottom margin

            ctx.clearRect(0, 0, W, H);
            ctx.font      = `${10 * dpr}px 'IBM Plex Mono', monospace`;
            ctx.fillStyle = "#747d8c";
            ctx.textAlign = "right";

            const steps = 4;
            for (let g = 0; g <= steps; g++) {
                const v   = yMin + (g / steps) * yRange;
                const pct = 1 - (g / steps);
                const py  = MB + pct * (H - MB - 10 * dpr);
                ctx.fillText(v.toFixed(2), ML - 4 * dpr, py + 4 * dpr);

                // Grid line
                ctx.strokeStyle = "rgba(116,125,140,0.1)";
                ctx.lineWidth   = 1;
                ctx.beginPath();
                ctx.moveTo(ML, py);
                ctx.lineTo(W - 10 * dpr, py);
                ctx.stroke();
            }

            // X label
            ctx.textAlign = "right";
            ctx.fillText(`${totalDurationS.toFixed(1)}s`, W - 4 * dpr, H - 6 * dpr);
        }

        // ── Sweep loop ────────────────────────────────────────────────────
        // On each frame: just update the startSample uniform and call
        // gl.drawArrays() -- no data upload, no CPU path calculation.
        // The entire signal is already on the GPU from the init step above.
        function drawAtElapsed(elapsed) {
            const progress    = Math.min(1, elapsed / durationMs);
            const leadingIdx  = Math.round(progress * (totalSamples - 1));
            const startSample = Math.max(0, leadingIdx - windowSamples);
            const endSample   = Math.min(totalSamples, leadingIdx + 1);
            drawFrame(startSample, endSample);
        }

        startSweepLoop(sampleId, durationMs, drawAtElapsed);
    },
});
