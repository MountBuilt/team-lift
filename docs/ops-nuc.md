# Team Lift ops — NUC tick host

**Production tick host:** always-on Intel NUC (Linux Mint).  
**Dev machine:** MacBook only. Do not leave Mac launchd loaded after cutover.

Aiden (morning report + thread replies) and web push run on the NUC:

| Path | Unit | Role |
|---|---|---|
| **Event (primary)** | `teamlift-banter-watch.service` | Firestore `onSnapshot` on `config/banter`; wakes when clients stamp `pendingAt` (comment / log poke) |
| **Safety timer** | `teamlift-banter.timer` → `teamlift-banter.service` | Every **30s**; clock jobs (report, morning/evening push) + recovery if an event was missed |
| **Tick body** | `scripts/refresh-banter.sh` → `orchestrator.mjs` | Single-flight lock so event + timer never double-send |

Product UI still deploys via `git push` to `main` (GitHub Pages); the NUC only
needs a `git pull` of the repo for orchestrator / watcher changes.

Related: `CLAUDE.md`, `scripts/refresh-banter.sh`, `scripts/watch-banter.mjs`,
`scripts/teamlift-banter*`, probe design in
`docs/superpowers/specs/2026-07-26-morning-report-design.md`.

### Free Spark plan (do not upgrade)

Stay within **50k document reads / day**:

- **Watcher:** one realtime listener on `config/banter` only. Charged **1 read on
  attach** and **1 read per change** to that document — **not** a poll loop.
  Aiden’s own writes also deliver a snapshot; the watcher only spawns a tick
  when `pendingAt` advances (or once at startup).
- **Safety timer idle probe:** 2 REST reads every 30s ≈ **5.8k reads/day**.
- **Full ticks** (users + entries collections) only when there is work.

Do **not** replace the listener with a tight REST poll of `pendingAt`.

---

## 1. Remote access (once)

### LAN SSH (minimum)

On the NUC (keyboard/monitor once if truly headless):

```bash
sudo apt update
sudo apt install -y openssh-server
sudo systemctl enable --now ssh
hostname -I   # note the LAN IP
```

From the Mac:

```bash
ssh <user>@<nuc-ip-or-hostname>
```

Optional `~/.ssh/config` on the Mac:

```
Host teamlift-nuc
  HostName <nuc-ip-or-hostname>
  User <user>
```

Then: `ssh teamlift-nuc`

### Off-LAN: Tailscale (recommended)

Install Tailscale on Mac and NUC (personal free tier). SSH via Tailscale IP or
MagicDNS name. Prefer this over port-forwarding 22 to the public internet.

---

## 2. What must exist on the NUC

| Item | Path on NUC | Notes |
|---|---|---|
| Repo checkout | e.g. `~/team-lift` | clone of `main` |
| Node | on PATH, 20+ | NodeSource, nvm, or distro package |
| SuperGrok | `grok` on PATH, `~/.grok/auth.json` | mode `600` on auth.json |
| VAPID private key | `~/.config/teamlift/vapid-private.key` | **same key as Mac** (must match public key in repo) |
| Optional Claude fallback | `~/.config/teamlift/claude-token` / `anthropic-key` | only if you want fallback |
| scripts deps | `~/team-lift/scripts/node_modules` | `cd scripts && npm ci` (includes `firebase` for the watcher) |
| Timezone | group local TZ | push windows use host local clock (07:30 / 20:30) |

**Never commit** VAPID private key or `~/.grok/auth.json`.

### Secrets / SuperGrok

1. Prefer: `grok login` once on the NUC if the device/browser flow works over SSH.
2. Fallback: copy from Mac (treat as a secret):

   ```bash
   # on Mac
   scp ~/.grok/auth.json teamlift-nuc:~/.grok/auth.json
   scp ~/.config/teamlift/vapid-private.key teamlift-nuc:~/.config/teamlift/vapid-private.key
   ssh teamlift-nuc 'chmod 600 ~/.grok/auth.json ~/.config/teamlift/vapid-private.key'
   ```

3. Install the `grok` binary the same way as on the Mac so it lands under
   `~/.grok/bin` (the wrapper and systemd unit put that on `PATH`).

4. Confirm:

   ```bash
   ssh teamlift-nuc 'bash ~/team-lift/scripts/refresh-banter.sh --dry-run'
   ```

Child processes still strip `XAI_API_KEY` (copywriter) so launchd/systemd cannot
silently burn metered xAI credits.

### Timezone

```bash
timedatectl   # use the group's real local TZ for push windows
# if wrong:
sudo timedatectl set-timezone Australia/Sydney   # or Pacific/Fiji, etc.
```

---

## 3. Install systemd user units

Unit templates live in the repo:

