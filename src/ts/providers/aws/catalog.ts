import { CatalogEntry, PlanResource } from "../../types/index.js";

var AWS_REG: Record<string, CatalogEntry> = {
  aws_vpc:                          {kind:"group", g:"vpc",    label:"VPC",                  icon:"i-vpc",    cat:"net",
                                      preview:["cidr_block","enable_dns_support","enable_dns_hostnames"]},
  aws_subnet:                       {kind:"group", g:"subnet", label:"Subnet",               icon:"i-subnet", cat:"net",
                                      preview:["cidr_block","availability_zone","map_public_ip_on_launch"]},

  aws_instance:                     {kind:"node", label:"EC2 Instance",        icon:"i-ec2",    cat:"compute", sub:"instance_type",
                                      preview:["ami","availability_zone","private_ip"]},
  aws_internet_gateway:             {kind:"node", label:"Internet Gateway",    icon:"i-igw",    cat:"net",  scope:"vpc",
                                      preview:["vpc_id"]},
  aws_egress_only_internet_gateway: {kind:"node", label:"Egress-Only IGW",     icon:"i-igw",    cat:"net",  scope:"vpc",
                                      preview:["vpc_id"]},
  aws_nat_gateway:                  {kind:"node", label:"NAT Gateway",         icon:"i-nat",    cat:"net",
                                      preview:["subnet_id","connectivity_type","allocation_id"]},
  aws_route_table:                  {kind:"node", label:"Route Table",         icon:"i-rt",     cat:"net",  scope:"vpc",
                                      preview:["vpc_id"]},
  aws_route:                        {kind:"node", label:"Route",               icon:"i-rt",     cat:"net",  scope:"vpc",
                                      preview:["destination_cidr_block","gateway_id","nat_gateway_id"]},
  aws_vpc_endpoint:                 {kind:"node", label:"VPC Endpoint",        icon:"i-vpce",   cat:"net",  sub:"service_name",
                                      preview:["vpc_endpoint_type","vpc_id"]},
  aws_network_acl:                  {kind:"node", label:"Network ACL",         icon:"i-nacl",   cat:"sec",  scope:"vpc",
                                      preview:["vpc_id"]},
  aws_security_group:               {kind:"group", g:"sg", label:"Security Group", icon:"i-sg",  cat:"sec",  scope:"vpc"},
  aws_eip:                          {kind:"node", label:"Elastic IP",          icon:"i-eip",    cat:"net",
                                      preview:["domain","public_ip","instance"]},
  aws_lb:                           {kind:"node", label:"Load Balancer",       icon:"i-lb",     cat:"net",
                                      preview:["load_balancer_type","internal"]},
  aws_alb:                          {kind:"node", label:"Load Balancer",       icon:"i-lb",     cat:"net",
                                      preview:["load_balancer_type","internal"]},
  aws_lb_target_group:              {kind:"node", label:"Target Group",        icon:"i-lb",     cat:"net",  scope:"vpc",
                                      preview:["port","protocol","target_type"]},
  aws_db_instance:                  {kind:"node", label:"RDS Instance",        icon:"i-db",     cat:"db",   sub:"engine",
                                      preview:["engine_version","instance_class","allocated_storage","multi_az"]},
  aws_db_subnet_group:              {kind:"node", label:"DB Subnet Group",     icon:"i-db",     cat:"db",
                                      preview:["subnet_ids"]},
  aws_rds_cluster:                  {kind:"node", label:"RDS Cluster",         icon:"i-db",     cat:"db",   sub:"engine",
                                      preview:["engine_version","database_name"]},
  aws_s3_bucket:                    {kind:"node", label:"S3 Bucket",           icon:"i-s3",     cat:"storage", scope:"region",
                                      preview:["bucket","force_destroy"]},
  aws_lambda_function:              {kind:"node", label:"Lambda Function",     icon:"i-lambda", cat:"compute", sub:"runtime",
                                      preview:["handler","memory_size","timeout"]},
  aws_cloudwatch_log_group:         {kind:"node", label:"Log Group",           icon:"i-cw",     cat:"mgmt", scope:"region",
                                      preview:["retention_in_days"]},

  aws_iam_role:                     {kind:"node", label:"IAM Role",            icon:"i-iam",    cat:"sec",  scope:"global",
                                      preview:["path","max_session_duration"]},
  aws_iam_policy:                   {kind:"node", label:"IAM Policy",          icon:"i-iam",    cat:"sec",  scope:"global",
                                      preview:["path"]},
  aws_iam_instance_profile:         {kind:"node", label:"Instance Profile",    icon:"i-iam",    cat:"sec",  scope:"global",
                                      preview:["role"]},
  aws_iam_user:                     {kind:"node", label:"IAM User",            icon:"i-iam",    cat:"sec",  scope:"global",
                                      preview:["path"]},

  aws_route_table_association:          {kind:"assoc", label:"RT Association",       icon:"i-rt",  cat:"net",
                                          preview:["subnet_id","route_table_id"]},
  aws_main_route_table_association:     {kind:"assoc", label:"Main RT Association",  icon:"i-rt",  cat:"net",
                                          preview:["route_table_id"]},
  aws_network_acl_association:          {kind:"assoc", label:"NACL Association",     icon:"i-nacl",cat:"sec",
                                          preview:["subnet_id"]},
  aws_iam_role_policy_attachment:       {kind:"assoc", label:"Policy Attachment",    icon:"i-iam", cat:"sec",
                                          preview:["policy_arn"]},
  aws_iam_user_policy_attachment:       {kind:"assoc", label:"Policy Attachment",    icon:"i-iam", cat:"sec",
                                          preview:["policy_arn"]},
  aws_security_group_rule:              {kind:"assoc", label:"SG Rule",              icon:"i-sg",  cat:"sec",
                                          preview:["type","from_port","to_port","protocol"]},
  aws_vpc_security_group_ingress_rule:  {kind:"assoc", label:"SG Ingress Rule",      icon:"i-sg",  cat:"sec",
                                          preview:["from_port","to_port","ip_protocol","cidr_ipv4"]},
  aws_vpc_security_group_egress_rule:   {kind:"assoc", label:"SG Egress Rule",       icon:"i-sg",  cat:"sec",
                                          preview:["from_port","to_port","ip_protocol","cidr_ipv4"]},
  aws_lb_listener:                      {kind:"assoc", label:"LB Listener",          icon:"i-lb",  cat:"net",
                                          preview:["port","protocol"]},
  aws_vpc_endpoint_route_table_association:{kind:"assoc", label:"Endpoint RT Assoc", icon:"i-vpce",cat:"net",
                                          preview:["route_table_id"]}
};

