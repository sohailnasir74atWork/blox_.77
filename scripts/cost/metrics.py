#!/usr/bin/env python3
"""Pull 30-day Cloud Monitoring totals for fruiteblocks, grouped by useful labels."""
import json, subprocess, sys, urllib.parse, urllib.request, datetime as dt

PROJECT = "fruiteblocks"
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 30
TOKEN = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()
end = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
start = end - dt.timedelta(days=DAYS)
PERIOD = f"{DAYS*86400}s"

# (metric type, per-series aligner, cross-series reducer, group-by fields, kind)
QUERIES = [
  # --- Realtime Database ---
  ("firebasedatabase.googleapis.com/network/sent_bytes_count", "ALIGN_SUM", "REDUCE_SUM", ["resource.label.database_id"], "bytes"),
  ("firebasedatabase.googleapis.com/network/sent_payload_bytes_count", "ALIGN_SUM", "REDUCE_SUM", ["resource.label.database_id"], "bytes"),
  ("firebasedatabase.googleapis.com/network/received_bytes_count", "ALIGN_SUM", "REDUCE_SUM", ["resource.label.database_id"], "bytes"),
  ("firebasedatabase.googleapis.com/storage/total_bytes", "ALIGN_MEAN", "REDUCE_MEAN", ["resource.label.database_id"], "bytes_gauge"),
  ("firebasedatabase.googleapis.com/network/active_connections", "ALIGN_MEAN", "REDUCE_MEAN", ["resource.label.database_id"], "gauge"),
  ("firebasedatabase.googleapis.com/network/api_hits_count", "ALIGN_SUM", "REDUCE_SUM", ["metric.label.operation_type"], "count"),
  ("firebasedatabase.googleapis.com/io/database_load", "ALIGN_MEAN", "REDUCE_MEAN", ["metric.label.type"], "gauge"),
  # --- Firestore ---
  ("firestore.googleapis.com/document/read_count", "ALIGN_SUM", "REDUCE_SUM", ["metric.label.type"], "count"),
  ("firestore.googleapis.com/document/write_count", "ALIGN_SUM", "REDUCE_SUM", ["metric.label.op"], "count"),
  ("firestore.googleapis.com/document/delete_count", "ALIGN_SUM", "REDUCE_SUM", [], "count"),
  ("firestore.googleapis.com/network/active_connections", "ALIGN_MEAN", "REDUCE_MEAN", [], "gauge"),
  ("firestore.googleapis.com/network/snapshot_listeners", "ALIGN_MEAN", "REDUCE_MEAN", [], "gauge"),
  # --- Cloud Functions v1 ---
  ("cloudfunctions.googleapis.com/function/execution_count", "ALIGN_SUM", "REDUCE_SUM", ["resource.label.function_name", "metric.label.status"], "count"),
  ("cloudfunctions.googleapis.com/function/network_egress", "ALIGN_SUM", "REDUCE_SUM", ["resource.label.function_name"], "bytes"),
  ("cloudfunctions.googleapis.com/function/execution_times", "ALIGN_DELTA", "REDUCE_SUM", ["resource.label.function_name"], "dist_ns"),
  # --- Cloud Run (v2 functions) ---
  ("run.googleapis.com/container/billable_instance_time", "ALIGN_SUM", "REDUCE_SUM", ["resource.label.service_name"], "seconds"),
  ("run.googleapis.com/request_count", "ALIGN_SUM", "REDUCE_SUM", ["resource.label.service_name"], "count"),
  # --- Storage / egress / logging ---
  ("storage.googleapis.com/network/sent_bytes_count", "ALIGN_SUM", "REDUCE_SUM", ["resource.label.bucket_name"], "bytes"),
  ("storage.googleapis.com/storage/total_bytes", "ALIGN_MEAN", "REDUCE_MEAN", ["resource.label.bucket_name"], "bytes_gauge"),
  ("logging.googleapis.com/byte_count", "ALIGN_SUM", "REDUCE_SUM", ["resource.type"], "bytes"),
  ("firebasehosting.googleapis.com/network/sent_bytes_count", "ALIGN_SUM", "REDUCE_SUM", ["resource.label.site_name"], "bytes"),
  ("identitytoolkit.googleapis.com/... skip", None, None, [], None),
]

def fmt(v, kind):
  if kind in ("bytes", "bytes_gauge"):
    for unit in ["B","KB","MB","GB","TB"]:
      if abs(v) < 1024: return f"{v:,.2f} {unit}"
      v /= 1024
    return f"{v:,.2f} PB"
  if kind == "seconds": return f"{v:,.0f} s ({v/3600:,.1f} h)"
  return f"{v:,.2f}" if isinstance(v,float) and not v.is_integer() else f"{v:,.0f}"

def query(metric, aligner, reducer, groupby):
  params = [
    ("filter", f'metric.type="{metric}"'),
    ("interval.startTime", start.isoformat().replace("+00:00","Z")),
    ("interval.endTime", end.isoformat().replace("+00:00","Z")),
    ("aggregation.alignmentPeriod", PERIOD),
    ("aggregation.perSeriesAligner", aligner),
    ("aggregation.crossSeriesReducer", reducer),
  ] + [("aggregation.groupByFields", g) for g in groupby]
  url = f"https://monitoring.googleapis.com/v3/projects/{PROJECT}/timeSeries?" + urllib.parse.urlencode(params)
  req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
  try:
    with urllib.request.urlopen(req, timeout=60) as r:
      return json.load(r)
  except urllib.error.HTTPError as e:
    return {"error": e.read().decode()[:300]}

print(f"# fruiteblocks — last {DAYS} days ({start.date()} → {end.date()})\n")
for metric, aligner, reducer, groupby, kind in QUERIES:
  if not aligner: continue
  data = query(metric, aligner, reducer, groupby)
  short = metric.split("googleapis.com/")[1]
  print(f"## {metric.split('.')[0]} :: {short}")
  if "error" in data:
    print("   ERROR:", data["error"].replace("\n"," ")[:200]); print(); continue
  series = data.get("timeSeries", [])
  if not series:
    print("   (no data)"); print(); continue
  rows = []
  for s in series:
    labels = {**s.get("metric",{}).get("labels",{}), **s.get("resource",{}).get("labels",{})}
    key = " | ".join(f"{k.split('.')[-1]}={labels.get(k.split('.')[-1],'?')}" for k in groupby) or "(all)"
    total = 0.0; cnt = 0
    for p in s.get("points", []):
      v = p["value"]
      if "distributionValue" in v:
        d = v["distributionValue"]; c = float(d.get("count",0)); m = float(d.get("mean",0))
        total += c*m; cnt += c
      else:
        total += float(v.get("int64Value", v.get("doubleValue", 0))); cnt += 1
    if kind == "dist_ns":
      rows.append((total, f"{key:60s} invocations={cnt:,.0f}  total_time={total/1e9:,.0f}s  mean={ (total/cnt/1e6) if cnt else 0:,.0f}ms"))
    elif kind in ("gauge","bytes_gauge"):
      avg = total/cnt if cnt else 0
      rows.append((avg, f"{key:60s} avg={fmt(avg,kind)}"))
    else:
      rows.append((total, f"{key:60s} {fmt(total,kind)}"))
  for _, line in sorted(rows, key=lambda r: -r[0])[:40]:
    print("  ", line)
  print()
