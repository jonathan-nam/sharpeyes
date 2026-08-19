# Dev container

Everything (JDK, Node, Python, Terraform, the AWS CLI) lives in the container. Nothing is
installed on your machine except Docker and VS Code.

## Bootstrapping a brand-new machine

**Follow this order.** Each step depends on the one before, and skipping ahead produces
errors that look like something else entirely. Every trap called out below is one we
actually hit.

### 1. Install the two things that are not in the container

- **Docker Desktop**. <https://docker.com/products/docker-desktop>
- **VS Code**. <https://code.visualstudio.com>, plus the **Dev Containers** extension
  (`ms-vscode-remote.remote-containers`). On Windows, also install **WSL**
  (`ms-vscode-remote.remote-wsl`).

### 2. Windows only: get a real Linux distro

macOS and Linux can skip to step 3.

```powershell
wsl --install -d Ubuntu       # then set a username and password
wsl --set-default Ubuntu      # so a bare `wsl` opens Ubuntu, not Docker's VM
```

> **Trap.** Docker Desktop installs its own `docker-desktop` distro, which is Alpine and
> is *not* a place to work. Without `--set-default`, a bare `wsl` lands you in it, where
> the Windows drives are not mounted the way you expect (so `find /mnt/c/...` silently
> returns nothing) and VS Code fails asking you to `apk add libstdc++`. **That prompt is
> the tell that you are in the wrong shell.** Never install anything into it.

Give the WSL VM some headroom by creating `%UserProfile%\.wslconfig`:

```ini
[wsl2]
memory=10GB                 # tune to your RAM; leave the host plenty
swap=8GB                    # without swap, a spike wedges the VM instead of slowing down
autoMemoryReclaim=gradual
```

Then `wsl --shutdown` from PowerShell for it to take. Skipping this is how the container
freezes hard enough that Docker Desktop's stop button stops responding.

### 3. Windows only: let WSL talk to Docker

**Docker Desktop → Settings → Resources → WSL Integration → enable `Ubuntu` → Apply &
Restart.**

> **Trap.** This is not optional. With the project in WSL, VS Code runs Docker *from inside
> WSL*, so **"Reopen in Container" simply fails without it**, and the error does not
> mention this setting.

### 4. Clone. On Windows, into WSL, never onto `C:`

```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/jonathan-nam/sharpeyes.git
cd sharpeyes
```

> **Trap.** If the repo sits on the Windows `C:` drive, WSL reaches it over 9p, which has no
> **inotify**. Hot reload then *cannot* work, the dev server silently serves stale code.
> and every file operation is ~18× slower. See *Keep the repo on the Linux filesystem*
> below. `post-create.sh` will warn you if you get this wrong.

### 5. Secrets, the two files git will never bring you

The repo is the whole story **except two files**, which are gitignored because they hold
secrets. Git will never bring them, so a clone that skips this step builds fine and then
401s every request, with nothing saying why.

```bash
cp frontend/.env.local.example frontend/.env.local
cat > .env <<'EOF'
AUTH_SECRET=paste-openssl-rand-base64-32-here
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
EOF
```

The two Discord values come from one page: <https://discord.com/developers/applications> → your
application → *OAuth2*. Register this redirect URI there, exactly, or sign-in fails at Discord
with nothing useful on screen:

```
http://localhost:3001/api/auth/callback/discord
```

