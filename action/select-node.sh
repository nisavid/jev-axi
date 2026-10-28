# Sourced by the absolute privileged Bash selected in action.yml, before secrets.
# Use Bash builtins and absolute Node paths only; never resolve a program via PATH.
jev_tool_cache="${JEV_RUNNER_TOOL_CACHE//\\//}"
case "$JEV_RUNNER_ARCH" in
  X64) jev_arch=x64 ;;
  ARM64) jev_arch=arm64 ;;
  *) printf '%s\n' '::error::Unsupported runner architecture; use X64 or ARM64'; exit 1 ;;
esac
jev_candidates=(
  "$jev_tool_cache"/node/24.*/"$jev_arch"/bin/node
  "$jev_tool_cache"/node/24.*/"$jev_arch"/node.exe
  "$jev_tool_cache"/node/22.*/"$jev_arch"/bin/node
  "$jev_tool_cache"/node/22.*/"$jev_arch"/node.exe
)
case "$JEV_RUNNER_OS" in
  Windows) jev_candidates+=("C:/Program Files/nodejs/node.exe") ;;
  Linux|macOS) jev_candidates+=(/usr/local/bin/node /usr/bin/node) ;;
  *) printf '%s\n' '::error::Unsupported runner OS'; exit 1 ;;
esac
for jev_node in "${jev_candidates[@]}"; do
  [[ -x "$jev_node" ]] || continue
  jev_major="$("$jev_node" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || continue
  [[ "$jev_major" =~ ^[0-9]+$ ]] && (( jev_major >= 22 )) || continue
  printf 'node=%s\n' "$jev_node" >> "$GITHUB_OUTPUT"
  return 0
done
printf '%s\n' '::error::Preinstall Node 22 or 24 in the runner tool cache, or Node 22+ at the standard platform path'
exit 1
