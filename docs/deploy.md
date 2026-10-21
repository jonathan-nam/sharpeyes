# Deploying

Production is **one Lightsail box** running `docker compose`: nginx, certbot, two backend replicas,
the auth service and Postgres. $12/month. The frontend is on Vercel's free tier.

The vision service is **not** deployed. Nothing in the app reaches it, so it stays in the repo and
in local development and does not run here. See docker-compose.prod.yml.

```
   DNS: Namecheap BasicDNS
                       │
   sharpeyes.app ──────┼──> Vercel           Next frontend
   api.sharpeyes.app ──┴──> Lightsail box    everything else
                                │
                            nginx :443      TLS, 20MB body limit, load balances
                                │
                            backend   :8080 ─┐ two replicas, nginx load balances
                            backend-b :8081 ─┤ across them one restart at a time
                            auth      :3001 ─┘ /api/auth/*
                                │
                            postgres + volume
                                │  nightly pg_dump
                                └──> S3
```

## First time

### 1. Domain and DNS

Registered at **Namecheap** (2026-08-23), on Namecheap's own **BasicDNS**. Two A records, no CDN
and no proxy in front of anything.

*Domain List -> Manage -> Advanced DNS*. **Delete the two records Namecheap creates by default**
first, a `CNAME www -> parkingpage.namecheap.com` and a URL Redirect on `@`. Left in place they
answer for names this app also wants, and a parking page served over your own domain looks exactly
like a deploy that failed.

| Type | Host | Value |
| --- | --- | --- |
| A | `@` | the IP **Vercel shows you** when you add the domain |
| A | `api` | the box's static IP, from `terraform output static_ip` |

**Do not copy an apex IP out of a blog post, this one included.** Vercel used to hand everybody
`76.76.21.21`; newer projects draw from a pool matched to the plan, so yours may be something else
entirely. Use whatever the Vercel dashboard prints next to the domain.

An apex cannot be a CNAME (RFC 1034: nothing else may sit beside one, and an apex needs NS records),
which is why that row is an A record while a `www` would be a CNAME to `cname.vercel-dns.com`.

Cloudflare was considered and is not used. Nothing in this repo depends on it, no code reads a
Cloudflare header, and one DNS provider is one less account. What that decision gives up is worth
knowing rather than rediscovering:

- **The icon paths lose an edge cache.** `/token-icons/*` and `/digit-icons/*` are served immutable
  for a year (see nginx/templates/), so a returning browser still pays nothing, but a cold visitor
  fetches them from the box instead of from somewhere near them.
- **The box's IP is public**, and it is one 2-vCPU instance. Nothing absorbs traffic in front of it.

Neither is load-bearing at this size. Putting Cloudflare back later is a nameserver change and
turning one record orange, and the apex would have to stay **grey**: Cloudflare's proxy fights
Vercel's own TLS there, and the failure looks like a certificate error nobody can explain.

`.app` is on the HSTS preload list, so browsers refuse plain http to it before a request is even
made. That is free https enforcement and nothing here has to change for it, with one caveat worth
knowing before the first deploy: **keep port 80 published anyway.** Let's Encrypt's HTTP-01
challenge starts there, and it is not a browser, so it does not consult the preload list. Closing 80
because "nothing can use http now" is how you fail a challenge against the rate limit below.

### 2. The box

```bash
cd infra
./bootstrap-state-backend.sh              # once, ever. State holds an IAM secret key.
terraform init -backend-config=backend.hcl

# Terraform cannot see an `aws login` session. Do this in the same shell first, EVERY time,
# because the credentials are temporary. See below.
eval "$(aws configure export-credentials --format env)"

terraform apply
terraform output static_ip                # -> the A record above
```

> **`aws login` and Terraform do not talk to each other.** The CLI stores the session under
> `~/.aws/login` and points at it with `login_session` in `~/.aws/config`, which is an AWS CLI
> feature: there is no `~/.aws/credentials`, and Terraform's provider uses the Go SDK, which knows
> nothing about it. It does not fall back to the CLI either, it reports **"No valid credential
> sources found"** and then spends 30 seconds timing out against the EC2 metadata endpoint, which
> reads like a network problem rather than a credentials one.
>
> `aws configure export-credentials` asks the CLI to resolve whatever it is using and print it as
> environment variables, which the provider does understand. They expire, so it is per shell, not
> once.

