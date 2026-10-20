#!/usr/bin/env bash
# planner-check.sh — the conformance rules of Project Planner blueprint v0.3 §4.8,
# runnable on a hub (or sandbox) clone without the app. Run from anywhere:
#   bash tools/planner-check.sh [hub-root]
# Exit 1 on any FAIL. WARN lines do not fail the run.
#
# Layout checked: nodes/<domain>/*.md, people/*.md, tags/<domain>.md, docs/**.
# Frontmatter is read line by line (top-level `key:` lines between the first
# two `---` lines); nothing here parses YAML in full, which is enough for the
# flat shape of §4.2.

set -u
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT" || { echo "no such folder: $ROOT"; exit 2; }

fail=0
FAIL() { echo "FAIL: $*"; fail=1; }
WARN() { echo "WARN: $*"; }

GUIDE_KEYS="type domain project version status tags created updated aliases"
PLANNER_KEYS="planner_id planner_type parent priority owner people start due blocked_by relates references drive"
HOME_KEYS="repo folder"

# Top-level frontmatter keys of a file, in order, one per line.
fm_keys() {
  awk 'NR==1 && $0!="---" {exit} NR>1 && $0=="---" {exit} NR>1 && /^[A-Za-z_][A-Za-z0-9_]*:/ {sub(/:.*/,""); print}' "$1"
}
# Value of a top-level key (raw, trimmed), empty when absent.
fm_val() {
  awk -v k="$2" 'NR==1 && $0!="---" {exit} NR>1 && $0=="---" {exit} NR>1 && index($0,k":")==1 {v=substr($0,length(k)+2); gsub(/^[ \t]+|[ \t]+$/,"",v); print v; exit}' "$1"
}
# Every [[stem]] in the frontmatter, one per line.
fm_links() {
  awk 'NR==1 && $0!="---" {exit} NR>1 && $0=="---" {exit} NR>1 {print}' "$1" | grep -o '\[\[[^]|#]*' | sed 's/^\[\[//'
}
stem_of() { basename "$1" .md; }

echo "=== planner-check: $ROOT"

# --- Inventory ---------------------------------------------------------------
nodes=$(find nodes -mindepth 2 -maxdepth 2 -name '*.md' 2>/dev/null | sort)
people=$(find people -mindepth 1 -maxdepth 1 -name '*.md' 2>/dev/null | sort)
docs=$(find docs -name '*.md' 2>/dev/null | sort)
tagfiles=$(find tags -mindepth 1 -maxdepth 1 -name '*.md' 2>/dev/null | sort)
domains=$(for f in $tagfiles; do stem_of "$f"; done)
echo "nodes: $(echo "$nodes" | grep -c . ) · people: $(echo "$people" | grep -c .) · docs: $(echo "$docs" | grep -c .) · domains: $(echo $domains)"

[ -n "$nodes" ] || WARN "no nodes found under nodes/"

# stem → planner_type, and stem → file, for nodes
declare -A TYPE PARENT FILE
for f in $nodes; do
  s=$(stem_of "$f"); TYPE[$s]=$(fm_val "$f" planner_type); FILE[$s]=$f
  p=$(fm_val "$f" parent); p=${p#\"}; p=${p%\"}; p=${p#\[\[}; p=${p%\]\]}; PARENT[$s]=$p
done

# --- Rule 7: stems unique across nodes/, people/ and docs/ --------------------
echo "--- rule 7: stem uniqueness"
dups=$( (for f in $nodes $people $docs; do stem_of "$f"; done) | sort | uniq -d)
if [ -n "$dups" ]; then for d in $dups; do FAIL "stem '$d' appears more than once in nodes/, people/ or docs/"; done; else echo "ok"; fi

# --- Rule 1: keys present, in order, no title: -------------------------------
echo "--- rule 1: keys and order"
r1=0
check_keys() { # file expected-keys...
  local f=$1; shift
  local want="$*"; local have; have=$(fm_keys "$f")
  for k in $want; do echo "$have" | grep -qx "$k" || { FAIL "$f: missing key '$k'"; r1=1; }; done
  echo "$have" | grep -qx title && { FAIL "$f: has a title: key"; r1=1; }
  # order: the expected keys that are present must appear in the expected order
  local present; present=$(for k in $want; do echo "$have" | grep -qx "$k" && echo "$k"; done | tr '\n' ' ')
  local actual; actual=$(echo "$have" | grep -x -F -f <(for k in $want; do echo "$k"; done) | tr '\n' ' ')
  [ "$present" = "$actual" ] || { FAIL "$f: keys out of order"; r1=1; }
}
for f in $nodes; do
  t=$(fm_val "$f" planner_type)
  if [ "$t" = project ]; then check_keys "$f" $GUIDE_KEYS $PLANNER_KEYS $HOME_KEYS
  else
    check_keys "$f" $GUIDE_KEYS $PLANNER_KEYS
    for k in $HOME_KEYS; do fm_keys "$f" | grep -qx "$k" && { FAIL "$f: '$k' belongs on project nodes only"; r1=1; }; done
  fi
done
for f in $people; do check_keys "$f" $GUIDE_KEYS; [ "$(fm_val "$f" type)" = person ] || { FAIL "$f: type is not person"; r1=1; }; done
[ $r1 = 0 ] && echo "ok"

# --- Rule 2: domain is a tag file; vocabularies of status/priority/type -------
echo "--- rule 2: domain and vocabularies"
r2=0
for f in $nodes; do
  d=$(fm_val "$f" domain); echo "$domains" | grep -qx "$d" || { FAIL "$f: domain '$d' has no tags/$d.md"; r2=1; }
  case "$(fm_val "$f" status)" in idea|active|on-hold|done|archived) ;; *) FAIL "$f: bad status"; r2=1;; esac
  case "$(fm_val "$f" priority)" in low|medium|high) ;; *) FAIL "$f: bad priority"; r2=1;; esac
  case "$(fm_val "$f" planner_type)" in project|subproject|task|subtask) ;; *) FAIL "$f: bad planner_type"; r2=1;; esac
