# tf plan view

Renders a Terraform plan as an AWS architecture diagram. Resources are drawn
inside the VPCs, subnets and security groups that contain them, so a plan can be
read as infrastructure rather than as a list of resources.

Runs in the browser with no AWS API access. The plan file is the only input.

## Use

```sh
open index.html

cd <terraform-dir>
terraform plan -out=plan.out
terraform show -json plan.out > plan.json
```

Load `plan.json` with the **Load plan.json** button or by dropping it on the
page. Files are read in the browser and never uploaded. **Sample plan** loads a
plan embedded in `index.html`.

## How it is built

References come from `expressions[*].references` and `depends_on` in
`configuration.root_module.resources`, truncated to `<type>.<name>`.

- `aws_vpc` and `aws_subnet` become containers. Subnets group by their
  `availability_zone` attribute.
- `aws_security_group` becomes a boundary around the resources that reference
  it. With no such resources it stays a tile.
- Every other resource sits in the first `aws_subnet` it references, else the
  `aws_vpc`, else at region or account level.
- Otherwise it follows a neighbour one reference away. `aws_eip` is placed with
  the `aws_nat_gateway` that references it.

## Limits

- AWS only. Other providers are reported, not supported.
- Topology only. Security group and network ACL reachability are not evaluated.
- Nested modules are drawn flat.
- `set`, `list` and `map` elements are matched using a bundled aws 5.100.0
  provider schema. Drop `terraform providers schema -json` output to override it.
- Unrecognised resource types are drawn as dashed amber tiles and reported.

See [DEVELOPMENT.md](DEVELOPMENT.md) to modify or verify the app.
