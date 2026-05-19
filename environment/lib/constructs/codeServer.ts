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

export interface InstanceProps {
  vpc: ec2.IVpc;
  config: InstanceConfig;
  instanceRole: iam.IRole;
}

export class Instance extends Construct {
  public readonly instance: ec2.Instance;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: InstanceProps) {
    super(scope, id);

    // セキュリティグループの作成
    this.securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for code-server instance',
      allowAllOutbound: true
    });

    // 50443ポートを CloudFront のマネージドプレフィックスリストからのみ許可
    this.securityGroup.addIngressRule(
      ec2.Peer.prefixList(CLOUDFRONT_ORIGIN_PREFIX_LIST_ID),
      ec2.Port.tcp(50443),
      'Allow access to code-server from CloudFront only'
    );

    // 8501ポートを全体に開放（ワークショップ用 / Streamlit）
    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8501),
      'Allow access to streamlit on code-server'
    );

    // SSH用の22番ポートを開放（管理用）
    if (props.config.whiteList && props.config.whiteList.length > 0) {
      props.config.whiteList.forEach((ip) => {
        this.securityGroup.addIngressRule(
          ec2.Peer.ipv4(ip),
          ec2.Port.tcp(22),
          'Allow SSH from whitelist'
        );
      });
    }

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
      // userData（codeServer.sh）変更時にインスタンスを置換し、変更を確実に反映させる
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
      comment: `${props.config.instanceName} CloudFront in front of code-server`,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      enableIpv6: true,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        // EC2 のパブリック DNS をオリジンとし、HTTP(50443) で接続する
        origin: new origins.HttpOrigin(this.instance.instancePublicDnsName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          httpPort: 50443,
          readTimeout: cdk.Duration.seconds(60),
          keepaliveTimeout: cdk.Duration.seconds(60)
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        // キャッシュ無効（code-server は動的コンテンツ・WebSocket のため）
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Host や Sec-WebSocket-* を含む全ヘッダをオリジンへ転送
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER
      }
    });

    // 出力
    new cdk.CfnOutput(this, 'InstancePublicIP', {
      value: this.instance.instancePublicIp,
      description: 'Public IP address of the code-server instance (SSH admin)'
    });

    new cdk.CfnOutput(this, 'CodeServerURL', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'URL to access code-server through CloudFront'
    });

    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name'
    });

    new cdk.CfnOutput(this, 'instanceRoleArn', {
      value: props.instanceRole.roleArn,
      description: 'ARN of the CloudFormation execution role for SAM'
    });
  }
}
