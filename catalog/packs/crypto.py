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


# SHA-1. A HASH, not a cipher: no key, no inverse, any input length
# collapses to 160 bits. Domain "crypto.sha1" keeps cipher blocks out of
# it -- a plaintext/key pair is not a message.
dsp("sha1_hash",
    entrypoint="/static/shorts/filters/sha1_filter.js",
    label="SHA-1",
    description="80 rounds in four groups; verified against FIPS-180 digests",
    requires = {"fields": ["arrays.message"], "fs_required": False,
                "domains": ["crypto.sha1"]},
    provides = {"fields": ["interimOutputs", "finalOutput.digest",
                           "finalOutput.blocks", "finalOutput.avalancheBits"],
                "fs": None, "domain": "crypto.sha1"})

renderer("sha1_state_view",
    entrypoint="/static/shorts/renderers/sha1_state_view.js",
    label="SHA-1 state",
    description="Five 32-bit words as bit rows; changed bits outlined",
    requires = {"fields": ["interimOutputs"]})
