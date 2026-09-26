// providers/aws/index.ts — AWS Provider Plugin
import { ProviderPlugin } from "../../types/index.js";
import { AWS_REG, CAT, CAT_LABEL, SIZE_H, awsBlockHeight } from "./catalog.js";
import { awsCli } from "./cli.js";
import {
  PORT_NAME, portName, portText, protoText, peerText,
  awsRulesHtml, awsIsRuleAttr, awsRuleKey, awsRuleRow, awsPopRow, awsRuleLines
} from "./rules.js";
import {
  vpcOf, subnetOf, placeVpcs, placeSubnets, placeSecurityGroups,
  placeAwsContainers, containerOfAws, isBoundaryAws
} from "./placement.js";

export const awsProvider: ProviderPlugin = {
  id: "aws",
  name: "AWS",
  prefix: "aws_",
  catalog: AWS_REG,
  categories: CAT,
  categoryLabels: CAT_LABEL,
  cli: awsCli,
  get sizing() {
    return { blockHeight: awsBlockHeight, SIZE_H };
  },
  get rules() {
    return {
      PORT_NAME, portName, portText, protoText, peerText,
      rulesHtml: awsRulesHtml,
      isRuleAttr: awsIsRuleAttr,
      ruleKey: awsRuleKey,
      ruleRow: awsRuleRow,
      popRow: awsPopRow,
      ruleLines: awsRuleLines
    };
  },
  get placement() {
    return {
      placeContainers: placeAwsContainers,
      containerOf: containerOfAws,
      isBoundary: isBoundaryAws,
      vpcOf, subnetOf, placeVpcs, placeSubnets, placeSecurityGroups
    };
  }
};

export default awsProvider;
