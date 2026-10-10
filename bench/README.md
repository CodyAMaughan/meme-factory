# Meme-picking benchmark

Does the Meme Factory pick the right template for a request? Each of ~1,500 templates has one to
three casual requests where it should be the clear winner. A system passes a request when the
target (a duplicate of it, or a template reviewers judged as good a fit) is among its first three
picks.

| Set | Requests | Written from |
|---|---|---|
| train (70%) | 1,066 + reviews | each template's card |
| bdev | 362 | the picture and name only (train templates); used to choose between experiments |
| test (30%) | 439 | each template's card |
| blind | 439 | the picture and name only (test templates); the honest number |

Card-written requests share words with the cards, which flatters plain search; the picture-only
sets don't. Misses were reviewed (adjud/): duplicates became equivalences, and where a system's
pick fit as well, the request was rewritten for its target and given to the better template.

    node bench/run.mjs <experiment> <train|bdev|test|blind> [limit]   # experiments.mjs
    python3 bench/rescore.py [split...]                               # all results, with duplicates
    python3 bench/final.py                                            # held-out, with reviews

Model calls go through `claude -p` with nothing loaded but a system prompt, cached in bench/cache.
