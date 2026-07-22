import os
import json
import threading

# As we move further, the app needs to store the discovered features such as the HRV stats, VIX etc.
# we would store those features in a JSON file for now. We need a well defined method for Creating/Updating/Reading
# those feaures. We have this JSON file which would servr this purpose.
# currently we will add everything in this JSON and JSON would be loaded on the server's memory. THis would ensure that 
# Access is lightening fast. Rather thah having an individual feature file for all the features, we shall haev a collective file
# since readin 1 file is quicker than reading 8.5K+ files. 
# Later on, when the app grows and we have more ECG Leads and more metrics, we will move this file to a MongoDB Cloud.
# This would ensure seamless integration without and change the access API.


class ECG_Signal_Feature_Manager:

    #default constructor to Manage initilization
    def __init__(self, cache_dir: str = "data_cache"):
        self.cache_dir = cache_dir
        self.json_path = os.path.join(self.cache_dir, "all_features_JSON_database.json")
        
        # Initialize the isolated in-memory RAM cache
        self._ram_store = {}
        # Thread lock dedicated entirely to this JSON file's disk operations
        self._disk_lock = threading.Lock()
        
        os.makedirs(self.cache_dir, exist_ok=True)
        # Automatically seed the RAM cache on instantiation
        self._load_database_into_ram()

# standardCRUD OPERATIONS below 
    def _load_database_into_ram(self) -> None:
        """Private startup method: Maps the disk dataset into active server memory."""
        if os.path.exists(self.json_path):
            try:
                with open(self.json_path, "r", encoding="utf-8") as f:
                    self._ram_store = json.load(f)
                print(f"🤖 [FEATURE MGR] Loaded {len(self._ram_store)} records into active RAM.")
            except Exception as e:
                print(f"🚨 FEATURE MGR Error reading disk file, starting empty: {e}")
                self._ram_store = {}
        else:
            print("📝 [FEATURE MGR] No existing database file found. Initializing empty state.")
            self._ram_store = {}

    def get_metric(self, record_id: str, stat_name: str, version: str) -> dict | None:
        """Public Reader: Fetches data straight from RAM in microseconds."""
        
        print(f"inside ECG_Signal_Feature_Manager.get_metric(), search for metric {record_id}, {stat_name}, {version}")
        if record_id in self._ram_store:
            record_data = self._ram_store[record_id]
            if stat_name in record_data and record_data[stat_name].get("version") == version:
                return {
                    "record_id": record_id,
                    "statistic_name": stat_name,
                    "value": record_data[stat_name]["value"],
                    "version": version,
                    "last_calculated": record_data[stat_name].get("last_calculated")
                }
        return None

    def update_metric(self, record_id: str, stat_name: str, value: any, version: str, timestamp: str) -> None:
        """Public Writer: Updates live RAM and triggers a safe background write to disk."""
        if record_id not in self._ram_store:
            self._ram_store[record_id] = {}
            
        self._ram_store[record_id][stat_name] = {
            "value": value,
            "version": version,
            "last_calculated": timestamp
        }
        
        # Fire-and-forget background thread to handle disk saving asynchronously
        threading.Thread(target=self._persist_to_disk).start()

    def _persist_to_disk(self) -> None:
        """Private Worker: Safely flushes the memory structure back to the physical drive."""
        with self._disk_lock:
            with open(self.json_path, "w", encoding="utf-8") as f:
                json.dump(self._ram_store, f, indent=4)


    # this function will rubber stamp a config for a record, when the user hits the rubber stamp button
    def rubber_stamp_record_config(self, record_id: str, verified_signature: str) -> None:
        """
        Locks down a specific configuration signature alongside an audit timestamp and bypasses raw telemetry variations to protect Stage 2 CNN pipelines.
        """
        from datetime import datetime, timezone
        
        if record_id not in self._ram_store:
            self._ram_store[record_id] = {}
            
        # Get current UTC timestamp with explicit timezone markers
        current_utc_time = datetime.now(timezone.utc).isoformat() 
            
        #upgrade successfully -  Storethis as  a nested tracking metadata object rather than a flat string
        self._ram_store[record_id]["verified_orientation_config"] = {
            "signature": verified_signature,
            "stamped_at": current_utc_time
        }
        
        # Flush the updated tracking matrix back to the master JSON file on disk
        threading.Thread(target=self._persist_to_disk).start()
        print(f"[TULD ENGINE] Ground Truth locked for {record_id} -> {verified_signature} at {current_utc_time}")

    # this fnction will read the current record's rubber stamp
    def get_rubber_stamp_config(self, record_id: str) -> dict | None:
        """Public Reader: Safely fetches the stamp metadata from RAM."""
        record_data = self._ram_store.get(record_id, {})
        stamp_data = record_data.get("verified_orientation_config", None)

        if isinstance(stamp_data, dict):
            return {
                "record_id": record_id,
                "is_verified": True,
                "verified_signature": stamp_data["signature"],
                "stamped_at": stamp_data.get("stamped_at")
            }
