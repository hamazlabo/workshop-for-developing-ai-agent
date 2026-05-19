import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface InstanceRoleProps {
  roleName?: string;
  description?: string;
}

export class InstanceRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props?: InstanceRoleProps) {
    super(scope, id);
    // ここからKMS権限までは固定(userdata内でパラメータストアを触っている為)
    // ワークショップ用のIAMロールを作成
    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      roleName: props?.roleName ?? 'workshop-instance-role',
      description: props?.description ?? 'IAM role for workshop instances',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('BedrockAgentCoreFullAccess')
      ]
    });

    // SSM Parameter Store への書き込み権限を付与（code-serverパスワード保存用）
    this.role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:PutParameter'],
      resources: [`arn:aws:ssm:*:${cdk.Stack.of(this).account}:parameter/workshop/code-server/*`]
    }));

    // KMS権限（SSM SecureStringパラメータ用）
    this.role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kms:Decrypt',
        'kms:Encrypt',
        'kms:GenerateDataKey'
      ],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'kms:ViaService': [`ssm.*.amazonaws.com`]
        }
      }
    }));
    // ここから下に、必要に応じて権限を追加する
    // Ex. Bedrock関連（AIエージェント構築ハンズオン用）
    this.role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:InvokeModel'
      ],
      resources: ['*']
    }));
  }
}
