# Releasing session-kit

The `Release alpha` workflow is manually triggered. It releases an alpha version
already committed to `main`; it does not change versions or commit files.
It checks and packs with pnpm, publishes the verified tarball to npm using `next`,
then creates a Git tag and GitHub prerelease at the workflow's commit.

## One-time npm setup

Push `.github/workflows/release.yml` to `main` before configuring npm.
In the npm settings for `@monarcode/session-kit`, add a GitHub Actions trusted
publisher with these values:

| Field | Value |
| --- | --- |
| Organization or user | `monarcode` |
| Repository | `session-kit` |
| Workflow filename | `release.yml` |
| Environment | Leave blank |
| Allowed action | Enable **Allow npm publish** |

The workflow uses direct publishing. npm's newer default allowing staged
publishing alone is insufficient. No npm token secret is required.
See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).
The workflow runs on GitHub-hosted runners with Node.js 24 and npm >=11.5.1.
For this public repository/package, trusted publishing also generates provenance.

## Release an alpha

1. Make the intended package changes. Set `package.json` to a new alpha version,
   such as `0.1.0-alpha.1`, and add its `## 0.1.0-alpha.1` section to `CHANGELOG.md`.
2. Run `pnpm run check`, then commit and push those changes to `main`.
3. Open GitHub Actions → **Release alpha** → **Run workflow**. Choose `main`
   and enter the exact package version, without a `v` prefix.
4. Verify the run succeeds, npm exposes the version through `next`, and the
   matching GitHub prerelease exists.

The workflow rejects a different branch, invalid or mismatched versions, missing
release notes, an existing npm version, and an existing Git tag. It does not
support stable releases yet. The published `0.1.0-alpha.0` cannot be republished.

The build job has read-only repository permissions. Only the publishing job
receives OIDC and release-write permissions. Its tarball and release notes come
from the same run's artifact, retained for 14 days. Publishing uses npm only for
the OIDC-authenticated upload; installation, tests, and packing use pnpm.

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
