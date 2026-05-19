import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as fs from 'fs';
import type { InstanceConfig } from '../config/instance';

import { Construct } from 'constructs';

// CloudFront のオリジン向けマネージドプレフィックスリスト (ap-northeast-1)
// com.amazonaws.global.cloudfront.origin-facing
const CLOUDFRONT_ORIGIN_PREFIX_LIST_ID = 'pl-58a04531';

export interface RocketChatProps {
  vpc: ec2.IVpc;
  config: InstanceConfig;
  instanceRole: iam.IRole;
}

export class RocketChat extends Construct {
  public readonly instance: ec2.Instance;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: RocketChatProps) {
    super(scope, id);

    // セキュリティグループの作成
    this.securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for RocketChat instance',
      allowAllOutbound: true
    });

    // 3000ポートを CloudFront のマネージドプレフィックスリストからのみ許可
    this.securityGroup.addIngressRule(
      ec2.Peer.prefixList(CLOUDFRONT_ORIGIN_PREFIX_LIST_ID),
      ec2.Port.tcp(3000),
      'Allow access to RocketChat from CloudFront only'
    );

    // KeyPairの作成
    const keyPair = new ec2.KeyPair(this, 'KeyPair', {
      keyPairName: props.config.instanceName,
      type: ec2.KeyPairType.RSA,
      format: ec2.KeyPairFormat.PEM
    });
    keyPair.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // KeyPairにタグを追加
    cdk.Tags.of(keyPair).add('Name', props.config.instanceName);
    cdk.Tags.of(keyPair).add('CreatedBy', 'CDK');

    // EC2インスタンスの作成（パブリックサブネットに配置）
    this.instance = new ec2.Instance(this, 'Instance', {
      vpc: props.vpc,
      instanceType: props.config.instanceType,
      machineImage: props.config.machineImage,
      securityGroup: this.securityGroup,
      keyPair: keyPair,
      role: props.instanceRole,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      blockDevices: props.config.blockDevices,
      associatePublicIpAddress: true,
      // userData（rocketChat.sh）変更時にインスタンスを置換し、変更を確実に反映させる
      userDataCausesReplacement: true
    });

    // ユーザデータのロード
    if (props.config.userDataPath) {
      const userDataScript = fs.readFileSync(props.config.userDataPath, 'utf8');
      this.instance.addUserData(userDataScript);
    }

    // インスタンスにタグを付ける
    cdk.Tags.of(this.instance).add('Name', props.config.instanceName);

    // CloudFront ディストリビューションの作成（HTTPS 化）
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${props.config.instanceName} CloudFront in front of RocketChat`,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      enableIpv6: true,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        // EC2 のパブリック DNS をオリジンとし、HTTP(3000) で接続する
        origin: new origins.HttpOrigin(this.instance.instancePublicDnsName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          httpPort: 3000,
          readTimeout: cdk.Duration.seconds(60),
          keepaliveTimeout: cdk.Duration.seconds(60)
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        // キャッシュ無効（RocketChat は動的コンテンツのため）
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Host ヘッダを転送し RocketChat に CloudFront のホスト名を認識させる
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER
      }
    });

    // 出力
    new cdk.CfnOutput(this, 'RocketChatURL', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'URL to access RocketChat through CloudFront'
    });

    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name'
    });

    new cdk.CfnOutput(this, 'InstanceId', {
      value: this.instance.instanceId,
      description: 'EC2 instance ID (use SSM Session Manager to log in)'
    });
  }
}
