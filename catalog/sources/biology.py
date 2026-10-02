# ---------------------------------------------------------------------------
# catalog/sources/biology.py
#
# Scenarios rather than recordings: each "sample" is a set of conditions
# for the electron transport chain -- what enters it, and what (if
# anything) is poisoning it.
# ---------------------------------------------------------------------------

from Services.data_source_store import data_source_store

ETS_SCENARIOS = {
    "ets_nadh":      {"entryPoint": "NADH",
                      "note": "NADH entering at Complex I -- the normal route"},
    "ets_succinate": {"entryPoint": "succinate",
                      "note": "FADH2 entering at Complex II -- skips the first pump"},
    "ets_cyanide":   {"entryPoint": "NADH", "inhibitor": "cyanide",
                      "note": "Cyanide on Complex IV -- the whole chain stops"},
    "ets_rotenone":  {"entryPoint": "NADH", "inhibitor": "rotenone",
                      "note": "Rotenone on Complex I -- blocked at the entrance"},
    "ets_antimycin": {"entryPoint": "NADH", "inhibitor": "antimycin",
                      "note": "Antimycin on Complex III -- blocked in the middle"},
    "ets_uncoupled": {"entryPoint": "NADH", "uncoupled": True,
                      "note": "DNP: electrons flow, protons leak back, heat not ATP"},
}


def _ets_provider(sample_id: str) -> dict:
    s = ETS_SCENARIOS.get(sample_id)
    if s is None:
        raise FileNotFoundError(sample_id)
    # The conditions ride in META, not arrays -- there is no signal here,
    # only a configuration. The DSPE computes the chain from constants.
    return {"arrays": {"scenario": [1]}, "meta": dict(s)}


def _ets_lister(limit: int, offset: int) -> dict:
    ids = list(ETS_SCENARIOS.keys())
    page = ids[offset:offset + limit]
    return {"samples": [{"record_id": i, "label": ETS_SCENARIOS[i]["note"]}
                        for i in page],
            "total": len(ids), "offset": offset}


data_source_store.register("ets_scenario",
    provider      = _ets_provider,
    lister        = _ets_lister,
    adapter       = "multi_to_arrays",
    primary_field = "scenario",
    fs_field      = None,
    label         = "ETS scenario",
    description   = "Entry point and inhibitor for the electron transport chain",
    schema        = {"fields": ["meta.entryPoint"],
                     "fs": None, "domain": "biology.metabolism"})


# ── Photosynthesis scenarios ────────────────────────────────────────────
# A pathway plus the conditions it is facing. The pairs matter more than
# any single card: C3 and C4 at the same temperature, or CAM by night and
# by day, are where the reason for three pathways becomes visible.
PHOTO_SCENARIOS = {
    "photo_c3_mild":   {"pathway": "C3",  "temperatureC": 18,
                        "note": "C3 in cool weather -- the cheapest option there is"},
    "photo_c3_hot":    {"pathway": "C3",  "temperatureC": 38,
                        "note": "C3 in heat -- RuBisCO grabs more oxygen as it warms"},
    "photo_c3_drought":{"pathway": "C3",  "temperatureC": 38, "drought": True,
                        "note": "C3 in drought -- stomata shut and fixation collapses"},
    "photo_c4_hot":    {"pathway": "C4",  "temperatureC": 38,
                        "note": "C4 in heat -- CO2 concentrated in a second cell type"},
    "photo_c4_mild":   {"pathway": "C4",  "temperatureC": 18,
                        "note": "C4 in cool weather -- paying for a pump it barely needs"},
    "photo_cam_night": {"pathway": "CAM", "temperatureC": 22, "night": True,
                        "note": "CAM at night -- stomata open in the cool, malate stored"},
    "photo_cam_day":   {"pathway": "CAM", "temperatureC": 40,
                        "note": "CAM by day -- stomata shut, running on the night's store"},
    "photo_cam_drought":{"pathway": "CAM","temperatureC": 45, "drought": True,
                        "note": "CAM in drought -- barely affected, which is the point"},
}


def _photo_provider(sample_id: str) -> dict:
    s = PHOTO_SCENARIOS.get(sample_id)
    if s is None:
        raise FileNotFoundError(sample_id)
    return {"arrays": {"scenario": [1]}, "meta": dict(s)}


def _photo_lister(limit: int, offset: int) -> dict:
    ids = list(PHOTO_SCENARIOS.keys())
    page = ids[offset:offset + limit]
    return {"samples": [{"record_id": i, "label": PHOTO_SCENARIOS[i]["note"]}
                        for i in page],
            "total": len(ids), "offset": offset}


data_source_store.register("photo_scenario",
    provider      = _photo_provider,
    lister        = _photo_lister,
    adapter       = "multi_to_arrays",
    primary_field = "scenario",
    fs_field      = None,
    label         = "Photosynthesis scenario",
    description   = "A pathway (C3/C4/CAM) and the conditions it faces",
    schema        = {"fields": ["meta.pathway"],
                     "fs": None, "domain": "biology.photosynthesis"})


# ── Pathways, in SBML's shape ───────────────────────────────────────────
# Two flat lists and no ordering: the sequence emerges from shared species
# names, exactly as SBML does it. `boundary` marks species the model does
# not track (SBML's boundaryCondition) -- water, NAD+, CoA. `formula`
# where given lets the DSPE atom-balance the reaction.
_TCA = {
    "name": "Citric acid cycle", "start": "oxaloacetate",
    # Succinate dehydrogenase -- what malonate inhibits, the classic
    # demonstration of competitive inhibition.
    "defaultBlock": "sdh",
    "species": {
        "oxaloacetate": {"name": "Oxaloacetate",    "formula": "C4H4O5"},
        "citrate":      {"name": "Citrate",         "formula": "C6H8O7"},
        "isocitrate":   {"name": "Isocitrate",      "formula": "C6H8O7"},
        "alphaKG":      {"name": "a-Ketoglutarate", "formula": "C5H6O5"},
        "succinylCoA":  {"name": "Succinyl-CoA"},
        "succinate":    {"name": "Succinate",       "formula": "C4H6O4"},
        "fumarate":     {"name": "Fumarate",        "formula": "C4H4O4"},
        "malate":       {"name": "Malate",          "formula": "C4H6O5"},
        "acetylCoA": {"name": "Acetyl-CoA", "boundary": True},
        "water": {"name": "H2O", "formula": "H2O", "boundary": True},
        "co2":   {"name": "CO2", "formula": "CO2", "boundary": True},
        "nad":   {"name": "NAD+",  "boundary": True},
        "nadh":  {"name": "NADH",  "boundary": True},
        "fad":   {"name": "FAD",   "boundary": True},
        "fadh2": {"name": "FADH2", "boundary": True},
        "coa":   {"name": "CoA",   "boundary": True},
        "gdp":   {"name": "GDP",   "boundary": True},
        "gtp":   {"name": "GTP",   "boundary": True},
        "pi":    {"name": "Pi",    "boundary": True},
    },
    "reactions": [
        {"id": "cs",  "name": "Citrate synthase",
         "reactants": {"oxaloacetate": 1, "acetylCoA": 1, "water": 1},
         "products": {"citrate": 1, "coa": 1}},
        {"id": "aco", "name": "Aconitase",
         "reactants": {"citrate": 1}, "products": {"isocitrate": 1}},
        {"id": "idh", "name": "Isocitrate dehydrogenase",
         "reactants": {"isocitrate": 1, "nad": 1},
         "products": {"alphaKG": 1, "co2": 1, "nadh": 1}},
        {"id": "kgd", "name": "a-KG dehydrogenase",
         "reactants": {"alphaKG": 1, "nad": 1, "coa": 1},
         "products": {"succinylCoA": 1, "co2": 1, "nadh": 1}},
        {"id": "scs", "name": "Succinyl-CoA synthetase",
         "reactants": {"succinylCoA": 1, "gdp": 1, "pi": 1},
         "products": {"succinate": 1, "coa": 1, "gtp": 1}},
        {"id": "sdh", "name": "Succinate dehydrogenase",
         "reactants": {"succinate": 1, "fad": 1},
         "products": {"fumarate": 1, "fadh2": 1}},
        {"id": "fum", "name": "Fumarase",
         "reactants": {"fumarate": 1, "water": 1}, "products": {"malate": 1}},
        {"id": "mdh", "name": "Malate dehydrogenase",
         "reactants": {"malate": 1, "nad": 1},
         "products": {"oxaloacetate": 1, "nadh": 1}},
    ],
}

# A LINEAR pathway, to prove the renderer picks its layout from the
# topology rather than a setting: this one never returns to its start.
_GLYCOLYSIS_UPPER = {
    "name": "Glycolysis (upper half)", "start": "glucose",
    "defaultBlock": "pfk",
    "species": {
        "glucose":     {"name": "Glucose",      "formula": "C6H12O6"},
        "glucose6P":   {"name": "Glucose-6-P"},
        "fructose6P":  {"name": "Fructose-6-P"},
        "fructose16BP":{"name": "Fructose-1,6-BP"},
        "atp": {"name": "ATP", "boundary": True},
        "adp": {"name": "ADP", "boundary": True},
    },
    "reactions": [
        {"id": "hk",  "name": "Hexokinase",
         "reactants": {"glucose": 1, "atp": 1}, "products": {"glucose6P": 1, "adp": 1}},
        {"id": "pgi", "name": "Phosphoglucose isomerase",
         "reactants": {"glucose6P": 1}, "products": {"fructose6P": 1}},
        {"id": "pfk", "name": "Phosphofructokinase",
         "reactants": {"fructose6P": 1, "atp": 1},
         "products": {"fructose16BP": 1, "adp": 1}},
    ],
}


