"""
SpectralBandStore
------------------
Bulk-oriented data store for spectral band-power CSVs (e.g. psd_band_features.csv).
Separate from ECG_Signal_Feature_Manager on purpose: that class serves scalar,
individually-versioned per-record metrics (SDNN, pNN50, ...) from a JSON file;
this one serves whole matrices/vectors of band data from a CSV, shaped for
bulk consumption by charts (class profiles, distributions, heatmaps, PCA/t-SNE).

Two datasets are supported side by side (full-length FFT vs fixed-9000-pt FFT)
-- each gets its own SpectralBandStore instance, kept independent because their
frequency resolution (Δf) differs and shouldn't be mixed in one analysis.
"""

import os
import json
import hashlib
import threading

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE
from sklearn.preprocessing import StandardScaler


class SpectralBandStore:

    def __init__(self, csv_path: str, label_col: str = "Inference",
                 class_names: dict | None = None, cache_dir: str = "data_cache",
                 dataset_name: str = "dataset"):
        self.csv_path = csv_path
        self.label_col = label_col
        self.class_names = class_names or {}
        self.dataset_name = dataset_name

        self.cache_dir = os.path.join(cache_dir, "pca_tsne", dataset_name)
        os.makedirs(self.cache_dir, exist_ok=True)
        self._pca_tsne_cache = {}          # in-memory layer, on top of the disk cache
        self._disk_lock = threading.Lock()

        self._df = None
        self._band_cols = []
        self.reload()

    # ------------------------------------------------------------------
    # Loading / reloading
    # ------------------------------------------------------------------
    def reload(self) -> None:
        """(Re)load the CSV from disk and invalidate the PCA/t-SNE cache --
        a growing dataset means old cached coordinates no longer reflect
        the full data, so they must not be silently served after a reload."""
        df = pd.read_csv(self.csv_path)
        if "SampleID" in df.columns:
            df = df.set_index("SampleID")
        self._df = df
        self._band_cols = sorted(
            [c for c in df.columns if c.startswith("band_")],
            key=lambda c: int(c.split("_")[1].split("-")[0])
        )
        self._pca_tsne_cache = {}
        print(f"[SpectralBandStore:{self.dataset_name}] loaded {len(df)} rows, "
              f"{len(self._band_cols)} band columns")

    def get_available_classes(self) -> list[dict]:
        """Unique class labels present in this dataset, with counts -- feeds
        the dynamic class checkboxes in the UI."""
        counts = self._df[self.label_col].value_counts()
        return [
            {"code": str(code), "label": self.class_names.get(code, str(code)), "count": int(n)}
            for code, n in counts.items()
        ]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _band_cols_limited(self, n_bands: int | None):
        if n_bands is None:
            return self._band_cols
        return self._band_cols[:n_bands]

    def _filtered(self, labels: list[str]):
        return self._df[self._df[self.label_col].isin(labels)]

    def _cache_key(self, labels: list[str]) -> str:
        raw = f"{self.dataset_name}|{','.join(sorted(labels))}"
        return hashlib.md5(raw.encode()).hexdigest()

    # ------------------------------------------------------------------
    # 1. Raw band values -- feeds Class Profile, Distribution (violin/box),
    #    and Heatmap plots. All three are computed client-side in JS/Plotly
    #    from this same payload; this method does no aggregation itself.
    # ------------------------------------------------------------------
    def get_raw_bands(self, labels: list[str], n_bands: int = 40,
                        max_per_class: int = 300, random_state: int = 42) -> dict:
        cols = self._band_cols_limited(n_bands)
        band_labels = [c.replace("band_", "").replace("Hz_pct", "") for c in cols]

        data = {}
        for label in labels:
            subset = self._df[self._df[self.label_col] == label]
            if len(subset) > max_per_class:
                subset = subset.sample(max_per_class, random_state=random_state)
            data[label] = {
                "sample_ids": subset.index.tolist(),
                "values": subset[cols].astype(float).values.tolist(),
            }

        return {
            "dataset": self.dataset_name,
            "band_labels": band_labels,
            "data": data,
        }

    # ------------------------------------------------------------------
    # 2. PCA / t-SNE -- the one genuinely expensive computation. Checked
    #    against an in-memory cache first, then an on-disk cache (survives
    #    process restarts), and only recomputed if neither has this exact
    #    (dataset, classes) combination yet.
    # ------------------------------------------------------------------
    def get_pca_tsne_coords(self, labels: list[str], n_bands: int = 100,
                              n_components: int = 3, tsne_perplexity: int = 30,
                              max_per_class: int = 300, force_recompute: bool = False,
                              random_state: int = 42) -> dict:
        key = self._cache_key(labels)

        if not force_recompute:
            if key in self._pca_tsne_cache:
                return self._pca_tsne_cache[key]
            disk_result = self._read_disk_cache(key)
            if disk_result is not None:
                self._pca_tsne_cache[key] = disk_result
                return disk_result

        result = self._compute_pca_tsne(
            labels, n_bands, n_components, tsne_perplexity, max_per_class, random_state
        )
        self._pca_tsne_cache[key] = result
        self._write_disk_cache(key, result)
        return result

    def _compute_pca_tsne(self, labels, n_bands, n_components, tsne_perplexity,
                            max_per_class, random_state):
        cols = self._band_cols_limited(n_bands)
        subset = self._filtered(labels)

        # cap per class for consistency with get_raw_bands, and to keep t-SNE fast
        parts = []
        for label in labels:
            class_df = subset[subset[self.label_col] == label]
            if len(class_df) > max_per_class:
                class_df = class_df.sample(max_per_class, random_state=random_state)
            parts.append(class_df)
        plot_df = pd.concat(parts, axis=0)

        X = plot_df[cols].astype(float).values
        y = plot_df[self.label_col].values
        X = StandardScaler().fit_transform(X)

        pca = PCA(n_components=n_components, random_state=random_state)
        X_pca = pca.fit_transform(X)
        explained_var = pca.explained_variance_ratio_.tolist()

        tsne = TSNE(n_components=n_components, perplexity=tsne_perplexity,
                     random_state=random_state, init="pca")
        X_tsne = tsne.fit_transform(X)

        result = {"dataset": self.dataset_name, "explained_variance": explained_var, "classes": {}}
        for label in labels:
            mask = y == label
            result["classes"][label] = {
                "sample_ids": plot_df.index[mask].tolist(),
                "pca": X_pca[mask].tolist(),
                "tsne": X_tsne[mask].tolist(),
            }
        return result

    # ------------------------------------------------------------------
    # Disk cache for PCA/t-SNE results -- survives process restarts, unlike
    # the in-memory dict alone. One small JSON file per cache_key.
    # ------------------------------------------------------------------
    def _disk_cache_path(self, key: str) -> str:
        return os.path.join(self.cache_dir, f"{key}.json")

    def _read_disk_cache(self, key: str):
        path = self._disk_cache_path(key)
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[SpectralBandStore] disk cache read failed for {key}: {e}")
            return None

    def _write_disk_cache(self, key: str, result: dict) -> None:
        def _write():
            with self._disk_lock:
                with open(self._disk_cache_path(key), "w", encoding="utf-8") as f:
                    json.dump(result, f)
        threading.Thread(target=_write).start()

    def clear_pca_tsne_cache(self) -> None:
        """Call after reload() if you want old disk-cached PCA/t-SNE results
        purged too, not just the in-memory layer."""
        self._pca_tsne_cache = {}
        for fname in os.listdir(self.cache_dir):
            if fname.endswith(".json"):
                os.remove(os.path.join(self.cache_dir, fname))