var CAT: Record<string, string> = {
  compute:  "var(--aws-compute)",
  net:      "var(--aws-net)",
  sec:      "var(--aws-sec)",
  storage:  "var(--aws-storage)",
  db:       "var(--aws-db)",
  mgmt:     "var(--aws-mgmt)"
};

var CAT_LABEL: [string, string][] = [
  ["compute", "Compute"],
  ["net",     "Networking"],
  ["sec",     "Security & identity"],
  ["storage", "Storage"],
  ["db",      "Database"],
  ["mgmt",    "Management"],
  ["other",   "Not implemented"]
];

var SIZE_H: Record<string, number> = {nano:16, micro:20, small:26, medium:32, large:40, xlarge:52,
              "2xlarge":64, "4xlarge":78, "8xlarge":92, "12xlarge":104,
              "16xlarge":116, "24xlarge":128, metal:140};

function awsBlockHeight(r: PlanResource): number {
  var t = r.attrs && (r.attrs.instance_type || r.attrs.node_type || r.attrs.instance_class);
  if (t){
    var sz = String(t).split(".").slice(1).join(".");
    if (SIZE_H[sz]) return SIZE_H[sz];
  }
  if (r.type === "aws_vpc_endpoint") return 22;
  if (r.kind === "assoc") return 10;
  return 26;
}

export { AWS_REG, CAT, CAT_LABEL, SIZE_H, awsBlockHeight };
