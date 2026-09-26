// providers/aws/cli.js — AWS CLI recipes
/* ---- AWS CLI: one inspect recipe per type. Plan-time IDs are unknown, so
   these filter by Name tag or name_prefix instead of by id. ---- */

function cliQuote(s){ return String(s).replace(/"/g, '\\"'); }

function awsCli(r, ctx){
  var reg = ctx.region ? ' --region ' + ctx.region : '';
  var tag = r.attrs && r.attrs.tags && r.attrs.tags.Name;
  var byTag = tag ? ' --filters "Name=tag:Name,Values=' + cliQuote(tag) + '"' : '';
  var pfx = r.attrs && r.attrs.name_prefix;
  var t = r.type;
  var L = [];
  function add(label, cmd){ L.push({label:label, cmd:cmd}); }

  switch (t){
    case "aws_vpc":
      add("Describe", "aws ec2 describe-vpcs" + reg + byTag);
      add("What is in it", "aws ec2 describe-subnets" + reg + ' --filters "Name=vpc-id,Values=<vpc-id>"');
      break;
    case "aws_subnet":
      add("Describe", "aws ec2 describe-subnets" + reg + byTag);
      add("Effective network ACL", "aws ec2 describe-network-acls" + reg +
          ' --filters "Name=association.subnet-id,Values=<subnet-id>" --query "NetworkAcls[0].Entries" --output table');
      add("Effective route table", "aws ec2 describe-route-tables" + reg +
          ' --filters "Name=association.subnet-id,Values=<subnet-id>" --query "RouteTables[0].Routes" --output table');
      break;
    case "aws_instance":
      add("Describe", "aws ec2 describe-instances" + reg + byTag +
          ' --query "Reservations[].Instances[].{Id:InstanceId,State:State.Name,Private:PrivateIpAddress,Public:PublicIpAddress}" --output table');
      add("Open a shell", "aws ssm start-session" + reg + " --target <instance-id>");
      add("Console output", "aws ec2 get-console-output" + reg + " --instance-id <instance-id> --output text");
      break;
    case "aws_security_group":
      add("Describe", "aws ec2 describe-security-groups" + reg + byTag);
      if (pfx) add("Find by prefix", "aws ec2 describe-security-groups" + reg +
          ' --query "SecurityGroups[?starts_with(GroupName, \'' + cliQuote(pfx) + '\')].{Id:GroupId,Name:GroupName}" --output table');
      add("Inbound rules", "aws ec2 describe-security-groups" + reg +
          ' --group-ids <sg-id> --query "SecurityGroups[0].IpPermissions" --output json');
      add("Outbound rules", "aws ec2 describe-security-groups" + reg +
          ' --group-ids <sg-id> --query "SecurityGroups[0].IpPermissionsEgress" --output json');
      break;
    case "aws_network_acl":
      add("Describe", "aws ec2 describe-network-acls" + reg + byTag);
      add("Rules as a table", "aws ec2 describe-network-acls" + reg +
          ' --network-acl-ids <acl-id> --query "NetworkAcls[0].Entries" --output table');
      break;
    case "aws_route_table":
      add("Describe", "aws ec2 describe-route-tables" + reg + byTag);
      add("Routes", "aws ec2 describe-route-tables" + reg +
          ' --route-table-ids <rtb-id> --query "RouteTables[0].Routes" --output table');
      break;
    case "aws_internet_gateway":
    case "aws_egress_only_internet_gateway":
      add("Describe", "aws ec2 describe-internet-gateways" + reg + byTag);
      break;
    case "aws_nat_gateway":
      add("Describe", "aws ec2 describe-nat-gateways" + reg +
          (tag ? ' --filter "Name=tag:Name,Values=' + cliQuote(tag) + '"' : ''));
      break;
    case "aws_vpc_endpoint":
      add("Describe", "aws ec2 describe-vpc-endpoints" + reg +
          ' --filters "Name=service-name,Values=' + cliQuote(r.attrs.service_name || "<service>") + '"');
      add("Endpoint ENI addresses", "aws ec2 describe-network-interfaces" + reg +
          ' --filters "Name=description,Values=*<vpce-id>*" --query "NetworkInterfaces[].PrivateIpAddress"');
      break;
    case "aws_eip":
      add("Describe", "aws ec2 describe-addresses" + reg + byTag);
      break;
    case "aws_iam_role":
      if (pfx) add("Find by prefix", "aws iam list-roles" + reg +
          ' --query "Roles[?starts_with(RoleName, \'' + cliQuote(pfx) + '\')].RoleName" --output table');
      add("Describe", "aws iam get-role --role-name <role-name>");
      add("Attached policies", "aws iam list-attached-role-policies --role-name <role-name> --output table");
      break;
    case "aws_iam_instance_profile":
      if (pfx) add("Find by prefix", "aws iam list-instance-profiles" +
          ' --query "InstanceProfiles[?starts_with(InstanceProfileName, \'' + cliQuote(pfx) + '\')].InstanceProfileName" --output table');
      add("Describe", "aws iam get-instance-profile --instance-profile-name <profile-name>");
      break;
    case "aws_iam_role_policy_attachment":
      add("Attached policies", "aws iam list-attached-role-policies --role-name <role-name> --output table");
      break;
    case "aws_iam_policy":
      add("Describe", "aws iam get-policy --policy-arn <policy-arn>");
      break;
    case "aws_route_table_association":
    case "aws_main_route_table_association":
      add("Associations", "aws ec2 describe-route-tables" + reg +
          ' --query "RouteTables[].Associations" --output table');
      break;
    case "aws_lb":
    case "aws_alb":
      add("Describe", "aws elbv2 describe-load-balancers" + reg + (r.attrs.name ? " --names " + r.attrs.name : ""));
      break;
    case "aws_lb_target_group":
      add("Describe", "aws elbv2 describe-target-groups" + reg + (r.attrs.name ? " --names " + r.attrs.name : ""));
      add("Target health", "aws elbv2 describe-target-health" + reg + " --target-group-arn <tg-arn> --output table");
      break;
    case "aws_db_instance":
      add("Describe", "aws rds describe-db-instances" + reg +
          (r.attrs.identifier ? " --db-instance-identifier " + r.attrs.identifier : ""));
      break;
    case "aws_rds_cluster":
      add("Describe", "aws rds describe-db-clusters" + reg +
          (r.attrs.cluster_identifier ? " --db-cluster-identifier " + r.attrs.cluster_identifier : ""));
      break;
    case "aws_s3_bucket":
      add("Describe", "aws s3api get-bucket-location --bucket " + (r.attrs.bucket || "<bucket>"));
      add("List contents", "aws s3 ls s3://" + (r.attrs.bucket || "<bucket>") + "/");
      break;
    case "aws_lambda_function":
      add("Describe", "aws lambda get-function" + reg + " --function-name " + (r.attrs.function_name || "<function>"));
      add("Recent logs", "aws logs tail" + reg + " /aws/lambda/" + (r.attrs.function_name || "<function>") + " --since 15m");
      break;
    case "aws_cloudwatch_log_group":
      add("Tail", "aws logs tail" + reg + " " + (r.attrs.name || "<log-group>") + " --follow");
      break;
    default:
      if (tag) add("Find by tag", "aws resourcegroupstaggingapi get-resources" + reg +
          ' --tag-filters "Key=Name,Values=' + cliQuote(tag) + '"');
      break;
  }
  return L;
}


export { awsCli, cliQuote };