| file | key | what it is |
| --- | --- | --- |
| `.env` (repo root) | `AUTH_SECRET` | encrypts the signing keys at rest. `openssl rand -base64 32` |
| `.env` (repo root) | `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | your Discord application |
| `frontend/.env.local` | `NEXT_PUBLIC_API_BASE_URL` | where the backend is |
| `frontend/.env.local` | `NEXT_PUBLIC_AUTH_BASE_URL` | where the **browser** reaches the auth service |

Everything else in those files already works as-is against the local stack.

The root `.env` is the one that matters, because that is the file `docker compose` reads, and
compose refuses to start without those three rather than booting a stack that cannot sign anybody
in. Note that `backend/.env.example` tells you to copy it to `backend/.env`: nothing loads that
file. The backend reads its configuration from the process environment (`Env.kt`), and compose
supplies it.

> **Trap.** `AUTH_BASE_URL` and the backend's `AUTH_ISSUER` have to be the same string. They are
> both derived from one variable in compose so they cannot drift, but if you override one by hand,
> the mismatch does not fail loudly: the backend boots happily and then 401s every request, and the
> UI reports that as *"Upload failed, check your connection"*, which sends you to look at your
> network. **If everything 401s, suspect this first.**

**You do not need an Anthropic API key.** The `.env.example` used to ask for one;
screenshots are parsed by the local OpenCV service in `vision/`, so no model is called and
nothing is metered.

### 6. Open in the container

VS Code → **Reopen in Container** (on Windows, first connect to WSL: `Ctrl+Shift+P` →
*WSL: Connect to WSL using Distro…* → Ubuntu, then open `~/projects/maplestorage`).

The first build takes a few minutes. When it finishes, `post-create.sh` prints:

```
Workspace filesystem: ext4. File watching works.
```

If it prints a 9p warning instead, go back to step 4.

> **Trap.** `code .` from WSL may fail with `Code.exe: Exec format error` if WSL interop is
> disabled. You do not need it. Open the folder from VS Code as above.

### 7. Sign in to GitHub and AWS

Neither is in the repo, and neither should be. Inside the container, once per machine:

```bash
gh auth login       # also sets up git push/pull over HTTPS
aws configure       # only if you are touching infra/
```

Both persist: `~/.aws` and `~/.config/gh` are bind-mounted from the host (see
`devcontainer.json`), so a container **rebuild** does not lose them. It is once per
machine, not once per container.

**Use a new AWS access key on each machine. Do not reuse one.** An access key belongs to
the IAM user, not the computer, so the same pair *would* work on both. That is exactly the
problem: every extra copy is another place it can leak, and revoking it would take down
every machine at once. AWS allows two active keys per user for this reason. Make a second
one in the IAM console, and then revoking a lost laptop is one click that does not touch
anything else.

**Do not copy `.env` files between machines.** They hold your Discord client secret and the key
that decrypts every signing key. Do not send them over Slack, email, or a shared drive. Re-fetch
them from the Discord developer portal, which takes half a minute and leaves no copy lying around.
A password manager is fine if you want them saved. Same reasoning for `infra/backend.hcl`: it is gitignored
because it embeds the AWS account ID, and this repo is public.

### 8. Prove it works

```bash
./scripts/smoke.sh
```

This brings the whole stack up (Postgres, the vision service, the backend) runs the
migrations, parses a real screenshot, and checks the counts that come back. **7/7 means the
environment is genuinely working, not just that the files are in place.** It is a much
stronger answer than "it built".

Then the day-to-day:

```bash
cd backend  && ./gradlew test     # against real Postgres
cd vision   && pytest tests/      # the CV regression corpus, against real screenshots
cd frontend && pnpm test          # the redemption + search rules
cd frontend && pnpm run dev       # http://localhost:3000
```

Day to day after this, start everything with `./scripts/dev-up.sh`. See *Starting the stack by
hand* below, and note the warning there before running `smoke.sh` a second time: it destroys the
database it builds, so it is safe now and not once you have data.

---

## Starting the stack by hand

`scripts/dev-up.sh` brings up everything: Postgres, vision and the backend via compose, plus
the Next dev server. Claude Code runs it from a `SessionStart` hook (`.claude/settings.json`),
and it is written to be run by hand too, so turning Claude off costs you nothing but the
automatic invocation. It is idempotent: running it against a live stack is a no-op.

```bash
cd /workspaces/maplestorage && ./scripts/dev-up.sh
```

It prints one JSON line, e.g. `{"systemMessage":"MapleStorage: postgres/vision/backend up,
frontend already on :3000."}`. That is the hook's output format, not an error.

### From a powered-off machine

The stack runs inside the dev container's **own** Docker daemon (the docker-in-docker feature),
and the repo lives in a container volume rather than on `C:`. So none of these containers appear
in Docker Desktop's list, and there is no way to start them without opening the dev container
first.

1. Start **Docker Desktop** and wait for it to be ready.
2. VS Code → `Ctrl+Shift+P` → *WSL: Connect to WSL using Distro…* → **Ubuntu**. Not `code .`
   from a WSL shell, which fails with `Exec format error` where interop is disabled.
3. Open the repo folder, then *Reopen in Container*. Wait for `post-create.sh` to print
   `Workspace filesystem: ... file watching works.`
4. `./scripts/dev-up.sh`
5. <http://localhost:3000>

### The two commands it wraps

```bash
# Postgres, vision, backend. Both -f files, always.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# The Next dev server, detached so it outlives the terminal.
cd frontend && nohup pnpm run dev > /tmp/next.log 2>&1 &
```

Both `-f` flags matter. `docker-compose.dev.yml` is what bind-mounts `vision/app` and adds
`--reload`, and it is deliberately not named `override.yml` (the reason is at the top of that
file), so a bare `docker compose up` runs the production vision image with the source baked in
at build time.

Ports: **3000** frontend, **8080** backend, **5432** Postgres. 8000 is published too, but the
vision service binds `127.0.0.1` inside the shared namespace, so `curl localhost:8000/health`
returning nothing is correct rather than a fault. Check it through the container instead:

```bash
docker compose exec -T vision python -c \
  "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').read())"
```

### Checking it, and stopping it

```bash
docker compose ps              # postgres and vision should read healthy
curl localhost:8080/health     # {"status":"ok"}
tail -f /tmp/next.log          # frontend compile log
docker compose stop            # stop the containers, KEEP the database
fuser -k 3000/tcp              # stop the dev server
```

> **Trap.** Never `pkill -f "next dev"`. The pattern matches its own shell, and it kills *every*
> dev server on the machine, including the one you are using on 3000. Kill by port.

> **Trap.** Never `docker compose down -v`, and never `./scripts/smoke.sh` without `--keep`. The
> `-v` deletes the Postgres volume, which is every character, count and boss clear in the dev
> database, and there is no backup. smoke.sh ends in that same `down -v` on the same compose
> project, including when it fails: it builds its own stack to test and is not a probe against a
> running one. Dump first if the data matters (`dev-snapshots/` is gitignored, and a dump carries
> a real user ID and Discord account row, so keep it out of a commit):
>
> ```bash
> mkdir -p dev-snapshots
> docker compose exec -T postgres pg_dump -U maplestorage maplestorage > dev-snapshots/local.sql
> ```

Unpushed work does not leave this environment. The repo is a container volume, not a mount of a
Windows directory, so a branch that exists only here cannot be seen from `C:` and does not
survive the volume. Push it.

---

## Keep the repo on the Linux filesystem, not the Windows drive

**Do this once. It is the highest-leverage change available to this environment.**

If the repo lives on the Windows `C:` drive, WSL2 reaches it over **9p**, and 9p has no
**inotify**. That means:

- **Hot reload cannot work.** Not "is flaky". *cannot*. The Next dev server never sees
  an edit, so it silently serves the code it compiled when it started. You change a file,
  reload, and nothing happens. Its compile log stays empty, which reads as success. This
  cost several hours before we found it. Polling does not rescue it: `WATCHPACK_POLLING`,
  `CHOKIDAR_USEPOLLING` and `TURBOPACK_FORCE_POLLING` were each tried, and each failed.
- **Everything is ~18× slower.** 300 small writes: **577 ms** on 9p, **31 ms** on ext4.
  That tax lands on npm, Gradle, pytest and git.

Fix it from a **WSL terminal on Windows** (not from inside the container, the filesystem
it needs to write to is the one the container cannot see):

```bash
find /mnt/c/Users -maxdepth 5 -type d -name maplestorage   # locate it
bash /mnt/c/.../maplestorage/scripts/move-to-wsl.sh        # copies to ~/projects
```

Then `cd ~/projects/maplestorage && code .` and *Reopen in Container*. It **copies** rather
than clones, so your `.env` files and uncommitted work come with it, and it leaves the
original alone until you delete it yourself.

Confirm inside the new container:

```bash
stat -f -c %T /workspaces/maplestorage    # want ext4/overlayfs, NOT v9fs
```

`post-create.sh` prints a loud warning if you are still on 9p.

### If you are stuck on 9p anyway

After **every** frontend edit:

```bash
cd frontend && fuser -k 3000/tcp; sleep 2; rm -rf .next
nohup pnpm run dev > /tmp/next.log 2>&1 & disown
```

and hard-refresh the browser (`Ctrl+Shift+R`), the CSS filename never changes between
builds, so a normal reload serves the cached copy. **Verify the bytes, not the log**: the
log is silent precisely *because* nothing recompiled.

```bash
CSS=$(curl -s localhost:3000/ | grep -oE '/_next/static/[^"]*\.css' | head -1)
curl -s "localhost:3000$CSS" | grep -c 'a-class-you-just-added'
```

## Credentials survive rebuilds

`~/.aws`, `~/.config/gh` and `~/.claude` are bind-mounted from the host (see
`devcontainer.json`), so a rebuild does not wipe them. `.gitconfig` and the SSH agent are
forwarded by VS Code itself.

`~/.claude` is in that list for a reason worth knowing: it holds Claude Code's memory and
session history. Container-local, it died with the container, so every rebuild silently
threw away everything learned about this machine and this project, and the next session
started by rediscovering it.

For how to sign in on a **new machine** (and why each machine should have its own AWS access
key), see *Starting from a fresh clone* above.

## Rebuilding the vision service breaks the backend

The backend shares the vision container's network namespace (`network_mode:
service:vision`, deliberately, it mirrors how ECS co-locates them). Rebuilding vision
*recreates* that container, and the backend's networking goes with it: uploads start
failing with "Upload failed, check your connection".

**Always restart the backend after rebuilding vision:**

```bash
docker compose up -d --build vision
docker compose up -d --force-recreate backend
```

## It froze, and Docker Desktop won't stop it

Symptom: the container locks up after a while, you get an HTTP 500, Docker Desktop's
stop/restart buttons do nothing, and a reboot is the only thing that works.

It has run out of memory. WSL2 gives its VM roughly half the host's RAM by default,
and everything runs inside it. VS Code's server, language servers, Docker builds,
the local stack, and the JVMs a Gradle build spawns. When that fills, WSL thrashes,
the Docker API stops answering (the 500), and Docker Desktop cannot stop a VM that
is no longer scheduling.

**You do not need to reboot.** From PowerShell on the host:

```powershell
wsl --shutdown
```

That clears the wedged VM in seconds. Restart Docker Desktop and reopen the
container. If `wsl --shutdown` itself hangs, `Restart-Service LxssManager` in an
elevated PowerShell is the next step.

**To stop it recurring**, create or edit `%UserProfile%\.wslconfig` on the host and
run `wsl --shutdown` once for it to take effect:

```ini
[wsl2]
memory=12GB           # more than the 50% default; leave the host some headroom
swap=8GB              # a memory spike gets slow instead of wedging
autoMemoryReclaim=gradual   # WSL 2.0+: hands freed memory back to Windows
```

Tune `memory` to your machine. `swap` matters more than it looks. Without it, a
spike wedges the VM instead of just slowing down.

`backend/gradle.properties` also caps the Gradle and Kotlin daemons and the worker
count, so a build cannot claim a third of the VM on its own. Raise those if you have
memory to spare.
