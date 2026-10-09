# Apply miss reviews to the benchmark: a duplicate becomes an equivalence; a better pick takes the
# original request (as one of at most 3 requests for that template), and the original target gets
# the reviewer's rewritten request. Every change is logged in adjud/changes.json.
import json, glob, sys
b = json.load(open('bench.json')); log = json.load(open('adjud/changes.json')) if glob.glob('adjud/changes.json') else []
done = {x['qid'] for x in log}
groups = [set(g) for g in json.load(open('dupes.json'))] if glob.glob('dupes.json') else []
def is_dupe(a, c): return any(a in g and c in g for g in groups)
count = {}
for x in b: count[x['target']] = count.get(x['target'], 0) + 1
byq = {x['qid']: x for x in b}
for f in sys.argv[1:]:
    for v in json.load(open(f)):
        q = byq.get(v['qid'])
        if not q or v['qid'] in done or v.get('verdict') != 'picked' or not v.get('better'): continue
        if is_dupe(q['target'], v['better']):
            log.append({'qid': v['qid'], 'action': 'duplicate', 'with': v['better']}); continue
        if count.get(v['better'], 0) < 3:
            n = count.get(v['better'], 0) + 1; count[v['better']] = n
            b.append({**q, 'qid': f"{v['better']}#adj{n}", 'target': v['better']})
        old = q['request']; q['request'] = v['new_request']; q['adjudicated'] = True
        log.append({'qid': v['qid'], 'action': 'switched', 'to': v['better'], 'old_request': old, 'new_request': v['new_request'], 'why': v.get('why')})
json.dump(b, open('bench.json', 'w'), indent=0); json.dump(log, open('adjud/changes.json', 'w'), indent=1)
print(sum(1 for x in log if x['action']=='switched'), 'switched,', sum(1 for x in log if x['action']=='duplicate'), 'duplicates')
