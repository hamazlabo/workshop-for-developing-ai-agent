# 03_AgentCoreを使ったエージェントデプロイ

## Amazon Bedrock AgentCore 概要

### AI エージェントに必要な機能

AI エージェントを使ってアプリを作成する際、必要な機能はある程度決まっている。

- 実行基盤: 長時間の処理にも耐えられる事
- 記憶領域: 会話内容を覚えていられる事
- 認証認可: 認可された行動のみ実行出来る事
- システム間連携: 様々なシステムと連携出来る事
- 可観測性: 後から実行内容をトレース出来る事

これらを AWS 上で簡単に実装出来るようにしたのが、Amazon Bedrock AgentCore というサービスで、フレームワーク。

### AgentCore Runtime とは

AI エージェントを用いたワークロードの課題として、実行時間が長引くことが挙げられる。
従来の Lambda には 15分の実行上限があり、AI エージェントのホストには不向きだった。
そこでローンチされたのが、AgentCore Runtime。

特徴:

- AI エージェントのホストに特化している
    - HTTP なら 8080 の /invocations で、
    - MCP なら 8000 の /mcp、
    - A2A なら 9000 の / で公開する
    - /ping や、sigV4による認証を備える
- 最長8時間の連続処理に対応
- Lambda と同じく、リクエストを受けた瞬間に仮想 VMが起動する

今回は、このサービスを使って AI エージェントをデプロイする。

## 3.1. デプロイ準備

### 3.1.1. ホームディレクトリへ移動

```bash
cd ~
```

### 3.1.2. AgentCore SDK をインストール

```sh
sudo npm install -g @aws/agentcore
```

期待する出力:

```txt
added 763 packages in 35s

266 packages are looking for funding
  run `npm fund` for details
npm notice
npm notice New minor version of npm available! 11.12.1 -> 11.15.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.15.0
npm notice To update run: npm install -g npm@11.15.0
npm notice
```

## 3.2. AgentCore SDK を使って、エージェントをデプロイする

### 3.2.1. TUI を起動する

以下コマンドを実行する。

```bash
agentcore
```

以下のような画面が起動する

```text

  ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │ >_ AgentCore                                                                                           v0.15.0 │
  └────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  >  


  No AgentCore project found in this directory.

  You can:
    create - Create a new AgentCore project here
    or cd into an existing project directory

  ⚑ Press Enter to create a new project

  ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  Type to search, Tab commands, Esc quit
```

### 3.2.2. 対話的に設定を入力する

1. コマンドを入力
    > create
2. Project name を入力 (重複しなければ何でも良い)
    > ex. MyProject
3. would you like add an agent?(エージェントを追加する?)
    > Yes, add an agent
4. Agent name を入力 (重複しないものを入力する)
    > ex. MyAgent
    
    ハイフンは使えないので注意

5. Select agent type
    > Create new agent
6. Language
    > Python
7. Build
    > Direct Code deploy
8. Protocol
    > HTTP
9. Framework
    > Strands Agents SDK
10. Model
    > Amazon Bedrock
11. Memory
    > Short-term memory
12. Advanced
    > 何も選択せず Enter
13. Review
    > 確認して Enter

期待する値:

Project created successfully!

のようなメッセージが表示されれば、セットアップ完了。

### 3.2.3. ディレクトリ構成を確認する

プロジェクト構成:

```txt
my-project/
├── agentcore/
│   ├── .env.local          # API keys (gitignored)
│   ├── agentcore.json      # Resource specifications
│   ├── aws-targets.json    # Deployment targets
│   └── cdk/                # CDK infrastructure
├── app/                    # Application code
```

アプリ構成:

```txt
├── app/                    # Application code
│   └── <AgentName>/        # Agent directory
│       ├── main.py         # Agent entry point
│       ├── memory          # Memory configuration
│       ├── pyproject.toml  # Python dependencies
│       └── model/          # Model configuration
```

ポイント:

- agentcore cli は、aws cdk のラッパー
- AI エージェントの設定をヒアリングして、cdk の設定ファイルを良い感じに作ってくれる

## 3.3. 天気予報エージェントを作成する

### 3.3.1. 天気予報士エージェントを AgentCore 対応に書き換える

以下を /home/ubuntu/hmddev/app/MyAgent/main.py にコピーペーストする。4か所変わっている。

