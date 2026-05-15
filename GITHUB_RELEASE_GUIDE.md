# GitHub Hosting and Release Automation Guide

This project is ready to host on GitHub and build installers automatically with GitHub Actions.

## What is included

This version includes:

- `.gitignore`
- `.github/workflows/test-build.yml`
- `.github/workflows/release.yml`

The release workflow builds:

- Windows `.exe` installer on `windows-latest`
- macOS `.dmg` installer on `macos-latest`

When you push a tag such as `v1.0.0`, GitHub Actions will create a GitHub Release and attach the installers.

## First-time GitHub setup

Create a new GitHub repository, for example:

```bash
tech-frontiers-pre-talk-grader
```

Then, from the project folder:

```bash
git init
git add .
git commit -m "Initial release-ready version"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/tech-frontiers-pre-talk-grader.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username or organization.

## Test the build first

After pushing to `main`, go to:

```text
GitHub repository > Actions > Test Build
```

Run the workflow manually if it did not start automatically.

This creates a test build artifact but does not publish a release.

## Create an official release

Update the version in `package.json` if needed. For example:

```json
"version": "1.0.1"
```

Commit the version change:

```bash
git add package.json
git commit -m "Bump version to 1.0.1"
git push
```

Create and push a tag:

```bash
git tag v1.0.1
git push origin v1.0.1
```

The `Build and Release` workflow will run automatically.

After it finishes, go to:

```text
GitHub repository > Releases
```

You should see a release with the Windows and macOS installers attached.

## Notes about unsigned installers

The generated Windows and macOS installers are not code-signed by default.

This means users may see warnings such as:

- Windows SmartScreen warning
- macOS unidentified developer warning

This is expected for unsigned open-source/internal builds.

To remove these warnings, the app would need code signing:

- Windows: code-signing certificate
- macOS: Apple Developer account, Developer ID certificate, notarization

## Recommended release naming

Use semantic version tags:

```text
v1.0.0
v1.0.1
v1.1.0
```

## Suggested GitHub release description

```text
Tech Frontiers Pre-Talk Grader

This release includes:
- Supportive / Summer Course grading calibration
- Parallel grading jobs
- Canvas SpeedGrader Rubric Scores file support
- Console log workbook export
- Improved console readability
- UF NaviGator API key instructions
```
