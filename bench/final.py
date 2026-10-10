# Final held-out scores: a pick counts when it's the target, a duplicate of it, or a template the
# reviewers judged as good a fit for that request (adjud/hv-*.json, from every system's misses).
import json, glob, sys
groups = [set(g) for g in json.load(open('dupes.json'))]
acc = {}
for f in glob.glob('adjud/hv-*.json'):
    for v in json.load(open(f)):
        acc[v['qid']] = set(v.get('acceptable') or [])
def ok(p, x):
    t = x['target']
    return p == t or any(p in g and t in g for g in groups) or p in acc.get(x['qid'], set())
exps = sys.argv[1:] or ['e1-current', 'e2-visual', 'e7-rerank', 'e8-combined', 'e15-production']
print(f"{'split':6} {'experiment':16} {'n':>4} {'short':>6} {'hit1':>6} {'hit3':>6} | {'sit3':>6} {'vis3':>6} {'nam3':>6}")
for split in ['blind', 'test']:
    for e in exps:
        try: r = json.load(open(f'results/{e}-{split}.json'))['results']
        except FileNotFoundError: continue
        pct = lambda f, l: round(100 * sum(1 for x in l if f(x)) / len(l), 1) if l else 0
        h1 = lambda x: bool(x['picks']) and ok(x['picks'][0], x)
        h3 = lambda x: any(ok(p, x) for p in x['picks'][:3])
        st = [[x for x in r if x['style'] == s] for s in ('situation', 'visual', 'named')]
        print(f"{split:6} {e:16} {len(r):>4} {pct(lambda x: x['inShortlist'], r):>6} {pct(h1, r):>6} {pct(h3, r):>6} | {pct(h3, st[0]):>6} {pct(h3, st[1]):>6} {pct(h3, st[2]):>6}")
