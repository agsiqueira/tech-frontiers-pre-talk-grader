# Tech Frontiers Pre-Talk Grading Support Tool

This is an Electron-based grading support prototype for the Tech Frontiers Industry 5.0 pre-talk reflection essay.

It uses the same general stack as the debriefing tool:

- Electron desktop application
- Node.js backend logic
- HTML/CSS/JavaScript interface
- UF Navigator AI or another OpenAI-compatible chat completions endpoint
- Excel workbook export

## What it does

The tool reads every `.docx`, `.pdf`, `.txt`, or `.md` file in a selected folder. For each essay, it:

1. Extracts the text.
2. Matches the file to a student in the Canvas-style rubric CSV.
3. Grades the essay using the 40-point rubric.
4. Fills the rubric score columns and comment columns.
5. Extracts three questions from each student.
6. Ranks all extracted questions and exports the top 10.
7. Creates an Excel workbook with four sheets:
   - Rubric Scores
   - All Student Questions
   - Top 10 Questions
   - Processing Log

## Rubric implemented

The tool follows the detailed rubric discussed for the pre-talk reflection essay:

- Initial Understanding of the Topic, 8 points
- Importance and Relevance, 8 points
- Interests, Concerns, and Predictions, 8 points
- Questions for the Speaker, 10 points
- Personal Learning Goals and Writing Quality, 6 points

It preserves the point bands for Excellent, Satisfactory, and Needs Improvement.

## Instructor review

This is a grading support tool, not an automatic final grader. The instructor should review scores and comments before posting grades.

## Setup

Install Node.js 20 or newer.

```bash
npm install
npm start
```

## How to use

1. Launch the app.
2. Select the folder containing student submissions.
3. Select the Canvas-style rubric CSV.
4. Choose where to save the output `.xlsx` file.
5. Enter your API base URL, model, and API key.
6. Click **Grade Folder**.

## Default AI settings

The app defaults to:

```text
Base URL: https://api.ai.it.ufl.edu/v1
Model: granite-3.3-8b-instruct
```

Adjust these if your UF Navigator AI endpoint uses a different base URL or model name.

## File naming recommendation

For best student matching, submission filenames should include the student name, for example:

```text
Justin Williamson Pre-Talk Reflection.docx
```

If the match is weak, the tool will still process the file but may require manual review.

## Packaging

To create a distributable build:

```bash
npm run dist
```

Unsigned Windows and macOS builds may show security warnings. This is expected unless the app is code-signed.


## Parser update based on sample submission

The app now includes a deterministic parser (`src/parser.js`) tuned for the actual pre-talk essay template. Before sending text to the model, it:

- extracts the student header fields when present,
- separates the five student response sections,
- removes the embedded rubric at the end of the submission,
- extracts the speaker questions using the `Question 1:`, `Question 2:`, `Question 3:` pattern,
- passes both the parsed sections and the cleaned essay text to the model.

This reduces the risk that the model grades the assignment instructions or the rubric instead of the student's writing.

### Test the parser on one file

```bash
node sample_parse.js "path/to/ackermanluke_1309592_106953602_PreTalk_Reflection_Module_0.docx"
```

The expected output should include the extracted student name and the three speaker questions.


## Latest revision in this package

This build includes:
- Revised interface labels requested for Canvas SpeedGrader Rubric Scores.
- Settings section renamed from AI Settings to Settings.
- Save button renamed to Save.
- API key loading/saving through the local Electron settings store.
- UF NaviGator API key instructions in the left panel.
- Supportive / Summer Course grading behavior revised so complete pre-talk submissions can receive full marks.
- Manual Review Flag cleared automatically when Supportive mode awards full marks.
- A second log workbook created next to the main output file, using the suffix `_LOG.xlsx`.
- The log workbook includes a "Needs Attention" column and attempts to highlight warning/error rows.


## Parallel grading update

This build adds a **Parallel grading jobs** setting. The default is 3, with a maximum of 5. This allows the app to grade multiple submissions at the same time while reducing the risk of API rate limits.

Recommended value for UF NaviGator: 3.

This build also improves console log readability by using higher-contrast colors for INFO, SUCCESS, WARNING, ERROR, and DONE rows.


## GitHub release automation

This package includes GitHub Actions workflows for automated builds and releases.

Files included:

- `.github/workflows/test-build.yml`
- `.github/workflows/release.yml`
- `GITHUB_RELEASE_GUIDE.md`

To create a release, push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will build the Windows and macOS installers and attach them to a GitHub Release.
