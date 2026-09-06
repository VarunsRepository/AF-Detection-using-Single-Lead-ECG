// ---------------------------------------------------------------------------
// savitzky_golay_filter.js
// A genuine Savitzky-Golay smoothing filter -- fits a low-degree polynomial
// to a sliding window of points (via least squares) and takes the fitted
// polynomial's value at the window's center, rather than a plain moving
// average. This is what lets it smooth high-frequency noise while
// preserving peak height/width much better than a simple average would.
//
// NOTE: this solves a genuinely DIFFERENT problem than baseline wander
// removal (baseline_correction_filter.js). Baseline correction removes
// SLOW DRIFT (very low frequency); this smooths HIGH-FREQUENCY NOISE. A
// real pipeline would often apply BOTH, sequentially, rather than
// choosing one or the other -- offered here as an alternative (matching
// how Stage 2's peak detectors work) for consistency with the existing
// plug-and-play pattern, not because that's the only sensible way to
// combine the two.
// ---------------------------------------------------------------------------

function savitzkyGolaySmooth(x, windowSize = 11, polyOrder = 3) {
    if (windowSize % 2 === 0) windowSize += 1; // must be odd, so there's a true center point
    const half = Math.floor(windowSize / 2);

    // Design matrix: each row is [1, i, i^2, ..., i^polyOrder] for i
    // running from -half to +half (position relative to the window's
    // center point).
    const X = [];
    for (let i = -half; i <= half; i++) {
        const row = [];
        for (let p = 0; p <= polyOrder; p++) row.push(Math.pow(i, p));
        X.push(row);
    }

    // Normal equations: (X^T X) c = X^T y solves for the fitted polynomial's
    // coefficients from a window of y-values. We only need the FIRST ROW of
    // (X^T X)^-1 X^T -- that row IS the smoothing weights (the fitted
    // polynomial's value at i=0, the window's center), and since it depends
    // only on window size/order (not on the actual data), it's computed
    // once and reused as a plain convolution kernel.
    const XtX = matMul(transpose(X), X);
    const XtXInv = invertMatrix(XtX);
    const smoothingWeights = firstRowOfProduct(XtXInv, transpose(X)); // length = windowSize

    const y = new Array(x.length);
    for (let i = 0; i < x.length; i++) {
        if (i < half || i >= x.length - half) {
            y[i] = x[i]; // not enough neighbors for a full window at the very edges -- left unsmoothed rather than guessing
            continue;
        }
        let sum = 0;
        for (let k = 0; k < windowSize; k++) {
            sum += smoothingWeights[k] * x[i - half + k];
        }
        y[i] = sum;
    }
    return y;
}

// --- small linear algebra helpers, only used by the function above ---

function transpose(M) {
    const rows = M.length, cols = M[0].length;
    const T = Array.from({ length: cols }, () => new Array(rows));
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) T[j][i] = M[i][j];
    return T;
}

function matMul(A, B) {
    const rowsA = A.length, colsA = A[0].length, colsB = B[0].length;
    const C = Array.from({ length: rowsA }, () => new Array(colsB).fill(0));
    for (let i = 0; i < rowsA; i++) {
        for (let k = 0; k < colsA; k++) {
            const a = A[i][k];
            if (a === 0) continue;
            for (let j = 0; j < colsB; j++) C[i][j] += a * B[k][j];
        }
    }
    return C;
}

function firstRowOfProduct(A, B) {
    // computes just the first row of A*B, without materializing the whole result
    const cols = B[0].length;
    const row = new Array(cols).fill(0);
    for (let k = 0; k < A[0].length; k++) {
        const a = A[0][k];
        if (a === 0) continue;
        for (let j = 0; j < cols; j++) row[j] += a * B[k][j];
    }
    return row;
}

function invertMatrix(M) {
    // Gauss-Jordan elimination with partial pivoting. M is small (typically
    // 3x3 or 4x4 -- polyOrder+1 square), so this is fast and easy to verify
    // correct without needing a general-purpose linear algebra library.
    const n = M.length;
    const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);

    for (let col = 0; col < n; col++) {
        let pivotRow = col;
        for (let r = col + 1; r < n; r++) {
            if (Math.abs(A[r][col]) > Math.abs(A[pivotRow][col])) pivotRow = r;
        }
        [A[col], A[pivotRow]] = [A[pivotRow], A[col]];

        const pivotVal = A[col][col];
        for (let j = 0; j < 2 * n; j++) A[col][j] /= pivotVal;

        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const factor = A[r][col];
            for (let j = 0; j < 2 * n; j++) A[r][j] -= factor * A[col][j];
        }
    }

    return A.map(row => row.slice(n));
}
