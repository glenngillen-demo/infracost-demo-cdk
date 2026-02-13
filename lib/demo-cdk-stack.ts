import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';

export class DemoCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC with public and private subnets across 2 AZs
    const vpc = new ec2.Vpc(this, 'DemoVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // ECS Cluster for the web application
    const cluster = new ecs.Cluster(this, 'DemoCluster', {
      vpc,
      containerInsights: true,
    });

    // Security group for RDS
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'Security group for RDS instance',
      allowAllOutbound: false,
    });

    // RDS PostgreSQL database in isolated subnet
    const database = new rds.DatabaseInstance(this, 'DemoDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [dbSecurityGroup],
      databaseName: 'demodb',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      multiAz: false,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Fargate service with Application Load Balancer
    const fargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'DemoWebApp',
      {
        cluster,
        cpu: 256,
        memoryLimitMiB: 512,
        desiredCount: 2,
        taskImageOptions: {
          image: ecs.ContainerImage.fromRegistry('nginx:alpine'),
          containerPort: 80,
          environment: {
            DB_HOST: database.dbInstanceEndpointAddress,
            DB_PORT: database.dbInstanceEndpointPort,
          },
        },
        publicLoadBalancer: true,
      }
    );

    // Allow the Fargate service to connect to the database
    dbSecurityGroup.addIngressRule(
      fargateService.service.connections.securityGroups[0],
      ec2.Port.tcp(5432),
      'Allow Fargate service to connect to PostgreSQL'
    );

    // Health check configuration for the load balancer
    fargateService.targetGroup.configureHealthCheck({
      path: '/',
      healthyHttpCodes: '200',
    });

    // Auto-scaling configuration
    const scaling = fargateService.service.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 10,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 70,
    });

    // ============================================
    // EC2 Auto Scaling Groups with Previous Gen Instance Types
    // ============================================

    // Amazon Linux 2 AMI for EC2 instances
    const ami = ec2.MachineImage.latestAmazonLinux2();

    // Security group for EC2 instances
    const ec2SecurityGroup = new ec2.SecurityGroup(this, 'Ec2SecurityGroup', {
      vpc,
      description: 'Security group for EC2 instances',
      allowAllOutbound: true,
    });
    ec2SecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH access'
    );

    // IAM role for EC2 instances
    const ec2Role = new iam.Role(this, 'Ec2InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // ASG 1: Web tier using M4 instances (previous gen, replaced by M5/M6/M7)
    const webTierAsg = new autoscaling.AutoScalingGroup(this, 'WebTierAsg', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.M4, ec2.InstanceSize.LARGE),
      machineImage: ami,
      role: ec2Role,
      securityGroup: ec2SecurityGroup,
      minCapacity: 2,
      maxCapacity: 8,
      desiredCapacity: 2,
    });
    cdk.Tags.of(webTierAsg).add('Tier', 'Web');
    cdk.Tags.of(webTierAsg).add('InstanceGeneration', 'Previous');

    // ASG 2: App tier using C4 instances (previous gen, replaced by C5/C6/C7)
    const appTierAsg = new autoscaling.AutoScalingGroup(this, 'AppTierAsg', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.C4, ec2.InstanceSize.XLARGE),
      machineImage: ami,
      role: ec2Role,
      securityGroup: ec2SecurityGroup,
      minCapacity: 2,
      maxCapacity: 6,
      desiredCapacity: 2,
    });
    cdk.Tags.of(appTierAsg).add('Tier', 'Application');
    cdk.Tags.of(appTierAsg).add('InstanceGeneration', 'Previous');

    // ASG 3: Worker tier using T2 instances (previous gen, replaced by T3/T3a)
    const workerTierAsg = new autoscaling.AutoScalingGroup(this, 'WorkerTierAsg', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.LARGE),
      machineImage: ami,
      role: ec2Role,
      securityGroup: ec2SecurityGroup,
      minCapacity: 1,
      maxCapacity: 10,
      desiredCapacity: 3,
    });
    cdk.Tags.of(workerTierAsg).add('Tier', 'Worker');
    cdk.Tags.of(workerTierAsg).add('InstanceGeneration', 'Previous');

    // ASG 4: Memory-intensive workloads using R4 instances (previous gen, replaced by R5/R6/R7)
    const memoryTierAsg = new autoscaling.AutoScalingGroup(this, 'MemoryTierAsg', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.R4, ec2.InstanceSize.LARGE),
      machineImage: ami,
      role: ec2Role,
      securityGroup: ec2SecurityGroup,
      minCapacity: 1,
      maxCapacity: 4,
      desiredCapacity: 2,
    });
    cdk.Tags.of(memoryTierAsg).add('Tier', 'Memory');
    cdk.Tags.of(memoryTierAsg).add('InstanceGeneration', 'Previous');

    // ============================================
    // ECS Cluster with EC2 Capacity (Previous Gen Instances)
    // ============================================

    const ecsEc2Cluster = new ecs.Cluster(this, 'LegacyEcsCluster', {
      vpc,
      clusterName: 'legacy-ec2-cluster',
    });

    // Add EC2 capacity with C3 instances (previous gen, replaced by C5/C6/C7)
    ecsEc2Cluster.addCapacity('LegacyCapacity', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.C3, ec2.InstanceSize.XLARGE),
      minCapacity: 2,
      maxCapacity: 6,
      desiredCapacity: 2,
    });

    // Add additional capacity with M3 instances (previous gen)
    ecsEc2Cluster.addCapacity('LegacyCapacityM3', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.M3, ec2.InstanceSize.LARGE),
      minCapacity: 1,
      maxCapacity: 4,
      desiredCapacity: 2,
    });

    // ============================================
    // Outputs
    // ============================================

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description: 'Application Load Balancer DNS name',
    });

    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: database.dbInstanceEndpointAddress,
      description: 'RDS Database endpoint',
    });

    new cdk.CfnOutput(this, 'WebTierAsgName', {
      value: webTierAsg.autoScalingGroupName,
      description: 'Web tier ASG name (M4 instances)',
    });

    new cdk.CfnOutput(this, 'LegacyEcsClusterName', {
      value: ecsEc2Cluster.clusterName,
      description: 'Legacy ECS cluster with EC2 capacity',
    });
  }
}

