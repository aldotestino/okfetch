# Changesets

Use Changesets to record release intent for the publishable packages in this
repository.

## Create A Changeset

```bash
bun run changeset
```

Select the changed package and its release level, then commit the generated
`.changeset/*.md` file with the code change. The publishable packages are a fixed
group, so Changesets applies the highest selected release level to all of them
and keeps their versions aligned.

Do not run `bun run version-packages` as part of the normal contribution flow.
That command consumes pending changesets and is run by the release workflow.

## Release

After a changeset reaches `main`, `.github/workflows/release.yml` creates or
updates a release PR. That PR contains package version updates, package
changelogs, internal dependency updates, the lockfile update, and deletion of
the consumed changeset files.

Merging the release PR publishes through npm trusted publishing. Changesets
then creates a package-specific Git tag and GitHub Release for every published
package.