# Full glycolysis: glucose -> 2 pyruvate, ten reactions.
# A CHAIN, not a cycle -- and a good test of that, since the walk must
# handle aldolase's branch (one substrate, two different products).
_GLYCOLYSIS = {
    "name": "Glycolysis", "start": "glucose",
    # CONDITIONS: the ten reactions above pyruvate are shared; only
    # pyruvate's FATE differs, and it differs for a REASON -- oxygen, and
    # which organism. Reactions carry `when` rather than a group label,
    # so yeast-versus-muscle falls out of two variables instead of
    # needing a third invented category.
    # RUNS: how many times a reaction occurs per molecule of the starting
    # substrate. Glycolysis splits into TWO three-carbon molecules, so
    # everything below aldolase happens twice per glucose. The walk still
    # visits each reaction once -- this is for the cofactor TALLY only.
    # Without it the books' "net 2 ATP" comes out as 0.
    "conditions": {
        "oxygen":   {"label": "Oxygen", "values": [1, 0], "default": 1,
                     "display": {"1": "present", "0": "absent"}},
        "organism": {"label": "Organism", "values": ["human", "yeast"],
                     "default": "human"},
    },
    # Phosphofructokinase: the committed step, and the real regulatory
    # point -- everything before it is still reversible.
    "defaultBlock": "pfk",
    "species": {
        "glucose":  {"name": "Glucose",         "formula": "C6H12O6"},
        "g6p":      {"name": "Glucose-6-P",     "formula": "C6H13O9P"},
        "f6p":      {"name": "Fructose-6-P",    "formula": "C6H13O9P"},
        "f16bp":    {"name": "Fructose-1,6-BP", "formula": "C6H14O12P2"},
        "dhap":     {"name": "DHAP",            "formula": "C3H7O6P"},
        "gap":      {"name": "GAP",             "formula": "C3H7O6P"},
        "bpg13":    {"name": "1,3-BPG",         "formula": "C3H8O10P2"},
        "pg3":      {"name": "3-P-glycerate",   "formula": "C3H7O7P"},
        "pg2":      {"name": "2-P-glycerate",   "formula": "C3H7O7P"},
        "pep":      {"name": "PEP",             "formula": "C3H5O6P"},
        "pyruvate": {"name": "Pyruvate",        "formula": "C3H4O3"},
        "lactate":      {"name": "Lactate", "formula": "C3H6O3"},
        "acetaldehyde": {"name": "Acetaldehyde", "formula": "C2H4O"},
        "ethanol":      {"name": "Ethanol", "formula": "C2H6O"},
        "acetylCoA": {"name": "Acetyl-CoA"},
        "water": {"name": "H2O", "formula": "H2O", "boundary": True},
        "atp":  {"name": "ATP",  "boundary": True},
        "adp":  {"name": "ADP",  "boundary": True},
        "nad":  {"name": "NAD+", "boundary": True},
        "nadh": {"name": "NADH", "boundary": True},
        "pi":   {"name": "Pi",   "boundary": True},
        "coa":  {"name": "CoA",  "boundary": True},
        "co2":  {"name": "CO2", "formula": "CO2", "boundary": True},
        "amp":  {"name": "AMP", "boundary": True},
    },
    "reactions": [
        {"id": "hk",   "name": "Hexokinase",
         "reactants": {"glucose": 1, "atp": 1}, "products": {"g6p": 1, "adp": 1}},
        {"id": "pgi",  "name": "Phosphoglucose isomerase",
         "reactants": {"g6p": 1}, "products": {"f6p": 1}},
        {"id": "pfk",  "name": "Phosphofructokinase",
         # The committed step, and the regulated one: ATP inhibits it and
         # AMP relieves that inhibition, so the cell stops making ATP when
         # it already has plenty. SBML calls these listOfModifiers.
         "modifiers": [{"species": "atp", "role": "inhibitor"},
                       {"species": "amp", "role": "activator"}],
         "reactants": {"f6p": 1, "atp": 1}, "products": {"f16bp": 1, "adp": 1}},
        {"id": "ald",  "name": "Aldolase",
         "reactants": {"f16bp": 1}, "products": {"dhap": 1, "gap": 1}},
        {"id": "tpi",  "name": "Triose-P isomerase",
         "reactants": {"dhap": 1}, "products": {"gap": 1}},
        {"id": "gapdh", "runs": 2, "name": "GAPDH",
         "reactants": {"gap": 1, "nad": 1, "pi": 1},
         "products": {"bpg13": 1, "nadh": 1}},
        {"id": "pgk", "runs": 2, "name": "Phosphoglycerate kinase",
         "reactants": {"bpg13": 1, "adp": 1}, "products": {"pg3": 1, "atp": 1}},
        {"id": "pgm", "runs": 2, "name": "Phosphoglycerate mutase",
         "reactants": {"pg3": 1}, "products": {"pg2": 1}},
        {"id": "eno", "runs": 2, "name": "Enolase",
         "reactants": {"pg2": 1}, "products": {"pep": 1, "water": 1}},
        {"id": "pk", "runs": 2,   "name": "Pyruvate kinase",
         "reactants": {"pep": 1, "adp": 1}, "products": {"pyruvate": 1, "atp": 1}},

        # The fork. Same pyruvate, two fates -- and note that lactate
        # dehydrogenase exists to REGENERATE NAD+, not to make lactate:
        # without it glycolysis stalls at GAPDH within seconds.
        {"id": "pdh", "runs": 2, "name": "Pyruvate dehydrogenase",
         "when": "oxygen > 0",
         "reactants": {"pyruvate": 1, "nad": 1, "coa": 1},
         "products": {"acetylCoA": 1, "co2": 1, "nadh": 1}},
        {"id": "ldh", "runs": 2, "name": "Lactate dehydrogenase",
         "when": "oxygen == 0 && organism == 'human'",
         "reactants": {"pyruvate": 1, "nadh": 1},
         "products": {"lactate": 1, "nad": 1}},

        # Alcoholic fermentation: TWO reactions, and yeast only. All three
        # fates exist to regenerate NAD+ so glycolysis can keep running --
        # lactate does it in one step, ethanol in two. That contrast is
        # the lesson, and it only shows because the trunk is shared.
        {"id": "pdc", "runs": 2, "name": "Pyruvate decarboxylase",
         "when": "oxygen == 0 && organism == 'yeast'",
         "reactants": {"pyruvate": 1},
         "products": {"acetaldehyde": 1, "co2": 1}},
        {"id": "adh", "runs": 2, "name": "Alcohol dehydrogenase",
         "when": "oxygen == 0 && organism == 'yeast'",
         "reactants": {"acetaldehyde": 1, "nadh": 1},
         "products": {"ethanol": 1, "nad": 1}},
    ],
}


# ── Calvin cycle ────────────────────────────────────────────────────────
# Regeneration is LUMPED. The real path from G3P back to ribulose-5-P
# takes seven reactions and three turns of the cycle to balance; showing
# them would bury the idea. Ru5P deliberately carries no formula, so the
# lumped step reports UNCHECKED rather than pretending to balance.
_CALVIN = {
    "name": "Calvin cycle", "start": "rubp", "defaultBlock": "prk",
    "species": {
        "rubp":  {"name": "RuBP",        "formula": "C5H12O11P2"},
        "pga3":  {"name": "3-PGA",       "formula": "C3H7O7P"},
        "bpg13": {"name": "1,3-BPG",     "formula": "C3H8O10P2"},
        "g3p":   {"name": "G3P",         "formula": "C3H7O6P"},
        "ru5p":  {"name": "Ribulose-5-P"},
        "co2":   {"name": "CO2",  "formula": "CO2", "boundary": True},
        "water": {"name": "H2O",  "formula": "H2O", "boundary": True},
        "atp":   {"name": "ATP",   "boundary": True},
        "adp":   {"name": "ADP",   "boundary": True},
        "nadph": {"name": "NADPH", "boundary": True},
        "nadp":  {"name": "NADP+", "boundary": True},
        "pi":    {"name": "Pi", "formula": "H3O4P", "boundary": True},
    },
    "reactions": [
        {"id": "rubisco", "name": "RuBisCO",
         "reactants": {"rubp": 1, "co2": 1, "water": 1},
         "products": {"pga3": 2}},
        {"id": "pgk", "name": "Phosphoglycerate kinase",
         "reactants": {"pga3": 1, "atp": 1}, "products": {"bpg13": 1, "adp": 1}},
        {"id": "gapdh", "name": "G3P dehydrogenase",
         "reactants": {"bpg13": 1, "nadph": 1},
         "products": {"g3p": 1, "nadp": 1, "pi": 1}},
        {"id": "regen", "name": "Regeneration (lumped)",
         "reactants": {"g3p": 1}, "products": {"ru5p": 1}},
        {"id": "prk", "name": "Phosphoribulokinase",
         "reactants": {"ru5p": 1, "atp": 1}, "products": {"rubp": 1, "adp": 1}},
    ],
}

# ── Urea cycle ──────────────────────────────────────────────────────────
# Spans two compartments: the first two reactions are mitochondrial, the
# rest cytosolic. Arginase closes the ring by regenerating ornithine --
# the carrier, not the product. Urea is what leaves.
_UREA = {
    "name": "Urea cycle", "start": "ornithine", "defaultBlock": "otc",
    "species": {
        "ornithine":  {"name": "Ornithine",         "formula": "C5H12N2O2"},
        "citrulline": {"name": "Citrulline",        "formula": "C6H13N3O3"},
        "argsucc":    {"name": "Argininosuccinate", "formula": "C10H18N4O6"},
        "arginine":   {"name": "Arginine",          "formula": "C6H14N4O2"},
        "carbamoylP": {"name": "Carbamoyl-P",       "formula": "CH4NO5P"},
        "urea":     {"name": "Urea",     "formula": "CH4N2O",  "boundary": True},
        "fumarate": {"name": "Fumarate", "formula": "C4H4O4",  "boundary": True},
        "aspartate":{"name": "Aspartate","formula": "C4H7NO4", "boundary": True},
        "ammonia":  {"name": "NH3", "formula": "H3N",   "boundary": True},
        "co2":      {"name": "CO2", "formula": "CO2",   "boundary": True},
        "water":    {"name": "H2O", "formula": "H2O",   "boundary": True},
        "pi":       {"name": "Pi",  "formula": "H3O4P", "boundary": True},
        "atp": {"name": "ATP", "boundary": True},
        "adp": {"name": "ADP", "boundary": True},
        "amp": {"name": "AMP", "boundary": True},
    },
    "reactions": [
        {"id": "cps1", "name": "Carbamoyl-P synthetase I",
         "reactants": {"ammonia": 1, "co2": 1, "atp": 2},
         "products": {"carbamoylP": 1, "adp": 2}},
        {"id": "otc", "name": "Ornithine transcarbamylase",
         "reactants": {"ornithine": 1, "carbamoylP": 1},
         "products": {"citrulline": 1, "pi": 1}},
        {"id": "ass", "name": "Argininosuccinate synthetase",
         "reactants": {"citrulline": 1, "aspartate": 1, "atp": 1},
         "products": {"argsucc": 1, "amp": 1}},
        {"id": "asl", "name": "Argininosuccinate lyase",
         "reactants": {"argsucc": 1},
         "products": {"arginine": 1, "fumarate": 1}},
        {"id": "arg", "name": "Arginase",
         "reactants": {"arginine": 1, "water": 1},
         "products": {"urea": 1, "ornithine": 1}},
    ],
}

# ── Beta-oxidation ──────────────────────────────────────────────────────
# A cycle with a twist: the walk returns to acyl-CoA, but the molecule
# is TWO CARBONS SHORTER each turn. The ring closes chemically while the
# substrate shrinks -- a spiral drawn as a circle. CoA-bound species
# carry no formula (the thioester is large), so every reaction here
# reports UNCHECKED, honestly.
_BETA_OX = {
    "name": "Beta-oxidation", "start": "acylCoA", "defaultBlock": "thiolase",
    "species": {
        "acylCoA":    {"name": "Acyl-CoA"},
        "enoylCoA":   {"name": "trans-Enoyl-CoA"},
        "hydroxyCoA": {"name": "3-Hydroxyacyl-CoA"},
        "ketoCoA":    {"name": "3-Ketoacyl-CoA"},
        "acetylCoA": {"name": "Acetyl-CoA", "boundary": True},
        "water": {"name": "H2O", "formula": "H2O", "boundary": True},
        "fad":   {"name": "FAD",   "boundary": True},
        "fadh2": {"name": "FADH2", "boundary": True},
        "nad":   {"name": "NAD+",  "boundary": True},
        "nadh":  {"name": "NADH",  "boundary": True},
        "coa":   {"name": "CoA",   "boundary": True},
    },
    "reactions": [
        {"id": "acd", "name": "Acyl-CoA dehydrogenase",
         "reactants": {"acylCoA": 1, "fad": 1},
         "products": {"enoylCoA": 1, "fadh2": 1}},
        {"id": "ech", "name": "Enoyl-CoA hydratase",
         "reactants": {"enoylCoA": 1, "water": 1},
         "products": {"hydroxyCoA": 1}},
        {"id": "hadh", "name": "3-Hydroxyacyl-CoA dehydrogenase",
         "reactants": {"hydroxyCoA": 1, "nad": 1},
         "products": {"ketoCoA": 1, "nadh": 1}},
        {"id": "thiolase", "name": "Thiolase",
         "reactants": {"ketoCoA": 1, "coa": 1},
         "products": {"acylCoA": 1, "acetylCoA": 1}},
    ],
}


