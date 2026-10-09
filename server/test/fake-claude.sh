#!/bin/sh
# Фейковый Claude Code CLI для проверки сервера (не настоящий CLI).
case "$1" in
  --version) echo "9.9.9-test"; exit 0 ;;
  setup-token) echo "Open https://claude.ai/fake-login to continue"; sleep 1; echo "Paste code:"; read -r code; echo "token accepted: $code"; exit 0 ;;
esac
echo '{"type":"system","subtype":"init","session_id":"cli-session-test","model":"sonnet"}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Привет из фейкового CLI. "}]}}'
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Файлы в порядке."}]}}'
echo '{"type":"result","subtype":"success","result":"","session_id":"cli-session-test","usage":{"input_tokens":11,"output_tokens":22}}'
exit 0
