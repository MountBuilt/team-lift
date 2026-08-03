# Team Lift ops — NUC tick host

**Production tick host:** always-on Intel NUC (Linux Mint).  
**Dev machine:** MacBook only. Do not leave Mac launchd loaded after cutover.

Aiden (morning report + thread replies) and web push run every ~60s on the NUC
via a **systemd user timer**. Product UI still deploys via `git push` to `main`
(GitHub Pages); the NUC only needs a `git pull` of the repo for orchestrator
changes.

Related: `CLAUDE.md`, `scripts/refresh-banter.sh`, `scripts/teamlift-banter.*`,
probe design in `docs/superpowers/specs/2026-07-26-morning-report-design.md`.

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
| scripts deps | `~/team-lift/scripts/node_modules` | `cd scripts && npm ci` |
| Timezone | `Australia/Sydney` | push windows 07:30 / 20:30 local |

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
timedatectl   # expect Australia/Sydney (or the group's real local TZ)
# if wrong:
sudo timedatectl set-timezone Australia/Sydney
```

---

## 3. Install the systemd user timer

Unit templates live in the repo:

- `scripts/teamlift-banter.service` — oneshot, runs `refresh-banter.sh`
- `scripts/teamlift-banter.timer` — every 60s

They assume the clone is **`~/team-lift`**. Edit `WorkingDirectory` / `ExecStart`
in the service file if your path differs.

```bash
# on NUC
mkdir -p ~/.config/systemd/user
cp ~/team-lift/scripts/teamlift-banter.service ~/.config/systemd/user/
cp ~/team-lift/scripts/teamlift-banter.timer ~/.config/systemd/user/
# edit paths in the service if clone is not ~/team-lift
systemctl --user daemon-reload
systemctl --user enable --now teamlift-banter.timer
systemctl --user list-timers | grep teamlift
# so the timer keeps running with no interactive login:
sudo loginctl enable-linger "$USER"
```

Prefer **user** units so secrets stay under `$HOME`.

### Logs

Non-idle ticks append to:

```
~/.local/state/teamlift/banter.log
```

Idle ticks stay silent (by design). Hand runs always print to the terminal.

```bash
tail -50 ~/.local/state/teamlift/banter.log
journalctl --user -u teamlift-banter.service -n 30
```

### Uninstall / stop

```bash
systemctl --user disable --now teamlift-banter.timer
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
   ```

3. Reinstall the timer only when `scripts/teamlift-banter.service` or
   `.timer` changed (copy again + `daemon-reload` + restart timer).
4. Hand test from the Mac:

   ```bash
   ssh teamlift-nuc 'bash ~/team-lift/scripts/refresh-banter.sh --dry-run'
   ```

---

## 5. Cutover checklist (prod)

Do this once when moving production off the Mac:

1. [ ] SSH works: `ssh teamlift-nuc`
2. [ ] NUC timezone: `timedatectl` → `Australia/Sydney` (or correct group TZ)
3. [ ] `node -v`, `grok` resolves, `~/.grok/auth.json` present (mode 600)
4. [ ] VAPID private key present; `bash scripts/refresh-banter.sh --dry-run` succeeds
5. [ ] Timer active: `systemctl --user status teamlift-banter.timer`
6. [ ] Live tick: comment on the morning report in the app → Aiden replies within
      ~1–2 min with **Mac asleep / Mac launchd unloaded**
7. [ ] Morning / evening push windows still work (or wait one calendar day)
8. [ ] **Unload Mac launchd** so two hosts do not double-send:

   ```bash
   # on Mac
   launchctl unload ~/Library/LaunchAgents/com.teamlift.banter.plist
   # if installed elsewhere, unload that path instead
   ```

9. [ ] Overnight test: Mac fully offline; next day morning report + evening nags
      + a human thread reply all still work

`scripts/com.teamlift.banter.plist` stays in the repo as **historical
reference** only. Do not re-enable it on the Mac while the NUC timer is active.

---

## 6. Troubleshooting

| Symptom | Check |
|---|---|
| No Aiden replies | Timer: `systemctl --user status teamlift-banter.timer`; log; `pendingAt` / poke from client |
| Double pushes / double Aiden | Mac launchd still loaded — unload it |
| `node not found` | Install Node; ensure PATH in service + script covers it; nvm users: open a login shell once or install via NodeSource |
| `no copy backend` | `grok` + `~/.grok/auth.json`; never set metered `XAI_API_KEY` for production ticks |
| VAPID / push fails | Same private key as the public key shipped in the app; path `~/.config/teamlift/vapid-private.key` |
| Timer dead after reboot | `sudo loginctl enable-linger $USER` |
