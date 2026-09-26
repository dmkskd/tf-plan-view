// providers/gcp/index.js — Google Cloud Platform Provider Plugin (Starter Scaffold)
import { q } from "../../core/util.js";
import {
  placeGcpNetworks, placeGcpSubnetworks,
  placeGcpContainers, containerOfGcp
} from "./placement.js";

export var GCP_REG = {
  google_compute_network:    {kind:"group", g:"vpc",    label:"VPC Network",    icon:"i-vpc",    cat:"net",
                               preview:["auto_create_subnetworks","routing_mode"]},
  google_compute_subnetwork: {kind:"group", g:"subnet", label:"Subnetwork",     icon:"i-subnet", cat:"net",
                               preview:["ip_cidr_range","region","private_ip_google_access"]},
  google_compute_instance:   {kind:"node",              label:"Compute Engine", icon:"i-ec2",    cat:"compute", sub:"machine_type",
                               preview:["zone","machine_type"]},
  google_storage_bucket:     {kind:"node",              label:"Cloud Storage",  icon:"i-s3",     cat:"storage", scope:"region",
                               preview:["location","storage_class"]}
};

export function GCP_CLI(r, ctx) {
  var L = [];
  function add(label, cmd) { L.push({label:label, cmd:cmd}); }
  var t = r.type;
  switch (t) {
    case "google_compute_instance":
      add("Describe", "gcloud compute instances describe " + r.name + (ctx.zone ? " --zone " + ctx.zone : ""));
      break;
    case "google_compute_network":
      add("Describe", "gcloud compute networks describe " + r.name);
      break;
    case "google_storage_bucket":
      add("Describe", "gcloud storage buckets describe gs://" + r.name);
      break;
  }
  return L;
}

export const gcpProvider = {
  id: "google",
  name: "Google Cloud",
  prefix: "google_",
  get catalog() { return typeof GCP_REG !== "undefined" ? GCP_REG : {}; },
  categories: {
    compute: "var(--aws-compute)",
    net:     "var(--aws-net)",
    sec:     "var(--aws-sec)",
    storage: "var(--aws-storage)",
    db:      "var(--aws-db)",
    mgmt:    "var(--aws-mgmt)"
  },
  categoryLabels: [
    ["compute", "Compute Engine"],
    ["net",     "VPC Network"],
    ["storage", "Cloud Storage"]
  ],
  sizing: {
    blockHeight: () => 26
  },
  cli: GCP_CLI,
  rules: {
    rulesHtml: () => null,
    isRuleAttr: () => false,
    ruleKey: () => "",
    ruleRow: () => "",
    popRow: () => "",
    ruleLines: () => ""
  },
  get placement() {
    return {
      placeContainers: placeGcpContainers,
      containerOf: containerOfGcp,
      isBoundary: () => false,
      placeNetworks: placeGcpNetworks,
      placeSubnets: placeGcpSubnetworks
    };
  }
};

export default gcpProvider;