# ═══ NON-BIOLOGICAL PATHWAYS ════════════════════════════════════════════
# The engine walks typed things that turn into other typed things. It is
# not biochemistry -- these two prove it, and each declares its own
# vocabulary so no card says "metabolite" at a compiler pass.

_COMPILER = {
    "name": "Compiler pipeline", "start": "source", "defaultBlock": "opt",
    "vocabulary": {"node": "form", "edge": "pass", "edges": "passes",
                   "side": "resource", "sides": "resources",
                   "cycle": "loop", "chain": "pipeline",
                   "branch": "optional pass", "per": "per"},
    # -O0 skips optimisation entirely; -O2 runs it. Same conditions
    # mechanism as oxygen and organism, over a different variable.
    "conditions": {
        "level": {"label": "Opt level", "values": ["O2", "O0"], "default": "O2"},
    },
    "species": {
        "source":  {"name": "Source"},
        "tokens":  {"name": "Tokens"},
        "ast":     {"name": "AST"},
        "ir":      {"name": "IR"},
        "optir":   {"name": "Optimised IR"},
        "asm":     {"name": "Machine code"},
        "time":    {"name": "Compile time", "boundary": True},
        "binsize": {"name": "Binary size",  "boundary": True},
    },
    "reactions": [
        {"id": "lex",   "name": "Lexer",
         "reactants": {"source": 1, "time": 1}, "products": {"tokens": 1}},
        {"id": "parse", "name": "Parser",
         "reactants": {"tokens": 1, "time": 1}, "products": {"ast": 1}},
        {"id": "lower", "name": "Lowering",
         "reactants": {"ast": 1}, "products": {"ir": 1}},
        {"id": "opt",   "name": "Optimiser", "when": "level == 'O2'",
         # Optimisation trades compile time for a smaller binary -- the
         # same "spends one thing to gain another" shape as an enzyme
         # spending ATP.
         "reactants": {"ir": 1, "time": 2}, "products": {"optir": 1, "binsize": -1}},
        {"id": "direct","name": "Direct lowering", "when": "level == 'O0'",
         "reactants": {"ir": 1}, "products": {"optir": 1}},
        {"id": "emit",  "name": "Code generator",
         "reactants": {"optir": 1, "time": 1}, "products": {"asm": 1}},
    ],
}

# ── A CLINICAL MODEL, DESCRIBED ─────────────────────────────────────────
# The behavioural model of depression (Lewinsohn, 1974; the basis of
# behavioural activation in CBT). It is included as a MODEL CLINICIANS
# USE -- a published account of a loop -- and not as a description of any
# viewer.
#
# Three deliberate differences from the biological pathways:
#
#   1. NO ORACLE. Atoms balance; moods do not. A wrong metabolic diagram
#      fails the atom check, a wrong psychological one merely looks
#      plausible. Nothing here is verified by arithmetic, and the card
#      should not pretend otherwise.
#   2. ARROWS MEAN "OFTEN", NOT "ALWAYS". In metabolism A -> B is
#      deterministic. Here it is a tendency, for some people, some of the
#      time. The vocabulary says "tendency" rather than "reaction" for
#      exactly this reason.
#   3. THE LOOP IS BREAKABLE, and the influences say where. A diagram
#      implying a person simply failed to pull a lever would be worse
#      than no diagram.
_DEPRESSION_MODEL = {
    "name": "Behavioural model of low mood",
    "start": "low_mood",
    "source": "Lewinsohn's behavioural model (1974); basis of behavioural "
              "activation in CBT. An educational model, not a diagnosis.",
    "vocabulary": {"node": "state", "edge": "tendency", "edges": "tendencies",
                   "side": "influence", "sides": "influences",
                   "cycle": "loop", "chain": "sequence",
                   "branch": "alternative", "per": "per"},
    "species": {
        "low_mood":    {"name": "Low mood"},
        "withdrawal":  {"name": "Withdrawal"},
        "fewer_rewards": {"name": "Fewer rewarding activities"},
        "energy":      {"name": "Energy", "boundary": True},
        "contact":     {"name": "Social contact", "boundary": True},
    },
    "reactions": [
        {"id": "t1", "name": "Doing less",
         "note": "Low mood makes activity feel effortless to postpone",
         "modifiers": [{"species": "energy", "role": "inhibitor"}],
         "reactants": {"low_mood": 1}, "products": {"withdrawal": 1}},
        {"id": "t2", "name": "Fewer good things happen",
         "note": "Withdrawal removes the sources of reward, not the need for them",
         "reactants": {"withdrawal": 1, "contact": 1},
         "products": {"fewer_rewards": 1}},
        {"id": "t3", "name": "Mood drops further",
         "note": "Less reward feeds back into mood -- and the loop closes",
         "reactants": {"fewer_rewards": 1}, "products": {"low_mood": 1}},
    ],
}





_SUCROSE_CYCLE = {
    "name": "Sucrose Cycle",
    "start": "sucrose",
    # CONDITIONS:
    # 1. pathway: Plants break sucrose down via two distinct routes:
    #    - "susy" (Sucrose Synthase): Conserves energy by producing UDP-glucose,
    #      predominant in actively growing sink tissues.
    #    - "invertase": Hydrolyzes sucrose to free glucose + fructose at the cost
    #      of an additional ATP to re-phosphorylate the hexoses (futile cycle).
    # 2. compartment: Invertase cleavage can occur in the cytosol ("cytosol")
    #    or cell wall/vacuole apoplast ("apoplast/vacuole").
    "conditions": {
        "pathway": {
            "label": "Degradation Route",
            "values": ["susy", "invertase"],
            "default": "susy",
            "display": {"susy": "Sucrose Synthase", "invertase": "Invertase"}
        },
        "compartment": {
            "label": "Compartment",
            "values": ["cytosol", "vacuole"],
            "default": "cytosol"
        },
    },
    # Sucrose-phosphate synthase (SPS): the key regulated and committed step
    # of sucrose biosynthesis, allosterically activated by G6P and inhibited by Pi.
    "defaultBlock": "sps",
    "species": {
        # Core sugars and intermediates
        "sucrose":      {"name": "Sucrose",             "formula": "C12H22O11"},
        "sucrose6p":    {"name": "Sucrose-6'-P",        "formula": "C12H23O14P"},
        "glucose":      {"name": "Glucose",             "formula": "C6H12O6"},
        "fructose":     {"name": "Fructose",            "formula": "C6H12O6"},
        "g6p":          {"name": "Glucose-6-P",         "formula": "C6H13O9P"},
        "g1p":          {"name": "Glucose-1-P",         "formula": "C6H13O9P"},
        "f6p":          {"name": "Fructose-6-P",        "formula": "C6H13O9P"},
        "udpg":         {"name": "UDP-Glucose",         "formula": "C15H24N2O17P2"},

        # Boundary cofactors and nucleotides
        "udp":          {"name": "UDP",                 "boundary": True},
        "utp":          {"name": "UTP",                 "boundary": True},
        "atp":          {"name": "ATP",                 "boundary": True},
        "adp":          {"name": "ADP",                 "boundary": True},
        "ppi":          {"name": "PPi",                 "boundary": True},
        "pi":           {"name": "Pi",                  "boundary": True},
        "water":        {"name": "H2O", "formula": "H2O", "boundary": True},
    },
    "reactions": [
        # --- DEGRADATION ARMS ---

        # Route A: Sucrose Synthase (energy-conserving; reversible cleavage)
        {
            "id": "susy_cleave",
            "name": "Sucrose synthase (cleavage)",
            "when": "pathway == 'susy'",
            "reactants": {"sucrose": 1, "udp": 1},
            "products": {"udpg": 1, "fructose": 1}
        },
        # Conversion of UDP-glucose back to hexose-phosphate pool via UDP-glucose pyrophosphorylase
        {
            "id": "ugpase_rev",
            "name": "UDP-glucose pyrophosphorylase (reverse)",
            "when": "pathway == 'susy'",
            "reactants": {"udpg": 1, "ppi": 1},
            "products": {"g1p": 1, "utp": 1}
        },

        # Route B: Invertase (hydrolytic, irreversible)
        {
            "id": "inv",
            "name": "Invertase",
            "when": "pathway == 'invertase'",
            "reactants": {"sucrose": 1, "water": 1},
            "products": {"glucose": 1, "fructose": 1}
        },
        # Free glucose phosphorylation (only needed under invertase hydrolysis)
        {
            "id": "glk",
            "name": "Glucokinase",
            "when": "pathway == 'invertase'",
            "reactants": {"glucose": 1, "atp": 1},
            "products": {"g6p": 1, "adp": 1}
        },

        # Hexose pool entry for released fructose (shared by both routes)
        {
            "id": "fk",
            "name": "Fructokinase",
            "reactants": {"fructose": 1, "atp": 1},
            "products": {"f6p": 1, "adp": 1}
        },

        # --- INTERCONVERSION OF HEXOSE-PHOSPHATES ---
        {
            "id": "pgi",
            "name": "Phosphoglucose isomerase",
            "reactants": {"f6p": 1},
            "products": {"g6p": 1}
        },
        {
            "id": "pgm",
            "name": "Phosphoglucomutase",
            "reactants": {"g6p": 1},
            "products": {"g1p": 1}
        },

        # --- RESYNTHESIS ARM (Completing the cycle) ---

        # UGPase forward: activates G1P for sucrose synthesis
        {
            "id": "ugpase_fwd",
            "name": "UDP-glucose pyrophosphorylase (forward)",
            "reactants": {"g1p": 1, "utp": 1},
            "products": {"udpg": 1, "ppi": 1}
        },
        # Sucrose-phosphate synthase: committed regulatory step
        {
            "id": "sps",
            "name": "Sucrose-phosphate synthase",
            "modifiers": [
                {"species": "g6p", "role": "activator"},
                {"species": "pi", "role": "inhibitor"}
            ],
            "reactants": {"udpg": 1, "f6p": 1},
            "products": {"sucrose6p": 1, "udp": 1}
        },
        # Sucrose-phosphate phosphatase: drives synthesis to completion
        {
            "id": "spp",
            "name": "Sucrose-phosphate phosphatase",
            "reactants": {"sucrose6p": 1, "water": 1},
            "products": {"sucrose": 1, "pi": 1}
        }
    ]
}



