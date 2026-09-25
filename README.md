# tf plan view

Renders a Terraform plan as an AWS architecture diagram, nesting resources as
Cloud, Region, VPC, Availability Zone, Subnet. Containment comes from
`configuration.root_module.resources[].expressions[*].references`, the only
relationship source a plan carries before apply.

## Run it

```sh
open index.html
```

The page opens empty.

## Load a plan

The app needs JSON. `plan.out` is binary, so convert it first:

```sh
cd <your-terraform-dir>
terraform plan -out=plan.out
terraform show -json plan.out > plan.json
```

Load the file with the **Load plan.json** button, or drag it onto the page. Files
are read in the browser and never uploaded. Click the filename in the top bar to
see the plan metadata, outputs and raw JSON.

**Sample plan** loads a plan embedded in `index.html`, covering creates, updates,
a replacement, a destroy, a no-op and drift.

## Views

**Topology** draws the architecture. Every tile looks the same; the plan action
appears only as a dot, which View can turn off.

**Changes** names the action on every tile and lists the attributes that change,
marking anything that forces replacement. Resources the plan does not touch are
hidden. When a plan holds updates, replacements or destroys, containers and plain
creates dim so the edited resources stand out.

**View: flat / isometric** switches projection. In isometric, drag to orbit,
shift-drag to pan, wheel to zoom, and block height follows instance size.

## Selecting a resource

The right pane shows what changes (before and after), the reconstructed Terraform
block, security group or network ACL rules as tables, AWS CLI commands for
inspecting it, and the planned attributes including the ones known only after
apply. Ids that do not exist yet appear as `<placeholders>`. Sections collapse and
remember their state.

**Disable** hides a resource and flags everything that transitively depends on it.

## Notes

Unrecognised resource types are drawn as dashed amber tiles and listed under
Validation, along with non-AWS providers, nested modules, drift and plans that
cannot be applied.

Add a type by adding a line to the `REG` object at the top of the `<script>` block.
The header comment there lists the other extension points.

Draws topology only. Does not evaluate security group or NACL reachability.

## Checking a change

Three scripts extract the functions that do not touch the DOM and print their
output. `tools/baseline/` holds that output recorded when it was correct, so a
diff shows exactly what a change altered:

```sh
node tools/check-boot.js                                          # does it start?
node tools/check-pure.js   | diff tools/baseline/check-pure.txt -
node tools/check-parse.js  | diff tools/baseline/check-parse.txt -
node tools/check-layout.js | diff tools/baseline/check-layout.txt -
```

`check-boot.js` runs the whole script against a shimmed DOM and exits non-zero if
it throws while starting up. The others only call individual functions, so an
exception during setup would otherwise pass unnoticed: the page renders its
static markup and every control silently stops responding.

`check-pure` covers the reconstructed Terraform block, CLI recipes, diffs and rule
tables; `check-parse` the parser and its validation messages; `check-layout` the
position and size of every box. If a diff is expected, re-record it:

```sh
node tools/check-layout.js > tools/baseline/check-layout.txt
```
