# Services/physionet_manager.py
import os
import urllib.request

import scipy.io
import numpy as np

import wfdb

#we've moved the entire logic of fetchign the physionet recordings from the app.py to this file
# we've used a class to prevent the use of free- floating variables in the global namespace

class PhysioNetRegistryManager:

    def __init__(self, cache_dir: str = "data_cache"):
        self.cache_dir = cache_dir
        self.csv_path = os.path.join(self.cache_dir, "REFERENCE-v2.csv")
        self._registry_cache = {}

        self._reverse_lookup_cache = None   # lazily built on first call to get_label_for_record()

    
        os.makedirs(self.cache_dir, exist_ok=True)

    def initialize_registry(self) -> None:
        """
        Public orchestration engine. 
        It only dictates the order of execution steps.
        """
        if self._registry_cache:
            return
            
        self._validate_and_clean_cache()
        self._ensure_file_exists()
        
        # Parse files and print diagnostics
        compiled_map, metrics = self._parse_csv_file()
        self._registry_cache = compiled_map
        self._print_diagnostic_logs(metrics)

    # ==========================================
    # PRIVATE DECOMPOSED STEPS (Helper Methods)
    # ==========================================

    def _validate_and_clean_cache(self) -> None:
        """Step 1: Check for corrupted HTML wrapper proxies."""
        if not os.path.exists(self.csv_path):
            return
            
        with open(self.csv_path, "r", encoding="utf-8", errors="ignore") as test_f:
            first_line = test_f.readline()
            if "<!DOCTYPE" in first_line or "<html" in first_line:
                print("\n[REGISTRY ENGINE] Detected corrupted HTML placeholder file. Purging cache...")
                os.remove(self.csv_path)

    def _ensure_file_exists(self) -> None:
        """Step 2: Handle raw web I/O down-streaming safely."""
        if os.path.exists(self.csv_path):
            return

        print("\n" + "="*55)
        print("[REGISTRY ENGINE] Fetching raw file matrix via download stream...")
        print("="*55)

        # The URL was "https://physionet.org" -- the HOMEPAGE, with no path.
        # urlretrieve happily saved that HTML as REFERENCE-v2.csv, the parser
        # found no N/A/O/~ labels in it, and every record came back
        # unclassified with nothing logged to say why.
        #
        # NOTE: a FREE PythonAnywhere account only reaches whitelisted
        # domains, through a proxy, so there this returns the proxy's error
        # page -- HTML again -- even with a correct URL. On a paid account
        # outbound access is unrestricted and this works; the guard below
        # still checks what arrived, because a 200 response proves nothing
        # about the body.
        url = ("https://physionet.org/files/challenge-2017/1.0.0/"
               "REFERENCE-v2.csv?download")
        try:
            opener = urllib.request.build_opener()
            opener.addheaders = [
                ('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            ]
            urllib.request.install_opener(opener)
            urllib.request.urlretrieve(url, self.csv_path)

            # Verify what actually arrived. A blocked or redirected request
            # returns HTML with a 200, so "the download succeeded" proves
            # nothing -- the file has to be inspected.
            with open(self.csv_path, "r", encoding="utf-8", errors="ignore") as fh:
                head = fh.readline()
            if "<" in head or "," not in head:
                os.remove(self.csv_path)
                raise IOError(
                    f"[REGISTRY ENGINE] Download did not return CSV (first line: "
                    f"{head[:60]!r}). On PythonAnywhere free tier outbound "
                    f"requests are proxied and physionet.org is not whitelisted "
                    f"-- upload REFERENCE-v2.csv to {self.csv_path} manually.")
            print("[REGISTRY ENGINE] Raw download stream pipe closed successfully.")
        except Exception as e:
            raise IOError(f"[REGISTRY ENGINE] CRITICAL: Download failed: {e}")

    def _parse_csv_file(self) -> tuple[dict, dict]:
        """Step 3: Extract structured rows from raw stream file block."""
        compiled_map = {"N": [], "A": [], "O": [], "~": []}
        metrics = {
            "total_lines": 0, "success": 0, "skipped": 0, "previews": []
        }

        with open(self.csv_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                metrics["total_lines"] += 1
                
                if len(metrics["previews"]) < 5:
                    metrics["previews"].append(line.replace("\n", "").replace("\r", ""))

                clean_line = line.replace("\r", "").replace("\n", "").strip()
                if not clean_line or "," not in clean_line: 
                    metrics["skipped"] += 1
                    continue
                    
                parts = clean_line.split(",", maxsplit=1)
                record, label = parts[0].strip(), parts[1].strip()
                
                if "," in label:
                    label = label.split(",")[0].strip()

                if label in compiled_map:
                    compiled_map[label].append(record)
                    metrics["success"] += 1
                else:
                    metrics["skipped"] += 1
                    
        # Zero parsed rows means the file is not the reference CSV. Silence
        # here is what let an HTML page masquerade as a label source: every
        # record stayed playable and every one reported no class.
        if metrics["success"] == 0:
            print("\n[REGISTRY ENGINE] *** NO LABELS PARSED *** from "
                  f"{self.csv_path} ({metrics['total_lines']} lines read). "
                  "Every record will report as unclassified. First lines:")
            for row in metrics["previews"]:
                print(f"    {row[:80]!r}")

        return compiled_map, metrics

    def _print_diagnostic_logs(self, metrics: dict) -> None:
        """Step 4: Output clean telemetry formatting logs to server."""
        print("\n" + "="*65)
        print("         PHYSIONET CHALLENGE 2017 REGISTRY DATA LOG         ")
        print("="*65)
        print(f" [FILE METRICS]")
        print(f"   -> Target Source Path:   {self.csv_path}")
        print(f"   -> Total Lines Found:    {metrics['total_lines']} rows")
        print(f"   -> Successfully Parsed:  {metrics['success']} rows")
        print(f"   -> Skipped / Ignored:    {metrics['skipped']} rows")
        print("-"*65)
        
        print(" [RAW FILE SAMPLES PREVIEW]")
        for idx, raw_row in enumerate(metrics["previews"], 1):
            print(f"   Row {idx} ->  \"{raw_row}\"")
        print("-"*65)
        
        print(" [MEMORY CATEGORY ALLOCATIONS]")
        for key, records in self._registry_cache.items():
            class_name = {
                "N": "Normal Sinus Rhythm (N)",
                "A": "Atrial Fibrillation (A)",
                "O": "Other Alternative (O)  ",
                "~": "Too Noisy / Corrupt (~) "
            }.get(key, key)
            
            pct = (len(records) / metrics["success"] * 100) if metrics["success"] > 0 else 0
            print(f"   -> {class_name} : {len(records):>4} items ({pct:>5.1f}%) | Samples: {records[:4]}")
        print("="*65 + "\n")

    # ==========================================
    # PUBLIC ACCESSORS
    # ==========================================
    def get_registry(self) -> dict:
        return self._registry_cache

    def get_records_by_class(self, target_class: str) -> list:
        return self._registry_cache.get(target_class, [])

    def get_individual_record(self, record_id: str) -> np.ndarray:
        """
        Checks local cache for a specific recording, downloads it if missing,
        and returns a normalized NumPy vector of signal voltages.
        """
        # Centralized path using the public instance property
        txt_filename = os.path.join(self.cache_dir, f"{record_id}.txt")
        
        if not os.path.exists(txt_filename):
            print(f"[MANAGER] Cache file missing for record {record_id}. Initiating streaming download...")
            folder_prefix = record_id[:3]
            
            # Direct PhysioNet Matrice URL Stream Endpoint
            url = f"https://physionet.org{folder_prefix}/{record_id}.mat?download"
            
            try:
                opener = urllib.request.build_opener()
                opener.addheaders = [('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')]
                urllib.request.install_opener(opener)
                
                temp_mat = os.path.join(self.cache_dir, f"temp_{record_id}.mat")
                urllib.request.urlretrieve(url, temp_mat)
                
                # Load the binary MATLAB array structure
                mat_data = scipy.io.loadmat(temp_mat)
                
                # Save out raw signal rows to a flat text cache file line by line
                with open(txt_filename, "w") as f:
                    f.write("\n".join(map(str, mat_data['val'][0])))
                    
                # Garbage clean the temporary download workspace buffer
                os.remove(temp_mat)
                print(f"[MANAGER] Successfully downloaded and cached recording: {record_id}")
            except Exception as e:
                raise IOError(f"PhysioNet Network/IO Failure for record {record_id}: {str(e)}")

        # 1. Read base signal matrix text lines
        raw_units = np.loadtxt(txt_filename)
        
        # 2. Divide by 1000.0 to rescale millivolt parameters
        signal_values = raw_units / 1000.0
        return signal_values

    # The older appraoch read the recording using Sci-pi's matlab parser
    # However it gave us considerable problems for file-IO so we swithced back to the Native WFDB parser
    def get_individual_record_wfdb(self, record_id: str) -> np.ndarray:

        """         
        Natively reads local .MAT and .HEA file pairs from the manual upload cache.
        Returns a perfectly calibrated 1D NumPy vector of signal voltages (mV).
        """
        mat_path = os.path.join(self.cache_dir, f"{record_id}.mat")
        hea_path = os.path.join(self.cache_dir, f"{record_id}.hea")
        
        if not os.path.exists(mat_path) or not os.path.exists(hea_path):
            raise FileNotFoundError(
                f"[MANAGER] Missing asset pairs for record '{record_id}' in cache directory. "
                f"Ensure both '{record_id}.mat' and '{record_id}.hea' are uploaded manually."
            )

        try:
            # wfdb requires only the shared base directory track name
            record_base_path = os.path.join(self.cache_dir, record_id)
            
            # Reads signal data automatically using structural parameters from header file
            signals, fields = wfdb.rdsamp(record_base_path)
            
            # Extracts single lead signal as flat 1D vector shape (N,)
            signal_values = signals[:, 0].astype(np.float64)
            return signal_values
            
        except Exception as e:
            raise IOError(f"[MANAGER] Native WFDB parsing error for record '{record_id}': {str(e)}")        


 
    # 2. NEW ADDITIONS FOR ACCESSING A RECORD FROM THE LABEL , alongside get_registry() / get_records_by_class()
    # ---------------------------------------------------------------------------
    
    def list_playable_records(self, limit: int | None = None) -> list[str]:
        """
        Returns record IDs that are ACTUALLY playable right now -- meaning both
        a .hea and .mat file physically exist in cache_dir. This is deliberately
        separate from the registry CSV: the registry knows about every record in
        the full challenge dataset, but only manually-uploaded records have real
        files to read. A record can be "known" without being "playable."
        """
        if not os.path.isdir(self.cache_dir):
            return []
    
        hea_ids = {os.path.splitext(f)[0] for f in os.listdir(self.cache_dir) if f.endswith(".hea")}
        mat_ids = {os.path.splitext(f)[0] for f in os.listdir(self.cache_dir) if f.endswith(".mat")}
    
        complete_ids = sorted(hea_ids & mat_ids)
        return complete_ids[:limit] if limit else complete_ids
    
    
    def get_label_for_record(self, record_id: str) -> str | None:
        """
        Looks up a record's true class label (N/A/O/~) from the registry.
        Builds a reverse lookup dict once, lazily, rather than scanning all
        four class lists on every single call -- matters once this gets called
        once per record in a batch (e.g. building the Shorts feed's card list).
        """
        if self._reverse_lookup_cache is None:
            self._reverse_lookup_cache = {
                record_id: label
                for label, records in self._registry_cache.items()
                for record_id in records
            }
        return self._reverse_lookup_cache.get(record_id)  # None if not in the registry at all
    
    
    def list_playable_records_with_labels(self, limit: int | None = None) -> list[dict]:
        """
        The one method the Shorts feed actually wants: playable records (file
        exists) enriched with their true label (if the registry knows it).
        label will be None for a file that exists but isn't in the reference
        CSV -- worth surfacing that as a flag rather than hiding it, since it's
        a genuine data-quality gap, not something to silently paper over.
        """
        playable_ids = self.list_playable_records(limit=limit)
        return [
            {"record_id": rid, "label": self.get_label_for_record(rid)}
            for rid in playable_ids
        ]

     
    def list_playable_records(self, limit: int | None = None, offset: int = 0) -> list[str]:
        """
        Returns record IDs that are ACTUALLY playable right now -- meaning both
        a .hea and .mat file physically exist in cache_dir. This is deliberately
        separate from the registry CSV: the registry knows about every record in
        the full challenge dataset, but only manually-uploaded records have real
        files to read. A record can be "known" without being "playable."
        `offset` supports real pagination -- not just a bigger fixed limit.
        """
        if not os.path.isdir(self.cache_dir):
            return []
    
        hea_ids = {os.path.splitext(f)[0] for f in os.listdir(self.cache_dir) if f.endswith(".hea")}
        mat_ids = {os.path.splitext(f)[0] for f in os.listdir(self.cache_dir) if f.endswith(".mat")}
    
        complete_ids = sorted(hea_ids & mat_ids)
        sliced = complete_ids[offset:]
        return sliced[:limit] if limit else sliced
    
    
    def get_label_for_record(self, record_id: str) -> str | None:
        """
        Looks up a record's true class label (N/A/O/~) from the registry.
        Builds a reverse lookup dict once, lazily, rather than scanning all
        four class lists on every single call -- matters once this gets called
        once per record in a batch (e.g. building the Shorts feed's card list).
        """
        if self._reverse_lookup_cache is None:
            self._reverse_lookup_cache = {
                record_id: label
                for label, records in self._registry_cache.items()
                for record_id in records
            }
        return self._reverse_lookup_cache.get(record_id)  # None if not in the registry at all
    
    
    def list_playable_records_with_labels(self, limit: int | None = None, offset: int = 0) -> list[dict]:
        """
        The one method the Shorts feed actually wants: playable records (file
        exists) enriched with their true label (if the registry knows it).
        label will be None for a file that exists but isn't in the reference
        CSV -- worth surfacing that as a flag rather than hiding it, since it's
        a genuine data-quality gap, not something to silently paper over.
        """
        playable_ids = self.list_playable_records(limit=limit, offset=offset)
        return [
            {"record_id": rid, "label": self.get_label_for_record(rid)}
            for rid in playable_ids
        ]
    
    
    def count_playable_records(self) -> int:
        """Total number of playable records, so the frontend knows when it's
        genuinely reached the end and should stop requesting more pages."""
        return len(self.list_playable_records())