// ============================================
// SQL Server Stack for Bahrain Region (me-south-1)
// ============================================
export class SqlServerBahrainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC for SQL Server in Bahrain
    const vpc = new ec2.Vpc(this, 'SqlServerVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Security group for SQL Server
    const sqlServerSecurityGroup = new ec2.SecurityGroup(this, 'SqlServerSecurityGroup', {
      vpc,
      description: 'Security group for SQL Server RDS instance',
      allowAllOutbound: false,
    });

    // SQL Server Enterprise Multi-AZ in Bahrain (db.r5.24xlarge)
    const sqlServerDatabase = new rds.DatabaseInstance(this, 'SqlServerEnterprise', {
      engine: rds.DatabaseInstanceEngine.sqlServerEe({
        version: rds.SqlServerEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.R5,
        ec2.InstanceSize.XLARGE24
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [sqlServerSecurityGroup],
      allocatedStorage: 200,
      maxAllocatedStorage: 1000,
      multiAz: true,
      licenseModel: rds.LicenseModel.LICENSE_INCLUDED,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Outputs
    new cdk.CfnOutput(this, 'SqlServerEndpoint', {
      value: sqlServerDatabase.dbInstanceEndpointAddress,
      description: 'SQL Server Enterprise endpoint',
    });

    new cdk.CfnOutput(this, 'SqlServerVpcId', {
      value: vpc.vpcId,
      description: 'SQL Server VPC ID',
    });
  }
}