- `scripts/teamlift-banter-watch.service` — always-on Firestore listener
- `scripts/teamlift-banter.service` — oneshot tick
- `scripts/teamlift-banter.timer` — every 30s safety net

They assume the clone is **`~/team-lift`**. Edit paths if your clone differs.

```bash
# on NUC
mkdir -p ~/.config/systemd/user
cp ~/team-lift/scripts/teamlift-banter.service ~/.config/systemd/user/
cp ~/team-lift/scripts/teamlift-banter.timer ~/.config/systemd/user/
cp ~/team-lift/scripts/teamlift-banter-watch.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now teamlift-banter.timer
systemctl --user enable --now teamlift-banter-watch.service
systemctl --user list-timers | grep teamlift
systemctl --user status teamlift-banter-watch.service --no-pager
# so units keep running with no interactive login:
sudo loginctl enable-linger "$USER"
```

Prefer **user** units so secrets stay under `$HOME`.

### Logs

Non-idle ticks append to:

```
~/.local/state/teamlift/banter.log
```

Look for `wake=pendingAt` (event) vs `wake=timer` / `wake=startup`.

Idle ticks stay silent in that file (by design). Watcher stdout is in the journal.

```bash
tail -50 ~/.local/state/teamlift/banter.log
journalctl --user -u teamlift-banter-watch.service -n 40 --no-pager
journalctl --user -u teamlift-banter.service -n 20 --no-pager
```

Single-flight lock + optional rerun flag:

```
~/.local/state/teamlift/tick.lock
~/.local/state/teamlift/tick.rerun
```

### Uninstall / stop

```bash
systemctl --user disable --now teamlift-banter.timer
systemctl --user disable --now teamlift-banter-watch.service
# optional: remove unit files from ~/.config/systemd/user/ and daemon-reload
```

---

## 4. Deploy workflow (Mac develops, NUC runs)

1. Develop and commit on the Mac; push to `main` (Pages + app code).
2. On the NUC:

   ```bash
   cd ~/team-lift && git pull
   # only when package-lock.json changed:
   cd scripts && npm ci
   systemctl --user restart teamlift-banter-watch.service
   ```

3. Reinstall units when `scripts/teamlift-banter*.service` or `.timer` changed:

   ```bash
   cp ~/team-lift/scripts/teamlift-banter*.service \
      ~/team-lift/scripts/teamlift-banter.timer \
      ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user restart teamlift-banter-watch.service
   systemctl --user restart teamlift-banter.timer
   ```

4. Hand test:

   ```bash
   ssh teamlift-nuc 'bash ~/team-lift/scripts/refresh-banter.sh --dry-run'
   ```

---

## 5. Cutover checklist (prod)

1. [ ] SSH works: `ssh teamlift-nuc`
2. [ ] NUC timezone matches group push windows: `timedatectl`
3. [ ] `node -v`, `grok` resolves, `~/.grok/auth.json` present (mode 600)
4. [ ] VAPID private key present; `bash scripts/refresh-banter.sh --dry-run` succeeds
5. [ ] Timer active: `systemctl --user status teamlift-banter.timer`
6. [ ] Watcher active: `systemctl --user status teamlift-banter-watch.service`
7. [ ] Live: comment in the app → Aiden replies in roughly **10–25s** with Mac
      launchd unloaded (model time dominates; event removes poll wait)
8. [ ] Morning / evening push windows still work (or wait one calendar day)
9. [ ] **Unload Mac launchd** so two hosts do not double-send:

   ```bash
   # on Mac
   launchctl unload ~/Library/LaunchAgents/com.teamlift.banter.plist
   ```

10. [ ] Overnight: Mac offline; morning report + evening nags + a thread reply

`scripts/com.teamlift.banter.plist` stays in the repo as **historical
reference** only. Do not re-enable it on the Mac while the NUC is active.

---

## 6. Troubleshooting

| Symptom | Check |
|---|---|
| No Aiden replies | Watcher + timer status; `banter.log`; `pendingAt` / poke from client |
| Slow replies (~30s+) | Is watcher running? `journalctl --user -u teamlift-banter-watch` should show `wake=pendingAt` after a comment |
| Double pushes / double Aiden | Mac launchd still loaded — unload it |
| `node not found` | Install Node; PATH in units + script; NodeSource preferred on NUC |
| `no copy backend` | `grok` + `~/.grok/auth.json`; never set metered `XAI_API_KEY` for production ticks |
| VAPID / push fails | Same private key as the public key in the app; `~/.config/teamlift/vapid-private.key` |
| Units dead after reboot | `sudo loginctl enable-linger $USER` |
| Firestore quota fear | Confirm no custom poll loop; watcher is one doc listen + 30s 2-doc probe only |
