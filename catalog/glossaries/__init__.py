# ---------------------------------------------------------------------------
# catalog/glossaries/
#
# Term definitions, ONE MODULE PER DOMAIN -- the same split as
# catalog/sources/ and catalog/packs/.
#
# Each module holds a TERMS dict of acronym -> {full, plain} and a
# terms_for(keys) helper. Recipes call terms_for() at import time and put
# the result on a stage's renderingEngine.config, because a glossary is a
# view concern: it changes nothing a DSPE computes.
#
# NOTHING IS IMPORTED HERE ON PURPOSE. Unlike sources/ and packs/, these
# modules register nothing into any store -- a recipe imports the one it
# needs directly. An eager import list would be a second place to keep in
# sync for no benefit.
#
# These do NOT belong in static/shorts/core/. core/ is the engine --
# interpreter, registries, feed -- and is app only. Twenty domains with
# their own vocabulary would turn it into a dumping ground.
# ---------------------------------------------------------------------------
