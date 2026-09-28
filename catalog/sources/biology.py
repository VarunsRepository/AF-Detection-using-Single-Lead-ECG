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