```py
from typing import Any

from strands import Agent, tool
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from model.load import load_model
from mcp_client.client import get_streamable_http_mcp_client
from memory.session import get_memory_session_manager

from datetime import datetime
from tools.weather_forecast import get_weather_forecast

app = BedrockAgentCoreApp()
log = app.logger

# Define a Streamable HTTP MCP Client
mcp_clients = [get_streamable_http_mcp_client()]

DEFAULT_SYSTEM_PROMPT = """
あなたは親しみやすく正確な気象予報士です。ユーザーから都道府県名を受け取り、天気予報情報を提供します。

## 主要機能

あなたは以下の天気予報APIツールにアクセスできます:

- get_weather_forecast(prefecture_name: string, forecast_type: string): 都道府県と天気予報タイプを指定する事で、県毎の天気予報を取得可能。forecast_typeでshort: 3日間の短期間、weekly: 週間天気の2種類に対応。

## 行動指針

### 1. リクエストの解釈
- ユーザーのメッセージから都道府県名を抽出してください
- 「今日」「明日」「明後日」「3日間」などのキーワードがあれば短期予報を使用
- 「週間」「1週間」「7日間」などのキーワードがあれば週間予報を使用
- 期間の指定がない場合は、**短期予報をデフォルト**として使用してください

### 2. 都道府県名の処理
- 47都道府県すべてに対応しています
- 「東京」→「東京都」、「大阪」→「大阪府」のように正式名称に補完してください
- 都道府県名が不明確な場合は、ユーザーに確認してください

### 3. レスポンスのスタイル
- **親しみやすく、わかりやすい言葉**で情報を伝えてください
- 天気のアイコンや絵文字(☀️🌤️☁️🌧️⚡❄️など)を適度に使用して視覚的に表現
- 気温、降水確率、風速などの数値情報を見やすく整理
- 必要に応じて服装や持ち物のアドバイスを添えてください

### 4. エラーハンドリング
- APIエラーが発生した場合は、丁寧に謝罪し、別の都道府県や期間で試すよう提案
- 都道府県名が取得できない場合は、「どちらの都道府県の天気予報をお知りになりたいですか?」と尋ねる

## レスポンス例

**良い例:**

東京都の3日間の天気予報をお伝えしますね!☀️

📅 今日(10月8日)
天気: 晴れ ☀️
気温: 最高25℃ / 最低18℃
降水確率: 10%

📅 明日(10月9日)
天気: 曇り時々晴れ 🌤️
気温: 最高23℃ / 最低17℃
降水確率: 20%

📅 明後日(10月10日)
天気: 雨 🌧️
気温: 最高20℃ / 最低16℃
降水確率: 80%

明後日は雨の予報ですので、傘をお忘れなく!🌂

## 重要な注意事項

- 気象情報は命に関わる重要な情報です。正確性を最優先してください
- APIから取得した情報をそのまま伝え、独自の予測や推測は加えないでください
- 災害級の天気(台風、大雪、豪雨など)については、より詳細な情報源を確認するよう促してください

ユーザーの安全と快適な日常生活をサポートすることがあなたの使命です。常に親切で、正確で、役立つ情報提供を心がけてください。
"""

# Define a collection of tools used by the model
tools = [get_weather_forecast]

# Add MCP client to tools if available
for mcp_client in mcp_clients:
    if mcp_client:
        tools.append(mcp_client)

def agent_factory():
    cache = {}
    def get_or_create_agent(session_id, user_id):
        key = f"{session_id}/{user_id}"
        if key not in cache:
            # Create an agent for the given session_id and user_id
            now = datetime.now()
            system_prompt = DEFAULT_SYSTEM_PROMPT + f"""
            現在の時刻: {now}
            """
            cache[key] = Agent(
                model=load_model(),
                session_manager=get_memory_session_manager(session_id, user_id),
                system_prompt=system_prompt,
                tools=tools
            )
        return cache[key]
    return get_or_create_agent
get_or_create_agent = agent_factory()


@app.entrypoint
async def invoke(payload, context):
    log.info("Invoking Agent.....")

    session_id = getattr(context, 'session_id', 'default-session')
    user_id = getattr(context, 'user_id', 'default-user')
    agent = get_or_create_agent(session_id, user_id)

    # Execute and format response
    stream = agent.stream_async(payload.get("prompt"))

    async for event in stream:
        # Handle Text parts of the response
        if "data" in event and isinstance(event["data"], str):
            yield event["data"]


if __name__ == "__main__":
    app.run()
```

### 3.3.2. ツールをコピー

`workshop-dor-developing-ai-agent/tools` をコピーし、`/home/ubuntu/MyProject/app/MyAgent` 直下へ移動

### 3.3.3. テスト起動

プロジェクトディレクトリへ移動する。

```bash
cd ~/<プロジェクトディレクトリ>
```

以下コマンドを実行すると、テスト用のターミナルが起動する。

```sh
agentcore dev --no-browser
```

そのままプロンプトを入力できるので、何か入れてみる。

```txt
今日の横浜の天気を教えて下さい。
```

エラー無く、天気予報が返ってきたら正常に動作している。

### 3.3.4. AgentCore Runtime 上にデプロイ