_SUCROSE_CYCLE2 = {
    "name": "Sucrose Cycle",
    "start": "sucrose",
    "defaultBlock": "sps",

    # Vocabulary adaptation: renders cleanly in the nav view HUD & toggles
    "vocabulary": {
        "node": "sugar",
        "edge": "enzyme",
        "cycle": "substrate cycle",
        "chain": "linear pathway",
        "side": "nucleotide",
        "per": "per molecule of",
    },

    "conditions": {
        "pathway": {
            "label": "Cleavage Route",
            "values": ["susy", "invertase"],
            "default": "susy",
            "display": {"susy": "SuSy (conserving)", "invertase": "Invertase (futile)"},
        },
    },

    "species": {
        # Core sugars and phosphorylated intermediates (with formulas for atom-checking)
        "sucrose":      {"name": "Sucrose",             "formula": "C12H22O11"},
        "sucrose6p":    {"name": "Sucrose-6'-P",        "formula": "C12H23O14P"},
        "glucose":      {"name": "Glucose",             "formula": "C6H12O6"},
        "fructose":     {"name": "Fructose",            "formula": "C6H12O6"},
        "g6p":          {"name": "Glucose-6-P",         "formula": "C6H13O9P"},
        "g1p":          {"name": "Glucose-1-P",         "formula": "C6H13O9P"},
        "f6p":          {"name": "Fructose-6-P",        "formula": "C6H13O9P"},
        "udpg":         {"name": "UDP-Glucose"},        # Cofactor-bound; verified via ledger

        # Boundary cofactors (excluded from topological graph walk and atom balancing)
        "udp":          {"name": "UDP",   "boundary": True},
        "utp":          {"name": "UTP",   "boundary": True},
        "atp":          {"name": "ATP",   "boundary": True},
        "adp":          {"name": "ADP",   "boundary": True},
        "ppi":          {"name": "PPi",   "boundary": True},
        "pi":           {"name": "Pi",    "boundary": True},
        "water":        {"name": "H2O",   "boundary": True},
    },

    "reactions": [
        # =====================================================================
        # 1. CLEAVAGE FORK (Conditional on `pathway`)
        # =====================================================================
        # Route A: Sucrose Synthase (conserves glycosidic bond energy into UDPG)
        {
            "id": "susy_cleave",
            "name": "Sucrose synthase (cleavage)",
            "when": "pathway == 'susy'",
            "reactants": {"sucrose": 1, "udp": 1},
            "products": {"udpg": 1, "fructose": 1},
        },

        # Route B: Invertase (hydrolysis to free hexoses; consumes net extra ATP)
        {
            "id": "inv",
            "name": "Invertase",
            "when": "pathway == 'invertase'",
            "reactants": {"sucrose": 1, "water": 1},
            "products": {"glucose": 1, "fructose": 1},
        },
        {
            "id": "glk",
            "name": "Glucokinase",
            "when": "pathway == 'invertase'",
            "reactants": {"glucose": 1, "atp": 1},
            "products": {"g6p": 1, "adp": 1},
        },

        # =====================================================================
        # 2. FRUCTOSE RECOVERY & HEXOSE POOL INTERCONVERSION
        # =====================================================================
        # Released fructose from either arm enters the hexose pool via fructokinase
        {
            "id": "fk",
            "name": "Fructokinase",
            "reactants": {"fructose": 1, "atp": 1},
            "products": {"f6p": 1, "adp": 1},
        },
        # Reversible isomerisation to G6P
        {
            "id": "pgi",
            "name": "Phosphoglucose isomerase",
            "reactants": {"f6p": 1},
            "products": {"g6p": 1},
        },
        # Reversible mutase to G1P
        {
            "id": "pgm",
            "name": "Phosphoglucomutase",
            "reactants": {"g6p": 1},
            "products": {"g1p": 1},
        },

        # =====================================================================
        # 3. RESYNTHESIS ARM (Completing the cycle)
        # =====================================================================
        # Converts G1P into UDP-glucose required for SPS
        {
            "id": "ugpase_fwd",
            "name": "UDP-glucose pyrophosphorylase",
            "reactants": {"g1p": 1, "utp": 1},
            "products": {"udpg": 1, "ppi": 1},
        },
        # Committed, allosterically regulated step synthesizing Sucrose-6'-P
        {
            "id": "sps",
            "name": "Sucrose-phosphate synthase",
            "modifiers": [
                {"species": "g6p", "role": "activator"},
                {"species": "pi",  "role": "inhibitor"},
            ],
            "reactants": {"udpg": 1, "f6p": 1},
            "products": {"sucrose6p": 1, "udp": 1},
        },
        # Dephosphorylates back to Sucrose, closing the loop to start
        {
            "id": "spp",
            "name": "Sucrose-phosphate phosphatase",
            "reactants": {"sucrose6p": 1, "water": 1},
            "products": {"sucrose": 1, "pi": 1},
        },
    ],
}


# ── The Odyssey ─────────────────────────────────────────────────────────
# A narrative pathway rather than a biological one.
# The same engine: one state produces the next state.
# Each "reaction" is a major plot transition.

_ODYSSEY = {
    "name": "The Odyssey",
    "start": "troy",
    "defaultBlock": "home",
    "vocabulary": {
        "node": "story beat",
        "edge": "transition",
        "edges": "transitions",
        "side": "influence",
        "sides": "influences",
        "cycle": "return",
        "chain": "journey",
        "branch": "divergence",
        "per": "per",
    },

    "species": {
        "troy":        {"name": "Troy Falls"},
        "depart":      {"name": "Odysseus Departs"},
        "cyclops":     {"name": "Cyclops Encounter"},
        "poseidon":    {"name": "Poseidon Pursues"},
        "aeolus":      {"name": "Winds Released"},
        "giants":      {"name": "Giants Attack"},
        "circe":       {"name": "Circe Transforms Crew"},
        "hades":       {"name": "Journey Into Hades"},
        "sirens":      {"name": "Sirens Encounter"},
        "scylla":      {"name": "Scylla And Charybdis"},
        "cattle":      {"name": "Sacred Cattle Slain"},
        "shipwreck":   {"name": "Shipwreck"},
        "calypso":     {"name": "Calypso Holds Odysseus"},
        "release":     {"name": "Odysseus Released"},
        "ithaca":      {"name": "Odysseus Reaches Ithaca"},
        "disguise":    {"name": "Odysseus Disguises Himself"},
        "telemachus":  {"name": "Telemachus Returns"},
        "suitors":     {"name": "Suitors Challenge Odysseus"},
        "bow":         {"name": "The Bow Is Strung"},
        "battle":      {"name": "Palace Battle"},
        "reunion":     {"name": "Odysseus Reunites"},
    },

    "reactions": [
        {"id": "depart", "name": "Leave Troy",
         "reactants": {"troy": 1},
         "products": {"depart": 1}},

        {"id": "cyclops", "name": "Face Polyphemus",
         "reactants": {"depart": 1},
         "products": {"cyclops": 1}},

        {"id": "poseidon", "name": "Blind The Cyclops",
         "reactants": {"cyclops": 1},
         "products": {"poseidon": 1}},

        {"id": "aeolus", "name": "Receive The Winds",
         "reactants": {"poseidon": 1},
         "products": {"aeolus": 1}},

        {"id": "giants", "name": "Escape The Giants",
         "reactants": {"aeolus": 1},
         "products": {"giants": 1}},

        {"id": "circe", "name": "Meet Circe",
         "reactants": {"giants": 1},
         "products": {"circe": 1}},

        {"id": "hades", "name": "Enter The Underworld",
         "reactants": {"circe": 1},
         "products": {"hades": 1}},

        {"id": "sirens", "name": "Resist The Sirens",
         "reactants": {"hades": 1},
         "products": {"sirens": 1}},

        {"id": "scylla", "name": "Cross The Monsters",
         "reactants": {"sirens": 1},
         "products": {"scylla": 1}},

        {"id": "cattle", "name": "Kill Sacred Cattle",
         "reactants": {"scylla": 1},
         "products": {"cattle": 1}},

        {"id": "shipwreck", "name": "Lose The Crew",
         "reactants": {"cattle": 1},
         "products": {"shipwreck": 1}},

        {"id": "calypso", "name": "Reach Ogygia",
         "reactants": {"shipwreck": 1},
         "products": {"calypso": 1}},

        {"id": "release", "name": "Leave Calypso",
         "reactants": {"calypso": 1},
         "products": {"release": 1}},

        {"id": "ithaca", "name": "Return To Ithaca",
         "reactants": {"release": 1},
         "products": {"ithaca": 1}},

        {"id": "disguise", "name": "Become A Beggar",
         "reactants": {"ithaca": 1},
         "products": {"disguise": 1}},

        {"id": "telemachus", "name": "Find Telemachus",
         "reactants": {"disguise": 1},
         "products": {"telemachus": 1}},

        {"id": "suitors", "name": "Face The Suitors",
         "reactants": {"telemachus": 1},
         "products": {"suitors": 1}},

        {"id": "bow", "name": "String The Bow",
         "reactants": {"suitors": 1},
         "products": {"bow": 1}},

        {"id": "battle", "name": "Defeat The Suitors",
         "reactants": {"bow": 1},
         "products": {"battle": 1}},

        {"id": "reunion", "name": "Reunite With Penelope",
         "reactants": {"battle": 1},
         "products": {"reunion": 1}},
    ],
}

_THERMOACIDOPHILE_CYCLE = {
    "name": "HP/HB Cycle (Thermoacidophile)",
    "start": "acetylCoA",
    "defaultBlock": "acc",
    "vocabulary": {
        "node": "intermediate",
        "edge": "enzyme",
        "cycle": "autotrophic cycle",
        "side": "energy / vent gas",
        "per": "per molecule of acetyl-CoA fixed",
    },
    "species": {
        # Core ring intermediates
        "acetylCoA":     {"name": "Acetyl-CoA"},
        "malonylCoA":    {"name": "Malonyl-CoA"},
        "hydroxyprop":   {"name": "3-Hydroxypropionate", "formula": "C3H6O3"},
        "succinylCoA":   {"name": "Succinyl-CoA"},
        "hydroxybut":    {"name": "4-Hydroxybutyrate",   "formula": "C4H8O3"},
        "crotonylCoA":   {"name": "Crotonyl-CoA"},

        # Net product exiting into cell biomass (boundary so graph walk doesn't branch off)
        "pyruvate":      {"name": "Pyruvate",            "boundary": True},

        # Boundary vent cofactors & gases
        "bicarbonate":   {"name": "HCO3-",               "boundary": True},
        "atp":           {"name": "ATP",                 "boundary": True},
        "adp":           {"name": "ADP",                 "boundary": True},
        "pi":            {"name": "Pi",                  "boundary": True},
        "nadph":         {"name": "NADPH",               "boundary": True},
        "nadp":          {"name": "NADP+",               "boundary": True},
        "coa":           {"name": "CoA",                 "boundary": True},
        "water":         {"name": "H2O",                 "boundary": True},
    },
    "reactions": [
        # 1. First CO2 fixation: Carboxylation of acetyl-CoA
        {
            "id": "acc",
            "name": "Acetyl-CoA carboxylase",
            "reactants": {"acetylCoA": 1, "bicarbonate": 1, "atp": 1},
            "products":  {"malonylCoA": 1, "adp": 1, "pi": 1},
        },
        # 2. Reduction to the hallmark 3-C intermediate (hydroxypropionate)
        {
            "id": "mcr",
            "name": "Malonyl-CoA reductase",
            "reactants": {"malonylCoA": 1, "nadph": 2},
            "products":  {"hydroxyprop": 1, "coa": 1, "nadp": 2},
        },
        # 3. Second CO2 fixation: Conversion and carboxylation to a 4-C backbone
        {
            "id": "pcs",
            "name": "Propionyl-CoA synthetase & carboxylase",
            "reactants": {"hydroxyprop": 1, "bicarbonate": 1, "atp": 2, "coa": 1, "nadph": 1},
            "products":  {"succinylCoA": 1, "adp": 2, "pi": 2, "nadp": 1},
        },
        # 4. Reduction to 4-hydroxybutyrate
        {
            "id": "ssr",
            "name": "Succinyl-CoA reductase",
            "reactants": {"succinylCoA": 1, "nadph": 2},
            "products":  {"hydroxybut": 1, "coa": 1, "nadp": 2},
        },
        # 5. Dehydration and activation to crotonyl-CoA
        {
            "id": "hbd",
            "name": "4-Hydroxybutyryl-CoA dehydratase",
            "reactants": {"hydroxybut": 1, "coa": 1, "atp": 1},
            "products":  {"crotonylCoA": 1, "amp": 1, "ppi": 1, "water": 1},
        },
        # 6. Cleavage: releases a biomass unit (pyruvate) and regenerates Acetyl-CoA
        {
            "id": "ccl",
            "name": "Crotonyl-CoA lyase / synthase",
            "reactants": {"crotonylCoA": 1, "water": 1},
            "products":  {"acetylCoA": 1, "pyruvate": 1},
        },
    ],
}

