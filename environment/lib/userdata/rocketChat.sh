#!/bin/bash
set -eux
exec > >(tee -a /var/log/user-data.log) 2>&1

# snapd は Ubuntu 24.04 のクラウドイメージにプリインストール済みのため、
# apt は意図的に操作しない（cloud-init 自身の apt 実行とデッドロックするため）。
snap wait system seed.loaded

# MongoDB を内包し、ポート 3000 で待ち受ける（snap が自動でサービスを起動・有効化）。
snap install rocketchat-server --channel=7.x/stable
