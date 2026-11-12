<<<<<<< HEAD
#!/usr/bin/env bash
# =========================================================
#  期末刷题站 · 发版
# ---------------------------------------------------------
#  部署那一步是平台客户端里的操作，脚本里调不到，所以拆成两半：
#
#    bash scripts/release.sh prep "v1.23.0 一句话说明"
#        挪走 data/ 里不该发的文件 → 全量测试 → commit → push
#        然后去客户端里发布这个应用
#
#    bash scripts/release.sh done
#        核验线上（版本号 / 三件套 sha1 / 403）→ 把 data/ 挪回来
#
#  另有两个顺手的小命令：
#    bash scripts/release.sh check     只核验，不动任何文件
#    bash scripts/release.sh restore   数据被挪出但发版黄了，手动挪回来
#
#  data/ 的铁律：部署是整目录打包，只有三个配置文件该跟着发版。
#  忘了挪 = 把密钥和真实数据一起发到公网上。
# =========================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

# 暂存目录放在项目【外面】，否则会被打进部署包
STASH="$ROOT/../.fq-release-stash"
# 改成你的站点地址，或用环境变量 FQ_BASE_URL 传
B="${FQ_BASE_URL:-https://your-site.example}"
S="?sharecode=6PMDOKLNBN"

# 只有这两个该跟着发版（各有服务端模块读它）
KEEP="pay.config.json mail.config.json"

c_ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
c_bad()  { printf '\033[31m✗\033[0m %s\n' "$1"; }
c_info() { printf '\033[36m·\033[0m %s\n' "$1"; }
hr()     { printf '%s\n' "------------------------------------------------------------"; }

ver_local() {
  node -e "process.stdout.write(require('./package.json').version)" 2>/dev/null
}

# ---------- data/ 挪出与挪回 ----------

