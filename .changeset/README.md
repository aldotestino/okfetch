# Changesets

Use Changesets to manage version bumps for the publishable packages in this repo.

## Create a release note

```bash
bun run changeset
```

This will create a markdown file in `.changeset/` describing which packages changed and what version bump they need.

## Apply version bumps locally

```bash
bun run version-packages
```

This updates package versions, internal dependency ranges, and the lockfile.

## Publish

Publishing is handled by `.github/workflows/release.yml` through npm trusted publishing.
