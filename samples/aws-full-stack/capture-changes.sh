#!/usr/bin/env bash
# Captures a real create/update/replace/delete diff as changes-plan.json.
#
# Assumes the baseline (staged_changes=false, the current main.tf default) is already
# applied. Flips to staged_changes=true, which: adds an SSH rule to the app security
# group (update), retires the log group (delete), and swaps aws_instance.app's
# AMI (replace).
#
# Usage: ./capture-changes.sh
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -s terraform.tfstate ]] || [[ "$(python3 -c 'import json,sys; print(len(json.load(open("terraform.tfstate"))["resources"]))' 2>/dev/null)" == "0" ]]; then
  echo "terraform.tfstate is empty — apply the baseline first:" >&2
  echo "  just apply confirm" >&2
  exit 1
fi

tmp_plan="$(mktemp -t capture-changes)"
trap 'rm -f "$tmp_plan"' EXIT

terraform plan -input=false -var="plan_only=false" -var="staged_changes=true" -out="$tmp_plan"
terraform show -json "$tmp_plan" > changes-plan.json

python3 -c '
import json, collections
d = json.load(open("changes-plan.json"))
c = collections.Counter()
for rc in d["resource_changes"]:
    a = rc["change"]["actions"]
    key = "no-op" if a == ["no-op"] else ("replace" if a == ["delete","create"] else a[0])
    c[key] += 1
print("changes-plan.json:", dict(c))
'
