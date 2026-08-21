# Local workspace layout

The Desktop is not a working directory. Active files live under `~/Projects`; macOS screenshots go directly to the private `davedoodz/mac-screenshots` repository.

## Directory map

| Purpose | Local directory |
| --- | --- |
| Application repositories | `~/Projects/apps` |
| Portfolio linked worktrees | `~/Projects/worktrees/david-room-portfolio` |
| Tool and configuration repositories | `~/Projects/tools` |
| Shared media and references | `~/Projects/assets` |
| Inactive or recovery material | `~/Projects/archive` |
| Screenshot checkout | `~/Projects/screenshots` |
| This repository | `~/Projects/config/ghostty-config` |

## Moved repositories

- `david-lafond-designs`, `david-room-portfolio`, `global-interiors`, `global-interiors-scl`, `global-interiors-source`, `nintendogs-for-mac`, `paper-design-repo`, `reself`, and `tag-soup-kitchen` moved from `~/Desktop` to `~/Projects/apps`.
- `local-portfolio-main`, `project-assets`, `projects-wt`, and `testimonial-wt` moved to `~/Projects/worktrees/david-room-portfolio`. Their linked-worktree metadata was repaired after relocation.
- `chrome-config`, `oh-my-pi`, and `omp-configs` moved to `~/Projects/tools`.
- Media folders and loose project videos moved to `~/Projects/assets`.
- Recovery material and inactive empty project folders moved to `~/Projects/archive`.
- `paper-design-repo` retained its pre-existing broken `.git` pointer to the missing `final-portfolio` worktree metadata; its files were moved intact.

## Screenshot automation

`macos/com.davedoodz.screenshot-sync.plist` runs `macos/sync-screenshots.zsh` every five minutes. The script commits new files in `~/Projects/screenshots` and retries any unpushed commit on the next run. The GitHub repository is private.

Hidden Google Drive transfer directories under `~/Desktop` are application-managed and intentionally untouched; they do not appear as Desktop icons.