_THERMOACIDOPHILE_CYCLE_SIMPLE = {
    "name": "Vent Carbon Fixation",
    "start": "c2_acetyl",
    "defaultBlock": "step1_fix1",
    "vocabulary": {
        "node": "carbon stage",
        "edge": "step",
        "cycle": "loop",
        "side": "energy",
        "per": "per sugar precursor made",
    },
    "species": {
        # Core ring intermediates simplified to carbon backbone stages
        "c2_acetyl":    {"name": "2-Carbon Starter"},
        "c3_malonyl":   {"name": "3-Carbon Chain"},
        "c4_succinyl":  {"name": "4-Carbon Chain"},
        "c4_hydroxy":   {"name": "Charged 4-Carbon"},

        # Net biomass sugar precursor exiting the loop
        "pyruvate":     {"name": "Pyruvate (food)",  "boundary": True},

        # Boundary energy & vent molecules
        "gas_co2":      {"name": "CO2 gas",          "boundary": True},
        "atp":          {"name": "ATP",              "boundary": True},
        "adp":          {"name": "ADP",              "boundary": True},
        "nadph":        {"name": "NADPH",            "boundary": True},
        "nadp":         {"name": "NADP+",            "boundary": True},
    },
    "reactions": [
        {
            "id": "step1_fix1",
            "name": "First Carbon Capture",
            "note": "Traps first vent gas molecule",
            "reactants": {"c2_acetyl": 1, "gas_co2": 1, "atp": 1},
            "products":  {"c3_malonyl": 1, "adp": 1},
        },
        {
            "id": "step2_fix2",
            "name": "Second Carbon Capture",
            "note": "Traps second vent gas molecule",
            "reactants": {"c3_malonyl": 1, "gas_co2": 1, "atp": 1},
            "products":  {"c4_succinyl": 1, "adp": 1},
        },
        {
            "id": "step3_charge",
            "name": "Chemical Recharge",
            "note": "Pumps in vent-powered electrons",
            "reactants": {"c4_succinyl": 1, "nadph": 1},
            "products":  {"c4_hydroxy": 1, "nadp": 1},
        },
        {
            "id": "step4_split",
            "name": "Food Release & Reset",
            "note": "Spits out food, resets loop",
            "reactants": {"c4_hydroxy": 1},
            "products":  {"c2_acetyl": 1, "pyruvate": 1},
        },
    ],
}


_PROJECT_HAIL_MARY = {
    "name": "Project Hail Mary",
    "start": "coma_awakening",
    "defaultBlock": "eva_disaster",

    # Custom vocabulary so the cards and rail read like an orbital mission log
    "vocabulary": {
        "node": "mission phase",
        "edge": "operation",
        "cycle": "survival loop",
        "chain": "trajectory",
        "side": "expendable / crew asset",
        "per": "per crew survival loop",
    },

    # THE CRUCIAL FORK:
    # 1. "heroic_rescue" (Canon): Grace abandons Earth return to save Rocky at 40 Eridani.
    # 2. "selfish_return" (Road not taken): Grace sends beetles and heads home to die.
    "conditions": {
        "loyalty": {
            "label": "Grace's Choice",
            "values": ["rescue_rocky", "return_to_earth"],
            "default": "rescue_rocky",
            "display": {
                "rescue_rocky": "Save Rocky (Erid)",
                "return_to_earth": "Return Solo (Earth)"
            },
        },
    },

    "species": {
        # Core narrative milestones (the primary backbone)
        "coma_awakening":    {"name": "Coma Awakening"},
        "tau_ceti_orbit":    {"name": "Tau Ceti Arrival"},
        "alien_contact":     {"name": "First Contact"},
        "taumeba_harvest":   {"name": "Breeding Taumeba"},
        "taumeba_ready":     {"name": "Predator Cultured"},
        "deep_space_fork":   {"name": "The Divergence Point"},
        "erid_salvation":    {"name": "Arrival at 40 Eridani"},
        "earth_beacons":     {"name": "Sol Probe Return"},

        # Boundary cofactors: the "ATP / NADH" currency of Hail Mary
        # Astrophage is ATP (spent for thrust, gained by breeding)
        "astrophage":        {"name": "Astrophage fuel", "boundary": True},
        # Sanity & memory are spent to unlock science solutions
        "sanity":            {"name": "Mental sanity",   "boundary": True},
        "crew_loss":         {"name": "Lost crewmates",  "boundary": True},
        # Rocky / Xenonite acts like NADH / enzyme catalyst
        "xenonite":          {"name": "Xenonite tool",   "boundary": True},
        "rocky_intel":       {"name": "Eridian insight", "boundary": True},
    },

    "reactions": [
        # --- PHASE 1: WAKING & ARRIVAL ---
        {
            "id": "wake_up",
            "name": "Amnesia Recovery Protocol",
            "note": "Relearns name, confirms dead crew",
            "reactants": {"coma_awakening": 1, "sanity": 1},
            "products":  {"tau_ceti_orbit": 1, "crew_loss": 2},
        },

        # --- PHASE 2: RENDEZVOUS & REGULATION ---
        # Meeting Rocky: Rocky acts as an allosteric ACTIVATOR (⊢)
        {
            "id": "rendezvous",
            "name": "Blip-A Air Gap Hookup",
            "note": "First contact with engineer Rocky",
            "modifiers": [
                {"species": "rocky_intel", "role": "activator"},
                {"species": "crew_loss",   "role": "inhibitor"},
            ],
            "reactants": {"tau_ceti_orbit": 1, "astrophage": 2},
            "products":  {"alien_contact": 1, "xenonite": 1},
        },

        # --- PHASE 3: THE DANGEROUS DETOUR (A SPUR) ---
        # The Taumeba sample dive nearly kills them (engine registers this as a side arm)
        {
            "id": "eva_dive",
            "name": "Adrian Atmospheric Dive",
            "note": "Suicidal plunge for predator bug",
            "reactants": {"alien_contact": 1, "astrophage": 3},
            "products":  {"taumeba_harvest": 1, "sanity": 1},
        },
        {
            "id": "culture_bug",
            "name": "Nitrogen-Resistant Breeding",
            "note": "Selects Taumeba that survive gas",
            "reactants": {"taumeba_harvest": 1, "xenonite": 1},
            "products":  {"taumeba_ready": 1, "astrophage": 1},
        },
        {
            "id": "prepare_departure",
            "name": "Separation & Loading",
            "note": "Both ships prep for departure",
            "reactants": {"taumeba_ready": 1},
            "products":  {"deep_space_fork": 1},
        },

        # --- PHASE 4: THE BIG FORK (Condition check on `loyalty`) ---

        # Route A (Canon): Discovers Taumeba eats Xenonite -> Turns around to save Rocky
        {
            "id": "turnaround_rescue",
            "name": "The Turnaround Burn",
            "when": "loyalty == 'rescue_rocky'",
            "note": "Burns all fuel to save friend",
            "reactants": {"deep_space_fork": 1, "astrophage": 8},
            "products":  {"erid_salvation": 1},
        },
        # Closes back to life/survival: living on Erid, eating meburger!
        {
            "id": "erid_life_cycle",
            "name": "Eridian Survival Loop",
            "when": "loyalty == 'rescue_rocky'",
            "note": "Saves Erid, sends probes to Sol",
            "reactants": {"erid_salvation": 1},
            "products":  {"coma_awakening": 1, "sanity": 2},
        },

        # Route B (The road not taken): Heads straight to Earth, Rocky suffocates
        {
            "id": "solo_return",
            "name": "Solo Earth Trajectory",
            "when": "loyalty == 'return_to_earth'",
            "note": "Returns home, leaves Rocky to die",
            "reactants": {"deep_space_fork": 1, "astrophage": 4},
            "products":  {"earth_beacons": 1},
        },
    ],
}