> **A new account cannot create a Lightsail instance at all.** The first apply on this account
> failed with `InvalidInputException: Sorry, you've reached your maximum limit of Lightsail
> Instances : 0`. Nothing is wrong with the config, AWS gates Lightsail until the account clears
> whatever verification it is waiting on. Opening the Lightsail console and starting an instance by
> hand usually triggers it; otherwise it is "try again later", or a support case.
>
> Everything else applies fine, which is the awkward part: the run half-succeeds and leaves a
> **static IP attached to nothing**. Lightsail bills about $0.005/hour for that, so destroy it
> rather than leave it waiting:
>
> ```bash
> terraform destroy -target=aws_lightsail_static_ip.app
> ```
>
> Re-running `terraform apply` once the limit lifts picks up exactly where it stopped.

Point DNS at that IP and let it resolve **before** starting nginx. Let's Encrypt will not issue a
certificate for a name that does not resolve to you, and failed challenges count against a rate
limit (5 per hostname per hour).

Download the SSH key from the Lightsail console, then:

```bash
ssh -i <key>.pem ubuntu@<static-ip>
```

Cloud-init installs Docker and adds `ubuntu` to the `docker` group. That group membership only
applies to a **new** login, so log out and back in once before deploying, or every docker command
says "permission denied".

### 3. Configure and deploy

```bash
git clone https://github.com/jonathan-nam/sharpeyes.git
cd sharpeyes
cp .env.prod.example .env
vi .env                    # every field. DB_PASSWORD: openssl rand -base64 32
./deploy.sh
```

`deploy.sh` pulls the images CI built, starts them, and then polls `https://$API_DOMAIN/health`
from outside, through nginx, over TLS. A container being "up" proves nothing: the backend
crash-loops on a missing variable, and Flyway migrates on every boot, so a bad migration surfaces
here and nowhere earlier.

### 4. Frontend

On Vercel, from the repo, root directory `frontend/`:

```
NEXT_PUBLIC_API_BASE_URL=https://api.sharpeyes.app
NEXT_PUBLIC_AUTH_BASE_URL=https://api.sharpeyes.app
NEXT_PUBLIC_PASSWORD_LOGIN=false
```

The last one mirrors the box's `AUTH_PASSWORD_LOGIN` and decides only what is OFFERED. The service
decides what WORKS, so the two disagreeing hides a working form or shows a refused one, and neither
signs the wrong person in. Change them together anyway.

Both are the API hostname, and the app's own calls go there. The one PAGE a browser opens on the
auth service, Discord's redirect back, is on the apex instead: the box sets `AUTH_BASE_URL` to the
frontend's origin and `next.config.ts` proxies `sharpeyes.app/api/auth/*` to the service. Chrome's
Safe Browsing flagged that redirect as phishing when it landed on `api.` (2026-10-21).

