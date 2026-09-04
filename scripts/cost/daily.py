import json, subprocess, urllib.parse, urllib.request, datetime as dt
PROJECT="fruiteblocks"; DAYS=30
TOKEN=subprocess.check_output(["gcloud","auth","print-access-token"]).decode().strip()
end=dt.datetime.now(dt.timezone.utc).replace(hour=0,minute=0,second=0,microsecond=0)
start=end-dt.timedelta(days=DAYS)
Q=[("RTDB egress GB","firebasedatabase.googleapis.com/network/sent_bytes_count","ALIGN_SUM",None,1/1024**3),
   ("RTDB listen ops M","firebasedatabase.googleapis.com/network/api_hits_count","ALIGN_SUM",'metric.label.operation_type="realtime_listen"',1e-6),
   ("RTDB set ops K","firebasedatabase.googleapis.com/network/api_hits_count","ALIGN_SUM",'metric.label.operation_type="realtime_set"',1e-3),
   ("RTDB conns avg","firebasedatabase.googleapis.com/network/active_connections","ALIGN_MEAN",None,1),
   ("FS reads M","firestore.googleapis.com/document/read_count","ALIGN_SUM",None,1e-6),
   ("FS listeners avg","firestore.googleapis.com/network/snapshot_listeners","ALIGN_MEAN",None,1),
   ("mirrorUsers K","cloudfunctions.googleapis.com/function/execution_count","ALIGN_SUM",'resource.label.function_name="mirrorUsersToSupabase"',1e-3),
   ("notifyPM K","cloudfunctions.googleapis.com/function/execution_count","ALIGN_SUM",'resource.label.function_name="notifyPrivateMessage"',1e-3)]
cols={}
for name,metric,al,extra,scale in Q:
  f=f'metric.type="{metric}"'+(f' AND {extra}' if extra else '')
  p=[("filter",f),("interval.startTime",start.isoformat().replace("+00:00","Z")),("interval.endTime",end.isoformat().replace("+00:00","Z")),
     ("aggregation.alignmentPeriod","86400s"),("aggregation.perSeriesAligner",al),("aggregation.crossSeriesReducer","REDUCE_SUM" if al=="ALIGN_SUM" else "REDUCE_MEAN")]
  url=f"https://monitoring.googleapis.com/v3/projects/{PROJECT}/timeSeries?"+urllib.parse.urlencode(p)
  d=json.load(urllib.request.urlopen(urllib.request.Request(url,headers={"Authorization":f"Bearer {TOKEN}"})))
  col={}
  for s in d.get("timeSeries",[]):
    for pt in s["points"]:
      day=pt["interval"]["endTime"][:10]; v=pt["value"]; v=float(v.get("int64Value",v.get("doubleValue",0)))
      col[day]=col.get(day,0)+v*scale
  cols[name]=col
days=sorted({d for c in cols.values() for d in c})
print("day        "+"".join(f"{n:>18s}" for n,*_ in Q))
for d in days:
  print(d+" "+"".join(f"{cols[n].get(d,0):18.2f}" for n,*_ in Q))
