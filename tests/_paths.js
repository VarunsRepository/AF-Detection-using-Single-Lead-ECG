// ---------------------------------------------------------------------------
// tests/_paths.js
//
// Resolves a component file by NAME, wherever it actually lives.
//
// WHY THIS EXISTS
//   The checks load filters and renderers off disk and run them in a VM.
//   The first version read bare filenames, which worked only while every
//   file sat in one scratch directory and broke the moment they were put
//   where they belong -- filters in static/shorts/filters, renderers in
//   static/shorts/renderers, core JS in static/shorts/core.
//
//   A test that only passes in the directory it was written in is not a
//   test, it is a coincidence.
//
// HOW IT FINDS THE ROOT
//   Walks up from this file until it sees a static/shorts directory. That
//   makes the checks runnable from anywhere -- the repo root, the tests
//   directory, an editor's run button -- rather than requiring a
//   particular working directory and failing confusingly when it is wrong.
//
//   A SEARCH_DIRS fallback includes "." so the files still resolve if you
//   keep them all in one folder while drafting, which is how they were
//   written.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

function findRoot(start) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
        if (fs.existsSync(path.join(dir, "static", "shorts"))) return dir;
        const up = path.dirname(dir);
        if (up === dir) break;
        dir = up;
    }
    return null;
}

const ROOT = findRoot(__dirname);

const SEARCH_DIRS = [
    ...(ROOT ? [
        path.join(ROOT, "static", "shorts", "filters"),
        path.join(ROOT, "static", "shorts", "renderers"),
        path.join(ROOT, "static", "shorts", "core"),
        path.join(ROOT, "static", "shorts", "adapters"),
    ] : []),
    __dirname,          // beside the checks
    process.cwd(),      // and wherever you ran from
    ".",
];

function resolve(name) {
    for (const d of SEARCH_DIRS) {
        const p = path.join(d, name);
        if (fs.existsSync(p)) return p;
    }
    // Loud, and says where it looked. A check that cannot find the thing
    // it tests must not be mistakable for a check that found nothing wrong.
    throw new Error(
        `_paths: cannot find "${name}".\n`
        + `  repo root ${ROOT ? `detected at ${ROOT}` : "NOT detected -- no static/shorts above " + __dirname}\n`
        + `  looked in:\n${SEARCH_DIRS.map(d => "    " + d).join("\n")}`);
}

function read(name) {
    return fs.readFileSync(resolve(name), "utf8");
}

module.exports = { ROOT, SEARCH_DIRS, resolve, read };
