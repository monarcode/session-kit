# Releasing session-kit

The `Release` workflow is manually triggered. It releases an alpha or release
candidate version already committed to `main`; it does not change versions or
commit files.
It checks and packs with pnpm, publishes the verified tarball to npm using `latest`,
then creates a Git tag and GitHub prerelease at the workflow's commit.

## One-time npm setup

Push `.github/workflows/release.yml` to `main` before configuring npm.
In the npm settings for `@monarcode/session-kit`, add a GitHub Actions trusted
publisher with these values:

| Field                | Value                        |
| -------------------- | ---------------------------- |
| Organization or user | `monarcode`                  |
| Repository           | `session-kit`                |
| Workflow filename    | `release.yml`                |
| Environment          | Leave blank                  |
| Allowed action       | Enable **Allow npm publish** |

The workflow uses direct publishing. npm's newer default allowing staged
publishing alone is insufficient. No npm token secret is required.
See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).
The workflow runs on GitHub-hosted runners with Node.js 24 and npm >=11.5.1.
For this public repository/package, trusted publishing also generates provenance.

## Release an alpha or release candidate

1. Make the intended package changes. Set `package.json` to the new version,
   such as `0.1.0-rc.0`, and rename `CHANGELOG.md`'s `## Unreleased` heading
   to `## 0.1.0-rc.0`.
2. Run `pnpm run check`, then commit and push those changes to `main`.
3. Open GitHub Actions → **Release** → **Run workflow**. Choose `main`
   and enter the exact package version, without a `v` prefix.
4. Verify the run succeeds, npm exposes the version through `latest`, and the
   matching GitHub prerelease exists.

The workflow rejects a different branch, invalid or mismatched versions, missing
release notes, an existing npm version, and an existing Git tag. It takes
`-alpha.N` and `-rc.N` versions only, not stable releases yet. The published
`0.1.0-alpha.0` cannot be republished.

The build job has read-only repository permissions. Only the publishing job
receives OIDC and release-write permissions. Its tarball and release notes come
from the same run's artifact, retained for 14 days. Publishing uses npm only for
the OIDC-authenticated upload; installation, tests, and packing use pnpm.

## The docs site

Cloudflare Pages builds the site from this repository. Its production branch
is `site`, so the live docs show the newest release, and `main` deploys as a
preview: the docs for what's next. Every pull request gets a preview too.

One-time setup, in Cloudflare Pages: connect the repository, set the
production branch to `site`, the build command to `pnpm run build:site`, the
output directory to `site/dist/client`, and the `NODE_VERSION` variable to
`24`. Then create the branch once from `main`:

```sh
git push origin main:refs/heads/site
```

After publishing, the Release workflow moves `site` to the released commit.
If that step fails, the package is published: move the branch yourself, with
the run's full commit SHA. A release whose changes include
`.github/workflows/` may need this, since the workflow's token can't update
a branch to a commit that changes workflow files.

```sh
git push --force origin FULL_COMMIT_SHA_FROM_THE_RUN:refs/heads/site
```

**Fixing the live docs between releases.** Fix it on `main` first, then
cherry-pick the commit onto `site`. The next release moves `site` to a
commit that already has the fix. A fix made only on `site` is lost.

```sh
git switch site
git cherry-pick FIX_SHA
git push origin site
```

**Starting a new release line.** Before releasing the first version of a new
line, such as `0.2.0-rc.0`, freeze the outgoing line's docs:

```sh
node scripts/snapshot-docs.mjs 0.1
```

It copies the pages from the line's newest release tag into
`site/content/docs/0.1/`, with that release's types from npm, and adds it to
the site's version dropdown. Commit the result with the release. After a
later patch to an old line, run it again for that line.

## Recover a partial release

If npm publishing fails, resolve the reported problem before rerunning. Check
whether npm already contains the version before attempting another publication.

If npm succeeds but GitHub release creation fails, do not bump the version or
republish. Download the `session-kit-release` artifact from that run and create
the missing GitHub prerelease with its `release-notes.md`, using the original
run's full commit SHA:

```sh
gh release create v0.1.0-alpha.1 \
  --repo monarcode/session-kit \
  --target FULL_COMMIT_SHA_FROM_THE_RUN \
  --title v0.1.0-alpha.1 \
  --prerelease --latest=false \
  --notes-file /absolute/path/to/release-notes.md
```

Use the affected version in that command. If the tag or release already exists,
inspect it and complete the missing step rather than creating it again.
