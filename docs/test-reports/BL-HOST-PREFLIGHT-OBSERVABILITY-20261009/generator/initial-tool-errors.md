# Retained initial unredirected tool failures

These are transcribed tool-return details, NOT a replacement for missing raw
bytes. Complete redirected logs are identified separately.

1. Initial runtime lookup: `ls -d /opt/homebrew/opt/node* /usr/local/bin/node
   /tmp/node* /private/tmp/node*` returned exit 1 because /usr/local/bin/node did
   not exist. This did not verify the requested Node 22 runtime.
2. Initial `command -v node npm jq timeout bash curl tar` returned exit 1;
   timeout was absent on the ambient PATH. The host tests use their existing
   synthetic timeout fixture, and no host tool was installed.
3. Initial `ls -ld node_modules` returned exit 1:
   `ls: node_modules: No such file or directory`.
4. Initial extraction command:
   `tar -xzf /private/tmp/hpog-20261009/runtime/node.tar.gz -C
   /private/tmp/hpog-20261009/runtime`.
   Tool chunk_id=12d239, exit_code=1, original_token_count=48035; tool output
   explicitly said it was truncated and reported 865 lines. Representative
   returned lines:

   ```text
   node-v22.22.0-darwin-arm64/include/node/openssl/archs/linux-armv4/asm/include/openssl/ct.h: Can't create 'node-v22.22.0-darwin-arm64/include/node/openssl/archs/linux-armv4/asm/include/openssl/ct.h': No space left on device
   node-v22.22.0-darwin-arm64/bin/node: Can't create 'node-v22.22.0-darwin-arm64/bin/node': No space left on device
   tar: Error exit delayed from previous errors.
   ```

   The intervening omitted bytes are not retained here. Do not infer a complete
   archive of initial tar stderr from these transcribed excerpts.
5. The subsequent Node --version returned exit 127; complete stderr is log 03.
6. The initial npm ci returned exit 1 due to configuring /dev/null as both user
   and global npm configuration; complete stderr is log 04. Since the requested
   Node binary was missing then, this invocation's fallback runtime was not
   verified and is NOT counted as a fresh Node22 install.
7. `ls -ld /Volumes/ORICO/project/.hpog-20261009` returned exit 1 before the move,
   proving the intended destination did not already exist.
8. After `mv /private/tmp/hpog-20261009 /Volumes/ORICO/project/.hpog-20261009`,
   `ls -ld /private/tmp/hpog-20261009` returned exit 1: original owned root no
   longer existed. Only this newly created helper tree was moved.

The original relocated npm session was paused with `kill -STOP 18122`, verified
by `ps -p 18122 -o pid,ppid,state,command` (STAT=Ts), and resumed with
`kill -CONT 18122` on Coordinator instruction. The process was the exact owned
`npm ci HOME=/Volumes/ORICO/project/.hpog-20261009/home` process. Its original
running session 85769 later returned exit 0. No restart hid a npm failure.
