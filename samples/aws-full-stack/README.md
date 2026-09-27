# aws-full-stack sample

Terraform project (VPC, ALB, ASG, RDS, S3, IAM) for generating richer sample
plan JSONs for tfplanview.

```
just init            # or: terraform init
just plan            # plan-only, offline, safe — no AWS credentials needed
just apply confirm   # apply the baseline for real against AWS
just capture         # capture a real create/update/replace/delete diff into changes-plan.json
just destroy confirm # tear it all down
```

Safe by default (`plan_only = true`): fake credentials, never calls AWS.
`just apply`/`destroy` need the literal word `confirm` and use your normal
AWS credentials. NAT Gateway/ALB/RDS bill hourly — don't forget
`just destroy confirm` when done.

`just capture` needs the baseline (`just apply`) already applied first — it
flips `var.staged_changes` to produce a real diff (an SG rule update, a deleted log
group, a replaced instance) into `changes-plan.json`, loadable in tfplanview
via "Load plan.json".
