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
//   Sets pixel colour, and rounds off POINTS using gl_PointCoord so a
//   peak marker is a disc rather than the square GL draws by default.
//
// ── THE PEAK MARKERS WERE INVISIBLE. FOUR BUGS, ALL IN ONE PATH ────────────
//
//   1. gl_PointSize WAS HARDCODED TO 1.0.
//      drawPoints() took a `size` argument and passed 12.0 and 5.0, but
//      nothing ever used it -- there was no point-size uniform at all. So
//      every peak rendered as ONE DEVICE PIXEL. On a phone at DPR 3 that
//      is a third of a CSS pixel. Not missing, just far too small to see,
//      which is why the renderer looked like it had no peak support while
//      containing a complete peak-drawing path.
//
//   2. THE X MAPPING WAS OVERWRITTEN FOR POINTS.
//      drawPoints did `gl.uniform1f(uStart, peakIdxList[0])`, and the
//      vertex shader computes x from (a_index - u_startSample). That
//      forces the FIRST visible peak to x = -1, the left edge, with the
//      rest placed relative to it. Even at a visible size they would have
//      been in the wrong place. A comment claimed the uniform was
//      restored afterwards; nothing restored it.
//
//   3. THE COLOUR IGNORED THE RECIPE.
//      chart_v1_canvas reads `config.peakMarkerColor` (falling back to
//      #ff4d4d), which is how the ECG recipe makes its markers orange.
//      This file had `peakRGBA = [1.0, 0.3, 0.3, 1.0]` hardcoded, so even
//      once visible it would have disagreed with the canvas renderer
//      about the colour.
//
//   4. FOUR BUFFERS CREATED AND DESTROYED EVERY FRAME.
//      peakIdxBuffer and peakAmpBuffer were uploaded once at init and
//      then never bound -- drawPoints built two fresh buffers per call,
//      twice per frame. Allocating and freeing GPU buffers at 60Hz is
//      exactly the cost this renderer exists to avoid. Now the
//      pre-uploaded buffers are drawn with an offset, which is what they
//      were created for.
//
//   Worth recording WHY this went unnoticed: the Schema Registry verifies
//   that the DSP PROVIDES peakIndices, and it does. Nothing checks that a
//   renderer declaring it actually DRAWS it. Three renderers for one
//   picture means three places a feature can quietly go missing, and only
//   one of them is the default.
//
// STILL KNOWN-BROKEN, AND NOT FIXED HERE:
//   The glow pass calls drawLineStrip(..., 4.0) meaning a 4px line, but
//   gl.lineWidth above 1.0 is ignored by every major browser, and the
//   third argument was never read anyway. So the WebGL renderer has no
//   glow -- the pass draws the same 1px line in a translucent colour over
//   itself. A real fix means expanding the line into a triangle strip,
//   which is a rewrite rather than a patch.
//
// Self-registers into RENDER_ALGORITHMS. Only loaded when referenced
// in a recipe's availableRenderers. rendering_registry.js must load first.
// ---------------------------------------------------------------------------

