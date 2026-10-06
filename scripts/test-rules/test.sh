#!/bin/bash
# Runs the rules tests against throwaway emulators on private ports
# (demo project id, nothing leaves this machine). firebase-tools 15 needs JDK 21+.
set -e
cd "$(dirname "$0")"
if [ -z "$JAVA_HOME" ] || ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -qE 'version "(2[1-9]|[3-9][0-9])'; then
  for j in /opt/homebrew/opt/openjdk /opt/homebrew/opt/openjdk@24 /opt/homebrew/opt/openjdk@23 /opt/homebrew/opt/openjdk@26; do
    [ -x "$j/bin/java" ] && export JAVA_HOME="$j" && break
  done
fi
export PATH="$JAVA_HOME/bin:$PATH"
[ -d node_modules ] || npm install --no-audit --no-fund
node build-database-rules.js --check
firebase emulators:exec --config firebase.test.json --only firestore,database \
  --project demo-fruiteblocks 'node run.js'
