// ---------------------------------------------------------------------------
// dwt_filter.js
// Genuine multi-level Discrete Wavelet Transform, using the Haar wavelet --
// the simplest real wavelet family, and easy to verify correct (it's
// exactly invertible: approx+detail losslessly reconstructs the input).
// Pure computation, no rendering, same convention as every other filter
// file -- this one just isn't wired into the main pipeline's
// registerStage(), by deliberate choice (see dwt_demo.js's header comment
// for why).
//
// Each level: pairs of adjacent samples become one "approximation"
// coefficient (their scaled sum -- the smooth, low-frequency trend) and
// one "detail" coefficient (their scaled difference -- the high-frequency
// content at that scale). Recursing on the approximation coefficients is
// what gives multi-level decomposition: level 2 sees half the resolution
// of level 1, level 3 half of that, etc.
// ---------------------------------------------------------------------------

function haarDWTSingleLevel(x) {
    const n = x.length;
    const half = Math.floor(n / 2);
    const approx = new Array(half);
    const detail = new Array(half);
    const norm = Math.SQRT1_2; // 1/sqrt(2) -- keeps the transform energy-preserving (orthonormal)

    for (let i = 0; i < half; i++) {
        const a = x[2 * i];
        const b = x[2 * i + 1];
        approx[i] = (a + b) * norm;
        detail[i] = (a - b) * norm;
    }
    return { approx, detail };
}

// Inverse of a single level -- reconstructs the original pair-sequence
// from approx+detail coefficients. Used only for the correctness check
// below, not by the demo itself, but kept here since it's the natural
// counterpart to the forward transform.
function inverseHaarDWTSingleLevel(approx, detail) {
    const n = approx.length;
    const x = new Array(n * 2);
    const norm = Math.SQRT1_2;
    for (let i = 0; i < n; i++) {
        x[2 * i] = (approx[i] + detail[i]) * norm;
        x[2 * i + 1] = (approx[i] - detail[i]) * norm;
    }
    return x;
}

function multiLevelHaarDWT(x, levels = 5) {
    let current = x;
    const decomposition = []; // [{level, approx, detail}, ...]

    for (let level = 1; level <= levels; level++) {
        if (current.length < 2) break; // can't decompose further
        const { approx, detail } = haarDWTSingleLevel(current);
        decomposition.push({ level, approx, detail });
        current = approx; // next level recurses on THIS level's approximation
    }
    return decomposition;
}
