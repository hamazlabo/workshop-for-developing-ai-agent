# workshop-for-developing-ai-agent

Strands Agents を使って、AI エージェントを作成するワークショップです。フレームワークの基礎からシステムプロンプトの役割、ツールの設計方法など、基礎を包括的に学ぶことが出来ます。

## 本ワークショップで学べる概念

本ワークショップを通じて、以下の概念を手を動かしながら習得できます。

- **開発環境の構築**: `uv` による Python パッケージ・仮想環境管理の基礎
- **AI エージェントの基礎**: Strands Agents フレームワークの考え方と最小構成のエージェント実装
- **モデルの選択**: Amazon Bedrock 経由での各種モデル (Anthropic Claude / Amazon Nova / OpenAI GPT) の利用方法
- **システムプロンプト**: エージェントに役割・振る舞いを与えるプロンプト設計
- **マルチターン会話**: `messages` の役割、Session Manager (File / S3) を使った会話履歴の管理と管理戦略
- **ツールによる拡張**: コミュニティツールの利用とツールの自作、ツール設計のポイント
- **レスポンス制御**: 同期実行とストリーミングレスポンスの扱い方
- **デプロイ**: AgentCore を使ったエージェントのデプロイ・実行・セッション管理・クリーンアップ

各テーマの詳細な手順は [`workshop/`](workshop/) 内のドキュメントを参照してください。

## ディレクトリ構成

```
.
├── environment/          # ワークショップ用環境を構築する AWS CDK プロジェクト
│   ├── bin/              # CDK アプリのエントリポイント
│   ├── lib/              # スタック定義
│   │   ├── config/       # インスタンス・ネットワークの設定
│   │   ├── constructs/   # 再利用可能なコンストラクト (code-server, VPC, IAM ロール等)
│   │   └── userdata/     # EC2 起動時に実行するセットアップスクリプト
│   └── test/             # CDK のテスト
├── tools/                # エージェントから呼び出すツールの実装 (天気予報など)
└── workshop/             # ワークショップの手順を記したドキュメント
```

## ワークショップ環境構築手順

`environment/` の AWS CDK プロジェクトをデプロイすることで、参加者用の code-server (ブラウザ版 VS Code) 環境を構築できます。

### 前提条件

- Node.js 18.x 以上
- AWS CLI 設定済み
- AWS CDK 2.x (`npm install -g aws-cdk`)

### デプロイ

```bash
cd environment

# 依存関係のインストール
npm install

# CDK ブートストラップ (初回のみ)
cdk bootstrap

# CFn テンプレート生成 (任意)
cdk synth

# スタックのデプロイ
cdk deploy

# 特定の AWS プロファイルを使用する場合
cdk deploy --profile xxx
```

### code-server の台数を変更する

参加者数に応じて、構築する code-server インスタンスの台数を変更できます。`environment/lib/workshop-stack.ts` のループの上限値を編集してください。

```typescript
// 例: 25 台の code-server インスタンスを作成する場合
for (let i = 1; i <= 25; i++) {
```

上限値が作成される台数になります (`i <= 1` なら 1 台、`i <= 25` なら 25 台)。編集後に `cdk deploy` を実行すると、台数が反映されます。

### インスタンスへのアクセス

code-server へは CloudFront 経由 (HTTPS) でアクセスします。EC2 のポートは CloudFront のマネージドプレフィックスリストからのみ許可されており、直接アクセスはできません。

1. **Code-Server URL の取得**: デプロイ完了時に出力される `CodeServerURL` を使用します。スタックの出力からも確認できます。
   ```bash
   aws cloudformation describe-stacks \
     --stack-name WorkshopStack \
     --query "Stacks[0].Outputs[?contains(OutputKey, 'CodeServerURL')].OutputValue" \
     --output text
   ```
   ブラウザで `https://<CloudFront ドメイン>` にアクセスします。
2. **パスワードの取得**:
   ```bash
   aws ssm get-parameter \
     --name "/workshop/code-server/<instance-id>/password" \
     --with-decryption \
     --query Parameter.Value \
     --output text
   ```

## RocketChat の使い方

ワークショップ中の質問・連絡用に RocketChat (チャットサーバー) が同時にデプロイされます。こちらも CloudFront 経由 (HTTPS) でアクセスします。

### アクセス

デプロイ完了時に出力される `RocketChatURL` を使用します。スタックの出力からも確認できます。

```bash
aws cloudformation describe-stacks \
  --stack-name WorkshopStack \
  --query "Stacks[0].Outputs[?contains(OutputKey, 'RocketChatURL')].OutputValue" \
  --output text
```

ブラウザで `https://<CloudFront ドメイン>` にアクセスします。

### 初期セットアップ (管理者のみ・初回のみ)

1. ブラウザで RocketChat URL にアクセスすると「ワークスペースを起動しましょう」画面が表示されます。
2. 管理者情報 (氏名・ユーザー名・メール・パスワード) を入力して「次へ」を進めます。
3. 管理者作成後、ログイン画面に遷移します。

### 匿名アクセスの有効化 (任意)

参加者がアカウント登録なしで利用できるようにする場合、管理者でログイン後に以下を設定します。

1. 右上の三点リーダー (...) → **⚙ Workspace** → **設定** を開く。
2. 検索バーで「アカウント」を検索し、該当タブを開く。
3. **匿名の読み取りを許可** / **匿名の書き込みを許可** を ON にする。
4. **変更を保存** をクリックする。

匿名ユーザーでの動作確認は、シークレットモードまたは別ブラウザで同じ URL を開いてください (管理者セッションが残っていると管理画面に遷移します)。

### クリーンアップ

```bash
cd environment
cdk destroy
```

> インスタンス数や IAM 権限の変更などの詳細なカスタマイズ手順は [environment/README.md](environment/README.md) を参照してください。