registerRenderingAlgorithm("chart_v1_webgl", {
    render(container, dspOutput, config, sampleId, fs, durationMs) {
        container.innerHTML = "";
        container.style.position = "relative";

        const cfg = config || {};
        const { filteredSignal } = dspOutput.finalOutput;
        // Sorted ascending so the peaks visible in a window are a
        // CONTIGUOUS run, which is what lets the pre-uploaded buffer be
        // drawn with an offset instead of rebuilt. A copy, because the
        // DSP's array belongs to the DSP.
        const peakIndices = Array.from(dspOutput.finalOutput.peakIndices ?? [])
                                 .sort((a, b) => a - b);

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

        const dpr = globalThis._DEV_CANVAS_DPR ?? devicePixelRatio;

        // Sized immediately as well as on resize. The ResizeObserver does
        // not fire before the first frame, and a 0x0 framebuffer draws
        // nothing at all -- the same literal-fallback rule the other
        // renderers in this folder follow.
        const initW = container.offsetWidth  || 390;
        const initH = container.offsetHeight || 300;
        const sizeTo = (w, h) => {
            canvas.width  = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            canvas.style.width  = w + "px";
            canvas.style.height = h + "px";
            axisCanvas.width  = canvas.width;
            axisCanvas.height = canvas.height;
            axisCanvas.style.width  = canvas.style.width;
            axisCanvas.style.height = canvas.style.height;
        };
        sizeTo(initW, initH);

        const ro = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            if (!width || !height) return;
            sizeTo(width, height);
            drawAxes();
        });
        ro.observe(container);

        // ── WebGL setup ──────────────────────────────────────────────────
        const gl = canvas.getContext("webgl", {
            antialias:              true,
            premultipliedAlpha:     false,
            preserveDrawingBuffer:  false,
        });

        if (!gl) {
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
            uniform float u_pointSize;   // in DEVICE pixels, for gl.POINTS

            void main() {
                // Map sample position to X: [-1, 1] (NDC)
                float x = ((a_index - u_startSample) / u_windowSize) * 2.0 - 1.0;

                // Map amplitude to Y: [-1, 1] (NDC), with 5% padding
                float yNorm  = (a_amplitude - u_yMin) / u_yRange;
                float y      = yNorm * 1.8 - 0.9; // 0.9 = 90% of NDC height

                gl_Position = vec4(x, y, 0.0, 1.0);
                // Was hardcoded 1.0, which is the whole reason the peak
                // markers were invisible.
                gl_PointSize = u_pointSize;
            }
        `;

        const fragmentShaderSrc = `
            precision mediump float;
            uniform vec4  u_colour;
            uniform float u_round;   // 1.0 for POINTS, 0.0 for the line

            void main() {
                // gl.POINTS are SQUARES by default. The canvas renderer
                // draws peaks with ctx.arc(), so discarding outside a
                // radius is what keeps the two renderers showing the same
                // picture rather than merely the same data.
                if (u_round > 0.5) {
                    vec2 d = gl_PointCoord - vec2(0.5);
                    if (dot(d, d) > 0.25) discard;
                }
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
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            // Said out loud: a failed link leaves a correctly sized,
            // fully wired, entirely blank canvas.
            console.error("WebGL link error:", gl.getProgramInfoLog(program));
            container.innerHTML = `<p style="color:#ff4d4d;padding:20px;">
                WebGL program failed to link (see console).</p>`;
            return;
        }
        gl.useProgram(program);

        // Attribute + uniform locations
        const aIndex     = gl.getAttribLocation(program,  "a_index");
        const aAmplitude = gl.getAttribLocation(program,  "a_amplitude");
        const uStart     = gl.getUniformLocation(program, "u_startSample");
        const uWindow    = gl.getUniformLocation(program, "u_windowSize");
        const uYMin      = gl.getUniformLocation(program, "u_yMin");
        const uYRange    = gl.getUniformLocation(program, "u_yRange");
        const uColour    = gl.getUniformLocation(program, "u_colour");
        const uPointSize = gl.getUniformLocation(program, "u_pointSize");
        const uRound     = gl.getUniformLocation(program, "u_round");

        // ── Upload signal to GPU (ONCE) ───────────────────────────────────
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

        // Peaks, uploaded once and then DRAWN WITH AN OFFSET. They used to
        // be uploaded here and never bound, while drawPoints rebuilt two
        // buffers per call.
        const peakIdxBuffer = gl.createBuffer();
        const peakAmpBuffer = gl.createBuffer();
        if (peakIndices.length > 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, peakIdxBuffer);
            gl.bufferData(gl.ARRAY_BUFFER,
                          new Float32Array(peakIndices), gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, peakAmpBuffer);
            gl.bufferData(gl.ARRAY_BUFFER,
                          new Float32Array(peakIndices.map(i => filteredSignal[i])),
                          gl.STATIC_DRAW);
        }

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive blending = natural glow

        const traceHex   = (typeof THEMES !== "undefined"
                            && THEMES[themeIndex]?.traceColor) || "#e8f4f8";
        const traceRGBA  = hexToVec4(traceHex, 1.0);
        const glowRGBA   = hexToVec4(traceHex, 0.15);

        // SAME SOURCE AS THE CANVAS RENDERER, so switching renderer cannot
        // silently change the colour of the markers.
        const peakHex    = cfg.peakMarkerColor || "#ff4d4d";
        const peakRGBA   = hexToVec4(peakHex, 1.0);
        const peakGlow   = hexToVec4(peakHex, 0.18);

        function hexToVec4(hex, alpha) {
            const h = String(hex).trim();
            // #rgb as well as #rrggbb: a recipe is hand-written and the
            // short form is a reasonable thing for someone to type.
            const full = h.length === 4
                ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
            const r = parseInt(full.slice(1, 3), 16) / 255;
            const g = parseInt(full.slice(3, 5), 16) / 255;
            const b = parseInt(full.slice(5, 7), 16) / 255;
            return [Number.isFinite(r) ? r : 1,
                    Number.isFinite(g) ? g : 0.3,
                    Number.isFinite(b) ? b : 0.3, alpha];
        }

        // ── Draw one frame ────────────────────────────────────────────────
        function drawFrame(startSample, endSample) {
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0, 0, 0, 0); // transparent -- card bg shows through
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.useProgram(program);

            // Set once per frame and NOT touched again -- the peak pass
            // used to overwrite u_startSample, which moved every marker.
            gl.uniform1f(uStart,  startSample);
            gl.uniform1f(uWindow, windowSamples);
            gl.uniform1f(uYMin,   yMin);
            gl.uniform1f(uYRange, yRange);
            gl.uniform1f(uRound,  0.0);
            gl.uniform1f(uPointSize, 1.0);

            const useGlow = globalThis._DEV_CANVAS_GLOW ?? true;

            // Glow pass. Kept for parity of structure with the canvas
            // renderer, but see the header: gl.lineWidth > 1 is ignored,
            // so this currently adds almost nothing for the LINE.
            if (useGlow) {
                gl.uniform4fv(uColour, glowRGBA);
                drawLineStrip(startSample, endSample);
            }

            gl.uniform4fv(uColour, traceRGBA);
            drawLineStrip(startSample, endSample);

            // ── Peak markers ───────────────────────────────────────────
            // Peaks are sorted, so the visible ones are one contiguous
            // run and can be drawn straight out of the buffer uploaded at
            // init. Two numbers instead of four buffer allocations.
            if (peakIndices.length > 0) {
                let lo = 0;
                while (lo < peakIndices.length && peakIndices[lo] < startSample) lo++;
                let hi = lo;
                while (hi < peakIndices.length && peakIndices[hi] <= endSample) hi++;
                const count = hi - lo;

                if (count > 0) {
                    gl.uniform1f(uRound, 1.0);
                    bindPeaks(lo);
                    // Sizes match chart_v1_canvas: a 4px radius disc, so
                    // 8px across, and a wider translucent halo for the
                    // glow pass. Multiplied by dpr because gl_PointSize
                    // is in DEVICE pixels while the canvas renderer's
                    // arc radius is multiplied by dpr for the same
                    // reason.
                    if (useGlow) {
                        gl.uniform4fv(uColour, peakGlow);
                        gl.uniform1f(uPointSize, 18.0 * dpr);
                        gl.drawArrays(gl.POINTS, 0, count);
                    }
                    gl.uniform4fv(uColour, peakRGBA);
                    gl.uniform1f(uPointSize, 8.0 * dpr);
                    gl.drawArrays(gl.POINTS, 0, count);
                    gl.uniform1f(uRound, 0.0);
                }
            }
        }

        function drawLineStrip(startSample, endSample) {
            const count = endSample - startSample;
            if (count < 2) return;

            gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
            gl.enableVertexAttribArray(aIndex);
            gl.vertexAttribPointer(aIndex, 1, gl.FLOAT, false, 0, startSample * 4);

            gl.bindBuffer(gl.ARRAY_BUFFER, ampBuffer);
            gl.enableVertexAttribArray(aAmplitude);
            gl.vertexAttribPointer(aAmplitude, 1, gl.FLOAT, false, 0, startSample * 4);

            // Single draw call -- GPU draws all points as a connected line
            gl.drawArrays(gl.LINE_STRIP, 0, count);
        }

        // Point the attributes at the peak buffers, offset to the first
        // visible peak. A Float32Array element is 4 bytes, hence `* 4`.
        function bindPeaks(firstVisible) {
            gl.bindBuffer(gl.ARRAY_BUFFER, peakIdxBuffer);
            gl.enableVertexAttribArray(aIndex);
            gl.vertexAttribPointer(aIndex, 1, gl.FLOAT, false, 0, firstVisible * 4);

            gl.bindBuffer(gl.ARRAY_BUFFER, peakAmpBuffer);
            gl.enableVertexAttribArray(aAmplitude);
            gl.vertexAttribPointer(aAmplitude, 1, gl.FLOAT, false, 0, firstVisible * 4);
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

                ctx.strokeStyle = "rgba(116,125,140,0.1)";
                ctx.lineWidth   = 1;
                ctx.beginPath();
                ctx.moveTo(ML, py);
                ctx.lineTo(W - 10 * dpr, py);
                ctx.stroke();
            }

            ctx.textAlign = "right";
            ctx.fillText(`${totalDurationS.toFixed(1)}s`, W - 4 * dpr, H - 6 * dpr);
        }
        drawAxes();

        // ── Sweep loop ────────────────────────────────────────────────────
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