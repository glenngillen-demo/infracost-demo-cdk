#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { DemoCdkStack, SqlServerBahrainStack } from "../lib/demo-cdk-stack";

const app = new cdk.App();

// Main demo stack (environment-agnostic)
new DemoCdkStack(app, "DemoCdkStack", {
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});

// SQL Server Enterprise Multi-AZ stack in Bahrain region (me-south-1)
new SqlServerBahrainStack(app, "SqlServerBahrainStack", {
  env: {
    region: "me-south-1", // Bahrain region
  },
  description:
    "SQL Server Enterprise Multi-AZ (db.r5.24xlarge) in Bahrain region",
});
