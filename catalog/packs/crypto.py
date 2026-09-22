# ---------------------------------------------------------------------------
# catalog/packs/crypto.py
#
# Cryptography components. Small today; SHA-256, SHA-1 and MD5
# land here alongside AES.
# ---------------------------------------------------------------------------

from catalog.registry import dsp, renderer

dsp("aes128_encrypt",
    entrypoint="/static/shorts/filters/aes128_filter.js",
    label="AES-128", description="Key expansion and encryption, verified against FIPS-197",
    requires = {"fields": ["arrays.plaintext", "arrays.key"],
                "fs_required": False, "domains": ["crypto.aes"]},
    provides = {"fields": ["interimOutputs",
                           "finalOutput.ciphertext",
                           "finalOutput.ciphertextHex",
                           "finalOutput.roundKeys"],
                "fs": None, "domain": "crypto.aes"})

renderer("aes_state_grid",
    entrypoint="/static/shorts/renderers/aes_state_grid.js",
    label="AES State Grid", description="4x4 byte grid stepping through interim states",
    requires = {"fields": ["interimOutputs"]})


# A 16-bit SPN -- the structure AES is built from, shrunk until every bit
# fits on screen. Domain "crypto.spn" rather than "crypto.aes": they
# share a shape but not a block size or data format, and a schema that
# conflated them would let AES data reach this DSPE.
dsp("spn_cipher",
    entrypoint="/static/shorts/filters/spn_cipher_filter.js",
    label="16-bit SPN",
    description="Heys' cipher -- substitution-permutation network, 4 rounds",
    requires = {"fields": ["arrays.plaintext", "arrays.key"],
                "fs_required": False, "domains": ["crypto.spn"]},
    provides = {"fields": ["interimOutputs", "finalOutput.ciphertextHex",
                           "finalOutput.roundKeys", "finalOutput.perm",
                           "finalOutput.avalancheBits"],
                "fs": None, "domain": "crypto.spn"})

renderer("spn_bits_view",
    entrypoint="/static/shorts/renderers/spn_bits_view.js",
    label="SPN Bits",
    description="All 16 bits as cells; permutation drawn as wires",
    requires = {"fields": ["interimOutputs"]})
