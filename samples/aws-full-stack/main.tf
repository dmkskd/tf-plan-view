########################################################################
# A richer AWS "full stack" sample: VPC, ALB, ASG, RDS and S3, plus
# supporting IAM/security groups — for generating tfplanview sample plans.
#
# PLAN-ONLY BY DEFAULT. This is not meant to be applied against real AWS.
# With var.plan_only = true (the default), fake credentials + skip_* flags
# mean `terraform plan` never makes a real AWS API call or needs network
# access to AWS itself (only to the provider registry, on `terraform init`).
# `terraform apply` will fail with a 401 AuthFailure — that's expected.
#
# IMPORTANT: if a real terraform.tfstate exists (from a previous `apply
# -var="plan_only=false"`), you MUST also pass -refresh=false, or plan will
# try to refresh those real resources using the fake credentials and fail.
# `just plan` already does this for you.
#
# Usage (default, safe, no AWS account needed):
#   terraform init
#   terraform plan -refresh=false -out=tfplan
#   terraform show -json tfplan > plan.json
#   Then load plan.json into tfplanview with the "Load plan.json" button.
#
# To actually apply this against a real AWS account instead:
#   terraform apply -var="plan_only=false"
#   (uses your normal AWS credential chain — env vars, ~/.aws/credentials,
#   SSO, or an IAM role — same as any other Terraform config.)
########################################################################

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "plan_only" {
  description = "true (default): fake credentials, never calls AWS — safe for `terraform plan`. false: applies for real, using your normal AWS credential chain."
  type        = bool
  default     = true
}

provider "aws" {
  region                      = var.region
  access_key                  = var.plan_only ? "fake" : null
  secret_key                  = var.plan_only ? "fake" : null
  skip_credentials_validation = var.plan_only
  skip_requesting_account_id  = var.plan_only
  skip_metadata_api_check     = var.plan_only
  skip_region_validation      = var.plan_only
}

variable "region" {
  default = "us-east-1"
}

# Three AZs, hardcoded rather than looked up via a data source, so plan
# never needs to call the AWS API. Three rather than two: it's easier to
# see "spans some but not all AZs" vs. "spans every AZ" when those aren't
# the same number.
variable "azs" {
  default = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

# Flips a few resources to a changed shape, to capture a real create/update/
# replace/delete mix instead of an all-create plan. Apply with this false
# first (the baseline), then true (the changes) — see capture-changes.sh.
variable "staged_changes" {
  type    = bool
  default = false
}

########################################################################
# Networking
########################################################################

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support    = true
  enable_dns_hostnames  = true
  tags = { Name = "main" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "main" }
}

resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "public-${var.azs[count.index]}" }
}

resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
  availability_zone = var.azs[count.index]
  tags = { Name = "private-${var.azs[count.index]}" }
}

resource "aws_subnet" "db" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 20)
  availability_zone = var.azs[count.index]
  tags = { Name = "db-${var.azs[count.index]}" }
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "nat" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "main" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "public" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = { Name = "private" }
}

resource "aws_route_table_association" "public" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

########################################################################
# Security groups
########################################################################

resource "aws_security_group" "alb" {
  name        = "alb"
  description = "Public ALB ingress"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "alb" }
}

resource "aws_security_group" "app" {
  name        = "app"
  description = "App servers - only reachable from the ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "App port from ALB"
    from_port        = 8080
    to_port          = 8080
    protocol         = "tcp"
    security_groups  = [aws_security_group.alb.id]
  }
  dynamic "ingress" {
    for_each = var.staged_changes ? [1] : []
    content {
      description = "SSH from the VPC (added by staged_changes)"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [aws_vpc.main.cidr_block]
    }
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "app" }
}

resource "aws_security_group" "db" {
  name        = "db"
  description = "Database - only reachable from app servers"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from app servers"
    from_port        = 5432
    to_port          = 5432
    protocol         = "tcp"
    security_groups  = [aws_security_group.app.id]
  }
  tags = { Name = "db" }
}

########################################################################
# IAM (instance role for the app servers)
########################################################################

resource "aws_iam_role" "app" {
  name = "app-instance-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_instance_profile" "app" {
  name = "app-instance-profile"
  role = aws_iam_role.app.name
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

########################################################################
# Load balancer + target group
########################################################################

resource "aws_lb" "app" {
  name               = "app"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  tags               = { Name = "app" }
}

resource "aws_lb_target_group" "app" {
  name        = "app"
  port        = 8080
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = aws_vpc.main.id

  health_check {
    path                = "/healthz"
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

########################################################################
# Autoscaling group + launch template
########################################################################

resource "aws_launch_template" "app" {
  # No user_data: this instance never actually serves anything, so the ALB
  # target group's /healthz check on 8080 will never pass. Fine for a plan
  # diagram, not fine if you actually expect traffic to flow.
  name_prefix   = "app-"
  image_id      = "ami-0c101f26f147fa7fd" # Amazon Linux 2023, us-east-1 — hardcoded, no data source lookup
  instance_type = "t3.micro"

  iam_instance_profile {
    name = aws_iam_instance_profile.app.name
  }

  vpc_security_group_ids = [aws_security_group.app.id]

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "app" }
  }
}

resource "aws_autoscaling_group" "app" {
  name                = "app"
  min_size            = 2
  max_size            = 4
  desired_capacity    = 2
  vpc_zone_identifier = aws_subnet.private[*].id
  target_group_arns   = [aws_lb_target_group.app.arn]

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "app"
    propagate_at_launch = true
  }
}

########################################################################
# Database
########################################################################

resource "aws_db_subnet_group" "main" {
  name       = "main"
  subnet_ids = aws_subnet.db[*].id
  tags       = { Name = "main" }
}

resource "aws_db_instance" "main" {
  identifier             = "app-db"
  engine                 = "postgres"
  engine_version         = "16.4"
  instance_class         = "db.t3.micro"
  allocated_storage      = 20
  db_name                = "appdb"
  username               = "appadmin"
  password               = "change-me-before-apply" # marked sensitive by the aws provider schema
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  multi_az               = false
  skip_final_snapshot    = true
}

########################################################################
# Storage
########################################################################

resource "aws_s3_bucket" "assets" {
  bucket = "app-assets-example-bucket"
  tags   = { Name = "assets" }
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

########################################################################
# Logging
########################################################################

resource "aws_cloudwatch_log_group" "app" {
  count             = var.staged_changes ? 0 : 1 # retired when staged
  name              = "/app/main"
  retention_in_days = 14
}

########################################################################
# A standalone EC2 instance, outside the ASG — just so a plain aws_instance
# shows up in the diagram alongside the ASG-managed ones. It is NOT a
# bastion: it shares the "app" security group (§166), which only allows
# inbound 8080 from the ALB, plus the staged SSH rule scoped to the VPC's own
# CIDR — there is no route for an operator outside the VPC to reach it.
########################################################################

resource "aws_instance" "app" {
  # Real, currently-valid Amazon Linux AMIs for us-east-1 (via the public SSM
  # parameters), not a data source — so plan_only=true never calls AWS.
  ami                    = var.staged_changes ? "ami-019f95f906c09e357" : "ami-0fef201115eefe936" # AMI change forces replacement
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name
  tags                   = { Name = "app" }
}

########################################################################
# Outputs
########################################################################

output "alb_dns_name" {
  value = aws_lb.app.dns_name
}

output "db_endpoint" {
  value     = aws_db_instance.main.endpoint
  sensitive = true
}