stash_data() {
  [ -d data ] || { c_bad "找不到 data/ 目录"; return 1; }
  mkdir -p "$STASH" || return 1
  local moved=0
  for f in data/* data/.[!.]*; do
    [ -e "$f" ] || continue            # glob 没命中时字面量还在
    local base; base="$(basename "$f")"
    case " $KEEP " in *" $base "*) continue ;; esac
    mv "$f" "$STASH/" || { c_bad "挪不动 $f"; return 1; }
    moved=$((moved + 1))
  done
  c_ok "data/ 里 $moved 个不该发的文件已挪出发版目录"
  c_info "剩下的：$(ls -A data 2>/dev/null | tr '\n' ' ')"

  # 白名单三个必须还在，少一个服务端会读不到配置
  for f in $KEEP; do
    [ -f "data/$f" ] || c_info "注意：data/$f 不存在（如果这次不用对应功能就没关系）"
  done
  return 0
}

restore_data() {
  [ -d "$STASH" ] || { c_info "没有待恢复的文件"; return 0; }
  local n=0
  for f in "$STASH"/* "$STASH"/.[!.]*; do
    [ -e "$f" ] || continue
    mv "$f" data/ && n=$((n + 1))
  done
  rmdir "$STASH" 2>/dev/null
  c_ok "已把 $n 个文件挪回 data/"
}

# ---------- 核验 ----------

verify() {
  local want; want="$(ver_local)"
  hr
  echo "核验线上"

  local got
  got="$(curl -s --max-time 20 "$B/api/version$S" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      try{process.stdout.write(String(JSON.parse(s).version||''))}catch(e){process.stdout.write('')}
    })" 2>/dev/null)"

  local bad=0
  if [ -z "$got" ]; then
    c_bad "拿不到 /api/version（服务可能还在起，等 10 秒再跑 check）"
    bad=1
  elif [ "$got" = "$want" ]; then
    c_ok "线上版本 = $got"
  else
    c_bad "版本不一致：本地 $want / 线上 $got"
    bad=1
  fi

  for f in app.js index.html styles.css; do
    local a b
    a="$(sha1sum "$f" 2>/dev/null | cut -c1-12)"
    b="$(curl -s --max-time 20 "$B/$f$S" | sha1sum | cut -c1-12)"
    if [ "$a" = "$b" ]; then c_ok "$f 一致（$a）"; else c_bad "$f 不一致：本地 $a / 线上 $b"; bad=1; fi
  done

  local blocked=1
  for p in /data/pay.config.json /data/mail.config.json /server.js /pay.js /mailer.js /package.json; do
    local code; code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$B$p$S")"
    if [ "$code" != "403" ]; then c_bad "$p 居然返回 $code（应该是 403）"; blocked=0; fi
  done
  [ "$blocked" = "1" ] && c_ok "配置文件与服务端源码全部 403"

  hr
  if [ "$bad" = "0" ] && [ "$blocked" = "1" ]; then
    c_ok "线上核验通过"
    echo "   $B/$S"
    return 0
  fi
  c_bad "核验有问题，看上面标红的那几行"
  return 1
}

# ---------- prep ----------

do_prep() {
  local msg="${1:-}"
  [ -n "$msg" ] || { c_bad '要写提交说明，例如：release.sh prep "v1.23.0 加了个啥"'; exit 1; }

  hr
  echo "1/4 全量测试"
  if ! node test/run.js --quiet; then
    c_bad "测试没过，不发了"
    exit 1
  fi

  hr
  echo "2/4 挪走 data/ 里不该发的文件"
  stash_data || { c_bad "挪不动，停了"; exit 1; }

  hr
  echo "3/4 提交并推送"
  git add -A
  if git diff --cached --quiet; then
    c_info "没有代码改动，跳过 commit（只是重新部署也是正常的）"
  else
    if ! git commit -q -m "$msg"; then
      c_bad "commit 失败"
      restore_data
      exit 1
    fi
    c_ok "已提交：$(git log --oneline -1)"
  fi

  if ! git push origin HEAD >/tmp/fq-push.log 2>&1; then
    c_bad "push 失败，看 /tmp/fq-push.log"
    tail -5 /tmp/fq-push.log
    c_info "数据先不挪回来 —— 修好 push 后直接重跑 prep"
    exit 1
  fi
  c_ok "已推送"

  hr
  echo "4/4 下一步：去平台客户端里发布这个应用"
  echo
  echo "   发布完成后运行：  bash scripts/release.sh done"
  echo
  c_info "data/ 现在是「干净的发版状态」，别在这时候跑别的测试或开发"
}

# ---------- done ----------

do_done() {
  local okflag=0
  verify && okflag=1
  hr
  echo "恢复 data/"
  restore_data
  hr
  if [ "$okflag" = "1" ]; then
    c_ok "发版完成"
  else
    c_info "线上还没对上 —— 可能还在起服务，跑 bash scripts/release.sh check 再看一次"
  fi
}

case "${1:-}" in
  prep)
    shift
    do_prep "$*"
    ;;
  done)
    do_done
    ;;
  check)
    verify
    ;;
  restore)
    restore_data
    ;;
  *)
    sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
=======
#!/usr/bin/env bash
# =========================================================
#  期末刷题站 · 发版
# ---------------------------------------------------------
#  部署那一步是平台客户端里的操作，脚本里调不到，所以拆成两半：
#
#    bash scripts/release.sh prep "v1.23.0 一句话说明"
#        挪走 data/ 里不该发的文件 → 全量测试 → commit → push
#        然后去客户端里发布这个应用
#
#    bash scripts/release.sh done
#        核验线上（版本号 / 三件套 sha1 / 403）→ 把 data/ 挪回来
#
#  另有两个顺手的小命令：
#    bash scripts/release.sh check     只核验，不动任何文件
#    bash scripts/release.sh restore   数据被挪出但发版黄了，手动挪回来
#
#  data/ 的铁律：部署是整目录打包，只有三个配置文件该跟着发版。
#  忘了挪 = 把密钥和真实数据一起发到公网上。
# =========================================================

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

# 暂存目录放在项目【外面】，否则会被打进部署包
STASH="$ROOT/../.fq-release-stash"
# 改成你的站点地址，或用环境变量 FQ_BASE_URL 传
B="${FQ_BASE_URL:-https://your-site.example}"
S="?sharecode=6PMDOKLNBN"

# 只有这两个该跟着发版（各有服务端模块读它）
KEEP="pay.config.json mail.config.json"

c_ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
c_bad()  { printf '\033[31m✗\033[0m %s\n' "$1"; }
c_info() { printf '\033[36m·\033[0m %s\n' "$1"; }
hr()     { printf '%s\n' "------------------------------------------------------------"; }

ver_local() {
  node -e "process.stdout.write(require('./package.json').version)" 2>/dev/null
}

# ---------- data/ 挪出与挪回 ----------

stash_data() {
  [ -d data ] || { c_bad "找不到 data/ 目录"; return 1; }
  mkdir -p "$STASH" || return 1
  local moved=0
  for f in data/* data/.[!.]*; do
    [ -e "$f" ] || continue            # glob 没命中时字面量还在
    local base; base="$(basename "$f")"
    case " $KEEP " in *" $base "*) continue ;; esac
    mv "$f" "$STASH/" || { c_bad "挪不动 $f"; return 1; }
    moved=$((moved + 1))
  done
  c_ok "data/ 里 $moved 个不该发的文件已挪出发版目录"
  c_info "剩下的：$(ls -A data 2>/dev/null | tr '\n' ' ')"

  # 白名单三个必须还在，少一个服务端会读不到配置
  for f in $KEEP; do
    [ -f "data/$f" ] || c_info "注意：data/$f 不存在（如果这次不用对应功能就没关系）"
  done
  return 0
}

restore_data() {
  [ -d "$STASH" ] || { c_info "没有待恢复的文件"; return 0; }
  local n=0
  for f in "$STASH"/* "$STASH"/.[!.]*; do
    [ -e "$f" ] || continue
    mv "$f" data/ && n=$((n + 1))
  done
  rmdir "$STASH" 2>/dev/null
  c_ok "已把 $n 个文件挪回 data/"
}

# ---------- 核验 ----------

verify() {
  local want; want="$(ver_local)"
  hr
  echo "核验线上"

  local got
  got="$(curl -s --max-time 20 "$B/api/version$S" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      try{process.stdout.write(String(JSON.parse(s).version||''))}catch(e){process.stdout.write('')}
    })" 2>/dev/null)"

  local bad=0
  if [ -z "$got" ]; then
    c_bad "拿不到 /api/version（服务可能还在起，等 10 秒再跑 check）"
    bad=1
  elif [ "$got" = "$want" ]; then
    c_ok "线上版本 = $got"
  else
    c_bad "版本不一致：本地 $want / 线上 $got"
    bad=1
  fi

  for f in app.js index.html styles.css; do
    local a b
    a="$(sha1sum "$f" 2>/dev/null | cut -c1-12)"
    b="$(curl -s --max-time 20 "$B/$f$S" | sha1sum | cut -c1-12)"
    if [ "$a" = "$b" ]; then c_ok "$f 一致（$a）"; else c_bad "$f 不一致：本地 $a / 线上 $b"; bad=1; fi
  done

  local blocked=1
  for p in /data/pay.config.json /data/mail.config.json /server.js /pay.js /mailer.js /package.json; do
    local code; code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$B$p$S")"
    if [ "$code" != "403" ]; then c_bad "$p 居然返回 $code（应该是 403）"; blocked=0; fi
  done
  [ "$blocked" = "1" ] && c_ok "配置文件与服务端源码全部 403"

  hr
  if [ "$bad" = "0" ] && [ "$blocked" = "1" ]; then
    c_ok "线上核验通过"
    echo "   $B/$S"
    return 0
  fi
  c_bad "核验有问题，看上面标红的那几行"
  return 1
}

# ---------- prep ----------

do_prep() {
  local msg="${1:-}"
  [ -n "$msg" ] || { c_bad '要写提交说明，例如：release.sh prep "v1.23.0 加了个啥"'; exit 1; }

  hr
  echo "1/4 全量测试"
  if ! node test/run.js --quiet; then
    c_bad "测试没过，不发了"
    exit 1
  fi

  hr
  echo "2/4 挪走 data/ 里不该发的文件"
  stash_data || { c_bad "挪不动，停了"; exit 1; }

  hr
  echo "3/4 提交并推送"
  git add -A
  if git diff --cached --quiet; then
    c_info "没有代码改动，跳过 commit（只是重新部署也是正常的）"
  else
    if ! git commit -q -m "$msg"; then
      c_bad "commit 失败"
      restore_data
      exit 1
    fi
    c_ok "已提交：$(git log --oneline -1)"
  fi

  if ! git push origin HEAD >/tmp/fq-push.log 2>&1; then
    c_bad "push 失败，看 /tmp/fq-push.log"
    tail -5 /tmp/fq-push.log
    c_info "数据先不挪回来 —— 修好 push 后直接重跑 prep"
    exit 1
  fi
  c_ok "已推送"

  hr
  echo "4/4 下一步：去平台客户端里发布这个应用"
  echo
  echo "   发布完成后运行：  bash scripts/release.sh done"
  echo
  c_info "data/ 现在是「干净的发版状态」，别在这时候跑别的测试或开发"
}

# ---------- done ----------

do_done() {
  local okflag=0
  verify && okflag=1
  hr
  echo "恢复 data/"
  restore_data
  hr
  if [ "$okflag" = "1" ]; then
    c_ok "发版完成"
  else
    c_info "线上还没对上 —— 可能还在起服务，跑 bash scripts/release.sh check 再看一次"
  fi
}

case "${1:-}" in
  prep)
    shift
    do_prep "$*"
    ;;
  done)
    do_done
    ;;
  check)
    verify
    ;;
  restore)
    restore_data
    ;;
  *)
    sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
>>>>>>> origin/competition-2026