done
[ $r2 = 0 ] && echo "ok"

# --- Rule 3: every [[stem]] resolves to nodes/, people/ or docs/ --------------
echo "--- rule 3: links resolve"
r3=0
targets=$( (for f in $nodes $people $docs; do stem_of "$f"; done) | sort -u)
for f in $nodes; do
  for l in $(fm_links "$f"); do echo "$targets" | grep -qx "$l" || { FAIL "$f: [[${l}]] does not resolve"; r3=1; }; done
done
[ $r3 = 0 ] && echo "ok"

# --- Rule 4: hierarchy and cycles -------------------------------------------
echo "--- rule 4: hierarchy"
r4=0
for s in "${!TYPE[@]}"; do
  t=${TYPE[$s]}; p=${PARENT[$s]}; f=${FILE[$s]}
  if [ -z "$p" ]; then [ "$t" = project ] || { FAIL "$f: a $t needs a parent"; r4=1; }; continue; fi
  pt=${TYPE[$p]:-}
  [ -n "$pt" ] || { FAIL "$f: parent [[${p}]] is not a planner node"; r4=1; continue; }
  case "$t:$pt" in
    project:*) WARN "$f: a project nested under another node" ;;
    subproject:task|subproject:subtask) FAIL "$f: a subproject under a $pt"; r4=1 ;;
    task:task) WARN "$f: a task under a task (new work under a task should be a sub-task)" ;;
    task:subtask) FAIL "$f: a task under a sub-task"; r4=1 ;;
    subtask:task) ;;
    subtask:*) FAIL "$f: a sub-task must sit under a task, not a $pt"; r4=1 ;;
  esac
  # cycle: walk up at most N steps
  cur=$p; n=0; total=${#TYPE[@]}
  while [ -n "$cur" ] && [ $n -le $total ]; do [ "$cur" = "$s" ] && { FAIL "$f: is its own ancestor"; r4=1; break; }; cur=${PARENT[$cur]:-}; n=$((n+1)); done
done
[ $r4 = 0 ] && echo "ok"

# --- Rule 5: tags in the domain vocabulary -----------------------------------
echo "--- rule 5: tags in vocabulary"
r5=0
vocab_of() { awk '/^#+[ \t]+[Vv]ocabulary/{on=1;next} on && /^#/{exit} on && /^\|/{split($0,c,"|"); g=c[2]; gsub(/^[ \t]+|[ \t]+$/,"",g); if (g ~ /^`[^`]+`$/) {gsub(/`/,"",g); print g}}' "$1"; }
for f in $nodes; do
  d=$(fm_val "$f" domain); tv=$(fm_val "$f" tags); tv=${tv#[}; tv=${tv%]}
  [ -z "$tv" ] && continue
  v=$(vocab_of "tags/$d.md" 2>/dev/null)
  for t in $(echo "$tv" | tr ',' ' '); do t=${t//\"/}; t=${t//\'/}; echo "$v" | grep -qx "$t" || { FAIL "$f: tag '$t' is not in tags/$d.md"; r5=1; }; done
done
[ $r5 = 0 ] && echo "ok"

# --- Rule 6: home formats ----------------------------------------------------
echo "--- rule 6: home formats"
r6=0
for f in $nodes; do
  [ "$(fm_val "$f" planner_type)" = project ] || continue
  r=$(fm_val "$f" repo); r=${r//\"/}; [ -z "$r" ] || [[ "$r" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { FAIL "$f: repo '$r' is not owner/name"; r6=1; }
  d=$(fm_val "$f" folder); d=${d//\"/}; [ -z "$d" ] || { [[ "$d" != */* && "$d" != *\\* && ! "$d" =~ ^[A-Za-z]: ]] || { FAIL "$f: folder '$d' is a path, not a name"; r6=1; }; }
done
[ $r6 = 0 ] && echo "ok"

echo "==="
if [ $fail = 0 ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; exit 1; fi
