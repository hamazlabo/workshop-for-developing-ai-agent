import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface InstanceConfig {
  instanceName: string;
  instanceType: ec2.InstanceType;
  machineImage: ec2.IMachineImage;
  blockDevices: ec2.BlockDevice[];
  userDataPath?: string;
  whiteList: string[];
}

export const instanceConfig = {
  CodeServer: {
    instanceName: 'code-server',
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
    blockDevices: [
      {
        // ルートボリューム
        deviceName: '/dev/sda1',
        volume: ec2.BlockDeviceVolume.ebs(20, {
          volumeType: ec2.EbsDeviceVolumeType.GP3,
          deleteOnTermination: true,
        }),
      }
    ],
    machineImage: ec2.MachineImage.fromSsmParameter(
      '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id',
      { os: ec2.OperatingSystemType.LINUX }
    ),
    userDataPath: './lib/userdata/codeServer.sh',
    whiteList: []
  },
  RocketChat: {
    instanceName: 'rocket-chat',
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
    blockDevices: [
      {
        // ルートボリューム
        deviceName: '/dev/sda1',
        volume: ec2.BlockDeviceVolume.ebs(20, {
          volumeType: ec2.EbsDeviceVolumeType.GP3,
          deleteOnTermination: true,
        }),
      }
    ],
    machineImage: ec2.MachineImage.fromSsmParameter(
      '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id',
      { os: ec2.OperatingSystemType.LINUX }
    ),
    userDataPath: './lib/userdata/rocketChat.sh',
    whiteList: []
  }
};