デプロイコマンドを実行する。

```bash
agentcore deploy
```

デプロイが進んで、以下のようなテキストが出力されたら成功。

```txt
 AgentCore Deploy

 Project: hmddev
 Target: us-east-1:012345678910

 [done]    Validate project
 [done]    Check dependencies
 [done]    Build CDK project
 [done]    Synthesize CloudFormation
 [done]    Check stack status
 [done]    Computing diff changes...
 [done]    Publish assets

 ╭────────────────────────────────────────────────╮
 │ ✓ Deploy to AWS Complete                       │
 │                                                │
 │ [████████████████████] 7/7                     │
 ╰────────────────────────────────────────────────╯

 Deployed 1 stack(s): AgentCore-hmddev-default
```

作成されるリソース:

- AgentCore Runtime
- AgentCore Runtime Executiron Role
- AgentCore Memory
- AgentCore Memory Executiron Role

関連するリソースを一式作成してくれる。

## 3.4. エージェントを実行する

今回は AgentCore SDK 経由で実行する。

### 3.4.1. プロジェクトディレクトリへ移動する

```bash
cd ~/<プロジェクトディレクトリ>
```

### 3.4.2. 普通に実行してみる

```bash
agentcore invoke --prompt "今日の横浜の天気を教えて下さい。"
```

天気予報してくれれば、成功。

### 3.4.3. セッション状態を維持させてみる

引数に `session-id` と `user-id` を渡す事で、マルチターンの会話が可能。

1ターン目:

```bash
agentcore invoke "こんにちは！私の名前は濱田一成です。あなたの名前を教えて下さい。" \
  --session-id "38efd7b6-474d-85d3-cdec-17d51017f165" \
  --user-id "3ebd9a7d-d08a-c2ad-1335-c056fd459a86"
```

2ターン目:

```bash
agentcore invoke "ところで、私の名前を覚えていますか？" \
  --session-id "38efd7b6-474d-85d3-cdec-17d51017f165" \
  --user-id "3ebd9a7d-d08a-c2ad-1335-c056fd459a86"
```

### 3.4.4. セッション ID を変えてみる

session-id を変えて、実行する。

```bash
agentcore invoke "私の名前を覚えていますか？" \
  --session-id "35abb1a6-257a-13af-b1f1-6b8882aa0e57" \
  --user-id "2b27b39e-add2-6024-9fad-8ee8a59e7f95"
```

恐らく、「まだ教えてもらっていません、、、」のように返ってくるはず。

### 3.4.5. ストリーミングレスポンスとして受ける

CLI を使う場合は、シンプルにオプションを付けるだけ。

```bash
agentcore invoke --prompt "今日の横浜の天気を教えて下さい。" --stream
```

## 3.5. クリーンアップ

全ての検証が終わったら、作成したリソースを削除する。
設定ファイルを空に -> cdk deploy(空にアップデートする) のような作業を実施する。

### 3.5.1. プロジェクトディレクトリへ移動

```bash
cd ~/<プロジェクトディレクトリ>
```

### 3.5.1. 設定ファイルからリソースを削除

```bash
agentcore remove all
```

AgentCore schemas reset successfully と表示されれば、成功。

### 3.5.2. 設定ファイルの内容を環境へ反映

```bash
agentcore deploy
```

削除していい？みたいな事を聞かれるので、y を押下。
削除が始まる。

## AI エージェントを本番で運用する方法

CLI は様々なリソースをラップしているので、CI/CD に組み込んで開発を回したり、アプリから実行するには不向き。

### リソース管理の方法: ECR デプロイを行う

AgentCore Runtime のデプロイ方法には今回利用した Direct Code Deploy 以外に、ECR 上のコンテナイメージを使う方法がある。
リソース定義に CDK(or Terraform)を使い、別途ビルドした ECR を参照する事で、リソース管理とコード管理を分けられる。

### アプリからの呼び出し: AgentCore SDK を使う

CLI でラップされている SDK をそのまま使うだけ。

```python
import boto3
import json

client = boto3.client("bedrock-agentcore", region_name="us-east-1")

response = client.invoke_agent_runtime(
    agentRuntimeArn="arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/abc123",
    payload=json.dumps({"prompt": "Hello!"}).encode("utf-8"),
    contentType="application/json",
    accept="application/json, text/event-stream",
    runtimeSessionId="session-2025-05-27",   # optional
    runtimeUserId="user@example.com",         # optional
    qualifier="DEFAULT",                       # optional
)

# response["response"] が StreamingBody
body = response["response"].read()
print(body.decode("utf-8"))
print("session:", response.get("runtimeSessionId"))
```

CLI だとパラメータ周りを上手く参照してくれるが、引数として設定する。

---
以上で、本セクションは終了です。