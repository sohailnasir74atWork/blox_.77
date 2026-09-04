import json, re, collections, sys
recs=[json.loads(l) for l in open('rtdb-profile.json') if l.strip().startswith('{')]
ts=[r['timestamp'] for r in recs]; dur=(max(ts)-min(ts))/1000
print(f"records={len(recs):,} window={dur:.0f}s  => {len(recs)/dur:.1f} ops/sec")
UID=re.compile(r'^[A-Za-z0-9_-]{20,}$'); PUSH=re.compile(r'^-[A-Za-z0-9_-]{19}$'); NUM=re.compile(r'^\d+$')
def norm(path, depth=3):
    out=[]
    for i,seg in enumerate(path[:depth]):
        if i>0 and (UID.match(seg) or PUSH.match(seg) or NUM.match(seg) or '@' in seg or '_' in seg and len(seg)>25): out.append('$id')
        else: out.append(seg)
    return '/'+'/'.join(out) if out else '/'
ops=collections.Counter(r['name'] for r in recs)
print("\n## ops by type (5 min)  → per day estimate")
for k,v in ops.most_common(): print(f"  {k:28s} {v:8,}   ≈{v/dur*86400:>12,.0f}/day")
print("\n## client platforms")
plat=collections.Counter((r.get('client',{}).get('userAgent',{}).get('os','?'), r.get('client',{}).get('userAgent',{}).get('platform','?'), (r.get('client',{}).get('userAgent',{}).get('userAgentString','?') or '?')[:28]) for r in recs)
for k,v in plat.most_common(12): print(f"  {v:8,}  {k}")
print("\n## unique client addresses:", len({r.get('client',{}).get('remoteAddress',{}).get('address') for r in recs}))
addr=collections.Counter(r.get('client',{}).get('remoteAddress',{}).get('address') for r in recs)
print("   top clients by ops:", [v for _,v in addr.most_common(10)])
by=collections.defaultdict(lambda:[0,0])
for r in recs:
    k=(r['name'],norm(r.get('path',[]))); by[k][0]+=1; by[k][1]+=r.get('bytes',0) or 0
def show(title, filt, key=0, n=30):
    print(f"\n## {title}")
    rows=[(k,v) for k,v in by.items() if filt(k)]
    rows.sort(key=lambda kv:-kv[1][key])
    tot=sum(v[key] for _,v in rows) or 1
    for (op,p),(c,b) in rows[:n]:
        print(f"  {op:22s} {p:55s} n={c:7,} ({c/tot*100:4.1f}%)  bytes={b/1024:9,.0f}KB")
show("one-shot/listen reads by path (listener-listen)", lambda k:k[0]=='listener-listen')
show("bytes by path (all ops, top)", lambda k:True, key=1)
show("writes by path (realtime-write)", lambda k:k[0]=='realtime-write')
show("updates by path (realtime-update)", lambda k:k[0]=='realtime-update')
show("on-disconnect by path", lambda k:k[0].startswith('on-disconnect'))
show("other ops (transactions, rest, etc)", lambda k:k[0] not in ('listener-listen','listener-unlisten','realtime-write','realtime-update') and not k[0].startswith('on-disconnect'))
un=[r for r in recs if r.get('unIndexed')]
print(f"\n## unIndexed queries: {len(un)}")
for k,v in collections.Counter(norm(r.get('path',[])) for r in un).most_common(10): print("  ",v,k)
# deeper look at /users children listens
print("\n## /users/$id/<child> listens (depth 4)")
c=collections.Counter('/'.join(r['path'][2:4]) for r in recs if r['name']=='listener-listen' and len(r['path'])>=2 and r['path'][0]=='users')
for k,v in c.most_common(25): print(f"  {v:7,}  users/$id/{k}")
print("\n## /users/$id/<child> writes (depth 4)")
c=collections.Counter('/'.join(r['path'][2:4]) for r in recs if r['name'] in('realtime-write','realtime-update') and len(r['path'])>=2 and r['path'][0]=='users')
for k,v in c.most_common(25): print(f"  {v:7,}  users/$id/{k}")

print("\n## TOP 6 CLIENTS: what are they doing?")
for a,cnt in addr.most_common(6):
    rs=[r for r in recs if r.get('client',{}).get('remoteAddress',{}).get('address')==a]
    ua=rs[0].get('client',{}).get('userAgent',{}).get('userAgentString','?')
    t=[r['timestamp'] for r in rs]; span=(max(t)-min(t))/1000 or 1
    print(f"\n  client {a[:22]}… ops={cnt:,} over {span:.0f}s = {cnt/span:.1f} ops/s  ua={ua[:40]}")
    c=collections.Counter((r['name'],norm(r.get('path',[]),4)) for r in rs)
    for (op,p),v in c.most_common(8): print(f"     {v:6,}  {op:20s} {p}")