_PROJECT_HAIL_MARY_DETAILED = {
    "name": "Project Hail Mary: Tau Ceti Mission",
    "start": "amnesia_awakening",
    "defaultBlock": "xenonite_breach",

    # Vocabulary tailored to an orbital log & survival loop
    "vocabulary": {
        "node": "mission phase",
        "edge": "critical maneuver",
        "cycle": "closed loop",
        "chain": "one-way trajectory",
        "side": "resource / crew",
        "per": "per completed survival loop",
    },

    # Condition forks:
    # 1. Grace's moral choice at the perimeter of the Tau Ceti system
    # 2. Stratt's laboratory testing mode (controls how the lab flashback runs)
    "conditions": {
        "loyalty": {
            "label": "The Turning Point",
            "values": ["rescue_rocky", "return_to_earth"],
            "default": "rescue_rocky",
            "display": {
                "rescue_rocky": "Rescue Rocky (40 Eridani)",
                "return_to_earth": "Return Solo (Earth)",
            },
        },
    },

    "species": {
        # Core chronological narrative nodes (the ring backbone)
        "amnesia_awakening":  {"name": "Amnesia Awakening"},
        "crew_necropsy":      {"name": "Crew Mass Grave"},
        "system_recovery":    {"name": "Ship Spin & Gravity"},
        "tau_orbit_burn":     {"name": "Tau Ceti Insertion"},
        "blip_contact":       {"name": "First Contact: Blip-A"},
        "tunnel_handshake":   {"name": "Air-Lock Tunnel Interface"},
        "adrian_skimming":    {"name": "Adrian Upper Atmosphere"},
        "taumeba_isolated":   {"name": "Taumeba Live Sample"},
        "nitrogen_selection": {"name": "Enclosure Breeding Lab"},
        "probe_jettison":     {"name": "Beetle Mini-Probes Primed"},
        "the_parting":        {"name": "The Deep Space Parting"},
        "xenonite_collapse":  {"name": "The Terrifying Epiphany"},
        "erid_descent":       {"name": "Descent to 40 Eridani"},
        "meburger_life":      {"name": "The Eridian Colony"},

        # Solo dead-end node
        "earth_graveyard":    {"name": "Sol System (Dead End)"},

        # Boundary assets, fuels, and emotional states
        # Astrophage acts as ATP; Xenonite acts as a catalytic cofactor
        "astrophage":         {"name": "Astrophage fuel", "boundary": True},
        "sanity":             {"name": "Memory & Sanity", "boundary": True},
        "dead_crew":          {"name": "Dead crewmates",  "boundary": True},
        "rocky_intel":        {"name": "Rocky's insight", "boundary": True},
        "xenonite_cylinder":  {"name": "Xenonite tool",   "boundary": True},
        "nitrogen_gas":       {"name": "Lethal N2 Gas",   "boundary": True},
        "sol_data":           {"name": "Genomic Archive", "boundary": True},
    },

    "reactions": [
        # --- ACT I: WAKING & THE DEAD SHIP ---
        {
            "id": "coma_slough",
            "name": "Catheter & Slurry Shedding",
            "note": "Relearns breathing, limbs, basic math",
            "reactants": {"amnesia_awakening": 1},
            "products":  {"crew_necropsy": 1, "dead_crew": 2},
        },
        {
            "id": "spin_ship",
            "name": "Centrifugal Gravity Reset",
            "note": "Spins ship drums for 1G",
            "modifiers": [
                {"species": "dead_crew", "role": "inhibitor"},
            ],
            "reactants": {"crew_necropsy": 1, "astrophage": 1},
            "products":  {"system_recovery": 1, "sanity": 1},
        },
        {
            "id": "tau_braking",
            "name": "Relativistic Spin-Down Burn",
            "note": "Arrives at dying star system",
            "reactants": {"system_recovery": 1, "astrophage": 4},
            "products":  {"tau_orbit_burn": 1},
        },

        # --- ACT II: FIRST CONTACT & ALLOSTERY ---
        {
            "id": "blip_radar",
            "name": "Alien Radar Echo Detection",
            "note": "Identifies xenonite hull nearby",
            "reactants": {"tau_orbit_burn": 1},
            "products":  {"blip_contact": 1},
        },
        {
            "id": "tunnel_build",
            "name": "Pressurized Xenonite Bridge",
            "note": "Musical chords yield first friendship",
            # Rocky acts as an activator; crew loss inhibits
            "modifiers": [
                {"species": "rocky_intel", "role": "activator"},
                {"species": "dead_crew",   "role": "inhibitor"},
            ],
            "reactants": {"blip_contact": 1},
            "products":  {"tunnel_handshake": 1, "xenonite_cylinder": 1, "sanity": 2},
        },

        # --- ACT III: ADRIAN HARVEST & BREEDING ---
        {
            "id": "hull_dive",
            "name": "Adrian Atmospheric Harpoon",
            "note": "Extreme turbulence nearly tears hull",
            "reactants": {"tunnel_handshake": 1, "astrophage": 3},
            "products":  {"adrian_skimming": 1},
        },
        {
            "id": "centrifuge_capture",
            "name": "Microfluidic Cell Trapping",
            "note": "Captures the natural astrophage predator",
            "reactants": {"adrian_skimming": 1, "xenonite_cylinder": 1},
            "products":  {"taumeba_isolated": 1},
        },
        {
            "id": "evolution_filter",
            "name": "Accelerated Breeding Chambers",
            "note": "Selects Taumeba resilient to nitrogen",
            "reactants": {"taumeba_isolated": 1, "nitrogen_gas": 1},
            "products":  {"nitrogen_selection": 1, "sol_data": 1},
        },

        # --- ACT IV: PREPARATION & THE PARTING ---
        {
            "id": "prep_beetles",
            "name": "Autonomous Beetles Programmed",
            "note": "Stores genomic fix for Earth",
            "reactants": {"nitrogen_selection": 1, "sol_data": 1},
            "products":  {"probe_jettison": 1, "astrophage": 1},
        },
        {
            "id": "farewell_split",
            "name": "The Uncoupling of Ships",
            "note": "Rocky sets off toward 40 Eridani",
            "reactants": {"probe_jettison": 1},
            "products":  {"the_parting": 1},
        },
        {
            "id": "xenonite_epiphany",
            "name": "Xenonite Permeability Discovery",
            "note": "Realizes Taumeba eats Rocky's hull",
            "reactants": {"the_parting": 1},
            "products":  {"xenonite_collapse": 1, "sanity": 1},
        },

        # --- ACT V: THE FORK & CYCLE WRAP ---

        # ROUTE A (Canon): Abandon home, dump tanks, burn for 40 Eridani
        {
            "id": "turnaround_burn",
            "name": "The Suicidal Turnaround Burn",
            "when": "loyalty == 'rescue_rocky'",
            "note": "Sacrifices return fuel to save partner",
            "reactants": {"xenonite_collapse": 1, "astrophage": 8},
            "products":  {"erid_descent": 1},
        },
        {
            "id": "erid_life_reset",
            "name": "Meburger Colony Equilibrium",
            "when": "loyalty == 'rescue_rocky'",
            "note": "Saves Erid; becomes alien schoolteacher",
            "modifiers": [
                {"species": "rocky_intel", "role": "activator"},
            ],
            "reactants": {"erid_descent": 1},
            # Reconnects to start: a closed life cycle under high-gravity sun!
            "products":  {"amnesia_awakening": 1, "sanity": 4},
        },

        # ROUTE B (Alternate): Selfish flight to Sol; Rocky dies in silence
        {
            "id": "abandon_rocky",
            "name": "Silent Cruise to Dead Sol",
            "when": "loyalty == 'return_to_earth'",
            "note": "Beetles arrive, Grace dies isolated",
            "reactants": {"xenonite_collapse": 1, "astrophage": 2},
            "products":  {"earth_graveyard": 1},
        },
    ],
}

_SUNSHINE = {
    "name": "Icarus II: Solar Reignite Mission",
    "start": "mercury_orbit",
    "defaultBlock": "shield_breach",

    # Vocabulary adjusted to an orbital payload delivery run
    "vocabulary": {
        "node": "mission waypoint",
        "edge": "event / maneuver",
        "cycle": "orbital loop",
        "chain": "terminal dive",
        "side": "vital resource / crew",
        "per": "per bomb delivery run",
    },

    # THE CRUCIAL JUNCTION:
    # 1. "divert_icarus1" (Canon): Divert to Icarus I for a second bomb -> Pinbacker boards -> disaster.
    # 2. "ignore_beacon" (Road not taken): Stay course -> deliver payload with full oxygen & intact crew.
    "conditions": {
        "trolley_problem": {
            "label": "Beacon Intercept",
            "values": ["divert_icarus1", "ignore_beacon"],
            "default": "divert_icarus1",
            "display": {
                "divert_icarus1": "Divert to Icarus I (Two Bombs)",
                "ignore_beacon": "Stay Course (Deliver Solo)",
            },
        },
    },

    "species": {
        # Core narrative milestones
        "mercury_orbit":     {"name": "Mercury Slingshot"},
        "icarus1_docking":   {"name": "Icarus I Rendezvous"},
        "airlock_rupture":   {"name": "Sub-Zero Airlock Breach"},
        "oxygen_crisis":     {"name": "Garden Garden Depletion"},
        "pinbacker_sabotage":{"name": "Pinbacker Infiltration"},
        "cube_separation":   {"name": "Stellar Bomb Decouple"},
        "payload_detonation":{"name": "Core Ignition & Sol Saved"},

        # Alternative clean run milestone (Road not taken)
        "clean_payload_run": {"name": "Nominal Approach & Drop"},

        # Boundary cofactors: the "ATP / NADH" life-support ledger
        # Oxygen is ATP (consumed constantly; garden burning depletes it)
        "oxygen":            {"name": "Oxygen reserve",    "boundary": True},
        # Crew members act as non-renewable catalytic enzymes
        "crew_lives":        {"name": "Crew members",      "boundary": True},
        # Sanity is stripped by Searle's fixation on raw sunlight
        "sanity":            {"name": "Crew psychology",   "boundary": True},
        # The Golden Shield protects the reaction from heat death
        "gold_shield":       {"name": "Shield integrity",  "boundary": True},
        # Pinbacker acts as a lethal uncompetitive inhibitor
        "pinbacker":         {"name": "Pinbacker zealotry","boundary": True},
    },

    "reactions": [
        # --- ACT I: THE SLINGSHOT & PSYCHE DRAIN ---
        {
            "id": "sun_observation",
            "name": "Solar Observation Room",
            "note": "Searle stares into the light",
            "modifiers": [
                {"species": "sanity", "role": "inhibitor"},
            ],
            "reactants": {"mercury_orbit": 1, "oxygen": 1},
            "products":  {"mercury_orbit": 1},
        },

        # --- ACT II: THE FORK (Condition check on `trolley_problem`) ---

        # ROUTE A (Canon): Capa votes to divert; Trey forgets shield calculation
        {
            "id": "change_trajectory",
            "name": "Beacon Trajectory Burn",
            "when": "trolley_problem == 'divert_icarus1'",
            "note": "Calculations fail; shield burns",
            "reactants": {"mercury_orbit": 1, "oxygen": 1},
            "products":  {"icarus1_docking": 1, "gold_shield": 1},
        },

        # ROUTE B (Alternate / Road Not Taken): Ignore distress call, proceed clean
        {
            "id": "stay_true",
            "name": "Disregard Icarus I Beacon",
            "when": "trolley_problem == 'ignore_beacon'",
            "note": "Strict protocol; full reserves",
            "reactants": {"mercury_orbit": 1, "oxygen": 1},
            "products":  {"clean_payload_run": 1},
        },
        {
            "id": "nominal_drop",
            "name": "Standard Remote Detonation",
            "when": "trolley_problem == 'ignore_beacon'",
            "note": "Bomb fires, crew escapes safely",
            "reactants": {"clean_payload_run": 1, "oxygen": 2},
            "products":  {"payload_detonation": 1},
        },

        # --- ACT III: CANON SPIRAL (The Price of the Divert) ---
        # The airlock jump: Capa, Mace, and Harvey cross vacuum without suits
        {
            "id": "airlock_jump",
            "name": "Cryo Vacuum Airlock Jump",
            "when": "trolley_problem == 'divert_icarus1'",
            "note": "Harvey freezes; airlock snaps",
            "reactants": {"icarus1_docking": 1, "crew_lives": 1},
            "products":  {"airlock_rupture": 1},
        },
        # Fire in the oxygen garden: sudden massive depletion of life support
        {
            "id": "garden_inferno",
            "name": "Oxygen Garden Firestorm",
            "when": "trolley_problem == 'divert_icarus1'",
            "note": "Garden burns; Searle stays behind",
            "reactants": {"airlock_rupture": 1, "oxygen": 4, "crew_lives": 1},
            "products":  {"oxygen_crisis": 1},
        },
        # Pinbacker's rampage: acts as an explicit biological blocker/inhibitor
        {
            "id": "pinbacker_strike",
            "name": "Corridor Infiltration",
            "when": "trolley_problem == 'divert_icarus1'",
            "note": "Ghost captain stalks coolant bay",
            "modifiers": [
                {"species": "pinbacker", "role": "inhibitor"},
            ],
            "reactants": {"oxygen_crisis": 1, "crew_lives": 2},
            "products":  {"pinbacker_sabotage": 1},
        },

        # --- ACT IV: TERMINAL IGNITION ---
        # Mace freezes inside the mainframe coolant to manually uncouple the payload
        {
            "id": "mace_coolant",
            "name": "Manual Override in Coolant",
            "when": "trolley_problem == 'divert_icarus1'",
            "note": "Mace freezes to release bomb",
            "reactants": {"pinbacker_sabotage": 1, "crew_lives": 1},
            "products":  {"cube_separation": 1},
        },
        # Capa manually touches the core spark inside the distortion cube
        {
            "id": "capa_detonation",
            "name": "Stellar Spark Chamber",
            "when": "trolley_problem == 'divert_icarus1'",
            "note": "Capa touches fire; Sol reignited",
            "reactants": {"cube_separation": 1, "crew_lives": 1, "oxygen": 1},
            "products":  {"payload_detonation": 1},
        },
    ],
}

