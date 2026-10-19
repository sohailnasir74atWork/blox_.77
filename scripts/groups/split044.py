# Writes supabase/044_steps/<n>_*.sql from the STEP sections of
# supabase/044_group_privacy.sql (the single source). Run after editing 044:
#   python3 scripts/groups/split044.py
# scripts/groups/test044.mjs fails if a step file and its section differ.
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'supabase')
NAMES = {0: '0_check.sql', 1: '1_functions.sql', 2: '2_group_messages.sql', 3: '3_switch.sql', 4: '4_cleanup.sql'}
LAST = max(NAMES)

src = open(os.path.join(ROOT, '044_group_privacy.sql'), encoding='utf-8').read().split('\n')
starts = []
for i, line in enumerate(src):
    m = re.match(r'^-- STEP (\d) ', line)
    if m:
        starts.append((int(m.group(1)), i - 1))
    if line.startswith('-- ROLLBACK'):
        starts.append((None, i - 1))
for k, (n, s) in enumerate(starts):
    if n is None:
        break
    body = '\n'.join(src[s:starts[k + 1][1]]).rstrip() + '\n'
    head = f'-- 044 step {n} of {LAST} — run in the SQL editor as ONE query, in order.\n-- Source: supabase/044_group_privacy.sql\n\n'
    with open(os.path.join(ROOT, '044_steps', NAMES[n]), 'w', encoding='utf-8') as f:
        f.write(head + body)
    print(NAMES[n])
