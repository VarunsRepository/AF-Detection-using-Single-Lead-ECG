
# Services/physionet_manager.py
import os
import urllib.request

#we've moved the entire logic of fetchign the physionet recordings from the app.py to this file
# we've used a class to prevent the use of free- floating variables in the global namespace

class PhysioNetRegistryManager:

    def __init__(self, cache_dir: str = "data_cache"):
        self.cache_dir = cache_dir
        self.csv_path = os.path.join(self.cache_dir, "REFERENCE-v2.csv")
        self._registry_cache = {}
        
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
        
        url = "https://physionet.org"
        try:
            opener = urllib.request.build_opener()
            opener.addheaders = [
                ('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            ]
            urllib.request.install_opener(opener)
            urllib.request.urlretrieve(url, self.csv_path)
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