_TCP_HANDSHAKE = {
    "name": "TCP 3-Way Handshake",
    "start": "client_closed",
    "defaultBlock": "step1_syn",

    # Vocabulary adapted to network transport protocols
    "vocabulary": {
        "node": "socket state",
        "edge": "packet / transition",
        "chain": "connection flow",
        "side": "header flag / packet",
        "per": "per connection attempt",
    },

    # Condition switch: Normal connection vs Dropped/Blocked packet[cite: 1, 3]
    "conditions": {
        "firewall": {
            "label": "Network Link",
            "values": ["open", "blocked"],
            "default": "open",
            "display": {"open": "Direct Route", "blocked": "Firewall Drop"},
        },
    },

    "species": {
        # Core connection states (the backbone nodes)
        "client_closed":     {"name": "Client: Closed"},
        "client_syn_sent":   {"name": "Client: SYN-Sent"},
        "server_syn_rcvd":   {"name": "Server: SYN-Received"},
        "conn_established":  {"name": "Link Established"},
        "conn_timeout":      {"name": "Timeout (RST / Drop)"},

        # Boundary items: flags and sequence numbers acting like cofactors
        "flag_syn":          {"name": "SYN packet",    "boundary": True},
        "flag_ack":          {"name": "ACK packet",    "boundary": True},
        "rtt_latency":       {"name": "Round-trip ms", "boundary": True},
    },

    "reactions": [
        # --- 1. CLIENT SENDS SYN ---
        {
            "id": "step1_syn",
            "name": "Send SYN",
            "note": "Client picks initial sequence",
            "reactants": {"client_closed": 1},
            "products":  {"client_syn_sent": 1, "flag_syn": 1},
        },

        # --- 2. ROUTE FORK: NORMAL SYN-ACK vs FIREWALL DROP ---
        # Route A: Server hears SYN, replies with SYN + ACK
        {
            "id": "step2_synack",
            "name": "Reply SYN-ACK",
            "when": "firewall == 'open'",
            "note": "Server confirms and responds",
            "reactants": {"client_syn_sent": 1, "flag_syn": 1},
            "products":  {"server_syn_rcvd": 1, "flag_ack": 1, "rtt_latency": 1},
        },
        # Route B (The blocked road): Packet dropped silently
        {
            "id": "step2_drop",
            "name": "Firewall Drop",
            "when": "firewall == 'blocked'",
            "note": "Port closed; packet discarded",
            "reactants": {"client_syn_sent": 1},
            "products":  {"conn_timeout": 1},
        },

        # --- 3. CLIENT SENDS FINAL ACK ---
        {
            "id": "step3_ack",
            "name": "Send Final ACK",
            "when": "firewall == 'open'",
            "note": "Socket opens for payload",
            "reactants": {"server_syn_rcvd": 1},
            "products":  {"conn_established": 1, "flag_ack": 1, "rtt_latency": 1},
        },
    ],
}

_PHOTOSYNTHESIS_SIMPLE = {
    "name": "Carbon Fixation Engines",
    "start": "atmospheric_gas",
    "defaultBlock": "rubisco_step",
    "vocabulary": {
        "node": "carbon stage",
        "edge": "adaptation step",
        "cycle": "calvin loop",
        "chain": "gas pathway",
        "side": "energy currency",
        "per": "per sugar molecule",
    },
    "conditions": {
        "adaptation": {
            "label": "Plant Strategy",
            "values": ["c3_normal", "c4_spatial", "cam_temporal", "c2_stress"],
            "default": "c3_normal",
            "display": {
                "c3_normal": "C3: Direct Sun",
                "c4_spatial": "C4: Space Separation",
                "cam_temporal": "CAM: Night Shift",
                "c2_stress": "C2: Heat Glitch",
            },
        },
    },
    "species": {
        # Core progression states
        "atmospheric_gas": {"name": "Ambient Carbon Gas"},
        "pre_concentrate": {"name": "Concentrated Acid"},
        "rubisco_stage":   {"name": "RuBisCO Gate"},
        "sugar_product":   {"name": "Clean Sugar (Food)"},
        "waste_glitch":    {"name": "Toxic Waste Byproduct"},

        # Boundary energy cofactors
        "atp":             {"name": "Light-Made ATP",   "boundary": True},
        "nadph":           {"name": "Light-Made NADPH", "boundary": True},
    },
    "reactions": [
        # --- PRE-PROCESSING FORKS ---
        # C4 spatial route (corn, sugarcane)
        {
            "id": "c4_pump",
            "name": "Mesophyll Cell Pump",
            "when": "adaptation == 'c4_spatial'",
            "note": "Pumps carbon into inner core",
            "reactants": {"atmospheric_gas": 1, "atp": 1},
            "products":  {"pre_concentrate": 1},
        },
        # CAM temporal route (cactus, pineapple)
        {
            "id": "cam_night",
            "name": "Night Vacuum Trap",
            "when": "adaptation == 'cam_temporal'",
            "note": "Traps gas in cool night",
            "reactants": {"atmospheric_gas": 1, "atp": 1},
            "products":  {"pre_concentrate": 1},
        },

        # --- FEED TO RUBISCO ---
        {
            "id": "feed_rubisco",
            "name": "RuBisCO Supercharge",
            "when": "adaptation == 'c4_spatial' || adaptation == 'cam_temporal'",
            "note": "Floods RuBisCO with pure carbon",
            "reactants": {"pre_concentrate": 1},
            "products":  {"rubisco_stage": 1},
        },
        # Direct baseline feed (C3 and C2 baseline)
        {
            "id": "direct_feed",
            "name": "Standard Stomata Intake",
            "when": "adaptation == 'c3_normal' || adaptation == 'c2_stress'",
            "note": "Direct gas flow from leaf",
            "reactants": {"atmospheric_gas": 1},
            "products":  {"rubisco_stage": 1},
        },

        # --- THE RUBISCO FATE ---
        # Desired sugar production
        {
            "id": "rubisco_step",
            "name": "Calvin Cycle Fixation",
            "when": "adaptation != 'c2_stress'",
            "note": "Binds CO2 into pure sugar",
            "reactants": {"rubisco_stage": 1, "atp": 2, "nadph": 2},
            "products":  {"sugar_product": 1},
        },
        # C2 Photorespiration stress loop
        {
            "id": "c2_error",
            "name": "Photorespiration Error",
            "when": "adaptation == 'c2_stress'",
            "note": "Accidentally binds hot oxygen",
            "reactants": {"rubisco_stage": 1, "atp": 1},
            "products":  {"waste_glitch": 1},
        },
    ],
}

