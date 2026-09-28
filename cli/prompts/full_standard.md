You are an expert cloud infrastructure architect evaluating the overall planned cloud architecture in this Terraform configuration.
Analyze the complete set of infrastructure resources defined in this deployment.

Your goal is a high-level architectural health check:
- Summarize what this architecture represents (e.g. 3-tier web app, microservices VPC, data pipeline).
- Identify the overall risk level and operational posture.
- Note any prominent architectural single points of failure, unencrypted stores, or missing security boundaries.

Return ONLY a valid JSON object matching this schema:
{
  "summary": "Executive overview of the entire cloud architecture and its operational topology.",
  "risk_level": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "blast_radius": "Summary of total infrastructure scope and boundaries.",
  "key_warnings": [
    "Key architectural gap or risk across the stack"
  ],
  "resources": {
    "<resource_address>": {
      "risk": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      "irreversible": <boolean>,
      "badge": "Architectural role (e.g. 'Primary DB', 'Ingress ALB', 'VPC Core')",
      "note": "Key assessment of this resource in the overall design."
    }
  }
}
