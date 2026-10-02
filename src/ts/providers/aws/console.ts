// providers/aws/console.ts — deep links into the AWS web console
import { PlanResource } from "../../types/index.js";

/* Console URLs are not a documented API; these templates follow the patterns
   the console has used for years. A link is only offered when the physical id
   is known, so resources being created (id "known after apply") get none. */

function consoleHost(region: string): string {
  if (region.indexOf("cn-") === 0) return "https://" + region + ".console.amazonaws.cn";
  if (region.indexOf("us-gov-") === 0) return "https://" + region + ".console.amazonaws-us-gov.com";
  return "https://" + region + ".console.aws.amazon.com";
}

function awsConsoleUrl(r: PlanResource, ctx?: any): string | null {
  var region = ctx && ctx.region;
  if (!region || !/^[a-z]{2}(-[a-z]+)+-\d+$/.test(region)) return null;
  var val = function(k: string): any { return (r.attrs && r.attrs[k]) || (r.before && r.before[k]); };
  var id = val("id");
  var host = consoleHost(region), q = "?region=" + encodeURIComponent(region);

  /* IAM is global and addressed by name, not by id; the name is unknown when
     the role is built from name_prefix. */
  if (r.type === "aws_iam_role") {
    var name = val("name");
    if (typeof name !== "string" || !name) return null;
    var iamHost = host.replace(region + ".", "");
    return iamHost + "/iam/home#/roles/details/" + encodeURIComponent(name);
  }

  if (typeof id !== "string" || !id) return null;
  var eid = encodeURIComponent(id);

  switch (r.type) {
    case "aws_instance":
      return host + "/ec2/home" + q + "#InstanceDetails:instanceId=" + eid;
    case "aws_security_group":
      return host + "/ec2/home" + q + "#SecurityGroup:securityGroupId=" + eid;
    case "aws_vpc":
      return host + "/vpcconsole/home" + q + "#VpcDetails:VpcId=" + eid;
    case "aws_subnet":
      return host + "/vpcconsole/home" + q + "#SubnetDetails:subnetId=" + eid;
    case "aws_route_table":
      return host + "/vpcconsole/home" + q + "#RouteTableDetails:RouteTableId=" + eid;
    case "aws_internet_gateway":
      return host + "/vpcconsole/home" + q + "#InternetGateway:internetGatewayId=" + eid;
    case "aws_nat_gateway":
      return host + "/vpcconsole/home" + q + "#NatGatewayDetails:natGatewayId=" + eid;
    case "aws_eip":
      return host + "/ec2/home" + q + "#ElasticIpDetails:AllocationId=" + eid;
    default:
      return null;
  }
}

export { awsConsoleUrl };