_PHOTOSYNTHESIS_DETAILED = {
    "name": "Carbon Fixation & Photorespiration",
    "start": "leaf_gas_pool",
    "defaultBlock": "rubisco_carboxylase",
    "vocabulary": {
        "node": "intermediate",
        "edge": "enzyme / channel",
        "cycle": "calvin cycle",
        "chain": "fixation route",
        "side": "energy / gas",
        "per": "per triose-P produced",
    },
    "conditions": {
        "regime": {
            "label": "Pathway Strategy",
            "values": ["c3_optimum", "c3_drought_stress", "c4_kranz", "cam_succulent"],
            "default": "c3_optimum",
            "display": {
                "c3_optimum": "C3: Optimum (Ambient CO2)",
                "c3_drought_stress": "C2: Drought Stress (Photorespiration)",
                "c4_kranz": "C4: Spatial Pump (Kranz Anatomy)",
                "cam_succulent": "CAM: Temporal Acid (Night Open)",
            },
        },
    },
    "species": {
        # Core intermediates
        "leaf_gas_pool":     {"name": "Sub-Stomatal Gas Space"},
        "oxaloacetate":      {"name": "Oxaloacetate (4C)", "formula": "C4H4O5"},
        "malate_stored":     {"name": "Malate Storage Pool", "formula": "C4H6O5"},
        "bundle_sheath_co2": {"name": "Concentrated CO2 Zone"},
        "rubp_acceptor":     {"name": "RuBP (5C Acceptor)"},
        "pga_pool":          {"name": "3-PGA (3C Backbone)", "formula": "C3H7O7P"},
        "glycolate_waste":   {"name": "2-P-Glycolate (2C)", "formula": "C2H5O6P"},
        "g3p_sugar":         {"name": "G3P Sugar Precursor", "formula": "C3H7O6P"},

        # Boundary gases, cofactors, and carriers
        "co2":               {"name": "Atmospheric CO2",  "boundary": True},
        "o2":                {"name": "Atmospheric O2",   "boundary": True},
        "pep":               {"name": "PEP Carrier (3C)", "boundary": True},
        "pyruvate_recycle":  {"name": "Pyruvate Recycle", "boundary": True},
        "atp":               {"name": "ATP",              "boundary": True},
        "adp":               {"name": "ADP",              "boundary": True},
        "pi":                {"name": "Pi",               "boundary": True},
        "nadph":             {"name": "NADPH",            "boundary": True},
        "nadp":              {"name": "NADP+",            "boundary": True},
    },
    "reactions": [
        # =====================================================================
        # 1. PRE-PROCESSING CONCENTRATION ARMS (C4 & CAM)
        # =====================================================================
        # C4 Mesophyll Capture via PEP Carboxylase
        {
            "id": "c4_pepc",
            "name": "PEP Carboxylase (Mesophyll)",
            "when": "regime == 'c4_kranz'",
            "note": "Traps CO2 with zero O2 affinity",
            "reactants": {"leaf_gas_pool": 1, "pep": 1},
            "products":  {"oxaloacetate": 1},
        },
        # CAM Night Capture via nocturnal open stomata
        {
            "id": "cam_pepc",
            "name": "Nocturnal PEP Carboxylation",
            "when": "regime == 'cam_succulent'",
            "note": "Open stomata capture night CO2",
            "reactants": {"leaf_gas_pool": 1, "pep": 1},
            "products":  {"oxaloacetate": 1},
        },
        # Conversion to malate for storage/transfer
        {
            "id": "malate_conversion",
            "name": "Malate Dehydrogenase & Storage",
            "when": "regime == 'c4_kranz' || regime == 'cam_succulent'",
            "note": "Stores carbon safely as 4C malate",
            "reactants": {"oxaloacetate": 1, "nadph": 1},
            "products":  {"malate_stored": 1, "nadp": 1},
        },
        # Decarboxylation: Releases high-pressure CO2 directly at RuBisCO
        {
            "id": "decarboxylation_pump",
            "name": "Malic Enzyme Decarboxylation",
            "when": "regime == 'c4_kranz' || regime == 'cam_succulent'",
            "note": "Dumps CO2 inside bundle sheath",
            "reactants": {"malate_stored": 1, "atp": 1},
            "products":  {"bundle_sheath_co2": 1, "pyruvate_recycle": 1, "adp": 1, "pi": 1},
        },
        {
            "id": "c4_rubp_charge",
            "name": "RuBP Charging",
            "when": "regime == 'c4_kranz' || regime == 'cam_succulent'",
            "note": "Prepares RuBisCO 5C acceptor",
            "reactants": {"bundle_sheath_co2": 1},
            "products":  {"rubp_acceptor": 1},
        },

        # Direct feed for C3 (Stomata open directly to RuBP)
        {
            "id": "c3_direct_intake",
            "name": "Direct Stomatal Diffusion",
            "when": "regime == 'c3_optimum' || regime == 'c3_drought_stress'",
            "note": "Gas diffuses directly to stroma",
            "reactants": {"leaf_gas_pool": 1},
            "products":  {"rubp_acceptor": 1},
        },

        # =====================================================================
        # 2. THE MASTER JUNCTION: RUBISCO CARBOXYLATION VS OXYGENATION
        # =====================================================================

        # Route A: Standard Carboxylation (C3 optimum, C4, CAM)
        # Yields two 3-PGA molecules per RuBP
        {
            "id": "rubisco_carboxylase",
            "name": "RuBisCO Carboxylation",
            "when": "regime != 'c3_drought_stress'",
            "note": "Productive fixation of CO2",
            "modifiers": [
                {"species": "co2", "role": "activator"},
                {"species": "o2",  "role": "inhibitor"},
            ],
            "reactants": {"rubp_acceptor": 1, "co2": 1},
            "products":  {"pga_pool": 1},
        },

        # Route B: Oxygenation Glitch (C2 Photorespiration under drought/heat)
        # Closed stomata deplete CO2; RuBisCO binds O2, yielding toxic 2-P-Glycolate
        {
            "id": "rubisco_oxygenase",
            "name": "RuBisCO Oxygenation (C2)",
            "when": "regime == 'c3_drought_stress'",
            "note": "Binds O2; leaks carbon and burns ATP",
            "modifiers": [
                {"species": "o2",  "role": "activator"},
                {"species": "co2", "role": "inhibitor"},
            ],
            "reactants": {"rubp_acceptor": 1, "o2": 1},
            "products":  {"glycolate_waste": 1},
        },

        # =====================================================================
        # 3. TERMINAL CONVERSIONS
        # =====================================================================
        # Calvin Cycle reduction arm: Converts 3-PGA to G3P (sugar food)
        {
            "id": "calvin_reduction",
            "name": "PGA Kinase & GAPDH (Calvin Cycle)",
            "when": "regime != 'c3_drought_stress'",
            "note": "Spends light energy to create sugar",
            "reactants": {"pga_pool": 1, "atp": 2, "nadph": 2},
            "products":  {"g3p_sugar": 1, "adp": 2, "pi": 2, "nadp": 2},
        },
        # Photorespiratory salvage cycle (consumes extra ATP across 3 organelles)
        {
            "id": "photorespiratory_salvage",
            "name": "Peroxisome / Mitochondrial Salvage",
            "when": "regime == 'c3_drought_stress'",
            "note": "Burns ATP trying to recover glycolate",
            "reactants": {"glycolate_waste": 1, "atp": 1},
            "products":  {"pga_pool": 1, "adp": 1},
        },
    ],
}

_WATER_CYCLE_SIMPLIFIED = {
  "name": "Water cycle",
  "start": "ocean",
  "defaultBlock": "condensation",
  "vocabulary": { "node": "store", "edge": "process", "edges": "processes",
                  "side": "driver", "sides": "drivers", "cycle": "cycle" },
  "species": {
    "ocean":  { "name": "Ocean",      "formula": "H2O" },
    "vapour": { "name": "Water vapour", "formula": "H2O" },
    "cloud":  { "name": "Cloud",      "formula": "H2O" },
    "rain":   { "name": "Rain",       "formula": "H2O" },
    "sun":    { "name": "Sunlight", "boundary": True },
    "heat":   { "name": "Heat released", "boundary": True }
  },
  "reactions": [
    { "id": "evaporation",   "name": "Evaporation",
      "reactants": { "ocean": 1, "sun": 1 }, "products": { "vapour": 1 } },
    { "id": "condensation",  "name": "Condensation",
      "reactants": { "vapour": 1 }, "products": { "cloud": 1, "heat": 1 } },
    { "id": "precipitation", "name": "Precipitation",
      "reactants": { "cloud": 1 },  "products": { "rain": 1 } },
    { "id": "runoff",        "name": "Runoff",
      "reactants": { "rain": 1 },   "products": { "ocean": 1 } }
  ]
}


PATHWAY_MODELS = {
    "path_tca":        {"pathway": _TCA,
                        "note": "The citric acid cycle -- eight reactions that close a loop"},
    "path_tca_idh":    {"pathway": _TCA, "blocked": "idh",
                        "note": "TCA with isocitrate dehydrogenase blocked"},
    "path_tca_sdh":    {"pathway": _TCA, "blocked": "sdh",
                        "note": "TCA with succinate dehydrogenase blocked (malonate)"},
    "path_glycolysis": {"pathway": _GLYCOLYSIS,
                        "note": "Glycolysis -- ten reactions, glucose to pyruvate"},
    "path_glycolysis_anaerobic": {"pathway": _GLYCOLYSIS,
                        "conditions": {"oxygen": 0, "organism": "human"},
                        "note": "No oxygen, human muscle -- pyruvate becomes lactate"},
    "path_glycolysis_yeast": {"pathway": _GLYCOLYSIS,
                        "conditions": {"oxygen": 0, "organism": "yeast"},
                        "note": "No oxygen, yeast -- pyruvate becomes ethanol"},
    "path_glycolysis_pfk": {"pathway": _GLYCOLYSIS, "blocked": "pfk",
                        "note": "Glycolysis blocked at phosphofructokinase, the committed step"},
    "path_glycolysis_top": {"pathway": _GLYCOLYSIS_UPPER,
                        "note": "Just the first three reactions -- a short chain"},
    "path_calvin":     {"pathway": _CALVIN,
                        "note": "Calvin cycle -- carbon fixed, then the acceptor rebuilt"},
    "path_urea":       {"pathway": _UREA,
                        "note": "Urea cycle -- ammonia in, urea out, ornithine recycled"},
    "path_urea_otc":   {"pathway": _UREA, "blocked": "otc",
                        "note": "OTC deficiency -- the commonest urea cycle disorder"},
    "path_compiler":   {"pathway": _COMPILER,
                        "note": "A compiler pipeline -- same engine, no biology"},
    "path_compiler_o0":{"pathway": _COMPILER, "conditions": {"level": "O0"},
                        "note": "The same pipeline at -O0: the optimiser is skipped"},
    "path_mood_model": {"pathway": _DEPRESSION_MODEL,
                        "note": "A model clinicians use for low mood -- "
                                "educational, not a diagnosis"},
    "path_beta_ox":    {"pathway": _BETA_OX,
                        "note": "Beta-oxidation -- a cycle that shortens its own substrate"},

    "path_odyssey": {  "pathway": _ODYSSEY,
                        "note": "Odysseus journeys home from Troy",
    },
    "path_sucrose": {  "pathway": _SUCROSE_CYCLE,
                        "note": "sucrose cycle manaylly created"
    },
    "path_sucrose2": {  "pathway": _SUCROSE_CYCLE2,
                        "note": "sucrose cycle manaylly created"
    },
    "path_thermoacidophiles": {  "pathway": _THERMOACIDOPHILE_CYCLE,
                        "note": "_THERMOACIDOPHILE_CYCLE used by Deep ocean extremophiles near black smokers to use H2S instead of O2"
    },
    "path_thermoacidophiles_simplified": {  "pathway": _THERMOACIDOPHILE_CYCLE_SIMPLE,
                        "note": "_THERMOACIDOPHILE_CYCLE_SIMPLE used by Deep ocean extremophiles near black smokers to use H2S instead of O2"
    }, 
    "path_project_hail_mary": {  "pathway": _PROJECT_HAIL_MARY,
                        "note": "project_hail_mary journeys through how they save the earth",
    },
    "path_project_hail_mary_detailed": {  "pathway": _PROJECT_HAIL_MARY_DETAILED,
                        "note": "project_hail_mary journeys through how they save the earth",
    },
    "path_sunshine": {  "pathway": _SUNSHINE,
                        "note": "Danny Boyle’s Sunshine (2007) mapped cleanly into the engine’s schema",
    },
    "path_TCP_handshake": {  "pathway": _TCP_HANDSHAKE,
                        "note": "TCP_handshake "
    },
    "path_photosynthesis_simple": {  "pathway": _PHOTOSYNTHESIS_SIMPLE,
                        "note": "simplified photosynthesis showing C2, C3, C4, CAM, Calvin cycle all in a single journey "
    },
    "path_photosynthesis_detailed": {  "pathway": _PHOTOSYNTHESIS_DETAILED,
                        "note": "Detailed photosynthesis short showing C2, C3, C4, CAM, Calvin cycle all in a single journey "
    },
     "water_cycle_simplified": {  "pathway": _WATER_CYCLE_SIMPLIFIED,
                        "note": "water_cycle_simplified"
    },
}




def _pathway_provider(sample_id: str) -> dict:
    s = PATHWAY_MODELS.get(sample_id)
    if s is None:
        raise FileNotFoundError(sample_id)
    return {"arrays": {"scenario": [1]}, "meta": dict(s)}


def _pathway_lister(limit: int, offset: int) -> dict:
    ids = list(PATHWAY_MODELS.keys())
    page = ids[offset:offset + limit]
    return {"samples": [{"record_id": i, "label": PATHWAY_MODELS[i]["note"]}
                        for i in page],
            "total": len(ids), "offset": offset}


data_source_store.register("pathway_model",
    provider      = _pathway_provider,
    lister        = _pathway_lister,
    adapter       = "multi_to_arrays",
    primary_field = "scenario",
    fs_field      = None,
    label         = "Metabolic pathway",
    description   = "Species and reactions in SBML's shape",
    schema        = {"fields": ["meta.pathway"],
                     "fs": None, "domain": "biology.pathway"})
