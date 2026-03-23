---
name: git-worktree-workflow
description: Use when starting work on a GitHub issue or feature. Sets up an isolated git worktree, investigates the issue, plans vertical slices if complex, coordinates agent commits, reviews, and prepares a PR summary.
---

# Git Worktree Workflow

## Overview

Isolated feature development using git worktrees. Each issue gets its own worktree under `.claude/worktrees/`, branched from the current feature branch.

**Ask the User for permission:** "Can I use git worktrees to set up an isolated workspace for this issue?"
Use the "AskUserQuestion" tool to get explicit approval before proceeding.

---

## Step 1 — Verify Current Branch

Before doing anything else, confirm we are on a feature branch (not `main` or `master`).

```bash
git branch --show-current
```

- If on main or master: stop and ask the user which feature branch to use. Do not proceed until on a feature branch.
- If already on a feat/... branch: continue.

The worktree will branch off the current feature branch, not main.

---

## Step 2 — Name the Worktree Branch

If you're not already on a feature branch, we should branch off the current branch before creating the worktree.

Branch naming scheme: `feat/{issue-number}-{short-description}`

Examples: `feat/12-improve-performance`, `feat/34-fix-agent-filtering`, `feat/7-add-export`

If the user provided an issue number and description, derive the name.
If a git issue is referenced, retrieve the issue title and number to create the branch name.

Otherwise, ask the user: "What issue number and short description should I use for the branch?"

---

## Step 3 — Create the Worktree

```bash
# Ensure .worktrees is gitignored
grep -q '\.worktrees' .gitignore || echo '.worktrees/' >> .gitignore

# Create the worktree
git worktree add .worktrees/{branch-name} -b {branch-name}
```

Install dependencies in the worktree:

```bash
cd .worktrees/{branch-name}
[ -f package.json ] && bun install || true
[ -f Cargo.toml ] && cargo build || true
[ -f requirements.txt ] && pip install -r requirements.txt || true
```

---

## Step 4 — Investigate the Issue

Read the issue description carefully. Check relevant files in `.worktrees/{branch-name}`.

Answer:
1. What is the user-visible problem or goal?
2. Which files are affected?
3. Are there existing tests to run?
4. Is there a risk of regression?

**Complexity gate:** If the issue touches more than ~3 files or has distinct independent sub-problems, proceed to Step 5 (plan vertical slices). If it is simple and contained, go directly to Step 6.

---

## Step 5 — Plan Vertical Slices (complex issues only)

Break the issue into vertical slices — each slice delivers an independently testable piece of value, not a technical layer.

**Good slices:**
- "Add the DB query + API endpoint for X"
- "Add the UI component for X"
- "Wire X end-to-end and add integration test"

**Bad slices:**
- "All backend changes"
- "All frontend changes"

Present the plan to the user:

> "Here is my proposed breakdown for this issue:
> 1. [slice description] — files: X, Y
> 2. [slice description] — files: A, B
> 3. [slice description] — files: C
>
> Does this look right before I start?"

Wait for user approval before proceeding.

---

## Step 6 — Implement

Verify once that git status is clean and does not contain the worktree directory:

```bash
git status
```

Work inside `.worktrees/{branch-name}`. Commit frequently with clear messages.

Each commit should:
- Be scoped to one logical change
- Include passing tests (run tests before each commit)
- Follow the existing commit message style

```bash
# From inside the worktree
git add <specific files>
git commit -m "feat: description of change"
```

Never commit directly to the parent feature branch while work is in progress.

---

## Step 7 — Pre-merge Checklist

Before proposing a merge, verify all of the following:

- All tests pass
- No build/type errors
- Each slice was committed separately
- Commit messages are clean and descriptive

If any check fails: fix it, commit, and re-run before continuing.

---

## Step 8 — Code Review

Perform a self-review of the diff against the original issue:

```bash
git diff {parent-feature-branch}...HEAD
```

Review checklist:
- Does the implementation match the issue requirements exactly? (no more, no less)
- Are there any obvious bugs, edge cases, or regressions?
- Is any code duplicated or overly complex?
- Are error states handled?

Fix any issues found, commit, and re-run tests.

---

## Step 9 — Ask User Before Merging

Present a summary and ask for approval:

> Summary of changes in `.worktrees/{branch-name}`:
>
> - [What was changed and why]
> - [Files modified: list]
> - [Tests: X passing, 0 failing]
>
> Shall I merge this into `{parent-feature-branch}`?
> I can also create a pull request if you prefer to review on GitHub first.

Wait for explicit user approval. Do not merge without it.

---

## Step 10 — Merge and Clean Up

Once the user approves:

```bash
# From the repo root (not the worktree)
git checkout {parent-feature-branch}
git merge --no-ff .worktrees/{branch-name} -m "merge: {branch-name} into {parent-feature-branch}"

# Remove the worktree
git worktree remove .worktrees/{branch-name}
git branch -d {branch-name}
```

---

## Step 11 — Final Summary

Provide a concise summary:

> Done. Changes from `{branch-name}` are merged into `{parent-feature-branch}`.
>
> What changed: [1–3 bullet points]
> Tests: X passing
>
> When you're ready I can open a pull request from `{parent-feature-branch}` into main.

---

## Quick Reference

| Situation | Action |
|---|---|
| On main/master | Ask user for feature branch before proceeding |
| Issue is simple (≤3 files) | Skip slice planning, implement directly |
| Issue is complex | Plan vertical slices, get user approval |
| Tests fail | Fix before asking to merge |
| User wants PR instead of merge | Skip Step 10, just push and create PR |

## Red Flags — Never Do These

- Never branch worktrees off main or master directly
- Never merge without user approval
- Never merge with failing tests
- Never commit worktree artifacts to the main repository (ensure `.worktrees/` is gitignored)
- Never work on multiple issues in the same worktree