Then register the redirect URI in the Discord application
(<https://discord.com/developers/applications> → *OAuth2*), exactly:

```
https://sharpeyes.app/api/auth/callback/discord
```

Discord matches it character for character, a trailing slash included, and refuses anything else.

### 5. Backups

The log file has to exist and be yours first, because `/var/log` is root-owned and the redirect
below fails before the command even runs:

```bash
sudo touch /var/log/sharpeyes-backup.log
sudo chown ubuntu:ubuntu /var/log/sharpeyes-backup.log
```

```bash
crontab -e
```
```
PATH=/usr/local/bin:/usr/bin:/bin
# 07:30 UTC, half an hour after the Lightsail snapshot
30 7 * * * cd /home/ubuntu/sharpeyes && ./scripts/backup-db.sh >> /var/log/sharpeyes-backup.log 2>&1
```

**The `PATH` line is required.** cron's own is `/usr/bin:/bin`, and `aws` installs to
`/usr/local/bin`. Without it the dump is taken and the upload dies on "command not found", nightly.

Check it under cron's environment rather than your shell's, because yours has neither problem:

```bash
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/ubuntu /bin/sh -c \
  'cd /home/ubuntu/sharpeyes && ./scripts/backup-db.sh'
```

**Then rehearse the restore, once, before you need it** (below). An untested backup is a file you
believe is a backup.

## Deploying a change

Push to master and let CI publish the images, then:

```bash
ssh ubuntu@<static-ip>
cd sharpeyes && ./deploy.sh
```

**No downtime, and it works differently now.** Two backend replicas sit behind nginx, and
`deploy.sh` restarts one at a time, waiting for each to answer `/health` before touching the next.

The numbers that used to be here (224 requests, 0 failures) were measured through **Caddy**, whose
active health checks pulled a restarting replica out of rotation *before* any request reached it.
**Open-source nginx has no active health checking** — that is an nginx Plus feature. The mechanism
is now `proxy_next_upstream`: the first request to a restarting replica fails and is retried
against the other. The user should still see no error, but it is reactive rather than proactive and
the old measurements do not carry over.

**Re-measure before quoting numbers here again.** A figure that was true of a different proxy is
exactly the kind of confident wrong number this project tries not to produce.

Nothing is built on the box. `.github/workflows/publish-images.yml` pushes both images to GHCR
tagged with the commit SHA, and `deploy.sh` pulls that tag. Two consequences worth knowing:

- **The images are public**, inherited from the repository, so the box pulls them without a
  registry login. Verified anonymously against GHCR: both manifests answer 200 with no credentials.
  If that ever changes, a pull 403s and the Packages tab is the only place to look.
- **`deploy.sh` waits up to 5 minutes** for the images to appear, because a deploy run straight
  after a merge will beat CI to the registry.

Flyway still migrates on boot, which is why the script polls `https://$API_DOMAIN/health` from
outside rather than trusting `docker compose ps`.

Running `docker compose` by hand on the box needs `IMAGE_TAG` set, even for `logs` or `ps`: Compose
interpolates the whole file on every subcommand. Any value works when you are not starting anything.
There is deliberately no default, because a `latest` that silently outranks the checked-out commit
is how a rollback ends up running the code it was rolling back from.

### Migrations must survive the previous release

Both replicas do not restart at once, so for the length of a deploy the **old code runs against the
new schema**. That is not a property of this script, it is what rolling anything means.

Dropping or renaming a column therefore takes two deploys: add the new shape and write to both,
deploy, then remove the old one in a later commit. Flyway's lock handles the concurrency itself
(verified: two replicas booting against an empty database, one applied all 66 migrations while the
other waited and found it up to date), so the risk is never a corrupt schema. It is the old binary
selecting a column that the new schema no longer has.

### Rolling back

Revert on master and deploy that, which keeps the box on a branch and CI on the thing that is
running. When it has to be faster than a PR, roll back on the box, bypassing `deploy.sh`:

```bash
git checkout <last-good-sha>                                   # detached HEAD
IMAGE_TAG=$(git rev-parse HEAD) docker compose \
  -f docker-compose.yml -f docker-compose.prod.yml up -d
```

`IMAGE_TAG` has to be set by hand here, because it is `deploy.sh` that normally derives it from the
checkout. Without it Compose has no tag to pull and refuses to start. Note this restarts both
replicas at once, so unlike a deploy it is not free; it is the emergency path.

`deploy.sh` cannot do this. It starts with `git pull --ff-only`, which on a detached HEAD exits with
"You are not currently on a branch" before anything is built. Get the box back onto `master` before
the next deploy, or that one fails the same way.

Either route rolls back **code only**. Flyway has no down migrations, so a schema change stays
applied and an old backend then runs against a newer schema. If the bad deploy carried a migration,
restore from S3 instead (below), and take a backup *before* deploying one:

```bash
./scripts/backup-db.sh
```

Note that `R__` migrations are repeatable: they re-run whenever their checksum changes, so a catalog
edit applies on the next deploy without a new version number.

Changing `.env` needs `up -d` afterwards. It is not in git, so `deploy.sh`'s pull will not touch it,
and a running container will not pick it up.

## What watches this

Three things, and they catch different failures. None of them overlaps as much as it looks.

| Watcher | Catches | Misses |
| --- | --- | --- |
| Lightsail alarms | the instance dying or pegging CPU | everything software: 502s, a wedged Postgres, an expired certificate |
| `.github/workflows/uptime.yml` | the API failing to reach its database, the frontend down, the certificate running out, the backup cron stopping | anything in the ~15 minutes between runs |
| `certbot` renewal | nothing. It is a thing to be watched, not a watcher | |

**The alert is a workflow going red.** GitHub emails the repo owner when a scheduled run fails on the
default branch, and that is the entire notification mechanism, so nothing should fail in that
workflow that is not worth an email. Each check retries three times before calling it.

**`/health` is not a database check and must not become one.** It answers `ok` with Postgres dead,
deliberately, because `deploy.sh` polls it to gate a rolling restart and a slow query must not stall
one. Point monitors at **`/health/db`**, which runs `SELECT 1` and answers 503 within two seconds
when it cannot.

**Nothing emails you about certificate expiry.** Let's Encrypt ended expiration notifications on
2025-06-04 and no longer stores the address, so the workflow's certificate check is the only warning
that exists. Verify renewal actually works without spending a rate limit:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec certbot \
  certbot renew --webroot --webroot-path /var/www/certbot --dry-run
```

### The backup check needs its own key

The box's backup user is `PutObject`-only on purpose, so it cannot list the bucket and cannot tell
you whether the dump stopped arriving. `aws_iam_user.backup_reader` in `infra/` is a second identity
with `ListBucket` and nothing else. The box writes and cannot read; GitHub reads and cannot write.

After `terraform apply`, wire it up. Read the secret in a terminal that is **not** being transcribed:

```bash
cd infra
terraform output -raw backup_reader_secret_access_key
```

```bash
gh variable set BACKUP_BUCKET --body "$(terraform output -raw backup_bucket)"
gh secret set BACKUP_READER_ACCESS_KEY_ID --body "$(terraform output -raw backup_reader_access_key_id)"
gh secret set BACKUP_READER_SECRET_ACCESS_KEY   # paste when prompted
```

The backup job skips itself while `BACKUP_BUCKET` is unset, so the workflow is not red in the
meantime.

## Restoring the database

Do this once as a rehearsal, into a scratch database, and compare row counts. The box's own
credentials are **PutObject-only**, so it cannot read its backups. Restore from a machine that can.

```bash
# From your laptop, with real AWS credentials:
aws s3 ls s3://sharpeyes-backups-<account-id>/
aws s3 cp s3://sharpeyes-backups-<account-id>/sharpeyes-<stamp>.sql.gz .

# On the box, into a scratch database first:
gunzip -c sharpeyes-<stamp>.sql.gz | \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  psql -U sharpeyes -d postgres -c 'CREATE DATABASE restore_check;' -d restore_check

# Compare. If these disagree, the backup is not a backup.
docker compose ... exec -T postgres psql -U sharpeyes -d sharpeyes   -c 'select count(*) from character_token;'
docker compose ... exec -T postgres psql -U sharpeyes -d restore_check  -c 'select count(*) from character_token;'
```

## Rebuilding after the box dies

This is why `infra/` exists rather than a console click.

```bash
cd infra && terraform apply     # new box, same static IP
```

Then steps 3 and 5 above, plus a restore. The instance comes back **empty**: Docker and nothing
else. The static IP survives, so DNS does not change.

## Things that will bite

- **Never publish 5432 or 8000.** `docker-compose.prod.yml` unpublishes them with `ports: !reset []`,
  which is needed because Compose *merges* `ports` across files rather than replacing them. Check it
  from off the box after any compose change: `curl --max-time 5 http://<static-ip>:5432` must fail.
- **Deleting a service from the prod overlay does not undeploy it.** Compose *merges* overlays, so
  a service defined in `docker-compose.yml` and absent from `docker-compose.prod.yml` is still
  deployed, with the base file's settings. That is how the parser nearly shipped to the box with
  `build:` and port 8000 published, which is worse than what it replaced. It is behind a compose
  **profile** instead. Check with
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml config --services`.
- **certbot renewal fails silently, and the site breaks 90 days later.** This is the cost of nginx
  over Caddy, which renewed by itself. `docker compose logs certbot` is the only thing that will
  tell you, and nothing will prompt you to look. If https ever stops working for no apparent
  reason, look there first.
- **nginx renders its config at start-up, not on reload.** The template is bind-mounted and
  `${API_DOMAIN}` is substituted by the image's entrypoint, which only runs when the container
  starts. A changed template therefore needs the container recreated before `nginx -s reload` has
  anything new to load; `deploy.sh` does both, in that order.
- **Do not shrink screenshots in the browser** to speed up uploads from far away. That is the bug
  this project exists to prevent: an OCR path that resampled its own evidence away and returned
  confident wrong counts. Uploads are 1.25-3.1 MB and that is fine.
- **Do not switch the backend to a fat jar.** Shading clobbers `META-INF/services` and silently
  breaks Flyway, which migrates on every boot. `backend/Dockerfile` says so too.
- The box needs egress to `nexon.com` (character lookups).
