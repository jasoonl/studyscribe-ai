# Claude skills

This repo ships two Claude Code project skills in `.claude/skills/`. Claude Code loads them automatically in this project:

- **`ui-ux-pro-max`**: [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) v2.15.0 (MIT, see its `LICENSE`). It is a searchable local database of UX guidelines, styles, palettes, font pairings, charts and per-stack rules, plus a design-system generator. It was installed with `npx ui-ux-pro-max-cli@2.15.0 init --ai claude`, with the upstream test fixtures removed. It needs Python 3 and nothing else.
- **`studyscribe-ui`**: StudyScribe's house rules. It keeps the existing tokens, fonts and components, and lists the "AI-generated look" patterns we never ship. Where ui-ux-pro-max's generic recommendations differ, this skill wins.

## Using ui-ux-pro-max everywhere (general skill)

`build.sh` turns the project copy into general copies that work outside this repo.

**Claude Code, in every project.** On your own computer, from this repo:

```bash
tools/claude-skills/build.sh install   # copies it to ~/.claude/skills/ui-ux-pro-max
```

You can also use upstream's own installers, `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` then `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill`, or `npx ui-ux-pro-max-cli init --ai claude --global`. Those also add upstream's companion skills (brand, slides, banner-design and others).

**Claude (claude.ai, desktop and mobile apps).** In Claude, open Settings, find Skills, choose to upload a skill, and pick `ui-ux-pro-max.zip` from this folder. Code execution must be on, because the skill runs a Python script. Rebuild the zip after updating the skill:

```bash
tools/claude-skills/build.sh zip
```

## Updating

```bash
cd "$(mktemp -d)" && npx -y ui-ux-pro-max-cli@latest init --ai claude
```

Copy the new `.claude/skills/ui-ux-pro-max` over the one in this repo, delete `scripts/tests`, then run `build.sh zip`.
