# Task
Write a title of one or two short words for the task in `<user>`.

The complete title must be at most 18 characters so it remains fully readable in a terminal tab. Prefer a concrete noun or a verb followed by a noun. Preserve names and technical terms exactly. Do not add punctuation, labels, quotes, or explanations. If there is no task, output `<title/>`.

# Repo dot

Every tab title ends with a colored dot that identifies the repo the session runs in: `Ghostty Tabs 🟢`. Terminal tab titles carry no color, so the color is the glyph itself.

The dot is picked from `🟢 🔵 🟣 🟠 🔴 🟡 🟤 ⚪ ⚫` and recorded in `~/.omp/agent/tab-dots.json`, keyed by git repo root (falling back to the session cwd outside a repo). A repo keeps its dot across sessions; a new repo claims a color no other tracked repo holds. Entries for deleted folders are pruned on read, which returns their colors to the pool. Once all nine are held, the new repo takes the color of the least recently used repo.

The title is set twice: at `session_start` (session name, else the repo folder name) and after each first-message title generation.
