# Rescore saved results with the current duplicate groups, and print one table.
import json, glob, sys
groups = [set(g) for g in json.load(open('dupes.json'))]
def same(a, b): return a == b or any(a in g and b in g for g in groups)
rows = []
for f in sorted(glob.glob('results/*.json')):
    d = json.load(open(f)); r = d['results']
    if not r: continue
    def pct(fn, l): return round(100 * sum(1 for x in l if fn(x)) / len(l), 1) if l else 0
    h1 = lambda x: bool(x['picks']) and same(x['picks'][0], x['target'])
    h3 = lambda x: any(same(p, x['target']) for p in x['picks'][:3])
    st = {s: [x for x in r if x['style'] == s] for s in ('situation', 'visual', 'named')}
    rows.append((d['summary']['split'], d['summary']['experiment'], len(r), pct(lambda x: x['inShortlist'], r), pct(h1, r), pct(h3, r), *(pct(h3, st[s]) for s in st)))
only = sys.argv[1:] 
print(f"{'split':6} {'experiment':18} {'n':>4} {'short':>6} {'hit1':>6} {'hit3':>6} | {'sit3':>6} {'vis3':>6} {'nam3':>6}")
for row in sorted(rows):
    if only and row[0] not in only: continue
    print(f"{row[0]:6} {row[1]:18} {row[2]:>4} {row[3]:>6} {row[4]:>6} {row[5]:>6} | {row[6]:>6} {row[7]:>6} {row[8]:>6}")
