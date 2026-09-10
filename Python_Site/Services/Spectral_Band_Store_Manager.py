# to get individual class objects we need to 
# which means we will have 1 object for datasets/CSVs   
from Services.Spectral_Band_Store import SpectralBandStore



class SpectralBandStoreManager:
    """
    Owns every SpectralBandStore instance (one per dataset/CSV) and is the
    single place that knows how to look one up by name. Individual stores
    don't know about each other or about datasets in general -- that's this
    manager's job, same role ECG_Signal_Feature_Manager plays for the JSON
    feature store, just for bulk band data across possibly several CSVs.
 
    Deliberately framework-agnostic: no jsonify(), no HTTP status codes in
    here. get_or_error() returns a plain (store, error_string) tuple; the
    route layer decides what HTTP status that error becomes.
    """
 
    def __init__(self):
        self._stores: dict[str, SpectralBandStore] = {}
 
    def register(self, dataset_name: str, store: SpectralBandStore) -> None:
        self._stores[dataset_name] = store
 
    def get(self, dataset_name: str) -> SpectralBandStore | None:
        return self._stores.get(dataset_name)
 
    def get_or_error(self, dataset_name: str):
        store = self._stores.get(dataset_name)
        if store is None:
            return None, f"Unknown dataset '{dataset_name}'"
        return store, None
 
    def list_datasets(self) -> list[str]:
        return list(self._stores.keys())
 
    def reload_all(self) -> None:
        for store in self._stores.values():
            store.reload()
 