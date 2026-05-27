import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';
import * as path from 'path';
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
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
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
    // AgentCore ハンズオン用ポリシー（Bedrock 呼び出し権限を含む）を policy.json から付与する
    // ファイル内の ACCOUNT_ID プレースホルダをデプロイ先アカウントに置換する
    const policyPath = path.join(__dirname, 'policy.json');
    const policyJson = fs.readFileSync(policyPath, 'utf8')
      .replace(/ACCOUNT_ID/g, cdk.Stack.of(this).account);
    new iam.Policy(this, 'AgentCoreWorkshopPolicy', {
      document: iam.PolicyDocument.fromJson(JSON.parse(policyJson))
    }).attachToRole(this.role);
  }
}
